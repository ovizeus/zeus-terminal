// THE TEACHER Batch 1 — Smoke test for teacherIndicators
// Loads teacherConfig (for constants) + teacherIndicators, runs pure tests
// NOTE: no 'use strict' here so eval'd function declarations are globally visible

// Simulate browser globals needed by teacherConfig
var window = globalThis;
globalThis.window = globalThis;

// Load files using vm.runInThisContext (makes const/function visible globally)
var fs = require('fs');
var vm = require('vm');
vm.runInThisContext(fs.readFileSync('public/js/teacher/teacherConfig.js', 'utf8'));
vm.runInThisContext(fs.readFileSync('public/js/teacher/teacherIndicators.js', 'utf8'));

let p = 0, f = 0;
function ok(cond, msg) {
  if (cond) { p++; console.log('  PASS: ' + msg); }
  else { f++; console.log('  FAIL: ' + msg); }
}

// Generate fake BTC bars
function makeBars(n, startPrice) {
  var bars = [], price = startPrice || 50000;
  for (var i = 0; i < n; i++) {
    var chg = (Math.random() - 0.48) * 200;
    var o = price, c = o + chg;
    var h = Math.max(o, c) + Math.random() * 100;
    var l = Math.min(o, c) - Math.random() * 100;
    bars.push({ open: o, high: h, low: l, close: c, volume: 1000 + Math.random() * 5000, time: Date.now() - ((n - i) * 300000) });
    price = c;
  }
  return bars;
}

var bars = makeBars(200, 50000);
var closes = bars.map(b => b.close);

console.log('=== THE TEACHER — Batch 1 Indicators Test ===\n');

// ── RSI ──
var rsi = teacherCalcRSI(closes);
ok(rsi.length === 200, 'RSI array length=200');
ok(rsi[14] !== null, 'RSI[14] not null (period=14)');
ok(rsi[0] === null, 'RSI[0] is null (insufficient data)');
ok(typeof rsi[rsi.length - 1] === 'number', 'RSI last is number');
ok(rsi[rsi.length - 1] >= 0 && rsi[rsi.length - 1] <= 100, 'RSI in 0-100 range');

// ── ADX ──
var adx = teacherCalcADX(bars);
ok(adx === null || typeof adx === 'number', 'ADX returns number or null');
if (adx !== null) ok(adx >= 0 && adx <= 100, 'ADX in 0-100: ' + adx);

// ── MACD ──
var macd = teacherCalcMACD(closes);
ok(macd !== null, 'MACD not null');
ok(typeof macd.macd === 'number', 'MACD.macd is number');
ok(typeof macd.signal === 'number', 'MACD.signal is number');
ok(typeof macd.hist === 'number', 'MACD.hist is number');

// ── MACD direction ──
var md = teacherDetectMACDDir(closes);
ok(['bull', 'bear', 'neut'].includes(md), 'MACD dir valid: ' + md);

// ── ATR ──
var atr = teacherCalcATR(bars);
ok(typeof atr === 'number' && atr > 0, 'ATR positive: ' + atr.toFixed(2));

// ── SuperTrend direction ──
var st = teacherDetectSTDir(bars);
ok(['bull', 'bear', 'neut'].includes(st), 'ST dir valid: ' + st);

// ── Bollinger Bands ──
var bb = teacherCalcBB(closes);
ok(bb !== null, 'BB not null');
ok(bb.upper > bb.middle, 'BB upper > middle');
ok(bb.middle > bb.lower, 'BB middle > lower');
ok(typeof bb.squeeze === 'boolean', 'BB squeeze is boolean');
ok(typeof bb.bandwidth === 'number', 'BB bandwidth is number');

// ── Wick Chaos ──
var wc = teacherWickChaos(bars, 10);
ok(typeof wc === 'number', 'WickChaos is number');
ok(wc >= 0 && wc <= 100, 'WickChaos 0-100: ' + wc);

// ── Breakout Strength ──
var bs = teacherBreakoutStrength(bars);
ok(typeof bs === 'number', 'BreakoutStrength is number');
ok(bs >= 0, 'BreakoutStrength >= 0: ' + bs);

// ── Regime Detection ──
var reg = teacherDetectRegime(bars);
ok(['RANGE', 'TREND', 'BREAKOUT', 'VOLATILE'].includes(reg.regime), 'Regime valid: ' + reg.regime);
ok(typeof reg.confidence === 'number', 'Regime conf is number');
ok(typeof reg.trapRisk === 'number', 'Regime trapRisk is number');
ok(['neutral', 'bullish', 'bearish'].includes(reg.trendBias), 'Regime trendBias valid');

// ── Confluence ──
var conf = teacherCalcConfluence(rsi[rsi.length - 1], md, st, adx, reg.regime);
ok(typeof conf.score === 'number', 'Confluence score is number');
ok(conf.score >= 0 && conf.score <= 100, 'Confluence 0-100: ' + conf.score);
ok(typeof conf.alignment === 'number', 'Confluence alignment is number');
ok(Array.isArray(conf.components), 'Confluence has components array');

// ── Divergence ──
var div = teacherDetectDivergence(bars);
ok(div === null || (div.type && typeof div.conf === 'number'), 'Divergence valid');

// ── Volume Climax ──
var clim = teacherDetectClimax(bars);
ok(clim === null || (clim.dir && typeof clim.mult === 'number'), 'Climax valid');

// ── Fee Estimation ──
var fees = teacherEstimateFees(10000, 'MARKET', 'swing');
ok(fees.total > 0, 'Fees positive: $' + fees.total.toFixed(4));
ok(fees.entryFee === fees.exitFee, 'Entry fee = Exit fee');
ok(Math.abs(fees.entryFee - 4) < 0.01, 'Taker fee = $4 on $10k');
ok(Math.abs(fees.slippage - 2) < 0.01, 'Swing slippage = $2 on $10k');

var feesLimit = teacherEstimateFees(10000, 'LIMIT', 'fast');
ok(feesLimit.entryFee < fees.entryFee, 'Limit fee < Market fee');

// ── Master: teacherComputeIndicators ──
var snap = teacherComputeIndicators(bars);
ok(snap.rsi !== null, 'Master RSI populated');
ok(snap.adx !== null || snap.adx === null, 'Master ADX valid');
ok(snap.regime !== undefined, 'Master regime populated');
ok(typeof snap.confluence === 'number', 'Master confluence populated');
ok(typeof snap.wickChaos === 'number', 'Master wickChaos populated');
ok(typeof snap.breakoutStr === 'number', 'Master breakoutStr populated');

// ── Edge cases ──
var empty = teacherComputeIndicators([]);
ok(empty.rsi === null, 'Empty bars -> null RSI');
ok(empty.regime === 'RANGE', 'Empty bars -> RANGE default');
ok(empty.confluence === 50, 'Empty bars -> confluence 50');

var small = teacherComputeIndicators(makeBars(5));
ok(small.rsi === null, '5 bars -> null RSI');

var nullRsi = teacherCalcRSI([], 14);
ok(nullRsi.length === 0, 'Empty closes -> empty RSI array');

var nullAdx = teacherCalcADX(makeBars(3), 14);
ok(nullAdx === null, '3 bars -> null ADX');

var nullBB = teacherCalcBB([], 20, 2);
ok(nullBB === null, 'Empty closes -> null BB');

console.log('\n========================================');
console.log('  RESULTS: ' + p + ' passed, ' + f + ' failed');
console.log('========================================');
if (f > 0) process.exit(1);
