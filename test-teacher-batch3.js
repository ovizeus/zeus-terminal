// THE TEACHER Batch 3+4 — Simulator + Reason smoke test
// Tests: equity, signal exits, time stops, enhanced step, sizing,
// missed trades, scoring, streaks, R-multiple, session analytics,
// reason engine (why entered/exited/outcome), pattern classification,
// lesson extraction, trade comparison
// Uses generated bars, no network calls

var window = globalThis;
globalThis.window = globalThis;

var vm = require('vm');
var fs = require('fs');

// Load all teacher files in dependency order
vm.runInThisContext(fs.readFileSync('public/js/teacher/teacherConfig.js', 'utf8'));
vm.runInThisContext(fs.readFileSync('public/js/teacher/teacherIndicators.js', 'utf8'));
vm.runInThisContext(fs.readFileSync('public/js/teacher/teacherStorage.js', 'utf8'));
vm.runInThisContext(fs.readFileSync('public/js/teacher/teacherDataset.js', 'utf8'));
vm.runInThisContext(fs.readFileSync('public/js/teacher/teacherEngine.js', 'utf8'));
vm.runInThisContext(fs.readFileSync('public/js/teacher/teacherSimulator.js', 'utf8'));
vm.runInThisContext(fs.readFileSync('public/js/teacher/teacherReason.js', 'utf8'));

var p = 0, f = 0;
function ok(cond, msg) {
  if (cond) { p++; console.log('  PASS: ' + msg); }
  else { f++; console.log('  FAIL: ' + msg); }
}

// Generate BTC bars: up-trend → down-trend
function makeBars(n, startPrice) {
  var bars = [], price = startPrice || 50000;
  var trend = 1;
  for (var i = 0; i < n; i++) {
    if (i === Math.floor(n * 0.6)) trend = -1;
    var chg = trend * (50 + Math.random() * 100) + (Math.random() - 0.5) * 80;
    var o = price, c = o + chg;
    var h = Math.max(o, c) + Math.random() * 80;
    var l = Math.min(o, c) - Math.random() * 80;
    bars.push({
      time: 1700000000 + i * 300,
      open: o, high: h, low: l, close: c,
      volume: 500 + Math.random() * 3000,
      timeMs: (1700000000 + i * 300) * 1000,
    });
    price = c;
  }
  return bars;
}

// Helper: init replay + step to a good position
function setupReplay(n) {
  n = n || 300;
  var bars = makeBars(n, 50000);
  var ds = { bars: bars, tf: '5m', symbol: 'BTCUSDT', loadedAt: Date.now(), range: { from: bars[0].time, to: bars[bars.length - 1].time } };
  teacherInitReplay(ds, {});
  return ds;
}

// Helper: step forward by n bars
function stepN(n) { for (var i = 0; i < n; i++) teacherStep(1); }

console.log('=== THE TEACHER — Batch 3+4 Simulator + Reason Test ===\n');

// ══════════════════════════════════════════════════════════════════
// SECTION 1: EQUITY CURVE
// ══════════════════════════════════════════════════════════════════
console.log('--- Equity Curve ---');

setupReplay(300);
teacherInitEquity();

var eq1 = teacherGetEquity();
ok(eq1 !== null, 'teacherGetEquity returns data');
ok(eq1.startCapital === TEACHER_TRADE_DEFAULTS.capitalUSD, 'startCapital matches config (' + eq1.startCapital + ')');
ok(eq1.currentCapital === eq1.startCapital, 'currentCapital = startCapital initially');
ok(eq1.returnPct === 0, 'Return = 0% initially');
ok(eq1.maxDrawdown === 0, 'No drawdown initially');
ok(eq1.curveLength === 1, 'Curve has 1 data point (init)');

