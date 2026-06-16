# Binance Rate-Limit Phase A.1 — Header-Aware Quota Gate

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add proactive defense against IP rate-limit ban by reading `X-MBX-USED-WEIGHT-1M` header from Binance responses and blocking new requests preemptively when quota pressure exceeds threshold (public 95%, signed 97%). Synthetic 429 responses trigger the existing IP-CB fallback in binanceSigner.

**Architecture:**
- `binanceTelemetry.js` exports `getQuotaPressure(host)` returning `0..1+` from `lastUsedWeight / CAP` (CAP=6000 default, configurable via env). `isSignedSource(src)` returns true for `signer:*` / `serverAT:*` tags. `wrapFetch` checks pressure BEFORE calling underlying fetch — if `shouldBlock(host, src)` returns true, returns synthetic 429 response object (status=429, ok=false, headers.get() returns last usedWeight, json() returns `{msg:'preemptive synthetic 429 — quota pressure', code:-1003}`).
- Pre-existing caller behavior is reused: `binanceSigner._setIpBan` already handles 429 → fallback 60s ban. Public-path callers (`marketRadar`, `marketFeed._altFetchKlinesLatest`, `serverLiquidity._pollDepth`) treat 429 as transient error — next tick retries naturally.
- Telemetry counter `blockedByPressure` per source tracks how many requests were blocked preemptively; surfaced via `/api/diag/binance-rates`.
- Env override: `BINANCE_QUOTA_CAP` (default 6000), `BINANCE_QUOTA_BLOCK_PUBLIC_PCT` (default 95), `BINANCE_QUOTA_BLOCK_SIGNED_PCT` (default 97).
- Phase 2 fusion math UNTOUCHED. ARCH-3 per-(user × env × symbol) isolation preserved — quota gate is per-host (process-global), independent of position/user state.

**Tech Stack:** Node.js, jest unit tests with `_resetForTest()` injection pattern from existing `binanceTelemetry.test.js`.

---

## File Structure

| File | Responsibility | Action |
|---|---|---|
| `server/services/binanceTelemetry.js` | Add `getQuotaPressure`, `isSignedSource`, `shouldBlockForPressure`, gate in `wrapFetch`, env-driven thresholds, `blockedByPressure` counter in `bySource` aggregation | Modify |
| `tests/unit/binanceTelemetry.test.js` | Extend with 3 new describe blocks: pressure calc, signed-source classification, wrapFetch preemptive block | Modify |
| `server/routes/exchange.js` (optional) | NO touch — existing 429 handling already maps preemptive → IP-CB via signer | None |

---

## Task 1: getQuotaPressure + isSignedSource pure helpers (RED + GREEN)

**Files:**
- Test: `tests/unit/binanceTelemetry.test.js` (extend)
- Modify: `server/services/binanceTelemetry.js`

- [ ] **Step 1: Append failing tests**

Add new describe block at the END of `tests/unit/binanceTelemetry.test.js` (before file ends):

