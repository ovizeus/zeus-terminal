// Zeus v122 — teacher/teacherCurriculum.js
// TEACHER V2 — Autonomous Curriculum Engine
// Manages dataset rotation, regime coverage, cross-validation,
// anti-overfit protection, and learning segment separation
// 100% sandboxed — reads ONLY Binance public API + TEACHER state
'use strict';

// ══════════════════════════════════════════════════════════════════
// CURRICULUM CONSTANTS
// ══════════════════════════════════════════════════════════════════

// Binance Futures start: Sept 2019 → present
var TEACHER_CURRICULUM_START_YEAR = 2019;
var TEACHER_CURRICULUM_START_MONTH = 10; // October (first full month)

var TEACHER_ALL_TFS = ['1m', '3m', '5m', '15m', '1h', '4h'];

// Segment length in days by TF
var TEACHER_SEGMENT_DAYS = {
  '1m': 3,    // 3 days of 1m = ~4320 bars
  '3m': 7,    // 7 days of 3m = ~3360 bars
  '5m': 10,   // 10 days of 5m = ~2880 bars
  '15m': 21,  // 21 days of 15m = ~2016 bars
  '1h': 45,   // 45 days of 1h = ~1080 bars
  '4h': 90,   // 90 days of 4h = ~540 bars
};

// ══════════════════════════════════════════════════════════════════
// CURRICULUM STATE — tracks what has been tested
// ══════════════════════════════════════════════════════════════════

function teacherInitCurriculum() {
  return {
    // Track coverage
    testedSegments: [],     // [{year, month, tf, profile, regime, isOOS, sessionId}]
    regimeCoverage: {},     // { TREND: n, RANGE: n, ... }
    tfCoverage: {},         // { '5m': n, '15m': n, ... }
    profileCoverage: {},    // { FAST: n, SWING: n, DEFENSE: n }

    // Cross-validation state
    oosSegments: [],        // out-of-sample segment indices (for validation)
    isSegments: [],         // in-sample segment indices (for learning)
    oosStats: null,         // stats from OOS segments only
    isStats: null,          // stats from IS segments only

    // Anti-overfit
    lastYear: 0,
    lastMonth: 0,
    lastTF: '',
    consecutiveSameRegime: 0,
    lastRegime: '',

    // Curriculum position
    totalSessions: 0,
    currentPhase: 'EXPLORE', // EXPLORE | DEEPEN | VALIDATE
  };
}

// ══════════════════════════════════════════════════════════════════
// AVAILABLE MONTHS — Generate pool of (year, month) pairs
// ══════════════════════════════════════════════════════════════════

function _teacherGetAvailableMonths() {
  var months = [];
  var now = new Date();
  var curYear = now.getFullYear();
  var curMonth = now.getMonth() + 1; // 1-12

  for (var y = TEACHER_CURRICULUM_START_YEAR; y <= curYear; y++) {
    var startM = (y === TEACHER_CURRICULUM_START_YEAR) ? TEACHER_CURRICULUM_START_MONTH : 1;
    var endM = (y === curYear) ? curMonth - 1 : 12; // exclude current month (incomplete)
    for (var m = startM; m <= endM; m++) {
      months.push({ year: y, month: m });
    }
  }
  return months;
}

// ══════════════════════════════════════════════════════════════════
// SEGMENT PICKER — Choose next dataset segment to replay
// Anti-overfit: rotates across years, months, TFs, avoids repeats
// ══════════════════════════════════════════════════════════════════

function teacherPickNextSegment(curriculum) {
  if (!curriculum) curriculum = teacherInitCurriculum();

  var allMonths = _teacherGetAvailableMonths();
  if (allMonths.length === 0) return null;

  // ── Decide TF ──
  // Rotate through TFs to ensure coverage
  var tfPool = TEACHER_ALL_TFS.slice();
  // Move least-tested TFs to front
  tfPool.sort(function (a, b) {
    var ca = (curriculum.tfCoverage[a] || 0);
    var cb = (curriculum.tfCoverage[b] || 0);
    return ca - cb;
  });
  // Avoid repeating same TF twice in a row unless we must
  var tf = tfPool[0];
  if (tf === curriculum.lastTF && tfPool.length > 1) tf = tfPool[1];

  // ── Decide month ──
  // Score each month: lower score = more likely to be picked (less tested)
  var scoredMonths = [];
  for (var i = 0; i < allMonths.length; i++) {
    var ym = allMonths[i];
    var timesUsed = 0;
    for (var j = 0; j < curriculum.testedSegments.length; j++) {
      var seg = curriculum.testedSegments[j];
      if (seg.year === ym.year && seg.month === ym.month) timesUsed++;
    }
    // Penalize recent months (avoid current regime bias)
    var recencyPenalty = 0;
    if (ym.year === curriculum.lastYear && ym.month === curriculum.lastMonth) recencyPenalty = 100;

    scoredMonths.push({
      year: ym.year,
      month: ym.month,
      score: timesUsed * 10 + recencyPenalty + Math.random() * 3, // small random jitter
    });
  }
  scoredMonths.sort(function (a, b) { return a.score - b.score; });

  // Pick from top 5 least-tested (random among them for variety)
  var topN = Math.min(5, scoredMonths.length);
  var pick = scoredMonths[Math.floor(Math.random() * topN)];

  // ── Random offset within month (anti cherry-pick) ──
  var segDays = TEACHER_SEGMENT_DAYS[tf] || 14;
  var daysInMonth = new Date(pick.year, pick.month, 0).getDate(); // days in this month
  var maxOffset = Math.max(0, daysInMonth - segDays);
  var startDay = 1 + Math.floor(Math.random() * Math.max(1, maxOffset));

  var startMs = new Date(pick.year, pick.month - 1, startDay, 0, 0, 0).getTime();
  var endMs = startMs + segDays * 86400000;

  // Cap endMs to not exceed present
  var now = Date.now();
  if (endMs > now) endMs = now;
  if (startMs >= endMs) {
    // Fallback: last 7 days at this TF
    startMs = now - 7 * 86400000;
    endMs = now;
  }

  // ── Decide IS vs OOS ──
  // Every 4th session is OOS (out-of-sample validation)
  var isOOS = (curriculum.totalSessions > 0) && (curriculum.totalSessions % 4 === 0);

  return {
    tf: tf,
    startMs: startMs,
    endMs: endMs,
    year: pick.year,
    month: pick.month,
    startDay: startDay,
    segDays: segDays,
    isOOS: isOOS,
    phase: isOOS ? 'VALIDATE' : 'LEARN',
  };
}

