'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');

const TEST_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-w3-p122-'));
const TEST_DB_PATH = path.join(TEST_DB_DIR, 'test.db');
process.env.ZEUS_DB_PATH = TEST_DB_PATH;
process.env.ZEUS_TEST_DISABLE_AUTH = '1';

const { db } = require('../../../server/services/database');
const sm = require('../../../server/services/ml/_meta/selfModel');

const TEST_USER = 9122;
const OTHER_USER = 9123;
const TEST_ENV = 'DEMO';

function cleanRows() {
    db.prepare('DELETE FROM ml_self_capability_graph WHERE user_id IN (?, ?)').run(TEST_USER, OTHER_USER);
    db.prepare('DELETE FROM ml_introspective_summaries WHERE user_id IN (?, ?)').run(TEST_USER, OTHER_USER);
}

beforeEach(() => cleanRows());
afterAll(() => {
    try { fs.rmSync(TEST_DB_DIR, { recursive: true, force: true }); } catch (_) {}
});

describe('§122 Migrations 233 + 234', () => {
    test('capability_id UNIQUE', () => {
        const ts = Date.now();
        db.prepare(
            `INSERT INTO ml_self_capability_graph
             (user_id, resolved_env, capability_id, module_id, module_kind,
              health, reliability, recency, trust_score, state,
              ts_last_assessed, ts_created)
             VALUES (?, ?, 'CG-UNIQ', 'M1', 'detector', 0.9, 0.9, 0.9, 0.9, 'strong', ?, ?)`
        ).run(TEST_USER, TEST_ENV, ts, ts);
        expect(() => db.prepare(
            `INSERT INTO ml_self_capability_graph
             (user_id, resolved_env, capability_id, module_id, module_kind,
              health, reliability, recency, trust_score, state,
              ts_last_assessed, ts_created)
             VALUES (?, ?, 'CG-UNIQ', 'M2', 'scorer', 0.5, 0.5, 0.5, 0.5, 'degraded', ?, ?)`
        ).run(TEST_USER, TEST_ENV, ts + 1, ts + 1)).toThrow();
    });

    test('CHECK module_kind restricts', () => {
        expect(() => db.prepare(
            `INSERT INTO ml_self_capability_graph
             (user_id, resolved_env, capability_id, module_id, module_kind,
              health, reliability, recency, trust_score, state,
              ts_last_assessed, ts_created)
             VALUES (?, ?, 'CG-BAD', 'M', 'BOGUS', 0.5, 0.5, 0.5, 0.5, 'degraded', ?, ?)`
        ).run(TEST_USER, TEST_ENV, Date.now(), Date.now())).toThrow();
    });

    test('CHECK state restricts', () => {
        expect(() => db.prepare(
            `INSERT INTO ml_self_capability_graph
             (user_id, resolved_env, capability_id, module_id, module_kind,
              health, reliability, recency, trust_score, state,
              ts_last_assessed, ts_created)
             VALUES (?, ?, 'CG-SBAD', 'M', 'detector', 0.5, 0.5, 0.5, 0.5, 'BOGUS', ?, ?)`
        ).run(TEST_USER, TEST_ENV, Date.now(), Date.now())).toThrow();
    });

    test('CHECK trust_score range', () => {
        expect(() => db.prepare(
            `INSERT INTO ml_self_capability_graph
             (user_id, resolved_env, capability_id, module_id, module_kind,
              health, reliability, recency, trust_score, state,
              ts_last_assessed, ts_created)
             VALUES (?, ?, 'CG-OOR', 'M', 'detector', 0.5, 0.5, 0.5, 1.5, 'degraded', ?, ?)`
        ).run(TEST_USER, TEST_ENV, Date.now(), Date.now())).toThrow();
    });
});

describe('§122 Constants', () => {
    test('MODULE_KINDS has 6 entries', () => {
        expect(sm.MODULE_KINDS).toEqual([
            'detector', 'scorer', 'policy',
            'execution', 'memory_learning', 'safety'
        ]);
    });

    test('CAPABILITY_STATES has 4 entries', () => {
        expect(sm.CAPABILITY_STATES).toEqual([
            'strong', 'degraded', 'uncertain', 'unavailable'
        ]);
    });

    test('thresholds strictly decreasing', () => {
        expect(sm.STRONG_THRESHOLD).toBeGreaterThan(sm.DEGRADED_THRESHOLD);
        expect(sm.DEGRADED_THRESHOLD).toBeGreaterThan(sm.UNCERTAIN_THRESHOLD);
    });
});

describe('§122 computeTrustScore (pure)', () => {
    test('avg of 3 dimensions', () => {
        const r = sm.computeTrustScore({
            health: 0.9, reliability: 0.6, recency: 0.3
        });
        expect(r.trustScore).toBeCloseTo(0.6);
    });

    test('all zeros → 0', () => {
        const r = sm.computeTrustScore({
            health: 0, reliability: 0, recency: 0
        });
        expect(r.trustScore).toBe(0);
    });

    test('all ones → 1', () => {
        const r = sm.computeTrustScore({
            health: 1, reliability: 1, recency: 1
        });
        expect(r.trustScore).toBe(1);
    });
});

