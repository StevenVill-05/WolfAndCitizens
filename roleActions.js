// roleActions.js

// Safe module loader to support files in root or /roles subfolder
function loadRoleModule(name) {
    try {
        return require(`./roles/${name}`);
    } catch (e) {
        try {
            return require(`./${name}`);
        } catch (err) {
            console.error(`[Warning] Could not load role handler for ${name}:`, err.message);
            return {};
        }
    }
}

const { handleWolfAction } = loadRoleModule('wolf');
const { handleDoctorAction } = loadRoleModule('doctor');
const { handleCitizenAction } = loadRoleModule('citizen');
const { handleClownAction } = loadRoleModule('clown');
const { handleSeerAction } = loadRoleModule('seer');
const { recordNightAction, recordDayVoteAction } = loadRoleModule('historyHelper');

const roleActions = {
    Wolf: handleWolfAction,
    GrandWolf: handleWolfAction,
    Doctor: handleDoctorAction,
    Seer: handleSeerAction,
    Citizen: handleCitizenAction,
    Clown: handleClownAction
};

let nightActionQueue = [];
let actedPersistentIds = new Set();
let dayVotes = {};

/**
 * Reset night tracking structures specifically at the start of each Night phase
 */
function prepareNightPhase() {
    nightActionQueue = [];
    actedPersistentIds.clear();
}

/**
 * Handle incoming player action requests during Night
 */
function handlePlayerAction(socket, data, io, players, currentDay) {
    const player = players.find(p => p.id === socket.id || (data && p.persistentId === data.persistentId));
    if (!player || !player.alive) return;

    if (!player.history) player.history = [];

    const role = player.role;
    if (roleActions[role]) {
        const success = roleActions[role](socket, data, io, players, nightActionQueue, currentDay);
        
        // Only mark player as acted if the action succeeded
        if (success !== false) {
            actedPersistentIds.add(player.persistentId);
            broadcastActionStatus(io, players);
        }
    }
}

/**
 * Check if ALL living active players (including Citizens & Clown) have submitted night actions
 */
function areAllNightActionsSubmitted(players) {
    const requiredRoles = ['Wolf', 'GrandWolf', 'Doctor', 'Seer', 'Citizen', 'Clown'];
    const activeLivingPlayers = players.filter(p => p.alive && p.connected && requiredRoles.includes(p.role));

    if (activeLivingPlayers.length === 0) return true;
    return activeLivingPlayers.every(p => actedPersistentIds.has(p.persistentId));
}

/**
 * Broadcast progress status of night actions (including Citizens & Clown) to Host display
 */
function broadcastActionStatus(io, players) {
    const requiredRoles = ['Wolf', 'GrandWolf', 'Doctor', 'Seer', 'Citizen', 'Clown'];
    const activeLivingPlayers = players.filter(p => p.alive && p.connected && requiredRoles.includes(p.role));
    
    const countActed = activeLivingPlayers.filter(p => actedPersistentIds.has(p.persistentId)).length;
    const totalRequired = activeLivingPlayers.length;
    const allReady = totalRequired > 0 && countActed >= totalRequired;

    io.emit('night-status-update', {
        actedCount: countActed,
        totalRequired: totalRequired,
        allReady: allReady
    });
}

/**
 * Resolve all night actions queued during the Witching Hour
 */
function resolveNightActions(io, players, dayNum) {
    nightActionQueue.sort((a, b) => a.priority - b.priority);

    let savedTargetId = null;
    let killedTargetId = null;
    let resultLog = "Night Results: ";

    const wolfVotes = {};
    
    nightActionQueue.forEach(action => {
        const actor = players.find(p => p.id === action.actorId || p.persistentId === action.actorId);
        if (actor && action.targetId) {
            if (typeof recordNightAction === 'function') {
                recordNightAction(dayNum || 1, actor.persistentId, action.targetId);
            }

            if (action.role === 'Wolf' || action.role === 'GrandWolf') {
                wolfVotes[action.targetId] = (wolfVotes[action.targetId] || 0) + 1;
            } else if (action.role === 'Doctor') {
                savedTargetId = action.targetId;
            }
        }
    });

    let maxVotes = 0;
    for (const [targetId, count] of Object.entries(wolfVotes)) {
        if (count > maxVotes) {
            maxVotes = count;
            killedTargetId = targetId;
        }
    }

    if (killedTargetId) {
        if (killedTargetId === savedTargetId) {
            resultLog += `The attack was successfully thwarted by the Apothecary! `;
        } else {
            const victim = players.find(p => p.persistentId === killedTargetId);
            if (victim) {
                victim.alive = false;
                resultLog += `Tragedy befell the village. ${victim.username} was slain in the dark. `;
                
                if (victim.id) {
                    io.to(victim.id).emit('player-eliminated');
                }
            }
        }
    } else {
        resultLog += `The night was quiet. No blood was spilled. `;
    }

    // Reset night action tracking
    nightActionQueue = [];
    actedPersistentIds.clear();

    io.emit('game-log', { message: resultLog });
    io.emit('update-players', players);

    checkGameOver(io, players);

    return resultLog;
}

