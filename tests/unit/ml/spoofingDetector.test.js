'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');

const TEST_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-w3-domn1-'));
const TEST_DB_PATH = path.join(TEST_DB_DIR, 'test.db');
process.env.ZEUS_DB_PATH = TEST_DB_PATH;
process.env.ZEUS_TEST_DISABLE_AUTH = '1';

const { db } = require('../../../server/services/database');
const sd = require('../../../server/services/ml/R2_cognition/spoofingDetector');

const TEST_USER = 9301;
const TEST_ENV = 'DEMO';

function cleanRows() {
    db.prepare('DELETE FROM ml_spoofing_events WHERE user_id = ?').run(TEST_USER);
}

beforeEach(() => cleanRows());
afterAll(() => {
    try { fs.rmSync(TEST_DB_DIR, { recursive: true, force: true }); } catch (_) {}
});

describe('DOM-N1 Migration 077', () => {
    test('table ml_spoofing_events exists', () => {
        const row = db.prepare(
            `SELECT name FROM sqlite_master WHERE type='table' AND name='ml_spoofing_events'`
        ).get();
        expect(row).toBeTruthy();
    });

    test('has expected columns', () => {
        const cols = db.prepare(`PRAGMA table_info(ml_spoofing_events)`).all().map(c => c.name);
        expect(cols).toEqual(expect.arrayContaining([
            'id', 'user_id', 'resolved_env', 'event_type',
            'symbol', 'severity', 'payload_json', 'created_at'
        ]));
    });

    test('CHECK event_type restricts', () => {
        expect(() => db.prepare(
            `INSERT INTO ml_spoofing_events
             (user_id, resolved_env, event_type, severity, payload_json, created_at)
             VALUES (?, ?, 'BOGUS', 0.5, '{}', ?)`
        ).run(TEST_USER, TEST_ENV, Date.now())).toThrow();
    });
});

describe('DOM-N1 Exported constants', () => {
    test('SPOOFING_EVENT_TYPES has 4 entries', () => {
        expect(sd.SPOOFING_EVENT_TYPES).toEqual(expect.arrayContaining([
            'suspected_spoof', 'fake_wall_detected',
            'pulled_orders', 'layering_pattern'
        ]));
    });

    test('DEFAULT_DETECTION_PARAMS has finite values', () => {
        expect(sd.DEFAULT_DETECTION_PARAMS.min_suspect_size_usd).toBeGreaterThan(0);
        expect(sd.DEFAULT_DETECTION_PARAMS.cancel_velocity_threshold_ms).toBeGreaterThan(0);
        expect(sd.DEFAULT_DETECTION_PARAMS.fake_wall_disappear_pct).toBeGreaterThan(0);
    });
});

describe('DOM-N1 detectSpoofing (pure)', () => {
    test('rapid cancel cycle → suspected spoof', () => {
        const now = Date.now();
        const r = sd.detectSpoofing({
            orderBookEvents: [
                { type: 'place', level: 50500, size: 500000, ts: now },
                { type: 'cancel', level: 50500, size: 500000, ts: now + 100 }  // canceled in 100ms
            ],
            currentPrice: 50000
        });
        expect(r.detected).toBe(true);
        expect(r.severity).toBeGreaterThan(0);
    });

    test('long-lived order → no spoof', () => {
        const now = Date.now();
        const r = sd.detectSpoofing({
            orderBookEvents: [
                { type: 'place', level: 50500, size: 100000, ts: now },
                { type: 'cancel', level: 50500, size: 100000, ts: now + 60000 }  // 60s
            ],
            currentPrice: 50000
        });
        expect(r.detected).toBe(false);
    });

    test('multiple rapid cancellations → high severity', () => {
        const now = Date.now();
        const events = [];
        for (let i = 0; i < 5; i++) {
            events.push({ type: 'place', level: 50500, size: 600000, ts: now + i * 200 });
            events.push({ type: 'cancel', level: 50500, size: 600000, ts: now + i * 200 + 50 });
        }
        const r = sd.detectSpoofing({
            orderBookEvents: events,
            currentPrice: 50000
        });
        expect(r.detected).toBe(true);
        expect(r.severity).toBeGreaterThan(0.3);
    });

    test('empty events → no spoof', () => {
        const r = sd.detectSpoofing({
            orderBookEvents: [],
            currentPrice: 50000
        });
        expect(r.detected).toBe(false);
        expect(r.severity).toBe(0);
    });
});

