'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');

const TEST_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-w3-p113-'));
const TEST_DB_PATH = path.join(TEST_DB_DIR, 'test.db');
process.env.ZEUS_DB_PATH = TEST_DB_PATH;
process.env.ZEUS_TEST_DISABLE_AUTH = '1';

const { db } = require('../../../server/services/database');
const cde = require('../../../server/services/ml/R2_cognition/causalDiscoveryEngine');

const TEST_USER = 9113;
const OTHER_USER = 9114;
const TEST_ENV = 'DEMO';

function cleanRows() {
    db.prepare('DELETE FROM ml_causal_edge_proposals WHERE user_id IN (?, ?)').run(TEST_USER, OTHER_USER);
    db.prepare('DELETE FROM ml_graph_revisions WHERE user_id IN (?, ?)').run(TEST_USER, OTHER_USER);
}

beforeEach(() => cleanRows());
afterAll(() => {
    try { fs.rmSync(TEST_DB_DIR, { recursive: true, force: true }); } catch (_) {}
});

describe('§113 Migrations 215 + 216', () => {
    test('proposal_id UNIQUE', () => {
        const ts = Date.now();
        db.prepare(
            `INSERT INTO ml_causal_edge_proposals
             (user_id, resolved_env, proposal_id, from_node, to_node,
              proposed_change, candidate_strength, evidence_summary,
              evidence_count, status, human_approved,
              ts_proposed, ts_decided)
             VALUES (?, ?, 'CEP-UNIQ', 'A', 'B', 'ADD', 0.5, 'e', 5, 'PROPOSED', 0, ?, NULL)`
        ).run(TEST_USER, TEST_ENV, ts);
        expect(() => db.prepare(
            `INSERT INTO ml_causal_edge_proposals
             (user_id, resolved_env, proposal_id, from_node, to_node,
              proposed_change, candidate_strength, evidence_summary,
              evidence_count, status, human_approved,
              ts_proposed, ts_decided)
             VALUES (?, ?, 'CEP-UNIQ', 'C', 'D', 'WEAKEN', 0.4, 'e2', 10, 'PROPOSED', 0, ?, NULL)`
        ).run(TEST_USER, TEST_ENV, ts + 1)).toThrow();
    });

    test('CHECK proposed_change restricts', () => {
        expect(() => db.prepare(
            `INSERT INTO ml_causal_edge_proposals
             (user_id, resolved_env, proposal_id, from_node, to_node,
              proposed_change, candidate_strength, evidence_summary,
              evidence_count, status, human_approved,
              ts_proposed, ts_decided)
             VALUES (?, ?, 'CEP-BAD', 'A', 'B', 'BOGUS', 0.5, 'e', 5, 'PROPOSED', 0, ?, NULL)`
        ).run(TEST_USER, TEST_ENV, Date.now())).toThrow();
    });

    test('CHECK candidate_strength range', () => {
        expect(() => db.prepare(
            `INSERT INTO ml_causal_edge_proposals
             (user_id, resolved_env, proposal_id, from_node, to_node,
              proposed_change, candidate_strength, evidence_summary,
              evidence_count, status, human_approved,
              ts_proposed, ts_decided)
             VALUES (?, ?, 'CEP-OOR', 'A', 'B', 'ADD', 1.5, 'e', 5, 'PROPOSED', 0, ?, NULL)`
        ).run(TEST_USER, TEST_ENV, Date.now())).toThrow();
    });

    test('CHECK version >= 1', () => {
        expect(() => db.prepare(
            `INSERT INTO ml_graph_revisions
             (user_id, resolved_env, revision_id, version,
              applied_proposals_json, revision_reason, ts_applied)
             VALUES (?, ?, 'GR-BAD', 0, '[]', 'r', ?)`
        ).run(TEST_USER, TEST_ENV, Date.now())).toThrow();
    });
});

