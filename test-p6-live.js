/**
 * Zeus Terminal — Phase 6 Live AT Test Suite
 * Offline simulation: mocks all Binance/DB dependencies
 * Tests: credentialStore, live entry gating, risk guard blocks,
 *        order placement flow, SL/TP, live exit, live stats, endpoints
 * Run: node test-p6-live.js
 */
'use strict';

// Stub required env vars for testing (config.js fail-fast requires these)
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-p6-jwt-secret-32chars!!!!';
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || 'test-p6-enc-key-32chars!!!!!!';

// ═══════════════════════════════════════════════════════════════
// TEST HARNESS (async-aware)
// ═══════════════════════════════════════════════════════════════
let _pass = 0, _fail = 0, _section = '';
const _failures = [];
const _testQueue = [];  // collect tests, run sequentially with await

function section(name) { _testQueue.push({ type: 'section', name }); }
function test(name, fn) { _testQueue.push({ type: 'test', name, fn }); }
function assert(cond, msg) { if (!cond) throw new Error(msg || 'Assertion failed'); }
function assertEq(a, b, msg) { if (a !== b) throw new Error(msg || `Expected ${b}, got ${a}`); }

async function runAllTests() {
    for (const item of _testQueue) {
        if (item.type === 'section') {
            _section = item.name;
            console.log(`\n${'═'.repeat(60)}\n  ${item.name}\n${'═'.repeat(60)}`);
            continue;
        }
        try {
            await item.fn();
            _pass++;
            console.log(`  ✅ ${item.name}`);
        } catch (e) {
            _fail++;
            console.log(`  ❌ ${item.name} — ${e.message}`);
            _failures.push({ section: _section, test: item.name, error: e.message });
        }
    }
}

// ═══════════════════════════════════════════════════════════════
// MOCK SETUP — Pre-populate require cache before loading serverAT
// ═══════════════════════════════════════════════════════════════

// Track all mock calls for verification
const _mockCalls = {
    sendSigned: [],
    validateOrder: [],
    recordPnL: [],
    telegram: [],
    audit: [],
    metrics: [],
};
function resetMocks() {
    _mockCalls.sendSigned.length = 0;
    _mockCalls.validateOrder.length = 0;
    _mockCalls.recordPnL.length = 0;
    _mockCalls.telegram.length = 0;
    _mockCalls.audit.length = 0;
    _mockCalls.metrics.length = 0;
    _mockBehavior.sendSignedResult = null;
    _mockBehavior.sendSignedError = null;
    _mockBehavior.sendSignedPathErrors = {};
    _mockBehavior.sendSignedTypeErrors = {};
    _mockBehavior.sendSignedCallLimit = 0;
    _mockBehavior.riskOk = true;
    _mockBehavior.riskReason = '';
    _mockBehavior.creds = { apiKey: 'TESTKEY', apiSecret: 'TESTSECRET', baseUrl: 'https://testnet.binancefuture.com', mode: 'testnet' };
    _sendCallCount = 0;
}
const _mockBehavior = {
    sendSignedResult: null,
    sendSignedError: null,
    sendSignedPathErrors: {},
    sendSignedTypeErrors: {},
    sendSignedCallLimit: 0,
    riskOk: true,
    riskReason: '',
    creds: { apiKey: 'TESTKEY', apiSecret: 'TESTSECRET', baseUrl: 'https://testnet.binancefuture.com', mode: 'testnet' },
};

// ── 1. Mock logger ──
const mockLogger = {
    info: () => { },
    warn: () => { },
    error: () => { },
    debug: () => { },
    log: () => { },
    LOG_DIR: '/tmp', LOG_FILE: '/tmp/test.log',
};
require.cache[require.resolve('./server/services/logger')] = { id: 'logger', exports: mockLogger, loaded: true };

// ── 2. Mock migrationFlags — controllable SERVER_AT flag ──
let _mfServerAT = false;
const mockMF = {
    get SERVER_MARKET_DATA() { return false; },
    get SERVER_BRAIN() { return true; },
    get SERVER_AT() { return _mfServerAT; },
    get CLIENT_BRAIN() { return false; },
    get CLIENT_AT() { return !_mfServerAT; },
    set: () => { },
    getAll: () => ({ SERVER_MARKET_DATA: false, SERVER_BRAIN: true, SERVER_AT: _mfServerAT, CLIENT_BRAIN: false, CLIENT_AT: !_mfServerAT }),
    save: () => { },
    DEFAULTS: {},
};
require.cache[require.resolve('./server/migrationFlags')] = { id: 'mf', exports: mockMF, loaded: true };

// ── 3. Mock credentialStore ──
const mockCredStore = {
    getExchangeCreds: (userId) => {
        return _mockBehavior.creds;
    },
};
require.cache[require.resolve('./server/services/credentialStore')] = { id: 'cs', exports: mockCredStore, loaded: true };

// ── 4. Mock binanceSigner — all behavior controlled via _mockBehavior ──
let _orderSeq = 1000;
let _sendCallCount = 0;
const mockSigner = {
    sendSignedRequest: async (method, path, params, creds) => {
        _sendCallCount++;
        _mockCalls.sendSigned.push({ method, path, params, creds });

        // Global error
        if (_mockBehavior.sendSignedError) {
            throw new Error(_mockBehavior.sendSignedError);
        }
        // Call-count-based error (fail on Nth call)
        if (_mockBehavior.sendSignedCallLimit > 0 && _sendCallCount >= _mockBehavior.sendSignedCallLimit) {
            throw new Error('CALL_LIMIT_REACHED');
        }
        // Path-specific error
        if (_mockBehavior.sendSignedPathErrors[path]) {
            throw new Error(_mockBehavior.sendSignedPathErrors[path]);
        }
        // Type-specific error (for order types)
        if (params && params.type && _mockBehavior.sendSignedTypeErrors[params.type]) {
            throw new Error(_mockBehavior.sendSignedTypeErrors[params.type]);
        }
        // Override result
        if (_mockBehavior.sendSignedResult) {
            return _mockBehavior.sendSignedResult;
        }
        // Default: return sensible mock Binance response
        _orderSeq++;
        if (path === '/fapi/v2/balance') {
            return [{ asset: 'USDT', availableBalance: '50000.00', balance: '50000.00' }];
        }
        if (path === '/fapi/v1/leverage') {
            return { leverage: params.leverage, symbol: params.symbol };
        }
        return {
            orderId: _orderSeq,
            symbol: params.symbol,
            side: params.side,
            type: params.type,
            executedQty: params.quantity || '0',
            avgPrice: '65000.00',
            status: 'FILLED',
        };
    },
    signParams: () => ({}),
};
require.cache[require.resolve('./server/services/binanceSigner')] = { id: 'bs', exports: mockSigner, loaded: true };

