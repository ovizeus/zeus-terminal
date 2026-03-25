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
function _mask(email) { if (!email) return '?'; const [u, d] = email.split('@'); return u[0] + '***@' + (d || '?'); }

const router = express.Router();
if (!process.env.JWT_SECRET) {
    console.error('[AUTH] FATAL: JWT_SECRET is not set in .env — server cannot start safely');
    process.exit(1);
}
const JWT_SECRET = process.env.JWT_SECRET;
const JWT_EXPIRY = '30d'; // stay logged in 30 days
const BCRYPT_ROUNDS = 10;

// ─── 2FA Code Store (in-memory, codes expire after 5 min) ───
const pendingCodes = new Map(); // email → { code, role, userId, attempts, expiresAt }
const CODE_TTL = 5 * 60 * 1000; // 5 minutes
const MAX_ATTEMPTS = 5;

// ─── Login Rate Limit (per-IP) ───
const loginAttempts = new Map(); // ip → { count, resetAt }
const LOGIN_WINDOW = 15 * 60 * 1000; // 15 minutes
const LOGIN_MAX = 10; // max attempts per window

// ─── Verify-Code Rate Limit (per-IP) ───
const verifyAttempts = new Map(); // ip → { count, resetAt }
const VERIFY_WINDOW = 15 * 60 * 1000;
const VERIFY_MAX = 10;

// ─── PIN Rate Limit (per-user) ───
const pinAttempts = new Map(); // userId → { count, resetAt }
const PIN_WINDOW = 15 * 60 * 1000;
const PIN_MAX = 5;

// ─── Login Rate Limit (per-email) ───
const loginAttemptsEmail = new Map(); // email → { count, resetAt }
const LOGIN_EMAIL_MAX = 5;

