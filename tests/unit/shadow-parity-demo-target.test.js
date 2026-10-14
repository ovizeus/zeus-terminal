const path = require('path');

// [2026-10-14] Why this exists.
//
// The migration gate for SERVER_BRAIN / SERVER_AT is the parity harness: you
// compare the client decision with the server decision on the same tick. On
// 2026-10-13 the evidence turned out to be impossible to collect:
//
//   brain_parity_log  client: 1148 rows for uid 1, still being written
//                     server:    7 rows, ALL inside one second on 2026-10-10
//
// Root cause (serverBrain.js:445-462): the server-side writer _runShadowCycle
// sits on the ELSE branch of _shouldRunMainCycle(), which is
// SERVER_BRAIN || SERVER_BRAIN_DEMO. The demo carve-out is ON, so that branch
// is never taken and the writer is never scheduled. PARITY_SHADOW_ENABLED is
// lit and structurally cannot produce a row.
//
// _runTestnetShadowCycle was added to compensate, but it is scoped by
// _isTestnetShadowTarget, which demands mode==='live' AND env==='TESTNET'. The
// operator trades DEMO (38 of 38 recent closed positions are mode=demo,
// env=DEMO), so he is never a target. The 7 rows are the one cycle during
// which he happened to be on testnet.
//
// The fix widens the PARITY target to include demo users, WITHOUT touching
// _isTestnetShadowTarget, which has its own meaning and its own tests.
//
// Why this is safe to do, verified in the code rather than assumed:
//   * includeUserFn is applied ONLY inside the per-user loop that calls
//     db.logParityRow(..., 'server', ...).
//   * _updateServerSigDir(_scanScores) runs AFTER the symbol loop, from scores
//     accumulated per SYMBOL, so the live mscan/sigDir input does not depend on
//     which users are included.
//   * the rows are produced by _computeFusionParity, which the code documents
//     as shadow-pure; the live _computeFusion is untouched.
// So widening the target adds diagnostic rows and changes no decision.
//
// REAL stays excluded deliberately: demo is the safe addition, and nothing is
// gained by writing shadow rows against a real-money user.

describe('shadow parity target covers demo users', () => {
  let brain, serverAT;
  beforeEach(() => {
    jest.resetModules();
    serverAT = require('../../server/services/serverAT');
    brain = require('../../server/services/serverBrain');
  });

  test('a demo user IS a parity target — the case that produced no evidence', () => {
    jest.spyOn(serverAT, 'getMode').mockReturnValue('demo');
    jest.spyOn(serverAT, '_resolveExecutionEnv').mockReturnValue({ env: 'DEMO' });
    expect(brain.__sp1.isShadowParityTarget(1)).toBe(true);
  });

  test('a testnet-live user is still a target — the original SP1 scope is kept', () => {
    jest.spyOn(serverAT, 'getMode').mockReturnValue('live');
    jest.spyOn(serverAT, '_resolveExecutionEnv').mockReturnValue({ env: 'TESTNET' });
    expect(brain.__sp1.isShadowParityTarget(1)).toBe(true);
  });

  test('a REAL-money user is NOT a target', () => {
    jest.spyOn(serverAT, 'getMode').mockReturnValue('live');
    jest.spyOn(serverAT, '_resolveExecutionEnv').mockReturnValue({ env: 'REAL' });
    expect(brain.__sp1.isShadowParityTarget(1)).toBe(false);
  });

  test('never throws when serverAT lookups fail — a diagnostic must not break the cycle', () => {
    jest.spyOn(serverAT, 'getMode').mockImplementation(() => { throw new Error('boom'); });
    expect(brain.__sp1.isShadowParityTarget(1)).toBe(false);
  });

  test('the narrow SP1 predicate is UNCHANGED — demo still false there', () => {
    // Guard against someone "simplifying" by widening the old predicate, which
    // would silently change what _serverSigDirState scoping means elsewhere.
    jest.spyOn(serverAT, 'getMode').mockReturnValue('demo');
    jest.spyOn(serverAT, '_resolveExecutionEnv').mockReturnValue({ env: 'DEMO' });
    expect(brain.__sp1.isTestnetShadowTarget(1)).toBe(false);
  });

  test('the testnet shadow cycle uses the WIDE predicate', () => {
    // The cycle must pass the widened target to _runShadowForUsers, otherwise
    // the predicate exists and nothing calls it — the exact shape of the bug
    // it is meant to fix.
    const src = require('fs').readFileSync(
      path.join(__dirname, '..', '..', 'server', 'services', 'serverBrain.js'), 'utf8');
    const body = src.slice(src.indexOf('function _runTestnetShadowCycle'));
    const end = body.indexOf('\n}');
    expect(body.slice(0, end)).toContain('_runShadowForUsers(_isShadowParityTarget)');
  });
});
