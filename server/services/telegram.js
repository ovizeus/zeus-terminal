// Zeus Terminal — Telegram Alert Service
// Per-user + global alerts via Bot API
// Zero dependencies — uses Node.js built-in https
'use strict';

const https = require('https');
const config = require('../config');

/**
 * Send a message to a specific Telegram chat using explicit credentials.
 * @param {string} token — Bot token
 * @param {string} chatId — Chat ID
 * @param {string} text — Message text (supports Markdown)
 * @param {string} [parseMode='Markdown']
 * @returns {Promise<boolean>}
 */
function _sendDirect(token, chatId, text, parseMode) {
    if (!token || !chatId) return Promise.resolve(false);

    const body = {
        chat_id: chatId,
        text: text,
        disable_web_page_preview: true,
    };
    if (parseMode) body.parse_mode = parseMode;

    return new Promise((resolve) => {
        const payload = JSON.stringify(body);
        const options = {
            hostname: 'api.telegram.org',
            port: 443,
            path: '/bot' + token + '/sendMessage',
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
            timeout: 5000,
        };
        const req = https.request(options, (res) => {
            let body = '';
            res.on('data', (chunk) => { body += chunk; });
            res.on('end', () => {
                if (res.statusCode !== 200) {
                    console.warn('[TELEGRAM] Send failed:', res.statusCode, body.slice(0, 200));
                    resolve(false);
                } else {
                    resolve(true);
                }
            });
        });
        req.on('error', (err) => {
            console.warn('[TELEGRAM] Request error:', err.message);
            resolve(false);
        });
        req.on('timeout', () => {
            req.destroy();
            console.warn('[TELEGRAM] Request timed out');
            resolve(false);
        });
        req.write(payload);
        req.end();
    });
}

// Send with 1 retry; if Markdown parse fails, retry as plain text
async function _sendWithRetry(token, chatId, text, parseMode) {
    const pm = parseMode || 'Markdown';
    const ok = await _sendDirect(token, chatId, text, pm);
    if (ok) return true;
    // Fallback: retry as plain text (handles Markdown parse errors)
    await new Promise(r => setTimeout(r, 2000));
    return _sendDirect(token, chatId, text, null);
}

// ── Send to global config (backward compat / fallback) ──
function send(text, parseMode) {
    const token = config.telegram && config.telegram.botToken;
    const chatId = config.telegram && config.telegram.chatId;
    return _sendWithRetry(token, chatId, text, parseMode);
}

// ── Send to a specific user (from DB, encrypted) ──
// [P3 FIX] No fallback to global — per-user alerts stay per-user.
// If user has no Telegram configured, the alert is silently skipped.
function sendToUser(userId, text, parseMode) {
    try {
        const db = require('./database');
        const { decrypt } = require('./encryption');
        const row = db.getUserTelegram(userId);
        if (!row || !row.telegram_bot_token_enc || !row.telegram_chat_id) {
            return Promise.resolve(false); // user has no Telegram — skip silently
        }
        // [ZT-AUD-#16] Skip rows already flagged broken (re-encrypt needed).
        if (row.telegram_broken_at) return Promise.resolve(false);
        let token;
        try {
            token = decrypt(row.telegram_bot_token_enc);
        } catch (e) {
            console.warn('[TELEGRAM] decrypt failed for user ' + userId + ' — marking broken:', e.message);
            try { db.markTelegramBroken(userId, e.message); } catch (_) { /* */ }
            return Promise.resolve(false);
        }
        return _sendWithRetry(token, row.telegram_chat_id, text, parseMode);
    } catch (e) {
        console.warn('[TELEGRAM] sendToUser failed:', e.message);
        return Promise.resolve(false); // don't leak to global on error
    }
}

