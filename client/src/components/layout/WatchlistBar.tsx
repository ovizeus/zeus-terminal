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
  useEffect(() => {
    const streams = WATCHLIST_SYMBOLS.map(s => s.toLowerCase() + '@miniTicker').join('/')
    const url = `wss://fstream.binance.com/stream?streams=${streams}`

    let ws: WebSocket
    let reconnectTimer: ReturnType<typeof setTimeout>

    function connect() {
      ws = new WebSocket(url)
      wsRef.current = ws

      ws.onmessage = (e) => {
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

      ws.onclose = () => {
        reconnectTimer = setTimeout(connect, 5000)
      }

      ws.onerror = () => {
        ws.close()
      }
    }

    connect()

    return () => {
      clearTimeout(reconnectTimer)
      if (wsRef.current) {
        wsRef.current.onclose = null // prevent reconnect on cleanup
        wsRef.current.close()
      }
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
            onClick={() => patch({ symbol: sym })}
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
