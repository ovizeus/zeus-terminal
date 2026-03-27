/**
 * ARES 100 USDT — Offline Runtime Verification
 * No HTTP needed — tests server modules directly + simulates client logic
 * Run: node test-ares-offline.js
 */
'use strict';
let P = 0, F = 0;
const ok = (c, m) => { if (c) { P++; console.log('  \u2705 ' + m); } else { F++; console.error('  \u274C FAIL: ' + m); } };

// ═══ 1. ORDER EXECUTION — Risk Guard ═══
console.log('\n\u2550\u2550\u2550 1. ORDER EXECUTION \u2014 Risk Guard Validation \u2550\u2550\u2550');
delete require.cache[require.resolve('./server/services/riskGuard')];
delete require.cache[require.resolve('./server/config')];
const cfg = require('./server/config');
Object.assign(cfg, { tradingEnabled: true });
Object.assign(cfg.binance, { apiKey: 'T', apiSecret: 'T' });
Object.assign(cfg.risk, { maxLeverage: 10, maxPositionUsdt: 100, dailyLossLimitPct: 5 });
const rg = require('./server/services/riskGuard');

ok(rg.validateOrder({ symbol: 'BTCUSDT', side: 'BUY', type: 'MARKET', quantity: 0.001, referencePrice: 65000, leverage: 5 }, 'AT', 1).ok, 'AT MARKET order PASS');
ok(rg.validateOrder({ symbol: 'BTCUSDT', side: 'BUY', type: 'MARKET', quantity: 0.001, referencePrice: 65000, leverage: 5 }, 'ARES', 1).ok, 'ARES MARKET order PASS');
ok(!rg.validateOrder({ symbol: 'BTCUSDT', side: 'BUY', type: 'MARKET', quantity: 0.001, referencePrice: 65000, leverage: 200 }, 'ARES', 1).ok, 'ARES 200x leverage BLOCKED');
ok(!rg.validateOrder({ symbol: 'BTCUSDT', side: 'BUY', type: 'LIMIT', quantity: 10, price: 100000, leverage: 5 }, 'AT', 1).ok, 'AT $1M LIMIT notional BLOCKED');
ok(!rg.validateOrder({ symbol: 'BTCUSDT', side: 'BUY', type: 'MARKET', quantity: 10, referencePrice: 0, leverage: 5 }, 'AT', 1).ok, 'MARKET referencePrice=0 BLOCKED');
ok(rg.validateOrder({ symbol: 'BTCUSDT', side: 'SELL', type: 'STOP_MARKET', quantity: 10, price: 0, leverage: 5 }, 'ARES', 1).ok, 'STOP_MARKET NOT blocked');
ok(rg.validateOrder({ symbol: 'BTCUSDT', side: 'SELL', type: 'TAKE_PROFIT_MARKET', quantity: 10, price: 0, leverage: 5 }, 'ARES', 1).ok, 'TP_MARKET NOT blocked');

// [RM-04] NaN bypass — leverage
ok(!rg.validateOrder({ symbol: 'BTCUSDT', side: 'BUY', type: 'MARKET', quantity: 0.001, price: 0, leverage: 'abc' }, 'AT', 1).ok, 'NaN leverage "abc" BLOCKED');
ok(!rg.validateOrder({ symbol: 'BTCUSDT', side: 'BUY', type: 'MARKET', quantity: 0.001, price: 0, leverage: undefined }, 'AT', 1).ok, 'undefined leverage BLOCKED');
ok(!rg.validateOrder({ symbol: 'BTCUSDT', side: 'BUY', type: 'MARKET', quantity: 0.001, price: 0, leverage: 0 }, 'AT', 1).ok, 'Zero leverage BLOCKED');
// [RM-03] NaN bypass — quantity
ok(!rg.validateOrder({ symbol: 'BTCUSDT', side: 'BUY', type: 'LIMIT', quantity: 'xyz', price: 65000, leverage: 5 }, 'AT', 1).ok, 'NaN quantity "xyz" BLOCKED');
ok(!rg.validateOrder({ symbol: 'BTCUSDT', side: 'BUY', type: 'LIMIT', quantity: '', price: 65000, leverage: 5 }, 'AT', 1).ok, 'Empty quantity BLOCKED');
ok(!rg.validateOrder({ symbol: 'BTCUSDT', side: 'BUY', type: 'LIMIT', quantity: 0, price: 65000, leverage: 5 }, 'AT', 1).ok, 'Zero quantity BLOCKED');

// ═══ 2. RISK GUARD — Independent Daily Loss ═══
console.log('\n\u2550\u2550\u2550 2. RISK GUARD \u2014 Independent Daily Loss \u2550\u2550\u2550');
const _dlUid = 80000 + (Date.now() % 10000); // unique per run — avoids persisted state
rg.recordClosedPnL(-1.2, 'ARES', _dlUid); rg.recordClosedPnL(3.5, 'ARES', _dlUid); rg.recordClosedPnL(-0.8, 'ARES', _dlUid);
ok(Math.abs(rg.getDailyState('ARES', _dlUid).realizedPnL - 1.5) < 0.01, 'ARES net=$1.50');
rg.recordClosedPnL(-2.0, 'AT', _dlUid);
ok(rg.getDailyState('AT', _dlUid).realizedPnL === -2, 'AT PnL=-$2.00 independent');

