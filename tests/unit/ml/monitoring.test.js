'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');

const TEST_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-w3-p35-'));
const TEST_DB_PATH = path.join(TEST_DB_DIR, 'test.db');
process.env.ZEUS_DB_PATH = TEST_DB_PATH;
process.env.ZEUS_TEST_DISABLE_AUTH = '1';

const { db } = require('../../../server/services/database');
const mon = require('../../../server/services/ml/_crosscutting/monitoring');

const TEST_USER = 9035;
const TEST_ENV = 'DEMO';

function cleanRows() {
    db.prepare('DELETE FROM ml_observability_events WHERE user_id = ?').run(TEST_USER);
    db.prepare('DELETE FROM ml_kpi_snapshots WHERE user_id = ?').run(TEST_USER);
}

beforeEach(() => cleanRows());
afterAll(() => {
    try { fs.rmSync(TEST_DB_DIR, { recursive: true, force: true }); } catch (_) {}
});

describe('§35 Migration 064 — events + kpi snapshots', () => {
    test('table ml_observability_events exists', () => {
        const row = db.prepare(
            `SELECT name FROM sqlite_master WHERE type='table' AND name='ml_observability_events'`
        ).get();
        expect(row).toBeTruthy();
    });

    test('table ml_kpi_snapshots exists', () => {
        const row = db.prepare(
            `SELECT name FROM sqlite_master WHERE type='table' AND name='ml_kpi_snapshots'`
        ).get();
        expect(row).toBeTruthy();
    });

    test('ml_observability_events has expected columns', () => {
        const cols = db.prepare(`PRAGMA table_info(ml_observability_events)`).all().map(c => c.name);
        expect(cols).toEqual(expect.arrayContaining([
            'id', 'user_id', 'resolved_env', 'event_type', 'payload_json',
            'regime', 'pos_id', 'ts'
        ]));
    });

    test('ml_kpi_snapshots has expected columns', () => {
        const cols = db.prepare(`PRAGMA table_info(ml_kpi_snapshots)`).all().map(c => c.name);
        expect(cols).toEqual(expect.arrayContaining([
            'id', 'user_id', 'resolved_env', 'kpi', 'value', 'regime', 'ts'
        ]));
    });

    test('CHECK event_type restricts', () => {
        expect(() => db.prepare(
            `INSERT INTO ml_observability_events
             (user_id, resolved_env, event_type, payload_json, ts)
             VALUES (?, ?, 'BOGUS', '{}', ?)`
        ).run(TEST_USER, TEST_ENV, Date.now())).toThrow();
    });

    test('CHECK kpi restricts', () => {
        expect(() => db.prepare(
            `INSERT INTO ml_kpi_snapshots
             (user_id, resolved_env, kpi, value, ts)
             VALUES (?, ?, 'BOGUS_KPI', 0.5, ?)`
        ).run(TEST_USER, TEST_ENV, Date.now())).toThrow();
    });
});

describe('§35 Exported constants', () => {
    test('EVENT_TYPES has 13 spec entries', () => {
        expect(mon.EVENT_TYPES).toHaveLength(13);
        expect(mon.EVENT_TYPES).toEqual(expect.arrayContaining([
            'decision_log', 'raw_features', 'detector_score',
            'meta_score', 'execution_event', 'fill', 'pnl',
            'slippage', 'latency', 'reconciliation_status',
            'drift_status', 'veto_reason', 'explainability_snapshot'
        ]));
    });

    test('KPI_KEYS has 11 spec entries', () => {
        expect(mon.KPI_KEYS).toHaveLength(11);
        expect(mon.KPI_KEYS).toEqual(expect.arrayContaining([
            'kpi_per_regime', 'pnl_per_regime', 'hit_rate_per_regime',
            'avg_rr', 'avg_slippage', 'avg_latency', 'fill_quality',
            'confidence_calibration', 'drift_monitor',
            'false_breakout_monitor', 'venue_divergence_monitor'
        ]));
    });

    test('AGGREGATION_PERIODS has time bucket sizes', () => {
        expect(mon.AGGREGATION_PERIODS).toEqual(expect.arrayContaining([
            'minute', 'hour', 'day', 'week'
        ]));
    });
});

