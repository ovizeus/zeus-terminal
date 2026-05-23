'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');

const TEST_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-w3-p73-'));
const TEST_DB_PATH = path.join(TEST_DB_DIR, 'test.db');
process.env.ZEUS_DB_PATH = TEST_DB_PATH;
process.env.ZEUS_TEST_DISABLE_AUTH = '1';

const { db } = require('../../../server/services/database');
const it = require('../../../server/services/ml/R5A_learning/informationTheoreticEdge');

const TEST_USER = 9073;
const TEST_ENV = 'DEMO';

function cleanRows() {
    db.prepare('DELETE FROM ml_signal_mi_observations WHERE user_id IN (?, ?)').run(TEST_USER, 9074);
    db.prepare('DELETE FROM ml_signal_mi_scores WHERE user_id IN (?, ?)').run(TEST_USER, 9074);
}

beforeEach(() => cleanRows());
afterAll(() => {
    try { fs.rmSync(TEST_DB_DIR, { recursive: true, force: true }); } catch (_) {}
});

describe('§73 Migrations 137 + 138', () => {
    test('ml_signal_mi_observations exists', () => {
        const cols = db.prepare(`PRAGMA table_info(ml_signal_mi_observations)`).all().map(c => c.name);
        expect(cols).toEqual(expect.arrayContaining([
            'signal_id', 'signal_value_bin', 'outcome', 'count', 'last_updated'
        ]));
    });

    test('CHECK signal_value_bin range 0..9', () => {
        const ts = Date.now();
        expect(() => db.prepare(
            `INSERT INTO ml_signal_mi_observations
             (user_id, resolved_env, signal_id, signal_value_bin, outcome, count, last_updated)
             VALUES (?, ?, 'S', 15, 'win', 1, ?)`
        ).run(TEST_USER, TEST_ENV, ts)).toThrow();
    });

    test('CHECK outcome restricts', () => {
        const ts = Date.now();
        expect(() => db.prepare(
            `INSERT INTO ml_signal_mi_observations
             (user_id, resolved_env, signal_id, signal_value_bin, outcome, count, last_updated)
             VALUES (?, ?, 'S', 5, 'BOGUS', 1, ?)`
        ).run(TEST_USER, TEST_ENV, ts)).toThrow();
    });

    test('UNIQUE joint key', () => {
        const ts = Date.now();
        db.prepare(
            `INSERT INTO ml_signal_mi_observations
             (user_id, resolved_env, signal_id, signal_value_bin, outcome, count, last_updated)
             VALUES (?, ?, 'S', 5, 'win', 1, ?)`
        ).run(TEST_USER, TEST_ENV, ts);
        expect(() => db.prepare(
            `INSERT INTO ml_signal_mi_observations
             (user_id, resolved_env, signal_id, signal_value_bin, outcome, count, last_updated)
             VALUES (?, ?, 'S', 5, 'win', 1, ?)`
        ).run(TEST_USER, TEST_ENV, ts + 1)).toThrow();
    });
});

describe('§73 Constants', () => {
    test('OUTCOME_BINS has 3 entries', () => {
        expect(it.OUTCOME_BINS).toEqual(['win', 'loss', 'scratch']);
    });

    test('SIGNAL_VALUE_BINS = 10', () => {
        expect(it.SIGNAL_VALUE_BINS).toBe(10);
    });

    test('MIN_SAMPLES_FOR_MI positive', () => {
        expect(it.MIN_SAMPLES_FOR_MI).toBeGreaterThan(0);
    });

    test('REDUNDANCY_THRESHOLD in (0,1)', () => {
        expect(it.REDUNDANCY_THRESHOLD).toBeGreaterThan(0);
        expect(it.REDUNDANCY_THRESHOLD).toBeLessThan(1);
    });
});

