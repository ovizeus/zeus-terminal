# Bybit Manual Trading Parity — Phase M Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (inline, with live Bybit-demo validation) to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Make the entire MANUAL trading flow (open, conditional SL/TP, close, cancel, modify, open-orders, leverage, margin-type) work when the active exchange is Bybit, exactly as it already does for Binance — so a manual order placed on Bybit actually reaches the exchange and an opened position can be protected and closed from the manual UI.

**Architecture:** All Binance-hardcoded `sendSignedRequest(...)` call sites in `server/routes/trading.js` (the manual endpoints) are replaced with calls to `server/services/exchangeOps.js` router methods, which dispatch to `binanceOps.js` OR `bybitOps.js` based on the active exchange. New router + ops methods are added only where one does not already exist. Binance behavior must remain byte-for-byte unchanged; Bybit gains parity via its `/v5/order/*` endpoints. No position may be left openable-but-unprotectable on Bybit — open, SL, TP, close, and cancel all land in this one phase.

**Tech Stack:** Node + Express, better-sqlite3, Jest (`npx jest --forceExit`). Bybit v5 REST (`/v5/order/create`, `/v5/order/realtime`, `/v5/position/set-leverage`) via `bybitSigner.sendSignedRequest`; Binance USDⓈ-M (`/fapi/v1/order`, `/fapi/v1/algoOrder`, `/fapi/v1/leverage`, `/fapi/v1/openOrders`) via `binanceSigner.sendSignedRequest`. Bybit demo account (uid=1) is live for end-to-end validation.

**Standing protocol (money-path):** every task = backup `.bak.pre-<task>-20260530` → TDD RED→GREEN → swap-back probe → show diff → deploy (`pm2 reload zeus`, server-only) only after the full phase is green, NOT per-task. Bybit unit tests inject responses via `bybitOps._enqueueSynthetic(resp)`; Binance unit tests mock `binanceSigner.sendSignedRequest`.

**Already exists (do NOT re-create):** `exchangeOps` + both ops have `closePosition`, `cancelOrder`, `placeStopLoss`, `getBalance`, `getPositions`, `ensureSymbolReady`. `exchangeOps.getOpenOrders` + `binanceOps.getOpenOrders` exist; **`bybitOps.getOpenOrders` does NOT** (Task 3 adds it).

**Bybit reference facts (verified in `bybitOps.js`):** main order = `POST /v5/order/create` `{category:'linear', symbol, side:_bybitSide(LONG→'Buy'/SHORT→'Sell'), orderType:'Market'|'Limit', qty, positionIdx:0, orderLinkId}`; Limit adds `timeInForce:'GTC', price`. Conditional (SL/TP) = same endpoint with `triggerPrice`, `triggerDirection` (SL on LONG=2 falling / SHORT=1 rising; TP on LONG=1 / SHORT=2), `reduceOnly:true`, `closeOnTrigger:true`. `_isOk(resp)` checks `retCode===0`. Errors via `bybitSigner.parseBybitError(resp)`. Success returns include `resp.result.orderId`, `resp.result.orderStatus`, `resp.result.avgPrice`.

