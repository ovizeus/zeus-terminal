// Zeus v122 — teacher/teacherCapability.js
// TEACHER V2 — Capability Score (0-100)
// 14-component weighted score + penalties
// Labels: WEAK / IMPROVING / DECENT / STRONG / ELITE
// 100% sandboxed — reads only from TEACHER.v2 state
'use strict';

// ══════════════════════════════════════════════════════════════════
// COMPONENT WEIGHTS
// ══════════════════════════════════════════════════════════════════

var TEACHER_CAPABILITY_WEIGHTS = {
  survivalRate:        15,
  drawdownControl:     12,
  profitFactor:        12,
  expectancy:          10,
  winRate:              8,
  calibrationQuality:   8,
  consistency:          8,
  regimeCoverage:       6,
  timeframeCoverage:    5,
  profileCoverage:      4,
  mistakeReduction:     4,
  edgeStability:        3,
  noTradeDiscipline:    3,
  recoveryFactor:       2,
};
// Total = 100

// ══════════════════════════════════════════════════════════════════
// LABELS
// ══════════════════════════════════════════════════════════════════

var TEACHER_CAPABILITY_LABELS = [
  { min: 0,  max: 19, label: 'WEAK' },
  { min: 20, max: 39, label: 'IMPROVING' },
  { min: 40, max: 59, label: 'DECENT' },
  { min: 60, max: 79, label: 'STRONG' },
  { min: 80, max: 100, label: 'ELITE' },
];

function _teacherCapLabel(score) {
  for (var i = 0; i < TEACHER_CAPABILITY_LABELS.length; i++) {
    if (score >= TEACHER_CAPABILITY_LABELS[i].min && score <= TEACHER_CAPABILITY_LABELS[i].max) {
      return TEACHER_CAPABILITY_LABELS[i].label;
    }
  }
  return 'WEAK';
}

// ══════════════════════════════════════════════════════════════════
// COMPONENT SCORERS — Each returns 0..1 (fraction of max)
// ══════════════════════════════════════════════════════════════════

function _capSurvivalRate(v2) {
  // How many sessions ended without ruin
  if (v2.lifetimeSessions === 0) return 0;
  var ruinRate = v2.failCount / v2.lifetimeSessions;
  // 0 ruins = 1.0, 50%+ ruin rate = 0
  return Math.max(0, Math.min(1, 1 - ruinRate * 2));
}

function _capDrawdownControl(v2) {
  // Based on max drawdown from lifetime stats
  if (!v2.lifetimeStats) return 0;
  var maxDD = Math.abs(v2.lifetimeStats.maxDrawdownPct || 0);
  // <5% DD = perfect, >50% = 0
  if (maxDD <= 5) return 1;
  if (maxDD >= 50) return 0;
  return 1 - (maxDD - 5) / 45;
}

function _capProfitFactor(v2) {
  if (!v2.lifetimeStats) return 0;
  var pf = v2.lifetimeStats.profitFactor || 0;
  // PF 0 = 0, PF 1.5 = 0.5, PF 3+ = 1.0
  if (pf <= 0) return 0;
  if (pf >= 3) return 1;
  return pf / 3;
}

function _capExpectancy(v2) {
  if (!v2.lifetimeStats) return 0;
  var exp = v2.lifetimeStats.expectancy || 0;
  // Expectancy in $ per trade — normalize against starting capital
  var normExp = exp / (v2.startCapital * 0.01); // relative to 1% of capital
  // 0 or negative = 0, 2+ = 1.0
  if (normExp <= 0) return 0;
  if (normExp >= 2) return 1;
  return normExp / 2;
}

function _capWinRate(v2) {
  if (!v2.lifetimeStats) return 0;
  var wr = v2.lifetimeStats.winRate || 0;
  // 30% = 0, 50% = 0.5, 70%+ = 1.0
  if (wr <= 30) return 0;
  if (wr >= 70) return 1;
  return (wr - 30) / 40;
}

function _capCalibrationQuality(v2) {
  // Uses calibration data if available
  if (!window.TEACHER) return 0;
  var T = window.TEACHER;
  if (!T.calibration || typeof T.calibration.realWR !== 'number') return 0.3; // no data = neutral

  // Compare predicted vs real win rate — smaller gap = better
  var gap = Math.abs(T.calibration.predictedWR - T.calibration.realWR);
  // 0 gap = 1.0, 20+ gap = 0
  if (gap <= 2) return 1;
  if (gap >= 20) return 0;
  return 1 - (gap - 2) / 18;
}

function _capConsistency(v2) {
  // Coefficient of variation of per-session PnL
  if (v2.lifetimeSessions < 5) return 0;
  if (!v2.curriculum || !v2.curriculum.sessionHistory) return 0;

  var pnls = [];
  var hist = v2.curriculum.sessionHistory;
  for (var i = 0; i < hist.length; i++) {
    if (typeof hist[i].totalPnl === 'number') pnls.push(hist[i].totalPnl);
  }
  if (pnls.length < 5) return 0;

  var mean = 0;
  for (var j = 0; j < pnls.length; j++) mean += pnls[j];
  mean /= pnls.length;
  if (mean <= 0) return 0;

  var variance = 0;
  for (var k = 0; k < pnls.length; k++) variance += (pnls[k] - mean) * (pnls[k] - mean);
  variance /= pnls.length;
  var cv = Math.sqrt(variance) / Math.abs(mean);

  // CV 0 = perfect consistency, CV 3+ = terrible
  if (cv <= 0.5) return 1;
  if (cv >= 3) return 0;
  return 1 - (cv - 0.5) / 2.5;
}

