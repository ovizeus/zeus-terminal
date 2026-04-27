// [Phase 2 S4-B2] Standalone probe — deterministic dry-run harness for the
// Bybit V5 signer envelopes shipped in S4-B1 (server/services/bybitSigner.js).
//
// HARD CONTRACT:
//   - No HTTP / fetch / axios / http / https / node-fetch.
//   - No DB, no serverAT/serverBrain/serverDSL imports.
//   - No real credential store read — fixed in-memory test vectors only.
//   - No PM2 reload, no flag flip, no version bump.
//   - apiSecret value is NEVER printed; the probe asserts it does not leak
//     into any serialized request descriptor.
//
// Run: node tests/probe-s4-b2.js   (exits 0 on full PASS, 1 on any FAIL)
'use strict';

const crypto = require('crypto');
const sgn = require('../server/services/bybitSigner');

// ── Fixed test vectors (synthetic; no resemblance to real keys) ─────────────
const APIK = 'TEST_API_KEY_S4B2';
const APIS = 'TEST_API_SECRET_S4B2_DO_NOT_USE';
const FIXED_TS = 1777300000000; // arbitrary fixed epoch ms
const FIXED_RW = 5000;
const BASE_TESTNET = 'https://api-testnet.bybit.com';

const _CREDS = { apiKey: APIK, apiSecret: APIS, baseUrl: BASE_TESTNET };
const _OPTS = { timestamp: FIXED_TS, recvWindow: FIXED_RW };

let pass = 0, fail = 0;
function check(name, cond, detail) {
    if (cond) { console.log('  ✓ ' + name); pass++; }
    else { console.log('  ✗ ' + name + (detail ? ' — ' + detail : '')); fail++; }
}

// Inline expected V5 signature (re-derives the canonical formula independently
// of bybitSigner.signV5 so the probe catches any silent drift in the helper).
function expectSig(payload) {
    return crypto
        .createHmac('sha256', APIS)
        .update(`${FIXED_TS}${APIK}${FIXED_RW}${payload || ''}`)
        .digest('hex');
}

// Common shape + signature + secret-leak assertions for every test.
function _assertCommon(label, descr, expectedPayload) {
    check(`${label}: dryRun:true`, descr.dryRun === true);
    check(`${label}: timestamp echoed`, descr.timestamp === FIXED_TS);
    check(`${label}: recvWindow echoed`, descr.recvWindow === FIXED_RW);
    const h = descr.headers || {};
    check(`${label}: header X-BAPI-API-KEY`, h['X-BAPI-API-KEY'] === APIK);
    check(`${label}: header X-BAPI-SIGN-TYPE=2`, h['X-BAPI-SIGN-TYPE'] === '2');
    check(`${label}: header X-BAPI-TIMESTAMP=${FIXED_TS}`, h['X-BAPI-TIMESTAMP'] === String(FIXED_TS));
    check(`${label}: header X-BAPI-RECV-WINDOW=${FIXED_RW}`, h['X-BAPI-RECV-WINDOW'] === String(FIXED_RW));
    check(`${label}: header Content-Type application/json`, h['Content-Type'] === 'application/json');
    check(`${label}: header X-BAPI-SIGN matches inline V5 HMAC`, h['X-BAPI-SIGN'] === expectSig(expectedPayload));
    check(`${label}: header set has exactly the 6 expected keys`,
        Object.keys(h).sort().join(',') ===
        'Content-Type,X-BAPI-API-KEY,X-BAPI-RECV-WINDOW,X-BAPI-SIGN,X-BAPI-SIGN-TYPE,X-BAPI-TIMESTAMP');
    const serialized = JSON.stringify(descr);
    check(`${label}: serialized descriptor does not leak apiSecret`, serialized.indexOf(APIS) === -1);
}

// ────────────────────────────────────────────────────────────────────────────
// T0 — module surface (re-asserts S4-B1 invariants from inside the probe)
// ────────────────────────────────────────────────────────────────────────────
console.log('\n=== T0 — bybitSigner module surface (S4-B1 invariants) ===');
{
    const expected = 'buildBybitHeaders,buildSignedRequestDryRun,canonicalizeBody,canonicalizeQuery,getBybitCbStatus,parseBybitError,signV5';
    check('T0: exports exactly the 7 documented functions',
        Object.keys(sgn).sort().join(',') === expected);
    check('T0: no sendSignedRequest export', typeof sgn.sendSignedRequest === 'undefined');
    check('T0: no sendRequest export', typeof sgn.sendRequest === 'undefined');
    check('T0: no placeOrder export', typeof sgn.placeOrder === 'undefined');
    check('T0: no executeLiveEntry export', typeof sgn.executeLiveEntry === 'undefined');
    check('T0: getBybitCbStatus inert (state CLOSED)',
        sgn.getBybitCbStatus().state === 'CLOSED' && sgn.getBybitCbStatus().enabled === false);
}

