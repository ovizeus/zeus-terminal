'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');

const TEST_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-w3-p61-'));
const TEST_DB_PATH = path.join(TEST_DB_DIR, 'test.db');
process.env.ZEUS_DB_PATH = TEST_DB_PATH;
process.env.ZEUS_TEST_DISABLE_AUTH = '1';

const { db } = require('../../../server/services/database');
const rie = require('../../../server/services/ml/R3A_safety/runtimeInvariantEngine');

const TEST_USER = 9061;
const TEST_ENV = 'DEMO';

function cleanRows() {
    db.prepare('DELETE FROM ml_invariant_violations WHERE user_id IN (?, ?)').run(TEST_USER, 9062);
    rie._resetCustomPredicates();
}

beforeEach(() => cleanRows());
afterAll(() => {
    try { fs.rmSync(TEST_DB_DIR, { recursive: true, force: true }); } catch (_) {}
});

describe('§61 Migration 108', () => {
    test('table ml_invariant_violations exists', () => {
        const row = db.prepare(
            `SELECT name FROM sqlite_master WHERE type='table' AND name='ml_invariant_violations'`
        ).get();
        expect(row).toBeTruthy();
    });

    test('CHECK severity restricts', () => {
        expect(() => db.prepare(
            `INSERT INTO ml_invariant_violations
             (user_id, resolved_env, invariant_id, severity, action_taken, ts)
             VALUES (?, ?, 'INV-X', 'BOGUS', 'lock', ?)`
        ).run(TEST_USER, TEST_ENV, Date.now())).toThrow();
    });

    test('CHECK action_taken restricts', () => {
        expect(() => db.prepare(
            `INSERT INTO ml_invariant_violations
             (user_id, resolved_env, invariant_id, severity, action_taken, ts)
             VALUES (?, ?, 'INV-X', 'critical', 'BOGUS', ?)`
        ).run(TEST_USER, TEST_ENV, Date.now())).toThrow();
    });
});

describe('§61 Constants', () => {
    test('BUILTIN_INVARIANTS has 6 entries', () => {
        expect(rie.BUILTIN_INVARIANTS).toHaveLength(6);
        expect(rie.BUILTIN_INVARIANTS).toEqual(expect.arrayContaining([
            'INV-001-no-orphan-position',
            'INV-002-size-under-cap',
            'INV-003-no-order-in-locked',
            'INV-004-no-unhedged-contradiction',
            'INV-005-valid-thesis-id',
            'INV-006-no-orphan-sl-tp'
        ]));
    });

    test('SEVERITY_LEVELS has 2 entries', () => {
        expect(rie.SEVERITY_LEVELS).toEqual(['warn', 'critical']);
    });

    test('ACTIONS has 5 entries', () => {
        expect(rie.ACTIONS).toEqual(['lock', 'alert', 'snapshot', 'forensic_log', 'noop']);
    });
});

describe('§61 Built-in INV-001 no orphan position', () => {
    test('passes when all live positions have exchange confirmation', () => {
        const r = rie.checkInvariant({
            id: 'INV-001-no-orphan-position',
            state: {
                positions: [
                    { id: 'P1', status: 'live', exchangeConfirmed: true },
                    { id: 'P2', status: 'live', exchangeConfirmed: true }
                ]
            }
        });
        expect(r.passed).toBe(true);
    });

    test('fails when live position lacks confirmation', () => {
        const r = rie.checkInvariant({
            id: 'INV-001-no-orphan-position',
            state: {
                positions: [
                    { id: 'P1', status: 'live', exchangeConfirmed: false }
                ]
            }
        });
        expect(r.passed).toBe(false);
        expect(r.severity).toBe('critical');
    });
});

describe('§61 Built-in INV-002 size under cap', () => {
    test('passes when all sizes under cap', () => {
        const r = rie.checkInvariant({
            id: 'INV-002-size-under-cap',
            state: { sizeCap: 100, positions: [{ id: 'P1', size: 50 }] }
        });
        expect(r.passed).toBe(true);
    });

    test('fails when any size over cap', () => {
        const r = rie.checkInvariant({
            id: 'INV-002-size-under-cap',
            state: { sizeCap: 100, positions: [{ id: 'P1', size: 150 }] }
        });
        expect(r.passed).toBe(false);
    });
});

