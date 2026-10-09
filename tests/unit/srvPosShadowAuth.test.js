'use strict';
// [2026-10-09 audit B1] POST /api/srv-pos/shadow-report took UNAUTHENTICATED
// writes from the public internet. Confirmed live against zeus-terminal.com:
//   curl -X POST -H 'x-zeus-request: 1' -d '{"count":0}' .../shadow-report -> 200
// The router is mounted before the global session auth, and its only remote
// guard was the constant header `x-zeus-request: 1`. That header is CSRF
// protection — it stops a browser posting cross-origin — but it is not
// authentication and does not slow curl down at all. The neighbouring
// /orphan-report route verifies the JWT cookie and answers 401, so the gap was
// an oversight rather than a decision.
//
// The buffer holds 100 reports at 5/min per IP, so roughly twenty minutes of
// posting evicts every genuine divergence report — the evidence the
// server-authoritative positions migration would be judged on.
//
// The existing route tests all pass because supertest connects from 127.0.0.1,
// where the localhost branch applies. These drive a REMOTE caller.

const express = require('express');
const request = require('supertest');

let app, router;

beforeEach(() => {
    jest.resetModules();
    jest.doMock('../../server/services/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));
    router = require('../../server/routes/srvPos');
    router._resetForTest();
    app = express();
    app.set('trust proxy', true);   // so X-Forwarded-For decides req.ip, as in production
    app.use('/api/srv-pos', router);
});

const REMOTE = '8.8.8.8';

describe('POST /api/srv-pos/shadow-report — remote callers must authenticate', () => {
    test('a remote caller with the constant header but no session is refused', async () => {
        const res = await request(app)
            .post('/api/srv-pos/shadow-report')
            .set('X-Forwarded-For', REMOTE)
            .set('x-zeus-request', '1')
            .send({ ts: Date.now(), count: 3, vectors: { v1: 1 } });

        expect(res.status).toBe(401);
    });

    test('a refused report never reaches the buffer', async () => {
        await request(app)
            .post('/api/srv-pos/shadow-report')
            .set('X-Forwarded-For', REMOTE)
            .set('x-zeus-request', '1')
            .send({ ts: Date.now(), count: 9 });

        // /status is localhost-only, so read it as localhost.
        const status = await request(app).get('/api/srv-pos/status');
        expect(status.status).toBe(200);
        expect(status.body.shadow.reportsCollected).toBe(0);
    });

    test('localhost still posts without a session (operator curl diagnostics)', async () => {
        const res = await request(app)
            .post('/api/srv-pos/shadow-report')
            .send({ ts: Date.now(), count: 1 });

        expect(res.status).toBe(200);
    });
});
