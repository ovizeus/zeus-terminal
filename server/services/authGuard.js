// server/services/authGuard.js
// [2026-11-27] Garzi anti-bot pentru inscriere / login / resetare — dupa atacul din 13–27 nov 2026:
// 93 de inscrieri false (mailinator, guerrillamailblock, prefix `verify_`), 76 de cereri de resetare
// pe conturile 2 si 5 din zeci de IP-uri (proxy-uri), o resetare reusita pe un cont-bot.
'use strict';

// Domenii de email TEMPORAR (inbox public / de unica folosinta). Si subdomeniile lor.
const DISPOSABLE_DOMAINS = new Set([
    'mailinator.com', 'mailinator.net', 'mailinator.org', 'binkmail.com', 'bobmail.info', 'suremail.info',
    'guerrillamail.com', 'guerrillamail.net', 'guerrillamail.org', 'guerrillamail.biz', 'guerrillamail.de',
    'guerrillamail.info', 'guerrillamailblock.com', 'sharklasers.com', 'grr.la', 'spam4.me', 'pokemail.net',
    '10minutemail.com', '10minutemail.net', '10minutemail.co.uk', 'tempmail.com', 'temp-mail.org', 'temp-mail.io',
    'tempmail.net', 'tempmailo.com', 'tempr.email', 'tmpmail.org', 'tmpmail.net', 'yopmail.com', 'yopmail.fr',
    'yopmail.net', 'trashmail.com', 'trashmail.de', 'trashmail.net', 'dispostable.com', 'getnada.com', 'nada.email',
    'maildrop.cc', 'mohmal.com', 'throwawaymail.com', 'fakeinbox.com', 'mintemail.com', 'emailondeck.com',
    'discard.email', 'mailnesia.com', 'mailcatch.com', 'moakt.com', 'burnermail.io', '1secmail.com', '1secmail.net',
    '1secmail.org', 'mail.tm', 'mailpoof.com', 'getairmail.com', 'spamgourmet.com', 'mytemp.email', 'emailfake.com',
    'fakemail.net', 'inboxkitten.com', 'mailsac.com', 'harakirimail.com', 'mailtemp.net', 'tempinbox.com',
]);

function _domainOf(email) {
    const e = String(email || '').toLowerCase().trim();
    const at = e.lastIndexOf('@');
    return at > 0 ? e.slice(at + 1) : '';
}

/** Adresa e pe un domeniu temporar (sau pe un subdomeniu al lui)? */
function isDisposableEmail(email) {
    const d = _domainOf(email);
    if (!d) return false;
    const parts = d.split('.');
    for (let i = 0; i < parts.length - 1; i++) {
        if (DISPOSABLE_DOMAINS.has(parts.slice(i).join('.'))) return true;
    }
    return false;
}

/** Semnatura botilor din nov 2026 (`verify_direct_…`, `verify_final_…`) sau adresa temporara. */
function isSuspiciousSignupEmail(email) {
    const local = String(email || '').toLowerCase().trim().split('@')[0] || '';
    return isDisposableEmail(email) || local.startsWith('verify_');
}

/**
 * Contor cu fereastra, pastrat in SQLite (tabela login_attempts, prin `store.loginAttemptGet/Upsert`),
 * ca o repornire a serverului sa nu stearga fereastra unui atacator.
 * @returns {boolean} true = permis, false = peste limita
 */
function hit(store, kind, key, max, windowMs, now = Date.now()) {
    const row = store.loginAttemptGet(kind, String(key));
    if (!row || now > row.reset_at) {
        store.loginAttemptUpsert(kind, String(key), 1, now + windowMs);
        return true;
    }
    const next = row.count + 1;
    store.loginAttemptUpsert(kind, String(key), next, row.reset_at);
    return next <= max;
}

module.exports = { DISPOSABLE_DOMAINS, isDisposableEmail, isSuspiciousSignupEmail, hit };
