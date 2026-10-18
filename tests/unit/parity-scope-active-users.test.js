const path = require('path');

// [2026-10-16] The server was writing parity rows 56x faster than they could
// ever be used.
//
// Measured, not guessed: the server emits for ALL symbols x ALL users every
// 30s — 8 users x 7 symbols = 161,280 rows a day, 304,136 in 48h — while the
// client emits PRIMARY only for ONE user's chart symbol. So 1 of 56
// combinations can pair. The other 98.2% cannot pair BY CONSTRUCTION, not for
// lack of activity: a user whose browser is closed produces no client row, so
// a server row for them has nothing to meet.
//
// My own estimate two days ago was "6 of 8 users are waste" — too kind, and
// wrong about the shape. The waste is per user AND per symbol.
//
// The fix narrows the server side to users who have actually produced a client
// parity row recently. It is self-correcting: open the app, client rows start,
// and within the staleness window server rows follow. The only cost is a short
// warm-up gap, which cannot lose a pair that would otherwise have formed —
// during that gap the client row has no server counterpart either way.
//
// Deliberately NOT narrowed by symbol: the server does not know which symbol
// the user has on screen, and guessing would silently drop the one pair that
// matters.

describe('parity is emitted only for users who can actually pair', () => {
  let brain;
  beforeEach(() => {
    jest.resetModules();
    brain = require('../../server/services/serverBrain');
  });

  test('a user with a recent client row IS a target', () => {
    brain.__sp1.setActiveParityUsersForTest(new Set([1]));
    expect(brain.__sp1.hasRecentClientParity(1)).toBe(true);
  });

  test('a user with no client row is NOT — their rows could never pair', () => {
    brain.__sp1.setActiveParityUsersForTest(new Set([1]));
    expect(brain.__sp1.hasRecentClientParity(2)).toBe(false);
  });

  test('an EMPTY active set means nobody — not everybody', () => {
    // The dangerous failure mode is inverting this: an empty set must not be
    // read as "no filter, emit for all", which would restore the 56x waste
    // silently.
    brain.__sp1.setActiveParityUsersForTest(new Set());
    expect(brain.__sp1.hasRecentClientParity(1)).toBe(false);
  });

  test('before the first refresh it is PERMISSIVE — a cold start must not lose pairs', () => {
    // null means "not yet known". Emitting during that window is the safe
    // direction: at worst a few extra rows, versus silently dropping the pair
    // that matters right after a restart.
    brain.__sp1.setActiveParityUsersForTest(null);
    expect(brain.__sp1.hasRecentClientParity(1)).toBe(true);
  });

  test('never throws on a malformed user id', () => {
    brain.__sp1.setActiveParityUsersForTest(new Set([1]));
    expect(() => brain.__sp1.hasRecentClientParity(undefined)).not.toThrow();
    expect(() => brain.__sp1.hasRecentClientParity(null)).not.toThrow();
  });

  test('the shadow target composes BOTH conditions', () => {
    // Being a demo user is not enough any more; the user must also be able to
    // pair. Asserted on the source so the composition cannot be dropped while
    // the helper stays behind, unused — tonight's recurring bug shape.
    const src = require('fs').readFileSync(
      path.join(__dirname, '..', '..', 'server', 'services', 'serverBrain.js'), 'utf8');
    const i = src.indexOf('function _isShadowParityTarget');
    const body = src.slice(i, src.indexOf('\n}', i));
    expect(body).toMatch(/_hasRecentClientParity\(/);
  });
});

// Wiring: a filter nothing refreshes is a filter that never narrows. That is
// the shape of bug this file exists because of.
describe('the active-user filter is actually refreshed and queried', () => {
  const fs = require('fs');
  const brainSrc = fs.readFileSync(
    path.join(__dirname, '..', '..', 'server', 'services', 'serverBrain.js'), 'utf8');
  const dbSrc = fs.readFileSync(
    path.join(__dirname, '..', '..', 'server', 'services', 'database.js'), 'utf8');

  test('the shadow loop refreshes the set before filtering', () => {
    const i = brainSrc.indexOf('function _runShadowForUsers');
    const head = brainSrc.slice(i, i + 700);
    expect(head).toMatch(/_refreshActiveParityUsers\(/);
  });

  test('the database exposes the lookup it depends on', () => {
    expect(dbSrc).toMatch(/function getRecentClientParityUserIds/);
    expect(dbSrc).toMatch(/^\s+getRecentClientParityUserIds,/m);   // exported
  });

  test('the lookup asks for CLIENT rows only', () => {
    const i = dbSrc.indexOf('function getRecentClientParityUserIds');
    const body = dbSrc.slice(i, i + 800);
    expect(body).toMatch(/source = 'client'/);
    expect(body).toMatch(/created_at >= \?/);
  });

  test('a failed lookup returns null, so the caller stays permissive', () => {
    const i = dbSrc.indexOf('function getRecentClientParityUserIds');
    const body = dbSrc.slice(i, i + 800);
    expect(body).toMatch(/return null/);
  });
});

// [2026-10-18] Eliminating the warm-up gap, which I predicted and then measured.
//
// When the server narrowed its parity emission to users with a recent client
// row, I wrote that it would "self-correct within ~5 minutes" because the
// active-user set refreshes on that cadence. Observed live during his first
// session after the change: of eleven PRIMARY rows, exactly one was unpaired —
// the FIRST, at 23:24:00. Every row after it paired.
//
// That one row is not free. unpairedRatio is a gate threshold (<= 5%), and a
// short session makes a single warm-up row a large fraction of it: this sample
// came out at 9%.
//
// The client row itself is the signal that the user is back, so it can
// invalidate the cache directly and the very next cycle picks them up. No
// polling, no shorter interval, no extra query — the event that proves
// activity is the one that clears the staleness.

describe('a returning user is picked up on the next cycle, not in five minutes', () => {
  let brain;
  beforeEach(() => {
    jest.resetModules();
    brain = require('../../server/services/serverBrain');
  });

  test('noteClientParityActivity forces the next refresh to re-query', () => {
    brain.__sp1.setActiveParityUsersForTest(new Set([99]));
    expect(brain.__sp1.hasRecentClientParity(1)).toBe(false);
    brain.noteClientParityActivity(1);
    // the set is now considered stale; the next refresh must not be skipped
    expect(brain.__sp1.isActiveParityStale()).toBe(true);
  });

  test('it never throws on a malformed id', () => {
    expect(() => brain.noteClientParityActivity(undefined)).not.toThrow();
    expect(() => brain.noteClientParityActivity(null)).not.toThrow();
  });

  test('the parity route calls it when a client row arrives', () => {
    const src = require('fs').readFileSync(
      require('path').join(__dirname, '..', '..', 'server', 'routes', 'brainParity.js'), 'utf8');
    const i = src.indexOf('logParityRow');
    const around = src.slice(i, src.indexOf('});', i));
    expect(around).toMatch(/noteClientParityActivity\(/);
  });
});
