// Zeus — teacher/teacherCurriculum.ts
// Ported 1:1 from public/js/teacher/teacherCurriculum.js (Phase 7C)
// TEACHER V2 — Autonomous Curriculum Engine

const w = window as any

const TEACHER_CURRICULUM_START_YEAR = 2019
const TEACHER_CURRICULUM_START_MONTH = 10
export const TEACHER_ALL_TFS = ['1m', '3m', '5m', '15m', '1h', '4h']
export const TEACHER_SEGMENT_DAYS: any = { '1m': 3, '3m': 7, '5m': 10, '15m': 21, '1h': 45, '4h': 90 }

export function teacherInitCurriculum(): any {
  return {
    testedSegments: [], regimeCoverage: {}, tfCoverage: {}, profileCoverage: {},
    oosSegments: [], isSegments: [], oosStats: null, isStats: null,
    lastYear: 0, lastMonth: 0, lastTF: '', consecutiveSameRegime: 0, lastRegime: '',
    totalSessions: 0, currentPhase: 'EXPLORE',
  }
}

function _teacherGetAvailableMonths(): any[] {
  const months: any[] = []; const now = new Date(); const curYear = now.getFullYear(); const curMonth = now.getMonth() + 1
  for (let y = TEACHER_CURRICULUM_START_YEAR; y <= curYear; y++) {
    const startM = (y === TEACHER_CURRICULUM_START_YEAR) ? TEACHER_CURRICULUM_START_MONTH : 1
    const endM = (y === curYear) ? curMonth - 1 : 12
    for (let m = startM; m <= endM; m++) months.push({ year: y, month: m })
  }
  return months
}

export function teacherPickNextSegment(curriculum: any): any {
  if (!curriculum) curriculum = teacherInitCurriculum()
  const allMonths = _teacherGetAvailableMonths(); if (allMonths.length === 0) return null
  const tfPool = TEACHER_ALL_TFS.slice()
  tfPool.sort(function (a: any, b: any) { return (curriculum.tfCoverage[a] || 0) - (curriculum.tfCoverage[b] || 0) })
  let tf = tfPool[0]; if (tf === curriculum.lastTF && tfPool.length > 1) tf = tfPool[1]
  const scoredMonths: any[] = []
  for (let i = 0; i < allMonths.length; i++) {
    const ym = allMonths[i]; let timesUsed = 0
    for (let j = 0; j < curriculum.testedSegments.length; j++) { const seg = curriculum.testedSegments[j]; if (seg.year === ym.year && seg.month === ym.month) timesUsed++ }
    let recencyPenalty = 0; if (ym.year === curriculum.lastYear && ym.month === curriculum.lastMonth) recencyPenalty = 100
    scoredMonths.push({ year: ym.year, month: ym.month, score: timesUsed * 10 + recencyPenalty + Math.random() * 3 })
  }
  scoredMonths.sort(function (a: any, b: any) { return a.score - b.score })
  const topN = Math.min(5, scoredMonths.length); const pick = scoredMonths[Math.floor(Math.random() * topN)]
  const segDays = TEACHER_SEGMENT_DAYS[tf] || 14
  const daysInMonth = new Date(pick.year, pick.month, 0).getDate()
  const maxOffset = Math.max(0, daysInMonth - segDays)
  const startDay = 1 + Math.floor(Math.random() * Math.max(1, maxOffset))
  let startMs = new Date(pick.year, pick.month - 1, startDay, 0, 0, 0).getTime()
  let endMs = startMs + segDays * 86400000
  const now = Date.now(); if (endMs > now) endMs = now
  if (startMs >= endMs) { startMs = now - 7 * 86400000; endMs = now }
  const isOOS = (curriculum.totalSessions > 0) && (curriculum.totalSessions % 4 === 0)
  return { tf, startMs, endMs, year: pick.year, month: pick.month, startDay, segDays, isOOS, phase: isOOS ? 'VALIDATE' : 'LEARN' }
}

