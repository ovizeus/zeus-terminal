'use strict';
const { _classifyTier } = require('../../server/services/serverBrain');
describe('_classifyTier (SP2 soak floor lowers SMALL bar ONLY)', () => {
  test('no floor → standard 62 SMALL bar', () => {
    expect(_classifyTier(41, 100, null)).toBe('NO_TRADE');
    expect(_classifyTier(62, 60, null)).toBe('SMALL');
  });
  test('soak floor 45 → confidence 45-61 becomes SMALL (testnet soak)', () => {
    expect(_classifyTier(45, 100, 45)).toBe('SMALL');
    expect(_classifyTier(41, 100, 45)).toBe('NO_TRADE'); // below floor
  });
  test('floor never RAISES the bar (floor>=62 ignored, stays 62)', () => {
    expect(_classifyTier(62, 60, 80)).toBe('SMALL');
  });
  test('floor never affects MEDIUM/LARGE tiers', () => {
    expect(_classifyTier(72, 68, 45)).toBe('MEDIUM');
    expect(_classifyTier(82, 75, 45)).toBe('LARGE');
  });
  test('confluence.score gate still applies at SMALL (floor lowers conf bar only, not confScore>=60)', () => {
    expect(_classifyTier(50, 55, 45)).toBe('NO_TRADE'); // confScore 55 < 60
  });
});
