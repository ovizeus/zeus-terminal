'use strict';
// [2026-11-27] Securitate etapa 2 — 2FA cu aplicatie de autentificare (TOTP, RFC 6238), fara biblioteci
// externe (speakeasy nu mai e intretinut; codul e ~50 de linii pe node:crypto). Vectorii oficiali RFC 6238.
const totp = require('../../server/services/totp');

const RFC_SECRET = totp.base32Encode(Buffer.from('12345678901234567890', 'ascii'));

describe('TOTP — vectorii RFC 6238 (SHA1, 30 s, ultimele 6 cifre)', () => {
    test.each([
        [59, '287082'], [1111111109, '081804'], [1111111111, '050471'],
        [1234567890, '005924'], [2000000000, '279037'],
    ])('T=%i → %s', (t, code) => {
        expect(totp.codeAt(RFC_SECRET, Math.floor(t / 30))).toBe(code);
    });
});

describe('base32', () => {
    test('dus-intors pe octeti aleatori', () => {
        const b = require('crypto').randomBytes(20);
        expect(totp.base32Decode(totp.base32Encode(b)).equals(b)).toBe(true);
    });
    test('accepta litere mici si spatii (cum il tasteaza omul)', () => {
        const s = totp.base32Encode(Buffer.from('hello world 12345'));
        expect(totp.base32Decode(s.toLowerCase().replace(/(.{4})/g, '$1 ')).toString()).toBe('hello world 12345');
    });
});

describe('verify', () => {
    const secret = totp.generateSecret();
    const now = 1_800_000_000_000;
    const step = Math.floor(now / 1000 / 30);
    test('secretul nou are 32 de caractere base32 (160 de biti)', () => {
        expect(secret).toMatch(/^[A-Z2-7]{32}$/);
    });
    test('codul curent trece si intoarce pasul folosit', () => {
        expect(totp.verify(secret, totp.codeAt(secret, step), { now })).toEqual({ ok: true, step });
    });
    test('un pas in urma sau inainte trece (ceas decalat cu 30 s)', () => {
        expect(totp.verify(secret, totp.codeAt(secret, step - 1), { now }).ok).toBe(true);
        expect(totp.verify(secret, totp.codeAt(secret, step + 1), { now }).ok).toBe(true);
    });
    test('doi pasi departe → refuzat', () => {
        expect(totp.verify(secret, totp.codeAt(secret, step - 2), { now }).ok).toBe(false);
    });
    test('REFOLOSIRE: un cod deja folosit (pas <= ultimul) → refuzat', () => {
        expect(totp.verify(secret, totp.codeAt(secret, step), { now, lastStep: step }).ok).toBe(false);
        expect(totp.verify(secret, totp.codeAt(secret, step - 1), { now, lastStep: step }).ok).toBe(false);
    });
    test('gunoi → refuzat, fara sa arunce', () => {
        for (const c of ['', '12345', '1234567', 'abcdef', null, undefined, 123456]) {
            expect(totp.verify(secret, c, { now }).ok).toBe(false);
        }
    });
    test('accepta spatiu la mijloc („123 456")', () => {
        const c = totp.codeAt(secret, step);
        expect(totp.verify(secret, c.slice(0, 3) + ' ' + c.slice(3), { now }).ok).toBe(true);
    });
});

describe('coduri de rezerva', () => {
    test('10 coduri unice, 10 caractere fara litere confundabile', () => {
        const { codes, hashes } = totp.generateRecoveryCodes();
        expect(codes).toHaveLength(10);
        expect(new Set(codes).size).toBe(10);
        for (const c of codes) expect(c).toMatch(/^[A-HJ-NP-Z2-9]{5}-[A-HJ-NP-Z2-9]{5}$/);
        expect(hashes).toHaveLength(10);
        expect(hashes.join()).not.toContain(codes[0]);
    });
    test('un cod de rezerva se foloseste O SINGURA data', () => {
        const { codes, hashes } = totp.generateRecoveryCodes();
        const r1 = totp.useRecoveryCode(hashes, codes[3].toLowerCase().replace('-', ''));
        expect(r1.ok).toBe(true);
        expect(r1.remaining).toHaveLength(9);
        expect(totp.useRecoveryCode(r1.remaining, codes[3]).ok).toBe(false);
    });
    test('cod gresit → refuzat, lista neschimbata', () => {
        const { hashes } = totp.generateRecoveryCodes();
        const r = totp.useRecoveryCode(hashes, 'AAAAA-AAAAA');
        expect(r.ok).toBe(false);
        expect(r.remaining).toBe(hashes);
    });
});

describe('otpauth URI (pentru QR)', () => {
    test('contine emitentul, contul si secretul, codificate', () => {
        const u = totp.otpauthUri('ABCDEFGHIJKLMNOP', 'ana+1@x.ro');
        expect(u).toBe('otpauth://totp/Zeus%20Terminal:ana%2B1%40x.ro?secret=ABCDEFGHIJKLMNOP&issuer=Zeus%20Terminal&algorithm=SHA1&digits=6&period=30');
    });
});
