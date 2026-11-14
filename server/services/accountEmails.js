'use strict';
// ═══════════════════════════════════════════════════════════════════════════
// EMAILURILE DE CONT — tot ce primeste un utilizator pe email despre contul lui
// ═══════════════════════════════════════════════════════════════════════════
// [2026-11-13] Inceput cu doua: „am primit cererea" si „accesul a fost aprobat".
// [2026-11-14] Extins la cererea operatorului, dupa un inventar al tuturor
// emailurilor trimise: codurile spun acum PENTRU CE sunt, iar orice schimbare
// la cont e confirmata (parola schimbata / resetata, cont inchis, acces complet,
// suspendare, raspuns la suport). Pana acum omul primea codul si apoi tacere —
// daca altcineva ii schimba parola, nu afla.
//
// Reguli:
//   - o notificare NU blocheaza nimic: actiunea reuseste si daca emailul nu
//     pleaca; esecul ramane in jurnal. (Codurile sunt exceptia: fara cod
//     actiunea nu poate continua, deci cel care le trimite asteapta raspunsul.)
//   - niciun termen promis, nicio data de lansare;
//   - doar adresa destinatarului — nimic despre alti utilizatori; la schimbarea
//     adresei, cea veche NU afla care e cea noua;
//   - nu se scrie niciodata o parola intr-un email;
//   - fara email la respingerea unei cereri (hotarat de operator);
//   - text in ENGLEZA (R-P-10), semnat „Zeus Terminal team".

const logger = require('./logger');

const TEAM = 'Zeus Terminal team';
const SENDER_NAME = 'Zeus Terminal';
const OPEN_NOW = 'the chart, indicators, market data and the liquidation map';
const TRADING = 'AutoTrade, manual trading, ARES, DSL and OMEGA';

function appUrl() {
    const raw = String(process.env.APP_PUBLIC_URL || 'https://zeus-terminal.com').trim().replace(/\/+$/, '');
    return /^https:\/\/[a-z0-9.-]+(:\d+)?$/i.test(raw) ? raw : 'https://zeus-terminal.com';
}
const loginUrl = () => appUrl() + '/login.html';
const supportUrl = () => appUrl() + '/support.html';

/**
 * Antetul „From". Adresa vine din mediu; daca nu are deja un nume afisat,
 * primeste „Zeus Terminal". Fara asta, omul vedea in casuta o adresa goala.
 */
function fromHeader() {
    const raw = String(process.env.SMTP_FROM || process.env.SMTP_USER || '').trim();
    if (!raw || raw.includes('<')) return raw;
    return /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/.test(raw) ? `${SENDER_NAME} <${raw}>` : raw;
}

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** „2026-11-14 09:30 UTC" — o singura forma, fara fus ghicit. */
function fmtUtc(ts) {
    const d = new Date(ts);
    if (!Number.isFinite(d.getTime())) return '';
    return d.toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
}

// Un singur sablon pentru toate: acelasi antet, aceeasi semnatura.
//   paragraphs — text simplu (se escapeaza aici)
//   code       — cifrele unui cod, afisate mare
//   quote      — un citat (raspunsul de la suport)
//   button     — { href, label }
function _html(title, paragraphs, extra) {
    const x = extra || {};
    const p = (t) => `<p style="margin:0 0 14px;color:#c4cfda;font-size:14px;line-height:1.6">${esc(t)}</p>`;
    const head = (x.before || []).map(p).join('');
    const code = x.code
        ? `<div style="margin:6px 0 18px;padding:18px 12px;text-align:center;background:#111a28;border:1px solid #2a3b4b;border-radius:8px;font-family:'Courier New',monospace;font-size:30px;letter-spacing:8px;font-weight:700;color:#eaf2f8">${esc(x.code)}</div>`
        : '';
    const quote = x.quote
        ? `<div style="margin:0 0 16px;padding:12px 14px;border-left:3px solid #8fb4d9;background:#111a28;border-radius:0 6px 6px 0;color:#d3dce6;font-size:14px;line-height:1.6;white-space:pre-wrap">${esc(x.quote)}</div>`
        : '';
    const body = paragraphs.map(p).join('');
    const b = x.button
        ? `<p style="margin:22px 0 8px"><a href="${esc(x.button.href)}" style="display:inline-block;background:#f0c040;color:#0a0f14;text-decoration:none;font-weight:700;padding:11px 22px;border-radius:6px;font-size:14px">${esc(x.button.label)}</a></p>`
        : '';
    return `<div style="font-family:Arial,Helvetica,sans-serif;background:#0a0f16;padding:28px 24px;border-radius:12px;max-width:460px;margin:0 auto">
<h2 style="color:#f0c040;margin:0 0 6px;font-size:18px">Zeus Terminal</h2>
<h3 style="color:#eaf2f8;margin:0 0 18px;font-size:16px;font-weight:600">${esc(title)}</h3>
${head}${code}${quote}${body}${b}
<p style="margin:22px 0 0;color:#7f93a6;font-size:13px">${esc(TEAM)}</p>
</div>`;
}

