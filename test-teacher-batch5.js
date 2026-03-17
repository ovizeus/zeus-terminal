// THE TEACHER Batch 5 — Stats + Calibration + Memory smoke test
// Tests core stats, grouped stats, rolling, distribution, hourly,
// top/bottom, session comparison, calibration curve/score/zones/advice,
// memory consolidation, pattern memory, pre-trade lookback, memory management

var window = globalThis;
globalThis.window = globalThis;
// Stub localStorage for Node
globalThis.localStorage = (function () {
  var store = {};
  return {
    getItem: function (k) { return store[k] || null; },
    setItem: function (k, v) { store[k] = String(v); },
    removeItem: function (k) { delete store[k]; },
  };
})();

var vm = require('vm');
var fs = require('fs');

// Load all teacher files in dependency order
var files = [
  'teacherConfig.js', 'teacherIndicators.js', 'teacherStorage.js',
  'teacherDataset.js', 'teacherEngine.js', 'teacherSimulator.js',
  'teacherReason.js', 'teacherStats.js', 'teacherCalibration.js', 'teacherMemory.js',
];
for (var i = 0; i < files.length; i++) {
  vm.runInThisContext(fs.readFileSync('public/js/teacher/' + files[i], 'utf8'));
}

var p = 0, f = 0;
function ok(cond, msg) {
  if (cond) { p++; console.log('  PASS: ' + msg); }
  else { f++; console.log('  FAIL: ' + msg); }
}

// ── Sample trades ──
function makeTrades() {
  return [
    { id: 'T1', side: 'LONG', outcome: 'WIN', pnlNet: 25, pnlPct: 2.5, pnlRaw: 27, totalFees: 2, barsHeld: 12, exitReason: 'TP_HIT', entryReasons: ['REGIME_TREND', 'HIGH_ADX_TREND', 'MACD_CROSS_BULL', 'ST_FLIP_BULL'], entry: 50000, sl: 49500, tp: 51000, qty: 0.02, entryTs: 1700000000 },
    { id: 'T2', side: 'SHORT', outcome: 'LOSS', pnlNet: -10, pnlPct: -1.0, pnlRaw: -8, totalFees: 2, barsHeld: 3, exitReason: 'SL_HIT', entryReasons: ['MACD_CROSS_BEAR'], entry: 50500, sl: 51000, tp: 49500, qty: 0.02, entryTs: 1700003600 },
    { id: 'T3', side: 'LONG', outcome: 'WIN', pnlNet: 40, pnlPct: 4.0, pnlRaw: 42, totalFees: 2, barsHeld: 20, exitReason: 'DSL_HIT', entryReasons: ['REGIME_TREND', 'HIGH_ADX_TREND', 'CONFLUENCE_HIGH'], entry: 51000, sl: 50500, tp: 52000, qty: 0.02, entryTs: 1700007200 },
    { id: 'T4', side: 'LONG', outcome: 'WIN', pnlNet: 15, pnlPct: 1.5, pnlRaw: 17, totalFees: 2, barsHeld: 8, exitReason: 'TP_HIT', entryReasons: ['REGIME_TREND', 'HIGH_ADX_TREND', 'ST_FLIP_BULL'], entry: 52000, sl: 51500, tp: 53000, qty: 0.02, entryTs: 1700010800 },
    { id: 'T5', side: 'SHORT', outcome: 'LOSS', pnlNet: -8, pnlPct: -0.8, pnlRaw: -6, totalFees: 2, barsHeld: 2, exitReason: 'SL_HIT', entryReasons: ['REGIME_RANGE', 'LOW_ADX_RANGE'], entry: 53000, sl: 53500, tp: 52000, qty: 0.02, entryTs: 1700014400 },
    { id: 'T6', side: 'LONG', outcome: 'LOSS', pnlNet: -12, pnlPct: -1.2, pnlRaw: -10, totalFees: 2, barsHeld: 1, exitReason: 'SL_HIT', entryReasons: ['REGIME_RANGE', 'LOW_ADX_RANGE'], entry: 52500, sl: 52000, tp: 53500, qty: 0.02, entryTs: 1700018000 },
    { id: 'T7', side: 'LONG', outcome: 'WIN', pnlNet: 30, pnlPct: 3.0, pnlRaw: 32, totalFees: 2, barsHeld: 15, exitReason: 'TP_HIT', entryReasons: ['REGIME_BREAKOUT', 'BB_SQUEEZE_BREAK', 'MACD_CROSS_BULL'], entry: 52000, sl: 51500, tp: 53500, qty: 0.02, entryTs: 1700021600 },
    { id: 'T8', side: 'SHORT', outcome: 'LOSS', pnlNet: -5, pnlPct: -0.5, pnlRaw: -3, totalFees: 2, barsHeld: 45, exitReason: 'TIME_STOP', entryReasons: ['MACD_CROSS_BEAR', 'ST_FLIP_BEAR'], entry: 53500, sl: 54000, tp: 52500, qty: 0.02, entryTs: 1700025200 },
  ];
}

