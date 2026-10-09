'use strict';
// [2026-10-09 audit B2] logDivergence inserted cycle_no, decision,
// shadow_signal, diverged and details into dsl_parity_log — a table that has
// none of those columns. It is about DSL stop-loss parity (pivot_left,
// impulse_val, current_sl), an entirely different thing. Both the INSERT and
// getDailyParity's SELECT fail on the real database, and both sit in empty
// catches, so the whole module was a no-op that reported 100% parity forever.
//
// It survived because tests/integration/bybitIntegration.test.js CREATEs its
// own dsl_parity_log with exactly the columns the code wants. The test passed
// green for code that could not run in production — the most misleading kind of
// green there is. This file uses the real migrated schema instead.

const fs = require('fs');
const os = require('os');
const path = require('path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'zeus-parityshadow-'));
process.env.ZEUS_DB_PATH = path.join(tmp, 'test.db');

const { db } = require('../../server/services/database');
const psl = require('../../server/services/parityShadowLogger');

beforeEach(() => {
    db.prepare('DELETE FROM parity_shadow_log').run();
});

describe('parityShadowLogger writes to a table that actually exists', () => {
    test('a divergence is persisted and can be read back', () => {
        psl.logDivergence({
            userId: 1, symbol: 'BTCUSDT', exchange: 'binance', shadowExchange: 'bybit',
            cycleNo: 7, decision: 'LONG', shadowSignal: 'SHORT', diverged: true,
            details: { why: 'test' },
        });

        const row = db.prepare('SELECT * FROM parity_shadow_log WHERE user_id = 1').get();
        expect(row).toBeDefined();
        expect(row.symbol).toBe('BTCUSDT');
        expect(row.cycle_no).toBe(7);
        expect(row.decision).toBe('LONG');
        expect(row.shadow_signal).toBe('SHORT');
        expect(row.diverged).toBe(1);
    });

    test('daily parity counts matches against divergences instead of silently reporting 100%', () => {
        const today = new Date().toISOString().slice(0, 10);
        for (let i = 0; i < 7; i++) {
            psl.logDivergence({ userId: 2, symbol: 'ETHUSDT', exchange: 'binance', shadowExchange: 'bybit',
                cycleNo: i, decision: 'LONG', shadowSignal: 'LONG', diverged: false });
        }
        for (let i = 0; i < 3; i++) {
            psl.logDivergence({ userId: 2, symbol: 'ETHUSDT', exchange: 'binance', shadowExchange: 'bybit',
                cycleNo: 100 + i, decision: 'LONG', shadowSignal: 'SHORT', diverged: true });
        }

        const parity = psl.getDailyParity(2, today);
        expect(parity.total).toBe(10);
        expect(parity.matched).toBe(7);
        expect(parity.parityPct).toBe(70);
    });

    test('an empty day reports no samples rather than a fake 100%', () => {
        const parity = psl.getDailyParity(999, '2020-01-01');
        expect(parity.total).toBe(0);
    });
});
