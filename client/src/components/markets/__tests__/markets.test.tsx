/**
 * [2026-11-21] MARKETS — caseta de sub DEMO MODE + panoul complet + stratul de date.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { MarketsBar } from '../MarketsBar'
import { MarketsPanel } from '../MarketsPanel'
import { useUiStore } from '../../../stores'
import { selectItems, fmtPrice, fmtPct, corrInfo, subscribeTradfi, _resetTradfiForTest, type TradfiItem } from '../../../markets/tradfi'

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
    expect(screen.getByText('MARKETS')).toBeTruthy()
    expect(screen.getAllByText('Gold').length).toBeGreaterThan(0)
    fireEvent.click(screen.getByRole('button', { name: /open traditional markets/i }))
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