describe('§122 classifyCapabilityState (pure)', () => {
    test('high trust → strong', () => {
        const r = sm.classifyCapabilityState({ trustScore: 0.85 });
        expect(r.state).toBe('strong');
    });

    test('mid trust → degraded', () => {
        const r = sm.classifyCapabilityState({ trustScore: 0.60 });
        expect(r.state).toBe('degraded');
    });

    test('low trust → uncertain', () => {
        const r = sm.classifyCapabilityState({ trustScore: 0.40 });
        expect(r.state).toBe('uncertain');
    });

    test('very low → unavailable', () => {
        const r = sm.classifyCapabilityState({ trustScore: 0.10 });
        expect(r.state).toBe('unavailable');
    });
});

describe('§122 assessModuleCapability', () => {
    test('persists with auto-computed trust + state', () => {
        const r = sm.assessModuleCapability({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            capabilityId: 'AC-1', moduleId: 'cvd_detector',
            moduleKind: 'detector',
            health: 0.9, reliability: 0.85, recency: 0.9
        });
        expect(r.assessed).toBe(true);
        expect(r.trustScore).toBeCloseTo(0.8833);
        expect(r.state).toBe('strong');
    });

    test('duplicate throws', () => {
        sm.assessModuleCapability({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            capabilityId: 'AC-DUP', moduleId: 'M', moduleKind: 'detector',
            health: 0.5, reliability: 0.5, recency: 0.5
        });
        expect(() => sm.assessModuleCapability({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            capabilityId: 'AC-DUP', moduleId: 'M2', moduleKind: 'scorer',
            health: 0.7, reliability: 0.7, recency: 0.7
        })).toThrow();
    });

    test('invalid module_kind throws', () => {
        expect(() => sm.assessModuleCapability({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            capabilityId: 'AC-BAD', moduleId: 'M', moduleKind: 'BOGUS',
            health: 0.5, reliability: 0.5, recency: 0.5
        })).toThrow();
    });
});

describe('§122 recordIntrospectiveSummary', () => {
    test('persists with confidence_modifier', () => {
        const r = sm.recordIntrospectiveSummary({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            summaryId: 'IS-1', decisionId: 'D-1',
            modulesReliedOn: [
                { moduleId: 'cvd', trustScore: 0.9 },
                { moduleId: 'orderflow', trustScore: 0.5 }
            ],
            selfTrustAggregate: 0.7
        });
        expect(r.recorded).toBe(true);
        // confidence_modifier auto = avg of trust scores = 0.7
        expect(r.confidenceModifier).toBeCloseTo(0.7);
    });

    test('low aggregate → low modifier', () => {
        const r = sm.recordIntrospectiveSummary({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            summaryId: 'IS-LOW', decisionId: 'D',
            modulesReliedOn: [{ moduleId: 'm', trustScore: 0.1 }],
            selfTrustAggregate: 0.1
        });
        expect(r.confidenceModifier).toBeLessThan(0.2);
    });
});

describe('§122 getCapabilityGraph', () => {
    test('filter by state', () => {
        sm.assessModuleCapability({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            capabilityId: 'GC-STRONG', moduleId: 'M1', moduleKind: 'detector',
            health: 0.95, reliability: 0.95, recency: 0.95
        });
        sm.assessModuleCapability({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            capabilityId: 'GC-WEAK', moduleId: 'M2', moduleKind: 'scorer',
            health: 0.10, reliability: 0.10, recency: 0.10
        });
        const r = sm.getCapabilityGraph({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            stateFilter: 'strong'
        });
        expect(r).toHaveLength(1);
        expect(r[0].capabilityId).toBe('GC-STRONG');
    });

    test('filter by kind', () => {
        sm.assessModuleCapability({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            capabilityId: 'GC-DET', moduleId: 'M1', moduleKind: 'detector',
            health: 0.7, reliability: 0.7, recency: 0.7
        });
        sm.assessModuleCapability({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            capabilityId: 'GC-SAF', moduleId: 'M2', moduleKind: 'safety',
            health: 0.8, reliability: 0.8, recency: 0.8
        });
        const r = sm.getCapabilityGraph({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            kindFilter: 'safety'
        });
        expect(r).toHaveLength(1);
        expect(r[0].capabilityId).toBe('GC-SAF');
    });
});

describe('§122 isolation', () => {
    test('per (user × env) isolation', () => {
        sm.assessModuleCapability({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            capabilityId: 'ISO-1', moduleId: 'M', moduleKind: 'detector',
            health: 0.5, reliability: 0.5, recency: 0.5
        });
        const a = sm.getCapabilityGraph({
            userId: TEST_USER, resolvedEnv: TEST_ENV
        });
        const b = sm.getCapabilityGraph({
            userId: OTHER_USER, resolvedEnv: TEST_ENV
        });
        expect(a).toHaveLength(1);
        expect(b).toHaveLength(0);
    });
});
