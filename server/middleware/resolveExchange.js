// Zeus Terminal — Per-User Exchange Resolver Middleware
// Loads and decrypts the authenticated user's exchange credentials
'use strict';

const db = require('../services/database');
const { decrypt } = require('../services/encryption');

/**
 * Middleware that loads the current user's exchange credentials.
 * Sets req.exchangeCreds = { apiKey, apiSecret, baseUrl } if found.
 * Must be used AFTER sessionAuth (req.user must exist).
 */
function resolveExchange(req, res, next) {
    // Allow status/metrics/config reads without exchange credentials
    const readOnlyPaths = ['/status', '/metrics', '/audit', '/config', '/exchange'];
    if (readOnlyPaths.some(p => req.path.startsWith(p))) {
        return next();
    }

    if (!req.user || !req.user.id) {
        return res.status(401).json({ error: 'Authentication required' });
    }

    const account = db.getExchangeAccount(req.user.id);
    if (!account) {
        return res.status(403).json({
            error: 'No exchange connected — configurează API keys în Settings → Exchange API'
        });
    }

    try {
        const apiKey = decrypt(account.api_key_encrypted);
        const apiSecret = decrypt(account.api_secret_encrypted);
        const baseUrl = account.mode === 'testnet'
            ? 'https://testnet.binancefuture.com'
            : 'https://fapi.binance.com';

        req.exchangeCreds = { apiKey, apiSecret, baseUrl };
        req.exchangeMode = account.mode;
        next();
    } catch (err) {
        console.error(`[EXCHANGE] Decryption failed for user ${req.user.id}:`, err.message);
        return res.status(500).json({
            error: 'Eroare la decriptare credențiale — reconectează exchange în Settings'
        });
    }
}

module.exports = resolveExchange;
