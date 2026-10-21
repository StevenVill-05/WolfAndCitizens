// clown.js

function handleClownAction(socket, data, io, players, nightActionQueue, currentDay) {
    const player = players.find(p => p.id === socket.id || (data && p.persistentId === data.persistentId));
    if (!player || !player.alive || player.role !== 'Clown') return;

    const targetPlayer = players.find(p => p.persistentId === data.targetId);
    if (!targetPlayer || !targetPlayer.alive) {
        socket.emit('action-rejected', { reason: 'Target not found or no longer alive.' });
        return;
    }

    const targetName = targetPlayer.username || 'Someone';

    // Store target and mark action completed
    player.nightTarget = data.targetId;
    player.hasActed = true;

    // Record in personal history
    if (!player.history) player.history = [];
    player.history.push({
        day: currentDay || 1,
        phase: 'Night',
        action: `Visited ${targetName}`,
        result: 'You wandered the shadows and clowned around. Nothing happened.'
    });

    socket.emit('action-confirmed', { message: 'Your clownish visit has been recorded in the shadows.' });
}

module.exports = {
    handleClownAction
};