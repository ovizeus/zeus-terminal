'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');

const TEST_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'r1-enf-'));
process.env.ZEUS_DB_PATH = path.join(TEST_DB_DIR, 'test.db');

const { db } = require('../../server/services/database');
const r1 = require('../../server/services/ml/R1_constitution/enforcementEngine');
const principles = require('../../server/services/ml/R1_constitution/principles');

function seedUser(uid) {
    try {
        db.prepare(`INSERT OR IGNORE INTO users (id, email, password_hash) VALUES (?, ?, ?)`)
          .run(uid, `u${uid}@test.local`, 'x');
    } catch (_) {}
}

beforeEach(() => {
    seedUser(1);
    db.prepare("DELETE FROM ml_r1_violations").run();
});

describe('R1 enforcementEngine.evaluate — 7 principles', () => {
    test('clean decision → allowed=true, no violations', () => {
        const r = r1.evaluate({
            userId: 1,
            decision: {
                symbol: 'BTCUSDT', side: 'LONG',
                size: 100, balance: 1000,
                leverage: 5,
                sl: 69000, tp: 71000,
                mode: 'demo',
                reflection: { proceed: true, concerns: [] },
                openPositions: [],
                recentCloses: [],
                correlatedExposure: { totalPct: 10 },
            },
        });
        expect(r.allowed).toBe(true);
        expect(r.violations).toEqual([]);
    });

    // 1. MAX_POSITION_SIZE_PCT — position size ≤ 25% balance
    test('position size 30% of balance → MAX_POSITION_SIZE_PCT violation', () => {
        const r = r1.evaluate({
            userId: 1,
            decision: {
                symbol: 'BTCUSDT', side: 'LONG',
                size: 300, balance: 1000,
                leverage: 5, sl: 69000, mode: 'demo',
                reflection: { proceed: true, concerns: [] },
                openPositions: [], recentCloses: [],
                correlatedExposure: { totalPct: 0 },
            },
        });
        expect(r.allowed).toBe(false);
        expect(r.violations.map(v => v.id)).toContain('MAX_POSITION_SIZE_PCT');
    });

    // 2. MAX_LEVERAGE — leverage ≤ 25x
    test('leverage 50x → MAX_LEVERAGE violation', () => {
        const r = r1.evaluate({
            userId: 1,
            decision: {
                symbol: 'BTCUSDT', side: 'LONG',
                size: 100, balance: 1000, leverage: 50,
                sl: 69000, mode: 'demo',
                reflection: { proceed: true, concerns: [] },
                openPositions: [], recentCloses: [],
                correlatedExposure: { totalPct: 0 },
            },
        });
        expect(r.allowed).toBe(false);
        expect(r.violations.map(v => v.id)).toContain('MAX_LEVERAGE');
    });

    // 3. NO_REVENGE_TRADE — 3 consecutive losses → 30min cooldown
    test('3 consecutive losses + new entry within 30min → NO_REVENGE_TRADE', () => {
        const recentCloses = [
            { closePnl: -50, closedAt: Date.now() - 5 * 60 * 1000 },   // 5min ago
            { closePnl: -30, closedAt: Date.now() - 10 * 60 * 1000 },  // 10min ago
            { closePnl: -20, closedAt: Date.now() - 15 * 60 * 1000 },  // 15min ago
        ];
        const r = r1.evaluate({
            userId: 1,
            decision: {
                symbol: 'BTCUSDT', side: 'LONG',
                size: 100, balance: 1000, leverage: 5, sl: 69000, mode: 'demo',
                reflection: { proceed: true, concerns: [] },
                openPositions: [], recentCloses,
                correlatedExposure: { totalPct: 0 },
            },
        });
        expect(r.allowed).toBe(false);
        expect(r.violations.map(v => v.id)).toContain('NO_REVENGE_TRADE');
    });

    test('3 losses but >30min ago → NO_REVENGE_TRADE not triggered', () => {
        const recentCloses = [
            { closePnl: -50, closedAt: Date.now() - 35 * 60 * 1000 },
            { closePnl: -30, closedAt: Date.now() - 40 * 60 * 1000 },
            { closePnl: -20, closedAt: Date.now() - 45 * 60 * 1000 },
        ];
        const r = r1.evaluate({
            userId: 1,
            decision: {
                symbol: 'BTCUSDT', side: 'LONG',
                size: 100, balance: 1000, leverage: 5, sl: 69000, mode: 'demo',
                reflection: { proceed: true, concerns: [] },
                openPositions: [], recentCloses,
                correlatedExposure: { totalPct: 0 },
            },
        });
        expect(r.violations.map(v => v.id)).not.toContain('NO_REVENGE_TRADE');
    });

    // 4. NO_OPPOSITE_ENTRY_ON_OPEN
    test('SHORT entry while LONG open on same symbol → NO_OPPOSITE_ENTRY_ON_OPEN', () => {
        const r = r1.evaluate({
            userId: 1,
            decision: {
                symbol: 'BTCUSDT', side: 'SHORT',
                size: 100, balance: 1000, leverage: 5, sl: 71000, mode: 'demo',
                reflection: { proceed: true, concerns: [] },
                openPositions: [{ symbol: 'BTCUSDT', side: 'LONG', size: 100 }],
                recentCloses: [], correlatedExposure: { totalPct: 0 },
            },
        });
        expect(r.allowed).toBe(false);
        expect(r.violations.map(v => v.id)).toContain('NO_OPPOSITE_ENTRY_ON_OPEN');
    });

    // 5. MAX_CORRELATED_EXPOSURE — sum ≤ 50% balance
    test('correlated exposure 60% → MAX_CORRELATED_EXPOSURE', () => {
        const r = r1.evaluate({
            userId: 1,
            decision: {
                symbol: 'BTCUSDT', side: 'LONG',
                size: 100, balance: 1000, leverage: 5, sl: 69000, mode: 'demo',
                reflection: { proceed: true, concerns: [] },
                openPositions: [], recentCloses: [],
                correlatedExposure: { totalPct: 60 },
            },
        });
        expect(r.allowed).toBe(false);
        expect(r.violations.map(v => v.id)).toContain('MAX_CORRELATED_EXPOSURE');
    });

    // 6. MIN_REFLECTION_CONFIDENCE
    test('reflection.proceed=false → MIN_REFLECTION_CONFIDENCE', () => {
        const r = r1.evaluate({
            userId: 1,
            decision: {
                symbol: 'BTCUSDT', side: 'LONG',
                size: 100, balance: 1000, leverage: 5, sl: 69000, mode: 'demo',
                reflection: { proceed: false, concerns: ['low_conviction'] },
                openPositions: [], recentCloses: [],
                correlatedExposure: { totalPct: 0 },
            },
        });
        expect(r.allowed).toBe(false);
        expect(r.violations.map(v => v.id)).toContain('MIN_REFLECTION_CONFIDENCE');
    });

    // 7. NO_LIVE_WITHOUT_SL
    test('live entry without SL → NO_LIVE_WITHOUT_SL', () => {
        const r = r1.evaluate({
            userId: 1,
            decision: {
                symbol: 'BTCUSDT', side: 'LONG',
                size: 100, balance: 1000, leverage: 5,
                sl: null, mode: 'live',
                reflection: { proceed: true, concerns: [] },
                openPositions: [], recentCloses: [],
                correlatedExposure: { totalPct: 0 },
            },
        });
        expect(r.allowed).toBe(false);
        expect(r.violations.map(v => v.id)).toContain('NO_LIVE_WITHOUT_SL');
    });

    test('demo entry without SL → NO_LIVE_WITHOUT_SL NOT triggered (live-only rule)', () => {
        const r = r1.evaluate({
            userId: 1,
            decision: {
                symbol: 'BTCUSDT', side: 'LONG',
                size: 100, balance: 1000, leverage: 5,
                sl: null, mode: 'demo',
                reflection: { proceed: true, concerns: [] },
                openPositions: [], recentCloses: [],
                correlatedExposure: { totalPct: 0 },
            },
        });
        expect(r.violations.map(v => v.id)).not.toContain('NO_LIVE_WITHOUT_SL');
    });
});

