import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, waitFor } from '@testing-library/react'
import { DslDrivePanel } from '../DslDrivePanel'

// [2026-10-11] The operator's recurring red Panel Error, reported NINE times on
// 2026-10-11 (07:09, 07:11, 07:14, 07:15 x3, 11:40 x3, 13:58) from his Android
// app: "Cannot read properties of null (reading 'toFixed')".
//
// It is not the ARES PositionCard — that was fixed in the 07:14 bundle and the
// crash kept arriving afterwards FROM the very bundle containing the fix.
//
// It is this panel. /api/dsldrive/state hands the position straight through:
//
//     entry: p.price, sl: p.sl          (server/routes/dslDrive.js)
//
// and the panel formats both with
//
//     const fmt = (x: number) => (Math.abs(x) >= 1000 ? x.toFixed(1) : x.toFixed(2))
//
// which has no guard, while its own sibling one line below it does:
//
//     const pct = (x?: number|null) => Number.isFinite(x as number) ? ... : '—'
//
// A position opened with no stop loss stores sl: null. That is not rare: of
// 3367 rows in at_closed, 303 carry sl literally null — about one in eleven.
// While such a position is open this panel polls every 1500ms and throws on
// every render, which is why a single position produced a whole day of reports.
//
// Math.abs(null) is 0, so the >= 1000 test is not what saves or damns it:
// both branches call .toFixed on null.

const row = (over: any = {}) => ({
  seq: 1780224662041, symbol: 'BTCUSDT', side: 'LONG',
  exchange: null, mode: 'demo',
  entry: 83620.05,
  sl: null,            // ← he left the SL field empty in the ticket
  ml: null, cockpit: null, dsl: null,
  ...over,
})
const state = (over: any = {}) => ({
  ok: true, mode: 'SHADOW', fullControl: false, ts: Date.now(),
  positions: [row(over)],
})

let payload: any = state()
vi.mock('../../../services/api', () => ({
  api: {
    raw: async (_m: string, url: string) =>
      String(url).includes('scoreboard') ? { ok: true } : payload,
  },
}))

beforeEach(() => { payload = state() })
afterEach(() => { vi.restoreAllMocks() })

const firstRow = (c: HTMLElement) => c.querySelector('.dsldrive-row')?.textContent || ''

describe('DSL Drive survives a position with no stop loss', () => {
  it('does not throw when sl is null, as 303 stored positions are', async () => {
    const { container } = render(<DslDrivePanel />)
    await waitFor(() => expect(container.textContent).toContain('BTCUSDT'))
  })

  it('shows an em dash for the missing stop, never a fabricated 0.00', async () => {
    const { container } = render(<DslDrivePanel />)
    await waitFor(() => expect(container.textContent).toContain('BTCUSDT'))
    expect(firstRow(container)).toContain('—')
    expect(firstRow(container)).not.toMatch(/SL\s*0\.00/)
  })

  it('still prints the entry price it does have', async () => {
    const { container } = render(<DslDrivePanel />)
    await waitFor(() => expect(container.textContent).toContain('83620.1'))
  })

  it('survives entry being null too', async () => {
    payload = state({ entry: null })
    const { container } = render(<DslDrivePanel />)
    await waitFor(() => expect(container.textContent).toContain('BTCUSDT'))
  })

  it('survives a null cockpit pivot, the third unguarded fmt call site', async () => {
    payload = state({
      cockpit: { capPct: 1, pivotLeft: null, pivotRight: 2, plPct: null, prPct: null, action: 'HOLD' },
    })
    const { container } = render(<DslDrivePanel />)
    await waitFor(() => expect(container.textContent).toContain('BTCUSDT'))
  })

  it('keeps a genuine zero rather than hiding it', async () => {
    payload = state({ sl: 0 })
    const { container } = render(<DslDrivePanel />)
    await waitFor(() => expect(container.textContent).toContain('BTCUSDT'))
    expect(firstRow(container)).toContain('0.00')
  })
})
