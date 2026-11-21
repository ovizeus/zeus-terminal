/**
 * [2026-11-21] MARKETS — caseta de sub DEMO MODE + panoul complet + stratul de date.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { MarketsBar } from '../MarketsBar'
import { MarketsPanel } from '../MarketsPanel'
import { useUiStore } from '../../../stores'
import { selectItems, marketPulse, fmtPrice, fmtPct, corrInfo, subscribeTradfi, _resetTradfiForTest, type TradfiItem } from '../../../markets/tradfi'

const it0 = (o: Partial<TradfiItem>): TradfiItem => ({
  sym: 'X', name: 'X', group: 'stocks', market: 'us', price: 100, chg24: 0, high24: 110, low24: 90, vol24: 1e6,
  chg30: 0, spark: [1, 2, 3], corrBtc: 0.5, open: false, ...o,
})
const ITEMS = [
  it0({ sym: 'XAU', name: 'Gold', group: 'metals', market: 'cmdty', price: 3538.4, chg24: -0.54, corrBtc: 0.53 }),
  it0({ sym: 'NVDA', name: 'Nvidia', price: 128.9, chg24: -10.3, corrBtc: 0.46 }),
  it0({ sym: 'IBIT', name: 'iShares Bitcoin ETF', group: 'crypto', price: 52.1, chg24: -5.1, corrBtc: 0.97 }),
  it0({ sym: 'CL', name: 'WTI Crude Oil', group: 'energy', market: 'cmdty', price: 83.7, chg24: 1.2, corrBtc: -0.4 }),
  it0({ sym: 'NEW', name: 'New Listing', price: 10, chg24: 3, corrBtc: null }),
]
const SNAP = { ok: true, asOf: Date.now(), source: 'gate', stale: false, error: null, sessions: { us: false, cmdty: false, fx: false, de: false, jp: false }, items: ITEMS }

describe('formatare si filtre (pure)', () => {
  it('pret: zecimale dupa marime; procent cu semn', () => {
    expect(fmtPrice(3538.42)).toBe('3,538.42')
    expect(fmtPrice(1.09801)).toBe('1.0980')
    expect(fmtPct(-0.544)).toBe('-0.54%')
    expect(fmtPct(1.2)).toBe('+1.20%')
    expect(fmtPct(null)).toBe('—')
  })
  it('corelatia: praguri si „—" fara istoric', () => {
    expect(corrInfo(0.97).tone).toBe('strong')
    expect(corrInfo(0.4).tone).toBe('moderate')
    expect(corrInfo(0.05).tone).toBe('none')
    expect(corrInfo(-0.4).tone).toBe('inverse')
    expect(corrInfo(null).label).toBe('—')
  })
  it('grupa + cautare + sortare; fara valoare = la coada', () => {
    expect(selectItems(ITEMS, 'metals', '', 'default').map((i) => i.sym)).toEqual(['XAU'])
    expect(selectItems(ITEMS, 'all', 'nvid', 'default').map((i) => i.sym)).toEqual(['NVDA'])
    expect(selectItems(ITEMS, 'all', '', 'gainers')[0].sym).toBe('NEW')
    expect(selectItems(ITEMS, 'all', '', 'losers')[0].sym).toBe('NVDA')
    const byCorr = selectItems(ITEMS, 'all', '', 'corr').map((i) => i.sym)
    expect(byCorr[0]).toBe('IBIT')
    expect(byCorr[byCorr.length - 1]).toBe('NEW')
  })
})

describe('rezumatul de stare a pietei (marketPulse)', () => {
  const mk = (sym: string, chg24: number, corrBtc: number | null = null) => it0({ sym, name: sym, chg24, corrBtc })
  it('actiunile scad, aurul creste → RISK-OFF; cifrele vin din lista', () => {
    const p = marketPulse([mk('SPX500', -2.6), mk('NAS100', -4.0), mk('XAU', 0.8), mk('TLT', 0.4)])
    expect(p.regime).toBe('RISK-OFF')
    expect(p.regimeText).toMatch(/stocks -3\.30%/)
    expect(p.regimeText).toMatch(/gold \+0\.80%/)
  })
  it('scade tot, si refugiile → „broad selling"', () => {
    const p = marketPulse([mk('SPX500', -2.6), mk('NAS100', -4.0), mk('XAU', -1.3), mk('TLT', -0.9), mk('A', -1), mk('B', -2), mk('C', 0.5)])
    expect(p.regime).toBe('RISK-OFF')
    expect(p.regimeText).toMatch(/Broad selling/)
    expect(p.down).toBe(6); expect(p.up).toBe(1)
  })
  it('„si refugiile scad" doar cand FIECARE scade (aur jos, obligatiuni sus = nu)', () => {
    const base = [mk('SPX500', -2.6), mk('NAS100', -4.0), mk('A', -1), mk('B', -2), mk('C', -1), mk('D', 0.5)]
    expect(marketPulse([...base, mk('XAU', -1.04), mk('TLT', 0.35)]).regimeText).not.toMatch(/safe havens are down/)
    expect(marketPulse([...base, mk('XAU', -1.04), mk('TLT', 0.35)]).regimeText).toMatch(/Broad selling \(\d+ of \d+ falling\)/)
    expect(marketPulse([...base, mk('XAU', -1.04), mk('TLT', -0.2)]).regimeText).toMatch(/safe havens are down too/)
  })
  it('actiunile cresc peste refugii → RISK-ON; in rest MIXED', () => {
    expect(marketPulse([mk('SPX500', 1.2), mk('NAS100', 1.6), mk('XAU', -0.2)]).regime).toBe('RISK-ON')
    expect(marketPulse([mk('SPX500', 0.1), mk('NAS100', -0.2), mk('XAU', 0.1)]).regime).toBe('MIXED')
  })
  it('pe ce merge BTC: cea mai mare corelatie macro, fara actiunile crypto', () => {
    const p = marketPulse([mk('NAS100', -1, 0.64), mk('XAU', 0, 0.53), mk('CL', 0, -0.4), it0({ sym: 'IBIT', group: 'crypto', corrBtc: 0.97 })])
    expect(p.btcText).toMatch(/with Nasdaq 100 \(0\.64/)
    expect(marketPulse([mk('NAS100', 0, 0.1), mk('XAU', 0, -0.05)]).btcText).toMatch(/on its own/)
  })
  it('fara indici: fara regim inventat', () => {
    expect(marketPulse([mk('NVDA', -10)]).regime).toBeNull()
  })
})

describe('un singur sondaj pentru toata aplicatia', () => {
  let calls = 0
  beforeEach(() => {
    _resetTradfiForTest(); calls = 0
    vi.stubGlobal('fetch', vi.fn(async () => { calls++; return { ok: true, json: async () => SNAP } }))
  })
  afterEach(() => { _resetTradfiForTest(); vi.unstubAllGlobals() })
  it('doi abonati = o singura cerere; dupa ultima dezabonare nu mai intreaba', async () => {
    const a = subscribeTradfi(() => {}), b = subscribeTradfi(() => {})
    await act(async () => { await Promise.resolve() })
    expect(calls).toBe(1)
    a(); b()
    const before = calls
    await new Promise((r) => setTimeout(r, 30))
    expect(calls).toBe(before)
  })
})

describe('caseta si panoul', () => {
  beforeEach(() => {
    _resetTradfiForTest()
    useUiStore.setState(useUiStore.getInitialState())
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => SNAP })))
  })
  afterEach(() => { _resetTradfiForTest(); vi.unstubAllGlobals() })

  it('caseta arata aurul si deschide panoul la atingere', async () => {
    render(<MarketsBar />)
    await act(async () => { await new Promise((r) => setTimeout(r, 0)) })
    expect(screen.getByText('GLOBAL MARKETS')).toBeTruthy()
    expect(screen.getAllByText('Gold').length).toBeGreaterThan(0)
    fireEvent.click(screen.getByRole('button', { name: /open global markets/i }))
    expect(useUiStore.getState().activeModal).toBe('markets')
  })

  it('panoul: grupe, cautare, detalii, inchidere; e recunoscut ca fereastra (butonul inapoi)', async () => {
    const onClose = vi.fn()
    const { container } = render(<MarketsPanel onClose={onClose} />)
    await act(async () => { await new Promise((r) => setTimeout(r, 0)) })
    expect(container.querySelector('.z-modal--open')).toBeTruthy()
    expect(screen.getByText('Nvidia')).toBeTruthy()
    fireEvent.click(screen.getByRole('tab', { name: /metals/i }))
    expect(screen.queryByText('Nvidia')).toBeNull()
    expect(screen.getByText('Gold')).toBeTruthy()
    fireEvent.click(screen.getByText('Gold'))
    expect(screen.getByText(/24h low/)).toBeTruthy()
    fireEvent.click(screen.getByRole('tab', { name: /^all/i }))
    fireEvent.change(screen.getByLabelText('Search markets'), { target: { value: 'zzz' } })
    expect(screen.getByText(/Nothing matches/)).toBeTruthy()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
  })
})
