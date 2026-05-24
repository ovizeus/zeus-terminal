'use strict';

const FREQ_CAP_MS = 300000;
const SCALP_THRESHOLD = 5;
const SCALP_WINDOW_MS = 900000;
const _lastReaction = new Map();
const _tradeHistory = new Map();

const PHRASES = {
    CALM: {
        entry: ['{side} on {symbol}. noted.', 'manual {side} {symbol}. watching.', '{symbol} {side} — let\'s see.'],
        win: ['{symbol} closed green. clean.', 'nice {side} on {symbol}.', '{symbol} profit locked.'],
        loss: ['{symbol} closed red. it happens.', '{side} {symbol} didn\'t work. next.', 'loss on {symbol}. move on.'],
    },
    ALERT: {
        entry: ['going manual on {symbol}? interesting.', '{side} {symbol} — bold timing.', 'manual {side} {symbol}... market\'s hot.'],
        win: ['nice manual {side} on {symbol}!', '{symbol} win. market agreed.', '{side} {symbol} — clean execution.'],
        loss: ['{symbol} didn\'t work. rough one.', '{side} {symbol} loss. review this.', 'ouch. {symbol} went the wrong way.'],
    },
    CAUTIOUS: {
        entry: ['manual {side} on {symbol}... careful.', '{side} {symbol}? risky move right now.', 'careful with {symbol}. signals mixed.'],
        win: ['{symbol} win. don\'t push luck.', 'profit on {symbol}. take it and walk.', '{side} {symbol} worked. surprising.'],
        loss: ['{symbol} loss. saw it coming.', 'told you {symbol} looked sketchy.', '{side} {symbol} — review before next.'],
    },
};

function _pickPhrase(mood, action, symbol, side) {
    const moodKey = PHRASES[mood] ? mood : 'CALM';
    const actionKey = PHRASES[moodKey][action] ? action : 'entry';
    const pool = PHRASES[moodKey][actionKey];
    return pool[Math.floor(Math.random() * pool.length)]
        .replace(/\{symbol\}/g, symbol).replace(/\{side\}/g, side);
}

function _recordTrade(symbol) {
    const now = Date.now();
    if (!_tradeHistory.has(symbol)) _tradeHistory.set(symbol, []);
    const hist = _tradeHistory.get(symbol);
    hist.push(now);
    while (hist.length > 0 && hist[0] < now - SCALP_WINDOW_MS) hist.shift();
}

function _isScalping(symbol) {
    const hist = _tradeHistory.get(symbol);
    return hist && hist.length >= SCALP_THRESHOLD;
}

function reactToTrade(params) {
    const { userId, symbol, side, action, mood } = params || {};
    if (!userId || !symbol || !side || !action) return { reacted: false, reason: 'missing params' };
    _recordTrade(symbol);
    if (_isScalping(symbol)) return { reacted: false, reason: 'scalping detected — silent' };
    const now = Date.now();
    const lastTs = _lastReaction.get(symbol) || 0;
    if (now - lastTs < FREQ_CAP_MS) return { reacted: false, reason: 'frequency cap (5min per symbol)' };
    const text = _pickPhrase(mood || 'CALM', action, symbol, side);
    _lastReaction.set(symbol, now);
    try {
        const voiceLogger = require('./voiceLogger');
        // Map internal moods to voiceLogger-valid moods (DB CHECK constraint)
        const _moodMap = { CALM: 'CALM', ALERT: 'FOCUSED', CAUTIOUS: 'NERVOUS' };
        const dbMood = _moodMap[mood] || 'CALM';
        voiceLogger.logUtterance({
            userId, utteranceType: 'CHAT_REPLY', mood: dbMood, text,
            templateId: 'omega_reaction',
            contextJson: JSON.stringify({ symbol, side, action, pnl: params.pnl || null }),
        });
    } catch (_) {}
    return { reacted: true, text };
}

function _resetForTest() { _lastReaction.clear(); _tradeHistory.clear(); }

module.exports = { reactToTrade, _resetForTest, _recordTrade, FREQ_CAP_MS, SCALP_THRESHOLD };
