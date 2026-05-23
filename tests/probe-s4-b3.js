// [Phase 2 S4-B3] Standalone probe — deterministic harness for the Bybit
// V5 order translator (server/services/bybitOrderTranslator.js) shipped in
// S4-B3, paired with the dry-run signer shipped in S4-B1 / hardened in B1.1.
//
// HARD CONTRACT:
//   - No HTTP / fetch / axios / http / https / node-fetch.
//   - No DB, no serverAT/serverBrain/serverDSL imports.
//   - No real credential store read — fixed in-memory test vectors only.
//   - apiSecret value is NEVER printed; the probe asserts it does not leak
//     into any serialized output.
//
// Run: node tests/probe-s4-b3.js   (exits 0 on full PASS, 1 on any FAIL)
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const tx = require('../server/services/bybitOrderTranslator');
const sgn = require('../server/services/bybitSigner');

// ── Fixed test vectors (synthetic; no resemblance to real keys) ─────────────
const APIK = 'TEST_API_KEY_S4B3';
const APIS = 'TEST_API_SECRET_S4B3_DO_NOT_USE';
const FIXED_TS = 1777310000000;
const FIXED_RW = 5000;
const BASE_TESTNET = 'https://api-testnet.bybit.com';

const _CREDS = { apiKey: APIK, apiSecret: APIS, baseUrl: BASE_TESTNET };
const _OPTS = { timestamp: FIXED_TS, recvWindow: FIXED_RW };

let pass = 0, fail = 0;
function check(name, cond, detail) {
    if (cond) { console.log('  ✓ ' + name); pass++; }
    else { console.log('  ✗ ' + name + (detail ? ' — ' + detail : '')); fail++; }
}

function expectThrow(label, fn, expectedMsg) {
    let threw = false, actualMsg = '';
    try { fn(); } catch (e) { threw = true; actualMsg = e && e.message; }
    check(`${label}: throws ${expectedMsg}`,
        threw && actualMsg === expectedMsg,
        threw ? `actual: ${actualMsg}` : 'did not throw');
}

// Inline expected V5 signature (re-derives canonical formula independently
// of bybitSigner.signV5 so the probe catches any silent drift).
function expectSig(payload) {
    return crypto.createHmac('sha256', APIS)
        .update(`${FIXED_TS}${APIK}${FIXED_RW}${payload || ''}`)
        .digest('hex');
}

// Pair a translator-produced body with bybitSigner and return the descriptor.
function signPost(translatedBody, urlPath) {
    return sgn.buildSignedRequestDryRun('POST', urlPath, translatedBody, _CREDS, _OPTS);
}
function signGet(translatedQuery, urlPath) {
    return sgn.buildSignedRequestDryRun('GET', urlPath, translatedQuery, _CREDS, _OPTS);
}

// ────────────────────────────────────────────────────────────────────────────
// T0 — translator export surface (no leaks, exactly 8 functions)
// ────────────────────────────────────────────────────────────────────────────
console.log('\n=== T0 — translator module surface ===');
{
    const expected = [
        'normalizeBybitErrorShape',
        'translateCancelAllToBybitV5',
        'translateMarketEntryToBybitV5',
        'translateMarketEntryWithSLTPToBybitV5',
        'translatePositionListRequestToBybitV5',
        'translateReduceOnlyCloseToBybitV5',
        'translateSetLeverageToBybitV5',
        'translateWalletBalanceRequestToBybitV5',
    ].join(',');
    check('T0: exports exactly the 8 translator functions',
        Object.keys(tx).sort().join(',') === expected);
    for (const k of Object.keys(tx)) {
        check(`T0: ${k} is a function`, typeof tx[k] === 'function');
    }
    check('T0: no send* on translator', typeof tx.sendSignedRequest === 'undefined' &&
        typeof tx.sendOrder === 'undefined' && typeof tx.sendRequest === 'undefined');
}

