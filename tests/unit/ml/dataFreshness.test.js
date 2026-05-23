'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');

const TEST_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-w3-p13-'));
const TEST_DB_PATH = path.join(TEST_DB_DIR, 'test.db');
process.env.ZEUS_DB_PATH = TEST_DB_PATH;
process.env.ZEUS_TEST_DISABLE_AUTH = '1';

const { db } = require('../../../server/services/database');
const df = require('../../../server/services/ml/R3A_safety/dataFreshness');

const TEST_USER = 9113;
const TEST_ENV = 'DEMO';

function cleanRows() {
    db.prepare('DELETE FROM ml_freshness_log WHERE user_id = ?').run(TEST_USER);
}

beforeEach(() => cleanRows());
afterAll(() => {
    try { fs.rmSync(TEST_DB_DIR, { recursive: true, force: true }); } catch (_) {}
});

describe('§13 Migration 056_ml_freshness_log', () => {
    test('table ml_freshness_log exists', () => {
        const row = db.prepare(
            `SELECT name FROM sqlite_master WHERE type='table' AND name='ml_freshness_log'`
        ).get();
        expect(row).toBeTruthy();
    });

    test('has expected columns', () => {
        const cols = db.prepare(`PRAGMA table_info(ml_freshness_log)`).all().map(c => c.name);
        expect(cols).toEqual(expect.arrayContaining([
            'id', 'user_id', 'resolved_env', 'action', 'issue_count',
            'stale_feeds_json', 'divergences_json', 'snapshot_issues_json',
            'clock_drift_ms', 'context_json', 'created_at'
        ]));
    });

    test('CHECK action restricts to ladder values', () => {
        expect(() => db.prepare(
            `INSERT INTO ml_freshness_log (user_id, resolved_env, action, issue_count,
              stale_feeds_json, divergences_json, snapshot_issues_json, created_at)
             VALUES (?, ?, 'BOGUS', 0, '[]', '[]', '[]', ?)`
        ).run(TEST_USER, TEST_ENV, Date.now())).toThrow();
    });

    test('CHECK resolved_env restricts to DEMO|TESTNET|REAL', () => {
        expect(() => db.prepare(
            `INSERT INTO ml_freshness_log (user_id, resolved_env, action, issue_count,
              stale_feeds_json, divergences_json, snapshot_issues_json, created_at)
             VALUES (?, 'PROD', 'OK', 0, '[]', '[]', '[]', ?)`
        ).run(TEST_USER, Date.now())).toThrow();
    });
});

describe('§13 Exported constants', () => {
    test('FEED_CHECK_KEYS has 8 entries', () => {
        expect(df.FEED_CHECK_KEYS).toHaveLength(8);
        expect(df.FEED_CHECK_KEYS).toEqual(expect.arrayContaining([
            'feed_age', 'timestamp_alignment', 'update_gap',
            'source_divergence', 'snapshot_integrity', 'websocket_health',
            'clock_drift', 'flow_continuity'
        ]));
    });

    test('ACTION_LADDER has 5 + OK (in spec order)', () => {
        expect(df.ACTION_LADDER).toEqual([
            'OK',
            'OBSERVER',
            'ALERT',
            'PAUSE',
            'REDUCE_RISK',
            'NO_TRADE'
        ]);
    });

    test('DEFAULT_THRESHOLDS has finite numbers for all required keys', () => {
        expect(df.DEFAULT_THRESHOLDS.feed_age_ms).toBeGreaterThan(0);
        expect(df.DEFAULT_THRESHOLDS.update_gap_ms).toBeGreaterThan(0);
        expect(df.DEFAULT_THRESHOLDS.timestamp_skew_ms).toBeGreaterThan(0);
        expect(df.DEFAULT_THRESHOLDS.source_divergence_pct).toBeGreaterThan(0);
        expect(df.DEFAULT_THRESHOLDS.clock_drift_ms).toBeGreaterThan(0);
        expect(df.DEFAULT_THRESHOLDS.flow_gap_ms).toBeGreaterThan(0);
    });
});

describe('§13 evaluateFeedHealth — healthy feed scenarios', () => {
    test('all feeds fresh + aligned + websocket healthy → OK', () => {
        const now = Date.now();
        const r = df.evaluateFeedHealth({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            feeds: {
                BTCUSDT_price: { lastUpdate: now - 200, value: 50000, source: 'binance' }
            },
            websocketHealthy: true,
            clockDriftMs: 100
        });
        expect(r.action).toBe('OK');
        expect(r.issueCount).toBe(0);
        expect(r.staleFeeds).toEqual([]);
        expect(r.divergences).toEqual([]);
    });

    test('clockDriftMs within threshold → no clock_drift issue', () => {
        const now = Date.now();
        const r = df.evaluateFeedHealth({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            feeds: { BTCUSDT_price: { lastUpdate: now - 100, value: 50000 } },
            websocketHealthy: true,
            clockDriftMs: df.DEFAULT_THRESHOLDS.clock_drift_ms - 1
        });
        expect(r.action).toBe('OK');
    });
});

