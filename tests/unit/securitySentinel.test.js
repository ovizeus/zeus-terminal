'use strict';
// [2026-11-27] Securitate etapa 3 — Sentinel (varianta usoara): citeste audit_log, trimite alerte pe telefon
// adminilor la rafale (inscrieri, resetari, parole gresite), la intrarea unui admin de pe un IP NOU si la
// schimbari pe un cont de admin. Doar OBSERVA — nu blocheaza nimic.
const { createSentinel } = require('../../server/services/securitySentinel');

const T0 = Date.parse('2026-11-27T20:00:00Z');
const at = (ms) => new Date(T0 + ms).toISOString().replace('T', ' ').slice(0, 19);
function harness(opts) {
    const o = opts || {};
    const rows = []; const sent = [];
    let id = 0;
    const add = (action, userId, ip, ms) => rows.push({ id: ++id, user_id: userId, action, ip: ip || '1.2.3.4', created_at: at(ms || 0) });
    const s = createSentinel({
        readSince: (last) => rows.filter((r) => r.id > last),
        maxId: () => o.startAfterExisting ? id : 0,
        adminIds: () => [1],
        isAdmin: (uid) => uid === 1,
        ipSeenBefore: (uid, ip, beforeId) => rows.some((r) => r.user_id === uid && r.ip === ip && r.action === 'LOGIN_SUCCESS' && r.id < beforeId),
        send: (uid, line) => sent.push([uid, line]),
    });
    return { s, add, sent };
}

test('pornirea nu trimite alerte pentru istoricul vechi', () => {
    const h = harness({ startAfterExisting: true });
    for (let i = 0; i < 20; i++) h.add('LOGIN_FAILED', 5, '9.9.9.9', i * 1000);
    h.s.init();
    h.s.tick(T0 + 30000);
    expect(h.sent).toHaveLength(0);
});
test('rafala de inscrieri: 5 in 10 min → O alerta; a 6-a nu mai repeta (pauza 30 min)', () => {
    const h = harness(); h.s.init();
    for (let i = 0; i < 6; i++) h.add(i % 2 ? 'REGISTER_BLOCKED_SUSPICIOUS' : 'USER_REGISTERED', null, '5.5.5.' + i, i * 60000);
    h.s.tick(T0 + 6 * 60000);
    expect(h.sent).toHaveLength(1);
    expect(h.sent[0][0]).toBe(1);
    expect(h.sent[0][1]).toMatch(/sign-up/i);
    h.add('USER_REGISTERED', null, '5.5.5.9', 7 * 60000);
    h.s.tick(T0 + 8 * 60000);
    expect(h.sent).toHaveLength(1);
});
test('4 inscrieri raspandite pe o ora → nimic', () => {
    const h = harness(); h.s.init();
    for (let i = 0; i < 4; i++) h.add('USER_REGISTERED', null, '5.5.5.' + i, i * 15 * 60000);
    h.s.tick(T0 + 61 * 60000);
    expect(h.sent).toHaveLength(0);
});
test('rafala de resetari de parola (5/10 min) → alerta cu numarul de conturi tinta', () => {
    const h = harness(); h.s.init();
    for (let i = 0; i < 5; i++) h.add('FORGOT_PASSWORD_REQUESTED', i < 3 ? 5 : 2, '8.8.8.' + i, i * 30000);
    h.s.tick(T0 + 3 * 60000);
    expect(h.sent).toHaveLength(1);
    expect(h.sent[0][1]).toMatch(/password-reset/i);
    expect(h.sent[0][1]).toMatch(/2 accounts/);
});
test('parole gresite: 10 in 10 min → alerta; 9 → nimic', () => {
    const h = harness(); h.s.init();
    for (let i = 0; i < 9; i++) h.add('LOGIN_FAILED', 5, '7.7.7.7', i * 10000);
    h.s.tick(T0 + 2 * 60000);
    expect(h.sent).toHaveLength(0);
    h.add('LOGIN_2FA_FAILED', 5, '7.7.7.7', 100000);
    h.s.tick(T0 + 3 * 60000);
    expect(h.sent).toHaveLength(1);
    expect(h.sent[0][1]).toMatch(/failed sign-in/i);
});
test('admin intra de pe un IP NOU → alerta cu IP-ul; de pe unul vechi → nimic', () => {
    const h = harness(); h.s.init();
    h.add('LOGIN_SUCCESS', 1, '82.77.10.140', 0);
    h.s.tick(T0 + 1000);
    expect(h.sent).toHaveLength(1);              // prima data = nou
    h.add('LOGIN_SUCCESS', 1, '82.77.10.140', 60000);
    h.s.tick(T0 + 61000);
    expect(h.sent).toHaveLength(1);              // vechi → tacere
    h.add('LOGIN_SUCCESS', 1, '203.0.113.9', 120000);
    h.s.tick(T0 + 121000);
    expect(h.sent).toHaveLength(2);
    expect(h.sent[1][1]).toContain('203.0.113.9');
});
test('un user obisnuit intra de pe IP nou → nimic (nu e treaba adminului)', () => {
    const h = harness(); h.s.init();
    h.add('LOGIN_SUCCESS', 7, '203.0.113.9', 0);
    h.s.tick(T0 + 1000);
    expect(h.sent).toHaveLength(0);
});
test.each([
    ['CHANGE_PASSWORD_SUCCESS', /password changed/i],
    ['FORGOT_PASSWORD_SUCCESS', /password reset/i],
    ['CHANGE_EMAIL_SUCCESS', /email changed/i],
    ['TWO_FACTOR_DISABLED', /two-factor.*off/i],
    ['LOGIN_RECOVERY_CODE_USED', /backup code/i],
])('schimbare pe contul de ADMIN: %s → alerta', (action, re) => {
    const h = harness(); h.s.init();
    h.add(action, 1, '82.77.10.140', 0);
    h.s.tick(T0 + 1000);
    expect(h.sent).toHaveLength(1);
    expect(h.sent[0][1]).toMatch(re);
});
test('aceeasi schimbare pe un cont obisnuit → nimic', () => {
    const h = harness(); h.s.init();
    h.add('CHANGE_PASSWORD_SUCCESS', 7, '1.1.1.1', 0);
    h.s.tick(T0 + 1000);
    expect(h.sent).toHaveLength(0);
});
test('o eroare la trimitere nu opreste citirea (nu reia la nesfarsit)', () => {
    const rows = [{ id: 1, user_id: 1, action: 'CHANGE_EMAIL_SUCCESS', ip: 'x', created_at: at(0) }];
    let calls = 0;
    const s = createSentinel({
        readSince: (l) => rows.filter((r) => r.id > l), maxId: () => 0, adminIds: () => [1], isAdmin: () => true,
        ipSeenBefore: () => true, send: () => { calls++; throw new Error('down'); },
    });
    s.init();
    expect(() => s.tick(T0 + 1000)).not.toThrow();
    s.tick(T0 + 2000);
    expect(calls).toBe(1);
});
test('summary(): cifrele zilei pentru raportul din admin', () => {
    const h = harness(); h.s.init();
    h.add('LOGIN_FAILED', 5, '7.7.7.7', 0);
    h.add('USER_REGISTERED', null, '5.5.5.5', 0);
    h.add('REGISTER_BLOCKED_SUSPICIOUS', null, '5.5.5.6', 0);
    h.s.tick(T0 + 1000);
    const sm = h.s.summary();
    expect(sm.failedSignIns).toBe(1);
    expect(sm.signUps).toBe(2);
    expect(sm.alertsSent).toBe(0);
});
