const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const os = require('os');
const path = require('path');
const QRCode = require('qrcode');

const { getAllHistory, resetHistory } = require('./historyHelper');

// Import modular role action handlers & resolution functions
const { 
    handlePlayerAction, 
    resolveNightActions, 
    areAllNightActionsSubmitted, 
    broadcastActionStatus,
    recordDayVote,
    resolveDayVote,
    checkGameOver,
    resetRoleActionState
} = require('./roleActions');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Serve static files from root directory or 'public' subfolder
app.use(express.static(__dirname));
app.use(express.static(path.join(__dirname, 'public')));

// Helper function to find computer's local IP address on LAN/Wi-Fi
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

// Global State Tracking
let players = [];
let hostSocketId = null;
let currentPhase = 'day'; 
let currentDay = 1;
let activeRolePool = ['Wolf', 'Citizen', 'Seer', 'Doctor'];

// Route to generate a QR code data URL for host lobby display
app.get('/api/qrcode', async (req, res) => {
    try {
        const qrImageURL = await QRCode.toDataURL(controllerURL);
        res.json({ qrImageURL, controllerURL });
    } catch (err) {
        res.status(500).json({ error: 'Error generating QR code' });
    }
});

/**
 * Distribute randomized roles and commence new or restarted session
 */
function assignRolesAndStart() {
    currentDay = 1;
    currentPhase = 'day';
    
    // Clear history and action queues
    resetHistory();
    resetRoleActionState();

    // 1. Construct role pool matching active player count
    let shuffledRoles = [...activeRolePool];

    // Pad with Citizens if player count exceeds role pool length
    while (shuffledRoles.length < players.length) {
        shuffledRoles.push('Citizen');
    }

    // Trim role pool if fewer players joined than selected bubbles
    if (shuffledRoles.length > players.length) {
        shuffledRoles = shuffledRoles.slice(0, players.length);
    }

    // 2. Fisher-Yates shuffle algorithm
    for (let i = shuffledRoles.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffledRoles[i], shuffledRoles[j]] = [shuffledRoles[j], shuffledRoles[i]];
    }

    // 3. Assign roles to connected players
    players.forEach((player, index) => {
        const assignedRole = shuffledRoles[index];
        player.role = assignedRole;
        player.alive = true;
        player.history = [];
        
        if (player.id) {
            io.to(player.id).emit('assigned-role', { role: assignedRole });
        }
    });

    console.log('Roles assigned for new round:', players.map(p => `${p.username}: ${p.role}`));

    io.emit('game-restarted', { phase: currentPhase, players, currentDay });
    io.emit('phase-changed', { phase: currentPhase, players, currentDay });
}

// Handle real-time socket connections
io.on('connection', (socket) => {
    console.log(`Device connected: ${socket.id}`);

    // Register tab as Host screen
    socket.on('register-host', () => {
        hostSocketId = socket.id;
        console.log(`Host screen registered: ${socket.id}`);
        socket.emit('update-players', players);
        socket.emit('phase-changed', { phase: currentPhase, players, currentDay });
        
        if (currentPhase === 'night') {
            broadcastActionStatus(io, players);
        }
    });

    // Register or reconnect player controller
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
                if (callback) callback({ success: false, error: 'Username is already taken!' });
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
            socket.emit('phase-changed', { phase: currentPhase, players, currentDay });
        }

        if (!player.alive) {
            socket.emit('player-eliminated');
        }
    });

    // Host initiates game start
    socket.on('start-game', (selectedRoles) => {
        console.log('Host started game with roles:', selectedRoles);
        activeRolePool = selectedRoles && selectedRoles.length > 0 ? selectedRoles : activeRolePool;
        assignRolesAndStart();
    });

    // Host restarts game session
    socket.on('restart-game', () => {
        console.log('Host triggered game restart.');
        assignRolesAndStart();
    });

    // Host requests action history modal data
    socket.on('request-history-data', () => {
        socket.emit('update-history-data', {
            historyData: getAllHistory(),
            players: players
        });
    });

    // Handle Day banishing vote submission
    socket.on('submit-day-vote', ({ targetId }) => {
        const voter = players.find(p => p.id === socket.id);
        if (voter && voter.alive) {
            recordDayVote(voter.persistentId, targetId, currentDay);
            
            const targetPlayer = players.find(p => p.persistentId === targetId);
            const targetName = targetId === 'abstain' ? 'Abstain' : (targetPlayer ? targetPlayer.username : 'Unknown');
            
            console.log(`Day Vote: ${voter.username} voted for [${targetName}]`);
            socket.emit('day-vote-confirmed', { targetName });
        }
    });

    // Delegate night actions to role registry
    socket.on('player-action', (data) => {
        handlePlayerAction(socket, data, io, players, currentDay);
    });
// Toggle Phase between Day and Night
    socket.on('toggle-phase', () => {
        if (currentPhase === 'night') {
            // Resolve queued actions even if some players did not submit in time
            resolveNightActions(io, players, currentDay);

            if (checkGameOver(io, players)) return;

            currentPhase = 'day';
            currentDay++;
        } else {
            resolveDayVote(io, players, currentDay);

            if (checkGameOver(io, players)) return;

            currentPhase = 'night';
            setTimeout(() => broadcastActionStatus(io, players), 100);
        }

        console.log(`Phase transitioned to: ${currentPhase.toUpperCase()} (Day ${currentDay})`);
        io.emit('phase-changed', { phase: currentPhase, players, currentDay });

        io.emit('update-history-data', {
            historyData: getAllHistory(),
            players: players
        });
    });

    // Host banishes/kicks a player
    socket.on('kick-player', (persistentId) => {
        console.log(`Host kicked player: ${persistentId}`);
        const playerToKick = players.find(p => p.persistentId === persistentId);
        if (playerToKick && playerToKick.id) {
            io.to(playerToKick.id).emit('kicked');
        }
        players = players.filter(p => p.persistentId !== persistentId);
        io.emit('update-players', players);
    });

    // Wolf Den Chat
    socket.on('wolf-chat-message', (message) => {
        const sender = players.find(p => p.id === socket.id);
        if (sender && sender.alive && (sender.role === 'Wolf' || sender.role === 'GrandWolf')) {
            const safeMsg = (message || '').trim();
            if (!safeMsg) return;

            players.forEach(p => {
                if (p.alive && (p.role === 'Wolf' || p.role === 'GrandWolf') && p.id) {
                    io.to(p.id).emit('incoming-wolf-message', {
                        sender: `${sender.username} (${sender.role})`,
                        message: safeMsg
                    });
                }
            });
        }
    });

    // Wolf Target Lock Notification
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

    // Spirit Realm / Ghost Chat
    socket.on('ghost-chat-message', (message) => {
        const sender = players.find(p => p.id === socket.id);
        if (sender && !sender.alive) {
            const safeMsg = (message || '').trim();
            if (!safeMsg) return;

            players.forEach(p => {
                if (!p.alive && p.id) {
                    io.to(p.id).emit('incoming-ghost-message', {
                        name: sender.username || 'Spirit',
                        message: safeMsg
                    });
                }
            });
        }
    });

    // Handle Disconnections
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
            console.log(`Player marked offline: ${player.persistentId}`);
            io.emit('update-players', players);
        }
    });
});

server.listen(PORT, () => {
    console.log(`\n========================================`);
    console.log(` Medieval Council Server Active!`);
    console.log(` PC Host Lobby:  http://localhost:${PORT}`);
    console.log(` Mobile Access:  ${controllerURL}`);
    console.log(`========================================\n`);
});