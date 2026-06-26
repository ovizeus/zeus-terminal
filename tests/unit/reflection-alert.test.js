'use strict';
// [S9 2026-06-26] Reflection block alert — pure helpers (message builder + throttle)
// so a reflection block surfaces to the operator (audit + Telegram) without spamming.

const { buildReflectionAlert, shouldAlert, _resetAlertThrottle } = require('../../server/services/serverReflection');

describe('reflection alert (pure)', () => {
  beforeEach(() => _resetAlertThrottle());

  test('buildReflectionAlert summarizes the block', () => {
    const msg = buildReflectionAlert('BTCUSDT', 'LONG', [{ type: 'losing_streak' }, { type: 'dangerous_regime' }]);
    expect(msg).toContain('BTCUSDT');
    expect(msg).toContain('LONG');
    expect(msg).toContain('losing_streak');
    expect(msg).toContain('dangerous_regime');
  });

  test('buildReflectionAlert handles empty concerns gracefully', () => {
    const msg = buildReflectionAlert('ETHUSDT', 'SHORT', []);
    expect(msg).toContain('ETHUSDT');
    expect(typeof msg).toBe('string');
  });

  test('shouldAlert throttles repeat keys within the 10min window', () => {
    expect(shouldAlert('1:BTCUSDT:LONG', 1000)).toBe(true);                 // first → alert
    expect(shouldAlert('1:BTCUSDT:LONG', 1000 + 60000)).toBe(false);        // 1min later → throttled
    expect(shouldAlert('1:BTCUSDT:LONG', 1000 + 11 * 60000)).toBe(true);    // >10min → alert again
    expect(shouldAlert('1:ETHUSDT:SHORT', 1000)).toBe(true);                // different key → alert
  });
});