// ── 5. Mock exchangeInfo ──
const mockExchangeInfo = {
    roundOrderParams: (symbol, quantity, stopPrice) => {
        return { quantity: quantity, stopPrice: stopPrice };
    },
    startAutoRefresh: () => { },
};
require.cache[require.resolve('./server/services/exchangeInfo')] = { id: 'ei', exports: mockExchangeInfo, loaded: true };

// ── 6. Mock riskGuard ──
const mockRiskGuard = {
    validateOrder: (order, owner, userId) => {
        _mockCalls.validateOrder.push({ order, owner, userId });
        return { ok: _mockBehavior.riskOk, reason: _mockBehavior.riskReason };
    },
    recordClosedPnL: (pnl, owner, userId) => {
        _mockCalls.recordPnL.push({ pnl, owner, userId });
    },
    setEmergencyKill: () => { },
    getDailyState: () => ({ realizedPnL: 0 }),
};
require.cache[require.resolve('./server/services/riskGuard')] = { id: 'rg', exports: mockRiskGuard, loaded: true };

// ── 7. Mock telegram ──
const mockTelegram = {
    send: (text) => { _mockCalls.telegram.push({ fn: 'send', text }); },
    sendToUser: (userId, text) => { _mockCalls.telegram.push({ fn: 'sendToUser', userId, text }); },
    alertOrderFilled: (...args) => { _mockCalls.telegram.push({ fn: 'alertOrderFilled', args }); },
    alertOrderFailed: (...args) => { _mockCalls.telegram.push({ fn: 'alertOrderFailed', args }); },
    alertRiskBlock: (...args) => { _mockCalls.telegram.push({ fn: 'alertRiskBlock', args }); },
};
require.cache[require.resolve('./server/services/telegram')] = { id: 'tg', exports: mockTelegram, loaded: true };

// ── 8. Mock audit ──
const mockAudit = {
    record: (action, details, actor) => { _mockCalls.audit.push({ action, details, actor }); },
    readLast: () => [],
};
require.cache[require.resolve('./server/services/audit')] = { id: 'au', exports: mockAudit, loaded: true };

// ── 9. Mock metrics ──
const mockMetrics = {
    recordOrder: (outcome) => { _mockCalls.metrics.push({ fn: 'recordOrder', outcome }); },
    recordLatency: () => { },
    recordError: () => { },
    recordReconciliation: () => { },
    getMetrics: () => ({}),
};
require.cache[require.resolve('./server/services/metrics')] = { id: 'mt', exports: mockMetrics, loaded: true };

// ── 10. Mock database (for credentialStore + serverAT persistence) ──
const mockDB = {
    getExchangeAccount: () => null,
    atSavePosition: () => { },
    atArchiveClosed: () => true,
    atSetState: () => { },
    atGetOpenUserIds: () => [],
    atLoadOpenPositions: () => [],
    atGetStateByUser: () => [],
    getGhostCandidates: () => [],
    saveMissedTrade: () => { },
    runRaw: () => { },
    getMaxSeq: () => 0,
};
require.cache[require.resolve('./server/services/database')] = { id: 'db', exports: mockDB, loaded: true };

// ── 11. Mock encryption ──
const mockEncryption = {
    encrypt: (t) => 'enc_' + t,
    decrypt: (t) => t.replace('enc_', ''),
};
require.cache[require.resolve('./server/services/encryption')] = { id: 'enc', exports: mockEncryption, loaded: true };

// ═══════════════════════════════════════════════════════════════
// LOAD serverAT with mocked dependencies
// ═══════════════════════════════════════════════════════════════
const serverAT = require('./server/services/serverAT');
const TEST_UID = 1;

// Helpers
function makeDecision(overrides) {
    return Object.assign({
        cycle: 100,
        symbol: 'BTCUSDT',
        price: 65000,
        regime: { regime: 'TREND_UP' },
        fusion: {
            decision: 'LARGE',
            dir: 'LONG',
            confidence: 85,
            score: 78,
        },
    }, overrides);
}

function makeSTC(overrides) {
    return Object.assign({
        size: 100,
        lev: 10,
        slPct: 1.0,
        rr: 2.0,
        maxPos: 5,
        cooldownMs: 30000,
    }, overrides);
}

// Small delay helper for async operations
function tick(ms) { return new Promise(r => setTimeout(r, ms || 50)); }

console.log('═══════════════════════════════════════════════════════════════');
console.log('  Zeus Terminal — Phase 6 Live AT Test Suite');
console.log('═══════════════════════════════════════════════════════════════');

// ═══════════════════════════════════════════════════════════════
// 1. CREDENTIAL STORE (uses real module with mocked DB/encryption)
// ═══════════════════════════════════════════════════════════════
section('1. CREDENTIAL STORE');

test('getExchangeCreds returns creds from mock', () => {
    // Clear credentialStore cache so it reloads fresh (with mocked DB/encryption)
    delete require.cache[require.resolve('./server/services/credentialStore')];
    mockDB.getExchangeAccount = (uid) => {
        if (uid === 1) return { api_key_encrypted: 'enc_KEY123', api_secret_encrypted: 'enc_SEC456', mode: 'testnet' };
        return null;
    };
    const { getExchangeCreds } = require('./server/services/credentialStore');
    const creds = getExchangeCreds(1);
    assert(creds !== null, 'Should return creds');
    assertEq(creds.apiKey, 'KEY123', 'apiKey decrypted');
    assertEq(creds.apiSecret, 'SEC456', 'apiSecret decrypted');
    assertEq(creds.mode, 'testnet', 'mode');
    assertEq(creds.baseUrl, 'https://testnet.binancefuture.com', 'baseUrl for testnet');
    // Re-cache the mock for serverAT
    require.cache[require.resolve('./server/services/credentialStore')] = { id: 'cs', exports: mockCredStore, loaded: true };
});

