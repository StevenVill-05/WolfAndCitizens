const wolf = require('./roles/wolf');
const grandWolf = require('./roles/grandWolf');
const citizen = require('./roles/citizen');
const seer = require('./roles/seer');
const doctor = require('./roles/doctor');

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

function resolveNightActions(io, players) {
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

            if (action.role === 'Wolf' || action.role === 'GrandWolf') {
                if (action.targetId) {
                    wolfVotes[action.targetId] = (wolfVotes[action.targetId] || 0) + 1;
                    actor.history.push({
                        phase: 'Night',
                        action: `Voted to strike ${targetName}`,
                        result: 'Submitted decree to the pack.'
                    });
                }
            } else if (action.role === 'Doctor') {
                savedTargetId = action.targetId;
                actor.history.push({
                    phase: 'Night',
                    action: `Attempted to heal ${targetName}`,
                    result: 'Healing potion administered.'
                });
            } else if (action.role === 'Seer') {
                const seerSocket = action.actorId;
                if (target) {
                    io.to(seerSocket).emit('seer-result', { 
                        message: `Oracle vision: Target is a ${target.role}` 
                    });
                    actor.history.push({
                        phase: 'Night',
                        action: `Scryed into the soul of ${targetName}`,
                        result: `Vision revealed role: ${target.role}`
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

module.exports = { 
    handlePlayerAction, 
    resolveNightActions, 
    areAllNightActionsSubmitted,
    broadcastActionStatus 
};