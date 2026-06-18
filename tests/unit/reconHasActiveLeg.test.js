const { hasActiveLeg } = require('../../server/services/reconHelpers');

const P = (userId, symbol, side, mode = 'live', extra = {}) => ({ userId, symbol, side, mode, ...extra });

describe('reconHelpers.hasActiveLeg (DEDUP-GUARD stage 1)', () => {
  test('canonical LIVE leg present → true (do not adopt duplicate)', () => {
    const pos = [P(1, 'BTCUSDT', 'SHORT', 'live', { live: { status: 'LIVE' } })];
    expect(hasActiveLeg(pos, 1, 'BTCUSDT', 'SHORT')).toBe(true);
  });

  test('only a dual-write STUB present (no live.status) → still true (leg is represented)', () => {
    const pos = [P(1, 'BTCUSDT', 'SHORT', 'live', { live: undefined, source: 'serverAT' })];
    expect(hasActiveLeg(pos, 1, 'BTCUSDT', 'SHORT')).toBe(true);
  });

  test('no record for the key → false (genuine orphan, adopt)', () => {
    const pos = [P(1, 'ETHUSDT', 'LONG'), P(1, 'BTCUSDT', 'LONG')];
    expect(hasActiveLeg(pos, 1, 'BTCUSDT', 'SHORT')).toBe(false);
  });

  test('opposite side does not count (LONG present, SHORT asked)', () => {
    const pos = [P(1, 'BTCUSDT', 'LONG', 'live', { live: { status: 'LIVE' } })];
    expect(hasActiveLeg(pos, 1, 'BTCUSDT', 'SHORT')).toBe(false);
  });

  test('demo-mode record is ignored (never maps to live exchange)', () => {
    const pos = [P(1, 'BTCUSDT', 'SHORT', 'demo', { live: { status: 'LIVE' } })];
    expect(hasActiveLeg(pos, 1, 'BTCUSDT', 'SHORT')).toBe(false);
  });

  test('different user does not count', () => {
    const pos = [P(2, 'BTCUSDT', 'SHORT', 'live', { live: { status: 'LIVE' } })];
    expect(hasActiveLeg(pos, 1, 'BTCUSDT', 'SHORT')).toBe(false);
  });

  test('testnet-tagged dual-write row counts (same one-way exchange leg)', () => {
    const pos = [P(1, 'BNBUSDT', 'SHORT', 'testnet', { source: 'serverAT' })];
    expect(hasActiveLeg(pos, 1, 'BNBUSDT', 'SHORT')).toBe(true);
  });

  test('defensive: non-array → false', () => {
    expect(hasActiveLeg(null, 1, 'BTCUSDT', 'SHORT')).toBe(false);
    expect(hasActiveLeg(undefined, 1, 'BTCUSDT', 'SHORT')).toBe(false);
  });
});
