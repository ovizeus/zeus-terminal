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

// symbol → last time we wrote a live markPrice (so the slow lastPrice fallback won't clobber it)
const _markFresh: Record<string, number> = {}

// symbol → live Binance markPrice. DEDICATED, authoritative store written ONLY by the markPrice feed.
// ROOT CAUSE (2026-06-21): the shared `w.allPrices` map is continuously overwritten with lastPrice by
// the high-frequency watchlist + chart WS feeds (services/symbols.ts:63/119, core/managers.ts:122),
// which have no markPrice guard. So the markPrice we wrote was clobbered ~instantly and positions were
// priced off lastPrice → PnL desynced from Binance (which prices off markPrice) by the last↔mark spread.
// Positions now read markPrice from HERE, where no lastPrice feed can reach it.
const _markPx: Record<string, number> = {}

/** Record a fresh markPrice for a symbol (called by pollMarkPrices and tests). */
export function _recordMarkPx(sym: string, price: number, now = Date.now()): void {
  const s = String(sym).toUpperCase()
  _markPx[s] = price
  _markFresh[s] = now
}

/** Authoritative live markPrice for a position symbol, or null when absent/stale/invalid.
 *  Decoupled from w.allPrices so the high-frequency lastPrice feeds cannot clobber it. */
export function markPxFor(sym: string, maxAgeMs = 15000, now = Date.now()): number | null {
  const s = String(sym).toUpperCase()
  const ts = _markFresh[s]
  const px = _markPx[s]
  if (ts && (now - ts) < maxAgeMs && Number.isFinite(px) && px > 0) return px
  return null
}

/** Test helper: clear the dedicated markPrice store. */
export function _clearMarkPx(): void {
  for (const k of Object.keys(_markPx)) delete _markPx[k]
  for (const k of Object.keys(_markFresh)) delete _markFresh[k]
}

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

/** Fast poll (~1s): fetch live Binance markPrice (server premiumIndex cache) for every open-position
 *  symbol and write it into w.allPrices — so position PnL prices off the exchange's markPrice, to the
 *  second, matching Binance. Binance's markPrice@1s WS is Hetzner-blocked, so this REST cache is the
 *  live source; the slow lastPrice ticker poll stays only as a fallback (skips fresh markPrice). */
export async function pollMarkPrices(): Promise<void> {
  const syms = collectOpenSymbols()
  if (syms.length === 0) return
  try {
    const r = await fetch('/api/market/markprice?symbols=' + encodeURIComponent(syms.join(',')), { signal: AbortSignal.timeout(4000) })
    if (!r.ok) return
    const map = await r.json() // { SYM: markPrice }
    if (!w.allPrices) w.allPrices = {}
    let any = false
    const now = Date.now()
    for (const sym of Object.keys(map || {})) {
      const px = parseFloat(map[sym])
      if (Number.isFinite(px) && px > 0) {
        _recordMarkPx(sym, px, now)   // authoritative store positions read from (unclobberable)
        w.allPrices[sym] = px         // also seed the shared map (best-effort; watchlist may overwrite)
        any = true
      }
    }
    if (any) {
      try {
        const ps = usePositionsStore.getState()
        ps.setDemoPositions(ps.demoPositions.slice())
        ps.setLivePositions(ps.livePositions.slice())
      } catch (_) { /* render nudge optional */ }
    }
  } catch (_) { /* best-effort markPrice feed */ }
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
let _markTimer: any = null
/** Start the periodic feeds once. Idempotent. markPrice polls ~1s (live, primary); the lastPrice
 *  ticker polls slower as a fallback for symbols without a fresh markPrice. */
export function startPositionPriceFeed(intervalMs = 6000): void {
  if (w.__ZEUS_POS_PRICE_FEED__) return
  w.__ZEUS_POS_PRICE_FEED__ = true
  pollMarkPrices()
  _markTimer = setInterval(pollMarkPrices, 1000) // live markPrice, to the second
  pollPositionPrices()
  _timer = setInterval(pollPositionPrices, intervalMs)
}

/** Stop the feed (test/cleanup). */
export function stopPositionPriceFeed(): void {
  if (_markTimer) { clearInterval(_markTimer); _markTimer = null }
  if (_timer) { clearInterval(_timer); _timer = null }
  w.__ZEUS_POS_PRICE_FEED__ = false
}
