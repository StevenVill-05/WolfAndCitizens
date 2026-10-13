module.exports = (socket, data, io, players) => {
        console.log(`[SEER ACTION] Player ${socket.id} is investigating.`);
        socket.emit('action-success', { message: "Inspection registered!" });
    };