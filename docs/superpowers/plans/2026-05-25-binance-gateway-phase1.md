# Binance Gateway Phase 1 — Market Cache + Dedup + Client Kill

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate duplicate Binance REST calls, create central market cache, proxy client requests through server. Multi-exchange aware from day 1.

**Architecture:** `marketCache.js` is exchange-agnostic (keyed by `exchange:symbol`). Server modules write to cache after fetch, other modules read from cache. Client stops calling Binance directly — uses `/api/market/*` proxy endpoints that read from cache. WS combined stream unchanged (Phase 2).

**Tech Stack:** Node.js 22, better-sqlite3, Jest. Test runner: `/root/.nvm/versions/node/v22.22.3/bin/node /root/zeus-terminal/node_modules/.bin/jest`

---

## File Map

| File | Action | Purpose |
|------|--------|---------|
| `server/services/marketCache.js` | CREATE | Central cache with TTL + request dedup |
| `server/routes/marketProxy.js` | CREATE | `/api/market/*` proxy endpoints for client |
| `server/services/marketRadar.js` | MODIFY | Write ticker/funding/OI to cache |
| `server/services/marketFeed.js` | MODIFY | Read funding/OI from cache instead of fetching |
| `server/services/serverSentiment.js` | MODIFY | Read funding from cache |
| `server.js` | MODIFY | Mount marketProxy routes |
| `client/src/data/marketDataFeeds.ts` | MODIFY | Use /api/market/* instead of direct Binance |
| `client/src/data/basisRate.ts` | MODIFY | Use /api/market/funding instead of direct |
| `client/src/utils/guards.ts` | MODIFY | Use server time instead of Binance /time |
| `client/src/services/symbols.ts` | MODIFY | Use radar broadcast instead of direct ticker |
| `tests/unit/marketCache.test.js` | CREATE | |
| `tests/unit/marketProxy.test.js` | CREATE | |

---

### Task 1: marketCache.js — Central Cache with TTL + Request Dedup

**Files:**
- Create: `server/services/marketCache.js`
- Test: `tests/unit/marketCache.test.js`

- [ ] **Step 1: Write test**

```javascript
'use strict';

describe('marketCache', () => {
  let cache;
  beforeEach(() => {
    cache = require('../../server/services/marketCache');
    cache._resetForTest();
  });

  test('set + get returns data within TTL', () => {
    cache.set('ticker', 'binance:BTCUSDT', { price: 77000 });
    const result = cache.get('ticker', 'binance:BTCUSDT');
    expect(result).not.toBeNull();
    expect(result.price).toBe(77000);
  });

  test('get returns null after TTL expires', () => {
    cache.set('ticker', 'binance:BTCUSDT', { price: 77000 }, { ttlMs: 1 });
    // Simulate TTL expiry
    const entry = cache._getEntry('ticker', 'binance:BTCUSDT');
    entry.ts = Date.now() - 10000;
    expect(cache.get('ticker', 'binance:BTCUSDT')).toBeNull();
  });

  test('set overwrites previous value', () => {
    cache.set('oi', 'binance:BTCUSDT', 50000);
    cache.set('oi', 'binance:BTCUSDT', 60000);
    expect(cache.get('oi', 'binance:BTCUSDT')).toBe(60000);
  });

  test('getOrFetch deduplicates concurrent requests', async () => {
    let fetchCount = 0;
    const fetcher = async () => { fetchCount++; return 42; };
    const [a, b] = await Promise.all([
      cache.getOrFetch('oi', 'binance:ETHUSDT', fetcher, { ttlMs: 60000 }),
      cache.getOrFetch('oi', 'binance:ETHUSDT', fetcher, { ttlMs: 60000 }),
    ]);
    expect(a).toBe(42);
    expect(b).toBe(42);
    expect(fetchCount).toBe(1);
  });

  test('getAll returns all entries for a type', () => {
    cache.set('ticker', 'binance:BTCUSDT', { p: 1 });
    cache.set('ticker', 'binance:ETHUSDT', { p: 2 });
    cache.set('ticker', 'bybit:BTCUSDT', { p: 3 });
    const all = cache.getAll('ticker');
    expect(Object.keys(all).length).toBe(3);
  });

  test('multi-exchange keys are independent', () => {
    cache.set('oi', 'binance:BTCUSDT', 100);
    cache.set('oi', 'bybit:BTCUSDT', 200);
    expect(cache.get('oi', 'binance:BTCUSDT')).toBe(100);
    expect(cache.get('oi', 'bybit:BTCUSDT')).toBe(200);
  });

  test('stats returns hit/miss counts', () => {
    cache.set('ticker', 'binance:X', 1);
    cache.get('ticker', 'binance:X'); // hit
    cache.get('ticker', 'binance:Y'); // miss
    const stats = cache.getStats();
    expect(stats.hits).toBeGreaterThanOrEqual(1);
    expect(stats.misses).toBeGreaterThanOrEqual(1);
  });
});
```

- [ ] **Step 2: Run — FAIL (module missing)**

```bash
/root/.nvm/versions/node/v22.22.3/bin/node /root/zeus-terminal/node_modules/.bin/jest tests/unit/marketCache.test.js --forceExit --no-coverage
```

- [ ] **Step 3: Create marketCache.js**

```javascript
'use strict';

// Exchange-agnostic market data cache with TTL + request deduplication.
// Keys: 'exchange:SYMBOL' (e.g., 'binance:BTCUSDT', 'bybit:BTCUSDT')
// Types: ticker, klines, oi, funding, depth, sentiment, time

const DEFAULT_TTL = {
    ticker: 60000,    // 60s
    klines: 60000,    // 60s
    oi: 120000,       // 2min
    funding: 300000,  // 5min
    depth: 60000,     // 60s
    sentiment: 300000, // 5min
    time: 300000,     // 5min
};

const _store = new Map();   // type → Map(key → { data, ts, ttlMs })
const _inflight = new Map(); // dedup key → Promise
let _hits = 0, _misses = 0;

function _bucket(type) {
    if (!_store.has(type)) _store.set(type, new Map());
    return _store.get(type);
}

function set(type, key, data, opts) {
    const ttlMs = (opts && opts.ttlMs) || DEFAULT_TTL[type] || 60000;
    _bucket(type).set(key, { data, ts: Date.now(), ttlMs });
}

function get(type, key) {
    const bucket = _bucket(type);
    const entry = bucket.get(key);
    if (!entry) { _misses++; return null; }
    if (Date.now() - entry.ts > entry.ttlMs) { _misses++; return null; }
    _hits++;
    return entry.data;
}

function getAll(type) {
    const bucket = _bucket(type);
    const now = Date.now();
    const result = {};
    for (const [key, entry] of bucket) {
        if (now - entry.ts <= entry.ttlMs) result[key] = entry.data;
    }
    return result;
}

async function getOrFetch(type, key, fetchFn, opts) {
    const cached = get(type, key);
    if (cached !== null) return cached;

    const dedupKey = `${type}:${key}`;
    if (_inflight.has(dedupKey)) return _inflight.get(dedupKey);

    const promise = (async () => {
        try {
            const data = await fetchFn();
            set(type, key, data, opts);
            return data;
        } finally {
            _inflight.delete(dedupKey);
        }
    })();
    _inflight.set(dedupKey, promise);
    return promise;
}

function getStats() { return { hits: _hits, misses: _misses, types: _store.size, inflight: _inflight.size }; }

function _getEntry(type, key) { return _bucket(type).get(key) || null; }

function _resetForTest() {
    _store.clear(); _inflight.clear(); _hits = 0; _misses = 0;
}

module.exports = { set, get, getAll, getOrFetch, getStats, _getEntry, _resetForTest, DEFAULT_TTL };
```

- [ ] **Step 4: Run — PASS**
- [ ] **Step 5: Commit** `feat: marketCache — exchange-agnostic central cache with TTL + request dedup`

---

### Task 2: Server modules write to marketCache

**Files:**
- Modify: `server/services/marketRadar.js`
- Modify: `server/services/marketFeed.js`
- Modify: `server/services/serverSentiment.js`
- Modify: `server/services/serverLiquidity.js`

- [ ] **Step 1: marketRadar — write ticker/funding/OI to cache after fetch**

In `marketRadar.js`, after `_fetchTicker24h()` processes results (inside `_pollTick`), add cache writes:

```javascript
// [Gateway Phase 1] Write to central cache — other modules read from here
try {
    const mc = require('./marketCache');
    for (const t of top) {
        mc.set('ticker', 'binance:' + t.symbol, {
            price: t.price, quoteVolume: t.quoteVolume,
            priceChangePercent24h: t.priceChangePercent24h,
        });
    }
} catch (_) {}
```

After `_pollFunding()`:
```javascript
try {
    const mc = require('./marketCache');
    for (const f of fundingData) {
        mc.set('funding', 'binance:' + f.symbol, {
            rate: parseFloat(f.lastFundingRate), markPrice: parseFloat(f.markPrice),
            indexPrice: parseFloat(f.indexPrice), ts: Date.now(),
        });
    }
} catch (_) {}
```

After `_fetchOI()` returns a value:
```javascript
try { require('./marketCache').set('oi', 'binance:' + symbol, oi); } catch (_) {}
```

- [ ] **Step 2: marketFeed — read funding/OI from cache instead of fetching**

In `marketFeed.js subscribe()`, replace `fetchFundingRate(symbol)` and `fetchOpenInterest(symbol)` calls:

```javascript
// [Gateway Phase 1] Read from cache first, fall back to fetch
const mc = require('./marketCache');
let fr = mc.get('funding', 'binance:' + symUpper);
if (fr === null) {
    const fetched = await fetchFundingRate(symUpper);
    fr = fetched;
} else {
    fr = fr.rate;
}
let oi = mc.get('oi', 'binance:' + symUpper);
if (oi === null) {
    oi = await fetchOpenInterest(symUpper);
}
```

- [ ] **Step 3: serverSentiment — read funding from cache**

In `serverSentiment.js _pollAll()`, replace the `/fapi/v1/fundingRate` fetch:

```javascript
// [Gateway Phase 1] Read funding from cache (marketRadar already fetches)
try {
    const mc = require('./marketCache');
    const cached = mc.get('funding', 'binance:' + symbol);
    if (cached && cached.rate != null) {
        fundingData = [{ fundingRate: cached.rate }];
        // skip REST call
    }
} catch (_) {}
```

- [ ] **Step 4: serverLiquidity — write depth to cache**

After `_pollDepth(symbol)` fetches depth:
```javascript
try { require('./marketCache').set('depth', 'binance:' + symbol, { bids, asks, ts: Date.now() }); } catch (_) {}
```

- [ ] **Step 5: Run existing tests**

```bash
/root/.nvm/versions/node/v22.22.3/bin/node /root/zeus-terminal/node_modules/.bin/jest tests/unit/marketCache.test.js --forceExit --no-coverage
```

- [ ] **Step 6: Commit** `feat: server modules write/read marketCache — eliminate duplicate Binance calls`

---

### Task 3: Server proxy endpoints for client

**Files:**
- Create: `server/routes/marketProxy.js`
- Modify: `server.js` (mount routes)
- Test: `tests/unit/marketProxy.test.js`

- [ ] **Step 1: Write test**

```javascript
'use strict';
const mc = require('../../server/services/marketCache');

describe('marketProxy endpoints (unit)', () => {
  test('marketCache provides ticker data', () => {
    mc.set('ticker', 'binance:BTCUSDT', { price: 77000, quoteVolume: 1e9, priceChangePercent24h: 0.5 });
    const data = mc.get('ticker', 'binance:BTCUSDT');
    expect(data.price).toBe(77000);
  });

  test('marketCache provides funding data', () => {
    mc.set('funding', 'binance:BTCUSDT', { rate: 0.0001, markPrice: 77000, indexPrice: 76990 });
    const data = mc.get('funding', 'binance:BTCUSDT');
    expect(data.rate).toBe(0.0001);
  });

  test('marketCache provides OI data', () => {
    mc.set('oi', 'binance:BTCUSDT', 85000);
    expect(mc.get('oi', 'binance:BTCUSDT')).toBe(85000);
  });

  test('marketCache provides depth data', () => {
    mc.set('depth', 'binance:BTCUSDT', { bids: [[77000, 1]], asks: [[77001, 2]], ts: Date.now() });
    const data = mc.get('depth', 'binance:BTCUSDT');
    expect(data.bids.length).toBe(1);
  });

  test('marketCache provides sentiment data', () => {
    mc.set('sentiment', 'binance:BTCUSDT', { ls: 1.2, topLs: 0.8, taker: 0.95 });
    const data = mc.get('sentiment', 'binance:BTCUSDT');
    expect(data.ls).toBe(1.2);
  });
});
```

- [ ] **Step 2: Create marketProxy.js**

```javascript
'use strict';
const express = require('express');
const router = express.Router();
const mc = require('../services/marketCache');

// GET /api/market/ticker?symbol=BTCUSDT&exchange=binance
router.get('/ticker', (req, res) => {
    const sym = (req.query.symbol || 'BTCUSDT').toUpperCase();
    const exch = req.query.exchange || 'binance';
    const data = mc.get('ticker', exch + ':' + sym);
    if (!data) return res.json({ ok: true, data: null, cached: false });
    res.json({ ok: true, data, cached: true });
});

// GET /api/market/ticker/all?exchange=binance
router.get('/ticker/all', (req, res) => {
    const exch = req.query.exchange || 'binance';
    const all = mc.getAll('ticker');
    const filtered = {};
    for (const [k, v] of Object.entries(all)) {
        if (k.startsWith(exch + ':')) filtered[k.split(':')[1]] = v;
    }
    res.json({ ok: true, data: filtered, count: Object.keys(filtered).length });
});

// GET /api/market/funding?symbol=BTCUSDT&exchange=binance
router.get('/funding', (req, res) => {
    const sym = (req.query.symbol || 'BTCUSDT').toUpperCase();
    const exch = req.query.exchange || 'binance';
    const data = mc.get('funding', exch + ':' + sym);
    res.json({ ok: true, data: data || null });
});

// GET /api/market/oi?symbol=BTCUSDT&exchange=binance
router.get('/oi', (req, res) => {
    const sym = (req.query.symbol || 'BTCUSDT').toUpperCase();
    const exch = req.query.exchange || 'binance';
    const data = mc.get('oi', exch + ':' + sym);
    res.json({ ok: true, data: data || null });
});

// GET /api/market/depth?symbol=BTCUSDT&exchange=binance
router.get('/depth', (req, res) => {
    const sym = (req.query.symbol || 'BTCUSDT').toUpperCase();
    const exch = req.query.exchange || 'binance';
    const data = mc.get('depth', exch + ':' + sym);
    res.json({ ok: true, data: data || null });
});

// GET /api/market/sentiment?symbol=BTCUSDT&exchange=binance
router.get('/sentiment', (req, res) => {
    const sym = (req.query.symbol || 'BTCUSDT').toUpperCase();
    const exch = req.query.exchange || 'binance';
    const data = mc.get('sentiment', exch + ':' + sym);
    res.json({ ok: true, data: data || null });
});

// GET /api/market/time — server time (no Binance call)
router.get('/time', (req, res) => {
    res.json({ ok: true, serverTime: Date.now() });
});

// GET /api/market/klines?symbol=BTCUSDT&tf=5m&limit=200&exchange=binance
router.get('/klines', (req, res) => {
    const sym = (req.query.symbol || 'BTCUSDT').toUpperCase();
    const tf = req.query.tf || '5m';
    const exch = req.query.exchange || 'binance';
    try {
        const serverState = require('../services/serverState');
        const bars = serverState.getBarsForSymbol(sym, tf);
        const limit = Math.min(parseInt(req.query.limit) || 200, 1000);
        res.json({ ok: true, data: (bars || []).slice(-limit) });
    } catch (_) {
        res.json({ ok: true, data: [] });
    }
});

// GET /api/market/cache/stats — diagnostic
router.get('/cache/stats', (req, res) => {
    res.json({ ok: true, ...mc.getStats() });
});

module.exports = router;
```

- [ ] **Step 3: Mount in server.js**

Find where other routes are mounted (search for `app.use('/api/market'`). Add:

```javascript
app.use('/api/market', require('./server/routes/marketProxy'));
```

- [ ] **Step 4: Run tests — PASS**
- [ ] **Step 5: Commit** `feat: /api/market/* proxy endpoints — client reads from server cache`

---

### Task 4: Kill client direct Binance calls

**Files:**
- Modify: `client/src/data/marketDataFeeds.ts`
- Modify: `client/src/data/basisRate.ts`
- Modify: `client/src/utils/guards.ts`

- [ ] **Step 1: marketDataFeeds.ts — OI + LS from server proxy**

Replace `fetchOI()`:
```typescript
export async function fetchOI(): Promise<void> {
    try {
        const r = await fetch('/api/market/oi?symbol=' + (w.S?.symbol || 'BTCUSDT'))
        const d = await r.json()
        if (d.ok && d.data != null) {
            w.S.oi = d.data
            const e = el('oiVal')
            if (e) e.textContent = Number(d.data).toLocaleString()
        }
    } catch (_) {}
}
```

Replace `fetchLS()`:
```typescript
export async function fetchLS(): Promise<void> {
    try {
        const r = await fetch('/api/market/sentiment?symbol=' + (w.S?.symbol || 'BTCUSDT'))
        const d = await r.json()
        if (d.ok && d.data && d.data.ls != null) {
            const e = el('lsVal')
            if (e) e.textContent = Number(d.data.ls).toFixed(2)
        }
    } catch (_) {}
}
```

- [ ] **Step 2: basisRate.ts — funding from server proxy**

Replace direct Binance call:
```typescript
export async function fetchBasisRate(): Promise<void> {
    try {
        const r = await fetch('/api/market/funding?symbol=BTCUSDT')
        const d = await r.json()
        if (d.ok && d.data) {
            const { markPrice, indexPrice, rate } = d.data
            if (markPrice && indexPrice) {
                const basis = ((markPrice - indexPrice) / indexPrice) * 100
                const e = el('basisVal')
                if (e) e.textContent = basis.toFixed(4) + '%'
            }
        }
    } catch (_) {}
}
```

- [ ] **Step 3: guards.ts — server time instead of Binance**

Replace `_syncServerTime()`:
```typescript
async function _syncServerTime(): Promise<void> {
    try {
        const r = await fetch('/api/market/time')
        const d = await r.json()
        if (d.ok && d.serverTime) {
            _serverTimeDelta = d.serverTime - Date.now()
        }
    } catch (_) {}
}
```

- [ ] **Step 4: Build client**

```bash
cd /root/zeus-terminal/client && npm run build
```

- [ ] **Step 5: Commit** `feat: client uses /api/market/* proxy — zero direct Binance REST calls`

---

### Task 5: Integration verify + PM2 reload + tag

- [ ] **Step 1: Run full test suite**

```bash
/root/.nvm/versions/node/v22.22.3/bin/node /root/zeus-terminal/node_modules/.bin/jest tests/unit/marketCache.test.js tests/unit/marketProxy.test.js --forceExit --no-coverage
```

- [ ] **Step 2: PM2 reload + verify**

```bash
pm2 reload zeus --update-env
sleep 30
# Rate state clean?
sqlite3 /root/zeus-terminal/data/zeus.db "SELECT banned_until, warm_until, consecutive_ban_count FROM binance_rate_state"
# Cache populating?
curl -s http://127.0.0.1:3000/api/market/cache/stats
# Ticker available?
curl -s http://127.0.0.1:3000/api/market/ticker?symbol=BTCUSDT
# Brain still producing?
sqlite3 /root/zeus-terminal/data/zeus.db "SELECT COUNT(*) FROM brain_decisions WHERE ts > (strftime('%s','now')*1000 - 120000)"
```

- [ ] **Step 3: Monitor 10min — no new bans**

```bash
sleep 600
sqlite3 /root/zeus-terminal/data/zeus.db "SELECT banned_until, warm_until, consecutive_ban_count FROM binance_rate_state"
# Expected: 0|0|0 (no new bans)
```

- [ ] **Step 4: Tag + push**

```bash
git tag binance-gateway-phase1-COMPLETE-$(date +%Y%m%d)
git push origin main --tags
```

---

## Verification Checklist

- [ ] marketCache stores/retrieves with TTL
- [ ] getOrFetch deduplicates concurrent requests
- [ ] Multi-exchange keys work (binance:X vs bybit:X)
- [ ] marketRadar writes ticker/funding/OI to cache
- [ ] marketFeed reads funding/OI from cache (no duplicate fetch)
- [ ] serverSentiment reads funding from cache
- [ ] /api/market/ticker returns cached radar data
- [ ] /api/market/klines returns serverState bars
- [ ] /api/market/funding returns cached funding
- [ ] /api/market/time returns server time (no Binance call)
- [ ] Client fetchOI uses /api/market/oi
- [ ] Client fetchLS uses /api/market/sentiment
- [ ] Client basisRate uses /api/market/funding
- [ ] Client timeSync uses /api/market/time
- [ ] Zero new Binance bans for 10+ min after deploy
- [ ] Brain still producing decisions
- [ ] Radar still showing events
