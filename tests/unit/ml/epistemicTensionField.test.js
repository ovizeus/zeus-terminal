'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');

const TEST_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-w3-p125-'));
const TEST_DB_PATH = path.join(TEST_DB_DIR, 'test.db');
process.env.ZEUS_DB_PATH = TEST_DB_PATH;
process.env.ZEUS_TEST_DISABLE_AUTH = '1';

const { db } = require('../../../server/services/database');
const etf = require('../../../server/services/ml/_meta/epistemicTensionField');

const TEST_USER = 9125;
const OTHER_USER = 9126;
const TEST_ENV = 'DEMO';

function cleanRows() {
    db.prepare('DELETE FROM ml_tension_assessments WHERE user_id IN (?, ?)').run(TEST_USER, OTHER_USER);
    db.prepare('DELETE FROM ml_tension_sources_audit WHERE user_id IN (?, ?)').run(TEST_USER, OTHER_USER);
}

beforeEach(() => cleanRows());
afterAll(() => {
    try { fs.rmSync(TEST_DB_DIR, { recursive: true, force: true }); } catch (_) {}
});

const ALL_SOURCES_ZERO = {
    hypotheses: 0, thesis_nodes: 0, regime_beliefs: 0,
    confidence_bounds: 0, unknowns: 0, competence: 0,
    operational_health: 0, utility_priorities: 0
};

describe('§125 Migrations 239 + 240', () => {
    test('assessment_id UNIQUE', () => {
        const ts = Date.now();
        db.prepare(
            `INSERT INTO ml_tension_assessments
             (user_id, resolved_env, assessment_id, sources_json,
              tension_score, gradient_kind, recommended_state, ts)
             VALUES (?, ?, 'TA-UNIQ', '{}', 0.3, 'local', 'caution', ?)`
        ).run(TEST_USER, TEST_ENV, ts);
        expect(() => db.prepare(
            `INSERT INTO ml_tension_assessments
             (user_id, resolved_env, assessment_id, sources_json,
              tension_score, gradient_kind, recommended_state, ts)
             VALUES (?, ?, 'TA-UNIQ', '{}', 0.5, 'global', 'reduce_size', ?)`
        ).run(TEST_USER, TEST_ENV, ts + 1)).toThrow();
    });

    test('CHECK gradient_kind restricts', () => {
        expect(() => db.prepare(
            `INSERT INTO ml_tension_assessments
             (user_id, resolved_env, assessment_id, sources_json,
              tension_score, gradient_kind, recommended_state, ts)
             VALUES (?, ?, 'TA-BAD', '{}', 0.5, 'BOGUS', 'caution', ?)`
        ).run(TEST_USER, TEST_ENV, Date.now())).toThrow();
    });

    test('CHECK recommended_state restricts', () => {
        expect(() => db.prepare(
            `INSERT INTO ml_tension_assessments
             (user_id, resolved_env, assessment_id, sources_json,
              tension_score, gradient_kind, recommended_state, ts)
             VALUES (?, ?, 'TA-SBAD', '{}', 0.5, 'local', 'BOGUS', ?)`
        ).run(TEST_USER, TEST_ENV, Date.now())).toThrow();
    });

    test('CHECK source_kind restricts', () => {
        expect(() => db.prepare(
            `INSERT INTO ml_tension_sources_audit
             (user_id, resolved_env, audit_id, assessment_id,
              source_kind, contribution_score, notes, ts)
             VALUES (?, ?, 'TSA-BAD', 'A', 'BOGUS', 0.5, NULL, ?)`
        ).run(TEST_USER, TEST_ENV, Date.now())).toThrow();
    });
});

describe('§125 Constants', () => {
    test('TENSION_SOURCES has 8 entries', () => {
        expect(etf.TENSION_SOURCES).toEqual([
            'hypotheses', 'thesis_nodes', 'regime_beliefs',
            'confidence_bounds', 'unknowns', 'competence',
            'operational_health', 'utility_priorities'
        ]);
    });

    test('GRADIENT_KINDS has 4 entries', () => {
        expect(etf.GRADIENT_KINDS).toEqual([
            'local', 'global', 'persistent', 'acute'
        ]);
    });

    test('RECOMMENDED_STATES has 5 entries', () => {
        expect(etf.RECOMMENDED_STATES).toEqual([
            'continue', 'caution', 'reduce_size', 'observer', 'full_freeze'
        ]);
    });

    test('THRESHOLDS strictly increasing', () => {
        expect(etf.THRESHOLDS.caution)
            .toBeLessThan(etf.THRESHOLDS.reduce);
        expect(etf.THRESHOLDS.reduce)
            .toBeLessThan(etf.THRESHOLDS.observer);
        expect(etf.THRESHOLDS.observer)
            .toBeLessThan(etf.THRESHOLDS.freeze);
    });
});

describe('§125 computeTensionScore (pure)', () => {
    test('zero across sources → 0', () => {
        const r = etf.computeTensionScore({
            sourceContributions: ALL_SOURCES_ZERO
        });
        expect(r.tensionScore).toBe(0);
    });

    test('all max → 1.0', () => {
        const r = etf.computeTensionScore({
            sourceContributions: {
                hypotheses: 1, thesis_nodes: 1, regime_beliefs: 1,
                confidence_bounds: 1, unknowns: 1, competence: 1,
                operational_health: 1, utility_priorities: 1
            }
        });
        expect(r.tensionScore).toBe(1.0);
    });

    test('half mix → 0.5', () => {
        const r = etf.computeTensionScore({
            sourceContributions: {
                hypotheses: 1, thesis_nodes: 1, regime_beliefs: 1,
                confidence_bounds: 1, unknowns: 0, competence: 0,
                operational_health: 0, utility_priorities: 0
            }
        });
        expect(r.tensionScore).toBe(0.5);
    });

    test('range violation throws', () => {
        expect(() => etf.computeTensionScore({
            sourceContributions: { ...ALL_SOURCES_ZERO, hypotheses: 1.5 }
        })).toThrow();
    });
});

