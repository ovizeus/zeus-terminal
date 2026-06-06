'use strict';

// [2026-06-06] Admin header badge — GET /auth/admin/pending-count
// Operator wants the admin shield icon in the main header to show how many
// registrations await approval (like an unread-messages badge) WITHOUT
// opening the admin panel. Cheap dedicated endpoint (same admin guard as
// /auth/admin/users) so the header can poll it lightly.

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-for-admin-badge';

const request = require('supertest');
const express = require('express');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');

const ADMIN = { id: 1, email: 'admin@example.com', role: 'admin', status: 'active', token_version: 0 };
const USER = { id: 2, email: 'user@example.com', role: 'user', status: 'active', token_version: 0 };

function buildApp(users) {
    jest.resetModules();
    jest.doMock('../../server/services/database', () => ({
        findUserByEmail: (email) => [ADMIN, USER].find(u => u.email === email) || null,
        listUsers: () => users,
        // require-time / unrelated-path helpers used elsewhere in auth.js
        prepare: () => ({ run: () => ({}), get: () => null, all: () => [] }),
    }));
    jest.doMock('../../server/middleware/sessionAuth', () => ({
        getActiveSessions: () => [],
        resetActivity: () => {},
    }));
    const app = express();
    app.use(express.json());
    app.use(cookieParser());
    app.use('/auth', require('../../server/routes/auth.js'));
    return app;
}

function tokenFor(u) {
    return jwt.sign({ id: u.id, email: u.email, role: u.role, tokenVersion: u.token_version }, process.env.JWT_SECRET, { expiresIn: '5m' });
}

const MIXED_USERS = [
    { id: 1, email: 'admin@example.com', role: 'admin', approved: 1 },
    { id: 2, email: 'a@x.com', role: 'user', approved: 1 },
    { id: 3, email: 'b@x.com', role: 'user', approved: 0 },   // pending
    { id: 4, email: 'c@x.com', role: 'user', approved: 0 },   // pending
];

describe('GET /auth/admin/pending-count', () => {
    test('THE FEATURE: admin gets the pending-approval count', async () => {
        const app = buildApp(MIXED_USERS);
        const res = await request(app)
            .get('/auth/admin/pending-count')
            .set('Cookie', 'zeus_token=' + tokenFor(ADMIN));
        expect(res.status).toBe(200);
        expect(res.body).toEqual({ ok: true, count: 2 });
    });

    test('zero pending → count 0', async () => {
        const app = buildApp(MIXED_USERS.map(u => ({ ...u, approved: 1 })));
        const res = await request(app)
            .get('/auth/admin/pending-count')
            .set('Cookie', 'zeus_token=' + tokenFor(ADMIN));
        expect(res.status).toBe(200);
        expect(res.body.count).toBe(0);
    });

    test('non-admin → 403', async () => {
        const app = buildApp(MIXED_USERS);
        const res = await request(app)
            .get('/auth/admin/pending-count')
            .set('Cookie', 'zeus_token=' + tokenFor(USER));
        expect(res.status).toBe(403);
    });

    test('no token → 401', async () => {
        const app = buildApp(MIXED_USERS);
        const res = await request(app).get('/auth/admin/pending-count');
        expect(res.status).toBe(401);
    });
});