// ══════════════════════════════════════════════════════════════════
// RECORD SEGMENT COMPLETION — Update curriculum tracking
// ══════════════════════════════════════════════════════════════════

function teacherRecordSegment(curriculum, segment, sessionResult) {
  if (!curriculum || !segment) return;

  // Record tested segment
  curriculum.testedSegments.push({
    year: segment.year,
    month: segment.month,
    tf: segment.tf,
    profile: sessionResult ? sessionResult.profile : 'UNKNOWN',
    regime: sessionResult ? sessionResult.dominantRegime : 'UNKNOWN',
    isOOS: segment.isOOS,
    sessionId: sessionResult ? sessionResult.sessionId : null,
    trades: sessionResult ? sessionResult.totalTrades : 0,
    pnl: sessionResult ? sessionResult.totalPnl : 0,
    winRate: sessionResult ? sessionResult.winRate : 0,
    timestamp: Date.now(),
  });

  // Cap testedSegments history
  if (curriculum.testedSegments.length > 500) {
    curriculum.testedSegments = curriculum.testedSegments.slice(-500);
  }

  // Update coverage maps
  curriculum.tfCoverage[segment.tf] = (curriculum.tfCoverage[segment.tf] || 0) + 1;
  if (sessionResult && sessionResult.profile) {
    curriculum.profileCoverage[sessionResult.profile] = (curriculum.profileCoverage[sessionResult.profile] || 0) + 1;
  }
  if (sessionResult && sessionResult.dominantRegime) {
    curriculum.regimeCoverage[sessionResult.dominantRegime] = (curriculum.regimeCoverage[sessionResult.dominantRegime] || 0) + 1;
  }

  // Anti-repeat tracking
  curriculum.lastYear = segment.year;
  curriculum.lastMonth = segment.month;
  curriculum.lastTF = segment.tf;
  curriculum.totalSessions++;

  // Regime consecutive tracking
  var thisRegime = sessionResult ? sessionResult.dominantRegime : '';
  if (thisRegime === curriculum.lastRegime) {
    curriculum.consecutiveSameRegime++;
  } else {
    curriculum.consecutiveSameRegime = 0;
  }
  curriculum.lastRegime = thisRegime;

  // Update phase
  if (curriculum.totalSessions < 5) curriculum.currentPhase = 'EXPLORE';
  else if (curriculum.totalSessions % 4 === 0) curriculum.currentPhase = 'VALIDATE';
  else curriculum.currentPhase = 'DEEPEN';
}

// ══════════════════════════════════════════════════════════════════
// CROSS-VALIDATION STATS — IS vs OOS comparison
// ══════════════════════════════════════════════════════════════════