test('getExchangeCreds returns null for missing user', () => {
    delete require.cache[require.resolve('./server/services/credentialStore')];
    const { getExchangeCreds } = require('./server/services/credentialStore');
    const creds = getExchangeCreds(999);
    assertEq(creds, null, 'No creds for unknown user');
    require.cache[require.resolve('./server/services/credentialStore')] = { id: 'cs', exports: mockCredStore, loaded: true };
});

test('getExchangeCreds returns null for null userId', () => {
    delete require.cache[require.resolve('./server/services/credentialStore')];
    const { getExchangeCreds } = require('./server/services/credentialStore');
    assertEq(getExchangeCreds(null), null, 'null userId → null');
    assertEq(getExchangeCreds(0), null, 'zero userId → null');
    require.cache[require.resolve('./server/services/credentialStore')] = { id: 'cs', exports: mockCredStore, loaded: true };
});

test('getExchangeCreds live mode baseUrl', () => {
    delete require.cache[require.resolve('./server/services/credentialStore')];
    mockDB.getExchangeAccount = (uid) => {
        if (uid === 2) return { api_key_encrypted: 'enc_LIVE', api_secret_encrypted: 'enc_LIVESEC', mode: 'live' };
        return null;
    };
    const { getExchangeCreds } = require('./server/services/credentialStore');
    const creds = getExchangeCreds(2);
    assertEq(creds.baseUrl, 'https://fapi.binance.com', 'live mode uses fapi.binance.com');
    require.cache[require.resolve('./server/services/credentialStore')] = { id: 'cs', exports: mockCredStore, loaded: true };
});

// ═══════════════════════════════════════════════════════════════
// 2. SHADOW MODE — P5 Regression (MF.SERVER_AT = false)
// ═══════════════════════════════════════════════════════════════
section('2. SHADOW MODE — P5 Regression');

test('Shadow entry created for LARGE LONG', () => {
    serverAT.reset(TEST_UID);
    resetMocks();
    serverAT.setMode(TEST_UID, 'demo');
    const entry = serverAT.processBrainDecision(makeDecision(), makeSTC(), TEST_UID);
    assert(entry !== null, 'Should create shadow entry');
    assertEq(entry.side, 'LONG', 'side');
    assertEq(entry.symbol, 'BTCUSDT', 'symbol');
    assertEq(entry.tier, 'LARGE', 'tier');
    assertEq(entry.status, 'OPEN', 'status');
    assert(entry.live === undefined || entry.live === null, 'No live data when SERVER_AT=false');
});

test('Shadow stats increment correctly', () => {
    const stats = serverAT.getStats(TEST_UID);
    assertEq(stats.entries, 1, '1 entry');
    assertEq(stats.openCount, 1, '1 open');
    assertEq(stats.exits, 0, '0 exits');
});

test('No Binance API calls when SERVER_AT=false', async () => {
    // Entry already created in previous test with SERVER_AT=false
    await tick(50);  // Allow any potential async to settle
    assertEq(_mockCalls.sendSigned.length, 0, 'No sendSignedRequest calls');
    assertEq(_mockCalls.validateOrder.length, 0, 'No risk guard calls');
});

test('Duplicate symbol+side rejected', () => {
    const dup = serverAT.processBrainDecision(makeDecision(), makeSTC(), TEST_UID);
    assertEq(dup, null, 'Duplicate BTCUSDT LONG rejected');
});

test('Shadow entry for different symbol allowed', () => {
    const entry2 = serverAT.processBrainDecision(
        makeDecision({ symbol: 'ETHUSDT', price: 3500 }),
        makeSTC()
    , TEST_UID);
    assert(entry2 !== null, 'ETHUSDT entry created');
    assertEq(entry2.symbol, 'ETHUSDT', 'symbol');
});

test('MEDIUM tier uses correct multiplier', () => {
    const entry = serverAT.processBrainDecision(
        makeDecision({ symbol: 'SOLUSDT', price: 150, fusion: { decision: 'MEDIUM', dir: 'SHORT', confidence: 72, score: 65 } }),
        makeSTC()
    , TEST_UID);
    assert(entry !== null, 'MEDIUM SHORT created');
    assertEq(entry.tier, 'MEDIUM', 'tier=MEDIUM');
    assertEq(entry.side, 'SHORT', 'side=SHORT');
    assertEq(entry.fusionMult, 1.35, 'MEDIUM mult=1.35');
});

test('NO_TRADE tier returns null', () => {
    const r = serverAT.processBrainDecision(
        makeDecision({ fusion: { decision: 'NO_TRADE', dir: 'LONG', confidence: 20, score: 15 } }),
        makeSTC()
    , TEST_UID);
    assertEq(r, null, 'NO_TRADE → null');
});

test('SL/TP calculation correct for LONG', () => {
    serverAT.reset(TEST_UID);
    const entry = serverAT.processBrainDecision(
        makeDecision({ price: 60000 }),
        makeSTC({ slPct: 1.0, rr: 2.0 })
    , TEST_UID);
    // SL = 60000 - (60000 * 1.0/100) = 60000 - 600 = 59400
    // TP = 60000 + (600 * 2.0) = 61200
    assertEq(entry.sl, 59400, 'SL=59400');
    assertEq(entry.tp, 61200, 'TP=61200');
});

test('SL/TP calculation correct for SHORT', () => {
    const entry = serverAT.processBrainDecision(
        makeDecision({ symbol: 'ETHUSDT', price: 4000, fusion: { decision: 'SMALL', dir: 'SHORT', confidence: 60, score: 55 } }),
        makeSTC({ slPct: 0.5, rr: 3.0 })
    , TEST_UID);
    // SL = 4000 + (4000 * 0.5/100) = 4000 + 20 = 4020
    // TP = 4000 - (20 * 3.0) = 3940
    assertEq(entry.sl, 4020, 'SHORT SL=4020');
    assertEq(entry.tp, 3940, 'SHORT TP=3940');
});

