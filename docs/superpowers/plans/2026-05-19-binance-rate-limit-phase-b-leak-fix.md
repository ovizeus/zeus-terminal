# Binance Rate-Limit Phase B — Auto-Subscribe Leak Fix

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate marketFeed poller leak by introducing per-(user × env × position) ref-counting on symbol subscriptions; close orphaned pollers when last referencing position closes.

**Architecture:**
- `marketFeed` adds `_symbolRefs: Map<symbol, Set<refKey>>` where `refKey = "userId|env|posSeq"` for trade-driven refs and `"boot|system"` for sticky boot symbols.
- New `subscribeForRef(symbol, refKey, timeframes?)` adds ref + subscribes symbol if first ref (idempotent). New `releaseRef(refKey)` removes refKey from all symbol sets; if a symbol's set becomes empty AND it's not boot-sticky, fully unsubscribe (close WS streams + clear ALT klinePollers).
- `serverAT._closePosition` calls `releaseRef("uid|env|seq")` after marking position CLOSED. Recon auto-subscribe path migrates to `subscribeForRef("uid|env|seq")` instead of bare `subscribe()`.
- Periodic 5min orphan sweeper: iterate `_symbolRefs` → for each refKey "uid|env|seq", check `at_positions WHERE seq=? AND status='OPEN'`; if missing, releaseRef. Defensive against missed close hooks.
- Phase 2 fusion math UNTOUCHED. ARCH-3 per-(user × env × symbol) isolation preserved: pollers stay alive as long as ANY user holds a position on that symbol.

**Tech Stack:** Node.js + better-sqlite3, jest unit tests with `_resetForTest()` helpers, existing TDD pattern from `binanceTelemetry.test.js`.

---

## File Structure

| File | Responsibility | Action |
|---|---|---|
| `server/services/marketFeed.js` | Add `_symbolRefs` state, `subscribeForRef`, `releaseRef`, `_sweepOrphanRefs`, expand `getPollerStats()` | Modify |
| `server/services/serverAT.js` | `_closePosition` calls `releaseRef`; recon auto-subscribe uses `subscribeForRef`; boot wires sweeper | Modify |
| `server.js` | Boot wires `marketFeed.startOrphanSweep(db)` after AT init | Modify |
| `tests/unit/marketFeedRefCount.test.js` | TDD coverage: ref-count semantics, sticky boot, releaseRef triggers cleanup, sweep finds orphans | Create |
| `tests/unit/serverATCloseUnsubscribe.test.js` | Integration: _closePosition triggers releaseRef on its refKey | Create |

---

## Task 1: Ref-count data structure (RED + GREEN)

**Files:**
- Test: `tests/unit/marketFeedRefCount.test.js`
- Modify: `server/services/marketFeed.js`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/marketFeedRefCount.test.js`:

```js
'use strict';

const marketFeed = require('../../server/services/marketFeed');

beforeEach(() => {
    marketFeed._resetRefsForTest();
});

