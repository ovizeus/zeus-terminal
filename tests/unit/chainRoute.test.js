'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');

const TEST_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'chain-route-'));
process.env.ZEUS_DB_PATH = path.join(TEST_DB_DIR, 'test.db');
process.env.ZEUS_TEST_DISABLE_AUTH = '1';

const express = require('express');
const request = require('supertest');
const { db } = require('../../server/services/database');
const omegaRoutes = require('../../server/routes/omega');
const chain = require('../../server/services/ml/_audit/chainedTrail');

function makeApp() {
    const app = express();
    app.use((req, _res, next) => { req.user = { id: 1 }; next(); });
    app.use('/api/omega', omegaRoutes);
    return app;
}

describe('audit chain routes', () => {
    let app;
    beforeAll(() => {
        app = makeApp();
        db.prepare("DELETE FROM ml_audit_chain").run();
        try { db.prepare("DELETE FROM sqlite_sequence WHERE name='ml_audit_chain'").run(); } catch (_) {}
    });

    test('GET /audit/chain/head returns null when empty', async () => {
        const r = await request(app).get('/api/omega/audit/chain/head').expect(200);
        expect(r.body.ok).toBe(true);
        expect(r.body.head).toBeNull();
    });

    test('GET /audit/chain/recent returns entries', async () => {
        chain.append({ kind: 'TEST', payload: { v: 1 } });
        chain.append({ kind: 'TEST', payload: { v: 2 } });
        const r = await request(app).get('/api/omega/audit/chain/recent').expect(200);
        expect(r.body.entries.length).toBe(2);
    });

    test('GET /audit/chain/verify returns ok=true for clean chain', async () => {
        const r = await request(app).get('/api/omega/audit/chain/verify').expect(200);
        expect(r.body.ok).toBe(true);
        expect(r.body.result.ok).toBe(true);
    });

    test('GET /audit/chain/verify detects tampering', async () => {
        db.prepare("UPDATE ml_audit_chain SET payload_json = ? WHERE id = (SELECT MIN(id) FROM ml_audit_chain)")
          .run(JSON.stringify({ TAMPERED: true }));
        const r = await request(app).get('/api/omega/audit/chain/verify').expect(200);
        expect(r.body.result.ok).toBe(false);
    });
});
