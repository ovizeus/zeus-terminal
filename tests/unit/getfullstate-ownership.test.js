'use strict';
const { _computeUserOwnership } = require('../../server/services/serverAT');
describe('_computeUserOwnership for sync payload', () => {
  test('present client → entryOwner CLIENT, backstop SERVER', () => {
    const o = _computeUserOwnership({ clientPresent: true, atActive: true, credsValid: true, cutoverActive: true });
    expect(o.entryOwner).toBe('CLIENT');
    expect(o.exitOwner.disasterBackstop).toBe('SERVER');
  });
  test('absent client + cutover → entryOwner SERVER', () => {
    const o = _computeUserOwnership({ clientPresent: false, atActive: true, credsValid: true, cutoverActive: true });
    expect(o.entryOwner).toBe('SERVER');
  });
});

// ─── [SP2-b 2026-06-07] full ownership pass-through + glue fail-closed ───
describe('SP2-b full ownership', () => {
  test('_computeUserOwnership honors fullServerOwnership (present client → SERVER)', () => {
    const o = _computeUserOwnership({ clientPresent: true, atActive: true, credsValid: true, cutoverActive: true, fullServerOwnership: true });
    expect(o.entryOwner).toBe('SERVER');
    expect(o.exitOwner.disasterBackstop).toBe('SERVER');
  });
  test('serverFullyOwnsEntries exported and fail-closed with default flags (SERVER_AT_FULL_OWNERSHIP absent/false)', () => {
    const { serverFullyOwnsEntries } = require('../../server/services/serverAT');
    expect(typeof serverFullyOwnsEntries).toBe('function');
    // Test env loads defaults (flag false) → must be false for any user.
    expect(serverFullyOwnsEntries(1)).toBe(false);
    expect(serverFullyOwnsEntries(999999)).toBe(false);
  });
});
