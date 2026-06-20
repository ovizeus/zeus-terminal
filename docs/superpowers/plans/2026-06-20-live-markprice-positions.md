# Live markPrice for All Positions — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Zeus reads the exchange's live markPrice (second-by-second) for EVERY open position, so per-position PnL matches Binance instead of being recomputed from a polled lastPrice.

**Architecture:** Root cause (proven): `getSymPrice()` reads `w.allPrices[sym]`, which for off-chart position symbols is filled by `positionPriceFeed` with the **lastPrice** of a polled 24hr ticker — while Binance computes PnL from **markPrice**. The server already streams Binance `@markPrice@1s` and proxies it to the client as a `market.price` message, but the client handler only applies it to the CHART symbol (`if (msg.symbol !== sym) return`). Fix: subscribe each open-position symbol to the server feed and write its live `market.price` (markPrice) into `w.allPrices`, so PnL/DSL/everything downstream uses the exchange's live markPrice.

**Tech Stack:** TS + Vite + vitest (`cd client && sudo -u zeus npx vitest run <file>`). Client WS bridge `wsMarketBridge` (`subscribeSymbol`, `on('market.price', …)`). Build `cd /opt/zeus-terminal/client && sudo -u zeus npm run build`; `chown -R zeus:zeus public/app` from repo root.

**Rules:** TDD for the pure helper; money-path (position PnL display) → verify the fixed PnL equals `/api/positions` (Binance markPrice) live before claiming done; one batched deploy; GET operator GO before deploy.

---

## File structure
- **Modify** `client/src/data/positionPriceFeed.ts` — add `_positionMarkPrice` pure helper; subscribe open-position symbols; install a `market.price` handler that writes live markPrice into `w.allPrices`; make the lastPrice poll a non-clobbering fallback.
- **Modify** `client/src/data/__tests__/positionPriceFeed.test.ts` — vitest for the helper.
- **Modify** `server/version.js` — bump at deploy.

---

## Task 1: `_positionMarkPrice` pure helper (TDD)

**Files:** Modify `client/src/data/positionPriceFeed.ts`; Modify `client/src/data/__tests__/positionPriceFeed.test.ts`

- [ ] **Step 1: Write the failing test** — append to `client/src/data/__tests__/positionPriceFeed.test.ts`:

```ts
import { _positionMarkPrice } from '../positionPriceFeed'

describe('_positionMarkPrice', () => {
  const open = new Set(['BTCUSDT', 'ETHUSDT'])
  it('returns {symbol, price} for an open-position symbol with a valid markPrice', () => {
    expect(_positionMarkPrice({ symbol: 'BTCUSDT', price: '63700.5' }, open)).toEqual({ symbol: 'BTCUSDT', price: 63700.5 })
  })
  it('uppercases the symbol before matching', () => {
    expect(_positionMarkPrice({ symbol: 'btcusdt', price: 100 }, open)).toEqual({ symbol: 'BTCUSDT', price: 100 })
  })
  it('returns null for a symbol not in the open set', () => {
    expect(_positionMarkPrice({ symbol: 'SOLUSDT', price: 150 }, open)).toBeNull()
  })
  it('returns null for an invalid / non-positive price', () => {
    expect(_positionMarkPrice({ symbol: 'BTCUSDT', price: '0' }, open)).toBeNull()
    expect(_positionMarkPrice({ symbol: 'BTCUSDT', price: 'x' }, open)).toBeNull()
    expect(_positionMarkPrice({ symbol: 'BTCUSDT' }, open)).toBeNull()
  })
})
```

- [ ] **Step 2: Run to verify fail**

```
cd /opt/zeus-terminal/client && sudo -u zeus npx vitest run src/data/__tests__/positionPriceFeed.test.ts 2>&1 | tail -12
```
Expected: FAIL — `_positionMarkPrice` not exported.

- [ ] **Step 3: Implement** — add to `client/src/data/positionPriceFeed.ts` (top-level export):

```ts
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
```

- [ ] **Step 4: Run to verify pass**

```
cd /opt/zeus-terminal/client && sudo -u zeus npx vitest run src/data/__tests__/positionPriceFeed.test.ts 2>&1 | tail -8
```
Expected: PASS.

- [ ] **Step 5: Commit**

```
cd /opt/zeus-terminal && git add client/src/data/positionPriceFeed.ts client/src/data/__tests__/positionPriceFeed.test.ts
git commit -m "feat(positions): _positionMarkPrice pure helper with tests"
```

---

## Task 2: Live markPrice handler + subscribe open positions

**Files:** Modify `client/src/data/positionPriceFeed.ts`

- [ ] **Step 1: Read the current feed** — open `client/src/data/positionPriceFeed.ts`. Note `collectOpenSymbols()` (returns the open-position symbols) and `pollPositionPrices()` (the lastPrice poll). The fix adds a live markPrice WS path that takes precedence and marks freshness so the poll won't clobber it.

