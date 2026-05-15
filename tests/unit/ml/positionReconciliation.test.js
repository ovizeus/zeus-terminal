'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');

const TEST_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-w3-p28-'));
const TEST_DB_PATH = path.join(TEST_DB_DIR, 'test.db');
process.env.ZEUS_DB_PATH = TEST_DB_PATH;
process.env.ZEUS_TEST_DISABLE_AUTH = '1';

const { db } = require('../../../server/services/database');
const recon = require('../../../server/services/ml/R3A_safety/positionReconciliation');

const TEST_USER = 9128;
const TEST_ENV = 'DEMO';

function cleanRows() {
    db.prepare('DELETE FROM ml_recon_log WHERE user_id = ?').run(TEST_USER);
}

beforeEach(() => cleanRows());
afterAll(() => {
    try { fs.rmSync(TEST_DB_DIR, { recursive: true, force: true }); } catch (_) {}
});

describe('§28 Migration 057_ml_recon_log', () => {
    test('table ml_recon_log exists', () => {
        const row = db.prepare(
            `SELECT name FROM sqlite_master WHERE type='table' AND name='ml_recon_log'`
        ).get();
        expect(row).toBeTruthy();
    });

    test('has expected columns', () => {
        const cols = db.prepare(`PRAGMA table_info(ml_recon_log)`).all().map(c => c.name);
        expect(cols).toEqual(expect.arrayContaining([
            'id', 'user_id', 'resolved_env', 'check_type', 'subject',
            'action', 'severity', 'divergences_json', 'details_json',
            'created_at'
        ]));
    });

    test('CHECK check_type restricts to RECON|LATENCY|RATE_LIMIT', () => {
        expect(() => db.prepare(
            `INSERT INTO ml_recon_log
             (user_id, resolved_env, check_type, action, severity, divergences_json, created_at)
             VALUES (?, ?, 'BOGUS', 'OK', 0, '[]', ?)`
        ).run(TEST_USER, TEST_ENV, Date.now())).toThrow();
    });

    test('CHECK action restricts to OK|ALERT|LOCK|FLATTEN', () => {
        expect(() => db.prepare(
            `INSERT INTO ml_recon_log
             (user_id, resolved_env, check_type, action, severity, divergences_json, created_at)
             VALUES (?, ?, 'RECON', 'NUKE', 0, '[]', ?)`
        ).run(TEST_USER, TEST_ENV, Date.now())).toThrow();
    });

    test('CHECK resolved_env restricts to DEMO|TESTNET|REAL', () => {
        expect(() => db.prepare(
            `INSERT INTO ml_recon_log
             (user_id, resolved_env, check_type, action, severity, divergences_json, created_at)
             VALUES (?, 'PROD', 'RECON', 'OK', 0, '[]', ?)`
        ).run(TEST_USER, Date.now())).toThrow();
    });
});

describe('§28 Exported constants', () => {
    test('DIVERGENCE_TYPES has 8 entries', () => {
        expect(recon.DIVERGENCE_TYPES).toHaveLength(8);
        expect(recon.DIVERGENCE_TYPES).toEqual(expect.arrayContaining([
            'position_qty', 'position_side', 'position_missing',
            'sl_missing', 'sl_mismatch', 'tp_missing', 'tp_mismatch',
            'order_phantom'
        ]));
    });

    test('LATENCY_KINDS has 4 entries', () => {
        expect(recon.LATENCY_KINDS).toEqual([
            'order_ack', 'cancel', 'websocket_lag', 'clock_drift'
        ]);
    });

    test('ACTION_LADDER ordered OK→ALERT→LOCK→FLATTEN', () => {
        expect(recon.ACTION_LADDER).toEqual(['OK', 'ALERT', 'LOCK', 'FLATTEN']);
    });

    test('DEFAULT_THRESHOLDS has positive values', () => {
        expect(recon.DEFAULT_THRESHOLDS.qty_tolerance_pct).toBeGreaterThan(0);
        expect(recon.DEFAULT_THRESHOLDS.price_tolerance_pct).toBeGreaterThan(0);
        expect(recon.DEFAULT_THRESHOLDS.order_ack_ms).toBeGreaterThan(0);
        expect(recon.DEFAULT_THRESHOLDS.cancel_ms).toBeGreaterThan(0);
        expect(recon.DEFAULT_THRESHOLDS.websocket_lag_ms).toBeGreaterThan(0);
        expect(recon.DEFAULT_THRESHOLDS.clock_drift_ms).toBeGreaterThan(0);
    });
});