describe('R1 enforcementEngine.logViolations', () => {
    test('logs each violation with metadata', () => {
        r1.logViolations({
            userId: 1,
            decision: { symbol: 'BTCUSDT', side: 'LONG' },
            violations: [
                { id: 'MAX_LEVERAGE', name: 'Max leverage exceeded', severity: 'hard' },
            ],
            enforcementMode: 'advisory',
        });
        const rows = db.prepare("SELECT * FROM ml_r1_violations WHERE user_id = 1").all();
        expect(rows.length).toBe(1);
        expect(rows[0].principle_id).toBe('MAX_LEVERAGE');
        expect(rows[0].enforcement_mode).toBe('advisory');
    });
});

describe('R1 principles export', () => {
    test('exports all 7 canonical principles', () => {
        const ids = principles.list().map(p => p.id);
        expect(ids).toEqual(expect.arrayContaining([
            'MAX_POSITION_SIZE_PCT', 'MAX_LEVERAGE', 'NO_REVENGE_TRADE',
            'NO_OPPOSITE_ENTRY_ON_OPEN', 'MAX_CORRELATED_EXPOSURE',
            'MIN_REFLECTION_CONFIDENCE', 'NO_LIVE_WITHOUT_SL',
        ]));
        expect(principles.list().length).toBe(7);
    });
});
