const serverAT = require('../../server/services/serverAT');
const isExplicit = serverAT.__dslfix.isExplicitUserControl;

const NOW = 1_000_000_000_000;
const MIN30 = 30 * 60 * 1000;

describe('[DSL-FIX] _isExplicitUserControl — only EXPLICIT take-control is skipped', () => {
  test('born-manual position (controlMode=user, no _controlModeTs) → NOT skipped (server manages DSL)', () => {
    expect(isExplicit({ controlMode: 'user' }, NOW)).toBe(false);
  });

  test('explicit take-control within 30min → skipped', () => {
    expect(isExplicit({ controlMode: 'user', _controlModeTs: NOW - 60_000 }, NOW)).toBe(true);
  });

  test('explicit take-control older than 30min → NOT skipped (will revert + manage)', () => {
    expect(isExplicit({ controlMode: 'user', _controlModeTs: NOW - (MIN30 + 1) }, NOW)).toBe(false);
  });

  test('auto position → NOT skipped', () => {
    expect(isExplicit({ controlMode: 'auto', _controlModeTs: NOW }, NOW)).toBe(false);
  });

  test('exactly at 30min boundary → still skipped (<=)', () => {
    expect(isExplicit({ controlMode: 'user', _controlModeTs: NOW - MIN30 }, NOW)).toBe(true);
  });
});
