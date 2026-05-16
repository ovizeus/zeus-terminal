'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');

const TEST_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-w3-p115-'));
const TEST_DB_PATH = path.join(TEST_DB_DIR, 'test.db');
process.env.ZEUS_DB_PATH = TEST_DB_PATH;
process.env.ZEUS_TEST_DISABLE_AUTH = '1';

const { db } = require('../../../server/services/database');
const sre = require('../../../server/services/ml/_meta/selfRepairEngine');

const TEST_USER = 9115;
const OTHER_USER = 9116;
const TEST_ENV = 'DEMO';

function cleanRows() {
    db.prepare('DELETE FROM ml_repair_proposals WHERE user_id IN (?, ?)').run(TEST_USER, OTHER_USER);
    db.prepare('DELETE FROM ml_repair_outcomes WHERE user_id IN (?, ?)').run(TEST_USER, OTHER_USER);
}

beforeEach(() => cleanRows());
afterAll(() => {
    try { fs.rmSync(TEST_DB_DIR, { recursive: true, force: true }); } catch (_) {}
});

describe('§115 Migrations 219 + 220', () => {
    test('proposal_id UNIQUE', () => {
        const ts = Date.now();
        db.prepare(
            `INSERT INTO ml_repair_proposals
             (user_id, resolved_env, proposal_id, issue_kind,
              remediation_type, affected_component_id,
              expected_benefit, expected_risk, rank_score,
              status, justification, ts_proposed, ts_decided)
             VALUES (?, ?, 'RP-UNIQ', 'threshold', 'retune', 'detector_X',
                     0.6, 0.2, 0.2, 'PROPOSED', 'j', ?, NULL)`
        ).run(TEST_USER, TEST_ENV, ts);
        expect(() => db.prepare(
            `INSERT INTO ml_repair_proposals
             (user_id, resolved_env, proposal_id, issue_kind,
              remediation_type, affected_component_id,
              expected_benefit, expected_risk, rank_score,
              status, justification, ts_proposed, ts_decided)
             VALUES (?, ?, 'RP-UNIQ', 'sizing', 'replace', 'Y',
                     0.3, 0.4, -0.5, 'PROPOSED', 'j2', ?, NULL)`
        ).run(TEST_USER, TEST_ENV, ts + 1)).toThrow();
    });

    test('CHECK issue_kind restricts', () => {
        expect(() => db.prepare(
            `INSERT INTO ml_repair_proposals
             (user_id, resolved_env, proposal_id, issue_kind,
              remediation_type, affected_component_id,
              expected_benefit, expected_risk, rank_score,
              status, justification, ts_proposed, ts_decided)
             VALUES (?, ?, 'RP-BAD', 'BOGUS', 'retune', 'X',
                     0.5, 0.2, 0.1, 'PROPOSED', 'j', ?, NULL)`
        ).run(TEST_USER, TEST_ENV, Date.now())).toThrow();
    });

    test('CHECK expected_benefit range', () => {
        expect(() => db.prepare(
            `INSERT INTO ml_repair_proposals
             (user_id, resolved_env, proposal_id, issue_kind,
              remediation_type, affected_component_id,
              expected_benefit, expected_risk, rank_score,
              status, justification, ts_proposed, ts_decided)
             VALUES (?, ?, 'RP-OOR', 'threshold', 'retune', 'X',
                     1.5, 0.2, 1.1, 'PROPOSED', 'j', ?, NULL)`
        ).run(TEST_USER, TEST_ENV, Date.now())).toThrow();
    });

    test('CHECK outcome decision restricts', () => {
        expect(() => db.prepare(
            `INSERT INTO ml_repair_outcomes
             (user_id, resolved_env, outcome_id, proposal_id,
              observed_benefit, observed_risk, decision, reason, ts)
             VALUES (?, ?, 'RO-BAD', 'P', 0.5, 0.2, 'BOGUS', NULL, ?)`
        ).run(TEST_USER, TEST_ENV, Date.now())).toThrow();
    });
});

