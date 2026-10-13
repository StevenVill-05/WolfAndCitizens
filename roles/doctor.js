module.exports = (socket, data, io, players) => {
        console.log(`[DOCTOR ACTION] Player ${socket.id} is protecting someone.`);
        socket.emit('action-success', { message: "Protection locked!" });
    };