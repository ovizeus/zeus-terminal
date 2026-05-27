/**
 * Zeus Terminal — Symbols/Watchlist (ported from public/js/data/symbols.js)
 * ZStore, connectWatchlist, switchWLSymbol
 *
 * NOTE: heavily reads old JS globals (S, BM, AT, TP, DSL, PERF, DHF, WL_SYMS,
 * wlPrices, allPrices, WS, Timeouts, etc.) via window.*.
 */

import { getSymbol, getPrice, getBrainMetrics, getATObject, getTPObject, getDSLObject } from './stateAccessors'
import { el } from '../utils/dom'
import { fP } from '../utils/format'
import { onNeuronScanUpdate } from '../engine/brain'
import { _enterDegradedMode, _exitDegradedMode } from '../utils/guards'
import { setSymbol } from '../data/marketDataWS'
const w = window as Record<string, any> // kept for w.S (state ref), w.PERF, w.DHF, w.allPrices, w.WL_SYMS, w.__wsGen, w.wlPrices, w.WS, w.Timeouts, fn calls

export const ZStore = {
  price: (sym: string) => w.allPrices?.[sym] || (sym === getSymbol() ? getPrice() : null),
  state: () => w.S,
  brain: () => getBrainMetrics(),
  at: () => getATObject() ?? null,
  tp: () => getTPObject(),
  dsl: () => getDSLObject() ?? null,
  perf: () => typeof w.PERF !== 'undefined' ? w.PERF : null,
  dhf: () => typeof w.DHF !== 'undefined' ? w.DHF : null,
  _listeners: {} as Record<string, Array<(data: unknown) => void>>,
  on(event: string, fn: (data: unknown) => void) { (this._listeners[event] = this._listeners[event] || []).push(fn) },
  emit(event: string, data?: unknown) { (this._listeners[event] || []).forEach(fn => { try { fn(data) } catch { /* */ } }) },
  dispatch(action: string, payload?: unknown) { this.emit(action, payload) },
}

// [Phase 2 S3.1d] Watchlist 24hr-change cache, refreshed via REST poll every
// 30s when ALT_WS_FEEDS is ON (miniTicker stream is throttled). bookTicker
// delivers live price; % change comes from /fapi/v1/ticker/24hr.
const _wlChgCache: Record<string, number> = {}
let _wlChgPollTimer: any = null

async function _pollWatchlist24hr(): Promise<void> {
  try {
    const syms: string[] = (w.WL_SYMS || []).map((s: string) => s.toUpperCase())
    if (syms.length === 0) return
    const q = encodeURIComponent(JSON.stringify(syms))
    const r = await fetch(`/api/market/ticker24hr?symbols=${q}`, { signal: AbortSignal.timeout(8000) })
    if (!r.ok) return
    const arr = await r.json()
    if (!Array.isArray(arr)) return
    for (const t of arr) {
      if (!t || !t.symbol) continue
      const pct = parseFloat(t.priceChangePercent)
      if (Number.isFinite(pct)) _wlChgCache[t.symbol] = pct
    }
  } catch (_) { /* quiet */ }
}

