// Zeus — data/chartBackfill.ts
// Lazy historical backfill on left-edge scroll. Pure helpers are exported for unit
// tests; the impure loadOlder/initBackfill/resetBackfill orchestration is added in a
// later task. Gated by w.__MF.CHART_BACKFILL_ENABLED.

import { _isHistoricalBarSane } from '../utils/guards'
import { _indRenderHook } from '../engine/indicators'
import { renderTradeMarkers } from './marketDataOverlays'

export const MAX_BARS = 5000
export const EDGE_THRESHOLD = 12
export const FETCH_LIMIT = 1000

export interface Bar { time: number; open: number; high: number; low: number; close: number; volume: number }

export function _shouldTriggerBackfill(o: {
  from: number | null; klinesLen: number; inFlight: boolean; exhausted: boolean;
  enabled: boolean; maxBars: number; edgeThreshold: number
}): boolean {
  if (!o.enabled || o.inFlight || o.exhausted) return false
  if (o.klinesLen <= 0 || o.klinesLen >= o.maxBars) return false
  if (o.from == null) return false
  return o.from < o.edgeThreshold
}

// Concatenate older + current, dropping any older bar whose time is >= the current
// window's first bar time (boundary overlap), and guarantee strictly ascending unique
// times. Empty older → current unchanged.
export function _mergeOlderKlines(older: Bar[], current: Bar[]): Bar[] {
  if (!older || !older.length) return current
  if (!current || !current.length) return older
  const boundary = current[0].time
  const trimmed = older.filter(b => b.time < boundary)
  return trimmed.concat(current)
}

export function _computeRestoredRange(prev: { from: number; to: number } | null, prependedCount: number): { from: number; to: number } | null {
  if (!prev) return null
  return { from: prev.from + prependedCount, to: prev.to + prependedCount }
}

export function _nextEndTime(oldestBarTimeSec: number): number {
  return oldestBarTimeSec * 1000 - 1
}

// Trim the klines array to a bounded window. When backfill is enabled, use a sliding
// MAX_BARS (5000) window with a small buffer so we don't slice on every tick — and so
// backfilled history is not discarded by the next live append. When disabled, preserve
// the original pre-backfill behavior exactly (>1500 → keep last 1200).
export function _capKlines<T>(arr: T[], enabled: boolean): T[] {
  if (enabled) {
    if (arr.length > MAX_BARS + 200) return arr.slice(-MAX_BARS)
    return arr
  }
  if (arr.length > 1500) return arr.slice(-1200)
  return arr
}

const w = window as any

let _inFlight = false
let _exhausted = false
let _installed = false

function _enabled(): boolean {
  return !!(w.__MF && w.__MF.CHART_BACKFILL_ENABLED === true)
}

function _showLoading(show: boolean): void {
  let el = document.getElementById('chartBackfillLoading')
  if (!el && show) {
    const host = document.getElementById('csec') || document.body
    el = document.createElement('div')
    el.id = 'chartBackfillLoading'
    el.textContent = '⟳ loading history…'
    host.appendChild(el)
  }
  if (el) el.style.display = show ? 'block' : 'none'
}

export function resetBackfill(): void {
  _inFlight = false
  _exhausted = false
  _showLoading(false)
}

export async function loadOlder(): Promise<void> {
  if (!_enabled() || _inFlight || _exhausted) return
  if (!w.cSeries || !w.mainChart || !Array.isArray(w.S?.klines) || !w.S.klines.length) return
  if (w.S.klines.length >= MAX_BARS) return

  const gen = w.__wsGen
  const sym = w.S.symbol
  const tf = w.S.chartTf
  let prevRange: { from: number; to: number } | null = null
  try { prevRange = w.mainChart.timeScale().getVisibleLogicalRange() } catch (_) { prevRange = null }
  const oldest = w.S.klines[0].time

  try {
    _inFlight = true
    _showLoading(true)
    const ac = new AbortController()
    const acTimer = setTimeout(() => ac.abort(), 10000)
    let r: Response
    try {
      r = await fetch(`/api/market/klines?symbol=${sym}&interval=${tf}&endTime=${_nextEndTime(oldest)}&limit=${FETCH_LIMIT}&bg=1`, { signal: ac.signal })
    } finally { clearTimeout(acTimer) }
    if (!r || !r.ok) return // no-op, never mutate klines on failure
    const d = await r.json()
    // Stale guard: symbol/tf/gen changed during the fetch → drop silently.
    if (w.__wsGen !== gen || w.S.symbol !== sym || w.S.chartTf !== tf) return
    if (!Array.isArray(d) || !d.length) { _exhausted = true; return }

    const olderBars: Bar[] = d
      .map((k: any) => ({ time: Math.floor(k[0] / 1000), open: +k[1], high: +k[2], low: +k[3], close: +k[4], volume: +k[5] }))
      .filter((k: Bar) => _isHistoricalBarSane(k))
    if (!olderBars.length) { _exhausted = true; return }

    const before = w.S.klines.length
    const merged = _mergeOlderKlines(olderBars, w.S.klines)
    const prepended = merged.length - before
    if (prepended <= 0) { _exhausted = true; return } // nothing genuinely older
    if (olderBars.length < FETCH_LIMIT) _exhausted = true // reached listing date

    w.S.klines = merged
    try { w.cSeries.setData(w.S.klines) } catch (_) { }
    try { if (typeof w.rebuildCandleSeriesFromKlines === 'function') w.rebuildCandleSeriesFromKlines() } catch (_) { }
    try { if (typeof _indRenderHook === 'function') _indRenderHook() } catch (_) { }
    try { if (typeof renderTradeMarkers === 'function') renderTradeMarkers() } catch (_) { }
    const restored = _computeRestoredRange(prevRange, prepended)
    if (restored) { try { w.mainChart.timeScale().setVisibleLogicalRange(restored) } catch (_) { } }
  } catch (_) {
    // Any error → no-op. Never blank or partially-write the chart.
  } finally {
    _inFlight = false
    _showLoading(false)
  }
}

export function initBackfill(): void {
  if (_installed || !w.mainChart) return
  _installed = true
  try {
    w.mainChart.timeScale().subscribeVisibleLogicalRangeChange((r: any) => {
      const ok = _shouldTriggerBackfill({
        from: r ? r.from : null,
        klinesLen: Array.isArray(w.S?.klines) ? w.S.klines.length : 0,
        inFlight: _inFlight,
        exhausted: _exhausted,
        enabled: _enabled(),
        maxBars: MAX_BARS,
        edgeThreshold: EDGE_THRESHOLD,
      })
      if (ok) { void loadOlder() }
    })
  } catch (_) { _installed = false }
}
