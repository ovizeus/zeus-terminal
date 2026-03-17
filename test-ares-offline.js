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

ok(rg.validateOrder({ symbol: 'BTCUSDT', side: 'BUY', type: 'MARKET', quantity: 0.001, price: 0, leverage: 5 }, 'AT').ok, 'AT MARKET order PASS');
ok(rg.validateOrder({ symbol: 'BTCUSDT', side: 'BUY', type: 'MARKET', quantity: 0.001, price: 0, leverage: 5 }, 'ARES').ok, 'ARES MARKET order PASS');
ok(!rg.validateOrder({ symbol: 'BTCUSDT', side: 'BUY', type: 'MARKET', quantity: 0.001, price: 0, leverage: 200 }, 'ARES').ok, 'ARES 200x leverage BLOCKED');
ok(!rg.validateOrder({ symbol: 'BTCUSDT', side: 'BUY', type: 'LIMIT', quantity: 10, price: 100000, leverage: 5 }, 'AT').ok, 'AT $1M LIMIT notional BLOCKED');
ok(rg.validateOrder({ symbol: 'BTCUSDT', side: 'BUY', type: 'MARKET', quantity: 10, price: 0, leverage: 5 }, 'AT').ok, 'MARKET price=0 NOT blocked');
ok(rg.validateOrder({ symbol: 'BTCUSDT', side: 'SELL', type: 'STOP_MARKET', quantity: 10, price: 0, leverage: 5 }, 'ARES').ok, 'STOP_MARKET NOT blocked');
ok(rg.validateOrder({ symbol: 'BTCUSDT', side: 'SELL', type: 'TAKE_PROFIT_MARKET', quantity: 10, price: 0, leverage: 5 }, 'ARES').ok, 'TP_MARKET NOT blocked');

// ═══ 2. RISK GUARD — Independent Daily Loss ═══
console.log('\n\u2550\u2550\u2550 2. RISK GUARD \u2014 Independent Daily Loss \u2550\u2550\u2550');
rg.recordClosedPnL(-1.2, 'ARES'); rg.recordClosedPnL(3.5, 'ARES'); rg.recordClosedPnL(-0.8, 'ARES');
ok(Math.abs(rg.getDailyState('ARES').realizedPnL - 1.5) < 0.01, 'ARES net=$1.50');
rg.recordClosedPnL(-2.0, 'AT');
ok(rg.getDailyState('AT').realizedPnL === -2, 'AT PnL=-$2.00 independent');

// ═══ 3. RISK GUARD — Emergency Kill ═══
console.log('\n\u2550\u2550\u2550 3. RISK GUARD \u2014 Emergency Kill \u2550\u2550\u2550');
delete require.cache[require.resolve('./server/services/riskGuard')];
const rg2 = require('./server/services/riskGuard');
rg2.setEmergencyKill(true);
ok(!rg2.validateOrder({ symbol: 'BTCUSDT', side: 'BUY', type: 'MARKET', quantity: 0.001, price: 0, leverage: 5 }, 'AT').ok, 'Kill blocks AT');
ok(!rg2.validateOrder({ symbol: 'BTCUSDT', side: 'BUY', type: 'MARKET', quantity: 0.001, price: 0, leverage: 5 }, 'ARES').ok, 'Kill blocks ARES');
rg2.setEmergencyKill(false);
ok(rg2.validateOrder({ symbol: 'BTCUSDT', side: 'BUY', type: 'MARKET', quantity: 0.001, price: 0, leverage: 5 }, 'AT').ok, 'Unblocked after kill off');

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
console.log('\n\u2550\u2550\u2550 FINAL WALLET \u2550\u2550\u2550');
console.log('  Start: $100.00  |  Current: $' + W.bal.toFixed(4) + '  |  P&L: $' + (W.bal - 100).toFixed(4));
console.log('  Trades: ' + positions.length + '  |  Open: ' + positions.filter(p => p.status === 'OPEN').length + '  |  Journal: ' + journal.length);
console.log('\n========================================');
console.log('  TOTAL: ' + P + ' passed, ' + F + ' failed');
console.log('========================================');
if (F > 0) process.exit(1);
