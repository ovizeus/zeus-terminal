'use strict';
// [2026-11-22] Notificari pe telefon: cheia telefonului, ce e „important", cine vede ce.
const path = require('path');
const fs = require('fs');
const os = require('os');
const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'notify-dev-'));
process.env.ZEUS_DB_PATH = path.join(DIR, 'test.db');
process.env.ZEUS_TEST_DISABLE_AUTH = '1';

const { db } = require('../../server/services/database');
const ND = require('../../server/services/notifyDevices');
const express = require('express');
const request = require('supertest');

function user(id, role = 'user', approved = 1, status = 'active') {
    db.prepare('INSERT OR REPLACE INTO users (id, email, password_hash, role, approved, status) VALUES (?, ?, ?, ?, ?, ?)')
        .run(id, `u${id}@t.local`, 'x', role, approved, status);
}
function msg(userId, sender, text, readUser = 0, readAdmin = 0) {
    db.prepare('INSERT INTO support_messages (user_id, sender, message, read_by_user, read_by_admin) VALUES (?, ?, ?, ?, ?)').run(userId, sender, text, readUser, readAdmin);
}
beforeEach(() => {
    db.prepare('DELETE FROM notify_devices').run();
    db.prepare('DELETE FROM support_messages').run();
    db.prepare('DELETE FROM users').run();
    user(1, 'admin'); user(2); user(3, 'user', 0, 'pending');
});
afterAll(() => { try { db.close(); } catch (_) {} try { fs.rmSync(DIR, { recursive: true, force: true }); } catch (_) {} });

test('cheia se intoarce o data; in baza ramane doar hash-ul', () => {
    const t = ND.register(2);
    expect(t.length).toBeGreaterThan(30);
    const row = db.prepare('SELECT token_hash FROM notify_devices').get();
    expect(row.token_hash).not.toBe(t);
    expect(row.token_hash).toBe(ND._hash(t));
    expect(ND.userForToken(t)).toEqual({ userId: 2, isAdmin: false });
    expect(ND.userForToken('x'.repeat(40))).toBeNull();
});

test('utilizator: doar raspunsurile suportului NECITITE, ale lui', () => {
    msg(2, 'admin', 'Your deposit was credited.'); msg(2, 'admin', 'old', 1); msg(2, 'user', 'hello');
    msg(5, 'admin', 'someone else');
    const p = ND.pending(2, false);
    expect(p.badge).toBe(1);
    expect(p.items).toEqual([{ id: expect.stringMatching(/^sup-reply:/), kind: 'support', title: 'Zeus Support replied', body: 'Your deposit was credited.' }]);
});

test('admin: mesajele utilizatorilor necitite + conturile de aprobat (ca bulina ADMIN)', () => {
    msg(2, 'user', 'I cannot log in, help please'); msg(2, 'user', 'seen', 0, 1);
    const p = ND.pending(1, true);
    expect(p.badge).toBe(2);
    expect(p.items.map((i) => i.kind).sort()).toEqual(['approval', 'support']);
    expect(p.items.find((i) => i.kind === 'approval').id).toBe('approve:3');
});

test('cheie revocata sau cont inactiv → nimic', () => {
    const t = ND.register(2);
    ND.revoke(t);
    expect(ND.userForToken(t)).toBeNull();
    const t2 = ND.register(3);
    expect(ND.userForToken(t2)).toBeNull(); // status pending
});

test('rutele: /register cere sesiune; /pending merge DOAR cu cheia', async () => {
    const app = express();
    app.use((req, _res, next) => { if (req.get('x-test-user')) req.user = { id: Number(req.get('x-test-user')) }; next(); });
    app.use('/api/notify', require('../../server/routes/notify'));
    await request(app).post('/api/notify/register').expect(401);
    const r = await request(app).post('/api/notify/register').set('x-test-user', '2').expect(200);
    msg(2, 'admin', 'Reply');
    await request(app).get('/api/notify/pending').expect(401);
    const p = await request(app).get('/api/notify/pending').set('X-Zeus-Notify-Token', r.body.token).expect(200);
    expect(p.body.badge).toBe(1);
    expect(p.headers['cache-control']).toBe('no-store');
});

test('sessionAuth lasa publice doar /pending si /revoke, nu /register', () => {
    const src = fs.readFileSync(path.join(__dirname, '../../server/middleware/sessionAuth.js'), 'utf8');
    expect(src).toMatch(/'\/api\/notify\/pending'/);
    expect(src).toMatch(/'\/api\/notify\/revoke'/);
    expect(src).not.toMatch(/'\/api\/notify\/register'/);
    expect(src).not.toMatch(/'\/api\/notify\/'/);
});

test('notificarea de proba: doar contul ales, o singura data, fisierul se sterge', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'notify-tst-'));
    process.env.ZEUS_NOTIFY_TEST_DIR = dir;
    const f = path.join(dir, 'notify-test.json');
    fs.writeFileSync(f, JSON.stringify({ userId: 1, title: 'Zeus test', body: 'Merge!' }));
    expect(ND.pending(2, false).items.find((i) => i.kind === 'test')).toBeUndefined();
    expect(fs.existsSync(f)).toBe(true);
    const p = ND.pending(1, true);
    expect(p.items[0]).toMatchObject({ kind: 'test', title: 'Zeus test', body: 'Merge!' });
    expect(p.badge).toBeGreaterThanOrEqual(1);
    expect(fs.existsSync(f)).toBe(false);
    expect(ND.pending(1, true).items.find((i) => i.kind === 'test')).toBeUndefined();
    delete process.env.ZEUS_NOTIFY_TEST_DIR;
    fs.rmSync(dir, { recursive: true, force: true });
});
