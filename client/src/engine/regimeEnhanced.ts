/**
 * detectRegimeEnhanced — extracted from brain.ts to break circular dep brain↔regime.
 * Pure function: analyzes klines and returns regime classification.
 * Both brain.ts and regime.ts can import from here without circularity.
 */

export function detectRegimeEnhanced(klines: any): any {
  if (!klines || klines.length < 50) return { regime: 'unknown', adx: 0, vol: '—', structure: '—', squeeze: false }
  const last = klines.slice(-50)
  const closes = last.map((k: any) => k.close)
  const highs = last.map((k: any) => k.high)
  const lows = last.map((k: any) => k.low)
  const vols = last.map((k: any) => k.volume)

  // ATR
  const atrs = last.slice(1).map((k: any, i: number) => Math.max(k.high - k.low, Math.abs(k.high - last[i].close), Math.abs(k.low - last[i].close)))
  const avgATR = atrs.reduce((a: number, b: number) => a + b, 0) / atrs.length
  const atrPct = avgATR / closes[closes.length - 1] * 100

  // EMA
  const calcEMA = (data: any, p: number) => { const k = 2 / (p + 1); let e = data[0]; return data.map((v: number) => { e = v * k + e * (1 - k); return e }) }
  const ema20 = calcEMA(closes, 20)
  const ema50 = calcEMA(closes, 50)
  const slope20 = (ema20[ema20.length - 1] - ema20[ema20.length - 10]) / ema20[ema20.length - 10] * 100

  // ADX approximation
  let plusDM = 0, minusDM = 0, tr = 0
  for (let i = 1; i < last.length; i++) {
    const upMove = last[i].high - last[i - 1].high
    const downMove = last[i - 1].low - last[i].low
    if (upMove > downMove && upMove > 0) plusDM += upMove
    if (downMove > upMove && downMove > 0) minusDM += downMove
    tr += Math.max(last[i].high - last[i].low, Math.abs(last[i].high - last[i - 1].close), Math.abs(last[i].low - last[i - 1].close))
  }
  const adx = tr > 0 ? Math.round(Math.abs(plusDM - minusDM) / tr * 100) : 0

  // Volume trend
  const avgVolRecent = vols.slice(-5).reduce((a: number, b: number) => a + b, 0) / 5
  const avgVolOld = vols.slice(-20, -5).reduce((a: number, b: number) => a + b, 0) / 15
  const volMode = avgVolRecent > avgVolOld * 1.3 ? 'expansion' : avgVolRecent < avgVolOld * 0.7 ? 'contraction' : 'normal'

  // Structure: HH/HL or LH/LL
  const recentHighs = highs.slice(-10)
  const recentLows = lows.slice(-10)
  const hhCount = recentHighs.slice(1).filter((h: number, i: number) => h > recentHighs[i]).length
  const llCount = recentLows.slice(1).filter((l: number, i: number) => l < recentLows[i]).length
  const structure = hhCount >= 6 ? 'HH/HL' : llCount >= 6 ? 'LH/LL' : 'MIXED'

  // Squeeze: Bollinger inside Keltner
  const bb20 = calcEMA(closes, 20)
  const stddev = Math.sqrt(closes.slice(-20).reduce((a: number, v: number) => a + (v - bb20[bb20.length - 1]) ** 2, 0) / 20)
  const squeeze = stddev < avgATR * 1.5

  // Regime
  let regime = 'unknown'
  if (atrPct > 2.5) regime = 'panic'
  else if (atrPct > 1.5 && volMode === 'expansion' && adx > 30) regime = 'breakout'
  else if (adx > 25 && Math.abs(slope20) > 0.3) regime = 'trend'
  else if (squeeze) regime = 'squeeze'
  else regime = 'range'

  // suppress unused
  void ema50

  return { regime, adx, volMode, structure, squeeze, atrPct, slope20, confidence: adx }
}
