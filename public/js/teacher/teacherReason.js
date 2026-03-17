// Zeus v122 — teacher/teacherReason.js
// THE TEACHER — Reason Engine: WHY entered, WHY exited, WHY won/lost,
// pattern classification, lesson extraction, comparative analysis
// Reads/writes ONLY window.TEACHER — fully sandboxed
'use strict';

// ══════════════════════════════════════════════════════════════════
// WHY ENTERED — Analyze entry decision quality
// ══════════════════════════════════════════════════════════════════

/**
 * Analyze why a trade was entered and rate the decision.
 * @param {Object} trade — closed trade from TEACHER.trades
 * @returns {{ summary, factors:[], alignment, confidence, verdict }}
 */
function teacherWhyEntered(trade) {
  if (!trade) return null;

  var factors = [];
  var reasons = trade.entryReasons || [];
  var isLong = trade.side === 'LONG';

  // Categorize reasons into groups
  var trendAligned = 0, momentumAligned = 0, volatilityOk = 0, totalSignals = reasons.length;

  for (var i = 0; i < reasons.length; i++) {
    var r = reasons[i];
    if (r === 'ST_FLIP_BULL' || r === 'ST_FLIP_BEAR' || r === 'REGIME_TREND' || r === 'REGIME_BREAKOUT') {
      trendAligned++;
      factors.push({ type: 'TREND', tag: r, impact: 'positive' });
    } else if (r === 'MACD_CROSS_BULL' || r === 'MACD_CROSS_BEAR' || r === 'RSI_OVERSOLD' || r === 'RSI_OVERBOUGHT') {
      momentumAligned++;
      factors.push({ type: 'MOMENTUM', tag: r, impact: 'positive' });
    } else if (r === 'CONFLUENCE_HIGH' || r === 'CONFLUENCE_LOW' || r === 'HIGH_ADX_TREND') {
      factors.push({ type: 'CONFIRMATION', tag: r, impact: 'positive' });
    } else if (r === 'DIVERGENCE_BULL' || r === 'DIVERGENCE_BEAR') {
      factors.push({ type: 'REVERSAL', tag: r, impact: isLong ? (r === 'DIVERGENCE_BULL' ? 'positive' : 'negative') : (r === 'DIVERGENCE_BEAR' ? 'positive' : 'negative') });
    } else if (r === 'BB_SQUEEZE_BREAK') {
      volatilityOk++;
      factors.push({ type: 'VOLATILITY', tag: r, impact: 'positive' });
    } else if (r === 'LOW_ADX_RANGE' || r === 'REGIME_RANGE') {
      factors.push({ type: 'WARNING', tag: r, impact: 'negative' });
    } else {
      factors.push({ type: 'OTHER', tag: r, impact: 'neutral' });
    }
  }

  // Alignment: how many groups agree
  var groupsAligned = (trendAligned > 0 ? 1 : 0) + (momentumAligned > 0 ? 1 : 0) + (volatilityOk > 0 ? 1 : 0);
  var alignment = totalSignals > 0 ? Math.round((groupsAligned / 3) * 100) : 0;

  // Confidence in the entry decision
  var confidence = Math.min(100, totalSignals * 15 + groupsAligned * 20);

  // Warnings
  var warnings = [];
  if (totalSignals < 2) warnings.push('Few signals at entry (' + totalSignals + ')');
  if (trendAligned === 0) warnings.push('No trend confirmation');
  if (momentumAligned === 0) warnings.push('No momentum confirmation');
  for (var i = 0; i < factors.length; i++) {
    if (factors[i].impact === 'negative') warnings.push('Counter-signal: ' + factors[i].tag);
  }

  // Verdict
  var verdict;
  if (confidence >= 70 && warnings.length === 0) verdict = 'STRONG_ENTRY';
  else if (confidence >= 50) verdict = 'ADEQUATE_ENTRY';
  else if (confidence >= 30) verdict = 'WEAK_ENTRY';
  else verdict = 'POOR_ENTRY';

  var summary = trade.side + ' entry with ' + totalSignals + ' signals, ' + groupsAligned + '/3 groups aligned. ' + verdict + '.';

  return {
    summary:    summary,
    factors:    factors,
    alignment:  alignment,
    confidence: confidence,
    verdict:    verdict,
    warnings:   warnings,
  };
}

