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
        // [BYBIT-DEMO 2026-05-29] "testnet" maps to Bybit DEMO TRADING (api-demo.bybit.com),
        // NOT the legacy separate testnet (api-testnet.bybit.com). Demo Trading keys are
        // created inside the real bybit.com account (Account → Demo Trading) and only auth
        // against api-demo.bybit.com — that's what operators actually use. Market data still
        // comes from the real WS (bybitFeed stream.bybit.com); only account/order REST differs.
        testnet: 'https://api-demo.bybit.com',
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
// Shared decrypt+normalize for a single exchange_accounts row. Identical output to the
// previous inline getExchangeCreds body — preserves backward compatibility.
function _credsFromAccount(account, userId) {
    if (!account) return null;
    try {
        const apiKey = decrypt(account.api_key_encrypted);
        const apiSecret = decrypt(account.api_secret_encrypted);
        if (!apiKey || !apiSecret) return null;

        const exchange = account.exchange || 'binance';
        // [Hotfix] Strict mode whitelist — invalid mode is NEVER coerced to 'live'.
        // Reason: Zeus must not assume REAL/LIVE when truth is uncertain.
        const mode = account.mode;
        if (mode !== 'testnet' && mode !== 'live') {
            console.error('[CRED] Invalid mode for user', userId, 'exchange', exchange, ': received', JSON.stringify(mode));
            return null;
        }
        const baseUrl = _resolveBaseUrl(exchange, mode);
        if (!baseUrl) {
            console.error('[CRED] Unknown exchange in row for user', userId, ':', exchange);
            return null;
        }

        return { exchange, apiKey, apiSecret, baseUrl, mode };
    } catch (err) {
        console.error('[CRED] Failed to decrypt credentials for user', userId, ':', err.message);
        return null;
    }
}

// ACTIVE row's credentials (used for NEW orders → the active exchange). Unchanged behavior.
function getExchangeCreds(userId) {
    if (!userId) return null;
    return _credsFromAccount(db.getExchangeAccount(userId), userId);
}

// [Multi-exchange switch P1] Credentials for a SPECIFIC exchange regardless of is_active.
// Used to manage still-open positions on a NON-active exchange (close/SL/DSL) after a switch.
// Returns null if no verified account exists for that exchange.
function getExchangeCredsFor(userId, exchange) {
    if (!userId || !exchange) return null;
    return _credsFromAccount(db.getExchangeAccountByExchange(userId, exchange), userId);
}

module.exports = { getExchangeCreds, getExchangeCredsFor };
