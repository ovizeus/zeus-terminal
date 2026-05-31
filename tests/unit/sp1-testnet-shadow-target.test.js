const path = require('path');

describe('SP1 _isTestnetShadowTarget', () => {
  let brain, serverAT;
  beforeEach(() => {
    jest.resetModules();
    serverAT = require('../../server/services/serverAT');
    brain = require('../../server/services/serverBrain');
  });

  test('true for a live-mode user whose execution env resolves TESTNET', () => {
    jest.spyOn(serverAT, 'getMode').mockReturnValue('live');
    jest.spyOn(serverAT, '_resolveExecutionEnv').mockReturnValue({ env: 'TESTNET' });
    expect(brain.__sp1.isTestnetShadowTarget(1)).toBe(true);
  });

  test('false for a demo-mode user', () => {
    jest.spyOn(serverAT, 'getMode').mockReturnValue('demo');
    jest.spyOn(serverAT, '_resolveExecutionEnv').mockReturnValue({ env: 'TESTNET' });
    expect(brain.__sp1.isTestnetShadowTarget(2)).toBe(false);
  });

  test('false for a live-mode user whose env is REAL', () => {
    jest.spyOn(serverAT, 'getMode').mockReturnValue('live');
    jest.spyOn(serverAT, '_resolveExecutionEnv').mockReturnValue({ env: 'REAL' });
    expect(brain.__sp1.isTestnetShadowTarget(1)).toBe(false);
  });

  test('false (never throws) when serverAT lookups throw', () => {
    jest.spyOn(serverAT, 'getMode').mockImplementation(() => { throw new Error('boom'); });
    expect(brain.__sp1.isTestnetShadowTarget(1)).toBe(false);
  });
});