// ────────────────────────────────────────────────────────────────────────────
// T1 — translateMarketEntryToBybitV5 LONG (default IOC, default linear)
// ────────────────────────────────────────────────────────────────────────────
console.log('\n=== T1 — translateMarketEntryToBybitV5 LONG ===');
{
    const intent = { symbol: 'BTCUSDT', side: 'long', qty: '0.001', clientOrderId: 'SAT_77_a1b2c3d4' };
    const out = tx.translateMarketEntryToBybitV5(intent);

    check('T1: category=linear', out.category === 'linear');
    check('T1: symbol echoed', out.symbol === 'BTCUSDT');
    check('T1: side mapped long→Buy', out.side === 'Buy');
    check('T1: orderType=Market', out.orderType === 'Market');
    check('T1: qty as string', out.qty === '0.001');
    check('T1: reduceOnly=false', out.reduceOnly === false);
    check('T1: timeInForce default IOC', out.timeInForce === 'IOC');
    check('T1: orderLinkId echoed', out.orderLinkId === 'SAT_77_a1b2c3d4');
    check('T1: no extra keys', Object.keys(out).sort().join(',') ===
        'category,orderLinkId,orderType,qty,reduceOnly,side,symbol,timeInForce');

    // Pair with signer to confirm V5 envelope is well-formed.
    const desc = signPost(out, '/v5/order/create');
    check('T1: signer dryRun:true', desc.dryRun === true);
    check('T1: signer body matches canonical', desc.body === sgn.canonicalizeBody(out));
    check('T1: signer signature matches inline V5 HMAC',
        desc.headers['X-BAPI-SIGN'] === expectSig(desc.body));
    check('T1: descriptor does not leak apiSecret', JSON.stringify(desc).indexOf(APIS) === -1);
}

// ────────────────────────────────────────────────────────────────────────────
// T2 — translateMarketEntryToBybitV5 SHORT
// ────────────────────────────────────────────────────────────────────────────
console.log('\n=== T2 — translateMarketEntryToBybitV5 SHORT ===');
{
    const intent = { symbol: 'BTCUSDT', side: 'short', qty: 0.001, clientOrderId: 'SAT_78_e5f6a7b8', timeInForce: 'GTC' };
    const out = tx.translateMarketEntryToBybitV5(intent);

    check('T2: side mapped short→Sell', out.side === 'Sell');
    check('T2: timeInForce honors GTC', out.timeInForce === 'GTC');
    check('T2: qty number coerced to string', out.qty === '0.001');
    const desc = signPost(out, '/v5/order/create');
    check('T2: signature differs from a Buy variant (different body)',
        desc.headers['X-BAPI-SIGN'] !==
        signPost(tx.translateMarketEntryToBybitV5({ ...intent, side: 'long' }), '/v5/order/create').headers['X-BAPI-SIGN']);
}

// ────────────────────────────────────────────────────────────────────────────
// T3 — translateReduceOnlyCloseToBybitV5 — LONG position → side:'Sell'
// (Option A semantics from approved S4-B3 spec)
// ────────────────────────────────────────────────────────────────────────────
console.log('\n=== T3 — translateReduceOnlyCloseToBybitV5 (positionSide=long → Sell) ===');
{
    const intent = { symbol: 'BTCUSDT', positionSide: 'long', qty: '0.001', clientOrderId: 'SAT_C77_x1y2z3w4' };
    const out = tx.translateReduceOnlyCloseToBybitV5(intent);

    check('T3: side=Sell when closing long', out.side === 'Sell');
    check('T3: reduceOnly=true', out.reduceOnly === true);
    check('T3: orderType=Market', out.orderType === 'Market');
    check('T3: qty as string', out.qty === '0.001');
    check('T3: orderLinkId echoed', out.orderLinkId === 'SAT_C77_x1y2z3w4');
    check('T3: timeInForce default IOC', out.timeInForce === 'IOC');
    check('T3: no extra keys', Object.keys(out).sort().join(',') ===
        'category,orderLinkId,orderType,qty,reduceOnly,side,symbol,timeInForce');
    const desc = signPost(out, '/v5/order/create');
    check('T3: signature matches inline V5 HMAC',
        desc.headers['X-BAPI-SIGN'] === expectSig(desc.body));
}

// ────────────────────────────────────────────────────────────────────────────
// T4 — translateReduceOnlyCloseToBybitV5 — SHORT position → side:'Buy'
// ────────────────────────────────────────────────────────────────────────────
console.log('\n=== T4 — translateReduceOnlyCloseToBybitV5 (positionSide=short → Buy) ===');
{
    const intent = { symbol: 'ETHUSDT', positionSide: 'short', qty: 0.5, clientOrderId: 'SAT_C78_q1w2e3r4' };
    const out = tx.translateReduceOnlyCloseToBybitV5(intent);
    check('T4: side=Buy when closing short', out.side === 'Buy');
    check('T4: reduceOnly=true', out.reduceOnly === true);
    check('T4: symbol echoed', out.symbol === 'ETHUSDT');
    check('T4: qty number coerced to string', out.qty === '0.5');
}