describe('§61 Built-in INV-003 no order in locked', () => {
    test('passes when normal state', () => {
        const r = rie.checkInvariant({
            id: 'INV-003-no-order-in-locked',
            state: { systemState: 'NORMAL', action: { type: 'place_order' } }
        });
        expect(r.passed).toBe(true);
    });

    test('fails place_order in LOCKED', () => {
        const r = rie.checkInvariant({
            id: 'INV-003-no-order-in-locked',
            state: { systemState: 'LOCKED', action: { type: 'place_order' } }
        });
        expect(r.passed).toBe(false);
    });

    test('fails place_order in OBSERVER', () => {
        const r = rie.checkInvariant({
            id: 'INV-003-no-order-in-locked',
            state: { systemState: 'OBSERVER', action: { type: 'place_order' } }
        });
        expect(r.passed).toBe(false);
    });
});

describe('§61 Built-in INV-004 no unhedged contradiction', () => {
    test('passes pure LONG portfolio', () => {
        const r = rie.checkInvariant({
            id: 'INV-004-no-unhedged-contradiction',
            state: {
                positions: [
                    { id: 'P1', symbol: 'BTC', side: 'LONG' },
                    { id: 'P2', symbol: 'BTC', side: 'LONG' }
                ]
            }
        });
        expect(r.passed).toBe(true);
    });

    test('fails LONG + SHORT same symbol without hedge', () => {
        const r = rie.checkInvariant({
            id: 'INV-004-no-unhedged-contradiction',
            state: {
                positions: [
                    { id: 'P1', symbol: 'BTC', side: 'LONG' },
                    { id: 'P2', symbol: 'BTC', side: 'SHORT' }
                ]
            }
        });
        expect(r.passed).toBe(false);
    });

    test('passes LONG + SHORT with hedge flag on both', () => {
        const r = rie.checkInvariant({
            id: 'INV-004-no-unhedged-contradiction',
            state: {
                positions: [
                    { id: 'P1', symbol: 'BTC', side: 'LONG', hedgeFlag: true },
                    { id: 'P2', symbol: 'BTC', side: 'SHORT', hedgeFlag: true }
                ]
            }
        });
        expect(r.passed).toBe(true);
    });
});

describe('§61 Built-in INV-005 valid thesis ID', () => {
    test('passes when all live positions have thesis_id', () => {
        const r = rie.checkInvariant({
            id: 'INV-005-valid-thesis-id',
            state: {
                positions: [
                    { id: 'P1', status: 'live', thesisId: 'T-001' }
                ]
            }
        });
        expect(r.passed).toBe(true);
    });

    test('fails when live position missing thesis_id', () => {
        const r = rie.checkInvariant({
            id: 'INV-005-valid-thesis-id',
            state: {
                positions: [
                    { id: 'P1', status: 'live', thesisId: '' }
                ]
            }
        });
        expect(r.passed).toBe(false);
    });
});

describe('§61 Built-in INV-006 no orphan SL/TP', () => {
    test('passes when SL/TP references open positions only', () => {
        const r = rie.checkInvariant({
            id: 'INV-006-no-orphan-sl-tp',
            state: {
                positions: [{ id: 'P1', status: 'live' }],
                openOrders: [{ id: 'O1', type: 'SL', positionId: 'P1' }]
            }
        });
        expect(r.passed).toBe(true);
    });

    test('fails when SL references closed position', () => {
        const r = rie.checkInvariant({
            id: 'INV-006-no-orphan-sl-tp',
            state: {
                positions: [{ id: 'P1', status: 'closed' }],
                openOrders: [{ id: 'O1', type: 'SL', positionId: 'P1' }]
            }
        });
        expect(r.passed).toBe(false);
    });
});

describe('§61 checkAllInvariants', () => {
    test('returns allPassed=true when state clean', () => {
        const r = rie.checkAllInvariants({
            state: {
                positions: [
                    { id: 'P1', status: 'live', exchangeConfirmed: true,
                      symbol: 'BTC', side: 'LONG', thesisId: 'T1', size: 1 }
                ],
                sizeCap: 100,
                systemState: 'NORMAL',
                openOrders: []
            }
        });
        expect(r.allPassed).toBe(true);
        expect(r.totalChecked).toBeGreaterThanOrEqual(6);
    });

    test('returns failures when invariants violated', () => {
        const r = rie.checkAllInvariants({
            state: {
                positions: [
                    { id: 'P1', status: 'live', exchangeConfirmed: false,
                      symbol: 'BTC', side: 'LONG', thesisId: '', size: 200 }
                ],
                sizeCap: 100,
                systemState: 'NORMAL'
            }
        });
        expect(r.allPassed).toBe(false);
        expect(r.failures.length).toBeGreaterThan(0);
    });
});

