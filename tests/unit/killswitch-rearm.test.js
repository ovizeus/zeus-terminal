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

  // [2026-06-15] Operator: after manual deactivate, a residual "kill switch active"
  // message lingered AND the kill could re-activate before the next loss. Root: resetKill
  // cleared killActive + re-baselined pnlAtReset, but LEFT killActiveAt/killReason/killLoss/
  // killLimit stale. The client mirrors those (residual UI) and, because state.ts only wipes
  // its realizedDailyPnL counter when `!killActive && killActiveAt===0`, that wipe never
  // fired → a journal recompute could re-trigger. resetKill must FULLY clear the metadata.
  test('[2026-06-15] resetKill fully clears kill metadata (no residual, no re-trigger)', () => {
    const UID3 = 990003;
    const us = serverAT._uStateForTest(UID3);
    us.engineMode = 'demo'; us.demoStartBalance = 10000; us.killPct = 5; // limit = $500
    us.killActive = false; us.pnlAtReset = 0;
    us.dailyPnL = -500;
    serverAT._checkKillSwitchForTest(UID3);
    expect(us.killActive).toBe(true);
    expect(us.killActiveAt).toBeGreaterThan(0);
    expect(us.killReason).toBe('daily_loss');

    serverAT.resetKill(UID3);
    const s = serverAT._uStateForTest(UID3);
    expect(s.killActive).toBe(false);
    expect(s.killActiveAt).toBe(0);   // ← was left stale → residual + blocked the client realized-PnL wipe
    expect(s.killReason).toBe(null);
    expect(s.killLoss).toBe(0);
    expect(s.killLimit).toBe(0);
    expect(s.pnlAtReset).toBe(-500);  // still re-baselined → won't re-fire until another full limit
  });

  test('[KILL-REARM 2026-06-07] reset has NO cooldown — consecutive resets both succeed', () => {
    // Operator rule: deactivation is always allowed; the pnlAtReset baseline
    // (not a timer) is what prevents instant re-triggering. The old 5-min
    // cooldown surfaced as "Kill switch reset cooldown — wait 162s" in the
    // deactivate dialog and blocked the operator from his own kill switch.
    const UID2 = 990002;
    const us = serverAT._uStateForTest(UID2);
    us.engineMode = 'demo'; us.demoStartBalance = 10000; us.killPct = 5;
    us.killActive = true; us.pnlAtReset = 0; us.dailyPnL = -500;

    const r1 = serverAT.resetKill(UID2);
    expect(r1.ok).toBe(true);

    // immediate second reset (double-tap) — must NOT be blocked by a timer
    us.killActive = true;
    const r2 = serverAT.resetKill(UID2);
    expect(r2.ok).toBe(true);
    expect(serverAT._uStateForTest(UID2).killActive).toBe(false);
    // idempotent re-baseline: same dailyPnL → same pnlAtReset
    expect(serverAT._uStateForTest(UID2).pnlAtReset).toBe(-500);
  });
});
