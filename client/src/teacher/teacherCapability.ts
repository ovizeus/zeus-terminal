// Zeus — teacher/teacherCapability.ts
// Ported 1:1 from public/js/teacher/teacherCapability.js (Phase 7C)
// TEACHER V2 — Capability Score (0-100)

const w = window as any

export const TEACHER_CAPABILITY_WEIGHTS: any = {
  survivalRate: 15, drawdownControl: 12, profitFactor: 12, expectancy: 10,
  winRate: 8, calibrationQuality: 8, consistency: 8, regimeCoverage: 6,
  timeframeCoverage: 5, profileCoverage: 4, mistakeReduction: 4,
  edgeStability: 3, noTradeDiscipline: 3, recoveryFactor: 2,
}

const TEACHER_CAPABILITY_LABELS = [
  { min: 0, max: 19, label: 'WEAK' }, { min: 20, max: 39, label: 'IMPROVING' },
  { min: 40, max: 59, label: 'DECENT' }, { min: 60, max: 79, label: 'STRONG' },
  { min: 80, max: 100, label: 'ELITE' },
]

function _teacherCapLabel(score: any): string {
  for (let i = 0; i < TEACHER_CAPABILITY_LABELS.length; i++) { if (score >= TEACHER_CAPABILITY_LABELS[i].min && score <= TEACHER_CAPABILITY_LABELS[i].max) return TEACHER_CAPABILITY_LABELS[i].label }
  return 'WEAK'
}

function _capSurvivalRate(v2: any): number { if (v2.lifetimeSessions === 0) return 0; return Math.max(0, Math.min(1, 1 - (v2.failCount / v2.lifetimeSessions) * 2)) }
function _capDrawdownControl(v2: any): number { if (!v2.lifetimeStats) return 0; const maxDD = Math.abs(v2.lifetimeStats.maxDrawdownPct || 0); if (maxDD <= 5) return 1; if (maxDD >= 50) return 0; return 1 - (maxDD - 5) / 45 }
function _capProfitFactor(v2: any): number { if (!v2.lifetimeStats) return 0; const pf = v2.lifetimeStats.profitFactor || 0; if (pf <= 0) return 0; if (pf >= 3) return 1; return pf / 3 }
function _capExpectancy(v2: any): number { if (!v2.lifetimeStats) return 0; const exp = v2.lifetimeStats.expectancy || 0; const normExp = exp / (v2.startCapital * 0.01); if (normExp <= 0) return 0; if (normExp >= 2) return 1; return normExp / 2 }
function _capWinRate(v2: any): number { if (!v2.lifetimeStats) return 0; const wr = v2.lifetimeStats.winRate || 0; if (wr <= 30) return 0; if (wr >= 70) return 1; return (wr - 30) / 40 }

function _capCalibrationQuality(_v2: any): number {
  if (!w.TEACHER) return 0; const T = w.TEACHER
  if (!T.calibration || typeof T.calibration.realWR !== 'number') return 0.3
  const gap = Math.abs(T.calibration.predictedWR - T.calibration.realWR)
  if (gap <= 2) return 1; if (gap >= 20) return 0; return 1 - (gap - 2) / 18
}

function _capConsistency(v2: any): number {
  if (v2.lifetimeSessions < 5) return 0; if (!v2.curriculum || !v2.curriculum.sessionHistory) return 0
  const pnls: any[] = []; const hist = v2.curriculum.sessionHistory
  for (let i = 0; i < hist.length; i++) { if (typeof hist[i].totalPnl === 'number') pnls.push(hist[i].totalPnl) }
  if (pnls.length < 5) return 0
  let mean = 0; for (let j = 0; j < pnls.length; j++) mean += pnls[j]; mean /= pnls.length; if (mean <= 0) return 0
  let variance = 0; for (let k = 0; k < pnls.length; k++) variance += (pnls[k] - mean) * (pnls[k] - mean); variance /= pnls.length
  const cv = Math.sqrt(variance) / Math.abs(mean)
  if (cv <= 0.5) return 1; if (cv >= 3) return 0; return 1 - (cv - 0.5) / 2.5
}

