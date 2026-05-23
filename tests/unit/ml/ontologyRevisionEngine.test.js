'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');

const TEST_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-w3-p123-'));
const TEST_DB_PATH = path.join(TEST_DB_DIR, 'test.db');
process.env.ZEUS_DB_PATH = TEST_DB_PATH;
process.env.ZEUS_TEST_DISABLE_AUTH = '1';

const { db } = require('../../../server/services/database');
const ore = require('../../../server/services/ml/R5B_governance/ontologyRevisionEngine');

const TEST_USER = 9123;
const OTHER_USER = 9124;
const TEST_ENV = 'DEMO';

function cleanRows() {
    db.prepare('DELETE FROM ml_primitive_proposals WHERE user_id IN (?, ?)').run(TEST_USER, OTHER_USER);
    db.prepare('DELETE FROM ml_ontology_versions WHERE user_id IN (?, ?)').run(TEST_USER, OTHER_USER);
}

beforeEach(() => cleanRows());
afterAll(() => {
    try { fs.rmSync(TEST_DB_DIR, { recursive: true, force: true }); } catch (_) {}
});

describe('§123 Migrations 235 + 236', () => {
    test('proposal_id UNIQUE', () => {
        const ts = Date.now();
        db.prepare(
            `INSERT INTO ml_primitive_proposals
             (user_id, resolved_env, proposal_id, target_kind, operation,
              proposal_summary, explanatory_gain, compression_gain,
              predictive_gain, complexity_cost, net_score, status,
              ts_proposed, ts_decided)
             VALUES (?, ?, 'PP-UNIQ', 'concept', 'add', 's',
                     0.5, 0.3, 0.4, 0.2, 0.2, 'PROPOSED', ?, NULL)`
        ).run(TEST_USER, TEST_ENV, ts);
        expect(() => db.prepare(
            `INSERT INTO ml_primitive_proposals
             (user_id, resolved_env, proposal_id, target_kind, operation,
              proposal_summary, explanatory_gain, compression_gain,
              predictive_gain, complexity_cost, net_score, status,
              ts_proposed, ts_decided)
             VALUES (?, ?, 'PP-UNIQ', 'regime_primitive', 'split', 's2',
                     0.3, 0.4, 0.5, 0.2, 0.2, 'PROPOSED', ?, NULL)`
        ).run(TEST_USER, TEST_ENV, ts + 1)).toThrow();
    });

    test('CHECK target_kind restricts', () => {
        expect(() => db.prepare(
            `INSERT INTO ml_primitive_proposals
             (user_id, resolved_env, proposal_id, target_kind, operation,
              proposal_summary, explanatory_gain, compression_gain,
              predictive_gain, complexity_cost, net_score, status,
              ts_proposed, ts_decided)
             VALUES (?, ?, 'PP-BAD', 'BOGUS', 'add', 's',
                     0.5, 0.5, 0.5, 0.2, 0.3, 'PROPOSED', ?, NULL)`
        ).run(TEST_USER, TEST_ENV, Date.now())).toThrow();
    });

    test('CHECK operation restricts', () => {
        expect(() => db.prepare(
            `INSERT INTO ml_primitive_proposals
             (user_id, resolved_env, proposal_id, target_kind, operation,
              proposal_summary, explanatory_gain, compression_gain,
              predictive_gain, complexity_cost, net_score, status,
              ts_proposed, ts_decided)
             VALUES (?, ?, 'PP-OBAD', 'concept', 'BOGUS', 's',
                     0.5, 0.5, 0.5, 0.2, 0.3, 'PROPOSED', ?, NULL)`
        ).run(TEST_USER, TEST_ENV, Date.now())).toThrow();
    });

    test('CHECK version_number >= 1', () => {
        expect(() => db.prepare(
            `INSERT INTO ml_ontology_versions
             (user_id, resolved_env, version_id, version_number,
              applied_proposals_json, revision_reason, ts_applied)
             VALUES (?, ?, 'OV-BAD', 0, '[]', 'r', ?)`
        ).run(TEST_USER, TEST_ENV, Date.now())).toThrow();
    });
});

