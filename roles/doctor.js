// doctor.js

function handleDoctorAction(socket, data, io, players, nightActionQueue, currentDay) {
    const player = players.find(p => p.id === socket.id || (data && p.persistentId === data.persistentId));
    if (!player || !player.alive || player.role !== 'Doctor') return;

    const targetId = data.targetId;
    const targetPlayer = players.find(p => p.persistentId === targetId);
    if (!targetPlayer || !targetPlayer.alive) {
        socket.emit('action-rejected', { reason: 'Target not found or no longer alive.' });
        return;
    }

    const targetName = targetPlayer.username || 'Someone';

    // Priority 1: Protection resolves BEFORE Wolf attacks (priority 2)
    const action = {
        priority: 1,
        role: 'Doctor',
        actorId: player.persistentId,
        targetId
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
        action: `Protected ${targetName}`,
        result: 'You prepared your medicine to save this soul if attacked.'
    });

    socket.emit('action-confirmed', { message: `You are shielding ${targetName} tonight.` });
}

module.exports = {
    handleDoctorAction
};