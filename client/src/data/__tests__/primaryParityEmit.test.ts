import { describe, it, expect } from 'vitest'
import { shouldEmitPrimaryParity } from '../klines'

// [2026-10-14] Closes the circular migration gate.
//
// The parity harness is the evidence gate for SERVER_BRAIN/SERVER_AT: compare
// the client decision with the server decision on the same tick. It could not
// be fed. brain_parity_log held 1148 client rows against 7 server rows from a
// single second on 2026-10-10, and after the server side was fixed it became
// ~6700 server rows an hour against ZERO client PRIMARY rows — measured, not
// assumed: last client row 20:57:38, last server row 21:26:48.
//
// Why: PRIMARY comes from runAutoTradeCheck in autotrade.ts, which returns at
// line 705 via _isServerDemoATActive. The operator runs SERVER_AT_DEMO, so the
// server owns AT, so the client engine stands down — correctly — and the emit
// below it never runs. Collecting the evidence that authorises the migration
// required the client running AT, and the migration having already partly
// happened is what stopped it. primaryPairs would stay 0 for any number of days.
//
// The fix emits PRIMARY from the multi-symbol scanner instead, which already
// runs regardless of who owns AT (it produced 101 COVERAGE rows while the
// server owned AT). That is not a new design: klines.ts already documents
// "PRIMARY agreement (chart symbol via computeFusionDecision, mirrors server
// pipeline)" — the chart symbol was excluded only because autotrade.ts was
// expected to cover it.
//
// autotrade.ts is NOT touched. The money-path control flow and all three
// server-authority stand-down guards are exactly as they were.
//
// Exclusivity is the one thing that must not go wrong: if the client engine is
// ever armed again, BOTH emitters would fire for the chart symbol and double
// the PRIMARY sample, silently biasing the very evidence this exists to
// collect. So the scanner emits ONLY when the server owns AT.

describe('PRIMARY parity is emitted exactly once', () => {
  it('emits when the server owns AT globally — autotrade.ts has stood down', () => {
    expect(shouldEmitPrimaryParity(true, false, 'live')).toBe(true)
  })

  it('emits when the server owns demo AT and the user is in demo — the operator case', () => {
    expect(shouldEmitPrimaryParity(false, true, 'demo')).toBe(true)
  })

  it('does NOT emit when the client engine is armed — autotrade.ts covers it', () => {
    expect(shouldEmitPrimaryParity(false, false, 'demo')).toBe(false)
    expect(shouldEmitPrimaryParity(false, false, 'live')).toBe(false)
  })

  it('does NOT emit on a demo carve-out while the user is in LIVE mode', () => {
    // _isServerDemoATActive requires mode==='demo'; autotrade.ts still runs for
    // a live user, so emitting here would duplicate.
    expect(shouldEmitPrimaryParity(false, true, 'live')).toBe(false)
  })

  it('is case-insensitive about the mode, as _isServerDemoATActive is', () => {
    expect(shouldEmitPrimaryParity(false, true, 'DEMO')).toBe(true)
  })

  it('never throws on missing or malformed inputs', () => {
    expect(() => shouldEmitPrimaryParity(undefined as never, undefined as never, undefined as never)).not.toThrow()
    expect(shouldEmitPrimaryParity(undefined as never, undefined as never, undefined as never)).toBe(false)
  })

  it('treats only a strict true as server ownership', () => {
    // w._serverATEnabled is undefined until the AT-state sync lands; a loose
    // check would emit during the boot window and pair against nothing.
    expect(shouldEmitPrimaryParity(1 as never, false, 'demo')).toBe(false)
  })
})