describe('§113 Constants', () => {
    test('PROPOSED_CHANGES has 6 entries', () => {
        expect(cde.PROPOSED_CHANGES).toEqual([
            'ADD', 'STRENGTHEN', 'WEAKEN', 'INVERT', 'REMOVE', 'CONTEXTUALIZE'
        ]);
    });

    test('PROPOSAL_STATUSES has 4 entries', () => {
        expect(cde.PROPOSAL_STATUSES).toEqual([
            'PROPOSED', 'SHADOW_VALIDATING', 'CONFIRMED', 'REJECTED'
        ]);
    });

    test('READINESS_OUTCOMES has 3 entries', () => {
        expect(cde.READINESS_OUTCOMES).toEqual([
            'READY', 'INSUFFICIENT_EVIDENCE', 'WEAK_STRENGTH'
        ]);
    });
});

describe('§113 evaluateProposalReadiness (pure)', () => {
    test('READY when strong + sufficient evidence', () => {
        const r = cde.evaluateProposalReadiness({
            candidateStrength: 0.80, evidenceCount: 50
        });
        expect(r.outcome).toBe('READY');
    });

    test('INSUFFICIENT_EVIDENCE when count too low', () => {
        const r = cde.evaluateProposalReadiness({
            candidateStrength: 0.80, evidenceCount: 5
        });
        expect(r.outcome).toBe('INSUFFICIENT_EVIDENCE');
    });

    test('WEAK_STRENGTH when strength below MIN', () => {
        const r = cde.evaluateProposalReadiness({
            candidateStrength: 0.10, evidenceCount: 50
        });
        expect(r.outcome).toBe('WEAK_STRENGTH');
    });
});

describe('§113 proposeEdgeRevision', () => {
    test('persists with PROPOSED status', () => {
        const r = cde.proposeEdgeRevision({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            proposalId: 'PE-1', fromNode: 'DXY', toNode: 'risk_assets',
            proposedChange: 'STRENGTHEN', candidateStrength: 0.7,
            evidenceSummary: 'correlation rising', evidenceCount: 40
        });
        expect(r.proposed).toBe(true);
    });

    test('duplicate throws', () => {
        cde.proposeEdgeRevision({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            proposalId: 'PE-DUP', fromNode: 'A', toNode: 'B',
            proposedChange: 'ADD', candidateStrength: 0.5,
            evidenceSummary: 'e', evidenceCount: 10
        });
        expect(() => cde.proposeEdgeRevision({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            proposalId: 'PE-DUP', fromNode: 'C', toNode: 'D',
            proposedChange: 'REMOVE', candidateStrength: 0.4,
            evidenceSummary: 'e', evidenceCount: 5
        })).toThrow();
    });

    test('invalid change throws', () => {
        expect(() => cde.proposeEdgeRevision({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            proposalId: 'PE-BAD', fromNode: 'A', toNode: 'B',
            proposedChange: 'BOGUS', candidateStrength: 0.5,
            evidenceSummary: 'e', evidenceCount: 5
        })).toThrow();
    });

    test('low strength throws (below MIN_CANDIDATE_STRENGTH)', () => {
        expect(() => cde.proposeEdgeRevision({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            proposalId: 'PE-LOW', fromNode: 'A', toNode: 'B',
            proposedChange: 'ADD', candidateStrength: 0.10,
            evidenceSummary: 'e', evidenceCount: 5
        })).toThrow();
    });
});

describe('§113 validateInShadow', () => {
    test('PROPOSED → SHADOW_VALIDATING', () => {
        cde.proposeEdgeRevision({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            proposalId: 'VS-1', fromNode: 'A', toNode: 'B',
            proposedChange: 'ADD', candidateStrength: 0.7,
            evidenceSummary: 'e', evidenceCount: 30
        });
        const r = cde.validateInShadow({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            proposalId: 'VS-1'
        });
        expect(r.newStatus).toBe('SHADOW_VALIDATING');
    });

    test('unknown proposal throws', () => {
        expect(() => cde.validateInShadow({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            proposalId: 'NOEXIST'
        })).toThrow();
    });
});

