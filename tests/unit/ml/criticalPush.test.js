'use strict';
describe('A-Z Raid N: criticalPush', () => {
  test('pushCritical returns sent result', () => {
    const cp = require('../../../server/services/ml/_voice/criticalPush');
    cp._resetForTest();
    const result = cp.pushCritical({ userId: 1, eventType: 'DD_LOCKOUT', severity: 'P0', message: 'Drawdown limit reached' });
    expect(result).toHaveProperty('deduplicated');
    expect(result.deduplicated).toBe(false);
  });
  test('pushCritical deduplicates within 5min', () => {
    const cp = require('../../../server/services/ml/_voice/criticalPush');
    cp._resetForTest();
    cp.pushCritical({ userId: 1, eventType: 'DD_LOCKOUT', severity: 'P0', message: 'first' });
    const result = cp.pushCritical({ userId: 1, eventType: 'DD_LOCKOUT', severity: 'P0', message: 'second' });
    expect(result.deduplicated).toBe(true);
  });
  test('pushCritical allows different event types', () => {
    const cp = require('../../../server/services/ml/_voice/criticalPush');
    cp._resetForTest();
    cp.pushCritical({ userId: 1, eventType: 'DD_LOCKOUT', severity: 'P0', message: 'dd' });
    const result = cp.pushCritical({ userId: 1, eventType: 'BLACK_SWAN', severity: 'P0', message: 'swan' });
    expect(result.deduplicated).toBe(false);
  });
});
