// Candle Type Switcher — replaces w.cSeries with the requested series type,
// transforms klines when needed (Heikin Ashi), and persists the choice.
// Supported types: candles, hollow, heikin, bars, line, line-markers, step, area, volume-candles.

import { USER_SETTINGS, _usScheduleSave } from '../core/config'

const w = window as any

export type CandleType =
  | 'candles'
  | 'hollow'
  | 'heikin'
  | 'bars'
  | 'line'
  | 'line-markers'
  | 'step'
  | 'area'
  | 'volume-candles'

export const CANDLE_TYPES: { id: CandleType; label: string; icon: string }[] = [
  { id: 'candles', label: 'Candles', icon: '▮' },
  { id: 'hollow', label: 'Hollow Candles', icon: '▯' },
  { id: 'heikin', label: 'Heikin Ashi', icon: '◧' },
  { id: 'bars', label: 'Bars', icon: '├' },
  { id: 'line', label: 'Line', icon: '⟋' },
  { id: 'line-markers', label: 'Line with Markers', icon: '◆⟋' },
  { id: 'step', label: 'Step Line', icon: '⌐' },
  { id: 'area', label: 'Area', icon: '▲' },
  { id: 'volume-candles', label: 'Volume Candles', icon: '▊' },
]

function _colors() {
  const c = (w.S && w.S._savedChartColors) || {}
  return {
    bull: c.bull || '#00d97a',
    bear: c.bear || '#ff3355',
    bullW: c.bullW || c.bull || '#00d97a',
    bearW: c.bearW || c.bear || '#ff3355',
  }
}

function _heikinAshi(klines: any[]): any[] {
  if (!klines.length) return []
  const out: any[] = []
  let prevO = klines[0].open
  let prevC = klines[0].close
  for (let i = 0; i < klines.length; i++) {
    const k = klines[i]
    const haClose = (k.open + k.high + k.low + k.close) / 4
    const haOpen = i === 0 ? (k.open + k.close) / 2 : (prevO + prevC) / 2
    const haHigh = Math.max(k.high, haOpen, haClose)
    const haLow = Math.min(k.low, haOpen, haClose)
    out.push({ time: k.time, open: haOpen, high: haHigh, low: haLow, close: haClose })
    prevO = haOpen
    prevC = haClose
  }
  return out
}

function _removeOldSeries() {
  try {
    if (w.cSeries && w.mainChart) {
      w.mainChart.removeSeries(w.cSeries)
    }
  } catch (_) { }
  w.cSeries = null
}

function _buildSeries(type: CandleType): any {
  const col = _colors()
  const chart = w.mainChart
  if (!chart) return null

  if (type === 'candles') {
    return chart.addCandlestickSeries({
      upColor: col.bull, downColor: col.bear,
      borderUpColor: col.bull, borderDownColor: col.bear,
      wickUpColor: col.bullW + '77', wickDownColor: col.bearW + '77',
    })
  }
  if (type === 'hollow') {
    return chart.addCandlestickSeries({
      upColor: 'rgba(0,0,0,0)',
      downColor: col.bear,
      borderUpColor: col.bull,
      borderDownColor: col.bear,
      wickUpColor: col.bullW,
      wickDownColor: col.bearW,
    })
  }
  if (type === 'heikin') {
    return chart.addCandlestickSeries({
      upColor: col.bull, downColor: col.bear,
      borderUpColor: col.bull, borderDownColor: col.bear,
      wickUpColor: col.bullW + '77', wickDownColor: col.bearW + '77',
    })
  }
  if (type === 'volume-candles') {
    return chart.addCandlestickSeries({
      upColor: col.bull, downColor: col.bear,
      borderUpColor: col.bull, borderDownColor: col.bear,
      wickUpColor: col.bullW + '77', wickDownColor: col.bearW + '77',
    })
  }
  if (type === 'bars') {
    return chart.addBarSeries({
      upColor: col.bull, downColor: col.bear, thinBars: false,
    })
  }
  if (type === 'line') {
    return chart.addLineSeries({
      color: col.bull, lineWidth: 2, priceLineVisible: false, lastValueVisible: true,
    })
  }
  if (type === 'line-markers') {
    return chart.addLineSeries({
      color: col.bull, lineWidth: 2,
      priceLineVisible: false, lastValueVisible: true,
      pointMarkersVisible: true, pointMarkersRadius: 3,
    })
  }
  if (type === 'step') {
    return chart.addLineSeries({
      color: col.bull, lineWidth: 2,
      priceLineVisible: false, lastValueVisible: true,
      lineType: 1, // LineType.WithSteps
    })
  }
  if (type === 'area') {
    return chart.addAreaSeries({
      topColor: col.bull + 'aa',
      bottomColor: col.bull + '00',
      lineColor: col.bull,
      lineWidth: 2,
      priceLineVisible: false, lastValueVisible: true,
    })
  }
  return null
}

