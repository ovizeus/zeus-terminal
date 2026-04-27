// [Phase 2 S4-B4] Standalone probe — deterministic harness for the dormant
// Bybit shadow parity service (server/services/bybitParityShadow.js) shipped
// in S4-B4. Pairs the shadow service with the translator (S4-B3) and the
// signer (S4-B1 / B1.1).
//
// HARD CONTRACT:
//   - No HTTP / fetch / axios / http / https / node-fetch.
//   - No DB, no audit, no env reads.
//   - No real credential store reads — fixed synthetic vectors only.
//   - apiSecret value is NEVER printed; the probe asserts it does not leak
//     into any returned record.
//
// Run: node tests/probe-s4-b4.js   (exits 0 on full PASS, 1 on any FAIL)
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const shadow = require('../server/services/bybitParityShadow');
const tx = require('../server/services/bybitOrderTranslator');
const sgn = require('../server/services/bybitSigner');

// ── Fixed test vectors (synthetic; no real credentials) ─────────────────────
const APIK = 'TEST_API_KEY_S4B4';
const APIS = 'TEST_API_SECRET_S4B4_DO_NOT_USE';
const FIXED_TS = 1777320000000;
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

function _sha256(s) {
    return crypto.createHash('sha256').update(s || '').digest('hex');
}

// Common assertions every record must satisfy. Pure-shape checks.
function _assertSanitized(label, rec) {
    check(`${label}: ok=true`, rec.ok === true);
    check(`${label}: exchange='bybit'`, rec.exchange === 'bybit');
    check(`${label}: mode='dry-run'`, rec.mode === 'dry-run');
    check(`${label}: dryRun:true`, rec.dryRun === true);
    check(`${label}: secretLeak:false`, rec.secretLeak === false);
    check(`${label}: hasSignature:true`, rec.hasSignature === true);
    check(`${label}: signatureLength=64`, rec.signatureLength === 64);
    check(`${label}: headerNames is array`, Array.isArray(rec.headerNames));
    check(`${label}: headerNames sorted`,
        JSON.stringify(rec.headerNames) ===
        JSON.stringify([...rec.headerNames].sort()));
    check(`${label}: headerNames includes 6 expected entries`,
        rec.headerNames.join(',') ===
        'Content-Type,X-BAPI-API-KEY,X-BAPI-RECV-WINDOW,X-BAPI-SIGN,X-BAPI-SIGN-TYPE,X-BAPI-TIMESTAMP');
    check(`${label}: timestamp echoed`, rec.timestamp === FIXED_TS);
    check(`${label}: recvWindow echoed`, rec.recvWindow === FIXED_RW);
    check(`${label}: baseUrl echoed`, rec.baseUrl === BASE_TESTNET);
    check(`${label}: url begins with baseUrl`, rec.url.indexOf(BASE_TESTNET) === 0);
    check(`${label}: url has no production host`, rec.url.indexOf('api.bybit.com') === -1);
    // payloadHash must equal sha256(body || query)
    const payload = (rec.method === 'GET' || rec.method === 'DELETE') ? rec.query : rec.body;
    check(`${label}: payloadHash = sha256(payload)`, rec.payloadHash === _sha256(payload));
    // Frozen
    check(`${label}: record is frozen`, Object.isFrozen(rec));
    // Sanitization invariants — apiSecret / apiKey / raw signature absent
    const ser = JSON.stringify(rec);
    check(`${label}: serialized record does NOT contain apiSecret`, ser.indexOf(APIS) === -1);
    check(`${label}: serialized record does NOT contain apiKey`, ser.indexOf(APIK) === -1);
    // No 64-hex-only string can be present unless it is the payloadHash itself.
    // Easier: assert the X-BAPI-SIGN header VALUE (which lives in signed desc)
    // does not appear by reconstructing it independently and checking absence.
    const reconstructedSig = crypto.createHmac('sha256', APIS)
        .update(`${FIXED_TS}${APIK}${FIXED_RW}${payload}`).digest('hex');
    check(`${label}: serialized record does NOT contain raw signature`,
        ser.indexOf(reconstructedSig) === -1);
}