function _capRegimeCoverage(v2) {
  if (!v2.curriculum) return 0;
  var metrics = teacherGetCoverageMetrics(v2.curriculum);
  return metrics.regimeCoverage / 100;
}

function _capTimeframeCoverage(v2) {
  if (!v2.curriculum) return 0;
  var metrics = teacherGetCoverageMetrics(v2.curriculum);
  return metrics.tfCoverage / 100;
}

function _capProfileCoverage(v2) {
  if (!v2.curriculum) return 0;
  var metrics = teacherGetCoverageMetrics(v2.curriculum);
  return metrics.profileCoverage / 100;
}

function _capMistakeReduction(v2) {
  // Compare mistake ratio in last 200 trades vs first 200
  if (v2.lifetimeTrades.length < 100) return 0;

  var half = Math.floor(v2.lifetimeTrades.length / 2);
  var firstHalf = v2.lifetimeTrades.slice(0, half);
  var secondHalf = v2.lifetimeTrades.slice(half);

  function mistakeRatio(arr) {
    var mistakes = 0;
    for (var i = 0; i < arr.length; i++) {
      var cl = arr[i]._classification;
      if (cl === 'MISTAKE' || cl === 'BAD_TRADE' || cl === 'AVOIDABLE_LOSS') mistakes++;
    }
    return arr.length > 0 ? mistakes / arr.length : 0;
  }

  var r1 = mistakeRatio(firstHalf);
  var r2 = mistakeRatio(secondHalf);

  // Improvement in mistake rate: went from 40% to 10% = great
  if (r1 <= 0) return 0.5; // no mistakes in first half — neutral
  var improvement = (r1 - r2) / r1;
  // >0 means improving
  return Math.max(0, Math.min(1, 0.5 + improvement * 0.5));
}

function _capEdgeStability(v2) {
  // Is the edge (PF) stable across IS and OOS?
  if (!v2.curriculum) return 0;
  var cv = teacherComputeCrossValidation(v2.curriculum);
  if (!cv || cv.sampleIS < 20 || cv.sampleOOS < 10) return 0;

  // IS/OOS PF ratio — closer to 1.0 = stable
  var ratio = cv.pfIS > 0 ? cv.pfOOS / cv.pfIS : 0;
  if (ratio >= 0.8 && ratio <= 1.2) return 1;
  if (ratio >= 0.5 && ratio <= 1.5) return 0.5;
  return 0;
}

function _capNoTradeDiscipline(v2) {
  // Were no-trade decisions justified? We approximate this:
  // Low trade frequency in messy regimes = good
  // We check if CAPITULATION/SQUEEZE regimes have fewer trades per bar
  // For now, use a simpler proxy: if overall trade frequency is reasonable
  if (v2.lifetimeSessions < 5) return 0;
  var totalBars = 0;
  var hist = v2.curriculum ? v2.curriculum.sessionHistory : [];
  for (var i = 0; i < hist.length; i++) {
    totalBars += (hist[i].barsReplayed || 200);
  }
  if (totalBars === 0) return 0;

  var tradesPerBar = v2.lifetimeTrades.length / totalBars;
  // Good discipline: 0.01-0.05 trades/bar, bad: >0.1 (overtrading)
  if (tradesPerBar <= 0.02) return 1;
  if (tradesPerBar >= 0.1) return 0;
  return 1 - (tradesPerBar - 0.02) / 0.08;
}

function _capRecoveryFactor(v2) {
  if (!v2.lifetimeStats) return 0;
  // Recovery factor = net profit / max drawdown
  var netProfit = v2.lifetimeStats.totalPnl || 0;
  var maxDD = Math.abs(v2.lifetimeStats.maxDrawdown || 1);
  if (netProfit <= 0) return 0;
  var rf = netProfit / maxDD;
  // RF 0 = 0, RF 3+ = 1.0
  if (rf >= 3) return 1;
  return rf / 3;
}

// ══════════════════════════════════════════════════════════════════
// PENALTIES — Applied after base score
// ══════════════════════════════════════════════════════════════════

