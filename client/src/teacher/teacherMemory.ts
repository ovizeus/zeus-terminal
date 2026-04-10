// Zeus — teacher/teacherMemory.ts
// Ported 1:1 from public/js/teacher/teacherMemory.js (Phase 7C)
// THE TEACHER — Learning memory layer
// [8E-3] w.TEACHER reads migrated to getTeacher()
import { getTeacher } from '../services/stateAccessors'

const w = window as any

function _findMemoryEntry(arr: any, tags: any): any {
  if (!arr || !tags || tags.length === 0) return null
  for (let i = 0; i < arr.length; i++) {
    const entryTags = arr[i].tags || []
    let match = true
    for (let j = 0; j < tags.length; j++) {
      if (entryTags.indexOf(tags[j]) === -1) { match = false; break }
    }
    if (match && entryTags.length === tags.length) return arr[i]
  }
  return null
}

export function teacherConsolidateMemory(newLessons: any): any {
  const T = getTeacher()
  if (!T || !newLessons || newLessons.length === 0) return { added: 0, updated: 0, skipped: 0 }
  let mem = T.memory
  if (!mem) { mem = { patterns: [], edges: [], mistakes: [] }; T.memory = mem }
  let added = 0, updated = 0, skipped = 0
  const now = Date.now()
  for (let i = 0; i < newLessons.length; i++) {
    const lesson = newLessons[i]; const type = lesson.type
    if (type === 'EDGE') {
      const existing = _findMemoryEntry(mem.edges, lesson.tags)
      if (existing) {
        existing.sampleSize += (lesson.evidence && lesson.evidence.total) || 1
        existing.winRate = lesson.evidence ? parseFloat(((lesson.evidence.wins / lesson.evidence.total) * 100).toFixed(1)) : existing.winRate
        existing.lastSeen = now; existing.confidence = Math.min(95, existing.confidence + 2); updated++
      } else {
        mem.edges.push({ id: 'E_' + now + '_' + Math.random().toString(36).slice(2, 6), description: lesson.description, type: type, tags: lesson.tags || [], winRate: lesson.evidence ? parseFloat(((lesson.evidence.wins / lesson.evidence.total) * 100).toFixed(1)) : 0, sampleSize: (lesson.evidence && lesson.evidence.total) || 1, firstSeen: now, lastSeen: now, confidence: lesson.confidence || 50, active: true }); added++
      }
    } else if (type === 'AVOID' || type === 'REGIME') {
      const existing = _findMemoryEntry(mem.edges, lesson.tags)
      if (existing) {
        existing.sampleSize += (lesson.evidence && lesson.evidence.total) || 1; existing.lastSeen = now; existing.confidence = Math.min(95, existing.confidence + 2); updated++
      } else {
        mem.edges.push({ id: 'E_' + now + '_' + Math.random().toString(36).slice(2, 6), description: lesson.description, type: type, tags: lesson.tags || [], winRate: lesson.evidence ? parseFloat(((lesson.evidence.wins / (lesson.evidence.wins + lesson.evidence.losses)) * 100).toFixed(1)) : 0, sampleSize: (lesson.evidence && (lesson.evidence.wins + lesson.evidence.losses)) || (lesson.evidence && lesson.evidence.total) || 1, firstSeen: now, lastSeen: now, confidence: lesson.confidence || 50, active: true }); added++
      }
    } else if (type === 'MISTAKE' || type === 'TIMING') {
      const existing = _findMemoryEntry(mem.mistakes, lesson.tags)
      if (existing) {
        existing.frequency++; existing.lastSeen = now
        if (existing.frequency >= 5) existing.severity = 'HIGH'
        else if (existing.frequency >= 3) existing.severity = 'MEDIUM'
        updated++
      } else {
        mem.mistakes.push({ id: 'M_' + now + '_' + Math.random().toString(36).slice(2, 6), description: lesson.description, type: type, tags: lesson.tags || [], frequency: 1, firstSeen: now, lastSeen: now, severity: 'LOW', resolved: false }); added++
      }
    } else { skipped++ }
  }
  if (mem.edges.length > 100) mem.edges = mem.edges.slice(-100)
  if (mem.mistakes.length > 100) mem.mistakes = mem.mistakes.slice(-100)
  return { added, updated, skipped }
}

