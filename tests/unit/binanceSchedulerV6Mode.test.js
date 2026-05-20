'use strict';

/**
 * V6 integration: binanceScheduler honors persistent rate state mode.
 *
 * SUPPRESSED → ALL requests rejected (even P0/P1)
 * WARM → class B rejected, A+C allowed
 * NORMAL → original P0..P5 lane logic applies
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
let scheduler;

beforeEach(() => {
  db = new Database(':memory:');
  db.exec(SCHEMA_SQL);

  jest.resetModules();
  jest.doMock('../../server/services/database', () => ({ db, get: () => db }));

  scheduler = require('../../server/services/binanceScheduler');
  scheduler._resetForTest();
});

afterEach(() => {
  db.close();
  jest.dontMock('../../server/services/database');
});

describe('binanceScheduler V6 mode gating — SUPPRESSED', () => {
  test('rejects ALL requests when banned_until > now (even P0/P1)', () => {
    db.prepare(`
      INSERT INTO binance_rate_state (scope, banned_until, ban_reason, updated_at)
      VALUES ('global', ?, 'test ban', ?)
    `).run(Date.now() + 60_000, Date.now());

    // P0 (order op) — would normally always accept
    const p0 = scheduler.canProceed({ pressure: 0, src: 'signer:POST /fapi/v1/order', path: '/fapi/v1/order' });
    expect(p0.accept).toBe(false);
    expect(p0.reason).toBe('suppressed_banned');

    // P1 (recon) — would normally always accept
    const p1 = scheduler.canProceed({ pressure: 0, src: 'serverAT:recon-positionRisk', path: '/fapi/v2/positionRisk' });
    expect(p1.accept).toBe(false);
    expect(p1.reason).toBe('suppressed_banned');

    // P5 (depth) — public, normally low priority
    const p5 = scheduler.canProceed({ pressure: 0, src: 'serverLiquidity:depth', path: '/fapi/v1/depth' });
    expect(p5.accept).toBe(false);
    expect(p5.reason).toBe('suppressed_banned');
  });
});

describe('binanceScheduler V6 mode gating — WARM', () => {
  beforeEach(() => {
    // Set up WARM state — ban expired, warm window active
    db.prepare(`
      INSERT INTO binance_rate_state (scope, banned_until, warm_until, updated_at)
      VALUES ('global', ?, ?, ?)
    `).run(Date.now() - 1_000, Date.now() + 60_000, Date.now());
  });

  test('CLASS_A endpoints (balance, positionRisk, order) accepted during warm', () => {
    expect(scheduler.canProceed({ pressure: 0, src: 'x', path: '/fapi/v2/balance' }).accept).toBe(true);
    expect(scheduler.canProceed({ pressure: 0, src: 'x', path: '/fapi/v2/positionRisk' }).accept).toBe(true);
    expect(scheduler.canProceed({ pressure: 0, src: 'x', path: '/fapi/v1/order' }).accept).toBe(true);
  });

  test('CLASS_B endpoints (ticker24h, klines, openInterest) REJECTED during warm', () => {
    const t = scheduler.canProceed({ pressure: 0, src: 'marketRadar:ticker24h', path: '/fapi/v1/ticker/24hr' });
    expect(t.accept).toBe(false);
    expect(t.reason).toBe('warm_class_b');

    const k = scheduler.canProceed({ pressure: 0, src: 'marketFeed:alt-klines', path: '/fapi/v1/klines' });
    expect(k.accept).toBe(false);
    expect(k.reason).toBe('warm_class_b');
  });

  test('CLASS_C endpoints (depth, ping) accepted during warm (cheap)', () => {
    expect(scheduler.canProceed({ pressure: 0, src: 'serverLiquidity:depth', path: '/fapi/v1/depth' }).accept).toBe(true);
    expect(scheduler.canProceed({ pressure: 0, src: 'x', path: '/fapi/v1/ping' }).accept).toBe(true);
  });

  test('unknown path defaults to CLASS_B → rejected during warm (safe default)', () => {
    const u = scheduler.canProceed({ pressure: 0, src: 'x', path: '/fapi/v1/unknown-endpoint' });
    expect(u.accept).toBe(false);
    expect(u.reason).toBe('warm_class_b');
  });
});

describe('binanceScheduler V6 mode gating — NORMAL', () => {
  test('no row in DB → mode=NORMAL → original lane logic applies', () => {
    // P0 accepted regardless of pressure
    expect(scheduler.canProceed({ pressure: 0.99, src: 'signer:POST /fapi/v1/order', path: '/fapi/v1/order' }).accept).toBe(true);

    // P5 rejected at high pressure
    const p5 = scheduler.canProceed({ pressure: 0.95, src: 'serverLiquidity:depth', path: '/fapi/v1/depth' });
    expect(p5.accept).toBe(false);
    expect(p5.reason).toBe('threshold_reject');
  });

  test('row with banned_until=0 and warm_until=0 → NORMAL', () => {
    db.prepare(`
      INSERT INTO binance_rate_state (scope, banned_until, warm_until, updated_at)
      VALUES ('global', 0, 0, ?)
    `).run(Date.now());

    expect(scheduler.canProceed({ pressure: 0.5, src: 'x', path: '/fapi/v1/depth' }).accept).toBe(true);
  });
});