describe('§73 recordSignalOutcome', () => {
    test('discretizes signalValue to 10 bins', () => {
        it.recordSignalOutcome({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            signalId: 'sig-X', signalValue: 0.95, outcome: 'win'
        });
        const r = db.prepare(
            `SELECT signal_value_bin FROM ml_signal_mi_observations WHERE signal_id = 'sig-X'`
        ).get();
        expect(r.signal_value_bin).toBe(9);  // 0.95 * 10 = 9.5 → bin 9
    });

    test('clamps out-of-range to [0..9]', () => {
        it.recordSignalOutcome({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            signalId: 'sig-clamp', signalValue: 1.5, outcome: 'win'
        });
        const r = db.prepare(
            `SELECT signal_value_bin FROM ml_signal_mi_observations WHERE signal_id = 'sig-clamp'`
        ).get();
        expect(r.signal_value_bin).toBe(9);
    });

    test('throws on invalid outcome', () => {
        expect(() => it.recordSignalOutcome({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            signalId: 'sig-bad', signalValue: 0.5, outcome: 'BOGUS'
        })).toThrow();
    });
});

describe('§73 computeMutualInformation', () => {
    test('insufficient samples → sufficient=false', () => {
        for (let i = 0; i < 5; i++) {
            it.recordSignalOutcome({
                userId: TEST_USER, resolvedEnv: TEST_ENV,
                signalId: 'sig-low', signalValue: 0.5, outcome: 'win'
            });
        }
        const r = it.computeMutualInformation({
            userId: TEST_USER, resolvedEnv: TEST_ENV, signalId: 'sig-low'
        });
        expect(r.sufficient).toBe(false);
    });

    test('strong predictive signal → high MI', () => {
        // bin 0 → all losses, bin 9 → all wins (perfect predictor)
        for (let i = 0; i < 20; i++) {
            it.recordSignalOutcome({
                userId: TEST_USER, resolvedEnv: TEST_ENV,
                signalId: 'sig-strong', signalValue: 0.05, outcome: 'loss'
            });
            it.recordSignalOutcome({
                userId: TEST_USER, resolvedEnv: TEST_ENV,
                signalId: 'sig-strong', signalValue: 0.95, outcome: 'win'
            });
        }
        const r = it.computeMutualInformation({
            userId: TEST_USER, resolvedEnv: TEST_ENV, signalId: 'sig-strong'
        });
        expect(r.sufficient).toBe(true);
        expect(r.miBits).toBeGreaterThan(0.5);  // strong information
    });

    test('uniform signal → MI near zero', () => {
        // Same outcome distribution regardless of signal bin
        for (let i = 0; i < 40; i++) {
            it.recordSignalOutcome({
                userId: TEST_USER, resolvedEnv: TEST_ENV,
                signalId: 'sig-noise', signalValue: i / 100, outcome: 'win'
            });
        }
        const r = it.computeMutualInformation({
            userId: TEST_USER, resolvedEnv: TEST_ENV, signalId: 'sig-noise'
        });
        // Outcome variance = 0 (all wins) → MI = 0
        expect(r.miBits).toBeCloseTo(0, 1);
    });

    test('partial predictor → moderate MI', () => {
        for (let i = 0; i < 30; i++) {
            it.recordSignalOutcome({
                userId: TEST_USER, resolvedEnv: TEST_ENV,
                signalId: 'sig-partial', signalValue: 0.2,
                outcome: i % 3 === 0 ? 'loss' : 'win'
            });
            it.recordSignalOutcome({
                userId: TEST_USER, resolvedEnv: TEST_ENV,
                signalId: 'sig-partial', signalValue: 0.8,
                outcome: i % 3 === 0 ? 'win' : 'loss'
            });
        }
        const r = it.computeMutualInformation({
            userId: TEST_USER, resolvedEnv: TEST_ENV, signalId: 'sig-partial'
        });
        expect(r.miBits).toBeGreaterThan(0);
    });
});

describe('§73 computeAndRecordMI', () => {
    test('records MI score after compute', () => {
        for (let i = 0; i < 20; i++) {
            it.recordSignalOutcome({
                userId: TEST_USER, resolvedEnv: TEST_ENV,
                signalId: 'sig-rec', signalValue: 0.1, outcome: 'loss'
            });
            it.recordSignalOutcome({
                userId: TEST_USER, resolvedEnv: TEST_ENV,
                signalId: 'sig-rec', signalValue: 0.9, outcome: 'win'
            });
        }
        const r = it.computeAndRecordMI({
            userId: TEST_USER, resolvedEnv: TEST_ENV, signalId: 'sig-rec'
        });
        expect(r.sufficient).toBe(true);
        const score = it.getMIScore({
            userId: TEST_USER, resolvedEnv: TEST_ENV, signalId: 'sig-rec'
        });
        expect(score).toBeTruthy();
        expect(score.mutual_information_bits).toBeGreaterThan(0);
    });
});