describe('§123 Constants', () => {
    test('TARGET_KINDS has 2 entries', () => {
        expect(ore.TARGET_KINDS).toEqual(['concept', 'regime_primitive']);
    });

    test('OPERATIONS has 7 entries', () => {
        expect(ore.OPERATIONS).toEqual([
            'add', 'split', 'merge', 'rename',
            'widen', 'narrow', 'remove_redundant'
        ]);
    });

    test('PROPOSAL_STATUSES has 4 entries', () => {
        expect(ore.PROPOSAL_STATUSES).toEqual([
            'PROPOSED', 'SHADOW', 'CONFIRMED', 'REJECTED'
        ]);
    });
});

describe('§123 computeNetScore (pure)', () => {
    test('weighted gains minus cost', () => {
        const r = ore.computeNetScore({
            explanatoryGain: 0.8, compressionGain: 0.5,
            predictiveGain: 0.6, complexityCost: 0.2
        });
        // 0.4*0.8 + 0.2*0.5 + 0.4*0.6 - 0.2 = 0.32 + 0.10 + 0.24 - 0.2 = 0.46
        expect(r.netScore).toBeCloseTo(0.46);
    });

    test('all gains zero → negative cost', () => {
        const r = ore.computeNetScore({
            explanatoryGain: 0, compressionGain: 0,
            predictiveGain: 0, complexityCost: 0.5
        });
        expect(r.netScore).toBeCloseTo(-0.5);
    });

    test('range violation throws', () => {
        expect(() => ore.computeNetScore({
            explanatoryGain: 1.5, compressionGain: 0.5,
            predictiveGain: 0.5, complexityCost: 0.2
        })).toThrow();
    });
});

describe('§123 proposePrimitiveChange', () => {
    test('persists with auto-computed net_score', () => {
        const r = ore.proposePrimitiveChange({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            proposalId: 'PC-1', targetKind: 'concept',
            operation: 'add',
            proposalSummary: 'new concept: silent_absorption',
            explanatoryGain: 0.7, compressionGain: 0.3,
            predictiveGain: 0.6, complexityCost: 0.2
        });
        expect(r.proposed).toBe(true);
        expect(r.netScore).toBeGreaterThan(0);
    });

    test('duplicate throws', () => {
        ore.proposePrimitiveChange({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            proposalId: 'PC-DUP', targetKind: 'concept',
            operation: 'add', proposalSummary: 's',
            explanatoryGain: 0.5, compressionGain: 0.5,
            predictiveGain: 0.5, complexityCost: 0.2
        });
        expect(() => ore.proposePrimitiveChange({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            proposalId: 'PC-DUP', targetKind: 'concept',
            operation: 'merge', proposalSummary: 's2',
            explanatoryGain: 0.4, compressionGain: 0.4,
            predictiveGain: 0.4, complexityCost: 0.1
        })).toThrow();
    });

    test('invalid operation throws', () => {
        expect(() => ore.proposePrimitiveChange({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            proposalId: 'PC-BAD', targetKind: 'concept',
            operation: 'BOGUS', proposalSummary: 's',
            explanatoryGain: 0.5, compressionGain: 0.5,
            predictiveGain: 0.5, complexityCost: 0.2
        })).toThrow();
    });

    test('low net_score throws', () => {
        expect(() => ore.proposePrimitiveChange({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            proposalId: 'PC-LOW', targetKind: 'concept',
            operation: 'add', proposalSummary: 's',
            explanatoryGain: 0.1, compressionGain: 0.1,
            predictiveGain: 0.1, complexityCost: 0.5
        })).toThrow();
    });
});

describe('§123 transitionToShadow', () => {
    test('PROPOSED → SHADOW', () => {
        ore.proposePrimitiveChange({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            proposalId: 'TS-1', targetKind: 'concept',
            operation: 'add', proposalSummary: 's',
            explanatoryGain: 0.7, compressionGain: 0.5,
            predictiveGain: 0.6, complexityCost: 0.2
        });
        const r = ore.transitionToShadow({
            userId: TEST_USER, resolvedEnv: TEST_ENV, proposalId: 'TS-1'
        });
        expect(r.newStatus).toBe('SHADOW');
    });
});

