'use strict';
const { db } = require('../../../server/services/database');

beforeEach(() => {
  db.prepare('DELETE FROM ml_heartbeat_state').run();
});

afterAll(() => {
  db.prepare('DELETE FROM ml_heartbeat_state').run();
});

describe('Wave 1: deadMansSwitch brain wiring', () => {
  test('emitHeartbeat writes row to ml_heartbeat_state after brain cycle', () => {
    const dms = require('../../../server/services/ml/R0_substrate/deadMansSwitch');
    dms.emitHeartbeat({ userId: 1, resolvedEnv: 'DEMO' });
    const row = db.prepare('SELECT * FROM ml_heartbeat_state WHERE user_id = 1 AND resolved_env = ?').get('DEMO');
    expect(row).not.toBeNull();
    expect(row.last_heartbeat_ts).toBeGreaterThan(0);
    expect(row.status).toBe('HEALTHY');
  });

  test('checkHeartbeatStaleness returns HEALTHY when recent heartbeat', () => {
    const dms = require('../../../server/services/ml/R0_substrate/deadMansSwitch');
    dms.emitHeartbeat({ userId: 1, resolvedEnv: 'DEMO' });
    const result = dms.checkHeartbeatStaleness({ userId: 1, resolvedEnv: 'DEMO' });
    expect(result.status).toBe('HEALTHY');
    expect(result.stale).toBe(undefined);
  });

  test('checkHeartbeatStaleness returns STALE after threshold', () => {
    const dms = require('../../../server/services/ml/R0_substrate/deadMansSwitch');
    dms.configureThresholds({ userId: 1, resolvedEnv: 'DEMO', expectedIntervalMs: 50, stalenessMs: 100, deadMs: 500 });
    dms.emitHeartbeat({ userId: 1, resolvedEnv: 'DEMO', ts: Date.now() - 200 });
    const result = dms.checkHeartbeatStaleness({ userId: 1, resolvedEnv: 'DEMO' });
    expect(result.status).toBe('STALE');
    expect(result.stale).toBe(undefined);
  });
});
