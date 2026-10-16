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
