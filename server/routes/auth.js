// Zeus Terminal — Authentication Routes
// Uses SQLite via database.js for all user storage
'use strict';

const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');
const crypto = require('crypto');
const db = require('../services/database');
const logger = require('../services/logger');
const { getActiveSessions, resetActivity } = require('../middleware/sessionAuth');
function _mask(email) { if (!email) return '?'; const [u, d] = email.split('@'); return u[0] + '***@' + (d || '?'); }

const router = express.Router();
if (!process.env.JWT_SECRET) {
    console.error('[AUTH] FATAL: JWT_SECRET is not set in .env — server cannot start safely');
    process.exit(1);
}
const JWT_SECRET = process.env.JWT_SECRET;
// [M8] Default 1d (24h). Inactivity timeout (sessionAuth) handles long-lived sessions safely.
// Env-configurable up to 30d for users who want it.
const JWT_EXPIRY_DAYS = Math.max(1, Math.min(30, parseInt(process.env.JWT_EXPIRY_DAYS, 10) || 1));
const JWT_EXPIRY = JWT_EXPIRY_DAYS + 'd';
const BCRYPT_ROUNDS = 10;

// ─── 2FA Code Store (in-memory, codes expire after 5 min) ───
const pendingCodes = new Map(); // email → { code, role, userId, attempts, expiresAt }
const CODE_TTL = 5 * 60 * 1000; // 5 minutes
const MAX_ATTEMPTS = 5;

// ─── Login Rate Limit (per-IP) — [SEC-1] SQLite-backed, survives pm2 reload ───
const LOGIN_WINDOW = 15 * 60 * 1000; // 15 minutes
const LOGIN_MAX = 10; // max attempts per window

// ─── Verify-Code Rate Limit (per-IP) ───
const verifyAttempts = new Map(); // ip → { count, resetAt }
const VERIFY_WINDOW = 15 * 60 * 1000;
const VERIFY_MAX = 3; // Reduced from 10 — 6-digit code + 3 attempts is sufficient

// ─── PIN Rate Limit (per-user) ───
// [M9] Exponential backoff: after each PIN_MAX failures, the next window doubles
// (15min → 1h → 4h → 24h). Resets on successful PIN unlock or after 24h idle.
const pinAttempts = new Map(); // userId → { count, resetAt, lockoutLevel }
const PIN_WINDOW = 15 * 60 * 1000;
const PIN_MAX = 5;
const PIN_LOCKOUT_LEVELS = [15 * 60 * 1000, 60 * 60 * 1000, 4 * 60 * 60 * 1000, 24 * 60 * 60 * 1000]; // 15m,1h,4h,24h

// ─── Login Rate Limit (per-email) — [SEC-1] SQLite-backed ───
const LOGIN_EMAIL_MAX = 5;

// [AUTH-1] 2FA email-send rate limiter — prevents email bombing via repeated
// /login submits cu correct password (each one would otherwise queue another
// 2FA email). Tracks send count per email în a rolling window. SEPARATE from
// the SEC-1 SQLite per-email login attempts (which counts FAILED logins);
// this counts SUCCESSFUL pendingCodes.set + _sendCode dispatches.
const _2faSendTracker = new Map(); // email → { count, windowStart }
const _2FA_WINDOW_MS = 10 * 60 * 1000; // 10 minutes rolling window
const _2FA_MAX_SENDS = 3; // max 3 codes per email per 10 minutes

// Periodic cleanup of expired codes and stale rate-limit entries (every 5 min)
setInterval(() => {
    const now = Date.now();
    for (const [k, v] of pendingCodes) { if (now > v.expiresAt) pendingCodes.delete(k); }
    for (const [k, v] of verifyAttempts) { if (now > v.resetAt) verifyAttempts.delete(k); }
    for (const [k, v] of pinAttempts) { if (now > v.resetAt) pinAttempts.delete(k); }
    // [SEC-1] Prune expired login-attempt rows from SQLite
    try { db.loginAttemptPruneExpired(now); } catch (_) { }
    // [AUTH-1] Prune expired 2FA send-tracker entries
    for (const [k, v] of _2faSendTracker) { if (now - v.windowStart > _2FA_WINDOW_MS) _2faSendTracker.delete(k); }
}, 5 * 60 * 1000);

// ─── Email Transporter ───
let _mailer = null;
function _getMailer() {
    if (_mailer) return _mailer;
    const host = process.env.SMTP_HOST;
    const port = parseInt(process.env.SMTP_PORT, 10) || 587;
    const user = process.env.SMTP_USER;
    const pass = process.env.SMTP_PASS;
    if (!host || !user || !pass) {
        console.warn('[AUTH] SMTP not configured — 2FA codes will be logged to console');
        return null;
    }
    _mailer = nodemailer.createTransport({
        host, port,
        secure: port === 465,
        auth: { user, pass }
    });
    return _mailer;
}

function _generateCode() {
    return crypto.randomInt(100000, 999999).toString();
}

// Password policy — 12 chars min, uppercase + lowercase + digit
function _validatePassword(pw) {
    if (!pw || pw.length < 12) return 'Password must be at least 12 characters';
    if (pw.length > 128) return 'Password cannot exceed 128 characters';
    if (!/[a-z]/.test(pw)) return 'Password must contain at least one lowercase letter';
    if (!/[A-Z]/.test(pw)) return 'Password must contain at least one uppercase letter';
    if (!/\d/.test(pw)) return 'Password must contain at least one digit';
    return null;
}

async function _sendCode(email, code) {
    const mailer = _getMailer();
    if (!mailer) {
        // SMTP not configured — log code to console for local dev
        console.warn(`[AUTH-2FA] SMTP not configured — DEV CODE for ${email}: ${code}`);
        return true;
    }
    try {
        await mailer.sendMail({
            from: process.env.SMTP_FROM || process.env.SMTP_USER,
            to: email,
            subject: '🔐 Zeus Terminal — Verification Code',
            text: `Your verification code: ${code}\n\nThis code expires in 5 minutes.\nIf you did not request this code, ignore this email.`,
            html: `
                <div style="font-family:sans-serif;background:#0a0f16;color:#e0e0e0;padding:30px;border-radius:12px;max-width:400px;margin:0 auto">
                    <h2 style="color:#00afff;margin:0 0 16px">⚡ Zeus Terminal</h2>
                    <p style="margin:0 0 20px;color:#999">Login verification code:</p>
                    <div style="background:#111a28;border:1px solid #00afff44;border-radius:8px;padding:20px;text-align:center;font-size:32px;letter-spacing:8px;font-weight:700;color:#00ff88">${code}</div>
                    <p style="margin:16px 0 0;color:#556;font-size:12px">Code expires in 5 minutes.</p>
                </div>`
        });
        logger.info('AUTH', '2FA code sent', { to: _mask(email) });
        return true;
    } catch (err) {
        logger.error('AUTH', '2FA send failed', { to: _mask(email), error: err.message });
        return false;
    }
}

// ─── Helpers ───

// [SEC-1] Counters live in SQLite (table login_attempts) so a pm2 reload can't
// reset an attacker's window. Kind is 'ip' or 'email'; max is LOGIN_MAX vs LOGIN_EMAIL_MAX.
function _bumpLoginAttempt(kind, key, max) {
    const now = Date.now();
    const row = db.loginAttemptGet(kind, key);
    if (!row || now > row.reset_at) {
        db.loginAttemptUpsert(kind, key, 1, now + LOGIN_WINDOW);
        return true;
    }
    const nextCount = row.count + 1;
    db.loginAttemptUpsert(kind, key, nextCount, row.reset_at);
    return nextCount <= max;
}

function _checkLoginRate(ip) {
    return _bumpLoginAttempt('ip', ip, LOGIN_MAX);
}

function _checkLoginRateEmail(email) {
    return _bumpLoginAttempt('email', email, LOGIN_EMAIL_MAX);
}

function _setAuthCookie(res, token, userId) {
    res.cookie('zeus_token', token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production', // HTTPS only in prod (Cloudflare handles this)
        sameSite: 'lax',
        maxAge: JWT_EXPIRY_DAYS * 24 * 60 * 60 * 1000, // [SC-02] matches JWT_EXPIRY
        path: '/'
    });
    // [R21] Companion non-httpOnly cookie so client-side can read userId for
    // per-user localStorage scoping. User id is not secret (session token
    // stays httpOnly); this only exposes the id, not auth.
    if (userId != null) {
        res.cookie('zeus_uid', String(userId), {
            httpOnly: false,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'lax',
            maxAge: JWT_EXPIRY_DAYS * 24 * 60 * 60 * 1000,
            path: '/'
        });
    }
}

