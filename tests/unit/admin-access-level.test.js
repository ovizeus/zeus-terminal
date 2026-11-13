'use strict';
// [BETA-GATE 2026-11-13] Ruta care ridica un cont de la view-only la acces
// complet deschide tradingul pentru el. Doar adminul o poate chema.
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-for-access-level';

const request = require('supertest');
const express = require('express');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');

const USERS = () => ({
    'admin@example.com': { id: 1, email: 'admin@example.com', role: 'admin', status: 'active', token_version: 0, access_level: 'full' },
    'second@example.com': { id: 3, email: 'second@example.com', role: 'admin', status: 'active', token_version: 0, access_level: 'full' },
    'user@example.com': { id: 2, email: 'user@example.com', role: 'user', status: 'active', token_version: 0, access_level: 'full' },
    'new@example.com': { id: 21, email: 'new@example.com', role: 'user', status: 'active', token_version: 0, access_level: 'viewer' },
});

function buildApp(st) {
    jest.resetModules();
    jest.doMock('../../server/services/database', () => ({
        findUserByEmail: (email) => st.users[email] || null,
        findUserById: (id) => Object.values(st.users).find((u) => u.id === id) || null,
        listUsers: () => Object.values(st.users),
        setAccessLevel: (id, level) => { const u = Object.values(st.users).find((x) => x.id === id); u.access_level = level; st.sets.push([id, level]); },
        auditLog: (...a) => { st.audits.push([a[1], a[2]]); },
        prepare: () => ({ run: () => ({}), get: () => null, all: () => [] }),
    }));
    jest.doMock('../../server/middleware/sessionAuth', () => ({ getActiveSessions: () => [], resetActivity: () => {} }));
    const app = express();
    app.use(express.json());
    app.use(cookieParser());
    app.use('/auth', require('../../server/routes/auth.js'));
    return app;
}
const cookie = (u) => 'zeus_token=' + jwt.sign({ id: u.id, email: u.email, role: u.role, tokenVersion: 0 }, process.env.JWT_SECRET, { expiresIn: '5m' });
const post = (app, who, body) => {
    const r = request(app).post('/auth/admin/access-level').set('X-Zeus-Request', '1');
    return (who ? r.set('Cookie', cookie(who)) : r).send(body);
};

describe('POST /auth/admin/access-level', () => {
    let st, app;
    beforeEach(() => { st = { users: USERS(), sets: [], audits: [] }; app = buildApp(st); });

    test('adminul ridica un cont la full si ramane urma in audit', async () => {
        const res = await post(app, st.users['admin@example.com'], { email: 'New@Example.com ', level: 'full' });
        expect(res.status).toBe(200);
        expect(res.body).toEqual({ ok: true, accessLevel: 'full' });
        expect(st.sets).toEqual([[21, 'full']]);
        expect(st.audits).toEqual([['ADMIN_ACCESS_LEVEL', { targetId: 21, from: 'viewer', to: 'full' }]]);
    });

    test('adminul il poate cobori inapoi', async () => {
        const res = await post(app, st.users['admin@example.com'], { email: 'user@example.com', level: 'viewer' });
        expect(res.status).toBe(200);
        expect(st.sets).toEqual([[2, 'viewer']]);
    });

    test('⛔ un user obisnuit nu-si poate ridica singur accesul', async () => {
        const res = await post(app, st.users['new@example.com'], { email: 'new@example.com', level: 'full' });
        expect(res.status).toBe(403);
        expect(st.sets).toEqual([]);
        expect(st.users['new@example.com'].access_level).toBe('viewer');
    });

    test('⛔ nici un user cu acces complet nu poate ridica pe altul', async () => {
        const res = await post(app, st.users['user@example.com'], { email: 'new@example.com', level: 'full' });
        expect(res.status).toBe(403);
        expect(st.sets).toEqual([]);
    });

    test('⛔ fara sesiune: 401', async () => {
        expect((await post(app, null, { email: 'new@example.com', level: 'full' })).status).toBe(401);
        expect(st.sets).toEqual([]);
    });

    test('⛔ doar cele doua valori; un nivel inventat e refuzat', async () => {
        for (const level of ['admin', 'FULL', '', undefined, 1]) {
            const res = await post(app, st.users['admin@example.com'], { email: 'new@example.com', level });
            expect([level, res.status]).toEqual([level, 400]);
        }
        expect(st.sets).toEqual([]);
    });

    test('accesul unui admin nu se schimba de aici; cont inexistent = 404', async () => {
        expect((await post(app, st.users['admin@example.com'], { email: 'second@example.com', level: 'viewer' })).status).toBe(400);
        expect((await post(app, st.users['admin@example.com'], { email: 'ghost@example.com', level: 'full' })).status).toBe(404);
        expect(st.sets).toEqual([]);
    });

    test('lista de utilizatori si /auth/me poarta nivelul', async () => {
        const list = await request(app).get('/auth/admin/users').set('Cookie', cookie(st.users['admin@example.com']));
        expect(list.status).toBe(200);
        const by = Object.fromEntries((list.body.users || list.body).map((u) => [u.email, u.accessLevel]));
        expect(by).toMatchObject({ 'admin@example.com': 'full', 'user@example.com': 'full', 'new@example.com': 'viewer' });
        const me = await request(app).get('/auth/me').set('Cookie', cookie(st.users['new@example.com']));
        expect(me.body.accessLevel).toBe('viewer');
        const meFull = await request(app).get('/auth/me').set('Cookie', cookie(st.users['user@example.com']));
        expect(meFull.body.accessLevel).toBe('full');
    });
});
