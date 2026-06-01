const serverAT = require('../../server/services/serverAT');
const breached = serverAT.__dslfix.isSLBreached;

describe('[DSL-FIX2] _isSLBreached — guard against null/0 effectiveSL (no false HIT_SL)', () => {
  test('SHORT with null effectiveSL → NOT breached (was the bug: price>=null→price>=0→true)', () => {
    expect(breached('SHORT', 71545, null)).toBe(false);
  });

  test('SHORT with 0 effectiveSL → NOT breached', () => {
    expect(breached('SHORT', 71545, 0)).toBe(false);
  });

  test('LONG with null effectiveSL → NOT breached', () => {
    expect(breached('LONG', 71545, null)).toBe(false);
  });

  test('SHORT breached when price rises to/above a valid SL', () => {
    expect(breached('SHORT', 71800, 71734)).toBe(true);
    expect(breached('SHORT', 71700, 71734)).toBe(false);
  });

  test('LONG breached when price falls to/below a valid SL', () => {
    expect(breached('LONG', 71200, 71226)).toBe(true);
    expect(breached('LONG', 71300, 71226)).toBe(false);
  });

  test('NaN/undefined effectiveSL → NOT breached', () => {
    expect(breached('SHORT', 71545, undefined)).toBe(false);
    expect(breached('SHORT', 71545, NaN)).toBe(false);
  });
});
