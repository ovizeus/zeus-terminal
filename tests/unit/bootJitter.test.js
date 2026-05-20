'use strict';

const { bootJitter } = require('../../server/utils/bootJitter');

describe('bootJitter', () => {
  test('returns a number in [0, maxMs)', () => {
    const out = bootJitter('marketFeed', 25_000);
    expect(typeof out).toBe('number');
    expect(out).toBeGreaterThanOrEqual(0);
    expect(out).toBeLessThan(25_000);
  });

  test('deterministic — same key returns same value', () => {
    const a = bootJitter('marketRadar.oi', 25_000);
    const b = bootJitter('marketRadar.oi', 25_000);
    expect(a).toBe(b);
  });

  test('different keys spread the values (no collision for common subsystem names)', () => {
    const keys = ['marketFeed', 'marketRadar.oi', 'marketRadar.ticker24h', 'serverLiquidity', 'serverSentiment'];
    const values = keys.map(k => bootJitter(k, 25_000));
    const unique = new Set(values);
    expect(unique.size).toBe(keys.length); // all distinct
  });

  test('respects maxMs upper bound (no overflow)', () => {
    for (let i = 0; i < 50; i++) {
      const v = bootJitter(`subsystem-${i}`, 10_000);
      expect(v).toBeLessThan(10_000);
    }
  });

  test('default maxMs = 25_000 if not provided', () => {
    const v = bootJitter('default-test');
    expect(v).toBeLessThan(25_000);
    expect(v).toBeGreaterThanOrEqual(0);
  });
});