```js
describe('binanceTelemetry — quota pressure (Phase A.1)', () => {
    test('getQuotaPressure returns 0 when no calls recorded', () => {
        expect(telemetry.getQuotaPressure('fapi.binance.com')).toBe(0);
    });

    test('getQuotaPressure returns lastUsedWeight/CAP ratio', () => {
        telemetry.recordCall({
            host: 'fapi.binance.com', path: '/a', source: 'marketRadar',
            weight: 40, status: 200, latencyMs: 50, usedWeight: 3000,
        });
        // Default CAP 6000 → 3000/6000 = 0.5
        expect(telemetry.getQuotaPressure('fapi.binance.com')).toBe(0.5);
    });

    test('getQuotaPressure unknown host returns 0', () => {
        expect(telemetry.getQuotaPressure('nowhere.example.com')).toBe(0);
    });

    test('getQuotaPressure tracks lastUsedWeight (not peak)', () => {
        telemetry.recordCall({ host: 'h', path: '/a', source: 's', weight: 1, status: 200, latencyMs: 1, usedWeight: 5000 });
        telemetry.recordCall({ host: 'h', path: '/a', source: 's', weight: 1, status: 200, latencyMs: 1, usedWeight: 2000 });
        // last=2000, peak=5000. Pressure must reflect LAST not peak (recovery aware).
        expect(telemetry.getQuotaPressure('h')).toBeCloseTo(2000 / 6000, 4);
    });

    test('isSignedSource detects signer: prefix', () => {
        expect(telemetry.isSignedSource('signer:GET /fapi/v2/balance')).toBe(true);
        expect(telemetry.isSignedSource('signer:POST /fapi/v1/order')).toBe(true);
    });

    test('isSignedSource detects serverAT: prefix', () => {
        expect(telemetry.isSignedSource('serverAT:recon-positionRisk')).toBe(true);
    });

    test('isSignedSource returns false for public sources', () => {
        expect(telemetry.isSignedSource('marketRadar:oi')).toBe(false);
        expect(telemetry.isSignedSource('marketFeed:alt-klines')).toBe(false);
        expect(telemetry.isSignedSource('serverLiquidity:depth')).toBe(false);
        expect(telemetry.isSignedSource('unknown')).toBe(false);
        expect(telemetry.isSignedSource(null)).toBe(false);
        expect(telemetry.isSignedSource(undefined)).toBe(false);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /root/zeus-terminal && npx jest tests/unit/binanceTelemetry.test.js --forceExit`
Expected: FAIL — `getQuotaPressure is not a function` and `isSignedSource is not a function`.

- [ ] **Step 3: Implement helpers in binanceTelemetry.js**

In `server/services/binanceTelemetry.js`, find the line `function parseUsedWeight(headers) {` (around line 47). BEFORE this function, add the new helpers + threshold constants:

```js
// [Phase A.1 2026-05-19] Quota pressure gate. Reads X-MBX-USED-WEIGHT-1M
// (captured in byHost.lastUsedWeight) and blocks new requests when quota
// crosses threshold. Env override: BINANCE_QUOTA_CAP/BLOCK_PUBLIC_PCT/BLOCK_SIGNED_PCT.
function _intEnv(name, def) {
    const v = parseInt(process.env[name], 10);
    return Number.isFinite(v) && v > 0 ? v : def;
}
const QUOTA_CAP = _intEnv('BINANCE_QUOTA_CAP', 6000);
const BLOCK_PUBLIC_PCT = _intEnv('BINANCE_QUOTA_BLOCK_PUBLIC_PCT', 95);
const BLOCK_SIGNED_PCT = _intEnv('BINANCE_QUOTA_BLOCK_SIGNED_PCT', 97);

function getQuotaPressure(host) {
    _prune();
    const hostData = _aggregateByHost()[host];
    if (!hostData || hostData.lastUsedWeight == null) return 0;
    return hostData.lastUsedWeight / QUOTA_CAP;
}

function isSignedSource(src) {
    if (typeof src !== 'string') return false;
    return src.startsWith('signer:') || src.startsWith('serverAT:');
}

function shouldBlockForPressure(host, src) {
    const pressure = getQuotaPressure(host);
    const cap = isSignedSource(src) ? (BLOCK_SIGNED_PCT / 100) : (BLOCK_PUBLIC_PCT / 100);
    return pressure >= cap;
}
```

- [ ] **Step 4: Export the new helpers**

In the `module.exports` block at the bottom of `server/services/binanceTelemetry.js`, add:

```js
    getQuotaPressure,
    isSignedSource,
    shouldBlockForPressure,
```

Place these near other public functions (between `parseUsedWeight` and `wrapFetch` entries).

- [ ] **Step 5: Run test to verify it passes**

Run: `cd /root/zeus-terminal && npx jest tests/unit/binanceTelemetry.test.js --forceExit`
Expected: PASS, 24/24 tests (17 existing + 7 new).

- [ ] **Step 6: Commit**

