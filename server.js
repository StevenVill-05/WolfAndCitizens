const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const os = require('os');
const QRCode = require('qrcode');

// Import modular role action handlers & night resolution functions
const { 
    handlePlayerAction, 
    resolveNightActions, 
    areAllNightActionsSubmitted, 
    broadcastActionStatus,
    recordDayVote,
    resolveDayVote
} = require('./roleActions');


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

    // Record day trial vote
    socket.on('submit-day-vote', ({ targetId }) => {
        const voter = players.find(p => p.id === socket.id);
        if (voter && voter.alive) {
            recordDayVote(voter.persistentId, targetId);
            
            const targetPlayer = players.find(p => p.persistentId === targetId);
            const targetName = targetId === 'abstain' ? 'Abstain' : (targetPlayer ? targetPlayer.username : 'Unknown');
            
            console.log(`Day Vote: ${voter.username} voted for ${targetName}`);
            socket.emit('day-vote-confirmed', { targetName });
        }
    });
     
    console.log(`A device connected: ${socket.id}`);

    // Register browser tab as the Host screen
    socket.on('register-host', () => {
        hostSocketId = socket.id;
        console.log(`Host screen registered: ${socket.id}`);
        socket.emit('update-players', players);
        socket.emit('phase-changed', { phase: currentPhase, players });
        
        // If reconnecting during night, broadcast action tracking status immediately
        if (currentPhase === 'night') {
            broadcastActionStatus(io, players);
        }
    });
// Register or reconnect phone controller using a persistent ID & Unique Username
    socket.on('register-player', ({ persistentId, username }, callback) => {
        let player = players.find(p => p.persistentId === persistentId);

        if (player) {
            player.id = socket.id;
            player.connected = true;
            if (username && username.trim() !== '') {
                player.username = username.trim();
            }
            console.log(`Player reconnected: ${player.username} (${persistentId})`);
            
            if (callback) callback({ success: true, username: player.username });
        } else {
            const trimmedName = (username || '').trim();
            if (!trimmedName) {
                if (callback) callback({ success: false, error: 'Username cannot be empty.' });
                return;
            }

            const nameExists = players.some(
                p => p.username && p.username.toLowerCase() === trimmedName.toLowerCase()
            );

            if (nameExists) {
                if (callback) callback({ success: false, error: 'Username is already taken by another player!' });
                return;
            }

            player = {
                id: socket.id,
                persistentId: persistentId || socket.id,
                username: trimmedName,
                role: null,
                alive: true,
                connected: true,
                history: []
            };
            players.push(player);
            console.log(`New player joined: ${player.username} (Total: ${players.length})`);

            if (callback) callback({ success: true, username: player.username });
        }

        io.emit('update-players', players);

        if (player.role) {
            socket.emit('assigned-role', { role: player.role });
            // CRITICAL FIX: Send the current phase so reloaded controllers match the game state immediately
            socket.emit('phase-changed', { phase: currentPhase, players });
        }

        if (!player.alive) {
            socket.emit('player-eliminated');
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
            if (!areAllNightActionsSubmitted(players)) {
                socket.emit('phase-toggle-rejected', {
                    reason: 'Cannot switch to Day phase until all required night actions are submitted!'
                });
                return;
            }

            resolveNightActions(io, players);
            currentPhase = 'day';
        } else {
            // Transitioning from Day -> Night: Resolve Day Voting First
            resolveDayVote(io, players);
            currentPhase = 'night';
            setTimeout(() => broadcastActionStatus(io, players), 100);
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

    // Wolf Chat using Username
    socket.on('wolf-chat-message', (message) => {
        const sender = players.find(p => p.id === socket.id);
        if (sender && sender.alive && (sender.role === 'Wolf' || sender.role === 'GrandWolf')) {
            players.forEach(p => {
                if (p.alive && (p.role === 'Wolf' || p.role === 'GrandWolf') && p.id) {
                    io.to(p.id).emit('incoming-wolf-message', {
                        sender: `${sender.username} (${sender.role})`,
                        message: message
                    });
                }
            });
        }
    });

    // Wolf Vote Notification using Username
    socket.on('wolf-vote-cast', ({ targetId }) => {
        const voter = players.find(p => p.id === socket.id);
        const target = players.find(p => p.persistentId === targetId);
        if (voter && target && voter.alive && (voter.role === 'Wolf' || voter.role === 'GrandWolf')) {
            players.forEach(p => {
                if (p.alive && (p.role === 'Wolf' || p.role === 'GrandWolf') && p.id) {
                    io.to(p.id).emit('wolf-vote-updated', {
                        voterName: voter.username,
                        targetName: target.username
                    });
                }
            });
        }
    });

    // Ghost Chat using Username
    socket.on('ghost-chat-message', (message) => {
        const sender = players.find(p => p.id === socket.id);
        if (sender && !sender.alive) {
            players.forEach(p => {
                if (!p.alive && p.id) {
                    io.to(p.id).emit('incoming-ghost-message', {
                        name: sender.username || 'Spirit',
                        message: message
                    });
                }
            });
        }
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