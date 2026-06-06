'use strict';

// [2026-06-06 evening #2] Operator: the AT journal drowned in
// ENTRY_FAILED_INSUFFICIENT_MARGIN (25×) + ENTRY_FAILED_LEVERAGE_FAILED (7×)
// rows. Root cause = asymmetry: DEMO has a balance gate at DECISION time
// (serverAT ~1183: blocked as missed trade, no record, no journal row) but
// LIVE has none — the entry record is created, Telegram ENTRY fires, and only
// THEN the margin check fails → zombie cleanup persists ENTRY_FAILED_* into
// at_closed (the journal). No cooldown → brain retried every cycle → spam +
// API pressure (contributed to the 14:46 IP ban).
//
// G1 — live affordability gate at decision time (mirror of the demo gate),
//      using us.liveAvailableRef cached from recon + the margin pre-check.
// G2 — failure cooldown: INSUFFICIENT_MARGIN → account-wide 5 min;
//      LEVERAGE_FAILED / MARGIN_TYPE_FAILED → per-symbol 10 min;
//      MARGIN_CHECK_FAILED (API error) → account-wide 2 min.
// G3 — GET /api/journal excludes ENTRY_FAILED% rows by default
//      (?includeFailed=1 keeps the forensic view; DB rows untouched).

describe('G1/G2 — serverAT entry gate helpers', () => {
    let at;
    beforeAll(() => {
        jest.resetModules();
        at = require('../../server/services/serverAT');
    });

    test('G1: _liveEntryAffordable blocks when cached available < size, passes otherwise/unknown', () => {
        const f = at._entryGateTestHooks.affordable;
        expect(f(799, 1000)).toBe(false);  // the real 06-06 case
        expect(f(1737, 800)).toBe(true);
        expect(f(0, 800)).toBe(true);      // no data yet → defer to authoritative async check
        expect(f(null, 800)).toBe(true);
        expect(f(undefined, 800)).toBe(true);
    });

    test('G2: INSUFFICIENT_MARGIN cools down ALL symbols for that user for 5 min', () => {
        const cd = at._entryGateTestHooks.cooldown;
        cd._clear();
        const t0 = 1_780_800_000_000;
        cd.record(1, 'ETHUSDT', 'INSUFFICIENT_MARGIN', t0);
        expect(cd.check(1, 'ETHUSDT', t0 + 1000)).toBeTruthy();   // same symbol
        expect(cd.check(1, 'BTCUSDT', t0 + 1000)).toBeTruthy();   // margin is account-wide
        expect(cd.check(2, 'ETHUSDT', t0 + 1000)).toBeFalsy();    // other user untouched
        expect(cd.check(1, 'BTCUSDT', t0 + 5 * 60_000 + 1)).toBeFalsy(); // expired
    });

    test('G2: LEVERAGE_FAILED cools down ONLY that symbol for 10 min', () => {
        const cd = at._entryGateTestHooks.cooldown;
        cd._clear();
        const t0 = 1_780_800_000_000;
        cd.record(1, 'BTCUSDT', 'LEVERAGE_FAILED', t0);
        expect(cd.check(1, 'BTCUSDT', t0 + 9 * 60_000)).toBeTruthy();
        expect(cd.check(1, 'ETHUSDT', t0 + 1000)).toBeFalsy();    // other symbols free
        expect(cd.check(1, 'BTCUSDT', t0 + 10 * 60_000 + 1)).toBeFalsy(); // expired
    });

    test('G2: MARGIN_CHECK_FAILED (API error) cools down account-wide for 2 min', () => {
        const cd = at._entryGateTestHooks.cooldown;
        cd._clear();
        const t0 = 1_780_800_000_000;
        cd.record(1, 'SOLUSDT', 'MARGIN_CHECK_FAILED', t0);
        expect(cd.check(1, 'BNBUSDT', t0 + 60_000)).toBeTruthy();
        expect(cd.check(1, 'BNBUSDT', t0 + 2 * 60_000 + 1)).toBeFalsy();
    });
});

describe('G3 — GET /api/journal hides ENTRY_FAILED rows by default', () => {
    const request = require('supertest');
    const express = require('express');

    function mkRow(seq, closeReason, pnl) {
        return {
            data: JSON.stringify({
                seq, symbol: 'BTCUSDT', side: 'SHORT', mode: 'live',
                price: 60000, size: 1000, margin: 1000, lev: 5,
                sl: 61000, tp: 58000, closePnl: pnl, closeReason,
                ts: 1780750000000, closeTs: 1780750060000,
                autoTrade: true, sourceMode: 'auto',
            }),
            closed_at: '2026-06-06 15:00:00',
        };
    }

    function buildApp(rows) {
        jest.resetModules();
        jest.doMock('../../server/services/database', () => ({
            journalGetClosed: () => rows,
            journalCountClosed: () => rows.length,
        }));
        const app = express();
        app.use(express.json());
        app.use((req, _res, next) => { req.user = { id: 1 }; next(); });
        app.use('/api/journal', require('../../server/routes/journal.js'));
        return app;
    }

    const ROWS = [
        mkRow(1, 'DSL_PL', 34.35),
        mkRow(2, 'ENTRY_FAILED_INSUFFICIENT_MARGIN', 0),
        mkRow(3, 'ENTRY_FAILED_LEVERAGE_FAILED', 0),
        mkRow(4, 'HIT_SL', -12.31),
    ];

    test('THE FIX: default response contains only real trades', async () => {
        const app = buildApp(ROWS);
        const res = await request(app).get('/api/journal');
        expect(res.status).toBe(200);
        const reasons = res.body.trades.map(t => t.exitReason);
        expect(reasons).toEqual(['DSL_PL', 'HIT_SL']);
    });

    test('?includeFailed=1 keeps the forensic view (all 4 rows)', async () => {
        const app = buildApp(ROWS);
        const res = await request(app).get('/api/journal?includeFailed=1');
        expect(res.status).toBe(200);
        expect(res.body.trades.length).toBe(4);
    });
});
