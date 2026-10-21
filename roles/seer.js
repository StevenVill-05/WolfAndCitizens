// seer.js

function handleSeerAction(socket, data, io, players, nightActionQueue, currentDay) {
    const player = players.find(p => p.id === socket.id || (data && p.persistentId === data.persistentId));
    if (!player || !player.alive || player.role !== 'Seer') return;

    const targetId = data.targetId;
    const targetPlayer = players.find(p => p.persistentId === targetId);
    if (!targetPlayer) {
        socket.emit('action-rejected', { reason: 'Target not found.' });
        return;
    }

    const targetName = targetPlayer.username || 'Someone';
    const targetRole = targetPlayer.role;
    const isEvil = (targetRole === 'Wolf' || targetRole === 'GrandWolf');

    // Queue Seer inspection action
    const action = {
        priority: 1,
        role: 'Seer',
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

    const resultMessage = isEvil ? `${targetName} is a WOLF!` : `${targetName} is a CITIZEN / VILLAGER.`;

    // Record in personal history
    if (!player.history) player.history = [];
    player.history.push({
        day: currentDay || 1,
        phase: 'Night',
        action: `Gazed upon ${targetName}`,
        result: `Visions revealed: ${resultMessage}`
    });

    // Send immediate confirmation & vision result to Seer's device
    socket.emit('action-confirmed', { 
        message: `Vision complete: ${resultMessage}`,
        inspectionResult: {
            targetId: targetId,
            targetName: targetName,
            isEvil: isEvil,
            exactRole: targetRole
        }
    });
}

module.exports = {
    handleSeerAction
};