'use strict';
// ═══════════════════════════════════════════════════════════════════════════
// EMAILURILE DE CONT — cererea a fost primita / accesul a fost aprobat
// ═══════════════════════════════════════════════════════════════════════════
// [2026-11-13] Cerut de operator: cine cere un cont trebuie sa afle ca cererea
// a ajuns si ca se aproba MANUAL, apoi sa afle cand a fost aprobat. Pana acum
// omul se inregistra si nu mai auzea nimic.
//
// Reguli:
//   - trimiterea NU blocheaza nimic: inregistrarea si aprobarea reusesc si daca
//     emailul nu pleaca; esecul ramane in jurnal;
//   - niciun termen promis (nici „in 24h", nici o data de lansare);
//   - doar adresa destinatarului — nimic despre alti utilizatori;
//   - fara email la respingere (hotarat de operator);
//   - text in ENGLEZA (R-P-10), semnat „Zeus Terminal team".

const logger = require('./logger');

const TEAM = 'Zeus Terminal team';
const OPEN_NOW = 'the chart, indicators, market data and the liquidation map';

function appUrl() {
    const raw = String(process.env.APP_PUBLIC_URL || 'https://zeus-terminal.com').trim().replace(/\/+$/, '');
    return /^https:\/\/[a-z0-9.-]+(:\d+)?$/i.test(raw) ? raw : 'https://zeus-terminal.com';
}

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function _html(title, paragraphs, button) {
    const p = paragraphs.map((t) => `<p style="margin:0 0 14px;color:#c4cfda;font-size:14px;line-height:1.6">${t}</p>`).join('');
    const b = button
        ? `<p style="margin:22px 0 8px"><a href="${esc(button.href)}" style="display:inline-block;background:#f0c040;color:#0a0f14;text-decoration:none;font-weight:700;padding:11px 22px;border-radius:6px;font-size:14px">${esc(button.label)}</a></p>`
        : '';
    return `<div style="font-family:Arial,Helvetica,sans-serif;background:#0a0f16;padding:28px 24px;border-radius:12px;max-width:460px;margin:0 auto">
<h2 style="color:#f0c040;margin:0 0 6px;font-size:18px">Zeus Terminal</h2>
<h3 style="color:#eaf2f8;margin:0 0 18px;font-size:16px;font-weight:600">${esc(title)}</h3>
${p}${b}
<p style="margin:22px 0 0;color:#7f93a6;font-size:13px">${esc(TEAM)}</p>
</div>`;
}

/** Functie pura: emailul de „am primit cererea". */
function registrationEmail(email) {
    const to = String(email);
    const lines = [
        `We received your request for a Zeus Terminal account (${to}).`,
        'Access is approved manually by our team, so it is not instant. You will get a second email as soon as your account is approved — there is nothing else you need to do.',
        `Zeus Terminal is currently in beta. Once approved, you will have ${OPEN_NOW}. Trading features open at public launch.`,
        'If you did not request this account, you can ignore this email.',
    ];
    return {
        subject: 'Zeus Terminal — we received your request',
        text: lines.join('\n\n') + `\n\n${TEAM}`,
        html: _html('We received your request', lines.map(esc)),
    };
}

/** Functie pura: emailul de „accesul a fost aprobat". */
function approvalEmail(email) {
    const to = String(email);
    const url = appUrl() + '/login.html';
    const lines = [
        `Your Zeus Terminal account (${to}) has been approved. You can sign in now.`,
        `Zeus Terminal is in beta. Your account opens with ${OPEN_NOW}.`,
        'Trading features (AutoTrade, manual trading, ARES, DSL and OMEGA) are visible but locked until public launch.',
        'Questions? Use Support inside the app and we will get back to you.',
    ];
    return {
        subject: 'Zeus Terminal — your access is approved',
        text: [lines[0], `Sign in: ${url}`, ...lines.slice(1)].join('\n\n') + `\n\n${TEAM}`,
        html: _html('Your access is approved', lines.map(esc), { href: url, label: 'Sign in to Zeus Terminal' }),
    };
}

const _mask = (e) => String(e).replace(/^(.).*(@.*)$/, '$1***$2');

/**
 * Trimite unul din cele doua emailuri. Nu arunca niciodata si nu se asteapta
 * de cel care o cheama: intoarce `true` doar daca emailul a plecat.
 */
async function sendAccountEmail(kind, email, opts) {
    try {
        const to = String(email || '').trim().toLowerCase();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) return false;
        const build = kind === 'registered' ? registrationEmail : kind === 'approved' ? approvalEmail : null;
        if (!build) return false;
        const transport = (opts && opts.transport) || require('./mailer').getTransport();
        if (!transport) {
            logger.warn('MAIL', `account email "${kind}" not sent — SMTP is not configured`, { to: _mask(to) });
            return false;
        }
        const m = build(to);
        await transport.sendMail({
            from: process.env.SMTP_FROM || process.env.SMTP_USER,
            to, subject: m.subject, text: m.text, html: m.html,
        });
        logger.info('MAIL', `account email "${kind}" sent`, { to: _mask(to) });
        return true;
    } catch (err) {
        logger.warn('MAIL', `account email "${kind}" FAILED — ${err && err.message}`, { to: _mask(email) });
        return false;
    }
}

module.exports = { registrationEmail, approvalEmail, sendAccountEmail, appUrl };