// ────────────────────────────────────────────────────────────────────────────
// T5 — translateMarketEntryWithSLTPToBybitV5 (LONG + SHORT, defaults + overrides)
// ────────────────────────────────────────────────────────────────────────────
console.log('\n=== T5 — translateMarketEntryWithSLTPToBybitV5 LONG/SHORT ===');
{
    const longIntent = {
        symbol: 'BTCUSDT', side: 'long', qty: '0.001',
        clientOrderId: 'SAT_77_sl1tp1aa', stopLoss: '67000', takeProfit: '72000',
    };
    const longOut = tx.translateMarketEntryWithSLTPToBybitV5(longIntent);
    check('T5L: side=Buy', longOut.side === 'Buy');
    check('T5L: stopLoss as string', longOut.stopLoss === '67000');
    check('T5L: takeProfit as string', longOut.takeProfit === '72000');
    check('T5L: slTriggerBy default LastPrice', longOut.slTriggerBy === 'LastPrice');
    check('T5L: tpTriggerBy default LastPrice', longOut.tpTriggerBy === 'LastPrice');
    check('T5L: tpslMode default Full', longOut.tpslMode === 'Full');
    check('T5L: reduceOnly=false', longOut.reduceOnly === false);
    check('T5L: orderLinkId echoed', longOut.orderLinkId === 'SAT_77_sl1tp1aa');
    check('T5L: keyset complete',
        Object.keys(longOut).sort().join(',') ===
        'category,orderLinkId,orderType,qty,reduceOnly,side,slTriggerBy,stopLoss,symbol,takeProfit,timeInForce,tpTriggerBy,tpslMode');

    const shortIntent = {
        symbol: 'ETHUSDT', side: 'short', qty: 0.05,
        clientOrderId: 'SAT_78_sl1tp1bb', stopLoss: 3500, takeProfit: 3000,
        slTriggerBy: 'MarkPrice', tpTriggerBy: 'IndexPrice', tpslMode: 'Partial',
    };
    const shortOut = tx.translateMarketEntryWithSLTPToBybitV5(shortIntent);
    check('T5S: side=Sell', shortOut.side === 'Sell');
    check('T5S: slTriggerBy override MarkPrice', shortOut.slTriggerBy === 'MarkPrice');
    check('T5S: tpTriggerBy override IndexPrice', shortOut.tpTriggerBy === 'IndexPrice');
    check('T5S: tpslMode override Partial', shortOut.tpslMode === 'Partial');
    check('T5S: numeric SL coerced to string', shortOut.stopLoss === '3500');
    check('T5S: numeric TP coerced to string', shortOut.takeProfit === '3000');

    // Sign and verify
    const desc = signPost(longOut, '/v5/order/create');
    check('T5: signed body matches canonical', desc.body === sgn.canonicalizeBody(longOut));
    check('T5: signature matches inline V5 HMAC',
        desc.headers['X-BAPI-SIGN'] === expectSig(desc.body));
}

// ────────────────────────────────────────────────────────────────────────────
// T6 — translateCancelAllToBybitV5
// ────────────────────────────────────────────────────────────────────────────
console.log('\n=== T6 — translateCancelAllToBybitV5 ===');
{
    const out = tx.translateCancelAllToBybitV5({ symbol: 'BTCUSDT' });
    check('T6: category=linear default', out.category === 'linear');
    check('T6: symbol echoed', out.symbol === 'BTCUSDT');
    check('T6: keyset { category, symbol }',
        Object.keys(out).sort().join(',') === 'category,symbol');
    const desc = signPost(out, '/v5/order/cancel-all');
    check('T6: signature matches', desc.headers['X-BAPI-SIGN'] === expectSig(desc.body));
}

// ────────────────────────────────────────────────────────────────────────────
// T7 — translateSetLeverageToBybitV5 (symmetric)
// ────────────────────────────────────────────────────────────────────────────
console.log('\n=== T7 — translateSetLeverageToBybitV5 (symmetric) ===');
{
    const outNum = tx.translateSetLeverageToBybitV5({ symbol: 'BTCUSDT', leverage: 10 });
    check('T7: buyLeverage=sellLeverage', outNum.buyLeverage === outNum.sellLeverage);
    check('T7: leverage stringified', outNum.buyLeverage === '10');
    const outStr = tx.translateSetLeverageToBybitV5({ symbol: 'ETHUSDT', leverage: '20' });
    check('T7: leverage from string passes', outStr.buyLeverage === '20' && outStr.sellLeverage === '20');
    check('T7: keyset complete',
        Object.keys(outNum).sort().join(',') === 'buyLeverage,category,sellLeverage,symbol');
    const desc = signPost(outNum, '/v5/position/set-leverage');
    check('T7: signature matches', desc.headers['X-BAPI-SIGN'] === expectSig(desc.body));
}

