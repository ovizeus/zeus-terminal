// Zeus Terminal — Credential Store (Phase 6)
// Extracts per-user exchange credential resolution into a reusable service.
// Used by: resolveExchange middleware (HTTP context) AND serverAT (internal).
'use strict';

const db = require('./database');
const { decrypt } = require('./encryption');

/**
 * Load and decrypt a user's exchange credentials.
 * @param {number|string} userId
 * @returns {{ apiKey: string, apiSecret: string, baseUrl: string, mode: string } | null}
 */
function getExchangeCreds(userId) {
    if (!userId) return null;
    const account = db.getExchangeAccount(userId);
    if (!account) return null;

    try {
        const apiKey = decrypt(account.api_key_encrypted);
        const apiSecret = decrypt(account.api_secret_encrypted);
        if (!apiKey || !apiSecret) return null;
        const baseUrl = account.mode === 'testnet'
            ? 'https://testnet.binancefuture.com'
            : 'https://fapi.binance.com';

        return { apiKey, apiSecret, baseUrl, mode: account.mode };
    } catch (err) {
        console.error('[CRED] Failed to decrypt credentials for user', userId, ':', err.message);
        return null;
    }
}

module.exports = { getExchangeCreds };
