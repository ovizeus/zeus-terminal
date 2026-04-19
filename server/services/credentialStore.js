// Zeus Terminal — Credential Store (Phase 6 + Phase 2A: exchange-aware)
// Extracts per-user exchange credential resolution into a reusable service.
// Used by: resolveExchange middleware (HTTP context) AND serverAT (internal).
'use strict';

const db = require('./database');
const { decrypt } = require('./encryption');

// [Phase 2A] Canonical baseUrl matrix per (exchange, mode).
// Values match those used by /api/exchange/save verification (routes/exchange.js).
const BASE_URLS = {
    binance: {
        testnet: 'https://testnet.binancefuture.com',
        live:    'https://fapi.binance.com',
    },
    bybit: {
        testnet: 'https://api-testnet.bybit.com',
        live:    'https://api.bybit.com',
    },
};

function _resolveBaseUrl(exchange, mode) {
    const ex = BASE_URLS[exchange];
    if (!ex) return null;
    return ex[mode === 'testnet' ? 'testnet' : 'live'];
}

/**
 * Load and decrypt the active row's credentials for a user.
 * Phase 1A guarantees at most one active row per user.
 * @param {number|string} userId
 * @returns {{ exchange: string, apiKey: string, apiSecret: string, baseUrl: string, mode: string } | null}
 */
function getExchangeCreds(userId) {
    if (!userId) return null;
    const account = db.getExchangeAccount(userId);
    if (!account) return null;

    try {
        const apiKey = decrypt(account.api_key_encrypted);
        const apiSecret = decrypt(account.api_secret_encrypted);
        if (!apiKey || !apiSecret) return null;

        const exchange = account.exchange || 'binance';
        const mode = account.mode === 'testnet' ? 'testnet' : 'live';
        const baseUrl = _resolveBaseUrl(exchange, mode);
        if (!baseUrl) {
            console.error('[CRED] Unknown exchange in active row for user', userId, ':', exchange);
            return null;
        }

        return { exchange, apiKey, apiSecret, baseUrl, mode };
    } catch (err) {
        console.error('[CRED] Failed to decrypt credentials for user', userId, ':', err.message);
        return null;
    }
}

module.exports = { getExchangeCreds };