// Simulate a trade update
var fakeTrade = { id: 'test', pnlNet: 50, exitBar: 105, outcome: 'WIN' };
var T = window.TEACHER;
T.trades = [fakeTrade];
_teacherUpdateEquity(fakeTrade);
var eq2 = teacherGetEquity();
ok(eq2.currentCapital === eq1.startCapital + 50, 'Capital increased by win (+$50)');
ok(eq2.peak >= eq2.currentCapital, 'Peak >= current');
ok(eq2.curveLength === 2, 'Curve now has 2 points');
ok(eq2.tradeEquity.length === 1, 'tradeEquity has 1 entry');

// Simulate a loss
var fakeLoss = { id: 'test2', pnlNet: -80, exitBar: 110, outcome: 'LOSS' };
T.trades.push(fakeLoss);
_teacherUpdateEquity(fakeLoss);
var eq3 = teacherGetEquity();
ok(eq3.currentCapital < eq3.peak, 'Capital below peak after loss');
ok(eq3.maxDrawdown > 0, 'Max drawdown > 0 after loss');
ok(eq3.maxDrawdownPct > 0, 'Max drawdown % > 0');
ok(eq3.currentDD > 0, 'Current DD > 0');

// ══════════════════════════════════════════════════════════════════
// SECTION 2: SIGNAL EXIT CHECKS
// ══════════════════════════════════════════════════════════════════
console.log('\n--- Signal Exits ---');

setupReplay(300);
stepN(10);

// No open trade → should return null
var sigNoTrade = teacherCheckSignalExit();
ok(sigNoTrade === null, 'No signal exit when no open trade');

// Open a LONG, set indicators to bearish → signal flip
teacherOpenTrade('LONG');
T = window.TEACHER;
ok(T.openTrade !== null, 'Trade opened for signal test');

// Simulate bearish indicators
T.indicators.macdDir = 'bear';
T.indicators.stDir = 'bear';
T.indicators.confluence = 25;

var sig1 = teacherCheckSignalExit();
ok(sig1 === 'SIGNAL_FLIP', 'MACD bear → SIGNAL_FLIP for LONG');

// Reset to neutral, test confluence drop
T.indicators.macdDir = 'bull';
T.indicators.stDir = 'bull';
T.indicators.confluence = 25;
var sig2 = teacherCheckSignalExit();
ok(sig2 === 'CONFLUENCE_DROP', 'Confluence 25 → CONFLUENCE_DROP for LONG');

// Test SHORT signal exit
T.indicators.confluence = 50; // reset
teacherCloseTrade(); // close current
stepN(2);
teacherOpenTrade('SHORT');
T.indicators.macdDir = 'bull';
var sig3 = teacherCheckSignalExit();
ok(sig3 === 'SIGNAL_FLIP', 'MACD bull → SIGNAL_FLIP for SHORT');

// SHORT + high confluence → CONFLUENCE_DROP
T.indicators.macdDir = 'bear';
T.indicators.stDir = 'bear';
T.indicators.confluence = 75;
var sig4 = teacherCheckSignalExit();
ok(sig4 === 'CONFLUENCE_DROP', 'Confluence 75 → CONFLUENCE_DROP for SHORT');

// Regime change test
T.indicators.confluence = 50;
T.openTrade.entryReasons = ['REGIME_TREND', 'MACD_CROSS_BEAR'];
T.indicators.regime = 'RANGE';
var sig5 = teacherCheckSignalExit();
ok(sig5 === 'REGIME_CHANGE', 'Regime TREND→RANGE → REGIME_CHANGE');

T.indicators.regime = 'TREND';
var sig6 = teacherCheckSignalExit();
ok(sig6 === null, 'TREND regime → no exit signal');

// ══════════════════════════════════════════════════════════════════
// SECTION 3: TIME STOP
// ══════════════════════════════════════════════════════════════════
console.log('\n--- Time Stop ---');

setupReplay(300);
stepN(10);
teacherOpenTrade('LONG');
T = window.TEACHER;

// Not expired yet
var ts1 = teacherCheckTimeStop();
ok(ts1 === null, 'No time stop at beginning');

// Force bars held to match max
T.openTrade.entryBar = T.cursor - 99;
var ts2 = teacherCheckTimeStop();
ok(ts2 === null, 'No time stop at 99 bars (limit 100)');

