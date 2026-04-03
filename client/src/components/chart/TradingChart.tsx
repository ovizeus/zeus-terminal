import { useEffect, useRef, useCallback } from 'react'
import {
  createChart,
  ColorType,
  type IChartApi,
  type ISeriesApi,
  CrosshairMode,
} from 'lightweight-charts'
import { useMarketData, type Kline } from '../../hooks/useMarketData'

/** Chart colors — will read from CSS vars in future phases */
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
  volume: '#00b8d422',
  volBull: '#00d97a44',
  volBear: '#ff335544',
}

function calcEMA(closes: number[], period: number): number[] {
  const k = 2 / (period + 1)
  let ema = closes[0]
  return closes.map((v) => {
    ema = v * k + ema * (1 - k)
    return ema
  })
}

export function TradingChart() {
  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const candleRef = useRef<ISeriesApi<'Candlestick'> | null>(null)
  const volRef = useRef<ISeriesApi<'Histogram'> | null>(null)
  const ema50Ref = useRef<ISeriesApi<'Line'> | null>(null)
  const ema200Ref = useRef<ISeriesApi<'Line'> | null>(null)
  const klinesRef = useRef<Kline[]>([])

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
    })
    chartRef.current = chart

    // Candlestick series
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

  // Set full kline data
  const onKlinesLoaded = useCallback((klines: Kline[]) => {
    klinesRef.current = klines
    if (!candleRef.current || !volRef.current) return

    candleRef.current.setData(
      klines.map((k) => ({ time: k.time as import('lightweight-charts').UTCTimestamp, open: k.open, high: k.high, low: k.low, close: k.close })),
    )
    volRef.current.setData(
      klines.map((k) => ({
        time: k.time as import('lightweight-charts').UTCTimestamp,
        value: k.volume,
        color: k.close >= k.open ? COLORS.volBull : COLORS.volBear,
      })),
    )

    // EMA
    const closes = klines.map((k) => k.close)
    if (closes.length >= 50 && ema50Ref.current) {
      ema50Ref.current.setData(
        calcEMA(closes, 50).map((v, i) => ({ time: klines[i].time as import('lightweight-charts').UTCTimestamp, value: v })),
      )
    }
    if (closes.length >= 200 && ema200Ref.current) {
      ema200Ref.current.setData(
        calcEMA(closes, 200).map((v, i) => ({ time: klines[i].time as import('lightweight-charts').UTCTimestamp, value: v })),
      )
    }

    chartRef.current?.timeScale().scrollToRealTime()
  }, [])

  // Update single bar
  const onKlineUpdate = useCallback((bar: Kline) => {
    if (!candleRef.current || !volRef.current) return

    // Update or append to local klines
    const klines = klinesRef.current
    const last = klines[klines.length - 1]
    if (last && last.time === bar.time) {
      klines[klines.length - 1] = bar
    } else {
      klines.push(bar)
      if (klines.length > 1500) klines.shift()
    }

    const ts = bar.time as import('lightweight-charts').UTCTimestamp
    candleRef.current.update({ time: ts, open: bar.open, high: bar.high, low: bar.low, close: bar.close })
    volRef.current.update({
      time: ts,
      value: bar.volume,
      color: bar.close >= bar.open ? COLORS.volBull : COLORS.volBear,
    })
  }, [])

  // Connect to Binance data
  useMarketData(onKlinesLoaded, onKlineUpdate)

  return <div ref={containerRef} className="zr-chart-container" />
}
