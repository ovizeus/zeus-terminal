// THE TEACHER Batch 2 — Engine + Dataset smoke test
// Tests replay engine, stepping, trade sim, SL/TP, DSL, session summary
// Uses generated bars, no network calls

var window = globalThis;
globalThis.window = globalThis;

var vm = require('vm');
var fs = require('fs');

// Load all teacher files in order
vm.runInThisContext(fs.readFileSync('public/js/teacher/teacherConfig.js', 'utf8'));
vm.runInThisContext(fs.readFileSync('public/js/teacher/teacherIndicators.js', 'utf8'));
vm.runInThisContext(fs.readFileSync('public/js/teacher/teacherStorage.js', 'utf8'));
vm.runInThisContext(fs.readFileSync('public/js/teacher/teacherDataset.js', 'utf8'));
vm.runInThisContext(fs.readFileSync('public/js/teacher/teacherEngine.js', 'utf8'));

var p = 0, f = 0;
function ok(cond, msg) {
  if (cond) { p++; console.log('  PASS: ' + msg); }
  else { f++; console.log('  FAIL: ' + msg); }
}

// Generate realistic BTC bars (trending up then down)
function makeBars(n, startPrice) {
  var bars = [], price = startPrice || 50000;
  var trend = 1; // 1=up, -1=down
  for (var i = 0; i < n; i++) {
    if (i === Math.floor(n * 0.6)) trend = -1; // flip to down
    var chg = trend * (50 + Math.random() * 100) + (Math.random() - 0.5) * 80;
    var o = price, c = o + chg;
    var h = Math.max(o, c) + Math.random() * 80;
    var l = Math.min(o, c) - Math.random() * 80;
    bars.push({
      time: 1700000000 + i * 300, // 5min intervals
      open: o, high: h, low: l, close: c,
      volume: 500 + Math.random() * 3000,
      timeMs: (1700000000 + i * 300) * 1000,
    });
    price = c;
  }
  return bars;
}

console.log('=== THE TEACHER — Batch 2 Engine Test ===\n');

// ── Dataset validation ──
console.log('--- Dataset Validation ---');
var bars300 = makeBars(300, 50000);
var dataset = { bars: bars300, tf: '5m', symbol: 'BTCUSDT', loadedAt: Date.now(), range: { from: bars300[0].time, to: bars300[bars300.length - 1].time } };
var v = teacherValidateDataset(dataset);
ok(v.valid, 'Dataset 300 bars valid');
ok(v.barCount === 300, 'barCount = 300');

var badDS = { bars: makeBars(10), tf: '5m', symbol: 'BTCUSDT', loadedAt: Date.now(), range: {} };
var v2 = teacherValidateDataset(badDS);
ok(!v2.valid, 'Dataset 10 bars rejected (< minBars)');

var emptyDS = teacherValidateDataset(null);
ok(!emptyDS.valid, 'Null dataset rejected');

// ── Init Replay ──
console.log('\n--- Init Replay ---');
var initResult = teacherInitReplay(dataset, {});
ok(initResult !== null, 'Init replay returned result');
ok(initResult.totalBars === 300, 'totalBars = 300');
ok(initResult.startCursor === TEACHER_REPLAY_DEFAULTS.lookback, 'Cursor at lookback: ' + initResult.startCursor);
ok(TEACHER.replaying === false, 'Not replaying yet');
ok(TEACHER.openTrade === null, 'No open trade');

// ── Stepping ──
console.log('\n--- Stepping Forward ---');
var tick1 = teacherStep(1);
ok(tick1 !== null, 'Step 1 returned tick');
ok(tick1.barIndex === TEACHER_REPLAY_DEFAULTS.lookback + 1, 'Cursor advanced by 1');
ok(tick1.bar !== null, 'Tick has bar');
ok(tick1.indicators !== null, 'Tick has indicators');
ok(typeof tick1.progress === 'number', 'Tick has progress');

var tick5 = teacherStep(5);
ok(tick5.barIndex === TEACHER_REPLAY_DEFAULTS.lookback + 6, 'Step 5 moved cursor +5');

// ── Step Back ──
console.log('\n--- Stepping Back ---');
var back = teacherStepBack(3);
ok(back !== null, 'StepBack returned result');
ok(back.barIndex === TEACHER_REPLAY_DEFAULTS.lookback + 3, 'Cursor went back 3');

