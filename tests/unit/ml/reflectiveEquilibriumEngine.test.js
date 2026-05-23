'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');

const TEST_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-w3-p121-'));
const TEST_DB_PATH = path.join(TEST_DB_DIR, 'test.db');
process.env.ZEUS_DB_PATH = TEST_DB_PATH;
process.env.ZEUS_TEST_DISABLE_AUTH = '1';

const { db } = require('../../../server/services/database');
const ree = require('../../../server/services/ml/_meta/reflectiveEquilibriumEngine');

const TEST_USER = 9121;
const OTHER_USER = 9122;
const TEST_ENV = 'DEMO';

function cleanRows() {
    db.prepare('DELETE FROM ml_coherence_audits WHERE user_id IN (?, ?)').run(TEST_USER, OTHER_USER);
    db.prepare('DELETE FROM ml_systemic_contradictions WHERE user_id IN (?, ?)').run(TEST_USER, OTHER_USER);
}

beforeEach(() => cleanRows());
afterAll(() => {
    try { fs.rmSync(TEST_DB_DIR, { recursive: true, force: true }); } catch (_) {}
});

describe('§121 Migrations 231 + 232', () => {
    test('audit_id UNIQUE', () => {
        const ts = Date.now();
        db.prepare(
            `INSERT INTO ml_coherence_audits
             (user_id, resolved_env, audit_id, layers_checked_json,
              equilibrium_score, conflicts_detected, recurring_count, ts)
             VALUES (?, ?, 'CA-UNIQ', '[]', 0.8, 0, 0, ?)`
        ).run(TEST_USER, TEST_ENV, ts);
        expect(() => db.prepare(
            `INSERT INTO ml_coherence_audits
             (user_id, resolved_env, audit_id, layers_checked_json,
              equilibrium_score, conflicts_detected, recurring_count, ts)
             VALUES (?, ?, 'CA-UNIQ', '[]', 0.5, 1, 0, ?)`
        ).run(TEST_USER, TEST_ENV, ts + 1)).toThrow();
    });

    test('CHECK layer_a restricts', () => {
        expect(() => db.prepare(
            `INSERT INTO ml_systemic_contradictions
             (user_id, resolved_env, contradiction_id, audit_id,
              layer_a, layer_b, conflict_description,
              recurrence_count, recommended_action, ts)
             VALUES (?, ?, 'SC-BAD', 'A', 'BOGUS', 'utility',
                     'd', 1, 'no_action', ?)`
        ).run(TEST_USER, TEST_ENV, Date.now())).toThrow();
    });

    test('CHECK recommended_action restricts', () => {
        expect(() => db.prepare(
            `INSERT INTO ml_systemic_contradictions
             (user_id, resolved_env, contradiction_id, audit_id,
              layer_a, layer_b, conflict_description,
              recurrence_count, recommended_action, ts)
             VALUES (?, ?, 'SC-ABAD', 'A', 'utility', 'policy_layer',
                     'd', 1, 'BOGUS', ?)`
        ).run(TEST_USER, TEST_ENV, Date.now())).toThrow();
    });

    test('CHECK equilibrium_score range', () => {
        expect(() => db.prepare(
            `INSERT INTO ml_coherence_audits
             (user_id, resolved_env, audit_id, layers_checked_json,
              equilibrium_score, conflicts_detected, recurring_count, ts)
             VALUES (?, ?, 'CA-OOR', '[]', 1.5, 0, 0, ?)`
        ).run(TEST_USER, TEST_ENV, Date.now())).toThrow();
    });
});

describe('§121 Constants', () => {
    test('CANONICAL_LAYERS has 6 entries', () => {
        expect(ree.CANONICAL_LAYERS).toEqual([
            'constitution', 'utility', 'regime_grammar',
            'concept_library', 'thesis_graph', 'policy_layer'
        ]);
    });

    test('RECOMMENDED_ACTIONS has 5 entries', () => {
        expect(ree.RECOMMENDED_ACTIONS).toEqual([
            'review_rule', 'weaken_concept', 'quarantine_heuristic',
            'escalate_governance', 'no_action'
        ]);
    });

    test('CROSS_LAYER_ESCALATE > RECURRENCE_THRESHOLD', () => {
        expect(ree.CROSS_LAYER_ESCALATE_THRESHOLD)
            .toBeGreaterThan(ree.RECURRENCE_THRESHOLD);
    });
});

describe('§121 computeEquilibriumScore (pure)', () => {
    test('zero conflicts → 1.0', () => {
        const r = ree.computeEquilibriumScore({
            totalConflicts: 0, recurringCount: 0
        });
        expect(r.equilibriumScore).toBe(1.0);
    });

    test('many recurring → low score', () => {
        const r = ree.computeEquilibriumScore({
            totalConflicts: 10, recurringCount: 6
        });
        expect(r.equilibriumScore).toBeLessThan(0.3);
    });

    test('clamps to [0,1]', () => {
        const r = ree.computeEquilibriumScore({
            totalConflicts: 100, recurringCount: 50
        });
        expect(r.equilibriumScore).toBeGreaterThanOrEqual(0);
        expect(r.equilibriumScore).toBeLessThanOrEqual(1);
    });
});

