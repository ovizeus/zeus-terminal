'use strict';

// [REAL-GATE P0-3 2026-06-09] Route tests for GET/POST /api/ring5/live-optin.
// Mirrors tests/unit/ml/ring5Routes.test.js supertest pattern; mlLiveOptin mocked.

const path = require('path');
const fs = require('fs');
const os = require('os');

const TEST_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ring5-liveoptin-'));
process.env.ZEUS_DB_PATH = path.join(TEST_DB_DIR, 'test.db');
process.env.ZEUS_TEST_DISABLE_AUTH = '1';

jest.mock('../../server/services/ml/mlLiveOptin', () => ({
    isOptedIn: jest.fn(),
    setOptin: jest.fn()
}));

const express = require('express');
const request = require('supertest');

const mlLiveOptin = require('../../server/services/ml/mlLiveOptin');
const ring5Routes = require('../../server/routes/ring5');

function buildApp(user) {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => { req.user = user; next(); });
    app.use('/api/ring5', ring5Routes);
    return app;
}

describe('Ring5 live-optin self-service routes', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('GET /live-optin', () => {
        test('401 when no authenticated user', async () => {
            const app = buildApp(null);
            const res = await request(app).get('/api/ring5/live-optin');
            expect(res.status).toBe(401);
            expect(res.body.ok).toBe(false);
        });

        test('401 when user has no id', async () => {
            const app = buildApp({ role: 'user' });
            const res = await request(app).get('/api/ring5/live-optin');
            expect(res.status).toBe(401);
        });

        test('returns optedIn state for the authenticated user (no admin required)', async () => {
            mlLiveOptin.isOptedIn.mockReturnValue(false);
            const app = buildApp({ id: 7, role: 'user' });
            const res = await request(app).get('/api/ring5/live-optin');
            expect(res.status).toBe(200);
            expect(res.body).toEqual({ ok: true, optedIn: false });
            expect(mlLiveOptin.isOptedIn).toHaveBeenCalledWith(7);
        });

        test('returns optedIn=true when store says so', async () => {
            mlLiveOptin.isOptedIn.mockReturnValue(true);
            const app = buildApp({ id: 1, role: 'admin' });
            const res = await request(app).get('/api/ring5/live-optin');
            expect(res.body).toEqual({ ok: true, optedIn: true });
        });
    });

    describe('POST /live-optin', () => {
        test('401 when no authenticated user', async () => {
            const app = buildApp(null);
            const res = await request(app)
                .post('/api/ring5/live-optin')
                .send({ optedIn: true });
            expect(res.status).toBe(401);
            expect(mlLiveOptin.setOptin).not.toHaveBeenCalled();
        });

        test('optedIn:true grants via setOptin(uid, true, "api", ip)', async () => {
            mlLiveOptin.setOptin.mockReturnValue({ optedIn: true });
            const app = buildApp({ id: 7, role: 'user' });
            const res = await request(app)
                .post('/api/ring5/live-optin')
                .send({ optedIn: true });
            expect(res.status).toBe(200);
            expect(res.body.ok).toBe(true);
            expect(res.body.optedIn).toBe(true);
            expect(mlLiveOptin.setOptin).toHaveBeenCalledWith(7, true, 'api', expect.anything());
        });

        test('explicit optedIn:false revokes via setOptin(uid, false, "api", ip)', async () => {
            mlLiveOptin.setOptin.mockReturnValue({ optedIn: false });
            const app = buildApp({ id: 7, role: 'user' });
            const res = await request(app)
                .post('/api/ring5/live-optin')
                .send({ optedIn: false });
            expect(res.status).toBe(200);
            expect(res.body.ok).toBe(true);
            expect(mlLiveOptin.setOptin).toHaveBeenCalledWith(7, false, 'api', expect.anything());
        });

        test('missing optedIn is treated as revoke (strict boolean)', async () => {
            mlLiveOptin.setOptin.mockReturnValue({ optedIn: false });
            const app = buildApp({ id: 7, role: 'user' });
            const res = await request(app)
                .post('/api/ring5/live-optin')
                .send({});
            expect(res.status).toBe(200);
            expect(mlLiveOptin.setOptin).toHaveBeenCalledWith(7, false, 'api', expect.anything());
        });

        test('non-boolean optedIn ("true" string) is treated as revoke', async () => {
            mlLiveOptin.setOptin.mockReturnValue({ optedIn: false });
            const app = buildApp({ id: 7, role: 'user' });
            const res = await request(app)
                .post('/api/ring5/live-optin')
                .send({ optedIn: 'true' });
            expect(res.status).toBe(200);
            expect(mlLiveOptin.setOptin).toHaveBeenCalledWith(7, false, 'api', expect.anything());
        });

        test('500 when setOptin throws (atomic audit failure on grant)', async () => {
            mlLiveOptin.setOptin.mockImplementation(() => {
                throw new Error('audit write failed');
            });
            const app = buildApp({ id: 7, role: 'user' });
            const res = await request(app)
                .post('/api/ring5/live-optin')
                .send({ optedIn: true });
            expect(res.status).toBe(500);
            expect(res.body.ok).toBe(false);
            expect(res.body.error).toBe('optin update failed');
        });
    });
});