// ────────────────────────────────────────────────────────────────────────────
// T1 — GET /v5/account/wallet-balance?accountType=CONTRACT
// ────────────────────────────────────────────────────────────────────────────
console.log('\n=== T1 — GET /v5/account/wallet-balance (CONTRACT) ===');
{
    const params = { accountType: 'CONTRACT' };
    const r = sgn.buildSignedRequestDryRun('GET', '/v5/account/wallet-balance', params, _CREDS, _OPTS);
    const expectedQuery = 'accountType=CONTRACT';

    check('T1: method=GET', r.method === 'GET');
    check('T1: path preserved', r.path === '/v5/account/wallet-balance');
    check('T1: url has canonical query',
        r.url === `${BASE_TESTNET}/v5/account/wallet-balance?${expectedQuery}`);
    check('T1: query canonical', r.query === expectedQuery);
    check('T1: body empty (GET)', r.body === '');
    _assertCommon('T1', r, expectedQuery);
}

// ────────────────────────────────────────────────────────────────────────────
// T2 — GET /v5/account/wallet-balance?accountType=UNIFIED
// ────────────────────────────────────────────────────────────────────────────
console.log('\n=== T2 — GET /v5/account/wallet-balance (UNIFIED) ===');
{
    const params = { accountType: 'UNIFIED' };
    const r = sgn.buildSignedRequestDryRun('GET', '/v5/account/wallet-balance', params, _CREDS, _OPTS);
    const expectedQuery = 'accountType=UNIFIED';

    check('T2: method=GET', r.method === 'GET');
    check('T2: path preserved', r.path === '/v5/account/wallet-balance');
    check('T2: url has canonical query',
        r.url === `${BASE_TESTNET}/v5/account/wallet-balance?${expectedQuery}`);
    check('T2: query canonical', r.query === expectedQuery);
    check('T2: body empty (GET)', r.body === '');
    _assertCommon('T2', r, expectedQuery);
    // T1 vs T2 differ only by accountType → signatures must differ.
    const r1 = sgn.buildSignedRequestDryRun('GET', '/v5/account/wallet-balance', { accountType: 'CONTRACT' }, _CREDS, _OPTS);
    check('T2: signature differs from T1 due to different query',
        r.headers['X-BAPI-SIGN'] !== r1.headers['X-BAPI-SIGN']);
}

// ────────────────────────────────────────────────────────────────────────────
// T3 — GET /v5/position/list?category=linear&symbol=BTCUSDT
// ────────────────────────────────────────────────────────────────────────────
console.log('\n=== T3 — GET /v5/position/list (linear, BTCUSDT) ===');
{
    // Pass keys in non-alphabetical input order to prove canonical sort.
    const params = { symbol: 'BTCUSDT', category: 'linear' };
    const r = sgn.buildSignedRequestDryRun('GET', '/v5/position/list', params, _CREDS, _OPTS);
    const expectedQuery = 'category=linear&symbol=BTCUSDT';

    check('T3: method=GET', r.method === 'GET');
    check('T3: path preserved', r.path === '/v5/position/list');
    check('T3: query canonical (sorted)', r.query === expectedQuery);
    check('T3: url has canonical query',
        r.url === `${BASE_TESTNET}/v5/position/list?${expectedQuery}`);
    check('T3: body empty (GET)', r.body === '');
    _assertCommon('T3', r, expectedQuery);
}

