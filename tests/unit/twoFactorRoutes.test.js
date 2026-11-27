'use strict';
// [2026-11-27] Securitate etapa 2 — rutele /api/2fa (montate dupa sessionAuth, care pune req.user).
const fs = require('fs'); const os = require('os'); const path = require('path');
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || 'b'.repeat(64);
const request = require('supertest');
const express = require('express');
const bcrypt = require('bcryptjs');
let db, totp, mails;
const PASS = 'Corect-Parola-1';
beforeAll(() => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'zeus-2fa-routes-'));
    process.env.ZEUS_DB_PATH = path.join(tmp, 'test.db');
    db = require('../../server/services/database');
    totp = require('../../server/services/totp');
    mails = [];
    jest.doMock('../../server/services/accountEmails', () => ({ sendAccountEmail: async (k, e) => { mails.push([k, e]); return true; } }));
});
let nextId = 0;
function mkUser() {
    const email = `r${Date.now()}${++nextId}@x.ro`;
    db.createUser(email, bcrypt.hashSync(PASS, 4), 'user');
    return db.findUserByEmail(email);
}
function app(user) {
    const a = express();
    a.use(express.json());
    a.use((req, _res, next) => { req.user = user ? { id: user.id, email: user.email, role: 'user' } : undefined; next(); });
    a.use('/api/2fa', require('../../server/routes/twoFactor'));
    return a;
}
const step = () => Math.floor(Date.now() / 1000 / 30);

test('fara sesiune → 401', async () => {
    expect((await request(app(null)).get('/api/2fa/status')).status).toBe(401);
});
test('status initial: oprit', async () => {
    const u = mkUser();
    const r = await request(app(u)).get('/api/2fa/status');
    expect(r.body).toEqual({ ok: true, enabled: false, recoveryLeft: 0 });
});
test('setup cere PAROLA corecta (o sesiune furata nu poate porni 2FA si bloca proprietarul)', async () => {
    const u = mkUser();
    const bad = await request(app(u)).post('/api/2fa/setup').send({ password: 'gresit' });
    expect(bad.status).toBe(403);
    const ok = await request(app(u)).post('/api/2fa/setup').send({ password: PASS });
    expect(ok.status).toBe(200);
    expect(ok.body.secret).toMatch(/^[A-Z2-7]{32}$/);
    expect(ok.body.uri).toContain('otpauth://');
});
test('flux complet: setup → confirm → coduri de rezerva + email + audit; status pornit', async () => {
    const u = mkUser(); const a = app(u);
    const s = await request(a).post('/api/2fa/setup').send({ password: PASS });
    const c = await request(a).post('/api/2fa/confirm').send({ code: totp.codeAt(s.body.secret, step()) });
    expect(c.status).toBe(200);
    expect(c.body.recoveryCodes).toHaveLength(10);
    expect(mails).toContainEqual(['two_factor_enabled', u.email]);
    expect((await request(a).get('/api/2fa/status')).body.enabled).toBe(true);
    const audit = db.db.prepare("SELECT action FROM audit_log WHERE user_id = ? ORDER BY id").all(u.id).map(r => r.action);
    expect(audit).toContain('TWO_FACTOR_ENABLED');
});
test('confirm cu cod gresit → 400', async () => {
    const u = mkUser(); const a = app(u);
    await request(a).post('/api/2fa/setup').send({ password: PASS });
    expect((await request(a).post('/api/2fa/confirm').send({ code: '000000' })).status).toBe(400);
});
test('disable cere parola SI cod; cu ambele → oprit + email + audit', async () => {
    const u = mkUser(); const a = app(u);
    const s = await request(a).post('/api/2fa/setup').send({ password: PASS });
    const c = await request(a).post('/api/2fa/confirm').send({ code: totp.codeAt(s.body.secret, step()) });
    const rc = c.body.recoveryCodes;
    expect((await request(a).post('/api/2fa/disable').send({ password: 'gresit', code: rc[0] })).status).toBe(403);
    expect((await request(a).post('/api/2fa/disable').send({ password: PASS, code: '000000' })).status).toBe(400);
    const d = await request(a).post('/api/2fa/disable').send({ password: PASS, code: rc[1] });
    expect(d.status).toBe(200);
    expect(mails).toContainEqual(['two_factor_disabled', u.email]);
    expect((await request(a).get('/api/2fa/status')).body.enabled).toBe(false);
});
test('incercari repetate de cod → 429 dupa 5 in 10 min', async () => {
    const u = mkUser(); const a = app(u);
    await request(a).post('/api/2fa/setup').send({ password: PASS });
    let last;
    for (let i = 0; i < 6; i++) last = await request(a).post('/api/2fa/confirm').send({ code: '000000' });
    expect(last.status).toBe(429);
});
test('raspunsurile nu contin niciodata secretul criptat sau hash-urile', async () => {
    const u = mkUser(); const a = app(u);
    const s = await request(a).post('/api/2fa/setup').send({ password: PASS });
    await request(a).post('/api/2fa/confirm').send({ code: totp.codeAt(s.body.secret, step()) });
    const st = await request(a).get('/api/2fa/status');
    expect(JSON.stringify(st.body)).not.toMatch(/v1:|secret|recovery_json/);
});
