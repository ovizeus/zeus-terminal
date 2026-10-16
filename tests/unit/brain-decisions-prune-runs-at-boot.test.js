const fs = require('fs');
const path = require('path');

// [2026-10-16] A daily maintenance task that a daily restart cancels.
//
// brain_decisions is the largest object in the database by far: 1372.9 MB of a
// 2.8 GB file, plus ~70 MB of indexes, 791,963 rows over 155 days. Its
// retention is tiered and sensible — NO_TRADE 30 days, blocked_* 90, entry 365
// — and db.bdPrune() implements exactly that.
//
// But it was scheduled as:
//
//     setInterval(() => brainLogger.prune(), 86400000);
//
// with no run at startup, unlike the parity prune ten lines away which fires
// 120s after boot. So the prune only happens if the process survives a full 24
// hours, and every reload or crash restarts the countdown. During the
// 1082-restart outage it would never have run at all.
//
// The residue is measurable, not theoretical: 6,684 NO_TRADE rows older than
// 30 days and 6,618 blocked_* rows older than 90 — all matching the delete
// criteria, all still there.
//
// The fix is to mirror the pattern already used in this file for the parity
// prune: one run shortly after boot, then the daily interval. Not sooner than
// that — boot is busy and this is maintenance, not safety.

const SRC = fs.readFileSync(
  path.join(__dirname, '..', '..', 'server', 'services', 'serverBrain.js'), 'utf8');

describe('the brain_decisions prune is not cancelled by a restart', () => {
  // NOTE: the first version of these two asserted that setTimeout/setInterval
  // appeared within 500 characters of brainLogger.prune(). They PASSED against
  // the unfixed code, because the parity prune sits ten lines away and supplied
  // both. Proximity is not wiring. Named-symbol assertions cannot pass by
  // accident.
  test('there is a boot run, not only a 24h interval', () => {
    expect(SRC).toMatch(/setTimeout\(_runBrainDecisionsPrune,\s*\d+\)/);
  });

  test('the daily interval is still there — the boot run does not replace it', () => {
    expect(SRC).toMatch(/setInterval\(_runBrainDecisionsPrune,\s*86400000\)/);
  });

  test('the boot run is delayed, not immediate — boot is busy', () => {
    const i = SRC.indexOf('_runBrainDecisionsPrune');
    expect(i).toBeGreaterThan(-1);
    const block = SRC.slice(i, i + 900);
    const m = block.match(/setTimeout\(_runBrainDecisionsPrune,\s*(\d+)\)/);
    expect(m).not.toBeNull();
    expect(Number(m[1])).toBeGreaterThanOrEqual(60000);
  });

  test('it mirrors the parity prune pattern in the same file', () => {
    // The parity prune already does boot-run + interval; this one should not
    // invent a different shape.
    expect(SRC).toMatch(/setTimeout\(_runParityPrune,\s*\d+\)/);
    expect(SRC).toMatch(/setInterval\(_runParityPrune,\s*\d+\)/);
  });

  test('the file was really read (guard against a vacuous pass)', () => {
    expect(SRC.length).toBeGreaterThan(20000);
  });
});
