import { useEffect, useRef } from 'react'
import { useMarketStore } from '../../stores'

const WATCHLIST_SYMBOLS = [
  'BTCUSDT',
  'ETHUSDT',
  'SOLUSDT',
  'BNBUSDT',
  'XRPUSDT',
  'DOGEUSDT',
  'ADAUSDT',
  'ZECUSDT',
] as const

function shortName(sym: string): string {
  return sym.replace('USDT', '')
}

/** Format price — same logic as symbols.js line 49:
 *  >= 1000 → comma-separated, >= 1 → 3 decimals, else 4 sig figs */
function fmtPrice(p: number): string {
  if (p >= 1000) return '$' + p.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })
  if (p >= 1) return '$' + p.toFixed(3)
  return '$' + p.toPrecision(4)
}

export default function WatchlistBar() {
  const symbol = useMarketStore((s) => s.market.symbol)
  const patch = useMarketStore((s) => s.patch)
  const wlPrices = useMarketStore((s) => s.wlPrices)
  const setWlPrice = useMarketStore((s) => s.setWlPrice)
  const wsRef = useRef<WebSocket | null>(null)

  // Connect to Binance miniTicker for watchlist symbols (1:1 with connectWatchlist in symbols.js)
  // When the bridge is active, it opens its own WS via connectWatchlist() and emits
  // 'zeus:wlPrice' events. In that case we close our raw WS to avoid double connections.
  useEffect(() => {
    const streams = WATCHLIST_SYMBOLS.map(s => s.toLowerCase() + '@miniTicker').join('/')
    const url = `wss://fstream.binance.com/stream?streams=${streams}`

    let ws: WebSocket | null = null
    let reconnectTimer: ReturnType<typeof setTimeout>
    let bridgeActive = false

    function closeRawWs() {
      clearTimeout(reconnectTimer)
      if (ws) {
        ws.onclose = null
        ws.onerror = null
        ws.close()
        ws = null
        wsRef.current = null
      }
    }

    function connect() {
      if (bridgeActive) return
      const _ws = new WebSocket(url)
      ws = _ws
      wsRef.current = _ws

      _ws.onmessage = (e) => {
        try {
          const j = JSON.parse(e.data)
          if (!j.data) return
          const d = j.data
          const sym: string = d.s
          const price = +d.c
          const open = +d.o
          const chg = (price - open) / open * 100
          setWlPrice(sym, price, chg)
        } catch { /* ignore parse errors */ }
      }

      _ws.onclose = () => {
        if (!bridgeActive) reconnectTimer = setTimeout(connect, 5000)
      }

      _ws.onerror = () => { _ws.close() }
    }

    // When bridge WS (connectWatchlist) starts sending data it emits 'zeus:wlPrice'.
    // On first such event: close our raw WS (no more duplicate), keep listening to events.
    // We do NOT close on zeus:bridgeReady because connectWatchlist() runs 1500ms later
    // (inside startApp phase-3 setTimeout), so bridgeReady fires too early.
    function onWlPrice(e: Event) {
      const { sym, price, chg } = (e as CustomEvent).detail
      setWlPrice(sym, price, chg)
      if (!bridgeActive) {
        // First event from bridge WS → close raw WS to eliminate duplicate connection
        bridgeActive = true
        closeRawWs()
      }
    }

    window.addEventListener('zeus:wlPrice', onWlPrice)
    connect()

    return () => {
      window.removeEventListener('zeus:wlPrice', onWlPrice)
      clearTimeout(reconnectTimer)
      closeRawWs()
    }
  }, [setWlPrice])

  return (
    <div className="wl-bar" id="wlBar">
      {WATCHLIST_SYMBOLS.map((sym) => {
        const data = wlPrices[sym]
        return (
          <div
            key={sym}
            id={`wl-${sym}`}
            className={sym === symbol ? 'wl-item act' : 'wl-item'}
            onClick={() => {
              const w = window as any
              // Always update Zustand so WatchlistBar active class + ChartControls select sync
              patch({ symbol: sym })
              // switchWLSymbol → w.setSymbol() → full chart/kline/WS reset
              if (typeof w.switchWLSymbol === 'function') w.switchWLSymbol(sym)
            }}
          >
            <div className="wl-sym">{shortName(sym)}</div>
            <div className="wl-price" id={`wlp-${sym}`}>
              {data ? fmtPrice(data.price) : '\u2014'}
            </div>
            <div className={`wl-chg${data ? (data.chg >= 0 ? ' up' : ' dn') : ''}`} id={`wlc-${sym}`}>
              {data ? `${data.chg >= 0 ? '+' : ''}${data.chg.toFixed(2)}%` : '\u2014'}
            </div>
          </div>
        )
      })}
    </div>
  )
}
