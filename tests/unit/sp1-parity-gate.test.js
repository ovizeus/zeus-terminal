const { evaluateParityGate, SP1_THRESHOLDS, soakWindow } = require('../../server/services/parityGate');

function mkReport({ pct, pairs, unpaired }) {
  return { totals: { primaryAgreementPct: pct, primaryPairs: pairs, primaryUnpaired: unpaired } };
}

describe('SP1 evaluateParityGate', () => {
  test('PASS when agreement, pairs, and unpaired-ratio all clear thresholds', () => {
    const r = evaluateParityGate(mkReport({ pct: 99.1, pairs: 800, unpaired: 10 }));
    expect(r.pass).toBe(true);
    expect(r.failures).toEqual([]);
  });

  test('FAIL on insufficient pairs even at 100% agreement (false-high guard)', () => {
    const r = evaluateParityGate(mkReport({ pct: 100, pairs: 3, unpaired: 0 }));
    expect(r.pass).toBe(false);
    expect(r.failures).toContain('paired');
  });

  test('FAIL when unpaired ratio exceeds U', () => {
    const r = evaluateParityGate(mkReport({ pct: 99, pairs: 600, unpaired: 400 }));
    expect(r.pass).toBe(false);
    expect(r.failures).toContain('unpairedRatio');
  });

  test('FAIL when agreement below N', () => {
    const r = evaluateParityGate(mkReport({ pct: 90, pairs: 800, unpaired: 5 }));
    expect(r.pass).toBe(false);
    expect(r.failures).toContain('agreement');
  });

  test('thresholds are the locked SP1 values', () => {
    expect(SP1_THRESHOLDS).toEqual({ N: 98, P: 500, U: 0.05, M: 3 });
  });
});

describe('SP1 soakWindow', () => {
  const DAY = 24 * 3600 * 1000;
  const mkDb = (firstTs) => ({ db: { prepare: () => ({ get: () => ({ firstTs }) }) } });

  test('explicit soakStart used as floor when more recent than M-day rolling', () => {
    const now = 1000 * DAY;
    const soakStart = now - 1 * DAY; // soak started 1 day ago
    const w = soakWindow(mkDb(now - 40 * DAY), 1, now, soakStart);
    expect(w.since).toBe(soakStart); // floor is the explicit soak start, not old server rows
    expect(w.daysElapsed).toBe(1);
  });

  test('window is the M-day rolling start once the soak is older than M days', () => {
    const now = 1000 * DAY;
    const soakStart = now - 10 * DAY; // soak started 10 days ago
    const w = soakWindow(mkDb(null), 1, now, soakStart);
    expect(w.since).toBe(now - SP1_THRESHOLDS.M * DAY); // rolling 3-day window
    expect(w.daysElapsed).toBe(10);
  });

  test('falls back to first server row when no explicit soakStart', () => {
    const now = 1000 * DAY;
    const firstTs = now - 2 * DAY;
    const w = soakWindow(mkDb(firstTs), 1, now, null);
    expect(w.since).toBe(firstTs);
    expect(w.daysElapsed).toBe(2);
  });

  test('no soakStart and no server rows → daysElapsed 0', () => {
    const now = 1000 * DAY;
    const w = soakWindow(mkDb(null), 1, now, null);
    expect(w.daysElapsed).toBe(0);
  });
});