// ────────────────────────────────────────────────────────────────────────────
// T0 — module surface (exactly the documented exports)
// ────────────────────────────────────────────────────────────────────────────
console.log('\n=== T0 — bybitParityShadow module surface ===');
{
    const expected = 'SUPPORTED_INTENT_TYPES,buildBybitParityRecord';
    check('T0: exports exactly the documented surface',
        Object.keys(shadow).sort().join(',') === expected);
    check('T0: buildBybitParityRecord is a function',
        typeof shadow.buildBybitParityRecord === 'function');
    check('T0: SUPPORTED_INTENT_TYPES is a frozen array of 7',
        Array.isArray(shadow.SUPPORTED_INTENT_TYPES) &&
        shadow.SUPPORTED_INTENT_TYPES.length === 7 &&
        Object.isFrozen(shadow.SUPPORTED_INTENT_TYPES));
    check('T0: SUPPORTED_INTENT_TYPES content matches spec',
        shadow.SUPPORTED_INTENT_TYPES.slice().sort().join(',') ===
        'cancelAll,entryWithSLTP,marketEntry,positionList,reduceOnlyClose,setLeverage,walletBalance');
    check('T0: no send* on shadow', typeof shadow.sendSignedRequest === 'undefined' &&
        typeof shadow.sendOrder === 'undefined' && typeof shadow.placeOrder === 'undefined');
}

// ────────────────────────────────────────────────────────────────────────────
// T1 — marketEntry LONG record
// ────────────────────────────────────────────────────────────────────────────
console.log('\n=== T1 — marketEntry LONG record ===');
{
    const intent = { symbol: 'BTCUSDT', side: 'long', qty: '0.001', clientOrderId: 'SAT_77_aaa11122' };
    const rec = shadow.buildBybitParityRecord('marketEntry', intent, _CREDS, _OPTS);
    check('T1: intentType=marketEntry', rec.intentType === 'marketEntry');
    check('T1: method=POST', rec.method === 'POST');
    check('T1: path=/v5/order/create', rec.path === '/v5/order/create');
    check('T1: category=linear', rec.category === 'linear');
    check('T1: symbol=BTCUSDT', rec.symbol === 'BTCUSDT');
    check('T1: side=Buy (long→Buy)', rec.side === 'Buy');
    check('T1: reduceOnly=false', rec.reduceOnly === false);
    check('T1: orderType=Market', rec.orderType === 'Market');
    check('T1: qty as string', rec.qty === '0.001');
    check('T1: orderLinkId echoed', rec.orderLinkId === 'SAT_77_aaa11122');
    check('T1: query empty (POST)', rec.query === '');
    check('T1: body is JSON', typeof rec.body === 'string' && rec.body.length > 0);
    _assertSanitized('T1', rec);
}

// ────────────────────────────────────────────────────────────────────────────
// T2 — marketEntry SHORT record
// ────────────────────────────────────────────────────────────────────────────
console.log('\n=== T2 — marketEntry SHORT record ===');
{
    const intent = { symbol: 'BTCUSDT', side: 'short', qty: 0.001, clientOrderId: 'SAT_78_bbb22233' };
    const rec = shadow.buildBybitParityRecord('marketEntry', intent, _CREDS, _OPTS);
    check('T2: side=Sell (short→Sell)', rec.side === 'Sell');
    check('T2: numeric qty stringified', rec.qty === '0.001');
    _assertSanitized('T2', rec);
    // T1 vs T2 must produce different payloadHash because side differs
    const recLong = shadow.buildBybitParityRecord('marketEntry',
        { symbol: 'BTCUSDT', side: 'long', qty: 0.001, clientOrderId: 'SAT_78_bbb22233' },
        _CREDS, _OPTS);
    check('T2: payloadHash differs from LONG counterpart',
        rec.payloadHash !== recLong.payloadHash);
}