// ══════════════════════════════════════════════════════════════════
// WHY EXITED — Analyze exit conditions
// ══════════════════════════════════════════════════════════════════

/**
 * Analyze why a trade was exited.
 * @param {Object} trade — closed trade
 * @returns {{ summary, exitType, wasOptimal, betterExit, analysis }}
 */
function teacherWhyExited(trade) {
  if (!trade) return null;

  var exitType = 'UNKNOWN';
  var wasOptimal = false;
  var analysis = '';

  switch (trade.exitReason) {
    case 'TP_HIT':
      exitType = 'TARGET';
      wasOptimal = true;
      analysis = 'Take profit reached at $' + trade.exit.toFixed(2) + '. Planned exit executed.';
      break;
    case 'SL_HIT':
      exitType = 'STOP';
      wasOptimal = false;
      analysis = 'Stop loss hit at $' + trade.exit.toFixed(2) + '. Risk was contained.';
      break;
    case 'DSL_HIT':
      exitType = 'TRAILING_STOP';
      wasOptimal = true;
      analysis = 'Dynamic trailing stop activated and hit. Profit was protected.';
      break;
    case 'SIGNAL_FLIP':
      exitType = 'SIGNAL';
      wasOptimal = trade.outcome === 'WIN';
      analysis = 'Indicators flipped against position. ' + (trade.outcome === 'WIN' ? 'Exited with profit.' : 'Signal change came too late.');
      break;
    case 'REGIME_CHANGE':
      exitType = 'REGIME';
      wasOptimal = trade.outcome !== 'LOSS';
      analysis = 'Market regime changed from trend to range/volatile.';
      break;
    case 'CONFLUENCE_DROP':
      exitType = 'CONFLUENCE';
      wasOptimal = trade.outcome === 'WIN';
      analysis = 'Confluence score collapsed. Multi-indicator agreement lost.';
      break;
    case 'TIME_STOP':
      exitType = 'TIME';
      wasOptimal = false;
      analysis = 'Trade held too long (' + trade.barsHeld + ' bars). Position timed out.';
      break;
    case 'MANUAL_EXIT':
      exitType = 'MANUAL';
      wasOptimal = trade.outcome === 'WIN';
      analysis = 'Manual exit by user. ' + (trade.outcome === 'WIN' ? 'Good judgement.' : 'Could have been avoided.');
      break;
    case 'MAX_BARS_EXIT':
      exitType = 'END_OF_DATA';
      wasOptimal = false;
      analysis = 'Replay ended with open position. Force-closed at last bar.';
      break;
    default:
      analysis = 'Unknown exit reason: ' + trade.exitReason;
  }

  // Could a better exit have been found?
  var betterExit = null;
  if (trade.exitReason === 'SL_HIT' && !trade.dslUsed) {
    betterExit = 'DSL (trailing stop) may have captured profit before SL hit';
  }
  if (trade.exitReason === 'TIME_STOP' && trade.pnlPct > 0) {
    betterExit = 'Was profitable at exit — a tighter TP or DSL would have locked gains';
  }

  var summary = exitType + ' exit: ' + trade.exitReason + ' → $' + trade.pnlNet.toFixed(2) + ' (' + trade.pnlPct.toFixed(1) + '%)';

  return {
    summary:     summary,
    exitType:    exitType,
    wasOptimal:  wasOptimal,
    betterExit:  betterExit,
    analysis:    analysis,
    pnlNet:      trade.pnlNet,
    barsHeld:    trade.barsHeld,
  };
}

