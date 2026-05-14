/**
 * Zeus Terminal — Server-Aggregated Liquidation Feed Client (Plan A 2026-05-14)
 *
 * Listens to Zeus WebSocket frames of type `liq.feed` (broadcast by
 * server-side `liqFeedAggregator.js`) and dispatches the same CustomEvents
 * (`zeus:liq` / `zeus:okxLiq`) that Quant Monitor already consumes. This
 * keeps QM's `addLiq()` handler unchanged — the only delta is event source
 * (server WS broadcast vs direct exchange WS).
 *
 * Active when `MF.LIQ_FEED_VIA_SERVER` is true (default). When false,
 * client-side direct connections in `marketDataWS.ts` + `okxLiqWS.ts`
 * remain authoritative.
 *
 * Spec: _review/audit/LIQ_FEED_PROXY_PLAN_20260514.md
 */

const w = window as any

export interface LiqFeedEvent {
    exchange: 'binance' | 'bybit' | 'okx'
    symbol: string
    side: 'BUY' | 'SELL'
    isLong: boolean
    p: number
    q: number
    vol: number
    time: number
}

/**
 * Process a single `liq.feed` frame and dispatch the appropriate
 * CustomEvent. Pure presentation — no state mutation.
 */
export function handleLiqFeedFrame(liq: LiqFeedEvent | null | undefined): void {
    if (!liq || !liq.exchange) return
    if (liq.exchange === 'okx') {
        // Quant Monitor `addLiq('okx', ...)` expects exchange='OKX' upper.
        const detail = { ...liq, exchange: 'OKX' }
        try { window.dispatchEvent(new CustomEvent('zeus:okxLiq', { detail })) } catch (_) { /* defensive */ }
        return
    }
    // binance / bybit route through zeus:liq with `exchange` field lowercase.
    try { window.dispatchEvent(new CustomEvent('zeus:liq', { detail: liq })) } catch (_) { /* defensive */ }
}

let _started = false
let _frameHandler: ((e: Event) => void) | null = null

/**
 * Subscribe to existing zeus:wsFrame CustomEvent (dispatched per-frame by
 * client WS message handler). Filter `liq.feed` type and re-dispatch as
 * zeus:liq/zeus:okxLiq. Idempotent.
 */
export function start(): void {
    if (_started) return
    _started = true
    _frameHandler = (e: Event) => {
        const detail = (e as CustomEvent).detail
        if (!detail || detail.type !== 'liq.feed') return
        handleLiqFeedFrame(detail.data)
    }
    window.addEventListener('zeus:wsFrame', _frameHandler as EventListener)
    if (typeof w.ZLOG !== 'undefined') {
        try { w.ZLOG.push('LIQ-FEED', '[liqFeedClient] subscribed to zeus:wsFrame for liq.feed broadcasts') } catch (_) {}
    }
}

export function stop(): void {
    if (!_started) return
    if (_frameHandler) {
        window.removeEventListener('zeus:wsFrame', _frameHandler as EventListener)
        _frameHandler = null
    }
    _started = false
}