describe('§123 confirmProposal', () => {
    function seedShadow(id) {
        ore.proposePrimitiveChange({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            proposalId: id, targetKind: 'concept',
            operation: 'add', proposalSummary: 's',
            explanatoryGain: 0.7, compressionGain: 0.5,
            predictiveGain: 0.6, complexityCost: 0.2
        });
        ore.transitionToShadow({
            userId: TEST_USER, resolvedEnv: TEST_ENV, proposalId: id
        });
    }

    test('CONFIRMED only when validation passed', () => {
        seedShadow('CP-OK');
        const r = ore.confirmProposal({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            proposalId: 'CP-OK', validationPassed: true
        });
        expect(r.newStatus).toBe('CONFIRMED');
    });

    test('rejects without validation', () => {
        seedShadow('CP-NOK');
        expect(() => ore.confirmProposal({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            proposalId: 'CP-NOK', validationPassed: false
        })).toThrow();
    });
});

describe('§123 applyOntologyVersion', () => {
    function seedConfirmed(id) {
        ore.proposePrimitiveChange({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            proposalId: id, targetKind: 'concept',
            operation: 'add', proposalSummary: 's',
            explanatoryGain: 0.7, compressionGain: 0.5,
            predictiveGain: 0.6, complexityCost: 0.2
        });
        ore.transitionToShadow({
            userId: TEST_USER, resolvedEnv: TEST_ENV, proposalId: id
        });
        ore.confirmProposal({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            proposalId: id, validationPassed: true
        });
    }

    test('bumps version + applies confirmed', () => {
        seedConfirmed('AV-1');
        seedConfirmed('AV-2');
        const r = ore.applyOntologyVersion({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            versionId: 'V1', proposalIds: ['AV-1', 'AV-2'],
            revisionReason: 'new_concepts_validated'
        });
        expect(r.applied).toBe(true);
        expect(r.versionNumber).toBe(1);
    });

    test('throws if any not CONFIRMED', () => {
        seedConfirmed('AV-CONF');
        ore.proposePrimitiveChange({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            proposalId: 'AV-PEND', targetKind: 'concept',
            operation: 'add', proposalSummary: 's',
            explanatoryGain: 0.5, compressionGain: 0.5,
            predictiveGain: 0.5, complexityCost: 0.2
        });
        expect(() => ore.applyOntologyVersion({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            versionId: 'V-MIXED',
            proposalIds: ['AV-CONF', 'AV-PEND'],
            revisionReason: 'r'
        })).toThrow();
    });
});

describe('§123 getActiveProposals', () => {
    test('filter by status', () => {
        ore.proposePrimitiveChange({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            proposalId: 'GA-P', targetKind: 'concept',
            operation: 'add', proposalSummary: 's',
            explanatoryGain: 0.5, compressionGain: 0.5,
            predictiveGain: 0.5, complexityCost: 0.2
        });
        ore.proposePrimitiveChange({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            proposalId: 'GA-S', targetKind: 'regime_primitive',
            operation: 'split', proposalSummary: 's',
            explanatoryGain: 0.6, compressionGain: 0.4,
            predictiveGain: 0.5, complexityCost: 0.2
        });
        ore.transitionToShadow({
            userId: TEST_USER, resolvedEnv: TEST_ENV, proposalId: 'GA-S'
        });
        const r = ore.getActiveProposals({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            statusFilter: 'SHADOW'
        });
        expect(r).toHaveLength(1);
        expect(r[0].proposalId).toBe('GA-S');
    });
});

describe('§123 isolation', () => {
    test('per (user × env) isolation', () => {
        ore.proposePrimitiveChange({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            proposalId: 'ISO-1', targetKind: 'concept',
            operation: 'add', proposalSummary: 's',
            explanatoryGain: 0.5, compressionGain: 0.5,
            predictiveGain: 0.5, complexityCost: 0.2
        });
        const a = ore.getActiveProposals({
            userId: TEST_USER, resolvedEnv: TEST_ENV
        });
        const b = ore.getActiveProposals({
            userId: OTHER_USER, resolvedEnv: TEST_ENV
        });
        expect(a).toHaveLength(1);
        expect(b).toHaveLength(0);
    });
});
