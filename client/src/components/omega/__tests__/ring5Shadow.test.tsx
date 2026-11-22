/**
 * [2026-11-22] Ring5 — „Shadow results": modul (umbra vs aplicat) si efectul in dolari.
 */
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import { Ring5Panel } from '../Ring5Panel'

const REPORT = {
  ok: true, days: 7, applyOn: false, thresholds: [0.3, 0.5],
  total: {
    ring5: { trades: 120, matched: 30, blockEffect: 85.5, wouldBlock: { n: 9, pnl: -85.5, winners: 2, losers: 7 }, wouldShrink: { n: 3, pnl: -4 }, boost: { n: 5, pnl: 20 } },
    breakeven: { trades: 120, realPnl: -300, '0.3': { armed: 60, hit: 25, hitWinners: 6, hitLosers: 19, shadowPnl: -150, effect: 150 }, '0.5': { armed: 40, hit: 12, hitWinners: 4, hitLosers: 8, shadowPnl: -320, effect: -20 } },
  },
  perUser: {},
}

afterEach(() => vi.unstubAllGlobals())

describe('Ring5 — shadow results', () => {
  it('arata ca e UMBRA (neaplicat), blocarile si efectul pe fiecare prag', async () => {
    // celelalte cereri ale panoului raspund cu eroare: panoul le arata ca erori si merge mai departe
    vi.stubGlobal('fetch', vi.fn(async (url: string) => (String(url).includes('shadow-report')
      ? { ok: true, status: 200, statusText: 'OK', json: async () => REPORT }
      : { ok: false, status: 503, statusText: 'Unavailable', json: async () => ({ ok: false }) })))
    render(<Ring5Panel forceExpanded />)
    await act(async () => { await new Promise((r) => setTimeout(r, 0)) })
    expect(screen.getByText('SHADOW — recorded, not applied')).toBeTruthy()
    expect(screen.getByText(/would have blocked/).textContent).toMatch(/9.*7 losers, 2 winners/)
    expect(screen.getByText('+85.50$')).toBeTruthy()
    expect(screen.getByText('+150.00$')).toBeTruthy()
    expect(screen.getByText('-20.00$')).toBeTruthy()
  })
})
