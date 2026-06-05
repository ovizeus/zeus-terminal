'use strict';

// [JOURNAL SPLIT 2026-06-05] Operator: "AT journal mixed with manual — AT cu
// AT, manual cu manual". Root cause (two server-side holes in routes/journal.js):
//   1. POST /api/journal/report DROPPED autoTrade/sourceMode when persisting
//      client-reported closes → 1,982/2,600 at_closed rows (76%) unclassified.
//      Client-AT closes (demo engine runs client-side, reports with
//      autoTrade:true) landed in the MANUAL bucket (`autoTrade !== true`).
//   2. GET /api/journal returned a mapped subset WITHOUT autoTrade/sourceMode
//      even for correctly-classified rows → after any refresh the UI could
//      not separate them.
// Plus a one-off backfill (script, not tested here) classifies legacy rows by
// closeReason heuristics (DSL/HIT_SL/TTP → auto; Manual/Close All → manual).

const express = require('express');
const request = require('supertest');

function buildApp(dbMock) {
    jest.resetModules();
    jest.doMock('../../server/services/database', () => dbMock);
    const router = require('../../server/routes/journal');
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => { req.user = { id: 1 }; next(); });
    app.use('/api/journal', router);
    return app;
}

describe('POST /api/journal/report — preserves AT/manual classification', () => {
    test('THE FIX: autoTrade:true + sourceMode propagate into the stored JSON', async () => {
        const inserts = [];
        const app = buildApp({
            journalGetClosed: () => [], journalCountClosed: () => 0,
            atInsertClosed: (seq, json, uid) => inserts.push({ seq, json: JSON.parse(json), uid }),
        });
        const r = await request(app).post('/api/journal/report').send({
            id: 1780700000001, side: 'LONG', sym: 'BTCUSDT', mode: 'demo',
            entry: 61000, pnl: 12.5, reason: 'DSL_PL', autoTrade: true, sourceMode: 'auto',
        });
        expect(r.status).toBe(200);
        expect(inserts.length).toBe(1);
        expect(inserts[0].json.autoTrade).toBe(true);
        expect(inserts[0].json.sourceMode).toBe('auto');
    });

    test('manual close → autoTrade:false, sourceMode manual', async () => {
        const inserts = [];
        const app = buildApp({
            journalGetClosed: () => [], journalCountClosed: () => 0,
            atInsertClosed: (seq, json) => inserts.push(JSON.parse(json)),
        });
        await request(app).post('/api/journal/report').send({
            id: 1780700000002, side: 'SHORT', sym: 'ETHUSDT', mode: 'demo',
            entry: 1600, pnl: -3, reason: 'Manual', autoTrade: false,
        });
        expect(inserts[0].autoTrade).toBe(false);
        expect(inserts[0].sourceMode).toBe('manual');
    });

    test('absent autoTrade → derives sourceMode manual (status quo for unknown), no crash', async () => {
        const inserts = [];
        const app = buildApp({
            journalGetClosed: () => [], journalCountClosed: () => 0,
            atInsertClosed: (seq, json) => inserts.push(JSON.parse(json)),
        });
        await request(app).post('/api/journal/report').send({
            id: 1780700000003, side: 'LONG', sym: 'SOLUSDT', mode: 'demo', entry: 64, pnl: 1, reason: 'Close All Manual',
        });
        expect(inserts[0].autoTrade).toBe(false);
        expect(inserts[0].sourceMode).toBe('manual');
    });

    test('sourceMode whitelist: junk value rejected → derived from autoTrade', async () => {
        const inserts = [];
        const app = buildApp({
            journalGetClosed: () => [], journalCountClosed: () => 0,
            atInsertClosed: (seq, json) => inserts.push(JSON.parse(json)),
        });
        await request(app).post('/api/journal/report').send({
            id: 1780700000004, side: 'LONG', sym: 'BNBUSDT', mode: 'demo',
            entry: 590, pnl: 0, reason: 'x', autoTrade: true, sourceMode: '<script>',
        });
        expect(inserts[0].sourceMode).toBe('auto');
    });
});

describe('GET /api/journal — returns the classification fields', () => {
    function rowsOf(...datas) {
        return datas.map((d, i) => ({ seq: d.seq || i + 1, data: JSON.stringify(d), closed_at: '2026-06-05 12:00:00' }));
    }

    test('THE FIX: autoTrade + sourceMode included per trade', async () => {
        const app = buildApp({
            journalGetClosed: () => rowsOf(
                { seq: 1, symbol: 'BTCUSDT', side: 'LONG', mode: 'live', price: 61000, closePnl: 10, closeReason: 'DSL_PL', ts: 1, closeTs: 2, autoTrade: true, sourceMode: 'auto' },
                { seq: 2, symbol: 'ETHUSDT', side: 'SHORT', mode: 'live', price: 1600, closePnl: -5, closeReason: 'Manual', ts: 1, closeTs: 2, autoTrade: false, sourceMode: 'manual' },
                { seq: 3, symbol: 'SOLUSDT', side: 'LONG', mode: 'demo', price: 64, closePnl: 1, closeReason: 'Close All Manual', ts: 1, closeTs: 2 },
            ),
            journalCountClosed: () => 3,
            atInsertClosed: () => {},
        });
        const r = await request(app).get('/api/journal');
        expect(r.status).toBe(200);
        const bySeq = Object.fromEntries(r.body.trades.map(t => [t.seq, t]));
        expect(bySeq[1].autoTrade).toBe(true);
        expect(bySeq[1].sourceMode).toBe('auto');
        expect(bySeq[2].autoTrade).toBe(false);
        expect(bySeq[2].sourceMode).toBe('manual');
        expect(bySeq[3].autoTrade).toBe(false); // legacy unclassified → manual bucket (status quo)
        expect(bySeq[3].sourceMode).toBe(null);
    });

    test('?source=at / ?source=manual server-side bucket filters', async () => {
        const app = buildApp({
            journalGetClosed: () => rowsOf(
                { seq: 1, symbol: 'BTCUSDT', side: 'LONG', mode: 'live', price: 61000, closePnl: 10, closeReason: 'DSL_PL', ts: 1, closeTs: 2, autoTrade: true, sourceMode: 'auto' },
                { seq: 2, symbol: 'ETHUSDT', side: 'SHORT', mode: 'live', price: 1600, closePnl: -5, closeReason: 'Manual', ts: 1, closeTs: 2, autoTrade: false, sourceMode: 'manual' },
            ),
            journalCountClosed: () => 2,
            atInsertClosed: () => {},
        });
        const at = await request(app).get('/api/journal?source=at');
        expect(at.body.trades.map(t => t.seq)).toEqual([1]);
        const man = await request(app).get('/api/journal?source=manual');
        expect(man.body.trades.map(t => t.seq)).toEqual([2]);
    });
});