// ── Send to ALL users with telegram configured + global ──
function sendToAll(text, parseMode) {
    try {
        const db = require('./database');
        const { decrypt } = require('./encryption');
        const users = db.getAllTelegramUsers();
        const promises = [];
        const sentChatIds = new Set();

        for (const u of users) {
            try {
                const token = decrypt(u.telegram_bot_token_enc);
                if (!sentChatIds.has(u.telegram_chat_id)) {
                    sentChatIds.add(u.telegram_chat_id);
                    promises.push(_sendWithRetry(token, u.telegram_chat_id, text, parseMode));
                }
            } catch (_) { }
        }

        // Also send to global config if not already covered
        const gToken = config.telegram && config.telegram.botToken;
        const gChatId = config.telegram && config.telegram.chatId;
        if (gToken && gChatId && !sentChatIds.has(gChatId)) {
            promises.push(_sendWithRetry(gToken, gChatId, text, parseMode));
        }

        if (promises.length === 0) return Promise.resolve(false);
        return Promise.all(promises).then(results => results.some(Boolean));
    } catch (e) {
        console.warn('[TELEGRAM] sendToAll failed:', e.message);
        return send(text, parseMode);
    }
}

// ── Pre-built alert helpers (userId is optional — omit for broadcast) ──

// [P3 FIX] Per-user alerts require userId — no fallback to global
function _userSend(userId, text, parseMode) {
    if (!userId) {
        console.warn('[TELEGRAM] _userSend called without userId — alert dropped');
        return Promise.resolve(false);
    }
    return sendToUser(userId, text, parseMode);
}

function alertOrderFilled(symbol, side, qty, price, orderId, userId) {
    return _userSend(userId,
        '✅ *ORDER FILLED*\n' +
        '`' + symbol + '` ' + side + '\n' +
        'Qty: `' + qty + '` @ $`' + price + '`\n' +
        'OrderID: `' + orderId + '`'
    );
}

function alertOrderFailed(symbol, side, reason, userId) {
    return _userSend(userId,
        '❌ *ORDER FAILED*\n' +
        '`' + symbol + '` ' + side + '\n' +
        'Reason: ' + reason
    );
}

function alertRiskBlock(reason, owner, userId) {
    return _userSend(userId,
        '🚫 *RISK BLOCKED* (' + (owner || 'AT') + ')\n' +
        reason
    );
}

function alertKillSwitch(active, userId) {
    return _userSend(userId,
        active
            ? '🛑 *EMERGENCY KILL SWITCH ACTIVATED*\nAll trading is now BLOCKED.'
            : '🟢 *KILL SWITCH DEACTIVATED*\nTrading resumed.'
    );
}

function alertDailyLoss(owner, realized, limit, userId) {
    return _userSend(userId,
        '⚠️ *DAILY LOSS LIMIT* (' + owner + ')\n' +
        'Realized: $`' + Math.abs(realized).toFixed(2) + '` / $`' + limit.toFixed(2) + '`\n' +
        'New orders BLOCKED until tomorrow.'
    );
}

function alertServerStart() {
    return sendToAll(
        '⚡ *Zeus Terminal Started*\n' +
        'Trading: ' + (config.tradingEnabled ? '✅ ENABLED' : '🔒 DISABLED') + '\n' +
        'Time: ' + new Date().toISOString()
    );
}

function alertServerStop(reason) {
    return sendToAll(
        '🔴 *Zeus Terminal Stopped*\n' +
        'Reason: ' + (reason || 'shutdown') + '\n' +
        'Time: ' + new Date().toISOString()
    );
}

// [AUDIT] Returns array of all user IDs that have Telegram configured
function getAllUserIds() {
    try {
        const db = require('./database');
        const users = db.getAllTelegramUsers();
        const ids = [];
        const seen = new Set();
        for (const u of users) {
            const uid = u.user_id || u.id;
            if (uid && !seen.has(uid)) { seen.add(uid); ids.push(uid); }
        }
        return ids;
    } catch (_) {
        return [];
    }
}

module.exports = {
    send,
    sendToUser,
    sendToAll,
    getAllUserIds,
    alertOrderFilled,
    alertOrderFailed,
    alertRiskBlock,
    alertKillSwitch,
    alertDailyLoss,
    alertServerStart,
    alertServerStop,
};