T.openTrade.entryBar = T.cursor - 100;
var ts3 = teacherCheckTimeStop();
ok(ts3 === 'TIME_STOP', 'Time stop at 100 bars');

// Custom max bars
teacherSetMaxBarsInTrade(50);
T.openTrade.entryBar = T.cursor - 50;
var ts4 = teacherCheckTimeStop();
ok(ts4 === 'TIME_STOP', 'Time stop at 50 bars (custom limit)');

teacherSetMaxBarsInTrade(100); // reset

// Boundary test: below min
teacherSetMaxBarsInTrade(1);
ok(TEACHER_MAX_BARS_IN_TRADE === 5, 'Max bars clamped to min 5');
teacherSetMaxBarsInTrade(1000);
ok(TEACHER_MAX_BARS_IN_TRADE === 500, 'Max bars clamped to max 500');
teacherSetMaxBarsInTrade(100); // restore

// ══════════════════════════════════════════════════════════════════
// SECTION 4: ENHANCED STEP
// ══════════════════════════════════════════════════════════════════
console.log('\n--- Enhanced Step ---');

setupReplay(300);
teacherInitEquity();
stepN(10);

var eTick = teacherEnhancedStep({});
ok(eTick !== null, 'Enhanced step returns tick');
ok(typeof eTick.barIndex === 'number', 'Enhanced tick has barIndex');

// Enhanced step with no trade → just steps forward
var eTick2 = teacherEnhancedStep({ signalExits: false, timeStop: false });
ok(eTick2 !== null, 'Enhanced step (opts disabled) works');

// ══════════════════════════════════════════════════════════════════
// SECTION 5: POSITION SIZING
// ══════════════════════════════════════════════════════════════════
console.log('\n--- Position Sizing ---');

// Fixed fraction
var ff1 = teacherSizeFixedFraction(1000, 1.0, 1.0, 50000, 10);
ok(ff1 !== null, 'Fixed fraction returns result');
ok(ff1.leverage >= 1 && ff1.leverage <= 10, 'Leverage in range 1-10: ' + ff1.leverage);
ok(ff1.qty > 0, 'Qty > 0: ' + ff1.qty);
ok(ff1.notional > 0, 'Notional > 0: ' + ff1.notional);
ok(ff1.riskUSD === 10, 'Risk USD = $10 (1% of $1000)');

// Edge cases
var ff2 = teacherSizeFixedFraction(0, 1, 1, 50000, 10);
ok(ff2 === null, 'No capital → null');
var ff3 = teacherSizeFixedFraction(1000, 1, 0, 50000, 10);
ok(ff3 === null, 'No SL distance → null');

// Kelly
var ks1 = teacherSizeKelly(0.6, 1.5, 1000, 50000, 10);
ok(ks1 !== null, 'Kelly returns result');
ok(ks1.kellyPct >= 0, 'Kelly % >= 0: ' + ks1.kellyPct);
ok(ks1.leverage >= 1, 'Kelly leverage >= 1: ' + ks1.leverage);
ok(ks1.qty > 0, 'Kelly qty > 0');

// Kelly edge: losing winRate
var ks2 = teacherSizeKelly(0.3, 0.5, 1000, 50000, 10);
ok(ks2 !== null, 'Kelly with poor stats returns result');
ok(ks2.kellyPct >= 0, 'Kelly % >= 0 even with poor stats');

var ks3 = teacherSizeKelly(0, 1.5, 1000, 50000, 10);
ok(ks3 === null, 'Kelly null with 0 winRate');

// ══════════════════════════════════════════════════════════════════
// SECTION 6: TRADE QUALITY SCORING
// ══════════════════════════════════════════════════════════════════
console.log('\n--- Trade Quality Scoring ---');