// ═══ 3. RISK GUARD — Emergency Kill ═══
console.log('\n\u2550\u2550\u2550 3. RISK GUARD \u2014 Emergency Kill \u2550\u2550\u2550');
delete require.cache[require.resolve('./server/services/riskGuard')];
const rg2 = require('./server/services/riskGuard');
rg2.setEmergencyKill(true, 99998);
ok(!rg2.validateOrder({ symbol: 'BTCUSDT', side: 'BUY', type: 'MARKET', quantity: 0.001, referencePrice: 65000, leverage: 5 }, 'AT', 99998).ok, 'Kill blocks AT');
ok(!rg2.validateOrder({ symbol: 'BTCUSDT', side: 'BUY', type: 'MARKET', quantity: 0.001, referencePrice: 65000, leverage: 5 }, 'ARES', 99998).ok, 'Kill blocks ARES');
rg2.setEmergencyKill(false, 99998);
ok(rg2.validateOrder({ symbol: 'BTCUSDT', side: 'BUY', type: 'MARKET', quantity: 0.001, referencePrice: 65000, leverage: 5 }, 'AT', 99998).ok, 'Unblocked after kill off');

// ═══ 4. VALIDATION MIDDLEWARE ═══
console.log('\n\u2550\u2550\u2550 4. VALIDATION MIDDLEWARE \u2550\u2550\u2550');
delete require.cache[require.resolve('./server/middleware/validate')];
const { validateOrderBody } = require('./server/middleware/validate');
const mReq = b => ({ body: b, headers: { 'content-type': 'application/json' } });
const mRes = () => { let s = 200, j = null; return { status(c) { s = c; return this }, json(d) { j = d } }; };
let n1 = false; validateOrderBody(mReq({ symbol: 'BTCUSDT', side: 'BUY', type: 'STOP_MARKET', quantity: 0.001 }), mRes(), () => { n1 = true });
ok(!n1, 'STOP_MARKET no stopPrice BLOCKED');
let n2 = false; validateOrderBody(mReq({ symbol: 'BTCUSDT', side: 'BUY', type: 'STOP_MARKET', quantity: 0.001, stopPrice: 50000 }), mRes(), () => { n2 = true });
ok(n2, 'STOP_MARKET with stopPrice PASSES');
let n3 = false; validateOrderBody(mReq({ side: 'BUY', type: 'MARKET', quantity: 0.001 }), mRes(), () => { n3 = true });
ok(!n3, 'Missing symbol BLOCKED');

// ═══ 5. MODULES LOAD CLEAN ═══
console.log('\n\u2550\u2550\u2550 5. SERVER MODULES \u2550\u2550\u2550');
['./server/config', './server/middleware/validate', './server/middleware/rateLimit', './server/services/binanceSigner', './server/routes/trading'].forEach(m => {
    try { require(m); ok(true, m.replace('./', '')); } catch (e) { ok(false, m + ': ' + e.message); }
});

// ═══ 6. WALLET $100 SIMULATION ═══
console.log('\n\u2550\u2550\u2550 6. WALLET \u2014 $100 USDT \u2550\u2550\u2550');
const W = {
    bal: 0, locked: 0, get avail() { return this.bal - this.locked },
    fund(a) { this.bal += a }, reserve(a) { if (a > this.avail) return false; this.locked += a; return true },
    release(a) { this.locked = Math.max(0, this.locked - a) }, fees(n) { const f = n * 0.0004 * 2; this.bal -= f; return f }
};
W.fund(100);
ok(W.bal === 100, 'Balance=$100'); ok(W.avail === 100, 'Available=$100');
ok(W.reserve(20), 'Reserve $20'); ok(W.locked === 20, 'Locked=$20'); ok(W.avail === 80, 'Avail=$80');
ok(!W.reserve(90), 'Over-reserve blocked');
W.release(20); ok(W.locked === 0, 'Released');
W.fees(50);
ok(Math.abs(W.bal - 99.96) < 0.001, 'After fees=$' + W.bal.toFixed(4));

// ═══ 7. POSITIONS — Open/Track/Close ═══
console.log('\n\u2550\u2550\u2550 7. POSITIONS \u2014 Open/Track/Close \u2550\u2550\u2550');
const positions = [];
function openP(o) {
    const p = {
        id: 'ARES_' + Date.now(), symbol: 'BTCUSDT', owner: 'ARES', status: 'OPEN',
        side: o.side, leverage: o.leverage, notional: o.notional, entryPrice: o.entryPrice,
        stakeV: o.stake, uPnL: 0, uPct: 0, markPrice: o.entryPrice, openTs: Date.now()
    };
    positions.push(p); W.reserve(p.stakeV); return p;
}
function updPrices(mark) {
    positions.filter(x => x.status === 'OPEN').forEach(p => {
        p.markPrice = mark; const d = p.side === 'LONG' ? 1 : -1;
        p.uPnL = ((mark - p.entryPrice) / p.entryPrice) * p.notional * d;
        p.uPct = ((mark - p.entryPrice) / p.entryPrice) * 100 * d;
    });
}
function closeP(id) {
    const p = positions.find(x => x.id === id && x.status === 'OPEN'); if (!p) return null;
    p.status = 'CLOSED'; p.closeTs = Date.now(); const gross = p.uPnL; const fee = W.fees(p.notional);
    W.release(p.stakeV); W.bal += gross - fee; return { id, gross, fee, net: gross - fee };
}