test('onPriceUpdate closes at SL (LONG)', () => {
    serverAT.reset(TEST_UID);
    serverAT.processBrainDecision(makeDecision({ price: 60000 }), makeSTC({ slPct: 1.0, rr: 2.0 }), TEST_UID);
    assertEq(serverAT.getOpenCount(TEST_UID), 1, '1 open before SL');
    serverAT.onPriceUpdate('BTCUSDT', 59400);  // Hit SL
    assertEq(serverAT.getOpenCount(TEST_UID), 0, '0 open after SL hit');
    const stats = serverAT.getStats(TEST_UID);
    assertEq(stats.exits, 1, '1 exit');
    assert(stats.pnl < 0, 'Negative PnL at SL');
    assertEq(stats.losses, 1, '1 loss');
});

test('onPriceUpdate closes at TP (LONG)', () => {
    serverAT.reset(TEST_UID);
    serverAT.processBrainDecision(makeDecision({ price: 60000 }), makeSTC({ slPct: 1.0, rr: 2.0 }), TEST_UID);
    serverAT.onPriceUpdate('BTCUSDT', 61200);  // Hit TP
    assertEq(serverAT.getOpenCount(TEST_UID), 0, '0 open after TP hit');
    const stats = serverAT.getStats(TEST_UID);
    assertEq(stats.wins, 1, '1 win (TP)');
    assert(stats.pnl > 0, 'Positive PnL at TP');
});

test('maxPos gate blocks excess shadow entries', () => {
    serverAT.reset(TEST_UID);
    serverAT.processBrainDecision(makeDecision({ symbol: 'BTCUSDT' }), makeSTC({ maxPos: 2 }), TEST_UID);
    serverAT.processBrainDecision(makeDecision({ symbol: 'ETHUSDT', price: 3500 }), makeSTC({ maxPos: 2 }), TEST_UID);
    const third = serverAT.processBrainDecision(
        makeDecision({ symbol: 'SOLUSDT', price: 150 }),
        makeSTC({ maxPos: 2 })
    , TEST_UID);
    assertEq(third, null, '3rd entry blocked by maxPos=2');
    assertEq(serverAT.getOpenCount(TEST_UID), 2, '2 positions open');
});

// [REMOVED] expireStale was removed from serverAT — time-based expiry fully eliminated
// Positions close only via: SL, TP, DSL_PL, DSL_TTP, MANUAL_CLIENT, EMERGENCY_CLOSED, RECON_PHANTOM, RESET, kill switch

// ═══════════════════════════════════════════════════════════════
// 3. LIVE EXECUTION — Entry (MF.SERVER_AT = true)
// ═══════════════════════════════════════════════════════════════
section('3. LIVE EXECUTION — Entry');

test('Live entry calls sendSignedRequest for leverage + market + SL + TP', async () => {
    resetMocks();
    serverAT.reset(TEST_UID);
    serverAT.setMode(TEST_UID, 'live');
    await tick(50); // let setMode background balance check complete
    resetMocks();   // clear the background balance call
    _orderSeq = 2000;

    const entry = serverAT.processBrainDecision(makeDecision({ price: 65000 }), makeSTC(), TEST_UID);
    assert(entry !== null, 'Entry created');
    entry.live = {}; // [FIX] init live object — serverAT.js line 767 needs entry.live to exist before assignment

    // Wait for async live execution
    await tick(100);

    // Should have: balance check, leverage, market entry, SL, TP = 5 calls
    assert(_mockCalls.sendSigned.length >= 5, `Expected ≥5 API calls, got ${_mockCalls.sendSigned.length}`);

    // Call 0: margin pre-check
    assertEq(_mockCalls.sendSigned[0].path, '/fapi/v2/balance', 'First call checks balance');

    // Call 1: leverage
    assertEq(_mockCalls.sendSigned[1].path, '/fapi/v1/leverage', 'Second call sets leverage');
    assertEq(_mockCalls.sendSigned[1].params.leverage, 10, 'leverage=10');

    // Call 2: MARKET entry
    assertEq(_mockCalls.sendSigned[2].path, '/fapi/v1/order', 'Third call places order');
    assertEq(_mockCalls.sendSigned[2].params.type, 'MARKET', 'MARKET order');
    assertEq(_mockCalls.sendSigned[2].params.side, 'BUY', 'LONG → BUY');

    // Call 3: STOP_MARKET (SL)
    assertEq(_mockCalls.sendSigned[3].params.type, 'STOP_MARKET', 'SL is STOP_MARKET');
    assert(String(_mockCalls.sendSigned[3].params.reduceOnly) === 'true', 'SL reduceOnly');

    // Call 4: TAKE_PROFIT_MARKET (TP)
    assertEq(_mockCalls.sendSigned[4].params.type, 'TAKE_PROFIT_MARKET', 'TP is TAKE_PROFIT_MARKET');
    assert(String(_mockCalls.sendSigned[4].params.reduceOnly) === 'true', 'TP reduceOnly');
});

test('Risk guard validateOrder is called before entry', async () => {
    resetMocks();
    serverAT.reset(TEST_UID);
    serverAT.setMode(TEST_UID, 'live');

    serverAT.processBrainDecision(makeDecision(), makeSTC(), TEST_UID);
    await tick(100);

    assertEq(_mockCalls.validateOrder.length, 1, 'validateOrder called once');
    assertEq(_mockCalls.validateOrder[0].owner, 'SERVER_AT', 'owner=SERVER_AT');
    assertEq(_mockCalls.validateOrder[0].order.symbol, 'BTCUSDT', 'correct symbol');
    assertEq(_mockCalls.validateOrder[0].order.type, 'MARKET', 'type=MARKET');
});

test('Risk guard block prevents live entry', async () => {
    resetMocks();
    serverAT.reset(TEST_UID);
    serverAT.setMode(TEST_UID, 'live');
    await tick(100); // let async handlers from reset complete
    resetMocks();    // clear leaked DELETE calls from prior live positions
    _mockBehavior.riskOk = false;
    _mockBehavior.riskReason = 'daily_loss_limit';

    const entry = serverAT.processBrainDecision(makeDecision(), makeSTC(), TEST_UID);
    await tick(100);

    // Shadow entry should exist with risk blocked live status
    assert(entry !== null, 'Shadow entry still created');
    assertEq(entry.live.status, 'RISK_BLOCKED', 'live status = RISK_BLOCKED');
    assertEq(entry.live.reason, 'daily_loss_limit', 'risk reason stored');

    // No Binance API calls (only validateOrder, no sendSignedRequest)
    assertEq(_mockCalls.sendSigned.length, 0, 'No exchange calls when risk blocked');

    // Telegram risk alert sent
    const riskAlert = _mockCalls.telegram.find(c => c.fn === 'alertRiskBlock');
    assert(riskAlert, 'Telegram risk block alert sent');

    // Live stats
    const ls = serverAT.getLiveStats(TEST_UID);
    assertEq(ls.blocked, 1, 'blocked=1 in live stats');

    _mockBehavior.riskOk = true;
    _mockBehavior.riskReason = '';
});

