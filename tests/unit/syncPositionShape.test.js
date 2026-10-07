'use strict';
// tests/unit/syncPositionShape.test.js
// [SYNC SHAPE MISMATCH 2026-10-07] The WS-4 "structural sanity gate" in
// POST /api/sync/state required p.symbol:
//     typeof p.symbol === 'string' && p.symbol.length > 0
// but the client has always sent the field as `sym` (core/state.ts builds
// `{ id, side, sym, entry, size, ... }`). So every synced position was dropped.
// Live proof before the fix: the operator had exactly 2 open demo positions and
// the log repeated "[SYNC] [WS-4] Dropped 2 malformed position(s) ... uid=1" on
// every sync — 100% of them. Nothing downstream in sync.js ever reads `symbol`;
// the merge keys off `p.id` alone, so the gate invented a requirement the
// payload never had, and the demo-position snapshot stopped persisting.

const express = require('express');
const supertest = require('supertest');
const fs = require('fs');
const path = require('path');

const TEST_UID = 987654;
const stateFile = path.join(__dirname, '..', '..', 'data', 'sync_user', TEST_UID + '_state.json');

function app() {
    const a = express();
    a.use(express.json());
    a.use((req, _res, next) => { req.user = { id: TEST_UID }; next(); });
    a.use('/api/sync', require('../../server/routes/sync'));
    return a;
}

function cleanup() {
    try { if (fs.existsSync(stateFile)) fs.unlinkSync(stateFile); } catch (_) { /* */ }
}

async function post(positions) {
    return supertest(app()).post('/api/sync/state').send({ ts: Date.now(), positions });
}
function persisted() {
    if (!fs.existsSync(stateFile)) return null;
    return JSON.parse(fs.readFileSync(stateFile, 'utf8'));
}

describe('POST /api/sync/state — position shape gate', () => {
    beforeEach(cleanup);
    afterAll(cleanup);

    test('a position in the REAL client shape (sym) survives the sync', async () => {
        const res = await post([{ id: 1780224662006, side: 'SHORT', sym: 'SOLUSDT', entry: 116.4, size: 10 }]);
        expect(res.status).toBe(200);
        const state = persisted();
        expect(state).not.toBeNull();
        expect(state.positions).toHaveLength(1);
        expect(state.positions[0].sym).toBe('SOLUSDT');
    });

    test('both open demo positions survive — the exact case that logged "Dropped 2"', async () => {
        const res = await post([
            { id: 1780224662006, side: 'SHORT', sym: 'SOLUSDT', entry: 116.4 },
            { id: 1780224662007, side: 'SHORT', sym: 'XRPUSDT', entry: 1.42 },
        ]);
        expect(res.status).toBe(200);
        expect(persisted().positions).toHaveLength(2);
    });

    test('the legacy `symbol` spelling still works (back-compat)', async () => {
        await post([{ id: 42, side: 'LONG', symbol: 'BTCUSDT', entry: 83000 }]);
        expect(persisted().positions).toHaveLength(1);
    });

    test('the gate still drops an entry with no id', async () => {
        await post([{ side: 'LONG', sym: 'BTCUSDT' }]);
        const state = persisted();
        expect(state.positions).toHaveLength(0);
    });

    test('the gate still drops an entry with no symbol under either name', async () => {
        await post([{ id: 7, side: 'LONG' }]);
        expect(persisted().positions).toHaveLength(0);
    });

    test('a valid entry is kept even when a malformed one rides along', async () => {
        await post([
            { id: 7, side: 'LONG' },                                   // bad
            { id: 8, side: 'SHORT', sym: 'ETHUSDT', entry: 2570 },      // good
        ]);
        const state = persisted();
        expect(state.positions).toHaveLength(1);
        expect(state.positions[0].id).toBe(8);
    });
});