// ══════════════════════════════════════════════════════════════════
// WHY WON / WHY LOST — Deep analysis per outcome
// ══════════════════════════════════════════════════════════════════

/**
 * Analyze why a trade won or lost.
 * @param {Object} trade — closed trade
 * @returns {{ summary, keyFactors:[], lessons:[], classification }}
 */
function teacherWhyOutcome(trade) {
  if (!trade) return null;

  var keyFactors = [];
  var lessons = [];
  var classification = '';

  if (trade.outcome === 'WIN') {
    // ── Win analysis ──
    if (trade.exitReason === 'TP_HIT') {
      keyFactors.push('TP hit — market moved in predicted direction');
      lessons.push('Entry signals correctly identified direction');
    }
    if (trade.exitReason === 'DSL_HIT') {
      keyFactors.push('DSL protected profits — trailed successfully');
      lessons.push('Trailing stop captured majority of move');
    }
    if (trade.entryReasons && trade.entryReasons.length >= 3) {
      keyFactors.push('Strong multi-signal confluence at entry (' + trade.entryReasons.length + ' signals)');
      lessons.push('High-confidence entries (3+ signals) correlate with wins');
    }
    if (trade.barsHeld <= 10) {
      keyFactors.push('Quick win — captured move efficiently');
    }
    if (trade.pnlPct >= 3) {
      classification = 'STRONG_WIN';
      lessons.push('Excellent R:R achieved — replicate this setup');
    } else if (trade.pnlPct >= 1) {
      classification = 'SOLID_WIN';
    } else {
      classification = 'MARGINAL_WIN';
      lessons.push('Small win — check if TP could have been wider');
    }
  } else if (trade.outcome === 'LOSS') {
    // ── Loss analysis ──
    if (trade.exitReason === 'SL_HIT') {
      keyFactors.push('SL hit — market moved against position');
      if (trade.entryReasons && trade.entryReasons.length < 2) {
        keyFactors.push('Weak entry: only ' + trade.entryReasons.length + ' signal(s)');
        lessons.push('Avoid entries with < 2 confirming signals');
      }
    }
    if (trade.exitReason === 'TIME_STOP') {
      keyFactors.push('Held too long without resolution');
      lessons.push('Consider tighter time stops or signal-based exits');
    }

    // Check for counter-trend entry
    var hasRange = false, hasTrend = false;
    var reasons = trade.entryReasons || [];
    for (var i = 0; i < reasons.length; i++) {
      if (reasons[i] === 'REGIME_RANGE' || reasons[i] === 'LOW_ADX_RANGE') hasRange = true;
      if (reasons[i] === 'REGIME_TREND' || reasons[i] === 'REGIME_BREAKOUT') hasTrend = true;
    }
    if (hasRange && !hasTrend) {
      keyFactors.push('Entered during RANGE regime — low directional conviction');
      lessons.push('Range regimes have lower win rates for directional trades');
    }

    if (trade.barsHeld <= 2) {
      keyFactors.push('Quick loss — immediate reversal after entry');
      lessons.push('Quick stops suggest bad timing — wait for confirmation bar');
      classification = 'QUICK_STOP';
    } else if (Math.abs(trade.pnlPct) > 3) {
      classification = 'HEAVY_LOSS';
      lessons.push('Large loss — consider tighter SL or smaller position');
    } else {
      classification = 'CONTROLLED_LOSS';
      lessons.push('Loss was controlled within acceptable risk');
    }
  } else {
    classification = 'BREAKEVEN';
    keyFactors.push('Trade ended near entry price');
    lessons.push('Breakeven often means entry timing was slightly off');
  }

  var summary = trade.outcome + ' (' + classification + '): ' +
    trade.side + ' $' + trade.pnlNet.toFixed(2) + ' (' + trade.pnlPct.toFixed(1) + '%) in ' + trade.barsHeld + ' bars. ' +
    keyFactors.length + ' key factor(s).';

  return {
    summary:        summary,
    keyFactors:     keyFactors,
    lessons:        lessons,
    classification: classification,
    outcome:        trade.outcome,
    pnlPct:         trade.pnlPct,
  };
}