describe('§125 classifyGradient (pure)', () => {
    test('high local + low global → local', () => {
        const r = etf.classifyGradient({
            localSignal: 0.8, globalSignal: 0.2,
            persistentSignal: 0, acuteSignal: 0
        });
        expect(r.gradientKind).toBe('local');
    });

    test('high global + low local → global', () => {
        const r = etf.classifyGradient({
            localSignal: 0.2, globalSignal: 0.8,
            persistentSignal: 0, acuteSignal: 0
        });
        expect(r.gradientKind).toBe('global');
    });

    test('high persistent → persistent', () => {
        const r = etf.classifyGradient({
            localSignal: 0.3, globalSignal: 0.3,
            persistentSignal: 0.8, acuteSignal: 0
        });
        expect(r.gradientKind).toBe('persistent');
    });

    test('high acute spike → acute', () => {
        const r = etf.classifyGradient({
            localSignal: 0.2, globalSignal: 0.2,
            persistentSignal: 0, acuteSignal: 0.9
        });
        expect(r.gradientKind).toBe('acute');
    });
});

describe('§125 selectRecommendedState (pure)', () => {
    test('very low → continue', () => {
        const r = etf.selectRecommendedState({ tensionScore: 0.10 });
        expect(r.state).toBe('continue');
    });

    test('mid-low → caution', () => {
        const r = etf.selectRecommendedState({ tensionScore: 0.30 });
        expect(r.state).toBe('caution');
    });

    test('mid → reduce_size', () => {
        const r = etf.selectRecommendedState({ tensionScore: 0.50 });
        expect(r.state).toBe('reduce_size');
    });

    test('high → observer', () => {
        const r = etf.selectRecommendedState({ tensionScore: 0.70 });
        expect(r.state).toBe('observer');
    });

    test('extreme → full_freeze', () => {
        const r = etf.selectRecommendedState({ tensionScore: 0.85 });
        expect(r.state).toBe('full_freeze');
    });

    test('persistent escalates one rung', () => {
        const r = etf.selectRecommendedState({
            tensionScore: 0.25, isPersistent: true
        });
        expect(r.state).toBe('reduce_size');   // caution → reduce_size
    });
});

describe('§125 runTensionAssessment', () => {
    test('persists + auto-computes score + state', () => {
        const r = etf.runTensionAssessment({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            assessmentId: 'RTA-1',
            sourceContributions: {
                hypotheses: 0.7, thesis_nodes: 0.5, regime_beliefs: 0.4,
                confidence_bounds: 0.3, unknowns: 0.6, competence: 0.2,
                operational_health: 0.1, utility_priorities: 0.2
            }
        });
        expect(r.assessed).toBe(true);
        expect(r.tensionScore).toBeGreaterThan(0);
        expect(r.recommendedState).toBeTruthy();
    });

    test('duplicate throws', () => {
        etf.runTensionAssessment({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            assessmentId: 'RTA-DUP',
            sourceContributions: ALL_SOURCES_ZERO
        });
        expect(() => etf.runTensionAssessment({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            assessmentId: 'RTA-DUP',
            sourceContributions: ALL_SOURCES_ZERO
        })).toThrow();
    });
});

describe('§125 recordTensionSource', () => {
    test('persists', () => {
        const r = etf.recordTensionSource({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            auditId: 'TS-1', assessmentId: 'A-1',
            sourceKind: 'hypotheses',
            contributionScore: 0.7,
            notes: 'rival thesis spread'
        });
        expect(r.recorded).toBe(true);
    });

    test('invalid source_kind throws', () => {
        expect(() => etf.recordTensionSource({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            auditId: 'TS-BAD', assessmentId: 'A',
            sourceKind: 'BOGUS', contributionScore: 0.5
        })).toThrow();
    });

    test('range violation throws', () => {
        expect(() => etf.recordTensionSource({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            auditId: 'TS-OOR', assessmentId: 'A',
            sourceKind: 'unknowns', contributionScore: 1.5
        })).toThrow();
    });
});

describe('§125 getTensionHistory', () => {
    test('filter by gradient_kind', () => {
        etf.runTensionAssessment({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            assessmentId: 'GTH-1',
            sourceContributions: {
                ...ALL_SOURCES_ZERO, hypotheses: 0.8
            },
            gradientHints: { localSignal: 0.8, globalSignal: 0.2,
                persistentSignal: 0, acuteSignal: 0 }
        });
        etf.runTensionAssessment({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            assessmentId: 'GTH-2',
            sourceContributions: {
                ...ALL_SOURCES_ZERO, unknowns: 0.7
            },
            gradientHints: { localSignal: 0, globalSignal: 0.7,
                persistentSignal: 0, acuteSignal: 0 }
        });
        const r = etf.getTensionHistory({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            gradientFilter: 'local'
        });
        expect(r.find(a => a.assessmentId === 'GTH-1')).toBeTruthy();
    });
});

describe('§125 isolation', () => {
    test('per (user × env) isolation', () => {
        etf.runTensionAssessment({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            assessmentId: 'ISO-1',
            sourceContributions: ALL_SOURCES_ZERO
        });
        const a = etf.getTensionHistory({
            userId: TEST_USER, resolvedEnv: TEST_ENV
        });
        const b = etf.getTensionHistory({
            userId: OTHER_USER, resolvedEnv: TEST_ENV
        });
        expect(a).toHaveLength(1);
        expect(b).toHaveLength(0);
    });
});