export function teacherRecordSegment(curriculum: any, segment: any, sessionResult: any): void {
  if (!curriculum || !segment) return
  curriculum.testedSegments.push({ year: segment.year, month: segment.month, tf: segment.tf, profile: sessionResult ? sessionResult.profile : 'UNKNOWN', regime: sessionResult ? sessionResult.dominantRegime : 'UNKNOWN', isOOS: segment.isOOS, sessionId: sessionResult ? sessionResult.sessionId : null, trades: sessionResult ? sessionResult.totalTrades : 0, pnl: sessionResult ? sessionResult.totalPnl : 0, winRate: sessionResult ? sessionResult.winRate : 0, timestamp: Date.now() })
  if (curriculum.testedSegments.length > 500) curriculum.testedSegments = curriculum.testedSegments.slice(-500)
  curriculum.tfCoverage[segment.tf] = (curriculum.tfCoverage[segment.tf] || 0) + 1
  if (sessionResult && sessionResult.profile) curriculum.profileCoverage[sessionResult.profile] = (curriculum.profileCoverage[sessionResult.profile] || 0) + 1
  if (sessionResult && sessionResult.dominantRegime) curriculum.regimeCoverage[sessionResult.dominantRegime] = (curriculum.regimeCoverage[sessionResult.dominantRegime] || 0) + 1
  curriculum.lastYear = segment.year; curriculum.lastMonth = segment.month; curriculum.lastTF = segment.tf; curriculum.totalSessions++
  const thisRegime = sessionResult ? sessionResult.dominantRegime : ''
  if (thisRegime === curriculum.lastRegime) curriculum.consecutiveSameRegime++; else curriculum.consecutiveSameRegime = 0
  curriculum.lastRegime = thisRegime
  if (curriculum.totalSessions < 5) curriculum.currentPhase = 'EXPLORE'
  else if (curriculum.totalSessions % 4 === 0) curriculum.currentPhase = 'VALIDATE'
  else curriculum.currentPhase = 'DEEPEN'
}

function _teacherAggSegmentStats(segs: any): any {
  if (!segs || segs.length === 0) return { avgWinRate: 0, avgPF: 0, avgPnl: 0, totalTrades: 0 }
  let totalWR = 0, totalPnl = 0, totalTrades = 0, count = 0
  for (let i = 0; i < segs.length; i++) { if (segs[i].trades > 0) { totalWR += segs[i].winRate || 0; totalPnl += segs[i].pnl || 0; totalTrades += segs[i].trades || 0; count++ } }
  return { avgWinRate: count > 0 ? totalWR / count : 0, avgPF: 0, avgPnl: count > 0 ? totalPnl / count : 0, totalTrades, sessions: count }
}

export function teacherComputeCrossValidation(curriculum: any): any {
  if (!curriculum || !curriculum.testedSegments || curriculum.testedSegments.length < 4) return { isStats: null, oosStats: null, gap: null, isValid: false, reason: 'INSUFFICIENT_DATA' }
  const isSegs: any[] = [], oosSegs: any[] = []
  for (let i = 0; i < curriculum.testedSegments.length; i++) { if (curriculum.testedSegments[i].isOOS) oosSegs.push(curriculum.testedSegments[i]); else isSegs.push(curriculum.testedSegments[i]) }
  if (oosSegs.length < 2) return { isStats: null, oosStats: null, gap: null, isValid: false, reason: 'NEED_MORE_OOS' }
  const isStats = _teacherAggSegmentStats(isSegs); const oosStats = _teacherAggSegmentStats(oosSegs)
  const wrGap = Math.abs(isStats.avgWinRate - oosStats.avgWinRate); const pfGap = Math.abs(isStats.avgPF - oosStats.avgPF); const pnlGap = Math.abs(isStats.avgPnl - oosStats.avgPnl)
  let overfit = false; const overfitReason: any[] = []
  if (wrGap > 15) { overfit = true; overfitReason.push('WR_GAP:' + wrGap.toFixed(1)) }
  if (isStats.avgPF > 0 && oosStats.avgPF > 0 && isStats.avgPF / oosStats.avgPF > 2) { overfit = true; overfitReason.push('PF_RATIO:' + (isStats.avgPF / oosStats.avgPF).toFixed(1)) }
  return { isStats, oosStats, gap: { winRate: wrGap, profitFactor: pfGap, pnl: pnlGap }, overfit, overfitReasons: overfitReason, isValid: true, isSampleSize: isSegs.length, oosSampleSize: oosSegs.length }
}

