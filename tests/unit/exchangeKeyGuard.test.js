'use strict';
// [2026-11-27] Securitate extra 1 — cheile de exchange (ce e mai valoros intr-un cont):
//  - 24 h dupa schimbarea parolei/emailului sau oprirea 2FA, cheile NU se pot adauga/schimba (ca la Binance);
//  - cu 2FA pornit, salvarea cheilor cere codul din aplicatie.
const fs = require('fs'); const os = require('os'); const path = require('path');
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || 'c'.repeat(64);
let db, guard, tf, totp;
beforeAll(() => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'zeus-exkg-'));
    process.env.ZEUS_DB_PATH = path.join(tmp, 'test.db');
    db = require('../../server/services/database');
    guard = require('../../server/services/exchangeKeyGuard');
    tf = require('../../server/services/twoFactor');
    totp = require('../../server/services/totp');
});
const audit = (uid, action, agoMin) => db.db.prepare("INSERT INTO audit_log (user_id, action, details, ip, created_at) VALUES (?, ?, '{}', '1.1.1.1', datetime('now', ?))").run(uid, action, `-${agoMin} minutes`);

test('cont fara schimbari recente si fara 2FA → permis', () => {
    expect(guard.check(201, {})).toEqual({ ok: true });
});
test.each(['CHANGE_PASSWORD_SUCCESS', 'FORGOT_PASSWORD_SUCCESS', 'CHANGE_EMAIL_SUCCESS', 'TWO_FACTOR_DISABLED'])
('%s acum 2 h → blocat 24 h, cu ora la care se deblocheaza', (action) => {
    const uid = 300 + Math.floor(Math.random() * 1000);
    audit(uid, action, 120);
    const r = guard.check(uid, {});
    expect(r.ok).toBe(false);
    expect(r.status).toBe(403);
    expect(r.code).toBe('SECURITY_HOLD');
    expect(r.until).toBeGreaterThan(Date.now() + 21 * 3600000);
    expect(r.error).toMatch(/24 hours/);
});
test('schimbare de parola acum 25 h → permis', () => {
    audit(202, 'CHANGE_PASSWORD_SUCCESS', 25 * 60);
    expect(guard.check(202, {}).ok).toBe(true);
});
test('schimbarea altui cont nu blocheaza', () => {
    audit(203, 'CHANGE_PASSWORD_SUCCESS', 10);
    expect(guard.check(204, {}).ok).toBe(true);
});
describe('cu 2FA pornit', () => {
    let uid, secret;
    beforeAll(() => {
        uid = 210;
        const s = tf.beginSetup(uid, 'k@x.ro', Date.now() - 120000);
        secret = s.secret;
        tf.confirmSetup(uid, totp.codeAt(secret, Math.floor((Date.now() - 120000) / 30000)), Date.now() - 120000);
    });
    test('fara cod → 403 TOTP_REQUIRED', () => {
        expect(guard.check(uid, {})).toMatchObject({ ok: false, status: 403, code: 'TOTP_REQUIRED' });
    });
    test('cod gresit → 403 TOTP_INVALID', () => {
        expect(guard.check(uid, { totpCode: '000000' })).toMatchObject({ ok: false, code: 'TOTP_INVALID' });
    });
    test('cod corect → permis (si nu se mai poate refolosi)', () => {
        const c = totp.codeAt(secret, Math.floor(Date.now() / 30000));
        expect(guard.check(uid, { totpCode: c })).toEqual({ ok: true });
        expect(guard.check(uid, { totpCode: c }).ok).toBe(false);
    });
});
