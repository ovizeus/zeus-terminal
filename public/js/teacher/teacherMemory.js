// Zeus v122 — teacher/teacherMemory.js
// THE TEACHER — Learning memory layer
// Persists discovered edges, patterns, mistakes across sessions.
// Auto-consolidates lessons, detects recurring themes, provides
// pre-trade lookback from past experience.
// Reads/writes ONLY window.TEACHER — fully sandboxed
'use strict';

// ══════════════════════════════════════════════════════════════════
// MEMORY STRUCTURE — 3 categories: patterns, edges, mistakes
// ══════════════════════════════════════════════════════════════════
//
// Pattern:  { id, name, count, winRate, avgPnl, lastSeen, confidence }
// Edge:     { id, description, type, winRate, sampleSize, firstSeen, lastSeen, active }
// Mistake:  { id, description, type, frequency, lastSeen, severity, resolved }
//

// ══════════════════════════════════════════════════════════════════
// MEMORY CONSOLIDATION — Merge new lessons into persistent memory
// ══════════════════════════════════════════════════════════════════

/**
 * Consolidate new lessons into TEACHER.memory.
 * Merges duplicates, updates counts/confidence, adds new entries.
 * @param {Array} newLessons — from teacherExtractLessons()
 * @returns {{ added, updated, skipped }}
 */
function teacherConsolidateMemory(newLessons) {
  var T = window.TEACHER;
  if (!T || !newLessons || newLessons.length === 0) return { added: 0, updated: 0, skipped: 0 };

  var mem = T.memory;
  if (!mem) { mem = { patterns: [], edges: [], mistakes: [] }; T.memory = mem; }

  var added = 0, updated = 0, skipped = 0;
  var now = Date.now();

  for (var i = 0; i < newLessons.length; i++) {
    var lesson = newLessons[i];
    var type = lesson.type; // EDGE, AVOID, MISTAKE, TIMING, REGIME

    if (type === 'EDGE') {
      var existing = _findMemoryEntry(mem.edges, lesson.tags);
      if (existing) {
        existing.sampleSize += (lesson.evidence && lesson.evidence.total) || 1;
        existing.winRate = lesson.evidence ? parseFloat(((lesson.evidence.wins / lesson.evidence.total) * 100).toFixed(1)) : existing.winRate;
        existing.lastSeen = now;
        existing.confidence = Math.min(95, existing.confidence + 2);
        updated++;
      } else {
        mem.edges.push({
          id:          'E_' + now + '_' + Math.random().toString(36).slice(2, 6),
          description: lesson.description,
          type:        type,
          tags:        lesson.tags || [],
          winRate:     lesson.evidence ? parseFloat(((lesson.evidence.wins / lesson.evidence.total) * 100).toFixed(1)) : 0,
          sampleSize:  (lesson.evidence && lesson.evidence.total) || 1,
          firstSeen:   now,
          lastSeen:    now,
          confidence:  lesson.confidence || 50,
          active:      true,
        });
        added++;
      }
    } else if (type === 'AVOID' || type === 'REGIME') {
      // Avoid patterns / regime-specific insights → also edges (negative)
      var existing = _findMemoryEntry(mem.edges, lesson.tags);
      if (existing) {
        existing.sampleSize += (lesson.evidence && lesson.evidence.total) || 1;
        existing.lastSeen = now;
        existing.confidence = Math.min(95, existing.confidence + 2);
        updated++;
      } else {
        mem.edges.push({
          id:          'E_' + now + '_' + Math.random().toString(36).slice(2, 6),
          description: lesson.description,
          type:        type,
          tags:        lesson.tags || [],
          winRate:     lesson.evidence ? parseFloat(((lesson.evidence.wins / (lesson.evidence.wins + lesson.evidence.losses)) * 100).toFixed(1)) : 0,
          sampleSize:  (lesson.evidence && (lesson.evidence.wins + lesson.evidence.losses)) || (lesson.evidence && lesson.evidence.total) || 1,
          firstSeen:   now,
          lastSeen:    now,
          confidence:  lesson.confidence || 50,
          active:      true,
        });
        added++;
      }
    } else if (type === 'MISTAKE' || type === 'TIMING') {
      var existing = _findMemoryEntry(mem.mistakes, lesson.tags);
      if (existing) {
        existing.frequency++;
        existing.lastSeen = now;
        if (existing.frequency >= 5) existing.severity = 'HIGH';
        else if (existing.frequency >= 3) existing.severity = 'MEDIUM';
        updated++;
      } else {
        mem.mistakes.push({
          id:          'M_' + now + '_' + Math.random().toString(36).slice(2, 6),
          description: lesson.description,
          type:        type,
          tags:        lesson.tags || [],
          frequency:   1,
          firstSeen:   now,
          lastSeen:    now,
          severity:    'LOW',
          resolved:    false,
        });
        added++;
      }
    } else {
      skipped++;
    }
  }

  // Cap entries
  if (mem.edges.length > 100) mem.edges = mem.edges.slice(-100);
  if (mem.mistakes.length > 100) mem.mistakes = mem.mistakes.slice(-100);

  return { added: added, updated: updated, skipped: skipped };
}