describe('§13 evaluateFeedHealth — degraded scenarios', () => {
    test('stale feed (age > threshold) → action != OK + listed in staleFeeds', () => {
        const now = Date.now();
        const r = df.evaluateFeedHealth({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            feeds: {
                BTCUSDT_price: { lastUpdate: now - (df.DEFAULT_THRESHOLDS.feed_age_ms + 5000), value: 50000 }
            },
            websocketHealthy: true,
            clockDriftMs: 0
        });
        expect(r.action).not.toBe('OK');
        expect(r.staleFeeds).toContain('BTCUSDT_price');
    });

    test('websocket unhealthy → flow_continuity issue + escalated action', () => {
        const now = Date.now();
        const r = df.evaluateFeedHealth({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            feeds: { BTCUSDT_price: { lastUpdate: now - 100, value: 50000 } },
            websocketHealthy: false,
            clockDriftMs: 0
        });
        expect(r.action).not.toBe('OK');
        expect(r.flowIssues).toContain('websocket_down');
    });

    test('clock drift exceeds threshold → escalated action', () => {
        const now = Date.now();
        const r = df.evaluateFeedHealth({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            feeds: { BTCUSDT_price: { lastUpdate: now - 100, value: 50000 } },
            websocketHealthy: true,
            clockDriftMs: df.DEFAULT_THRESHOLDS.clock_drift_ms + 1000
        });
        expect(r.action).not.toBe('OK');
        expect(r.clockDriftFlag).toBe(true);
    });

    test('source divergence > threshold → divergences populated', () => {
        const now = Date.now();
        const r = df.evaluateFeedHealth({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            feeds: {
                BTCUSDT_price_binance: { lastUpdate: now - 100, value: 50000, source: 'binance' },
                BTCUSDT_price_bybit:   { lastUpdate: now - 100, value: 53000, source: 'bybit' }
            },
            criticalSourceGroups: { BTC_PRICE: ['BTCUSDT_price_binance', 'BTCUSDT_price_bybit'] },
            websocketHealthy: true,
            clockDriftMs: 0
        });
        expect(r.action).not.toBe('OK');
        expect(r.divergences).toContain('BTC_PRICE');
    });

    test('snapshot integrity broken (checksum mismatch) → snapshotIssues populated', () => {
        const now = Date.now();
        const r = df.evaluateFeedHealth({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            feeds: {
                BTCUSDT_orderbook: {
                    lastUpdate: now - 100, value: { bid: 50000 },
                    snapshotIntegrity: false
                }
            },
            websocketHealthy: true,
            clockDriftMs: 0
        });
        expect(r.action).not.toBe('OK');
        expect(r.snapshotIssues).toContain('BTCUSDT_orderbook');
    });
});

describe('§13 evaluateFeedHealth — action ladder escalation', () => {
    test('1 minor issue (clock drift slight) → OBSERVER', () => {
        const now = Date.now();
        const r = df.evaluateFeedHealth({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            feeds: { BTCUSDT_price: { lastUpdate: now - 100, value: 50000 } },
            websocketHealthy: true,
            clockDriftMs: df.DEFAULT_THRESHOLDS.clock_drift_ms + 500
        });
        expect(['OBSERVER', 'ALERT']).toContain(r.action);
    });

    test('multiple issues → escalates to PAUSE or higher', () => {
        const now = Date.now();
        const r = df.evaluateFeedHealth({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            feeds: {
                BTCUSDT_price: { lastUpdate: now - (df.DEFAULT_THRESHOLDS.feed_age_ms + 5000), value: 50000 },
                ETHUSDT_price: { lastUpdate: now - (df.DEFAULT_THRESHOLDS.feed_age_ms + 5000), value: 3000 }
            },
            websocketHealthy: false,
            clockDriftMs: df.DEFAULT_THRESHOLDS.clock_drift_ms + 5000
        });
        const ladder = df.ACTION_LADDER;
        const rank = ladder.indexOf(r.action);
        expect(rank).toBeGreaterThanOrEqual(ladder.indexOf('PAUSE'));
    });

    test('catastrophic (most critical feeds stale + ws down) → NO_TRADE', () => {
        const now = Date.now();
        const r = df.evaluateFeedHealth({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            feeds: {
                BTCUSDT_price: { lastUpdate: now - 60000, value: 50000 },
                ETHUSDT_price: { lastUpdate: now - 60000, value: 3000 },
                SOLUSDT_price: { lastUpdate: now - 60000, value: 100 },
                BTCUSDT_book:  { lastUpdate: now - 60000, value: {}, snapshotIntegrity: false }
            },
            websocketHealthy: false,
            clockDriftMs: 100000
        });
        expect(r.action).toBe('NO_TRADE');
    });
});

