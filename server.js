const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const os = require('os');
const QRCode = require('qrcode');

// Import modular role action handlers & night resolution
const { handlePlayerAction, resolveNightActions } = require('./roleActions');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Serve static files from the 'public' folder
app.use(express.static('public'));

// Helper function to find your computer's local IP address on your Wi-Fi/LAN
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

// Route to generate a QR code data URL for the big screen to display
app.get('/api/qrcode', async (req, res) => {
    try {
        const qrImageURL = await QRCode.toDataURL(controllerURL);
        res.json({ qrImageURL, controllerURL });
    } catch (err) {
        res.status(500).send('Error generating QR code');
    }
});

// Handle real-time socket connections from phones and PC
io.on('connection', (socket) => {
    console.log(`A device connected: ${socket.id}`);

    // Register browser tab as the Host screen
    socket.on('register-host', () => {
        hostSocketId = socket.id;
        console.log(`Host screen registered: ${socket.id}`);
        socket.emit('update-players', players);
        socket.emit('phase-changed', { phase: currentPhase, players });
    });

    // Register or reconnect phone controller using a persistent ID
    socket.on('register-player', ({ persistentId }) => {
        let player = players.find(p => p.persistentId === persistentId);

        if (player) {
            player.id = socket.id;
            player.connected = true;
            console.log(`Player reconnected: ${persistentId} (Socket: ${socket.id})`);
        } else {
            player = {
                id: socket.id,
                persistentId: persistentId || socket.id,
                role: null,
                alive: true,
                connected: true
            };
            players.push(player);
            console.log(`New player registered: ${socket.id} (Total players: ${players.length})`);
        }

        io.emit('update-players', players);

        if (player.role) {
            socket.emit('assigned-role', { role: player.role });
        }
    });
    
    // Handle host starting the game with selected roles
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
        if (currentPhase === 'night') {
            // Transitioning from Night to Day -> Process priority actions (Kills, Saves, Seer)
            resolveNightActions(io, players);
            currentPhase = 'day';
        } else {
            // Transitioning from Day to Night
            currentPhase = 'night';
        }

        console.log(`Phase changed to: ${currentPhase}`);
        io.emit('phase-changed', { phase: currentPhase, players });
    });

    // Host manually kicks a player out
    socket.on('kick-player', (persistentId) => {
        console.log(`Host kicked player with ID: ${persistentId}`);
        const playerToKick = players.find(p => p.persistentId === persistentId);
        if (playerToKick) {
            io.to(playerToKick.id).emit('kicked');
        }
        players = players.filter(p => p.persistentId !== persistentId);
        io.emit('update-players', players);
    });

    // Delegate player actions to our modular role actions registry
    socket.on('player-action', (data) => {
        handlePlayerAction(socket, data, io, players);
    });

    // Handle disconnections (mark offline instead of deleting)
    socket.on('disconnect', () => {
        console.log(`Device disconnected: ${socket.id}`);
        
        if (socket.id === hostSocketId) {
            console.log('Host screen disconnected.');
            hostSocketId = null;
            return;
        }

        const player = players.find(p => p.id === socket.id);
        if (player) {
            player.connected = false;
            console.log(`Player went offline: ${player.persistentId}`);
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