console.log('=== THE TEACHER — Batch 5 Stats + Calibration + Memory Test ===\n');

// ══════════════════════════════════════════════════════════════════
// SECTION 1: CORE STATS
// ══════════════════════════════════════════════════════════════════
console.log('--- Core Stats ---');
var trades = makeTrades();
var stats = teacherComputeStats(trades);

ok(stats.totalTrades === 8, 'Total trades = 8');
ok(stats.wins === 4, 'Wins = 4');
ok(stats.losses === 4, 'Losses = 4');
ok(stats.winRate === 50, 'Win rate = 50%');
ok(stats.totalPnl === 75, 'Total PnL = $75');
ok(stats.grossWins > 0, 'Gross wins > 0: $' + stats.grossWins);
ok(stats.grossLosses > 0, 'Gross losses > 0: $' + stats.grossLosses);
ok(stats.profitFactor > 1, 'Profit factor > 1: ' + stats.profitFactor);
ok(stats.avgPnl > 0, 'Avg PnL > 0: $' + stats.avgPnl);
ok(stats.avgWin > 0, 'Avg win > 0: $' + stats.avgWin);
ok(stats.avgLoss > 0, 'Avg loss > 0: $' + stats.avgLoss);
ok(stats.wlRatio > 0, 'W/L ratio > 0: ' + stats.wlRatio);
ok(stats.expectancy > 0, 'Expectancy > 0: $' + stats.expectancy);
ok(stats.totalFees === 16, 'Total fees = $16');
ok(stats.bestTrade.id === 'T3', 'Best trade = T3 ($40)');
ok(stats.worstTrade.id === 'T6', 'Worst trade = T6 (-$12)');
ok(stats.longWinRate > 0, 'Long win rate: ' + stats.longWinRate + '%');
ok(stats.shortWinRate >= 0, 'Short win rate: ' + stats.shortWinRate + '%');
ok(stats.avgBarsHeld > 0, 'Avg bars held: ' + stats.avgBarsHeld);

// Empty stats
var empty = teacherComputeStats([]);
ok(empty.totalTrades === 0, 'Empty → 0 trades');
ok(empty.winRate === 0, 'Empty → 0% win rate');

var nullStats = teacherComputeStats(null);
ok(nullStats.totalTrades === 0, 'Null → empty stats');

// ══════════════════════════════════════════════════════════════════
// SECTION 2: GROUPED STATS
// ══════════════════════════════════════════════════════════════════
console.log('\n--- Grouped Stats ---');

var bySide = teacherStatsBySide(trades);
ok(bySide['LONG'] !== undefined, 'Has LONG group');
ok(bySide['SHORT'] !== undefined, 'Has SHORT group');
ok(bySide['LONG'].totalTrades === 5, 'LONG: 5 trades');
ok(bySide['SHORT'].totalTrades === 3, 'SHORT: 3 trades');

var byExit = teacherStatsByExitReason(trades);
ok(byExit['TP_HIT'] !== undefined, 'Has TP_HIT group');
ok(byExit['SL_HIT'] !== undefined, 'Has SL_HIT group');
ok(byExit['DSL_HIT'] !== undefined, 'Has DSL_HIT group');
ok(byExit['TP_HIT'].totalTrades === 3, 'TP_HIT: 3 trades');

var byRegime = teacherStatsByRegime(trades);
ok(byRegime['TREND'] !== undefined, 'Has TREND regime');
ok(byRegime['RANGE'] !== undefined, 'Has RANGE regime');
ok(byRegime['TREND'].winRate === 100, 'TREND regime: 100% win rate');
ok(byRegime['RANGE'].winRate === 0, 'RANGE regime: 0% win rate');

