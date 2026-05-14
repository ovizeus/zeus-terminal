// Zeus — OKX Liquidation WebSocket connector
const w = window as any

let _ws: WebSocket | null = null
let _reconnTimer: any = null

// [WS-DIAG 2026-05-14] Centralized state tracker — see marketDataWS.ts for
// the BNB/BYB equivalent. Operator-driven post-DNS failure investigation.
function _setOkxDiag(patch: any) {
  if (!w.S) return
  w.S._wsDiag = w.S._wsDiag || { bnb: {}, byb: {}, okx: {} }
  w.S._wsDiag.okx = Object.assign({}, w.S._wsDiag.okx || {}, patch, { ts: Date.now() })
}

export function connectOKXLiq(): void {
  if (_ws && _ws.readyState <= 1) return
  try {
    _setOkxDiag({ state: 'CONNECTING', url: 'ws.okx.com', err: '' })
    _ws = new WebSocket('wss://ws.okx.com:8443/ws/v5/public')
    _ws.onopen = () => {
      if (!w.S) return
      w.S._okxLiqConnected = true
      _ws!.send(JSON.stringify({
        op: 'subscribe',
        args: [{ channel: 'liquidation-orders', instType: 'SWAP', instFamily: 'BTC-USDT' }]
      }))
      console.log('[OKX-LIQ] WS connected — liquidation stream active')
      _setOkxDiag({ state: 'OPEN', err: '' })
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
              // [WS-DIAG] count event for diag panel
              try { w.S._wsDiag.okx.ev = (w.S._wsDiag.okx.ev || 0) + 1; w.S._wsDiag.okx.lastEv = Date.now() } catch (_) {}
              // Emit custom event for Quant Monitor and other consumers
              window.dispatchEvent(new CustomEvent('zeus:okxLiq', { detail: liq }))
            }
          })
        }
      } catch (_) { /* silent */ }
    }
    _ws.onclose = (e: any) => {
      if (w.S) w.S._okxLiqConnected = false
      _setOkxDiag({ state: 'CLOSED', err: (e && e.code ? `code=${e.code}${e.reason ? ' '+e.reason : ''}` : 'unknown') })
      _reconnTimer = setTimeout(connectOKXLiq, 5000)
    }
    _ws.onerror = () => { if (w.S) w.S._okxLiqConnected = false; _setOkxDiag({ state: 'ERROR', err: 'onerror_event' }) }
  } catch (e: any) {
    _setOkxDiag({ state: 'EXCEPTION', err: e && e.message ? e.message : 'unknown' })
  }
}

export function disconnectOKXLiq(): void {
  if (_reconnTimer) { clearTimeout(_reconnTimer); _reconnTimer = null }
  if (_ws) { try { _ws.close() } catch (_) { /* silent */ } _ws = null }
  if (w.S) w.S._okxLiqConnected = false
}