/**
 * Find a memory entry by matching tags.
 */
function _findMemoryEntry(arr, tags) {
  if (!arr || !tags || tags.length === 0) return null;
  for (var i = 0; i < arr.length; i++) {
    var entryTags = arr[i].tags || [];
    var match = true;
    for (var j = 0; j < tags.length; j++) {
      if (entryTags.indexOf(tags[j]) === -1) { match = false; break; }
    }
    if (match && entryTags.length === tags.length) return arr[i];
  }
  return null;
}

// ══════════════════════════════════════════════════════════════════
// PATTERN MEMORY — Update pattern frequency and win rates
// ══════════════════════════════════════════════════════════════════

/**
 * Update pattern memory from a batch of closed trades.
 * @param {Array} trades
 * @returns {{ patternsUpdated, newPatterns }}
 */
function teacherUpdatePatternMemory(trades) {
  var T = window.TEACHER;
  if (!T || !trades || trades.length === 0) return { patternsUpdated: 0, newPatterns: 0 };

  var mem = T.memory;
  if (!mem.patterns) mem.patterns = [];

  var patStats = {};
  for (var i = 0; i < trades.length; i++) {
    var pats = teacherClassifyPattern(trades[i]);
    for (var j = 0; j < pats.length; j++) {
      var name = pats[j].name;
      if (!patStats[name]) patStats[name] = { wins: 0, losses: 0, total: 0, totalPnl: 0 };
      patStats[name].total++;
      patStats[name].totalPnl += trades[i].pnlNet || 0;
      if (trades[i].outcome === 'WIN') patStats[name].wins++;
      else if (trades[i].outcome === 'LOSS') patStats[name].losses++;
    }
  }

  var now = Date.now();
  var updated = 0, added = 0;
  var patNames = Object.keys(patStats);

  for (var i = 0; i < patNames.length; i++) {
    var name = patNames[i];
    var ps = patStats[name];
    var existing = null;

    for (var k = 0; k < mem.patterns.length; k++) {
      if (mem.patterns[k].name === name) { existing = mem.patterns[k]; break; }
    }

    if (existing) {
      existing.count += ps.total;
      existing.wins = (existing.wins || 0) + ps.wins;
      existing.losses = (existing.losses || 0) + ps.losses;
      existing.winRate = existing.count > 0 ? parseFloat(((existing.wins / existing.count) * 100).toFixed(1)) : 0;
      existing.avgPnl = parseFloat(((existing.totalPnl + ps.totalPnl) / existing.count).toFixed(2));
      existing.totalPnl = parseFloat((existing.totalPnl + ps.totalPnl).toFixed(2));
      existing.lastSeen = now;
      existing.confidence = Math.min(95, 50 + existing.count * 3);
      updated++;
    } else {
      mem.patterns.push({
        id:         'P_' + now + '_' + name,
        name:       name,
        count:      ps.total,
        wins:       ps.wins,
        losses:     ps.losses,
        winRate:    ps.total > 0 ? parseFloat(((ps.wins / ps.total) * 100).toFixed(1)) : 0,
        avgPnl:     ps.total > 0 ? parseFloat((ps.totalPnl / ps.total).toFixed(2)) : 0,
        totalPnl:   parseFloat(ps.totalPnl.toFixed(2)),
        firstSeen:  now,
        lastSeen:   now,
        confidence: Math.min(95, 50 + ps.total * 3),
      });
      added++;
    }
  }

  // Cap
  if (mem.patterns.length > 100) mem.patterns = mem.patterns.slice(-100);

  return { patternsUpdated: updated, newPatterns: added };
}

// ══════════════════════════════════════════════════════════════════
// PRE-TRADE LOOKBACK — Check memory before entering a trade
// ══════════════════════════════════════════════════════════════════