// ─── POST /auth/register ───
router.post('/register', async (req, res) => {
    if (!_checkLoginRate(req.ip)) return res.status(429).json({ error: 'Too many requests. Try again in a few minutes.' });
    try {
        const { email, password, termsAcceptedAt, termsVersion } = req.body;
        if (!email || !password) {
            return res.status(400).json({ error: 'Email and password are required' });
        }

        // [LEGAL-1] Require explicit acceptance of Terms / Privacy / Cookie policies (GDPR Art. 7)
        if (!termsAcceptedAt || typeof termsAcceptedAt !== 'string' || !termsVersion || typeof termsVersion !== 'string') {
            return res.status(400).json({ error: 'You must accept the Terms, Privacy and Cookie policies to register.' });
        }

        const normalEmail = email.toLowerCase().trim();

        // Validate email format
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalEmail)) {
            return res.status(400).json({ error: 'Invalid email format' });
        }

        // [S3B3] Uniform password policy
        var _pwErr = _validatePassword(password);
        if (_pwErr) {
            return res.status(400).json({ error: _pwErr });
        }

        // Check if user exists — generic response to prevent email enumeration
        if (db.findUserByEmail(normalEmail)) {
            return res.json({ ok: true, pending: true, message: 'Account created. Waiting for admin approval.' });
        }

        // Limit max users (security — prevent mass registration)
        const MAX_USERS = parseInt(process.env.MAX_USERS, 10) || 10;
        const currentCount = db.countUsers();
        if (currentCount >= MAX_USERS) {
            return res.status(403).json({ error: 'Maximum number of accounts reached' });
        }

        // First user = admin (auto-approved), rest need approval
        const isFirst = currentCount === 0;
        const hash = await bcrypt.hash(password, BCRYPT_ROUNDS);
        const role = isFirst ? 'admin' : 'user';
        const userId = db.createUser(normalEmail, hash, role, isFirst);
        db.addPasswordHistory(userId, hash);

        // [LEGAL-1] Persist consent record (GDPR Art. 7 — demonstrability)
        try { db.setUserTermsConsent(userId, termsAcceptedAt, termsVersion); } catch (_) { /* best-effort */ }

        db.auditLog(userId, 'USER_REGISTERED', { role, autoApproved: isFirst, termsVersion, termsAcceptedAt }, req.ip);

        if (isFirst) {
            // Admin auto-login (JWT includes id + tokenVersion for session invalidation)
            const token = jwt.sign({ id: userId, email: normalEmail, role: 'admin', tokenVersion: 1 }, JWT_SECRET, { expiresIn: JWT_EXPIRY });
            _setAuthCookie(res, token, userId);
            resetActivity(userId, Date.now());
            logger.info('AUTH', 'Admin registered', { email: _mask(normalEmail) });
            return res.json({ ok: true, email: normalEmail, role: 'admin' });
        }

        // Non-admin: registered but pending approval
        logger.info('AUTH', 'User registered (pending)', { email: _mask(normalEmail) });
        res.json({ ok: true, pending: true, message: 'Account created. Waiting for admin approval.' });
    } catch (err) {
        logger.error('AUTH', 'Register error', { error: err.message });
        res.status(500).json({ error: 'Internal error' });
    }
});

// ─── POST /auth/login — Step 1: verify password, send 2FA code ───
router.post('/login', async (req, res) => {
    try {
        // Rate limit by IP
        if (!_checkLoginRate(req.ip)) {
            return res.status(429).json({ error: 'Too many login attempts. Wait 15 minutes.' });
        }

        const { email, password } = req.body;
        if (!email || !password) {
            return res.status(400).json({ error: 'Email and password are required' });
        }

        const normalEmail = email.toLowerCase().trim();
        const user = db.findUserByEmail(normalEmail);

        if (!user) {
            // [SEC-2] IP-tagged log for fail2ban (unknown email = probing)
            logger.warn('AUTH', 'LOGIN_FAILED unknown_email ip=' + req.ip, { email: _mask(normalEmail), ip: req.ip });
            // [AUTH-2] Constant-time defense: spend ~bcrypt.compare time even
            // on unknown email so timing differential doesn't leak email
            // validity to attackers. Without this, valid email + wrong password
            // takes ~100ms (bcrypt.compare on 12-round hash) while unknown email
            // returns instantly — timing distinguishes valid/invalid emails.
            // Compare against a known-bad hash; result always false (never
            // authenticates). Per-email rate bucket isn't hit on this path
            // (intentional — see SEC-2/AUTH-2 reasoning în bug book).
            try { await bcrypt.compare(password || '', '$2a$12$0000000000000000000000.0000000000000000000000000000000'); } catch (_) {}
            return res.status(401).json({ error: 'Incorrect email or password' });
        }

        // Check account status (blocked?)
        if (user.status === 'blocked') {
            return res.status(403).json({ error: 'Your account has been blocked.' });
        }

        // Check ban
        if (user.status === 'banned' && user.banned_until) {
            const banEnd = new Date(user.banned_until);
            if (banEnd > new Date()) {
                const remaining = banEnd.getFullYear() >= 9999 ? 'permanent' : banEnd.toLocaleString('ro-RO');
                return res.status(403).json({ error: 'Your account is suspended until: ' + remaining });
            }
            // Ban expired — auto-unban
            db.unbanUser(user.id);
        }

        // Per-email rate limit (prevents targeted brute-force on known accounts)
        if (!_checkLoginRateEmail(normalEmail)) {
            return res.status(429).json({ error: 'Too many attempts for this account. Try again in 15 minutes.' });
        }

        const valid = await bcrypt.compare(password, user.password_hash);
        if (!valid) {
            db.auditLog(user.id, 'LOGIN_FAILED', { reason: 'wrong_password' }, req.ip);
            // [SEC-2] IP-tagged log so fail2ban can ban brute-forcers
            logger.warn('AUTH', 'LOGIN_FAILED wrong_password ip=' + req.ip, { email: _mask(normalEmail), ip: req.ip });
            return res.status(401).json({ error: 'Incorrect email or password' });
        }

        // Reject expired temporary password (set by admin reset)
        if (user.pwd_temp_expires_at && new Date(user.pwd_temp_expires_at) < new Date()) {
            db.auditLog(user.id, 'LOGIN_FAILED', { reason: 'temp_password_expired' }, req.ip);
            logger.warn('AUTH', 'LOGIN_FAILED temp_password_expired ip=' + req.ip, { email: _mask(normalEmail), ip: req.ip });
            return res.status(401).json({ error: 'Your temporary password has expired. Ask an administrator for a new one.' });
        }

        // Check approval
        if (!user.approved) {
            return res.status(403).json({ error: 'You already have a pending access request — it is awaiting administrator approval.' });
        }

        // [AUTH-1] 2FA email-bombing rate limit — gate before pendingCodes.set
        // + _sendCode dispatch. Without this, attacker (or buggy client cu
        // automatic retry) flooding /login cu correct credentials triggers
        // unlimited 2FA emails, abusing SMTP and degrading mailbox UX.
        // Window: 10 min, max 3 sends per email. Returns 429 when exceeded.
        // Uses in-memory Map (not SQLite) — restart resets bucket which is
        // acceptable risk; rate-limit is a soft defense, not auth gate.
        {
            const _now = Date.now();
            const _track = _2faSendTracker.get(normalEmail) || { count: 0, windowStart: _now };
            if (_now - _track.windowStart > _2FA_WINDOW_MS) {
                // Window expired — reset counter
                _track.count = 0;
                _track.windowStart = _now;
            }
            if (_track.count >= _2FA_MAX_SENDS) {
                logger.warn('AUTH', `2FA send rate limit hit uid=${user.id} email=${_mask(normalEmail)} ip=${req.ip} count=${_track.count}/${_2FA_MAX_SENDS}`);
                return res.status(429).json({ error: 'Too many 2FA codes sent — try again in a few minutes.' });
            }
            _track.count++;
            _2faSendTracker.set(normalEmail, _track);
        }

        // Generate and send 2FA code.
        // [AUTH-4] On /login retry within active window, REUSE existing
        // pending code instead of overwriting. Previously: new code orphaned
        // the first one — user mistypes-then-retries got mismatched codes.
        // Now: same code re-emailed (identical to first send), attempts
        // counter preserved, expiry preserved. Fresh code only when no
        // pending entry exists or previous expired.
        const _now = Date.now();
        const _existing = pendingCodes.get(normalEmail);
        const _hasValidPending = _existing && _existing.expiresAt > _now;
        const code = _hasValidPending ? _existing.code : _generateCode();
        pendingCodes.set(normalEmail, {
            code,
            role: user.role || 'user',
            userId: user.id,
            attempts: _hasValidPending ? _existing.attempts : 0,
            expiresAt: _hasValidPending ? _existing.expiresAt : _now + CODE_TTL,
        });

        // [ZT-AUD-C3] 2FA is mandatory. If SMTP isn't available we never
        // bypass — in production we fail, in dev we surface the code via
        // server console so the operator can still complete the flow without
        // skipping the 2FA challenge entirely.
        const mailer = _getMailer();
        if (!mailer) {
            const isProd = process.env.NODE_ENV === 'production';
            if (isProd) {
                pendingCodes.delete(normalEmail);
                logger.error('AUTH', 'Login blocked — SMTP not configured in production', { email: _mask(normalEmail) });
                db.auditLog(user.id, 'LOGIN_FAILED', { reason: 'no_smtp_no_bypass' }, req.ip);
                return res.status(503).json({ error: 'Email service unavailable. Cannot send 2FA code. Try again later.' });
            }
            // Dev/test: keep the code in pendingCodes and print it server-side.
            console.warn(`[AUTH-2FA][DEV] SMTP not configured. 2FA code for ${_mask(normalEmail)}: ${code}`);
            logger.warn('AUTH', '2FA code printed to console (dev, no SMTP)', { email: _mask(normalEmail) });
            return res.json({ ok: true, needsCode: true, message: '2FA code printed to the server console (dev mode).' });
        }

        const sent = await _sendCode(normalEmail, code);
        if (!sent) {
            pendingCodes.delete(normalEmail);
            logger.error('AUTH', 'SMTP failed, login blocked', { email: _mask(normalEmail) });
            return res.status(503).json({ error: 'Email service unavailable. Cannot send 2FA code. Try again later.' });
        }

        logger.info('AUTH', '2FA code sent for login', { email: _mask(normalEmail) });
        res.json({ ok: true, needsCode: true, message: 'Cod de verificare trimis pe email.' });
    } catch (err) {
        console.error('[AUTH] Login error:', err.message);
        res.status(500).json({ error: 'Internal error' });
    }
});