// ────────────────────────────────────────────────────────────────────────────
// T8 — translateWalletBalanceRequestToBybitV5 default CONTRACT
// ────────────────────────────────────────────────────────────────────────────
console.log('\n=== T8 — translateWalletBalanceRequestToBybitV5 default CONTRACT ===');
{
    const out = tx.translateWalletBalanceRequestToBybitV5({});
    check('T8: accountType default CONTRACT', out.accountType === 'CONTRACT');
    check('T8: keyset { accountType }', Object.keys(out).join(',') === 'accountType');
    const out2 = tx.translateWalletBalanceRequestToBybitV5();
    check('T8: undefined arg returns CONTRACT default', out2.accountType === 'CONTRACT');
    const desc = signGet(out, '/v5/account/wallet-balance');
    check('T8: signed query matches canonical',
        desc.query === sgn.canonicalizeQuery(out));
    check('T8: signature matches', desc.headers['X-BAPI-SIGN'] === expectSig(desc.query));
}

// ────────────────────────────────────────────────────────────────────────────
// T9 — translateWalletBalanceRequestToBybitV5 explicit UNIFIED
// ────────────────────────────────────────────────────────────────────────────
console.log('\n=== T9 — translateWalletBalanceRequestToBybitV5 UNIFIED ===');
{
    const out = tx.translateWalletBalanceRequestToBybitV5({ accountType: 'UNIFIED' });
    check('T9: accountType=UNIFIED honored', out.accountType === 'UNIFIED');
    const desc = signGet(out, '/v5/account/wallet-balance');
    check('T9: signature differs from CONTRACT signature',
        desc.headers['X-BAPI-SIGN'] !==
        signGet(tx.translateWalletBalanceRequestToBybitV5({ accountType: 'CONTRACT' }), '/v5/account/wallet-balance').headers['X-BAPI-SIGN']);
}

// ────────────────────────────────────────────────────────────────────────────
// T10 — translatePositionListRequestToBybitV5 with symbol
// ────────────────────────────────────────────────────────────────────────────
console.log('\n=== T10 — translatePositionListRequestToBybitV5 with symbol ===');
{
    const out = tx.translatePositionListRequestToBybitV5({ symbol: 'BTCUSDT' });
    check('T10: category=linear default', out.category === 'linear');
    check('T10: symbol echoed', out.symbol === 'BTCUSDT');
    check('T10: keyset { category, symbol }',
        Object.keys(out).sort().join(',') === 'category,symbol');
    const desc = signGet(out, '/v5/position/list');
    check('T10: signature matches', desc.headers['X-BAPI-SIGN'] === expectSig(desc.query));
}

// ────────────────────────────────────────────────────────────────────────────
// T11 — translatePositionListRequestToBybitV5 without symbol
// ────────────────────────────────────────────────────────────────────────────
console.log('\n=== T11 — translatePositionListRequestToBybitV5 without symbol ===');
{
    const out1 = tx.translatePositionListRequestToBybitV5({});
    check('T11: category=linear when intent {}', out1.category === 'linear');
    check('T11: no symbol field when omitted', !('symbol' in out1));
    const out2 = tx.translatePositionListRequestToBybitV5();
    check('T11: undefined arg returns category linear', out2.category === 'linear');
    check('T11: undefined arg has no symbol', !('symbol' in out2));
}

// ────────────────────────────────────────────────────────────────────────────
// T12 — normalizeBybitErrorShape
// ────────────────────────────────────────────────────────────────────────────
console.log('\n=== T12 — normalizeBybitErrorShape ===');
{
    const a = tx.normalizeBybitErrorShape({ retCode: 0, retMsg: 'OK', time: 123, result: { x: 1 } });
    check('T12: ok=true on retCode 0', a.ok === true && a.code === 0 && a.message === 'OK' && a.time === 123 && a.result.x === 1);
    const b = tx.normalizeBybitErrorShape(null);
    check('T12: null → invalid_response defaults', b.ok === false && b.code === -1 && b.message === 'invalid_response' && b.result === null);
    const c = tx.normalizeBybitErrorShape({});
    check('T12: empty obj → defaults', c.ok === false && c.code === -1 && c.message === '' && c.time === 0 && c.result === null);
    const d = tx.normalizeBybitErrorShape({ retCode: 110007, retMsg: 'insufficient balance', time: 999 });
    check('T12: non-zero retCode → ok=false with message', d.ok === false && d.code === 110007 && d.message === 'insufficient balance' && d.time === 999);
}