```bash
git add server/services/binanceTelemetry.js tests/unit/binanceTelemetry.test.js
git commit -m "[Phase A.1] add quota pressure helpers (no gate yet)

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 2: Synthetic 429 response factory + wrapFetch gate (RED + GREEN)

**Files:**
- Modify: `server/services/binanceTelemetry.js` — patch `wrapFetch` to call `shouldBlockForPressure` before fetch
- Test: `tests/unit/binanceTelemetry.test.js` (extend)

- [ ] **Step 1: Append failing tests**

Add new describe block at the END of `tests/unit/binanceTelemetry.test.js`:

```js
describe('binanceTelemetry — wrapFetch preemptive gate (Phase A.1)', () => {
    test('wrapFetch returns synthetic 429 when public pressure >= 95%', async () => {
        // Seed pressure at 95.5%
        telemetry.recordCall({
            host: 'fapi.binance.com', path: '/seed', source: 'marketRadar',
            weight: 1, status: 200, latencyMs: 1, usedWeight: 5730,  // 5730/6000 = 95.5%
        });
        let fetchCalled = false;
        const fakeFetch = async () => { fetchCalled = true; return { status: 200, ok: true, headers: { get: () => null }, json: async () => ({}) }; };
        const res = await telemetry.wrapFetch(fakeFetch, 'https://fapi.binance.com/test', { __src: 'marketRadar:oi' });
        expect(fetchCalled).toBe(false);
        expect(res.status).toBe(429);
        expect(res.ok).toBe(false);
        const body = await res.json();
        expect(body.code).toBe(-1003);
        expect(body.msg).toMatch(/preemptive/i);
    });

    test('wrapFetch allows public request when pressure < 95%', async () => {
        telemetry.recordCall({
            host: 'fapi.binance.com', path: '/seed', source: 'marketRadar',
            weight: 1, status: 200, latencyMs: 1, usedWeight: 5000,  // 83.3%
        });
        let fetchCalled = false;
        const fakeFetch = async () => { fetchCalled = true; return { status: 200, ok: true, headers: { get: () => '5050' }, json: async () => ({}) }; };
        const res = await telemetry.wrapFetch(fakeFetch, 'https://fapi.binance.com/test', { __src: 'marketRadar:oi' });
        expect(fetchCalled).toBe(true);
        expect(res.status).toBe(200);
    });

    test('wrapFetch signed tolerates higher pressure — blocks only at 97%', async () => {
        // 96% pressure: public would block, signed should NOT
        telemetry.recordCall({
            host: 'fapi.binance.com', path: '/seed', source: 'signer:warmup',
            weight: 1, status: 200, latencyMs: 1, usedWeight: 5760,  // 96%
        });
        let fetchCalled = false;
        const fakeFetch = async () => { fetchCalled = true; return { status: 200, ok: true, headers: { get: () => null }, json: async () => ({}) }; };
        const res = await telemetry.wrapFetch(fakeFetch, 'https://fapi.binance.com/test', { __src: 'signer:GET /fapi/v2/balance' });
        expect(fetchCalled).toBe(true);  // signed gets through at 96%
        expect(res.status).toBe(200);
    });

    test('wrapFetch signed DOES block at 97% pressure', async () => {
        telemetry.recordCall({
            host: 'fapi.binance.com', path: '/seed', source: 'signer:warmup',
            weight: 1, status: 200, latencyMs: 1, usedWeight: 5830,  // 97.2%
        });
        let fetchCalled = false;
        const fakeFetch = async () => { fetchCalled = true; return { status: 200 }; };
        const res = await telemetry.wrapFetch(fakeFetch, 'https://fapi.binance.com/test', { __src: 'signer:GET /fapi/v2/balance' });
        expect(fetchCalled).toBe(false);
        expect(res.status).toBe(429);
    });

    test('synthetic 429 records blockedByPressure counter per source', async () => {
        telemetry.recordCall({
            host: 'fapi.binance.com', path: '/seed', source: 'marketRadar',
            weight: 1, status: 200, latencyMs: 1, usedWeight: 5800,
        });
        const fakeFetch = async () => ({ status: 200, ok: true, headers: { get: () => null }, json: async () => ({}) });
        await telemetry.wrapFetch(fakeFetch, 'https://fapi.binance.com/x', { __src: 'marketRadar:oi' });
        await telemetry.wrapFetch(fakeFetch, 'https://fapi.binance.com/y', { __src: 'marketRadar:oi' });
        const snap = telemetry.getSnapshot();
        expect(snap.bySource['marketRadar:oi'].blockedByPressure).toBe(2);
    });

    test('non-blocked request does NOT increment blockedByPressure', async () => {
        telemetry.recordCall({
            host: 'fapi.binance.com', path: '/seed', source: 'marketRadar',
            weight: 1, status: 200, latencyMs: 1, usedWeight: 1000,  // 16%
        });
        const fakeFetch = async () => ({ status: 200, ok: true, headers: { get: () => null }, json: async () => ({}) });
        await telemetry.wrapFetch(fakeFetch, 'https://fapi.binance.com/x', { __src: 'marketRadar:oi' });
        const snap = telemetry.getSnapshot();
        // Either 0 or undefined acceptable since source created mid-flight
        const cnt = (snap.bySource['marketRadar:oi'] || {}).blockedByPressure || 0;
        expect(cnt).toBe(0);
    });

    test('synthetic 429 response.headers.get returns last usedWeight', async () => {
        telemetry.recordCall({
            host: 'fapi.binance.com', path: '/seed', source: 'marketRadar',
            weight: 1, status: 200, latencyMs: 1, usedWeight: 5800,
        });
        const res = await telemetry.wrapFetch(async () => ({}), 'https://fapi.binance.com/x', { __src: 'marketRadar:oi' });
        expect(res.headers.get('x-mbx-used-weight-1m')).toBe('5800');
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /root/zeus-terminal && npx jest tests/unit/binanceTelemetry.test.js --forceExit`
Expected: FAIL — synthetic 429 not yet implemented; tests expect `fetchCalled=false` but current `wrapFetch` always calls fetch.

- [ ] **Step 3: Patch wrapFetch in binanceTelemetry.js**

In `server/services/binanceTelemetry.js`, find the current `wrapFetch` function (around line 55-90 after Task 1's additions). The current implementation looks like:

```js
async function wrapFetch(fetchFn, url, opts) {
    const src = (opts && opts.__src) || 'unknown';
    let host = 'unknown', path = '/';
    try {
        const u = new URL(url);
        host = u.host;
        path = u.pathname;
    } catch (_) { /* leave defaults */ }
    const t0 = Date.now();
    try {
        const res = await fetchFn(url, opts);
        ...
```

Replace the entire `wrapFetch` function with:

```js
async function wrapFetch(fetchFn, url, opts) {
    const src = (opts && opts.__src) || 'unknown';
    let host = 'unknown', path = '/';
    try {
        const u = new URL(url);
        host = u.host;
        path = u.pathname;
    } catch (_) { /* leave defaults */ }

    // [Phase A.1 2026-05-19] Preemptive gate — if Binance reported usedWeight
    // is over threshold, refuse to issue the request and synthesize a 429
    // response. Caller (signer or public poller) handles 429 via existing
    // logic (binanceSigner._setIpBan fallback 60s; public next-tick retry).
    if (shouldBlockForPressure(host, src)) {
        const pressure = getQuotaPressure(host);
        const lastUsed = Math.round(pressure * QUOTA_CAP);
        recordCall({
            host, path, source: src,
            weight: 0,
            status: 429,
            latencyMs: 0,
            usedWeight: lastUsed,
            blockedByPressure: true,
        });
        const msg = `preemptive synthetic 429 — quota pressure ${(pressure * 100).toFixed(1)}% (lastUsedWeight=${lastUsed}/${QUOTA_CAP})`;
        return {
            status: 429,
            ok: false,
            headers: { get: (k) => k.toLowerCase() === 'x-mbx-used-weight-1m' ? String(lastUsed) : null },
            json: async () => ({ msg, code: -1003 }),
        };
    }

    const t0 = Date.now();
    try {
        const res = await fetchFn(url, opts);
        const latencyMs = Date.now() - t0;
        const usedWeight = parseUsedWeight(res && res.headers);
        recordCall({
            host, path, source: src,
            weight: (opts && typeof opts.__weight === 'number') ? opts.__weight : 0,
            status: res ? res.status : 0,
            latencyMs,
            usedWeight,
        });
        return res;
    } catch (err) {
        const latencyMs = Date.now() - t0;
        recordCall({
            host, path, source: src,
            weight: 0,
            status: 0,
            latencyMs,
            networkError: true,
        });
        throw err;
    }
}
```

- [ ] **Step 4: Patch recordCall to track blockedByPressure flag**

In `server/services/binanceTelemetry.js`, find the current `recordCall` function (around line 28). The current implementation looks like:

```js
function recordCall(entry) {
    if (!entry || typeof entry !== 'object') return;
    _ring.push({
        ts: _ts(),
        host: entry.host || 'unknown',
        path: entry.path || '/',
        source: entry.source || 'unknown',
        weight: typeof entry.weight === 'number' ? entry.weight : 0,
        status: typeof entry.status === 'number' ? entry.status : 0,
        latencyMs: typeof entry.latencyMs === 'number' ? entry.latencyMs : 0,
        usedWeight: typeof entry.usedWeight === 'number' ? entry.usedWeight : null,
        networkError: !!entry.networkError,
    });
    _prune();
}
```

Add `blockedByPressure` field by replacing with:

```js
function recordCall(entry) {
    if (!entry || typeof entry !== 'object') return;
    _ring.push({
        ts: _ts(),
        host: entry.host || 'unknown',
        path: entry.path || '/',
        source: entry.source || 'unknown',
        weight: typeof entry.weight === 'number' ? entry.weight : 0,
        status: typeof entry.status === 'number' ? entry.status : 0,
        latencyMs: typeof entry.latencyMs === 'number' ? entry.latencyMs : 0,
        usedWeight: typeof entry.usedWeight === 'number' ? entry.usedWeight : null,
        networkError: !!entry.networkError,
        blockedByPressure: !!entry.blockedByPressure,
    });
    _prune();
}
```

- [ ] **Step 5: Patch _aggregateBySource to count blockedByPressure per source**

In `server/services/binanceTelemetry.js`, find the current `_aggregateBySource` function (around line 100). The current implementation looks like:

```js
function _aggregateBySource() {
    _prune();
    const out = {};
    for (const e of _ring) {
        if (!out[e.source]) {
            out[e.source] = { calls: 0, weightSum: 0, errors2xx: 0, errors4xx: 0, errors5xx: 0, networkErrors: 0, latencySum: 0 };
        }
        const s = out[e.source];
        s.calls++;
        s.weightSum += e.weight;
        s.latencySum += e.latencyMs;
        if (e.networkError) s.networkErrors++;
        else if (e.status >= 200 && e.status < 300) {
            s.errors2xx++;
        } else if (e.status >= 400 && e.status < 500) s.errors4xx++;
        else if (e.status >= 500) s.errors5xx++;
    }
    return out;
}
```

Replace with (add `blockedByPressure` field to seed object + increment counter):

```js
function _aggregateBySource() {
    _prune();
    const out = {};
    for (const e of _ring) {
        if (!out[e.source]) {
            out[e.source] = { calls: 0, weightSum: 0, errors2xx: 0, errors4xx: 0, errors5xx: 0, networkErrors: 0, latencySum: 0, blockedByPressure: 0 };
        }
        const s = out[e.source];
        s.calls++;
        s.weightSum += e.weight;
        s.latencySum += e.latencyMs;
        if (e.blockedByPressure) s.blockedByPressure++;
        if (e.networkError) s.networkErrors++;
        else if (e.status >= 200 && e.status < 300) {
            s.errors2xx++;
        } else if (e.status >= 400 && e.status < 500) s.errors4xx++;
        else if (e.status >= 500) s.errors5xx++;
    }
    return out;
}
```

- [ ] **Step 6: Run tests to verify pass**

Run: `cd /root/zeus-terminal && npx jest tests/unit/binanceTelemetry.test.js --forceExit`
Expected: PASS, 31/31 tests (24 from Task 1 + 7 new).

- [ ] **Step 7: Sanity load + module check**

```bash
node -e "
const t = require('./server/services/binanceTelemetry');
t.recordCall({host:'fapi.binance.com', path:'/x', source:'marketRadar', weight:1, status:200, latencyMs:1, usedWeight:5800});
console.log('pressure:', t.getQuotaPressure('fapi.binance.com'));
console.log('shouldBlock (public):', t.shouldBlockForPressure('fapi.binance.com', 'marketRadar:oi'));
console.log('shouldBlock (signed):', t.shouldBlockForPressure('fapi.binance.com', 'signer:GET /fapi/v2/balance'));
process.exit(0);
"
```

Expected output:
```
pressure: 0.9666666666666667
shouldBlock (public): true
shouldBlock (signed): false
```

- [ ] **Step 8: Commit**

```bash
git add server/services/binanceTelemetry.js tests/unit/binanceTelemetry.test.js
git commit -m "[Phase A.1] preemptive 429 gate when X-MBX-USED-WEIGHT-1M > threshold

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 3: Surface quotaPressure in getSnapshot for diag visibility

**Files:**
- Modify: `server/services/binanceTelemetry.js` — extend `getSnapshot` with per-host pressure + thresholds
- Test: `tests/unit/binanceTelemetry.test.js` (extend)

- [ ] **Step 1: Append failing test**

Add new describe block at end of `tests/unit/binanceTelemetry.test.js`:

```js
describe('binanceTelemetry — getSnapshot exposes pressure (Phase A.1)', () => {
    test('snapshot.quotaPressure reports ratio per host', () => {
        telemetry.recordCall({
            host: 'fapi.binance.com', path: '/a', source: 's',
            weight: 1, status: 200, latencyMs: 1, usedWeight: 3000,
        });
        telemetry.recordCall({
            host: 'testnet.binancefuture.com', path: '/b', source: 's',
            weight: 1, status: 200, latencyMs: 1, usedWeight: 5400,
        });
        const snap = telemetry.getSnapshot();
        expect(snap.quotaPressure).toBeDefined();
        expect(snap.quotaPressure['fapi.binance.com']).toBeCloseTo(0.5, 3);
        expect(snap.quotaPressure['testnet.binancefuture.com']).toBeCloseTo(0.9, 3);
    });

    test('snapshot.quotaThresholds reports configured caps', () => {
        const snap = telemetry.getSnapshot();
        expect(snap.quotaThresholds).toBeDefined();
        expect(snap.quotaThresholds.cap).toBe(6000);
        expect(snap.quotaThresholds.blockPublicPct).toBe(95);
        expect(snap.quotaThresholds.blockSignedPct).toBe(97);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /root/zeus-terminal && npx jest tests/unit/binanceTelemetry.test.js --forceExit`
Expected: FAIL — `snap.quotaPressure` and `snap.quotaThresholds` undefined.

- [ ] **Step 3: Extend getSnapshot in binanceTelemetry.js**

In `server/services/binanceTelemetry.js`, find the current `getSnapshot` function (around line 150-170). The current implementation looks like:

```js
function getSnapshot() {
    _prune();
    let activePollers = null;
    if (_pollersProvider) {
        try { activePollers = _pollersProvider(); } catch (_) { activePollers = null; }
    }
    return {
        bootTs: _bootTs,
        uptimeMs: _ts() - _bootTs,
        totalCalls: _ring.length,
        callsPer1min: _countSince(ONE_MIN_MS),
        callsPer5min: _countSince(FIVE_MIN_MS),
        bySource: _aggregateBySource(),
        byHost: _aggregateByHost(),
        topEndpoints: _topEndpoints(),
        activePollers,
    };
}
```

Replace with (add quotaPressure derived from byHost + thresholds constants):

```js
function getSnapshot() {
    _prune();
    let activePollers = null;
    if (_pollersProvider) {
        try { activePollers = _pollersProvider(); } catch (_) { activePollers = null; }
    }
    const byHost = _aggregateByHost();
    const quotaPressure = {};
    for (const [host, v] of Object.entries(byHost)) {
        quotaPressure[host] = v.lastUsedWeight != null ? v.lastUsedWeight / QUOTA_CAP : 0;
    }
    return {
        bootTs: _bootTs,
        uptimeMs: _ts() - _bootTs,
        totalCalls: _ring.length,
        callsPer1min: _countSince(ONE_MIN_MS),
        callsPer5min: _countSince(FIVE_MIN_MS),
        bySource: _aggregateBySource(),
        byHost,
        topEndpoints: _topEndpoints(),
        activePollers,
        quotaPressure,
        quotaThresholds: {
            cap: QUOTA_CAP,
            blockPublicPct: BLOCK_PUBLIC_PCT,
            blockSignedPct: BLOCK_SIGNED_PCT,
        },
    };
}
```

- [ ] **Step 4: Run test to verify pass**

Run: `cd /root/zeus-terminal && npx jest tests/unit/binanceTelemetry.test.js --forceExit`
Expected: PASS, 33/33 tests (31 from Task 2 + 2 new).

- [ ] **Step 5: Commit**

```bash
git add server/services/binanceTelemetry.js tests/unit/binanceTelemetry.test.js
git commit -m "[Phase A.1] surface quotaPressure + thresholds in diag snapshot

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 4: Full regression + bump + deploy + smoke

**Files:** none (verification only)

- [ ] **Step 1: Run full jest suite**

Run: `cd /root/zeus-terminal && npx jest --forceExit 2>&1 | tail -10`
Expected: 7114+ tests PASS (was 7098 post-PhaseB, +16 from Phase A.1 Tasks 1-3), 0 failures.

- [ ] **Step 2: Verify modules load**

```bash
node -e "require('./server/services/binanceTelemetry'); require('./server/services/marketFeed'); require('./server/services/binanceSigner'); console.log('LOAD_OK'); process.exit(0);"
```

Expected: `LOAD_OK`

- [ ] **Step 3: Sanity check env-driven thresholds**

```bash
BINANCE_QUOTA_CAP=5000 BINANCE_QUOTA_BLOCK_PUBLIC_PCT=80 node -e "
const t = require('./server/services/binanceTelemetry');
const snap = t.getSnapshot();
console.log('cap:', snap.quotaThresholds.cap, 'expected 5000');
console.log('publicPct:', snap.quotaThresholds.blockPublicPct, 'expected 80');
process.exit(0);
"
```

Expected:
```
cap: 5000 expected 5000
publicPct: 80 expected 80
```

- [ ] **Step 4: Bump version**

Edit `server/version.js`. Change `version: '1.7.92'` → `version: '1.7.93'`, `build: 118` → `build: 119`. Prepend new changelog entry at the START of the `changelog: [` array:

```js
'b119 v1.7.93 — BIN-TELEM Phase A.1 header-aware quota gate 2026-05-19. Adds proactive defense against IP rate-limit by reading X-MBX-USED-WEIGHT-1M and blocking new requests when pressure exceeds threshold (public 95%, signed 97%). Confirmed need empirically: T+48min post-PhaseB intermediate snapshot showed testnet.binancefuture.com peakUsedWeight=5350/6000 (89%, 535 weight from re-ban) despite only 35 signed calls/h from us — quota partajată cu vecini pe IP NAT-uit consumă restul. NEW helpers binanceTelemetry.getQuotaPressure(host) + isSignedSource(src) + shouldBlockForPressure(host, src). wrapFetch gates BEFORE underlying fetch — synthetic 429 response (status=429, ok=false, headers.get returns lastUsedWeight, json returns {msg, code:-1003}). Caller behavior reused: binanceSigner detects 429 → _setIpBan fallback 60s; public callers (marketRadar/marketFeed/serverLiquidity) treat as transient → next-tick retry. recordCall tracks blockedByPressure flag, _aggregateBySource counts per source. Env overrides: BINANCE_QUOTA_CAP (default 6000), BINANCE_QUOTA_BLOCK_PUBLIC_PCT (default 95), BINANCE_QUOTA_BLOCK_SIGNED_PCT (default 97). getSnapshot returns quotaPressure map per host + quotaThresholds for diag visibility. +16 new tests across 3 describe blocks. Phase 2 fusion UNTOUCHED. ARCH-3 preserved — gate is per-host process-global, independent of position/user. Next: Phase A.2 priority lanes + operator critical section.',
```

- [ ] **Step 5: Commit version bump**

```bash
git add server/version.js
git commit -m "[Phase A.1] bump v1.7.93 b119 — header-aware quota gate

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

- [ ] **Step 6: Tag + PM2 reload + smoke**

```bash
git tag post-v2/PHASE-A1-119 HEAD
pm2 reload zeus
sleep 5
curl -s http://127.0.0.1:3000/api/diag/binance-rates | python3 -c "
import json, sys
d = json.load(sys.stdin)
print('=== Post-PhaseA1 smoke ===')
print('quotaThresholds:', d.get('quotaThresholds'))
print('quotaPressure:', d.get('quotaPressure'))
print('activeSymbols:', d['activePollers']['marketFeed']['activeSymbols'])
print('altKlinePollers:', d['activePollers']['marketFeed']['altKlinePollersCount'])
"
```

Expected:
- `quotaThresholds: {cap: 6000, blockPublicPct: 95, blockSignedPct: 97}`
- `quotaPressure: {<host>: <ratio>}` non-empty for fapi.binance.com after boot fetches
- activeSymbols + altKlinePollers unchanged (Phase B sticky boot still works)

- [ ] **Step 7: Push branch + tag**

```bash
git push origin omega/wave-1-foundation
git push origin post-v2/PHASE-A1-119
```

- [ ] **Step 8: Save T+0-post-PhaseA1 snapshot**

```bash
curl -s http://127.0.0.1:3000/api/diag/binance-rates > /tmp/zeus-T0-postPhaseA1.json
echo "T+0 post-PhaseA1 saved $(wc -c < /tmp/zeus-T0-postPhaseA1.json) bytes"
```

---

# Self-Review Checklist

**1. Spec coverage:**
- ✅ getQuotaPressure(host) → Task 1
- ✅ isSignedSource(src) → Task 1
- ✅ shouldBlockForPressure(host, src) → Task 1 (env-driven thresholds)
- ✅ wrapFetch synthetic 429 when blocked → Task 2
- ✅ recordCall + bySource counter for blockedByPressure → Task 2
- ✅ Synthetic 429 has headers.get + json shape compatible with caller expectations → Task 2
- ✅ Snapshot exposes quotaPressure + thresholds → Task 3
- ✅ Env override CAP/PUBLIC_PCT/SIGNED_PCT → Task 1 (verified by sanity check Task 4 Step 3)
- ✅ Deploy + smoke → Task 4

**2. Placeholders:** None — every step has concrete code blocks + exact commands.

**3. Type consistency:**
- `getQuotaPressure(host)` returns number 0..1+ (Tasks 1, 3)
- `isSignedSource(src)` returns boolean (Tasks 1, 2)
- `shouldBlockForPressure(host, src)` returns boolean (Task 1, used in Task 2 wrapFetch)
- Synthetic 429 response shape: `{ status: 429, ok: false, headers: { get: fn }, json: async fn }` consistent with real fetch Response (Task 2)
- `recordCall` entry gains `blockedByPressure: boolean` field (Task 2)
- `_aggregateBySource` adds `blockedByPressure: number` counter (Task 2)
- `getSnapshot` adds `quotaPressure: Record<host, number>` + `quotaThresholds: {cap, blockPublicPct, blockSignedPct}` (Task 3)

**4. ARCH-3 verified:** Quota gate is per-host (process-global), NOT per-(user × env × symbol). This is correct because Binance rate-limit is per-IP, shared by all users/positions/symbols on the same process. Sticky boot symbol ref-counts (Phase B) remain untouched. Phase 2 fusion math untouched.

**5. Defensive properties:**
- Synthetic 429 records to ring buffer like a real 429 → telemetry visibility preserved
- `binanceSigner._setIpBan` (existing) triggers on 429 status code → preemptive 429 activates IP-CB fallback 60s naturally
- Public callers' existing try/catch handles 429 as transient → next-tick retry
- Env overrides allow rapid threshold tuning in prod without rebuild

**6. Test isolation:** Every test uses `telemetry._resetForTest()` from existing `beforeEach`. Env vars read at module load — tests rely on default values (CAP=6000, public=95%, signed=97%). Test in Task 4 Step 3 verifies env override works at process boot.