describe('DOM-N1 detectFakeWall (pure)', () => {
    test('large wall disappears as price approaches → fake wall', () => {
        const r = sd.detectFakeWall({
            orderBook: {
                bids: [{ price: 49990, size: 1000000 }],
                asks: [{ price: 50100, size: 50000 }]
            },
            priceMovement: {
                priorWallSize: 1000000,
                currentWallSize: 50000,
                priceDirection: 'TOWARD_WALL'
            }
        });
        expect(r.detected).toBe(true);
    });

    test('wall holds → no fake wall', () => {
        const r = sd.detectFakeWall({
            orderBook: {
                bids: [{ price: 49990, size: 1000000 }],
                asks: []
            },
            priceMovement: {
                priorWallSize: 1000000,
                currentWallSize: 1000000,
                priceDirection: 'TOWARD_WALL'
            }
        });
        expect(r.detected).toBe(false);
    });

    test('wall disappears but price moving away → not fake', () => {
        const r = sd.detectFakeWall({
            orderBook: {
                bids: [],
                asks: [{ price: 50100, size: 100000 }]
            },
            priceMovement: {
                priorWallSize: 1000000,
                currentWallSize: 100000,
                priceDirection: 'AWAY_FROM_WALL'
            }
        });
        expect(r.detected).toBe(false);
    });
});

describe('DOM-N1 recordSpoofingEvent', () => {
    test('records spoofing event', () => {
        sd.recordSpoofingEvent({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            eventType: 'suspected_spoof',
            payload: { level: 50500, severity: 0.7 },
            symbol: 'BTCUSDT',
            severity: 0.7
        });
        const rows = db.prepare(
            `SELECT * FROM ml_spoofing_events WHERE user_id = ?`
        ).all(TEST_USER);
        expect(rows).toHaveLength(1);
        expect(rows[0].event_type).toBe('suspected_spoof');
    });

    test('throws on invalid event_type', () => {
        expect(() => sd.recordSpoofingEvent({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            eventType: 'bogus',
            payload: {}
        })).toThrow(/event_type|eventType/i);
    });
});

describe('DOM-N1 getSpoofingHistory', () => {
    beforeEach(() => {
        for (let i = 0; i < 5; i++) {
            sd.recordSpoofingEvent({
                userId: TEST_USER, resolvedEnv: TEST_ENV,
                eventType: 'suspected_spoof',
                payload: { i }, symbol: 'BTCUSDT', severity: 0.5
            });
        }
    });

    test('returns all events', () => {
        const r = sd.getSpoofingHistory({
            userId: TEST_USER, resolvedEnv: TEST_ENV
        });
        expect(r).toHaveLength(5);
    });

    test('respects limit', () => {
        const r = sd.getSpoofingHistory({
            userId: TEST_USER, resolvedEnv: TEST_ENV, limit: 2
        });
        expect(r).toHaveLength(2);
    });

    test('filters by since', () => {
        const r = sd.getSpoofingHistory({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            since: Date.now() + 1000
        });
        expect(r).toEqual([]);
    });
});

describe('DOM-N1 getSpoofingFrequency', () => {
    beforeEach(() => {
        for (let i = 0; i < 3; i++) {
            sd.recordSpoofingEvent({
                userId: TEST_USER, resolvedEnv: TEST_ENV,
                eventType: 'suspected_spoof',
                payload: {}, symbol: 'BTCUSDT', severity: 0.5
            });
        }
        for (let i = 0; i < 2; i++) {
            sd.recordSpoofingEvent({
                userId: TEST_USER, resolvedEnv: TEST_ENV,
                eventType: 'fake_wall_detected',
                payload: {}, symbol: 'BTCUSDT', severity: 0.6
            });
        }
    });

    test('returns per-event-type counts', () => {
        const r = sd.getSpoofingFrequency({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            symbol: 'BTCUSDT'
        });
        expect(r.total).toBe(5);
        expect(r.byType.suspected_spoof).toBe(3);
        expect(r.byType.fake_wall_detected).toBe(2);
    });

    test('zero events when no records', () => {
        const r = sd.getSpoofingFrequency({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            symbol: 'ETHUSDT'
        });
        expect(r.total).toBe(0);
    });
});

describe('DOM-N1 isolation', () => {
    test('per (user × env) isolation', () => {
        const OTHER_USER = 9302;
        sd.recordSpoofingEvent({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            eventType: 'suspected_spoof', payload: {}, severity: 0.5
        });
        const myRows = db.prepare(
            `SELECT * FROM ml_spoofing_events WHERE user_id = ?`
        ).all(TEST_USER);
        const otherRows = db.prepare(
            `SELECT * FROM ml_spoofing_events WHERE user_id = ?`
        ).all(OTHER_USER);
        expect(myRows).toHaveLength(1);
        expect(otherRows).toHaveLength(0);
    });
});
