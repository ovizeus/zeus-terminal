const fs = require('fs');
const path = require('path');

// [2026-10-14] The test suite was writing into the PRODUCTION log.
//
// While hunting the Telegram failures I found rows in data/logs/zeus.log that
// could only come from tests — BADCOIN, seq=1, "SL cancel fail" — timestamped
// inside the window of a full suite run (20:03:36). The logger opens
// data/logs/zeus.log unconditionally, so every suite that touches a module
// which logs appends to the live file.
//
// Appending is the mild half. The destructive half is rotation: _rotate() runs
// on a 60s interval, RENAMES the live log once it passes 5MB, and then deletes
// every rotated file beyond the newest three. A long test run could therefore
// rotate and prune the operator's production logs — the exact evidence used to
// diagnose incidents.
//
// The database was never touched (verified: the newest emergency_close_queue
// rows are from 2026-08-18, all resolved), so this was log damage only. But
// logs that cannot be trusted during a test run are logs that cannot be trusted
// when it matters, and the same file is what the crash watchdog reads.
//
// migrationFlags.js already solves this exact problem for its own state file
// ("Tests must never touch it"), so the pattern is the established one here.

describe('the logger never touches production files under test', () => {
  const logger = require('../../server/services/logger');

  test('it is running under a test runner (guard for this suite itself)', () => {
    expect(!!process.env.JEST_WORKER_ID || process.env.NODE_ENV === 'test').toBe(true);
  });

  // Checks CONTENT, not size. A write stream is buffered, so comparing
  // statSync() before and after can pass while the write is still in flight —
  // the first version of this test did exactly that and passed before the fix
  // existed. A unique marker cannot pass vacuously.
  // ASYNC on purpose. A write stream is buffered, so reading the file in the
  // same tick can pass while the write is still in flight — the first two
  // versions of this test did exactly that and passed even with the guard
  // removed. Waiting lets a real write land, so the assertion can fail.
  test('writing a line does NOT reach data/logs/zeus.log', async () => {
    const f = logger.LOG_FILE;
    const marker = 'LOGGER_GUARD_' + Date.now() + '_' + Math.random().toString(36).slice(2);
    logger.info('TEST_GUARD', marker);
    logger.error('TEST_GUARD', marker);
    await new Promise((r) => setTimeout(r, 250));
    const body = fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : '';
    expect(body).not.toContain(marker);
  });

  test('the production log is not created if it is absent', () => {
    // The stream is opened lazily; under test it must never be opened at all.
    expect(logger._isUnderTest).toBe(true);
    expect(logger._getStreamForTest()).toBeNull();
  });

  test('rotation is a no-op under test — it must never rename or prune', () => {
    const dir = logger.LOG_DIR;
    const before = fs.existsSync(dir) ? fs.readdirSync(dir).sort() : [];
    logger._rotateForTest();
    const after = fs.existsSync(dir) ? fs.readdirSync(dir).sort() : [];
    expect(after).toEqual(before);
  });

  test('console output still works, so tests asserting on it are unaffected', () => {
    const spy = jest.spyOn(console, 'log').mockImplementation(() => {});
    logger.info('TEST_GUARD', 'visible on stdout');
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});
