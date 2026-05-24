'use strict';
const { db } = require('../../../server/services/database');

beforeEach(() => {
  db.prepare('DELETE FROM ml_pit_snapshots WHERE user_id = 99').run();
});

afterAll(() => {
  db.prepare('DELETE FROM ml_pit_snapshots WHERE user_id = 99').run();
});

describe('Wave 1: pointInTimeStore wiring via brainLogger', () => {
  test('recordSnapshot stores decision snapshot with market state', () => {
    const pit = require('../../../server/services/ml/R0_substrate/pointInTimeStore');
    const result = pit.recordSnapshot({
      userId: 99,
      resolvedEnv: 'DEMO',
      snapshotType: 'decision',
      ts: Date.now(),
      marketState: { symbol: 'BTCUSDT', price: 67000, regime: 'TREND' },
      modelOutput: { score: 72, dir: 'bull', tier: 'MEDIUM' },
      scores: { regime: 0.8, alignment: 0.7 },
    });
    expect(result).toBeDefined();

    const row = db.prepare('SELECT * FROM ml_pit_snapshots WHERE user_id = 99 ORDER BY id DESC LIMIT 1').get();
    expect(row).not.toBeNull();
    expect(row.snapshot_type).toBe('decision');
    expect(JSON.parse(row.market_state_json).symbol).toBe('BTCUSDT');
  });

  test('getStateAt retrieves latest snapshot at or before timestamp', () => {
    const pit = require('../../../server/services/ml/R0_substrate/pointInTimeStore');
    const ts = Date.now() - 5000;
    pit.recordSnapshot({
      userId: 99, resolvedEnv: 'DEMO', snapshotType: 'decision', ts,
      marketState: { price: 65000 },
    });
    const result = pit.getStateAt({ userId: 99, resolvedEnv: 'DEMO', ts: Date.now() });
    expect(result).not.toBeNull();
    // getStateAt returns { found, ts, snapshot } — snapshot has parsed fields
    const row = db.prepare('SELECT * FROM ml_pit_snapshots WHERE user_id = 99 ORDER BY id DESC LIMIT 1').get();
    expect(row).not.toBeNull();
    expect(JSON.parse(row.market_state_json).price).toBe(65000);
  });

  test('countSnapshots returns correct count', () => {
    const pit = require('../../../server/services/ml/R0_substrate/pointInTimeStore');
    pit.recordSnapshot({ userId: 99, resolvedEnv: 'DEMO', snapshotType: 'decision', ts: Date.now(), marketState: { a: 1 } });
    pit.recordSnapshot({ userId: 99, resolvedEnv: 'DEMO', snapshotType: 'decision', ts: Date.now(), marketState: { a: 2 } });
    const count = pit.countSnapshots({ userId: 99, resolvedEnv: 'DEMO' });
    expect(count).toBe(2);
  });
});
