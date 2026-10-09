'use strict';
// [2026-10-09] The ML auto-quarantine scan had been inert since it shipped.
// The cron discovered users with `SELECT DISTINCT user_id FROM ml_bandit_evidence`,
// but that table has no user_id column (its schema keys on cell_key, which encodes
// the user as its first segment). The query threw on prepare, a bare catch swallowed
// it into `users = []`, and every tick logged "0 users ... evaluated=0" while 755
// attribution events and 749 bandit rows sat there unread.
//
// The existing mlScanCron test could not catch it: it mocks db.prepare to return a
// fixed user list whatever the SQL is, so the schema mismatch was invisible. This
// file uses a REAL in-memory database with the REAL schemas, so a column that does
// not exist fails here the way it fails in production.

const Database = require('better-sqlite3');
const realDb = new Database(':memory:');

realDb.exec(`
    CREATE TABLE ml_attribution_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        resolved_env TEXT NOT NULL,
        decision_digest TEXT NOT NULL,
        outcome_class TEXT NOT NULL,
        attributed_at INTEGER NOT NULL
    );
    CREATE TABLE ml_bandit_evidence (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        cell_key TEXT NOT NULL,
        module_id TEXT NOT NULL,
        contribution REAL NOT NULL,
        confidence REAL NOT NULL,
        outcome_class TEXT NOT NULL,
        ts INTEGER NOT NULL,
        created_at INTEGER NOT NULL
    );
`);

jest.mock('../../../server/services/database', () => ({ db: realDb }));
jest.mock('../../../server/services/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));

const scanCalls = [];
jest.mock('../../../server/services/ml/R5B_governance/autoQuarantine', () => ({
    scanAllFeatures: jest.fn((params) => {
        scanCalls.push(params);
        return { evaluated: 1, quarantined: [], skipped: 0, errors: [] };
    }),
}));
jest.mock('../../../server/migrationFlags', () => new Proxy({}, {
    get: (_, p) => (p === 'ML_CRON_SCAN_ENABLED' ? true : false),
}));

const { _tick } = require('../../../server/cron/mlScanCron');

beforeEach(() => {
    scanCalls.length = 0;
    realDb.prepare('DELETE FROM ml_attribution_events').run();
    realDb.prepare('DELETE FROM ml_bandit_evidence').run();
});

function addAttribution(userId, env, digest, whenMs) {
    realDb.prepare(
        `INSERT INTO ml_attribution_events (user_id, resolved_env, decision_digest, outcome_class, attributed_at)
         VALUES (?, ?, ?, 'WIN', ?)`
    ).run(userId, env, digest, whenMs);
}

describe('mlScanCron — user discovery against the real schema', () => {
    test('a user with recent attribution events is scanned', () => {
        addAttribution(1, 'DEMO', 'digest_a', Date.now() - 60 * 60 * 1000);

        _tick();

        expect(scanCalls.map((c) => c.userId)).toContain(1);
    });

    test('discovery does not depend on ml_bandit_evidence, which has no user_id', () => {
        // Rows exist, shaped exactly as production shapes them: the user lives
        // inside cell_key, so any query selecting user_id here throws.
        realDb.prepare(
            `INSERT INTO ml_bandit_evidence (cell_key, module_id, contribution, confidence, outcome_class, ts, created_at)
             VALUES ('1:DEMO:BTCUSDT:TREND', 'ring5_outcome', 0.5, 0.9, 'positive', ?, ?)`
        ).run(Date.now(), Date.now());
        addAttribution(7, 'DEMO', 'digest_b', Date.now() - 60 * 60 * 1000);

        _tick();

        expect(scanCalls.map((c) => c.userId)).toContain(7);
    });

    test('a user with no attribution events in the window is not scanned', () => {
        addAttribution(3, 'DEMO', 'digest_c', Date.now() - 40 * 24 * 60 * 60 * 1000);

        _tick();

        expect(scanCalls.map((c) => c.userId)).not.toContain(3);
    });
});