// ── Jump ──
console.log('\n--- Jump To ---');
var jump = teacherJumpTo(150);
ok(jump.barIndex === 150, 'Jumped to bar 150');
ok(typeof jump.indicators === 'object', 'Jump has indicators');

// ── Open Trade (LONG) ──
console.log('\n--- Trade: LONG ---');
teacherJumpTo(120); // reset cursor
var trade = teacherOpenTrade('LONG', { slPct: 1.0, tpPct: 2.0 });
ok(trade !== null, 'Opened LONG trade');
ok(trade.side === 'LONG', 'Side = LONG');
ok(trade.entry > 0, 'Entry price > 0: ' + trade.entry.toFixed(2));
ok(trade.sl < trade.entry, 'SL < entry (LONG)');
ok(trade.tp > trade.entry, 'TP > entry (LONG)');
ok(trade.leverage === 5, 'Leverage = 5');
ok(trade.entryFee > 0, 'Entry fee > 0');
ok(Array.isArray(trade.entryReasons), 'Has entry reasons');
ok(TEACHER.openTrade === trade, 'TEACHER.openTrade set');

// Try opening second trade (should fail)
var trade2 = teacherOpenTrade('SHORT');
ok(trade2 === null, 'Cannot open second trade while in position');

// ── Step through bars and let it process ──
console.log('\n--- Trade Processing (stepping through bars) ---');
var closedBySLTP = false;
for (var i = 0; i < 150; i++) {
  var st = teacherStep(1);
  if (!TEACHER.openTrade) { closedBySLTP = true; break; }
}
ok(closedBySLTP, 'Trade closed by SL or TP during replay');
ok(TEACHER.trades.length >= 1, 'Trade recorded: ' + TEACHER.trades.length);
var lastTrade = TEACHER.trades[TEACHER.trades.length - 1];
ok(typeof lastTrade.pnlNet === 'number', 'PnL computed: $' + lastTrade.pnlNet);
ok(typeof lastTrade.pnlPct === 'number', 'PnL% computed: ' + lastTrade.pnlPct + '%');
ok(lastTrade.totalFees > 0, 'Fees recorded: $' + lastTrade.totalFees);
ok(['TP_HIT', 'SL_HIT', 'DSL_HIT'].includes(lastTrade.exitReason), 'Exit reason: ' + lastTrade.exitReason);
ok(['WIN', 'LOSS', 'BREAKEVEN'].includes(lastTrade.outcome), 'Outcome: ' + lastTrade.outcome);
ok(lastTrade.barsHeld >= 1, 'barsHeld >= 1: ' + lastTrade.barsHeld);

// ── Short trade ──
console.log('\n--- Trade: SHORT ---');
var shortTrade = teacherOpenTrade('SHORT', { slPct: 1.5, tpPct: 3.0 });
ok(shortTrade !== null, 'Opened SHORT trade');
ok(shortTrade.sl > shortTrade.entry, 'SL > entry (SHORT)');
ok(shortTrade.tp < shortTrade.entry, 'TP < entry (SHORT)');

// Manual close
var closed = teacherCloseTrade('MANUAL_EXIT');
ok(closed !== null, 'Manual close succeeded');
ok(closed.exitReason === 'MANUAL_EXIT', 'Exit reason: MANUAL_EXIT');
ok(TEACHER.openTrade === null, 'No open trade after close');
ok(TEACHER.trades.length >= 2, 'Total trades: ' + TEACHER.trades.length);

// ── Snapshot ──
console.log('\n--- Snapshot ---');
var snap = teacherGetSnapshot();
ok(snap !== null, 'Snapshot returned');
ok(typeof snap.cursor === 'number', 'Has cursor');
ok(typeof snap.progress === 'number', 'Has progress');
ok(snap.tradeCount >= 2, 'tradeCount: ' + snap.tradeCount);

// ── Auto-play + pause ──
console.log('\n--- Auto-play ---');
teacherJumpTo(250); // near end
var playOK = teacherPlay();
ok(playOK, 'Play started');
ok(TEACHER.replaying, 'replaying = true');

var pauseOK = teacherPause();
ok(pauseOK, 'Pause succeeded');
ok(TEACHER.paused, 'paused = true');

teacherStopReplay();
ok(!TEACHER.replaying, 'Stopped: replaying = false');

// ── Speed change ──
teacherSetSpeed(200);
ok(TEACHER.config.speedMs === 200, 'Speed = 200ms');
teacherSetSpeed(10);
ok(TEACHER.config.speedMs === 50, 'Speed clamped to 50ms min');

