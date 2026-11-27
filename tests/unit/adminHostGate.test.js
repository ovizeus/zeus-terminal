'use strict';
// [2026-11-27] Etapa 2 — admin pe subdomeniu separat (admin.zeus-terminal.com, cu Cloudflare Access in fata).
// INACTIV pana cand operatorul pune ADMIN_HOST in .env. Activ: rutele de admin raspund 404 pe orice alt domeniu,
// ca Access sa nu poata fi ocolit prin domeniul principal. Hostul se ia din antetul Host (pus de nginx), NU
// din X-Forwarded-Host (pe care il poate trimite oricine).
const request = require('supertest');
const express = require('express');
const { createAdminHostGate, adminHostOf } = require('../../server/middleware/adminHostGate');

function app(host) {
    const a = express();
    a.set('trust proxy', 1);
    a.use(createAdminHostGate(() => host));
    a.get('/auth/admin/users', (_q, r) => r.json({ ok: true }));
    a.get('/api/admin/x', (_q, r) => r.json({ ok: true }));
    a.get('/api/market/klines', (_q, r) => r.json({ ok: true }));
    a.get('/auth/me', (_q, r) => r.json({ ok: true }));
    return a;
}

test('fara ADMIN_HOST: nimic nu se schimba', async () => {
    expect((await request(app(null)).get('/auth/admin/users').set('Host', 'zeus-terminal.com')).status).toBe(200);
});
test('cu ADMIN_HOST: admin pe domeniul principal → 404', async () => {
    const a = app('admin.zeus-terminal.com');
    expect((await request(a).get('/auth/admin/users').set('Host', 'zeus-terminal.com')).status).toBe(404);
    expect((await request(a).get('/api/admin/x').set('Host', 'zeus-terminal.com')).status).toBe(404);
});
test('cu ADMIN_HOST: admin pe subdomeniu → trece (si cu port)', async () => {
    const a = app('admin.zeus-terminal.com');
    expect((await request(a).get('/auth/admin/users').set('Host', 'admin.zeus-terminal.com')).status).toBe(200);
    expect((await request(a).get('/auth/admin/users').set('Host', 'ADMIN.zeus-terminal.com:443')).status).toBe(200);
});
test('X-Forwarded-Host falsificat NU deschide poarta', async () => {
    const a = app('admin.zeus-terminal.com');
    const r = await request(a).get('/auth/admin/users').set('Host', 'zeus-terminal.com').set('X-Forwarded-Host', 'admin.zeus-terminal.com');
    expect(r.status).toBe(404);
});
test('restul aplicatiei merge pe ambele domenii', async () => {
    const a = app('admin.zeus-terminal.com');
    for (const h of ['zeus-terminal.com', 'admin.zeus-terminal.com']) {
        expect((await request(a).get('/api/market/klines').set('Host', h)).status).toBe(200);
        expect((await request(a).get('/auth/me').set('Host', h)).status).toBe(200);
    }
});
test('adminHostOf: doar un nume de host valid din .env, altfel null', () => {
    expect(adminHostOf({ ADMIN_HOST: 'admin.zeus-terminal.com' })).toBe('admin.zeus-terminal.com');
    expect(adminHostOf({ ADMIN_HOST: ' Admin.Zeus-Terminal.com ' })).toBe('admin.zeus-terminal.com');
    expect(adminHostOf({ ADMIN_HOST: 'https://x/y' })).toBeNull();
    expect(adminHostOf({})).toBeNull();
});

test('server.js monteaza poarta INAINTEA rutelor /auth si a celor /api', () => {
    const src = require('fs').readFileSync(require('path').join(__dirname, '../../server.js'), 'utf8');
    const g = src.indexOf('createAdminHostGate(');
    expect(g).toBeGreaterThan(0);
    expect(g).toBeLessThan(src.indexOf("app.use('/auth', authRoutes)"));
});
