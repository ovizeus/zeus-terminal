'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');

const TEST_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-w3-p97-'));
const TEST_DB_PATH = path.join(TEST_DB_DIR, 'test.db');
process.env.ZEUS_DB_PATH = TEST_DB_PATH;
process.env.ZEUS_TEST_DISABLE_AUTH = '1';

const { db } = require('../../../server/services/database');
const fe = require('../../../server/services/ml/R5B_governance/forgettingEngine');

const TEST_USER = 9097;
const OTHER_USER = 9098;
const TEST_ENV = 'DEMO';
const DAY_MS = 86400000;

function cleanRows() {
    db.prepare('DELETE FROM ml_knowledge_items WHERE user_id IN (?, ?)').run(TEST_USER, OTHER_USER);
    db.prepare('DELETE FROM ml_forgetting_decisions WHERE user_id IN (?, ?)').run(TEST_USER, OTHER_USER);
}

beforeEach(() => cleanRows());
afterAll(() => {
    try { fs.rmSync(TEST_DB_DIR, { recursive: true, force: true }); } catch (_) {}
});

describe('§97 Migrations 183 + 184', () => {
    test('item_id UNIQUE', () => {
        const ts = Date.now();
        db.prepare(
            `INSERT INTO ml_knowledge_items
             (user_id, resolved_env, item_id, kind, content_json,
              freshness_score, status,
              ts_created, ts_last_relevance, ts_status_changed)
             VALUES (?, ?, 'I-UNIQ', 'heuristic', '{}', 0.9, 'ACTIVE', ?, ?, ?)`
        ).run(TEST_USER, TEST_ENV, ts, ts, ts);
        expect(() => db.prepare(
            `INSERT INTO ml_knowledge_items
             (user_id, resolved_env, item_id, kind, content_json,
              freshness_score, status,
              ts_created, ts_last_relevance, ts_status_changed)
             VALUES (?, ?, 'I-UNIQ', 'prior', '{}', 0.7, 'ACTIVE', ?, ?, ?)`
        ).run(TEST_USER, TEST_ENV, ts + 1, ts + 1, ts + 1)).toThrow();
    });

    test('CHECK kind restricts', () => {
        expect(() => db.prepare(
            `INSERT INTO ml_knowledge_items
             (user_id, resolved_env, item_id, kind, content_json,
              freshness_score, status,
              ts_created, ts_last_relevance, ts_status_changed)
             VALUES (?, ?, 'I-BAD', 'BOGUS', '{}', 0.9, 'ACTIVE', ?, ?, ?)`
        ).run(TEST_USER, TEST_ENV, Date.now(), Date.now(), Date.now())).toThrow();
    });

    test('CHECK freshness_score in [0,1]', () => {
        expect(() => db.prepare(
            `INSERT INTO ml_knowledge_items
             (user_id, resolved_env, item_id, kind, content_json,
              freshness_score, status,
              ts_created, ts_last_relevance, ts_status_changed)
             VALUES (?, ?, 'I-OOR', 'prior', '{}', 1.5, 'ACTIVE', ?, ?, ?)`
        ).run(TEST_USER, TEST_ENV, Date.now(), Date.now(), Date.now())).toThrow();
    });

    test('CHECK action restricts', () => {
        expect(() => db.prepare(
            `INSERT INTO ml_forgetting_decisions
             (user_id, resolved_env, decision_id, item_id, action,
              prior_status, new_status, reason, evidence_json, ts)
             VALUES (?, ?, 'D-BAD', 'I', 'BOGUS', 'ACTIVE', 'ACTIVE', 'r', NULL, ?)`
        ).run(TEST_USER, TEST_ENV, Date.now())).toThrow();
    });
});