// ────────────────────────────────────────────────────────────────────────────
// T3 — reduceOnlyClose long → side:'Sell', reduceOnly:true (Option A)
// ────────────────────────────────────────────────────────────────────────────
console.log('\n=== T3 — reduceOnlyClose (positionSide=long → Sell) ===');
{
    const intent = { symbol: 'BTCUSDT', positionSide: 'long', qty: '0.001', clientOrderId: 'SAT_C77_x1y2z3w4' };
    const rec = shadow.buildBybitParityRecord('reduceOnlyClose', intent, _CREDS, _OPTS);
    check('T3: side=Sell when closing long', rec.side === 'Sell');
    check('T3: reduceOnly=true', rec.reduceOnly === true);
    check('T3: orderType=Market', rec.orderType === 'Market');
    check('T3: orderLinkId echoed', rec.orderLinkId === 'SAT_C77_x1y2z3w4');
    _assertSanitized('T3', rec);
}

// ────────────────────────────────────────────────────────────────────────────
// T4 — reduceOnlyClose short → side:'Buy', reduceOnly:true (Option A)
// ────────────────────────────────────────────────────────────────────────────
console.log('\n=== T4 — reduceOnlyClose (positionSide=short → Buy) ===');
{
    const intent = { symbol: 'ETHUSDT', positionSide: 'short', qty: 0.5, clientOrderId: 'SAT_C78_q1w2e3r4' };
    const rec = shadow.buildBybitParityRecord('reduceOnlyClose', intent, _CREDS, _OPTS);
    check('T4: side=Buy when closing short', rec.side === 'Buy');
    check('T4: reduceOnly=true', rec.reduceOnly === true);
    check('T4: symbol=ETHUSDT', rec.symbol === 'ETHUSDT');
    _assertSanitized('T4', rec);
}

// ────────────────────────────────────────────────────────────────────────────
// T5 — entryWithSLTP record (LONG with default triggers)
// ────────────────────────────────────────────────────────────────────────────
console.log('\n=== T5 — entryWithSLTP LONG default triggers ===');
{
    const intent = {
        symbol: 'BTCUSDT', side: 'long', qty: '0.001',
        clientOrderId: 'SAT_77_sl1tp1aa', stopLoss: '67000', takeProfit: '72000',
    };
    const rec = shadow.buildBybitParityRecord('entryWithSLTP', intent, _CREDS, _OPTS);
    check('T5: intentType=entryWithSLTP', rec.intentType === 'entryWithSLTP');
    check('T5: side=Buy', rec.side === 'Buy');
    check('T5: stopLoss as string', rec.stopLoss === '67000');
    check('T5: takeProfit as string', rec.takeProfit === '72000');
    check('T5: slTriggerBy default LastPrice', rec.slTriggerBy === 'LastPrice');
    check('T5: tpTriggerBy default LastPrice', rec.tpTriggerBy === 'LastPrice');
    check('T5: tpslMode default Full', rec.tpslMode === 'Full');
    check('T5: reduceOnly=false', rec.reduceOnly === false);
    _assertSanitized('T5', rec);
}

// ────────────────────────────────────────────────────────────────────────────
// T6 — cancelAll record
// ────────────────────────────────────────────────────────────────────────────
console.log('\n=== T6 — cancelAll record ===');
{
    const rec = shadow.buildBybitParityRecord('cancelAll', { symbol: 'BTCUSDT' }, _CREDS, _OPTS);
    check('T6: intentType=cancelAll', rec.intentType === 'cancelAll');
    check('T6: method=POST', rec.method === 'POST');
    check('T6: path=/v5/order/cancel-all', rec.path === '/v5/order/cancel-all');
    check('T6: symbol=BTCUSDT', rec.symbol === 'BTCUSDT');
    check('T6: side absent (cancelAll has no side)', rec.side === undefined);
    check('T6: reduceOnly absent', rec.reduceOnly === undefined);
    _assertSanitized('T6', rec);
}