describe('§115 Constants', () => {
    test('ISSUE_KINDS has 6 entries', () => {
        expect(sre.ISSUE_KINDS).toEqual([
            'threshold', 'regime_misclassification', 'sizing',
            'execution_drift', 'feature_redundancy', 'stale_concepts'
        ]);
    });

    test('REMEDIATION_TYPES has 6 entries', () => {
        expect(sre.REMEDIATION_TYPES).toEqual([
            'retune', 'retrain', 'disable', 'replace',
            'quarantine', 'shadow_experiment'
        ]);
    });

    test('PROPOSAL_STATUSES has 5 entries', () => {
        expect(sre.PROPOSAL_STATUSES).toEqual([
            'PROPOSED', 'SHADOW', 'CANARY', 'APPLIED', 'REJECTED'
        ]);
    });

    test('OUTCOME_DECISIONS has 3 entries', () => {
        expect(sre.OUTCOME_DECISIONS).toEqual([
            'PROMOTE', 'REJECT', 'EXTEND_SHADOW'
        ]);
    });

    test('RISK_AVERSION_LAMBDA > 1 (conservative)', () => {
        expect(sre.RISK_AVERSION_LAMBDA).toBeGreaterThan(1);
    });
});

describe('§115 computeRankScore (pure)', () => {
    test('benefit minus lambda × risk', () => {
        const r = sre.computeRankScore({
            expectedBenefit: 0.8, expectedRisk: 0.2
        });
        // 0.8 - 2.0 × 0.2 = 0.4
        expect(r.rankScore).toBeCloseTo(0.4);
    });

    test('high risk yields negative rank', () => {
        const r = sre.computeRankScore({
            expectedBenefit: 0.3, expectedRisk: 0.5
        });
        // 0.3 - 1.0 = -0.7
        expect(r.rankScore).toBeLessThan(0);
    });

    test('custom lambda override', () => {
        const r = sre.computeRankScore({
            expectedBenefit: 0.5, expectedRisk: 0.5,
            riskAversionLambda: 1.0
        });
        expect(r.rankScore).toBe(0);
    });
});

describe('§115 proposeRepair', () => {
    test('persists with auto-computed rank', () => {
        const r = sre.proposeRepair({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            proposalId: 'PR-1', issueKind: 'threshold',
            remediationType: 'retune',
            affectedComponentId: 'detector_cvd',
            expectedBenefit: 0.6, expectedRisk: 0.1,
            justification: 'cvd false-positive rate elevated last 7d'
        });
        expect(r.proposed).toBe(true);
        expect(r.rankScore).toBeCloseTo(0.4);
    });

    test('duplicate throws', () => {
        sre.proposeRepair({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            proposalId: 'PR-DUP', issueKind: 'sizing',
            remediationType: 'retune',
            affectedComponentId: 'C', expectedBenefit: 0.5,
            expectedRisk: 0.2, justification: 'j'
        });
        expect(() => sre.proposeRepair({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            proposalId: 'PR-DUP', issueKind: 'sizing',
            remediationType: 'replace',
            affectedComponentId: 'C2', expectedBenefit: 0.4,
            expectedRisk: 0.1, justification: 'j2'
        })).toThrow();
    });

    test('invalid issue_kind throws', () => {
        expect(() => sre.proposeRepair({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            proposalId: 'PR-BAD', issueKind: 'BOGUS',
            remediationType: 'retune',
            affectedComponentId: 'X', expectedBenefit: 0.5,
            expectedRisk: 0.1, justification: 'j'
        })).toThrow();
    });

    test('below MIN_BENEFIT_TO_PROPOSE throws', () => {
        expect(() => sre.proposeRepair({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            proposalId: 'PR-LOW', issueKind: 'threshold',
            remediationType: 'retune',
            affectedComponentId: 'X', expectedBenefit: 0.05,
            expectedRisk: 0.1, justification: 'j'
        })).toThrow();
    });
});

describe('§115 transitionToShadow', () => {
    test('PROPOSED → SHADOW', () => {
        sre.proposeRepair({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            proposalId: 'TS-1', issueKind: 'threshold',
            remediationType: 'retune',
            affectedComponentId: 'X', expectedBenefit: 0.5,
            expectedRisk: 0.1, justification: 'j'
        });
        const r = sre.transitionToShadow({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            proposalId: 'TS-1'
        });
        expect(r.newStatus).toBe('SHADOW');
    });

    test('rejects from invalid state', () => {
        sre.proposeRepair({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            proposalId: 'TS-INV', issueKind: 'threshold',
            remediationType: 'retune',
            affectedComponentId: 'X', expectedBenefit: 0.5,
            expectedRisk: 0.1, justification: 'j'
        });
        sre.transitionToShadow({
            userId: TEST_USER, resolvedEnv: TEST_ENV, proposalId: 'TS-INV'
        });
        // Already SHADOW — can't transition to SHADOW again
        expect(() => sre.transitionToShadow({
            userId: TEST_USER, resolvedEnv: TEST_ENV, proposalId: 'TS-INV'
        })).toThrow();
    });
});

