'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');

const TEST_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-w3-p40-'));
const TEST_DB_PATH = path.join(TEST_DB_DIR, 'test.db');
process.env.ZEUS_DB_PATH = TEST_DB_PATH;
process.env.ZEUS_TEST_DISABLE_AUTH = '1';

const { db } = require('../../../server/services/database');
const scm = require('../../../server/services/ml/R2_cognition/structuralCausalModel');

const TEST_USER = 9040;
const TEST_ENV = 'DEMO';

function cleanRows() {
    db.prepare(`DELETE FROM ml_causal_chains WHERE chain_id LIKE 'test-%'`).run();
    db.prepare('DELETE FROM ml_causal_observations WHERE user_id = ?').run(TEST_USER);
}

beforeEach(() => cleanRows());
afterAll(() => {
    try { fs.rmSync(TEST_DB_DIR, { recursive: true, force: true }); } catch (_) {}
});

describe('§40 Migration 096', () => {
    test('table ml_causal_chains exists', () => {
        const row = db.prepare(
            `SELECT name FROM sqlite_master WHERE type='table' AND name='ml_causal_chains'`
        ).get();
        expect(row).toBeTruthy();
    });

    test('table ml_causal_observations exists', () => {
        const row = db.prepare(
            `SELECT name FROM sqlite_master WHERE type='table' AND name='ml_causal_observations'`
        ).get();
        expect(row).toBeTruthy();
    });

    test('chains has expected columns', () => {
        const cols = db.prepare(`PRAGMA table_info(ml_causal_chains)`).all().map(c => c.name);
        expect(cols).toEqual(expect.arrayContaining([
            'id', 'chain_id', 'name', 'edges_json',
            'expected_outcome', 'created_at'
        ]));
    });

    test('observations has expected columns', () => {
        const cols = db.prepare(`PRAGMA table_info(ml_causal_observations)`).all().map(c => c.name);
        expect(cols).toEqual(expect.arrayContaining([
            'id', 'user_id', 'resolved_env', 'chain_id',
            'state', 'trigger_event_json', 'evidence_json',
            'actual_outcome', 'matched', 'created_at'
        ]));
    });
});

describe('§40 Exported constants', () => {
    test('CHAIN_STATES has 4 entries', () => {
        expect(scm.CHAIN_STATES).toEqual([
            'LATENT', 'TRIGGERED', 'RESOLVED', 'INVALIDATED'
        ]);
    });

    test('EDGE_TYPES has expected entries', () => {
        expect(scm.EDGE_TYPES).toEqual(expect.arrayContaining([
            'causal', 'correlational', 'conditional'
        ]));
    });
});

describe('§40 registerChain', () => {
    test('registers chain', () => {
        scm.registerChain({
            chainId: 'test-dxy-risk',
            name: 'DXY spike → risk pressure → liquidations → bounce',
            edges: [
                { cause: 'dxy_spike', effect: 'risk_asset_pressure', type: 'causal' },
                { cause: 'risk_asset_pressure', effect: 'liquidations', type: 'causal' },
                { cause: 'liquidations', effect: 'bounce_opportunity', type: 'conditional' }
            ],
            expectedOutcome: 'long_bounce'
        });
        const rows = db.prepare(
            `SELECT * FROM ml_causal_chains WHERE chain_id = ?`
        ).all('test-dxy-risk');
        expect(rows).toHaveLength(1);
    });

    test('throws on duplicate chainId', () => {
        scm.registerChain({
            chainId: 'test-dup',
            name: 'X', edges: [],
            expectedOutcome: 'x'
        });
        expect(() => scm.registerChain({
            chainId: 'test-dup',
            name: 'Y', edges: [],
            expectedOutcome: 'y'
        })).toThrow();
    });
});

describe('§40 observeTrigger', () => {
    beforeEach(() => {
        scm.registerChain({
            chainId: 'test-funding-squeeze',
            name: 'Extreme funding → squeeze inevitable',
            edges: [
                { cause: 'funding_extreme', effect: 'squeeze', type: 'causal' }
            ],
            expectedOutcome: 'short_squeeze'
        });
    });

    test('marks chain TRIGGERED', () => {
        scm.observeTrigger({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            chainId: 'test-funding-squeeze',
            triggerEvent: { signal: 'funding_rate', value: 0.005 },
            evidence: { fundingRate: 0.005, oi: 5000000 }
        });
        const rows = db.prepare(
            `SELECT * FROM ml_causal_observations WHERE user_id = ?`
        ).all(TEST_USER);
        expect(rows).toHaveLength(1);
        expect(rows[0].state).toBe('TRIGGERED');
    });

    test('throws on unknown chainId', () => {
        expect(() => scm.observeTrigger({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            chainId: 'nonexistent',
            triggerEvent: {}, evidence: {}
        })).toThrow();
    });
});

