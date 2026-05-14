/**
 * R-1 Test Harness — replayEngine.js tests
 *
 * Verifies snapshot loading + deterministic replay of decisions from
 * ml_decision_snapshots. Foundation for spec invariant #6 (replay determinism).
 */

const { loadSnapshot, replayDecision } = require('../../../server/services/ml/R-1_testHarness/replayEngine');

describe('R-1 Test Harness — replayEngine', () => {
    test('module exports loadSnapshot + replayDecision', () => {
        expect(typeof loadSnapshot).toBe('function');
        expect(typeof replayDecision).toBe('function');
    });

    test('loadSnapshot returns null for non-existent digest', () => {
        const result = loadSnapshot('nonexistent_digest_xyz_omega_test');
        expect(result).toBeNull();
    });

    test('replayDecision returns object with required fields', () => {
        const synthSnapshot = {
            decision_digest: 'abc123',
            snapshot_json: JSON.stringify({ score: 0.75, top5: ['feat_a', 'feat_b'] }),
            registry_digest: 'reg_def456',
            input_snapshot_ref: 'inp_789'
        };
        const result = replayDecision(synthSnapshot);
        expect(result).toHaveProperty('decision_digest');
        expect(result).toHaveProperty('replay_score');
        expect(result).toHaveProperty('replay_top5');
        expect(result).toHaveProperty('matches_original');
    });

    test('replayDecision throws on malformed snapshot_json', () => {
        const bad = {
            decision_digest: 'abc',
            snapshot_json: 'not-json{{{',
            registry_digest: 'def'
        };
        expect(() => replayDecision(bad)).toThrow(/snapshot_json/i);
    });

    test('replayDecision flags matches_original=true when re-execution matches', () => {
        const snapshot = {
            decision_digest: 'test_match',
            snapshot_json: JSON.stringify({ score: 0.5, top5: ['a', 'b', 'c'] }),
            registry_digest: 'reg_x'
        };
        const result = replayDecision(snapshot);
        expect(result.matches_original).toBe(true);
        expect(result.replay_score).toBe(0.5);
    });
});