// ────────────────────────────────────────────────────────────────────────────
// T4 — POST /v5/order/create — LONG market entry, reduceOnly:false, no SL/TP
// ────────────────────────────────────────────────────────────────────────────
console.log('\n=== T4 — POST /v5/order/create LONG market (no SL/TP) ===');
{
    const params = {
        category: 'linear',
        symbol: 'BTCUSDT',
        side: 'Buy',
        orderType: 'Market',
        qty: '0.001',
        reduceOnly: false,
        timeInForce: 'IOC',
    };
    const r = sgn.buildSignedRequestDryRun('POST', '/v5/order/create', params, _CREDS, _OPTS);
    const expectedBody = JSON.stringify({
        category: 'linear',
        orderType: 'Market',
        qty: '0.001',
        reduceOnly: false,
        side: 'Buy',
        symbol: 'BTCUSDT',
        timeInForce: 'IOC',
    });

    check('T4: method=POST', r.method === 'POST');
    check('T4: path preserved', r.path === '/v5/order/create');
    check('T4: url has no query string (POST)',
        r.url === `${BASE_TESTNET}/v5/order/create`);
    check('T4: query empty (POST)', r.query === '');
    check('T4: body is canonical sorted JSON', r.body === expectedBody);
    _assertCommon('T4', r, expectedBody);
}

// ────────────────────────────────────────────────────────────────────────────
// T5 — POST /v5/order/create — SHORT market with stopLoss + takeProfit
// ────────────────────────────────────────────────────────────────────────────
console.log('\n=== T5 — POST /v5/order/create SHORT market with SL+TP ===');
{
    const params = {
        category: 'linear',
        symbol: 'BTCUSDT',
        side: 'Sell',
        orderType: 'Market',
        qty: '0.001',
        reduceOnly: false,
        stopLoss: '70500',
        takeProfit: '69000',
        slTriggerBy: 'LastPrice',
        tpTriggerBy: 'LastPrice',
        timeInForce: 'IOC',
    };
    const r = sgn.buildSignedRequestDryRun('POST', '/v5/order/create', params, _CREDS, _OPTS);
    const expectedBody = JSON.stringify({
        category: 'linear',
        orderType: 'Market',
        qty: '0.001',
        reduceOnly: false,
        side: 'Sell',
        slTriggerBy: 'LastPrice',
        stopLoss: '70500',
        symbol: 'BTCUSDT',
        takeProfit: '69000',
        timeInForce: 'IOC',
        tpTriggerBy: 'LastPrice',
    });

    check('T5: method=POST', r.method === 'POST');
    check('T5: side=Sell included in body',
        r.body.includes('"side":"Sell"'));
    check('T5: stopLoss included in body', r.body.includes('"stopLoss":"70500"'));
    check('T5: takeProfit included in body', r.body.includes('"takeProfit":"69000"'));
    check('T5: body is canonical sorted JSON', r.body === expectedBody);
    check('T5: url has no query string', r.url === `${BASE_TESTNET}/v5/order/create`);
    _assertCommon('T5', r, expectedBody);
    // T4 vs T5 must produce different signatures (different bodies).
    const r4 = sgn.buildSignedRequestDryRun('POST', '/v5/order/create', {
        category: 'linear', symbol: 'BTCUSDT', side: 'Buy', orderType: 'Market',
        qty: '0.001', reduceOnly: false, timeInForce: 'IOC',
    }, _CREDS, _OPTS);
    check('T5: signature differs from T4 (different body)',
        r.headers['X-BAPI-SIGN'] !== r4.headers['X-BAPI-SIGN']);
}

// ────────────────────────────────────────────────────────────────────────────
// T6 — POST /v5/order/create — REDUCE-only close market order
// ────────────────────────────────────────────────────────────────────────────
console.log('\n=== T6 — POST /v5/order/create REDUCE-only close ===');
{
    const params = {
        category: 'linear',
        symbol: 'BTCUSDT',
        side: 'Sell',          // closing a Buy position
        orderType: 'Market',
        qty: '0.001',
        reduceOnly: true,
        timeInForce: 'IOC',
    };
    const r = sgn.buildSignedRequestDryRun('POST', '/v5/order/create', params, _CREDS, _OPTS);
    const expectedBody = JSON.stringify({
        category: 'linear',
        orderType: 'Market',
        qty: '0.001',
        reduceOnly: true,
        side: 'Sell',
        symbol: 'BTCUSDT',
        timeInForce: 'IOC',
    });

    check('T6: method=POST', r.method === 'POST');
    check('T6: reduceOnly:true present in body', r.body.includes('"reduceOnly":true'));
    check('T6: body is canonical sorted JSON', r.body === expectedBody);
    check('T6: url has no query string', r.url === `${BASE_TESTNET}/v5/order/create`);
    _assertCommon('T6', r, expectedBody);
}

