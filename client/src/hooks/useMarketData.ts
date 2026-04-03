/**
 * Fetches klines from Binance and subscribes to live updates.
 * Updates marketStore with price and kline data.
 */
import { useEffect, useRef } from 'react'
import { useMarketStore } from '../stores'

const BINANCE_REST = 'https://fapi.binance.com'
const BINANCE_WS = 'wss://fstream.binance.com/ws'

export interface Kline {
  time: number
  open: number
  high: number
  low: number
  close: number
  volume: number
}

function parseKlines(raw: number[][]): Kline[] {
  return raw
    .map((k) => ({
      time: Math.floor((k[0] as number) / 1000),
      open: +k[1],
      high: +k[2],
      low: +k[3],
      close: +k[4],
      volume: +k[5],
    }))
    .filter((k) => k.open > 0 && k.high >= k.low && k.close > 0)
}

export function useMarketData(
  onKlinesLoaded?: (klines: Kline[]) => void,
  onKlineUpdate?: (bar: Kline) => void,
) {
  const symbol = useMarketStore((s) => s.market.symbol)
  const chartTf = useMarketStore((s) => s.market.chartTf)
  const setPrice = useMarketStore((s) => s.setPrice)
  const wsRef = useRef<WebSocket | null>(null)
  const genRef = useRef(0)

  useEffect(() => {
    const gen = ++genRef.current
    let ws: WebSocket | null = null

    async function fetchAndSubscribe() {
      // Fetch klines
      try {
        const url = `${BINANCE_REST}/fapi/v1/klines?symbol=${symbol}&interval=${chartTf}&limit=1000`
        const res = await fetch(url, { signal: AbortSignal.timeout(10000) })
        if (!res.ok || gen !== genRef.current) return
        const raw = await res.json()
        if (gen !== genRef.current) return

        const klines = parseKlines(raw)
        if (klines.length > 0) {
          setPrice(klines[klines.length - 1].close)
          onKlinesLoaded?.(klines)
        }
      } catch {
        // Will retry on next symbol/tf change
        return
      }

      // Subscribe to live kline WS
      if (gen !== genRef.current) return
      const symLow = symbol.toLowerCase()
      ws = new WebSocket(`${BINANCE_WS}/${symLow}@kline_${chartTf}`)
      wsRef.current = ws

      ws.onmessage = (e) => {
        if (gen !== genRef.current) return
        try {
          const j = JSON.parse(e.data)
          const k = j.k
          const bar: Kline = {
            time: Math.floor(k.t / 1000),
            open: +k.o,
            high: +k.h,
            low: +k.l,
            close: +k.c,
            volume: +k.v,
          }
          if (bar.close > 0) {
            setPrice(bar.close)
            onKlineUpdate?.(bar)
          }
        } catch {
          // ignore malformed
        }
      }
    }

    fetchAndSubscribe()

    return () => {
      genRef.current++
      if (ws) {
        ws.close()
        ws = null
      }
      if (wsRef.current === ws) wsRef.current = null
    }
  }, [symbol, chartTf, setPrice, onKlinesLoaded, onKlineUpdate])
}
