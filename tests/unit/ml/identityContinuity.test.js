'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');

const TEST_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-w3-p127-'));
const TEST_DB_PATH = path.join(TEST_DB_DIR, 'test.db');
process.env.ZEUS_DB_PATH = TEST_DB_PATH;
process.env.ZEUS_TEST_DISABLE_AUTH = '1';

const { db } = require('../../../server/services/database');
const ic = require('../../../server/services/ml/_meta/identityContinuity');

const TEST_USER = 9127;
const OTHER_USER = 9128;
const TEST_ENV = 'DEMO';

function cleanRows() {
    db.prepare('DELETE FROM ml_identity_snapshots WHERE user_id IN (?, ?)').run(TEST_USER, OTHER_USER);
    db.prepare('DELETE FROM ml_identity_drift_audits WHERE user_id IN (?, ?)').run(TEST_USER, OTHER_USER);
}

beforeEach(() => cleanRows());
afterAll(() => {
    try { fs.rmSync(TEST_DB_DIR, { recursive: true, force: true }); } catch (_) {}
});

const HASH_SET_A = {
    charterHash: 'h-charter-A',
    ontologyHash: 'h-ontology-A',
    conceptsHash: 'h-concepts-A',
    utilityPrioritiesHash: 'h-utility-A',
    regimeGrammarHash: 'h-regime-A',
    policyStyleHash: 'h-policy-A',
    riskPhilosophyHash: 'h-risk-A'
};

const HASH_SET_B_MINOR = {
    ...HASH_SET_A,
    policyStyleHash: 'h-policy-B' // only minor axis changed
};

describe('§127 Migrations 243 + 244', () => {
    test('snapshot_id UNIQUE', () => {
        const ts = Date.now();
        db.prepare(
            `INSERT INTO ml_identity_snapshots
             (user_id, resolved_env, snapshot_id, version_label,
              charter_hash, ontology_hash, concepts_hash,
              utility_priorities_hash, regime_grammar_hash,
              policy_style_hash, risk_philosophy_hash, ts)
             VALUES (?, ?, 'IS-UNIQ', 'v1', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'h7', ?)`
        ).run(TEST_USER, TEST_ENV, ts);
        expect(() => db.prepare(
            `INSERT INTO ml_identity_snapshots
             (user_id, resolved_env, snapshot_id, version_label,
              charter_hash, ontology_hash, concepts_hash,
              utility_priorities_hash, regime_grammar_hash,
              policy_style_hash, risk_philosophy_hash, ts)
             VALUES (?, ?, 'IS-UNIQ', 'v2', 'a', 'b', 'c', 'd', 'e', 'f', 'g', ?)`
        ).run(TEST_USER, TEST_ENV, ts + 1)).toThrow();
    });

    test('CHECK drift_kind restricts', () => {
        expect(() => db.prepare(
            `INSERT INTO ml_identity_drift_audits
             (user_id, resolved_env, audit_id, from_snapshot_id,
              to_snapshot_id, axis_drifts_json, continuity_score,
              drift_kind, ts)
             VALUES (?, ?, 'IDA-BAD', 'S1', 'S2', '{}', 0.8, 'BOGUS', ?)`
        ).run(TEST_USER, TEST_ENV, Date.now())).toThrow();
    });

    test('CHECK continuity_score range', () => {
        expect(() => db.prepare(
            `INSERT INTO ml_identity_drift_audits
             (user_id, resolved_env, audit_id, from_snapshot_id,
              to_snapshot_id, axis_drifts_json, continuity_score,
              drift_kind, ts)
             VALUES (?, ?, 'IDA-OOR', 'S1', 'S2', '{}', 1.5, 'evolution_normal', ?)`
        ).run(TEST_USER, TEST_ENV, Date.now())).toThrow();
    });
});