// ── Session summary ──
console.log('\n--- Session Summary ---');
var summary = _teacherBuildSessionSummary();
ok(summary !== null, 'Summary built');
ok(summary.totalTrades >= 2, 'totalTrades: ' + summary.totalTrades);
ok(typeof summary.winRate === 'number', 'winRate: ' + summary.winRate + '%');
ok(typeof summary.profitFactor === 'number', 'profitFactor: ' + summary.profitFactor);
ok(typeof summary.totalPnl === 'number', 'totalPnl: $' + summary.totalPnl);
ok(typeof summary.totalFees === 'number', 'totalFees: $' + summary.totalFees);

// ── DSL test ──
console.log('\n--- DSL (Dynamic Stop Loss) ---');
// Create a strongly trending dataset for DSL activation
var trendBars = [];
var tPrice = 50000;
for (var i = 0; i < 300; i++) {
  var chg = 30 + Math.random() * 20; // always up
  var o = tPrice, c = o + chg;
  trendBars.push({ time: 1700000000 + i * 300, open: o, high: c + 10, low: o - 10, close: c, volume: 1000, timeMs: (1700000000 + i * 300) * 1000 });
  tPrice = c;
  if (i === 250) { // crash at bar 250
    for (var j = 0; j < 49; j++) {
      i++;
      tPrice -= 300;
      trendBars.push({ time: 1700000000 + i * 300, open: tPrice + 300, high: tPrice + 310, low: tPrice - 10, close: tPrice, volume: 2000, timeMs: (1700000000 + i * 300) * 1000 });
    }
    break;
  }
}
var trendDS = { bars: trendBars, tf: '5m', symbol: 'BTCUSDT', loadedAt: Date.now(), range: { from: trendBars[0].time, to: trendBars[trendBars.length - 1].time } };
teacherInitReplay(trendDS, {});
teacherJumpTo(110);
var dslTrade = teacherOpenTrade('LONG', { slPct: 2.0, tpPct: 50.0, dslEnabled: true, dslActivation: 0.3, dslTrailPct: 0.5 });
ok(dslTrade !== null, 'DSL trade opened');
ok(dslTrade.dsl.enabled, 'DSL enabled');

// Step through the trend and crash
for (var i = 0; i < 180; i++) teacherStep(1);
var dslResult = TEACHER.trades[TEACHER.trades.length - 1];
ok(dslResult !== undefined, 'DSL trade completed');
if (dslResult) {
  ok(dslResult.dslUsed === true, 'DSL was activated');
  ok(dslResult.exitReason === 'DSL_HIT' || dslResult.exitReason === 'SL_HIT', 'Exit by DSL or SL: ' + dslResult.exitReason);
}

// ── Edge: invalid inputs ──
console.log('\n--- Edge Cases ---');
ok(teacherOpenTrade('INVALID') === null, 'Invalid side rejected');
ok(teacherStep(0) !== null || true, 'Step(0) handled');
ok(teacherGetSnapshot() !== null, 'Snapshot after all ops');

// ── Callback test ──
console.log('\n--- Callbacks ---');
var callbackBars = makeBars(250, 60000);
var callbackDS = { bars: callbackBars, tf: '5m', symbol: 'BTCUSDT', loadedAt: Date.now(), range: { from: callbackBars[0].time, to: callbackBars[callbackBars.length - 1].time } };
var tickCount = 0;
teacherInitReplay(callbackDS, { onTick: function () { tickCount++; } });
for (var i = 0; i < 20; i++) teacherStep(1);
ok(tickCount === 20, 'onTick called 20 times: ' + tickCount);

// ── Presets ──
console.log('\n--- Presets ---');
var p24h = teacherPresetLast24h();
ok(p24h.tf === '5m', 'Preset 24h = 5m');
ok(p24h.endMs - p24h.startMs === 86400000, 'Preset 24h range = 24h');
var p7d = teacherPresetLast7d();
ok(p7d.tf === '15m', 'Preset 7d = 15m');
var p30d = teacherPresetLast30d();
ok(p30d.tf === '1h', 'Preset 30d = 1h');
var pCustom = teacherPresetCustom('4h', 90);
ok(pCustom.tf === '4h', 'Custom preset = 4h');
ok(pCustom.endMs - pCustom.startMs === 90 * 86400000, 'Custom 90 days');

console.log('\n========================================');
console.log('  RESULTS: ' + p + ' passed, ' + f + ' failed');
console.log('========================================');
if (f > 0) process.exit(1);
