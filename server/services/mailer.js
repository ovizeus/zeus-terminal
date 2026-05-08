// Zeus Terminal — Shared mailer service
// [OPS-9] Critical alert email fallback when Telegram channel fails.
// Singleton SMTP transport reused across modules. Reads SMTP_* env (same
// vars consumed by routes/auth.js for 2FA codes — no duplication of
// credentials, just shared transport).
'use strict';

const nodemailer = require('nodemailer');

let _transport = null;

function _getTransport() {
    if (_transport) return _transport;
    const host = process.env.SMTP_HOST;
    const port = parseInt(process.env.SMTP_PORT, 10) || 587;
    const user = process.env.SMTP_USER;
    const pass = process.env.SMTP_PASS;
    if (!host || !user || !pass) return null;
    _transport = nodemailer.createTransport({
        host, port,
        secure: port === 465,
        auth: { user, pass },
    });
    return _transport;
}

// Send a critical operations alert email to all admin users. Best-effort —
// logs failures but never throws. Returns count of emails dispatched.
async function sendCriticalEmail(subject, body) {
    try {
        const transport = _getTransport();
        if (!transport) return 0;
        const db = require('./database');
        const admins = (db.listUsers() || []).filter(u => u && u.role === 'admin' && u.email);
        if (admins.length === 0) return 0;
        const from = process.env.SMTP_USER;
        let sent = 0;
        for (const a of admins) {
            try {
                await transport.sendMail({
                    from,
                    to: a.email,
                    subject: `[Zeus alert] ${subject}`,
                    text: body,
                });
                sent++;
            } catch (e) {
                console.warn('[MAILER] sendCriticalEmail failed to ' + a.email + ':', e.message);
            }
        }
        return sent;
    } catch (err) {
        console.warn('[MAILER] sendCriticalEmail crashed:', err && err.message);
        return 0;
    }
}

module.exports = { sendCriticalEmail };