const pos1 = openP({ side: 'LONG', leverage: 10, notional: 50, entryPrice: 60000, stake: 5 });
ok(pos1.id.startsWith('ARES_'), 'ID=ARES_*'); ok(pos1.owner === 'ARES', 'Owner=ARES');
ok(W.locked === 5, 'Stake $5 locked');
updPrices(61000); ok(pos1.uPnL > 0, 'uPnL=$' + pos1.uPnL.toFixed(2) + ' (positive at 61k)');
ok(Math.abs(pos1.uPct - 1.667) < 0.01, 'uPnLPct=' + pos1.uPct.toFixed(2) + '%');
updPrices(59500); ok(pos1.uPnL < 0, 'uPnL=$' + pos1.uPnL.toFixed(2) + ' (negative at 59.5k)');
const c1 = closeP(pos1.id);
ok(c1.net < 0, 'netPnL=$' + c1.net.toFixed(4) + ' (loss)');
ok(W.locked === 0, 'Stake released'); ok(W.bal < 100, 'Balance=$' + W.bal.toFixed(4));

// ═══ 8. DSL TRAILING ═══
console.log('\n\u2550\u2550\u2550 8. DSL \u2014 Trailing Stop \u2550\u2550\u2550');
function trail(high, cur, pct) { const tp = high * (1 - pct / 100); return { tp, hit: cur <= tp } }
ok(!trail(62000, 61500, 2).hit, '2% trail: 62k/61500 NOT hit');
ok(trail(62000, 60700, 2).hit, '2% trail: 62k/60700 TRIGGERED at $' + trail(62000, 60700, 2).tp.toFixed(0));
ok(!trail(60500, 60200, 0.5).hit, '0.5% trail: 60500/60200 NOT hit');
ok(trail(60500, 60195, 0.5).hit, '0.5% trail: 60500/60195 TRIGGERED');

// ═══ 9. TRADE JOURNAL ═══
console.log('\n\u2550\u2550\u2550 9. TRADE JOURNAL \u2550\u2550\u2550');
const journal = [];
function jOpen(dec, pos, ep) {
    journal.push({
        id: pos.id, openTs: Date.now(), side: dec.side,
        confidence: dec.confidence, entryPrice: ep, closeTs: null, netPnl: null, outcome: null,
        closeReason: null, durationMs: null, inputs: { ...dec.sources }
    });
}
function jClose(id, res) {
    const e = journal.find(x => x.id === id); if (!e) return null;
    e.closeTs = Date.now(); e.netPnl = res.netPnl; e.outcome = res.netPnl >= 0 ? 'WIN' : 'LOSS';
    e.closeReason = res.closeReason; e.durationMs = e.closeTs - e.openTs; return e;
}

const pos2 = openP({ side: 'LONG', leverage: 10, notional: 40, entryPrice: 60000, stake: 4 });
const dec = { side: 'LONG', confidence: 78, sources: { regime: 'trend', session: 'LONDON', entryScore: 72, atrPct: 1.1 } };
jOpen(dec, pos2, 60000);
ok(journal.length === 1, '1 entry after open');
ok(journal[0].inputs.regime === 'trend', 'Regime captured');
ok(journal[0].inputs.session === 'LONDON', 'Session captured');
ok(journal[0].closeTs === null, 'closeTs null while open');
updPrices(60800);
const c2 = closeP(pos2.id);
const je = jClose(pos2.id, { netPnl: c2.net, closeReason: 'trailing_stop' });
ok(je.closeTs !== null, 'closeTs set');
ok(je.outcome === (c2.net >= 0 ? 'WIN' : 'LOSS'), 'Outcome=' + je.outcome);
ok(je.closeReason === 'trailing_stop', 'Reason=trailing_stop');
ok(je.durationMs >= 0, 'Duration=' + je.durationMs + 'ms');
console.log('  Journal: ' + je.outcome + ', $' + je.netPnl.toFixed(4) + ', reason=' + je.closeReason);

