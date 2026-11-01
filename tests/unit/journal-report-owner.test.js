'use strict';
// [OWNERLESS BLOB 2026-11-01] Closes the question left open by b297 (2026-10-21):
// "scriitorul lor nu a putut fi gasit in codul actual (forma lor, cu confluence si
// tier dar fara qty sau cycle, nu se potriveste cu niciun constructor de azi)".
//
// It is THIS route. POST /api/journal/report builds a 22-key blob — seq, symbol,
// side, mode, price, size, margin, lev, sl, tp, closePnl, closeReason, ts, closeTs,
// regime, confluence, tier, status, exchange, env, autoTrade, sourceMode — which is
// byte-for-byte the shape of the 521 at_closed rows whose JSON carries no userId
// while the row's user_id column says 1. The column is filled from the session
// (`db.atInsertClosed(seq, json, userId)`); the blob simply never got the field.
//
// Why it matters beyond tidiness: _findSameModeOpposite in serverAT reads the
// owner OFF THE OBJECT, and [C5] at load refuses any position whose object has no
// userId. An ownerless blob is therefore invisible to the directional guard and
// unloadable after a restart — the exact failure mode b297 had to make the guard
// fail-closed about.
const express = require('express');
const request = require('supertest');

function buildApp(inserts, uid) {
    jest.resetModules();
    jest.doMock('../../server/services/database', () => ({
        journalGetClosed: () => [], journalCountClosed: () => 0,
        atInsertClosed: (seq, json, u) => inserts.push({ seq, json: JSON.parse(json), uid: u }),
    }));
    const router = require('../../server/routes/journal');
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => { req.user = { id: uid }; next(); });
    app.use('/api/journal', router);
    return app;
}

const TRADE = {
    id: 1780700000009, side: 'SHORT', sym: 'ETHUSDT', mode: 'demo',
    entry: 2400, pnl: -3.2, reason: 'HIT_SL', autoTrade: true, sourceMode: 'auto',
};

describe('POST /api/journal/report — the blob carries its owner', () => {
    test('THE FIX: userId is stamped INTO the stored JSON, not only the column', async () => {
        const inserts = [];
        const r = await request(buildApp(inserts, 1)).post('/api/journal/report').send(TRADE);
        expect(r.status).toBe(200);
        expect(inserts[0].json.userId).toBe(1);
    });
    test('the stamped owner is the SESSION user, never the payload', async () => {
        const inserts = [];
        // A client claiming to be someone else must not be believed.
        await request(buildApp(inserts, 7)).post('/api/journal/report')
            .send({ ...TRADE, userId: 99, user_id: 99 });
        expect(inserts[0].json.userId).toBe(7);
        expect(inserts[0].uid).toBe(7);
    });
    test('blob owner and column owner always agree', async () => {
        const inserts = [];
        await request(buildApp(inserts, 3)).post('/api/journal/report').send(TRADE);
        expect(inserts[0].json.userId).toBe(inserts[0].uid);
    });
    test('userId is a number, not a string from the session', async () => {
        const inserts = [];
        await request(buildApp(inserts, '5')).post('/api/journal/report').send(TRADE);
        expect(inserts[0].json.userId).toBe(5);
    });
});