/**
 * Before entering a trade, check memory for relevant warnings/edges.
 * @param {string} side — 'LONG' or 'SHORT'
 * @param {Object} indicators — current indicator snapshot
 * @returns {{ warnings:[], edges:[], patternInfo:[], memoryScore }}
 */
function teacherPreTradeLookback(side, indicators) {
  var T = window.TEACHER;
  if (!T || !T.memory) return { warnings: [], edges: [], patternInfo: [], memoryScore: 50 };

  var mem = T.memory;
  var warnings = [], edges = [], patternInfo = [];

  // Build hypothetical entry reasons to match patterns
  var hypotheticalReasons = [];
  if (indicators) {
    if (indicators.regime === 'TREND' || indicators.regime === 'BREAKOUT') {
      hypotheticalReasons.push('REGIME_' + indicators.regime);
    } else if (indicators.regime === 'RANGE') {
      hypotheticalReasons.push('REGIME_RANGE');
    }
    if (indicators.adx && indicators.adx >= 25) hypotheticalReasons.push('HIGH_ADX_TREND');
    else if (indicators.adx && indicators.adx < 20) hypotheticalReasons.push('LOW_ADX_RANGE');

    if (side === 'LONG') {
      if (indicators.macdDir === 'bull') hypotheticalReasons.push('MACD_CROSS_BULL');
      if (indicators.stDir === 'bull') hypotheticalReasons.push('ST_FLIP_BULL');
      if (indicators.confluence >= 65) hypotheticalReasons.push('CONFLUENCE_HIGH');
    } else {
      if (indicators.macdDir === 'bear') hypotheticalReasons.push('MACD_CROSS_BEAR');
      if (indicators.stDir === 'bear') hypotheticalReasons.push('ST_FLIP_BEAR');
      if (indicators.confluence <= 35) hypotheticalReasons.push('CONFLUENCE_LOW');
    }
  }

  // Check pattern memory
  var hypotheticalTrade = { entryReasons: hypotheticalReasons };
  var matchedPatterns = teacherClassifyPattern(hypotheticalTrade);

  for (var i = 0; i < matchedPatterns.length; i++) {
    var patName = matchedPatterns[i].name;
    // Find in memory
    for (var j = 0; j < mem.patterns.length; j++) {
      if (mem.patterns[j].name === patName) {
        var p = mem.patterns[j];
        patternInfo.push({
          name:     p.name,
          winRate:  p.winRate,
          count:    p.count,
          avgPnl:   p.avgPnl,
          verdict:  p.winRate >= 60 ? 'FAVORABLE' : (p.winRate <= 40 ? 'UNFAVORABLE' : 'NEUTRAL'),
        });
        if (p.winRate <= 35 && p.count >= 3) {
          warnings.push('Pattern ' + p.name + ' has poor history: ' + p.winRate + '% win rate (' + p.count + ' samples)');
        }
        if (p.winRate >= 65 && p.count >= 3) {
          edges.push('Pattern ' + p.name + ' has strong edge: ' + p.winRate + '% win rate (' + p.count + ' samples)');
        }
        break;
      }
    }
  }

  // Check regime warnings from edges
  for (var i = 0; i < mem.edges.length; i++) {
    var e = mem.edges[i];
    if (!e.active || e.confidence < 50) continue;
    // Match tags against current conditions
    var relevant = false;
    for (var j = 0; j < e.tags.length; j++) {
      if (hypotheticalReasons.indexOf(e.tags[j]) !== -1 || (indicators && indicators.regime && e.tags[j] === 'REGIME_' + indicators.regime)) {
        relevant = true;
        break;
      }
    }
    if (relevant) {
      if (e.type === 'AVOID' || (e.winRate < 35 && e.sampleSize >= 3)) {
        warnings.push(e.description);
      } else if (e.type === 'EDGE' && e.winRate >= 60) {
        edges.push(e.description);
      }
    }
  }

  // Check active mistakes
  for (var i = 0; i < mem.mistakes.length; i++) {
    var m = mem.mistakes[i];
    if (m.resolved) continue;
    if (m.severity === 'HIGH' || m.frequency >= 3) {
      warnings.push('Recurring mistake: ' + m.description);
    }
  }

  // Memory score: 50 base, +/- based on warnings/edges
  var memoryScore = 50 + edges.length * 10 - warnings.length * 15;
  memoryScore = Math.max(0, Math.min(100, memoryScore));

  return {
    warnings:    warnings,
    edges:       edges,
    patternInfo: patternInfo,
    memoryScore: memoryScore,
  };
}