function _capRegimeCoverage(v2: any): number { if (!v2.curriculum) return 0; const metrics = w.teacherGetCoverageMetrics(v2.curriculum); return metrics.regimeCoverage / 100 }
function _capTimeframeCoverage(v2: any): number { if (!v2.curriculum) return 0; const metrics = w.teacherGetCoverageMetrics(v2.curriculum); return metrics.tfCoverage / 100 }
function _capProfileCoverage(v2: any): number { if (!v2.curriculum) return 0; const metrics = w.teacherGetCoverageMetrics(v2.curriculum); return metrics.profileCoverage / 100 }

function _capMistakeReduction(v2: any): number {
  if (v2.lifetimeTrades.length < 100) return 0
  const half = Math.floor(v2.lifetimeTrades.length / 2)
  const firstHalf = v2.lifetimeTrades.slice(0, half); const secondHalf = v2.lifetimeTrades.slice(half)
  function mistakeRatio(arr: any): number { let mistakes = 0; for (let i = 0; i < arr.length; i++) { const cl = arr[i]._classification; if (cl === 'MISTAKE' || cl === 'BAD_TRADE' || cl === 'AVOIDABLE_LOSS') mistakes++ }; return arr.length > 0 ? mistakes / arr.length : 0 }
  const r1 = mistakeRatio(firstHalf); const r2 = mistakeRatio(secondHalf)
  if (r1 <= 0) return 0.5; const improvement = (r1 - r2) / r1
  return Math.max(0, Math.min(1, 0.5 + improvement * 0.5))
}

function _capEdgeStability(v2: any): number {
  if (!v2.curriculum) return 0; const cv = w.teacherComputeCrossValidation(v2.curriculum)
  if (!cv || cv.sampleIS < 20 || cv.sampleOOS < 10) return 0
  const ratio = cv.pfIS > 0 ? cv.pfOOS / cv.pfIS : 0
  if (ratio >= 0.8 && ratio <= 1.2) return 1; if (ratio >= 0.5 && ratio <= 1.5) return 0.5; return 0
}

function _capNoTradeDiscipline(v2: any): number {
  if (v2.lifetimeSessions < 5) return 0; let totalBars = 0
  const hist = v2.curriculum ? v2.curriculum.sessionHistory : []
  for (let i = 0; i < hist.length; i++) totalBars += (hist[i].barsReplayed || 200)
  if (totalBars === 0) return 0; const tradesPerBar = v2.lifetimeTrades.length / totalBars
  if (tradesPerBar <= 0.02) return 1; if (tradesPerBar >= 0.1) return 0; return 1 - (tradesPerBar - 0.02) / 0.08
}

function _capRecoveryFactor(v2: any): number {
  if (!v2.lifetimeStats) return 0; const netProfit = v2.lifetimeStats.totalPnl || 0; const maxDD = Math.abs(v2.lifetimeStats.maxDrawdown || 1)
  if (netProfit <= 0) return 0; const rf = netProfit / maxDD; if (rf >= 3) return 1; return rf / 3
}

