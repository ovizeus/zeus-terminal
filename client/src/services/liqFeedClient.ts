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
        // Live Feed counters (procLiq).
        try {
            // Flag-gated: when LIQ_FEED_VIA_SERVER is off this client is not
            // authoritative — skip, or procLiq's internal zeus:liq dispatch
            // would double-fire (caught by the vitest dispatch-count test).
            if (w.__MF && w.__MF.LIQ_FEED_VIA_SERVER === true) {
                if (w.S && w.S.liqMetrics && !w.S.liqMetrics.okx) {
                    w.S.liqMetrics.okx = { count: 0, usd: 0, lastTs: 0, reconnects: 0, msgCount: 0, connected: true, connectedAt: Date.now() }
                }
                procLiq({ s: liq.symbol, S: liq.side, q: liq.q, p: liq.p }, 'okx', liq.time)
            }
        } catch (_) { /* display-only — never break the QM dispatch */ }
        return
    }
    // binance / bybit route through zeus:liq with `exchange` field lowercase.
    try { window.dispatchEvent(new CustomEvent('zeus:liq', { detail: liq })) } catch (_) { /* defensive */ }
    // [LIQ-WARMUP 2026-06-07] When the server pipeline is authoritative, ALSO
    // ingest bybit + binance into the Overview/Monitor/Feed counters. The
    // direct-WS bybit path and the legacy market.liq binance path are now
    // flag-gated OFF in marketDataWS (no double-count) — and on devices whose
    // network blocks exchange hostnames (the operator's case; the original
    // reason for the server proxy) this is the ONLY path that can ever move
    // the BNB/BYB columns off $0.
    try {
        if (w.__MF && w.__MF.LIQ_FEED_VIA_SERVER === true) {
            const src = liq.exchange === 'bybit' ? 'byb' : 'bnb'
            procLiq({ s: liq.symbol, S: liq.side, q: liq.q, p: liq.p }, src, liq.time)
        }
    } catch (_) { /* display-only — never break the QM dispatch */ }
}

/**
 * [LIQ-WARMUP 2026-06-07] Pull the server's ring buffer (last events per
 * exchange, held by liqFeedAggregator precisely for new-client warmup since
 * Plan A — never consumed until now) and replay it through the exact same
 * frame handler. Without this every page load showed $0 across the
 * Liquidation Overview/Monitor/Live Feed until the next ≥threshold event
 * happened to arrive while the page was open.
 */
async function _warmupFromServer(): Promise<void> {
    try {
        // [LIQ-WARMUP timing fix 2026-06-07] start() runs at app mount, but
        // window.__MF is populated asynchronously AFTER mount — the one-shot
        // flag gate below returned early on EVERY page load, silently turning
        // warmup into a no-op (counters only ever filled from live events;
        // proven via Playwright network capture: zero /api/liq/recent calls).
        // Poll briefly for the flags object before deciding.
        for (let i = 0; i < 15 && !(w.__MF && typeof w.__MF === 'object'); i++) {
            await new Promise(r => setTimeout(r, 2000))
        }
        if (!(w.__MF && w.__MF.LIQ_FEED_VIA_SERVER === true)) return
        const resp = await fetch('/api/liq/recent?limit=300', { credentials: 'same-origin' })
        if (!resp.ok) return
        const body = await resp.json()
        const events = Array.isArray(body && body.events) ? body.events : []
        // Server returns time-ascending — replay preserves feed ordering.
        for (const ev of events) handleLiqFeedFrame(ev)
        if (typeof w.ZLOG !== 'undefined') {
            try { w.ZLOG.push('LIQ-FEED', `[liqFeedClient] warmup replayed ${events.length} buffered event(s)`) } catch (_) {}
        }
    } catch (_) { /* warmup is best-effort — live frames still flow */ }
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
    // [LIQ-WARMUP 2026-06-07] Fire-and-forget — populates counters from the
    // server buffer so panels open with data instead of $0.
    void _warmupFromServer()
}

export function stop(): void {
    if (!_started) return
    if (_frameHandler) {
        window.removeEventListener('zeus:wsFrame', _frameHandler as EventListener)
        _frameHandler = null
    }
    _started = false
}
