'use strict';

/**
 * OMEGA Cross-cutting — Voice Logger
 *
 * Facade over `ml_voice_log` for every Ω utterance:
 * - `logUtterance(...)` — record one thought/chat-reply/greeting/etc with mood
 * - `getRecent({userId, limit})` — recent utterances for replay/history feature
 *
 * Wave 1D scope: persistence + retrieval interface only. The personality
 * engine (template matching, mood resolution, TTS dispatch) lives in
 * Wave 8 polish — this layer is the durable record everything writes to.
 *
 * UTTERANCE_TYPES + MOODS exported for caller validation. CHECK constraints
 * in DB enforce them at write time as defense-in-depth.
 */

const { db } = require('../../database');

const UTTERANCE_TYPES = Object.freeze([
    'THOUGHT', 'CHAT_REPLY', 'GREETING', 'FAREWELL', 'CRITICAL_ALERT', 'REACTION'
]);

const MOODS = Object.freeze([
    'CALM', 'FOCUSED', 'EXCITED', 'NERVOUS', 'ANGRY', 'SAD', 'BORED'
]);

const _stmts = {
    insert: db.prepare(`
        INSERT INTO ml_voice_log
        (user_id, utterance_type, mood, text, template_id, context_json,
         decision_digest, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `),
    getRecent: db.prepare(`
        SELECT * FROM ml_voice_log
        WHERE user_id = ?
        ORDER BY created_at DESC
        LIMIT ?
    `),
    // [Day 29] Voice feed should show only OMEGA "thinking" — NOT chat replies.
    // Chat conversations live in TalkWithMe; voice shows real ML cognition.
    getRecentThoughts: db.prepare(`
        SELECT * FROM ml_voice_log
        WHERE user_id = ? AND utterance_type != 'CHAT_REPLY'
        ORDER BY created_at DESC
        LIMIT ?
    `)
};

function _required(params, key) {
    if (!params || params[key] === undefined || params[key] === null) {
        throw new Error(`voiceLogger: missing required field "${key}"`);
    }
    return params[key];
}

function logUtterance(params) {
    const userId = _required(params, 'userId');
    const utteranceType = _required(params, 'utteranceType');
    const mood = _required(params, 'mood');
    const text = _required(params, 'text');
    const templateId = params.templateId || null;
    const contextJson = params.contextJson || null;
    const decisionDigest = params.decisionDigest || null;
    const result = _stmts.insert.run(
        userId, utteranceType, mood, text, templateId, contextJson,
        decisionDigest, Date.now()
    );
    return { id: result.lastInsertRowid };
}

function getRecent(params) {
    const userId = _required(params, 'userId');
    const limit = Math.max(1, Math.min(1000, params.limit || 100));
    return _stmts.getRecent.all(userId, limit);
}

function getRecentThoughts(params) {
    const userId = _required(params, 'userId');
    const limit = Math.max(1, Math.min(1000, params.limit || 100));
    return _stmts.getRecentThoughts.all(userId, limit);
}

module.exports = {
    logUtterance,
    getRecent,
    getRecentThoughts,
    UTTERANCE_TYPES,
    MOODS
};