function _teacherCapPenalties(v2: any): any {
  const penalties: any[] = []; let totalPenalty = 0
  const trades = v2.lifetimeTrades.length
  if (trades < 100) { const p = Math.round((1 - trades / 100) * 15); penalties.push({ name: 'sampleSize', value: p, reason: 'Only ' + trades + ' trades (need 100+)' }); totalPenalty += p }
  if (v2.failCount > 0) { const ruinP = Math.min(20, v2.failCount * 5); penalties.push({ name: 'ruin', value: ruinP, reason: v2.failCount + ' ruin(s)' }); totalPenalty += ruinP }
  if (v2.curriculum) { const coverage = w.teacherGetCoverageMetrics(v2.curriculum); if (coverage.regimeCoverage < 50) { const rgP = Math.round((50 - coverage.regimeCoverage) / 50 * 10); penalties.push({ name: 'regimeBlind', value: rgP, reason: 'Only ' + coverage.regimeCoverage.toFixed(0) + '% regime coverage' }); totalPenalty += rgP } }
  if (v2.curriculum && v2.curriculum.sessionHistory && v2.curriculum.sessionHistory.length >= 10) {
    const hist = v2.curriculum.sessionHistory; let recentPnl = 0, olderPnl = 0; const recentN = Math.min(5, hist.length); const olderN = hist.length - recentN
    for (let i = hist.length - recentN; i < hist.length; i++) recentPnl += (hist[i].totalPnl || 0)
    for (let j = 0; j < hist.length - recentN; j++) olderPnl += (hist[j].totalPnl || 0)
    if (olderN > 0) olderPnl /= olderN; recentPnl /= recentN
    if (recentPnl < olderPnl * 0.5 && olderPnl > 0) { penalties.push({ name: 'instability', value: 8, reason: 'Recent performance degrading' }); totalPenalty += 8 }
  }
  if (v2.curriculum) { const cv = w.teacherComputeCrossValidation(v2.curriculum); if (cv && cv.sampleIS >= 20 && cv.sampleOOS >= 10 && cv.overfitDetected) { const oosP = Math.round(Math.min(15, (cv.wrGap || 0) * 0.5 + 5)); penalties.push({ name: 'oosGap', value: oosP, reason: 'IS-OOS gap detected (WR gap ' + cv.wrGap.toFixed(1) + '%)' }); totalPenalty += oosP } }
  return { penalties, totalPenalty: Math.min(totalPenalty, 50) }
}

export function teacherComputeCapability(v2: any): any {
  if (!v2) return { score: 0, label: 'WEAK', breakdown: null }
  const components: any = {
    survivalRate: _capSurvivalRate(v2), drawdownControl: _capDrawdownControl(v2), profitFactor: _capProfitFactor(v2),
    expectancy: _capExpectancy(v2), winRate: _capWinRate(v2), calibrationQuality: _capCalibrationQuality(v2),
    consistency: _capConsistency(v2), regimeCoverage: _capRegimeCoverage(v2), timeframeCoverage: _capTimeframeCoverage(v2),
    profileCoverage: _capProfileCoverage(v2), mistakeReduction: _capMistakeReduction(v2), edgeStability: _capEdgeStability(v2),
    noTradeDiscipline: _capNoTradeDiscipline(v2), recoveryFactor: _capRecoveryFactor(v2),
  }
  let rawScore = 0; const breakdown: any = {}
  for (const key in components) {
    const weight = TEACHER_CAPABILITY_WEIGHTS[key] || 0; const val = components[key]; const pts = val * weight; rawScore += pts
    breakdown[key] = { fraction: parseFloat(val.toFixed(3)), weight, points: parseFloat(pts.toFixed(2)) }
  }
  const penaltyResult = _teacherCapPenalties(v2)
  const finalScore = Math.max(0, Math.min(100, Math.round(rawScore - penaltyResult.totalPenalty)))
  return { score: finalScore, label: _teacherCapLabel(finalScore), rawScore: Math.round(rawScore), penaltyTotal: penaltyResult.totalPenalty, penalties: penaltyResult.penalties, breakdown, timestamp: Date.now() }
}

export function teacherGetCapabilitySummary(): any {
  const T = w.TEACHER; if (!T || !T.v2) return null; const v2 = T.v2
  return { score: v2.capability, label: v2.capabilityLabel, sessions: v2.lifetimeSessions, totalTrades: v2.lifetimeTrades.length, failCount: v2.failCount, capital: v2.currentCapital, status: v2.status, statusDetail: v2.statusDetail }
}

;(function _teacherCapabilityGlobals() {
  if (typeof window !== 'undefined') {
    w.TEACHER_CAPABILITY_WEIGHTS = TEACHER_CAPABILITY_WEIGHTS
    w.teacherComputeCapability = teacherComputeCapability; w.teacherGetCapabilitySummary = teacherGetCapabilitySummary
  }
})()
