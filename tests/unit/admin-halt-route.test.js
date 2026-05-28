'use strict';

// Task B — POST/GET /api/admin/halt endpoint
// Verifies admin auth, 400 validation, 200 success, 401 unauth, 403 non-admin.

const express = require('express');
const supertest = require('supertest');
const path = require('path');

jest.mock(path.resolve(__dirname, '../../server/services/serverAT'), () => ({
    setGlobalHalt: jest.fn((active, byUid, reason) => ({ active, by: byUid, reason, ts: Date.now() })),
    getGlobalHaltState: jest.fn(() => ({ active: false, by: null, ts: null, reason: null })),
}));

describe('POST/GET /api/admin/halt', () => {
    let app, serverAT;

    beforeEach(() => {
        jest.resetModules();
        jest.clearAllMocks();
        jest.doMock(path.resolve(__dirname, '../../server/services/serverAT'), () => ({
            setGlobalHalt: jest.fn((active, byUid, reason) => ({ active, by: byUid, reason, ts: Date.now() })),
            getGlobalHaltState: jest.fn(() => ({ active: false, by: null, ts: null, reason: null })),
        }));
        serverAT = require('../../server/services/serverAT');
        app = express();
        app.use(express.json());
        app.use((req, res, next) => {
            const role = req.headers['x-test-role'];
            const id = parseInt(req.headers['x-test-uid'], 10) || 0;
            if (id) req.user = { id, role: role || 'user' };
            next();
        });
        app.use('/api/admin', require('../../server/routes/admin'));
    });

    test('admin can arm halt with reason', async () => {
        const res = await supertest(app)
            .post('/api/admin/halt')
            .set('x-test-role', 'admin').set('x-test-uid', '1')
            .send({ active: true, reason: 'monitoring_alert' });
        expect(res.status).toBe(200);
        expect(serverAT.setGlobalHalt).toHaveBeenCalledWith(true, 1, 'monitoring_alert');
        expect(res.body.ok).toBe(true);
        expect(res.body.halt).toMatchObject({ active: true, by: 1, reason: 'monitoring_alert' });
    });

    test('admin can disarm halt', async () => {
        const res = await supertest(app)
            .post('/api/admin/halt')
            .set('x-test-role', 'admin').set('x-test-uid', '1')
            .send({ active: false, reason: 'all_clear' });
        expect(res.status).toBe(200);
        expect(serverAT.setGlobalHalt).toHaveBeenCalledWith(false, 1, 'all_clear');
    });

    test('admin without reason uses admin_api default', async () => {
        const res = await supertest(app)
            .post('/api/admin/halt')
            .set('x-test-role', 'admin').set('x-test-uid', '1')
            .send({ active: true });
        expect(res.status).toBe(200);
        expect(serverAT.setGlobalHalt).toHaveBeenCalledWith(true, 1, 'admin_api');
    });

    test('non-admin gets 403', async () => {
        const res = await supertest(app)
            .post('/api/admin/halt')
            .set('x-test-role', 'user').set('x-test-uid', '2')
            .send({ active: true });
        expect(res.status).toBe(403);
        expect(serverAT.setGlobalHalt).not.toHaveBeenCalled();
    });

    test('unauthenticated gets 401', async () => {
        const res = await supertest(app).post('/api/admin/halt').send({ active: true });
        expect(res.status).toBe(401);
        expect(serverAT.setGlobalHalt).not.toHaveBeenCalled();
    });

    test('missing active field returns 400', async () => {
        const res = await supertest(app)
            .post('/api/admin/halt')
            .set('x-test-role', 'admin').set('x-test-uid', '1')
            .send({ reason: 'x' });
        expect(res.status).toBe(400);
        expect(serverAT.setGlobalHalt).not.toHaveBeenCalled();
    });

    test('non-boolean active returns 400', async () => {
        const res = await supertest(app)
            .post('/api/admin/halt')
            .set('x-test-role', 'admin').set('x-test-uid', '1')
            .send({ active: 'yes' });
        expect(res.status).toBe(400);
    });

    test('reason field truncated to 200 chars', async () => {
        const longReason = 'X'.repeat(500);
        const res = await supertest(app)
            .post('/api/admin/halt')
            .set('x-test-role', 'admin').set('x-test-uid', '1')
            .send({ active: true, reason: longReason });
        expect(res.status).toBe(200);
        const callArgs = serverAT.setGlobalHalt.mock.calls[0];
        expect(callArgs[2].length).toBeLessThanOrEqual(200);
    });

    test('GET /api/admin/halt returns current state', async () => {
        const res = await supertest(app)
            .get('/api/admin/halt')
            .set('x-test-role', 'admin').set('x-test-uid', '1');
        expect(res.status).toBe(200);
        expect(res.body).toHaveProperty('active');
        expect(serverAT.getGlobalHaltState).toHaveBeenCalled();
    });

    test('GET non-admin gets 403', async () => {
        const res = await supertest(app)
            .get('/api/admin/halt')
            .set('x-test-role', 'user').set('x-test-uid', '2');
        expect(res.status).toBe(403);
    });

    test('setGlobalHalt throw returns 500', async () => {
        serverAT.setGlobalHalt.mockImplementation(() => { throw new Error('db locked'); });
        const res = await supertest(app)
            .post('/api/admin/halt')
            .set('x-test-role', 'admin').set('x-test-uid', '1')
            .send({ active: true });
        expect(res.status).toBe(500);
        expect(res.body.error).toMatch(/db locked/);
    });
});