describe('§121 proposeRevisionAction (pure)', () => {
    test('cross-layer + recurrence >= 5 → escalate_governance', () => {
        const r = ree.proposeRevisionAction({
            recurrenceCount: 6, isCrossLayer: true, layerKind: 'utility'
        });
        expect(r.action).toBe('escalate_governance');
    });

    test('concept-side recurrent → weaken_concept', () => {
        const r = ree.proposeRevisionAction({
            recurrenceCount: 4, isCrossLayer: false,
            layerKind: 'concept_library'
        });
        expect(r.action).toBe('weaken_concept');
    });

    test('policy_layer recurrent → quarantine_heuristic', () => {
        const r = ree.proposeRevisionAction({
            recurrenceCount: 4, isCrossLayer: false,
            layerKind: 'policy_layer'
        });
        expect(r.action).toBe('quarantine_heuristic');
    });

    test('moderate rule conflict → review_rule', () => {
        const r = ree.proposeRevisionAction({
            recurrenceCount: 2, isCrossLayer: false,
            layerKind: 'thesis_graph'
        });
        expect(r.action).toBe('review_rule');
    });

    test('single local conflict → no_action', () => {
        const r = ree.proposeRevisionAction({
            recurrenceCount: 1, isCrossLayer: false,
            layerKind: 'utility'
        });
        expect(r.action).toBe('no_action');
    });
});

describe('§121 runCoherenceAudit', () => {
    test('persists', () => {
        const r = ree.runCoherenceAudit({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            auditId: 'RCA-1',
            layersChecked: ['constitution', 'utility'],
            equilibriumScore: 0.8, conflictsDetected: 2,
            recurringCount: 0
        });
        expect(r.recorded).toBe(true);
    });

    test('duplicate throws', () => {
        ree.runCoherenceAudit({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            auditId: 'RCA-DUP', layersChecked: ['constitution'],
            equilibriumScore: 0.5, conflictsDetected: 0, recurringCount: 0
        });
        expect(() => ree.runCoherenceAudit({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            auditId: 'RCA-DUP', layersChecked: ['utility'],
            equilibriumScore: 0.6, conflictsDetected: 0, recurringCount: 0
        })).toThrow();
    });

    test('out-of-range score throws', () => {
        expect(() => ree.runCoherenceAudit({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            auditId: 'RCA-OOR', layersChecked: [],
            equilibriumScore: 1.5, conflictsDetected: 0, recurringCount: 0
        })).toThrow();
    });
});

describe('§121 recordContradiction', () => {
    test('persists', () => {
        const r = ree.recordContradiction({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            contradictionId: 'RC-1', auditId: 'A-1',
            layerA: 'utility', layerB: 'constitution',
            conflictDescription: 'profit conflict with safety constraint',
            recurrenceCount: 2,
            recommendedAction: 'review_rule'
        });
        expect(r.recorded).toBe(true);
    });

    test('invalid layer throws', () => {
        expect(() => ree.recordContradiction({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            contradictionId: 'RC-BAD', auditId: 'A',
            layerA: 'BOGUS', layerB: 'utility',
            conflictDescription: 'x', recurrenceCount: 1,
            recommendedAction: 'no_action'
        })).toThrow();
    });

    test('invalid action throws', () => {
        expect(() => ree.recordContradiction({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            contradictionId: 'RC-ABAD', auditId: 'A',
            layerA: 'utility', layerB: 'constitution',
            conflictDescription: 'x', recurrenceCount: 1,
            recommendedAction: 'BOGUS'
        })).toThrow();
    });
});

describe('§121 detectRecurringConflicts', () => {
    test('finds layer-pair conflicts above threshold', () => {
        // Add 3 contradictions on same layer pair
        for (let i = 0; i < 3; i++) {
            ree.recordContradiction({
                userId: TEST_USER, resolvedEnv: TEST_ENV,
                contradictionId: `DRC-${i}`, auditId: 'A',
                layerA: 'utility', layerB: 'constitution',
                conflictDescription: 'profit vs safety',
                recurrenceCount: 1, recommendedAction: 'no_action'
            });
        }
        const r = ree.detectRecurringConflicts({
            userId: TEST_USER, resolvedEnv: TEST_ENV
        });
        expect(r.length).toBeGreaterThan(0);
        expect(r[0].count).toBeGreaterThanOrEqual(ree.RECURRENCE_THRESHOLD);
    });
});

describe('§121 getContradictionHistory', () => {
    test('filter by layer', () => {
        ree.recordContradiction({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            contradictionId: 'GC-A', auditId: 'A',
            layerA: 'utility', layerB: 'constitution',
            conflictDescription: 'd', recurrenceCount: 1,
            recommendedAction: 'review_rule'
        });
        ree.recordContradiction({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            contradictionId: 'GC-B', auditId: 'A',
            layerA: 'concept_library', layerB: 'thesis_graph',
            conflictDescription: 'd', recurrenceCount: 1,
            recommendedAction: 'weaken_concept'
        });
        const r = ree.getContradictionHistory({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            layerFilter: 'utility'
        });
        expect(r).toHaveLength(1);
        expect(r[0].contradictionId).toBe('GC-A');
    });
});

describe('§121 isolation', () => {
    test('per (user × env) isolation', () => {
        ree.runCoherenceAudit({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            auditId: 'ISO-1', layersChecked: [],
            equilibriumScore: 0.5, conflictsDetected: 0, recurringCount: 0
        });
        const a = ree.getContradictionHistory({
            userId: TEST_USER, resolvedEnv: TEST_ENV
        });
        ree.recordContradiction({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            contradictionId: 'ISO-C', auditId: 'ISO-1',
            layerA: 'utility', layerB: 'constitution',
            conflictDescription: 'd', recurrenceCount: 1,
            recommendedAction: 'no_action'
        });
        const b = ree.getContradictionHistory({
            userId: OTHER_USER, resolvedEnv: TEST_ENV
        });
        expect(b).toHaveLength(0);
    });
});