// ─── POST /auth/verify-code — Step 2: verify 2FA code, set cookie ───
router.post('/verify-code', (req, res) => {
    try {
        // Per-IP rate limit
        const ip = req.ip;
        const now = Date.now();
        let va = verifyAttempts.get(ip);
        if (!va || now > va.resetAt) { va = { count: 0, resetAt: now + VERIFY_WINDOW }; verifyAttempts.set(ip, va); }
        va.count++;
        if (va.count > VERIFY_MAX) {
            return res.status(429).json({ error: 'Too many verification attempts. Try again later.' });
        }

        const { email, code } = req.body;
        if (!email || !code) {
            return res.status(400).json({ error: 'Email and code are required' });
        }

        const normalEmail = email.toLowerCase().trim();
        const pending = pendingCodes.get(normalEmail);

        if (!pending) {
            return res.status(400).json({ error: 'No active code. Please sign in again.' });
        }

        // Check expiration
        if (Date.now() > pending.expiresAt) {
            pendingCodes.delete(normalEmail);
            return res.status(400).json({ error: 'The code has expired. Please sign in again.' });
        }

        // Check attempts
        pending.attempts++;
        if (pending.attempts > MAX_ATTEMPTS) {
            pendingCodes.delete(normalEmail);
            return res.status(429).json({ error: 'Too many attempts. Please sign in again.' });
        }

        // Verify code (constant-time comparison)
        const codeStr = String(code).trim();
        if (codeStr.length !== 6 || !crypto.timingSafeEqual(Buffer.from(codeStr), Buffer.from(pending.code))) {
            return res.status(401).json({ error: 'Incorrect code. You have ' + (MAX_ATTEMPTS - pending.attempts) + ' attempts left.' });
        }

        // Success — clear code and set JWT (includes user id + tokenVersion)
        pendingCodes.delete(normalEmail);
        const freshUser = db.findUserById(pending.userId);
        const token = jwt.sign({ id: pending.userId, email: normalEmail, role: pending.role, tokenVersion: freshUser ? freshUser.token_version : 1 }, JWT_SECRET, { expiresIn: JWT_EXPIRY });
        _setAuthCookie(res, token, pending.userId);
        // Reset inactivity tracking so this fresh session isn't immediately
        // tripped by the previous session's stale last_active_at.
        resetActivity(pending.userId, Date.now());

        db.auditLog(pending.userId, 'LOGIN_SUCCESS', {}, req.ip);
        logger.info('AUTH', 'Login verified', { email: _mask(normalEmail), role: pending.role });
        res.json({ ok: true, email: normalEmail, role: pending.role });
    } catch (err) {
        console.error('[AUTH] Verify-code error:', err.message);
        res.status(500).json({ error: 'Internal error' });
    }
});

// ─── POST /auth/logout ───
router.post('/logout', (req, res) => {
    res.clearCookie('zeus_token', { path: '/' });
    res.clearCookie('zeus_uid', { path: '/' });
    res.json({ ok: true });
});

// ─── GET /auth/me — check if logged in ───
router.get('/me', (req, res) => {
    const token = req.cookies && req.cookies.zeus_token;
    if (!token) return res.status(401).json({ error: 'Not authenticated' });

    try {
        const decoded = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });

        // If JWT has id, use it; otherwise resolve from DB (legacy token)
        let userId = decoded.id;
        if (!userId) {
            const u = db.findUserByEmail(decoded.email);
            userId = u ? u.id : null;
        }

        // [R21] Refresh companion zeus_uid cookie on every /auth/me. This
        // covers sessions that predate the R21 deploy (they have zeus_token
        // but no zeus_uid) — /auth/me is the first server call on every
        // boot, so uid is restored before any localStorage work.
        if (userId != null) {
            res.cookie('zeus_uid', String(userId), {
                httpOnly: false,
                secure: process.env.NODE_ENV === 'production',
                sameSite: 'lax',
                maxAge: JWT_EXPIRY_DAYS * 24 * 60 * 60 * 1000,
                path: '/'
            });
        }

        res.json({ ok: true, id: userId, email: decoded.email, role: decoded.role || 'user' });
    } catch (err) {
        res.clearCookie('zeus_token', { path: '/' });
        res.clearCookie('zeus_uid', { path: '/' });
        res.status(401).json({ error: 'Token invalid' });
    }
});

// ─── ADMIN: GET /auth/admin/users — list all users + exchange info ───
router.get('/admin/users', (req, res) => {
    const token = req.cookies && req.cookies.zeus_token;
    if (!token) return res.status(401).json({ error: 'Not authenticated' });

    try {
        const decoded = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });
        const caller = db.findUserByEmail(decoded.email);
        if (!caller || caller.role !== 'admin' || caller.status !== 'active') {
            return res.status(403).json({ error: 'Admin only' });
        }
        if ((decoded.tokenVersion ?? 0) !== (caller.token_version ?? 0)) {
            return res.status(401).json({ error: 'Session expired' });
        }

        const users = db.listUsers().map(u => ({
            id: u.id,
            email: u.email,
            role: u.role || 'user',
            approved: !!u.approved,
            status: u.status || 'active',
            bannedUntil: u.banned_until || null,
            createdAt: u.created_at
        }));

        // Enrich with exchange connection info
        let exchangeMap = {};
        try {
            const exchanges = db.listAllExchangeAccounts();
            exchanges.forEach(ex => { exchangeMap[ex.email] = ex; });
        } catch (_) { }

        const enriched = users.map(u => {
            const ex = exchangeMap[u.email];
            return {
                ...u,
                exchange: ex ? {
                    connected: true,
                    exchange: ex.exchange,
                    mode: ex.mode,
                    status: ex.status,
                    lastVerified: ex.last_verified_at
                } : { connected: false }
            };
        });

        res.json({ ok: true, users: enriched });
    } catch (err) {
        res.status(401).json({ error: 'Token invalid' });
    }
});

// ─── ADMIN: GET /auth/admin/pending-count — header badge counter ───
// [2026-06-06] Cheap poll target for the admin shield icon in the main header:
// shows how many registrations await approval without opening the panel.
// Same guard as /admin/users.
router.get('/admin/pending-count', (req, res) => {
    const token = req.cookies && req.cookies.zeus_token;
    if (!token) return res.status(401).json({ error: 'Not authenticated' });
    try {
        const decoded = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });
        const caller = db.findUserByEmail(decoded.email);
        if (!caller || caller.role !== 'admin' || caller.status !== 'active') {
            return res.status(403).json({ error: 'Admin only' });
        }
        if ((decoded.tokenVersion ?? 0) !== (caller.token_version ?? 0)) {
            return res.status(401).json({ error: 'Session expired' });
        }
        const count = db.listUsers().filter(u => !u.approved && (u.role || 'user') !== 'admin').length;
        res.json({ ok: true, count });
    } catch (err) {
        res.status(401).json({ error: 'Token invalid' });
    }
});

// ─── ADMIN: POST /auth/admin/approve — approve a user ───
router.post('/admin/approve', (req, res) => {
    const token = req.cookies && req.cookies.zeus_token;
    if (!token) return res.status(401).json({ error: 'Not authenticated' });

    try {
        const decoded = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });
        const caller = db.findUserByEmail(decoded.email);
        if (!caller || caller.role !== 'admin' || caller.status !== 'active') {
            return res.status(403).json({ error: 'Admin only' });
        }
        if ((decoded.tokenVersion ?? 0) !== (caller.token_version ?? 0)) {
            return res.status(401).json({ error: 'Session expired' });
        }

        const { email } = req.body;
        if (!email) return res.status(400).json({ error: 'Email required' });

        const normalEmail = email.toLowerCase().trim();
        const user = db.findUserByEmail(normalEmail);
        if (!user) return res.status(404).json({ error: 'User not found' });

        db.approveUser(normalEmail);
        db.auditLog(caller.id, 'ADMIN_APPROVE_USER', { targetEmail: normalEmail }, req.ip);
        logger.info('AUTH', 'Admin approved user', { target: _mask(normalEmail) });
        res.json({ ok: true });
    } catch (err) {
        res.status(401).json({ error: 'Token invalid' });
    }
});

// ─── ADMIN: POST /auth/admin/delete — delete a user ───
router.post('/admin/delete', (req, res) => {
    const token = req.cookies && req.cookies.zeus_token;
    if (!token) return res.status(401).json({ error: 'Not authenticated' });

    try {
        const decoded = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });
        const caller = db.findUserByEmail(decoded.email);
        if (!caller || caller.role !== 'admin' || caller.status !== 'active') {
            return res.status(403).json({ error: 'Admin only' });
        }
        if ((decoded.tokenVersion ?? 0) !== (caller.token_version ?? 0)) {
            return res.status(401).json({ error: 'Session expired' });
        }

        const { email } = req.body;
        if (!email) return res.status(400).json({ error: 'Email required' });

        const normalEmail = email.toLowerCase().trim();
        // Can't delete yourself
        if (normalEmail === decoded.email) {
            return res.status(400).json({ error: 'You cannot delete your own account' });
        }

        const target = db.findUserByEmail(normalEmail);
        if (!target) return res.status(404).json({ error: 'User not found' });

        // Also disconnect their exchange before deleting (cascade should handle it, but be safe)
        db.disconnectExchange(target.id);
        db.deleteUser(normalEmail, 'admin');
        db.auditLog(caller.id, 'ADMIN_DELETE_USER', { targetEmail: normalEmail }, req.ip);
        logger.info('AUTH', 'Admin deleted user', { target: _mask(normalEmail) });
        res.json({ ok: true });
    } catch (err) {
        res.status(401).json({ error: 'Token invalid' });
    }
});