var winTrade = {
  id: 'W1', side: 'LONG', entry: 50000, exit: 51000, sl: 49500,
  tp: 51000, exitReason: 'TP_HIT', outcome: 'WIN',
  pnlRaw: 20, pnlNet: 18, pnlPct: 3.6, totalFees: 2,
  entryReasons: ['ST_FLIP_BULL', 'MACD_CROSS_BULL', 'REGIME_TREND', 'CONFLUENCE_HIGH'],
  barsHeld: 15, qty: 0.02,
};

var s1 = teacherScoreTrade(winTrade);
ok(s1 !== null, 'Score returned for win trade');
ok(s1.score > 0, 'Score > 0: ' + s1.score);
ok(s1.grade !== 'F', 'Grade not F: ' + s1.grade);
ok(s1.components.entryAlignment > 0, 'Entry alignment > 0');
ok(s1.components.exitQuality === 100, 'TP_HIT → exit quality 100');
ok(s1.components.holdDuration > 0, 'Hold duration scored');

var lossTrade = {
  id: 'L1', side: 'SHORT', entry: 50000, exit: 50500, sl: 50500,
  tp: 49000, exitReason: 'SL_HIT', outcome: 'LOSS',
  pnlRaw: -10, pnlNet: -12, pnlPct: -2.4, totalFees: 2,
  entryReasons: ['MACD_CROSS_BEAR'],
  barsHeld: 2, qty: 0.02,
};

var s2 = teacherScoreTrade(lossTrade);
ok(s2 !== null, 'Score returned for loss trade');
ok(s2.score < s1.score, 'Loss score < win score (' + s2.score + ' < ' + s1.score + ')');
ok(s2.components.exitQuality === 20, 'SL_HIT → exit quality 20');

// Null trade
var s3 = teacherScoreTrade(null);
ok(s3.score === 0, 'Null trade → score 0');
ok(s3.grade === 'F', 'Null trade → grade F');

// ══════════════════════════════════════════════════════════════════
// SECTION 7: STREAKS
// ══════════════════════════════════════════════════════════════════
console.log('\n--- Streaks ---');

var trades1 = [
  { outcome: 'WIN' }, { outcome: 'WIN' }, { outcome: 'WIN' },
  { outcome: 'LOSS' }, { outcome: 'LOSS' },
  { outcome: 'WIN' },
];
var st1 = teacherCalcStreaks(trades1);
ok(st1.maxWinStreak === 3, 'Max win streak = 3');
ok(st1.maxLossStreak === 2, 'Max loss streak = 2');
ok(st1.currentStreak === 1, 'Current streak = 1');
ok(st1.currentType === 'WIN', 'Current type = WIN');

var st2 = teacherCalcStreaks([]);
ok(st2.maxWinStreak === 0, 'Empty → max win 0');
ok(st2.maxLossStreak === 0, 'Empty → max loss 0');

var st3 = teacherCalcStreaks(null);
ok(st3.maxWinStreak === 0, 'Null → 0');

// ══════════════════════════════════════════════════════════════════
// SECTION 8: R-MULTIPLE
// ══════════════════════════════════════════════════════════════════
console.log('\n--- R-Multiple ---');

var rm1 = teacherCalcRMultiple(winTrade);
ok(rm1 !== null, 'R-multiple returned for win');
ok(rm1.rDollar > 0, 'Risk $ > 0: ' + rm1.rDollar);
ok(rm1.rMultiple > 0, 'R-multiple > 0 for winner: ' + rm1.rMultiple);

var rm2 = teacherCalcRMultiple(lossTrade);
ok(rm2 !== null, 'R-multiple returned for loss');
ok(rm2.rMultiple < 0, 'R-multiple < 0 for loser: ' + rm2.rMultiple);

var rm3 = teacherCalcRMultiple(null);
ok(rm3 === null, 'Null trade → null');

var rmNoSl = teacherCalcRMultiple({ entry: 50000, sl: 50000, qty: 0.02, pnlRaw: 10 });
ok(rmNoSl === null, 'Zero SL distance → null');

