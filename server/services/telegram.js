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

// [CFG-8] Telegram global rate limit = 30 msg/sec per bot. Multiple users
// firing alerts at the same tick (anomaly detector + restart count + risk
// block + kill switch + daily loss + PnL phase change) could collide. No
// queue/batch previously → silent rate-limit drops at API edge. Token-bucket
// pattern: serialize sends through FIFO queue cu MIN_INTERVAL_MS spacing.
// 35ms = ~28 msgs/sec, safely under 30/sec ceiling. Queue is in-memory
// (acceptable: alert burst is bounded, restart resets bucket).
const _sendQueue = [];
let _queueWorking = false;
const _MIN_SEND_INTERVAL_MS = 35;
function _enqueueSend(token, chatId, text, parseMode) {
    return new Promise(resolve => {
        _sendQueue.push({ token, chatId, text, parseMode, resolve });
        _processSendQueue();
    });
}
async function _processSendQueue() {
    if (_queueWorking) return;
    _queueWorking = true;
    try {
        while (_sendQueue.length > 0) {
            const item = _sendQueue.shift();
            try {
                const result = await _sendDirect(item.token, item.chatId, item.text, item.parseMode);
                item.resolve(result);
            } catch (e) {
                item.resolve(false);
            }
            if (_sendQueue.length > 0) {
                await new Promise(r => setTimeout(r, _MIN_SEND_INTERVAL_MS));
            }
        }
    } finally {
        _queueWorking = false;
    }
}

// Send with 1 retry; if Markdown parse fails, retry as plain text.
// [CFG-8] All sends go through _enqueueSend (rate-limit serialized).
async function _sendWithRetry(token, chatId, text, parseMode) {
    const pm = parseMode || 'Markdown';
    // [2026-10-14] Repair unbalanced delimiters before the FIRST attempt. An odd
    // _ * or ` from an interpolated machine string (LIVE_NO_SL, SMART_CUT, any
    // err.message) opens an entity Telegram cannot close, so it 400s the whole
    // message and we pay the 2s plain-text retry below. ~500 sends hit that over
    // three days. Balanced formatting is untouched, so intentional *bold* and
    // `code` still render.
    const body = (pm === 'Markdown') ? _balanceMarkdown(text) : text;
    const ok = await _enqueueSend(token, chatId, body, pm);
    if (ok) return true;
    // Fallback: retry as plain text (handles Markdown parse errors)
    await new Promise(r => setTimeout(r, 2000));
    // Fallback sends the ORIGINAL text: with no parse_mode there are no
    // entities, so the escapes would show up as literal backslashes.
    return _enqueueSend(token, chatId, text, null);
}

// ── Send to global config (backward compat / fallback) ──
// [OPS-9] On Telegram failure, fall back to email to admin users via shared
// mailer service. Best-effort — fallback runs in background, never blocks
// the original return. Bug spec: "Telegram-only single-channel alerts —
// silent failures if Telegram broken". Email fallback closes that gap for
// global-broadcast critical alerts.
async function send(text, parseMode) {
    const token = config.telegram && config.telegram.botToken;
    const chatId = config.telegram && config.telegram.chatId;
    const ok = await _sendWithRetry(token, chatId, text, parseMode);
    if (!ok) {
        // Background email fallback — non-blocking
        try {
            const mailer = require('./mailer');
            const subj = (text || '').split('\n')[0].slice(0, 80) || 'critical alert';
            mailer.sendCriticalEmail(subj, text).catch(() => { });
        } catch (_) { /* mailer optional */ }
    }
    return ok;
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

// [P3] Escape legacy-Markdown specials (_ * ` [) so dynamic identifiers like
// SERVER_BOOT don't break parse_mode='Markdown' (the send() default → a
// "can't parse entities" first attempt + 2s plain-text retry). Apply to plain
// informational alerts only — never to messages that intentionally use Markdown.
function escapeMarkdown(text) {
    if (text == null) return '';
    return String(text).replace(/([_*`\[])/g, '\\$1');
}

// [2026-10-14] Repair unbalanced legacy-Markdown delimiters before sending.
//
// parse_mode='Markdown' treats _ * and ` as entity delimiters. Alert templates
// interpolate machine strings that are full of them — DEAD_MAN_SWITCH,
// LIVE_NO_SL, exit types like SMART_CUT, anything inside err.message. An ODD
// count opens an entity that never closes and Telegram rejects the whole
// message with "can't parse entities ... byte offset N". That cost ~500 failed
// sends over 2026-10-12..14 (209 / 86 / 212 a day).
//
// The same bug was found and fixed once before, at serverAT.js:380 on
// 2026-10-07 ("149x in a single day"), by escaping at that ONE call site.
// Twenty-five other templates still interpolate unescaped values, so it came
// back. Fixing it here covers all of them without touching the money-path
// callers, and without the sweeping escapeMarkdown() — which would also escape
// the INTENTIONAL formatting those templates rely on.
//
// The rule is deliberately narrow: a delimiter is escaped throughout only when
// its unescaped count is odd, i.e. only when it is already broken. Balanced
// *bold* and `code` pass through untouched.
//
// No alert was ever lost to this — _sendWithRetry falls back to plain text —
// but the send queue is serialized, so each failure put 2s in front of whatever
// alert came next.
function _balanceMarkdown(text) {
    if (text == null) return '';
    const src = String(text);
    const DELIMS = ['_', '*', '`'];
    const count = { '_': 0, '*': 0, '`': 0 };
    // Count only UNESCAPED delimiters; a backslash neutralises the next char,
    // so escapeMarkdown() having run first must not be undone or double-counted.
    for (let i = 0; i < src.length; i++) {
        const c = src[i];
        if (c === '\\') { i++; continue; }
        if (DELIMS.indexOf(c) !== -1) count[c]++;
    }
    const odd = DELIMS.filter((c) => count[c] % 2 === 1);
    if (odd.length === 0) return src;      // every delimiter is balanced
    let out = '';
    for (let i = 0; i < src.length; i++) {
        const c = src[i];
        if (c === '\\') { out += c + (src[i + 1] || ''); i++; continue; }
        out += (odd.indexOf(c) !== -1) ? ('\\' + c) : c;
    }
    return out;
}

module.exports = {
    send,
    escapeMarkdown,
    _balanceMarkdown,
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