// ══════════════════════════════════════════════════════════════════
// FULL TRADE REPORT — Combines all 3 analyses for a single trade
// ══════════════════════════════════════════════════════════════════

/**
 * Generate complete analysis report for a closed trade.
 * @param {Object} trade
 * @returns {{ entry, exit, outcome, quality, rMultiple }}
 */
function teacherTradeReport(trade) {
  if (!trade) return null;

  return {
    tradeId:   trade.id,
    side:      trade.side,
    entry:     teacherWhyEntered(trade),
    exit:      teacherWhyExited(trade),
    outcome:   teacherWhyOutcome(trade),
    quality:   teacherScoreTrade(trade),
    rMultiple: teacherCalcRMultiple(trade),
  };
}

// ══════════════════════════════════════════════════════════════════
// PATTERN CLASSIFICATION — Classify trade setups into named patterns
// ══════════════════════════════════════════════════════════════════

var TEACHER_PATTERNS = {
  'TREND_FOLLOW':    { requires: ['REGIME_TREND', 'HIGH_ADX_TREND'], description: 'Trend-following entry in strong directional move' },
  'BREAKOUT':        { requires: ['REGIME_BREAKOUT', 'BB_SQUEEZE_BREAK'], description: 'Breakout entry from squeeze/consolidation' },
  'REVERSAL':        { requires: ['DIVERGENCE_BULL|DIVERGENCE_BEAR', 'RSI_OVERSOLD|RSI_OVERBOUGHT'], description: 'Mean-reversion entry at extreme RSI + divergence' },
  'MOMENTUM_CONF':   { requires: ['MACD_CROSS_BULL|MACD_CROSS_BEAR', 'ST_FLIP_BULL|ST_FLIP_BEAR'], description: 'MACD + SuperTrend momentum confirmation' },
  'CONFLUENCE_PLAY': { requires: ['CONFLUENCE_HIGH|CONFLUENCE_LOW'], description: 'High multi-indicator confluence entry' },
  'RANGE_TRADE':     { requires: ['REGIME_RANGE', 'LOW_ADX_RANGE'], description: 'Trade within range-bound market' },
};

/**
 * Classify a trade into named pattern(s).
 * @param {Object} trade
 * @returns {Array} matched patterns [{name, description, matched:boolean}]
 */
function teacherClassifyPattern(trade) {
  if (!trade || !trade.entryReasons) return [];

  var reasons = trade.entryReasons;
  var matched = [];

  var patternNames = Object.keys(TEACHER_PATTERNS);
  for (var p = 0; p < patternNames.length; p++) {
    var name = patternNames[p];
    var pat = TEACHER_PATTERNS[name];
    var allMatch = true;

    for (var r = 0; r < pat.requires.length; r++) {
      var alts = pat.requires[r].split('|');
      var anyAltMatch = false;
      for (var a = 0; a < alts.length; a++) {
        if (reasons.indexOf(alts[a]) !== -1) { anyAltMatch = true; break; }
      }
      if (!anyAltMatch) { allMatch = false; break; }
    }

    if (allMatch) {
      matched.push({ name: name, description: pat.description });
    }
  }

  return matched;
}

// ══════════════════════════════════════════════════════════════════
// LESSON EXTRACTION — Auto-generate lessons from session trades
// ══════════════════════════════════════════════════════════════════

/**
 * Extract lessons from a batch of trades.
 * @param {Array} trades — closed trades
 * @returns {Array} lessons [{type, description, confidence, evidence, tags}]
 */
