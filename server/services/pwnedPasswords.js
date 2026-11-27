'use strict';
/**
 * [2026-11-27] Securitate extra 6 — refuza parolele cunoscute ca furate (Have I Been Pwned, Pwned Passwords).
 * k-anonymity: pleaca DOAR primele 5 caractere hex ale SHA-1; parola si restul amprentei nu parasesc
 * serverul. `Add-Padding` ascunde si marimea raspunsului. Serviciul cazut / lent → null → NU blocam pe nimeni.
 *   isPwned(password) → Promise<true | false | null>
 */
const crypto = require('crypto');
const API = 'https://api.pwnedpasswords.com/range/';

async function isPwned(password, opts) {
    const o = opts || {};
    const f = o.fetchImpl || (typeof fetch === 'function' ? fetch : null);
    if (!f) return null;
    const h = crypto.createHash('sha1').update(String(password || '')).digest('hex').toUpperCase();
    const prefix = h.slice(0, 5), suffix = h.slice(5);
    const timeoutMs = Number.isFinite(o.timeoutMs) ? o.timeoutMs : 3000;
    try {
        const res = await Promise.race([
            f(API + prefix, { headers: { 'Add-Padding': 'true', 'User-Agent': 'password-breach-check' } }),
            new Promise((resolve) => setTimeout(() => resolve(null), timeoutMs)),
        ]);
        if (!res || !res.ok) return null;
        const body = await res.text();
        for (const line of String(body).split(/\r?\n/)) {
            const [suf, count] = line.trim().split(':');
            if (suf && suf.toUpperCase() === suffix) return Number(count) > 0;
        }
        return false;
    } catch (_) {
        return null;
    }
}

module.exports = { isPwned };
