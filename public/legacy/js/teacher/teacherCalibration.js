// Zeus v122 — teacher/teacherCalibration.js
// THE TEACHER — Confidence calibration engine
// Tracks user's confidence predictions vs actual outcomes,
// generates calibration curve, identifies over/under-confidence zones,
// suggests adjustments. Reads/writes ONLY window.TEACHER — fully sandboxed
'use strict';

// ══════════════════════════════════════════════════════════════════
// CONFIDENCE RECORD — Track predicted vs actual per trade
// ══════════════════════════════════════════════════════════════════

/**
 * Build calibration data from trades.
 * Each trade's entry confidence is from teacherWhyEntered().confidence.
 * @param {Array} trades
 * @returns {Array} [{tradeId, predicted, actual, delta}]
 */
function teacherBuildCalibrationData(trades) {
  if (!trades || trades.length === 0) return [];

  var data = [];
  for (var i = 0; i < trades.length; i++) {
    var t = trades[i];
    var entryAnalysis = teacherWhyEntered(t);
    if (!entryAnalysis) continue;

    var predicted = entryAnalysis.confidence; // 0-100
    var actual = t.outcome === 'WIN' ? 100 : (t.outcome === 'BREAKEVEN' ? 50 : 0);

    data.push({
      tradeId:   t.id,
      predicted: predicted,
      actual:    actual,
      delta:     predicted - actual,  // positive = overconfident
      outcome:   t.outcome,
      side:      t.side,
    });
  }
  return data;
}

// ══════════════════════════════════════════════════════════════════
// CALIBRATION CURVE — Bin predictions into buckets and compare to reality
// ══════════════════════════════════════════════════════════════════

/**
 * Generate calibration curve: group by predicted confidence, compute actual win%.
 * @param {Array} calibData — from teacherBuildCalibrationData
 * @param {number} [bucketSize=20] — bucket width (e.g. 0-20, 20-40, ...)
 * @returns {Array} [{rangeLabel, from, to, count, predictedAvg, actualWinRate, gap}]
 */
function teacherCalibrationCurve(calibData, bucketSize) {
  if (!calibData || calibData.length === 0) return [];
  bucketSize = bucketSize || 20;

  var buckets = {};
  for (var i = 0; i < calibData.length; i++) {
    var d = calibData[i];
    var key = Math.floor(d.predicted / bucketSize) * bucketSize;
    if (!buckets[key]) buckets[key] = { predicted: [], wins: 0, total: 0 };
    buckets[key].predicted.push(d.predicted);
    buckets[key].total++;
    if (d.outcome === 'WIN') buckets[key].wins++;
  }

  var result = [];
  var keys = Object.keys(buckets).map(Number).sort(function (a, b) { return a - b; });
  for (var i = 0; i < keys.length; i++) {
    var k = keys[i];
    var b = buckets[k];
    var predSum = 0;
    for (var j = 0; j < b.predicted.length; j++) predSum += b.predicted[j];
    var predAvg = predSum / b.predicted.length;
    var actualWR = (b.wins / b.total) * 100;

    result.push({
      rangeLabel: k + '-' + (k + bucketSize),
      from:       k,
      to:         k + bucketSize,
      count:      b.total,
      predictedAvg: parseFloat(predAvg.toFixed(1)),
      actualWinRate: parseFloat(actualWR.toFixed(1)),
      gap:        parseFloat((predAvg - actualWR).toFixed(1)),
    });
  }
  return result;
}

// ══════════════════════════════════════════════════════════════════
// CALIBRATION SCORE — Single number: how well-calibrated is the user?
// ══════════════════════════════════════════════════════════════════

/**
 * Score calibration accuracy (0-100, 100 = perfectly calibrated).
 * Uses mean absolute error between predicted and actual buckets.
 * @param {Array} curve — from teacherCalibrationCurve
 * @returns {{ score, rating, avgGap, details }}
 */
