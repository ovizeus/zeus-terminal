/**
 * Zeus Terminal — Chart Bridge
 *
 * Exposes React TradingChart's LightweightCharts instance and all series
 * to window globals so old JS (marketData.js, drawingTools.js, panels.js, etc.)
 * can operate against the React-owned chart.
 *
 * Old JS expects these globals:
 *   mainChart   — IChartApi (the main chart instance)
 *   cSeries     — ISeriesApi<'Candlestick'> (candle series)
 *   volS        — ISeriesApi<'Histogram'> (volume series)
 *   ema50S      — ISeriesApi<'Line'>
 *   ema200S     — ISeriesApi<'Line'>
 *   wma20S      — ISeriesApi<'Line'>
 *   wma50S      — ISeriesApi<'Line'>
 *   stS         — ISeriesApi<'Line'> (SuperTrend)
 *   _zMainChart — alias for drawingTools.js
 *   _zCSeries   — alias for drawingTools.js
 *   LightweightCharts — library namespace (for sub-chart creation)
 *
 * React owns chart lifecycle (create/destroy).
 * Old JS reads refs and adds additional series (liq, sr, vwap, ovi, etc.)
 *
 * LIFECYCLE:
 *   1. React TradingChart mounts → calls registerChart()
 *   2. registerChart() exposes all refs to window
 *   3. Dispatches 'zeus:chartReady' event
 *   4. Bridge loader (legacyLoader.ts) waits for this event before calling startApp()
 *   5. On unmount → unregisterChart() cleans window refs
 */

import type { IChartApi, ISeriesApi } from 'lightweight-charts'
import * as LightweightCharts from 'lightweight-charts'

// ── Types ──────────────────────────────────────────────────────────
export interface ChartRefs {
  chart: IChartApi
  candle: ISeriesApi<'Candlestick'>
  volume: ISeriesApi<'Histogram'>
  ema50: ISeriesApi<'Line'>
  ema200: ISeriesApi<'Line'>
  wma20: ISeriesApi<'Line'>
  wma50: ISeriesApi<'Line'>
  st: ISeriesApi<'Line'>
}

// ── State ──────────────────────────────────────────────────────────
let _registered = false
let _refs: ChartRefs | null = null

// ── Public API ─────────────────────────────────────────────────────

/**
 * Called by TradingChart after chart + all series are created.
 * Exposes everything to window globals for old JS compatibility.
 */
export function registerChart(refs: ChartRefs): void {
  if (_registered) {
    console.warn('[CHART-BRIDGE] Already registered — unregister first')
    return
  }

  _refs = refs
  _registered = true

  const w = window as any

  // ── Expose LightweightCharts library namespace ──
  // Old JS uses LightweightCharts.createChart() for sub-indicator charts (MACD, RSI, etc.)
  // and LightweightCharts.CrosshairMode, .LineStyle, etc.
  w.LightweightCharts = LightweightCharts

  // ── Expose main chart + candle series (most critical) ──
  w.mainChart = refs.chart
  w.cSeries = refs.candle

  // ── Expose drawing tools aliases ──
  w._zMainChart = refs.chart
  w._zCSeries = refs.candle

  // ── Expose volume series ──
  w.volS = refs.volume

  // ── Expose indicator series (same names as old marketData.js globals) ──
  w.ema50S = refs.ema50
  w.ema200S = refs.ema200
  w.wma20S = refs.wma20
  w.wma50S = refs.wma50
  w.stS = refs.st

  // ── Initialize array series placeholders ──
  // Old JS creates these dynamically, but expects them to exist as arrays
  if (!w.liqSeries) w.liqSeries = []
  if (!w.srSeries) w.srSeries = []
  if (!w.zsSeries) w.zsSeries = []
  // vwapSeries owned by panels.ts — no init needed here
  if (!w.oviSeries) w.oviSeries = []

  console.log('[CHART-BRIDGE] Chart registered — all refs exposed to window')

  // ── Dispatch readiness event ──
  // legacyLoader.ts listens for this before calling startApp()
  window.dispatchEvent(new CustomEvent('zeus:chartReady'))
}

/**
 * Called by TradingChart on unmount.
 * Cleans up window globals to prevent stale ref access.
 */
export function unregisterChart(): void {
  if (!_registered) return

  const w = window as any

  // Null out refs — old JS code checks for null before using
  w.mainChart = null
  w.cSeries = null
  w._zMainChart = null
  w._zCSeries = null
  w.volS = null
  w.ema50S = null
  w.ema200S = null
  w.wma20S = null
  w.wma50S = null
  w.stS = null

  // Don't remove LightweightCharts — it's a library, not a ref
  // Don't remove array series — old JS may still hold references

  _refs = null
  _registered = false

  console.log('[CHART-BRIDGE] Chart unregistered — window refs cleared')
}

/** Check if chart bridge has registered refs */
export function isChartReady(): boolean {
  return _registered && _refs !== null
}

/** Get chart refs (for internal React use) */
export function getChartRefs(): ChartRefs | null {
  return _refs
}
