'use strict';
const { resolveOwnership } = require('../../server/services/ownership');
const base = { clientPresent: true, atActive: true, credsValid: true, cutoverActive: true, underTakeControl: false };
const ctx = (o) => Object.assign({}, base, o);

describe('resolveOwnership — entries (exclusive, fail-closed)', () => {
  test('client present → entryOwner CLIENT', () => {
    expect(resolveOwnership(ctx({})).entryOwner).toBe('CLIENT');
  });
  test('client absent + cutover + AT + creds → entryOwner SERVER', () => {
    expect(resolveOwnership(ctx({ clientPresent: false })).entryOwner).toBe('SERVER');
  });
  test('client absent but cutover OFF → CLIENT', () => {
    expect(resolveOwnership(ctx({ clientPresent: false, cutoverActive: false })).entryOwner).toBe('CLIENT');
  });
  test('client absent but AT off → CLIENT', () => {
    expect(resolveOwnership(ctx({ clientPresent: false, atActive: false })).entryOwner).toBe('CLIENT');
  });
  test('client absent but creds invalid → CLIENT', () => {
    expect(resolveOwnership(ctx({ clientPresent: false, credsValid: false })).entryOwner).toBe('CLIENT');
  });
});

describe('resolveOwnership — exits (always-on net + hard backstop)', () => {
  test('normal → activeManager SERVER, disasterBackstop SERVER', () => {
    const o = resolveOwnership(ctx({})).exitOwner;
    expect(o.activeManager).toBe('SERVER');
    expect(o.disasterBackstop).toBe('SERVER');
  });
  test('under take-control → activeManager USER, disasterBackstop STILL SERVER', () => {
    const o = resolveOwnership(ctx({ underTakeControl: true })).exitOwner;
    expect(o.activeManager).toBe('USER');
    expect(o.disasterBackstop).toBe('SERVER');
  });
  test('disasterBackstop is SERVER in EVERY state', () => {
    for (const cp of [true, false]) for (const tc of [true, false]) for (const co of [true, false]) {
      expect(resolveOwnership(ctx({ clientPresent: cp, underTakeControl: tc, cutoverActive: co })).exitOwner.disasterBackstop).toBe('SERVER');
    }
  });
});

// ─── [SP2-b 2026-06-07] FULL server ownership — operator directive:
// "brain AT să ruleze server-side, clientul să nu mai comande nimic".
// fullServerOwnership=true → SERVER owns entries even with client PRESENT.
// All other prerequisites stay mandatory (fail-closed).
describe('resolveOwnership — fullServerOwnership (SP2-b client lockout)', () => {
  test('client PRESENT + fullServerOwnership → entryOwner SERVER', () => {
    expect(resolveOwnership(ctx({ fullServerOwnership: true })).entryOwner).toBe('SERVER');
  });
  test('fullServerOwnership but cutover OFF → CLIENT (fail-closed)', () => {
    expect(resolveOwnership(ctx({ fullServerOwnership: true, cutoverActive: false })).entryOwner).toBe('CLIENT');
  });
  test('fullServerOwnership but AT off → CLIENT (fail-closed)', () => {
    expect(resolveOwnership(ctx({ fullServerOwnership: true, atActive: false })).entryOwner).toBe('CLIENT');
  });
  test('fullServerOwnership but creds invalid → CLIENT (fail-closed)', () => {
    expect(resolveOwnership(ctx({ fullServerOwnership: true, credsValid: false })).entryOwner).toBe('CLIENT');
  });
  test('field ABSENT → legacy hybrid behavior unchanged (present client → CLIENT)', () => {
    expect(resolveOwnership(ctx({})).entryOwner).toBe('CLIENT');
    expect(resolveOwnership(ctx({ clientPresent: false })).entryOwner).toBe('SERVER');
  });
  test('exit backstop stays SERVER with fullServerOwnership in every state', () => {
    for (const cp of [true, false]) {
      expect(resolveOwnership(ctx({ clientPresent: cp, fullServerOwnership: true })).exitOwner.disasterBackstop).toBe('SERVER');
    }
  });
});

// ─── [SP2-b 2026-06-07] Pure decision: reject client-originated AUTO opens
// when the server fully owns entries. reduceOnly (closes) NEVER blocked —
// kill switch / manual close must always work.
describe('shouldRejectClientAutoOrder — order/place defense-in-depth', () => {
  const { shouldRejectClientAutoOrder } = require('../../server/services/ownership');
  test('server owns + source auto + open → REJECT', () => {
    expect(shouldRejectClientAutoOrder({ serverOwnsEntries: true, source: 'auto', reduceOnly: false })).toBe(true);
  });
  test('reduceOnly close NEVER rejected (kill/manual close path)', () => {
    expect(shouldRejectClientAutoOrder({ serverOwnsEntries: true, source: 'auto', reduceOnly: true })).toBe(false);
  });
  test('manual order never rejected', () => {
    expect(shouldRejectClientAutoOrder({ serverOwnsEntries: true, source: 'manual', reduceOnly: false })).toBe(false);
    expect(shouldRejectClientAutoOrder({ serverOwnsEntries: true, source: undefined, reduceOnly: false })).toBe(false);
  });
  test('server does NOT own → auto passes (legacy client-AT mode)', () => {
    expect(shouldRejectClientAutoOrder({ serverOwnsEntries: false, source: 'auto', reduceOnly: false })).toBe(false);
  });
});

// ─── [SP2-b 2026-06-07] Pure core for serverAT.serverFullyOwnsEntries glue.
describe('computeFullOwnership — flag/cutover/env matrix', () => {
  const { computeFullOwnership } = require('../../server/services/ownership');
  const ok = { flagFull: true, flagExec: true, isCutover: true, engineMode: 'live', credsMode: 'testnet' };
  const c = (o) => Object.assign({}, ok, o);
  test('all conditions met → true', () => {
    expect(computeFullOwnership(c({}))).toBe(true);
  });
  test('flag OFF → false (rollback lever)', () => {
    expect(computeFullOwnership(c({ flagFull: false }))).toBe(false);
  });
  test('exec carve-out OFF → false', () => {
    expect(computeFullOwnership(c({ flagExec: false }))).toBe(false);
  });
  test('not a cutover user → false', () => {
    expect(computeFullOwnership(c({ isCutover: false }))).toBe(false);
  });
  test('demo engine → false (demo already server-owned via SERVER_AT_DEMO)', () => {
    expect(computeFullOwnership(c({ engineMode: 'demo' }))).toBe(false);
  });
  test('REAL creds → false (REAL stays blocked until explicit GO)', () => {
    expect(computeFullOwnership(c({ credsMode: 'real' }))).toBe(false);
    expect(computeFullOwnership(c({ credsMode: 'live' }))).toBe(false);
    expect(computeFullOwnership(c({ credsMode: null }))).toBe(false);
  });
});