var byPattern = teacherStatsByPattern(trades);
ok(Object.keys(byPattern).length > 0, 'Has pattern groups: ' + Object.keys(byPattern).length);

// Custom group function
var byBarsGroup = teacherGroupStats(trades, function (t) {
  return t.barsHeld <= 5 ? 'SHORT_HOLD' : 'LONG_HOLD';
});
ok(byBarsGroup['SHORT_HOLD'] !== undefined, 'Has SHORT_HOLD group');
ok(byBarsGroup['LONG_HOLD'] !== undefined, 'Has LONG_HOLD group');

// ══════════════════════════════════════════════════════════════════
// SECTION 3: ROLLING STATS
// ══════════════════════════════════════════════════════════════════
console.log('\n--- Rolling Stats ---');

var roll3 = teacherRollingStats(trades, 3);
ok(roll3.totalTrades === 3, 'Rolling 3: last 3 trades');

var rollAll = teacherRollingStats(trades, 100);
ok(rollAll.totalTrades === 8, 'Rolling 100: all 8 trades');

var rollEmpty = teacherRollingStats([], 5);
ok(rollEmpty.totalTrades === 0, 'Rolling empty → 0');

// ══════════════════════════════════════════════════════════════════
// SECTION 4: PNL DISTRIBUTION
// ══════════════════════════════════════════════════════════════════
console.log('\n--- PnL Distribution ---');

var dist = teacherPnlDistribution(trades, 10);
ok(dist.length > 0, 'Distribution has buckets: ' + dist.length);
ok(dist[0].from !== undefined, 'Bucket has from');
ok(dist[0].to !== undefined, 'Bucket has to');
ok(dist[0].count > 0, 'Bucket has count');

var totalInBuckets = 0;
for (var i = 0; i < dist.length; i++) totalInBuckets += dist[i].count;
ok(totalInBuckets === 8, 'All 8 trades in buckets');

var distEmpty = teacherPnlDistribution([], 5);
ok(distEmpty.length === 0, 'Empty → no buckets');

// ══════════════════════════════════════════════════════════════════
// SECTION 5: HOURLY PERFORMANCE
// ══════════════════════════════════════════════════════════════════
console.log('\n--- Hourly Performance ---');

var hourly = teacherHourlyPerformance(trades);
ok(hourly.length === 24, '24 hourly buckets');
var totalHourlyTrades = 0;
for (var i = 0; i < 24; i++) totalHourlyTrades += hourly[i].trades;
ok(totalHourlyTrades === 8, 'All 8 trades distributed by hour');

// Check a known hour (entryTs 1700000000 = some UTC hour)
var d = new Date(1700000000 * 1000);
var expectedHour = d.getUTCHours();
ok(hourly[expectedHour].trades > 0, 'Hour ' + expectedHour + ' has trades');

var hourlyNull = teacherHourlyPerformance(null);
ok(hourlyNull.length === 24, 'Null → still 24 buckets');

// ══════════════════════════════════════════════════════════════════
// SECTION 6: TOP / BOTTOM TRADES
// ══════════════════════════════════════════════════════════════════
console.log('\n--- Top / Bottom Trades ---');

var top3 = teacherTopTrades(trades, 3);
ok(top3.length === 3, 'Top 3 returned');
ok(top3[0].pnlNet >= top3[1].pnlNet, 'Top sorted descending');
ok(top3[0].id === 'T3', 'Top 1 = T3 ($40)');

var bot3 = teacherBottomTrades(trades, 3);
ok(bot3.length === 3, 'Bottom 3 returned');
ok(bot3[0].pnlNet <= bot3[1].pnlNet, 'Bottom sorted ascending');
ok(bot3[0].id === 'T6', 'Bottom 1 = T6 (-$12)');

var topEmpty = teacherTopTrades([], 5);
ok(topEmpty.length === 0, 'Empty → no top trades');

// ══════════════════════════════════════════════════════════════════
// SECTION 7: SESSION COMPARISON
// ══════════════════════════════════════════════════════════════════
console.log('\n--- Session Comparison ---');

var sessionStats = teacherComputeStats(trades.slice(0, 4)); // first 4 trades (3W 1L)
var overallStats = teacherComputeStats(trades); // all 8 trades

