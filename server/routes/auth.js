// Zeus Terminal — Authentication Routes
// Uses SQLite via database.js for all user storage
'use strict';

const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');
const crypto = require('crypto');
const db = require('../services/database');

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(32).toString('hex');
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

async function _sendCode(email, code) {
    const mailer = _getMailer();
    if (!mailer) {
        // Fallback: log to console (for testing without SMTP)
        console.log(`[AUTH-2FA] Code for ${email}: ${code} (SMTP not configured)`);
        return true;
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
        console.log(`[AUTH-2FA] Code sent to ${email}`);
        return true;
    } catch (err) {
        console.error(`[AUTH-2FA] Failed to send code to ${email}:`, err.message);
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

        if (password.length < 6) {
            return res.status(400).json({ error: 'Parola trebuie să aibă minim 6 caractere' });
        }

        // Check if user exists
        if (db.findUserByEmail(normalEmail)) {
            return res.status(409).json({ error: 'Acest email este deja înregistrat' });
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

        db.auditLog(userId, 'USER_REGISTERED', { role, autoApproved: isFirst }, req.ip);

        if (isFirst) {
            // Admin auto-login (JWT includes id)
            const token = jwt.sign({ id: userId, email: normalEmail, role: 'admin' }, JWT_SECRET, { expiresIn: JWT_EXPIRY });
            _setAuthCookie(res, token);
            console.log(`[AUTH] Admin registered: ${normalEmail}`);
            return res.json({ ok: true, email: normalEmail, role: 'admin' });
        }

        // Non-admin: registered but pending approval
        console.log(`[AUTH] User registered (pending approval): ${normalEmail}`);
        res.json({ ok: true, pending: true, message: 'Contul a fost creat. Așteaptă aprobarea administratorului.' });
    } catch (err) {
        console.error('[AUTH] Register error:', err.message);
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
            return res.status(500).json({ error: 'Nu am putut trimite codul. Încearcă din nou.' });
        }

        console.log(`[AUTH] 2FA code sent to: ${normalEmail}`);
        res.json({ ok: true, needsCode: true, message: 'Cod de verificare trimis pe email.' });
    } catch (err) {
        console.error('[AUTH] Login error:', err.message);
        res.status(500).json({ error: 'Eroare internă' });
    }
});

// ─── POST /auth/verify-code — Step 2: verify 2FA code, set cookie ───
router.post('/verify-code', (req, res) => {
    try {
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

        // Success — clear code and set JWT (includes user id)
        pendingCodes.delete(normalEmail);
        const token = jwt.sign({ id: pending.userId, email: normalEmail, role: pending.role }, JWT_SECRET, { expiresIn: JWT_EXPIRY });
        _setAuthCookie(res, token);

        db.auditLog(pending.userId, 'LOGIN_SUCCESS', {}, req.ip);
        console.log(`[AUTH] Login verified: ${normalEmail} (${pending.role})`);
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
        const decoded = jwt.verify(token, JWT_SECRET);

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
        const decoded = jwt.verify(token, JWT_SECRET);
        const caller = db.findUserByEmail(decoded.email);
        if (!caller || caller.role !== 'admin') {
            return res.status(403).json({ error: 'Admin only' });
        }

        const users = db.listUsers().map(u => ({
            email: u.email,
            role: u.role || 'user',
            approved: !!u.approved,
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
        const decoded = jwt.verify(token, JWT_SECRET);
        const caller = db.findUserByEmail(decoded.email);
        if (!caller || caller.role !== 'admin') {
            return res.status(403).json({ error: 'Admin only' });
        }

        const { email } = req.body;
        if (!email) return res.status(400).json({ error: 'Email required' });

        const normalEmail = email.toLowerCase().trim();
        const user = db.findUserByEmail(normalEmail);
        if (!user) return res.status(404).json({ error: 'User not found' });

        db.approveUser(normalEmail);
        db.auditLog(caller.id, 'ADMIN_APPROVE_USER', { targetEmail: normalEmail }, req.ip);
        console.log(`[AUTH] Admin approved user: ${normalEmail}`);
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
        const decoded = jwt.verify(token, JWT_SECRET);
        const caller = db.findUserByEmail(decoded.email);
        if (!caller || caller.role !== 'admin') {
            return res.status(403).json({ error: 'Admin only' });
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
        console.log(`[AUTH] Admin deleted user: ${normalEmail}`);
        res.json({ ok: true });
    } catch (err) {
        res.status(401).json({ error: 'Token invalid' });
    }
});

// ─── Export JWT_SECRET for middleware ───
router.JWT_SECRET = JWT_SECRET;

module.exports = router;