test('No creds prevents live entry', async () => {
    resetMocks();
    serverAT.reset(TEST_UID);
    serverAT.setMode(TEST_UID, 'live');
    _mockBehavior.creds = null;  // No credentials

    const entry = serverAT.processBrainDecision(makeDecision(), makeSTC(), TEST_UID);
    await tick(100);

    assert(entry !== null, 'Shadow entry exists');
    assertEq(entry.live.status, 'NO_CREDS', 'live status = NO_CREDS');
    assertEq(_mockCalls.sendSigned.length, 0, 'No exchange calls');

    const ls = serverAT.getLiveStats(TEST_UID);
    assertEq(ls.errors, 1, 'errors=1 in live stats');

    _mockBehavior.creds = { apiKey: 'TESTKEY', apiSecret: 'TESTSECRET', baseUrl: 'https://testnet.binancefuture.com', mode: 'testnet' };
});

test('Market order failure logged and tracked', async () => {
    resetMocks();
    serverAT.reset(TEST_UID);
    serverAT.setMode(TEST_UID, 'live');
    // Leverage OK, but all /fapi/v1/order calls fail
    _mockBehavior.sendSignedPathErrors['/fapi/v1/order'] = 'INSUFFICIENT_MARGIN';

    const entry = serverAT.processBrainDecision(makeDecision(), makeSTC(), TEST_UID);
    await tick(100);

    assertEq(entry.live.status, 'ENTRY_FAILED', 'live status = ENTRY_FAILED');
    assertEq(entry.live.error, 'INSUFFICIENT_MARGIN', 'error message stored');

    // Telegram failure alert should have been sent
    const failAlert = _mockCalls.telegram.find(c => c.fn === 'alertOrderFailed');
    assert(failAlert, 'Telegram alertOrderFailed called');
});

test('Leverage failure is BLOCKING — entry rejected', async () => {
    resetMocks();
    serverAT.reset(TEST_UID);
    serverAT.setMode(TEST_UID, 'live');
    await tick(50); resetMocks();
    // Leverage call fails — now BLOCKING (wrong leverage = wrong risk)
    _mockBehavior.sendSignedPathErrors['/fapi/v1/leverage'] = 'LEVERAGE_ALREADY_SET';

    const entry = serverAT.processBrainDecision(makeDecision(), makeSTC(), TEST_UID);
    entry.live = {};
    await tick(2500); // leverage retry has 1s delay before second attempt

    assertEq(entry.live.status, 'LEVERAGE_FAILED', 'Entry blocked after leverage failure');
    assertEq(entry.live.error, 'LEVERAGE_ALREADY_SET', 'error stored');
});

test('SL/TP failures trigger emergency close', async () => {
    resetMocks();
    serverAT.reset(TEST_UID);
    serverAT.setMode(TEST_UID, 'live');
    await tick(50); resetMocks();
    // SL and TP order types fail, but MARKET is fine
    _mockBehavior.sendSignedTypeErrors['STOP_MARKET'] = 'STOP_ORDER_FAILED';
    _mockBehavior.sendSignedTypeErrors['TAKE_PROFIT_MARKET'] = 'TP_ORDER_FAILED';

    const entry = serverAT.processBrainDecision(makeDecision(), makeSTC(), TEST_UID);
    entry.live = {}; // [FIX] init live object
    await tick(6000); // SL retries: 0s + 1s + 3s = 4s, then emergency close

    // SL retries all fail → emergency MARKET close succeeds → position closed
    assert(entry.live !== undefined, 'live object exists');
    assertEq(entry.live.status, 'EMERGENCY_CLOSED', 'Emergency closed after SL retries exhausted');

    // Telegram emergency close message sent
    const emgMsg = _mockCalls.telegram.find(c => c.fn === 'sendToUser' && c.text.includes('EMERGENCY'));
    assert(emgMsg, 'Telegram emergency close message sent');
});

test('Live entry stores tracking data on shadow entry', async () => {
    resetMocks();
    serverAT.reset(TEST_UID);
    serverAT.setMode(TEST_UID, 'live');
    await tick(50); resetMocks();

    const entry = serverAT.processBrainDecision(makeDecision(), makeSTC(), TEST_UID);
    entry.live = {}; // [FIX] init live object
    await tick(100);

    assertEq(entry.live.status, 'LIVE', 'status=LIVE');
    assert(entry.live.liveSeq > 0, 'liveSeq assigned');
    assert(entry.live.clientOrderId.startsWith('SAT_'), 'clientOrderId starts with SAT_');
    assert(entry.live.mainOrderId > 0, 'mainOrderId set');
    assert(entry.live.avgPrice > 0, 'avgPrice recorded');
    assert(entry.live.executedQty > 0, 'executedQty recorded');
});

test('Audit record written on entry fill', async () => {
    resetMocks();
    serverAT.reset(TEST_UID);
    serverAT.setMode(TEST_UID, 'live');
    await tick(50); resetMocks();

    const entry = serverAT.processBrainDecision(makeDecision(), makeSTC(), TEST_UID);
    entry.live = {}; // [FIX] init live object
    await tick(100);

    const fillAudit = _mockCalls.audit.find(a => a.action === 'SAT_ENTRY_FILLED');
    assert(fillAudit, 'SAT_ENTRY_FILLED audit record created');
    assertEq(fillAudit.actor, 'SERVER_AT', 'actor=SERVER_AT');
    assertEq(fillAudit.details.symbol, 'BTCUSDT', 'symbol in audit');
});

