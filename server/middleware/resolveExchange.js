// Zeus Terminal — Per-User Exchange Resolver Middleware
// Loads and decrypts the authenticated user's exchange credentials
'use strict';

const { getExchangeCreds } = require('../services/credentialStore');

/**
 * Middleware that loads the current user's exchange credentials.
 * Sets req.exchangeCreds = { apiKey, apiSecret, baseUrl } if found.
 * Must be used AFTER sessionAuth (req.user must exist).
 */
function resolveExchange(req, res, next) {
    // Allow status/metrics/config reads without exchange credentials
    const readOnlyPaths = ['/status', '/metrics', '/audit', '/config', '/exchange', '/user', '/brain', '/risk']; // [S10] brain analytics + risk PnL tracking don't need exchange keys
    if (readOnlyPaths.some(p => req.path.startsWith(p))) {
        return next();
    }

    if (!req.user || !req.user.id) {
        return res.status(401).json({ error: 'Authentication required' });
    }

    try {
        const creds = getExchangeCreds(req.user.id);
        if (!creds) {
            return res.status(403).json({
                error: 'No exchange connected — configurează API keys în Settings → Exchange API'
            });
        }
        req.exchangeCreds = { apiKey: creds.apiKey, apiSecret: creds.apiSecret, baseUrl: creds.baseUrl };
        req.exchangeMode = creds.mode;
        next();
    } catch (err) {
        console.error(`[EXCHANGE] Decryption failed for user ${req.user.id}:`, err.message);
        return res.status(500).json({
            error: 'Eroare la decriptare credențiale — reconectează exchange în Settings'
        });
    }
}

module.exports = resolveExchange;