// ─── ADMIN: POST /auth/admin/reject — reject a pending user (delete) ───
router.post('/admin/reject', (req, res) => {
    const token = req.cookies && req.cookies.zeus_token;
    if (!token) return res.status(401).json({ error: 'Not authenticated' });
    try {
        const decoded = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });
        const caller = db.findUserByEmail(decoded.email);
        if (!caller || caller.role !== 'admin' || caller.status !== 'active') return res.status(403).json({ error: 'Admin only' });
        if ((decoded.tokenVersion ?? 0) !== (caller.token_version ?? 0)) return res.status(401).json({ error: 'Session expired' });
        const { email } = req.body;
        if (!email) return res.status(400).json({ error: 'Email required' });
        const normalEmail = email.toLowerCase().trim();
        const target = db.findUserByEmail(normalEmail);
        if (!target) return res.status(404).json({ error: 'User not found' });
        if (target.role === 'admin') return res.status(400).json({ error: 'Cannot reject admin' });
        db.rejectUser(normalEmail);
        db.auditLog(caller.id, 'ADMIN_REJECT_USER', { targetEmail: normalEmail }, req.ip);
        logger.info('AUTH', 'Admin rejected user', { target: _mask(normalEmail) });
        res.json({ ok: true });
    } catch (err) { res.status(401).json({ error: 'Token invalid' }); }
});

// ─── ADMIN: POST /auth/admin/block — block/unblock a user ───
router.post('/admin/block', (req, res) => {
    const token = req.cookies && req.cookies.zeus_token;
    if (!token) return res.status(401).json({ error: 'Not authenticated' });
    try {
        const decoded = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });
        const caller = db.findUserByEmail(decoded.email);
        if (!caller || caller.role !== 'admin' || caller.status !== 'active') return res.status(403).json({ error: 'Admin only' });
        if ((decoded.tokenVersion ?? 0) !== (caller.token_version ?? 0)) return res.status(401).json({ error: 'Session expired' });
        const { email, block } = req.body; // block: true/false
        if (!email) return res.status(400).json({ error: 'Email required' });
        const normalEmail = email.toLowerCase().trim();
        const target = db.findUserByEmail(normalEmail);
        if (!target) return res.status(404).json({ error: 'User not found' });
        if (target.role === 'admin') return res.status(400).json({ error: 'Cannot block admin' });
        const newStatus = block ? 'blocked' : 'active';
        db.setUserStatus(target.id, newStatus);
        if (!block) db.unbanUser(target.id); // unblock also clears ban
        db.auditLog(caller.id, block ? 'ADMIN_BLOCK_USER' : 'ADMIN_UNBLOCK_USER', { targetEmail: normalEmail }, req.ip);
        logger.info('AUTH', block ? 'Admin blocked user' : 'Admin unblocked user', { target: _mask(normalEmail) });
        res.json({ ok: true, status: newStatus });
    } catch (err) { res.status(401).json({ error: 'Token invalid' }); }
});

// ─── ADMIN: POST /auth/admin/ban — ban a user for a duration ───
router.post('/admin/ban', (req, res) => {
    const token = req.cookies && req.cookies.zeus_token;
    if (!token) return res.status(401).json({ error: 'Not authenticated' });
    try {
        const decoded = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });
        const caller = db.findUserByEmail(decoded.email);
        if (!caller || caller.role !== 'admin' || caller.status !== 'active') return res.status(403).json({ error: 'Admin only' });
        if ((decoded.tokenVersion ?? 0) !== (caller.token_version ?? 0)) return res.status(401).json({ error: 'Session expired' });
        const { email, duration } = req.body; // duration: '1h','24h','7d','30d','permanent'
        if (!email || !duration) return res.status(400).json({ error: 'Email and duration required' });
        const normalEmail = email.toLowerCase().trim();
        const target = db.findUserByEmail(normalEmail);
        if (!target) return res.status(404).json({ error: 'User not found' });
        if (target.role === 'admin') return res.status(400).json({ error: 'Cannot ban admin' });
        let bannedUntil = null;
        if (duration === 'permanent') {
            bannedUntil = '9999-12-31T23:59:59Z';
        } else {
            const ms = { '1h': 3600000, '24h': 86400000, '7d': 604800000, '30d': 2592000000 };
            const dur = ms[duration];
            if (!dur) return res.status(400).json({ error: 'Invalid duration. Use: 1h, 24h, 7d, 30d, permanent' });
            bannedUntil = new Date(Date.now() + dur).toISOString();
        }
        db.banUser(target.id, bannedUntil);
        db.auditLog(caller.id, 'ADMIN_BAN_USER', { targetEmail: normalEmail, duration, bannedUntil }, req.ip);
        logger.info('AUTH', 'Admin banned user', { target: _mask(normalEmail), duration, bannedUntil });
        res.json({ ok: true, bannedUntil });
    } catch (err) { res.status(401).json({ error: 'Token invalid' }); }
});

// ─── ADMIN: GET /auth/admin/audit — paginated audit log ───
router.get('/admin/audit', (req, res) => {
    const token = req.cookies && req.cookies.zeus_token;
    if (!token) return res.status(401).json({ error: 'Not authenticated' });
    try {
        const decoded = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });
        const caller = db.findUserByEmail(decoded.email);
        if (!caller || caller.role !== 'admin' || caller.status !== 'active') return res.status(403).json({ error: 'Admin only' });
        if ((decoded.tokenVersion ?? 0) !== (caller.token_version ?? 0)) return res.status(401).json({ error: 'Session expired' });

        // [M10] True pagination — limit + offset, with total count
        const limit = parseInt(req.query.limit, 10) || 50;
        const offset = parseInt(req.query.offset, 10) || 0;
        const page = db.listAuditLog(limit, offset);
        res.json({ ok: true, entries: page.rows, total: page.total, limit: page.limit, offset: page.offset });
    } catch (err) { res.status(401).json({ error: 'Token invalid' }); }
});

// ─── Admin auth helper (reusable) ───
function _adminGuard(req, res) {
    const token = req.cookies && req.cookies.zeus_token;
    if (!token) { res.status(401).json({ error: 'Not authenticated' }); return null; }
    try {
        const decoded = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });
        const caller = db.findUserByEmail(decoded.email);
        if (!caller || caller.role !== 'admin' || caller.status !== 'active') { res.status(403).json({ error: 'Admin only' }); return null; }
        if ((decoded.tokenVersion ?? 0) !== (caller.token_version ?? 0)) { res.status(401).json({ error: 'Session expired' }); return null; }
        return { caller, decoded };
    } catch (_) { res.status(401).json({ error: 'Token invalid' }); return null; }
}

// ─── ADMIN: GET /auth/admin/health — server health snapshot ───
router.get('/admin/health', (req, res) => {
    const guard = _adminGuard(req, res); if (!guard) return;
    let dbStatus = 'ok';
    try { db.db.prepare('SELECT 1').get(); } catch (_) { dbStatus = 'down'; }
    // [PANEL-LABELS 2026-06-12] Read the REAL WS server (global.__zeusWss, set at
    // server.js:1694). The old probe read global.__zeusWSClients which is never
    // assigned anywhere → always undefined → forced WARN (yellow) even though the
    // WebSocket server is up and serving. Report 'ok' when the WSS exists.
    const wss = global.__zeusWss;
    const wsStatus = (wss && wss.clients) ? 'ok' : 'down';
    const health = {
        server: 'ok',
        websocket: wsStatus,
        database: dbStatus,
        exchange: 'ok',
        sync: 'ok',
        audit: 'ok',
        uptime: process.uptime(),
        memory: { rss: process.memoryUsage().rss, heapUsed: process.memoryUsage().heapUsed, heapTotal: process.memoryUsage().heapTotal },
        checkedAt: new Date().toISOString(),
    };
    res.json({ ok: true, health });
});

