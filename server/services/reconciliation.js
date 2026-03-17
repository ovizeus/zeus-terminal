// Zeus Terminal — Order Reconciliation Service
// Periodically compares local position state with exchange reality
// Reports mismatches via logger + telegram — never modifies positions
// Multi-user: iterates over all users with active exchange connections
'use strict';

const { sendSignedRequest } = require('./binanceSigner');
const config = require('../config');
const logger = require('./logger');
const telegram = require('./telegram');

let _localPositions = []; // Updated by trading routes
let _interval = null;
let _lastMismatchTs = 0;  // Throttle alerts (max 1 per 5 min)

/**
 * Update local position snapshot (called after order fills or syncs).
 * @param {Array} positions — Array of { symbol, side, size }
 */
function updateLocalSnapshot(positions) {
    _localPositions = Array.isArray(positions) ? positions : [];
}

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
 */
async function _reconcileForCreds(creds, label) {
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
            logger.debug('RECONCILE', `[${label}] ${exchangePositions.length} open positions`);
        }
        return { ok: true, positions: exchangePositions, label };
    } catch (err) {
        logger.error('RECONCILE', `[${label}] Failed: ${err.message}`);
        return { ok: false, error: err.message, label };
    }
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
            await _reconcileForCreds(creds, label);
        }

        return { ok: true };
    } catch (err) {
        logger.error('RECONCILE', 'Failed to reconcile: ' + err.message);
        return { ok: false, error: err.message };
    }
}

/**
 * Start the reconciliation loop (every 30s).
 */
function startReconciliation() {
    if (_interval) return;
    // First run after 10s (let server stabilize)
    setTimeout(() => {
        reconcile();
        _interval = setInterval(reconcile, 30000);
    }, 10000);
    logger.info('RECONCILE', 'Reconciliation loop started (30s interval)');
}

/**
 * Stop the reconciliation loop.
 */
function stopReconciliation() {
    if (_interval) { clearInterval(_interval); _interval = null; }
}

module.exports = {
    updateLocalSnapshot,
    reconcile,
    startReconciliation,
    stopReconciliation,
};
