'use strict';
// [2026-11-27] Securitate extra 6 — parolele cunoscute ca furate (Have I Been Pwned, k-anonymity):
// pleaca DOAR primele 5 caractere ale SHA-1; parola si restul amprentei nu parasesc serverul.
// Serviciul cazut / lent → necunoscut (null) → NU blocam pe nimeni.
const crypto = require('crypto');
const { isPwned } = require('../../server/services/pwnedPasswords');
const sha = (p) => crypto.createHash('sha1').update(p).digest('hex').toUpperCase();

function fakeFetch(lines, seen) {
    return async (url, init) => {
        seen.push({ url, init });
        return { ok: true, status: 200, text: async () => lines.join('\r\n') };
    };
}
test('parola din lista de scurgeri → true; trimite doar prefixul de 5', async () => {
    const h = sha('Password123!'); const seen = [];
    const r = await isPwned('Password123!', { fetchImpl: fakeFetch([`${h.slice(5)}:4521`, 'ABCDEF0123456789ABCDEF0123456789ABC:1'], seen) });
    expect(r).toBe(true);
    expect(seen[0].url).toBe('https://api.pwnedpasswords.com/range/' + h.slice(0, 5));
    expect(JSON.stringify(seen)).not.toContain(h.slice(5));
    expect(JSON.stringify(seen)).not.toContain('Password123!');
    expect(seen[0].init.headers['Add-Padding']).toBe('true');
});
test('parola care nu apare → false (si randurile de umplutura cu :0 nu conteaza)', async () => {
    const h = sha('x9#Zq!long-unique-pass-2026');
    expect(await isPwned('x9#Zq!long-unique-pass-2026', { fetchImpl: fakeFetch([`${h.slice(5)}:0`, 'FFFFF:3'], []) })).toBe(false);
});
test('serviciul raspunde cu eroare → null (nu blocam)', async () => {
    expect(await isPwned('abc', { fetchImpl: async () => ({ ok: false, status: 503, text: async () => '' }) })).toBeNull();
});
test('serviciul nu raspunde la timp → null', async () => {
    const never = () => new Promise(() => {});
    expect(await isPwned('abc', { fetchImpl: never, timeoutMs: 20 })).toBeNull();
});
test('fetch arunca → null', async () => {
    expect(await isPwned('abc', { fetchImpl: async () => { throw new Error('dns'); } })).toBeNull();
});
