'use strict';
const DEDUP_WINDOW_MS = 300000;
const _lastPush = new Map();
function pushCritical(params) {
    const { userId, eventType, severity, message } = params || {};
    if (!eventType || !message) return { sent: false, reason: 'missing params', deduplicated: false };
    const key = `${eventType}:${severity || 'P0'}`;
    const now = Date.now();
    const last = _lastPush.get(key) || 0;
    if (now - last < DEDUP_WINDOW_MS) return { sent: false, deduplicated: true };
    _lastPush.set(key, now);
    try {
        const telegram = require('../../telegram');
        if (userId) telegram.sendToUser(userId, `🚨 OMEGA: ${eventType}\n${message}`);
    } catch (_) {}
    return { sent: true, deduplicated: false };
}
function _resetForTest() { _lastPush.clear(); }
module.exports = { pushCritical, _resetForTest, DEDUP_WINDOW_MS };
