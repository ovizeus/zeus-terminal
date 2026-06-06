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

import { llvRequestRender } from '../data/marketDataOverlays'
import { procLiq } from '../data/marketDataWS'

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
 * [LIQ-FEED PROXY 2026-05-14 FIX] Populate w.S.llvBuckets for chart overlay
 * walls — same logic as marketDataWS.procLiq lines ~200-213. When server
 * feed bypasses direct WS, chart walls (renderLiqLevels) lost their data
 * source. This replicates llvBuckets population for BTC events.
 */
function _updateLlvBuckets(liq: LiqFeedEvent): void {
    if (!w.S || !w.S.llvSettings) return
    // Only BTC (chart shows current symbol; walls bucketed by % from price).
    if (!liq.symbol || !liq.symbol.toUpperCase().startsWith('BTC')) return
    const price = liq.p
    const qty = liq.q
    const usd = liq.vol
    if (!isFinite(price) || price <= 0 || !isFinite(usd) || usd <= 0) return
    const _bkt = w.S.llvSettings.bucketPct || 0.3
    const _step = price * _bkt / 100
    if (!_step || !isFinite(_step) || _step <= 0) return
    let _pkey: number = Math.round(price / _step) * _step
    _pkey = Math.round(_pkey)
    w.S.llvBuckets = w.S.llvBuckets || {}
    w.S.llvBuckets[_pkey] = w.S.llvBuckets[_pkey] || { price: _pkey, longUSD: 0, shortUSD: 0, longBTC: 0, shortBTC: 0, ts: Date.now() }
    if (liq.isLong) {
        w.S.llvBuckets[_pkey].longUSD += usd
        w.S.llvBuckets[_pkey].longBTC += qty
    } else {
        w.S.llvBuckets[_pkey].shortUSD += usd
        w.S.llvBuckets[_pkey].shortBTC += qty
    }
    w.S.llvBuckets[_pkey].ts = Date.now()
    // Trigger chart overlay re-render (debounced 250ms inside llvRequestRender)
    if (w.S.overlays && w.S.overlays.llv) {
        try { llvRequestRender() } catch (_) { /* defensive */ }
    }
}

/**
 * Process a single `liq.feed` frame and dispatch the appropriate
 * CustomEvent. Also populates w.S.llvBuckets for chart overlay walls.
 */
export function handleLiqFeedFrame(liq: LiqFeedEvent | null | undefined): void {
    if (!liq || !liq.exchange) return
    // Update chart overlay buckets (BTC walls visualization)
    _updateLlvBuckets(liq)
    if (liq.exchange === 'okx') {
        // Quant Monitor `addLiq('okx', ...)` expects exchange='OKX' upper.
        const detail = { ...liq, exchange: 'OKX' }
        try { window.dispatchEvent(new CustomEvent('zeus:okxLiq', { detail })) } catch (_) { /* defensive */ }
        // [LIQ-FIX 2026-06-06] Also feed the Liquidation Overview / Monitor /
        // Live Feed counters (procLiq). OKX is the ONLY source ingested here:
        // bybit arrives via the browser's direct WS and binance via the
        // market.liq proxy — ingesting those too would double-count. OKX has
        // no other client path, so this is duplication-free.
        try {
            // Flag-gated: when LIQ_FEED_VIA_SERVER is off this client is not
            // authoritative — skip, or procLiq's internal zeus:liq dispatch
            // would double-fire (caught by the vitest dispatch-count test).
            if (w.__MF && w.__MF.LIQ_FEED_VIA_SERVER === true) {
                if (w.S && w.S.liqMetrics && !w.S.liqMetrics.okx) {
                    w.S.liqMetrics.okx = { count: 0, usd: 0, lastTs: 0, reconnects: 0, msgCount: 0, connected: true, connectedAt: Date.now() }
                }
                procLiq({ s: liq.symbol, S: liq.side, q: liq.q, p: liq.p }, 'okx')
            }
        } catch (_) { /* display-only — never break the QM dispatch */ }
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