function teacherCalibrationScore(curve) {
  if (!curve || curve.length === 0) return { score: 0, rating: 'INSUFFICIENT_DATA', avgGap: 0, details: 'Need more trades' };

  var totalGap = 0, totalWeight = 0;
  for (var i = 0; i < curve.length; i++) {
    var weight = curve[i].count;
    totalGap += Math.abs(curve[i].gap) * weight;
    totalWeight += weight;
  }

  var avgGap = totalWeight > 0 ? totalGap / totalWeight : 0;
  // Score: 100 - avgGap (clamped)
  var score = Math.max(0, Math.min(100, Math.round(100 - avgGap)));

  var rating;
  if (score >= 85) rating = 'EXCELLENT';
  else if (score >= 70) rating = 'GOOD';
  else if (score >= 50) rating = 'FAIR';
  else if (score >= 30) rating = 'POOR';
  else rating = 'VERY_POOR';

  var details;
  if (avgGap < 10) details = 'Well-calibrated — confidence predictions match outcomes closely';
  else if (avgGap < 25) details = 'Slightly miscalibrated — review mid-confidence trades';
  else details = 'Poorly calibrated — systematic over/under-confidence detected';

  return {
    score:   score,
    rating:  rating,
    avgGap:  parseFloat(avgGap.toFixed(1)),
    details: details,
  };
}

// ══════════════════════════════════════════════════════════════════
// OVER/UNDER-CONFIDENCE DETECTION
// ══════════════════════════════════════════════════════════════════

/**
 * Find confidence zones where user is systematically wrong.
 * @param {Array} curve — from teacherCalibrationCurve
 * @returns {{ overconfident:[], underconfident:[], wellCalibrated:[] }}
 */
function teacherConfidenceZones(curve) {
  if (!curve) return { overconfident: [], underconfident: [], wellCalibrated: [] };

  var over = [], under = [], well = [];

  for (var i = 0; i < curve.length; i++) {
    var c = curve[i];
    if (c.count < 2) continue; // skip thin data
    var entry = { range: c.rangeLabel, gap: c.gap, predicted: c.predictedAvg, actual: c.actualWinRate, count: c.count };

    if (c.gap > 15) {
      over.push(entry);
    } else if (c.gap < -15) {
      under.push(entry);
    } else {
      well.push(entry);
    }
  }

  return { overconfident: over, underconfident: under, wellCalibrated: well };
}

// ══════════════════════════════════════════════════════════════════
// CALIBRATION ADVICE — Generate textual suggestions
// ══════════════════════════════════════════════════════════════════

/**
 * Generate calibration-based trading advice.
 * @param {Array} curve
 * @param {Object} zones — from teacherConfidenceZones
 * @returns {Array} advice strings
 */
function teacherCalibrationAdvice(curve, zones) {
  if (!curve || !zones) return [];

  var advice = [];

  if (zones.overconfident.length > 0) {
    for (var i = 0; i < zones.overconfident.length; i++) {
      var z = zones.overconfident[i];
      advice.push('OVERCONFIDENT in ' + z.range + '% zone: predicted ~' + z.predicted + '% but actual win rate is ' + z.actual + '%. Require more confirmation signals before entering.');
    }
  }

  if (zones.underconfident.length > 0) {
    for (var i = 0; i < zones.underconfident.length; i++) {
      var z = zones.underconfident[i];
      advice.push('UNDERCONFIDENT in ' + z.range + '% zone: predicted ~' + z.predicted + '% but actually winning ' + z.actual + '%. Trust your signals more in this range.');
    }
  }

  if (zones.overconfident.length === 0 && zones.underconfident.length === 0 && zones.wellCalibrated.length > 0) {
    advice.push('Well-calibrated across all confidence zones. Keep consistent.');
  }

  return advice;
}

// ══════════════════════════════════════════════════════════════════
// FULL CALIBRATION REPORT — Combines everything
// ══════════════════════════════════════════════════════════════════

/**
 * Generate complete calibration report from trades.
 * @param {Array} trades
 * @returns {{ data, curve, score, zones, advice }}
 */
function teacherCalibrationReport(trades) {
  var data = teacherBuildCalibrationData(trades);
  var curve = teacherCalibrationCurve(data);
  var score = teacherCalibrationScore(curve);
  var zones = teacherConfidenceZones(curve);
  var advice = teacherCalibrationAdvice(curve, zones);

  return {
    data:     data,
    curve:    curve,
    score:    score,
    zones:    zones,
    advice:   advice,
    totalTrades: trades ? trades.length : 0,
  };
}