const _text = (lines) => lines.filter(Boolean).join('\n\n') + `\n\n${TEAM}`;
const _notYou = () => `If this was not you, reset your password right away with "Forgot password" on the sign-in page and contact us: ${supportUrl()}`;

// ── Cererea si aprobarea ───────────────────────────────────────────────────
function registrationEmail(email) {
    const lines = [
        `We received your request for a Zeus Terminal account (${email}).`,
        'Access is approved manually by our team, so it is not instant. You will get a second email as soon as your account is approved — there is nothing else you need to do.',
        `Zeus Terminal is currently in beta. Once approved, you will have ${OPEN_NOW}. Trading features open at public launch.`,
        'If you did not request this account, you can ignore this email.',
    ];
    return { subject: 'Zeus Terminal — we received your request', text: _text(lines), html: _html('We received your request', lines) };
}

function approvalEmail(email) {
    const lines = [
        `Your Zeus Terminal account (${email}) has been approved. You can sign in now.`,
        `Zeus Terminal is in beta. Your account opens with ${OPEN_NOW}.`,
        `Trading features (${TRADING}) are visible but locked until public launch.`,
        'Questions? Use Support inside the app and we will get back to you.',
    ];
    return {
        subject: 'Zeus Terminal — your access is approved',
        text: _text([lines[0], `Sign in: ${loginUrl()}`, ...lines.slice(1)]),
        html: _html('Your access is approved', lines, { button: { href: loginUrl(), label: 'Sign in to Zeus Terminal' } }),
    };
}

// ── Codurile: fiecare spune pentru ce e ────────────────────────────────────
// Inainte, toate cele cinci foloseau un singur email care scria „Login
// verification code" — inclusiv cel pentru inchiderea contului.
const CODE_PURPOSES = {
    login: { subject: 'your sign-in code', title: 'Your sign-in code', line: 'Use this code to finish signing in.' },
    change_password: { subject: 'confirm your password change', title: 'Confirm your password change', line: 'Use this code to confirm the change of your password.' },
    change_email: { subject: 'confirm your new email address', title: 'Confirm your new email address', line: 'Use this code to confirm this address as the new sign-in email for your Zeus Terminal account.' },
    forgot_password: { subject: 'your password reset code', title: 'Reset your password', line: 'Use this code to set a new password.' },
    close_account: { subject: 'confirm closing your account', title: 'Confirm closing your account', line: 'Use this code to confirm that you want to close your Zeus Terminal account. Closing an account cannot be undone.' },
};

function codeEmail(purpose, code, minutes) {
    const p = CODE_PURPOSES[purpose] || CODE_PURPOSES.login;
    const mins = Number(minutes) > 0 ? Math.round(Number(minutes)) : 5;
    const c = String(code);
    const after = [
        `The code expires in ${mins} minutes.`,
        'Never share this code with anyone. If you did not request it, you can ignore this email — nothing changes without the code.',
    ];
    return {
        subject: `Zeus Terminal — ${p.subject}`,
        text: _text([p.line, `Code: ${c}`, ...after]),
        html: _html(p.title, after, { before: [p.line], code: c }),
    };
}

// ── Confirmarile: ceva s-a schimbat la contul tau ──────────────────────────
function passwordChangedEmail(email, data) {
    const when = fmtUtc((data && data.at) || Date.now());
    const lines = [
        `The password for your Zeus Terminal account (${email}) was changed on ${when}.`,
        'Every other session was signed out.',
        _notYou(),
    ];
    return { subject: 'Zeus Terminal — your password was changed', text: _text(lines), html: _html('Your password was changed', lines) };
}

