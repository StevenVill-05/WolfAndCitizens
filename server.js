const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const os = require('os');
const QRCode = require('qrcode');

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
            // Skip over non-IPv4 and internal (i.e. 127.0.0.1) addresses
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
        // Immediately send the current players list to the newly connected host
        socket.emit('update-players', players);
    });

    // Register phone as a Player controller
    socket.on('register-player', () => {
        if (!players.find(p => p.id === socket.id)) {
            players.push({ id: socket.id });
            console.log(`Player registered: ${socket.id} (Total players: ${players.length})`);
        }
        // Broadcast the updated player list to EVERYONE (including host)
        io.emit('update-players', players);
    });
    
    // Handle host starting the game
    socket.on('start-game', () => {
        console.log('Host started the game!');
        io.emit('game-started');
    });

    // Listen for button presses or actions from the phone controller
    socket.on('player-action', (data) => {
        data.playerId = socket.id;
        console.log('Received action from controller:', data);
        // Broadcast this action to the PC game screen
        io.emit('game-update', data);
    });

    // Handle disconnections
    socket.on('disconnect', () => {
        console.log(`Device disconnected: ${socket.id}`);
        
        if (socket.id === hostSocketId) {
            console.log('Host screen disconnected.');
            hostSocketId = null;
        }

        // Remove from players array if it was a player
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