// roles/wolf.js
module.exports = (socket, data, io, players, nightActionQueue) => {
    console.log(`[WOLF ACTION] Socket ${socket.id} targeted ${data.targetId}`);

    const existingIndex = nightActionQueue.findIndex(a => a.actorId === socket.id);
    const actionObj = {
        priority: 1, // Highest priority: Wolf kill
        role: 'Wolf',
        actorId: socket.id,
        targetId: data.targetId
    };

    if (existingIndex >= 0) {
        nightActionQueue[existingIndex] = actionObj;
    } else {
        nightActionQueue.push(actionObj);
    }
};