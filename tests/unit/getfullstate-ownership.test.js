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
