/**
 * ARES Runtime Verification — Server-side + Client-side tests
 * Run: node test-ares-runtime.js
 *
 * Tests:
 * 1. Risk Guard — separate AT/ARES daily loss tracking
 * 2. Risk Guard — emergency kill switch
 * 3. Risk Guard — order validation per owner
 * 4. Server syntax check — all modules load cleanly
 *
 * For client-side tests (wallet, DSL, journal, reconciliation),
 * paste the BROWSER TEST block into the browser console.
 */
'use strict';

let passed = 0;
let failed = 0;

function assert(cond, msg) {
    if (cond) { passed++; console.log('  ✅ ' + msg); }
    else { failed++; console.error('  ❌ FAIL: ' + msg); }
}

// ── 1. Risk Guard Module Tests ──────────────────────────────────────────
console.log('\n═══ 1. RISK GUARD — Separate AT/ARES Tracking ═══');

// Reset module cache to get fresh state
delete require.cache[require.resolve('./server/services/riskGuard')];
delete require.cache[require.resolve('./server/config')];

// Force config to test-friendly values BEFORE loading riskGuard
const config = require('./server/config');
config.tradingEnabled = true;
config.binance.apiKey = 'TEST_KEY';
config.binance.apiSecret = 'TEST_SECRET';
config.risk.maxLeverage = 10;
config.risk.maxPositionUsdt = 100;
config.risk.dailyLossLimitPct = 5;

const rg = require('./server/services/riskGuard');

// Basic order should pass for both AT and ARES
const okAT = rg.validateOrder({ symbol: 'BTCUSDT', side: 'BUY', type: 'MARKET', quantity: 0.001, price: 0, leverage: 5 }, 'AT');
assert(okAT.ok === true, 'AT order passes validation');

const okARES = rg.validateOrder({ symbol: 'BTCUSDT', side: 'BUY', type: 'MARKET', quantity: 0.001, price: 0, leverage: 5 }, 'ARES');
assert(okARES.ok === true, 'ARES order passes validation');

// High leverage should fail
const highLev = rg.validateOrder({ symbol: 'BTCUSDT', side: 'BUY', type: 'MARKET', quantity: 0.001, price: 0, leverage: 200 }, 'ARES');
assert(highLev.ok === false, 'High leverage (200x) blocked');
assert(highLev.reason.includes('Leverage'), 'Reason mentions leverage');

// LIMIT order with excessive notional should fail
const bigLimit = rg.validateOrder({ symbol: 'BTCUSDT', side: 'BUY', type: 'LIMIT', quantity: 10, price: 100000, leverage: 5 }, 'AT');
assert(bigLimit.ok === false, 'Large LIMIT notional blocked');

// MARKET order with price=0 should NOT be blocked by notional
const mktOrder = rg.validateOrder({ symbol: 'BTCUSDT', side: 'BUY', type: 'MARKET', quantity: 10, price: 0, leverage: 5 }, 'AT');
assert(mktOrder.ok === true, 'MARKET order not blocked by notional (price=0)');

console.log('\n═══ 2. RISK GUARD — Independent Daily Loss Tracking ═══');

// Record losses for ARES — should NOT affect AT
rg.recordClosedPnL(-10, 'ARES');
rg.recordClosedPnL(-10, 'ARES');

const aresState = rg.getDailyState('ARES');
const atState = rg.getDailyState('AT');
assert(aresState.realizedPnL === -20, 'ARES daily PnL = -20 after 2× $-10 losses');
assert(atState.realizedPnL === 0, 'AT daily PnL = 0 (unaffected by ARES losses)');

// Record losses for AT — confirm independent
rg.recordClosedPnL(-5, 'AT');
const atState2 = rg.getDailyState('AT');
const aresState2 = rg.getDailyState('ARES');
assert(atState2.realizedPnL === -5, 'AT daily PnL = -5 after $-5 loss');
assert(aresState2.realizedPnL === -20, 'ARES daily PnL still -20 (unaffected by AT)');

console.log('\n═══ 3. RISK GUARD — Emergency Kill Switch ═══');

// Fresh riskGuard for this test group (reset daily state)
delete require.cache[require.resolve('./server/services/riskGuard')];
const rg3 = require('./server/services/riskGuard');

// Emergency kill should block ALL orders
rg3.setEmergencyKill(true);
const killedAT = rg3.validateOrder({ symbol: 'BTCUSDT', side: 'BUY', type: 'MARKET', quantity: 0.001, price: 0, leverage: 5 }, 'AT');
const killedARES = rg3.validateOrder({ symbol: 'BTCUSDT', side: 'BUY', type: 'MARKET', quantity: 0.001, price: 0, leverage: 5 }, 'ARES');
assert(killedAT.ok === false, 'Emergency kill blocks AT');
assert(killedARES.ok === false, 'Emergency kill blocks ARES');
assert(killedAT.reason.includes('Emergency'), 'Kill reason mentions emergency');

