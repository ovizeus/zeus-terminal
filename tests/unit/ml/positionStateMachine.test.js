'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');

const TEST_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-w3-p12-'));
const TEST_DB_PATH = path.join(TEST_DB_DIR, 'test.db');
process.env.ZEUS_DB_PATH = TEST_DB_PATH;
process.env.ZEUS_TEST_DISABLE_AUTH = '1';

const { db } = require('../../../server/services/database');
const psm = require('../../../server/services/ml/R4_execution/positionStateMachine');

const TEST_USER = 9012;
const TEST_ENV = 'DEMO';
const POS = 'pos-test-12-001';

function cleanRows() {
    db.prepare('DELETE FROM ml_position_state WHERE user_id = ?').run(TEST_USER);
    db.prepare('DELETE FROM ml_position_transitions WHERE user_id = ?').run(TEST_USER);
}

beforeEach(() => cleanRows());
afterAll(() => {
    try { fs.rmSync(TEST_DB_DIR, { recursive: true, force: true }); } catch (_) {}
});

describe('§12 Migration 061_ml_position_state', () => {
    test('table ml_position_state exists', () => {
        const row = db.prepare(
            `SELECT name FROM sqlite_master WHERE type='table' AND name='ml_position_state'`
        ).get();
        expect(row).toBeTruthy();
    });

    test('table ml_position_transitions exists', () => {
        const row = db.prepare(
            `SELECT name FROM sqlite_master WHERE type='table' AND name='ml_position_transitions'`
        ).get();
        expect(row).toBeTruthy();
    });

    test('ml_position_state has expected columns', () => {
        const cols = db.prepare(`PRAGMA table_info(ml_position_state)`).all().map(c => c.name);
        expect(cols).toEqual(expect.arrayContaining([
            'id', 'user_id', 'resolved_env', 'pos_id', 'symbol',
            'state', 'state_since', 'created_at', 'updated_at'
        ]));
    });

    test('ml_position_state UNIQUE per (user_id, resolved_env, pos_id)', () => {
        db.prepare(
            `INSERT INTO ml_position_state
             (user_id, resolved_env, pos_id, symbol, state, state_since, created_at, updated_at)
             VALUES (?, ?, ?, ?, 'IDLE', ?, ?, ?)`
        ).run(TEST_USER, TEST_ENV, POS, 'BTCUSDT', Date.now(), Date.now(), Date.now());
        expect(() => db.prepare(
            `INSERT INTO ml_position_state
             (user_id, resolved_env, pos_id, symbol, state, state_since, created_at, updated_at)
             VALUES (?, ?, ?, ?, 'IDLE', ?, ?, ?)`
        ).run(TEST_USER, TEST_ENV, POS, 'BTCUSDT', Date.now(), Date.now(), Date.now())).toThrow();
        cleanRows();
    });

    test('ml_position_state CHECK state restricts to 12 values', () => {
        expect(() => db.prepare(
            `INSERT INTO ml_position_state
             (user_id, resolved_env, pos_id, symbol, state, state_since, created_at, updated_at)
             VALUES (?, ?, ?, ?, 'BOGUS', ?, ?, ?)`
        ).run(TEST_USER, TEST_ENV, POS, 'BTCUSDT', Date.now(), Date.now(), Date.now())).toThrow();
    });

    test('ml_position_transitions CHECK new_state restricts', () => {
        expect(() => db.prepare(
            `INSERT INTO ml_position_transitions
             (user_id, resolved_env, pos_id, from_state, to_state, reason, actor, created_at)
             VALUES (?, ?, ?, 'IDLE', 'BOGUS', 'test', 'test', ?)`
        ).run(TEST_USER, TEST_ENV, POS, Date.now())).toThrow();
    });
});

describe('§12 Exported constants', () => {
    test('POSITION_STATES has 12 entries', () => {
        expect(psm.POSITION_STATES).toHaveLength(12);
        expect(psm.POSITION_STATES).toEqual([
            'IDLE', 'WATCHING', 'ARMED', 'READY', 'ENTERED',
            'MANAGING', 'PARTIAL_TAKEN', 'RUNNER_ACTIVE', 'EXITED',
            'INVALIDATED', 'LOCKED', 'COOLDOWN'
        ]);
    });

    test('VALID_TRANSITIONS defined for each state', () => {
        for (const state of psm.POSITION_STATES) {
            expect(Array.isArray(psm.VALID_TRANSITIONS[state])).toBe(true);
        }
    });

    test('STATE_OWNERSHIP maps each state to a layer', () => {
        for (const state of psm.POSITION_STATES) {
            expect(['signal', 'execution', 'risk']).toContain(psm.STATE_OWNERSHIP[state]);
        }
    });

    test('IDLE can transition to WATCHING', () => {
        expect(psm.VALID_TRANSITIONS.IDLE).toContain('WATCHING');
    });

    test('terminal states (EXITED/INVALIDATED) can transition to COOLDOWN/IDLE', () => {
        expect(psm.VALID_TRANSITIONS.EXITED).toContain('COOLDOWN');
        expect(psm.VALID_TRANSITIONS.INVALIDATED).toContain('COOLDOWN');
    });
});