var cmp = teacherCompareSessionStats(sessionStats, overallStats);
ok(cmp.improvements.length + cmp.regressions.length + cmp.neutral.length > 0, 'Comparison has items');
ok(Array.isArray(cmp.improvements), 'Has improvements array');
ok(Array.isArray(cmp.regressions), 'Has regressions array');

// Session with 75% WR vs overall 50% → should have improvement in winRate
var hasWRImprovement = false;
for (var i = 0; i < cmp.improvements.length; i++) {
  if (cmp.improvements[i].key === 'winRate') hasWRImprovement = true;
}
ok(hasWRImprovement, 'Win rate improvement detected (75% vs 50%)');

var cmpNull = teacherCompareSessionStats(null, overallStats);
ok(cmpNull.improvements.length === 0, 'Null session → empty');

// ══════════════════════════════════════════════════════════════════
// SECTION 8: AGGREGATE STATS
// ══════════════════════════════════════════════════════════════════
console.log('\n--- Aggregate Stats ---');

var sessions = [
  { trades: trades.slice(0, 4) },
  { trades: trades.slice(4) },
];
var agg = teacherAggregateStats(sessions);
ok(agg.totalTrades === 8, 'Aggregated 8 trades from 2 sessions');
ok(agg.sessionCount === 2, 'Session count = 2');
ok(agg.totalPnl === 75, 'Aggregated PnL = $75');

var aggEmpty = teacherAggregateStats([]);
ok(aggEmpty.totalTrades === 0, 'Empty sessions → 0');

// ══════════════════════════════════════════════════════════════════
// SECTION 9: CALIBRATION DATA
// ══════════════════════════════════════════════════════════════════
console.log('\n--- Calibration Data ---');

var calibData = teacherBuildCalibrationData(trades);
ok(calibData.length === 8, 'Calibration data for 8 trades');
ok(typeof calibData[0].predicted === 'number', 'Has predicted confidence');
ok(typeof calibData[0].actual === 'number', 'Has actual outcome');
ok(typeof calibData[0].delta === 'number', 'Has delta');

var calibEmpty = teacherBuildCalibrationData([]);
ok(calibEmpty.length === 0, 'Empty → no data');

// ══════════════════════════════════════════════════════════════════
// SECTION 10: CALIBRATION CURVE
// ══════════════════════════════════════════════════════════════════
console.log('\n--- Calibration Curve ---');

var curve = teacherCalibrationCurve(calibData, 20);
ok(curve.length > 0, 'Curve has buckets: ' + curve.length);
ok(typeof curve[0].predictedAvg === 'number', 'Bucket has predictedAvg');
ok(typeof curve[0].actualWinRate === 'number', 'Bucket has actualWinRate');
ok(typeof curve[0].gap === 'number', 'Bucket has gap');
ok(curve[0].count > 0, 'Bucket has count');

var curveEmpty = teacherCalibrationCurve([], 20);
ok(curveEmpty.length === 0, 'Empty → no curve');

// ══════════════════════════════════════════════════════════════════
// SECTION 11: CALIBRATION SCORE
// ══════════════════════════════════════════════════════════════════
console.log('\n--- Calibration Score ---');

var cScore = teacherCalibrationScore(curve);
ok(cScore.score >= 0 && cScore.score <= 100, 'Score in 0-100: ' + cScore.score);
ok(typeof cScore.rating === 'string', 'Has rating: ' + cScore.rating);
ok(typeof cScore.avgGap === 'number', 'Has avgGap: ' + cScore.avgGap);
ok(typeof cScore.details === 'string', 'Has details');

var cScoreEmpty = teacherCalibrationScore([]);
ok(cScoreEmpty.rating === 'INSUFFICIENT_DATA', 'Empty → INSUFFICIENT_DATA');

// ══════════════════════════════════════════════════════════════════
// SECTION 12: CONFIDENCE ZONES
// ══════════════════════════════════════════════════════════════════
console.log('\n--- Confidence Zones ---');

var zones = teacherConfidenceZones(curve);
ok(zones.overconfident !== undefined, 'Has overconfident array');
ok(zones.underconfident !== undefined, 'Has underconfident array');
ok(zones.wellCalibrated !== undefined, 'Has wellCalibrated array');
var totalZoned = zones.overconfident.length + zones.underconfident.length + zones.wellCalibrated.length;
ok(totalZoned >= 0, 'Total zones: ' + totalZoned);

