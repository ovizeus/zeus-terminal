import { useEffect, useRef } from 'react'
import { useMarketStore } from '../../stores'
import { switchWLSymbol } from '../../services/symbols'

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

  // [WS-PROXY B.6] Server proxy path for watchlist — or legacy direct WS
  useEffect(() => {
    const w = window as any
    const _useProxy = w.__MF && w.__MF.WS_PROXY_ENABLED === true

    if (_useProxy) {
      // Proxy path: listen market.wl from server /ws/sync
      const { on, subscribeWatchlist } = require('../../services/wsMarketBridge')
      const unsub = on('market.wl', (msg: any) => {
        if (msg.symbol && msg.price) setWlPrice(msg.symbol, msg.price, msg.chg || 0)
      })
      subscribeWatchlist(WATCHLIST_SYMBOLS.slice() as string[])
      return () => { unsub() }
    }

    // ── Legacy direct path ──
    const streams = WATCHLIST_SYMBOLS.map(s => s.toLowerCase() + '@miniTicker').join('/')
    const url = `wss://fstream.binance.com/stream?streams=${streams}`

    let ws: WebSocket | null = null
    let reconnectTimer: ReturnType<typeof setTimeout>
    let bridgeActive = false

    function closeRawWs() {
      clearTimeout(reconnectTimer)
      if (ws) {
        ws.onclose = null; ws.onerror = null; ws.close(); ws = null; wsRef.current = null
      }
    }

    function connect() {
      if (bridgeActive) return
      const _ws = new WebSocket(url)
      ws = _ws; wsRef.current = _ws
      _ws.onmessage = (e) => {
        try {
          const j = JSON.parse(e.data)
          if (!j.data) return
          const d = j.data
          // [AUDIT-20260619 P3] guard NaN/Infinity: if open price is 0/absent the
          // legacy miniTicker change rendered "NaN%"/"Infinity%". (Server path
          // wsMarketProxy already guards this; only this client path was exposed.)
          const _o = +d.o
          const _chg = (Number.isFinite(_o) && _o > 0) ? (+d.c - _o) / _o * 100 : 0
          setWlPrice(d.s, +d.c, _chg)
        } catch { /* ignore */ }
      }
      _ws.onclose = () => { if (!bridgeActive) reconnectTimer = setTimeout(connect, 5000) }
      _ws.onerror = () => { _ws.close() }
    }

    function onWlPrice(e: Event) {
      const { sym, price, chg } = (e as CustomEvent).detail
      setWlPrice(sym, price, chg)
      if (!bridgeActive) { bridgeActive = true; closeRawWs() }
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
              // Always update Zustand so WatchlistBar active class + ChartControls select sync
              patch({ symbol: sym })
              // switchWLSymbol → setSymbol() → full chart/kline/WS reset
              if (typeof switchWLSymbol === 'function') switchWLSymbol(sym)
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
