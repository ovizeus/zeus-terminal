'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');

const TEST_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-w3-p100-'));
const TEST_DB_PATH = path.join(TEST_DB_DIR, 'test.db');
process.env.ZEUS_DB_PATH = TEST_DB_PATH;
process.env.ZEUS_TEST_DISABLE_AUTH = '1';

const { db } = require('../../../server/services/database');
const nc = require('../../../server/services/ml/R2_cognition/narrativeCoherence');

const TEST_USER = 9100;
const OTHER_USER = 9101;
const TEST_ENV = 'DEMO';

function cleanRows() {
    db.prepare('DELETE FROM ml_narrative_threads WHERE user_id IN (?, ?)').run(TEST_USER, OTHER_USER);
    db.prepare('DELETE FROM ml_narrative_arc_links WHERE user_id IN (?, ?)').run(TEST_USER, OTHER_USER);
}

beforeEach(() => cleanRows());
afterAll(() => {
    try { fs.rmSync(TEST_DB_DIR, { recursive: true, force: true }); } catch (_) {}
});

const FULL_NARRATIVE = {
    whyMoving: 'liquidity grab pre-news',
    whoSelling: 'short-term holders',
    whoBuying: 'institutional bid block',
    trappedSide: 'late longs from yesterday',
    expectedResolution: 'reclaim and continuation higher'
};

describe('§100 Migrations 189 + 190', () => {
    test('thread_id UNIQUE', () => {
        const ts = Date.now();
        db.prepare(
            `INSERT INTO ml_narrative_threads
             (user_id, resolved_env, thread_id, why_moving, who_selling,
              who_buying, trapped_side, expected_resolution,
              coherence_score, status, ts)
             VALUES (?, ?, 'T-UNIQ', 'w', 'a', 'b', 'c', 'd', 0.8, 'COHERENT', ?)`
        ).run(TEST_USER, TEST_ENV, ts);
        expect(() => db.prepare(
            `INSERT INTO ml_narrative_threads
             (user_id, resolved_env, thread_id, why_moving, who_selling,
              who_buying, trapped_side, expected_resolution,
              coherence_score, status, ts)
             VALUES (?, ?, 'T-UNIQ', 'w2', 'a2', 'b2', 'c2', 'd2', 0.3, 'INCOHERENT', ?)`
        ).run(TEST_USER, TEST_ENV, ts + 1)).toThrow();
    });

    test('CHECK status restricts', () => {
        expect(() => db.prepare(
            `INSERT INTO ml_narrative_threads
             (user_id, resolved_env, thread_id, why_moving, who_selling,
              who_buying, trapped_side, expected_resolution,
              coherence_score, status, ts)
             VALUES (?, ?, 'T-BAD', NULL, NULL, NULL, NULL, NULL, 0.5, 'BOGUS', ?)`
        ).run(TEST_USER, TEST_ENV, Date.now())).toThrow();
    });

    test('CHECK supports in (0,1)', () => {
        expect(() => db.prepare(
            `INSERT INTO ml_narrative_arc_links
             (user_id, resolved_env, link_id, thread_id, signal_id,
              supports, contribution, reason, ts)
             VALUES (?, ?, 'L-BAD', 'T', 'S', 5, 0.5, 'r', ?)`
        ).run(TEST_USER, TEST_ENV, Date.now())).toThrow();
    });
});

describe('§100 Constants', () => {
    test('NARRATIVE_FIELDS has 5 entries', () => {
        expect(nc.NARRATIVE_FIELDS).toHaveLength(5);
    });

    test('DECISION_OUTCOMES has 4 entries', () => {
        expect(nc.DECISION_OUTCOMES).toEqual([
            'BLOCK', 'REDUCE', 'NORMAL', 'AMPLIFY'
        ]);
    });

    test('thresholds ordered', () => {
        expect(nc.DEFAULT_COHERENCE_THRESHOLD)
            .toBeLessThan(nc.AMPLIFY_THRESHOLD);
    });
});

describe('§100 computeCoherenceScore (pure)', () => {
    test('full narrative no links → high coherence', () => {
        const r = nc.computeCoherenceScore({
            thread: FULL_NARRATIVE, links: []
        });
        // completeness=1.0, supportConsistency=1.0 (default) → 1.0
        expect(r.coherenceScore).toBe(1.0);
        expect(r.status).toBe('COHERENT');
    });

    test('empty narrative → PENDING', () => {
        const r = nc.computeCoherenceScore({
            thread: {}, links: []
        });
        // completeness=0, support=1 default → 0.4 (still > 0 but under threshold)
        expect(r.status).toBe('PENDING');
    });

    test('partial narrative + contradicting links', () => {
        const r = nc.computeCoherenceScore({
            thread: { whyMoving: 'x', whoSelling: 'y' },
            links: [
                { supports: false }, { supports: false }, { supports: true }
            ]
        });
        // completeness = 2/5 = 0.4; support = 1/3 = 0.333
        // score = 0.6*0.4 + 0.4*0.333 = 0.24 + 0.133 = 0.373
        expect(r.coherenceScore).toBeCloseTo(0.373, 2);
        expect(r.status).toBe('INCOHERENT');
    });
});

