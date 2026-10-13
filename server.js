const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const os = require('os');
const QRCode = require('qrcode');

const { handlePlayerAction } = require('./roleActions');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

function getLocalIP() {
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
        for (const net of interfaces[name]) {
            if (net.family === 'IPv4' && !net.internal) {
                return net.address;
            }
        }
    }
    return 'localhost';
}

const PORT = 3000;
const localIP = getLocalIP();
const controllerURL = `http://${localIP}:${PORT}/controller.html`;

// State tracking
let players = [];
let hostSocketId = null;
let currentPhase = 'day'; // Default starting phase

app.get('/api/qrcode', async (req, res) => {
    try {
        const qrImageURL = await QRCode.toDataURL(controllerURL);
        res.json({ qrImageURL, controllerURL });
    } catch (err) {
        res.status(500).send('Error generating QR code');
    }
});

io.on('connection', (socket) => {
    console.log(`A device connected: ${socket.id}`);

    socket.on('register-host', () => {
        hostSocketId = socket.id;
        console.log(`Host screen registered: ${socket.id}`);
        socket.emit('update-players', players);
        socket.emit('phase-changed', { phase: currentPhase, players });
    });

    socket.on('register-player', () => {
        let player = players.find(p => p.id === socket.id);
        if (!player) {
            player = { id: socket.id, role: null, alive: true };
            players.push(player);
            console.log(`Player registered: ${socket.id} (Total players: ${players.length})`);
        }
        io.emit('update-players', players);
    });
    
    socket.on('start-game', (selectedRoles) => {
        console.log('Host started the game with roles:', selectedRoles);

        players.forEach((player, index) => {
            const assignedRole = selectedRoles[index % selectedRoles.length];
            player.role = assignedRole;
            player.alive = true;
            io.to(player.id).emit('assigned-role', { role: assignedRole });
        });

        currentPhase = 'day';
        io.emit('game-started', players);
        io.emit('phase-changed', { phase: currentPhase, players });
    });

    // Handle host switching between Day and Night phases
    socket.on('toggle-phase', () => {
        currentPhase = currentPhase === 'day' ? 'night' : 'day';
        console.log(`Phase changed to: ${currentPhase}`);
        io.emit('phase-changed', { phase: currentPhase, players });
    });

    socket.on('player-action', (data) => {
        handlePlayerAction(socket, data, io, players);
    });

    socket.on('disconnect', () => {
        console.log(`Device disconnected: ${socket.id}`);
        
        if (socket.id === hostSocketId) {
            hostSocketId = null;
        }

        const playerExists = players.some(p => p.id === socket.id);
        if (playerExists) {
            players = players.filter(p => p.id !== socket.id);
            console.log(`Player removed. Total players: ${players.length}`);
            io.emit('update-players', players);
        }
    });
});

server.listen(PORT, () => {
    console.log(`\n========================================`);
    console.log(` Game server is running!`);
    console.log(` PC Lobby:    http://localhost:${PORT}`);
    console.log(` Phone Link:  ${controllerURL}`);
    console.log(`========================================\n`);
});