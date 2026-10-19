const wolf = require('./roles/wolf');
const grandWolf = require('./roles/grandWolf');
const citizen = require('./roles/citizen');
const seer = require('./roles/seer');
const doctor = require('./roles/doctor');
const { recordNightAction } = require('./historyHelper');

const roleActions = {
    Wolf: wolf,
    GrandWolf: grandWolf,
    Citizen: citizen,
    Seer: seer,
    Doctor: doctor
};

let nightActionQueue = [];
let actedPersistentIds = new Set(); // Track persistent IDs of players who acted this night

function handlePlayerAction(socket, data, io, players) {
    const player = players.find(p => p.id === socket.id);
    if (!player || !player.alive) return;

    if (!player.history) player.history = [];

    const role = player.role;
    if (roleActions[role]) {
        roleActions[role](socket, data, io, players, nightActionQueue);
        
        // Track that this player has taken an action
        actedPersistentIds.add(player.persistentId);

        // Notify the host about updated action status
        broadcastActionStatus(io, players);
    }
}

// Check if all living players with active night roles (Wolf, GrandWolf, Doctor, Seer) have acted
function areAllNightActionsSubmitted(players) {
    const requiredRoles = ['Wolf', 'GrandWolf', 'Doctor', 'Seer'];
    const activeLivingPlayers = players.filter(p => p.alive && requiredRoles.includes(p.role));

    return activeLivingPlayers.every(p => actedPersistentIds.has(p.persistentId));
}

// Send current completion stats (e.g., "2/3 players acted") to host
function broadcastActionStatus(io, players) {
    const requiredRoles = ['Wolf', 'GrandWolf', 'Doctor', 'Seer'];
    const activeLivingPlayers = players.filter(p => p.alive && requiredRoles.includes(p.role));
    
    const countActed = activeLivingPlayers.filter(p => actedPersistentIds.has(p.persistentId)).length;
    const totalRequired = activeLivingPlayers.length;
    const allReady = countActed >= totalRequired;

    io.emit('night-status-update', {
        actedCount: countActed,
        totalRequired: totalRequired,
        allReady: allReady
    });
}

function resolveNightActions(io, players, dayNum) {
    nightActionQueue.sort((a, b) => a.priority - b.priority);

    let savedTargetId = null;
    let killedTargetId = null;
    let resultLog = "Night Results: ";

    const wolfVotes = {};
    
    nightActionQueue.forEach(action => {
        const actor = players.find(p => p.id === action.actorId);
        if (actor) {
            if (!actor.history) actor.history = [];
            const target = players.find(p => p.persistentId === action.targetId);
            const targetName = target ? target.username : 'Someone';

            if (action.targetId) {
                // 1. Record into centralized historyData helper
                recordNightAction(dayNum || 1, actor.persistentId, action.targetId);

                // 2. Generic player-to-player visit log for personal chronicle UI
                actor.history.push({
                    day: dayNum || 1,
                    phase: 'Night',
                    action: `Visited ${targetName}`,
                    result: 'Action executed in the shadows.'
                });
            }

            // Specific role resolution logic
            if (action.role === 'Wolf' || action.role === 'GrandWolf') {
                if (action.targetId) {
                    wolfVotes[action.targetId] = (wolfVotes[action.targetId] || 0) + 1;
                }
            } else if (action.role === 'Doctor') {
                savedTargetId = action.targetId;
            } else if (action.role === 'Seer') {
                const seerSocket = action.actorId;
                if (target) {
                    io.to(seerSocket).emit('seer-result', { 
                        message: `Oracle vision: Target is a ${target.role}` 
                    });
                }
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
            resultLog += `The attack was successfully saved by the Apothecary! `;
        } else {
            const victim = players.find(p => p.persistentId === killedTargetId);
            if (victim) {
                victim.alive = false;
                resultLog += `Tragedy befell the village. A cold body was found in the square at dawn. `;
                if (victim.id) {
                    io.to(victim.id).emit('player-eliminated');
                }
            }
        }
    } else {
        resultLog += `The night was quiet. No blood was spilled. `;
    }

    // Reset night action tracking for the next cycle
    nightActionQueue = [];
    actedPersistentIds.clear();

    io.emit('game-log', { message: resultLog });
    io.emit('update-players', players);
}
// Add day vote tracking structures at the top of roleActions.js
let dayVotes = {}; // Maps voterPersistentId -> targetPersistentId or 'abstain'

function recordDayVote(voterPersistentId, targetPersistentId) {
    dayVotes[voterPersistentId] = targetPersistentId;
}
function resolveDayVote(io, players) {
    const voteCounts = {};
    let totalVotesCast = 0;
    let totalAbstain = 0;

    // Tally votes from living players
    players.filter(p => p.alive).forEach(player => {
        const targetId = dayVotes[player.persistentId];

        if (!targetId || targetId === 'abstain') {
            totalAbstain++;
            if (!player.history) player.history = [];
            player.history.push({
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
                phase: 'Day Trial',
                action: `Voted to banish ${targetPlayer ? targetPlayer.username : 'Unknown'}`,
                result: 'Vote submitted to trial.'
            });
        }
    });

    // Find candidate with maximum votes
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

    // Handle Tie or No Votes
    if (topCandidates.length === 0 || maxVotes === 0) {
        resultLog += `The council abstained. No one was hanged today.`;
    } else if (topCandidates.length > 1) {
        resultLog += `The vote resulted in a tie (${maxVotes} votes each). The council could not reach consensus; no one was hanged!`;
    } else {
        // Clear majority winner
        const hangedPersistentId = topCandidates[0];
        const victim = players.find(p => p.persistentId === hangedPersistentId);

        if (victim) {
            victim.alive = false; // Mark player dead on server
            resultLog += `By majority decree, ${victim.username} was hanged in the village square! Their true role was ${victim.role}.`;
            
            // Notify the victim's socket to switch to ghost screen
            if (victim.id) {
                io.to(victim.id).emit('player-eliminated');
            }
        }
    }

    // Clear day votes for the next cycle
    dayVotes = {};

    io.emit('game-log', { message: resultLog });
    io.emit('update-players', players);
    
    return resultLog;
}

module.exports = { 
    handlePlayerAction, 
    resolveNightActions, 
    areAllNightActionsSubmitted,
    broadcastActionStatus,
    recordDayVote,
    resolveDayVote
};