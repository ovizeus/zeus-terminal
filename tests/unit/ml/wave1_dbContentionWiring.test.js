'use strict';
const { db } = require('../../../server/services/database');

beforeEach(() => {
  db.prepare("DELETE FROM ml_db_contention_log WHERE user_id = 99").run();
});

afterAll(() => {
  db.prepare("DELETE FROM ml_db_contention_log WHERE user_id = 99").run();
});

describe('Wave 1: dbContentionMonitor wiring', () => {
  test('recordOperation logs slow query to ml_db_contention_log', () => {
    const dcm = require('../../../server/services/ml/R0_substrate/dbContentionMonitor');
    dcm.recordOperation({
      userId: 99, resolvedEnv: 'DEMO',
      operation: 'write', durationMs: 150, lockWaitMs: 60,
    });
    const row = db.prepare('SELECT * FROM ml_db_contention_log WHERE user_id = 99 ORDER BY id DESC LIMIT 1').get();
    expect(row).not.toBeNull();
    expect(row.duration_ms).toBe(150);
    expect(row.lock_wait_ms).toBe(60);
  });

  test('detectContention identifies high contention from ops array', () => {
    const dcm = require('../../../server/services/ml/R0_substrate/dbContentionMonitor');
    const ops = [
      { durationMs: 150, lockWaitMs: 60 },
      { durationMs: 200, lockWaitMs: 80 },
      { durationMs: 50, lockWaitMs: 10 },
    ];
    const result = dcm.detectContention({ recentOps: ops });
    expect(result).toHaveProperty('contentionDetected');
    expect(result).toHaveProperty('severity');
  });

  test('recordOperation with durationMs < 100 still records (module records all)', () => {
    const dcm = require('../../../server/services/ml/R0_substrate/dbContentionMonitor');
    dcm.recordOperation({
      userId: 99, resolvedEnv: 'DEMO',
      operation: 'read', durationMs: 25,
    });
    const row = db.prepare('SELECT * FROM ml_db_contention_log WHERE user_id = 99 AND duration_ms = 25').get();
    expect(row).not.toBeNull();
  });
});
