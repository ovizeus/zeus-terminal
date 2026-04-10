// Zeus — OKX Liquidation WebSocket connector
const w = window as any

let _ws: WebSocket | null = null
let _reconnTimer: any = null

export function connectOKXLiq(): void {
  if (_ws && _ws.readyState <= 1) return
  try {
    _ws = new WebSocket('wss://ws.okx.com:8443/ws/v5/public')
    _ws.onopen = () => {
      if (!w.S) return
      w.S._okxLiqConnected = true
      _ws!.send(JSON.stringify({
        op: 'subscribe',
        args: [{ channel: 'liquidation-orders', instType: 'SWAP', instFamily: 'BTC-USDT' }]
      }))
      console.log('[OKX-LIQ] WS connected — liquidation stream active')
    }
    _ws.onmessage = (e: MessageEvent) => {
      try {
        const m = JSON.parse(e.data)
        if (m.data && m.data.length) {
          m.data.forEach((d: any) => {
            const isBtc = d.instId && d.instId.includes('BTC')
            if (!isBtc) return
            const liq = {
              p: +d.bkPx || +d.markPx || 0,
              q: +d.sz || 0,
              vol: (+d.bkPx || +d.markPx || 0) * (+d.sz || 0),
              side: d.side === 'sell' ? 'SELL' : 'BUY',
              time: +d.ts || Date.now(),
              exchange: 'OKX'
            }
            if (liq.vol > 0) {
              if (!w.S._okxLiqs) w.S._okxLiqs = []
              w.S._okxLiqs.push(liq)
              if (w.S._okxLiqs.length > 300) w.S._okxLiqs.shift()
              // Emit custom event for Quant Monitor and other consumers
              window.dispatchEvent(new CustomEvent('zeus:okxLiq', { detail: liq }))
            }
          })
        }
      } catch (_) { /* silent */ }
    }
    _ws.onclose = () => {
      if (w.S) w.S._okxLiqConnected = false
      _reconnTimer = setTimeout(connectOKXLiq, 5000)
    }
    _ws.onerror = () => { if (w.S) w.S._okxLiqConnected = false }
  } catch (_) { /* silent */ }
}

export function disconnectOKXLiq(): void {
  if (_reconnTimer) { clearTimeout(_reconnTimer); _reconnTimer = null }
  if (_ws) { try { _ws.close() } catch (_) { /* silent */ } _ws = null }
  if (w.S) w.S._okxLiqConnected = false
}