function _applyData(series: any, type: CandleType, klines: any[]) {
  if (!series || !klines || !klines.length) return
  const col = _colors()
  try {
    if (type === 'candles' || type === 'hollow' || type === 'bars') {
      series.setData(klines.map(k => ({ time: k.time, open: k.open, high: k.high, low: k.low, close: k.close })))
    } else if (type === 'heikin') {
      series.setData(_heikinAshi(klines))
    } else if (type === 'volume-candles') {
      // Scale width/color by volume percentile
      const vols = klines.map(k => k.volume || 0)
      const sorted = [...vols].sort((a, b) => a - b)
      const p75 = sorted[Math.floor(sorted.length * 0.75)] || 1
      series.setData(klines.map(k => {
        const bullish = k.close >= k.open
        const hi = (k.volume || 0) >= p75
        const base = bullish ? col.bull : col.bear
        const shade = hi ? base : base + '88'
        return { time: k.time, open: k.open, high: k.high, low: k.low, close: k.close, color: shade, borderColor: shade, wickColor: shade }
      }))
    } else if (type === 'line' || type === 'line-markers' || type === 'step' || type === 'area') {
      series.setData(klines.map(k => ({ time: k.time, value: k.close })))
    }
  } catch (e) {
    console.warn('[candleType] setData failed:', (e as Error).message)
  }
}

let _currentType: CandleType = 'candles'
let _hookInstalled = false

export function getCandleType(): CandleType {
  return _currentType
}

export function applyCandleType(type: CandleType, opts?: { persist?: boolean }): void {
  if (!w.mainChart) return
  const klines = (w.S && w.S.klines) || []
  _removeOldSeries()
  const series = _buildSeries(type)
  if (!series) return
  w.cSeries = series
  _currentType = type
  _applyData(series, type, klines)
  if (opts?.persist !== false) {
    try {
      USER_SETTINGS.chart.candleType = type
      _usScheduleSave()
    } catch (_) { }
  }
  _installUpdateHook()
}

// Intercept w.cSeries.update so streaming ticks keep the type-specific transform.
// For heikin-ashi we need full recompute; for others update() works natively.
function _installUpdateHook() {
  if (_hookInstalled) return
  _hookInstalled = true
  // Patch a "tick" function called on each kline WS update.
  // We wrap it via a global helper that renderChart/kline WS handler can call.
  w._applyLatestBar = (bar: any) => {
    const series = w.cSeries
    if (!series) return
    try {
      if (_currentType === 'heikin') {
        // recompute entire HA — cheap for 1500 bars
        const klines = (w.S && w.S.klines) || []
        series.setData(_heikinAshi(klines))
      } else if (_currentType === 'line' || _currentType === 'line-markers' || _currentType === 'step' || _currentType === 'area') {
        series.update({ time: bar.time, value: bar.close })
      } else if (_currentType === 'volume-candles') {
        const col = _colors()
        const bullish = bar.close >= bar.open
        const base = bullish ? col.bull : col.bear
        series.update({ time: bar.time, open: bar.open, high: bar.high, low: bar.low, close: bar.close, color: base, borderColor: base, wickColor: base })
      } else {
        series.update({ time: bar.time, open: bar.open, high: bar.high, low: bar.low, close: bar.close })
      }
    } catch (_) { }
  }
}

export function rebuildCandleSeriesFromKlines(): void {
  // Called by renderChart AFTER klines refresh, so series matches current type.
  if (!w.mainChart || !w.S || !w.S.klines) return
  if (_currentType === 'candles' && w.cSeries) {
    // default series already handled by caller's setData; nothing to do
    return
  }
  applyCandleType(_currentType, { persist: false })
}

// Expose globally for legacy bootstrap
w.applyCandleType = applyCandleType
w.getCandleType = getCandleType
w.rebuildCandleSeriesFromKlines = rebuildCandleSeriesFromKlines
