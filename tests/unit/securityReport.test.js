'use strict';
// [2026-11-27] Securitate etapa 3 — raportul de securitate din admin (ultimele 24 h), din audit_log.
const fs = require('fs'); const os = require('os'); const path = require('path');
let db, report;
beforeAll(() => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'zeus-secrep-'));
    process.env.ZEUS_DB_PATH = path.join(tmp, 'test.db');
    db = require('../../server/services/database').db;
    report = require('../../server/services/securitySentinel').dailyReport;
});
const add = (action, uid, ip, ago) => db.prepare("INSERT INTO audit_log (user_id, action, details, ip, created_at) VALUES (?, ?, '{}', ?, datetime('now', ?))")
    .run(uid, action, ip, `-${ago} minutes`);

test('numara pe ultimele 24 h si da IP-urile cele mai active la esecuri SI resetari', () => {
    for (let i = 0; i < 4; i++) add('LOGIN_FAILED', 5, '83.141.90.134', 10 + i);
    add('LOGIN_2FA_FAILED', 5, '7.7.7.7', 5);
    add('FORGOT_PASSWORD_REQUESTED', 5, '83.141.90.134', 20);
    add('USER_REGISTERED', null, '5.5.5.5', 30);
    add('REGISTER_BLOCKED_SUSPICIOUS', null, '5.5.5.6', 30);
    add('LOGIN_SUCCESS', 1, '82.77.10.140', 40);
    add('LOGIN_FAILED', 5, '9.9.9.9', 60 * 25);          // mai vechi de 24 h → nu se numara
    const r = report(db);
    expect(r).toMatchObject({ hours: 24, failedSignIns: 5, resetRequests: 1, signUps: 2, blockedSignUps: 1, signIns: 1 });
    expect(r.topFailIps[0]).toEqual({ ip: '83.141.90.134', n: 5 });   // 4 parole gresite + 1 resetare (atacul a venit pe resetari)
    expect(r.topFailIps.map((x) => x.ip)).not.toContain('9.9.9.9');
});
