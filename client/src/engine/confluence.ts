// Zeus — engine/confluence.ts
// Ported 1:1 from public/js/brain/confluence.js (Phase 5A)
// Confluence score computation

const w = window as any

export function calcConfluenceScore(): void {
  // [PATCH5 BRAIN-OFF] No confluence scoring when AT is disabled
  // [FIX R9] Reset scores to neutral on AT disable — prevents stale cache on re-enable
  if (!w.AT.enabled) {
    if (typeof w.BM !== 'undefined') w.BM.confluenceScore = 50
    w.CORE_STATE.score = 50
    w.CORE_STATE.lastUpdate = Date.now()
    return
  }
  // FIX: ruleaza mereu, nu mai returneaza devreme
  const { bullCount = 0, bearCount = 0 } = w.S.signalData || {}
  const total = bullCount + bearCount
  const rsiV = (w.S.rsi && w.S.rsi['5m']) || 50
  const rsiScore = rsiV > 70 ? 80 : rsiV < 30 ? 80 : rsiV > 55 ? 60 : rsiV < 45 ? 60 : 50
  const rsiDir = rsiV > 50 ? 'bull' : 'bear'
  const signalRatioScore = total > 0 ? Math.min(100, (bullCount / (total || 1)) * 100) : 50
  const stScore = w.S.signalData && w.S.signalData.signals && w.S.signalData.signals.find((s: any) => s.name?.includes('Supertrend')) ? 80 : 50
  const stDir = w.S.signalData && w.S.signalData.signals && w.S.signalData.signals.find((s: any) => s.name?.includes('Supertrend') && s.dir === 'bull') ? 'bull' : 'bear'
  const lsScore = w.S.ls ? (w.S.ls.l > 55 || w.S.ls.s > 55 ? 75 : 50) : 50
  const lsDir = w.S.ls ? (w.S.ls.l > w.S.ls.s ? 'bull' : 'bear') : 'neut'
  const frScore = w.S.fr !== null && w.S.fr !== undefined ? (Math.abs(w.S.fr) * 10000 > 5 ? 70 : 50) : 50
  const frDir = w.S.fr !== null && w.S.fr !== undefined ? (w.S.fr < 0 ? 'bull' : 'bear') : 'neut'
  // [ZT-AUD-B3] OI stale guard — if last fetch >5min ago, neutralise to prevent stale bias
  const oiStale = !w.S.oiTs || (Date.now() - w.S.oiTs > 300000)
  const oiScore = (!oiStale && w.S.oiPrev && w.S.oi) ? ((Math.abs(w.S.oi - w.S.oiPrev) / w.S.oiPrev) * 100 > 0.1 ? 70 : 50) : 50
  // [FIX R1] Neutral fallback when OI data is missing — prevents hidden bear bias
  const oiDir = (oiStale || (w.S.oi == null && w.S.oiPrev == null)) ? 'neut' : ((w.S.oi || 0) > (w.S.oiPrev || 0) ? 'bull' : 'bear')
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
  // [FIX v85.1 F3] Scrie în memorie — sursă unică de adevăr, DOM e doar afișaj
  if (typeof w.BM !== 'undefined') w.BM.confluenceScore = finalScore
  // [P0.4] Decision log — confluence snapshot
  if (typeof w.DLog !== 'undefined') w.DLog.record('confluence', { score: finalScore, bull: bullCount, bear: bearCount, rsi: rsiScore, st: stScore, ls: lsScore, fr: frScore, oi: oiScore })
  // [v119] Sync CORE_STATE — unica sursa de adevar pentru logica
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

  // [SR] Înregistrăm semnalul de confluenţă dacă scorul depăşeşte pragul (>=55 sau <=45)
  if (finalScore >= 55 || finalScore <= 45) {
    const dir = finalScore >= 55 ? 'LONG' : 'SHORT'
    const label = finalScore >= 75 ? 'STRONG BULL' : finalScore >= 60 ? 'BULLISH' : finalScore >= 45 ? 'NEUTRAL' : finalScore >= 30 ? 'BEARISH' : 'STRONG BEAR'
    if (typeof w.srRecord === 'function') w.srRecord('confluence', label, dir, finalScore)
  }
}
