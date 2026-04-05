// Zeus — teacher/teacherCalibration.ts
// Ported 1:1 from public/js/teacher/teacherCalibration.js (Phase 7C)
// THE TEACHER — Confidence calibration engine

const w = window as any

export function teacherBuildCalibrationData(trades: any): any[] {
  if (!trades || trades.length === 0) return []
  const data: any[] = []
  for (let i = 0; i < trades.length; i++) {
    const t = trades[i]; const entryAnalysis = w.teacherWhyEntered(t); if (!entryAnalysis) continue
    const predicted = entryAnalysis.confidence
    const actual = t.outcome === 'WIN' ? 100 : (t.outcome === 'BREAKEVEN' ? 50 : 0)
    data.push({ tradeId: t.id, predicted, actual, delta: predicted - actual, outcome: t.outcome, side: t.side })
  }
  return data
}

export function teacherCalibrationCurve(calibData: any, bucketSize?: any): any[] {
  if (!calibData || calibData.length === 0) return []
  bucketSize = bucketSize || 20
  const buckets: any = {}
  for (let i = 0; i < calibData.length; i++) {
    const d = calibData[i]; const key = Math.floor(d.predicted / bucketSize) * bucketSize
    if (!buckets[key]) buckets[key] = { predicted: [], wins: 0, total: 0 }
    buckets[key].predicted.push(d.predicted); buckets[key].total++; if (d.outcome === 'WIN') buckets[key].wins++
  }
  const result: any[] = []; const keys = Object.keys(buckets).map(Number).sort(function (a: any, b: any) { return a - b })
  for (let i = 0; i < keys.length; i++) {
    const k = keys[i]; const b = buckets[k]; let predSum = 0
    for (let j = 0; j < b.predicted.length; j++) predSum += b.predicted[j]
    const predAvg = predSum / b.predicted.length; const actualWR = (b.wins / b.total) * 100
    result.push({ rangeLabel: k + '-' + (k + bucketSize), from: k, to: k + bucketSize, count: b.total, predictedAvg: parseFloat(predAvg.toFixed(1)), actualWinRate: parseFloat(actualWR.toFixed(1)), gap: parseFloat((predAvg - actualWR).toFixed(1)) })
  }
  return result
}

export function teacherCalibrationScore(curve: any): any {
  if (!curve || curve.length === 0) return { score: 0, rating: 'INSUFFICIENT_DATA', avgGap: 0, details: 'Need more trades' }
  let totalGap = 0, totalWeight = 0
  for (let i = 0; i < curve.length; i++) { totalGap += Math.abs(curve[i].gap) * curve[i].count; totalWeight += curve[i].count }
  const avgGap = totalWeight > 0 ? totalGap / totalWeight : 0
  const score = Math.max(0, Math.min(100, Math.round(100 - avgGap)))
  let rating: string
  if (score >= 85) rating = 'EXCELLENT'; else if (score >= 70) rating = 'GOOD'; else if (score >= 50) rating = 'FAIR'; else if (score >= 30) rating = 'POOR'; else rating = 'VERY_POOR'
  let details: string
  if (avgGap < 10) details = 'Well-calibrated — confidence predictions match outcomes closely'
  else if (avgGap < 25) details = 'Slightly miscalibrated — review mid-confidence trades'
  else details = 'Poorly calibrated — systematic over/under-confidence detected'
  return { score, rating, avgGap: parseFloat(avgGap.toFixed(1)), details }
}

export function teacherConfidenceZones(curve: any): any {
  if (!curve) return { overconfident: [], underconfident: [], wellCalibrated: [] }
  const over: any[] = [], under: any[] = [], well: any[] = []
  for (let i = 0; i < curve.length; i++) {
    const c = curve[i]; if (c.count < 2) continue
    const entry = { range: c.rangeLabel, gap: c.gap, predicted: c.predictedAvg, actual: c.actualWinRate, count: c.count }
    if (c.gap > 15) over.push(entry); else if (c.gap < -15) under.push(entry); else well.push(entry)
  }
  return { overconfident: over, underconfident: under, wellCalibrated: well }
}

export function teacherCalibrationAdvice(curve: any, zones: any): any[] {
  if (!curve || !zones) return []
  const advice: any[] = []
  if (zones.overconfident.length > 0) {
    for (let i = 0; i < zones.overconfident.length; i++) { const z = zones.overconfident[i]; advice.push('OVERCONFIDENT in ' + z.range + '% zone: predicted ~' + z.predicted + '% but actual win rate is ' + z.actual + '%. Require more confirmation signals before entering.') }
  }
  if (zones.underconfident.length > 0) {
    for (let i = 0; i < zones.underconfident.length; i++) { const z = zones.underconfident[i]; advice.push('UNDERCONFIDENT in ' + z.range + '% zone: predicted ~' + z.predicted + '% but actually winning ' + z.actual + '%. Trust your signals more in this range.') }
  }
  if (zones.overconfident.length === 0 && zones.underconfident.length === 0 && zones.wellCalibrated.length > 0) advice.push('Well-calibrated across all confidence zones. Keep consistent.')
  return advice
}

export function teacherCalibrationReport(trades: any): any {
  const data = teacherBuildCalibrationData(trades); const curve = teacherCalibrationCurve(data); const score = teacherCalibrationScore(curve); const zones = teacherConfidenceZones(curve); const advice = teacherCalibrationAdvice(curve, zones)
  return { data, curve, score, zones, advice, totalTrades: trades ? trades.length : 0 }
}

;(function _teacherCalibrationGlobals() {
  if (typeof window !== 'undefined') {
    w.teacherBuildCalibrationData = teacherBuildCalibrationData; w.teacherCalibrationCurve = teacherCalibrationCurve
    w.teacherCalibrationScore = teacherCalibrationScore; w.teacherConfidenceZones = teacherConfidenceZones
    w.teacherCalibrationAdvice = teacherCalibrationAdvice; w.teacherCalibrationReport = teacherCalibrationReport
  }
})()
