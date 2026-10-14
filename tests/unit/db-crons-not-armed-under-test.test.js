const fs = require('fs');
const path = require('path');

// [2026-10-14] database.js arms FIVE background crons from bare module-load
// timers — daily backup (30s), audit retention (60s), restore probe (90s),
// restart-count check (2min) and anomaly detector (2.5min), each followed by a
// recurring interval. None were gated, so any suite that imports database.js
// and runs past those delays starts them.
//
// Two consequences, the second much worse than the first:
//
//   1. Timer leak. This is the remaining 13 "Cannot log after tests are done"
//      in a sharded run, with "[DB] Backup created: /tmp/r7-tracer-*/db_backups"
//      as the attempted log — real database copies written into test temp dirs.
//
//   2. EVERY ONE of these five can send Telegram. A long test run could put
//      genuine-looking production alerts on the operator's phone — a restart
//      spike, a trading anomaly, a failed backup — none of them real.
//
// The crons themselves are untouched: this gates only their SCHEDULING, and
// only under a test runner, the same way migrationFlags.js, logger.js and the
// serverAT watchdog now do.

const SRC = fs.readFileSync(
  path.join(__dirname, '..', '..', 'server', 'services', 'database.js'), 'utf8');

const CRONS = [
  '_runDailyBackup',
  '_runAuditLogRetention',
  '_runRestoreProbe',
  '_runRestartCountCheck',
  '_runAnomalyDetector',
];

describe('database background crons do not arm under a test runner', () => {
  test('the test guard exists and is the established one', () => {
    expect(SRC).toMatch(/_UNDER_TEST\s*=\s*!!process\.env\.JEST_WORKER_ID/);
  });

  test.each(CRONS)('%s is scheduled inside the guard, not at bare module scope', (name) => {
    // Every scheduling call for this cron must sit on a guarded line, i.e. the
    // bare `setTimeout(_runX, N);` / `setInterval(_runX, N);` form must be gone.
    const bare = new RegExp('^\\s*set(?:Timeout|Interval)\\(' + name + ',', 'm');
    expect(SRC).not.toMatch(bare);
  });

  test('all five are still scheduled for production — we gated them, not deleted them', () => {
    for (const name of CRONS) {
      expect(SRC).toMatch(new RegExp('set(?:Timeout|Interval)\\(' + name + ','));
    }
  });

  test('the cron bodies are untouched — each can still alert in production', () => {
    for (const name of CRONS) {
      expect(SRC).toMatch(new RegExp('function ' + name));
    }
  });
});