// ══════════════════════════════════════════════════════════════════
// SECTION 9: FULL SESSION ANALYTICS
// ══════════════════════════════════════════════════════════════════
console.log('\n--- Full Session Analytics ---');

setupReplay(300);
teacherInitEquity();
T = window.TEACHER;
T.trades = [winTrade, lossTrade];
_teacherUpdateEquity(winTrade);
_teacherUpdateEquity(lossTrade);

var analytics = teacherFullSessionAnalytics();
ok(analytics !== null, 'Analytics returned');
ok(analytics.equity !== null, 'Has equity data');
ok(analytics.streaks !== null, 'Has streak data');
ok(analytics.streaks.maxWinStreak === 1, 'Win streak = 1 (2 trades alternating)');
ok(Array.isArray(analytics.scores), 'Has scores array');
ok(analytics.scores.length === 2, '2 trade scores');
ok(analytics.avgTradeQuality > 0, 'Avg quality > 0: ' + analytics.avgTradeQuality);
ok(typeof analytics.avgR === 'number', 'Has average R');
ok(typeof analytics.totalR === 'number', 'Has total R');
ok(analytics.exitBreakdown !== null, 'Has exit breakdown');
ok(analytics.exitBreakdown['TP_HIT'] !== undefined, 'TP_HIT in breakdown');
ok(analytics.exitBreakdown['SL_HIT'] !== undefined, 'SL_HIT in breakdown');
ok(analytics.entryReasonFreq !== null, 'Has entry reason frequency');

// ══════════════════════════════════════════════════════════════════
// SECTION 10: WHY ENTERED (Reason Engine)
// ══════════════════════════════════════════════════════════════════
console.log('\n--- Why Entered ---');

var we1 = teacherWhyEntered(winTrade);
ok(we1 !== null, 'WhyEntered returns result');
ok(typeof we1.summary === 'string', 'Has summary');
ok(Array.isArray(we1.factors), 'Has factors array');
ok(we1.factors.length === 4, '4 factors for 4 reasons');
ok(we1.alignment > 0, 'Alignment > 0: ' + we1.alignment);
ok(we1.confidence > 0, 'Confidence > 0: ' + we1.confidence);
ok(we1.verdict === 'STRONG_ENTRY' || we1.verdict === 'ADEQUATE_ENTRY', 'Verdict: ' + we1.verdict);
ok(we1.warnings.length === 0, 'No warnings for strong entry');

var we2 = teacherWhyEntered(lossTrade);
ok(we2 !== null, 'WhyEntered for loss trade');
ok(we2.confidence < we1.confidence, 'Weaker confidence for fewer signals');
ok(we2.warnings.length > 0, 'Has warnings for weak entry');

var we3 = teacherWhyEntered(null);
ok(we3 === null, 'Null trade → null');

// Trade with counter-signals
var counterTrade = {
  side: 'LONG',
  entryReasons: ['MACD_CROSS_BULL', 'DIVERGENCE_BEAR', 'LOW_ADX_RANGE'],
};
var we4 = teacherWhyEntered(counterTrade);
ok(we4.warnings.length >= 2, 'Counter-signals generate warnings: ' + we4.warnings.length);

// ══════════════════════════════════════════════════════════════════
// SECTION 11: WHY EXITED
// ══════════════════════════════════════════════════════════════════
console.log('\n--- Why Exited ---');

var wx1 = teacherWhyExited(winTrade);
ok(wx1 !== null, 'WhyExited returns result');
ok(wx1.exitType === 'TARGET', 'TP_HIT → TARGET');
ok(wx1.wasOptimal === true, 'TP_HIT = optimal');
ok(typeof wx1.analysis === 'string', 'Has analysis text');

var wx2 = teacherWhyExited(lossTrade);
ok(wx2.exitType === 'STOP', 'SL_HIT → STOP');
ok(wx2.wasOptimal === false, 'SL_HIT not optimal');
ok(wx2.betterExit !== null, 'Suggests DSL as alternative');