// ─── ADMIN: GET /auth/admin/users/:id — user detail ───
router.get('/admin/users/:id', (req, res) => {
    const guard = _adminGuard(req, res); if (!guard) return;
    const id = parseInt(req.params.id, 10);
    if (!id || Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
    const u = db.findUserById(id);
    if (!u) return res.status(404).json({ error: 'User not found' });
    let exchange = { connected: false };
    try {
        const all = db.listAllExchangeAccounts();
        const ex = all.find(x => x.email === u.email);
        if (ex) exchange = { connected: true, exchange: ex.exchange, mode: ex.mode, status: ex.status, lastVerified: ex.last_verified_at };
    } catch (_) {}
    res.json({
        ok: true,
        user: {
            id: u.id,
            email: u.email,
            role: u.role || 'user',
            approved: !!u.approved,
            status: u.status || 'active',
            bannedUntil: u.banned_until || null,
            createdAt: u.created_at,
            updatedAt: u.updated_at,
            tokenVersion: u.token_version,
            exchange,
        },
    });
});

// ─── ADMIN: GET /auth/admin/users/:id/audit — audit filtered by user ───
router.get('/admin/users/:id/audit', (req, res) => {
    const guard = _adminGuard(req, res); if (!guard) return;
    const id = parseInt(req.params.id, 10);
    if (!id || Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
    const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
    const u = db.findUserById(id);
    if (!u) return res.status(404).json({ error: 'User not found' });
    // Include both actions performed by user AND targeting them (email match in details)
    const byActor = db.listAuditLogByUser(id, limit, 0).rows; // [M10] new shape
    const byTarget = db.listAuditLogByTarget(u.email, limit);
    const seen = new Set();
    const merged = [...byActor, ...byTarget]
      .filter(e => { if (seen.has(e.id)) return false; seen.add(e.id); return true; })
      .sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''))
      .slice(0, limit);
    res.json({ ok: true, entries: merged });
});

// ─── ADMIN: POST /auth/admin/force-logout — invalidate all sessions for a user ───
router.post('/admin/force-logout', (req, res) => {
    const guard = _adminGuard(req, res); if (!guard) return;
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email required' });
    const normalEmail = email.toLowerCase().trim();
    const target = db.findUserByEmail(normalEmail);
    if (!target) return res.status(404).json({ error: 'User not found' });
    db.bumpTokenVersion(target.id);
    db.auditLog(guard.caller.id, 'ADMIN_FORCE_LOGOUT', { targetEmail: normalEmail, targetId: target.id }, req.ip);
    logger.info('AUTH', 'Admin forced logout', { target: _mask(normalEmail) });
    res.json({ ok: true });
});

// ─── ADMIN: POST /auth/admin/suspend — suspend with reason ───
router.post('/admin/suspend', (req, res) => {
    const guard = _adminGuard(req, res); if (!guard) return;
    const { email, reason } = req.body;
    if (!email) return res.status(400).json({ error: 'Email required' });
    const normalEmail = email.toLowerCase().trim();
    const target = db.findUserByEmail(normalEmail);
    if (!target) return res.status(404).json({ error: 'User not found' });
    if (target.role === 'admin') return res.status(400).json({ error: 'Cannot suspend admin' });
    db.setUserStatus(target.id, 'blocked');
    db.auditLog(guard.caller.id, 'ADMIN_SUSPEND_USER', { targetEmail: normalEmail, reason: reason || 'admin_suspend' }, req.ip);
    logger.info('AUTH', 'Admin suspended user', { target: _mask(normalEmail), reason });
    res.json({ ok: true });
});

// ─── ADMIN: GET /auth/admin/sessions — list active in-memory sessions ───
router.get('/admin/sessions', (req, res) => {
    const guard = _adminGuard(req, res); if (!guard) return;
    const sessions = getActiveSessions();
    const userMap = {};
    try { db.listUsers().forEach(u => { userMap[u.id] = u; }); } catch (_) {}
    const enriched = sessions.map(s => {
        const u = userMap[s.userId];
        return {
            userId: s.userId,
            email: u?.email || '(unknown)',
            role: u?.role || 'user',
            status: u?.status || 'unknown',
            lastActive: new Date(s.lastActive).toISOString(),
            idleMs: Date.now() - s.lastActive,
        };
    }).sort((a, b) => a.idleMs - b.idleMs);
    res.json({ ok: true, sessions: enriched, count: enriched.length });
});

