import { describe, it, expect } from 'vitest'
import { resolveDisplayPnl } from '../guards'

// [2026-06-14] Bug: live AT positions showed +$0.00 PnL even when entry != current
// price. Root cause: render code trusted pos.pnl whenever Number.isFinite(pos.pnl),
// and an uncomputed/stale server pnl of exactly 0 is finite → the real price-based
// PnL was never used. A SHORT with entry 605.54 / now 604.61 cannot be exactly 0.
describe('resolveDisplayPnl', () => {
  it('uses the LOCAL price-based pnl when the live server pnl is exactly 0 (uncomputed/stale)', () => {
    // entry 605.54, now 604.61, SHORT, real local pnl ~ +14.9 — must NOT show 0
    expect(resolveDisplayPnl(true, 0, 14.9)).toBe(14.9)
  })

  it('uses the live server pnl when it is a real non-zero value', () => {
    expect(resolveDisplayPnl(true, -26.3, -44.0)).toBe(-26.3)
    expect(resolveDisplayPnl(true, 12.5, 9.9)).toBe(12.5)
  })

  it('falls back to local pnl when server pnl is missing / NaN', () => {
    expect(resolveDisplayPnl(true, undefined, 3.3)).toBe(3.3)
    expect(resolveDisplayPnl(true, NaN, -1.1)).toBe(-1.1)
    expect(resolveDisplayPnl(true, null, 7)).toBe(7)
  })

  it('uses local pnl for non-live (demo) positions regardless of server pnl', () => {
    expect(resolveDisplayPnl(false, 99, 4.2)).toBe(4.2)
  })

  it('returns local pnl (≈0) when genuinely flat — both are 0', () => {
    expect(resolveDisplayPnl(true, 0, 0)).toBe(0)
  })
})