function _teacherCapPenalties(v2) {
  var penalties = [];
  var totalPenalty = 0;

  // 1. Sample size penalty — need 100+ trades for reliable score
  var trades = v2.lifetimeTrades.length;
  if (trades < 100) {
    var p = Math.round((1 - trades / 100) * 15);
    penalties.push({ name: 'sampleSize', value: p, reason: 'Only ' + trades + ' trades (need 100+)' });
    totalPenalty += p;
  }

  // 2. Ruin penalty — each ruin costs points
  if (v2.failCount > 0) {
    var ruinP = Math.min(20, v2.failCount * 5);
    penalties.push({ name: 'ruin', value: ruinP, reason: v2.failCount + ' ruin(s)' });
    totalPenalty += ruinP;
  }

  // 3. Regime blind spots — missing major regimes
  if (v2.curriculum) {
    var coverage = teacherGetCoverageMetrics(v2.curriculum);
    if (coverage.regimeCoverage < 50) {
      var rgP = Math.round((50 - coverage.regimeCoverage) / 50 * 10);
      penalties.push({ name: 'regimeBlind', value: rgP, reason: 'Only ' + coverage.regimeCoverage.toFixed(0) + '% regime coverage' });
      totalPenalty += rgP;
    }
  }

  // 4. Instability penalty — if recent sessions are worse than average
  if (v2.curriculum && v2.curriculum.sessionHistory && v2.curriculum.sessionHistory.length >= 10) {
    var hist = v2.curriculum.sessionHistory;
    var recentPnl = 0, olderPnl = 0;
    var recentN = Math.min(5, hist.length);
    var olderN = hist.length - recentN;
    for (var i = hist.length - recentN; i < hist.length; i++) {
      recentPnl += (hist[i].totalPnl || 0);
    }
    for (var j = 0; j < hist.length - recentN; j++) {
      olderPnl += (hist[j].totalPnl || 0);
    }
    if (olderN > 0) olderPnl /= olderN;
    recentPnl /= recentN;
    if (recentPnl < olderPnl * 0.5 && olderPnl > 0) {
      penalties.push({ name: 'instability', value: 8, reason: 'Recent performance degrading' });
      totalPenalty += 8;
    }
  }

  // 5. OOS gap penalty — overfit detection
  if (v2.curriculum) {
    var cv = teacherComputeCrossValidation(v2.curriculum);
    if (cv && cv.sampleIS >= 20 && cv.sampleOOS >= 10) {
      if (cv.overfitDetected) {
        var oosP = Math.round(Math.min(15, (cv.wrGap || 0) * 0.5 + 5));
        penalties.push({ name: 'oosGap', value: oosP, reason: 'IS-OOS gap detected (WR gap ' + cv.wrGap.toFixed(1) + '%)' });
        totalPenalty += oosP;
      }
    }
  }

  return { penalties: penalties, totalPenalty: Math.min(totalPenalty, 50) }; // cap penalty at -50
}

// ══════════════════════════════════════════════════════════════════
// MAIN SCORE COMPUTATION
// ══════════════════════════════════════════════════════════════════

function teacherComputeCapability(v2) {
  if (!v2) return { score: 0, label: 'WEAK', breakdown: null };

  // Component scores
  var components = {
    survivalRate:       _capSurvivalRate(v2),
    drawdownControl:    _capDrawdownControl(v2),
    profitFactor:       _capProfitFactor(v2),
    expectancy:         _capExpectancy(v2),
    winRate:            _capWinRate(v2),
    calibrationQuality: _capCalibrationQuality(v2),
    consistency:        _capConsistency(v2),
    regimeCoverage:     _capRegimeCoverage(v2),
    timeframeCoverage:  _capTimeframeCoverage(v2),
    profileCoverage:    _capProfileCoverage(v2),
    mistakeReduction:   _capMistakeReduction(v2),
    edgeStability:      _capEdgeStability(v2),
    noTradeDiscipline:  _capNoTradeDiscipline(v2),
    recoveryFactor:     _capRecoveryFactor(v2),
  };

  // Weighted sum
  var rawScore = 0;
  var breakdown = {};
  for (var key in components) {
    var weight = TEACHER_CAPABILITY_WEIGHTS[key] || 0;
    var val = components[key];
    var pts = val * weight;
    rawScore += pts;
    breakdown[key] = {
      fraction: parseFloat(val.toFixed(3)),
      weight: weight,
      points: parseFloat(pts.toFixed(2)),
    };
  }

  // Apply penalties
  var penaltyResult = _teacherCapPenalties(v2);
  var finalScore = Math.max(0, Math.min(100, Math.round(rawScore - penaltyResult.totalPenalty)));

  var label = _teacherCapLabel(finalScore);

  return {
    score: finalScore,
    label: label,
    rawScore: Math.round(rawScore),
    penaltyTotal: penaltyResult.totalPenalty,
    penalties: penaltyResult.penalties,
    breakdown: breakdown,
    timestamp: Date.now(),
  };
}

// ══════════════════════════════════════════════════════════════════
// QUICK SUMMARY — For panel display
// ══════════════════════════════════════════════════════════════════

function teacherGetCapabilitySummary() {
  var T = window.TEACHER;
  if (!T || !T.v2) return null;
  var v2 = T.v2;
  return {
    score: v2.capability,
    label: v2.capabilityLabel,
    sessions: v2.lifetimeSessions,
    totalTrades: v2.lifetimeTrades.length,
    failCount: v2.failCount,
    capital: v2.currentCapital,
    status: v2.status,
    statusDetail: v2.statusDetail,
  };
}
