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

// [2026-10-11] The operator's ACTUAL position, as stored. Read from
// at_positions row created 2026-10-10 21:20:53, three seconds before the first
// CLIENT_ERR. The order itself succeeded — it is in the database, OPEN, with a
// real qty — so the crash was purely in rendering it.
//
// Note what the row does and does not have: no entryPrice key at all, no
// leverage key, and sl/tp null because he left them empty in the ticket. That
// is the exact shape that took the panel down.
describe('the position the operator actually opened', () => {
  const stored = {
    id: 'seq-1780224662037',
    symbol: 'BTCUSDT',
    side: 'LONG',
    mode: 'demo',
    sourceMode: 'manual',
    autoTrade: false,
    qty: 0.481,
    // entryPrice / leverage genuinely absent on the stored row
    sl: null,
    tp: null,
    live: false,
    durationMs: 0,
    closable: true,
    reason: '',
    beMoved: false,
  }

  it('renders without throwing', () => {
    expect(() => render(<PositionCard pos={stored as never} />)).not.toThrow()
  })

  it('shows em dashes for the numbers the row does not carry', () => {
    const { container } = render(<PositionCard pos={stored as never} />)
    expect(container.textContent).toContain('—')
  })

  it('still identifies the position', () => {
    const { container } = render(<PositionCard pos={stored as never} />)
    expect(container.textContent).toContain('BTCUSDT')
    expect(container.textContent).toContain('LONG')
  })
})
