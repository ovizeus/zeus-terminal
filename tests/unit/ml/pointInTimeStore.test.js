'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');

const TEST_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-w3-p55-'));
const TEST_DB_PATH = path.join(TEST_DB_DIR, 'test.db');
process.env.ZEUS_DB_PATH = TEST_DB_PATH;
process.env.ZEUS_TEST_DISABLE_AUTH = '1';

const { db } = require('../../../server/services/database');
const pit = require('../../../server/services/ml/R0_substrate/pointInTimeStore');

const TEST_USER = 9055;
const TEST_ENV = 'DEMO';

function cleanRows() {
    db.prepare('DELETE FROM ml_pit_snapshots WHERE user_id = ?').run(TEST_USER);
    db.prepare('DELETE FROM ml_pit_snapshots WHERE user_id = ?').run(9056);
}

beforeEach(() => cleanRows());
afterAll(() => {
    try { fs.rmSync(TEST_DB_DIR, { recursive: true, force: true }); } catch (_) {}
});

describe('§55 Migration 099', () => {
    test('table ml_pit_snapshots exists', () => {
        const row = db.prepare(
            `SELECT name FROM sqlite_master WHERE type='table' AND name='ml_pit_snapshots'`
        ).get();
        expect(row).toBeTruthy();
    });

    test('has expected columns', () => {
        const cols = db.prepare(`PRAGMA table_info(ml_pit_snapshots)`).all().map(c => c.name);
        expect(cols).toEqual(expect.arrayContaining([
            'id', 'user_id', 'resolved_env', 'snapshot_type', 'ts',
            'market_state_json', 'feature_state_json', 'model_output_json',
            'vetos_json', 'scores_json', 'order_intent_json', 'created_at'
        ]));
    });

    test('CHECK snapshot_type restricts', () => {
        expect(() => db.prepare(
            `INSERT INTO ml_pit_snapshots
             (user_id, resolved_env, snapshot_type, ts, created_at)
             VALUES (?, ?, 'BOGUS', ?, ?)`
        ).run(TEST_USER, TEST_ENV, Date.now(), Date.now())).toThrow();
    });

    test('CHECK resolved_env restricts', () => {
        expect(() => db.prepare(
            `INSERT INTO ml_pit_snapshots
             (user_id, resolved_env, snapshot_type, ts, created_at)
             VALUES (?, 'BOGUS', 'decision', ?, ?)`
        ).run(TEST_USER, Date.now(), Date.now())).toThrow();
    });
});

describe('§55 Exported constants', () => {
    test('SNAPSHOT_TYPES has 4 expected entries', () => {
        expect(pit.SNAPSHOT_TYPES).toEqual(['decision', 'tick', 'event', 'manual']);
    });

    test('MAX_SNAPSHOTS_PER_QUERY positive', () => {
        expect(pit.MAX_SNAPSHOTS_PER_QUERY).toBeGreaterThan(0);
    });
});

describe('§55 recordSnapshot', () => {
    test('persists snapshot with all payload fields', () => {
        const r = pit.recordSnapshot({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            snapshotType: 'decision',
            ts: 1700000000000,
            marketState: { price: 100, depth: { bids: 5 } },
            featureState: { rsi: 30, ema: 99 },
            modelOutput: { score: 0.65 },
            vetos: [],
            scores: { entry: 0.7 },
            orderIntent: { side: 'LONG', size: 1 }
        });
        expect(r.recorded).toBe(true);
        expect(r.id).toBeGreaterThan(0);

        const row = db.prepare(
            `SELECT * FROM ml_pit_snapshots WHERE id = ?`
        ).get(r.id);
        expect(row.snapshot_type).toBe('decision');
        expect(JSON.parse(row.market_state_json).price).toBe(100);
        expect(JSON.parse(row.model_output_json).score).toBe(0.65);
    });

    test('accepts all 4 snapshot types', () => {
        for (const type of pit.SNAPSHOT_TYPES) {
            const r = pit.recordSnapshot({
                userId: TEST_USER, resolvedEnv: TEST_ENV,
                snapshotType: type,
                ts: Date.now()
            });
            expect(r.recorded).toBe(true);
        }
        const rows = db.prepare(
            `SELECT COUNT(*) AS c FROM ml_pit_snapshots WHERE user_id = ?`
        ).get(TEST_USER);
        expect(rows.c).toBe(4);
    });

    test('throws on invalid snapshotType', () => {
        expect(() => pit.recordSnapshot({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            snapshotType: 'bogus',
            ts: Date.now()
        })).toThrow(/snapshotType/i);
    });

    test('throws on invalid ts (negative)', () => {
        expect(() => pit.recordSnapshot({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            snapshotType: 'tick',
            ts: -1
        })).toThrow(/ts/i);
    });

    test('handles NULL optional fields gracefully', () => {
        const r = pit.recordSnapshot({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            snapshotType: 'tick',
            ts: 1700000000000
        });
        expect(r.recorded).toBe(true);
        const snap = pit.getSnapshotById(r.id);
        expect(snap.marketState).toBe(null);
        expect(snap.featureState).toBe(null);
    });
});

