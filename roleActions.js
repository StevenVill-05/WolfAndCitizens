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

let nightActionQueue = [];

function handlePlayerAction(socket, data, io, players) {
    const player = players.find(p => p.id === socket.id);
    if (!player) {
        console.log(`[ACTION ERROR] Player not found for socket: ${socket.id}`);
        return;
    }
    if (!player.alive) {
        console.log(`[ACTION IGNORED] Dead player tried to act: ${player.persistentId}`);
        return;
    }

    const role = player.role;
    console.log(`[HANDLE ACTION] Player role: ${role}`);

    if (roleActions[role]) {
        roleActions[role](socket, data, io, players, nightActionQueue);
    } else {
        console.log(`[ACTION ERROR] No action handler defined for role: ${role}`);
    }
}

function resolveNightActions(io, players) {
    console.log(`\n--- RESOLVING NIGHT ACTIONS ---`);
    nightActionQueue.sort((a, b) => a.priority - b.priority);

    let savedTargetId = null;
    let killedTargetId = null;
    let resultLog = "Night Results: ";

    nightActionQueue.forEach(action => {
        if (action.role === 'Wolf') {
            killedTargetId = action.targetId;
        } 
        else if (action.role === 'Doctor') {
            savedTargetId = action.targetId;
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

    if (killedTargetId) {
        if (killedTargetId === savedTargetId) {
            resultLog += `The attack was successfully saved by the Apothecary! `;
            console.log(`[RESULT] Victim saved by doctor.`);
        } else {
            const victim = players.find(p => p.persistentId === killedTargetId);
            if (victim) {
                victim.alive = false;
                resultLog += `Tragedy befell the village. A cold body was found in the square at dawn. `;
                console.log(`[RESULT] Victim killed: ${victim.persistentId} (alive = ${victim.alive})`);
                
                // Transfer victim to the ghost page on their controller
                if (victim.id) {
                    io.to(victim.id).emit('player-eliminated');
                }
            } else {
                console.log(`[RESULT ERROR] Could not find victim with persistentId: ${killedTargetId}`);
            }
        }
    } else {
        resultLog += `It was a quiet night. No attacks were made. `;
        console.log(`[RESULT] No wolf target submitted.`);
    }

    nightActionQueue = [];

    io.emit('game-log', { message: resultLog });
    io.emit('update-players', players);
    console.log(`-------------------------------\n`);
}

module.exports = { handlePlayerAction, resolveNightActions };