import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { PositionCard } from '../PositionsList'

// [2026-10-11] The operator opened a manual demo position on b270 and got the
// red Panel Error: "Cannot read properties of null (reading 'toFixed')".
//
// PositionCard formats six numbers. Two of them, markPrice and liqPrice, go
// through fmt1(), which guards with Number.isFinite and falls back to an em
// dash. The other four call .toFixed() straight on the field:
//
//   pos.size.toFixed(1)      pos.entry.toFixed(1)
//   pos.pnlPct.toFixed(2)    pos.pnl.toFixed(2)
//
// The type declares them `number`, but this is runtime data and the live
// database disagrees: his open rows in at_positions hold entryPrice: null. A
// freshly opened position also has no pnl until the first price tick. So the
// guard was written for two fields and forgotten for four — the shape of a bug
// that waits for a position with a missing number.
//
// An em dash is the right answer: a missing number must not read as zero on a
// money surface, and it must never take the panel down.

const base = {
  id: 'p1', symbol: 'XRPUSDT', side: 'LONG', size: 530, entry: 1.4412,
  pnl: 59.68, pnlPct: 1.2, live: false, durationMs: 1000, closable: true,
  leverage: 10, markPrice: 1.4512, liqPrice: 1.31, slPrice: 1.39, tpPrice: 1.47,
  reason: '', beMoved: false,
}
const card = (over: Record<string, unknown>) =>
  render(<PositionCard pos={{ ...base, ...over } as never} />)

describe('a position card survives a missing number', () => {
  it('does not throw when entry is null, as the live rows are', () => {
    expect(() => card({ entry: null })).not.toThrow()
  })

  it('does not throw before the first pnl tick', () => {
    expect(() => card({ pnl: null, pnlPct: null })).not.toThrow()
  })

  it('does not throw when size is missing', () => {
    expect(() => card({ size: null })).not.toThrow()
  })

  it('does not throw when every number is missing at once', () => {
    expect(() => card({
      entry: null, pnl: null, pnlPct: null, size: null, markPrice: null, liqPrice: null,
    })).not.toThrow()
  })

  it('shows an em dash rather than a zero for a missing number', () => {
    const { container } = card({ entry: null, pnl: null, pnlPct: null, size: null })
    expect(container.textContent).toContain('—')
    expect(container.textContent).not.toMatch(/Entry 0\.0/)
  })

  it('still prints the real numbers when they are there', () => {
    const { container } = card({})
    expect(container.textContent).toContain('59.68')
  })
})