function passwordResetEmail(email, data) {
    const when = fmtUtc((data && data.at) || Date.now());
    const lines = [
        `The password for your Zeus Terminal account (${email}) was reset on ${when}, using a code sent to this address.`,
        'Every session was signed out. You can sign in with your new password.',
        _notYou(),
    ];
    return {
        subject: 'Zeus Terminal — your password was reset',
        text: _text([lines[0], lines[1], `Sign in: ${loginUrl()}`, lines[2]]),
        html: _html('Your password was reset', lines, { button: { href: loginUrl(), label: 'Sign in' } }),
    };
}

// Parola temporara NU se scrie aici: o da echipa, direct. Emailul spune doar
// ca s-a intamplat si ce are omul de facut in ora in care parola e valabila.
function adminPasswordResetEmail(email) {
    const lines = [
        `The password for your Zeus Terminal account (${email}) was reset by our team.`,
        'A temporary password has been set and our team will give it to you directly. It works for one hour: sign in with it and change it from Settings before then.',
        'Prefer to choose your own password right away? Use "Forgot password" on the sign-in page.',
        `If you did not ask for this, contact us: ${supportUrl()}`,
    ];
    return {
        subject: 'Zeus Terminal — your password was reset by our team',
        text: _text([...lines.slice(0, 3), `Sign in: ${loginUrl()}`, lines[3]]),
        html: _html('Your password was reset by our team', lines, { button: { href: loginUrl(), label: 'Sign in' } }),
    };
}

function accountClosedEmail(email) {
    const lines = [
        `Your Zeus Terminal account (${email}) has been closed at your request and you have been signed out.`,
        'Any exchange connection on the account was removed. You can no longer sign in with this address.',
        `If you did not request this, contact us right away: ${supportUrl()}`,
        'You are welcome back any time — a new account goes through the same approval.',
    ];
    return { subject: 'Zeus Terminal — your account has been closed', text: _text(lines), html: _html('Your account has been closed', lines) };
}

// Catre adresa VECHE. Nu spune care e cea noua.
function emailChangedEmail() {
    const lines = [
        'The sign-in email for your Zeus Terminal account was changed. This address is no longer linked to the account.',
        `If you did not make this change, contact us right away: ${supportUrl()}`,
    ];
    return { subject: 'Zeus Terminal — the email address on your account was changed', text: _text(lines), html: _html('Your sign-in email was changed', lines) };
}

// ── Accesul ────────────────────────────────────────────────────────────────
function accessFullEmail(email) {
    const lines = [
        `Your Zeus Terminal account (${email}) now has full access.`,
        `Trading features — ${TRADING} — are unlocked. Reload the app if you still see the locks.`,
        'Questions? Use Support inside the app.',
    ];
    return {
        subject: 'Zeus Terminal — you now have full access',
        text: _text([lines[0], lines[1], `Open Zeus Terminal: ${loginUrl()}`, lines[2]]),
        html: _html('You now have full access', lines, { button: { href: loginUrl(), label: 'Open Zeus Terminal' } }),
    };
}

function suspendedEmail(email, data) {
    const until = data && data.until ? fmtUtc(data.until) : '';
    const lines = [
        until
            ? `Your Zeus Terminal account (${email}) has been suspended until ${until}. You cannot sign in until then.`
            : `Your Zeus Terminal account (${email}) has been suspended. You cannot sign in for now.`,
        `If you think this is a mistake, contact us: ${supportUrl()}`,
    ];
    return { subject: 'Zeus Terminal — your account has been suspended', text: _text(lines), html: _html('Your account has been suspended', lines) };
}

function restoredEmail(email) {
    const lines = [`Your Zeus Terminal account (${email}) is active again. You can sign in.`];
    return {
        subject: 'Zeus Terminal — your account is active again',
        text: _text([lines[0], `Sign in: ${loginUrl()}`]),
        html: _html('Your account is active again', lines, { button: { href: loginUrl(), label: 'Sign in' } }),
    };
}

// ── Suportul ───────────────────────────────────────────────────────────────
const SUPPORT_PREVIEW_MAX = 600;

