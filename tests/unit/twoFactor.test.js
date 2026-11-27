'use strict';
// [2026-11-27] Securitate etapa 2 — serviciul 2FA (TOTP) pe baza reala izolata.
const fs = require('fs'); const os = require('os'); const path = require('path');
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || 'a'.repeat(64);
let db, tf, totp;
beforeAll(() => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'zeus-2fa-'));
    process.env.ZEUS_DB_PATH = path.join(tmp, 'test.db');
    db = require('../../server/services/database');
    tf = require('../../server/services/twoFactor');
    totp = require('../../server/services/totp');
});
const NOW = 1_800_000_000_000;
const stepOf = (t) => Math.floor(t / 1000 / 30);
let uid = 100;
function enrolled() {
    const id = ++uid;
    const s = tf.beginSetup(id, `u${id}@x.ro`, NOW);
    const r = tf.confirmSetup(id, totp.codeAt(s.secret, stepOf(NOW)), NOW);
    return { id, secret: s.secret, recovery: r.recoveryCodes };
}

describe('activare', () => {
    test('fara 2FA: isEnabled=false, status corect', () => {
        expect(tf.isEnabled(1)).toBe(false);
        expect(tf.status(1)).toEqual({ enabled: false, recoveryLeft: 0 });
    });
    test('beginSetup da secret + otpauth, dar NU porneste 2FA pana la confirmare', () => {
        const s = tf.beginSetup(50, 'ana@x.ro', NOW);
        expect(s.secret).toMatch(/^[A-Z2-7]{32}$/);
        expect(s.uri).toContain('otpauth://totp/');
        expect(tf.isEnabled(50)).toBe(false);
    });
    test('secretul e CRIPTAT in baza, nu in clar', () => {
        const s = tf.beginSetup(51, 'b@x.ro', NOW);
        const row = db.totpGet(51);
        expect(row.pending_enc).not.toContain(s.secret);
        expect(row.pending_enc.startsWith('v1:')).toBe(true);
    });
    test('confirmare cu cod gresit → refuzat, 2FA ramane oprit', () => {
        tf.beginSetup(52, 'c@x.ro', NOW);
        expect(tf.confirmSetup(52, '000000', NOW).ok).toBe(false);
        expect(tf.isEnabled(52)).toBe(false);
    });
    test('confirmare corecta → pornit + 10 coduri de rezerva (date O SINGURA data)', () => {
        const e = enrolled();
        expect(tf.isEnabled(e.id)).toBe(true);
        expect(e.recovery).toHaveLength(10);
        expect(tf.status(e.id)).toEqual({ enabled: true, recoveryLeft: 10 });
        expect(JSON.stringify(db.totpGet(e.id))).not.toContain(e.recovery[0]);
    });
    test('confirmare fara setup inceput → refuzat', () => {
        expect(tf.confirmSetup(999, '123456', NOW).ok).toBe(false);
    });
    test('setup expirat (peste 15 min) → refuzat', () => {
        const s = tf.beginSetup(53, 'd@x.ro', NOW);
        const later = NOW + 16 * 60000;
        expect(tf.confirmSetup(53, totp.codeAt(s.secret, stepOf(later)), later).ok).toBe(false);
    });
    test('beginSetup cand e deja pornit → refuzat (nu se inlocuieste secretul pe furis)', () => {
        const e = enrolled();
        expect(tf.beginSetup(e.id, 'x@x.ro', NOW)).toEqual({ ok: false, error: 'already_enabled' });
    });
});

describe('login', () => {
    test('codul corect trece', () => {
        const e = enrolled();
        const t = NOW + 60000;
        expect(tf.verifyLogin(e.id, totp.codeAt(e.secret, stepOf(t)), t)).toEqual({ ok: true, method: 'totp' });
    });
    test('ACELASI cod a doua oara → refuzat (refolosire)', () => {
        const e = enrolled();
        const t = NOW + 60000;
        const c = totp.codeAt(e.secret, stepOf(t));
        expect(tf.verifyLogin(e.id, c, t).ok).toBe(true);
        expect(tf.verifyLogin(e.id, c, t).ok).toBe(false);
    });
    test('codul folosit la activare nu mai trece la login', () => {
        const e = enrolled();
        expect(tf.verifyLogin(e.id, totp.codeAt(e.secret, stepOf(NOW)), NOW).ok).toBe(false);
    });
    test('cod de rezerva: trece o data, apoi nu; ramân 9', () => {
        const e = enrolled();
        expect(tf.verifyLogin(e.id, e.recovery[0], NOW)).toEqual({ ok: true, method: 'recovery', recoveryLeft: 9 });
        expect(tf.verifyLogin(e.id, e.recovery[0], NOW).ok).toBe(false);
        expect(tf.status(e.id).recoveryLeft).toBe(9);
    });
    test('cont fara 2FA → verifyLogin refuza (nu e o usa ocolitoare)', () => {
        expect(tf.verifyLogin(4242, '123456', NOW).ok).toBe(false);
    });
});

describe('dezactivare', () => {
    test('cere un cod valid; cu cod gresit ramane pornit', () => {
        const e = enrolled();
        expect(tf.disable(e.id, '000000', NOW).ok).toBe(false);
        expect(tf.isEnabled(e.id)).toBe(true);
    });
    test('cu cod valid → oprit, secretul sters', () => {
        const e = enrolled();
        const t = NOW + 60000;
        expect(tf.disable(e.id, totp.codeAt(e.secret, stepOf(t)), t).ok).toBe(true);
        expect(tf.isEnabled(e.id)).toBe(false);
        expect(db.totpGet(e.id)).toBeNull();
    });
    test('si cu un cod de rezerva (telefon pierdut)', () => {
        const e = enrolled();
        expect(tf.disable(e.id, e.recovery[5], NOW).ok).toBe(true);
        expect(tf.isEnabled(e.id)).toBe(false);
    });
});

// [2026-11-27] Revizie M-6
describe('curatare si garzi', () => {
    test('adminReset sterge 2FA si spune daca era pornit', () => {
        const e = enrolled();
        expect(tf.adminReset(e.id)).toBe(true);
        expect(tf.isEnabled(e.id)).toBe(false);
        expect(tf.adminReset(e.id)).toBe(false);
    });
    test('un secret gol / prea scurt nu verifica niciodata (asigurare)', () => {
        const id = ++uid;
        db.totpSetPending(id, require('../../server/services/encryption').encrypt(''), NOW);
        db.totpEnable(id, require('../../server/services/encryption').encrypt(''), '[]', -1, NOW);
        const emptyCode = totp.codeAt('', stepOf(NOW + 60000));
        expect(tf.verifyLogin(id, emptyCode, NOW + 60000).ok).toBe(false);
    });
    test('stergerea contului sterge si randul 2FA', () => {
        const e = enrolled();
        db.db.prepare("INSERT OR IGNORE INTO users (id, email, password_hash, role, approved, status) VALUES (?, ?, 'x', 'user', 1, 'active')").run(e.id, `del${e.id}@x.ro`);
        db.deleteUser(`del${e.id}@x.ro`);
        expect(db.totpGet(e.id)).toBeNull();
    });
});