describe('§28 reconcilePosition — matching scenarios', () => {
    test('internal matches exchange exactly → OK', () => {
        const r = recon.reconcilePosition({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            symbol: 'BTCUSDT',
            internal: { qty: 0.5, side: 'LONG', slPrice: 49000, tpPrice: 51000 },
            exchange: { qty: 0.5, side: 'LONG', slPrice: 49000, tpPrice: 51000 }
        });
        expect(r.action).toBe('OK');
        expect(r.divergences).toEqual([]);
        expect(r.matches).toBe(true);
    });

    test('small qty diff within tolerance → OK', () => {
        const r = recon.reconcilePosition({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            symbol: 'BTCUSDT',
            internal: { qty: 0.5000, side: 'LONG', slPrice: 49000 },
            exchange: { qty: 0.5001, side: 'LONG', slPrice: 49000 }
        });
        expect(r.action).toBe('OK');
        expect(r.matches).toBe(true);
    });

    test('small price diff within tolerance → OK', () => {
        const r = recon.reconcilePosition({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            symbol: 'BTCUSDT',
            internal: { qty: 0.5, side: 'LONG', slPrice: 49000.00 },
            exchange: { qty: 0.5, side: 'LONG', slPrice: 49000.01 }
        });
        expect(r.action).toBe('OK');
    });
});

describe('§28 reconcilePosition — divergence scenarios', () => {
    test('qty mismatch outside tolerance → ALERT + position_qty divergence', () => {
        const r = recon.reconcilePosition({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            symbol: 'BTCUSDT',
            internal: { qty: 0.5, side: 'LONG' },
            exchange: { qty: 0.6, side: 'LONG' }
        });
        expect(r.action).not.toBe('OK');
        expect(r.divergences).toContain('position_qty');
    });

    test('side mismatch (LONG vs SHORT) → FLATTEN (critical)', () => {
        const r = recon.reconcilePosition({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            symbol: 'BTCUSDT',
            internal: { qty: 0.5, side: 'LONG' },
            exchange: { qty: 0.5, side: 'SHORT' }
        });
        expect(r.action).toBe('FLATTEN');
        expect(r.divergences).toContain('position_side');
    });

    test('exchange has NO position but internal thinks LONG → FLATTEN', () => {
        const r = recon.reconcilePosition({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            symbol: 'BTCUSDT',
            internal: { qty: 0.5, side: 'LONG' },
            exchange: null
        });
        expect(r.action).toBe('FLATTEN');
        expect(r.divergences).toContain('position_missing');
    });

    test('SL missing on exchange but internal expects → LOCK', () => {
        const r = recon.reconcilePosition({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            symbol: 'BTCUSDT',
            internal: { qty: 0.5, side: 'LONG', slPrice: 49000 },
            exchange: { qty: 0.5, side: 'LONG', slPrice: null }
        });
        expect(['LOCK', 'FLATTEN']).toContain(r.action);
        expect(r.divergences).toContain('sl_missing');
    });

    test('SL price mismatch (large diff) → ALERT or LOCK', () => {
        const r = recon.reconcilePosition({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            symbol: 'BTCUSDT',
            internal: { qty: 0.5, side: 'LONG', slPrice: 49000 },
            exchange: { qty: 0.5, side: 'LONG', slPrice: 47000 }
        });
        expect(r.action).not.toBe('OK');
        expect(r.divergences).toContain('sl_mismatch');
    });

    test('phantom order on exchange (no internal record) → ALERT', () => {
        const r = recon.reconcilePosition({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            symbol: 'BTCUSDT',
            internal: null,
            exchange: { qty: 0.5, side: 'LONG' }
        });
        expect(r.action).not.toBe('OK');
        expect(r.divergences).toContain('order_phantom');
    });

    test('multiple divergences → most severe action (FLATTEN > LOCK > ALERT)', () => {
        const r = recon.reconcilePosition({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            symbol: 'BTCUSDT',
            internal: { qty: 0.5, side: 'LONG', slPrice: 49000 },
            exchange: { qty: 0.5, side: 'SHORT', slPrice: null }
        });
        expect(r.action).toBe('FLATTEN');
    });
});

describe('§28 monitorLatency', () => {
    test('latency within threshold → no alert', () => {
        const r = recon.monitorLatency({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            kind: 'order_ack', valueMs: 50
        });
        expect(r.alert).toBe(false);
    });

    test('latency above threshold → alert', () => {
        const r = recon.monitorLatency({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            kind: 'order_ack',
            valueMs: recon.DEFAULT_THRESHOLDS.order_ack_ms + 1000
        });
        expect(r.alert).toBe(true);
        expect(r.kind).toBe('order_ack');
        expect(r.severity).toBeGreaterThan(0);
    });

    test('cancel latency above threshold → alert', () => {
        const r = recon.monitorLatency({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            kind: 'cancel',
            valueMs: recon.DEFAULT_THRESHOLDS.cancel_ms + 5000
        });
        expect(r.alert).toBe(true);
    });

    test('throws on invalid kind', () => {
        expect(() => recon.monitorLatency({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            kind: 'BOGUS', valueMs: 100
        })).toThrow(/kind/);
    });

    test('custom threshold overrides default', () => {
        const r = recon.monitorLatency({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            kind: 'order_ack', valueMs: 200,
            thresholds: { order_ack_ms: 100 }
        });
        expect(r.alert).toBe(true);
    });
});

