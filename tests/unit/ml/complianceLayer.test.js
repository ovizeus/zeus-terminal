'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');

const TEST_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-w3-p66-'));
const TEST_DB_PATH = path.join(TEST_DB_DIR, 'test.db');
process.env.ZEUS_DB_PATH = TEST_DB_PATH;
process.env.ZEUS_TEST_DISABLE_AUTH = '1';

const { db } = require('../../../server/services/database');
const cl = require('../../../server/services/ml/_crosscutting/complianceLayer');

const TEST_USER = 9066;
const TEST_ENV = 'DEMO';

function cleanRows() {
    db.prepare('DELETE FROM ml_compliance_violations WHERE user_id IN (?, ?)').run(TEST_USER, 9067);
    db.prepare('DELETE FROM ml_economic_justifications WHERE user_id IN (?, ?)').run(TEST_USER, 9067);
}

beforeEach(() => cleanRows());
afterAll(() => {
    try { fs.rmSync(TEST_DB_DIR, { recursive: true, force: true }); } catch (_) {}
});

describe('§66 Migrations 117 + 118', () => {
    test('ml_compliance_violations exists', () => {
        const cols = db.prepare(`PRAGMA table_info(ml_compliance_violations)`).all().map(c => c.name);
        expect(cols).toEqual(expect.arrayContaining([
            'user_id', 'resolved_env', 'violation_type', 'severity',
            'context_json', 'action_taken', 'ts'
        ]));
    });

    test('CHECK violation_type restricts', () => {
        expect(() => db.prepare(
            `INSERT INTO ml_compliance_violations
             (user_id, resolved_env, violation_type, severity, ts)
             VALUES (?, ?, 'BOGUS', 'warn', ?)`
        ).run(TEST_USER, TEST_ENV, Date.now())).toThrow();
    });

    test('CHECK severity restricts', () => {
        expect(() => db.prepare(
            `INSERT INTO ml_compliance_violations
             (user_id, resolved_env, violation_type, severity, ts)
             VALUES (?, ?, 'quote_stuff', 'BOGUS', ?)`
        ).run(TEST_USER, TEST_ENV, Date.now())).toThrow();
    });

    test('ml_economic_justifications exists', () => {
        const cols = db.prepare(`PRAGMA table_info(ml_economic_justifications)`).all().map(c => c.name);
        expect(cols).toEqual(expect.arrayContaining([
            'decision_id', 'action_type', 'justification_text',
            'supporting_signals_json', 'expected_economic_outcome', 'ts'
        ]));
    });
});

describe('§66 Constants', () => {
    test('VIOLATION_TYPES has 5 entries', () => {
        expect(cl.VIOLATION_TYPES).toEqual([
            'quote_stuff', 'wash_trade', 'event_sync', 'cancel_rate', 'other'
        ]);
    });

    test('SEVERITY_LEVELS has 3 entries', () => {
        expect(cl.SEVERITY_LEVELS).toEqual(['info', 'warn', 'critical']);
    });

    test('thresholds in valid ranges', () => {
        expect(cl.QUOTE_STUFF_CANCEL_RATIO_THRESHOLD).toBeGreaterThan(0);
        expect(cl.QUOTE_STUFF_CANCEL_RATIO_THRESHOLD).toBeLessThan(1);
        expect(cl.EVENT_SYNC_THRESHOLD_MS).toBeGreaterThan(0);
    });
});

describe('§66 checkQuoteStuffing', () => {
    test('no violation when normal cancel ratio', () => {
        const now = Date.now();
        const orders = [
            { action: 'place', ts: now - 1000 },
            { action: 'place', ts: now - 2000 },
            { action: 'place', ts: now - 3000 },
            { action: 'cancel', ts: now - 4000 },
            { action: 'place', ts: now - 5000 }
        ];
        const r = cl.checkQuoteStuffing({ orderHistory: orders, now });
        expect(r.violation).toBe(false);
        expect(r.cancelRatio).toBeLessThan(0.5);
    });

    test('violation when cancel ratio > 80%', () => {
        const now = Date.now();
        const orders = [];
        for (let i = 0; i < 10; i++) {
            orders.push({ action: 'cancel', ts: now - i * 100 });
        }
        for (let i = 0; i < 2; i++) {
            orders.push({ action: 'place', ts: now - (10 + i) * 100 });
        }
        const r = cl.checkQuoteStuffing({ orderHistory: orders, now });
        expect(r.violation).toBe(true);
        expect(r.cancelRatio).toBeGreaterThanOrEqual(0.80);
    });

    test('no violation when window has < 5 orders', () => {
        const now = Date.now();
        const orders = [
            { action: 'cancel', ts: now - 100 },
            { action: 'cancel', ts: now - 200 }
        ];
        const r = cl.checkQuoteStuffing({ orderHistory: orders, now });
        expect(r.violation).toBe(false);
    });

    test('empty history returns no violation', () => {
        const r = cl.checkQuoteStuffing({ orderHistory: [] });
        expect(r.violation).toBe(false);
        expect(r.samples).toBe(0);
    });
});

