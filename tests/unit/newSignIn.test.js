'use strict';
// [2026-11-27] Securitate extra 3 — email la intrarea de pe un IP nou (ca la Binance): cand, de unde,
// „nu ai fost tu? schimba parola". Nu la prima intrare din viata contului, nu la acelasi IP.
const fs = require('fs'); const os = require('os'); const path = require('path');
let db, ns;
beforeAll(() => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'zeus-newsignin-'));
    process.env.ZEUS_DB_PATH = path.join(tmp, 'test.db');
    db = require('../../server/services/database');
    ns = require('../../server/services/newSignIn');
});
const login = (uid, ip, agoMin) => db.db.prepare("INSERT INTO audit_log (user_id, action, details, ip, created_at) VALUES (?, 'LOGIN_SUCCESS', '{}', ?, datetime('now', ?))").run(uid, ip, `-${agoMin || 0} minutes`).lastInsertRowid;

test('prima intrare din viata contului → fara email (n-avem cu ce compara)', () => {
    const id = login(501, '1.1.1.1');
    expect(ns.shouldNotify(501, '1.1.1.1', id)).toBe(false);
});
test('acelasi IP ca inainte → fara email', () => {
    login(502, '2.2.2.2', 600);
    const id = login(502, '2.2.2.2');
    expect(ns.shouldNotify(502, '2.2.2.2', id)).toBe(false);
});
test('IP nou fata de ultimele 180 de zile → email', () => {
    login(503, '3.3.3.3', 600);
    const id = login(503, '9.9.9.9');
    expect(ns.shouldNotify(503, '9.9.9.9', id)).toBe(true);
});
test('fara IP → fara email (nu putem spune „nou")', () => {
    login(504, '4.4.4.4', 600);
    const id = login(504, null);
    expect(ns.shouldNotify(504, null, id)).toBe(false);
});
test('emailul: IP, ora UTC, dispozitivul, ce faci daca n-ai fost tu', () => {
    const m = require('../../server/services/accountEmails').newSignInEmail('a@x.ro', { ip: '9.9.9.9', at: Date.parse('2026-11-27T20:00:00Z'), device: 'Chrome on Android' });
    expect(m.subject).toMatch(/new sign-in/i);
    expect(m.text).toContain('9.9.9.9');
    expect(m.text).toContain('2026-11-27 20:00 UTC');
    expect(m.text).toContain('Chrome on Android');
    expect(m.text).toMatch(/not you/i);
});
test('dispozitivul din User-Agent, scurt si fara date ciudate', () => {
    expect(ns.deviceOf('Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36')).toBe('Chrome on Android');
    expect(ns.deviceOf('Mozilla/5.0 (Windows NT 10.0; Win64) Edg/120')).toBe('Edge on Windows');
    expect(ns.deviceOf('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) Safari/604')).toBe('Safari on iPhone');
    expect(ns.deviceOf('')).toBe('Unknown device');
});
