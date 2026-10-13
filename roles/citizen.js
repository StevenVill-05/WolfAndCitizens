module.exports = (socket, data, io, players) => {
   console.log(`[CITIZEN ACTION] Player ${socket.id} stayed alert.`);
        io.emit('game-log', { message: `A Citizen is discussing options.` });
    };