// ────────────────────────────────────────────────────────────────────────────
// T7 — setLeverage record (symmetric)
// ────────────────────────────────────────────────────────────────────────────
console.log('\n=== T7 — setLeverage record (symmetric 10x) ===');
{
    const rec = shadow.buildBybitParityRecord('setLeverage',
        { symbol: 'BTCUSDT', leverage: 10 }, _CREDS, _OPTS);
    check('T7: intentType=setLeverage', rec.intentType === 'setLeverage');
    check('T7: path=/v5/position/set-leverage', rec.path === '/v5/position/set-leverage');
    check('T7: buyLeverage=10', rec.buyLeverage === '10');
    check('T7: sellLeverage=10', rec.sellLeverage === '10');
    check('T7: buy==sell', rec.buyLeverage === rec.sellLeverage);
    _assertSanitized('T7', rec);
}

// ────────────────────────────────────────────────────────────────────────────
// T8 — walletBalance default CONTRACT
// ────────────────────────────────────────────────────────────────────────────
console.log('\n=== T8 — walletBalance default CONTRACT ===');
{
    const rec = shadow.buildBybitParityRecord('walletBalance', {}, _CREDS, _OPTS);
    check('T8: intentType=walletBalance', rec.intentType === 'walletBalance');
    check('T8: method=GET', rec.method === 'GET');
    check('T8: path=/v5/account/wallet-balance', rec.path === '/v5/account/wallet-balance');
    check('T8: accountType=CONTRACT', rec.accountType === 'CONTRACT');
    check('T8: query=accountType=CONTRACT', rec.query === 'accountType=CONTRACT');
    check('T8: body empty (GET)', rec.body === '');
    check('T8: symbol null (no symbol on wallet-balance)', rec.symbol === null);
    check('T8: category null (wallet-balance has no category)', rec.category === null);
    _assertSanitized('T8', rec);
}

// ────────────────────────────────────────────────────────────────────────────
// T9 — walletBalance UNIFIED override
// ────────────────────────────────────────────────────────────────────────────
console.log('\n=== T9 — walletBalance UNIFIED override ===');
{
    const rec = shadow.buildBybitParityRecord('walletBalance',
        { accountType: 'UNIFIED' }, _CREDS, _OPTS);
    check('T9: accountType=UNIFIED honored', rec.accountType === 'UNIFIED');
    check('T9: query=accountType=UNIFIED', rec.query === 'accountType=UNIFIED');
    const recDefault = shadow.buildBybitParityRecord('walletBalance', {}, _CREDS, _OPTS);
    check('T9: payloadHash differs from CONTRACT default',
        rec.payloadHash !== recDefault.payloadHash);
    _assertSanitized('T9', rec);
}

// ────────────────────────────────────────────────────────────────────────────
// T10 — positionList with symbol
// ────────────────────────────────────────────────────────────────────────────
console.log('\n=== T10 — positionList with symbol ===');
{
    const rec = shadow.buildBybitParityRecord('positionList',
        { symbol: 'BTCUSDT' }, _CREDS, _OPTS);
    check('T10: method=GET', rec.method === 'GET');
    check('T10: path=/v5/position/list', rec.path === '/v5/position/list');
    check('T10: category=linear', rec.category === 'linear');
    check('T10: symbol=BTCUSDT', rec.symbol === 'BTCUSDT');
    check('T10: query canonical sorted', rec.query === 'category=linear&symbol=BTCUSDT');
    _assertSanitized('T10', rec);
}

// ────────────────────────────────────────────────────────────────────────────
// T11 — positionList without symbol
// ────────────────────────────────────────────────────────────────────────────
console.log('\n=== T11 — positionList without symbol ===');
{
    const rec = shadow.buildBybitParityRecord('positionList', {}, _CREDS, _OPTS);
    check('T11: category=linear', rec.category === 'linear');
    check('T11: symbol null when omitted', rec.symbol === null);
    check('T11: query=category=linear', rec.query === 'category=linear');
    _assertSanitized('T11', rec);
}