describe('§127 Constants', () => {
    test('IDENTITY_AXES has 7 entries', () => {
        expect(ic.IDENTITY_AXES).toEqual([
            'charter', 'ontology', 'concepts',
            'utility_priorities', 'regime_grammar',
            'policy_style', 'risk_philosophy'
        ]);
    });

    test('DRIFT_KINDS has 4 entries', () => {
        expect(ic.DRIFT_KINDS).toEqual([
            'evolution_normal', 'identity_drift',
            'major_self_rewrite', 'forced_governance_review'
        ]);
    });

    test('CONTINUITY_THRESHOLDS strictly decreasing', () => {
        expect(ic.CONTINUITY_THRESHOLDS.evolution)
            .toBeGreaterThan(ic.CONTINUITY_THRESHOLDS.drift);
        expect(ic.CONTINUITY_THRESHOLDS.drift)
            .toBeGreaterThan(ic.CONTINUITY_THRESHOLDS.rewrite);
    });

    test('DEFAULT_AXIS_WEIGHTS sum to 1.0', () => {
        const sum = Object.values(ic.DEFAULT_AXIS_WEIGHTS).reduce((s, w) => s + w, 0);
        expect(sum).toBeCloseTo(1.0, 4);
    });

    test('charter has highest weight', () => {
        const w = ic.DEFAULT_AXIS_WEIGHTS;
        expect(w.charter).toBeGreaterThanOrEqual(w.ontology);
        expect(w.charter).toBeGreaterThanOrEqual(w.policy_style);
    });
});

describe('§127 computeAxisDrift (pure)', () => {
    test('same hash → 0', () => {
        const r = ic.computeAxisDrift({ oldHash: 'abc', newHash: 'abc' });
        expect(r.drift).toBe(0);
    });

    test('different hash → 1', () => {
        const r = ic.computeAxisDrift({ oldHash: 'abc', newHash: 'xyz' });
        expect(r.drift).toBe(1);
    });
});

describe('§127 computeContinuityScore (pure)', () => {
    test('all axis identical → 1.0', () => {
        const r = ic.computeContinuityScore({
            axisDrifts: {
                charter: 0, ontology: 0, concepts: 0,
                utility_priorities: 0, regime_grammar: 0,
                policy_style: 0, risk_philosophy: 0
            }
        });
        expect(r.continuityScore).toBe(1.0);
    });

    test('all axis different → 0.0', () => {
        const r = ic.computeContinuityScore({
            axisDrifts: {
                charter: 1, ontology: 1, concepts: 1,
                utility_priorities: 1, regime_grammar: 1,
                policy_style: 1, risk_philosophy: 1
            }
        });
        expect(r.continuityScore).toBe(0.0);
    });

    test('only policy_style drifted (5% weight) → 0.95', () => {
        const r = ic.computeContinuityScore({
            axisDrifts: {
                charter: 0, ontology: 0, concepts: 0,
                utility_priorities: 0, regime_grammar: 0,
                policy_style: 1, risk_philosophy: 0
            }
        });
        expect(r.continuityScore).toBeCloseTo(0.95, 2);
    });

    test('only charter drifted (30% weight) → 0.70', () => {
        const r = ic.computeContinuityScore({
            axisDrifts: {
                charter: 1, ontology: 0, concepts: 0,
                utility_priorities: 0, regime_grammar: 0,
                policy_style: 0, risk_philosophy: 0
            }
        });
        expect(r.continuityScore).toBeCloseTo(0.70, 2);
    });
});

describe('§127 classifyDriftKind (pure)', () => {
    test('>= 0.85 → evolution_normal', () => {
        const r = ic.classifyDriftKind({ continuityScore: 0.90 });
        expect(r.driftKind).toBe('evolution_normal');
    });

    test('>= 0.65 → identity_drift', () => {
        const r = ic.classifyDriftKind({ continuityScore: 0.75 });
        expect(r.driftKind).toBe('identity_drift');
    });

    test('>= 0.40 → major_self_rewrite', () => {
        const r = ic.classifyDriftKind({ continuityScore: 0.50 });
        expect(r.driftKind).toBe('major_self_rewrite');
    });

    test('< 0.40 → forced_governance_review', () => {
        const r = ic.classifyDriftKind({ continuityScore: 0.20 });
        expect(r.driftKind).toBe('forced_governance_review');
    });
});

