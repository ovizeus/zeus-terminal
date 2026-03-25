// Zeus Terminal — Order Reconciliation Service
// Periodically compares local position state with exchange reality
// Reports mismatches via logger + telegram — never modifies positions
// Multi-user: iterates over all users with active exchange connections
'use strict';

const { sendSignedRequest } = require('./binanceSigner');
const config = require('../config');
const logger = require('./logger');
const telegram = require('./telegram');
const serverAT = require('./serverAT'); // [ZT-AUD-009] for internal position comparison

let _interval = null;
let _startupTimeout = null;

/**
 * Build credentials for a specific user's exchange account.
 * Returns null if account cannot be decrypted.
 */
function _buildCreds(account) {
    try {
        const { decrypt } = require('./encryption');
        const apiKey = decrypt(account.api_key_encrypted);
        const apiSecret = decrypt(account.api_secret_encrypted);
        const baseUrl = account.mode === 'testnet'
            ? 'https://testnet.binancefuture.com'
            : 'https://fapi.binance.com';
        return { apiKey, apiSecret, baseUrl };
    } catch (_) {
        return null;
    }
}

/**
 * Reconcile positions for a single set of credentials.
 * [ZT-AUD-009] Now compares exchange positions with internal AT positions
 * and alerts on mismatches. Remains strictly read-only.
 */
async function _reconcileForCreds(creds, label, userId) {
    try {
        const data = await sendSignedRequest('GET', '/fapi/v2/positionRisk', {}, creds);
        const exchangePositions = data
            .filter(p => parseFloat(p.positionAmt) !== 0)
            .map(p => ({
                symbol: p.symbol,
                side: parseFloat(p.positionAmt) > 0 ? 'LONG' : 'SHORT',
                size: Math.abs(parseFloat(p.positionAmt)),
            }));

        if (exchangePositions.length > 0) {
            logger.debug('RECONCILE', `[${label}] ${exchangePositions.length} exchange positions`);
        }

        // [ZT-AUD-009] Compare with internal live positions
        if (userId) {
            const internalPositions = serverAT.getLivePositions(userId);
            const mismatches = _comparePositions(exchangePositions, internalPositions, label);
            if (mismatches.length > 0) {
                const summary = mismatches.map(m => m.msg).join('\n');
                logger.warn('RECONCILE', `[${label}] ${mismatches.length} mismatch(es):\n${summary}`);
                telegram.sendToUser(userId, `⚠️ *RECONCILIATION MISMATCH*\n${summary}`);
            }
        }

        return { ok: true, positions: exchangePositions, label };
    } catch (err) {
        logger.error('RECONCILE', `[${label}] Failed: ${err.message}`);
        return { ok: false, error: err.message, label };
    }
}

/**
 * [ZT-AUD-009] Compare exchange positions vs internal AT live positions.
 * Returns array of {type, msg} for each mismatch found.
 * Strictly read-only — no mutations.
 */
function _comparePositions(exchangePositions, internalPositions, label) {
    const mismatches = [];

    // Build lookup: symbol_side → position
    const exchMap = {};
    exchangePositions.forEach(ep => { exchMap[ep.symbol + '_' + ep.side] = ep; });

    const intMap = {};
    internalPositions.forEach(ip => {
        const key = ip.symbol + '_' + ip.side;
        intMap[key] = ip;
    });

    // 1) Orphan on exchange — exists on exchange but not in internal state
    for (const key in exchMap) {
        if (!intMap[key]) {
            const ep = exchMap[key];
            mismatches.push({
                type: 'ORPHAN_EXCHANGE',
                msg: `🔸 ORPHAN on exchange: ${ep.symbol} ${ep.side} qty=${ep.size} — not tracked internally`,
            });
        }
    }

    // 2) Ghost internal — exists in internal state but not on exchange
    for (const key in intMap) {
        if (!exchMap[key]) {
            const ip = intMap[key];
            mismatches.push({
                type: 'GHOST_INTERNAL',
                msg: `👻 GHOST internal: ${ip.symbol} ${ip.side} seq=${ip.seq} — not found on exchange`,
            });
        }
    }

    // 3) Size mismatch — same symbol+side but different quantity
    for (const key in exchMap) {
        if (intMap[key]) {
            const ep = exchMap[key];
            const ip = intMap[key];
            const intQty = ip.qty || 0;
            // Allow 0.1% tolerance for rounding differences
            if (intQty > 0 && Math.abs(ep.size - intQty) / intQty > 0.001) {
                mismatches.push({
                    type: 'SIZE_MISMATCH',
                    msg: `📐 SIZE mismatch: ${ep.symbol} ${ep.side} — exchange=${ep.size} internal=${intQty}`,
                });
            }
        }
    }

    return mismatches;
}

/**
 * Fetch positions from all active exchange accounts and log.
 */
async function reconcile() {
    if (!config.tradingEnabled) return { ok: true, skipped: true };

    try {
        const db = require('./database');
        const accounts = db.listAllExchangeAccounts();

        if (accounts.length === 0) {
            return { ok: true, skipped: true, reason: 'no_accounts' };
        }

        for (const account of accounts) {
            const creds = _buildCreds(account);
            if (!creds) continue;
            const label = account.email || `user_${account.user_id}`;
            await _reconcileForCreds(creds, label, account.user_id);
        }

        return { ok: true };
    } catch (err) {
        logger.error('RECONCILE', 'Failed to reconcile: ' + err.message);
        return { ok: false, error: err.message };
    }
}

/**
 * Start the reconciliation loop (every 30s).
 * Skips reconcile calls when trading is disabled to save resources.
 */
function startReconciliation() {
    if (_interval || _startupTimeout) return;
    // First run after 10s (let server stabilize)
    _startupTimeout = setTimeout(() => {
        _startupTimeout = null;
        if (config.tradingEnabled) reconcile();
        _interval = setInterval(() => {
            if (config.tradingEnabled) reconcile();
        }, 30000);
    }, 10000);
    logger.info('RECONCILE', 'Reconciliation loop started (30s interval)');
}

/**
 * Stop the reconciliation loop.
 */
function stopReconciliation() {
    if (_startupTimeout) { clearTimeout(_startupTimeout); _startupTimeout = null; }
    if (_interval) { clearInterval(_interval); _interval = null; }
}

module.exports = {
    reconcile,
    startReconciliation,
    stopReconciliation,
};