// ────────────────────────────────────────────────────────────────────────────
// T12 — invalid intentType rejected
// ────────────────────────────────────────────────────────────────────────────
console.log('\n=== T12 — invalid intentType rejected ===');
{
    expectThrow('T12: unknown intentType',
        () => shadow.buildBybitParityRecord('unknownThing', {}, _CREDS, _OPTS),
        'BYBIT_PARITY_INVALID_INTENT_TYPE');
    expectThrow('T12: empty intentType',
        () => shadow.buildBybitParityRecord('', {}, _CREDS, _OPTS),
        'BYBIT_PARITY_INVALID_INTENT_TYPE');
    expectThrow('T12: number intentType',
        () => shadow.buildBybitParityRecord(42, {}, _CREDS, _OPTS),
        'BYBIT_PARITY_INVALID_INTENT_TYPE');
    expectThrow('T12: __proto__ key not honored',
        () => shadow.buildBybitParityRecord('__proto__', {}, _CREDS, _OPTS),
        'BYBIT_PARITY_INVALID_INTENT_TYPE');
}

// ────────────────────────────────────────────────────────────────────────────
// T13 — translator errors propagate unchanged
// ────────────────────────────────────────────────────────────────────────────
console.log('\n=== T13 — translator errors propagate unchanged ===');
{
    expectThrow('T13: marketEntry invalid side propagates BYBIT_TRANSLATOR_INVALID_SIDE',
        () => shadow.buildBybitParityRecord('marketEntry',
            { symbol: 'BTCUSDT', side: 'BUY', qty: '0.001', clientOrderId: 'SAT_X' },
            _CREDS, _OPTS),
        'BYBIT_TRANSLATOR_INVALID_SIDE');
    expectThrow('T13: marketEntry invalid qty propagates BYBIT_TRANSLATOR_INVALID_QTY',
        () => shadow.buildBybitParityRecord('marketEntry',
            { symbol: 'BTCUSDT', side: 'long', qty: 0, clientOrderId: 'SAT_X' },
            _CREDS, _OPTS),
        'BYBIT_TRANSLATOR_INVALID_QTY');
    expectThrow('T13: reduceOnlyClose invalid positionSide propagates BYBIT_TRANSLATOR_INVALID_POSITION_SIDE',
        () => shadow.buildBybitParityRecord('reduceOnlyClose',
            { symbol: 'BTCUSDT', positionSide: 'Sell', qty: '0.001', clientOrderId: 'SAT_X' },
            _CREDS, _OPTS),
        'BYBIT_TRANSLATOR_INVALID_POSITION_SIDE');
    expectThrow('T13: setLeverage invalid leverage propagates BYBIT_TRANSLATOR_INVALID_LEVERAGE',
        () => shadow.buildBybitParityRecord('setLeverage',
            { symbol: 'BTCUSDT', leverage: 0 }, _CREDS, _OPTS),
        'BYBIT_TRANSLATOR_INVALID_LEVERAGE');
    expectThrow('T13: walletBalance invalid accountType propagates BYBIT_TRANSLATOR_INVALID_ACCOUNT_TYPE',
        () => shadow.buildBybitParityRecord('walletBalance',
            { accountType: 'SPOT' }, _CREDS, _OPTS),
        'BYBIT_TRANSLATOR_INVALID_ACCOUNT_TYPE');
}