// ────────────────────────────────────────────────────────────────────────────
// T13 — defensive rejects (canonical error codes)
// ────────────────────────────────────────────────────────────────────────────
console.log('\n=== T13 — defensive rejects ===');
{
    const ok = { symbol: 'BTCUSDT', side: 'long', qty: '0.001', clientOrderId: 'SAT_X' };

    // entry side
    expectThrow('T13: entry invalid side',
        () => tx.translateMarketEntryToBybitV5({ ...ok, side: 'BUY' }),
        'BYBIT_TRANSLATOR_INVALID_SIDE');
    expectThrow('T13: entry missing side',
        () => tx.translateMarketEntryToBybitV5({ ...ok, side: undefined }),
        'BYBIT_TRANSLATOR_INVALID_SIDE');

    // close positionSide
    expectThrow('T13: close invalid positionSide',
        () => tx.translateReduceOnlyCloseToBybitV5({ symbol: 'BTCUSDT', positionSide: 'Sell', qty: '0.001', clientOrderId: 'SAT_X' }),
        'BYBIT_TRANSLATOR_INVALID_POSITION_SIDE');

    // qty
    expectThrow('T13: entry qty=0',
        () => tx.translateMarketEntryToBybitV5({ ...ok, qty: 0 }),
        'BYBIT_TRANSLATOR_INVALID_QTY');
    expectThrow('T13: entry qty NaN',
        () => tx.translateMarketEntryToBybitV5({ ...ok, qty: NaN }),
        'BYBIT_TRANSLATOR_INVALID_QTY');
    expectThrow('T13: entry qty negative',
        () => tx.translateMarketEntryToBybitV5({ ...ok, qty: -1 }),
        'BYBIT_TRANSLATOR_INVALID_QTY');
    expectThrow('T13: entry qty non-numeric string',
        () => tx.translateMarketEntryToBybitV5({ ...ok, qty: 'abc' }),
        'BYBIT_TRANSLATOR_INVALID_QTY');

    // symbol
    expectThrow('T13: empty symbol',
        () => tx.translateMarketEntryToBybitV5({ ...ok, symbol: '' }),
        'BYBIT_TRANSLATOR_INVALID_SYMBOL');
    expectThrow('T13: lowercase symbol',
        () => tx.translateMarketEntryToBybitV5({ ...ok, symbol: 'btcusdt' }),
        'BYBIT_TRANSLATOR_INVALID_SYMBOL');
    expectThrow('T13: non-ASCII symbol',
        () => tx.translateMarketEntryToBybitV5({ ...ok, symbol: 'BTC-USDT' }),
        'BYBIT_TRANSLATOR_INVALID_SYMBOL');

    // clientOrderId
    expectThrow('T13: clientOrderId too long (>36)',
        () => tx.translateMarketEntryToBybitV5({ ...ok, clientOrderId: 'X'.repeat(37) }),
        'BYBIT_TRANSLATOR_INVALID_CLIENT_ID');
    expectThrow('T13: clientOrderId with special char',
        () => tx.translateMarketEntryToBybitV5({ ...ok, clientOrderId: 'SAT 77' }),
        'BYBIT_TRANSLATOR_INVALID_CLIENT_ID');
    expectThrow('T13: clientOrderId empty',
        () => tx.translateMarketEntryToBybitV5({ ...ok, clientOrderId: '' }),
        'BYBIT_TRANSLATOR_INVALID_CLIENT_ID');

    // category
    expectThrow('T13: unsupported category inverse',
        () => tx.translateMarketEntryToBybitV5({ ...ok, category: 'inverse' }),
        'BYBIT_TRANSLATOR_UNSUPPORTED_CATEGORY');
    expectThrow('T13: unsupported category spot',
        () => tx.translateMarketEntryToBybitV5({ ...ok, category: 'spot' }),
        'BYBIT_TRANSLATOR_UNSUPPORTED_CATEGORY');
    expectThrow('T13: unsupported category empty string',
        () => tx.translateMarketEntryToBybitV5({ ...ok, category: '' }),
        'BYBIT_TRANSLATOR_UNSUPPORTED_CATEGORY');

    // SL / TP
    const okSlTp = { ...ok, stopLoss: 67000, takeProfit: 72000 };
    expectThrow('T13: SL=0 rejected',
        () => tx.translateMarketEntryWithSLTPToBybitV5({ ...okSlTp, stopLoss: 0 }),
        'BYBIT_TRANSLATOR_INVALID_SL');
    expectThrow('T13: TP negative rejected',
        () => tx.translateMarketEntryWithSLTPToBybitV5({ ...okSlTp, takeProfit: -1 }),
        'BYBIT_TRANSLATOR_INVALID_TP');
    expectThrow('T13: SL non-numeric string',
        () => tx.translateMarketEntryWithSLTPToBybitV5({ ...okSlTp, stopLoss: 'low' }),
        'BYBIT_TRANSLATOR_INVALID_SL');

    // tpslMode
    expectThrow('T13: tpslMode invalid',
        () => tx.translateMarketEntryWithSLTPToBybitV5({ ...okSlTp, tpslMode: 'Half' }),
        'BYBIT_TRANSLATOR_INVALID_TPSL_MODE');

    // triggerBy
    expectThrow('T13: slTriggerBy invalid',
        () => tx.translateMarketEntryWithSLTPToBybitV5({ ...okSlTp, slTriggerBy: 'OraclePrice' }),
        'BYBIT_TRANSLATOR_INVALID_TRIGGER_BY');

    // leverage
    expectThrow('T13: leverage 0',
        () => tx.translateSetLeverageToBybitV5({ symbol: 'BTCUSDT', leverage: 0 }),
        'BYBIT_TRANSLATOR_INVALID_LEVERAGE');
    expectThrow('T13: leverage fractional',
        () => tx.translateSetLeverageToBybitV5({ symbol: 'BTCUSDT', leverage: 1.5 }),
        'BYBIT_TRANSLATOR_INVALID_LEVERAGE');
    expectThrow('T13: leverage NaN',
        () => tx.translateSetLeverageToBybitV5({ symbol: 'BTCUSDT', leverage: NaN }),
        'BYBIT_TRANSLATOR_INVALID_LEVERAGE');

    // timeInForce
    expectThrow('T13: invalid TIF',
        () => tx.translateMarketEntryToBybitV5({ ...ok, timeInForce: 'POST_ONLY' }),
        'BYBIT_TRANSLATOR_INVALID_TIF');

    // accountType
    expectThrow('T13: invalid accountType',
        () => tx.translateWalletBalanceRequestToBybitV5({ accountType: 'SPOT' }),
        'BYBIT_TRANSLATOR_INVALID_ACCOUNT_TYPE');
}