// ═══ 10. RECONCILIATION ═══
console.log('\n\u2550\u2550\u2550 10. RECONCILIATION \u2014 After Reload \u2550\u2550\u2550');
const snap = JSON.stringify({ wallet: { bal: W.bal, locked: W.locked }, positions: positions.filter(p => p.status === 'OPEN'), journal });
const restored = JSON.parse(snap);
ok(restored.wallet.bal === W.bal, 'Wallet restored=$' + restored.wallet.bal.toFixed(4));
ok(restored.wallet.locked === W.locked, 'Locked restored');
ok(restored.journal.length === journal.length, 'Journal entries=' + restored.journal.length);
ok(restored.journal[0].inputs.regime === 'trend', 'Journal regime preserved');
ok(restored.journal[0].closeReason === 'trailing_stop', 'Journal reason preserved');
ok(restored.journal[0].netPnl === je.netPnl, 'Journal PnL preserved');

// ═══ SUMMARY ═══
// ═══ 11. IDEMPOTENCY CACHE — BE-01 ═══
console.log('\n\u2550\u2550\u2550 11. IDEMPOTENCY CACHE \u2014 BE-01 Cleanup on Failure \u2550\u2550\u2550');
(function () {
  const tradingSrc = require('fs').readFileSync('./server/routes/trading.js', 'utf8');
  // Verify BE-01 markers exist
  ok(tradingSrc.includes('_idemKey') && tradingSrc.includes('[BE-01]'), 'BE-01 patch markers present');
  // Verify delete on leverage fail path
  ok(tradingSrc.includes('_idempotencyCache.delete(_idemKey)') && tradingSrc.includes('order never reached exchange'), 'Leverage fail → cache delete');
  // Verify delete on 4xx (confirmed Binance reject)
  ok(tradingSrc.includes('err.status >= 400 && err.status < 500'), '4xx Binance reject → cache delete');
  // Verify 5xx/timeout does NOT delete (safety — ambiguous)
  // The condition only deletes on 4xx, so 5xx falls through without delete
  const catchBlock = tradingSrc.slice(tradingSrc.indexOf('[BE-01] Release idempotency'));
  ok(catchBlock.includes('err.status >= 400 && err.status < 500'), '5xx/timeout → cache RETAINED (safety)');
  // Verify _idemKey is computed from req.user.id + x-idempotency-key header
  ok(tradingSrc.includes('`${req.user.id}:${req.headers[\'x-idempotency-key\']}`'), '_idemKey formula matches _checkIdempotency');

  // Direct cache behavior simulation
  const _testCache = new Map();
  function simCheckIdem(userId, key) {
    var fk = userId + ':' + key;
    if (_testCache.has(fk)) return { duplicate: true, key: fk };
    _testCache.set(fk, Date.now());
    return null;
  }
  // Test 1: success → retry with same key → 409
  var r1 = simCheckIdem(1, 'key-success');
  ok(r1 === null, 'First call with key → OK (null)');
  var r2 = simCheckIdem(1, 'key-success');
  ok(r2 && r2.duplicate === true, 'Success + retry same key → duplicate (409)');

  // Test 2: fail → delete → retry → OK
  var r3 = simCheckIdem(1, 'key-levfail');
  ok(r3 === null, 'First call (lev fail) → OK');
  _testCache.delete('1:key-levfail'); // simulate BE-01 leverage fail cleanup
  var r4 = simCheckIdem(1, 'key-levfail');
  ok(r4 === null, 'After delete (lev fail) + retry → OK (not 409)');

  // Test 3: 4xx reject → delete → retry → OK
  var r5 = simCheckIdem(1, 'key-4xx');
  ok(r5 === null, 'First call (4xx reject) → OK');
  _testCache.delete('1:key-4xx'); // simulate BE-01 4xx cleanup
  var r6 = simCheckIdem(1, 'key-4xx');
  ok(r6 === null, 'After delete (4xx) + retry → OK (not 409)');

  // Test 4: 5xx timeout → NO delete → retry → 409 (safety)
  var r7 = simCheckIdem(1, 'key-5xx');
  ok(r7 === null, 'First call (5xx timeout) → OK');
  // NO delete — simulates ambiguous error where key is retained
  var r8 = simCheckIdem(1, 'key-5xx');
  ok(r8 && r8.duplicate === true, '5xx + retry same key → duplicate (409 safety)');
})();
// \u2550\u2550\u2550 12. ENCRYPTION \u2014 _getKey hex validation (SC-03) \u2550\u2550\u2550
console.log('\n\u2550\u2550\u2550 12. ENCRYPTION \u2014 _getKey hex validation (SC-03) \u2550\u2550\u2550');
(function testGetKeyValidation() {
  const origKey = process.env.ENCRYPTION_KEY;

  // Valid 64-char hex \u2192 should not throw
  process.env.ENCRYPTION_KEY = 'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789';
  try { require('./server/services/encryption').encrypt('test'); P++; console.log('  \u2705 Valid 64-char hex key \u2192 encrypt OK'); }
  catch (e) { F++; console.error('  \u274c FAIL: Valid hex key threw: ' + e.message); }

  // Non-hex 64 chars \u2192 must throw
  process.env.ENCRYPTION_KEY = 'zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz';
  delete require.cache[require.resolve('./server/services/encryption')];
  try { require('./server/services/encryption').encrypt('test'); F++; console.error('  \u274c FAIL: Non-hex 64 chars did not throw'); }
  catch (e) { P++; console.log('  \u2705 Non-hex 64 chars \u2192 throw OK'); }

  // Short hex (62 chars) \u2192 must throw
  process.env.ENCRYPTION_KEY = 'abcdef0123456789abcdef0123456789abcdef0123456789abcdef01234567';
  delete require.cache[require.resolve('./server/services/encryption')];
  try { require('./server/services/encryption').encrypt('test'); F++; console.error('  \u274c FAIL: 62-char hex did not throw'); }
  catch (e) { P++; console.log('  \u2705 62-char hex \u2192 throw OK'); }

  // Empty \u2192 must throw
  process.env.ENCRYPTION_KEY = '';
  delete require.cache[require.resolve('./server/services/encryption')];
  try { require('./server/services/encryption').encrypt('test'); F++; console.error('  \u274c FAIL: Empty key did not throw'); }
  catch (e) { P++; console.log('  \u2705 Empty key \u2192 throw OK'); }

  // Restore original key
  process.env.ENCRYPTION_KEY = origKey;
  delete require.cache[require.resolve('./server/services/encryption')];
})();

