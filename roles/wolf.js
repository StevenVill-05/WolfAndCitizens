module.exports = (socket, data, io, players, nightActionQueue) => {
    nightActionQueue.push({
        priority: 1, // Highest priority: Happens first
        role: 'Wolf',
        actorId: socket.id,
        targetId: data.targetId
    });
    console.log(`[WOLF] Queued attack action on target: ${data.targetId}`);
};