// ────────────────────────────────────────────────────────────────────────────
// T14 — determinism (same input → same output)
// ────────────────────────────────────────────────────────────────────────────
console.log('\n=== T14 — determinism ===');
{
    const intent = { symbol: 'BTCUSDT', side: 'long', qty: '0.001', clientOrderId: 'SAT_DET_aa' };
    const a = JSON.stringify(tx.translateMarketEntryToBybitV5(intent));
    const b = JSON.stringify(tx.translateMarketEntryToBybitV5(intent));
    const c = JSON.stringify(tx.translateMarketEntryToBybitV5({ ...intent }));
    check('T14: market entry deterministic across 3 calls', a === b && b === c);
    const lev1 = JSON.stringify(tx.translateSetLeverageToBybitV5({ symbol: 'BTCUSDT', leverage: 10 }));
    const lev2 = JSON.stringify(tx.translateSetLeverageToBybitV5({ symbol: 'BTCUSDT', leverage: 10 }));
    check('T14: set-leverage deterministic', lev1 === lev2);
    const wb1 = JSON.stringify(tx.translateWalletBalanceRequestToBybitV5({ accountType: 'CONTRACT' }));
    const wb2 = JSON.stringify(tx.translateWalletBalanceRequestToBybitV5({ accountType: 'CONTRACT' }));
    check('T14: wallet-balance deterministic', wb1 === wb2);
}