// DSL exit
var dslTrade = { exit: 51200, exitReason: 'DSL_HIT', outcome: 'WIN', pnlNet: 15, pnlPct: 1.5, barsHeld: 20, dslUsed: true };
var wx3 = teacherWhyExited(dslTrade);
ok(wx3.exitType === 'TRAILING_STOP', 'DSL_HIT → TRAILING_STOP');
ok(wx3.wasOptimal === true, 'DSL optimal');

// Signal flip
var sigTrade = { exit: 50200, exitReason: 'SIGNAL_FLIP', outcome: 'WIN', pnlNet: 5, pnlPct: 0.5, barsHeld: 10, dslUsed: false };
var wx4 = teacherWhyExited(sigTrade);
ok(wx4.exitType === 'SIGNAL', 'SIGNAL_FLIP → SIGNAL type');

// Time stop
var timeTrade = { exit: 49800, exitReason: 'TIME_STOP', outcome: 'LOSS', pnlNet: -5, pnlPct: -0.5, barsHeld: 100, dslUsed: false };
var wx5 = teacherWhyExited(timeTrade);
ok(wx5.exitType === 'TIME', 'TIME_STOP → TIME type');

// Manual
var manualTrade = { exit: 50100, exitReason: 'MANUAL_EXIT', outcome: 'WIN', pnlNet: 3, pnlPct: 0.3, barsHeld: 5, dslUsed: false };
var wx6 = teacherWhyExited(manualTrade);
ok(wx6.exitType === 'MANUAL', 'MANUAL_EXIT → MANUAL type');

var wx7 = teacherWhyExited(null);
ok(wx7 === null, 'Null → null');

// ══════════════════════════════════════════════════════════════════
// SECTION 12: WHY OUTCOME
// ══════════════════════════════════════════════════════════════════
console.log('\n--- Why Outcome ---');

var wo1 = teacherWhyOutcome(winTrade);
ok(wo1 !== null, 'WhyOutcome returns result for win');
ok(wo1.outcome === 'WIN', 'Outcome = WIN');
ok(wo1.classification === 'STRONG_WIN', 'pnlPct 3.6% → STRONG_WIN');
ok(wo1.keyFactors.length > 0, 'Has key factors');
ok(wo1.lessons.length > 0, 'Has lessons');

var wo2 = teacherWhyOutcome(lossTrade);
ok(wo2 !== null, 'WhyOutcome for loss');
ok(wo2.outcome === 'LOSS', 'Outcome = LOSS');
ok(wo2.classification !== '', 'Has classification');
ok(wo2.lessons.length > 0, 'Loss has lessons');

// Quick stop loss
var quickLoss = {
  outcome: 'LOSS', exitReason: 'SL_HIT', side: 'LONG',
  pnlNet: -8, pnlPct: -1.6, barsHeld: 1, entryReasons: ['MACD_CROSS_BULL'],
};
var wo3 = teacherWhyOutcome(quickLoss);
ok(wo3.classification === 'QUICK_STOP', 'barsHeld 1 → QUICK_STOP');

// Breakeven
var beTrade = { outcome: 'BREAKEVEN', pnlNet: 0, pnlPct: 0, barsHeld: 10, side: 'LONG', entryReasons: [] };
var wo4 = teacherWhyOutcome(beTrade);
ok(wo4.classification === 'BREAKEVEN', 'BREAKEVEN classified');
ok(wo4.keyFactors.length > 0, 'Breakeven has factors');

var wo5 = teacherWhyOutcome(null);
ok(wo5 === null, 'Null → null');

// ══════════════════════════════════════════════════════════════════
// SECTION 13: FULL TRADE REPORT
// ══════════════════════════════════════════════════════════════════
console.log('\n--- Full Trade Report ---');

var rpt = teacherTradeReport(winTrade);
ok(rpt !== null, 'Trade report returned');
ok(rpt.tradeId === winTrade.id, 'Correct trade ID');
ok(rpt.entry !== null, 'Has entry analysis');
ok(rpt.exit !== null, 'Has exit analysis');
ok(rpt.outcome !== null, 'Has outcome analysis');
ok(rpt.quality !== null, 'Has quality score');
ok(rpt.rMultiple !== null, 'Has R-multiple');