// ─── ADMIN: GET /auth/admin/audit/export — export audit log as CSV ───
router.get('/admin/audit/export', (req, res) => {
    const guard = _adminGuard(req, res); if (!guard) return;
    const limit = Math.min(parseInt(req.query.limit, 10) || 1000, 5000);
    const rows = db.listAuditLog(limit, 0).rows; // [M10] new shape
    const headers = ['id', 'created_at', 'user_id', 'action', 'ip', 'details'];
    const esc = (v) => {
        if (v == null) return '';
        const s = String(v).replace(/"/g, '""');
        return /[",\n]/.test(s) ? `"${s}"` : s;
    };
    const csv = [headers.join(','), ...rows.map(r => headers.map(h => esc(r[h])).join(','))].join('\n');
    const filename = `zeus-audit-${new Date().toISOString().slice(0, 10)}.csv`;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(csv);
});

// ─── ADMIN: POST /auth/admin/note — add internal note (stored in audit_log) ───
router.post('/admin/note', (req, res) => {
    const guard = _adminGuard(req, res); if (!guard) return;
    const { email, note } = req.body;
    if (!email || !note) return res.status(400).json({ error: 'Email and note required' });
    const normalEmail = email.toLowerCase().trim();
    const target = db.findUserByEmail(normalEmail);
    if (!target) return res.status(404).json({ error: 'User not found' });
    db.auditLog(guard.caller.id, 'ADMIN_NOTE', { targetEmail: normalEmail, targetId: target.id, note: String(note).slice(0, 1000) }, req.ip);
    res.json({ ok: true });
});

// ─── ADMIN: POST /auth/admin/reset-password — generate temp password, bump token_version ───
router.post('/admin/reset-password', async (req, res) => {
    const guard = _adminGuard(req, res); if (!guard) return;
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email required' });
    const normalEmail = email.toLowerCase().trim();
    const target = db.findUserByEmail(normalEmail);
    if (!target) return res.status(404).json({ error: 'User not found' });
    if (target.role === 'admin' && target.id !== guard.caller.id) {
        return res.status(400).json({ error: 'Cannot reset password for another admin' });
    }
    const tempPassword = crypto.randomBytes(9).toString('base64').replace(/[+/=]/g, '').slice(0, 12) + '!9';
    const hash = await bcrypt.hash(tempPassword, BCRYPT_ROUNDS);
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    db.updatePassword(target.id, hash);
    db.addPasswordHistory(target.id, hash);
    db.setTempPasswordMeta(target.id, expiresAt);
    db.bumpTokenVersion(target.id);
    db.auditLog(guard.caller.id, 'ADMIN_RESET_PASSWORD', { targetEmail: normalEmail, targetId: target.id, expiresAt }, req.ip);
    res.json({ ok: true, tempPassword, expiresAt, note: 'Temp password expires in 1 hour. Communicate via secure channel; user must change on first login.' });
});

// [M7] Per-admin rate limit on bulk endpoint — limits damage from compromised admin
const _bulkRate = new Map(); // adminId → { count, resetAt }
const BULK_WINDOW = 60 * 1000; // 1 min
const BULK_MAX_CALLS = 3;      // 3 calls/min/admin
const BULK_MAX_IDS = 50;       // worst case: 150 actions/min/admin
setInterval(() => { const now = Date.now(); for (const [k, v] of _bulkRate) if (now > v.resetAt) _bulkRate.delete(k); }, 5 * 60 * 1000);

// ─── ADMIN: POST /auth/admin/bulk — bulk ops (force-logout / approve / block) ───
router.post('/admin/bulk', (req, res) => {
    const guard = _adminGuard(req, res); if (!guard) return;
    // [M7] Per-admin throttle
    const now = Date.now();
    let br = _bulkRate.get(guard.caller.id);
    if (!br || now > br.resetAt) { br = { count: 0, resetAt: now + BULK_WINDOW }; _bulkRate.set(guard.caller.id, br); }
    br.count++;
    if (br.count > BULK_MAX_CALLS) {
        db.auditLog(guard.caller.id, 'ADMIN_BULK_RATE_LIMITED', { count: br.count }, req.ip);
        return res.status(429).json({ error: 'Bulk rate limit: max ' + BULK_MAX_CALLS + ' calls/min' });
    }
    const { action, ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: 'ids[] required' });
    if (ids.length > BULK_MAX_IDS) return res.status(400).json({ error: 'Max ' + BULK_MAX_IDS + ' ids per request' });
    const allowed = ['force-logout', 'approve', 'block', 'unblock'];
    if (!allowed.includes(action)) return res.status(400).json({ error: 'Unknown action' });
    const results = { ok: 0, skipped: 0, errors: [] };
    for (const rawId of ids) {
        const id = parseInt(rawId, 10);
        if (!id) { results.skipped++; continue; }
        try {
            const u = db.findUserById(id);
            if (!u) { results.skipped++; continue; }
            if (u.role === 'admin' && u.id !== guard.caller.id) { results.skipped++; continue; }
            if (action === 'force-logout') { db.bumpTokenVersion(id); }
            else if (action === 'approve') { db.approveUser(u.email); }
            else if (action === 'block') { db.setUserStatus(u.id, 'blocked'); }
            else if (action === 'unblock') { db.setUserStatus(u.id, 'active'); }
            results.ok++;
        } catch (err) { results.errors.push({ id, error: err.message }); }
    }
    db.auditLog(guard.caller.id, 'ADMIN_BULK_' + action.toUpperCase().replace('-', '_'), { ids, results }, req.ip);
    res.json({ ok: true, results });
});

// ─── ADMIN: GET /auth/admin/modules — module status snapshot ───
router.get('/admin/modules', (req, res) => {
    const guard = _adminGuard(req, res); if (!guard) return;
    let MF = null;
    try { MF = require('../migrationFlags'); } catch (_) {}
    const modules = [
        // [PANEL-LABELS 2026-06-12] AT execution migrated server-side under the
        // SP2-b cutover flag SERVER_AT_FULL_OWNERSHIP (the legacy SERVER_AT flag
        // was never flipped, so the panel wrongly showed "client"). Treat full
        // server ownership as server-side.
        { key: 'at',        name: 'AutoTrade',   location: (MF?.SERVER_AT || MF?.SERVER_AT_FULL_OWNERSHIP) ? 'server' : (MF?.CLIENT_AT ? 'client' : 'off'),
          state: MF?.SERVER_AT || MF?.SERVER_AT_FULL_OWNERSHIP || MF?.CLIENT_AT ? 'ok' : 'off' },
        { key: 'brain',     name: 'Brain',       location: MF?.SERVER_BRAIN ? 'server' : (MF?.CLIENT_BRAIN ? 'client' : 'off'),
          state: MF?.SERVER_BRAIN || MF?.CLIENT_BRAIN ? 'ok' : 'off' },
        { key: 'marketData',name: 'Market Feed', location: MF?.SERVER_MARKET_DATA ? 'server' : 'client',
          state: 'ok' },
        { key: 'websocket', name: 'WebSocket',   location: 'server', state: 'ok' },
        { key: 'database',  name: 'Database',    location: 'server', state: 'ok' },
        { key: 'audit',     name: 'Audit Log',   location: 'server', state: 'ok' },
    ];
    try {
        const audit = db.listAuditLog(1, 0).rows; // [M10] new shape
        modules.find(m => m.key === 'audit').lastEvent = audit[0]?.created_at || null;
    } catch (_) {}
    res.json({ ok: true, modules, uptime: process.uptime(), checkedAt: new Date().toISOString() });
});

// ─── ADMIN: GET /auth/admin/flags — current migration flags ───
router.get('/admin/flags', (req, res) => {
    const guard = _adminGuard(req, res); if (!guard) return;
    let MF = null;
    try { MF = require('../migrationFlags'); } catch (_) { return res.status(500).json({ error: 'migrationFlags unavailable' }); }
    const defaults = MF.DEFAULTS || {};
    const current = MF.getAll();
    const flags = Object.keys(defaults).map(key => ({
        key,
        value: current[key],
        default: defaults[key],
        changed: current[key] !== defaults[key],
        // [P1 2026-06-06] UI renders protected flags read-only.
        protected: PROTECTED_FLAGS.has(key) || undefined,
    }));
    res.json({ ok: true, flags });
});

// [P1 2026-06-06] REAL-money master switches must NEVER be one-tap toggles in
// the admin panel — they flip ONLY via the formal operator procedure (review +
// phantom-check, at the console). Fail-closed blocklist; attempts are audited.
const PROTECTED_FLAGS = new Set(['_SRV_POS_REAL_ENABLED', '_USERDATA_STREAM_REAL_ENABLED']);

// ─── ADMIN: POST /auth/admin/flags — toggle a migration flag ───
router.post('/admin/flags', (req, res) => {
    const guard = _adminGuard(req, res); if (!guard) return;
    const { key, value } = req.body;
    if (typeof key !== 'string' || typeof value !== 'boolean') return res.status(400).json({ error: 'key:string and value:boolean required' });
    // [P1 2026-06-06] Fail-closed: REAL master switches refuse the admin route.
    if (PROTECTED_FLAGS.has(key)) {
        try { db.auditLog(guard.caller.id, 'ADMIN_FLAG_TOGGLE_BLOCKED', { key, requested: value, reason: 'protected — operator procedure only' }, req.ip); } catch (_) {}
        return res.status(403).json({ error: 'Flag protected — REAL execution flips only via the formal operator procedure, not the admin panel' });
    }
    let MF = null;
    try { MF = require('../migrationFlags'); } catch (_) { return res.status(500).json({ error: 'migrationFlags unavailable' }); }
    try {
        const before = MF.getAll()[key];
        MF.set(key, value);
        const after = MF.getAll()[key];
        db.auditLog(guard.caller.id, 'ADMIN_FLAG_TOGGLE', { key, before, requested: value, after }, req.ip);
        res.json({ ok: true, flags: MF.getAll() });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

// ─── CHANGE PASSWORD: Step 1 — request code ───
router.post('/change-password/request', async (req, res) => {
    if (!_checkLoginRate(req.ip)) return res.status(429).json({ error: 'Too many requests. Try again in a few minutes.' });
    const token = req.cookies && req.cookies.zeus_token;
    if (!token) return res.status(401).json({ error: 'Not authenticated' });
    try {
        const decoded = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });
        const user = db.findUserByEmail(decoded.email);
        if (!user) return res.status(404).json({ error: 'User not found' });

        const { currentPassword } = req.body;
        if (!currentPassword) return res.status(400).json({ error: 'Current password is required' });

        const valid = await bcrypt.compare(currentPassword, user.password_hash);
        if (!valid) {
            db.auditLog(user.id, 'CHANGE_PASSWORD_FAILED', { reason: 'wrong_current_password' }, req.ip);
            return res.status(401).json({ error: 'Current password is incorrect' });
        }

        const code = _generateCode();
        pendingCodes.set('chpw_' + decoded.email, {
            code,
            userId: user.id,
            attempts: 0,
            expiresAt: Date.now() + CODE_TTL
        });

        const sent = await _sendCode(decoded.email, code);
        if (!sent) {
            pendingCodes.delete('chpw_' + decoded.email);
            return res.status(503).json({ error: 'Could not send the code. Please try again later.' });
        }

        db.auditLog(user.id, 'CHANGE_PASSWORD_REQUESTED', {}, req.ip);
        res.json({ ok: true, message: 'Cod trimis pe email' });
    } catch (err) {
        res.status(401).json({ error: 'Token invalid' });
    }
});

// ─── CHANGE PASSWORD: Step 2 — verify code & update ───
router.post('/change-password/confirm', async (req, res) => {
    if (!_checkLoginRate(req.ip)) return res.status(429).json({ error: 'Too many requests. Try again in a few minutes.' });
    const token = req.cookies && req.cookies.zeus_token;
    if (!token) return res.status(401).json({ error: 'Not authenticated' });
    try {
        const decoded = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });
        const user = db.findUserByEmail(decoded.email);
        if (!user) return res.status(404).json({ error: 'User not found' });

        const { code, newPassword } = req.body;
        if (!code || !newPassword) return res.status(400).json({ error: 'Code and new password are required' });
        var _pwErr2 = _validatePassword(newPassword);
        if (_pwErr2) return res.status(400).json({ error: _pwErr2 });

        const key = 'chpw_' + decoded.email;
        const pending = pendingCodes.get(key);
        if (!pending) return res.status(400).json({ error: 'No active code. Request a new one.' });

        if (Date.now() > pending.expiresAt) {
            pendingCodes.delete(key);
            return res.status(400).json({ error: 'The code has expired. Request a new one.' });
        }

        pending.attempts++;
        if (pending.attempts > 5) {
            pendingCodes.delete(key);
            return res.status(429).json({ error: 'Too many attempts. Request a new code.' });
        }

        if (String(code).length !== 6 || !crypto.timingSafeEqual(Buffer.from(String(code)), Buffer.from(String(pending.code)))) {
            return res.status(400).json({ error: 'Incorrect code. You have ' + (5 - pending.attempts) + ' attempts left.' });
        }

        // Code valid — check password history (last 5)
        const newHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
        const history = db.getPasswordHistory(user.id);
        for (const oldHash of history) {
            if (await bcrypt.compare(newPassword, oldHash)) {
                return res.status(400).json({ error: 'You cannot reuse one of your last 5 passwords.' });
            }
        }

        // Update password + record in history + invalidate old sessions
        db.updatePassword(user.id, newHash);
        db.addPasswordHistory(user.id, newHash);
        db.clearTempPasswordMeta(user.id);
        db.bumpTokenVersion(user.id);
        pendingCodes.delete(key);

        // Re-issue JWT with new tokenVersion so current session stays valid
        const freshUser = db.findUserById(user.id);
        const newToken = jwt.sign(
            { id: user.id, email: decoded.email, role: decoded.role, tokenVersion: freshUser.token_version },
            JWT_SECRET, { expiresIn: JWT_EXPIRY }
        );
        _setAuthCookie(res, newToken, user.id);

        db.auditLog(user.id, 'CHANGE_PASSWORD_SUCCESS', {}, req.ip);
        logger.info('AUTH', 'Password changed', { email: _mask(decoded.email) });
        res.json({ ok: true, message: 'Your password has been changed successfully.' });
    } catch (err) {
        res.status(401).json({ error: 'Token invalid' });
    }
});