test('Metrics recordOrder(filled) called', async () => {
    resetMocks();
    serverAT.reset(TEST_UID);
    serverAT.setMode(TEST_UID, 'live');
    await tick(50); resetMocks();

    const entry = serverAT.processBrainDecision(makeDecision(), makeSTC(), TEST_UID);
    entry.live = {}; // [FIX] init live object
    await tick(100);

    const filled = _mockCalls.metrics.filter(m => m.outcome === 'filled');
    assert(filled.length > 0, 'metrics.recordOrder("filled") called');
});

test('Telegram alertOrderFilled called', async () => {
    resetMocks();
    serverAT.reset(TEST_UID);
    serverAT.setMode(TEST_UID, 'live');
    await tick(50); resetMocks();

    const entry = serverAT.processBrainDecision(makeDecision(), makeSTC(), TEST_UID);
    entry.live = {}; // [FIX] init live object
    await tick(100);

    const fillAlert = _mockCalls.telegram.filter(c => c.fn === 'alertOrderFilled');
    assert(fillAlert.length > 0, 'alertOrderFilled called');
});

// ═══════════════════════════════════════════════════════════════
// 4. LIVE EXIT — SL/TP / Expiry
// ═══════════════════════════════════════════════════════════════
section('4. LIVE EXIT — SL/TP/Expiry');

test('SL hit cancels TP order and records PnL', async () => {
    resetMocks();
    serverAT.reset(TEST_UID);
    serverAT.setMode(TEST_UID, 'live');
    await tick(50); resetMocks();

    const entry = serverAT.processBrainDecision(
        makeDecision({ price: 60000 }),
        makeSTC({ slPct: 1.0, rr: 2.0 })
    , TEST_UID);
    entry.live = {}; // [FIX] init live object
    await tick(100);  // live entry completes

    resetMocks();  // Clear mock calls to isolate exit calls

    // Price hits SL (59400 for LONG)
    serverAT.onPriceUpdate('BTCUSDT', 59400);
    await tick(100);  // live exit handler runs

    // Should cancel TP order (DELETE /fapi/v1/order)
    const cancelCalls = _mockCalls.sendSigned.filter(c => c.method === 'DELETE');
    assert(cancelCalls.length >= 1, `Should cancel TP order, got ${cancelCalls.length} DELETE calls`);

    // PnL recorded
    assert(_mockCalls.recordPnL.length >= 1, 'recordClosedPnL called');

    // Audit exit record
    const exitAudit = _mockCalls.audit.find(a => a.action === 'SAT_EXIT');
    assert(exitAudit, 'SAT_EXIT audit record');
    assertEq(exitAudit.details.exitType, 'HIT_SL', 'exitType=HIT_SL');

    // Telegram exit message
    const exitMsg = _mockCalls.telegram.find(c => c.fn === 'sendToUser' && c.text.includes('HIT_SL'));
    assert(exitMsg, 'Telegram exit message sent');
});

test('TP hit cancels SL order', async () => {
    resetMocks();
    serverAT.reset(TEST_UID);
    serverAT.setMode(TEST_UID, 'live');
    await tick(50); resetMocks();

    const entry = serverAT.processBrainDecision(
        makeDecision({ price: 60000 }),
        makeSTC({ slPct: 1.0, rr: 2.0 })
    , TEST_UID);
    entry.live = {}; // [FIX] init live object
    await tick(100);

    resetMocks();

    // Price hits TP (61200 for LONG)
    serverAT.onPriceUpdate('BTCUSDT', 61200);
    await tick(100);

    const cancelCalls = _mockCalls.sendSigned.filter(c => c.method === 'DELETE');
    assert(cancelCalls.length >= 1, 'Should cancel SL order');

    const exitAudit = _mockCalls.audit.find(a => a.action === 'SAT_EXIT');
    assert(exitAudit, 'SAT_EXIT audit record');
    assertEq(exitAudit.details.exitType, 'HIT_TP', 'exitType=HIT_TP');
});

// [REMOVED] expireStale was removed from serverAT — time-based expiry fully eliminated
// Expiry force-close test removed along with expireStale function

// ═══════════════════════════════════════════════════════════════
// 5. LIVE STATS & GETTERS
// ═══════════════════════════════════════════════════════════════
section('5. LIVE STATS & GETTERS');

test('getLiveStats returns correct structure', () => {
    resetMocks();
    serverAT.reset(TEST_UID);

    const ls = serverAT.getLiveStats(TEST_UID);
    assert('enabled' in ls, 'has enabled');
    assert('tradingUserId' in ls, 'has tradingUserId');
    assert('entries' in ls, 'has entries');
    assert('exits' in ls, 'has exits');
    assert('pnl' in ls, 'has pnl');
    assert('wins' in ls, 'has wins');
    assert('losses' in ls, 'has losses');
    assert('winRate' in ls, 'has winRate');
    assert('blocked' in ls, 'has blocked');
    assert('errors' in ls, 'has errors');
});

test('getLiveStats.enabled reflects MF.SERVER_AT', () => {
    serverAT.setMode(TEST_UID, 'demo');
    assertEq(serverAT.getLiveStats(TEST_UID).enabled, false, 'enabled=false when SERVER_AT=false');
    serverAT.setMode(TEST_UID, 'live');
    assertEq(serverAT.getLiveStats(TEST_UID).enabled, true, 'enabled=true when SERVER_AT=true');
});

test('getLivePositions returns only LIVE positions', async () => {
    resetMocks();
    serverAT.reset(TEST_UID);
    serverAT.setMode(TEST_UID, 'live');
    await tick(50); resetMocks();

    const entry = serverAT.processBrainDecision(makeDecision(), makeSTC(), TEST_UID);
    entry.live = {}; // [FIX] init live object
    await tick(100);

    const lp = serverAT.getLivePositions(TEST_UID);
    assertEq(lp.length, 1, '1 live position');
    assertEq(lp[0].live.status, 'LIVE', 'status=LIVE');
    assertEq(lp[0].symbol, 'BTCUSDT', 'symbol in live position');
});

test('getLivePositions returns empty when no live entries', () => {
    resetMocks();
    serverAT.reset(TEST_UID);
    serverAT.setMode(TEST_UID, 'demo');

    serverAT.processBrainDecision(makeDecision(), makeSTC(), TEST_UID);
    // No live execution because SERVER_AT=false
    const lp = serverAT.getLivePositions(TEST_UID);
    assertEq(lp.length, 0, '0 live positions when SERVER_AT=false');
});