describe('§115 transitionToCanary', () => {
    test('SHADOW → CANARY', () => {
        sre.proposeRepair({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            proposalId: 'TC-1', issueKind: 'threshold',
            remediationType: 'retune',
            affectedComponentId: 'X', expectedBenefit: 0.5,
            expectedRisk: 0.1, justification: 'j'
        });
        sre.transitionToShadow({
            userId: TEST_USER, resolvedEnv: TEST_ENV, proposalId: 'TC-1'
        });
        const r = sre.transitionToCanary({
            userId: TEST_USER, resolvedEnv: TEST_ENV, proposalId: 'TC-1'
        });
        expect(r.newStatus).toBe('CANARY');
    });

    test('rejects from PROPOSED (must go through SHADOW)', () => {
        sre.proposeRepair({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            proposalId: 'TC-SKIP', issueKind: 'threshold',
            remediationType: 'retune',
            affectedComponentId: 'X', expectedBenefit: 0.5,
            expectedRisk: 0.1, justification: 'j'
        });
        expect(() => sre.transitionToCanary({
            userId: TEST_USER, resolvedEnv: TEST_ENV, proposalId: 'TC-SKIP'
        })).toThrow();
    });
});

describe('§115 recordRepairOutcome', () => {
    function seedAtCanary(id) {
        sre.proposeRepair({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            proposalId: id, issueKind: 'threshold',
            remediationType: 'retune',
            affectedComponentId: 'X', expectedBenefit: 0.5,
            expectedRisk: 0.1, justification: 'j'
        });
        sre.transitionToShadow({
            userId: TEST_USER, resolvedEnv: TEST_ENV, proposalId: id
        });
        sre.transitionToCanary({
            userId: TEST_USER, resolvedEnv: TEST_ENV, proposalId: id
        });
    }

    test('PROMOTE → APPLIED', () => {
        seedAtCanary('RO-PROMOTE');
        const r = sre.recordRepairOutcome({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            outcomeId: 'RO-O-P', proposalId: 'RO-PROMOTE',
            observedBenefit: 0.7, observedRisk: 0.1,
            decision: 'PROMOTE', reason: 'canary_success'
        });
        expect(r.newStatus).toBe('APPLIED');
    });

    test('REJECT → REJECTED', () => {
        seedAtCanary('RO-REJECT');
        const r = sre.recordRepairOutcome({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            outcomeId: 'RO-O-R', proposalId: 'RO-REJECT',
            observedBenefit: 0, observedRisk: 0.8,
            decision: 'REJECT', reason: 'canary_failure'
        });
        expect(r.newStatus).toBe('REJECTED');
    });

    test('EXTEND_SHADOW keeps current status', () => {
        seedAtCanary('RO-EXTEND');
        const r = sre.recordRepairOutcome({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            outcomeId: 'RO-O-E', proposalId: 'RO-EXTEND',
            observedBenefit: 0.3, observedRisk: 0.2,
            decision: 'EXTEND_SHADOW', reason: 'inconclusive'
        });
        expect(r.newStatus).toBe('CANARY');
    });
});

describe('§115 getActiveProposals', () => {
    test('filter by status', () => {
        sre.proposeRepair({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            proposalId: 'GA-A', issueKind: 'threshold',
            remediationType: 'retune',
            affectedComponentId: 'X', expectedBenefit: 0.5,
            expectedRisk: 0.1, justification: 'j'
        });
        sre.proposeRepair({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            proposalId: 'GA-B', issueKind: 'sizing',
            remediationType: 'replace',
            affectedComponentId: 'Y', expectedBenefit: 0.6,
            expectedRisk: 0.2, justification: 'j'
        });
        sre.transitionToShadow({
            userId: TEST_USER, resolvedEnv: TEST_ENV, proposalId: 'GA-B'
        });
        const r = sre.getActiveProposals({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            statusFilter: 'PROPOSED'
        });
        expect(r).toHaveLength(1);
        expect(r[0].proposalId).toBe('GA-A');
    });
});

describe('§115 isolation', () => {
    test('per (user × env) isolation', () => {
        sre.proposeRepair({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            proposalId: 'ISO-1', issueKind: 'threshold',
            remediationType: 'retune',
            affectedComponentId: 'X', expectedBenefit: 0.5,
            expectedRisk: 0.1, justification: 'j'
        });
        const a = sre.getActiveProposals({
            userId: TEST_USER, resolvedEnv: TEST_ENV
        });
        const b = sre.getActiveProposals({
            userId: OTHER_USER, resolvedEnv: TEST_ENV
        });
        expect(a).toHaveLength(1);
        expect(b).toHaveLength(0);
    });
});