// Periodic cleanup of expired codes and stale rate-limit entries (every 5 min)
setInterval(() => {
    const now = Date.now();
    for (const [k, v] of pendingCodes) { if (now > v.expiresAt) pendingCodes.delete(k); }
    for (const [k, v] of loginAttempts) { if (now > v.resetAt) loginAttempts.delete(k); }
    for (const [k, v] of loginAttemptsEmail) { if (now > v.resetAt) loginAttemptsEmail.delete(k); }
    for (const [k, v] of verifyAttempts) { if (now > v.resetAt) verifyAttempts.delete(k); }
    for (const [k, v] of pinAttempts) { if (now > v.resetAt) pinAttempts.delete(k); }
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
    if (!pw || pw.length < 12) return 'Parola trebuie să aibă minim 12 caractere';
    if (pw.length > 128) return 'Parola nu poate depăși 128 de caractere';
    if (!/[a-z]/.test(pw)) return 'Parola trebuie să conțină cel puțin o literă mică';
    if (!/[A-Z]/.test(pw)) return 'Parola trebuie să conțină cel puțin o literă mare';
    if (!/\d/.test(pw)) return 'Parola trebuie să conțină cel puțin o cifră';
    return null;
}

async function _sendCode(email, code) {
    const mailer = _getMailer();
    if (!mailer) {
        // SMTP not configured — code NOT logged for security
        console.warn('[AUTH-2FA] SMTP not configured — cannot send code');
        return false;
    }
    try {
        await mailer.sendMail({
            from: process.env.SMTP_FROM || process.env.SMTP_USER,
            to: email,
            subject: '🔐 Zeus Terminal — Cod de verificare',
            text: `Codul tău de verificare: ${code}\n\nAcest cod expiră în 5 minute.\nDacă nu ai solicitat acest cod, ignoră acest email.`,
            html: `
                <div style="font-family:sans-serif;background:#0a0f16;color:#e0e0e0;padding:30px;border-radius:12px;max-width:400px;margin:0 auto">
                    <h2 style="color:#00afff;margin:0 0 16px">⚡ Zeus Terminal</h2>
                    <p style="margin:0 0 20px;color:#999">Cod de verificare login:</p>
                    <div style="background:#111a28;border:1px solid #00afff44;border-radius:8px;padding:20px;text-align:center;font-size:32px;letter-spacing:8px;font-weight:700;color:#00ff88">${code}</div>
                    <p style="margin:16px 0 0;color:#556;font-size:12px">Codul expiră în 5 minute.</p>
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

function _checkLoginRate(ip) {
    const now = Date.now();
    const entry = loginAttempts.get(ip);
    if (!entry || now > entry.resetAt) {
        loginAttempts.set(ip, { count: 1, resetAt: now + LOGIN_WINDOW });
        return true;
    }
    entry.count++;
    return entry.count <= LOGIN_MAX;
}

function _checkLoginRateEmail(email) {
    const now = Date.now();
    const entry = loginAttemptsEmail.get(email);
    if (!entry || now > entry.resetAt) {
        loginAttemptsEmail.set(email, { count: 1, resetAt: now + LOGIN_WINDOW });
        return true;
    }
    entry.count++;
    return entry.count <= LOGIN_EMAIL_MAX;
}

function _setAuthCookie(res, token) {
    res.cookie('zeus_token', token, {
        httpOnly: true,
        secure: true,       // HTTPS only (Cloudflare handles this)
        sameSite: 'lax',
        maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
        path: '/'
    });
}

// ─── POST /auth/register ───
router.post('/register', async (req, res) => {
    if (!_checkLoginRate(req.ip)) return res.status(429).json({ error: 'Prea multe cereri. Încearcă peste câteva minute.' });
    try {
        const { email, password } = req.body;
        if (!email || !password) {
            return res.status(400).json({ error: 'Email și parola sunt obligatorii' });
        }

        const normalEmail = email.toLowerCase().trim();

        // Validate email format
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalEmail)) {
            return res.status(400).json({ error: 'Email invalid' });
        }

        // [S3B3] Uniform password policy
        var _pwErr = _validatePassword(password);
        if (_pwErr) {
            return res.status(400).json({ error: _pwErr });
        }

        // Check if user exists — generic response to prevent email enumeration
        if (db.findUserByEmail(normalEmail)) {
            return res.json({ ok: true, pending: true, message: 'Contul a fost creat. Așteaptă aprobarea administratorului.' });
        }

        // Limit max users (security — prevent mass registration)
        const MAX_USERS = parseInt(process.env.MAX_USERS, 10) || 10;
        const currentCount = db.countUsers();
        if (currentCount >= MAX_USERS) {
            return res.status(403).json({ error: 'Numărul maxim de conturi a fost atins' });
        }

        // First user = admin (auto-approved), rest need approval
        const isFirst = currentCount === 0;
        const hash = await bcrypt.hash(password, BCRYPT_ROUNDS);
        const role = isFirst ? 'admin' : 'user';
        const userId = db.createUser(normalEmail, hash, role, isFirst);
        db.addPasswordHistory(userId, hash);

        db.auditLog(userId, 'USER_REGISTERED', { role, autoApproved: isFirst }, req.ip);

        if (isFirst) {
            // Admin auto-login (JWT includes id + tokenVersion for session invalidation)
            const token = jwt.sign({ id: userId, email: normalEmail, role: 'admin', tokenVersion: 1 }, JWT_SECRET, { expiresIn: JWT_EXPIRY });
            _setAuthCookie(res, token);
            logger.info('AUTH', 'Admin registered', { email: _mask(normalEmail) });
            return res.json({ ok: true, email: normalEmail, role: 'admin' });
        }

        // Non-admin: registered but pending approval
        logger.info('AUTH', 'User registered (pending)', { email: _mask(normalEmail) });
        res.json({ ok: true, pending: true, message: 'Contul a fost creat. Așteaptă aprobarea administratorului.' });
    } catch (err) {
        logger.error('AUTH', 'Register error', { error: err.message });
        res.status(500).json({ error: 'Eroare internă' });
    }
});

// ─── POST /auth/login — Step 1: verify password, send 2FA code ───
router.post('/login', async (req, res) => {
    try {
        // Rate limit by IP
        if (!_checkLoginRate(req.ip)) {
            return res.status(429).json({ error: 'Prea multe încercări de login. Așteaptă 15 minute.' });
        }

        const { email, password } = req.body;
        if (!email || !password) {
            return res.status(400).json({ error: 'Email și parola sunt obligatorii' });
        }

        const normalEmail = email.toLowerCase().trim();
        const user = db.findUserByEmail(normalEmail);

        if (!user) {
            return res.status(401).json({ error: 'Email sau parolă incorectă' });
        }

        // Check account status (blocked?)
        if (user.status === 'blocked') {
            return res.status(403).json({ error: 'Contul tău a fost blocat.' });
        }

        // Check ban
        if (user.status === 'banned' && user.banned_until) {
            const banEnd = new Date(user.banned_until);
            if (banEnd > new Date()) {
                const remaining = banEnd.getFullYear() >= 9999 ? 'permanent' : banEnd.toLocaleString('ro-RO');
                return res.status(403).json({ error: 'Contul tău este suspendat până la: ' + remaining });
            }
            // Ban expired — auto-unban
            db.unbanUser(user.id);
        }

        // Per-email rate limit (prevents targeted brute-force on known accounts)
        if (!_checkLoginRateEmail(normalEmail)) {
            return res.status(429).json({ error: 'Prea multe încercări pentru acest cont. Așteaptă 15 minute.' });
        }

        const valid = await bcrypt.compare(password, user.password_hash);
        if (!valid) {
            db.auditLog(user.id, 'LOGIN_FAILED', { reason: 'wrong_password' }, req.ip);
            return res.status(401).json({ error: 'Email sau parolă incorectă' });
        }

        // Check approval
        if (!user.approved) {
            return res.status(403).json({ error: 'Contul tău nu a fost încă aprobat de administrator.' });
        }

        // Generate and send 2FA code
        const code = _generateCode();
        pendingCodes.set(normalEmail, {
            code,
            role: user.role || 'user',
            userId: user.id,
            attempts: 0,
            expiresAt: Date.now() + CODE_TTL
        });

        const sent = await _sendCode(normalEmail, code);
        if (!sent) {
            // SMTP failed — do NOT bypass 2FA, return error
            pendingCodes.delete(normalEmail);
            logger.error('AUTH', 'SMTP failed, login blocked', { email: _mask(normalEmail) });
            return res.status(503).json({ error: 'Email service unavailable. Cannot send 2FA code. Try again later.' });
        }

        logger.info('AUTH', '2FA code sent for login', { email: _mask(normalEmail) });
        res.json({ ok: true, needsCode: true, message: 'Cod de verificare trimis pe email.' });
    } catch (err) {
        console.error('[AUTH] Login error:', err.message);
        res.status(500).json({ error: 'Eroare internă' });
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
            return res.status(400).json({ error: 'Email și codul sunt obligatorii' });
        }

        const normalEmail = email.toLowerCase().trim();
        const pending = pendingCodes.get(normalEmail);

        if (!pending) {
            return res.status(400).json({ error: 'Nu există un cod activ. Loghează-te din nou.' });
        }

        // Check expiration
        if (Date.now() > pending.expiresAt) {
            pendingCodes.delete(normalEmail);
            return res.status(400).json({ error: 'Codul a expirat. Loghează-te din nou.' });
        }

        // Check attempts
        pending.attempts++;
        if (pending.attempts > MAX_ATTEMPTS) {
            pendingCodes.delete(normalEmail);
            return res.status(429).json({ error: 'Prea multe încercări. Loghează-te din nou.' });
        }

        // Verify code (constant-time comparison)
        const codeStr = String(code).trim();
        if (codeStr.length !== 6 || !crypto.timingSafeEqual(Buffer.from(codeStr), Buffer.from(pending.code))) {
            return res.status(401).json({ error: 'Cod incorect. Mai ai ' + (MAX_ATTEMPTS - pending.attempts) + ' încercări.' });
        }

        // Success — clear code and set JWT (includes user id + tokenVersion)
        pendingCodes.delete(normalEmail);
        const freshUser = db.findUserById(pending.userId);
        const token = jwt.sign({ id: pending.userId, email: normalEmail, role: pending.role, tokenVersion: freshUser ? freshUser.token_version : 1 }, JWT_SECRET, { expiresIn: JWT_EXPIRY });
        _setAuthCookie(res, token);

        db.auditLog(pending.userId, 'LOGIN_SUCCESS', {}, req.ip);
        logger.info('AUTH', 'Login verified', { email: _mask(normalEmail), role: pending.role });
        res.json({ ok: true, email: normalEmail, role: pending.role });
    } catch (err) {
        console.error('[AUTH] Verify-code error:', err.message);
        res.status(500).json({ error: 'Eroare internă' });
    }
});

// ─── POST /auth/logout ───
router.post('/logout', (req, res) => {
    res.clearCookie('zeus_token', { path: '/' });
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

        res.json({ ok: true, id: userId, email: decoded.email, role: decoded.role || 'user' });
    } catch (err) {
        res.clearCookie('zeus_token', { path: '/' });
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
        if (decoded.tokenVersion !== undefined && caller.token_version !== decoded.tokenVersion) {
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
        if (decoded.tokenVersion !== undefined && caller.token_version !== decoded.tokenVersion) {
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
        if (decoded.tokenVersion !== undefined && caller.token_version !== decoded.tokenVersion) {
            return res.status(401).json({ error: 'Session expired' });
        }

        const { email } = req.body;
        if (!email) return res.status(400).json({ error: 'Email required' });

        const normalEmail = email.toLowerCase().trim();
        // Can't delete yourself
        if (normalEmail === decoded.email) {
            return res.status(400).json({ error: 'Nu te poți șterge pe tine' });
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
        if (decoded.tokenVersion !== undefined && caller.token_version !== decoded.tokenVersion) return res.status(401).json({ error: 'Session expired' });
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
        if (decoded.tokenVersion !== undefined && caller.token_version !== decoded.tokenVersion) return res.status(401).json({ error: 'Session expired' });
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
        if (decoded.tokenVersion !== undefined && caller.token_version !== decoded.tokenVersion) return res.status(401).json({ error: 'Session expired' });
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
        if (decoded.tokenVersion !== undefined && caller.token_version !== decoded.tokenVersion) return res.status(401).json({ error: 'Session expired' });

        const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
        const rows = db.listAuditLog(limit);
        res.json({ ok: true, entries: rows });
    } catch (err) { res.status(401).json({ error: 'Token invalid' }); }
});

// ─── CHANGE PASSWORD: Step 1 — request code ───
router.post('/change-password/request', async (req, res) => {
    if (!_checkLoginRate(req.ip)) return res.status(429).json({ error: 'Prea multe cereri. Încearcă peste câteva minute.' });
    const token = req.cookies && req.cookies.zeus_token;
    if (!token) return res.status(401).json({ error: 'Not authenticated' });
    try {
        const decoded = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });
        const user = db.findUserByEmail(decoded.email);
        if (!user) return res.status(404).json({ error: 'User not found' });

        const { currentPassword } = req.body;
        if (!currentPassword) return res.status(400).json({ error: 'Parola curentă este necesară' });

        const valid = await bcrypt.compare(currentPassword, user.password_hash);
        if (!valid) {
            db.auditLog(user.id, 'CHANGE_PASSWORD_FAILED', { reason: 'wrong_current_password' }, req.ip);
            return res.status(401).json({ error: 'Parola curentă este incorectă' });
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
            return res.status(503).json({ error: 'Nu s-a putut trimite codul. Încearcă mai târziu.' });
        }

        db.auditLog(user.id, 'CHANGE_PASSWORD_REQUESTED', {}, req.ip);
        res.json({ ok: true, message: 'Cod trimis pe email' });
    } catch (err) {
        res.status(401).json({ error: 'Token invalid' });
    }
});

// ─── CHANGE PASSWORD: Step 2 — verify code & update ───
router.post('/change-password/confirm', async (req, res) => {
    if (!_checkLoginRate(req.ip)) return res.status(429).json({ error: 'Prea multe cereri. Încearcă peste câteva minute.' });
    const token = req.cookies && req.cookies.zeus_token;
    if (!token) return res.status(401).json({ error: 'Not authenticated' });
    try {
        const decoded = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });
        const user = db.findUserByEmail(decoded.email);
        if (!user) return res.status(404).json({ error: 'User not found' });

        const { code, newPassword } = req.body;
        if (!code || !newPassword) return res.status(400).json({ error: 'Cod și parola nouă sunt necesare' });
        var _pwErr2 = _validatePassword(newPassword);
        if (_pwErr2) return res.status(400).json({ error: _pwErr2 });

        const key = 'chpw_' + decoded.email;
        const pending = pendingCodes.get(key);
        if (!pending) return res.status(400).json({ error: 'Niciun cod activ. Solicită unul nou.' });

        if (Date.now() > pending.expiresAt) {
            pendingCodes.delete(key);
            return res.status(400).json({ error: 'Codul a expirat. Solicită unul nou.' });
        }

        pending.attempts++;
        if (pending.attempts > 5) {
            pendingCodes.delete(key);
            return res.status(429).json({ error: 'Prea multe încercări. Solicită un cod nou.' });
        }

        if (String(code).length !== 6 || !crypto.timingSafeEqual(Buffer.from(String(code)), Buffer.from(String(pending.code)))) {
            return res.status(400).json({ error: 'Cod incorect. Mai ai ' + (5 - pending.attempts) + ' încercări.' });
        }

        // Code valid — check password history (last 5)
        const newHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
        const history = db.getPasswordHistory(user.id);
        for (const oldHash of history) {
            if (await bcrypt.compare(newPassword, oldHash)) {
                return res.status(400).json({ error: 'Nu poți refolosi una din ultimele 5 parole.' });
            }
        }

        // Update password + record in history + invalidate old sessions
        db.updatePassword(user.id, newHash);
        db.addPasswordHistory(user.id, newHash);
        db.bumpTokenVersion(user.id);
        pendingCodes.delete(key);

        // Re-issue JWT with new tokenVersion so current session stays valid
        const freshUser = db.findUserById(user.id);
        const newToken = jwt.sign(
            { id: user.id, email: decoded.email, role: decoded.role, tokenVersion: freshUser.token_version },
            JWT_SECRET, { expiresIn: JWT_EXPIRY }
        );
        _setAuthCookie(res, newToken);

        db.auditLog(user.id, 'CHANGE_PASSWORD_SUCCESS', {}, req.ip);
        logger.info('AUTH', 'Password changed', { email: _mask(decoded.email) });
        res.json({ ok: true, message: 'Parola a fost schimbată cu succes!' });
    } catch (err) {
        res.status(401).json({ error: 'Token invalid' });
    }
});

// ─── CHANGE EMAIL: Step 1 — request code ───
router.post('/change-email/request', async (req, res) => {
    if (!_checkLoginRate(req.ip)) return res.status(429).json({ error: 'Prea multe cereri. Încearcă peste câteva minute.' });
    const token = req.cookies && req.cookies.zeus_token;
    if (!token) return res.status(401).json({ error: 'Not authenticated' });
    try {
        const decoded = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });
        const user = db.findUserByEmail(decoded.email);
        if (!user) return res.status(404).json({ error: 'User not found' });

        const { currentPassword, newEmail } = req.body;
        if (!currentPassword) return res.status(400).json({ error: 'Parola curentă este necesară' });
        if (!newEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail)) {
            return res.status(400).json({ error: 'Adresă de email invalidă' });
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
            return res.status(401).json({ error: 'Parola curentă este incorectă' });
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
            return res.status(503).json({ error: 'Nu s-a putut trimite codul. Încearcă mai târziu.' });
        }

        db.auditLog(user.id, 'CHANGE_EMAIL_REQUESTED', { newEmail: normalised }, req.ip);
        res.json({ ok: true, message: 'Cod trimis pe noul email' });
    } catch (err) {
        res.status(401).json({ error: 'Token invalid' });
    }
});

// ─── CHANGE EMAIL: Step 2 — verify code & update ───
router.post('/change-email/confirm', async (req, res) => {
    if (!_checkLoginRate(req.ip)) return res.status(429).json({ error: 'Prea multe cereri. Încearcă peste câteva minute.' });
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
        if (!pending) return res.status(400).json({ error: 'Niciun cod activ. Solicită unul nou.' });

        if (Date.now() > pending.expiresAt) {
            pendingCodes.delete(key);
            return res.status(400).json({ error: 'Codul a expirat. Solicită unul nou.' });
        }

        pending.attempts++;
        if (pending.attempts > 5) {
            pendingCodes.delete(key);
            return res.status(429).json({ error: 'Prea multe încercări. Solicită un cod nou.' });
        }

        if (String(code).length !== 6 || !crypto.timingSafeEqual(Buffer.from(String(code)), Buffer.from(String(pending.code)))) {
            return res.status(400).json({ error: 'Cod incorect. Mai ai ' + (5 - pending.attempts) + ' încercări.' });
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
            { expiresIn: '30d' }
        );
        _setAuthCookie(res, newToken);

        // Notify old email about the change
        const _oldMailer = _getMailer();
        if (_oldMailer) {
            _oldMailer.sendMail({
                from: process.env.SMTP_FROM || process.env.SMTP_USER,
                to: decoded.email,
                subject: '⚠️ Zeus Terminal — Adresa de email a fost schimbată',
                text: 'Adresa de email asociată contului tău Zeus Terminal a fost schimbată.\nDacă nu ai solicitat această schimbare, contactează imediat administratorul.',
                html: '<div style="font-family:sans-serif;background:#0a0f16;color:#e0e0e0;padding:30px;border-radius:12px;max-width:400px;margin:0 auto"><h2 style="color:#ff6600;margin:0 0 16px">⚠️ Zeus Terminal</h2><p>Adresa de email asociată contului tău a fost schimbată.</p><p style="margin:16px 0 0;color:#ff4444;font-size:13px">Dacă nu ai solicitat această schimbare, contactează imediat administratorul.</p></div>'
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
    if (!_checkLoginRate(req.ip)) return res.status(429).json({ error: 'Prea multe cereri. Încearcă peste câteva minute.' });
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Emailul este necesar' });

    const user = db.findUserByEmail(email);
    // Always return success (don't reveal if email exists)
    if (!user) return res.json({ ok: true, message: 'Dacă emailul există, vei primi un cod.' });

    if (user.status === 'banned' || (user.banned_until && new Date(user.banned_until) > new Date())) {
        return res.json({ ok: true, message: 'Dacă emailul există, vei primi un cod.' });
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
        return res.status(503).json({ error: 'Nu s-a putut trimite codul. Încearcă mai târziu.' });
    }

    db.auditLog(user.id, 'FORGOT_PASSWORD_REQUESTED', {}, req.ip);
    logger.info('AUTH', 'Forgot password code sent', { email: _mask(email) });
    res.json({ ok: true, message: 'Dacă emailul există, vei primi un cod.' });
});

// ─── FORGOT PASSWORD: Step 2 — verify code & set new password ───
router.post('/forgot-password/confirm', async (req, res) => {
    if (!_checkLoginRate(req.ip)) return res.status(429).json({ error: 'Prea multe cereri. Încearcă peste câteva minute.' });
    const { email, code, newPassword } = req.body;
    if (!email || !code || !newPassword) return res.status(400).json({ error: 'Email, cod și parola nouă sunt necesare' });
    var _pwErr3 = _validatePassword(newPassword);
    if (_pwErr3) return res.status(400).json({ error: _pwErr3 });

    const key = 'fgpw_' + email.toLowerCase().trim();
    const pending = pendingCodes.get(key);
    if (!pending) return res.status(400).json({ error: 'Niciun cod activ. Solicită unul nou.' });

    if (Date.now() > pending.expiresAt) {
        pendingCodes.delete(key);
        return res.status(400).json({ error: 'Codul a expirat. Solicită unul nou.' });
    }

    pending.attempts++;
    if (pending.attempts > MAX_ATTEMPTS) {
        pendingCodes.delete(key);
        return res.status(429).json({ error: 'Prea multe încercări. Solicită un cod nou.' });
    }

    if (String(code).length !== 6 || !crypto.timingSafeEqual(Buffer.from(String(code)), Buffer.from(String(pending.code)))) {
        return res.status(400).json({ error: 'Cod incorect. Mai ai ' + (MAX_ATTEMPTS - pending.attempts) + ' încercări.' });
    }

    const newHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
    const history = db.getPasswordHistory(pending.userId);
    for (const oldHash of history) {
        if (await bcrypt.compare(newPassword, oldHash)) {
            return res.status(400).json({ error: 'Nu poți refolosi una din ultimele 5 parole.' });
        }
    }

    db.updatePassword(pending.userId, newHash);
    db.addPasswordHistory(pending.userId, newHash);
    db.bumpTokenVersion(pending.userId);
    pendingCodes.delete(key);

    db.auditLog(pending.userId, 'FORGOT_PASSWORD_SUCCESS', {}, req.ip);
    logger.info('AUTH', 'Password reset via forgot-password', { email: _mask(email) });
    res.json({ ok: true, message: 'Parola a fost resetată cu succes! Te poți autentifica.' });
});

// ─── CLOSE ACCOUNT: Step 1 — request code ───
router.post('/close-account/request', async (req, res) => {
    if (!_checkLoginRate(req.ip)) return res.status(429).json({ error: 'Prea multe cereri. Încearcă peste câteva minute.' });
    const token = req.cookies && req.cookies.zeus_token;
    if (!token) return res.status(401).json({ error: 'Not authenticated' });
    try {
        const decoded = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });
        const user = db.findUserByEmail(decoded.email);
        if (!user) return res.status(404).json({ error: 'User not found' });

        const { currentPassword } = req.body;
        if (!currentPassword) return res.status(400).json({ error: 'Parola curentă este necesară' });

        const valid = await bcrypt.compare(currentPassword, user.password_hash);
        if (!valid) {
            db.auditLog(user.id, 'CLOSE_ACCOUNT_FAILED', { reason: 'wrong_password' }, req.ip);
            return res.status(401).json({ error: 'Parola curentă este incorectă' });
        }

        if (user.role === 'admin') {
            return res.status(403).json({ error: 'Contul de administrator nu poate fi șters.' });
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
            return res.status(503).json({ error: 'Nu s-a putut trimite codul. Încearcă mai târziu.' });
        }

        db.auditLog(user.id, 'CLOSE_ACCOUNT_REQUESTED', {}, req.ip);
        res.json({ ok: true, message: 'Cod trimis pe email' });
    } catch (err) {
        res.status(401).json({ error: 'Token invalid' });
    }
});

// ─── CLOSE ACCOUNT: Step 2 — verify code & delete ───
router.post('/close-account/confirm', async (req, res) => {
    if (!_checkLoginRate(req.ip)) return res.status(429).json({ error: 'Prea multe cereri. Încearcă peste câteva minute.' });
    const token = req.cookies && req.cookies.zeus_token;
    if (!token) return res.status(401).json({ error: 'Not authenticated' });
    try {
        const decoded = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });
        const user = db.findUserByEmail(decoded.email);
        if (!user) return res.status(404).json({ error: 'User not found' });

        if (user.role === 'admin') {
            return res.status(403).json({ error: 'Contul de administrator nu poate fi șters.' });
        }

        const { code } = req.body;
        if (!code) return res.status(400).json({ error: 'Codul este necesar' });

        const key = 'clac_' + decoded.email;
        const pending = pendingCodes.get(key);
        if (!pending) return res.status(400).json({ error: 'Niciun cod activ. Solicită unul nou.' });

        if (Date.now() > pending.expiresAt) {
            pendingCodes.delete(key);
            return res.status(400).json({ error: 'Codul a expirat. Solicită unul nou.' });
        }

        pending.attempts++;
        if (pending.attempts > MAX_ATTEMPTS) {
            pendingCodes.delete(key);
            return res.status(429).json({ error: 'Prea multe încercări. Solicită un cod nou.' });
        }

        if (String(code).length !== 6 || !crypto.timingSafeEqual(Buffer.from(String(code)), Buffer.from(String(pending.code)))) {
            return res.status(400).json({ error: 'Cod incorect. Mai ai ' + (MAX_ATTEMPTS - pending.attempts) + ' încercări.' });
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

        db.auditLog(user.id, 'CLOSE_ACCOUNT_SUCCESS', { email: decoded.email }, req.ip);
        logger.info('AUTH', 'Account closed', { email: _mask(decoded.email) });
        res.json({ ok: true, message: 'Contul a fost șters. Vei fi redirecționat.' });
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
        const { pin } = req.body;
        if (!pin || typeof pin !== 'string' || pin.length < 4 || pin.length > 8) {
            return res.status(400).json({ error: 'PIN trebuie să aibă 4–8 caractere' });
        }
        const hash = await bcrypt.hash(pin, BCRYPT_ROUNDS);
        db.setUserPin(user.id, hash);
        db.auditLog(user.id, 'PIN_SET', {}, req.ip);
        logger.info('AUTH', 'PIN set', { email: _mask(user.email) });
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

        // PIN rate limit per user
        const now = Date.now();
        let pa = pinAttempts.get(user.id);
        if (pa && now < pa.resetAt && pa.count >= PIN_MAX) {
            return res.status(429).json({ error: 'pin_rate_limited' });
        }

        const storedHash = db.getUserPin(user.id);
        if (!storedHash) return res.status(200).json({ error: 'pin_not_set' });
        const { pin } = req.body;
        if (!pin || typeof pin !== 'string') return res.status(400).json({ error: 'invalid_pin' });
        const valid = await bcrypt.compare(pin, storedHash);
        if (valid) {
            pinAttempts.delete(user.id);
            res.json({ ok: true });
        } else {
            if (!pa || now > pa.resetAt) { pa = { count: 0, resetAt: now + PIN_WINDOW }; pinAttempts.set(user.id, pa); }
            pa.count++;
            db.auditLog(user.id, 'PIN_VERIFY_FAILED', { attempts: pa.count }, req.ip);
            res.json({ ok: false, error: 'invalid_pin' });
        }
    } catch (err) { res.status(401).json({ error: 'session_invalid' }); }
});

// REMOVE PIN
router.post('/pin/remove', (req, res) => {
    const token = req.cookies && req.cookies.zeus_token;
    if (!token) return res.status(401).json({ error: 'session_invalid' });
    try {
        const decoded = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });
        const user = db.findUserById(decoded.id);
        if (!user || user.status !== 'active') return res.status(401).json({ error: 'session_invalid' });
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
