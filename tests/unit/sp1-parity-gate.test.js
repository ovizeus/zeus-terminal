const { evaluateParityGate, SP1_THRESHOLDS, soakWindow } = require('../../server/services/parityGate');

// Gate judges ACTIONABLE agreement (cycles where ≥1 side trades), with an
// actionable-cycle floor (A) + overall pairing-integrity floors (P, U).
function mkReport({ actPct, actPairs, pairs, unpaired }) {
  return { totals: {
    primaryActionableAgreementPct: actPct,
    primaryActionablePairs: actPairs,
    primaryPairs: pairs,
    primaryUnpaired: unpaired,
  } };
}

describe('SP1 evaluateParityGate', () => {
  test('PASS when actionable agreement, actionable floor, pairs, and unpaired all clear', () => {
    const r = evaluateParityGate(mkReport({ actPct: 99.1, actPairs: 80, pairs: 800, unpaired: 10 }));
    expect(r.pass).toBe(true);
    expect(r.failures).toEqual([]);
  });

  test('FAIL on too few actionable cycles even at 100% actionable agreement', () => {
    const r = evaluateParityGate(mkReport({ actPct: 100, actPairs: 5, pairs: 800, unpaired: 10 }));
    expect(r.pass).toBe(false);
    expect(r.failures).toContain('actionable');
  });

  test('FAIL when actionable agreement below N (real-trade disagreement)', () => {
    const r = evaluateParityGate(mkReport({ actPct: 80, actPairs: 100, pairs: 800, unpaired: 10 }));
    expect(r.pass).toBe(false);
    expect(r.failures).toContain('agreement');
  });

  test('FAIL on insufficient overall pairs (sample sufficiency)', () => {
    const r = evaluateParityGate(mkReport({ actPct: 100, actPairs: 60, pairs: 100, unpaired: 0 }));
    expect(r.pass).toBe(false);
    expect(r.failures).toContain('paired');
  });

  test('FAIL when unpaired ratio exceeds U', () => {
    const r = evaluateParityGate(mkReport({ actPct: 100, actPairs: 60, pairs: 600, unpaired: 400 }));
    expect(r.pass).toBe(false);
    expect(r.failures).toContain('unpairedRatio');
  });

  test('agreement fails when no actionable cycles yet (null pct)', () => {
    const r = evaluateParityGate(mkReport({ actPct: null, actPairs: 0, pairs: 800, unpaired: 5 }));
    expect(r.pass).toBe(false);
    expect(r.failures).toContain('agreement');
    expect(r.failures).toContain('actionable');
  });

  test('thresholds are the locked SP1 values', () => {
    expect(SP1_THRESHOLDS).toEqual({ N: 98, P: 500, U: 0.05, M: 3, A: 50 });
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
