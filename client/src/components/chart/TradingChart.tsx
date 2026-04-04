import { useEffect, useRef, useCallback } from 'react'
import {
  createChart,
  ColorType,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp,
  CrosshairMode,
  LineStyle,
} from 'lightweight-charts'
import { useMarketData, type Kline } from '../../hooks/useMarketData'
import { useMarketStore } from '../../stores'

/** Chart colors — 1:1 match with original marketData.js */
const COLORS = {
  bg: '#0a0f16',
  text: '#7a9ab8',
  grid: '#1a2530',
  border: '#1e2530',
  bullCandle: '#00d97a',
  bearCandle: '#ff3355',
  bullWick: '#00d97a77',
  bearWick: '#ff335577',
  ema50: '#f0c040',
  ema200: '#00b8d4',
  wma20: '#aa44ff',
  wma50: '#ff8822',
  st: '#ff8800',
  volume: '#00b8d422',
  volBull: '#00d97a44',
  volBear: '#ff335544',
}

/* ── Indicator math (matches original marketData.js) ── */

function calcEMA(data: number[], p: number): number[] {
  const k = 2 / (p + 1)
  let e = data[0]
  return data.map((v) => {
    e = v * k + e * (1 - k)
    return e
  })
}

function calcWMA(data: number[], p: number): (number | null)[] {
  return data.map((_v, i) => {
    if (i < p - 1) return null
    let s = 0, w = 0
    for (let j = 0; j < p; j++) {
      s += data[i - j] * (p - j)
      w += p - j
    }
    return s / w
  })
}

function calcATRLast(klines: Kline[], period: number): number | null {
  const n = klines.length
  if (n < period + 2) return null
  const tr = new Array(n).fill(0)
  for (let i = 1; i < n; i++) {
    const h = klines[i].high, l = klines[i].low, pc = klines[i - 1].close
    tr[i] = Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc))
  }
  // Wilder ATR
  let seedSum = 0
  for (let j = 1; j <= period; j++) seedSum += tr[j]
  let atr = seedSum / period
  for (let j = period + 1; j < n; j++) {
    atr = (atr * (period - 1) + tr[j]) / period
  }
  return atr
}

interface STPoint { time: number; value: number }

function calcSuperTrend(klines: Kline[], closes: number[], atr: number, mult: number): STPoint[] {
  const out: STPoint[] = []
  let up = 0, dn = 0, trend = 1
  const prev: { up: number; dn: number }[] = []

  klines.forEach((k, i) => {
    const hl2 = (k.high + k.low) / 2
    const bu = hl2 + mult * atr
    const bl = hl2 - mult * atr

    if (i === 0) {
      up = bu; dn = bl
    } else {
      up = bu < prev[i - 1].up || closes[i - 1] > prev[i - 1].up ? bu : prev[i - 1].up
      dn = bl > prev[i - 1].dn || closes[i - 1] < prev[i - 1].dn ? bl : prev[i - 1].dn
    }

    if (closes[i] > up) trend = 1
    else if (closes[i] < dn) trend = -1

    prev.push({ up, dn })
    out.push({ time: k.time, value: trend === 1 ? dn : up })
  })
  return out
}

