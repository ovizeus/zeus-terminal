const path = require('path');
const fs = require('fs');

// [2026-10-14] The flaky test and the stray log line had one cause.
//
// A sharded full run produced 1 failure that did not reproduce, plus 34 copies
// of "Cannot log after tests are done". The attempted log was always:
//
//   [WATCHDOG] LIVE_NO_SL watchdog started — interval 30s
//
// serverAT.js starts that watchdog from a BARE setTimeout at module load,
// 15s after require. Any suite that imports serverAT and runs longer than 15s
// trips it, starting a 30s setInterval that nothing ever clears. It then keeps
// firing after teardown — logging into a torn-down jest console, keeping the
// worker alive, and making unrelated tests flaky.
//
// It also sent me down a false trail: I saw that same line in the PRODUCTION
// log at 20:03:43 and treated it as a live 30s alert cycle while hunting the
// Telegram failures. It was my own test run writing into the production log
// (fixed separately in logger.js).
//
// The watchdog itself is money-path safety — it repairs positions left without
// a stop loss — so it must be UNCHANGED in production. The guard only prevents
// it arming under a test runner.

const SRC = fs.readFileSync(
  path.join(__dirname, '..', '..', 'server', 'services', 'serverAT.js'), 'utf8');

describe('the LIVE_NO_SL watchdog does not arm under a test runner', () => {
  // These assertions are written to FAIL if the guard is removed. An earlier
  // version did not: it only checked that the constant appeared somewhere in
  // the block, which stays true when the `if` is neutered, and it read the
  // timer before the 15s delay had elapsed, so it was false either way. Both
  // passed against the unguarded code. Same mistake as the logger test, twice
  // in one evening — hence every one of these is mutation-checked.

  test('the setTimeout is INSIDE the guard, not merely near the constant', () => {
    const block = SRC.slice(SRC.indexOf('// Start watchdog on module load'));
    const head = block.slice(0, block.indexOf('}, 15000);') + 12);
    const guardAt = head.indexOf('if (!_WATCHDOG_UNDER_TEST)');
    const timerAt = head.indexOf('setTimeout(');
    expect(guardAt).toBeGreaterThan(-1);
    expect(timerAt).toBeGreaterThan(guardAt);   // the timer is nested in the guard
  });

  test('the guard is the established one, not a new invention', () => {
    expect(SRC).toMatch(/_WATCHDOG_UNDER_TEST = !!process\.env\.JEST_WORKER_ID/);
  });

  test('no watchdog interval arms even after the 15s delay elapses', () => {
    // The real bug needed 15s of wall clock, which no unit test waits for.
    // Fake timers make the delay observable, so the assertion can fail.
    jest.resetModules();
    jest.useFakeTimers();
    try {
      const serverAT = require('../../server/services/serverAT');
      jest.advanceTimersByTime(20000);
      expect(serverAT._watchdogArmedForTest()).toBe(false);
    } finally {
      jest.useRealTimers();
    }
  });

  test('the watchdog function itself is untouched and still exported', () => {
    // The safety behaviour must not be what we disabled — only its scheduling.
    expect(SRC).toMatch(/function _watchdogLiveNoSL/);
    expect(SRC).toMatch(/LIVE_NO_SL position\(s\) — attempting SL repair/);
  });
});