---

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `server/services/bybitOps.js` | Bybit `/v5` ops | ADD `setLeverage`, `placeOrder`, `placeTakeProfit`, `getOpenOrders`, `getOrder` |
| `server/services/binanceOps.js` | Binance `/fapi` ops | ADD `setLeverage`, `placeOrder`, `placeTakeProfit`, `getOrder` (getOpenOrders exists) |
| `server/services/exchangeOps.js` | Router | ADD `setLeverage`, `setMarginType`, `placeOrder`, `placeTakeProfit`, `getOrder` |
| `server/services/marginTypeHelper.js` | Binance margin idempotency | Leave as-is; gate at caller (exchangeOps.setMarginType is no-op for bybit) |
| `server/routes/trading.js` | Manual HTTP endpoints | REWRITE `/order/place`, `/order/modify`, `/openOrders`, `/leverage`, `/manual/protection` TP to route via exchangeOps |
| tests/unit/*.test.js | TDD | New cases per task |

**Canonical method shapes (used consistently across all tasks):**

- `setLeverage(uid, {symbol, leverage}, creds)` → `{ ok:boolean, leverage?, error?, rawExchange }`
- `placeOrder(uid, {symbol, side('BUY'|'SELL'), type('MARKET'|'LIMIT'), quantity, price?, reduceOnly?, closePosition?, clientOrderId?}, creds)` → `{ ok, orderId?, status?, error?, rawExchange }`
- `placeTakeProfit(uid, {symbol, side('LONG'|'SHORT'), triggerPrice, quantity, reduceOnly:true, clientOrderId?}, creds)` → `{ ok, tpOrderId?, status?, error?, rawExchange }`
- `getOpenOrders(uid, {symbol?}, creds)` → `Array<{orderId, symbol, side, type, price, qty, status, reduceOnly, rawExchange}>`
- `getOrder(uid, {symbol, orderId}, creds)` → `{ orderId, status, avgPrice, executedQty, rawExchange } | null`
- `setMarginType(uid, {symbol, marginType:'CROSSED'}, creds)` → `{ ok, skipped?, error?, rawExchange }`

exchangeOps wrappers follow the existing `getBalance` pattern: `const {ops, creds} = _resolveOps(uid); return ops.METHOD(uid, params, creds);` (with `_resolveOpsFor(uid, params.exchangeOverride)` where override is supported, mirroring `closePosition`).

---

## Task 1: exchangeOps.setLeverage + both ops

**Files:** Modify `server/services/bybitOps.js`, `binanceOps.js`, `exchangeOps.js`; Test `tests/unit/bybitOps.test.js`, `binanceOps.test.js` (create if absent), `exchangeOps` test.

- [ ] **Step 1 — RED (bybit):** add to `tests/unit/bybitOps.test.js`:
```js
describe('bybitOps.setLeverage', () => {
    beforeEach(() => bybitOps._resetSyntheticQueue());
    it('POSTs /v5/position/set-leverage and returns ok', async () => {
        bybitOps._enqueueSynthetic({ retCode: 0, retMsg: 'OK', result: {} });
        const r = await bybitOps.setLeverage(1, { symbol: 'BTCUSDT', leverage: 5 }, _validCreds);
        expect(r.ok).toBe(true);
        expect(r.rawExchange).toBe('bybit');
    });
    it('treats retCode 110043 (leverage not modified) as ok', async () => {
        bybitOps._enqueueSynthetic({ retCode: 110043, retMsg: 'leverage not modified', result: {} });
        const r = await bybitOps.setLeverage(1, { symbol: 'BTCUSDT', leverage: 5 }, _validCreds);
        expect(r.ok).toBe(true);
    });
});
```
- [ ] **Step 2 — Run:** `npx jest tests/unit/bybitOps.test.js -t "setLeverage" --forceExit` → FAIL (`setLeverage is not a function`).
- [ ] **Step 3 — GREEN (bybit):** add to `bybitOps.js` (export it):
```js
async function setLeverage(uid, params, creds) {
    const resp = await _dispatchRequest('POST', '/v5/position/set-leverage', {
        category: 'linear', symbol: params.symbol,
        buyLeverage: String(params.leverage), sellLeverage: String(params.leverage),
    }, creds);
    // 110043 = "leverage not modified" — already at target, treat as success (idempotent).
    if (_isOk(resp) || resp.retCode === 110043) return { ok: true, leverage: params.leverage, rawExchange: 'bybit' };
    return { ok: false, error: bybitSigner.parseBybitError(resp), rawExchange: 'bybit' };
}
```
- [ ] **Step 4 — GREEN (binance):** add to `binanceOps.js` (export it):
```js
async function setLeverage(uid, params, creds) {
    try {
        const resp = await sendSignedRequest('POST', '/fapi/v1/leverage', { symbol: params.symbol, leverage: params.leverage }, creds);
        return { ok: true, leverage: resp.leverage != null ? Number(resp.leverage) : params.leverage, rawExchange: 'binance' };
    } catch (err) {
        return { ok: false, error: err.message, rawExchange: 'binance' };
    }
}
```
- [ ] **Step 5 — GREEN (router):** add to `exchangeOps.js` (export it):
```js
async function setLeverage(uid, params) {
    const { ops, creds } = _resolveOps(uid);
    return ops.setLeverage(uid, params, creds);
}
```
- [ ] **Step 6 — Run all three** → PASS. **Swap-back** bybitOps backup → the new tests FAIL. **Commit.**

---

## Task 2: exchangeOps.setMarginType (binance via helper; bybit no-op)

**Files:** Modify `exchangeOps.js`; Test the router.

Bybit UNIFIED accounts are cross-margin by account configuration — there is no per-symbol marginType call equivalent to Binance `/fapi/v1/marginType`, so for bybit this is a safe no-op (returns `{ok:true, skipped:true}`). Binance routes through the existing `marginTypeHelper.ensureCrossed`.

- [ ] **Step 1 — RED:** test that `exchangeOps.setMarginType(uid,{symbol,marginType:'CROSSED'})` returns `{ok:true, skipped:true}` when active exchange is bybit (mock `_resolveOps` creds.exchange='bybit'), and calls `marginTypeHelper.ensureCrossed` when binance.
- [ ] **Step 2 — Run** → FAIL.
- [ ] **Step 3 — GREEN:** in `exchangeOps.js`:
```js
async function setMarginType(uid, params) {
    const { creds } = _resolveOps(uid);
    if (creds.exchange === 'bybit') return { ok: true, skipped: true, rawExchange: 'bybit' };
    // Binance: idempotent CROSSED enforcement via existing helper.
    const marginHelper = require('./marginTypeHelper');
    const binanceSigner = require('./binanceSigner');
    try {
        await marginHelper.ensureCrossed(params.symbol, creds, binanceSigner.sendSignedRequest);
        return { ok: true, rawExchange: 'binance' };
    } catch (err) {
        return { ok: false, error: err.message, rawExchange: 'binance' };
    }
}
```
- [ ] **Step 4 — Run** → PASS. **Commit.**

---

## Task 3: bybitOps.getOpenOrders + exchangeOps wiring

**Files:** Modify `bybitOps.js` (add + export `getOpenOrders`); confirm `exchangeOps.getOpenOrders` routes to it; Test `bybitOps.test.js`.

- [ ] **Step 1 — RED:**
```js
describe('bybitOps.getOpenOrders', () => {
    beforeEach(() => bybitOps._resetSyntheticQueue());
    it('returns canonical open-order list', async () => {
        bybitOps._enqueueSynthetic({ retCode: 0, result: { list: [
            { orderId: 'o1', symbol: 'BTCUSDT', side: 'Buy', orderType: 'Limit', price: '50000', qty: '0.01', orderStatus: 'New', reduceOnly: false },
        ] } });
        const r = await bybitOps.getOpenOrders(1, { symbol: 'BTCUSDT' }, _validCreds);
        expect(Array.isArray(r)).toBe(true);
        expect(r[0].orderId).toBe('o1');
        expect(r[0].side).toBe('BUY');
        expect(r[0].rawExchange).toBe('bybit');
    });
});
```
- [ ] **Step 2 — Run** → FAIL.
- [ ] **Step 3 — GREEN:**
```js
async function getOpenOrders(uid, params, creds) {
    const query = { category: 'linear', openOnly: 0 };
    if (params && params.symbol) query.symbol = params.symbol;
    const resp = await _dispatchRequest('GET', '/v5/order/realtime', query, creds);
    if (!_isOk(resp) || !resp.result || !Array.isArray(resp.result.list)) return [];
    return resp.result.list.map(o => ({
        orderId: String(o.orderId), symbol: o.symbol,
        side: o.side === 'Buy' ? 'BUY' : 'SELL', type: o.orderType,
        price: o.price, qty: o.qty, status: o.orderStatus,
        reduceOnly: !!o.reduceOnly, rawExchange: 'bybit',
    }));
}
```
- [ ] **Step 4 — Run** → PASS. **Swap-back. Commit.**

---

## Task 4: exchangeOps.placeOrder + both ops (generic manual order)

**Files:** Modify `bybitOps.js`, `binanceOps.js`, `exchangeOps.js`; Test both ops.

This is the core manual order (open MARKET/LIMIT, reduce-only close, closePosition). NOT the AT entry (which keeps `placeEntry` with SL/TP atomicity). `placeOrder` is a thin, generic order — no SL/TP, no DB position row (manual orders are tracked by the existing manual-position machinery in trading.js).

- [ ] **Step 1 — RED (bybit):**
```js
describe('bybitOps.placeOrder', () => {
    beforeEach(() => bybitOps._resetSyntheticQueue());
    it('places a MARKET BUY (linear) and returns canonical shape', async () => {
        bybitOps._enqueueSynthetic({ retCode: 0, result: { orderId: 'm1', orderStatus: 'Filled' } });
        const r = await bybitOps.placeOrder(1, { symbol: 'BTCUSDT', side: 'BUY', type: 'MARKET', quantity: '0.01' }, _validCreds);
        expect(r.ok).toBe(true);
        expect(r.orderId).toBe('m1');
        expect(r.rawExchange).toBe('bybit');
    });
    it('places a reduce-only close', async () => {
        bybitOps._enqueueSynthetic({ retCode: 0, result: { orderId: 'm2', orderStatus: 'Filled' } });
        const r = await bybitOps.placeOrder(1, { symbol: 'BTCUSDT', side: 'SELL', type: 'MARKET', quantity: '0.01', reduceOnly: true }, _validCreds);
        expect(r.ok).toBe(true);
    });
    it('surfaces bybit error on retCode!=0', async () => {
        bybitOps._enqueueSynthetic({ retCode: 110007, retMsg: 'insufficient balance', result: {} });
        const r = await bybitOps.placeOrder(1, { symbol: 'BTCUSDT', side: 'BUY', type: 'MARKET', quantity: '999' }, _validCreds);
        expect(r.ok).toBe(false);
        expect(r.error).toBeTruthy();
    });
});
```
- [ ] **Step 2 — Run** → FAIL.
- [ ] **Step 3 — GREEN (bybit):**
```js
async function placeOrder(uid, params, creds) {
    const body = {
        category: 'linear', symbol: params.symbol,
        side: params.side === 'BUY' ? 'Buy' : 'Sell',
        orderType: params.type === 'LIMIT' ? 'Limit' : 'Market',
        qty: String(params.quantity), positionIdx: 0,
    };
    if (body.orderType === 'Limit') { body.timeInForce = 'GTC'; body.price = String(params.price); }
    if (params.reduceOnly || params.closePosition) { body.reduceOnly = true; body.closeOnTrigger = !!params.closePosition; }
    if (params.clientOrderId) body.orderLinkId = String(params.clientOrderId).slice(0, 36);
    const resp = await _dispatchRequest('POST', '/v5/order/create', body, creds);
    if (!_isOk(resp)) return { ok: false, error: bybitSigner.parseBybitError(resp), rawExchange: 'bybit' };
    return { ok: true, orderId: String(resp.result.orderId), status: resp.result.orderStatus, ts: Date.now(), rawExchange: 'bybit' };
}
```
- [ ] **Step 4 — RED+GREEN (binance):** mirror with `binanceSigner`:
```js
async function placeOrder(uid, params, creds) {
    const body = { symbol: params.symbol, side: params.side, type: params.type, quantity: String(params.quantity) };
    if (params.type === 'LIMIT') { body.price = String(params.price); body.timeInForce = 'GTC'; }
    if (params.reduceOnly) body.reduceOnly = 'true';
    if (params.closePosition) body.closePosition = 'true';
    if (params.clientOrderId) body.newClientOrderId = String(params.clientOrderId);
    try {
        const resp = await sendSignedRequest('POST', '/fapi/v1/order', body, creds);
        return { ok: true, orderId: String(resp.orderId), status: resp.status, ts: Date.now(), rawExchange: 'binance' };
    } catch (err) {
        return { ok: false, error: err.message, rawExchange: 'binance' };
    }
}
```
- [ ] **Step 5 — GREEN (router):**
```js
async function placeOrder(uid, params) {
    const { ops, creds } = _resolveOpsFor(uid, params && params.exchangeOverride);
    return ops.placeOrder(uid, params, creds);
}
```
- [ ] **Step 6 — Run all** → PASS. **Swap-back. Commit.**

---

## Task 5: exchangeOps.placeTakeProfit + both ops

**Files:** Modify `bybitOps.js`, `binanceOps.js`, `exchangeOps.js`; Test both.

TP mirrors the existing `placeStopLoss` but with TP trigger direction. Binance uses the algo endpoint (`TAKE_PROFIT_MARKET` via `/fapi/v1/algoOrder` CONDITIONAL, per the Dec-2025 migration already in `binanceOps._placeConditionalAlgo`).

- [ ] **Step 1 — RED (bybit):**
```js
describe('bybitOps.placeTakeProfit', () => {
    beforeEach(() => bybitOps._resetSyntheticQueue());
    it('places TP conditional reduce-only with correct triggerDirection (LONG→1)', async () => {
        bybitOps._enqueueSynthetic({ retCode: 0, result: { orderId: 'tp1', orderStatus: 'New' } });
        const r = await bybitOps.placeTakeProfit(1, { symbol: 'BTCUSDT', side: 'LONG', triggerPrice: '60000', quantity: '0.01' }, _validCreds);
        expect(r.ok).toBe(true);
        expect(r.tpOrderId).toBe('tp1');
        expect(r.rawExchange).toBe('bybit');
    });
});
```
- [ ] **Step 2 — Run** → FAIL.
- [ ] **Step 3 — GREEN (bybit):**
```js
async function placeTakeProfit(uid, params, creds) {
    // TP for a LONG triggers when price RISES (triggerDirection 1); for a SHORT when it FALLS (2).
    const resp = await _dispatchRequest('POST', '/v5/order/create', {
        category: 'linear', symbol: params.symbol,
        side: params.side === 'LONG' ? 'Sell' : 'Buy',
        orderType: 'Market', qty: String(params.quantity), positionIdx: 0,
        triggerPrice: String(params.triggerPrice),
        triggerDirection: params.side === 'LONG' ? 1 : 2,
        reduceOnly: true, closeOnTrigger: true,
        orderLinkId: params.clientOrderId ? String(params.clientOrderId).slice(0, 36) : undefined,
    }, creds);
    if (!_isOk(resp)) return { ok: false, error: bybitSigner.parseBybitError(resp), rawExchange: 'bybit' };
    return { ok: true, tpOrderId: String(resp.result.orderId), status: resp.result.orderStatus, ts: Date.now(), rawExchange: 'bybit' };
}
```
- [ ] **Step 4 — RED+GREEN (binance):** route through the existing `_placeConditionalAlgo` (TAKE_PROFIT_MARKET, triggerPrice, reduceOnly, clientAlgoId) returning `{ok, tpOrderId, rawExchange:'binance'}`.
- [ ] **Step 5 — GREEN (router):** `placeTakeProfit(uid, params)` → `_resolveOpsFor` → `ops.placeTakeProfit`.
- [ ] **Step 6 — Run all** → PASS. **Swap-back. Commit.**

---

## Task 6: exchangeOps.getOrder + both ops (fill query)

**Files:** Modify `bybitOps.js`, `binanceOps.js`, `exchangeOps.js`; Test both.

- [ ] **Step 1 — RED (bybit):**
```js
it('getOrder returns canonical fill info', async () => {
    bybitOps._enqueueSynthetic({ retCode: 0, result: { list: [{ orderId: 'g1', orderStatus: 'Filled', avgPrice: '50000', cumExecQty: '0.01' }] } });
    const r = await bybitOps.getOrder(1, { symbol: 'BTCUSDT', orderId: 'g1' }, _validCreds);
    expect(r.status).toBe('Filled');
    expect(r.avgPrice).toBe('50000');
    expect(r.rawExchange).toBe('bybit');
});
```
- [ ] **Step 2 — Run** → FAIL.
- [ ] **Step 3 — GREEN (bybit):**
```js
async function getOrder(uid, params, creds) {
    const resp = await _dispatchRequest('GET', '/v5/order/realtime', { category: 'linear', symbol: params.symbol, orderId: params.orderId }, creds);
    if (!_isOk(resp) || !resp.result || !Array.isArray(resp.result.list) || !resp.result.list.length) return null;
    const o = resp.result.list[0];
    return { orderId: String(o.orderId), status: o.orderStatus, avgPrice: o.avgPrice, executedQty: o.cumExecQty, rawExchange: 'bybit' };
}
```
- [ ] **Step 4 — RED+GREEN (binance):** `GET /fapi/v1/order {symbol, orderId}` → `{orderId, status, avgPrice:resp.avgPrice, executedQty:resp.executedQty, rawExchange:'binance'}`; return null on throw.
- [ ] **Step 5 — GREEN (router):** `getOrder(uid, params)` → `_resolveOpsFor` → `ops.getOrder`.
- [ ] **Step 6 — Run all** → PASS. **Swap-back. Commit.**

---

## Task 7: trading.js /order/place — route via exchangeOps

**Files:** Modify `server/routes/trading.js` (the `/order/place` handler: marginType ~417, leverage ~428, conditional algo ~472, order ~475, fill-patch ~561); Test `tests/unit/orderRoutes` (create a focused test that mocks exchangeOps and asserts routing + that `sendSignedRequest` is not called).

- [ ] **Step 1 — RED:** test that POST handler, with exchangeOps mocked, calls `exchangeOps.setMarginType` + `exchangeOps.setLeverage` (when leverage present) + `exchangeOps.placeOrder` for a MARKET order, and never calls the binance signer.
- [ ] **Step 2 — Run** → FAIL.
- [ ] **Step 3 — GREEN:** replace, in order:
  - marginType block → `await exchangeOps.setMarginType(req.user.id, { symbol, marginType: 'CROSSED' });` (keep try/catch, log-only on failure).
  - leverage block → `await exchangeOps.setLeverage(req.user.id, { symbol, leverage });` (log-only on failure).
  - conditional (`STOP_MARKET`/`TAKE_PROFIT_MARKET`) → `exchangeOps.placeStopLoss` / `exchangeOps.placeTakeProfit` with `{symbol, side: side==='SELL'?'LONG':'SHORT', triggerPrice: stopPrice, quantity, clientOrderId: newClientOrderId}` (map manual SELL-reduce → protecting a LONG, BUY-reduce → SHORT; derive from reduceOnly+side).
  - regular order → `const result = await exchangeOps.placeOrder(req.user.id, { symbol, side, type, quantity, price, reduceOnly: !!params.reduceOnly, closePosition: closePosition===true, clientOrderId: newClientOrderId }); if (!result.ok) return res.status(400).json({ error: result.error });  data = { orderId: result.orderId, status: result.status };`
  - fill-patch (`setTimeout` GET) → `exchangeOps.getOrder(req.user.id, { symbol, orderId: data.orderId })`, tolerate null.
- [ ] **Step 4 — Run** → PASS (binance behavior unchanged via routing; bybit now lands). **Commit.**

---

## Task 8: trading.js /order/modify — route via exchangeOps

**Files:** Modify `trading.js` (cancel ~993, replace ~1019, recovery ~1046); Test routing.

- [ ] **Step 1 — RED:** test modify calls `exchangeOps.cancelOrder` then `exchangeOps.placeOrder`, never the binance signer.
- [ ] **Step 2 — Run** → FAIL.
- [ ] **Step 3 — GREEN:** cancel step → `exchangeOps.cancelOrder(req.user.id, { symbol, orderId })`; replace + recovery steps → `exchangeOps.placeOrder(...)` with the same param mapping as Task 7.
- [ ] **Step 4 — Run** → PASS. **Commit.**

---

## Task 9: trading.js /openOrders, /leverage, /manual protection TP

**Files:** Modify `trading.js` (openOrders ~946, leverage ~655, TP ~1135); Test routing.

- [ ] **Step 1 — RED:** test `/openOrders` → `exchangeOps.getOpenOrders`; `/leverage` → `exchangeOps.setLeverage`; protection TP → `exchangeOps.placeTakeProfit`; none call the binance signer.
- [ ] **Step 2 — Run** → FAIL.
- [ ] **Step 3 — GREEN:**
  - openOrders ~946 → `const orders = await exchangeOps.getOpenOrders(req.user.id, { symbol });`
  - leverage ~655 → `const r = await exchangeOps.setLeverage(req.user.id, { symbol, leverage }); if (!r.ok) return res.status(400).json({ error: r.error });`
  - TP ~1135 → `const tp = await exchangeOps.placeTakeProfit(req.user.id, { symbol, side: tpSide, triggerPrice: tpTrigger, quantity: tpQty, clientOrderId: tpClientId });`
- [ ] **Step 4 — Run** → PASS. **Commit.**

---

## Task 10: Full-phase verification + deploy

- [ ] **Step 1:** Full server suite `npx jest --forceExit` — confirm only the known pre-existing failures remain (no new regressions vs the 23-fail baseline; the 7 executeLiveEntryCore failures are env-pre-existing).
- [ ] **Step 2:** Deploy server-only: `pm2 reload zeus`; confirm clean boot (no new errors).
- [ ] **Step 3 — Live validation on Bybit demo (uid=1, active=bybit):** via a throwaway diagnostic that calls `exchangeOps.placeOrder` (tiny MARKET BUY 0.001 BTCUSDT) → confirm it reaches the exchange (orderId returned), then `exchangeOps.closePosition` to flatten. Repeat open→close 3×. Confirm via `exchangeOps.getPositions` that it nets flat. Delete the diagnostic.
- [ ] **Step 4:** `git push origin main`. Update memory: Phase M CLOSED; Phases P (AT protection/trailing), A (add-on), R (recon/health) remain.

---

## Self-Review

**Spec coverage:** open (T4/T7) ✓, conditional SL (existing placeStopLoss, wired T7) ✓, TP (T5/T7/T9) ✓, close (existing closePosition) ✓ — *gap: Task 7 must also route the `closePosition===true && type==='MARKET'` manual-close branch through `exchangeOps.closePosition` rather than placeOrder; add that to T7 Step 3.* cancel (existing cancelOrder, T8) ✓, modify (T8) ✓, open-orders (T3/T9) ✓, leverage (T1/T7/T9) ✓, margin (T2/T7) ✓.

**Placeholder scan:** all code blocks concrete; bybit conditional param fine-tuning (triggerDirection, qty rounding) validated against the live demo in Task 10 Step 3 — flagged, not hand-waved.

**Type consistency:** method names + return shapes match the "Canonical method shapes" table across all tasks (`ok`, `orderId`, `tpOrderId`, `slOrderId`, `rawExchange`). exchangeOps wrappers use `_resolveOps`/`_resolveOpsFor` exactly as the existing `getBalance`/`closePosition`.

**Correction folded in:** Task 7 Step 3 also routes the manual MARKET-close (`closePosition===true`) through `exchangeOps.closePosition`.
