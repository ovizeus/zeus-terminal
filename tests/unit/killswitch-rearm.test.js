const serverAT = require('../../server/services/serverAT');

describe('[killswitch] re-arm invariant (existing pnlAtReset behavior)', () => {
  const UID = 990001; // throwaway test user id

  test('triggers at the limit, re-arms on reset, does NOT re-fire until another full limit', () => {
    const us = serverAT._uStateForTest(UID);
    us.engineMode = 'demo'; us.demoStartBalance = 10000; us.killPct = 5; // limit = $500
    us.killActive = false; us.pnlAtReset = 0;

    // loss of -$500 from reset baseline → triggers
    us.dailyPnL = -500;
    serverAT._checkKillSwitchForTest(UID);
    expect(serverAT._uStateForTest(UID).killActive).toBe(true);

    // operator deactivates → pnlAtReset re-baselines to current dailyPnL (-500)
    serverAT._clearKillCooldownForTest(UID);
    serverAT.resetKill(UID);
    expect(serverAT._uStateForTest(UID).killActive).toBe(false);
    expect(serverAT._uStateForTest(UID).pnlAtReset).toBe(-500);

    // small further loss (-$100 more → -$600) must NOT re-trigger (only -$100 since reset)
    us.dailyPnL = -600;
    serverAT._checkKillSwitchForTest(UID);
    expect(serverAT._uStateForTest(UID).killActive).toBe(false);

    // another full limit deeper (-$1000 → -$500 since reset) → re-triggers
    us.dailyPnL = -1000;
    serverAT._checkKillSwitchForTest(UID);
    expect(serverAT._uStateForTest(UID).killActive).toBe(true);
  });
});
