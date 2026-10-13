const wolf = require('./roles/wolf');
const citizen = require('./roles/citizen');
const seer = require('./roles/seer');
const doctor = require('./roles/doctor');

const roleActions = {
    Wolf: wolf,
    Citizen: citizen,
    Seer: seer,
    Doctor: doctor
};

// Queue to hold actions submitted during the night
let nightActionQueue = [];

function handlePlayerAction(socket, data, io, players) {
    const player = players.find(p => p.id === socket.id);
    if (!player || !player.alive) return; // Dead players can't act

    const role = player.role;
    if (roleActions[role]) {
        roleActions[role](socket, data, io, players, nightActionQueue);
    } else {
        console.log(`No action handler defined for role: ${role}`);
    }
}
function resolveNightActions(io, players) {
    // Sort actions by priority: lowest number comes first (1 -> Wolf, 2 -> Doctor, 3 -> Seer)
    nightActionQueue.sort((a, b) => a.priority - b.priority);

    let savedTargetId = null;
    let killedTargetId = null;
    let resultLog = "Night Results: ";

    // Execute actions in strict priority order
    nightActionQueue.forEach(action => {
        if (action.role === 'Wolf') {
            killedTargetId = action.targetId; // This is now persistentId
        } 
        else if (action.role === 'Doctor') {
            savedTargetId = action.targetId; // This is now persistentId
        } 
        else if (action.role === 'Seer') {
            const seerSocket = action.actorId;
            const target = players.find(p => p.persistentId === action.targetId);
            if (target) {
                io.to(seerSocket).emit('seer-result', { 
                    message: `Seer vision: Target is a ${target.role}` 
                });
            }
        }
    });

    // Finalize life/death outcomes using persistentId lookup
    if (killedTargetId) {
        if (killedTargetId === savedTargetId) {
            resultLog += `The attack on the target was successfully saved by the Doctor! `;
        } else {
            const victim = players.find(p => p.persistentId === killedTargetId);
            if (victim) {
                victim.alive = false;
                resultLog += `Player was eliminated during the night. `;
            }
        }
    } else {
        resultLog += `It was a quiet night. No attacks were made. `;
    }

    // Clear queue for the next night cycle
    nightActionQueue = [];

    io.emit('game-log', { message: resultLog });
    io.emit('update-players', players);
}

module.exports = { handlePlayerAction, resolveNightActions };