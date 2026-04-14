// Zeus Terminal — Session Auth Middleware
// Protects all pages — redirects to /login.html if not authenticated
'use strict';

const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');

// [ZT-AUD-#12 / C10] In-memory cache backed by DB (last_active_at column).
// Survives pm2 restarts so a stolen JWT cannot stay valid indefinitely just
// because the server restarted between misuse attempts.
const _activity = new Map();
const INACTIVITY_TIMEOUT_MS = parseInt(process.env.SESSION_INACTIVITY_MIN, 10) * 60000 || 4 * 3600000; // default 4h
// Throttle DB writes — only persist when delta > N ms (cache absorbs noise).
const ACTIVITY_PERSIST_MIN_MS = 60000;
const _lastPersistedTs = new Map();

// [RT-05] Hourly cleanup of stale in-memory entries (DB column persists).
setInterval(() => {
    const cutoff = Date.now() - INACTIVITY_TIMEOUT_MS;
    for (const [uid, ts] of _activity) {
        if (ts < cutoff) {
            _activity.delete(uid);
            _lastPersistedTs.delete(uid);
        }
    }
}, 3600000);

function _readLastActive(uid) {
    if (_activity.has(uid)) return _activity.get(uid);
    try {
        const db = require('../services/database');
        const ts = db.getLastActiveAt(uid);
        if (ts) {
            _activity.set(uid, ts);
            _lastPersistedTs.set(uid, ts);
            return ts;
        }
    } catch (_) { /* DB not ready */ }
    return null;
}

function _writeLastActive(uid, now) {
    _activity.set(uid, now);
    const lastDb = _lastPersistedTs.get(uid) || 0;
    if ((now - lastDb) >= ACTIVITY_PERSIST_MIN_MS) {
        try {
            const db = require('../services/database');
            db.setLastActiveAt(uid, now);
            _lastPersistedTs.set(uid, now);
        } catch (_) { /* swallow — cache still valid */ }
    }
}

function createSessionAuth(jwtSecret) {
    return function sessionAuth(req, res, next) {
        // Public paths — no auth required
        const publicPaths = [
            '/login.html',
            '/privacy.html',
            '/terms.html',
            '/cookies.html',
            '/support.html',
            '/robots.txt',
            '/auth/',
            '/sw.js',
            '/favicon.ico',
            '/manifest.json',
            '/assets/',
            '/app/assets/',
            '/app/themes.css',
            '/app/favicon.svg',
            '/app/zeus-logo.png',
            '/css/',
            '/js/',
            // [ZT-AUD-#15] Allow unauthenticated client error reports (so a
            // crash on the login page itself can still be logged).
            '/api/client-error'
        ];

        const isPublic = publicPaths.some(p => req.path.startsWith(p));
        if (isPublic) return next();

        // Allow internal server requests (reconciliation, etc.) from localhost — limited paths only
        const ip = req.ip || req.connection.remoteAddress || '';
        const isLocal = ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
        const localSafePaths = ['/api/status', '/api/metrics', '/api/health', '/api/migration/flags', '/api/dashboard', '/api/sd/health'];
        if (isLocal && localSafePaths.some(p => req.path === p)) return next();

        // Check JWT cookie
        const token = req.cookies && req.cookies.zeus_token;
        if (!token) {
            // API requests get 401, page requests get redirect
            if (req.path.startsWith('/api/')) {
                return res.status(401).json({ error: 'Authentication required' });
            }
            return res.redirect('/login.html');
        }

        try {
            const decoded = jwt.verify(token, jwtSecret, { algorithms: ['HS256'] });
            req.user = decoded;

            // Ensure req.user.id exists (resolve from DB for legacy tokens without id)
            if (!req.user.id && req.user.email) {
                try {
                    const db = require('../services/database');
                    const u = db.findUserByEmail(req.user.email);
                    if (u) req.user.id = u.id;
                } catch (_) { /* DB not ready yet */ }
            }

            // Check user status — block banned/disabled accounts even with valid token
            // Also verify token_version for session invalidation on password change
            if (req.user.id) {
                try {
                    const db = require('../services/database');
                    const fresh = db.findUserById(req.user.id);
                    if (!fresh || fresh.status !== 'active') {
                        res.clearCookie('zeus_token', { path: '/' });
                        if (req.path.startsWith('/api/')) return res.status(403).json({ error: 'Account suspended' });
                        return res.redirect('/login.html');
                    }
                    // Reject tokens issued before password change
                    if (decoded.tokenVersion != null && fresh.token_version != null && decoded.tokenVersion !== fresh.token_version) {
                        res.clearCookie('zeus_token', { path: '/' });
                        if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'Session expired. Please log in again.' });
                        return res.redirect('/login.html');
                    }
                } catch (dbErr) {
                    console.error('[SESSION] DB check failed:', dbErr.message);
                    if (req.path.startsWith('/api/')) return res.status(503).json({ error: 'Service temporarily unavailable' });
                    return res.redirect('/login.html');
                }
            }

            // Also allow /auth/admin/* for logged-in admin (even from login page context)
            if (req.path.startsWith('/auth/admin/')) return next();

            // [SENTRY] Tag all errors with authenticated user
            if (req.user.id) {
                try {
                    const Sentry = require('@sentry/node');
                    Sentry.setUser({ id: String(req.user.id), email: req.user.email || undefined });
                } catch (_) {}
            }

            // [ZT-AUD-#12] Inactivity timeout — DB-backed (survives pm2 restart).
            if (req.user.id) {
                const last = _readLastActive(req.user.id);
                const now = Date.now();
                if (last && (now - last) > INACTIVITY_TIMEOUT_MS) {
                    _activity.delete(req.user.id);
                    _lastPersistedTs.delete(req.user.id);
                    res.clearCookie('zeus_token', { path: '/' });
                    const db = require('../services/database');
                    try { db.auditLog(req.user.id, 'INACTIVITY_TIMEOUT', { inactiveMs: now - last }, req.ip); } catch (_) {}
                    if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'Session expired due to inactivity' });
                    return res.redirect('/login.html');
                }
                _writeLastActive(req.user.id, now);
            }

            next();
        } catch (err) {
            res.clearCookie('zeus_token', { path: '/' });
            if (req.path.startsWith('/api/')) {
                return res.status(401).json({ error: 'Token expired' });
            }
            return res.redirect('/login.html');
        }
    };
}

function getActiveSessions() {
    const out = [];
    for (const [uid, ts] of _activity) out.push({ userId: uid, lastActive: ts });
    return out;
}

module.exports = { createSessionAuth, cookieParser, getActiveSessions };