describe('§12 initializePosition', () => {
    test('creates new position in IDLE state by default', () => {
        const r = psm.initializePosition({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            posId: POS, symbol: 'BTCUSDT'
        });
        expect(r.created).toBe(true);
        expect(r.state).toBe('IDLE');
        const s = psm.getCurrentState({
            userId: TEST_USER, resolvedEnv: TEST_ENV, posId: POS
        });
        expect(s.state).toBe('IDLE');
    });

    test('accepts custom initial state', () => {
        psm.initializePosition({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            posId: POS, symbol: 'BTCUSDT',
            initialState: 'WATCHING'
        });
        const s = psm.getCurrentState({
            userId: TEST_USER, resolvedEnv: TEST_ENV, posId: POS
        });
        expect(s.state).toBe('WATCHING');
    });

    test('throws on invalid initial state', () => {
        expect(() => psm.initializePosition({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            posId: POS, symbol: 'BTCUSDT',
            initialState: 'BOGUS'
        })).toThrow(/state/);
    });

    test('throws on duplicate posId', () => {
        psm.initializePosition({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            posId: POS, symbol: 'BTCUSDT'
        });
        expect(() => psm.initializePosition({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            posId: POS, symbol: 'BTCUSDT'
        })).toThrow();
    });
});

describe('§12 isTransitionAllowed (pure)', () => {
    test('IDLE → WATCHING allowed', () => {
        expect(psm.isTransitionAllowed({
            fromState: 'IDLE', toState: 'WATCHING'
        })).toBe(true);
    });

    test('IDLE → ENTERED NOT allowed (skipping armed/ready)', () => {
        expect(psm.isTransitionAllowed({
            fromState: 'IDLE', toState: 'ENTERED'
        })).toBe(false);
    });

    test('Any state → INVALIDATED allowed (safety transition)', () => {
        expect(psm.isTransitionAllowed({
            fromState: 'MANAGING', toState: 'INVALIDATED'
        })).toBe(true);
    });

    test('Any state → LOCKED allowed (safety transition)', () => {
        expect(psm.isTransitionAllowed({
            fromState: 'ARMED', toState: 'LOCKED'
        })).toBe(true);
    });

    test('Invalid fromState returns false', () => {
        expect(psm.isTransitionAllowed({
            fromState: 'BOGUS', toState: 'IDLE'
        })).toBe(false);
    });
});

describe('§12 transitionState', () => {
    beforeEach(() => {
        psm.initializePosition({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            posId: POS, symbol: 'BTCUSDT'
        });
    });

    test('valid transition succeeds and updates state', () => {
        const r = psm.transitionState({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            posId: POS, toState: 'WATCHING',
            reason: 'signal_detected', actor: 'signal_layer'
        });
        expect(r.transitioned).toBe(true);
        expect(r.fromState).toBe('IDLE');
        expect(r.toState).toBe('WATCHING');
    });

    test('invalid transition throws', () => {
        expect(() => psm.transitionState({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            posId: POS, toState: 'EXITED',
            reason: 'test', actor: 'test'
        })).toThrow(/transition|allowed/i);
    });

    test('safety transition to LOCKED always succeeds', () => {
        const r = psm.transitionState({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            posId: POS, toState: 'LOCKED',
            reason: 'safety_veto', actor: 'risk_layer'
        });
        expect(r.transitioned).toBe(true);
        expect(r.toState).toBe('LOCKED');
    });

    test('records transition history row', () => {
        psm.transitionState({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            posId: POS, toState: 'WATCHING',
            reason: 'sig', actor: 'signal_layer'
        });
        const rows = db.prepare(
            `SELECT * FROM ml_position_transitions WHERE user_id = ? AND pos_id = ?`
        ).all(TEST_USER, POS);
        expect(rows).toHaveLength(1);
        expect(rows[0].to_state).toBe('WATCHING');
    });

    test('multi-step lifecycle (IDLE→WATCHING→ARMED→READY→ENTERED)', () => {
        psm.transitionState({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            posId: POS, toState: 'WATCHING', reason: 'r1', actor: 'sig'
        });
        psm.transitionState({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            posId: POS, toState: 'ARMED', reason: 'r2', actor: 'sig'
        });
        psm.transitionState({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            posId: POS, toState: 'READY', reason: 'r3', actor: 'exec'
        });
        psm.transitionState({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            posId: POS, toState: 'ENTERED', reason: 'r4', actor: 'exec'
        });
        const s = psm.getCurrentState({
            userId: TEST_USER, resolvedEnv: TEST_ENV, posId: POS
        });
        expect(s.state).toBe('ENTERED');
    });

    test('throws on uninitialized position', () => {
        expect(() => psm.transitionState({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            posId: 'pos-unknown', toState: 'WATCHING',
            reason: 'r', actor: 'a'
        })).toThrow(/not.*initialized|exist/i);
    });
});