describe('§35 recordEvent', () => {
    test('records event row', () => {
        mon.recordEvent({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            eventType: 'decision_log',
            payload: { decision: 'BUY', score: 0.78 },
            regime: 'trend'
        });
        const rows = db.prepare(
            `SELECT * FROM ml_observability_events WHERE user_id = ?`
        ).all(TEST_USER);
        expect(rows).toHaveLength(1);
        expect(rows[0].event_type).toBe('decision_log');
    });

    test('records pos_id when provided', () => {
        mon.recordEvent({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            eventType: 'execution_event',
            payload: { side: 'LONG' },
            posId: 'pos-1'
        });
        const row = db.prepare(
            `SELECT * FROM ml_observability_events WHERE user_id = ?`
        ).get(TEST_USER);
        expect(row.pos_id).toBe('pos-1');
    });

    test('throws on invalid event_type', () => {
        expect(() => mon.recordEvent({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            eventType: 'bogus_event',
            payload: {}
        })).toThrow(/event/i);
    });

    test('records ts when provided', () => {
        const ts = Date.now() - 60000;
        mon.recordEvent({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            eventType: 'fill', payload: { qty: 0.5 }, ts
        });
        const row = db.prepare(
            `SELECT * FROM ml_observability_events WHERE user_id = ?`
        ).get(TEST_USER);
        expect(row.ts).toBe(ts);
    });
});

describe('§35 recordKpi', () => {
    test('records kpi value', () => {
        mon.recordKpi({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            kpi: 'avg_rr', value: 1.85, regime: 'trend'
        });
        const rows = db.prepare(
            `SELECT * FROM ml_kpi_snapshots WHERE user_id = ?`
        ).all(TEST_USER);
        expect(rows).toHaveLength(1);
        expect(rows[0].kpi).toBe('avg_rr');
        expect(rows[0].value).toBeCloseTo(1.85);
    });

    test('records multiple values for same kpi (time-series)', () => {
        for (const v of [1.5, 1.8, 2.1]) {
            mon.recordKpi({
                userId: TEST_USER, resolvedEnv: TEST_ENV,
                kpi: 'avg_rr', value: v
            });
        }
        const rows = db.prepare(
            `SELECT * FROM ml_kpi_snapshots WHERE user_id = ? AND kpi = ?`
        ).all(TEST_USER, 'avg_rr');
        expect(rows).toHaveLength(3);
    });

    test('throws on invalid kpi', () => {
        expect(() => mon.recordKpi({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            kpi: 'bogus_kpi', value: 0.5
        })).toThrow(/kpi/i);
    });
});

describe('§35 getKpiDashboard', () => {
    beforeEach(() => {
        for (const v of [1.5, 1.8, 2.1]) {
            mon.recordKpi({
                userId: TEST_USER, resolvedEnv: TEST_ENV,
                kpi: 'avg_rr', value: v, regime: 'trend'
            });
        }
        mon.recordKpi({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            kpi: 'avg_slippage', value: 0.05, regime: 'trend'
        });
    });

    test('returns latest + mean + count for each kpi', () => {
        const dash = mon.getKpiDashboard({
            userId: TEST_USER, resolvedEnv: TEST_ENV
        });
        expect(dash.avg_rr).toBeDefined();
        expect(dash.avg_rr.latest).toBeCloseTo(2.1);
        expect(dash.avg_rr.mean).toBeCloseTo(1.8, 1);
        expect(dash.avg_rr.count).toBe(3);
    });

    test('filters by regime', () => {
        const dash = mon.getKpiDashboard({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            regime: 'range'
        });
        expect(dash.avg_rr).toBeUndefined();
    });

    test('filters by since', () => {
        const future = Date.now() + 60000;
        const dash = mon.getKpiDashboard({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            since: future
        });
        expect(dash.avg_rr).toBeUndefined();
    });

    test('respects kpis filter list', () => {
        const dash = mon.getKpiDashboard({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            kpis: ['avg_rr']
        });
        expect(dash.avg_rr).toBeDefined();
        expect(dash.avg_slippage).toBeUndefined();
    });
});

