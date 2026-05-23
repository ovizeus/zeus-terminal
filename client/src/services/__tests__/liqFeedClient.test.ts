/**
 * Zeus Terminal — Unit Tests: liqFeedClient (Plan A 2026-05-14)
 *
 * Client-side listener for server-aggregated liquidation feed.
 * Spec: _review/audit/LIQ_FEED_PROXY_PLAN_20260514.md
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { handleLiqFeedFrame } from '../liqFeedClient'

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
})
