// Zeus — engine/confluence.ts
// Ported 1:1 from public/js/brain/confluence.js (Phase 5A)
// Confluence score computation
// [8B-mini] READS migrated to stateAccessors. WRITES remain on window.* (bridge).

import { getATEnabled, getSignalData, getRSI, getLS, getFR, getOI } from '../services/stateAccessors'

const w = window as any // kept for WRITES only (w.BM, w.CORE_STATE, w.el, w.DLog, w.srRecord)

export function calcConfluenceScore(): void {
  // [PATCH5 BRAIN-OFF] No confluence scoring when AT is disabled
  // [FIX R9] Reset scores to neutral on AT disable — prevents stale cache on re-enable
  if (!getATEnabled()) {
    if (typeof w.BM !== 'undefined') w.BM.confluenceScore = 50
    w.CORE_STATE.score = 50
    w.CORE_STATE.lastUpdate = Date.now()
    return
  }
  // FIX: ruleaza mereu, nu mai returneaza devreme
  const sd = getSignalData()
  const { bullCount, bearCount } = sd
  const total = bullCount + bearCount
  const rsiV = getRSI('5m') ?? 50
  const rsiScore = rsiV > 70 ? 80 : rsiV < 30 ? 80 : rsiV > 55 ? 60 : rsiV < 45 ? 60 : 50
  const rsiDir = rsiV > 50 ? 'bull' : 'bear'
  const signalRatioScore = total > 0 ? Math.min(100, (bullCount / (total || 1)) * 100) : 50
  const stScore = sd.signals.find((s: any) => s.name?.includes('Supertrend')) ? 80 : 50
  const stDir = sd.signals.find((s: any) => s.name?.includes('Supertrend') && s.dir === 'bull') ? 'bull' : 'bear'
  const ls = getLS()
  const lsScore = ls ? (ls.l > 55 || ls.s > 55 ? 75 : 50) : 50
  const lsDir = ls ? (ls.l > ls.s ? 'bull' : 'bear') : 'neut'
  const fr = getFR()
  const frScore = fr !== null ? (Math.abs(fr) * 10000 > 5 ? 70 : 50) : 50
  const frDir = fr !== null ? (fr < 0 ? 'bull' : 'bear') : 'neut'
  // [ZT-AUD-B3] OI stale guard — if last fetch >5min ago, neutralise to prevent stale bias
  const oi = getOI()
  const oiStale = !oi.oiTs || (Date.now() - oi.oiTs > 300000)
  const oiScore = (!oiStale && oi.oiPrev && oi.oi) ? ((Math.abs(oi.oi - oi.oiPrev) / oi.oiPrev) * 100 > 0.1 ? 70 : 50) : 50
  // [FIX R1] Neutral fallback when OI data is missing — prevents hidden bear bias
  const oiDir = (oiStale || (oi.oi == null && oi.oiPrev == null)) ? 'neut' : ((oi.oi || 0) > (oi.oiPrev || 0) ? 'bull' : 'bear')
  const dirs = [rsiDir, stDir, lsDir, frDir, oiDir]
  const bullDirs = dirs.filter((d: string) => d === 'bull').length
  const dirFactor = bullDirs / dirs.length
  const baseScore = dirFactor * 100
  const signalBoost = total >= 4 ? 20 : total >= 2 ? 10 : 0
  const finalScore = Math.round(Math.max(0, Math.min(100, bullCount > bearCount ? baseScore + signalBoost : bullCount < bearCount ? baseScore - signalBoost : baseScore)))
  const scoreEl = w.el('confScore')
  const labelEl = w.el('confLabel')
  const fillEl = w.el('confFill')
  const col = finalScore >= 65 ? 'var(--grn)' : finalScore <= 35 ? 'var(--red)' : 'var(--ylw)'
  // [FIX v85.1 F3] Write to BM — single source of truth, DOM is display only
  if (typeof w.BM !== 'undefined') w.BM.confluenceScore = finalScore
  // [P0.4] Decision log — confluence snapshot
  if (typeof w.DLog !== 'undefined') w.DLog.record('confluence', { score: finalScore, bull: bullCount, bear: bearCount, rsi: rsiScore, st: stScore, ls: lsScore, fr: frScore, oi: oiScore })
  // [v119] Sync CORE_STATE
  w.CORE_STATE.score = finalScore
  w.CORE_STATE.lastUpdate = Date.now()
  if (scoreEl) { scoreEl.textContent = finalScore; scoreEl.style.color = col }
  if (labelEl) {
    const txt = finalScore >= 75 ? 'STRONG BULL' : finalScore >= 60 ? 'BULLISH' : finalScore >= 45 ? 'NEUTRAL' : finalScore >= 30 ? 'BEARISH' : 'STRONG BEAR'
    labelEl.textContent = txt; labelEl.style.color = col
  }
  if (fillEl) { fillEl.style.width = finalScore + '%'; fillEl.style.background = col }
  if (typeof w.updateBrainArc === 'function') w.updateBrainArc(finalScore)
  const setBar = (id: string, sc: number, dir: string) => { const b = w.el(id); if (b) { b.style.width = sc + '%'; b.style.background = dir === 'bull' ? 'var(--grn)' : 'var(--red)' } }
  setBar('cbRSI', rsiScore, rsiDir); setBar('cbMACD', signalRatioScore, bullCount >= bearCount ? 'bull' : 'bear')
  setBar('cbST', stScore, stDir); setBar('cbLS', lsScore, lsDir)
  setBar('cbFR', frScore, frDir); setBar('cbOI', oiScore, oiDir)

  // [SR] Register confluence signal if score crosses threshold
  if (finalScore >= 55 || finalScore <= 45) {
    const dir = finalScore >= 55 ? 'LONG' : 'SHORT'
    const label = finalScore >= 75 ? 'STRONG BULL' : finalScore >= 60 ? 'BULLISH' : finalScore >= 45 ? 'NEUTRAL' : finalScore >= 30 ? 'BEARISH' : 'STRONG BEAR'
    if (typeof w.srRecord === 'function') w.srRecord('confluence', label, dir, finalScore)
  }
}