// ────────────────────────────────────────────────────────────────────────────
// T15 — apiSecret never appears in any combined translator+signer output
// ────────────────────────────────────────────────────────────────────────────
console.log('\n=== T15 — apiSecret never leaks ===');
{
    const all = [
        signPost(tx.translateMarketEntryToBybitV5({ symbol: 'BTCUSDT', side: 'long', qty: '0.001', clientOrderId: 'SAT_LK1' }), '/v5/order/create'),
        signPost(tx.translateMarketEntryToBybitV5({ symbol: 'BTCUSDT', side: 'short', qty: '0.001', clientOrderId: 'SAT_LK2' }), '/v5/order/create'),
        signPost(tx.translateReduceOnlyCloseToBybitV5({ symbol: 'BTCUSDT', positionSide: 'long', qty: '0.001', clientOrderId: 'SAT_LK3' }), '/v5/order/create'),
        signPost(tx.translateReduceOnlyCloseToBybitV5({ symbol: 'BTCUSDT', positionSide: 'short', qty: '0.001', clientOrderId: 'SAT_LK4' }), '/v5/order/create'),
        signPost(tx.translateMarketEntryWithSLTPToBybitV5({ symbol: 'BTCUSDT', side: 'long', qty: '0.001', clientOrderId: 'SAT_LK5', stopLoss: '67000', takeProfit: '72000' }), '/v5/order/create'),
        signPost(tx.translateCancelAllToBybitV5({ symbol: 'BTCUSDT' }), '/v5/order/cancel-all'),
        signPost(tx.translateSetLeverageToBybitV5({ symbol: 'BTCUSDT', leverage: 10 }), '/v5/position/set-leverage'),
        signGet(tx.translateWalletBalanceRequestToBybitV5({}), '/v5/account/wallet-balance'),
        signGet(tx.translateWalletBalanceRequestToBybitV5({ accountType: 'UNIFIED' }), '/v5/account/wallet-balance'),
        signGet(tx.translatePositionListRequestToBybitV5({ symbol: 'BTCUSDT' }), '/v5/position/list'),
        signGet(tx.translatePositionListRequestToBybitV5({}), '/v5/position/list'),
    ];
    const combined = JSON.stringify(all);
    check('T15: combined translator+signer descriptors do not contain apiSecret',
        combined.indexOf(APIS) === -1);
    const sigs = all.map(r => r.headers['X-BAPI-SIGN']);
    check('T15: every descriptor has a signature', sigs.every(s => /^[0-9a-f]{64}$/.test(s)));
}

// ────────────────────────────────────────────────────────────────────────────
// T16 — pairing with bybitSigner across all 8 endpoint shapes
// ────────────────────────────────────────────────────────────────────────────
console.log('\n=== T16 — pairing with bybitSigner across 8 endpoint shapes ===');
{
    const cases = [
        { label: 'order/create LONG',  desc: signPost(tx.translateMarketEntryToBybitV5({ symbol: 'BTCUSDT', side: 'long', qty: '0.001', clientOrderId: 'SAT_PR1' }), '/v5/order/create') },
        { label: 'order/create SHORT', desc: signPost(tx.translateMarketEntryToBybitV5({ symbol: 'BTCUSDT', side: 'short', qty: '0.001', clientOrderId: 'SAT_PR2' }), '/v5/order/create') },
        { label: 'order/create CLOSE-LONG', desc: signPost(tx.translateReduceOnlyCloseToBybitV5({ symbol: 'BTCUSDT', positionSide: 'long', qty: '0.001', clientOrderId: 'SAT_PR3' }), '/v5/order/create') },
        { label: 'order/create CLOSE-SHORT', desc: signPost(tx.translateReduceOnlyCloseToBybitV5({ symbol: 'BTCUSDT', positionSide: 'short', qty: '0.001', clientOrderId: 'SAT_PR4' }), '/v5/order/create') },
        { label: 'order/create LONG+SLTP', desc: signPost(tx.translateMarketEntryWithSLTPToBybitV5({ symbol: 'BTCUSDT', side: 'long', qty: '0.001', clientOrderId: 'SAT_PR5', stopLoss: '67000', takeProfit: '72000' }), '/v5/order/create') },
        { label: 'order/cancel-all', desc: signPost(tx.translateCancelAllToBybitV5({ symbol: 'BTCUSDT' }), '/v5/order/cancel-all') },
        { label: 'position/set-leverage', desc: signPost(tx.translateSetLeverageToBybitV5({ symbol: 'BTCUSDT', leverage: 10 }), '/v5/position/set-leverage') },
        { label: 'account/wallet-balance', desc: signGet(tx.translateWalletBalanceRequestToBybitV5({}), '/v5/account/wallet-balance') },
        { label: 'position/list', desc: signGet(tx.translatePositionListRequestToBybitV5({ symbol: 'BTCUSDT' }), '/v5/position/list') },
    ];
    for (const c of cases) {
        check(`T16: ${c.label} dryRun:true`, c.desc.dryRun === true);
        check(`T16: ${c.label} signature is hex(64)`, /^[0-9a-f]{64}$/.test(c.desc.headers['X-BAPI-SIGN']));
        const expectedPayload = c.desc.method === 'GET' ? c.desc.query : c.desc.body;
        check(`T16: ${c.label} signature matches inline V5 HMAC`,
            c.desc.headers['X-BAPI-SIGN'] === expectSig(expectedPayload));
        check(`T16: ${c.label} url begins with testnet baseUrl`,
            c.desc.url.indexOf(BASE_TESTNET) === 0);
        check(`T16: ${c.label} url does NOT contain production host`,
            c.desc.url.indexOf('api.bybit.com') === -1);
    }
}

