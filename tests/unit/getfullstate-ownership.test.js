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
  test('serverFullyOwnsEntries exported, boolean, fail-closed for non-cutover users', () => {
    const { serverFullyOwnsEntries } = require('../../server/services/serverAT');
    expect(typeof serverFullyOwnsEntries).toBe('function');
    // NOTE: migrationFlags loads the LIVE data/migration_flags.json — uid=1's
    // value depends on deployment state, so only assert it's boolean. A user
    // NOT in sp2_cutover_users.json must be false regardless of flags
    // (computeFullOwnership requires isCutover) — the stable invariant.
    expect(typeof serverFullyOwnsEntries(1)).toBe('boolean');
    expect(serverFullyOwnsEntries(999999)).toBe(false);
  });
});