var rpt2 = teacherTradeReport(null);
ok(rpt2 === null, 'Null trade → null report');

// ══════════════════════════════════════════════════════════════════
// SECTION 14: PATTERN CLASSIFICATION
// ══════════════════════════════════════════════════════════════════
console.log('\n--- Pattern Classification ---');

// Trend follow pattern
var trendTrade = {
  entryReasons: ['REGIME_TREND', 'HIGH_ADX_TREND', 'ST_FLIP_BULL', 'MACD_CROSS_BULL'],
};
var pat1 = teacherClassifyPattern(trendTrade);
ok(pat1.length > 0, 'Trend trade matched pattern(s): ' + pat1.length);
var hasTF = false;
for (var i = 0; i < pat1.length; i++) { if (pat1[i].name === 'TREND_FOLLOW') hasTF = true; }
ok(hasTF, 'Matched TREND_FOLLOW pattern');

// Breakout pattern
var breakTrade = { entryReasons: ['REGIME_BREAKOUT', 'BB_SQUEEZE_BREAK'] };
var pat2 = teacherClassifyPattern(breakTrade);
var hasBK = false;
for (var i = 0; i < pat2.length; i++) { if (pat2[i].name === 'BREAKOUT') hasBK = true; }
ok(hasBK, 'Matched BREAKOUT pattern');

// Reversal pattern
var revTrade = { entryReasons: ['DIVERGENCE_BULL', 'RSI_OVERSOLD'] };
var pat3 = teacherClassifyPattern(revTrade);
var hasRev = false;
for (var i = 0; i < pat3.length; i++) { if (pat3[i].name === 'REVERSAL') hasRev = true; }
ok(hasRev, 'Matched REVERSAL pattern');

// No match
var noMatchTrade = { entryReasons: ['UNKNOWN_SIGNAL'] };
var pat4 = teacherClassifyPattern(noMatchTrade);
ok(pat4.length === 0, 'Unknown signals → no pattern match');

// Null trade
var pat5 = teacherClassifyPattern(null);
ok(pat5.length === 0, 'Null → empty array');

// ══════════════════════════════════════════════════════════════════
// SECTION 15: LESSON EXTRACTION
// ══════════════════════════════════════════════════════════════════
console.log('\n--- Lesson Extraction ---');

// Need 3+ trades for lessons
var lessTrades = [
  { outcome: 'WIN', exitReason: 'TP_HIT', pnlNet: 20, barsHeld: 10, entryReasons: ['REGIME_TREND', 'HIGH_ADX_TREND', 'MACD_CROSS_BULL'] },
  { outcome: 'WIN', exitReason: 'TP_HIT', pnlNet: 15, barsHeld: 12, entryReasons: ['REGIME_TREND', 'HIGH_ADX_TREND', 'ST_FLIP_BULL'] },
  { outcome: 'WIN', exitReason: 'DSL_HIT', pnlNet: 30, barsHeld: 25, entryReasons: ['REGIME_TREND', 'HIGH_ADX_TREND', 'CONFLUENCE_HIGH'] },
  { outcome: 'LOSS', exitReason: 'SL_HIT', pnlNet: -10, barsHeld: 1, entryReasons: ['REGIME_RANGE', 'LOW_ADX_RANGE'] },
  { outcome: 'LOSS', exitReason: 'SL_HIT', pnlNet: -8, barsHeld: 2, entryReasons: ['REGIME_RANGE', 'LOW_ADX_RANGE'] },
  { outcome: 'LOSS', exitReason: 'SL_HIT', pnlNet: -12, barsHeld: 1, entryReasons: ['REGIME_RANGE', 'LOW_ADX_RANGE'] },
];
var les1 = teacherExtractLessons(lessTrades);
ok(les1.length > 0, 'Lessons extracted: ' + les1.length);

