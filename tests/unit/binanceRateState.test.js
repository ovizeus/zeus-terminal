'use strict';

/**
 * Tests for binanceRateState — persistent state for Binance rate-limit defense.
 *
 * Coverage:
 *  - load/save state across "boots" (in-memory DB)
 *  - state machine: NORMAL ↔ WARM ↔ SUPPRESSED transitions
 *  - anti-flap guard (MIN_STATE_DURATION_MS)
 *  - warm resume quota check
 *  - endpoint classification (A/B/C)
 *  - ban strike counter + exponential cooldown
 *  - state transition log persistence
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
let rateState;

beforeEach(() => {
  db = new Database(':memory:');
  db.exec(SCHEMA_SQL);

  jest.resetModules();
  jest.doMock('../../server/services/database', () => ({ db, get: () => db }));

  rateState = require('../../server/services/binanceRateState');
});

afterEach(() => {
  db.close();
  jest.dontMock('../../server/services/database');
});

describe('binanceRateState.load', () => {
  test('returns default state when DB is empty (fresh install / cold boot)', () => {
    const state = rateState.load();
    expect(state).toEqual({
      banned_until: 0,
      ban_reason: null,
      warm_until: 0,
      used_weight_1m: 0,
      used_weight_ts: null,
      burst_calls_10s: 0,
      burst_window_start: null,
      last_heavy_endpoint_ts: null,
      resume_generation: 1,
      consecutive_ban_count: 0,
      last_ban_at: null,
    });
  });

  test('returns default state when DB query throws (migration not yet applied)', () => {
    // Drop the table to simulate unmigrated DB.
    db.exec(`DROP TABLE binance_rate_state`);
    const state = rateState.load();
    expect(state).toEqual(rateState.DEFAULT_STATE);
  });
});

describe('binanceRateState.save', () => {
  test('persists state and load() returns the persisted values', () => {
    rateState.save({
      banned_until: 1779999999000,
      ban_reason: 'HTTP 418: Way too many requests',
      consecutive_ban_count: 3,
      last_ban_at: 1779999000000,
    });

    const loaded = rateState.load();
    expect(loaded.banned_until).toBe(1779999999000);
    expect(loaded.ban_reason).toBe('HTTP 418: Way too many requests');
    expect(loaded.consecutive_ban_count).toBe(3);
    expect(loaded.last_ban_at).toBe(1779999000000);
  });

  test('partial save updates only specified fields (preserves others)', () => {
    rateState.save({ banned_until: 1779999999000, ban_reason: 'first reason' });
    rateState.save({ consecutive_ban_count: 5 });

    const loaded = rateState.load();
    expect(loaded.banned_until).toBe(1779999999000); // preserved
    expect(loaded.ban_reason).toBe('first reason'); // preserved
    expect(loaded.consecutive_ban_count).toBe(5); // updated
  });

  test('simulated PM2 reload: new module instance sees previously-saved state', () => {
    // First "boot" — save some state
    rateState.save({ banned_until: 1779999999000, resume_generation: 7 });

    // Simulated second "boot" — fresh require but same DB
    jest.resetModules();
    jest.doMock('../../server/services/database', () => ({ db, get: () => db }));
    const rateStateReboot = require('../../server/services/binanceRateState');

    const loaded = rateStateReboot.load();
    expect(loaded.banned_until).toBe(1779999999000);
    expect(loaded.resume_generation).toBe(7);
  });

  test('save always touches updated_at column to current time', () => {
    const before = Date.now();
    rateState.save({ banned_until: 123 });
    const after = Date.now();

    const row = db.prepare(`SELECT updated_at FROM binance_rate_state WHERE scope='global'`).get();
    expect(row.updated_at).toBeGreaterThanOrEqual(before);
    expect(row.updated_at).toBeLessThanOrEqual(after);
  });
});

describe('binanceRateState.computeCurrentMode', () => {
  test('NORMAL when banned_until is in the past and no warm window', () => {
    const mode = rateState.computeCurrentMode({
      banned_until: Date.now() - 60_000,
      warm_until: 0,
    }, Date.now());
    expect(mode).toBe('NORMAL');
  });

  test('SUPPRESSED when banned_until > now', () => {
    const mode = rateState.computeCurrentMode({
      banned_until: Date.now() + 60_000,
      warm_until: 0,
    }, Date.now());
    expect(mode).toBe('SUPPRESSED');
  });

  test('WARM when ban expired but warm window still active', () => {
    const mode = rateState.computeCurrentMode({
      banned_until: Date.now() - 1_000,
      warm_until: Date.now() + 30_000,
    }, Date.now());
    expect(mode).toBe('WARM');
  });

  test('NORMAL when both windows have elapsed', () => {
    const mode = rateState.computeCurrentMode({
      banned_until: Date.now() - 200_000,
      warm_until: Date.now() - 100_000,
    }, Date.now());
    expect(mode).toBe('NORMAL');
  });
});

describe('binanceRateState.computeWarmDuration', () => {
  test('strike 0 → base 2 minutes (no jitter)', () => {
    const d = rateState.computeWarmDuration(0);
    expect(d).toBe(120_000);
  });

  test('strike 1 → 5 minutes (no jitter)', () => {
    const d = rateState.computeWarmDuration(1);
    expect(d).toBe(300_000);
  });

  test('strike 2 → 15 minutes base + up to 15% jitter (anti-pattern-detection)', () => {
    // Test by sampling — jitter should produce values in [base, base*1.15]
    const samples = Array.from({ length: 50 }, () => rateState.computeWarmDuration(2));
    const min = Math.min(...samples);
    const max = Math.max(...samples);
    expect(min).toBeGreaterThanOrEqual(900_000);
    expect(max).toBeLessThanOrEqual(900_000 * 1.15 + 1);
    // Should have variation, not all the same
    const unique = new Set(samples);
    expect(unique.size).toBeGreaterThan(1);
  });

  test('strike >= 3 capped at 30min base with jitter', () => {
    const samples = Array.from({ length: 50 }, () => rateState.computeWarmDuration(5));
    const min = Math.min(...samples);
    const max = Math.max(...samples);
    expect(min).toBeGreaterThanOrEqual(1_800_000);
    expect(max).toBeLessThanOrEqual(1_800_000 * 1.15 + 1);
  });
});

describe('binanceRateState.recordBan', () => {
  test('first ban: sets banned_until, ban_reason, consecutive_ban_count=1, last_ban_at', () => {
    const now = Date.now();
    rateState.recordBan({
      bannedUntil: now + 60_000,
      reason: 'HTTP 418',
      now,
    });

    const s = rateState.load();
    expect(s.banned_until).toBe(now + 60_000);
    expect(s.ban_reason).toBe('HTTP 418');
    expect(s.consecutive_ban_count).toBe(1);
    expect(s.last_ban_at).toBe(now);
  });

  test('subsequent ban within 4h window: increments strike counter', () => {
    const now = Date.now();
    rateState.recordBan({ bannedUntil: now + 60_000, reason: 'b1', now });
    rateState.recordBan({ bannedUntil: now + 120_000, reason: 'b2', now: now + 10_000 });

    expect(rateState.load().consecutive_ban_count).toBe(2);
  });

  test('ban after >4h clean window resets strike counter', () => {
    const now = Date.now();
    rateState.recordBan({ bannedUntil: now + 60_000, reason: 'b1', now });
    expect(rateState.load().consecutive_ban_count).toBe(1);

    // Simulate ban 5 hours later
    const muchLater = now + 5 * 3600 * 1000;
    rateState.recordBan({ bannedUntil: muchLater + 60_000, reason: 'b2', now: muchLater });

    expect(rateState.load().consecutive_ban_count).toBe(1);
  });

  test('never shrinks banned_until (defense against Binance returning earlier deadline)', () => {
    const now = Date.now();
    rateState.recordBan({ bannedUntil: now + 600_000, reason: 'long', now });
    rateState.recordBan({ bannedUntil: now + 60_000, reason: 'short', now: now + 1_000 });

    // banned_until should stay at the longer one
    expect(rateState.load().banned_until).toBe(now + 600_000);
  });
});

describe('binanceRateState.clearBan', () => {
  test('sets banned_until=0 but preserves consecutive_ban_count', () => {
    const now = Date.now();
    rateState.recordBan({ bannedUntil: now + 60_000, reason: 'x', now });
    rateState.clearBan();

    const s = rateState.load();
    expect(s.banned_until).toBe(0);
    expect(s.consecutive_ban_count).toBe(1); // history preserved
  });

  test('bumps resume_generation (invalidates stale timers)', () => {
    const genBefore = rateState.load().resume_generation;
    rateState.clearBan();
    const genAfter = rateState.load().resume_generation;
    expect(genAfter).toBe(genBefore + 1);
  });
});

describe('binanceRateState.classifyEndpoint', () => {
  test('CLASS_A — critical trading endpoints (always allowed, even in warm)', () => {
    expect(rateState.classifyEndpoint('/fapi/v2/balance')).toBe('A');
    expect(rateState.classifyEndpoint('/fapi/v2/positionRisk')).toBe('A');
    expect(rateState.classifyEndpoint('/fapi/v1/order')).toBe('A');
    expect(rateState.classifyEndpoint('/fapi/v1/allOpenOrders')).toBe('A');
  });

  test('CLASS_B — degradable (delayed/queued during warm resume)', () => {
    expect(rateState.classifyEndpoint('/fapi/v1/ticker/24hr')).toBe('B');
    expect(rateState.classifyEndpoint('/fapi/v1/klines')).toBe('B');
    expect(rateState.classifyEndpoint('/fapi/v1/markPriceKlines')).toBe('B');
    expect(rateState.classifyEndpoint('/fapi/v1/openInterest')).toBe('B');
    expect(rateState.classifyEndpoint('/fapi/v1/fundingRate')).toBe('B');
  });

  test('CLASS_C — cheap public (always allowed)', () => {
    expect(rateState.classifyEndpoint('/fapi/v1/depth')).toBe('C');
    expect(rateState.classifyEndpoint('/fapi/v1/ping')).toBe('C');
    expect(rateState.classifyEndpoint('/fapi/v1/time')).toBe('C');
  });

  test('unknown endpoint → default B (safe degradable)', () => {
    expect(rateState.classifyEndpoint('/fapi/v1/some-future-endpoint')).toBe('B');
    expect(rateState.classifyEndpoint('/random/path')).toBe('B');
  });

  test('strips query string before classification', () => {
    expect(rateState.classifyEndpoint('/fapi/v2/balance?timestamp=123')).toBe('A');
    expect(rateState.classifyEndpoint('/fapi/v1/depth?symbol=BTCUSDT&limit=20')).toBe('C');
  });
});

describe('binanceRateState.shouldAllowDuringWarm', () => {
  test('CLASS_A allowed during warm resume (critical)', () => {
    expect(rateState.shouldAllowDuringWarm('A')).toBe(true);
  });

  test('CLASS_B NOT allowed during warm resume (queued/degraded)', () => {
    expect(rateState.shouldAllowDuringWarm('B')).toBe(false);
  });

  test('CLASS_C allowed during warm resume (cheap, low risk)', () => {
    expect(rateState.shouldAllowDuringWarm('C')).toBe(true);
  });
});

describe('binanceRateState.appendTransitionLog', () => {
  test('persists structured transition event to log table', () => {
    rateState.appendTransitionLog({
      from: 'NORMAL',
      to: 'SUPPRESSED',
      reason: 'HTTP 418',
      ts: 1779999999000,
    });

    const rows = db.prepare(`SELECT * FROM binance_rate_state_log ORDER BY id`).all();
    expect(rows.length).toBe(1);
    expect(rows[0].ts).toBe(1779999999000);
    const event = JSON.parse(rows[0].event_json);
    expect(event.from).toBe('NORMAL');
    expect(event.to).toBe('SUPPRESSED');
    expect(event.reason).toBe('HTTP 418');
  });

  test('keeps last 100 entries (prunes older)', () => {
    for (let i = 0; i < 120; i++) {
      rateState.appendTransitionLog({
        from: 'NORMAL',
        to: 'SUPPRESSED',
        reason: `evt-${i}`,
        ts: 1779999999000 + i,
      });
    }
    const count = db.prepare(`SELECT COUNT(*) AS c FROM binance_rate_state_log`).get().c;
    expect(count).toBeLessThanOrEqual(100);

    // Newest entries kept
    const last = db.prepare(`SELECT event_json FROM binance_rate_state_log ORDER BY id DESC LIMIT 1`).get();
    expect(JSON.parse(last.event_json).reason).toBe('evt-119');
  });

  test('does not throw if log table missing (defensive)', () => {
    db.exec(`DROP TABLE binance_rate_state_log`);
    expect(() => {
      rateState.appendTransitionLog({ from: 'A', to: 'B', reason: 'r', ts: 1 });
    }).not.toThrow();
  });
});

describe('binanceRateState.startWarmResume', () => {
  test('sets warm_until based on consecutive_ban_count (strike 0 = 2 min)', () => {
    rateState.save({ consecutive_ban_count: 0 });
    const now = Date.now();
    const result = rateState.startWarmResume({ now });

    expect(result.warm_until).toBeGreaterThanOrEqual(now + 120_000);
    expect(result.warm_until).toBeLessThanOrEqual(now + 120_000 + 1);
  });

  test('strike 2 warm window varies (±15% jitter)', () => {
    rateState.save({ consecutive_ban_count: 2 });
    const durations = [];
    for (let i = 0; i < 30; i++) {
      const r = rateState.startWarmResume({ now: Date.now() });
      durations.push(r.warm_until - Date.now());
    }
    const unique = new Set(durations);
    expect(unique.size).toBeGreaterThan(1); // jittered
  });

  test('bumps resume_generation (stale timers invalidated)', () => {
    const genBefore = rateState.load().resume_generation;
    rateState.startWarmResume({ now: Date.now() });
    const genAfter = rateState.load().resume_generation;
    expect(genAfter).toBe(genBefore + 1);
  });
});

describe('binanceRateState.abortWarmResume', () => {
  test('on 418 during warm: extends ban + clears warm + bumps generation', () => {
    const now = Date.now();
    rateState.save({
      consecutive_ban_count: 1,
      last_ban_at: now - 60_000, // recent ban → strike increment window
      warm_until: now + 60_000,
    });
    const genBefore = rateState.load().resume_generation;

    rateState.abortWarmResume({
      bannedUntil: now + 600_000,
      reason: 'HTTP 418 during warm probe',
      now,
    });

    const s = rateState.load();
    expect(s.banned_until).toBe(now + 600_000);
    // warm should be cleared (set to 0 or <= now)
    expect((s.warm_until || 0) <= now).toBe(true);
    expect(s.resume_generation).toBe(genBefore + 1);
    expect(s.consecutive_ban_count).toBe(2); // strike incremented
  });
});

describe('binanceRateState anti-flap (MIN_STATE_DURATION_MS)', () => {
  test('canTransition true when last transition older than MIN_STATE_DURATION_MS', () => {
    const now = Date.now();
    const ok = rateState.canTransition({
      lastTransitionTs: now - 25_000,
      now,
      isHard418: false,
    });
    expect(ok).toBe(true);
  });

  test('canTransition false when last transition newer than MIN_STATE_DURATION_MS', () => {
    const now = Date.now();
    const ok = rateState.canTransition({
      lastTransitionTs: now - 5_000,
      now,
      isHard418: false,
    });
    expect(ok).toBe(false);
  });

  test('hard 418 always allowed regardless of recent transition', () => {
    const now = Date.now();
    const ok = rateState.canTransition({
      lastTransitionTs: now - 1_000,
      now,
      isHard418: true,
    });
    expect(ok).toBe(true);
  });

  test('MIN_STATE_DURATION_MS constant exposed and = 20000', () => {
    expect(rateState.MIN_STATE_DURATION_MS).toBe(20_000);
  });
});