export function connectWatchlist(): void {
  // [WS-PROXY B.6] Server proxy handles watchlist — skip direct WS
  if (w.__MF && w.__MF.WS_PROXY_ENABLED === true) {
    const { on } = require('./wsMarketBridge')
    on('market.wl', (msg: any) => {
      if (!msg.symbol) return
      const sym = msg.symbol as string
      w.wlPrices[sym] = { price: msg.price, chg: msg.chg || 0, ts: Date.now() }
      w.allPrices[sym] = msg.price
      const pe = document.getElementById('wlp-' + sym)
      const ce = document.getElementById('wlc-' + sym)
      if (pe) pe.textContent = msg.price >= 1000 ? '$' + Math.round(msg.price).toLocaleString() : '$' + (+msg.price).toFixed(msg.price >= 1 ? 3 : 4)
      if (ce) { ce.textContent = (msg.chg >= 0 ? '+' : '') + msg.chg.toFixed(2) + '%'; ce.style.color = msg.chg >= 0 ? 'var(--grn)' : 'var(--red)' }
      try { window.dispatchEvent(new CustomEvent('zeus:wlPrice', { detail: { sym, price: msg.price, chg: msg.chg || 0 } })) } catch (_) {}
      if (typeof onNeuronScanUpdate === 'function') onNeuronScanUpdate()
    })
    console.log('[connectWatchlist] WS_PROXY mode — server handles watchlist stream')
    return
  }
  // ── Legacy direct path ──
  const _altFeeds = w.__MF && w.__MF.ALT_WS_FEEDS === true
  // [Phase 2 S3.1d] ALT_WS_FEEDS — swap @miniTicker (throttled) for
  // @bookTicker (alive) and derive price from mid(bid,ask). % change comes
  // from REST /fapi/v1/ticker/24hr polled every 30s.
  const _streamType = _altFeeds ? '@bookTicker' : '@miniTicker'
  const streams = w.WL_SYMS.map((s: string) => s.toLowerCase() + _streamType).join('/')
  const _wlGen = w.__wsGen
  console.log(`[connectWatchlist] attempt | gen=${_wlGen} | streams count=${w.WL_SYMS.length} | altFeeds=${_altFeeds}`)

  // Start/refresh REST poll for 24hr change when ALT mode is ON
  if (_altFeeds) {
    if (_wlChgPollTimer) { try { clearInterval(_wlChgPollTimer) } catch (_) {} }
    _pollWatchlist24hr()
    _wlChgPollTimer = setInterval(_pollWatchlist24hr, 30000)
  } else if (_wlChgPollTimer) {
    try { clearInterval(_wlChgPollTimer) } catch (_) {}
    _wlChgPollTimer = null
  }

  w.WS.open('watchlist', `wss://fstream.binance.com/stream?streams=${streams}`, {
    onopen: () => {
      console.log(`[connectWatchlist] onopen | gen=${w.__wsGen} (my gen=${_wlGen})`)
      if (typeof w._resetBackoff === 'function') w._resetBackoff('wl')
      _exitDegradedMode('WL')
    },
    onmessage: (e: MessageEvent) => {
      if (w.__wsGen !== _wlGen) return
      const j = JSON.parse(e.data); if (!j.data) return
      const d = j.data
      const sym = d.s as string
      let price: number, chg: number
      if (_altFeeds) {
        // bookTicker: mid of best bid/ask. % change from REST cache.
        const bid = +d.b, ask = +d.a
        if (!(bid > 0 && ask > 0)) return
        price = (bid + ask) / 2
        chg = _wlChgCache[sym] != null ? _wlChgCache[sym] : 0
      } else {
        // miniTicker: c=last, o=open
        price = +d.c
        const open = +d.o
        chg = ((price - open) / open * 100)
      }
      w.wlPrices[sym] = { price, chg, ts: Date.now() }
      w.allPrices[sym] = price
      if (typeof onNeuronScanUpdate === 'function') onNeuronScanUpdate(sym)
      // Notify React WatchlistBar so it can update Zustand store without a separate WS
      window.dispatchEvent(new CustomEvent('zeus:wlPrice', { detail: { sym, price, chg } }))
      const pe = el('wlp-' + sym)
      const ce = el('wlc-' + sym)
      if (pe) { pe.textContent = '$' + (price >= 1000 ? fP(price) : price >= 1 ? price.toFixed(3) : price.toPrecision(4)) }
      if (ce) { ce.textContent = (chg >= 0 ? '+' : '') + chg.toFixed(2) + '%'; ce.className = 'wl-chg ' + (chg >= 0 ? 'up' : 'dn') }
    },
    onclose: () => {
      console.log('[connectWatchlist] onclose')
      _enterDegradedMode('WL')
      if (w.Timeouts?.set) w.Timeouts.set('wlReconnect', connectWatchlist, typeof w._nextBackoff === 'function' ? w._nextBackoff('wl', 5000, 30000) : 5000)
    },
  })
}

export function switchWLSymbol(sym: string): void {
  document.querySelectorAll('.wl-item').forEach(i => i.classList.remove('act'))
  const item = el('wl-' + sym); if (item) item.classList.add('act')
  const sel = document.querySelector('#symSel') as HTMLSelectElement | null
  if (sel) { sel.value = sym; if (typeof w.setSymbol === 'function') w.setSymbol(sym); else setSymbol(sym) }
  else { w.S.symbol = sym; if (typeof w.resetData === 'function') w.resetData() }
}