// ────────────────────────────────────────────────────────────────────────────
// T7 — POST /v5/order/cancel-all (category=linear, symbol=BTCUSDT)
// Bybit V5 sends params in the JSON body for POST endpoints; the spec's
// query-string notation describes the logical params, not the wire form.
// ────────────────────────────────────────────────────────────────────────────
console.log('\n=== T7 — POST /v5/order/cancel-all (linear, BTCUSDT) ===');
{
    const params = { category: 'linear', symbol: 'BTCUSDT' };
    const r = sgn.buildSignedRequestDryRun('POST', '/v5/order/cancel-all', params, _CREDS, _OPTS);
    const expectedBody = JSON.stringify({ category: 'linear', symbol: 'BTCUSDT' });

    check('T7: method=POST', r.method === 'POST');
    check('T7: path preserved', r.path === '/v5/order/cancel-all');
    check('T7: body is canonical sorted JSON', r.body === expectedBody);
    check('T7: url has no query string', r.url === `${BASE_TESTNET}/v5/order/cancel-all`);
    check('T7: query empty (POST)', r.query === '');
    _assertCommon('T7', r, expectedBody);
}

// ────────────────────────────────────────────────────────────────────────────
// T8 — POST /v5/position/set-leverage — buyLeverage/sellLeverage symmetric
// ────────────────────────────────────────────────────────────────────────────
console.log('\n=== T8 — POST /v5/position/set-leverage (10x symmetric) ===');
{
    const params = {
        category: 'linear',
        symbol: 'BTCUSDT',
        buyLeverage: '10',
        sellLeverage: '10',
    };
    const r = sgn.buildSignedRequestDryRun('POST', '/v5/position/set-leverage', params, _CREDS, _OPTS);
    const expectedBody = JSON.stringify({
        buyLeverage: '10',
        category: 'linear',
        sellLeverage: '10',
        symbol: 'BTCUSDT',
    });

    check('T8: method=POST', r.method === 'POST');
    check('T8: path preserved', r.path === '/v5/position/set-leverage');
    check('T8: body is canonical sorted JSON', r.body === expectedBody);
    check('T8: buyLeverage and sellLeverage symmetric in body',
        r.body.includes('"buyLeverage":"10"') && r.body.includes('"sellLeverage":"10"'));
    check('T8: url has no query string',
        r.url === `${BASE_TESTNET}/v5/position/set-leverage`);
    _assertCommon('T8', r, expectedBody);
}

// ────────────────────────────────────────────────────────────────────────────
// T9 — baseUrl is honored exactly (no production default leak)
// ────────────────────────────────────────────────────────────────────────────
console.log('\n=== T9 — baseUrl honored exactly (no production default) ===');
{
    const altBase = 'https://api-testnet.bybit.com'; // explicit testnet
    const r = sgn.buildSignedRequestDryRun('GET', '/v5/market/time', {}, {
        apiKey: APIK, apiSecret: APIS, baseUrl: altBase,
    }, _OPTS);
    check('T9: url begins with provided baseUrl exactly',
        r.url.indexOf(altBase) === 0);
    check('T9: url does NOT contain production host',
        r.url.indexOf('api.bybit.com') === -1);
    check('T9: url does NOT mention any binance host',
        r.url.indexOf('binance') === -1);
}

// ────────────────────────────────────────────────────────────────────────────
// T10 — buildSignedRequestDryRun rejects missing creds / baseUrl
// ────────────────────────────────────────────────────────────────────────────
console.log('\n=== T10 — defensive rejects ===');
{
    let threw;
    try { sgn.buildSignedRequestDryRun('GET', '/v5/market/time', {}, {}); threw = false; }
    catch (_e) { threw = true; }
    check('T10: throws on missing apiKey/apiSecret', threw);

    try {
        sgn.buildSignedRequestDryRun('GET', '/v5/market/time', {}, { apiKey: APIK, apiSecret: APIS });
        threw = false;
    } catch (_e) { threw = true; }
    check('T10: throws on missing baseUrl (no production default)', threw);

    try {
        sgn.buildSignedRequestDryRun('', '/v5/market/time', {}, _CREDS, _OPTS);
        threw = false;
    } catch (_e) { threw = true; }
    check('T10: throws on missing method', threw);

    try {
        sgn.buildSignedRequestDryRun('GET', '', {}, _CREDS, _OPTS);
        threw = false;
    } catch (_e) { threw = true; }
    check('T10: throws on missing path', threw);
}

