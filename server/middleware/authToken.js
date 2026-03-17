// Zeus Terminal — Bearer Token Auth Middleware
// Protects /api/* routes with a shared secret from .env
'use strict';

const config = require('../config');

// Check if request comes from localhost
function _isLocalRequest(req) {
    const ip = req.ip || req.connection?.remoteAddress || '';
    return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1' || ip === 'localhost';
}

let _tokenWarnLogged = false;

function authToken(req, res, next) {
    // /api/status is public — used for health checks before trading
    if (req.path === '/status') return next();
    // /api/metrics is public — read-only health data
    if (req.path === '/metrics') return next();

    const token = config.tradingToken;
    if (!token) {
        // No token configured — allow localhost only (dev mode)
        if (_isLocalRequest(req)) {
            if (!_tokenWarnLogged) {
                _tokenWarnLogged = true;
                console.warn('[AUTH] ⚠ TRADING_TOKEN not set — allowing localhost only. Set TRADING_TOKEN in .env for production!');
            }
            return next();
        }
        // Remote request without token configured — block
        console.warn('[AUTH] BLOCKED remote request (no TRADING_TOKEN configured):', req.method, req.originalUrl, 'from', req.ip || '?');
        return res.status(401).json({ error: 'Unauthorized — TRADING_TOKEN not configured on server' });
    }

    const header = req.headers.authorization || '';
    const provided = header.startsWith('Bearer ') ? header.slice(7) : '';
    if (provided !== token) {
        console.warn('[AUTH] Rejected request to', req.method, req.originalUrl, 'from', req.ip || '?');
        return res.status(401).json({ error: 'Unauthorized — invalid or missing token' });
    }
    next();
}

module.exports = authToken;
