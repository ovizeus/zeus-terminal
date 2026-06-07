/**
 * Zeus Terminal — Unit Tests: liqFeedClient (Plan A 2026-05-14)
 *
 * Client-side listener for server-aggregated liquidation feed.
 * Spec: _review/audit/LIQ_FEED_PROXY_PLAN_20260514.md
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
vi.mock('../../data/marketDataWS', () => ({ procLiq: vi.fn() }))
import { handleLiqFeedFrame } from '../liqFeedClient'
import { procLiq } from '../../data/marketDataWS'

describe('liqFeedClient (Plan A — server-aggregated liq feed)', () => {
    let dispatched: { name: string; detail: any }[]
    let _origDispatch: typeof window.dispatchEvent

    beforeEach(() => {
        dispatched = []
        _origDispatch = window.dispatchEvent
        window.dispatchEvent = ((ev: any) => {
            if (ev instanceof CustomEvent) {
                dispatched.push({ name: ev.type, detail: ev.detail })
            }
            return true
        }) as any
    })

    afterEach(() => {
        window.dispatchEvent = _origDispatch
    })

    it('dispatches zeus:liq for binance frames', () => {
        const liq = { exchange: 'binance', symbol: 'BTCUSDT', side: 'SELL', isLong: true, p: 60000, q: 0.5, vol: 30000, time: 1700000000000 } as const
        handleLiqFeedFrame(liq as any)
        expect(dispatched).toHaveLength(1)
        expect(dispatched[0].name).toBe('zeus:liq')
        expect(dispatched[0].detail).toMatchObject({ exchange: 'binance', p: 60000, vol: 30000, side: 'SELL', isLong: true })
    })

    it('dispatches zeus:liq for bybit frames', () => {
        const liq = { exchange: 'bybit', symbol: 'BTCUSDT', side: 'BUY', isLong: false, p: 60500, q: 0.3, vol: 18150, time: 1700000000123 } as const
        handleLiqFeedFrame(liq as any)
        expect(dispatched).toHaveLength(1)
        expect(dispatched[0].name).toBe('zeus:liq')
        expect(dispatched[0].detail.exchange).toBe('bybit')
    })

    it('dispatches zeus:okxLiq for okx frames', () => {
        const liq = { exchange: 'okx', symbol: 'BTCUSDT', side: 'SELL', isLong: true, p: 60750, q: 0.2, vol: 12150, time: 1700000000456 } as const
        handleLiqFeedFrame(liq as any)
        expect(dispatched).toHaveLength(1)
        expect(dispatched[0].name).toBe('zeus:okxLiq')
        expect(dispatched[0].detail.exchange).toBe('OKX')
    })

    it('ignores frames with missing exchange field', () => {
        handleLiqFeedFrame({ symbol: 'BTCUSDT', p: 60000, vol: 30000 } as any)
        expect(dispatched).toHaveLength(0)
    })

    it('ignores null/undefined frames', () => {
        handleLiqFeedFrame(null as any)
        handleLiqFeedFrame(undefined as any)
        expect(dispatched).toHaveLength(0)
    })

    // [LIQ-WARMUP 2026-06-07] With the server pipeline authoritative
    // (LIQ_FEED_VIA_SERVER on), bybit + binance frames must ALSO feed the
    // Overview/Monitor/Feed counters via procLiq (their direct client paths
    // are flag-gated off in marketDataWS — on the operator's network they
    // never worked anyway). Original event time is passed through so warmup
    // replay doesn't stamp history as "now".
    describe('flag-gated procLiq ingestion (LIQ_FEED_VIA_SERVER on)', () => {
        beforeEach(() => {
            ;(window as any).__MF = { LIQ_FEED_VIA_SERVER: true }
            ;(procLiq as any).mockClear()
        })
        afterEach(() => { delete (window as any).__MF })

        it('bybit frame → procLiq(payload, "byb", time) + zeus:liq dispatch', () => {
            const liq = { exchange: 'bybit', symbol: 'BTCUSDT', side: 'BUY', isLong: false, p: 60500, q: 0.3, vol: 18150, time: 1700000000123 }
            handleLiqFeedFrame(liq as any)
            expect(procLiq).toHaveBeenCalledWith({ s: 'BTCUSDT', S: 'BUY', q: 0.3, p: 60500 }, 'byb', 1700000000123)
            expect(dispatched.some(d => d.name === 'zeus:liq')).toBe(true)
        })

        it('binance frame → procLiq(payload, "bnb", time)', () => {
            const liq = { exchange: 'binance', symbol: 'ETHUSDT', side: 'SELL', isLong: true, p: 1600, q: 2, vol: 3200, time: 1700000000456 }
            handleLiqFeedFrame(liq as any)
            expect(procLiq).toHaveBeenCalledWith({ s: 'ETHUSDT', S: 'SELL', q: 2, p: 1600 }, 'bnb', 1700000000456)
        })

        it('okx frame → procLiq(payload, "okx", time)', () => {
            const liq = { exchange: 'okx', symbol: 'BTCUSDT', side: 'SELL', isLong: true, p: 60750, q: 0.2, vol: 12150, time: 1700000000789 }
            handleLiqFeedFrame(liq as any)
            expect(procLiq).toHaveBeenCalledWith({ s: 'BTCUSDT', S: 'SELL', q: 0.2, p: 60750 }, 'okx', 1700000000789)
        })

        it('flag OFF → no procLiq ingestion for bybit/binance', () => {
            ;(window as any).__MF = { LIQ_FEED_VIA_SERVER: false }
            handleLiqFeedFrame({ exchange: 'bybit', symbol: 'BTCUSDT', side: 'BUY', isLong: false, p: 60500, q: 0.3, vol: 18150, time: 1 } as any)
            handleLiqFeedFrame({ exchange: 'binance', symbol: 'BTCUSDT', side: 'SELL', isLong: true, p: 60000, q: 0.5, vol: 30000, time: 2 } as any)
            expect(procLiq).not.toHaveBeenCalled()
        })
    })
})