function teacherExtractLessons(trades) {
  if (!trades || trades.length < 3) return [];

  var lessons = [];

  // 1. Win rate by pattern
  var patternStats = {};
  for (var i = 0; i < trades.length; i++) {
    var patterns = teacherClassifyPattern(trades[i]);
    for (var p = 0; p < patterns.length; p++) {
      var name = patterns[p].name;
      if (!patternStats[name]) patternStats[name] = { wins: 0, losses: 0, total: 0 };
      patternStats[name].total++;
      if (trades[i].outcome === 'WIN') patternStats[name].wins++;
      else if (trades[i].outcome === 'LOSS') patternStats[name].losses++;
    }
  }

  var pKeys = Object.keys(patternStats);
  for (var i = 0; i < pKeys.length; i++) {
    var ps = patternStats[pKeys[i]];
    if (ps.total >= 3) {
      var wr = (ps.wins / ps.total) * 100;
      if (wr >= 70) {
        lessons.push({
          type: 'EDGE',
          description: pKeys[i] + ' pattern has ' + wr.toFixed(0) + '% win rate (' + ps.total + ' samples)',
          confidence: Math.min(90, Math.round(50 + ps.total * 5)),
          evidence: ps,
          tags: [pKeys[i]],
        });
      } else if (wr <= 30) {
        lessons.push({
          type: 'AVOID',
          description: pKeys[i] + ' pattern has only ' + wr.toFixed(0) + '% win rate — consider avoiding',
          confidence: Math.min(90, Math.round(50 + ps.total * 5)),
          evidence: ps,
          tags: [pKeys[i]],
        });
      }
    }
  }

  // 2. Exit reason effectiveness
  var exitStats = {};
  for (var i = 0; i < trades.length; i++) {
    var er = trades[i].exitReason;
    if (!exitStats[er]) exitStats[er] = { count: 0, avgPnl: 0, totalPnl: 0 };
    exitStats[er].count++;
    exitStats[er].totalPnl += trades[i].pnlNet;
  }
  var eKeys = Object.keys(exitStats);
  for (var i = 0; i < eKeys.length; i++) {
    exitStats[eKeys[i]].avgPnl = exitStats[eKeys[i]].totalPnl / exitStats[eKeys[i]].count;
    if (exitStats[eKeys[i]].count >= 2 && exitStats[eKeys[i]].avgPnl < -5) {
      lessons.push({
        type: 'MISTAKE',
        description: eKeys[i] + ' exits average $' + exitStats[eKeys[i]].avgPnl.toFixed(2) + ' — investigate',
        confidence: 60,
        evidence: exitStats[eKeys[i]],
        tags: [eKeys[i]],
      });
    }
  }

  // 3. Holding time insights
  var quickWins = 0, quickLosses = 0, longHolds = 0;
  for (var i = 0; i < trades.length; i++) {
    if (trades[i].barsHeld <= 3) {
      if (trades[i].outcome === 'WIN') quickWins++;
      else if (trades[i].outcome === 'LOSS') quickLosses++;
    }
    if (trades[i].barsHeld > 50) longHolds++;
  }
  if (quickLosses >= 3 && quickLosses > quickWins * 2) {
    lessons.push({
      type: 'TIMING',
      description: 'Many quick stops (' + quickLosses + '). Consider waiting for confirmation bar before entry.',
      confidence: 70,
      evidence: { quickWins: quickWins, quickLosses: quickLosses },
      tags: ['TIMING', 'QUICK_STOP'],
    });
  }
  if (longHolds >= 2) {
    lessons.push({
      type: 'TIMING',
      description: longHolds + ' trades held 50+ bars. Use tighter time stops or signal exits.',
      confidence: 60,
      evidence: { longHolds: longHolds },
      tags: ['TIMING', 'LONG_HOLD'],
    });
  }

  // 4. Regime-specific insights
  var regimeWins = { TREND: 0, RANGE: 0, BREAKOUT: 0, VOLATILE: 0 };
  var regimeLosses = { TREND: 0, RANGE: 0, BREAKOUT: 0, VOLATILE: 0 };
  for (var i = 0; i < trades.length; i++) {
    var reasons = trades[i].entryReasons || [];
    var regime = null;
    for (var j = 0; j < reasons.length; j++) {
      if (reasons[j] === 'REGIME_TREND') regime = 'TREND';
      else if (reasons[j] === 'REGIME_BREAKOUT') regime = 'BREAKOUT';
      else if (reasons[j] === 'REGIME_RANGE') regime = 'RANGE';
    }
    if (regime) {
      if (trades[i].outcome === 'WIN') regimeWins[regime]++;
      else if (trades[i].outcome === 'LOSS') regimeLosses[regime]++;
    }
  }
  var regKeys = Object.keys(regimeWins);
  for (var i = 0; i < regKeys.length; i++) {
    var rw = regimeWins[regKeys[i]], rl = regimeLosses[regKeys[i]];
    var rt = rw + rl;
    if (rt >= 3) {
      var rwr = (rw / rt) * 100;
      if (rwr >= 70) {
        lessons.push({
          type: 'REGIME',
          description: regKeys[i] + ' regime trades: ' + rwr.toFixed(0) + '% win rate (' + rt + ' trades)',
          confidence: Math.min(85, 50 + rt * 5),
          evidence: { wins: rw, losses: rl },
          tags: ['REGIME_' + regKeys[i]],
        });
      } else if (rwr <= 30) {
        lessons.push({
          type: 'REGIME',
          description: 'Poor performance in ' + regKeys[i] + ' regime: ' + rwr.toFixed(0) + '% — avoid this regime',
          confidence: Math.min(85, 50 + rt * 5),
          evidence: { wins: rw, losses: rl },
          tags: ['REGIME_' + regKeys[i]],
        });
      }
    }
  }

  return lessons;
}