// Deactivate kill switch
rg3.setEmergencyKill(false);
const unblockedAT = rg3.validateOrder({ symbol: 'BTCUSDT', side: 'BUY', type: 'MARKET', quantity: 0.001, price: 0, leverage: 5 }, 'AT');
assert(unblockedAT.ok === true, 'AT passes after emergency kill deactivated');

console.log('\n═══ 4. RISK GUARD — STOP_MARKET Not Blocked By Notional ═══');

// Uses rg3 which has clean daily state
const stopOrder = rg3.validateOrder({ symbol: 'BTCUSDT', side: 'SELL', type: 'STOP_MARKET', quantity: 10, price: 0, leverage: 5 }, 'ARES');
assert(stopOrder.ok === true, 'STOP_MARKET not blocked by notional check');

const tpOrder = rg3.validateOrder({ symbol: 'BTCUSDT', side: 'SELL', type: 'TAKE_PROFIT_MARKET', quantity: 10, price: 0, leverage: 5 }, 'ARES');
assert(tpOrder.ok === true, 'TAKE_PROFIT_MARKET not blocked by notional check');

console.log('\n═══ 5. SERVER MODULES — Load Clean ═══');

try {
    require('./server/config');
    assert(true, 'server/config.js loads');
} catch (e) { assert(false, 'server/config.js loads: ' + e.message); }

try {
    require('./server/middleware/validate');
    assert(true, 'server/middleware/validate.js loads');
} catch (e) { assert(false, 'server/middleware/validate.js loads: ' + e.message); }

try {
    require('./server/middleware/rateLimit');
    assert(true, 'server/middleware/rateLimit.js loads');
} catch (e) { assert(false, 'server/middleware/rateLimit.js loads: ' + e.message); }

try {
    require('./server/services/binanceSigner');
    assert(true, 'server/services/binanceSigner.js loads');
} catch (e) { assert(false, 'server/services/binanceSigner.js loads: ' + e.message); }

try {
    require('./server/routes/trading');
    assert(true, 'server/routes/trading.js loads');
} catch (e) { assert(false, 'server/routes/trading.js loads: ' + e.message); }

console.log('\n═══ 6. VALIDATE MIDDLEWARE — stopPrice Required for STOP_MARKET ═══');

delete require.cache[require.resolve('./server/middleware/validate')];
const { validateOrderBody } = require('./server/middleware/validate');

// Simulate express req/res/next
function mockReq(body) {
    return {
        body: body,
        headers: { 'content-type': 'application/json' },
    };
}
function mockRes() {
    let _status = 200, _json = null;
    return {
        status(c) { _status = c; return this; },
        json(d) { _json = d; return this; },
        get _status() { return _status; },
        get _json() { return _json; },
    };
}

// STOP_MARKET without stopPrice → should fail
const req1 = mockReq({ symbol: 'BTCUSDT', side: 'BUY', type: 'STOP_MARKET', quantity: 0.001 });
const res1 = mockRes();
let nextCalled1 = false;
validateOrderBody(req1, res1, () => { nextCalled1 = true; });
assert(!nextCalled1, 'STOP_MARKET without stopPrice → blocked (next not called)');

// STOP_MARKET with stopPrice → should pass
const req2 = mockReq({ symbol: 'BTCUSDT', side: 'BUY', type: 'STOP_MARKET', quantity: 0.001, stopPrice: 50000 });
const res2 = mockRes();
let nextCalled2 = false;
validateOrderBody(req2, res2, () => { nextCalled2 = true; });
assert(nextCalled2, 'STOP_MARKET with stopPrice → passes');

// ── SUMMARY ─────────────────────────────────────────────────────────────
console.log('\n══════════════════════════════════════════════════');
console.log(`  SERVER TESTS: ${passed} passed, ${failed} failed`);
console.log('══════════════════════════════════════════════════');

if (failed > 0) process.exit(1);