describe('§40 getActiveChains', () => {
    test('returns TRIGGERED chains', () => {
        scm.registerChain({
            chainId: 'test-active-1',
            name: 'A', edges: [],
            expectedOutcome: 'x'
        });
        scm.observeTrigger({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            chainId: 'test-active-1',
            triggerEvent: {}, evidence: {}
        });
        const r = scm.getActiveChains({
            userId: TEST_USER, resolvedEnv: TEST_ENV
        });
        expect(r.length).toBeGreaterThan(0);
        expect(r[0].state).toBe('TRIGGERED');
    });

    test('returns empty when no active', () => {
        const r = scm.getActiveChains({
            userId: TEST_USER, resolvedEnv: TEST_ENV
        });
        expect(r).toEqual([]);
    });
});

describe('§40 evaluateCausalSignal', () => {
    beforeEach(() => {
        scm.registerChain({
            chainId: 'test-eval-1',
            name: 'X', edges: [
                { cause: 'a', effect: 'b', type: 'causal' },
                { cause: 'b', effect: 'c', type: 'causal' }
            ],
            expectedOutcome: 'long'
        });
    });

    test('returns 0 strength when no observations', () => {
        const r = scm.evaluateCausalSignal({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            chainId: 'test-eval-1'
        });
        expect(r.strength).toBe(0);
    });

    test('returns positive strength when triggered', () => {
        scm.observeTrigger({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            chainId: 'test-eval-1',
            triggerEvent: { cause: 'a' },
            evidence: { count: 1 }
        });
        const r = scm.evaluateCausalSignal({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            chainId: 'test-eval-1'
        });
        expect(r.strength).toBeGreaterThan(0);
        expect(r.predictedOutcome).toBe('long');
    });
});

describe('§40 recordChainOutcome', () => {
    test('updates outcome', () => {
        scm.registerChain({
            chainId: 'test-outcome-1',
            name: 'X', edges: [],
            expectedOutcome: 'long_bounce'
        });
        scm.observeTrigger({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            chainId: 'test-outcome-1',
            triggerEvent: {}, evidence: {}
        });
        scm.recordChainOutcome({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            chainId: 'test-outcome-1',
            actualOutcome: 'long_bounce',
            matched: true
        });
        const row = db.prepare(
            `SELECT * FROM ml_causal_observations WHERE user_id = ? ORDER BY id DESC LIMIT 1`
        ).get(TEST_USER);
        expect(row.actual_outcome).toBe('long_bounce');
        expect(row.state).toBe('RESOLVED');
        expect(row.matched).toBe(1);
    });

    test('records INVALIDATED when outcome did not match', () => {
        scm.registerChain({
            chainId: 'test-inv-1',
            name: 'X', edges: [],
            expectedOutcome: 'long'
        });
        scm.observeTrigger({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            chainId: 'test-inv-1',
            triggerEvent: {}, evidence: {}
        });
        scm.recordChainOutcome({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            chainId: 'test-inv-1',
            actualOutcome: 'short',
            matched: false
        });
        const row = db.prepare(
            `SELECT * FROM ml_causal_observations WHERE user_id = ? ORDER BY id DESC LIMIT 1`
        ).get(TEST_USER);
        expect(row.state).toBe('INVALIDATED');
        expect(row.matched).toBe(0);
    });
});

describe('§40 isolation', () => {
    test('per (user × env) isolation', () => {
        const OTHER_USER = 9041;
        scm.registerChain({
            chainId: 'test-iso-1',
            name: 'X', edges: [], expectedOutcome: 'x'
        });
        scm.observeTrigger({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            chainId: 'test-iso-1',
            triggerEvent: {}, evidence: {}
        });
        const r1 = scm.getActiveChains({
            userId: TEST_USER, resolvedEnv: TEST_ENV
        });
        const r2 = scm.getActiveChains({
            userId: OTHER_USER, resolvedEnv: TEST_ENV
        });
        expect(r1.length).toBeGreaterThan(0);
        expect(r2.length).toBe(0);
    });
});