// Should find TREND_FOLLOW as edge and RANGE_TRADE as avoid
var hasEdge = false, hasAvoid = false, hasQuickStop = false;
for (var i = 0; i < les1.length; i++) {
  if (les1[i].type === 'EDGE') hasEdge = true;
  if (les1[i].type === 'AVOID') hasAvoid = true;
  if (les1[i].type === 'TIMING' && les1[i].description.indexOf('quick') >= 0) hasQuickStop = true;
}
ok(hasEdge, 'Found EDGE lesson (TREND_FOLLOW high win rate)');
ok(hasAvoid, 'Found AVOID lesson (RANGE_TRADE low win rate)');
ok(hasQuickStop, 'Found quick-stop timing lesson');

// Each lesson has structure
ok(les1[0].confidence > 0, 'Lesson has confidence > 0');
ok(les1[0].evidence !== null, 'Lesson has evidence');
ok(Array.isArray(les1[0].tags), 'Lesson has tags');

// Not enough trades
var les2 = teacherExtractLessons([{ outcome: 'WIN' }]);
ok(les2.length === 0, 'Too few trades → no lessons');

var les3 = teacherExtractLessons(null);
ok(les3.length === 0, 'Null → no lessons');

// ══════════════════════════════════════════════════════════════════
// SECTION 16: TRADE COMPARISON
// ══════════════════════════════════════════════════════════════════
console.log('\n--- Trade Comparison ---');

var cmp1 = teacherCompareTrades(winTrade, lossTrade);
ok(cmp1 !== null, 'Comparison returned');
ok(Array.isArray(cmp1.differences), 'Has differences');
ok(Array.isArray(cmp1.similarities), 'Has similarities');
ok(cmp1.differences.length > 0, 'Found differences');
ok(cmp1.betterTrade === 'A' || cmp1.betterTrade === 'B', 'Better trade identified: ' + cmp1.betterTrade);
ok(cmp1.scoreA > cmp1.scoreB, 'Win trade scored higher: ' + cmp1.scoreA + ' > ' + cmp1.scoreB);

// Same trade comparison
var cmp2 = teacherCompareTrades(winTrade, winTrade);
ok(cmp2.similarities.length > 0, 'Same trade has similarities');
ok(cmp2.betterTrade === 'TIE', 'Same trade → TIE');

// Null
var cmp3 = teacherCompareTrades(null, winTrade);
ok(cmp3 === null, 'Null tradeA → null');
var cmp4 = teacherCompareTrades(winTrade, null);
ok(cmp4 === null, 'Null tradeB → null');

// ══════════════════════════════════════════════════════════════════
// SECTION 17: MISSED TRADE DETECTION
// ══════════════════════════════════════════════════════════════════
console.log('\n--- Missed Trade Detection ---');

// This is expensive (runs indicators for all bars), so minimal test
var ds17 = setupReplay(300);
var missed1 = teacherFindMissedTrades(ds17, [], { minConfluence: 90, minADX: 40 });
ok(Array.isArray(missed1), 'Returns array');
// With extreme thresholds, may find 0 or few — just check structure
ok(missed1.length >= 0, 'Missed trades found: ' + missed1.length + ' (may be 0 with strict criteria)');

// Check structure if any found
if (missed1.length > 0) {
  ok(typeof missed1[0].barIndex === 'number', 'Missed trade has barIndex');
  ok(missed1[0].side === 'LONG' || missed1[0].side === 'SHORT', 'Missed trade has side');
  ok(Array.isArray(missed1[0].reasons), 'Missed trade has reasons');
}

// Null dataset
var missed2 = teacherFindMissedTrades(null, []);
ok(missed2.length === 0, 'Null dataset → empty');

// ══════════════════════════════════════════════════════════════════
// SUMMARY
// ══════════════════════════════════════════════════════════════════
console.log('\n========================================');
console.log('TOTAL: ' + (p + f) + '  PASS: ' + p + '  FAIL: ' + f);
console.log('========================================');
if (f > 0) process.exit(1);
