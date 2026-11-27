'use strict';
// [2026-11-27] Securitate etapa 2 — rolul din sesiune vine din BAZA, nu din token.
// Gasit: sessionAuth punea req.user = tokenul decodat, deci `role` era cel de la LOGIN. Un admin
// retrogradat ramanea admin (token valabil zile) pe toate rutele care citesc req.user.role
// (ring5, doctor, byoi...). Si: /auth/admin/* sarea peste verificarea de inactivitate.
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-session-role';
const request = require('supertest');
const express = require('express');
const jwt = require('jsonwebtoken');

function build(dbUser, lastActive) {
    jest.resetModules();
    const audits = [];
    jest.doMock('../../server/services/database', () => ({
        findUserById: () => dbUser,
        findUserByEmail: () => dbUser,
        getLastActiveAt: () => lastActive,
        setLastActiveAt: () => {},
        auditLog: (_u, a) => audits.push(a),
    }));
    const { createSessionAuth, cookieParser } = require('../../server/middleware/sessionAuth');
    const app = express();
    app.use(cookieParser());
    app.use(createSessionAuth(process.env.JWT_SECRET));
    // /auth/ e public in sessionAuth (rutele de admin isi verifica singure sesiunea) → garda de inactivitate separata
    app.use('/auth/admin', require('../../server/middleware/sessionAuth').createAdminIdleGuard(process.env.JWT_SECRET));
    app.get('/api/whoami', (req, res) => res.json({ role: req.user.role }));
    app.get('/auth/admin/ping', (req, res) => res.json({ ok: true }));
    return { app, audits };
}
const cookie = (role) => 'zeus_token=' + jwt.sign({ id: 7, email: 'a@b.co', role, tokenVersion: 1 }, process.env.JWT_SECRET, { expiresIn: '5m' });

describe('sesiunea foloseste rolul din baza', () => {
    test('token „admin", baza „user" → req.user.role = user', async () => {
        const { app } = build({ id: 7, role: 'user', status: 'active', token_version: 1 }, Date.now());
        const r = await request(app).get('/api/whoami').set('Cookie', cookie('admin'));
        expect(r.status).toBe(200);
        expect(r.body.role).toBe('user');
    });
    test('rol lipsa in baza → user (niciodata rolul din token)', async () => {
        const { app } = build({ id: 7, status: 'active', token_version: 1 }, Date.now());
        const r = await request(app).get('/api/whoami').set('Cookie', cookie('admin'));
        expect(r.body.role).toBe('user');
    });
    test('admin real ramane admin', async () => {
        const { app } = build({ id: 7, role: 'admin', status: 'active', token_version: 1 }, Date.now());
        const r = await request(app).get('/api/whoami').set('Cookie', cookie('admin'));
        expect(r.body.role).toBe('admin');
    });
});

describe('/auth/admin/* respecta inactivitatea', () => {
    test('sesiune inactiva de 5 ore → 401 si pe rutele de admin', async () => {
        const { app, audits } = build({ id: 7, role: 'admin', status: 'active', token_version: 1 }, Date.now() - 5 * 3600000);
        const r = await request(app).get('/auth/admin/ping').set('Cookie', cookie('admin'));
        expect(r.status).toBe(401);
        expect(audits).toContain('INACTIVITY_TIMEOUT');
    });
    test('fara token sau token invalid → garda lasa ruta sa raspunda singura (nu ghiceste)', async () => {
        const { app } = build(null, Date.now() - 5 * 3600000);
        const r = await request(app).get('/auth/admin/ping').set('Cookie', 'zeus_token=gunoi');
        expect(r.status).toBe(200);
    });
    test('auth.js monteaza garda INAINTEA primei rute de admin', () => {
        const src = require('fs').readFileSync(require('path').join(__dirname, '../../server/routes/auth.js'), 'utf8');
        const g = src.indexOf("router.use('/admin', createAdminIdleGuard(");
        const first = src.search(/router\.(get|post|put|delete)\('\/admin/);
        expect(g).toBeGreaterThan(0);
        expect(g).toBeLessThan(first);
    });
    test('sesiune activa → trece', async () => {
        const { app } = build({ id: 7, role: 'admin', status: 'active', token_version: 1 }, Date.now());
        const r = await request(app).get('/auth/admin/ping').set('Cookie', cookie('admin'));
        expect(r.status).toBe(200);
    });
});
