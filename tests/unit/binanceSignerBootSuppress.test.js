'use strict';

/**
 * V6 integration test: binanceSigner inherits ban state from DB at boot.
 *
 * The critical anti-thrash behavior — without this, every PM2 reload
 * would cause the new process to forget the existing ban and immediately
 * trigger another probe ⇒ re-ban cycle.
 */

const Database = require('better-sqlite3');

const SCHEMA_SQL = `
  CREATE TABLE binance_rate_state (
    scope TEXT PRIMARY KEY DEFAULT 'global',
    banned_until INTEGER NOT NULL DEFAULT 0,
    ban_reason TEXT,
    warm_until INTEGER NOT NULL DEFAULT 0,
    used_weight_1m INTEGER NOT NULL DEFAULT 0,
    used_weight_ts INTEGER,
    burst_calls_10s INTEGER NOT NULL DEFAULT 0,
    burst_window_start INTEGER,
    last_heavy_endpoint_ts INTEGER,
    resume_generation INTEGER NOT NULL DEFAULT 1,
    consecutive_ban_count INTEGER NOT NULL DEFAULT 0,
    last_ban_at INTEGER,
    updated_at INTEGER NOT NULL
  );
  CREATE TABLE binance_rate_state_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts INTEGER NOT NULL,
    event_json TEXT NOT NULL
  );
`;

let db;

beforeEach(() => {
  db = new Database(':memory:');
  db.exec(SCHEMA_SQL);
});

afterEach(() => {
  db.close();
});

describe('binanceSigner boot inheritance from DB', () => {
  test('boots into SUPPRESSED state when DB has banned_until > now (PM2 reload during active ban)', () => {
    // Simulate previous process having persisted a ban
    const futureBan = Date.now() + 60_000;
    db.prepare(`
      INSERT INTO binance_rate_state (scope, banned_until, ban_reason, updated_at)
      VALUES ('global', ?, 'pre-reload ban', ?)
    `).run(futureBan, Date.now());

    // Fresh "process boot" — new require
    jest.resetModules();
    jest.doMock('../../server/services/database', () => ({ db, get: () => db }));

    const signer = require('../../server/services/binanceSigner');
    const status = signer.getIpCbStatus();

    expect(status.banned).toBe(true);
    expect(status.bannedUntil).toBe(futureBan);
    expect(status.reason).toMatch(/pre-reload/);
  });

  test('boots into NORMAL state when DB has banned_until in the past (ban already expired)', () => {
    db.prepare(`
      INSERT INTO binance_rate_state (scope, banned_until, ban_reason, updated_at)
      VALUES ('global', ?, 'expired ban', ?)
    `).run(Date.now() - 60_000, Date.now() - 70_000);

    jest.resetModules();
    jest.doMock('../../server/services/database', () => ({ db, get: () => db }));

    const signer = require('../../server/services/binanceSigner');
    const status = signer.getIpCbStatus();

    expect(status.banned).toBe(false);
  });

  test('boots into NORMAL when DB has no row (cold start)', () => {
    jest.resetModules();
    jest.doMock('../../server/services/database', () => ({ db, get: () => db }));

    const signer = require('../../server/services/binanceSigner');
    const status = signer.getIpCbStatus();

    expect(status.banned).toBe(false);
  });

  test('boots into NORMAL even if DB unreachable (defensive — never crash signer)', () => {
    jest.resetModules();
    // Mock with no db key — load() will throw → fall back to defaults
    jest.doMock('../../server/services/database', () => {
      throw new Error('DB unreachable');
    });

    const signer = require('../../server/services/binanceSigner');
    const status = signer.getIpCbStatus();

    expect(status.banned).toBe(false);
  });
});