describe('§12 getCurrentState', () => {
    test('returns null when not initialized', () => {
        const s = psm.getCurrentState({
            userId: TEST_USER, resolvedEnv: TEST_ENV, posId: 'pos-unknown'
        });
        expect(s.exists).toBe(false);
    });

    test('returns state + ownership + age', () => {
        psm.initializePosition({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            posId: POS, symbol: 'BTCUSDT'
        });
        const s = psm.getCurrentState({
            userId: TEST_USER, resolvedEnv: TEST_ENV, posId: POS
        });
        expect(s.exists).toBe(true);
        expect(s.state).toBe('IDLE');
        expect(s.ownership).toBe('signal');
        expect(typeof s.age).toBe('number');
    });
});

describe('§12 getStateHistory', () => {
    test('returns empty for fresh position', () => {
        psm.initializePosition({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            posId: POS, symbol: 'BTCUSDT'
        });
        const h = psm.getStateHistory({
            userId: TEST_USER, resolvedEnv: TEST_ENV, posId: POS
        });
        expect(h).toEqual([]);
    });

    test('returns transitions in order', () => {
        psm.initializePosition({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            posId: POS, symbol: 'BTCUSDT'
        });
        psm.transitionState({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            posId: POS, toState: 'WATCHING', reason: 'r1', actor: 'sig'
        });
        psm.transitionState({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            posId: POS, toState: 'ARMED', reason: 'r2', actor: 'sig'
        });
        const h = psm.getStateHistory({
            userId: TEST_USER, resolvedEnv: TEST_ENV, posId: POS
        });
        expect(h.length).toBe(2);
        expect(h[0].toState).toBe('WATCHING');
        expect(h[1].toState).toBe('ARMED');
    });
});

describe('§12 isolation', () => {
    test('per (user × env × pos) isolation', () => {
        const OTHER_USER = 9013;
        psm.initializePosition({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            posId: POS, symbol: 'BTCUSDT'
        });
        psm.initializePosition({
            userId: OTHER_USER, resolvedEnv: TEST_ENV,
            posId: POS, symbol: 'BTCUSDT',
            initialState: 'COOLDOWN'
        });
        const r1 = psm.getCurrentState({
            userId: TEST_USER, resolvedEnv: TEST_ENV, posId: POS
        });
        const r2 = psm.getCurrentState({
            userId: OTHER_USER, resolvedEnv: TEST_ENV, posId: POS
        });
        expect(r1.state).toBe('IDLE');
        expect(r2.state).toBe('COOLDOWN');
        cleanRows();
        db.prepare(`DELETE FROM ml_position_state WHERE user_id = ?`).run(OTHER_USER);
        db.prepare(`DELETE FROM ml_position_transitions WHERE user_id = ?`).run(OTHER_USER);
    });
});

describe('§12 validation', () => {
    test('throws on missing userId', () => {
        expect(() => psm.initializePosition({
            resolvedEnv: TEST_ENV, posId: POS, symbol: 'BTCUSDT'
        })).toThrow(/userId/);
    });

    test('throws on missing reason in transitionState', () => {
        psm.initializePosition({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            posId: POS, symbol: 'BTCUSDT'
        });
        expect(() => psm.transitionState({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            posId: POS, toState: 'WATCHING', actor: 'sig'
        })).toThrow(/reason/);
    });
});