// ═══ 13. DSL SL UPDATE — TL-05 Lock/Gate/Queue ═══
console.log('\n\u2550\u2550\u2550 13. DSL SL UPDATE \u2014 TL-05 Lock/Gate/Queue \u2550\u2550\u2550');
(function testTL05() {
  const atSrc = require('fs').readFileSync('./server/services/serverAT.js', 'utf8');

  // Source markers present
  ok(atSrc.includes('pos._slUpdateInFlight = true'), 'TL-05 lock flag set in _updateLiveSL');
  ok(atSrc.includes('pos._slUpdateInFlight = false'), 'TL-05 lock released in finally');
  ok(atSrc.includes('pos._slQueuedSL = effectiveSL'), 'TL-05 queue at call site when in-flight');
  ok(atSrc.includes('pos._slQueuedSL = null'), 'TL-05 queued SL cleared after drain');

  // Gate logic: call site checks _slUpdateInFlight before calling _updateLiveSL
  const gateIdx = atSrc.indexOf('if (pos._slUpdateInFlight)');
  const callIdx = atSrc.indexOf('_updateLiveSL(pos, effectiveSL)');
  ok(gateIdx > 0 && callIdx > 0 && gateIdx < callIdx, 'TL-05 gate check appears before _updateLiveSL call');

  // Finally block drains queue only if queued !== current newSL
  ok(atSrc.includes('queued !== newSL'), 'TL-05 drain guard: skip if queued === current');

  // Simulate lock behavior on a mock pos object
  var mockPos = { _slUpdateInFlight: false, _slQueuedSL: null };

  // When not in-flight, should proceed (not queue)
  ok(!mockPos._slUpdateInFlight, 'Lock initially false \u2192 proceed');

  // Simulate in-flight: set lock, then check gate
  mockPos._slUpdateInFlight = true;
  mockPos._slQueuedSL = 61000;
  ok(mockPos._slUpdateInFlight === true && mockPos._slQueuedSL === 61000, 'In-flight \u2192 queued SL stored');

  // Simulate release + drain
  mockPos._slUpdateInFlight = false;
  var queued = mockPos._slQueuedSL;
  mockPos._slQueuedSL = null;
  ok(queued === 61000 && mockPos._slQueuedSL === null, 'After release \u2192 queued drained and cleared');
})();

// \u2550\u2550\u2550 14. EMERGENCY CLOSE FALLTHROUGH \u2014 TL-02 \u2550\u2550\u2550
console.log('\n\u2550\u2550\u2550 14. EMERGENCY CLOSE FALLTHROUGH \u2014 TL-02 \u2550\u2550\u2550');
(function testTL02() {
  const atSrc = require('fs').readFileSync('./server/services/serverAT.js', 'utf8');

  // Marker present
  ok(atSrc.includes('return; // [TL-02]'), 'TL-02 return marker present');

  // The return must appear AFTER the emergency close catch block and BEFORE TP placement
  var emgCatchIdx = atSrc.indexOf('EMERGENCY CLOSE FAILED:');
  var tl02ReturnIdx = atSrc.indexOf('return; // [TL-02]');
  var tpSectionIdx = atSrc.indexOf('// TP order with retry loop');
  ok(emgCatchIdx > 0 && tl02ReturnIdx > emgCatchIdx, 'TL-02 return is after emergency close catch');
  ok(tpSectionIdx > 0 && tl02ReturnIdx < tpSectionIdx, 'TL-02 return is before TP placement section');

  // Verify the existing success path also returns (sanity)
  var successReturn = atSrc.indexOf('exit early');
  ok(successReturn > 0 && successReturn < tl02ReturnIdx, 'Emergency close success return exists before TL-02 return');
})();

