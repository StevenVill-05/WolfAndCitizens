// roles/wolf.js

function handleWolfAction(socket, data, io, players, nightActionQueue, currentDay) {
    // Lookup player using socket ID or persistentId
    const player = players.find(p => p.id === socket.id || (data && p.persistentId === data.persistentId));
    if (!player || !player.alive || (player.role !== 'Wolf' && player.role !== 'GrandWolf')) return;

    const targetId = data.targetId;
    const targetPlayer = players.find(p => p.persistentId === targetId);
    if (!targetPlayer || !targetPlayer.alive) {
        socket.emit('action-rejected', { reason: 'Target not found or no longer alive.' });
        return;
    }

    const targetName = targetPlayer.username || 'Someone';

    // Priority 2: Attack resolves after Doctor protections (priority 1)
    const action = {
        priority: 2,
        role: player.role,
        actorId: player.persistentId,
        targetId: targetId
    };

    const existingActionIndex = nightActionQueue.findIndex(
        queuedAction => queuedAction.actorId === player.persistentId
    );

    if (existingActionIndex >= 0) {
        nightActionQueue[existingActionIndex] = action;
    } else {
        nightActionQueue.push(action);
    }

    // Store target and mark action completed
    player.nightTarget = targetId;
    player.hasActed = true;

    // Record in personal history
    if (!player.history) player.history = [];
    player.history.push({
        day: currentDay || 1,
        phase: 'Night',
        action: `Targeted ${targetName} for execution`,
        result: 'The pack marked this target in the dark.'
    });

    // Broadcast choice to fellow living wolves
    const livingWolves = players.filter(p => p.alive && (p.role === 'Wolf' || p.role === 'GrandWolf'));
    livingWolves.forEach(wolf => {
        if (wolf.id) {
            io.to(wolf.id).emit('wolf-vote-updated', {
                voterName: player.username,
                targetName: targetName,
                targetId: targetId
            });
        }
    });

    socket.emit('action-confirmed', { message: `Target set on ${targetName}.` });
}

module.exports = {
    handleWolfAction
};