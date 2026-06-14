/**
 * Position price feed — keeps `w.allPrices` populated for the symbols of OPEN
 * positions, so per-position PnL is correct even when the position's symbol is
 * neither the chart symbol nor in the watchlist.
 *
 * Root cause it fixes: getSymPrice() falls back to `pos.entry` for any symbol
 * not in w.allPrices/w.wlPrices/chart → diff 0 → PnL 0. Server-authoritative AT
 * positions are frequently off-chart (BTC/ETH/BNB while the chart is elsewhere),
 * so they showed 0 PnL in both the AT panel and DSL. We poll the server's
 * Binance-proxied 24hr ticker (reliable for any symbol, even when the client's
 * direct WS is filtered) and write lastPrice into w.allPrices.
 */

import { usePositionsStore } from '../stores/positionsStore'

const w = window as any

/** Collect unique symbols of all OPEN positions (demo + live, auto + manual).
 *  Reads BOTH the React positionsStore (the source the panels actually render —
 *  populated by the positions.changed WS via applyDelta) AND the legacy w.TP
 *  arrays (client-opened positions before server register). Server-authoritative
 *  AT positions live ONLY in the React store, so reading w.TP alone missed them. */
export function collectOpenSymbols(): string[] {
  const out = new Set<string>()
  const push = (arr: any[]) => {
    if (!Array.isArray(arr)) return
    for (const p of arr) {
      if (!p || p.closed) continue
      const s = p.sym || p.symbol
      if (s) out.add(String(s).toUpperCase())
    }
  }
  try { push(w.TP?.demoPositions); push(w.TP?.livePositions) } catch (_) { /* defensive */ }
  try {
    const st = usePositionsStore.getState()
    push(st.demoPositions); push(st.livePositions)
  } catch (_) { /* defensive */ }
  return Array.from(out)
}

/** Write lastPrice into w.allPrices for each valid ticker. Returns updated symbols. */
export function applyTickerPrices(tickers: any[]): string[] {
  if (!Array.isArray(tickers)) return []
  if (!w.allPrices) w.allPrices = {}
  const updated: string[] = []
  for (const t of tickers) {
    if (!t || !t.symbol) continue
    const px = parseFloat(t.lastPrice)
    if (Number.isFinite(px) && px > 0) {
      w.allPrices[t.symbol] = px
      updated.push(t.symbol)
    }
  }
  return updated
}

/** One poll cycle: gather open-position symbols, fetch their prices, update
 *  w.allPrices, then nudge the position panels to recompute PnL. */
export async function pollPositionPrices(): Promise<void> {
  const syms = collectOpenSymbols()
  if (syms.length === 0) return
  try {
    const url = '/api/market/ticker24hr?symbols=' + encodeURIComponent(JSON.stringify(syms))
    const r = await fetch(url, { signal: AbortSignal.timeout(8000) })
    if (!r.ok) return
    const body = await r.json()
    const list = Array.isArray(body) ? body : (body && body.data) || []
    const updated = applyTickerPrices(list)
    if (updated.length) {
      // New prices are in w.allPrices; nudge the position rows to recompute pnl
      // by re-setting the store arrays with fresh refs (same objects). We must
      // NOT call renderDemoPositions here — it copies from w.TP, which is empty
      // on the server-authoritative path and would WIPE the store's positions.
      try {
        const ps = usePositionsStore.getState()
        ps.setDemoPositions(ps.demoPositions.slice())
        ps.setLivePositions(ps.livePositions.slice())
      } catch (_) { /* render nudge optional */ }
    }
  } catch (_) { /* quiet — best-effort price feed */ }
}

let _timer: any = null
/** Start the periodic feed once. Idempotent. */
export function startPositionPriceFeed(intervalMs = 6000): void {
  if (w.__ZEUS_POS_PRICE_FEED__) return
  w.__ZEUS_POS_PRICE_FEED__ = true
  pollPositionPrices()
  _timer = setInterval(pollPositionPrices, intervalMs)
}

/** Stop the feed (test/cleanup). */
export function stopPositionPriceFeed(): void {
  if (_timer) { clearInterval(_timer); _timer = null }
  w.__ZEUS_POS_PRICE_FEED__ = false
}