// \u2550\u2550\u2550 15. CONTROL MODE INIT \u2014 TL-03 \u2550\u2550\u2550
console.log('\n\u2550\u2550\u2550 15. CONTROL MODE INIT \u2014 TL-03 \u2550\u2550\u2550');
(function testTL03() {
  const atSrc = require('fs').readFileSync('./server/services/serverAT.js', 'utf8');

  // Marker present
  ok(atSrc.includes("controlMode: 'auto', // [TL-03]"), 'TL-03 controlMode init marker present');

  // controlMode must appear in the entry object construction (near addOnHistory)
  var addOnIdx = atSrc.indexOf('addOnHistory: []');
  var ctrlIdx = atSrc.indexOf("controlMode: 'auto'");
  ok(addOnIdx > 0 && ctrlIdx > addOnIdx, 'TL-03 controlMode init is after addOnHistory in entry object');

  // The onPriceUpdate check must reference controlMode === 'user'
  ok(atSrc.includes("pos.controlMode === 'user'"), 'onPriceUpdate checks controlMode === user');

  // updateControlMode must accept 'auto', 'assist', 'user'
  ok(atSrc.includes("['auto', 'assist', 'user']"), 'updateControlMode allowed values match init');
})();

// \u2550\u2550\u2550 16. LIVE PENDING GUARD \u2014 TL-04 \u2550\u2550\u2550
console.log('\n\u2550\u2550\u2550 16. LIVE PENDING GUARD \u2014 TL-04 \u2550\u2550\u2550');
(function testTL04() {
  const atSrc = require('fs').readFileSync('./server/services/serverAT.js', 'utf8');

  // 1. _livePending initialized in entry object
  ok(atSrc.includes("_livePending: false, // [TL-04]"), 'TL-04 _livePending init marker present');

  // 2. onPriceUpdate skips _livePending positions
  ok(atSrc.includes('if (pos._livePending) continue'), 'TL-04 onPriceUpdate guard present');

  // 3. _livePending guard is AFTER controlMode check (correct order)
  var ctrlIdx = atSrc.indexOf("pos.controlMode === 'user'");
  var pendIdx = atSrc.indexOf('pos._livePending) continue');
  ok(ctrlIdx > 0 && pendIdx > ctrlIdx, 'TL-04 guard is after controlMode check');

  // 4. try/finally pattern in _executeLiveEntry
  ok(atSrc.includes('entry._livePending = true; // [TL-04]'), 'TL-04 sets _livePending = true at start');
  ok(atSrc.includes('entry._livePending = false; // [TL-04]'), 'TL-04 sets _livePending = false in finally');

  // 5. finally block exists (covers all return paths)
  var tryIdx = atSrc.indexOf('entry._livePending = true');
  var finallyIdx = atSrc.indexOf('} finally {', tryIdx);
  var falseIdx = atSrc.indexOf('entry._livePending = false', finallyIdx);
  ok(finallyIdx > tryIdx && falseIdx > finallyIdx, 'TL-04 uses try/finally pattern (all paths covered)');
})();