describe('§100 evaluateNarrativeDecision (pure)', () => {
    test('BLOCK when weak narrative + strong signals (false confidence)', () => {
        const r = nc.evaluateNarrativeDecision({
            coherenceScore: 0.3, signalAggregateStrength: 0.85
        });
        expect(r.decision).toBe('BLOCK');
    });

    test('REDUCE when weak narrative + weak signals', () => {
        const r = nc.evaluateNarrativeDecision({
            coherenceScore: 0.3, signalAggregateStrength: 0.4
        });
        expect(r.decision).toBe('REDUCE');
    });

    test('NORMAL when adequate narrative', () => {
        const r = nc.evaluateNarrativeDecision({
            coherenceScore: 0.70, signalAggregateStrength: 0.7
        });
        expect(r.decision).toBe('NORMAL');
    });

    test('AMPLIFY when very strong narrative', () => {
        const r = nc.evaluateNarrativeDecision({
            coherenceScore: 0.9, signalAggregateStrength: 0.5
        });
        expect(r.decision).toBe('AMPLIFY');
    });
});

describe('§100 buildNarrativeThread', () => {
    test('persists full narrative', () => {
        const r = nc.buildNarrativeThread({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            threadId: 'BT-1', ...FULL_NARRATIVE
        });
        expect(r.built).toBe(true);
        expect(r.status).toBe('COHERENT');
    });

    test('persists empty narrative as PENDING', () => {
        const r = nc.buildNarrativeThread({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            threadId: 'BT-EMPTY'
        });
        expect(r.status).toBe('PENDING');
    });

    test('duplicate throws', () => {
        nc.buildNarrativeThread({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            threadId: 'BT-DUP', ...FULL_NARRATIVE
        });
        expect(() => nc.buildNarrativeThread({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            threadId: 'BT-DUP'
        })).toThrow();
    });
});

describe('§100 attachSignalToNarrative', () => {
    test('contradicting link drops coherence', () => {
        nc.buildNarrativeThread({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            threadId: 'AS-1', ...FULL_NARRATIVE
        });
        const r = nc.attachSignalToNarrative({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            linkId: 'AS-L1', threadId: 'AS-1',
            signalId: 'sig-cvd', supports: false,
            reason: 'CVD diverging'
        });
        // completeness=1, support=0/1=0 → 0.6
        expect(r.newCoherenceScore).toBeCloseTo(0.6);
    });

    test('unknown thread throws', () => {
        expect(() => nc.attachSignalToNarrative({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            linkId: 'AS-BAD', threadId: 'NOEXIST',
            signalId: 'sig', supports: true
        })).toThrow();
    });
});

describe('§100 getNarrativeAudit', () => {
    test('returns thread + all links', () => {
        nc.buildNarrativeThread({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            threadId: 'AU-1', ...FULL_NARRATIVE
        });
        nc.attachSignalToNarrative({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            linkId: 'AU-L1', threadId: 'AU-1',
            signalId: 's1', supports: true
        });
        nc.attachSignalToNarrative({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            linkId: 'AU-L2', threadId: 'AU-1',
            signalId: 's2', supports: true
        });
        const r = nc.getNarrativeAudit({
            userId: TEST_USER, resolvedEnv: TEST_ENV, threadId: 'AU-1'
        });
        expect(r.links).toHaveLength(2);
        expect(r.narrative.whyMoving).toBe(FULL_NARRATIVE.whyMoving);
    });

    test('unknown thread throws', () => {
        expect(() => nc.getNarrativeAudit({
            userId: TEST_USER, resolvedEnv: TEST_ENV, threadId: 'NOEXIST'
        })).toThrow();
    });
});

describe('§100 isolation', () => {
    test('per (user × env) isolation', () => {
        nc.buildNarrativeThread({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            threadId: 'ISO-1', ...FULL_NARRATIVE
        });
        const a = nc.getThreadHistory({ userId: TEST_USER, resolvedEnv: TEST_ENV });
        const b = nc.getThreadHistory({ userId: OTHER_USER, resolvedEnv: TEST_ENV });
        expect(a).toHaveLength(1);
        expect(b).toHaveLength(0);
    });
});
