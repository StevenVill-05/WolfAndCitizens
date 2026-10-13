module.exports = (socket, data, io, players) => {
        console.log(`[WOLF ACTION] Player ${socket.id} chose to attack.`);
        io.emit('game-log', { message: `A Wolf is hunting...` });
    }