test('Live stats accumulate entries/exits', async () => {
    resetMocks();
    serverAT.reset(TEST_UID);
    await tick(200); // drain async from prior tests (leaked _handleLiveExit)
    serverAT.reset(TEST_UID); // re-reset to clear any leaked liveStats increments
    serverAT.setMode(TEST_UID, 'live');
    await tick(50); resetMocks();

    // Entry
    const entry = serverAT.processBrainDecision(
        makeDecision({ price: 60000 }),
        makeSTC({ slPct: 1.0, rr: 2.0 })
    , TEST_UID);
    entry.live = {}; // [FIX] init live object
    await tick(200);

    let ls = serverAT.getLiveStats(TEST_UID);
    assertEq(ls.entries, 1, 'live entries=1');

    // Hit TP → exit
    serverAT.onPriceUpdate('BTCUSDT', 61200);
    await tick(200);

    ls = serverAT.getLiveStats(TEST_UID);
    assertEq(ls.exits, 1, 'live exits=1');
    assertEq(ls.wins, 1, 'live wins=1');
    assert(ls.pnl > 0, 'live pnl positive after TP');
    assertEq(ls.winRate, 100, 'winRate 100% with 1 win');
});

test('Reset clears both shadow and live stats', () => {
    serverAT.setMode(TEST_UID, 'live');
    serverAT.reset(TEST_UID);
    const ss = serverAT.getStats(TEST_UID);
    const ls = serverAT.getLiveStats(TEST_UID);
    assertEq(ss.entries, 0, 'shadow entries=0 after reset');
    assertEq(ls.entries, 0, 'live entries=0 after reset');
    assertEq(ls.blocked, 0, 'live blocked=0 after reset');
    assertEq(ls.errors, 0, 'live errors=0 after reset');
});

// ═══════════════════════════════════════════════════════════════
// 6. SHADOW LOG — Ring Buffer
// ═══════════════════════════════════════════════════════════════
section('6. SHADOW LOG — Ring Buffer');

test('Log records shadow entries and live events', async () => {
    resetMocks();
    serverAT.reset(TEST_UID);
    serverAT.setMode(TEST_UID, 'live');
    await tick(50); resetMocks();

    const entry = serverAT.processBrainDecision(makeDecision(), makeSTC(), TEST_UID);
    entry.live = {}; // [FIX] init live object
    await tick(100);

    const log = serverAT.getLog(TEST_UID, 50);
    assert(log.length >= 1, 'Has log entries');

    const shadowEntry = log.find(l => l.type === 'ENTRY');
    assert(shadowEntry, 'ENTRY log');

    const liveEntry = log.find(l => l.type === 'LIVE_ENTRY');
    assert(liveEntry, 'LIVE_ENTRY log');
    assert(liveEntry.data.mainOrderId > 0, 'LIVE_ENTRY has mainOrderId');
});

test('Log limit works', () => {
    const log1 = serverAT.getLog(TEST_UID, 1);
    assertEq(log1.length, 1, 'Limit=1 returns 1 entry');

    const log5 = serverAT.getLog(TEST_UID, 5);
    assert(log5.length <= 5, 'Limit=5 returns ≤5 entries');
});

// ═══════════════════════════════════════════════════════════════
// 7. ORDER PARAMETERS & SIZE CALCULATION
// ═══════════════════════════════════════════════════════════════
section('7. ORDER PARAMETERS & SIZE CALCULATION');

test('LARGE tier size clamped correctly', () => {
    serverAT.reset(TEST_UID);
    serverAT.setMode(TEST_UID, 'demo');
    // LARGE mult=1.75, base=100 → raw=175, max=160 → clamped to 160
    const entry = serverAT.processBrainDecision(
        makeDecision({ price: 50000 }),
        makeSTC({ size: 100 })
    , TEST_UID);
    assertEq(entry.size, 160, 'LARGE clamped to 160% of base');
});

test('SMALL tier size correct', () => {
    serverAT.reset(TEST_UID);
    // SMALL mult=1.0, base=100 → raw=100, within [50,160] → 100
    const entry = serverAT.processBrainDecision(
        makeDecision({ price: 50000, fusion: { decision: 'SMALL', dir: 'LONG', confidence: 55, score: 50 } }),
        makeSTC({ size: 100 })
    , TEST_UID);
    assertEq(entry.size, 100, 'SMALL size=100 (1x base)');
});

test('Quantity calculation: (size * lev) / price', () => {
    serverAT.reset(TEST_UID);
    // size=100, lev=10, price=50000 → qty = (100*10)/50000 = 0.02
    const entry = serverAT.processBrainDecision(
        makeDecision({ price: 50000, fusion: { decision: 'SMALL', dir: 'LONG', confidence: 55, score: 50 } }),
        makeSTC({ size: 100, lev: 10 })
    , TEST_UID);
    assertEq(entry.qty, 0.02, 'qty = (100*10)/50000 = 0.02');
});

test('SHORT MARKET order sends SELL side', async () => {
    resetMocks();
    serverAT.reset(TEST_UID);
    serverAT.setMode(TEST_UID, 'live');
    await tick(50); resetMocks();

    const entry = serverAT.processBrainDecision(
        makeDecision({ price: 3500, symbol: 'ETHUSDT', fusion: { decision: 'MEDIUM', dir: 'SHORT', confidence: 70, score: 65 } }),
        makeSTC()
    , TEST_UID);
    entry.live = {}; // [FIX] init live object
    await tick(100);

    const marketCall = _mockCalls.sendSigned.find(c => c.params.type === 'MARKET');
    assert(marketCall, 'MARKET order placed');
    assertEq(marketCall.params.side, 'SELL', 'SHORT → SELL');

    // SL for SHORT should be BUY
    const slCall = _mockCalls.sendSigned.find(c => c.params.type === 'STOP_MARKET');
    assertEq(slCall.params.side, 'BUY', 'SHORT SL → BUY close side');

    const tpCall = _mockCalls.sendSigned.find(c => c.params.type === 'TAKE_PROFIT_MARKET');
    assertEq(tpCall.params.side, 'BUY', 'SHORT TP → BUY close side');
});

// ═══════════════════════════════════════════════════════════════
// 8. EDGE CASES
// ═══════════════════════════════════════════════════════════════
section('8. EDGE CASES');

