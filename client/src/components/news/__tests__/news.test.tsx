/**
 * [2026-11-21] MARKET NEWS — stratul de date (markets/news.ts), caseta si panoul.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'

vi.mock('../../../data/marketDataWS', () => ({ sendAlert: vi.fn() }))
import { sendAlert } from '../../../data/marketDataWS'
import { NewsBar } from '../NewsBar'
import { NewsPanel } from '../NewsPanel'
import { useUiStore } from '../../../stores'
import { QM } from '../../../quantmonitor/state'
import { ago, countdown, bestMove, filterNews, toMacroEvents, subscribeNews, _resetNewsForTest, _onAlertForTest, type NewsItem, type NewsSnap } from '../../../markets/news'

const NOW = Date.now()
const item = (o: Partial<NewsItem>): NewsItem => ({
  id: 'x', ts: NOW - 30 * 60_000, title: 'T', url: 'https://a/1', cat: 'crypto', official: false, tags: [], sources: ['Cointelegraph'],
  links: [{ source: 'Cointelegraph', url: 'https://a/1' }], moves: [], impact: 1, ...o,
})
const SNAP = (o: Partial<NewsSnap> = {}): NewsSnap => ({
  ok: true, asOf: NOW,
  items: [
    item({ id: 'a', title: 'Bitcoin falls to its lowest in two years', tags: ['BTC'], moves: [{ px: 'BTC', m15: 0.2, m60: 3.63, since: 2.1 }], impact: 6 }),
    item({ id: 'b', title: 'Fed holds rates steady', cat: 'macro', official: true, tags: ['FED'], sources: ['Federal Reserve', 'Bloomberg'], moves: [{ px: 'SPX500', m15: null, m60: null, since: null }] }),
    item({ id: 'c', title: 'Oil jumps after OPEC+ cut', cat: 'commodities', tags: ['OIL'] }),
  ],
  top: [], calendar: [
    { id: 'e1', title: 'CPI m/m', country: 'USD', ts: NOW + 2 * 3600_000, impact: 'High', forecast: '0.3%', previous: '0.2%', actual: '', moves: [] },
    { id: 'e2', title: 'Retail Sales', country: 'GBP', ts: NOW - 3600_000, impact: 'Medium', forecast: '0.1%', previous: '-0.2%', actual: '', moves: [] },
  ],
  brief: { text: 'BTC ROSE 3.63% within 1 hour after the headline.', at: NOW - 60_000 }, briefStatus: 'ok', calendarNote: null,
  sources: { total: 18, ok: 18 }, prefs: { alerts: 'app' }, ...o,
})

describe('formatare (pure)', () => {
  it('ago / countdown', () => {
    expect(ago(NOW - 20_000, NOW)).toBe('now')
    expect(ago(NOW - 5 * 60_000, NOW)).toBe('5m')
    expect(ago(NOW - 3 * 3600_000, NOW)).toBe('3h')
    expect(countdown(NOW + 2 * 3600_000 + 5 * 60_000, NOW)).toBe('in 2h 5m')
    expect(countdown(NOW - 1, NOW)).toBe('released')
  })
  it('cea mai buna masura: 1h > 15m > de la publicare; nimic = null', () => {
    expect(bestMove({ px: 'BTC', m15: 0.2, m60: 3.6, since: 1 })).toEqual({ v: 3.6, label: '1h' })
    expect(bestMove({ px: 'BTC', m15: 0.2, m60: null, since: 1 })).toEqual({ v: 0.2, label: '15m' })
    expect(bestMove({ px: 'BTC', m15: null, m60: null, since: null }).v).toBeNull()
  })
  it('filtru pe categorie + cautare in titlu si etichete', () => {
    const its = SNAP().items
    expect(filterNews(its, 'macro', '').map((i) => i.id)).toEqual(['b'])
    expect(filterNews(its, 'all', 'oil').map((i) => i.id)).toEqual(['c'])
    expect(filterNews(its, 'all', 'fed').map((i) => i.id)).toEqual(['b'])
  })
  it('calendarul Quant Monitor = evenimentele High reale', () => {
    expect(toMacroEvents(SNAP().calendar)).toEqual([{ name: 'USD CPI m/m', date: new Date(NOW + 2 * 3600_000) }])
  })
})

describe('sondaj si alerte', () => {
  beforeEach(() => { _resetNewsForTest(); (sendAlert as any).mockClear?.() })
  afterEach(() => { _resetNewsForTest(); vi.unstubAllGlobals() })
  it('dupa date: calendarul Quant Monitor nu mai e expirat', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => SNAP() })))
    const off = subscribeNews(() => {})
    await act(async () => { await new Promise((r) => setTimeout(r, 0)) })
    expect((QM as any).macroEvents[0].name).toBe('USD CPI m/m')
    off()
  })
  it('alerta respecta alegerea: „off" = nimic; „app" = o notificare', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => SNAP({ prefs: { alerts: 'off' } }) })))
    const off = subscribeNews(() => {})
    await act(async () => { await new Promise((r) => setTimeout(r, 0)) })
    _onAlertForTest({ type: 'news.alert', data: { title: 'USD CPI in 10 min', body: 'High impact' } })
    expect(sendAlert).not.toHaveBeenCalled()
    off(); _resetNewsForTest()
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => SNAP() })))
    const off2 = subscribeNews(() => {})
    await act(async () => { await new Promise((r) => setTimeout(r, 0)) })
    _onAlertForTest({ type: 'news.alert', data: { title: 'USD CPI in 10 min', body: 'High impact' } })
    expect(sendAlert).toHaveBeenCalledWith('USD CPI in 10 min', 'High impact', 'news')
    off2()
  })
})

describe('caseta si panoul', () => {
  let posted: any = null
  beforeEach(() => {
    _resetNewsForTest(); posted = null
    useUiStore.setState(useUiStore.getInitialState())
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: any) => {
      if (String(url).includes('/prefs')) { posted = JSON.parse(init.body); return { ok: true, json: async () => ({ ok: true }) } }
      return { ok: true, json: async () => SNAP() }
    }))
  })
  afterEach(() => { _resetNewsForTest(); vi.unstubAllGlobals() })

  it('caseta: titluri + urmatorul eveniment High; atingerea deschide panoul', async () => {
    render(<NewsBar />)
    await act(async () => { await new Promise((r) => setTimeout(r, 0)) })
    expect(screen.getByText('MARKET NEWS')).toBeTruthy()
    expect(screen.getByText(/USD CPI m\/m/)).toBeTruthy()
    expect(screen.getAllByText('Bitcoin falls to its lowest in two years').length).toBeGreaterThan(0)
    fireEvent.click(screen.getByRole('button', { name: /open market news/i }))
    expect(useUiStore.getState().activeModal).toBe('news')
  })

  it('panoul: rezumat AI, filtru, detalii cu reactia masurata si linkuri, calendar, alerte', async () => {
    const onClose = vi.fn()
    const { container } = render(<NewsPanel onClose={onClose} />)
    await act(async () => { await new Promise((r) => setTimeout(r, 0)) })
    expect(container.querySelector('.z-modal--open')).toBeTruthy()
    expect(screen.getByText(/BTC ROSE 3\.63%/)).toBeTruthy()
    fireEvent.click(screen.getByText('Bitcoin falls to its lowest in two years'))
    expect(screen.getByText('+3.63%')).toBeTruthy()
    expect(screen.getByText(/not proof it was caused/)).toBeTruthy()
    expect(screen.getByText(/Read on Cointelegraph/).getAttribute('target')).toBe('_blank')
    fireEvent.click(screen.getByRole('tab', { name: /^macro/i }))
    expect(screen.queryByText('Oil jumps after OPEC+ cut')).toBeNull()
    fireEvent.click(screen.getByRole('tab', { name: /economic calendar/i }))
    expect(screen.getByText(/USD · CPI m\/m/)).toBeTruthy()
    expect(screen.getByText(/GBP · Retail Sales/)).toBeTruthy()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'In-app + Telegram' })) })
    expect(posted).toEqual({ alerts: 'app_tg' })
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
  })

  it('AI indisponibil → „coming soon", nu text inventat; saptamana nepublicata → nota', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => SNAP({ brief: null, briefStatus: 'unavailable', calendar: [], calendarNote: 'The economic calendar for next week is published on Sunday.' }) })))
    render(<NewsPanel onClose={() => {}} />)
    await act(async () => { await new Promise((r) => setTimeout(r, 0)) })
    expect(screen.getByText(/AI briefing coming soon/)).toBeTruthy()
    fireEvent.click(screen.getByRole('tab', { name: /economic calendar/i }))
    expect(screen.getByText(/published on Sunday/)).toBeTruthy()
  })
})

describe('[2026-11-21 runda 2] stiri noi + moneda din grafic', () => {
  it('„N new since you looked": doar ce a aparut dupa ultima deschidere; prima vizita = 0', async () => {
    const { countNew, chartCoinTag, filterNews: f } = await import('../../../markets/news')
    const its = [item({ id: 'a', ts: 1000 }), item({ id: 'b', ts: 3000, tags: ['BTC'] }), item({ id: 'c', ts: 5000, tags: ['ETH'] })]
    expect(countNew(its, 0)).toBe(0)
    expect(countNew(its, 2000)).toBe(2)
    expect(chartCoinTag('BTCUSDT')).toBe('BTC')
    expect(chartCoinTag('ethusdt')).toBe('ETH')
    expect(chartCoinTag('')).toBeNull()
    expect(f(its, 'coin:BTC', '').map((i) => i.id)).toEqual(['b'])
  })
})