// ────────────────────────────────────────────────────────────────────────────
// T17 — BYBIT_DRY_RUN_ONLY hard gate is fail-closed (re-asserts S4-B1.1)
// ────────────────────────────────────────────────────────────────────────────
console.log('\n=== T17 — BYBIT_DRY_RUN_ONLY hard gate (S4-B1.1 invariant) ===');
{
    const MF = require('../server/migrationFlags');
    const all = MF.getAll();
    check('T17: BYBIT_DRY_RUN_ONLY=true', all.BYBIT_DRY_RUN_ONLY === true);
    check('T17: BYBIT_LIVE_ENABLED=false', all.BYBIT_LIVE_ENABLED === false);
    check('T17: BYBIT_TESTNET_ENABLED=false', all.BYBIT_TESTNET_ENABLED === false);
    check('T17: BYBIT_PARITY_ENABLED=false', all.BYBIT_PARITY_ENABLED === false);
    check('T17: per-flag getter agrees with getAll()',
        MF.BYBIT_DRY_RUN_ONLY === all.BYBIT_DRY_RUN_ONLY);
}

// ────────────────────────────────────────────────────────────────────────────
// T18 — static source-level verification of the translator
// ────────────────────────────────────────────────────────────────────────────
console.log('\n=== T18 — translator source-level (no I/O / no env / no Binance) ===');
{
    const txPath = path.resolve(__dirname, '..', 'server', 'services', 'bybitOrderTranslator.js');
    const raw = fs.readFileSync(txPath, 'utf8');
    // Strip line + block comments before pattern matching.
    const code = raw
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|[^:])\/\/[^\n]*/g, '$1');

    check('T18: translator readable', raw.length > 0);
    check('T18: no fetch(/axios/http*.request',
        !/\bfetch\s*\(/.test(code) && !/\baxios\b/.test(code) &&
        !/\bhttps?\.request\b/.test(code));
    check('T18: no require("http"|"https"|"axios"|"node-fetch")',
        !/require\(['"](?:node:)?https?['"]\)/.test(code) &&
        !/require\(['"]axios['"]\)/.test(code) &&
        !/require\(['"]node-fetch['"]\)/.test(code));
    check('T18: no Date.now() / Math.random() / process.env in code',
        !/Date\.now\(/.test(code) &&
        !/Math\.random\(/.test(code) &&
        !/process\.env/.test(code));
    check('T18: no import of binanceSigner / serverAT / serverBrain / serverDSL / database / routes',
        !/require\(['"]\.\/binanceSigner['"]\)/.test(code) &&
        !/require\(['"]\.\/serverAT['"]\)/.test(code) &&
        !/require\(['"]\.\/serverBrain['"]\)/.test(code) &&
        !/require\(['"]\.\/serverDSL['"]\)/.test(code) &&
        !/require\(['"]\.\/database['"]\)/.test(code) &&
        !/require\(['"]\.\.\/routes\//.test(code));
    check('T18: no send* function name in code',
        !/\bsendSignedRequest\b/.test(code) && !/\bsendOrder\b/.test(code) &&
        !/\bsendRequest\b/.test(code) && !/\bplaceOrder\b/.test(code));
}

// ────────────────────────────────────────────────────────────────────────────
// Summary
// ────────────────────────────────────────────────────────────────────────────
console.log('\n========================================================');
console.log(`probe-s4-b3: ${pass}/${pass + fail} PASS`);
console.log('========================================================');
process.exit(fail === 0 ? 0 : 1);