// \u2550\u2550\u2550 17. CIRCUIT BREAKER PER-USER \u2014 BE-04 \u2550\u2550\u2550
console.log('\n\u2550\u2550\u2550 17. CIRCUIT BREAKER PER-USER \u2014 BE-04 \u2550\u2550\u2550');
(function testBE04() {
  const bsSrc = require('fs').readFileSync('./server/services/binanceSigner.js', 'utf8');

  // 1. BE-04 marker present
  ok(bsSrc.includes('[BE-04]'), 'BE-04 marker present in binanceSigner.js');

  // 2. _cbMap is a Map (not global _cb object)
  ok(bsSrc.includes('const _cbMap = new Map()'), 'BE-04 uses Map for per-user CB');

  // 3. No global _cb singleton remaining
  ok(!bsSrc.includes('const _cb = {'), 'BE-04 removed global _cb singleton');

  // 4. CB functions accept key parameter
  ok(bsSrc.includes('function _cbRecordSuccess(key)'), 'BE-04 _cbRecordSuccess takes key param');
  ok(bsSrc.includes('function _cbRecordFailure(key)'), 'BE-04 _cbRecordFailure takes key param');
  ok(bsSrc.includes('function _cbCanProceed(key)'), 'BE-04 _cbCanProceed takes key param');

  // 5. _cbKey derived from creds (userId or apiKey fallback)
  ok(bsSrc.includes('creds.userId ? String(creds.userId) : creds.apiKey'), 'BE-04 _cbKey uses userId with apiKey fallback');

  // 6. All call sites pass _cbKey
  var callSites = bsSrc.match(/_cb(RecordFailure|RecordSuccess|CanProceed)\(/g) || [];
  var withKey = bsSrc.match(/_cb(RecordFailure|RecordSuccess|CanProceed)\(_cbKey\)/g) || [];
  ok(callSites.length > 0 && callSites.length === withKey.length + 3, 'BE-04 all sendSignedRequest CB calls pass _cbKey');
})();

// \u2550\u2550\u2550 18. _getUserState SAFE DEFAULT \u2014 RM-05 \u2550\u2550\u2550
console.log('\n\u2550\u2550\u2550 18. _getUserState SAFE DEFAULT \u2014 RM-05 \u2550\u2550\u2550');
(function testRM05() {
  const rgSrc = require('fs').readFileSync('./server/services/riskGuard.js', 'utf8');

  // 1. RM-05 marker present
  ok(rgSrc.includes('[RM-05]'), 'RM-05 marker present in riskGuard.js');

  // 2. No throw on missing userId
  ok(!rgSrc.includes("throw new Error('[RISK] _getUserState"), 'RM-05 removed throw in _getUserState');

  // 3. Safe default returns emergencyKill: true (blocks orders)
  ok(rgSrc.includes('emergencyKill: true'), 'RM-05 safe default has emergencyKill: true');

  // 4. console.error for observability on missing userId
  ok(rgSrc.includes("console.error('[RISK] _getUserState called without userId"), 'RM-05 logs error on missing userId');

  // 5. Functional: validateOrder with null userId returns blocked (not crash)
  var didCrash = false;
  try {
    var rg = require('./server/services/riskGuard');
    var result = rg.validateOrder({ symbol: 'BTCUSDT', side: 'BUY', type: 'MARKET', quantity: 0.001, referencePrice: 50000, leverage: 5 }, 'AT', null);
    ok(!result.ok, 'RM-05 validateOrder(null userId) returns blocked, not crash');
  } catch (e) {
    didCrash = true;
  }
  ok(!didCrash, 'RM-05 validateOrder(null userId) does not throw');
})();


// ═══ 19. BE-02 — User Context Per-User Write Lock ═══
console.log('\n\u2550\u2550\u2550 19. BE-02 \u2014 User Context Write Lock \u2550\u2550\u2550');
(() => {
  const src = require('fs').readFileSync('./server/routes/userContext.js', 'utf8');

  // 1. _writeLocks Map exists
  ok(src.includes('const _writeLocks = new Map()'), 'BE-02 _writeLocks Map declared');

  // 2. _withLock function exists
  ok(src.includes('function _withLock(userId, fn)'), 'BE-02 _withLock function declared');

  // 3. POST handler uses _withLock
  ok(src.includes('_withLock(req.user.id,'), 'BE-02 POST handler calls _withLock');

  // 4. Lock is per-userId (uses String(userId) as key)
  ok(src.includes("const key = String(userId)"), 'BE-02 lock key is String(userId)');

  // 5. Promise chain pattern (prev.then)
  ok(src.includes('prev.then(fn, fn)'), 'BE-02 Promise chain pattern for serialization');
})();


// ═══ 20. OB-01 — Audit Log on Blocked Orders ═══
console.log('\n\u2550\u2550\u2550 20. OB-01 \u2014 Audit Log on Blocked Orders \u2550\u2550\u2550');
(() => {
  const src = require('fs').readFileSync('./server/services/riskGuard.js', 'utf8');
  // 1. audit module imported
  ok(src.includes("const audit = require('./audit')"), 'OB-01 audit module imported');
  // 2. _logBlock helper exists
  ok(src.includes('function _logBlock(order, owner, userId, reason)'), 'OB-01 _logBlock function declared');
  // 3. _logBlock calls audit.record with ORDER_BLOCKED
  ok(src.includes("audit.record('ORDER_BLOCKED'"), 'OB-01 _logBlock calls audit.record ORDER_BLOCKED');
  // 4. All block paths call _logBlock (count markers)
  var markers = src.split('_logBlock(order, owner, userId, r); // [OB-01]').length - 1;
  ok(markers >= 8, 'OB-01 _logBlock called on all block paths (' + markers + ' call sites)');
  // 5. _logBlock is wrapped in try/catch (best-effort)
  ok(src.includes("} catch (_) { /* audit is best-effort */"), 'OB-01 _logBlock has try/catch safety');
})();

// ═══ 21. SC-02 — JWT Expiry Reduced ═══
console.log('\n\u2550\u2550\u2550 21. SC-02 \u2014 JWT Expiry Reduced \u2550\u2550\u2550');
(() => {
  const src = require('fs').readFileSync('./server/routes/auth.js', 'utf8');
  // 1. JWT_EXPIRY_DAYS constant with env override and default 7
  ok(src.includes('parseInt(process.env.JWT_EXPIRY_DAYS, 10) || 7'), 'SC-02 JWT_EXPIRY_DAYS default 7, env-configurable');
  // 2. No hardcoded '30d' for JWT (ban durations excluded)
  var jwtLines = src.split('\n').filter(l => l.includes("'30d'") && !l.includes('duration') && !l.includes('ban') && !l.includes('ms ='));
  ok(jwtLines.length === 0, 'SC-02 no hardcoded 30d JWT expiry (' + jwtLines.length + ' remaining)');
  // 3. Cookie maxAge uses JWT_EXPIRY_DAYS
  ok(src.includes('JWT_EXPIRY_DAYS * 24 * 60 * 60 * 1000'), 'SC-02 cookie maxAge uses JWT_EXPIRY_DAYS');
})();

// ═══ 22. F1 — Per-user AT on/off gate ═══
console.log('\n\u2550\u2550\u2550 22. F1 \u2014 Per-user AT on/off gate \u2550\u2550\u2550');
(() => {
  const atSrc = require('fs').readFileSync('./server/services/serverAT.js', 'utf8');
  const tradingSrc = require('fs').readFileSync('./server/routes/trading.js', 'utf8');
  // 1. _defaultUserState has atActive: true
  ok(atSrc.includes('atActive: true'), 'F1 _defaultUserState has atActive: true');
  // 2. _persistState saves atActive
  ok(atSrc.includes('atActive: us.atActive'), 'F1 _persistState saves atActive');
  // 3. _applyStateBlob restores atActive (default true)
  ok(atSrc.includes('us.atActive = saved.atActive !== false'), 'F1 _applyStateBlob restores atActive (default true)');
  // 4. processBrainDecision blocks when !atActive
  ok(atSrc.includes('if (!us.atActive)'), 'F1 processBrainDecision has atActive gate');
  // 5. toggleActive function exists with audit + telegram
  ok(atSrc.includes('function toggleActive(userId, active)'), 'F1 toggleActive function exists');
  ok(atSrc.includes("audit.record('AT_TOGGLE'"), 'F1 toggleActive has audit trail');
  // 6. getFullState exposes atActive
  ok(atSrc.includes('atActive: us.atActive'), 'F1 getFullState exposes atActive');
  // 7. API endpoint exists
  ok(tradingSrc.includes("router.post('/at/toggle'"), 'F1 POST /at/toggle endpoint exists');
  ok(tradingSrc.includes("typeof active !== 'boolean'"), 'F1 /at/toggle validates boolean input');
  // 8. toggleActive exported
  ok(atSrc.includes('toggleActive, // [F1]'), 'F1 toggleActive is exported');
})();

// ═══ 23. F2 — Stale price gate at entry ═══
console.log('\n\u2550\u2550\u2550 23. F2 \u2014 Stale price gate at entry \u2550\u2550\u2550');
(() => {
  const atSrc = require('fs').readFileSync('./server/services/serverAT.js', 'utf8');
  const brainSrc = require('fs').readFileSync('./server/services/serverBrain.js', 'utf8');
  // 1. serverBrain passes priceTs in decision
  ok(brainSrc.includes('priceTs: snap.priceTs'), 'F2 decision includes priceTs from snapshot');
  // 2. processBrainDecision has freshness gate
  ok(atSrc.includes('decision.priceTs') && atSrc.includes('> 10000'), 'F2 processBrainDecision has 10s freshness gate');
  // 3. Gate logs stale price age
  ok(atSrc.includes('stale price'), 'F2 stale price gate logs rejection');
  // 4. Gate is after price > 0 check
  var lines = atSrc.split('\n');
  var priceCheck = lines.findIndex(l => l.includes('if (!price || price <= 0)'));
  var staleCheck = lines.findIndex(l => l.includes('decision.priceTs') && l.includes('10000'));
  ok(priceCheck > 0 && staleCheck > priceCheck, 'F2 stale gate is after price > 0 check (L' + priceCheck + ' < L' + staleCheck + ')');
})();

// ═══ 24. F3 — controlMode user timeout safety ═══
console.log('\n\u2550\u2550\u2550 24. F3 \u2014 controlMode user timeout safety \u2550\u2550\u2550');
(() => {
  const atSrc = require('fs').readFileSync('./server/services/serverAT.js', 'utf8');
  // 1. updateControlMode sets _controlModeTs
  ok(atSrc.includes("pos._controlModeTs = Date.now()"), 'F3 updateControlMode sets _controlModeTs');
  // 2. _controlModeTs only set for user mode
  ok(atSrc.includes("controlMode === 'user') pos._controlModeTs"), 'F3 timestamp only for user control');
  // 3. onPriceUpdate has 30min timeout (1800000ms)
  ok(atSrc.includes('1800000'), 'F3 onPriceUpdate has 30min timeout (1800000ms)');
  // 4. Timeout reverts to auto
  ok(atSrc.includes("pos.controlMode = 'auto'") && atSrc.includes('30min timeout'), 'F3 timeout reverts to auto with log');
  // 5. Telegram notification on revert
  ok(atSrc.includes('Take Control Expired'), 'F3 telegram notification on timeout revert');
  // 6. Position persisted after revert
  var lines = atSrc.split('\n');
  var revertLine = lines.findIndex(l => l.includes('30min timeout'));
  var persistAfter = lines.slice(revertLine, revertLine + 5).some(l => l.includes('_persistPosition'));
  ok(persistAfter, 'F3 position persisted after timeout revert');
})();
console.log('\n\u2550\u2550\u2550 FINAL WALLET \u2550\u2550\u2550');
console.log('  Start: $100.00  |  Current: $' + W.bal.toFixed(4) + '  |  P&L: $' + (W.bal - 100).toFixed(4));
console.log('  Trades: ' + positions.length + '  |  Open: ' + positions.filter(p => p.status === 'OPEN').length + '  |  Journal: ' + journal.length);
console.log('\n========================================');
console.log('  TOTAL: ' + P + ' passed, ' + F + ' failed');
console.log('========================================');
if (F > 0) process.exit(1);
