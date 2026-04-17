/**
 * Fetches klines from Binance and subscribes to live updates.
 * Updates marketStore with price and kline data.
 */
import { useEffect, useRef } from 'react'
import { useMarketStore } from '../stores'

const BINANCE_REST = 'https://fapi.binance.com'


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
  _onKlineUpdate?: (bar: Kline) => void,
) {
  const symbol = useMarketStore((s) => s.market.symbol)
  const chartTf = useMarketStore((s) => s.market.chartTf)
  const setPrice = useMarketStore((s) => s.setPrice)
  const genRef = useRef(0)

  useEffect(() => {
    const gen = ++genRef.current

    // React does ONE REST fetch for initial klines so chart renders fast.
    // Old JS bridge (marketData.js) opens the kline WS and handles all live
    // updates via cSeries.setData/update through bridge globals.
    // No React WS — eliminates duplicate Binance kline connections.
    async function fetchInitial() {
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
        // Old JS will load klines when bridge starts — not critical
      }
    }

    fetchInitial()

    return () => { genRef.current++ }
  }, [symbol, chartTf, setPrice, onKlinesLoaded, _onKlineUpdate])
}