var zonesNull = teacherConfidenceZones(null);
ok(zonesNull.overconfident.length === 0, 'Null → empty zones');

// ══════════════════════════════════════════════════════════════════
// SECTION 13: CALIBRATION ADVICE
// ══════════════════════════════════════════════════════════════════
console.log('\n--- Calibration Advice ---');

var advice = teacherCalibrationAdvice(curve, zones);
ok(Array.isArray(advice), 'Advice is array');
// If there are zones, there should be advice
if (zones.overconfident.length > 0 || zones.underconfident.length > 0 || zones.wellCalibrated.length > 0) {
  ok(advice.length > 0, 'Has advice items: ' + advice.length);
} else {
  ok(true, 'No zones → no advice (OK)');
}

var adviceNull = teacherCalibrationAdvice(null, null);
ok(adviceNull.length === 0, 'Null → no advice');

// ══════════════════════════════════════════════════════════════════
// SECTION 14: FULL CALIBRATION REPORT
// ══════════════════════════════════════════════════════════════════
console.log('\n--- Full Calibration Report ---');

var report = teacherCalibrationReport(trades);
ok(report !== null, 'Report returned');
ok(report.data.length === 8, 'Report has 8 data points');
ok(report.curve.length > 0, 'Report has curve');
ok(report.score.score >= 0, 'Report has score');
ok(report.zones !== null, 'Report has zones');
ok(Array.isArray(report.advice), 'Report has advice');
ok(report.totalTrades === 8, 'Report total = 8');

// ══════════════════════════════════════════════════════════════════
// SECTION 15: MEMORY CONSOLIDATION
// ══════════════════════════════════════════════════════════════════
console.log('\n--- Memory Consolidation ---');

// Reset TEACHER state
window.TEACHER = _initTeacherState();

var lessons = teacherExtractLessons(trades);
ok(lessons.length > 0, 'Lessons extracted: ' + lessons.length);

var consol = teacherConsolidateMemory(lessons);
ok(consol.added > 0, 'Lessons added to memory: ' + consol.added);
ok(consol.added + consol.updated + consol.skipped === lessons.length, 'All lessons accounted for');

// Check memory has entries
var mem = window.TEACHER.memory;
ok(mem.edges.length > 0, 'Edges in memory: ' + mem.edges.length);

// Consolidate again → should update, not add
var consol2 = teacherConsolidateMemory(lessons);
ok(consol2.updated > 0, 'Second consolidation updates existing: ' + consol2.updated);

// Empty/null
var consolNull = teacherConsolidateMemory(null);
ok(consolNull.added === 0, 'Null → no adds');

// ══════════════════════════════════════════════════════════════════
// SECTION 16: PATTERN MEMORY
// ══════════════════════════════════════════════════════════════════
console.log('\n--- Pattern Memory ---');

var patResult = teacherUpdatePatternMemory(trades);
ok(patResult.newPatterns > 0, 'New patterns added: ' + patResult.newPatterns);

// Second update → should update existing
var patResult2 = teacherUpdatePatternMemory(trades);
ok(patResult2.patternsUpdated > 0, 'Patterns updated: ' + patResult2.patternsUpdated);

// Verify pattern data
var patterns = window.TEACHER.memory.patterns;
ok(patterns.length > 0, 'Patterns in memory: ' + patterns.length);
ok(typeof patterns[0].winRate === 'number', 'Pattern has winRate');
ok(typeof patterns[0].count === 'number', 'Pattern has count');
ok(patterns[0].count > 0, 'Pattern count > 0: ' + patterns[0].count);

var patEmpty = teacherUpdatePatternMemory([]);
ok(patEmpty.newPatterns === 0, 'Empty → no patterns');

// ══════════════════════════════════════════════════════════════════
// SECTION 17: PRE-TRADE LOOKBACK
// ══════════════════════════════════════════════════════════════════
console.log('\n--- Pre-Trade Lookback ---');

var indicators = {
  regime: 'TREND', adx: 30, macdDir: 'bull', stDir: 'bull', confluence: 70,
};
var lookback = teacherPreTradeLookback('LONG', indicators);
ok(lookback !== null, 'Lookback returned');
ok(Array.isArray(lookback.warnings), 'Has warnings');
ok(Array.isArray(lookback.edges), 'Has edges');
ok(Array.isArray(lookback.patternInfo), 'Has patternInfo');
ok(typeof lookback.memoryScore === 'number', 'Has memoryScore: ' + lookback.memoryScore);

