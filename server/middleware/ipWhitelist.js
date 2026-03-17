// Zeus Terminal — IP Whitelist Middleware
// If ALLOWED_IPS is set in .env, only those IPs can access /api/* routes
// If empty or not set, allows all (backwards compat / dev mode)
'use strict';

const config = require('../config');

function ipWhitelist(req, res, next) {
    const allowed = config.allowedIps;
    if (!allowed || allowed.length === 0) return next();

    // Extract client IP (handle proxies)
    const clientIp = (req.ip || req.connection.remoteAddress || '').replace('::ffff:', '');

    if (allowed.includes(clientIp) || clientIp === '127.0.0.1' || clientIp === '::1') {
        return next();
    }

    console.warn('[IP] Blocked request from', clientIp, 'to', req.method, req.originalUrl);
    return res.status(403).json({ error: 'IP not allowed: ' + clientIp });
}

module.exports = ipWhitelist;