describe('§97 Constants', () => {
    test('KNOWLEDGE_KINDS has 6 entries', () => {
        expect(fe.KNOWLEDGE_KINDS).toHaveLength(6);
    });

    test('ITEM_STATUSES has 5 entries', () => {
        expect(fe.ITEM_STATUSES).toEqual([
            'ACTIVE', 'WEAKENED', 'QUARANTINED', 'RETIRED', 'REVIVED'
        ]);
    });

    test('thresholds strictly decreasing', () => {
        const t = fe.DEFAULT_FRESHNESS_THRESHOLDS;
        expect(t.WEAKEN).toBeGreaterThan(t.QUARANTINE);
        expect(t.QUARANTINE).toBeGreaterThan(t.RETIRE);
    });
});

describe('§97 computeFreshnessScore (pure)', () => {
    test('newer item scores higher than older', () => {
        const young = fe.computeFreshnessScore({ ageDays: 1 });
        const old = fe.computeFreshnessScore({ ageDays: 90 });
        expect(young.freshness).toBeGreaterThan(old.freshness);
    });

    test('recency boost lifts old item', () => {
        const noRecency = fe.computeFreshnessScore({ ageDays: 60, recencyHits: 0 });
        const withRecency = fe.computeFreshnessScore({ ageDays: 60, recencyHits: 50 });
        expect(withRecency.freshness).toBeGreaterThan(noRecency.freshness);
    });

    test('drift+crowding hurts freshness', () => {
        const clean = fe.computeFreshnessScore({ ageDays: 1 });
        const dirty = fe.computeFreshnessScore({
            ageDays: 1, drift: 1.0, crowding: 1.0, edgeDecay: 1.0
        });
        expect(dirty.freshness).toBeLessThan(clean.freshness);
    });
});

describe('§97 registerKnowledgeItem', () => {
    test('persists ACTIVE', () => {
        const r = fe.registerKnowledgeItem({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            itemId: 'R-1', kind: 'heuristic',
            content: { rule: 'always buy dips' }
        });
        expect(r.registered).toBe(true);
        expect(r.status).toBe('ACTIVE');
    });

    test('duplicate throws', () => {
        fe.registerKnowledgeItem({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            itemId: 'R-DUP', kind: 'prior', content: {}
        });
        expect(() => fe.registerKnowledgeItem({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            itemId: 'R-DUP', kind: 'prior', content: {}
        })).toThrow();
    });

    test('invalid kind throws', () => {
        expect(() => fe.registerKnowledgeItem({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            itemId: 'R-BAD', kind: 'BOGUS', content: {}
        })).toThrow();
    });

    test('initialFreshness out of range throws', () => {
        expect(() => fe.registerKnowledgeItem({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            itemId: 'R-OOR', kind: 'prior', content: {},
            initialFreshness: 1.5
        })).toThrow();
    });
});

describe('§97 recordRelevanceEvent', () => {
    test('bumps ts_last_relevance', () => {
        fe.registerKnowledgeItem({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            itemId: 'REL-1', kind: 'prior', content: {}, ts: 1000
        });
        const r = fe.recordRelevanceEvent({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            itemId: 'REL-1', ts: 5000
        });
        expect(r.ts).toBe(5000);
    });

    test('unknown item throws', () => {
        expect(() => fe.recordRelevanceEvent({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            itemId: 'NOEXIST'
        })).toThrow();
    });
});

describe('§97 evaluateAndDecide', () => {
    test('young item → null recommendation (ACTIVE)', () => {
        fe.registerKnowledgeItem({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            itemId: 'EV-1', kind: 'prior', content: {}, ts: Date.now()
        });
        const r = fe.evaluateAndDecide({
            userId: TEST_USER, resolvedEnv: TEST_ENV, itemId: 'EV-1'
        });
        expect(r.recommendedAction).toBe(null);
    });

    test('ancient item with drift+crowding → RETIRE', () => {
        const created = Date.now() - 365 * DAY_MS;
        fe.registerKnowledgeItem({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            itemId: 'EV-OLD', kind: 'prior', content: {}, ts: created
        });
        const r = fe.evaluateAndDecide({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            itemId: 'EV-OLD',
            decayInputs: { drift: 1.0, crowding: 1.0, edgeDecay: 1.0 }
        });
        expect(r.recommendedAction).toBe('RETIRE');
    });
});

