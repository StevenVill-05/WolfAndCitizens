module.exports = (socket, data, io, players) => {
    console.log(`[WOLF ACTION] Player ${socket.id} chose to attack.`);
    // Add specific wolf logic here
    io.emit('game-log', { message: `A Wolf is hunting in the shadows...` });
};