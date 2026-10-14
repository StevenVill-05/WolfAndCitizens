// roles/grandWolf.js
module.exports = (socket, data, io, players, nightActionQueue) => {
    // Grand Wolf action logic mirrors Wolf voting/targeting
    const wolfHandler = require('./wolf');
    wolfHandler(socket, data, io, players, nightActionQueue);
};