// RANGE regime should trigger warnings (if memory has negative RANGE data)
var rangeInd = { regime: 'RANGE', adx: 15, macdDir: 'bull', stDir: 'bull', confluence: 70 };
var lookback2 = teacherPreTradeLookback('LONG', rangeInd);
ok(lookback2 !== null, 'Range lookback returned');
// Depending on memory content, may or may not have warnings
ok(typeof lookback2.memoryScore === 'number', 'Range memoryScore: ' + lookback2.memoryScore);

// Empty memory
var noMem = teacherPreTradeLookback('LONG', null);
ok(noMem.memoryScore === 50, 'No indicators → base score 50');

// ══════════════════════════════════════════════════════════════════
// SECTION 18: END-OF-SESSION MEMORY UPDATE
// ══════════════════════════════════════════════════════════════════
console.log('\n--- End-of-Session Memory Update ---');

window.TEACHER = _initTeacherState();
var endResult = teacherEndSessionMemoryUpdate(trades);
ok(endResult.lessonsConsolidated.added > 0, 'End-session: lessons added');
ok(endResult.patternsResult.newPatterns > 0, 'End-session: patterns added');
ok(typeof endResult.saved === 'boolean', 'End-session: saved flag');

var endEmpty = teacherEndSessionMemoryUpdate([]);
ok(endEmpty.lessonsConsolidated.added === 0, 'Empty trades → no memory update');

// ══════════════════════════════════════════════════════════════════
// SECTION 19: MEMORY SUMMARY
// ══════════════════════════════════════════════════════════════════
console.log('\n--- Memory Summary ---');

var summary = teacherMemorySummary();
ok(summary.totalPatterns > 0, 'Summary: patterns > 0');
ok(summary.totalEdges > 0, 'Summary: edges > 0');
ok(typeof summary.activeMistakes === 'number', 'Summary: has activeMistakes count');
// topEdge might be null if no edge meets criteria
ok(summary.topEdge === null || typeof summary.topEdge.winRate === 'number', 'Summary: topEdge valid');

// ══════════════════════════════════════════════════════════════════
// SECTION 20: RESOLVE / DEACTIVATE / CLEAR
// ══════════════════════════════════════════════════════════════════
console.log('\n--- Memory Management ---');

// Add a test mistake
window.TEACHER.memory.mistakes.push({ id: 'M_TEST', description: 'Test', type: 'TIMING', tags: ['TEST'], frequency: 3, severity: 'HIGH', resolved: false });
ok(teacherResolveMistake('M_TEST') === true, 'Resolve mistake → true');
ok(window.TEACHER.memory.mistakes[window.TEACHER.memory.mistakes.length - 1].resolved === true, 'Mistake now resolved');
ok(teacherResolveMistake('NONEXIST') === false, 'Resolve nonexistent → false');

// Add a test edge
window.TEACHER.memory.edges.push({ id: 'E_TEST', description: 'Test edge', type: 'EDGE', tags: ['TEST'], active: true, winRate: 80, sampleSize: 10, confidence: 70 });
ok(teacherDeactivateEdge('E_TEST') === true, 'Deactivate edge → true');
var lastEdge = window.TEACHER.memory.edges[window.TEACHER.memory.edges.length - 1];
ok(lastEdge.active === false, 'Edge now inactive');
ok(teacherDeactivateEdge('NONEXIST') === false, 'Deactivate nonexistent → false');

// Clear
ok(teacherClearMemory() === true, 'Clear memory → true');
ok(window.TEACHER.memory.patterns.length === 0, 'Patterns cleared');
ok(window.TEACHER.memory.edges.length === 0, 'Edges cleared');
ok(window.TEACHER.memory.mistakes.length === 0, 'Mistakes cleared');

// ══════════════════════════════════════════════════════════════════
// SUMMARY
// ══════════════════════════════════════════════════════════════════
console.log('\n========================================');
console.log('TOTAL: ' + (p + f) + '  PASS: ' + p + '  FAIL: ' + f);
console.log('========================================');
if (f > 0) process.exit(1);
