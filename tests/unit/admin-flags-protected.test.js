'use strict';

// [P1 2026-06-06] REAL-ladder hole found in the admin audit: the Flags panel
// exposed _SRV_POS_REAL_ENABLED (the master REAL-money switch) as a one-tap
// toggle via POST /auth/admin/flags — no danger confirm (only 5/35 flags have
// one), bypassing the formal flip procedure (operator review + phantom-check).
// Fail-closed fix: a server-side blocklist refuses these keys from the admin
// route entirely; they flip ONLY via the formal operator procedure. GET marks
// them `protected: true` so the UI renders them read-only.

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-for-admin-flags';

const request = require('supertest');
const express = require('express');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');

const ADMIN = { id: 1, email: 'admin@example.com', role: 'admin', status: 'active', token_version: 0 };

function buildApp(mfState) {
    jest.resetModules();
    jest.doMock('../../server/services/database', () => ({
        findUserByEmail: (email) => (email === ADMIN.email ? ADMIN : null),
        listUsers: () => [],
        auditLog: (...a) => { mfState.audits.push(a[1]); },
        prepare: () => ({ run: () => ({}), get: () => null, all: () => [] }),
    }));
    jest.doMock('../../server/middleware/sessionAuth', () => ({
        getActiveSessions: () => [], resetActivity: () => {},
    }));
    jest.doMock('../../server/migrationFlags', () => ({
        DEFAULTS: { SERVER_AT: false, _SRV_POS_REAL_ENABLED: false, _USERDATA_STREAM_REAL_ENABLED: false },
        getAll: () => ({ ...mfState.flags }),
        set: (k, v) => { mfState.flags[k] = v; },
    }));
    const app = express();
    app.use(express.json());
    app.use(cookieParser());
    app.use('/auth', require('../../server/routes/auth.js'));
    return app;
}

function adminCookie() {
    return 'zeus_token=' + jwt.sign(
        { id: ADMIN.id, email: ADMIN.email, role: 'admin', tokenVersion: 0 },
        process.env.JWT_SECRET, { expiresIn: '5m' });
}

describe('P1 — protected flags refuse admin toggling (fail-closed)', () => {
    test('THE FIX: POST _SRV_POS_REAL_ENABLED=true → 403, flag NOT set, attempt audited', async () => {
        const st = { flags: { SERVER_AT: false, _SRV_POS_REAL_ENABLED: false, _USERDATA_STREAM_REAL_ENABLED: false }, audits: [] };
        const app = buildApp(st);
        const res = await request(app).post('/auth/admin/flags')
            .set('Cookie', adminCookie()).set('X-Zeus-Request', '1')
            .send({ key: '_SRV_POS_REAL_ENABLED', value: true });
        expect(res.status).toBe(403);
        expect(st.flags._SRV_POS_REAL_ENABLED).toBe(false);          // NOT flipped
        expect(st.audits).toContain('ADMIN_FLAG_TOGGLE_BLOCKED');    // attempt recorded
    });

    test('THE FIX: _USERDATA_STREAM_REAL_ENABLED equally refused', async () => {
        const st = { flags: { SERVER_AT: false, _SRV_POS_REAL_ENABLED: false, _USERDATA_STREAM_REAL_ENABLED: false }, audits: [] };
        const app = buildApp(st);
        const res = await request(app).post('/auth/admin/flags')
            .set('Cookie', adminCookie()).set('X-Zeus-Request', '1')
            .send({ key: '_USERDATA_STREAM_REAL_ENABLED', value: true });
        expect(res.status).toBe(403);
        expect(st.flags._USERDATA_STREAM_REAL_ENABLED).toBe(false);
    });

    test('non-protected flag still toggles (existing behaviour intact)', async () => {
        const st = { flags: { SERVER_AT: false, _SRV_POS_REAL_ENABLED: false, _USERDATA_STREAM_REAL_ENABLED: false }, audits: [] };
        const app = buildApp(st);
        const res = await request(app).post('/auth/admin/flags')
            .set('Cookie', adminCookie()).set('X-Zeus-Request', '1')
            .send({ key: 'SERVER_AT', value: true });
        expect(res.status).toBe(200);
        expect(st.flags.SERVER_AT).toBe(true);
    });

    test('GET /auth/admin/flags marks protected keys with protected:true', async () => {
        const st = { flags: { SERVER_AT: false, _SRV_POS_REAL_ENABLED: false, _USERDATA_STREAM_REAL_ENABLED: false }, audits: [] };
        const app = buildApp(st);
        const res = await request(app).get('/auth/admin/flags').set('Cookie', adminCookie());
        expect(res.status).toBe(200);
        const byKey = Object.fromEntries(res.body.flags.map(f => [f.key, f]));
        expect(byKey._SRV_POS_REAL_ENABLED.protected).toBe(true);
        expect(byKey._USERDATA_STREAM_REAL_ENABLED.protected).toBe(true);
        expect(byKey.SERVER_AT.protected).toBeFalsy();
    });
});