describe('§35 getRecentEvents', () => {
    beforeEach(() => {
        for (let i = 0; i < 5; i++) {
            mon.recordEvent({
                userId: TEST_USER, resolvedEnv: TEST_ENV,
                eventType: 'decision_log',
                payload: { i }
            });
        }
        mon.recordEvent({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            eventType: 'pnl',
            payload: { value: 100 }
        });
    });

    test('returns all events when no filter', () => {
        const evts = mon.getRecentEvents({
            userId: TEST_USER, resolvedEnv: TEST_ENV
        });
        expect(evts.length).toBeGreaterThanOrEqual(6);
    });

    test('filters by event_type', () => {
        const evts = mon.getRecentEvents({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            eventType: 'pnl'
        });
        expect(evts).toHaveLength(1);
        expect(evts[0].eventType).toBe('pnl');
    });

    test('respects limit', () => {
        const evts = mon.getRecentEvents({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            limit: 3
        });
        expect(evts).toHaveLength(3);
    });

    test('filters by since', () => {
        const future = Date.now() + 60000;
        const evts = mon.getRecentEvents({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            since: future
        });
        expect(evts).toEqual([]);
    });
});

describe('§35 aggregateKpisByRegime', () => {
    beforeEach(() => {
        for (const v of [1.5, 1.8]) {
            mon.recordKpi({
                userId: TEST_USER, resolvedEnv: TEST_ENV,
                kpi: 'avg_rr', value: v, regime: 'trend'
            });
        }
        for (const v of [1.0, 1.2]) {
            mon.recordKpi({
                userId: TEST_USER, resolvedEnv: TEST_ENV,
                kpi: 'avg_rr', value: v, regime: 'range'
            });
        }
    });

    test('groups by regime', () => {
        const agg = mon.aggregateKpisByRegime({
            userId: TEST_USER, resolvedEnv: TEST_ENV
        });
        expect(agg.trend).toBeDefined();
        expect(agg.range).toBeDefined();
        expect(agg.trend.avg_rr.mean).toBeCloseTo(1.65, 1);
        expect(agg.range.avg_rr.mean).toBeCloseTo(1.1, 1);
    });
});

describe('§35 isolation', () => {
    test('per (user × env) isolation', () => {
        const OTHER_USER = 9036;
        mon.recordEvent({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            eventType: 'pnl', payload: { val: 100 }
        });
        mon.recordEvent({
            userId: OTHER_USER, resolvedEnv: TEST_ENV,
            eventType: 'pnl', payload: { val: 50 }
        });
        const mine = mon.getRecentEvents({
            userId: TEST_USER, resolvedEnv: TEST_ENV
        });
        const others = mon.getRecentEvents({
            userId: OTHER_USER, resolvedEnv: TEST_ENV
        });
        expect(mine).toHaveLength(1);
        expect(others).toHaveLength(1);
        db.prepare(`DELETE FROM ml_observability_events WHERE user_id = ?`).run(OTHER_USER);
    });
});

describe('§35 validation', () => {
    test('recordEvent throws on missing eventType', () => {
        expect(() => mon.recordEvent({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            payload: {}
        })).toThrow(/eventType/);
    });

    test('recordKpi throws on missing value', () => {
        expect(() => mon.recordKpi({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            kpi: 'avg_rr'
        })).toThrow(/value/);
    });
});