describe('§97 applyForgettingAction', () => {
    test('WEAKEN transitions + audit log', () => {
        fe.registerKnowledgeItem({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            itemId: 'AF-1', kind: 'prior', content: {}
        });
        const r = fe.applyForgettingAction({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            decisionId: 'D-1', itemId: 'AF-1',
            action: 'WEAKEN', reason: 'drift_high',
            evidence: { driftPct: 0.85 }
        });
        expect(r.newStatus).toBe('WEAKENED');
    });

    test('RETIRE sets freshness=0', () => {
        fe.registerKnowledgeItem({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            itemId: 'AF-RET', kind: 'prior', content: {}
        });
        const r = fe.applyForgettingAction({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            decisionId: 'D-RET', itemId: 'AF-RET',
            action: 'RETIRE', reason: 'edge_dead'
        });
        expect(r.freshness).toBe(0);
    });

    test('REVIVE restores freshness=1', () => {
        fe.registerKnowledgeItem({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            itemId: 'AF-REV', kind: 'prior', content: {}
        });
        fe.applyForgettingAction({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            decisionId: 'D-Q', itemId: 'AF-REV',
            action: 'QUARANTINE', reason: 'suspect'
        });
        const r = fe.applyForgettingAction({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            decisionId: 'D-REV', itemId: 'AF-REV',
            action: 'REVIVE', reason: 'new_evidence',
            evidence: { newSamples: 100 }
        });
        expect(r.newStatus).toBe('REVIVED');
        expect(r.freshness).toBe(1.0);
    });

    test('duplicate decisionId throws', () => {
        fe.registerKnowledgeItem({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            itemId: 'AF-DUP', kind: 'prior', content: {}
        });
        fe.applyForgettingAction({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            decisionId: 'D-DUP', itemId: 'AF-DUP',
            action: 'WEAKEN', reason: 'r'
        });
        expect(() => fe.applyForgettingAction({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            decisionId: 'D-DUP', itemId: 'AF-DUP',
            action: 'RETIRE', reason: 'r2'
        })).toThrow();
    });
});

describe('§97 getKnowledgeAudit', () => {
    test('default excludes RETIRED', () => {
        fe.registerKnowledgeItem({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            itemId: 'GA-A', kind: 'prior', content: {}
        });
        fe.registerKnowledgeItem({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            itemId: 'GA-R', kind: 'prior', content: {}
        });
        fe.applyForgettingAction({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            decisionId: 'GA-D', itemId: 'GA-R',
            action: 'RETIRE', reason: 'dead'
        });
        const r = fe.getKnowledgeAudit({
            userId: TEST_USER, resolvedEnv: TEST_ENV
        });
        expect(r).toHaveLength(1);
        expect(r[0].itemId).toBe('GA-A');
    });

    test('includeRetired returns all', () => {
        fe.registerKnowledgeItem({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            itemId: 'GA-IR', kind: 'prior', content: {}
        });
        fe.applyForgettingAction({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            decisionId: 'GA-DR', itemId: 'GA-IR',
            action: 'RETIRE', reason: 'dead'
        });
        const r = fe.getKnowledgeAudit({
            userId: TEST_USER, resolvedEnv: TEST_ENV, includeRetired: true
        });
        expect(r).toHaveLength(1);
        expect(r[0].status).toBe('RETIRED');
    });
});

describe('§97 isolation', () => {
    test('per (user × env) isolation', () => {
        fe.registerKnowledgeItem({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            itemId: 'ISO-1', kind: 'prior', content: {}
        });
        const a = fe.getKnowledgeAudit({ userId: TEST_USER, resolvedEnv: TEST_ENV });
        const b = fe.getKnowledgeAudit({ userId: OTHER_USER, resolvedEnv: TEST_ENV });
        expect(a).toHaveLength(1);
        expect(b).toHaveLength(0);
    });
});
