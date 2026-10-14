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

function handlePlayerAction(socket, data, io, players) {
    const player = players.find(p => p.id === socket.id);
    if (!player || !player.alive) return;

    const role = player.role;
    if (roleActions[role]) {
        roleActions[role](socket, data, io, players, nightActionQueue);
    }
}

function resolveNightActions(io, players) {
    nightActionQueue.sort((a, b) => a.priority - b.priority);

    let savedTargetId = null;
    let killedTargetId = null;
    let resultLog = "Night Results: ";

    // Tally wolf votes (from Wolf and GrandWolf actions)
    const wolfVotes = {};
    
    nightActionQueue.forEach(action => {
        if (action.role === 'Wolf' || action.role === 'GrandWolf') {
            if (action.targetId) {
                wolfVotes[action.targetId] = (wolfVotes[action.targetId] || 0) + 1;
            }
        } else if (action.role === 'Doctor') {
            savedTargetId = action.targetId;
        } else if (action.role === 'Seer') {
            const seerSocket = action.actorId;
            const target = players.find(p => p.persistentId === action.targetId);
            if (target) {
                io.to(seerSocket).emit('seer-result', { 
                    message: `Oracle vision: Target is a ${target.role}` 
                });
            }
        }
    });

    // Select the target with the highest votes
    let maxVotes = 0;
    for (const [targetId, count] of Object.entries(wolfVotes)) {
        if (count > maxVotes) {
            maxVotes = count;
            killedTargetId = targetId;
        }
    }

    // Resolve kill vs save
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

    nightActionQueue = [];
    io.emit('game-log', { message: resultLog });
    io.emit('update-players', players);
}

module.exports = { handlePlayerAction, resolveNightActions };