describe('§28 checkRateLimit', () => {
    test('used < 50% of budget → no throttle', () => {
        const r = recon.checkRateLimit({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            budgetTotal: 1000, used: 100, priorityTier: 'NORMAL'
        });
        expect(r.shouldThrottle).toBe(false);
        expect(r.remainingBudget).toBe(900);
    });

    test('used > 90% of budget → throttle with delay', () => {
        const r = recon.checkRateLimit({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            budgetTotal: 1000, used: 950, priorityTier: 'NORMAL'
        });
        expect(r.shouldThrottle).toBe(true);
        expect(r.throttleMs).toBeGreaterThan(0);
    });

    test('CRITICAL priority bypasses throttle even at 95%', () => {
        const r = recon.checkRateLimit({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            budgetTotal: 1000, used: 950, priorityTier: 'CRITICAL'
        });
        expect(r.shouldThrottle).toBe(false);
    });

    test('NORMAL request at 100% used → hard throttle', () => {
        const r = recon.checkRateLimit({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            budgetTotal: 1000, used: 1000, priorityTier: 'NORMAL'
        });
        expect(r.shouldThrottle).toBe(true);
        expect(r.throttleMs).toBeGreaterThan(0);
    });
});

describe('§28 audit logging', () => {
    test('logs row on reconcilePosition (OK)', () => {
        recon.reconcilePosition({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            symbol: 'BTCUSDT',
            internal: { qty: 0.5, side: 'LONG' },
            exchange: { qty: 0.5, side: 'LONG' }
        });
        const rows = db.prepare(
            `SELECT * FROM ml_recon_log WHERE user_id = ? AND check_type = 'RECON'`
        ).all(TEST_USER);
        expect(rows).toHaveLength(1);
        expect(rows[0].action).toBe('OK');
    });

    test('logs row on monitorLatency (alert)', () => {
        recon.monitorLatency({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            kind: 'order_ack',
            valueMs: recon.DEFAULT_THRESHOLDS.order_ack_ms + 1000
        });
        const rows = db.prepare(
            `SELECT * FROM ml_recon_log WHERE user_id = ? AND check_type = 'LATENCY'`
        ).all(TEST_USER);
        expect(rows).toHaveLength(1);
        expect(rows[0].action).toBe('ALERT');
    });

    test('logs row on checkRateLimit (throttle)', () => {
        recon.checkRateLimit({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            budgetTotal: 1000, used: 950, priorityTier: 'NORMAL'
        });
        const rows = db.prepare(
            `SELECT * FROM ml_recon_log WHERE user_id = ? AND check_type = 'RATE_LIMIT'`
        ).all(TEST_USER);
        expect(rows).toHaveLength(1);
    });
});

describe('§28 isolation', () => {
    test('per (user × env) isolation in queries', () => {
        const OTHER_USER = 9129;
        recon.reconcilePosition({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            symbol: 'BTCUSDT',
            internal: { qty: 0.5, side: 'LONG' },
            exchange: { qty: 0.5, side: 'SHORT' }
        });
        recon.reconcilePosition({
            userId: OTHER_USER, resolvedEnv: TEST_ENV,
            symbol: 'BTCUSDT',
            internal: { qty: 0.5, side: 'LONG' },
            exchange: { qty: 0.5, side: 'LONG' }
        });
        const myRows = db.prepare(`SELECT * FROM ml_recon_log WHERE user_id = ?`).all(TEST_USER);
        const otherRows = db.prepare(`SELECT * FROM ml_recon_log WHERE user_id = ?`).all(OTHER_USER);
        expect(myRows).toHaveLength(1);
        expect(otherRows).toHaveLength(1);
        expect(myRows[0].action).toBe('FLATTEN');
        expect(otherRows[0].action).toBe('OK');
        db.prepare(`DELETE FROM ml_recon_log WHERE user_id = ?`).run(OTHER_USER);
    });
});

describe('§28 validation', () => {
    test('reconcilePosition throws on missing userId', () => {
        expect(() => recon.reconcilePosition({
            resolvedEnv: TEST_ENV, symbol: 'BTCUSDT',
            internal: null, exchange: null
        })).toThrow(/userId/);
    });

    test('monitorLatency throws on missing valueMs', () => {
        expect(() => recon.monitorLatency({
            userId: TEST_USER, resolvedEnv: TEST_ENV, kind: 'order_ack'
        })).toThrow(/valueMs/);
    });

    test('checkRateLimit throws on missing budgetTotal', () => {
        expect(() => recon.checkRateLimit({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            used: 100, priorityTier: 'NORMAL'
        })).toThrow(/budgetTotal/);
    });
});
