// citizen.js

function handleCitizenAction(socket, data, io, players, nightActionQueue, currentDay) {
    const player = players.find(p => p.id === socket.id || (data && p.persistentId === data.persistentId));
    if (!player || !player.alive || player.role !== 'Citizen') return false;

    const targetPlayer = players.find(p => p.persistentId === data.targetId);
    if (!targetPlayer || !targetPlayer.alive) {
        socket.emit('action-rejected', { reason: 'Target not found or no longer alive.' });
        return false;
    }

    const targetName = targetPlayer.username || 'Someone';

    // Queue action so resolveNightActions records it into the Host Archives
    const action = {
        priority: 3,
        role: 'Citizen',
        actorId: player.persistentId,
        targetId: data.targetId
    };

    if (Array.isArray(nightActionQueue)) {
        const existingIndex = nightActionQueue.findIndex(a => a.actorId === player.persistentId);
        if (existingIndex >= 0) {
            nightActionQueue[existingIndex] = action;
        } else {
            nightActionQueue.push(action);
        }
    }

    player.nightTarget = data.targetId;
    player.hasActed = true;

    if (!player.history) player.history = [];
    player.history.push({
        day: currentDay || 1,
        phase: 'Night',
        action: `Visited ${targetName}`,
        result: 'You kept watch over your fellow villager through the night.'
    });

    socket.emit('action-confirmed', { message: 'Your nightly visit has been recorded.' });
    return true;
}

module.exports = {
    handleCitizenAction
};