export function teacherUpdatePatternMemory(trades: any): any {
  const T = getTeacher()
  if (!T || !trades || trades.length === 0) return { patternsUpdated: 0, newPatterns: 0 }
  const mem = T.memory; if (!mem.patterns) mem.patterns = []
  const patStats: any = {}
  for (let i = 0; i < trades.length; i++) {
    const pats = w.teacherClassifyPattern(trades[i])
    for (let j = 0; j < pats.length; j++) {
      const name = pats[j].name
      if (!patStats[name]) patStats[name] = { wins: 0, losses: 0, total: 0, totalPnl: 0 }
      patStats[name].total++; patStats[name].totalPnl += trades[i].pnlNet || 0
      if (trades[i].outcome === 'WIN') patStats[name].wins++
      else if (trades[i].outcome === 'LOSS') patStats[name].losses++
    }
  }
  const now = Date.now(); let updated = 0, added = 0
  const patNames = Object.keys(patStats)
  for (let i = 0; i < patNames.length; i++) {
    const name = patNames[i]; const ps = patStats[name]; let existing: any = null
    for (let k = 0; k < mem.patterns.length; k++) { if (mem.patterns[k].name === name) { existing = mem.patterns[k]; break } }
    if (existing) {
      existing.count += ps.total; existing.wins = (existing.wins || 0) + ps.wins; existing.losses = (existing.losses || 0) + ps.losses
      existing.winRate = existing.count > 0 ? parseFloat(((existing.wins / existing.count) * 100).toFixed(1)) : 0
      existing.avgPnl = parseFloat(((existing.totalPnl + ps.totalPnl) / existing.count).toFixed(2))
      existing.totalPnl = parseFloat((existing.totalPnl + ps.totalPnl).toFixed(2)); existing.lastSeen = now
      existing.confidence = Math.min(95, 50 + existing.count * 3); updated++
    } else {
      mem.patterns.push({ id: 'P_' + now + '_' + name, name, count: ps.total, wins: ps.wins, losses: ps.losses, winRate: ps.total > 0 ? parseFloat(((ps.wins / ps.total) * 100).toFixed(1)) : 0, avgPnl: ps.total > 0 ? parseFloat((ps.totalPnl / ps.total).toFixed(2)) : 0, totalPnl: parseFloat(ps.totalPnl.toFixed(2)), firstSeen: now, lastSeen: now, confidence: Math.min(95, 50 + ps.total * 3) }); added++
    }
  }
  if (mem.patterns.length > 100) mem.patterns = mem.patterns.slice(-100)
  return { patternsUpdated: updated, newPatterns: added }
}

export function teacherPreTradeLookback(side: any, indicators: any): any {
  const T = getTeacher()
  if (!T || !T.memory) return { warnings: [], edges: [], patternInfo: [], memoryScore: 50 }
  const mem = T.memory; const warnings: any[] = [], edges: any[] = [], patternInfo: any[] = []
  const hypotheticalReasons: any[] = []
  if (indicators) {
    if (indicators.regime === 'TREND' || indicators.regime === 'BREAKOUT') hypotheticalReasons.push('REGIME_' + indicators.regime)
    else if (indicators.regime === 'RANGE') hypotheticalReasons.push('REGIME_RANGE')
    if (indicators.adx && indicators.adx >= 25) hypotheticalReasons.push('HIGH_ADX_TREND')
    else if (indicators.adx && indicators.adx < 20) hypotheticalReasons.push('LOW_ADX_RANGE')
    if (side === 'LONG') {
      if (indicators.macdDir === 'bull') hypotheticalReasons.push('MACD_CROSS_BULL')
      if (indicators.stDir === 'bull') hypotheticalReasons.push('ST_FLIP_BULL')
      if (indicators.confluence >= 65) hypotheticalReasons.push('CONFLUENCE_HIGH')
    } else {
      if (indicators.macdDir === 'bear') hypotheticalReasons.push('MACD_CROSS_BEAR')
      if (indicators.stDir === 'bear') hypotheticalReasons.push('ST_FLIP_BEAR')
      if (indicators.confluence <= 35) hypotheticalReasons.push('CONFLUENCE_LOW')
    }
  }
  const hypotheticalTrade = { entryReasons: hypotheticalReasons }
  const matchedPatterns = w.teacherClassifyPattern(hypotheticalTrade)
  for (let i = 0; i < matchedPatterns.length; i++) {
    const patName = matchedPatterns[i].name
    for (let j = 0; j < mem.patterns.length; j++) {
      if (mem.patterns[j].name === patName) {
        const p = mem.patterns[j]
        patternInfo.push({ name: p.name, winRate: p.winRate, count: p.count, avgPnl: p.avgPnl, verdict: p.winRate >= 60 ? 'FAVORABLE' : (p.winRate <= 40 ? 'UNFAVORABLE' : 'NEUTRAL') })
        if (p.winRate <= 35 && p.count >= 3) warnings.push('Pattern ' + p.name + ' has poor history: ' + p.winRate + '% win rate (' + p.count + ' samples)')
        if (p.winRate >= 65 && p.count >= 3) edges.push('Pattern ' + p.name + ' has strong edge: ' + p.winRate + '% win rate (' + p.count + ' samples)')
        break
      }
    }
  }
  for (let i = 0; i < mem.edges.length; i++) {
    const e = mem.edges[i]; if (!e.active || e.confidence < 50) continue
    let relevant = false
    for (let j = 0; j < e.tags.length; j++) {
      if (hypotheticalReasons.indexOf(e.tags[j]) !== -1 || (indicators && indicators.regime && e.tags[j] === 'REGIME_' + indicators.regime)) { relevant = true; break }
    }
    if (relevant) {
      if (e.type === 'AVOID' || (e.winRate < 35 && e.sampleSize >= 3)) warnings.push(e.description)
      else if (e.type === 'EDGE' && e.winRate >= 60) edges.push(e.description)
    }
  }
  for (let i = 0; i < mem.mistakes.length; i++) {
    const m = mem.mistakes[i]; if (m.resolved) continue
    if (m.severity === 'HIGH' || m.frequency >= 3) warnings.push('Recurring mistake: ' + m.description)
  }
  let memoryScore = 50 + edges.length * 10 - warnings.length * 15
  memoryScore = Math.max(0, Math.min(100, memoryScore))
  return { warnings, edges, patternInfo, memoryScore }
}

