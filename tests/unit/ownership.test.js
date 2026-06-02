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
