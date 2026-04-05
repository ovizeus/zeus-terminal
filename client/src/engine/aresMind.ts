// Zeus — engine/aresMind.ts
// Ported 1:1 from public/js/brain/deepdive.js lines 1895-2001 (Phase 5B1)
// ARES_MIND — Cognitive memory tracking, prediction system

const w = window as any

const _shortMemory: any[] = []   // { ts, price, regime, score, dir, outcome }
const _predictions: any[] = []   // { ts, price, dir, targetPrice, resolved, correct }
let _cognitiveClarityPct = 0
let _pulseSpeed = 18             // viteza animatiei (s) — se adapteaza la ATR

function recordDecision(dir: string, score: number, regime: string, price: number): void {
  _shortMemory.unshift({ ts: Date.now(), dir, score, regime, price, outcome: null })
  if (_shortMemory.length > 10) _shortMemory.pop()
  _makePrediction(dir, price)
  _recalcClarity()
}

function resolveOutcome(pnl: number): void {
  const pending = _shortMemory.find((m: any) => m.outcome === null)
  if (pending) pending.outcome = pnl >= 0 ? 'win' : 'loss'
  _resolvePredictions()
}

function _makePrediction(dir: string, price: number): void {
  if (!price || price <= 0) return
  const movePct = 0.003 + Math.random() * 0.004  // 0.3-0.7%
  const target = dir === 'LONG' ? price * (1 + movePct) : price * (1 - movePct)
  _predictions.unshift({ ts: Date.now(), price, dir, targetPrice: target, resolved: false, correct: null })
  if (_predictions.length > 20) _predictions.pop()
}

function _resolvePredictions(): void {
  const now = Date.now()
  const curPrice = (typeof w.S !== 'undefined') ? w.S.price : 0
  _predictions.forEach((p: any) => {
    if (p.resolved) return
    const age = now - p.ts
    if (age < 300000) return  // < 5 min — nu rezolvam
    if (!curPrice) return
    p.resolved = true
    p.correct = (p.dir === 'LONG' && curPrice >= p.targetPrice) ||
      (p.dir === 'SHORT' && curPrice <= p.targetPrice)
  })
}

function _recalcClarity(): void {
  let score = 50
  const price = (typeof w.S !== 'undefined') ? w.S.price : 0
  const regime = (typeof w.BM !== 'undefined') ? w.BM.regime : null
  const atr = (typeof w.S !== 'undefined') ? w.S.atr : null
  if (price > 0) score += 15
  if (regime && regime !== '\u2014') score += 10
  if (atr > 0) score += 10
  // Consistenta: ultimele 3 decizii in aceeasi directie = +10
  if (_shortMemory.length >= 3) {
    const last3 = _shortMemory.slice(0, 3).map((m: any) => m.dir)
    if (last3.every((d: string) => d === last3[0])) score += 10
  }
  // Penalizare volatilitate extrema
  if (atr > 0 && price > 0 && (atr / price) > 0.02) score -= 15
  _cognitiveClarityPct = Math.min(100, Math.max(0, Math.round(score)))
  // Adaptam viteza pulsului la volatilitate (ATR)
  if (atr > 0 && price > 0) {
    const volRatio = atr / price
    _pulseSpeed = volRatio > 0.015 ? 6 : volRatio > 0.008 ? 12 : 18
  }
}

function getPredictionAccuracy(): number | null {
  const resolved = _predictions.filter((p: any) => p.resolved)
  if (!resolved.length) return null
  const correct = resolved.filter((p: any) => p.correct).length
  return Math.round((correct / resolved.length) * 100)
}

function getPatternInsight(): string {
  if (_shortMemory.length < 3) return 'Acumulez date cognitive...'
  const wins = _shortMemory.filter((m: any) => m.outcome === 'win').length
  const losses = _shortMemory.filter((m: any) => m.outcome === 'loss').length
  const longs = _shortMemory.filter((m: any) => m.dir === 'LONG').length
  const shorts = _shortMemory.filter((m: any) => m.dir === 'SHORT').length
  const bias = longs > shorts ? 'LONG' : shorts > longs ? 'SHORT' : 'NEUTRU'
  if (wins > losses * 2) return `Pattern detectat: bias ${bias} cu win-rate ridicat`
  if (losses > wins * 2) return `Alert\u0103 cognitiv\u0103: rezultate slabe recent \u2014 recalibrez`
  return `Memorie echilibrat\u0103: ${wins}W / ${losses}L, bias ${bias}`
}

function getClarity(): number { return _cognitiveClarityPct }
function getPulseSpeed(): number { return _pulseSpeed }
function getMemory(): any[] { return _shortMemory }

export const ARES_MIND = {
  recordDecision, resolveOutcome, getClarity, getPulseSpeed,
  getPredictionAccuracy, getPatternInsight, getMemory
}
