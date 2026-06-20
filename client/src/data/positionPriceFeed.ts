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
import { on, subscribeSymbol } from '../services/wsMarketBridge'

const w = window as any

// symbol → last time we wrote a live markPrice (so the lastPrice poll won't clobber it)
const _markFresh: Record<string, number> = {}
let _markFeedInstalled = false

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

/** Pure: given a server `market.price` message (carries Binance markPrice@1s) and the set of
 *  open-position symbols, return the {symbol, price} to write into w.allPrices, or null when the
 *  symbol isn't an open position or the price is invalid. */
export function _positionMarkPrice(msg: any, openSyms: Set<string>): { symbol: string; price: number } | null {
  if (!msg || !msg.symbol) return null
  const sym = String(msg.symbol).toUpperCase()
  if (!openSyms.has(sym)) return null
  const px = parseFloat(msg.price)
  if (!Number.isFinite(px) || px <= 0) return null
  return { symbol: sym, price: px }
}

/** Subscribe every open-position symbol to the server feed (Binance markPrice@1s) and write each
 *  incoming live markPrice into w.allPrices — so off-chart positions price off markPrice, matching
 *  Binance, live to the second. Idempotent (the handler installs once). */
export function installPositionMarkFeed(): void {
  if (_markFeedInstalled) return
  _markFeedInstalled = true
  if (!w.allPrices) w.allPrices = {}
  on('market.price', (msg: any) => {
    const r = _positionMarkPrice(msg, new Set(collectOpenSymbols()))
    if (!r) return
    w.allPrices[r.symbol] = r.price
    _markFresh[r.symbol] = Date.now()
  })
}

/** Ensure the server is streaming markPrice for every current open-position symbol. */
export function subscribePositionSymbols(): void {
  for (const sym of collectOpenSymbols()) {
    try { subscribeSymbol(sym) } catch (_) { /* defensive */ }
  }
}

/** Write lastPrice into w.allPrices for each valid ticker. Returns updated symbols. */
export function applyTickerPrices(tickers: any[]): string[] {
  if (!Array.isArray(tickers)) return []
  if (!w.allPrices) w.allPrices = {}
  const updated: string[] = []
  for (const t of tickers) {
    if (!t || !t.symbol) continue
    const sym = String(t.symbol).toUpperCase()
    // live markPrice wins — don't clobber a fresh markPrice with a polled lastPrice
    if (_markFresh[sym] && (Date.now() - _markFresh[sym]) < 5000) continue
    const px = parseFloat(t.lastPrice)
    if (Number.isFinite(px) && px > 0) {
      w.allPrices[sym] = px
      updated.push(sym)
    }
  }
  return updated
}

/** One poll cycle: gather open-position symbols, fetch their prices, update
 *  w.allPrices, then nudge the position panels to recompute PnL. */
export async function pollPositionPrices(): Promise<void> {
  installPositionMarkFeed()   // live Binance markPrice@1s → w.allPrices (primary)
  subscribePositionSymbols()  // ensure the server streams markPrice for every open symbol
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
