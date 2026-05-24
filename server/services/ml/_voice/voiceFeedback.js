'use strict';
const { db } = require('../../database');
const DAILY_LIMIT = 50;
const _stmts = {
    upsert: db.prepare(`INSERT INTO ml_voice_feedback (voice_log_id, user_id, feedback, created_at)
        VALUES (?, ?, ?, ?) ON CONFLICT(voice_log_id) DO UPDATE SET feedback = excluded.feedback, created_at = excluded.created_at`),
    countToday: db.prepare('SELECT COUNT(*) as cnt FROM ml_voice_feedback WHERE user_id = ? AND created_at > ?'),
    statsUp: db.prepare("SELECT COUNT(*) as cnt FROM ml_voice_feedback WHERE user_id = ? AND feedback = 'up' AND created_at > ?"),
    statsDown: db.prepare("SELECT COUNT(*) as cnt FROM ml_voice_feedback WHERE user_id = ? AND feedback = 'down' AND created_at > ?"),
};
function submitFeedback(params) {
    const { voiceLogId, userId, feedback } = params || {};
    if (!voiceLogId || !userId || !['up','down'].includes(feedback)) return { ok: false, reason: 'invalid params' };
    const dayStart = Date.now() - 86400000;
    const count = _stmts.countToday.get(userId, dayStart);
    if (count && count.cnt >= DAILY_LIMIT) return { ok: false, reason: 'daily limit reached (50/day)' };
    _stmts.upsert.run(voiceLogId, userId, feedback, Date.now());
    return { ok: true };
}
function getFeedbackStats(params) {
    const userId = params && params.userId;
    const since = (params && params.since) || 0;
    const up = _stmts.statsUp.get(userId, since);
    const down = _stmts.statsDown.get(userId, since);
    return { up: up ? up.cnt : 0, down: down ? down.cnt : 0, total: (up ? up.cnt : 0) + (down ? down.cnt : 0) };
}
module.exports = { submitFeedback, getFeedbackStats, DAILY_LIMIT };
