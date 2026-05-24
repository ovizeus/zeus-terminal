'use strict';
describe('A-Z Raid L: voiceLatencyGuard', () => {
  test('withLatencyCap passes fast function', async () => {
    const lg = require('../../../server/services/ml/_voice/voiceLatencyGuard');
    const result = await lg.withLatencyCap(() => 'fast', 100);
    expect(result).toBe('fast');
  });
  test('withLatencyCap abandons slow function', async () => {
    const lg = require('../../../server/services/ml/_voice/voiceLatencyGuard');
    const result = await lg.withLatencyCap(() => new Promise(r => setTimeout(() => r('slow'), 300)), 50);
    expect(result).toBeNull();
  });
  test('getAbandonStats returns counts', () => {
    const lg = require('../../../server/services/ml/_voice/voiceLatencyGuard');
    const stats = lg.getAbandonStats();
    expect(stats).toHaveProperty('totalAbandons');
    expect(stats).toHaveProperty('abandonsLastMinute');
  });
});