- [ ] **Step 2: Install the live markPrice handler + subscriptions** — add near the top (after the `w` const) a freshness map, and an `installPositionMarkFeed()` that subscribes open-position symbols and applies their live markPrice:

```ts
import { on, subscribeSymbol } from '../services/wsMarketBridge'

// symbol → last time we wrote a live markPrice (so the lastPrice poll won't clobber it)
const _markFresh: Record<string, number> = {}
let _markFeedInstalled = false

/** Subscribe every open-position symbol to the server feed (Binance markPrice@1s) and write
 *  each incoming live markPrice into w.allPrices — so off-chart positions price off markPrice,
 *  matching Binance, live to the second. Idempotent. */
export function installPositionMarkFeed(): void {
  if (_markFeedInstalled) return
  _markFeedInstalled = true
  if (!w.allPrices) w.allPrices = {}
  on('market.price', (msg: any) => {
    const open = new Set(collectOpenSymbols())
    const r = _positionMarkPrice(msg, open)
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
```

- [ ] **Step 3: Make the lastPrice poll a non-clobbering fallback** — in `applyTickerPrices` (the function that writes `t.lastPrice` into `w.allPrices`), skip symbols that have a fresh live markPrice (written in the last 5s):

```ts
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
```

- [ ] **Step 4: Wire install + subscribe into the poll cycle** — at the start of `pollPositionPrices()`, call the install + subscribe so they run whenever positions exist (idempotent install, re-subscribe picks up new symbols):

```ts
export async function pollPositionPrices(): Promise<void> {
  installPositionMarkFeed()
  subscribePositionSymbols()
  const syms = collectOpenSymbols()
  // … existing body (the lastPrice fallback fetch) unchanged …
```

- [ ] **Step 5: Build to verify it compiles**

```
cd /opt/zeus-terminal/client && sudo -u zeus npm run build 2>&1 | grep -E "built in|error TS" | head
```
Expected: built clean.

- [ ] **Step 6: Commit**

```
cd /opt/zeus-terminal && git add client/src/data/positionPriceFeed.ts
git commit -m "feat(positions): live markPrice@1s for every open position (subscribe + apply); lastPrice poll is fallback only"
```

---

## Task 3: Deploy + verify PnL matches Binance markPrice (live)

**Files:** Modify `server/version.js`

- [ ] **Step 1: chown + bump** — `cd /opt/zeus-terminal && chown -R zeus:zeus public/app`. Bump `server/version.js` to 1.7.126 b152, changelog: positions price off live Binance markPrice@1s (per-position PnL matches the exchange, no more lastPrice). Validate `node -e "require('./server/version.js')" && echo OK`.

- [ ] **Step 2: Reload (operator GO)** — `sudo -u zeus pm2 reload zeus && sleep 3 && curl -s -o /dev/null -w "health=%{http_code}\n" http://localhost:3000/api/health` (expect 401).

- [ ] **Step 3: Headless verify (the proof)** — mint uid=1 token; load app; wait for positions; read, for each open position, the client's price source `w.allPrices[sym]` and compare to the authoritative Binance markPrice from `GET /api/positions` (its `unrealizedPnL` is markPrice-based — derive `markPx = entryPrice + (-unrealizedPnL/size)` for SHORT, symmetric for LONG). Assert `|w.allPrices[sym] − markPx|` is tiny (sub-dollar, i.e. they track the same markPrice), NOT the tens-of-dollars lastPrice gap. Re-read after ~3s to confirm `w.allPrices[sym]` updates live (changes between reads). 0 page/console errors. Screenshot; delete it after.

- [ ] **Step 4: Commit + push (after GO)**

```
git add server/version.js
git commit -m "release: live markPrice for all positions — b152"
git push origin main
```

---

## Rollback
Pure client change. Revert the commits → positions price off the polled lastPrice again (the prior behavior). No server/brain/trading change.

## Self-review
- **Root-cause coverage:** off-chart positions priced off lastPrice (proven) → now subscribed to live markPrice@1s and applied to w.allPrices (T2) ✓; getSymPrice reads w.allPrices first, so PnL/DSL now use markPrice ✓; lastPrice poll demoted to non-clobbering fallback (T2 S3) ✓; live to the second = the WS markPrice@1s stream (server already runs it) ✓.
- **Type/name consistency:** `_positionMarkPrice(msg, openSyms:Set<string>) → {symbol,price}|null`, `installPositionMarkFeed()`, `subscribePositionSymbols()`, `_markFresh` map, `collectOpenSymbols()` (existing) — consistent across tasks.
- **Placeholder scan:** all steps concrete. T2 S4 references "existing body unchanged" of `pollPositionPrices` — that's the real existing function (only prepending two calls), not a placeholder.
- **Verification:** T3 S3 proves the fixed PnL tracks Binance markPrice (sub-dollar) and updates live — the money-path proof the operator asked for.
