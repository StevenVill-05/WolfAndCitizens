// roleActions.js

const wolf = require('./roles/wolf');

// Map role names to their corresponding modular file handlers
const roleActions = {
    Wolf: wolf
};

function handlePlayerAction(socket, data, io, players) {
    const player = players.find(p => p.id === socket.id);
    if (!player) return;

    const role = player.role; // e.g., "Wolf", "Citizen"

    if (roleActions[role]) {
        roleActions[role](socket, data, io, players);
    } else {
        console.log(`No action handler defined for role: ${role}`);
    }
}

module.exports = { handlePlayerAction };