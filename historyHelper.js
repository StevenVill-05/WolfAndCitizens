// historyHelper.js

// Centralized history store: 
// Structure: { [day]: { [persistentId]: { nightTarget: '...', dayVote: '...' } } }
let historyData = {};

// Ensure an entry exists for the given day and player
function ensureHistoryEntry(day, persistentId) {
    if (!historyData[day]) {
        historyData[day] = {};
    }
    if (!historyData[day][persistentId]) {
        historyData[day][persistentId] = { nightTarget: null, dayVote: null };
    }
}

// Record a night action target for a player on a specific day
function recordNightAction(day, persistentId, targetId) {
    ensureHistoryEntry(day, persistentId);
    historyData[day][persistentId].nightTarget = targetId;
}

// Record a day vote for a player on a specific day
function recordDayVoteAction(day, persistentId, targetId) {
    ensureHistoryEntry(day, persistentId);
    historyData[day][persistentId].dayVote = targetId;
}

// Extract a specific player's actions for a given day
function getPlayerDataForDay(day, persistentId) {
    if (historyData[day] && historyData[day][persistentId]) {
        return historyData[day][persistentId];
    }
    return { nightTarget: null, dayVote: null };
}

// Reset history (useful when restarting a game)
function resetHistory() {
    historyData = {};
}
function getAllHistory() {
    return historyData;
}


module.exports = {
    recordNightAction,
    recordDayVoteAction,
    getPlayerDataForDay,
    getAllHistory,
    resetHistory
};

/*
const { getPlayerDataForDay } = require('./historyHelper');

// Example: Get player_abc123's actions on Day 1
const dayOneActions = getPlayerDataForDay(1, 'player_abc123');
console.log(dayOneActions); 
// Output: { nightTarget: 'player_xyz789', dayVote: 'player_def456' }

*/