function teacherComputeCrossValidation(curriculum) {
  if (!curriculum || !curriculum.testedSegments || curriculum.testedSegments.length < 4) {
    return { isStats: null, oosStats: null, gap: null, isValid: false, reason: 'INSUFFICIENT_DATA' };
  }

  var isSegs = [];
  var oosSegs = [];
  for (var i = 0; i < curriculum.testedSegments.length; i++) {
    var seg = curriculum.testedSegments[i];
    if (seg.isOOS) oosSegs.push(seg);
    else isSegs.push(seg);
  }

  if (oosSegs.length < 2) {
    return { isStats: null, oosStats: null, gap: null, isValid: false, reason: 'NEED_MORE_OOS' };
  }

  var isStats = _teacherAggSegmentStats(isSegs);
  var oosStats = _teacherAggSegmentStats(oosSegs);

  // Gap analysis
  var wrGap = Math.abs(isStats.avgWinRate - oosStats.avgWinRate);
  var pfGap = Math.abs(isStats.avgPF - oosStats.avgPF);
  var pnlGap = Math.abs(isStats.avgPnl - oosStats.avgPnl);

  var overfit = false;
  var overfitReason = [];
  // If IS is much better than OOS, signal overfit
  if (wrGap > 15) { overfit = true; overfitReason.push('WR_GAP:' + wrGap.toFixed(1)); }
  if (isStats.avgPF > 0 && oosStats.avgPF > 0 && isStats.avgPF / oosStats.avgPF > 2) {
    overfit = true; overfitReason.push('PF_RATIO:' + (isStats.avgPF / oosStats.avgPF).toFixed(1));
  }

  return {
    isStats: isStats,
    oosStats: oosStats,
    gap: { winRate: wrGap, profitFactor: pfGap, pnl: pnlGap },
    overfit: overfit,
    overfitReasons: overfitReason,
    isValid: true,
    isSampleSize: isSegs.length,
    oosSampleSize: oosSegs.length,
  };
}

function _teacherAggSegmentStats(segs) {
  if (!segs || segs.length === 0) return { avgWinRate: 0, avgPF: 0, avgPnl: 0, totalTrades: 0 };

  var totalWR = 0, totalPF = 0, totalPnl = 0, totalTrades = 0;
  var count = 0;
  for (var i = 0; i < segs.length; i++) {
    if (segs[i].trades > 0) {
      totalWR += segs[i].winRate || 0;
      totalPnl += segs[i].pnl || 0;
      totalTrades += segs[i].trades || 0;
      count++;
    }
  }
  return {
    avgWinRate: count > 0 ? totalWR / count : 0,
    avgPF: 0, // PF computed at session level, not aggregated here
    avgPnl: count > 0 ? totalPnl / count : 0,
    totalTrades: totalTrades,
    sessions: count,
  };
}

// ══════════════════════════════════════════════════════════════════
// COVERAGE METRICS — For capability score
// ══════════════════════════════════════════════════════════════════

function teacherGetCoverageMetrics(curriculum) {
  if (!curriculum) return { regimePct: 0, tfPct: 0, profilePct: 0 };

  var targetRegimes = ['TREND', 'RANGE', 'SQUEEZE', 'EXPANSION', 'CAPITULATION', 'RECOVERY'];
  var coveredRegimes = 0;
  for (var i = 0; i < targetRegimes.length; i++) {
    if ((curriculum.regimeCoverage[targetRegimes[i]] || 0) >= 3) coveredRegimes++; // min 3 sessions
  }
  var regimePct = (coveredRegimes / targetRegimes.length) * 100;

  var coveredTFs = 0;
  for (var t = 0; t < TEACHER_ALL_TFS.length; t++) {
    if ((curriculum.tfCoverage[TEACHER_ALL_TFS[t]] || 0) >= 2) coveredTFs++;
  }
  var tfPct = (coveredTFs / TEACHER_ALL_TFS.length) * 100;

  var profiles = ['FAST', 'SWING', 'DEFENSE'];
  var coveredP = 0;
  for (var p = 0; p < profiles.length; p++) {
    if ((curriculum.profileCoverage[profiles[p]] || 0) >= 2) coveredP++;
  }
  var profilePct = (coveredP / profiles.length) * 100;

  return {
    regimePct: Math.round(regimePct),
    tfPct: Math.round(tfPct),
    profilePct: Math.round(profilePct),
    regimeDetail: curriculum.regimeCoverage,
    tfDetail: curriculum.tfCoverage,
    profileDetail: curriculum.profileCoverage,
  };
}

// ══════════════════════════════════════════════════════════════════
// FORCED ROTATION — If stuck on same regime/TF, force change
// ══════════════════════════════════════════════════════════════════

function teacherShouldForceRotation(curriculum) {
  if (!curriculum) return false;
  // Force rotation if same regime 3+ times consecutively
  if (curriculum.consecutiveSameRegime >= 3) return true;
  return false;
}

function teacherForceRotatedSegment(curriculum) {
  // Find least-covered regime and TF
  var targetRegimes = ['TREND', 'RANGE', 'SQUEEZE', 'EXPANSION'];
  var leastRegime = null;
  var leastCount = Infinity;
  for (var i = 0; i < targetRegimes.length; i++) {
    var c = curriculum.regimeCoverage[targetRegimes[i]] || 0;
    if (c < leastCount) { leastCount = c; leastRegime = targetRegimes[i]; }
  }

  // Pick TF we've tested least
  var leastTF = TEACHER_ALL_TFS[0];
  var ltCount = Infinity;
  for (var t = 0; t < TEACHER_ALL_TFS.length; t++) {
    var tc = curriculum.tfCoverage[TEACHER_ALL_TFS[t]] || 0;
    if (tc < ltCount) { ltCount = tc; leastTF = TEACHER_ALL_TFS[t]; }
  }

  // Pick random month, force the least-tested TF
  var seg = teacherPickNextSegment(curriculum);
  if (seg) {
    seg.tf = leastTF;
    seg.forcedRotation = true;
  }
  return seg;
}
