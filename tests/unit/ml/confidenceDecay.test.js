'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');

const TEST_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-w3-p15-'));
const TEST_DB_PATH = path.join(TEST_DB_DIR, 'test.db');
process.env.ZEUS_DB_PATH = TEST_DB_PATH;
process.env.ZEUS_TEST_DISABLE_AUTH = '1';

const { db } = require('../../../server/services/database');
const cd = require('../../../server/services/ml/R2_cognition/confidenceDecay');

const TEST_USER = 9015;
const TEST_ENV = 'DEMO';
const POS = 'pos-test-15-001';

function cleanRows() {
    db.prepare('DELETE FROM ml_confidence_state WHERE user_id = ?').run(TEST_USER);
}

beforeEach(() => cleanRows());
afterAll(() => {
    try { fs.rmSync(TEST_DB_DIR, { recursive: true, force: true }); } catch (_) {}
});

describe('§15 Migration 060_ml_confidence_state', () => {
    test('table ml_confidence_state exists', () => {
        const row = db.prepare(
            `SELECT name FROM sqlite_master WHERE type='table' AND name='ml_confidence_state'`
        ).get();
        expect(row).toBeTruthy();
    });

    test('has expected columns', () => {
        const cols = db.prepare(`PRAGMA table_info(ml_confidence_state)`).all().map(c => c.name);
        expect(cols).toEqual(expect.arrayContaining([
            'id', 'user_id', 'resolved_env', 'pos_id', 'symbol',
            'entry_confidence', 'current_confidence',
            'max_stagnation_ms', 'validation_window_ms',
            'thesis_criteria_json', 'decay_signals_json',
            'last_signal_at', 'created_at', 'updated_at'
        ]));
    });

    test('UNIQUE per (user_id, resolved_env, pos_id)', () => {
        db.prepare(
            `INSERT INTO ml_confidence_state
             (user_id, resolved_env, pos_id, symbol, entry_confidence, current_confidence,
              max_stagnation_ms, validation_window_ms, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(TEST_USER, TEST_ENV, POS, 'BTCUSDT', 0.8, 0.8, 60000, 300000, Date.now(), Date.now());
        expect(() => db.prepare(
            `INSERT INTO ml_confidence_state
             (user_id, resolved_env, pos_id, symbol, entry_confidence, current_confidence,
              max_stagnation_ms, validation_window_ms, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(TEST_USER, TEST_ENV, POS, 'BTCUSDT', 0.5, 0.5, 60000, 300000, Date.now(), Date.now())).toThrow();
        cleanRows();
    });

    test('CHECK resolved_env restricts to DEMO|TESTNET|REAL', () => {
        expect(() => db.prepare(
            `INSERT INTO ml_confidence_state
             (user_id, resolved_env, pos_id, symbol, entry_confidence, current_confidence,
              max_stagnation_ms, validation_window_ms, created_at, updated_at)
             VALUES (?, 'PROD', ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(TEST_USER, POS, 'BTCUSDT', 0.8, 0.8, 60000, 300000, Date.now(), Date.now())).toThrow();
    });
});

describe('§15 Exported constants', () => {
    test('DECAY_SIGNALS has 7 entries', () => {
        expect(cd.DECAY_SIGNALS).toHaveLength(7);
        expect(cd.DECAY_SIGNALS).toEqual(expect.arrayContaining([
            'no_follow_through', 'volume_disappears', 'impulse_dies',
            'time_no_progress', 'context_degrades', 'macro_pulse_reverses',
            'venue_confirmation_lost'
        ]));
    });

    test('ACTION_LADDER has HOLD/REDUCE/EXIT', () => {
        expect(cd.ACTION_LADDER).toEqual(['HOLD', 'REDUCE', 'EXIT']);
    });

    test('DEFAULT_PARAMS has positive values', () => {
        expect(cd.DEFAULT_PARAMS.max_stagnation_ms).toBeGreaterThan(0);
        expect(cd.DEFAULT_PARAMS.validation_window_ms).toBeGreaterThan(0);
        expect(cd.DEFAULT_PARAMS.decay_rate_per_signal).toBeGreaterThan(0);
        expect(cd.DEFAULT_PARAMS.exit_threshold).toBeGreaterThan(0);
        expect(cd.DEFAULT_PARAMS.reduce_threshold).toBeGreaterThan(cd.DEFAULT_PARAMS.exit_threshold);
    });
});

describe('§15 initializeThesis', () => {
    test('creates new state', () => {
        const r = cd.initializeThesis({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            posId: POS, symbol: 'BTCUSDT',
            entryConfidence: 0.8
        });
        expect(r.created).toBe(true);
        expect(r.entryConfidence).toBe(0.8);
        const state = cd.getCurrentConfidence({
            userId: TEST_USER, resolvedEnv: TEST_ENV, posId: POS
        });
        expect(state.confidence).toBe(0.8);
    });

    test('stores custom thesis criteria', () => {
        cd.initializeThesis({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            posId: POS, symbol: 'BTCUSDT',
            entryConfidence: 0.8,
            thesisCriteria: { followThroughBps: 50, volumeContinue: true }
        });
        const row = db.prepare(`SELECT * FROM ml_confidence_state WHERE pos_id = ?`).get(POS);
        const crit = JSON.parse(row.thesis_criteria_json);
        expect(crit.followThroughBps).toBe(50);
    });

    test('throws on missing entryConfidence', () => {
        expect(() => cd.initializeThesis({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            posId: POS, symbol: 'BTCUSDT'
        })).toThrow(/entryConfidence/);
    });

    test('throws on entryConfidence out of [0,1]', () => {
        expect(() => cd.initializeThesis({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            posId: POS, symbol: 'BTCUSDT',
            entryConfidence: 1.5
        })).toThrow(/range/);
    });
});

describe('§15 updateThesisProgress — signal decay', () => {
    beforeEach(() => {
        cd.initializeThesis({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            posId: POS, symbol: 'BTCUSDT',
            entryConfidence: 0.8
        });
    });

    test('no active signals → no decay (only time decay)', () => {
        const r = cd.updateThesisProgress({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            posId: POS, signals: {}, priceProgress: 0
        });
        expect(r.currentConfidence).toBeLessThanOrEqual(0.8);
        expect(r.currentConfidence).toBeGreaterThan(0.7);  // small time decay only
    });

    test('one active decay signal → confidence drops', () => {
        const r = cd.updateThesisProgress({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            posId: POS,
            signals: { volume_disappears: true },
            priceProgress: 0
        });
        expect(r.currentConfidence).toBeLessThan(0.8);
        expect(r.activeSignals).toContain('volume_disappears');
    });

    test('multiple decay signals compound', () => {
        const r1 = cd.updateThesisProgress({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            posId: POS,
            signals: { volume_disappears: true },
            priceProgress: 0
        });
        cd.initializeThesis({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            posId: 'pos-multi-15-002', symbol: 'BTCUSDT',
            entryConfidence: 0.8
        });
        const r2 = cd.updateThesisProgress({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            posId: 'pos-multi-15-002',
            signals: {
                volume_disappears: true,
                impulse_dies: true,
                context_degrades: true
            },
            priceProgress: 0
        });
        expect(r2.currentConfidence).toBeLessThan(r1.currentConfidence);
    });

    test('strong priceProgress → confidence recovers slightly', () => {
        cd.updateThesisProgress({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            posId: POS,
            signals: { impulse_dies: true },
            priceProgress: 0
        });
        const stateAfter1 = cd.getCurrentConfidence({
            userId: TEST_USER, resolvedEnv: TEST_ENV, posId: POS
        });
        const r2 = cd.updateThesisProgress({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            posId: POS,
            signals: {},
            priceProgress: 1.0  // strong follow-through
        });
        expect(r2.currentConfidence).toBeGreaterThan(stateAfter1.confidence);
    });

    test('unknown signal key is ignored', () => {
        const r = cd.updateThesisProgress({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            posId: POS,
            signals: { bogus_signal: true },
            priceProgress: 0
        });
        expect(r.activeSignals).toEqual([]);
    });
});

describe('§15 getCurrentConfidence — action ladder', () => {
    test('high confidence → HOLD', () => {
        cd.initializeThesis({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            posId: POS, symbol: 'BTCUSDT',
            entryConfidence: 0.85
        });
        const r = cd.getCurrentConfidence({
            userId: TEST_USER, resolvedEnv: TEST_ENV, posId: POS
        });
        expect(r.action).toBe('HOLD');
    });

    test('mid confidence → REDUCE', () => {
        cd.initializeThesis({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            posId: POS, symbol: 'BTCUSDT',
            entryConfidence: 0.8
        });
        for (let i = 0; i < 4; i++) {
            cd.updateThesisProgress({
                userId: TEST_USER, resolvedEnv: TEST_ENV,
                posId: POS,
                signals: {
                    volume_disappears: true,
                    no_follow_through: true
                },
                priceProgress: 0
            });
        }
        const r = cd.getCurrentConfidence({
            userId: TEST_USER, resolvedEnv: TEST_ENV, posId: POS
        });
        expect(['REDUCE', 'EXIT']).toContain(r.action);
    });

    test('confidence below exit threshold → EXIT', () => {
        cd.initializeThesis({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            posId: POS, symbol: 'BTCUSDT',
            entryConfidence: 0.8
        });
        for (let i = 0; i < 12; i++) {
            cd.updateThesisProgress({
                userId: TEST_USER, resolvedEnv: TEST_ENV,
                posId: POS,
                signals: {
                    volume_disappears: true,
                    impulse_dies: true,
                    context_degrades: true,
                    no_follow_through: true,
                    macro_pulse_reverses: true
                },
                priceProgress: 0
            });
        }
        const r = cd.getCurrentConfidence({
            userId: TEST_USER, resolvedEnv: TEST_ENV, posId: POS
        });
        expect(r.action).toBe('EXIT');
    });

    test('returns null state if pos not initialized', () => {
        const r = cd.getCurrentConfidence({
            userId: TEST_USER, resolvedEnv: TEST_ENV, posId: 'pos-unknown'
        });
        expect(r.exists).toBe(false);
    });
});

describe('§15 shouldExitOnFailedThesis', () => {
    test('returns false initially', () => {
        cd.initializeThesis({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            posId: POS, symbol: 'BTCUSDT',
            entryConfidence: 0.85
        });
        const r = cd.shouldExitOnFailedThesis({
            userId: TEST_USER, resolvedEnv: TEST_ENV, posId: POS
        });
        expect(r.shouldExit).toBe(false);
    });

    test('returns true when confidence below exit_threshold', () => {
        cd.initializeThesis({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            posId: POS, symbol: 'BTCUSDT',
            entryConfidence: 0.8
        });
        for (let i = 0; i < 12; i++) {
            cd.updateThesisProgress({
                userId: TEST_USER, resolvedEnv: TEST_ENV,
                posId: POS,
                signals: {
                    volume_disappears: true,
                    impulse_dies: true,
                    context_degrades: true,
                    no_follow_through: true,
                    macro_pulse_reverses: true,
                    venue_confirmation_lost: true,
                    time_no_progress: true
                },
                priceProgress: 0
            });
        }
        const r = cd.shouldExitOnFailedThesis({
            userId: TEST_USER, resolvedEnv: TEST_ENV, posId: POS
        });
        expect(r.shouldExit).toBe(true);
        expect(r.reasons.length).toBeGreaterThan(0);
    });

    test('returns true after max_stagnation exceeded', () => {
        cd.initializeThesis({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            posId: POS, symbol: 'BTCUSDT',
            entryConfidence: 0.9,
            maxStagnationMs: 50  // 50ms threshold
        });
        // Simulate time passing — manually backdate the row
        db.prepare(
            `UPDATE ml_confidence_state SET created_at = ?, updated_at = ? WHERE pos_id = ?`
        ).run(Date.now() - 1000, Date.now() - 1000, POS);
        const r = cd.shouldExitOnFailedThesis({
            userId: TEST_USER, resolvedEnv: TEST_ENV, posId: POS
        });
        expect(r.shouldExit).toBe(true);
        expect(r.reasons).toContain('max_stagnation_exceeded');
    });
});

describe('§15 isolation', () => {
    test('per (user × env × pos) isolation', () => {
        const OTHER_USER = 9016;
        cd.initializeThesis({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            posId: POS, symbol: 'BTCUSDT',
            entryConfidence: 0.8
        });
        cd.initializeThesis({
            userId: OTHER_USER, resolvedEnv: TEST_ENV,
            posId: POS, symbol: 'BTCUSDT',
            entryConfidence: 0.5
        });
        const r1 = cd.getCurrentConfidence({
            userId: TEST_USER, resolvedEnv: TEST_ENV, posId: POS
        });
        const r2 = cd.getCurrentConfidence({
            userId: OTHER_USER, resolvedEnv: TEST_ENV, posId: POS
        });
        expect(r1.confidence).toBe(0.8);
        expect(r2.confidence).toBe(0.5);
        db.prepare(`DELETE FROM ml_confidence_state WHERE user_id = ?`).run(OTHER_USER);
    });
});

describe('§15 validation', () => {
    test('throws on missing posId', () => {
        expect(() => cd.initializeThesis({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            symbol: 'BTCUSDT', entryConfidence: 0.8
        })).toThrow(/posId/);
    });

    test('updateThesisProgress throws when pos not initialized', () => {
        expect(() => cd.updateThesisProgress({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            posId: 'pos-unknown-15', signals: {}, priceProgress: 0
        })).toThrow(/not initialized|exist/i);
    });
});
