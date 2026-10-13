module.exports = (socket, data, io, players, nightActionQueue) => {
    nightActionQueue.push({
        priority: 2, // Medium priority: Happens after kills
        role: 'Doctor',
        actorId: socket.id,
        targetId: data.targetId
    });
    console.log(`[DOCTOR] Queued protection action on target: ${data.targetId}`);
};