// ─── CHANGE EMAIL: Step 1 — request code ───
router.post('/change-email/request', async (req, res) => {
    if (!_checkLoginRate(req.ip)) return res.status(429).json({ error: 'Too many requests. Try again in a few minutes.' });
    const token = req.cookies && req.cookies.zeus_token;
    if (!token) return res.status(401).json({ error: 'Not authenticated' });
    try {
        const decoded = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });
        const user = db.findUserByEmail(decoded.email);
        if (!user) return res.status(404).json({ error: 'User not found' });

        const { currentPassword, newEmail } = req.body;
        if (!currentPassword) return res.status(400).json({ error: 'Current password is required' });
        if (!newEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail)) {
            return res.status(400).json({ error: 'Invalid email address' });
        }

        const normalised = newEmail.toLowerCase().trim();
        if (normalised === decoded.email.toLowerCase()) {
            return res.status(400).json({ error: 'Emailul nou este identic cu cel actual' });
        }

        const existing = db.findUserByEmail(normalised);
        if (existing) return res.status(409).json({ error: 'Acest email este deja folosit' });

        const valid = await bcrypt.compare(currentPassword, user.password_hash);
        if (!valid) {
            db.auditLog(user.id, 'CHANGE_EMAIL_FAILED', { reason: 'wrong_password' }, req.ip);
            return res.status(401).json({ error: 'Current password is incorrect' });
        }

        const code = _generateCode();
        pendingCodes.set('chem_' + decoded.email, {
            code,
            userId: user.id,
            newEmail: normalised,
            attempts: 0,
            expiresAt: Date.now() + CODE_TTL
        });

        const sent = await _sendCode(normalised, code);
        if (!sent) {
            pendingCodes.delete('chem_' + decoded.email);
            return res.status(503).json({ error: 'Could not send the code. Please try again later.' });
        }

        db.auditLog(user.id, 'CHANGE_EMAIL_REQUESTED', { newEmail: normalised }, req.ip);
        res.json({ ok: true, message: 'Cod trimis pe noul email' });
    } catch (err) {
        res.status(401).json({ error: 'Token invalid' });
    }
});

// ─── CHANGE EMAIL: Step 2 — verify code & update ───
router.post('/change-email/confirm', async (req, res) => {
    if (!_checkLoginRate(req.ip)) return res.status(429).json({ error: 'Too many requests. Try again in a few minutes.' });
    const token = req.cookies && req.cookies.zeus_token;
    if (!token) return res.status(401).json({ error: 'Not authenticated' });
    try {
        const decoded = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });
        const user = db.findUserByEmail(decoded.email);
        if (!user) return res.status(404).json({ error: 'User not found' });

        const { code } = req.body;
        if (!code) return res.status(400).json({ error: 'Codul este necesar' });

        const key = 'chem_' + decoded.email;
        const pending = pendingCodes.get(key);
        if (!pending) return res.status(400).json({ error: 'No active code. Request a new one.' });

        if (Date.now() > pending.expiresAt) {
            pendingCodes.delete(key);
            return res.status(400).json({ error: 'The code has expired. Request a new one.' });
        }

        pending.attempts++;
        if (pending.attempts > 5) {
            pendingCodes.delete(key);
            return res.status(429).json({ error: 'Too many attempts. Request a new code.' });
        }

        if (String(code).length !== 6 || !crypto.timingSafeEqual(Buffer.from(String(code)), Buffer.from(String(pending.code)))) {
            return res.status(400).json({ error: 'Incorrect code. You have ' + (5 - pending.attempts) + ' attempts left.' });
        }

        // Atomic check + update in transaction
        const emailResult = db.atomicEmailUpdate(user.id, pending.newEmail);
        if (!emailResult.ok) {
            pendingCodes.delete(key);
            return res.status(409).json({ error: emailResult.error });
        }
        pendingCodes.delete(key);

        // Issue new JWT with updated email (preserve tokenVersion)
        const newToken = jwt.sign(
            { id: user.id, email: pending.newEmail, role: user.role, tokenVersion: user.token_version || 1 },
            JWT_SECRET,
            { expiresIn: JWT_EXPIRY } // [SC-02] use constant instead of hardcoded
        );
        _setAuthCookie(res, newToken, user.id); // [bug#3] refresh zeus_uid companion cookie too

        // Notify old email about the change
        const _oldMailer = _getMailer();
        if (_oldMailer) {
            _oldMailer.sendMail({
                from: process.env.SMTP_FROM || process.env.SMTP_USER,
                to: decoded.email,
                subject: '⚠️ Zeus Terminal — Email address changed',
                text: 'The email address associated with your Zeus Terminal account has been changed.\nIf you did not request this change, contact the administrator immediately.',
                html: '<div style="font-family:sans-serif;background:#0a0f16;color:#e0e0e0;padding:30px;border-radius:12px;max-width:400px;margin:0 auto"><h2 style="color:#ff6600;margin:0 0 16px">⚠️ Zeus Terminal</h2><p>The email address associated with your account has been changed.</p><p style="margin:16px 0 0;color:#ff4444;font-size:13px">If you did not request this change, contact the administrator immediately.</p></div>'
            }).catch(err => logger.error('AUTH', 'Old email notification failed', { error: err.message }));
        }

        db.auditLog(user.id, 'CHANGE_EMAIL_SUCCESS', { oldEmail: decoded.email, newEmail: pending.newEmail }, req.ip);
        logger.info('AUTH', 'Email changed', { from: _mask(decoded.email), to: _mask(pending.newEmail) });
        res.json({ ok: true, message: 'Emailul a fost schimbat cu succes!' });
    } catch (err) {
        res.status(401).json({ error: 'Token invalid' });
    }
});

// ─── FORGOT PASSWORD: Step 1 — request code (no login needed) ───
router.post('/forgot-password/request', async (req, res) => {
    if (!_checkLoginRate(req.ip)) return res.status(429).json({ error: 'Too many requests. Try again in a few minutes.' });
    const email = (req.body.email || '').toLowerCase().trim(); // [S13] normalize
    if (!email) return res.status(400).json({ error: 'Emailul este necesar' });

    const user = db.findUserByEmail(email);
    // Always return success (don't reveal if email exists)
    if (!user) return res.json({ ok: true, message: 'If the email exists, you will receive a code.' });

    if (user.status === 'banned' || (user.banned_until && new Date(user.banned_until) > new Date())) {
        return res.json({ ok: true, message: 'If the email exists, you will receive a code.' });
    }

    const code = _generateCode();
    pendingCodes.set('fgpw_' + email.toLowerCase().trim(), {
        code,
        userId: user.id,
        attempts: 0,
        expiresAt: Date.now() + CODE_TTL
    });

    const sent = await _sendCode(email, code);
    if (!sent) {
        pendingCodes.delete('fgpw_' + email.toLowerCase().trim());
        return res.status(503).json({ error: 'Could not send the code. Please try again later.' });
    }

    db.auditLog(user.id, 'FORGOT_PASSWORD_REQUESTED', {}, req.ip);
    logger.info('AUTH', 'Forgot password code sent', { email: _mask(email) });
    res.json({ ok: true, message: 'If the email exists, you will receive a code.' });
});

// ─── FORGOT PASSWORD: Step 2 — verify code & set new password ───
router.post('/forgot-password/confirm', async (req, res) => {
    if (!_checkLoginRate(req.ip)) return res.status(429).json({ error: 'Too many requests. Try again in a few minutes.' });
    const { email, code, newPassword } = req.body;
    if (!email || !code || !newPassword) return res.status(400).json({ error: 'Email, code and new password are required' });
    var _pwErr3 = _validatePassword(newPassword);
    if (_pwErr3) return res.status(400).json({ error: _pwErr3 });

    const key = 'fgpw_' + email.toLowerCase().trim();
    const pending = pendingCodes.get(key);
    if (!pending) return res.status(400).json({ error: 'No active code. Request a new one.' });

    if (Date.now() > pending.expiresAt) {
        pendingCodes.delete(key);
        return res.status(400).json({ error: 'The code has expired. Request a new one.' });
    }

    pending.attempts++;
    if (pending.attempts > MAX_ATTEMPTS) {
        pendingCodes.delete(key);
        return res.status(429).json({ error: 'Too many attempts. Request a new code.' });
    }

    if (String(code).length !== 6 || !crypto.timingSafeEqual(Buffer.from(String(code)), Buffer.from(String(pending.code)))) {
        return res.status(400).json({ error: 'Incorrect code. You have ' + (MAX_ATTEMPTS - pending.attempts) + ' attempts left.' });
    }

    const newHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
    const history = db.getPasswordHistory(pending.userId);
    for (const oldHash of history) {
        if (await bcrypt.compare(newPassword, oldHash)) {
            return res.status(400).json({ error: 'You cannot reuse one of your last 5 passwords.' });
        }
    }

    db.updatePassword(pending.userId, newHash);
    db.addPasswordHistory(pending.userId, newHash);
    db.clearTempPasswordMeta(pending.userId);
    db.bumpTokenVersion(pending.userId);
    pendingCodes.delete(key);

    db.auditLog(pending.userId, 'FORGOT_PASSWORD_SUCCESS', {}, req.ip);
    logger.info('AUTH', 'Password reset via forgot-password', { email: _mask(email) });
    res.json({ ok: true, message: 'Your password has been reset successfully. You can now sign in.' });
});

// ─── CLOSE ACCOUNT: Step 1 — request code ───
router.post('/close-account/request', async (req, res) => {
    if (!_checkLoginRate(req.ip)) return res.status(429).json({ error: 'Too many requests. Try again in a few minutes.' });
    const token = req.cookies && req.cookies.zeus_token;
    if (!token) return res.status(401).json({ error: 'Not authenticated' });
    try {
        const decoded = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });
        const user = db.findUserByEmail(decoded.email);
        if (!user) return res.status(404).json({ error: 'User not found' });

        const { currentPassword } = req.body;
        if (!currentPassword) return res.status(400).json({ error: 'Current password is required' });

        const valid = await bcrypt.compare(currentPassword, user.password_hash);
        if (!valid) {
            db.auditLog(user.id, 'CLOSE_ACCOUNT_FAILED', { reason: 'wrong_password' }, req.ip);
            return res.status(401).json({ error: 'Current password is incorrect' });
        }

        if (user.role === 'admin') {
            return res.status(403).json({ error: 'The administrator account cannot be deleted.' });
        }

        const code = _generateCode();
        pendingCodes.set('clac_' + decoded.email, {
            code,
            userId: user.id,
            attempts: 0,
            expiresAt: Date.now() + CODE_TTL
        });

        const sent = await _sendCode(decoded.email, code);
        if (!sent) {
            pendingCodes.delete('clac_' + decoded.email);
            return res.status(503).json({ error: 'Could not send the code. Please try again later.' });
        }

        db.auditLog(user.id, 'CLOSE_ACCOUNT_REQUESTED', {}, req.ip);
        res.json({ ok: true, message: 'Cod trimis pe email' });
    } catch (err) {
        res.status(401).json({ error: 'Token invalid' });
    }
});