describe('§55 getStateAt — time-travel primitive', () => {
    beforeEach(() => {
        // 3 snapshots at ts=100, 200, 300
        pit.recordSnapshot({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            snapshotType: 'decision', ts: 100,
            marketState: { price: 100 }
        });
        pit.recordSnapshot({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            snapshotType: 'decision', ts: 200,
            marketState: { price: 105 }
        });
        pit.recordSnapshot({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            snapshotType: 'decision', ts: 300,
            marketState: { price: 110 }
        });
    });

    test('exact ts match returns that snapshot', () => {
        const r = pit.getStateAt({ userId: TEST_USER, resolvedEnv: TEST_ENV, ts: 200 });
        expect(r.found).toBe(true);
        expect(r.snapshot.ts).toBe(200);
        expect(r.snapshot.marketState.price).toBe(105);
    });

    test('between two ts returns latest preceding', () => {
        const r = pit.getStateAt({ userId: TEST_USER, resolvedEnv: TEST_ENV, ts: 250 });
        expect(r.found).toBe(true);
        expect(r.snapshot.ts).toBe(200);
    });

    test('ts before all snapshots returns not found', () => {
        const r = pit.getStateAt({ userId: TEST_USER, resolvedEnv: TEST_ENV, ts: 50 });
        expect(r.found).toBe(false);
        expect(r.snapshot).toBe(null);
    });

    test('INVARIANT: future snapshots NOT visible', () => {
        // Critical: getStateAt(150) must NOT see snapshot at ts=200 or 300.
        // "Data available THEN" vs "data after" separation.
        const r = pit.getStateAt({ userId: TEST_USER, resolvedEnv: TEST_ENV, ts: 150 });
        expect(r.found).toBe(true);
        expect(r.snapshot.ts).toBe(100);
        expect(r.snapshot.marketState.price).toBe(100);  // NOT 105 or 110
    });
});

describe('§55 replaySnapshots — deterministic window', () => {
    beforeEach(() => {
        for (let i = 0; i < 10; i++) {
            pit.recordSnapshot({
                userId: TEST_USER, resolvedEnv: TEST_ENV,
                snapshotType: i % 2 === 0 ? 'tick' : 'decision',
                ts: 1000 + i * 100,
                marketState: { i }
            });
        }
    });

    test('returns ordered window asc', () => {
        const r = pit.replaySnapshots({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            startTs: 1200, endTs: 1500
        });
        expect(r.length).toBe(4);  // 1200, 1300, 1400, 1500
        expect(r[0].ts).toBe(1200);
        expect(r[r.length - 1].ts).toBe(1500);
    });

    test('filters by snapshotType', () => {
        const r = pit.replaySnapshots({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            startTs: 1000, endTs: 1900,
            snapshotType: 'tick'
        });
        expect(r.length).toBe(5);  // i=0,2,4,6,8
        r.forEach(s => expect(s.snapshotType).toBe('tick'));
    });

    test('respects limit', () => {
        const r = pit.replaySnapshots({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            startTs: 1000, endTs: 1900,
            limit: 3
        });
        expect(r.length).toBe(3);
    });

    test('throws if startTs > endTs', () => {
        expect(() => pit.replaySnapshots({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            startTs: 2000, endTs: 1000
        })).toThrow(/startTs/i);
    });

    test('throws on invalid snapshotType filter', () => {
        expect(() => pit.replaySnapshots({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            startTs: 1000, endTs: 2000,
            snapshotType: 'bogus'
        })).toThrow(/snapshotType/i);
    });
});

describe('§55 JSON round-trip fidelity', () => {
    test('complex nested payload survives store-and-retrieve', () => {
        const complex = {
            depth: { bids: [[100, 5], [99, 3]], asks: [[101, 4]] },
            indicators: { rsi: 30.5, ema: { '20': 99, '50': 95 } },
            flags: [true, false, true]
        };
        const r = pit.recordSnapshot({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            snapshotType: 'decision',
            ts: 1700000000000,
            marketState: complex
        });
        const snap = pit.getSnapshotById(r.id);
        expect(snap.marketState).toEqual(complex);
    });
});

describe('§55 isolation', () => {
    test('per (user × env) isolation', () => {
        const OTHER_USER = 9056;
        pit.recordSnapshot({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            snapshotType: 'decision', ts: 100
        });
        pit.recordSnapshot({
            userId: OTHER_USER, resolvedEnv: TEST_ENV,
            snapshotType: 'decision', ts: 200
        });
        const r1 = pit.getStateAt({ userId: TEST_USER, resolvedEnv: TEST_ENV, ts: 500 });
        const r2 = pit.getStateAt({ userId: OTHER_USER, resolvedEnv: TEST_ENV, ts: 500 });
        expect(r1.snapshot.ts).toBe(100);
        expect(r2.snapshot.ts).toBe(200);
    });
});

describe('§55 countSnapshots', () => {
    test('counts all when no since', () => {
        for (let i = 0; i < 5; i++) {
            pit.recordSnapshot({
                userId: TEST_USER, resolvedEnv: TEST_ENV,
                snapshotType: 'tick', ts: 1000 + i
            });
        }
        expect(pit.countSnapshots({
            userId: TEST_USER, resolvedEnv: TEST_ENV
        })).toBe(5);
    });

    test('counts only since when provided', () => {
        for (let i = 0; i < 5; i++) {
            pit.recordSnapshot({
                userId: TEST_USER, resolvedEnv: TEST_ENV,
                snapshotType: 'tick', ts: 1000 + i * 100
            });
        }
        expect(pit.countSnapshots({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            since: 1200
        })).toBe(3);  // 1200, 1300, 1400
    });
});