/**
 * Record a player's day vote choice
 */
function recordDayVote(voterPersistentId, targetPersistentId, dayNum) {
    dayVotes[voterPersistentId] = targetPersistentId;
    if (dayNum && typeof recordDayVoteAction === 'function') {
        recordDayVoteAction(dayNum, voterPersistentId, targetPersistentId);
    }
}

/**
 * Tally and resolve day trial banishing votes
 */
function resolveDayVote(io, players, dayNum) {
    const voteCounts = {};
    let totalVotesCast = 0;
    let totalAbstain = 0;

    players.filter(p => p.alive).forEach(player => {
        const targetId = dayVotes[player.persistentId];
        if (typeof recordDayVoteAction === 'function') {
            recordDayVoteAction(dayNum || 1, player.persistentId, targetId || 'abstain');
        }

        if (!targetId || targetId === 'abstain') {
            totalAbstain++;
            if (!player.history) player.history = [];
            player.history.push({
                day: dayNum || 1,
                phase: 'Day Trial',
                action: 'Abstained from voting',
                result: 'Chose not to cast a vote.'
            });
        } else {
            totalVotesCast++;
            voteCounts[targetId] = (voteCounts[targetId] || 0) + 1;
            
            const targetPlayer = players.find(p => p.persistentId === targetId);
            if (!player.history) player.history = [];
            player.history.push({
                day: dayNum || 1,
                phase: 'Day Trial',
                action: `Voted to banish ${targetPlayer ? targetPlayer.username : 'Unknown'}`,
                result: 'Vote submitted to trial.'
            });
        }
    });

    let maxVotes = 0;
    let topCandidates = [];

    for (const [targetId, count] of Object.entries(voteCounts)) {
        if (count > maxVotes) {
            maxVotes = count;
            topCandidates = [targetId];
        } else if (count === maxVotes) {
            topCandidates.push(targetId);
        }
    }

    let resultLog = `Day Trial Results: (${totalVotesCast} votes cast, ${totalAbstain} abstained). `;

    if (topCandidates.length === 0 || maxVotes === 0) {
        resultLog += `The council abstained. No one was banished today.`;
    } else if (topCandidates.length > 1) {
        resultLog += `The vote resulted in a tie (${maxVotes} votes each). No consensus was reached; no one was banished!`;
    } else {
        const hangedPersistentId = topCandidates[0];
        const victim = players.find(p => p.persistentId === hangedPersistentId);

        if (victim) {
            victim.alive = false;
            resultLog += `By majority decree, ${victim.username} was banished from the council! Their secret role was ${victim.role}.`;
            
            if (victim.id) {
                io.to(victim.id).emit('player-eliminated');
            }
        }
    }

    dayVotes = {};

    io.emit('game-log', { message: resultLog });
    io.emit('update-players', players);

    checkGameOver(io, players);

    return resultLog;
}

/**
 * Check win conditions for Wolves vs Village
 */
function checkGameOver(io, players) {
    const livingPlayers = players.filter(p => p.alive);
    const livingWolves = livingPlayers.filter(p => p.role === 'Wolf' || p.role === 'GrandWolf');
    const livingVillagers = livingPlayers.filter(p => p.role !== 'Wolf' && p.role !== 'GrandWolf');

    let winner = null;

    if (livingWolves.length === 0) {
        winner = 'Citizens';
    } else if (livingWolves.length >= livingVillagers.length) {
        winner = 'Wolves';
    }

    if (winner) {
        io.emit('game-over', { winner, players });
    }

    return winner;
}

/**
 * Reset all internal state (used during game restart)
 */
function resetRoleActionState() {
    nightActionQueue = [];
    actedPersistentIds.clear();
    dayVotes = {};
}

module.exports = { 
    handlePlayerAction, 
    resolveNightActions, 
    areAllNightActionsSubmitted,
    broadcastActionStatus,
    prepareNightPhase,
    recordDayVote,
    resolveDayVote,
    checkGameOver,
    resetRoleActionState
};