describe('§61 registerInvariant + custom', () => {
    test('registers custom invariant', () => {
        const r = rie.registerInvariant({
            id: 'CUSTOM-001',
            name: 'test invariant',
            predicate: () => ({ passed: true })
        });
        expect(r.registered).toBe(true);
    });

    test('cannot override builtin', () => {
        expect(() => rie.registerInvariant({
            id: 'INV-001-no-orphan-position',
            name: 'override attempt',
            predicate: () => ({ passed: true })
        })).toThrow(/builtin/i);
    });

    test('checkInvariant works on custom', () => {
        rie.registerInvariant({
            id: 'CUSTOM-002',
            name: 'fails always',
            predicate: () => ({ passed: false, severity: 'warn' })
        });
        const r = rie.checkInvariant({
            id: 'CUSTOM-002', state: {}
        });
        expect(r.passed).toBe(false);
    });
});

describe('§61 verifyBeforeAction / verifyAfterAction', () => {
    test('verifyBeforeAction injects action into state', () => {
        const r = rie.verifyBeforeAction({
            action: { type: 'place_order' },
            state: {
                systemState: 'LOCKED',
                positions: [],
                sizeCap: 100
            }
        });
        expect(r.allPassed).toBe(false);
        expect(r.failures.some(f => f.invariantId === 'INV-003-no-order-in-locked')).toBe(true);
    });

    test('verifyAfterAction validates post-state', () => {
        const r = rie.verifyAfterAction({
            postState: {
                positions: [
                    { id: 'P1', status: 'live', exchangeConfirmed: true,
                      symbol: 'BTC', side: 'LONG', thesisId: 'T1', size: 1 }
                ],
                sizeCap: 100,
                systemState: 'NORMAL'
            }
        });
        expect(r.allPassed).toBe(true);
    });
});

describe('§61 recordViolation', () => {
    test('persists violation row', () => {
        const r = rie.recordViolation({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            invariantId: 'INV-001-no-orphan-position',
            severity: 'critical',
            actionTaken: 'lock',
            context: { positionId: 'P1' }
        });
        expect(r.recorded).toBe(true);
        const rows = db.prepare(
            `SELECT * FROM ml_invariant_violations WHERE user_id = ?`
        ).all(TEST_USER);
        expect(rows).toHaveLength(1);
    });

    test('throws on invalid severity', () => {
        expect(() => rie.recordViolation({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            invariantId: 'INV-001-no-orphan-position',
            severity: 'fatal',
            actionTaken: 'lock'
        })).toThrow();
    });

    test('throws on invalid actionTaken', () => {
        expect(() => rie.recordViolation({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            invariantId: 'INV-001-no-orphan-position',
            severity: 'critical',
            actionTaken: 'reboot'
        })).toThrow();
    });
});

describe('§61 getViolationHistory + summary', () => {
    test('returns history filterable by severity', () => {
        rie.recordViolation({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            invariantId: 'INV-001-no-orphan-position',
            severity: 'critical', actionTaken: 'lock'
        });
        rie.recordViolation({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            invariantId: 'INV-005-valid-thesis-id',
            severity: 'warn', actionTaken: 'forensic_log'
        });
        const all = rie.getViolationHistory({
            userId: TEST_USER, resolvedEnv: TEST_ENV
        });
        const crit = rie.getViolationHistory({
            userId: TEST_USER, resolvedEnv: TEST_ENV, severity: 'critical'
        });
        expect(all).toHaveLength(2);
        expect(crit).toHaveLength(1);
    });

    test('getInvariantSummary returns counts', () => {
        rie.registerInvariant({
            id: 'CUSTOM-S1', name: 'test', predicate: () => ({ passed: true })
        });
        const s = rie.getInvariantSummary();
        expect(s.builtin).toHaveLength(6);
        expect(s.custom).toHaveLength(1);
        expect(s.total).toBe(7);
    });
});

describe('§61 isolation', () => {
    test('per (user × env) isolation on history', () => {
        const OTHER_USER = 9062;
        rie.recordViolation({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            invariantId: 'INV-001-no-orphan-position',
            severity: 'critical', actionTaken: 'lock'
        });
        const r1 = rie.getViolationHistory({
            userId: TEST_USER, resolvedEnv: TEST_ENV
        });
        const r2 = rie.getViolationHistory({
            userId: OTHER_USER, resolvedEnv: TEST_ENV
        });
        expect(r1).toHaveLength(1);
        expect(r2).toHaveLength(0);
    });
});