// ══════════════════════════════════════════════════════════════════
// COMPARATIVE ANALYSIS — Compare two trades or sessions
// ══════════════════════════════════════════════════════════════════

/**
 * Compare two trades side by side.
 * @param {Object} tradeA
 * @param {Object} tradeB
 * @returns {{ differences:[], similarities:[], betterTrade }}
 */
function teacherCompareTrades(tradeA, tradeB) {
  if (!tradeA || !tradeB) return null;

  var diffs = [];
  var sims = [];

  // Side
  if (tradeA.side === tradeB.side) sims.push('Same direction: ' + tradeA.side);
  else diffs.push('Different sides: ' + tradeA.side + ' vs ' + tradeB.side);

  // Outcome
  if (tradeA.outcome === tradeB.outcome) sims.push('Same outcome: ' + tradeA.outcome);
  else diffs.push('Different outcomes: ' + tradeA.outcome + ' vs ' + tradeB.outcome);

  // Entry signal count
  var sigA = (tradeA.entryReasons || []).length;
  var sigB = (tradeB.entryReasons || []).length;
  if (Math.abs(sigA - sigB) <= 1) sims.push('Similar signal count: ' + sigA + ' vs ' + sigB);
  else diffs.push('Signal count: ' + sigA + ' vs ' + sigB);

  // PnL
  diffs.push('PnL: $' + tradeA.pnlNet.toFixed(2) + ' vs $' + tradeB.pnlNet.toFixed(2));

  // Bars held
  diffs.push('Duration: ' + tradeA.barsHeld + ' vs ' + tradeB.barsHeld + ' bars');

  // Exit reason
  if (tradeA.exitReason === tradeB.exitReason) sims.push('Same exit: ' + tradeA.exitReason);
  else diffs.push('Exit: ' + tradeA.exitReason + ' vs ' + tradeB.exitReason);

  // Determine better trade
  var scoreA = teacherScoreTrade(tradeA).score;
  var scoreB = teacherScoreTrade(tradeB).score;
  var betterTrade = scoreA > scoreB ? 'A' : scoreB > scoreA ? 'B' : 'TIE';

  return {
    differences:  diffs,
    similarities: sims,
    betterTrade:  betterTrade,
    scoreA:       scoreA,
    scoreB:       scoreB,
  };
}