// ── BROWSER TEST SCRIPT ─────────────────────────────────────────────────
console.log(`
╔══════════════════════════════════════════════════════════════════╗
║  BROWSER TESTS — Paste this in Chrome DevTools console:        ║
╚══════════════════════════════════════════════════════════════════╝

(function ARES_BROWSER_TEST() {
  let p = 0, f = 0;
  function ok(c, m) { if (c) { p++; console.log('✅ ' + m); } else { f++; console.error('❌ ' + m); } }

  console.log('\\n═══ WALLET TEST ═══');
  // Fund wallet with 100 USDT
  if (ARES.wallet.balance < 1) ARES.wallet.fund(100);
  ok(ARES.wallet.balance >= 100, 'Wallet has ≥$100 balance: $' + ARES.wallet.balance.toFixed(2));
  ok(ARES.wallet.available >= 100, 'Wallet available: $' + ARES.wallet.available.toFixed(2));
  ok(ARES.wallet.locked === 0, 'No locked funds');

  // Reserve + release
  ARES.wallet.reserve(20);
  ok(ARES.wallet.locked === 20, 'Reserved $20, locked=' + ARES.wallet.locked);
  ok(ARES.wallet.available === ARES.wallet.balance - 20, 'Available reduced by $20');
  ARES.wallet.release(20);
  ok(ARES.wallet.locked === 0, 'Released $20, locked=0');

  // Fees
  const fees = ARES.wallet.roundTripFees(100);
  ok(fees > 0 && fees < 1, 'Round-trip fees for $100 notional: $' + fees.toFixed(4));

  console.log('\\n═══ POSITIONS TEST ═══');
  const pos = ARES.positions.open({
    side: 'LONG', leverage: 10, notional: 50,
    entryPrice: 60000, confidence: 75, policy: 'BALANCED',
    reason: 'test', stakeVirtual: 5
  });
  ok(pos && pos.id, 'Opened test position: ' + pos.id);
  ok(pos.symbol === 'BTCUSDT', 'Symbol is BTCUSDT');
  ok(pos.owner === 'ARES', 'Owner is ARES');
  ok(pos.status === 'OPEN', 'Status is OPEN');
  ok(ARES.positions.getOpen().length >= 1, 'getOpen() returns ≥1 position');

  // Update prices
  ARES.positions.updatePrices(61000);
  ok(pos.uPnL > 0, 'uPnL positive when price rises: $' + pos.uPnL.toFixed(2));
  ok(pos.uPnLPct > 0, 'uPnLPct positive: ' + pos.uPnLPct.toFixed(2) + '%');

  // Close position
  const result = ARES.positions.closePosition(pos.id);
  ok(result, 'Position closed successfully');
  ok(result.netPnL !== undefined, 'netPnL computed: $' + result.netPnL.toFixed(2));
  ok(ARES.positions.getOpen().filter(p => p.id === pos.id).length === 0, 'Position removed from open list');

  console.log('\\n═══ JOURNAL TEST ═══');
  ok(typeof ARES_JOURNAL !== 'undefined', 'ARES_JOURNAL exists');
  ok(typeof ARES_JOURNAL.recordOpen === 'function', 'recordOpen available');
  ok(typeof ARES_JOURNAL.recordClose === 'function', 'recordClose available');

  // Test journal entry
  const fakeDecision = {
    side: 'LONG', confidence: 80,
    reasons: ['test reason'],
    sources: { regime: 'trend', session: 'LONDON', entryScore: 70, atrPct: 1.2, bullCount: 5, bearCount: 2, balance: 100, openPositions: 0, state: 'DETERMINED' }
  };
  const fakePos = { id: 'TEST_POS_1', leverage: 10, notional: 50 };
  ARES_JOURNAL.recordOpen(fakeDecision, fakePos, 60000);
  const all = ARES_JOURNAL.getAll();
  const entry = all.find(e => e.id === 'TEST_POS_1');
  ok(entry, 'Journal entry created for TEST_POS_1');
  ok(entry.inputs.regime === 'trend', 'Journal captures regime');
  ok(entry.inputs.session === 'LONDON', 'Journal captures session');
  ok(entry.inputs.entryScore === 70, 'Journal captures entryScore');
  ok(entry.closeTs === null, 'closeTs is null (open trade)');

  ARES_JOURNAL.recordClose('TEST_POS_1', { closePrice: 61000, netPnl: 5.2, closeReason: 'test_close' });
  ok(entry.closeTs !== null, 'closeTs now set');
  ok(entry.netPnl === 5.2, 'netPnl recorded: $' + entry.netPnl);
  ok(entry.outcome === 'WIN', 'Outcome is WIN');
  ok(entry.closeReason === 'test_close', 'Close reason logged');
  ok(entry.durationMs > 0, 'Duration computed: ' + entry.durationMs + 'ms');

  console.log('\\n═══ DSL TRAILING LOGIC TEST ═══');
  ok(typeof ARES_MONITOR !== 'undefined', 'ARES_MONITOR exists');
  ok(typeof ARES_MONITOR.check === 'function', 'ARES_MONITOR.check available');

  console.log('\\n═══ RECONCILIATION TEST ═══');
  ok(typeof ARES.reconcile === 'function', 'ARES.reconcile() exposed');

  console.log('\\n═══ RISK PNL ENDPOINT TEST ═══');
  fetch('/api/risk/pnl', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pnl: -2.5, owner: 'ARES' })
  })
  .then(r => r.json())
  .then(d => {
    ok(d.ok === true, '/api/risk/pnl → ok:true');
    ok(d.owner === 'ARES', '/api/risk/pnl → owner:ARES');
    console.log('\\n══════════════════════════════════');
    console.log('  BROWSER TESTS: ' + p + ' passed, ' + f + ' failed');
    console.log('══════════════════════════════════');
  })
  .catch(e => { console.error('❌ /api/risk/pnl failed:', e.message); });
})();
`);