function supportReplyEmail(email, data) {
    let preview = String((data && data.message) || '').trim();
    if (preview.length > SUPPORT_PREVIEW_MAX) preview = preview.slice(0, SUPPORT_PREVIEW_MAX).trimEnd() + '…';
    const intro = 'You have a new reply from Zeus Terminal support:';
    const after = ['Open Support inside the app to read the full conversation and answer.'];
    return {
        subject: 'Zeus Terminal — new reply from support',
        text: _text([intro, preview ? `"${preview}"` : '', after[0], `Open Zeus Terminal: ${loginUrl()}`]),
        html: _html('New reply from support', after, { before: [intro], quote: preview, button: { href: loginUrl(), label: 'Open Zeus Terminal' } }),
    };
}

const BUILDERS = {
    registered: registrationEmail,
    approved: approvalEmail,
    password_changed: passwordChangedEmail,
    password_reset: passwordResetEmail,
    admin_password_reset: adminPasswordResetEmail,
    account_closed: accountClosedEmail,
    email_changed: emailChangedEmail,
    access_full: accessFullEmail,
    suspended: suspendedEmail,
    restored: restoredEmail,
    support_reply: supportReplyEmail,
};

const _mask = (e) => String(e).replace(/^(.).*(@.*)$/, '$1***$2');
const _validAddr = (to) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to);

// Un raspuns de la suport nu trimite un email la fiecare mesaj: daca adminul
// scrie cinci randuri la rand, omul primeste unul.
const SUPPORT_THROTTLE_MS = 10 * 60 * 1000;
const _lastSupportMail = new Map();   // adresa -> ts

function _throttled(kind, to, now) {
    if (kind !== 'support_reply') return false;
    const last = _lastSupportMail.get(to) || 0;
    if (now - last < SUPPORT_THROTTLE_MS) return true;
    _lastSupportMail.set(to, now);
    if (_lastSupportMail.size > 500) {
        for (const [k, v] of _lastSupportMail) if (now - v > SUPPORT_THROTTLE_MS) _lastSupportMail.delete(k);
    }
    return false;
}

/**
 * Trimite o notificare de cont. Nu arunca niciodata si nu se asteapta de cel
 * care o cheama: intoarce `true` doar daca emailul a plecat.
 *   opts.data      — ce ii trebuie sablonului (until, message, at)
 *   opts.transport — pentru teste
 *   opts.now       — pentru teste
 */
async function sendAccountEmail(kind, email, opts) {
    try {
        const to = String(email || '').trim().toLowerCase();
        if (!_validAddr(to)) return false;
        const build = Object.prototype.hasOwnProperty.call(BUILDERS, kind) ? BUILDERS[kind] : null;
        if (!build) return false;
        const o = opts || {};
        if (_throttled(kind, to, Number.isFinite(o.now) ? o.now : Date.now())) {
            logger.info('MAIL', `account email "${kind}" skipped — one was sent a moment ago`, { to: _mask(to) });
            return false;
        }
        // Sub teste nu pleaca niciodata un email adevarat: fara un transport dat
        // explicit, functia se opreste aici, orice ar fi in mediu.
        if (process.env.JEST_WORKER_ID && !o.transport) return false;
        const transport = o.transport || require('./mailer').getTransport();
        if (!transport) {
            logger.warn('MAIL', `account email "${kind}" not sent — SMTP is not configured`, { to: _mask(to) });
            return false;
        }
        const m = build(to, o.data);
        await transport.sendMail({ from: fromHeader(), to, subject: m.subject, text: m.text, html: m.html });
        logger.info('MAIL', `account email "${kind}" sent`, { to: _mask(to) });
        return true;
    } catch (err) {
        logger.warn('MAIL', `account email "${kind}" FAILED — ${err && err.message}`, { to: _mask(email) });
        return false;
    }
}

module.exports = {
    registrationEmail, approvalEmail, codeEmail, passwordChangedEmail, passwordResetEmail,
    adminPasswordResetEmail, accountClosedEmail, emailChangedEmail, accessFullEmail,
    suspendedEmail, restoredEmail, supportReplyEmail,
    sendAccountEmail, appUrl, fromHeader, fmtUtc,
    CODE_PURPOSES, SUPPORT_THROTTLE_MS, _resetThrottleForTest: () => _lastSupportMail.clear(),
};