// ────────────────────────────────────────────────────────────────────────────
// T11 — BYBIT flags are at safe defaults
// (NB: migrationFlags exposes per-flag property getters + getAll(); there is
//  no MF.get(name) method — the probe reads the canonical surface.)
// ────────────────────────────────────────────────────────────────────────────
console.log('\n=== T11 — Bybit migration flags at safe defaults ===');
{
    const MF = require('../server/migrationFlags');
    const all = MF.getAll();
    check('T11: BYBIT_DRY_RUN_ONLY=true', all.BYBIT_DRY_RUN_ONLY === true);
    check('T11: BYBIT_LIVE_ENABLED=false', all.BYBIT_LIVE_ENABLED === false);
    check('T11: BYBIT_TESTNET_ENABLED=false', all.BYBIT_TESTNET_ENABLED === false);
    check('T11: BYBIT_PARITY_ENABLED=false', all.BYBIT_PARITY_ENABLED === false);
    check('T11: per-flag getter agrees with getAll() for BYBIT_DRY_RUN_ONLY',
        MF.BYBIT_DRY_RUN_ONLY === all.BYBIT_DRY_RUN_ONLY);
}

// ────────────────────────────────────────────────────────────────────────────
// T12 — apiSecret never appears in any descriptor produced above
// ────────────────────────────────────────────────────────────────────────────
console.log('\n=== T12 — apiSecret never leaks into any descriptor ===');
{
    // Re-issue all 8 endpoint shapes and concatenate every serialized descriptor;
    // confirm the secret does not appear anywhere in the combined string.
    const all = [
        sgn.buildSignedRequestDryRun('GET', '/v5/account/wallet-balance', { accountType: 'CONTRACT' }, _CREDS, _OPTS),
        sgn.buildSignedRequestDryRun('GET', '/v5/account/wallet-balance', { accountType: 'UNIFIED' }, _CREDS, _OPTS),
        sgn.buildSignedRequestDryRun('GET', '/v5/position/list', { category: 'linear', symbol: 'BTCUSDT' }, _CREDS, _OPTS),
        sgn.buildSignedRequestDryRun('POST', '/v5/order/create', { category: 'linear', symbol: 'BTCUSDT', side: 'Buy', orderType: 'Market', qty: '0.001', reduceOnly: false, timeInForce: 'IOC' }, _CREDS, _OPTS),
        sgn.buildSignedRequestDryRun('POST', '/v5/order/create', { category: 'linear', symbol: 'BTCUSDT', side: 'Sell', orderType: 'Market', qty: '0.001', reduceOnly: false, stopLoss: '70500', takeProfit: '69000', slTriggerBy: 'LastPrice', tpTriggerBy: 'LastPrice', timeInForce: 'IOC' }, _CREDS, _OPTS),
        sgn.buildSignedRequestDryRun('POST', '/v5/order/create', { category: 'linear', symbol: 'BTCUSDT', side: 'Sell', orderType: 'Market', qty: '0.001', reduceOnly: true, timeInForce: 'IOC' }, _CREDS, _OPTS),
        sgn.buildSignedRequestDryRun('POST', '/v5/order/cancel-all', { category: 'linear', symbol: 'BTCUSDT' }, _CREDS, _OPTS),
        sgn.buildSignedRequestDryRun('POST', '/v5/position/set-leverage', { category: 'linear', symbol: 'BTCUSDT', buyLeverage: '10', sellLeverage: '10' }, _CREDS, _OPTS),
    ];
    const combined = JSON.stringify(all);
    check('T12: combined descriptors do not contain apiSecret', combined.indexOf(APIS) === -1);
    // All 8 signatures must be unique (different payloads → different sigs).
    const sigs = all.map(r => r.headers['X-BAPI-SIGN']);
    const uniq = new Set(sigs);
    check('T12: all 8 signatures unique (deterministic per payload)', uniq.size === 8);
}

// ────────────────────────────────────────────────────────────────────────────
// Summary
// ────────────────────────────────────────────────────────────────────────────
console.log('\n========================================================');
console.log(`probe-s4-b2: ${pass}/${pass + fail} PASS`);
console.log('========================================================');
process.exit(fail === 0 ? 0 : 1);