export function teacherEndSessionMemoryUpdate(trades: any): any {
  if (!trades || trades.length === 0) return { lessonsConsolidated: { added: 0, updated: 0, skipped: 0 }, patternsResult: { patternsUpdated: 0, newPatterns: 0 }, saved: false }
  const lessons = w.teacherExtractLessons(trades)
  const consolResult = teacherConsolidateMemory(lessons)
  const patResult = teacherUpdatePatternMemory(trades)
  let saved = false
  const _T2 = getTeacher(); if (_T2 && _T2.memory) saved = w.teacherSaveMemory(_T2.memory)
  return { lessonsConsolidated: consolResult, patternsResult: patResult, saved }
}

export function teacherMemorySummary(): any {
  const T = getTeacher()
  if (!T || !T.memory) return { totalPatterns: 0, totalEdges: 0, totalMistakes: 0, topEdge: null, worstMistake: null, activeMistakes: 0 }
  const mem = T.memory; const patterns = mem.patterns || []; const edges2 = mem.edges || []; const mistakes = mem.mistakes || []
  let topEdge: any = null
  for (let i = 0; i < edges2.length; i++) {
    if (edges2[i].active && edges2[i].sampleSize >= 3 && edges2[i].type === 'EDGE') {
      if (!topEdge || edges2[i].winRate > topEdge.winRate) topEdge = { description: edges2[i].description, winRate: edges2[i].winRate, sampleSize: edges2[i].sampleSize }
    }
  }
  let worstMistake: any = null, activeMistakes = 0
  for (let i = 0; i < mistakes.length; i++) {
    if (!mistakes[i].resolved) {
      activeMistakes++
      if (!worstMistake || mistakes[i].frequency > worstMistake.frequency) worstMistake = { description: mistakes[i].description, frequency: mistakes[i].frequency, severity: mistakes[i].severity }
    }
  }
  return { totalPatterns: patterns.length, totalEdges: edges2.length, totalMistakes: mistakes.length, topEdge, worstMistake, activeMistakes }
}

export function teacherResolveMistake(mistakeId: any): boolean {
  const T = getTeacher(); if (!T || !T.memory || !T.memory.mistakes) return false
  for (let i = 0; i < T.memory.mistakes.length; i++) { if (T.memory.mistakes[i].id === mistakeId) { T.memory.mistakes[i].resolved = true; return true } }
  return false
}

export function teacherDeactivateEdge(edgeId: any): boolean {
  const T = getTeacher(); if (!T || !T.memory || !T.memory.edges) return false
  for (let i = 0; i < T.memory.edges.length; i++) { if (T.memory.edges[i].id === edgeId) { T.memory.edges[i].active = false; return true } }
  return false
}

export function teacherClearMemory(): boolean {
  const T = getTeacher(); if (!T) return false
  T.memory = { patterns: [], edges: [], mistakes: [] }
  w.teacherSaveMemory(T.memory)
  return true
}

;(function _teacherMemoryGlobals() {
  if (typeof window !== 'undefined') {
    w.teacherConsolidateMemory = teacherConsolidateMemory
    w.teacherUpdatePatternMemory = teacherUpdatePatternMemory
    w.teacherPreTradeLookback = teacherPreTradeLookback
    w.teacherEndSessionMemoryUpdate = teacherEndSessionMemoryUpdate
    w.teacherMemorySummary = teacherMemorySummary
    w.teacherResolveMistake = teacherResolveMistake
    w.teacherDeactivateEdge = teacherDeactivateEdge
    w.teacherClearMemory = teacherClearMemory
  }
})()
