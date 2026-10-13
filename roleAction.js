// roleActions.js

const roleActions = {
    Wolf: (socket, data, io, players) => {
        console.log(`[WOLF ACTION] Player ${socket.id} chose to attack.`);
        // Add specific wolf logic here (e.g., vote to eliminate a citizen)
        io.emit('game-log', { message: `A Wolf is sharpening their claws...` });
    },

    Citizen: (socket, data, io, players) => {
        console.log(`[CITIZEN ACTION] Player ${socket.id} performed a normal action.`);
        // Add citizen logic here (e.g., general discussion vote)
        io.emit('game-log', { message: `A Citizen is staying alert.` });
    },

    Seer: (socket, data, io, players) => {
        console.log(`[SEER ACTION] Player ${socket.id} is inspecting someone.`);
        // Add seer logic here (e.g., check another player's secret role)
        socket.emit('seer-result', { info: "Inspection feature coming soon!" });
    },

    Doctor: (socket, data, io, players) => {
        console.log(`[DOCTOR ACTION] Player ${socket.id} is choosing who to protect.`);
        // Add doctor logic here (e.g., shield a player)
        socket.emit('action-success', { message: "Target protected!" });
    }
};

// Function to handle execution safely
function handlePlayerAction(socket, data, io, players) {
    // Find which player sent the action
    const player = players.find(p => p.id === socket.id);
    if (!player) return;

    const role = player.role; // e.g., "Wolf", "Citizen", etc.

    // Check if a handler exists for this role
    if (roleActions[role]) {
        roleActions[role](socket, data, io, players);
    } else {
        console.log(`No action handler defined for role: ${role}`);
    }
}

module.exports = { handlePlayerAction };