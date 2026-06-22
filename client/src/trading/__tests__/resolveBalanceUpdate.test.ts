import { describe, it, expect } from 'vitest'
import { _resolveBalanceUpdate } from '../liveApi'

// [BALANCE-SYNC FIX 2026-06-22] The exchange balance refresh used to piggyback on
// liveApiSyncState, which self-skips under position-mutex contention (WS pushes) →
// TP.liveBalance drifted on optimistic local arithmetic. The fix is a dedicated,
// decoupled balance poll; this pure helper carries the "never wipe a known balance
// with a transient 0" guard that both the dedicated poll and liveApiSyncState reuse.
describe('_resolveBalanceUpdate', () => {
  it('accepts a fresh positive balance over an unknown/zero previous', () => {
    expect(_resolveBalanceUpdate(655, 0)).toBe(655)
  })
  it('accepts a fresh positive balance over a known previous', () => {
    expect(_resolveBalanceUpdate(700.5, 655)).toBe(700.5)
  })
  it('SKIPS a transient 0 when a positive balance is already known (no wipe)', () => {
    expect(_resolveBalanceUpdate(0, 655)).toBeNull()
  })
  it('accepts 0 when there is no known balance yet (cold start)', () => {
    expect(_resolveBalanceUpdate(0, 0)).toBe(0)
  })
  it('coerces invalid inputs to 0 and applies the same guard', () => {
    expect(_resolveBalanceUpdate(NaN as any, 655)).toBeNull()   // invalid new + known → skip
    expect(_resolveBalanceUpdate(500, NaN as any)).toBe(500)    // valid new → accept
  })
})
