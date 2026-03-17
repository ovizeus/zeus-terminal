// Zeus v122 — brain/confluence.js
// Confluence score computation
'use strict';

function calcConfluenceScore() {
  // [PATCH5 BRAIN-OFF] No confluence scoring when AT is disabled
  // [FIX R9] Reset scores to neutral on AT disable — prevents stale cache on re-enable
  if (!AT.enabled) {
    if (typeof BM !== 'undefined') BM.confluenceScore = 50;
    window.CORE_STATE.score = 50;
    window.CORE_STATE.lastUpdate = Date.now();
    return;
  }
  // FIX: ruleaza mereu, nu mai returneaza devreme
  const { bullCount = 0, bearCount = 0 } = S.signalData || {};
  const total = bullCount + bearCount;
  const rsiV = (S.rsi && S.rsi['5m']) || 50;
  const rsiScore = rsiV > 70 ? 80 : rsiV < 30 ? 80 : rsiV > 55 ? 60 : rsiV < 45 ? 60 : 50;
  const rsiDir = rsiV > 50 ? 'bull' : 'bear';
  const signalRatioScore = total > 0 ? Math.min(100, (bullCount / (total || 1)) * 100) : 50;
  const stScore = S.signalData && S.signalData.signals && S.signalData.signals.find(s => s.name.includes('Supertrend')) ? 80 : 50;
  const stDir = S.signalData && S.signalData.signals && S.signalData.signals.find(s => s.name.includes('Supertrend') && s.dir === 'bull') ? 'bull' : 'bear';
  const lsScore = S.ls ? (S.ls.l > 55 || S.ls.s > 55 ? 75 : 50) : 50;
  const lsDir = S.ls ? (S.ls.l > S.ls.s ? 'bull' : 'bear') : 'neut';
  const frScore = S.fr !== null && S.fr !== undefined ? (Math.abs(S.fr) * 10000 > 5 ? 70 : 50) : 50;
  const frDir = S.fr !== null && S.fr !== undefined ? (S.fr < 0 ? 'bull' : 'bear') : 'neut';
  const oiScore = S.oiPrev && S.oi ? ((Math.abs(S.oi - S.oiPrev) / S.oiPrev) * 100 > 0.1 ? 70 : 50) : 50;
  // [FIX R1] Neutral fallback when OI data is missing — prevents hidden bear bias
  const oiDir = (S.oi == null && S.oiPrev == null) ? 'neut' : ((S.oi || 0) > (S.oiPrev || 0) ? 'bull' : 'bear');
  const dirs = [rsiDir, stDir, lsDir, frDir, oiDir];
  const bullDirs = dirs.filter(d => d === 'bull').length;
  const dirFactor = bullDirs / dirs.length;
  const baseScore = dirFactor * 100;
  const signalBoost = total >= 4 ? 20 : total >= 2 ? 10 : 0;
  const finalScore = Math.round(Math.max(0, Math.min(100, bullCount > bearCount ? baseScore + signalBoost : bullCount < bearCount ? baseScore - signalBoost : baseScore)));
  const scoreEl = el('confScore');
  const labelEl = el('confLabel');
  const fillEl = el('confFill');
  const col = finalScore >= 65 ? 'var(--grn)' : finalScore <= 35 ? 'var(--red)' : 'var(--ylw)';
  // [FIX v85.1 F3] Scrie în memorie — sursă unică de adevăr, DOM e doar afișaj
  if (typeof BM !== 'undefined') BM.confluenceScore = finalScore;
  // [v119] Sync CORE_STATE — unica sursa de adevar pentru logica
  window.CORE_STATE.score = finalScore;
  window.CORE_STATE.lastUpdate = Date.now();
  if (scoreEl) { scoreEl.textContent = finalScore; scoreEl.style.color = col; }
  if (labelEl) {
    const txt = finalScore >= 75 ? 'STRONG BULL' : finalScore >= 60 ? 'BULLISH' : finalScore >= 45 ? 'NEUTRAL' : finalScore >= 30 ? 'BEARISH' : 'STRONG BEAR';
    labelEl.textContent = txt; labelEl.style.color = col;
  }
  if (fillEl) { fillEl.style.width = finalScore + '%'; fillEl.style.background = col; }
  updateBrainArc(finalScore);
  const setBar = (id, sc, dir) => { const b = el(id); if (b) { b.style.width = sc + '%'; b.style.background = dir === 'bull' ? 'var(--grn)' : 'var(--red)'; } };
  setBar('cbRSI', rsiScore, rsiDir); setBar('cbMACD', signalRatioScore, bullCount >= bearCount ? 'bull' : 'bear');
  setBar('cbST', stScore, stDir); setBar('cbLS', lsScore, lsDir);
  setBar('cbFR', frScore, frDir); setBar('cbOI', oiScore, oiDir);

  // [SR] Înregistrăm semnalul de confluenţă dacă scorul depăşeşte pragul (>=55 sau <=45)
  if (finalScore >= 55 || finalScore <= 45) {
    const dir = finalScore >= 55 ? 'LONG' : 'SHORT';
    const label = finalScore >= 75 ? 'STRONG BULL' : finalScore >= 60 ? 'BULLISH' : finalScore >= 45 ? 'NEUTRAL' : finalScore >= 30 ? 'BEARISH' : 'STRONG BEAR';
    srRecord('confluence', label, dir, finalScore);
  }
}