export function teacherGetCoverageMetrics(curriculum: any): any {
  if (!curriculum) return { regimePct: 0, tfPct: 0, profilePct: 0 }
  const targetRegimes = ['TREND', 'RANGE', 'SQUEEZE', 'EXPANSION', 'CAPITULATION', 'RECOVERY']
  let coveredRegimes = 0
  for (let i = 0; i < targetRegimes.length; i++) { if ((curriculum.regimeCoverage[targetRegimes[i]] || 0) >= 3) coveredRegimes++ }
  const regimePct = (coveredRegimes / targetRegimes.length) * 100
  let coveredTFs = 0
  for (let t = 0; t < TEACHER_ALL_TFS.length; t++) { if ((curriculum.tfCoverage[TEACHER_ALL_TFS[t]] || 0) >= 2) coveredTFs++ }
  const tfPct = (coveredTFs / TEACHER_ALL_TFS.length) * 100
  const profiles = ['FAST', 'SWING', 'DEFENSE']; let coveredP = 0
  for (let p = 0; p < profiles.length; p++) { if ((curriculum.profileCoverage[profiles[p]] || 0) >= 2) coveredP++ }
  const profilePct = (coveredP / profiles.length) * 100
  return { regimePct: Math.round(regimePct), tfPct: Math.round(tfPct), profilePct: Math.round(profilePct), regimeDetail: curriculum.regimeCoverage, tfDetail: curriculum.tfCoverage, profileDetail: curriculum.profileCoverage }
}

export function teacherShouldForceRotation(curriculum: any): boolean {
  if (!curriculum) return false; return curriculum.consecutiveSameRegime >= 3
}

export function teacherForceRotatedSegment(curriculum: any): any {
  const targetRegimes = ['TREND', 'RANGE', 'SQUEEZE', 'EXPANSION']
  let _leastRegime: any = null, leastCount = Infinity
  for (let i = 0; i < targetRegimes.length; i++) { const c = curriculum.regimeCoverage[targetRegimes[i]] || 0; if (c < leastCount) { leastCount = c; _leastRegime = targetRegimes[i] } }
  void _leastRegime
  let leastTF = TEACHER_ALL_TFS[0], ltCount = Infinity
  for (let t = 0; t < TEACHER_ALL_TFS.length; t++) { const tc = curriculum.tfCoverage[TEACHER_ALL_TFS[t]] || 0; if (tc < ltCount) { ltCount = tc; leastTF = TEACHER_ALL_TFS[t] } }
  const seg = teacherPickNextSegment(curriculum)
  if (seg) { seg.tf = leastTF; seg.forcedRotation = true }
  return seg
}

;(function _teacherCurriculumGlobals() {
  if (typeof window !== 'undefined') {
    w.TEACHER_ALL_TFS = TEACHER_ALL_TFS; w.TEACHER_SEGMENT_DAYS = TEACHER_SEGMENT_DAYS
    w.teacherInitCurriculum = teacherInitCurriculum; w.teacherPickNextSegment = teacherPickNextSegment
    w.teacherRecordSegment = teacherRecordSegment; w.teacherComputeCrossValidation = teacherComputeCrossValidation
    w.teacherGetCoverageMetrics = teacherGetCoverageMetrics; w.teacherShouldForceRotation = teacherShouldForceRotation
    w.teacherForceRotatedSegment = teacherForceRotatedSegment
  }
})()