export function TradingChart() {
  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const candleRef = useRef<ISeriesApi<'Candlestick'> | null>(null)
  const volRef = useRef<ISeriesApi<'Histogram'> | null>(null)
  const ema50Ref = useRef<ISeriesApi<'Line'> | null>(null)
  const ema200Ref = useRef<ISeriesApi<'Line'> | null>(null)
  const wma20Ref = useRef<ISeriesApi<'Line'> | null>(null)
  const wma50Ref = useRef<ISeriesApi<'Line'> | null>(null)
  const stRef = useRef<ISeriesApi<'Line'> | null>(null)
  const klinesRef = useRef<Kline[]>([])

  // Read indicator toggles
  const indicators = useMarketStore((s) => s.market.indicators)

  // Initialize chart
  useEffect(() => {
    if (!containerRef.current) return
    const chart = createChart(containerRef.current, {
      width: containerRef.current.clientWidth,
      height: containerRef.current.clientHeight,
      layout: { background: { type: ColorType.Solid, color: COLORS.bg }, textColor: COLORS.text },
      grid: { vertLines: { color: COLORS.grid }, horzLines: { color: COLORS.grid } },
      rightPriceScale: { borderColor: COLORS.border, scaleMargins: { top: 0.05, bottom: 0.15 } },
      timeScale: { borderColor: COLORS.border, timeVisible: false, secondsVisible: false, rightOffset: 12 },
      crosshair: { mode: CrosshairMode.Normal },
      handleScroll: { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: true },
      handleScale: { mouseWheel: true, pinch: true, axisPressedMouseMove: true },
    })
    chartRef.current = chart

    // Candlestick
    candleRef.current = chart.addCandlestickSeries({
      upColor: COLORS.bullCandle,
      downColor: COLORS.bearCandle,
      borderUpColor: COLORS.bullCandle,
      borderDownColor: COLORS.bearCandle,
      wickUpColor: COLORS.bullWick,
      wickDownColor: COLORS.bearWick,
    })

    // Volume histogram
    volRef.current = chart.addHistogramSeries({
      color: COLORS.volume,
      priceFormat: { type: 'volume' },
      priceScaleId: 'vol',
      lastValueVisible: false,
      priceLineVisible: false,
    })
    chart.priceScale('vol').applyOptions({
      scaleMargins: { top: 0.8, bottom: 0 },
      borderVisible: false,
      visible: false,
    })

    // EMA 50
    ema50Ref.current = chart.addLineSeries({
      color: COLORS.ema50,
      lineWidth: 1,
      priceLineVisible: false,
      lastValueVisible: false,
    })

    // EMA 200
    ema200Ref.current = chart.addLineSeries({
      color: COLORS.ema200,
      lineWidth: 1,
      priceLineVisible: false,
      lastValueVisible: false,
    })

    // WMA 20
    wma20Ref.current = chart.addLineSeries({
      color: COLORS.wma20,
      lineWidth: 1,
      priceLineVisible: false,
      lastValueVisible: false,
    })

    // WMA 50 (dashed)
    wma50Ref.current = chart.addLineSeries({
      color: COLORS.wma50,
      lineWidth: 1,
      priceLineVisible: false,
      lastValueVisible: false,
      lineStyle: LineStyle.Dashed,
    })

    // SuperTrend
    stRef.current = chart.addLineSeries({
      color: COLORS.st,
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: false,
    })

    // Resize observer
    const ro = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect
      chart.resize(width, height)
    })
    ro.observe(containerRef.current)

    return () => {
      ro.disconnect()
      chart.remove()
      chartRef.current = null
    }
  }, [])

  // Toggle indicator visibility when store changes
  useEffect(() => {
    if (ema50Ref.current) ema50Ref.current.applyOptions({ visible: indicators.ema })
    if (ema200Ref.current) ema200Ref.current.applyOptions({ visible: indicators.ema })
    if (wma20Ref.current) wma20Ref.current.applyOptions({ visible: indicators.wma })
    if (wma50Ref.current) wma50Ref.current.applyOptions({ visible: indicators.wma })
    if (stRef.current) stRef.current.applyOptions({ visible: indicators.st })
  }, [indicators.ema, indicators.wma, indicators.st])

  // Set full kline data
  const onKlinesLoaded = useCallback((klines: Kline[]) => {
    klinesRef.current = klines
    if (!candleRef.current || !volRef.current) return

    const ts = (t: number) => t as UTCTimestamp

    candleRef.current.setData(
      klines.map((k) => ({ time: ts(k.time), open: k.open, high: k.high, low: k.low, close: k.close })),
    )
    volRef.current.setData(
      klines.map((k) => ({
        time: ts(k.time),
        value: k.volume,
        color: k.close >= k.open ? COLORS.volBull : COLORS.volBear,
      })),
    )

    const closes = klines.map((k) => k.close)

    // EMA
    if (closes.length >= 50 && ema50Ref.current) {
      ema50Ref.current.setData(
        calcEMA(closes, 50).map((v, i) => ({ time: ts(klines[i].time), value: v })),
      )
    }
    if (closes.length >= 200 && ema200Ref.current) {
      ema200Ref.current.setData(
        calcEMA(closes, 200).map((v, i) => ({ time: ts(klines[i].time), value: v })),
      )
    }

    // WMA
    if (wma20Ref.current) {
      const wma20 = calcWMA(closes, 20)
      wma20Ref.current.setData(
        wma20
          .map((v, i) => v !== null ? { time: ts(klines[i].time), value: v } : null)
          .filter((d): d is { time: UTCTimestamp; value: number } => d !== null),
      )
    }
    if (wma50Ref.current) {
      const wma50 = calcWMA(closes, 50)
      wma50Ref.current.setData(
        wma50
          .map((v, i) => v !== null ? { time: ts(klines[i].time), value: v } : null)
          .filter((d): d is { time: UTCTimestamp; value: number } => d !== null),
      )
    }

    // SuperTrend
    if (stRef.current) {
      const atr = calcATRLast(klines, 14)
      if (atr !== null) {
        const stData = calcSuperTrend(klines, closes, atr, 3)
        stRef.current.setData(
          stData.map((d) => ({ time: ts(d.time), value: d.value })),
        )
      }
      // Store ATR for brain engine
      useMarketStore.getState().patch({ atr })
    }

    chartRef.current?.timeScale().scrollToRealTime()

    // Store klines in marketStore for brain engine
    useMarketStore.getState().patch({ klines })
  }, [])

  // Update single bar
  const onKlineUpdate = useCallback((bar: Kline) => {
    if (!candleRef.current || !volRef.current) return

    const klines = klinesRef.current
    const last = klines[klines.length - 1]
    if (last && last.time === bar.time) {
      klines[klines.length - 1] = bar
    } else {
      klines.push(bar)
      if (klines.length > 1500) klines.shift()
    }

    const t = bar.time as UTCTimestamp
    candleRef.current.update({ time: t, open: bar.open, high: bar.high, low: bar.low, close: bar.close })
    volRef.current.update({
      time: t,
      value: bar.volume,
      color: bar.close >= bar.open ? COLORS.volBull : COLORS.volBear,
    })

    // Update klines in store for brain engine
    useMarketStore.getState().patch({ klines })
  }, [])

  // Connect to Binance data
  useMarketData(onKlinesLoaded, onKlineUpdate)

  return <div ref={containerRef} className="zr-chart-container" />
}
