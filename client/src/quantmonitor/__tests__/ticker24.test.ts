import { describe, it, expect, vi, afterEach } from 'vitest'
import { parseTicker24, tickerQuery, fetchTicker24 } from '../engines/ticker24'
import { qmDisplayPrice } from '../index'

// [2026-11-15] Poza operatorului: PRICE 0.00, LOW $0.00, VOL 0 langa BID/ASK
// reale. HIGH/LOW/VOL citeau campuri fara niciun scriitor; PRICE era 0 dupa o
// schimbare de moneda.
const w = window as any
const ROW = { symbol: 'BTCUSDT', highPrice: '65120.5', lowPrice: '63100.1', lastPrice: '63886.7', volume: '182345.2', quoteVolume: '11712345678.9', priceChangePercent: '-1.84' }

describe('parseTicker24', () => {
    it('citeste un rand Binance /ticker/24hr', () => {
        expect(parseTicker24(ROW)).toEqual({ high: 65120.5, low: 63100.1, vol: 182345.2, quoteVol: 11712345678.9, chgPct: -1.84, last: 63886.7 })
    })
    it('⛔ un rand stricat nu devine o cifra', () => {
        expect(parseTicker24(null)).toBeNull()
        expect(parseTicker24({ ...ROW, highPrice: '0' })).toBeNull()
        expect(parseTicker24({ ...ROW, lowPrice: 'x' })).toBeNull()
        expect(parseTicker24({ ...ROW, highPrice: '100', lowPrice: '200' })).toBeNull()
    })
})

describe('tickerQuery — aceeasi cerere ca lista de urmarire, cand se poate', () => {
    it('moneda din lista → toata lista (acelasi cache pe server)', () => {
        expect(tickerQuery('btcusdt', ['BTCUSDT', 'ETHUSDT'])).toEqual(['BTCUSDT', 'ETHUSDT'])
    })
    it('moneda din afara listei → doar ea', () => {
        expect(tickerQuery('PEPEUSDT', ['BTCUSDT'])).toEqual(['PEPEUSDT'])
        expect(tickerQuery('', ['BTCUSDT'])).toEqual([])
    })
})

describe('fetchTicker24', () => {
    afterEach(() => { vi.unstubAllGlobals(); delete w.S; delete w.WL_SYMS })
    it('umple HIGH / LOW / VOL / schimbarea pentru moneda din chart', async () => {
        w.S = { symbol: 'BTCUSDT' }; w.WL_SYMS = ['BTCUSDT', 'ETHUSDT']
        vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => [{ ...ROW, symbol: 'ETHUSDT', highPrice: '2000', lowPrice: '1900' }, ROW] })))
        await fetchTicker24()
        expect(w.S).toMatchObject({ high24h: 65120.5, low24h: 63100.1, vol24h: 182345.2, chg24hPct: -1.84, ticker24Sym: 'BTCUSDT' })
    })
    it('⛔ raspunsul sosit dupa o schimbare de moneda se arunca', async () => {
        w.S = { symbol: 'BTCUSDT' }
        vi.stubGlobal('fetch', vi.fn(async () => { w.S.symbol = 'BNBUSDT'; return { ok: true, json: async () => [ROW] } }))
        await fetchTicker24()
        expect(w.S.high24h).toBeUndefined()
    })
})

describe('qmDisplayPrice — PRICE nu mai e 0 langa BID/ASK reale', () => {
    it('pretul viu cand exista', () => {
        expect(qmDisplayPrice({ price: 63890, bids: [{ p: 63886.7 }], asks: [{ p: 63886.8 }] })).toBe(63890)
    })
    it('pretul viu lipsa → mijlocul cartii', () => {
        expect(qmDisplayPrice({ price: 0, bids: [{ p: 63886.7 }], asks: [{ p: 63886.8 }] })).toBeCloseTo(63886.75, 6)
    })
    it('fara carte → marcajul, apoi ultimul din ticker, apoi 0', () => {
        expect(qmDisplayPrice({ price: 0, markPrice: 63880 })).toBe(63880)
        expect(qmDisplayPrice({ price: 0, last24h: 63870 })).toBe(63870)
        expect(qmDisplayPrice({})).toBe(0)
        expect(qmDisplayPrice({ price: 0, bids: [{ p: 100 }], asks: [{ p: 90 }] })).toBe(0)   // carte inversata: nu o folosim
    })
})