// ─── CLOSE ACCOUNT: Step 2 — verify code & delete ───
router.post('/close-account/confirm', async (req, res) => {
    if (!_checkLoginRate(req.ip)) return res.status(429).json({ error: 'Too many requests. Try again in a few minutes.' });
    const token = req.cookies && req.cookies.zeus_token;
    if (!token) return res.status(401).json({ error: 'Not authenticated' });
    try {
        const decoded = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });
        const user = db.findUserByEmail(decoded.email);
        if (!user) return res.status(404).json({ error: 'User not found' });

        if (user.role === 'admin') {
            return res.status(403).json({ error: 'The administrator account cannot be deleted.' });
        }

        const { code } = req.body;
        if (!code) return res.status(400).json({ error: 'Codul este necesar' });

        const key = 'clac_' + decoded.email;
        const pending = pendingCodes.get(key);
        if (!pending) return res.status(400).json({ error: 'No active code. Request a new one.' });

        if (Date.now() > pending.expiresAt) {
            pendingCodes.delete(key);
            return res.status(400).json({ error: 'The code has expired. Request a new one.' });
        }

        pending.attempts++;
        if (pending.attempts > MAX_ATTEMPTS) {
            pendingCodes.delete(key);
            return res.status(429).json({ error: 'Too many attempts. Request a new code.' });
        }

        if (String(code).length !== 6 || !crypto.timingSafeEqual(Buffer.from(String(code)), Buffer.from(String(pending.code)))) {
            return res.status(400).json({ error: 'Incorrect code. You have ' + (MAX_ATTEMPTS - pending.attempts) + ' attempts left.' });
        }

        // Delete user and all associated data
        pendingCodes.delete(key);
        db.disconnectExchange(user.id);
        db.deleteUser(decoded.email, 'none'); // 'none' allows deleting any role except admin (enforced above)

        // Clear sync data files
        const syncDir = require('path').join(__dirname, '..', '..', 'data', 'sync_user');
        const fs = require('fs');
        try { fs.unlinkSync(require('path').join(syncDir, user.id + '_state.json')); } catch (_) { }
        try { fs.unlinkSync(require('path').join(syncDir, user.id + '_journal.json')); } catch (_) { }

        // Clear auth cookie
        res.clearCookie('zeus_token', { path: '/' });
        res.clearCookie('zeus_uid', { path: '/' });

        db.auditLog(user.id, 'CLOSE_ACCOUNT_SUCCESS', { email: decoded.email }, req.ip);
        logger.info('AUTH', 'Account closed', { email: _mask(decoded.email) });
        res.json({ ok: true, message: 'Your account has been deleted. You will be redirected.' });
    } catch (err) {
        res.status(401).json({ error: 'Token invalid' });
    }
});

// ─── Export JWT_SECRET for middleware ───
router.JWT_SECRET = JWT_SECRET;

// ─── PIN Lock — Server-Side Per-User ───

// SET / CHANGE PIN
router.post('/pin/set', async (req, res) => {
    const token = req.cookies && req.cookies.zeus_token;
    if (!token) return res.status(401).json({ error: 'session_invalid' });
    try {
        const decoded = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });
        const user = db.findUserById(decoded.id);
        if (!user || user.status !== 'active') return res.status(401).json({ error: 'session_invalid' });
        const { pin, currentPin } = req.body;
        if (!pin || typeof pin !== 'string' || pin.length < 4 || pin.length > 8) {
            return res.status(400).json({ error: 'PIN must be 4–8 characters' });
        }
        // [BATCH3-S] If PIN already set, require currentPin re-entry before overwrite.
        const existingHash = db.getUserPin(user.id);
        if (existingHash) {
            if (!currentPin || typeof currentPin !== 'string') {
                return res.status(400).json({ error: 'current_pin_required' });
            }
            const validCurrent = await bcrypt.compare(currentPin, existingHash);
            if (!validCurrent) {
                db.auditLog(user.id, 'PIN_CHANGE_FAILED', { reason: 'wrong_current_pin' }, req.ip);
                return res.status(401).json({ error: 'invalid_current_pin' });
            }
        }
        const hash = await bcrypt.hash(pin, BCRYPT_ROUNDS);
        db.setUserPin(user.id, hash);
        db.auditLog(user.id, existingHash ? 'PIN_CHANGED' : 'PIN_SET', {}, req.ip);
        logger.info('AUTH', existingHash ? 'PIN changed' : 'PIN set', { email: _mask(user.email) });
        res.json({ ok: true });
    } catch (err) { res.status(401).json({ error: 'session_invalid' }); }
});

// VERIFY PIN (unlock)
router.post('/pin/verify', async (req, res) => {
    const token = req.cookies && req.cookies.zeus_token;
    if (!token) return res.status(401).json({ error: 'session_invalid' });
    try {
        const decoded = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });
        const user = db.findUserById(decoded.id);
        if (!user || user.status !== 'active') return res.status(401).json({ error: 'session_invalid' });

        // [M9] PIN rate limit per user — exponential backoff
        const now = Date.now();
        let pa = pinAttempts.get(user.id);
        if (pa && now < pa.resetAt && pa.count >= PIN_MAX) {
            const remainMs = pa.resetAt - now;
            return res.status(429).json({ error: 'pin_rate_limited', retryAfterMs: remainMs });
        }

        const storedHash = db.getUserPin(user.id);
        if (!storedHash) return res.status(400).json({ error: 'pin_not_set' }); // [SC-09]
        const { pin } = req.body;
        if (!pin || typeof pin !== 'string') return res.status(400).json({ error: 'invalid_pin' });
        const valid = await bcrypt.compare(pin, storedHash);
        if (valid) {
            pinAttempts.delete(user.id);
            res.json({ ok: true });
        } else {
            // [M9] Exponential backoff — bump lockout level each time PIN_MAX is reached.
            if (!pa || now > pa.resetAt) {
                const prevLvl = (pa && pa.lockoutLevel != null) ? pa.lockoutLevel : -1;
                const lvl = Math.min(prevLvl + 1, PIN_LOCKOUT_LEVELS.length - 1);
                pa = { count: 0, resetAt: now + PIN_LOCKOUT_LEVELS[lvl], lockoutLevel: lvl };
                pinAttempts.set(user.id, pa);
            }
            pa.count++;
            db.auditLog(user.id, 'PIN_VERIFY_FAILED', { attempts: pa.count, lockoutLevel: pa.lockoutLevel }, req.ip);
            res.status(401).json({ ok: false, error: 'invalid_pin' }); // [SC-09]
        }
    } catch (err) { res.status(401).json({ error: 'session_invalid' }); }
});

// REMOVE PIN
router.post('/pin/remove', async (req, res) => {
    const token = req.cookies && req.cookies.zeus_token;
    if (!token) return res.status(401).json({ error: 'session_invalid' });
    try {
        const decoded = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });
        const user = db.findUserById(decoded.id);
        if (!user || user.status !== 'active') return res.status(401).json({ error: 'session_invalid' });
        const storedHash = db.getUserPin(user.id);
        // Idempotent: if no PIN is set, consider it already removed.
        if (!storedHash) return res.json({ ok: true });
        // [BATCH3-S] Require current PIN re-entry before removal —
        // prevents shoulder-surfed sessions from disabling app lock silently.
        const { pin } = req.body || {};
        if (!pin || typeof pin !== 'string') {
            return res.status(400).json({ error: 'pin_required' });
        }
        const valid = await bcrypt.compare(pin, storedHash);
        if (!valid) {
            db.auditLog(user.id, 'PIN_REMOVE_FAILED', { reason: 'wrong_pin' }, req.ip);
            return res.status(401).json({ error: 'invalid_pin' });
        }
        db.clearUserPin(user.id);
        db.auditLog(user.id, 'PIN_REMOVED', {}, req.ip);
        logger.info('AUTH', 'PIN removed', { email: _mask(user.email) });
        res.json({ ok: true });
    } catch (err) { res.status(401).json({ error: 'session_invalid' }); }
});

// CHECK if PIN is set (lightweight, no PIN sent)
router.get('/pin/status', (req, res) => {
    const token = req.cookies && req.cookies.zeus_token;
    if (!token) return res.status(401).json({ error: 'session_invalid' });
    try {
        const decoded = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });
        const user = db.findUserById(decoded.id);
        if (!user || user.status !== 'active') return res.status(401).json({ error: 'session_invalid' });
        const storedHash = db.getUserPin(user.id);
        res.json({ pinSet: !!storedHash });
    } catch (err) { res.status(401).json({ error: 'session_invalid' }); }
});

module.exports = router;