// ────────────────────────────────────────────────────────────────────────────
// T14 — opts validation (no Date.now leak)
// ────────────────────────────────────────────────────────────────────────────
console.log('\n=== T14 — opts validation (deterministic only) ===');
{
    const intent = { symbol: 'BTCUSDT', side: 'long', qty: '0.001', clientOrderId: 'SAT_X' };
    expectThrow('T14: opts missing rejected',
        () => shadow.buildBybitParityRecord('marketEntry', intent, _CREDS, undefined),
        'BYBIT_PARITY_OPTS_REQUIRED');
    expectThrow('T14: opts.timestamp missing rejected',
        () => shadow.buildBybitParityRecord('marketEntry', intent, _CREDS, { recvWindow: FIXED_RW }),
        'BYBIT_PARITY_TIMESTAMP_REQUIRED');
    expectThrow('T14: opts.recvWindow missing rejected',
        () => shadow.buildBybitParityRecord('marketEntry', intent, _CREDS, { timestamp: FIXED_TS }),
        'BYBIT_PARITY_RECV_WINDOW_REQUIRED');
    expectThrow('T14: opts.timestamp NaN rejected',
        () => shadow.buildBybitParityRecord('marketEntry', intent, _CREDS, { timestamp: NaN, recvWindow: FIXED_RW }),
        'BYBIT_PARITY_TIMESTAMP_REQUIRED');
}

// ────────────────────────────────────────────────────────────────────────────
// T15 — apiSecret / apiKey / raw signature never appear in any combined record set
// ────────────────────────────────────────────────────────────────────────────
console.log('\n=== T15 — secret / key / signature never leak across full intent set ===');
{
    const all = [
        shadow.buildBybitParityRecord('marketEntry', { symbol: 'BTCUSDT', side: 'long', qty: '0.001', clientOrderId: 'SAT_LK1' }, _CREDS, _OPTS),
        shadow.buildBybitParityRecord('marketEntry', { symbol: 'BTCUSDT', side: 'short', qty: '0.001', clientOrderId: 'SAT_LK2' }, _CREDS, _OPTS),
        shadow.buildBybitParityRecord('reduceOnlyClose', { symbol: 'BTCUSDT', positionSide: 'long', qty: '0.001', clientOrderId: 'SAT_LK3' }, _CREDS, _OPTS),
        shadow.buildBybitParityRecord('reduceOnlyClose', { symbol: 'BTCUSDT', positionSide: 'short', qty: '0.001', clientOrderId: 'SAT_LK4' }, _CREDS, _OPTS),
        shadow.buildBybitParityRecord('entryWithSLTP', { symbol: 'BTCUSDT', side: 'long', qty: '0.001', clientOrderId: 'SAT_LK5', stopLoss: '67000', takeProfit: '72000' }, _CREDS, _OPTS),
        shadow.buildBybitParityRecord('cancelAll', { symbol: 'BTCUSDT' }, _CREDS, _OPTS),
        shadow.buildBybitParityRecord('setLeverage', { symbol: 'BTCUSDT', leverage: 10 }, _CREDS, _OPTS),
        shadow.buildBybitParityRecord('walletBalance', {}, _CREDS, _OPTS),
        shadow.buildBybitParityRecord('walletBalance', { accountType: 'UNIFIED' }, _CREDS, _OPTS),
        shadow.buildBybitParityRecord('positionList', { symbol: 'BTCUSDT' }, _CREDS, _OPTS),
        shadow.buildBybitParityRecord('positionList', {}, _CREDS, _OPTS),
    ];
    const combined = JSON.stringify(all);
    check('T15: no apiSecret across combined records', combined.indexOf(APIS) === -1);
    check('T15: no apiKey across combined records', combined.indexOf(APIK) === -1);

    // Reconstruct each signature inline; assert none appear in serialized records.
    let sigsLeaked = 0;
    for (const r of all) {
        const payload = (r.method === 'GET' || r.method === 'DELETE') ? r.query : r.body;
        const sig = crypto.createHmac('sha256', APIS)
            .update(`${FIXED_TS}${APIK}${FIXED_RW}${payload}`).digest('hex');
        if (combined.indexOf(sig) !== -1) sigsLeaked++;
    }
    check('T15: no raw signature appears anywhere across combined records', sigsLeaked === 0);
    // payloadHashes must all be valid sha256 hex
    check('T15: every record has a valid payloadHash', all.every(r => /^[0-9a-f]{64}$/.test(r.payloadHash)));
    // Determinism: re-running with same intents produces identical hashes
    const all2 = all.map(r => r.payloadHash);
    const all3 = [
        shadow.buildBybitParityRecord('marketEntry', { symbol: 'BTCUSDT', side: 'long', qty: '0.001', clientOrderId: 'SAT_LK1' }, _CREDS, _OPTS).payloadHash,
        shadow.buildBybitParityRecord('marketEntry', { symbol: 'BTCUSDT', side: 'short', qty: '0.001', clientOrderId: 'SAT_LK2' }, _CREDS, _OPTS).payloadHash,
    ];
    check('T15: payloadHash deterministic across repeated calls',
        all3[0] === all2[0] && all3[1] === all2[1]);
}