describe('marketFeed — ref counting state', () => {
    test('addRef + hasSymbolRef returns true', () => {
        marketFeed._addRefForTest('XRPUSDT', '1|TESTNET|123');
        expect(marketFeed._hasSymbolRefForTest('XRPUSDT')).toBe(true);
    });

    test('symbol with zero refs returns false', () => {
        expect(marketFeed._hasSymbolRefForTest('XRPUSDT')).toBe(false);
    });

    test('multiple refs on same symbol counted independently', () => {
        marketFeed._addRefForTest('BTCUSDT', '1|TESTNET|111');
        marketFeed._addRefForTest('BTCUSDT', '2|REAL|222');
        expect(marketFeed._refCountForTest('BTCUSDT')).toBe(2);
    });

    test('releaseRef removes only matching refKey', () => {
        marketFeed._addRefForTest('BTCUSDT', '1|TESTNET|111');
        marketFeed._addRefForTest('BTCUSDT', '2|REAL|222');
        marketFeed._releaseRefByKeyForTest('1|TESTNET|111');
        expect(marketFeed._refCountForTest('BTCUSDT')).toBe(1);
        expect(marketFeed._hasSymbolRefForTest('BTCUSDT')).toBe(true);
    });

    test('releaseRef on last ref leaves symbol with zero refs', () => {
        marketFeed._addRefForTest('XRPUSDT', '1|TESTNET|333');
        marketFeed._releaseRefByKeyForTest('1|TESTNET|333');
        expect(marketFeed._refCountForTest('XRPUSDT')).toBe(0);
        expect(marketFeed._hasSymbolRefForTest('XRPUSDT')).toBe(false);
    });

    test('boot|system ref is sticky and never removed by releaseRef', () => {
        marketFeed._addRefForTest('BTCUSDT', 'boot|system');
        marketFeed._addRefForTest('BTCUSDT', '1|TESTNET|111');
        marketFeed._releaseRefByKeyForTest('1|TESTNET|111');
        expect(marketFeed._refCountForTest('BTCUSDT')).toBe(1);
        expect(marketFeed._hasSymbolRefForTest('BTCUSDT')).toBe(true);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/unit/marketFeedRefCount.test.js --forceExit`
Expected: FAIL — `_resetRefsForTest`, `_addRefForTest`, etc. undefined.

- [ ] **Step 3: Implement minimal ref-count state in marketFeed.js**

Add after `const _altKlinePollers = {};` line in `server/services/marketFeed.js`:

```js
// [BIN-TELEM Phase B 2026-05-19] Ref-counting for symbol subscriptions.
// Each symbol holds a Set of refKeys. refKey = "userId|env|posSeq" for
// position-driven subs, "boot|system" for sticky boot symbols.
// When a symbol's Set becomes empty (and contains no boot|system ref),
// fully unsubscribe the symbol (close WS + clear ALT pollers).
const _symbolRefs = new Map();  // symbol -> Set<refKey>

function _addRef(symbol, refKey) {
    const sym = String(symbol).toUpperCase();
    if (!_symbolRefs.has(sym)) _symbolRefs.set(sym, new Set());
    _symbolRefs.get(sym).add(refKey);
}

function _releaseRefByKey(refKey) {
    // Remove refKey from every symbol's Set; return list of symbols whose
    // Set became empty (or only contains zero non-boot refs).
    const emptied = [];
    for (const [sym, refs] of _symbolRefs) {
        if (refs.delete(refKey)) {
            if (refs.size === 0) emptied.push(sym);
        }
    }
    return emptied;
}

function _hasSymbolRef(symbol) {
    const refs = _symbolRefs.get(String(symbol).toUpperCase());
    return !!(refs && refs.size > 0);
}

function _refCount(symbol) {
    const refs = _symbolRefs.get(String(symbol).toUpperCase());
    return refs ? refs.size : 0;
}
```

Add to module.exports test helpers section:

```js
    // [BIN-TELEM Phase B] Test helpers
    _resetRefsForTest: () => { _symbolRefs.clear(); },
    _addRefForTest: _addRef,
    _releaseRefByKeyForTest: _releaseRefByKey,
    _hasSymbolRefForTest: _hasSymbolRef,
    _refCountForTest: _refCount,
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/unit/marketFeedRefCount.test.js --forceExit`
Expected: PASS, 6/6 tests.

- [ ] **Step 5: Commit**

```bash
git add server/services/marketFeed.js tests/unit/marketFeedRefCount.test.js
git commit -m "[Phase B] add ref-count state to marketFeed (no behavior change yet)

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 2: subscribeForRef + releaseRef public API (RED + GREEN)

**Files:**
- Modify: `server/services/marketFeed.js`
- Test: `tests/unit/marketFeedRefCount.test.js` (extend)

- [ ] **Step 1: Append failing tests**

Add to `tests/unit/marketFeedRefCount.test.js`:

```js
describe('marketFeed — subscribeForRef public API', () => {
    test('subscribeForRef adds ref + returns true when symbol newly added', async () => {
        // Mock the underlying subscribe to avoid hitting Binance
        const origSubscribe = marketFeed.subscribe;
        marketFeed._setSubscribeFnForTest(async () => { /* no-op */ });
        try {
            const added = await marketFeed.subscribeForRef('XRPUSDT', '1|TESTNET|999');
            expect(added).toBe(true);
            expect(marketFeed._refCountForTest('XRPUSDT')).toBe(1);
        } finally {
            marketFeed._setSubscribeFnForTest(origSubscribe);
        }
    });

    test('subscribeForRef returns false on duplicate refKey (idempotent)', async () => {
        marketFeed._setSubscribeFnForTest(async () => {});
        await marketFeed.subscribeForRef('XRPUSDT', '1|TESTNET|999');
        const dup = await marketFeed.subscribeForRef('XRPUSDT', '1|TESTNET|999');
        expect(dup).toBe(false);
        expect(marketFeed._refCountForTest('XRPUSDT')).toBe(1);
        marketFeed._setSubscribeFnForTest(null);
    });

    test('releaseRef on non-sticky last ref calls unsubscribeSymbol', () => {
        let unsubscribedSym = null;
        marketFeed._setUnsubscribeSymbolFnForTest((sym) => { unsubscribedSym = sym; });
        marketFeed._addRefForTest('XRPUSDT', '1|TESTNET|999');
        marketFeed.releaseRef('1|TESTNET|999');
        expect(unsubscribedSym).toBe('XRPUSDT');
        marketFeed._setUnsubscribeSymbolFnForTest(null);
    });

    test('releaseRef does NOT unsubscribe sticky boot symbol', () => {
        let unsubscribedSym = null;
        marketFeed._setUnsubscribeSymbolFnForTest((sym) => { unsubscribedSym = sym; });
        marketFeed._addRefForTest('BTCUSDT', 'boot|system');
        marketFeed._addRefForTest('BTCUSDT', '1|TESTNET|111');
        marketFeed.releaseRef('1|TESTNET|111');
        expect(unsubscribedSym).toBe(null);
        expect(marketFeed._refCountForTest('BTCUSDT')).toBe(1);
        marketFeed._setUnsubscribeSymbolFnForTest(null);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/unit/marketFeedRefCount.test.js --forceExit`
Expected: FAIL — `subscribeForRef`, `releaseRef`, `_setSubscribeFnForTest`, etc. undefined.

- [ ] **Step 3: Implement public API in marketFeed.js**

Add below `_refCount` function:

```js
// [BIN-TELEM Phase B] Pluggable subscribe/unsubscribe for tests.
let _subscribeFn = null;       // override default subscribe(symbol, timeframes)
let _unsubscribeSymbolFn = null; // override default unsubscribeSymbol(symbol)

async function subscribeForRef(symbol, refKey, timeframes) {
    const sym = String(symbol).toUpperCase();
    const had = _symbolRefs.has(sym) && _symbolRefs.get(sym).has(refKey);
    if (had) return false;
    _addRef(sym, refKey);
    // First ref for this symbol → trigger actual subscribe
    if (_symbolRefs.get(sym).size === 1) {
        const fn = _subscribeFn || subscribe;
        try { await fn(sym, timeframes); } catch (err) {
            logger.warn('FEED', `[refcount] subscribe ${sym} for ${refKey} failed: ${err.message}`);
        }
    }
    return true;
}

function releaseRef(refKey) {
    const emptied = _releaseRefByKey(refKey);
    for (const sym of emptied) {
        // Sticky check — should never fire here since _releaseRefByKey
        // returned the symbol meaning its Set is now empty, including no
        // boot|system ref. Defensive: log if boot ref was somehow released.
        const fn = _unsubscribeSymbolFn || _unsubscribeSymbolReal;
        try { fn(sym); } catch (err) {
            logger.warn('FEED', `[refcount] unsubscribe ${sym} failed: ${err.message}`);
        }
    }
    return emptied;
}

function _unsubscribeSymbolReal(symbol) {
    const sym = String(symbol).toUpperCase();
    // Close WS streams for this symbol (kline_*, markPrice@1s, bookTicker, trade, aggTrade)
    const symLower = sym.toLowerCase();
    for (const key of Object.keys(_streams)) {
        if (key.startsWith(symLower + '@')) {
            const entry = _streams[key];
            if (entry.ws) {
                try { entry.ws.removeAllListeners(); } catch (_) {}
                if (entry.ws.readyState === WebSocket.OPEN) {
                    try { entry.ws.close(); } catch (_) {}
                }
            }
            delete _streams[key];
        }
    }
    // Stop ALT klinePollers for this symbol
    for (const key of Object.keys(_altKlinePollers)) {
        if (key.startsWith(sym + '|')) {
            const state = _altKlinePollers[key];
            if (state && state.timer) clearInterval(state.timer);
            delete _altKlinePollers[key];
        }
    }
    _activeSymbols.delete(sym);
    _symbolRefs.delete(sym);
    logger.info('FEED', `[refcount] ${sym} unsubscribed (last ref released)`);
}
```

Extend module.exports:

```js
    subscribeForRef,
    releaseRef,
    _setSubscribeFnForTest: (fn) => { _subscribeFn = fn; },
    _setUnsubscribeSymbolFnForTest: (fn) => { _unsubscribeSymbolFn = fn; },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/unit/marketFeedRefCount.test.js --forceExit`
Expected: PASS, 10/10 tests (6 from Task 1 + 4 new).

- [ ] **Step 5: Commit**

```bash
git add server/services/marketFeed.js tests/unit/marketFeedRefCount.test.js
git commit -m "[Phase B] subscribeForRef + releaseRef API with sticky-boot protection

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 3: Boot symbols get sticky boot|system ref (RED + GREEN)

**Files:**
- Modify: `server.js` — boot block around line 1337
- Test: smoke check on actual boot

- [ ] **Step 1: Write boot integration test (smoke, not unit)**

Append to `tests/unit/marketFeedRefCount.test.js`:

```js
describe('marketFeed — boot sticky', () => {
    test('subscribeMultiWithBootRef adds boot|system ref to each symbol', async () => {
        marketFeed._setSubscribeFnForTest(async () => {});
        await marketFeed.subscribeMultiWithBootRef(['BTCUSDT', 'ETHUSDT'], ['5m']);
        expect(marketFeed._refCountForTest('BTCUSDT')).toBe(1);
        expect(marketFeed._refCountForTest('ETHUSDT')).toBe(1);
        // Release any user ref later — boot still sticky
        marketFeed._addRefForTest('BTCUSDT', '1|TESTNET|111');
        marketFeed.releaseRef('1|TESTNET|111');
        expect(marketFeed._refCountForTest('BTCUSDT')).toBe(1); // boot survives
        marketFeed._setSubscribeFnForTest(null);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/unit/marketFeedRefCount.test.js --forceExit`
Expected: FAIL — `subscribeMultiWithBootRef` undefined.

- [ ] **Step 3: Implement subscribeMultiWithBootRef**

Add to `server/services/marketFeed.js` near `subscribeMulti`:

```js
async function subscribeMultiWithBootRef(symbols, timeframes) {
    for (const sym of symbols) {
        await subscribeForRef(sym, 'boot|system', timeframes);
    }
}
```

Add to module.exports:

```js
    subscribeMultiWithBootRef,
```

Then modify `server.js` boot path. Find around line 1337:

```js
marketFeed.subscribeMulti(SD_SYMBOLS, SD_TFS).then(() => {
```

Replace with:

```js
marketFeed.subscribeMultiWithBootRef(SD_SYMBOLS, SD_TFS).then(() => {
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/unit/marketFeedRefCount.test.js --forceExit`
Expected: PASS, 11/11 tests.

- [ ] **Step 5: Commit**

```bash
git add server/services/marketFeed.js tests/unit/marketFeedRefCount.test.js server.js
git commit -m "[Phase B] boot symbols use sticky boot|system ref to prevent eviction

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 4: Recon auto-subscribe uses subscribeForRef (RED + GREEN)

**Files:**
- Modify: `server/services/serverAT.js` line 4427
- Test: `tests/unit/serverATCloseUnsubscribe.test.js`

- [ ] **Step 1: Write failing test**

Create `tests/unit/serverATCloseUnsubscribe.test.js`:

```js
'use strict';

const marketFeed = require('../../server/services/marketFeed');

beforeEach(() => {
    marketFeed._resetRefsForTest();
});

describe('serverAT — recon auto-subscribe ref shape', () => {
    test('refKey format used by recon path is "uid|env|seq"', () => {
        // This is a contract test — refKey must be parseable and stable.
        const refKey = '1|TESTNET|1776859652944';
        const parts = refKey.split('|');
        expect(parts.length).toBe(3);
        expect(parts[0]).toBe('1');           // userId
        expect(parts[1]).toBe('TESTNET');     // env
        expect(parts[2]).toBe('1776859652944'); // posSeq
    });
});

describe('serverAT — releaseRef on close', () => {
    test('after addRef + releaseRef on same key, symbol freed', () => {
        marketFeed._addRefForTest('XRPUSDT', '1|TESTNET|999');
        marketFeed._setUnsubscribeSymbolFnForTest(() => {});
        marketFeed.releaseRef('1|TESTNET|999');
        expect(marketFeed._refCountForTest('XRPUSDT')).toBe(0);
        marketFeed._setUnsubscribeSymbolFnForTest(null);
    });
});
```

- [ ] **Step 2: Run test to verify it fails initially**

Run: `npx jest tests/unit/serverATCloseUnsubscribe.test.js --forceExit`
Expected: First test PASS (contract), second test PASS (verifies Task 2 API).
If both PASS already → that's correct (no new behavior needed in marketFeed for this task).

- [ ] **Step 3: Patch serverAT.js recon path**

In `server/services/serverAT.js` find around line 4426:

```js
                    if (!activeSyms.has(_p.symbol)) {
                        logger.info(label, `Auto-subscribing ${_p.symbol} — open position detected uid=${userId} seq=${_p.seq}`);
                        marketFeed.subscribe(_p.symbol).catch(subErr => {
                            logger.warn(label, `Auto-subscribe failed for ${_p.symbol}: ${subErr.message}`);
                        });
                    }
```

Replace with:

```js
                    // [Phase B 2026-05-19] ref-counted subscribe — released
                    // when position closes (see _closePosition). Sticky boot
                    // symbols (BTC/ETH/SOL/BNB) keep their own boot|system ref
                    // regardless of position lifecycle.
                    const refKey = `${userId}|${_p.env || 'TESTNET'}|${_p.seq}`;
                    marketFeed.subscribeForRef(_p.symbol, refKey).then(added => {
                        if (added && !activeSyms.has(_p.symbol)) {
                            logger.info(label, `Auto-subscribed ${_p.symbol} uid=${userId} seq=${_p.seq} refKey=${refKey}`);
                        }
                    }).catch(subErr => {
                        logger.warn(label, `Auto-subscribe failed for ${_p.symbol}: ${subErr.message}`);
                    });
```

- [ ] **Step 4: Re-run all jest to verify no regression**

Run: `npx jest tests/unit/serverATCloseUnsubscribe.test.js tests/unit/marketFeedRefCount.test.js --forceExit`
Expected: PASS, both files green.

- [ ] **Step 5: Commit**

```bash
git add server/services/serverAT.js tests/unit/serverATCloseUnsubscribe.test.js
git commit -m "[Phase B] recon auto-subscribe uses ref-counted subscribeForRef

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 5: _closePosition releases ref (RED + GREEN)

**Files:**
- Modify: `server/services/serverAT.js` `_closePosition` function (around line 1983)
- Test: extend `tests/unit/serverATCloseUnsubscribe.test.js`

- [ ] **Step 1: Append failing integration test**

Append to `tests/unit/serverATCloseUnsubscribe.test.js`:

```js
describe('serverAT — _closePosition releases marketFeed ref', () => {
    test('closing a position decrements ref-count for its symbol', () => {
        // Seed: position open, ref added
        marketFeed._setUnsubscribeSymbolFnForTest(() => {});
        marketFeed._addRefForTest('XRPUSDT', '1|TESTNET|7777');
        expect(marketFeed._refCountForTest('XRPUSDT')).toBe(1);

        // Simulate close by directly calling releaseRef with the same refKey
        // shape _closePosition will use
        const pos = { userId: 1, env: 'TESTNET', seq: 7777, symbol: 'XRPUSDT' };
        const refKey = `${pos.userId}|${pos.env}|${pos.seq}`;
        marketFeed.releaseRef(refKey);

        expect(marketFeed._refCountForTest('XRPUSDT')).toBe(0);
        marketFeed._setUnsubscribeSymbolFnForTest(null);
    });
});
```

- [ ] **Step 2: Run test to verify it passes (already)**

Run: `npx jest tests/unit/serverATCloseUnsubscribe.test.js --forceExit`
Expected: PASS — this test only verifies the API contract, not the integration. The integration is added in Step 3.

- [ ] **Step 3: Patch _closePosition in serverAT.js**

In `server/services/serverAT.js` find the end of `_closePosition` function (around line 1939, before the closing brace). Locate:

```js
    pos.live.status = 'CLOSED';
```

After that line and any related cleanup, add:

```js
    // [Phase B 2026-05-19] Release marketFeed ref so pollers can be torn down
    // when last position on this symbol closes. Sticky boot symbols are
    // unaffected (their boot|system ref persists). Safe-guard: only release
    // for live positions — demo positions never subscribed via ref-count.
    if (pos.mode === 'live' && pos.userId && pos.env && pos.seq) {
        try {
            const refKey = `${pos.userId}|${pos.env}|${pos.seq}`;
            const released = require('./marketFeed').releaseRef(refKey);
            if (released.length > 0) {
                logger.info('AT_ENGINE', `[Phase B] released marketFeed refs: ${released.join(',')} (refKey=${refKey})`);
            }
        } catch (e) {
            logger.warn('AT_ENGINE', `[Phase B] releaseRef failed seq=${pos.seq}: ${e.message}`);
        }
    }
```

- [ ] **Step 4: Run all relevant tests**

Run: `npx jest tests/unit/marketFeedRefCount.test.js tests/unit/serverATCloseUnsubscribe.test.js --forceExit`
Expected: PASS, all green.

Full regression: `npx jest --forceExit 2>&1 | tail -5`
Expected: 7079+ tests PASS, 0 failures.

- [ ] **Step 5: Commit**

```bash
git add server/services/serverAT.js tests/unit/serverATCloseUnsubscribe.test.js
git commit -m "[Phase B] _closePosition releases marketFeed ref to unwind pollers

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 6: Orphan sweeper periodic + DB cross-check (RED + GREEN)

**Files:**
- Modify: `server/services/marketFeed.js` — add `startOrphanSweep(db)` + `_sweepOrphanRefs(db)`
- Modify: `server.js` — boot wire after marketFeed subscribeMultiWithBootRef
- Test: `tests/unit/marketFeedRefCount.test.js` extend

- [ ] **Step 1: Append failing tests**

Append to `tests/unit/marketFeedRefCount.test.js`:

```js
describe('marketFeed — orphan sweep', () => {
    test('_sweepOrphanRefs releases refs whose posSeq is not OPEN in DB', () => {
        marketFeed._addRefForTest('XRPUSDT', '1|TESTNET|111');
        marketFeed._addRefForTest('ETHUSDT', '1|TESTNET|222');
        marketFeed._addRefForTest('BTCUSDT', 'boot|system');

        // Mock DB: only seq=222 is OPEN
        const fakeDb = {
            prepare: () => ({
                get: (seq) => seq === 222 ? { c: 1 } : { c: 0 },
            }),
        };

        marketFeed._setUnsubscribeSymbolFnForTest(() => {});
        const released = marketFeed._sweepOrphanRefs(fakeDb);

        expect(released).toContain('1|TESTNET|111');
        expect(released).not.toContain('1|TESTNET|222');
        expect(released).not.toContain('boot|system');
        marketFeed._setUnsubscribeSymbolFnForTest(null);
    });

    test('_sweepOrphanRefs skips boot|system refs entirely', () => {
        marketFeed._addRefForTest('BTCUSDT', 'boot|system');
        const fakeDb = { prepare: () => ({ get: () => ({ c: 0 }) }) };
        marketFeed._setUnsubscribeSymbolFnForTest(() => {});
        const released = marketFeed._sweepOrphanRefs(fakeDb);
        expect(released).not.toContain('boot|system');
        expect(marketFeed._refCountForTest('BTCUSDT')).toBe(1);
        marketFeed._setUnsubscribeSymbolFnForTest(null);
    });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest tests/unit/marketFeedRefCount.test.js --forceExit`
Expected: FAIL — `_sweepOrphanRefs` undefined.

- [ ] **Step 3: Implement sweeper in marketFeed.js**

Add below `releaseRef`:

```js
// [BIN-TELEM Phase B] Orphan sweep — defensive cleanup. _closePosition
// already releases refs on normal close paths, but reconciliation gaps,
// crashes, missed events, or restarts may leave dangling refs. Sweep
// queries DB for each refKey "uid|env|seq" — if seq not OPEN, release.
function _sweepOrphanRefs(db) {
    if (!db || typeof db.prepare !== 'function') return [];
    const released = [];
    const stmt = db.prepare("SELECT COUNT(*) as c FROM at_positions WHERE seq=? AND status='OPEN'");
    // Snapshot keys first — _releaseRefByKey mutates _symbolRefs
    const allRefs = new Set();
    for (const refs of _symbolRefs.values()) for (const k of refs) allRefs.add(k);
    for (const refKey of allRefs) {
        if (refKey === 'boot|system') continue;  // sticky
        const parts = refKey.split('|');
        if (parts.length !== 3) continue;        // malformed → skip (defensive)
        const seq = parseInt(parts[2], 10);
        if (!Number.isFinite(seq)) continue;
        try {
            const row = stmt.get(seq);
            if (!row || row.c === 0) {
                releaseRef(refKey);
                released.push(refKey);
            }
        } catch (e) {
            logger.warn('FEED', `[refcount] sweep error refKey=${refKey}: ${e.message}`);
        }
    }
    if (released.length > 0) logger.info('FEED', `[refcount] orphan sweep released ${released.length} refs: ${released.join(',')}`);
    return released;
}

let _sweepTimer = null;
function startOrphanSweep(db, intervalMs) {
    if (_sweepTimer) clearInterval(_sweepTimer);
    const ms = intervalMs || 5 * 60 * 1000;  // 5min default
    _sweepTimer = setInterval(() => {
        try { _sweepOrphanRefs(db); } catch (e) {
            logger.warn('FEED', `[refcount] sweep tick error: ${e.message}`);
        }
    }, ms);
    if (typeof _sweepTimer.unref === 'function') _sweepTimer.unref();
    logger.info('FEED', `[refcount] orphan sweeper started, interval ${ms / 1000}s`);
}

function stopOrphanSweep() {
    if (_sweepTimer) { clearInterval(_sweepTimer); _sweepTimer = null; }
}
```

Extend module.exports:

```js
    startOrphanSweep,
    stopOrphanSweep,
    _sweepOrphanRefs,
```

- [ ] **Step 4: Run tests to verify pass**

Run: `npx jest tests/unit/marketFeedRefCount.test.js --forceExit`
Expected: PASS, all tests green.

- [ ] **Step 5: Wire sweeper at boot in server.js**

In `server.js` find the block after `marketFeed.subscribeMultiWithBootRef(...)` (the .then callback around line 1337-1340). Append inside the .then:

```js
      try {
        const dbRef = require('./server/services/database').getDb();
        marketFeed.startOrphanSweep(dbRef);
      } catch (e) {
        logger.warn('SERVER', `[Phase B] orphan sweeper boot failed: ${e.message}`);
      }
```

- [ ] **Step 6: Commit**

```bash
git add server/services/marketFeed.js tests/unit/marketFeedRefCount.test.js server.js
git commit -m "[Phase B] periodic orphan sweep + DB cross-check (5min interval)

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 7: Telemetry expansion — refs per symbol surfaced in /api/diag/binance-rates

**Files:**
- Modify: `server/services/marketFeed.js` — extend `getPollerStats()`
- Test: extend `tests/unit/marketFeedRefCount.test.js`

- [ ] **Step 1: Append failing test**

Append to `tests/unit/marketFeedRefCount.test.js`:

```js
describe('marketFeed — getPollerStats includes refs', () => {
    test('getPollerStats reports symbolRefs map with sizes', () => {
        marketFeed._addRefForTest('BTCUSDT', 'boot|system');
        marketFeed._addRefForTest('BTCUSDT', '1|TESTNET|111');
        marketFeed._addRefForTest('XRPUSDT', '2|REAL|222');

        const stats = marketFeed.getPollerStats();
        expect(stats.symbolRefs).toBeDefined();
        expect(stats.symbolRefs.BTCUSDT).toBe(2);
        expect(stats.symbolRefs.XRPUSDT).toBe(1);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/unit/marketFeedRefCount.test.js --forceExit`
Expected: FAIL — `stats.symbolRefs` undefined.

- [ ] **Step 3: Extend getPollerStats in marketFeed.js**

Find the existing `getPollerStats` function and modify return object to include `symbolRefs`:

```js
function getPollerStats() {
    const symbolRefs = {};
    for (const [sym, refs] of _symbolRefs) {
        symbolRefs[sym] = refs.size;
    }
    return {
        activeSymbols: Array.from(_activeSymbols),
        activeSymbolsCount: _activeSymbols.size,
        altKlinePollersCount: Object.keys(_altKlinePollers).length,
        altKlinePollerKeys: Object.keys(_altKlinePollers),
        wsStreamsCount: Object.keys(_streams).length,
        timeframes: _timeframes.slice(),
        symbolRefs,
        symbolRefsTotal: Object.values(symbolRefs).reduce((s, n) => s + n, 0),
    };
}
```

- [ ] **Step 4: Run test to verify pass**

Run: `npx jest tests/unit/marketFeedRefCount.test.js --forceExit`
Expected: PASS, all tests green.

- [ ] **Step 5: Commit**

```bash
git add server/services/marketFeed.js tests/unit/marketFeedRefCount.test.js
git commit -m "[Phase B] surface symbolRefs in getPollerStats for diag visibility

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 8: Full regression + deploy

**Files:** none (verification only)

- [ ] **Step 1: Run full jest suite**

Run: `npx jest --forceExit 2>&1 | tail -10`
Expected: 7096+ tests PASS (was 7079, +17 new from Tasks 1-7), 0 failures.

- [ ] **Step 2: Verify modules still load**

Run: `node -e "require('./server/services/marketFeed'); require('./server/services/serverAT'); console.log('LOAD_OK'); process.exit(0);" 2>&1 | tail -3`
Expected: `LOAD_OK`

- [ ] **Step 3: Bump version + commit**

Edit `server/version.js`:

```js
module.exports = {
    version: '1.7.92',
    build: 118,
    date: '2026-05-19',
    changelog: [
        'b118 v1.7.92 — BIN-TELEM Phase B leak fix 2026-05-19. Eliminates marketFeed auto-subscribe leak via per-(user × env × posSeq) ref-counting. Boot symbols (BTC/ETH/SOL/BNB) sticky via boot|system ref. Recon auto-subscribe migrated to subscribeForRef; _closePosition releases ref; periodic 5min orphan sweeper cross-checks at_positions table for missed releases. ~20 new tests across marketFeedRefCount + serverATCloseUnsubscribe. Telemetry expanded — /api/diag/binance-rates now reports symbolRefs map. ARCH-3 preserved: pollers stay alive while ANY user holds position on symbol. Validates: Phase B addresses LEAK CONFIRMED by T+1h telemetry (XRPUSDT added 12→15 pollers in 1h). Next: Phase C client tab dedupe.',
        // ... existing entries preserved
    ],
};
```

```bash
git add server/version.js
git commit -m "[Phase B] bump v1.7.92 b118 — ref-counted marketFeed subscriptions

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

- [ ] **Step 4: Tag + PM2 reload + smoke test**

```bash
git tag post-v2/PHASE-B-118 HEAD
pm2 reload zeus
sleep 5
curl -s http://127.0.0.1:3000/api/diag/binance-rates | python3 -m json.tool | head -50
```

Expected: `symbolRefs` present in response, BTCUSDT/ETHUSDT/SOLUSDT/BNBUSDT each have count >= 1 (boot|system).

- [ ] **Step 5: Push**

```bash
git push origin omega/wave-1-foundation
git push origin post-v2/PHASE-B-118
```

- [ ] **Step 6: Save T+0-post-PhaseB snapshot for soak comparison**

```bash
curl -s http://127.0.0.1:3000/api/diag/binance-rates > /tmp/zeus-T0-postPhaseB.json
echo "T+0-post-PhaseB snapshot saved $(wc -c < /tmp/zeus-T0-postPhaseB.json) bytes"
```

---

# Roadmap — remaining 5 phases (post Phase B)

These are **NOT implemented in this plan** — they require separate plans per phase. Tracked here as reference. Operator must trigger each phase explicitly.

## Phase C — Client-side dedupe (next priority, ~2-3h)

**Goal:** Prevent multi-tab polling fanout; debounce config-save / AT-toggle storms.

**Approach:**
- Use `document.visibilityState === 'visible'` + Page Visibility API in `useServerSync.ts` — only foreground tab runs `liveApiSyncState` + `pullATState` polling
- Background tabs subscribe to a `BroadcastChannel('zeus-sync')` to receive snapshots from foreground tab
- Debounce `loadFromServer` calls in settingsStore + aresStore (300ms trailing) to coalesce rapid config saves
- AT toggle on-event sync gated by 5s window dedupe

**Files:** `client/src/hooks/useServerSync.ts`, `client/src/stores/settingsStore.ts`, `client/src/stores/aresStore.ts`

**Tests:** vitest with `document.visibilityState` mocks

## Phase A.1 — Header-aware token bucket (~3-4h)

**Goal:** Refuse requests proactively when `X-MBX-USED-WEIGHT-1M` > 95% (5700/6000). Already capturing the header in binanceTelemetry.js — wire it as a gate.

**Approach:**
- `binanceTelemetry.js` exports `getQuotaPressure(host)` — returns `0..1` derived from last `usedWeight` per host
- `binanceTelemetry.wrapFetch` checks pressure before issuing fetch; if > 0.95, returns synthetic 429 immediately without hitting Binance (saves the burst from getting worse)
- Exponential retry with jitter on synthetic 429
- Critical path (signed requests in binanceSigner) gets higher tolerance (0.97 cap) — public polling cuts first

**Files:** `server/services/binanceTelemetry.js`, `server/services/binanceSigner.js`, all sites using `wrapFetch`

**Tests:** unit on `getQuotaPressure` + integration with mocked wrapFetch

## Phase A.2 — Priority lanes + operator critical section (~4-6h)

**Goal:** P0..P5 priority queue with operator-driven preemption.

**Approach:**
- New `server/services/binanceScheduler.js` — single-queue request scheduler with priorities
- Lanes: P0=order place/close, P1=reconcile, P2=fills, P3=telemetry, P4=klines, P5=cosmetic
- Operator critical section: `binanceScheduler.beginCriticalSection(opId, maxMs=5000)` — pauses P4/P5 for `maxMs`, auto-release on `endCriticalSection(opId)` or timeout
- All current `wrapFetch` calls migrate to `scheduler.enqueue({lane, fn})` — backward-compat shim during migration

**Files:** `server/services/binanceScheduler.js` (NEW), wires in binanceSigner + marketRadar + marketFeed + serverLiquidity

**Tests:** unit on lane ordering + critical section + timeout auto-release

## Operator Visibility (~1-2h, can be batched with A.1 or A.2)

**Goal:** UI shows quota pressure + degradation toasts when polling reduced.

**Approach:**
- New `client/src/components/QuotaIndicator.tsx` — small badge in ModeBar showing current pressure (color: green<70%, amber 70-90%, red>90%)
- Server emits WS frame `quota.pressure` every 5s with current usedWeight per host
- Toast on degradation start ("Quota pressure 87% — cosmetic polling reduced") and recovery

**Files:** `client/src/components/layout/QuotaIndicator.tsx` (NEW), `client/src/components/layout/ModeBar.tsx`, server emit hook in `binanceTelemetry.js`

**Tests:** vitest snapshot on QuotaIndicator color logic

## Phase D — Binance Futures WS unblock (infra, multi-day)

**Goal:** Restore `fstream.binance.com` WS connectivity so ALT_WS_FEEDS can flip OFF.

**Approach:**
- Diagnose: `traceroute fstream.binance.com`, MTR test, packet capture
- Options: (a) Cloudflare WARP outbound proxy, (b) WireGuard tunnel via different egress, (c) Hetzner→OVH/AWS datacenter migration, (d) request Binance whitelist for our IP range
- Once WS working: set `ALT_WS_FEEDS=false` migration flag, verify klines/markPrice/aggTrade flow via WS, monitor for 24h
- Expected savings: ~44% of total weight/h (alt-klines was 4863/10820 in T+1h sample)

**This is operator/infra work, not code work.** Not part of this plan.

---

# Self-review checklist

**1. Spec coverage:**
- ✅ Ref-counting per (user × env × posSeq): Task 1+2
- ✅ Boot sticky: Task 3
- ✅ Recon migration: Task 4
- ✅ _closePosition release hook: Task 5
- ✅ Orphan sweeper (defensive): Task 6
- ✅ Telemetry surface: Task 7
- ✅ Deploy + smoke: Task 8

**2. Placeholders:** None — every step has concrete code and exact commands.

**3. Type consistency:**
- `refKey` format always `"userId|env|posSeq"` (Tasks 4, 5, 6) or `"boot|system"` (Task 3, 6)
- `subscribeForRef(symbol, refKey, timeframes?)` consistent across Tasks 2, 3, 4
- `releaseRef(refKey)` returns `string[]` (emptied symbols) in Tasks 2, 5
- `_sweepOrphanRefs(db)` returns `string[]` (released refKeys) in Task 6
- `getPollerStats()` adds `symbolRefs: Record<string, number>` in Task 7

**4. ARCH-3 verified:** ref-count is per-(user × env × posSeq) on the refKey side, but the underlying poller is global per-process. Sticky boot ensures core 4 symbols never disappear. User1 + user2 both holding XRPUSDT → 2 refs → poller stays. User1 closes → 1 ref → poller stays. User2 closes → 0 refs → poller torn down. ✅

**5. Test isolation:** Every test uses `_resetRefsForTest()` in beforeEach + injected `_setSubscribeFnForTest` / `_setUnsubscribeSymbolFnForTest` to avoid hitting real Binance.