// ══════════════════════════════════════════════════════════════════
// END-OF-SESSION MEMORY UPDATE — Called when replay ends
// ══════════════════════════════════════════════════════════════════

/**
 * Run full memory update at end of session: consolidate lessons,
 * update pattern memory, persist to storage.
 * @param {Array} trades — session's closed trades
 * @returns {{ lessonsConsolidated, patternsResult, saved }}
 */
function teacherEndSessionMemoryUpdate(trades) {
  if (!trades || trades.length === 0) return { lessonsConsolidated: { added: 0, updated: 0, skipped: 0 }, patternsResult: { patternsUpdated: 0, newPatterns: 0 }, saved: false };

  // 1. Extract lessons
  var lessons = teacherExtractLessons(trades);

  // 2. Consolidate into memory
  var consolResult = teacherConsolidateMemory(lessons);

  // 3. Update pattern memory
  var patResult = teacherUpdatePatternMemory(trades);

  // 4. Persist
  var saved = false;
  if (window.TEACHER && window.TEACHER.memory) {
    saved = teacherSaveMemory(window.TEACHER.memory);
  }

  return {
    lessonsConsolidated: consolResult,
    patternsResult:      patResult,
    saved:               saved,
  };
}

// ══════════════════════════════════════════════════════════════════
// MEMORY SUMMARY — Quick overview of what's in memory
// ══════════════════════════════════════════════════════════════════

/**
 * Get a summary of current memory state.
 * @returns {{ totalPatterns, totalEdges, totalMistakes, topEdge, worstMistake, activeMistakes }}
 */
function teacherMemorySummary() {
  var T = window.TEACHER;
  if (!T || !T.memory) return { totalPatterns: 0, totalEdges: 0, totalMistakes: 0, topEdge: null, worstMistake: null, activeMistakes: 0 };

  var mem = T.memory;
  var patterns = mem.patterns || [];
  var edges = mem.edges || [];
  var mistakes = mem.mistakes || [];

  // Top edge by win rate (with min sample)
  var topEdge = null;
  for (var i = 0; i < edges.length; i++) {
    if (edges[i].active && edges[i].sampleSize >= 3 && edges[i].type === 'EDGE') {
      if (!topEdge || edges[i].winRate > topEdge.winRate) {
        topEdge = { description: edges[i].description, winRate: edges[i].winRate, sampleSize: edges[i].sampleSize };
      }
    }
  }

  // Worst active mistake
  var worstMistake = null;
  var activeMistakes = 0;
  for (var i = 0; i < mistakes.length; i++) {
    if (!mistakes[i].resolved) {
      activeMistakes++;
      if (!worstMistake || mistakes[i].frequency > worstMistake.frequency) {
        worstMistake = { description: mistakes[i].description, frequency: mistakes[i].frequency, severity: mistakes[i].severity };
      }
    }
  }

  return {
    totalPatterns:  patterns.length,
    totalEdges:     edges.length,
    totalMistakes:  mistakes.length,
    topEdge:        topEdge,
    worstMistake:   worstMistake,
    activeMistakes: activeMistakes,
  };
}

// ══════════════════════════════════════════════════════════════════
// RESOLVE / DEACTIVATE — User actions on memory entries
// ══════════════════════════════════════════════════════════════════

/**
 * Mark a mistake as resolved.
 * @param {string} mistakeId
 * @returns {boolean}
 */
function teacherResolveMistake(mistakeId) {
  var T = window.TEACHER;
  if (!T || !T.memory || !T.memory.mistakes) return false;
  for (var i = 0; i < T.memory.mistakes.length; i++) {
    if (T.memory.mistakes[i].id === mistakeId) {
      T.memory.mistakes[i].resolved = true;
      return true;
    }
  }
  return false;
}

/**
 * Deactivate an edge (no longer considered relevant).
 * @param {string} edgeId
 * @returns {boolean}
 */
function teacherDeactivateEdge(edgeId) {
  var T = window.TEACHER;
  if (!T || !T.memory || !T.memory.edges) return false;
  for (var i = 0; i < T.memory.edges.length; i++) {
    if (T.memory.edges[i].id === edgeId) {
      T.memory.edges[i].active = false;
      return true;
    }
  }
  return false;
}

/**
 * Clear all memory (fresh start).
 * @returns {boolean}
 */
function teacherClearMemory() {
  var T = window.TEACHER;
  if (!T) return false;
  T.memory = { patterns: [], edges: [], mistakes: [] };
  teacherSaveMemory(T.memory);
  return true;
}
