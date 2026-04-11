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

export function connectWatchlist(): void {
  const streams = w.WL_SYMS.map((s: string) => s.toLowerCase() + '@miniTicker').join('/')
  const _wlGen = w.__wsGen
  console.log(`[connectWatchlist] attempt | gen=${_wlGen} | streams count=${w.WL_SYMS.length}`)
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
      const price = +d.c; const open = +d.o
      const chg = ((price - open) / open * 100)
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
  if (sel) { sel.value = sym; setSymbol(sym) }
  else { w.S.symbol = sym; if (typeof w.resetData === 'function') w.resetData() }
}
