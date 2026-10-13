module.exports = (socket, data, io, players, nightActionQueue) => {
    nightActionQueue.push({
        priority: 3, // Lower priority: Happens last
        role: 'Seer',
        actorId: socket.id,
        targetId: data.targetId
    });
    console.log(`[SEER] Queued investigation action on target: ${data.targetId}`);
};