describe('§113 confirmProposal', () => {
    function seedProposal(id, evidenceCount = 40) {
        cde.proposeEdgeRevision({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            proposalId: id, fromNode: 'A', toNode: 'B',
            proposedChange: 'ADD', candidateStrength: 0.7,
            evidenceSummary: 'e', evidenceCount
        });
    }

    test('CONFIRMED when human approved + evidence sufficient', () => {
        seedProposal('CP-OK');
        const r = cde.confirmProposal({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            proposalId: 'CP-OK', humanApproved: true
        });
        expect(r.newStatus).toBe('CONFIRMED');
    });

    test('rejects confirm without human approval', () => {
        seedProposal('CP-NOAPPROVE');
        expect(() => cde.confirmProposal({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            proposalId: 'CP-NOAPPROVE', humanApproved: false
        })).toThrow();
    });

    test('rejects confirm with insufficient evidence', () => {
        seedProposal('CP-LOW', 5);
        expect(() => cde.confirmProposal({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            proposalId: 'CP-LOW', humanApproved: true
        })).toThrow();
    });
});

describe('§113 applyGraphRevision', () => {
    function seedConfirmed(id) {
        cde.proposeEdgeRevision({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            proposalId: id, fromNode: 'A', toNode: 'B',
            proposedChange: 'ADD', candidateStrength: 0.7,
            evidenceSummary: 'e', evidenceCount: 40
        });
        cde.confirmProposal({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            proposalId: id, humanApproved: true
        });
    }

    test('applies confirmed proposals + bumps version', () => {
        seedConfirmed('AGR-1');
        seedConfirmed('AGR-2');
        const r = cde.applyGraphRevision({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            revisionId: 'GR-V1',
            proposalIds: ['AGR-1', 'AGR-2'],
            revisionReason: 'evidence_threshold_crossed'
        });
        expect(r.applied).toBe(true);
        expect(r.version).toBe(1);
    });

    test('throws if any proposal NOT CONFIRMED', () => {
        seedConfirmed('AGR-CONF');
        cde.proposeEdgeRevision({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            proposalId: 'AGR-PEND', fromNode: 'X', toNode: 'Y',
            proposedChange: 'ADD', candidateStrength: 0.5,
            evidenceSummary: 'e', evidenceCount: 30
        });
        expect(() => cde.applyGraphRevision({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            revisionId: 'GR-MIXED',
            proposalIds: ['AGR-CONF', 'AGR-PEND'],
            revisionReason: 'r'
        })).toThrow();
    });

    test('version increments across multiple revisions', () => {
        seedConfirmed('V1-A');
        cde.applyGraphRevision({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            revisionId: 'V1-R', proposalIds: ['V1-A'],
            revisionReason: 'r1'
        });
        seedConfirmed('V2-A');
        const r = cde.applyGraphRevision({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            revisionId: 'V2-R', proposalIds: ['V2-A'],
            revisionReason: 'r2'
        });
        expect(r.version).toBe(2);
    });
});

describe('§113 getActiveProposals', () => {
    test('filter by status', () => {
        cde.proposeEdgeRevision({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            proposalId: 'GAP-P', fromNode: 'A', toNode: 'B',
            proposedChange: 'ADD', candidateStrength: 0.5,
            evidenceSummary: 'e', evidenceCount: 30
        });
        cde.proposeEdgeRevision({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            proposalId: 'GAP-S', fromNode: 'C', toNode: 'D',
            proposedChange: 'STRENGTHEN', candidateStrength: 0.6,
            evidenceSummary: 'e', evidenceCount: 30
        });
        cde.validateInShadow({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            proposalId: 'GAP-S'
        });
        const r = cde.getActiveProposals({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            statusFilter: 'SHADOW_VALIDATING'
        });
        expect(r).toHaveLength(1);
        expect(r[0].proposalId).toBe('GAP-S');
    });
});

describe('§113 isolation', () => {
    test('per (user × env) isolation', () => {
        cde.proposeEdgeRevision({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            proposalId: 'ISO-1', fromNode: 'A', toNode: 'B',
            proposedChange: 'ADD', candidateStrength: 0.5,
            evidenceSummary: 'e', evidenceCount: 30
        });
        const a = cde.getActiveProposals({
            userId: TEST_USER, resolvedEnv: TEST_ENV
        });
        const b = cde.getActiveProposals({
            userId: OTHER_USER, resolvedEnv: TEST_ENV
        });
        expect(a).toHaveLength(1);
        expect(b).toHaveLength(0);
    });
});