describe('§127 captureIdentitySnapshot', () => {
    test('persists', () => {
        const r = ic.captureIdentitySnapshot({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            snapshotId: 'CIS-1', versionLabel: 'v1.0',
            ...HASH_SET_A
        });
        expect(r.captured).toBe(true);
    });

    test('duplicate throws', () => {
        ic.captureIdentitySnapshot({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            snapshotId: 'CIS-DUP', versionLabel: 'v1',
            ...HASH_SET_A
        });
        expect(() => ic.captureIdentitySnapshot({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            snapshotId: 'CIS-DUP', versionLabel: 'v2',
            ...HASH_SET_B_MINOR
        })).toThrow();
    });
});

describe('§127 auditIdentityDrift', () => {
    test('persists + auto-classifies drift kind', () => {
        const r = ic.auditIdentityDrift({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            auditId: 'AID-1',
            fromSnapshotId: 'S1', toSnapshotId: 'S2',
            axisDrifts: {
                charter: 0, ontology: 0, concepts: 0,
                utility_priorities: 0, regime_grammar: 0,
                policy_style: 1, risk_philosophy: 0
            }
        });
        expect(r.audited).toBe(true);
        expect(r.driftKind).toBe('evolution_normal'); // 0.95
    });

    test('big drift → major_self_rewrite or forced', () => {
        const r = ic.auditIdentityDrift({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            auditId: 'AID-BIG',
            fromSnapshotId: 'S1', toSnapshotId: 'S2',
            axisDrifts: {
                charter: 1, ontology: 1, concepts: 1,
                utility_priorities: 1, regime_grammar: 1,
                policy_style: 0, risk_philosophy: 0
            }
        });
        // 1 - 0.30 - 0.20 - 0.15 - 0.15 - 0.10 = 0.10 → forced
        expect(r.driftKind).toBe('forced_governance_review');
    });

    test('duplicate throws', () => {
        ic.auditIdentityDrift({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            auditId: 'AID-DUP',
            fromSnapshotId: 'S1', toSnapshotId: 'S2',
            axisDrifts: {
                charter: 0, ontology: 0, concepts: 0,
                utility_priorities: 0, regime_grammar: 0,
                policy_style: 0, risk_philosophy: 0
            }
        });
        expect(() => ic.auditIdentityDrift({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            auditId: 'AID-DUP',
            fromSnapshotId: 'S3', toSnapshotId: 'S4',
            axisDrifts: {
                charter: 1, ontology: 0, concepts: 0,
                utility_priorities: 0, regime_grammar: 0,
                policy_style: 0, risk_philosophy: 0
            }
        })).toThrow();
    });
});

describe('§127 getIdentityHistory', () => {
    test('filter by drift_kind', () => {
        ic.auditIdentityDrift({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            auditId: 'GH-EVO', fromSnapshotId: 'A', toSnapshotId: 'B',
            axisDrifts: {
                charter: 0, ontology: 0, concepts: 0,
                utility_priorities: 0, regime_grammar: 0,
                policy_style: 1, risk_philosophy: 0
            }
        });
        ic.auditIdentityDrift({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            auditId: 'GH-DRIFT', fromSnapshotId: 'A', toSnapshotId: 'C',
            axisDrifts: {
                charter: 1, ontology: 0, concepts: 0,
                utility_priorities: 0, regime_grammar: 0,
                policy_style: 0, risk_philosophy: 0
            }
        });
        const r = ic.getIdentityHistory({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            driftKindFilter: 'evolution_normal'
        });
        expect(r).toHaveLength(1);
        expect(r[0].auditId).toBe('GH-EVO');
    });
});

describe('§127 isolation', () => {
    test('per (user × env) isolation', () => {
        ic.captureIdentitySnapshot({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            snapshotId: 'ISO-1', versionLabel: 'v1',
            ...HASH_SET_A
        });
        ic.auditIdentityDrift({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            auditId: 'ISO-A', fromSnapshotId: 'S1', toSnapshotId: 'S2',
            axisDrifts: {
                charter: 0, ontology: 0, concepts: 0,
                utility_priorities: 0, regime_grammar: 0,
                policy_style: 0, risk_philosophy: 0
            }
        });
        const a = ic.getIdentityHistory({
            userId: TEST_USER, resolvedEnv: TEST_ENV
        });
        const b = ic.getIdentityHistory({
            userId: OTHER_USER, resolvedEnv: TEST_ENV
        });
        expect(a).toHaveLength(1);
        expect(b).toHaveLength(0);
    });
});
