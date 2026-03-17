// Zeus Terminal — Session Auth Middleware
// Protects all pages — redirects to /login.html if not authenticated
'use strict';

const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');

function createSessionAuth(jwtSecret) {
    return function sessionAuth(req, res, next) {
        // Public paths — no auth required
        const publicPaths = [
            '/login.html',
            '/auth/',
            '/sw.js',
            '/manifest.json',
            '/assets/icon-192.png',
            '/assets/icon-512.png',
            '/assets/logo-zeus.jpg'
        ];

        const isPublic = publicPaths.some(p => req.path.startsWith(p) || req.path === p);
        if (isPublic) return next();

        // Allow internal server requests (reconciliation, etc.) from localhost
        const ip = req.ip || req.connection.remoteAddress || '';
        const isLocal = ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
        if (isLocal && req.path.startsWith('/api/')) return next();

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
            const decoded = jwt.verify(token, jwtSecret);
            req.user = decoded;

            // Ensure req.user.id exists (resolve from DB for legacy tokens without id)
            if (!req.user.id && req.user.email) {
                try {
                    const db = require('../services/database');
                    const u = db.findUserByEmail(req.user.email);
                    if (u) req.user.id = u.id;
                } catch (_) { /* DB not ready yet */ }
            }

            // Also allow /auth/admin/* for logged-in admin (even from login page context)
            if (req.path.startsWith('/auth/admin/')) return next();

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

module.exports = { createSessionAuth, cookieParser };