// ────────────────────────────────────────────────────────────────────────────
// T16 — header values stripped (only header NAMES present)
// ────────────────────────────────────────────────────────────────────────────
console.log('\n=== T16 — header values stripped, only NAMES present ===');
{
    const rec = shadow.buildBybitParityRecord('marketEntry',
        { symbol: 'BTCUSDT', side: 'long', qty: '0.001', clientOrderId: 'SAT_HV1' },
        _CREDS, _OPTS);
    const ser = JSON.stringify(rec);
    // None of the actual header values should appear (other than 'application/json'
    // for Content-Type, which is benign and useful — but it is not stored as a
    // VALUE in the record; the record only carries header names).
    check('T16: no apiKey value present', ser.indexOf(APIK) === -1);
    check('T16: no signature value present', !/[0-9a-f]{64}/.test(JSON.stringify({ headerNames: rec.headerNames })));
    // headerNames carries names only — not headers map
    check('T16: no `headers` field on record (values would carry secrets)',
        !Object.prototype.hasOwnProperty.call(rec, 'headers'));
    // hasSignature/signatureLength replace raw sig
    check('T16: hasSignature:true present', rec.hasSignature === true);
    check('T16: signatureLength=64 present', rec.signatureLength === 64);
}

// ────────────────────────────────────────────────────────────────────────────
// T17 — record is frozen (caller cannot mutate)
// ────────────────────────────────────────────────────────────────────────────
console.log('\n=== T17 — record is frozen ===');
{
    const rec = shadow.buildBybitParityRecord('cancelAll', { symbol: 'BTCUSDT' }, _CREDS, _OPTS);
    check('T17: Object.isFrozen(record)', Object.isFrozen(rec));
    check('T17: Object.isFrozen(record.warnings)', Object.isFrozen(rec.warnings));
    let mutated = false;
    try { rec.dryRun = false; mutated = (rec.dryRun === false); } catch (_) { /* strict mode throws */ }
    check('T17: cannot mutate dryRun', !mutated);
}

// ────────────────────────────────────────────────────────────────────────────
// T18 — BYBIT_DRY_RUN_ONLY hard gate (S4-B1.1) still active
// ────────────────────────────────────────────────────────────────────────────
console.log('\n=== T18 — BYBIT_DRY_RUN_ONLY hard gate ===');
{
    const MF = require('../server/migrationFlags');
    const all = MF.getAll();
    check('T18: BYBIT_DRY_RUN_ONLY=true', all.BYBIT_DRY_RUN_ONLY === true);
    check('T18: BYBIT_PARITY_ENABLED=false (B4 does not flip)', all.BYBIT_PARITY_ENABLED === false);
    check('T18: BYBIT_TESTNET_ENABLED=false', all.BYBIT_TESTNET_ENABLED === false);
    check('T18: BYBIT_LIVE_ENABLED=false', all.BYBIT_LIVE_ENABLED === false);
}

