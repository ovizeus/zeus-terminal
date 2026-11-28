'use strict';
// [2026-11-28] /api/passkeys — passkey-urile contului (montat dupa sessionAuth). Baza reala izolata +
// criptografie reala (telefon software); emailurile prinse.
const fs = require('fs'); const os = require('os'); const path = require('path');
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || 'c'.repeat(64);
const request = require('supertest');
const express = require('express');
const bcrypt = require('bcryptjs');
const { createSoftAuthenticator } = require('../helpers/softAuthenticator');

const PASS = 'Corect-Parola-1';
const ORIGIN = 'https://zeus-terminal.com';
let db, totp, tf, mails;
beforeAll(() => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'zeus-passkey-routes-'));
    process.env.ZEUS_DB_PATH = path.join(tmp, 'test.db');
    process.env.PASSKEY_ENABLED = 'true';
    db = require('../../server/services/database');
    totp = require('../../server/services/totp');
    tf = require('../../server/services/twoFactor');
    mails = [];
    jest.doMock('../../server/services/accountEmails', () => ({ sendAccountEmail: async (k, e, o) => { mails.push([k, e, o && o.data]); return true; } }));
});
afterAll(() => { delete process.env.PASSKEY_ENABLED; });
let n = 0;
function mkUser() {
    const email = `p${Date.now()}${++n}@x.ro`;
    db.createUser(email, bcrypt.hashSync(PASS, 4), 'user');
    return db.findUserByEmail(email);
}
function app(user) {
    const a = express();
    a.use(express.json());
    a.use((req, _res, next) => { req.user = user ? { id: user.id, email: user.email, role: 'user' } : undefined; next(); });
    a.use('/api/passkeys', require('../../server/routes/passkeys'));
    return a;
}
async function add(u, a, body) {
    const o = await request(app(u)).post('/api/passkeys/register/options').send({ password: PASS, ...(body || {}) });
    if (o.status !== 200) return o;
    return request(app(u)).post('/api/passkeys/register/verify').send({ response: a.register(o.body.options), name: 'Laptop' });
}
const auditOf = (uid) => db.db.prepare('SELECT action FROM audit_log WHERE user_id = ? ORDER BY id').all(uid).map((r) => r.action);

test('fara sesiune → 401', async () => {
    expect((await request(app(null)).get('/api/passkeys')).status).toBe(401);
});
test('lista initiala goala; spune ca e pornit', async () => {
    const u = mkUser();
    expect((await request(app(u)).get('/api/passkeys')).body).toEqual({ ok: true, enabled: true, needsCode: false, passkeys: [] });
});
test('adaugarea cere PAROLA corecta', async () => {
    const u = mkUser();
    const r = await request(app(u)).post('/api/passkeys/register/options').send({ password: 'gresit' });
    expect(r.status).toBe(403);
    expect(auditOf(u.id)).toContain('PASSKEY_ADD_BAD_PASSWORD');
});
test('flux complet: parola → telefonul semneaza → salvat; audit + email; apare in lista', async () => {
    const u = mkUser(); const a = createSoftAuthenticator({ rpID: 'zeus-terminal.com', origin: ORIGIN });
    const r = await add(u, a);
    expect(r.status).toBe(200);
    expect(auditOf(u.id)).toContain('PASSKEY_ADDED');
    expect(mails).toContainEqual(['passkey_added', u.email, { name: 'Laptop' }]);
    const l = await request(app(u)).get('/api/passkeys');
    expect(l.body.passkeys).toHaveLength(1);
    expect(l.body.passkeys[0]).toMatchObject({ name: 'Laptop', lastUsedAt: null });
    expect(JSON.stringify(l.body)).not.toContain('public');   // cheia nu pleaca spre client
});
test('cu 2FA pornit, adaugarea cere SI codul din aplicatie', async () => {
    const u = mkUser();
    const s = tf.beginSetup(u.id, u.email);
    tf.confirmSetup(u.id, totp.codeAt(s.secret, Math.floor(Date.now() / 30000) - 1));
    expect((await request(app(u)).get('/api/passkeys')).body.needsCode).toBe(true);
    const noCode = await request(app(u)).post('/api/passkeys/register/options').send({ password: PASS });
    expect(noCode.status).toBe(403);
    expect(noCode.body.code).toBe('TOTP_INVALID');
    const ok = await request(app(u)).post('/api/passkeys/register/options')
        .send({ password: PASS, code: totp.codeAt(s.secret, Math.floor(Date.now() / 30000)) });
    expect(ok.status).toBe(200);
});
test('stergerea cere parola; audit + email; altcineva nu poate sterge', async () => {
    const u = mkUser(); const other = mkUser(); const a = createSoftAuthenticator({ rpID: 'zeus-terminal.com', origin: ORIGIN });
    const r = await add(u, a);
    const id = r.body.id;
    expect((await request(app(u)).post('/api/passkeys/remove').send({ id, password: 'gresit' })).status).toBe(403);
    expect((await request(app(other)).post('/api/passkeys/remove').send({ id, password: PASS })).status).toBe(404);
    const ok = await request(app(u)).post('/api/passkeys/remove').send({ id, password: PASS });
    expect(ok.status).toBe(200);
    expect(auditOf(u.id)).toContain('PASSKEY_REMOVED');
    expect(mails.some((m) => m[0] === 'passkey_removed' && m[1] === u.email)).toBe(true);
    expect((await request(app(u)).get('/api/passkeys')).body.passkeys).toHaveLength(0);
});
test('limita: 5 parole gresite / 10 min → 429', async () => {
    const u = mkUser();
    let last;
    for (let i = 0; i < 6; i++) last = await request(app(u)).post('/api/passkeys/register/options').send({ password: 'gresit' });
    expect(last.status).toBe(429);
});
test('passkey nou → cheile de exchange intra in pauza de 24 h (ca la parola schimbata)', async () => {
    const u = mkUser(); const a = createSoftAuthenticator({ rpID: 'zeus-terminal.com', origin: ORIGIN });
    await add(u, a);
    const g = require('../../server/services/exchangeKeyGuard');
    expect(g.HOLD_ACTIONS).toContain('PASSKEY_ADDED');
    expect(g.check(u.id, {}).ok).toBe(false);
});
test('stins → GET enabled:false, POST 404', async () => {
    const u = mkUser();
    process.env.PASSKEY_ENABLED = 'false';
    try {
        expect((await request(app(u)).get('/api/passkeys')).body.enabled).toBe(false);
        expect((await request(app(u)).post('/api/passkeys/register/options').send({ password: PASS })).status).toBe(404);
    } finally { process.env.PASSKEY_ENABLED = 'true'; }
});
test('contul sters isi pierde passkey-urile', async () => {
    const u = mkUser(); const a = createSoftAuthenticator({ rpID: 'zeus-terminal.com', origin: ORIGIN });
    await add(u, a);
    expect(db.passkeyCount(u.id)).toBe(1);
    db.deleteUser(u.email);
    expect(db.passkeyCount(u.id)).toBe(0);
});