describe('§13 evaluateFeedHealth — audit logging', () => {
    test('logs row for every evaluation (OK)', () => {
        const now = Date.now();
        df.evaluateFeedHealth({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            feeds: { BTCUSDT_price: { lastUpdate: now - 100, value: 50000 } },
            websocketHealthy: true,
            clockDriftMs: 0
        });
        const rows = db.prepare(`SELECT * FROM ml_freshness_log WHERE user_id = ?`).all(TEST_USER);
        expect(rows).toHaveLength(1);
        expect(rows[0].action).toBe('OK');
    });

    test('logs row for degraded action with stale_feeds_json populated', () => {
        const now = Date.now();
        df.evaluateFeedHealth({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            feeds: {
                BTCUSDT_price: { lastUpdate: now - 60000, value: 50000 }
            },
            websocketHealthy: true,
            clockDriftMs: 0
        });
        const row = db.prepare(`SELECT * FROM ml_freshness_log WHERE user_id = ?`).get(TEST_USER);
        const stale = JSON.parse(row.stale_feeds_json);
        expect(stale).toContain('BTCUSDT_price');
    });

    test('context preserved in context_json', () => {
        const now = Date.now();
        df.evaluateFeedHealth({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            feeds: { BTCUSDT_price: { lastUpdate: now - 100, value: 50000 } },
            websocketHealthy: true,
            clockDriftMs: 0,
            context: { route: 'pre_entry_check', strategy: 'momentum_v1' }
        });
        const row = db.prepare(`SELECT * FROM ml_freshness_log WHERE user_id = ?`).get(TEST_USER);
        const ctx = JSON.parse(row.context_json);
        expect(ctx.route).toBe('pre_entry_check');
        expect(ctx.strategy).toBe('momentum_v1');
    });
});

describe('§13 evaluateFeedHealth — validation', () => {
    test('throws on missing userId', () => {
        expect(() => df.evaluateFeedHealth({
            resolvedEnv: TEST_ENV, feeds: {}, websocketHealthy: true, clockDriftMs: 0
        })).toThrow(/userId/);
    });

    test('throws on missing resolvedEnv', () => {
        expect(() => df.evaluateFeedHealth({
            userId: TEST_USER, feeds: {}, websocketHealthy: true, clockDriftMs: 0
        })).toThrow(/resolvedEnv/);
    });

    test('empty feeds + healthy ws + zero drift → OK (no feeds to check)', () => {
        const r = df.evaluateFeedHealth({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            feeds: {}, websocketHealthy: true, clockDriftMs: 0
        });
        expect(r.action).toBe('OK');
    });

    test('feed without lastUpdate is flagged stale', () => {
        const r = df.evaluateFeedHealth({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            feeds: { BTCUSDT_price: { value: 50000 } },
            websocketHealthy: true,
            clockDriftMs: 0
        });
        expect(r.staleFeeds).toContain('BTCUSDT_price');
    });

    test('custom thresholds override defaults', () => {
        const now = Date.now();
        const r = df.evaluateFeedHealth({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            feeds: { BTCUSDT_price: { lastUpdate: now - 6000, value: 50000 } },
            websocketHealthy: true,
            clockDriftMs: 0,
            thresholds: { ...df.DEFAULT_THRESHOLDS, feed_age_ms: 5000 }
        });
        expect(r.staleFeeds).toContain('BTCUSDT_price');
    });
});

describe('§13 isolation', () => {
    test('per (user × env) isolation in queries', () => {
        const OTHER_USER = 9112;
        const now = Date.now();
        df.evaluateFeedHealth({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            feeds: { BTCUSDT_price: { lastUpdate: now - 60000, value: 50000 } },
            websocketHealthy: true, clockDriftMs: 0
        });
        df.evaluateFeedHealth({
            userId: OTHER_USER, resolvedEnv: TEST_ENV,
            feeds: { BTCUSDT_price: { lastUpdate: now - 100, value: 50000 } },
            websocketHealthy: true, clockDriftMs: 0
        });
        const myRows = db.prepare(`SELECT * FROM ml_freshness_log WHERE user_id = ?`).all(TEST_USER);
        const otherRows = db.prepare(`SELECT * FROM ml_freshness_log WHERE user_id = ?`).all(OTHER_USER);
        expect(myRows).toHaveLength(1);
        expect(otherRows).toHaveLength(1);
        expect(myRows[0].action).not.toBe('OK');
        expect(otherRows[0].action).toBe('OK');
        db.prepare(`DELETE FROM ml_freshness_log WHERE user_id = ?`).run(OTHER_USER);
    });
});