// ────────────────────────────────────────────────────────────────────────────
// T19 — B1 + B3 export invariants (defence against sibling drift)
// ────────────────────────────────────────────────────────────────────────────
console.log('\n=== T19 — B1 + B3 export invariants ===');
{
    const sgnKeys = Object.keys(sgn).sort().join(',');
    check('T19: bybitSigner exports unchanged from B1.1',
        sgnKeys === 'buildBybitHeaders,buildSignedRequestDryRun,canonicalizeBody,canonicalizeQuery,getBybitCbStatus,parseBybitError,signV5');
    check('T19: bybitSigner has no sendSignedRequest', typeof sgn.sendSignedRequest === 'undefined');
    const txKeys = Object.keys(tx).sort().join(',');
    check('T19: bybitOrderTranslator exports unchanged from B3',
        txKeys === 'normalizeBybitErrorShape,translateCancelAllToBybitV5,translateMarketEntryToBybitV5,translateMarketEntryWithSLTPToBybitV5,translatePositionListRequestToBybitV5,translateReduceOnlyCloseToBybitV5,translateSetLeverageToBybitV5,translateWalletBalanceRequestToBybitV5');
}

// ────────────────────────────────────────────────────────────────────────────
// T20 — shadow service source-level pure (no I/O / no env / no Binance)
// ────────────────────────────────────────────────────────────────────────────
console.log('\n=== T20 — shadow service source-level (no I/O / no env / no Binance) ===');
{
    const shPath = path.resolve(__dirname, '..', 'server', 'services', 'bybitParityShadow.js');
    const raw = fs.readFileSync(shPath, 'utf8');
    // Strip in REVERSE order: line comments first, then block comments.
    // Otherwise a stray `/*` inside a `// ... routes/*` line gets picked up
    // by the block-comment regex and eats real code through the next `*/`.
    const code = raw
        .replace(/(^|[^:])\/\/[^\n]*/g, '$1')
        .replace(/\/\*[\s\S]*?\*\//g, '');

    check('T20: shadow source readable', raw.length > 0);
    check('T20: no fetch(/axios/http*.request',
        !/\bfetch\s*\(/.test(code) && !/\baxios\b/.test(code) &&
        !/\bhttps?\.request\b/.test(code));
    check('T20: no require("http"|"https"|"axios"|"node-fetch")',
        !/require\(['"](?:node:)?https?['"]\)/.test(code) &&
        !/require\(['"]axios['"]\)/.test(code) &&
        !/require\(['"]node-fetch['"]\)/.test(code));
    check('T20: no Date.now() / Math.random() / process.env in code',
        !/Date\.now\(/.test(code) &&
        !/Math\.random\(/.test(code) &&
        !/process\.env/.test(code));
    check('T20: no import of database / serverAT / serverBrain / serverDSL / binanceSigner / audit / routes',
        !/require\(['"]\.\/database['"]\)/.test(code) &&
        !/require\(['"]\.\/serverAT['"]\)/.test(code) &&
        !/require\(['"]\.\/serverBrain['"]\)/.test(code) &&
        !/require\(['"]\.\/serverDSL['"]\)/.test(code) &&
        !/require\(['"]\.\/binanceSigner['"]\)/.test(code) &&
        !/require\(['"]\.\/audit['"]\)/.test(code) &&
        !/require\(['"]\.\.\/routes\//.test(code));
    check('T20: no send* function name in code',
        !/\bsendSignedRequest\b/.test(code) && !/\bsendOrder\b/.test(code) &&
        !/\bsendRequest\b/.test(code) && !/\bplaceOrder\b/.test(code));
    // Allowed imports only: crypto + ./bybitSigner + ./bybitOrderTranslator
    const requireMatches = code.match(/require\(['"][^'"]+['"]\)/g) || [];
    const allowedRequires = ["require('crypto')", "require('./bybitSigner')", "require('./bybitOrderTranslator')"];
    const normalized = requireMatches.map(s => s.replace(/"/g, "'"));
    check('T20: shadow imports exactly { crypto, ./bybitSigner, ./bybitOrderTranslator }',
        normalized.length === 3 &&
        allowedRequires.every(a => normalized.includes(a)));
}

// ────────────────────────────────────────────────────────────────────────────
// Summary
// ────────────────────────────────────────────────────────────────────────────
console.log('\n========================================================');
console.log(`probe-s4-b4: ${pass}/${pass + fail} PASS`);
console.log('========================================================');
process.exit(fail === 0 ? 0 : 1);