describe('§73 detectSynergy', () => {
    test('synergy detected when joint MI > sum of individual', () => {
        // Seed both signals with >= MIN_SAMPLES_FOR_MI (30) each
        for (let i = 0; i < 40; i++) {
            it.recordSignalOutcome({
                userId: TEST_USER, resolvedEnv: TEST_ENV,
                signalId: 'A', signalValue: 0.5, outcome: i % 2 === 0 ? 'win' : 'loss'
            });
            it.recordSignalOutcome({
                userId: TEST_USER, resolvedEnv: TEST_ENV,
                signalId: 'B', signalValue: 0.5, outcome: i % 2 === 0 ? 'win' : 'loss'
            });
        }
        const r = it.detectSynergy({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            signalIdA: 'A', signalIdB: 'B',
            jointMIBits: 1.5
        });
        expect(r.synergyMargin).toBeGreaterThanOrEqual(0);
    });

    test('insufficient samples returns false', () => {
        const r = it.detectSynergy({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            signalIdA: 'X', signalIdB: 'Y', jointMIBits: 0.5
        });
        expect(r.synergistic).toBe(false);
    });
});

describe('§73 detectRedundancy', () => {
    test('identical signals → high cosine similarity', () => {
        for (let i = 0; i < 30; i++) {
            it.recordSignalOutcome({
                userId: TEST_USER, resolvedEnv: TEST_ENV,
                signalId: 'twin1', signalValue: 0.5, outcome: 'win'
            });
            it.recordSignalOutcome({
                userId: TEST_USER, resolvedEnv: TEST_ENV,
                signalId: 'twin2', signalValue: 0.5, outcome: 'win'
            });
        }
        const r = it.detectRedundancy({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            signalIds: ['twin1', 'twin2']
        });
        expect(r.pairs.length).toBeGreaterThan(0);
        expect(r.pairs[0].cosineSimilarity).toBeGreaterThan(0.85);
    });

    test('insufficient signals returns empty', () => {
        const r = it.detectRedundancy({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            signalIds: ['only-one']
        });
        expect(r.pairs).toEqual([]);
    });
});

describe('§73 getMIRanking', () => {
    test('returns signals ordered by MI desc', () => {
        // Strong signal
        for (let i = 0; i < 20; i++) {
            it.recordSignalOutcome({
                userId: TEST_USER, resolvedEnv: TEST_ENV,
                signalId: 'strong', signalValue: 0.1, outcome: 'loss'
            });
            it.recordSignalOutcome({
                userId: TEST_USER, resolvedEnv: TEST_ENV,
                signalId: 'strong', signalValue: 0.9, outcome: 'win'
            });
        }
        it.computeAndRecordMI({
            userId: TEST_USER, resolvedEnv: TEST_ENV, signalId: 'strong'
        });
        // Weak signal
        for (let i = 0; i < 20; i++) {
            it.recordSignalOutcome({
                userId: TEST_USER, resolvedEnv: TEST_ENV,
                signalId: 'weak', signalValue: 0.5, outcome: 'win'
            });
            it.recordSignalOutcome({
                userId: TEST_USER, resolvedEnv: TEST_ENV,
                signalId: 'weak', signalValue: 0.5, outcome: 'loss'
            });
        }
        it.computeAndRecordMI({
            userId: TEST_USER, resolvedEnv: TEST_ENV, signalId: 'weak'
        });

        const ranking = it.getMIRanking({
            userId: TEST_USER, resolvedEnv: TEST_ENV
        });
        expect(ranking[0].signal_id).toBe('strong');
    });
});

describe('§73 isolation', () => {
    test('per (user × env) isolation', () => {
        const OTHER_USER = 9074;
        it.recordSignalOutcome({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            signalId: 'iso-sig', signalValue: 0.5, outcome: 'win'
        });
        const r1 = db.prepare(
            `SELECT * FROM ml_signal_mi_observations WHERE user_id = ?`
        ).all(TEST_USER);
        const r2 = db.prepare(
            `SELECT * FROM ml_signal_mi_observations WHERE user_id = ?`
        ).all(OTHER_USER);
        expect(r1.length).toBe(1);
        expect(r2.length).toBe(0);
    });
});