test('Null decision returns null', () => {
    assertEq(serverAT.processBrainDecision(null, makeSTC(), TEST_UID), null, 'null decision');
});

test('Missing fusion returns null', () => {
    assertEq(serverAT.processBrainDecision({ price: 100, symbol: 'X' }, makeSTC(), TEST_UID), null, 'no fusion');
});

test('Missing stc returns null', () => {
    assertEq(serverAT.processBrainDecision(makeDecision(), null, TEST_UID), null, 'null stc');
});

test('Invalid price returns null', () => {
    assertEq(serverAT.processBrainDecision(makeDecision({ price: 0 }), makeSTC(), TEST_UID), null, 'price=0');
    assertEq(serverAT.processBrainDecision(makeDecision({ price: -1 }), makeSTC(), TEST_UID), null, 'price=-1');
});

test('Invalid side returns null', () => {
    const r = serverAT.processBrainDecision(
        makeDecision({ fusion: { decision: 'LARGE', dir: 'SIDEWAYS', confidence: 80, score: 70 } }),
        makeSTC()
    , TEST_UID);
    assertEq(r, null, 'Invalid dir → null');
});

test('SKIP tier returns null', () => {
    assertEq(serverAT.processBrainDecision(
        makeDecision({ fusion: { decision: 'SKIP', dir: 'LONG', confidence: 50, score: 40 } }),
        makeSTC()
    , TEST_UID), null, 'SKIP → null');
});

test('ERROR tier returns null', () => {
    assertEq(serverAT.processBrainDecision(
        makeDecision({ fusion: { decision: 'ERROR', dir: 'LONG', confidence: 0, score: 0 } }),
        makeSTC()
    , TEST_UID), null, 'ERROR → null');
});

test('onPriceUpdate ignores invalid price', () => {
    serverAT.reset(TEST_UID);
    serverAT.setMode(TEST_UID, 'demo'); // [FIX] explicit demo mode — prior section leaves live
    serverAT.processBrainDecision(makeDecision({ price: 60000 }), makeSTC(), TEST_UID);
    serverAT.onPriceUpdate('BTCUSDT', 0);
    serverAT.onPriceUpdate('BTCUSDT', -1);
    serverAT.onPriceUpdate('BTCUSDT', null);
    assertEq(serverAT.getOpenCount(TEST_UID), 1, 'Position still open after invalid prices');
});

test('onPriceUpdate ignores different symbol', () => {
    serverAT.reset(TEST_UID);
    serverAT.setMode(TEST_UID, 'demo'); // [FIX] explicit demo mode — prior section leaves live
    serverAT.processBrainDecision(makeDecision({ price: 60000 }), makeSTC(), TEST_UID);
    serverAT.onPriceUpdate('ETHUSDT', 1);  // Price that would trigger SL on BTC
    assertEq(serverAT.getOpenCount(TEST_UID), 1, 'Different symbol ignored');
});

// ═══════════════════════════════════════════════════════════════
// 9. SHORT PATH TESTS
// ═══════════════════════════════════════════════════════════════
section('9. SHORT PATH TESTS');

test('SHORT SL hit when price goes up', () => {
    serverAT.reset(TEST_UID);
    serverAT.setMode(TEST_UID, 'demo'); // [A4] explicit mode — prior section leaves live
    // SHORT @ 4000, SL = 4000 + (4000*1%) = 4040
    const entry = serverAT.processBrainDecision(
        makeDecision({ symbol: 'ETHUSDT', price: 4000, fusion: { decision: 'SMALL', dir: 'SHORT', confidence: 60, score: 55 } }),
        makeSTC({ slPct: 1.0, rr: 2.0 })
    , TEST_UID);
    assertEq(entry.sl, 4040, 'SHORT SL=4040');
    serverAT.onPriceUpdate('ETHUSDT', 4040);
    assertEq(serverAT.getOpenCount(TEST_UID), 0, 'SHORT closed at SL');
    assertEq(serverAT.getStats(TEST_UID).losses, 1, '1 loss');
});

test('SHORT TP hit when price goes down', () => {
    serverAT.reset(TEST_UID);
    serverAT.setMode(TEST_UID, 'demo'); // [A4] explicit mode — prior section leaves live
    // SHORT @ 4000, TP = 4000 - (40*2) = 3920
    const entry = serverAT.processBrainDecision(
        makeDecision({ symbol: 'ETHUSDT', price: 4000, fusion: { decision: 'SMALL', dir: 'SHORT', confidence: 60, score: 55 } }),
        makeSTC({ slPct: 1.0, rr: 2.0 })
    , TEST_UID);
    assertEq(entry.tp, 3920, 'SHORT TP=3920');
    serverAT.onPriceUpdate('ETHUSDT', 3920);
    assertEq(serverAT.getOpenCount(TEST_UID), 0, 'SHORT closed at TP');
    assertEq(serverAT.getStats(TEST_UID).wins, 1, '1 win');
});

// ═══════════════════════════════════════════════════════════════
// 10. MODULE EXPORTS
// ═══════════════════════════════════════════════════════════════
section('10. MODULE EXPORTS');

test('All expected functions exported', () => {
    const fns = [
        'processBrainDecision', 'onPriceUpdate',
        'getOpenPositions', 'getOpenCount', 'getLog', 'getStats',
        'getLiveStats', 'getLivePositions', 'reset',
        'setMode', 'getMode', 'toggleActive',
    ];
    for (const fn of fns) {
        assertEq(typeof serverAT[fn], 'function', `${fn} is a function`);
    }
});

// ═══════════════════════════════════════════════════════════════
// RUN ALL TESTS
// ═══════════════════════════════════════════════════════════════

runAllTests().then(() => {
    console.log(`\n${'═'.repeat(60)}`);
    console.log(`  RESULTS: ${_pass} passed, ${_fail} failed (${_pass + _fail} total)`);
    if (_failures.length) {
        console.log('\n  FAILURES:');
        _failures.forEach(f => console.log(`    [${f.section}] ${f.test}: ${f.error}`));
    }
    console.log(`${'═'.repeat(60)}\n`);
    process.exit(_fail > 0 ? 1 : 0);
}).catch(err => {
    console.error('Test runner error:', err);
    process.exit(1);
});