describe('§66 checkWashTrading', () => {
    test('no violation when only LONG positions', () => {
        const now = Date.now();
        const orders = [
            { action: 'place', side: 'LONG', symbol: 'BTC', size: 1, ts: now - 100 },
            { action: 'place', side: 'LONG', symbol: 'BTC', size: 2, ts: now - 200 }
        ];
        const r = cl.checkWashTrading({ orderHistory: orders, now });
        expect(r.violation).toBe(false);
    });

    test('violation when LONG + SHORT same size fast', () => {
        const now = Date.now();
        const orders = [
            { action: 'place', side: 'LONG', symbol: 'BTC', size: 1.5, ts: now - 100 },
            { action: 'place', side: 'SHORT', symbol: 'BTC', size: 1.5, ts: now - 500 }
        ];
        const r = cl.checkWashTrading({ orderHistory: orders, now });
        expect(r.violation).toBe(true);
        expect(r.flaggedSymbols[0].symbol).toBe('BTC');
    });

    test('no violation when LONG + SHORT different sizes', () => {
        const now = Date.now();
        const orders = [
            { action: 'place', side: 'LONG', symbol: 'BTC', size: 1, ts: now - 100 },
            { action: 'place', side: 'SHORT', symbol: 'BTC', size: 5, ts: now - 500 }
        ];
        const r = cl.checkWashTrading({ orderHistory: orders, now });
        expect(r.violation).toBe(false);
    });

    test('no violation when LONG/SHORT outside window', () => {
        const now = Date.now();
        const orders = [
            { action: 'place', side: 'LONG', symbol: 'BTC', size: 1, ts: now - 100 },
            { action: 'place', side: 'SHORT', symbol: 'BTC', size: 1, ts: now - 60000 }
        ];
        const r = cl.checkWashTrading({
            orderHistory: orders, now, windowMs: 30000
        });
        expect(r.violation).toBe(false);
    });
});

describe('§66 checkEventSyncManipulation', () => {
    test('no violation when order well after event', () => {
        const r = cl.checkEventSyncManipulation({
            orderTs: 10000, eventTs: 1000, threshold: 500
        });
        expect(r.violation).toBe(false);
    });

    test('violation when order within threshold', () => {
        const r = cl.checkEventSyncManipulation({
            orderTs: 10100, eventTs: 10000, threshold: 500
        });
        expect(r.violation).toBe(true);
        expect(r.deltaMs).toBeLessThanOrEqual(500);
    });

    test('symmetric detection (order before event)', () => {
        const r = cl.checkEventSyncManipulation({
            orderTs: 9700, eventTs: 10000, threshold: 500
        });
        expect(r.violation).toBe(true);
    });
});

describe('§66 logEconomicJustification + retrieve', () => {
    test('persists + retrieves', () => {
        cl.logEconomicJustification({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            decisionId: 'DEC-001',
            actionType: 'place_order',
            justification: 'breakout above resistance with strong volume',
            supportingSignals: { rsi: 70, vol: 'high' },
            expectedOutcome: 'price target 110'
        });
        const j = cl.getJustificationForDecision({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            decisionId: 'DEC-001'
        });
        expect(j).toBeTruthy();
        expect(j.justification).toMatch(/breakout/);
        expect(j.supportingSignals.rsi).toBe(70);
    });

    test('returns null when decision not logged', () => {
        const j = cl.getJustificationForDecision({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            decisionId: 'NONEXISTENT'
        });
        expect(j).toBe(null);
    });
});

describe('§66 recordViolation', () => {
    test('persists violation', () => {
        const r = cl.recordViolation({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            violationType: 'quote_stuff',
            severity: 'warn',
            context: { cancelRatio: 0.85 },
            actionTaken: 'log_only'
        });
        expect(r.recorded).toBe(true);
        const rows = db.prepare(
            `SELECT * FROM ml_compliance_violations WHERE user_id = ?`
        ).all(TEST_USER);
        expect(rows).toHaveLength(1);
    });

    test('throws on invalid violationType', () => {
        expect(() => cl.recordViolation({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            violationType: 'BOGUS', severity: 'warn'
        })).toThrow();
    });

    test('throws on invalid severity', () => {
        expect(() => cl.recordViolation({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            violationType: 'quote_stuff', severity: 'fatal'
        })).toThrow();
    });
});

describe('§66 getComplianceStats', () => {
    test('aggregates per type+severity', () => {
        cl.recordViolation({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            violationType: 'quote_stuff', severity: 'warn'
        });
        cl.recordViolation({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            violationType: 'quote_stuff', severity: 'warn'
        });
        cl.recordViolation({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            violationType: 'wash_trade', severity: 'critical'
        });
        const s = cl.getComplianceStats({
            userId: TEST_USER, resolvedEnv: TEST_ENV
        });
        expect(s.total).toBe(3);
        expect(s.byTypeAndSeverity.length).toBeGreaterThanOrEqual(2);
    });
});

describe('§66 isolation', () => {
    test('per (user × env) isolation', () => {
        const OTHER_USER = 9067;
        cl.recordViolation({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            violationType: 'quote_stuff', severity: 'warn'
        });
        const s1 = cl.getComplianceStats({
            userId: TEST_USER, resolvedEnv: TEST_ENV
        });
        const s2 = cl.getComplianceStats({
            userId: OTHER_USER, resolvedEnv: TEST_ENV
        });
        expect(s1.total).toBe(1);
        expect(s2.total).toBe(0);
    });
});
