// Zeus Terminal — Telegram Alert Service
// Sends critical alerts to a Telegram chat via Bot API
// Zero dependencies — uses Node.js built-in https
'use strict';

const https = require('https');
const config = require('../config');

/**
 * Send a message to the configured Telegram chat.
 * If TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID are not set, silently skips.
 * @param {string} text — Message text (supports Markdown)
 * @param {string} [parseMode='Markdown'] — 'Markdown' or 'HTML'
 * @returns {Promise<boolean>} — true if sent, false if skipped/failed
 */
function send(text, parseMode) {
    const token = config.telegram && config.telegram.botToken;
    const chatId = config.telegram && config.telegram.chatId;
    if (!token || !chatId) return Promise.resolve(false);

    return new Promise((resolve) => {
        const payload = JSON.stringify({
            chat_id: chatId,
            text: text,
            parse_mode: parseMode || 'Markdown',
            disable_web_page_preview: true,
        });
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

// ── Pre-built alert helpers ──

function alertOrderFilled(symbol, side, qty, price, orderId) {
    return send(
        '✅ *ORDER FILLED*\n' +
        '`' + symbol + '` ' + side + '\n' +
        'Qty: `' + qty + '` @ $`' + price + '`\n' +
        'OrderID: `' + orderId + '`'
    );
}

function alertOrderFailed(symbol, side, reason) {
    return send(
        '❌ *ORDER FAILED*\n' +
        '`' + symbol + '` ' + side + '\n' +
        'Reason: ' + reason
    );
}

function alertRiskBlock(reason, owner) {
    return send(
        '🚫 *RISK BLOCKED* (' + (owner || 'AT') + ')\n' +
        reason
    );
}

function alertKillSwitch(active) {
    return send(
        active
            ? '🛑 *EMERGENCY KILL SWITCH ACTIVATED*\nAll trading is now BLOCKED.'
            : '🟢 *KILL SWITCH DEACTIVATED*\nTrading resumed.'
    );
}

function alertDailyLoss(owner, realized, limit) {
    return send(
        '⚠️ *DAILY LOSS LIMIT* (' + owner + ')\n' +
        'Realized: $`' + Math.abs(realized).toFixed(2) + '` / $`' + limit.toFixed(2) + '`\n' +
        'New orders BLOCKED until tomorrow.'
    );
}

function alertServerStart() {
    return send(
        '⚡ *Zeus Terminal Started*\n' +
        'Trading: ' + (config.tradingEnabled ? '✅ ENABLED' : '🔒 DISABLED') + '\n' +
        'Time: ' + new Date().toISOString()
    );
}

function alertServerStop(reason) {
    return send(
        '🔴 *Zeus Terminal Stopped*\n' +
        'Reason: ' + (reason || 'shutdown') + '\n' +
        'Time: ' + new Date().toISOString()
    );
}

function alertReconciliationMismatch(localCount, exchangeCount, details) {
    return send(
        '⚠️ *POSITION MISMATCH*\n' +
        'Local: ' + localCount + ' | Exchange: ' + exchangeCount + '\n' +
        (details || '')
    );
}

module.exports = {
    send,
    alertOrderFilled,
    alertOrderFailed,
    alertRiskBlock,
    alertKillSwitch,
    alertDailyLoss,
    alertServerStart,
    alertServerStop,
    alertReconciliationMismatch,
};
