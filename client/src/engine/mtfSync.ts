// Zeus — engine/mtfSync.ts
// [ZT3-A] Option A adapter: compute MTFSnapshot from BM state and write into
// mtfStore. Mirrors the classification logic previously embedded in
// renderMTFPanel() (core/config.ts). MTFPanel.tsx consumes this snapshot —
// no document.getElementById writes here.

import { useMTFStore, type MTFSnapshot, type MTFDir, type MTFCell, type MTFTone } from '../stores/mtfStore'

const w = window as any

const cell = (text: string, tone: MTFTone = ''): MTFCell => ({ text, tone })

function fmtScore(score: number): string {
  return (score || 0) + ' / 100'
}

function fmtUpdated(ts: number | null): string {
  if (!ts) return '\u2014 actualizat la \u2014'
  try {
    const d = new Date(ts)
    return 'actualizat ' + d.toLocaleTimeString('ro-RO', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  } catch (_) {
    return '\u2014 actualizat la \u2014'
  }
}

export function syncMTFStore(): void {
  try {
    const BM = w.BM
    if (!BM) return
    const st = BM.structure || {}
    const lc = BM.liqCycle || {}
    const re = BM.regimeEngine || {}
    const pf = BM.phaseFilter || {}

    const rMap: Record<string, MTFTone> = { trend: 'good', breakout: 'good', squeeze: 'warn', range: 'warn', panic: 'bad', volatile: 'bad', unknown: '', 'insufficient data': '' }
    const regime = cell((st.regime || '\u2014').toUpperCase(), rMap[st.regime] || '')

    const structureTone: MTFTone = st.structureLabel === 'HH/HL' ? 'good' : st.structureLabel === 'LH/LL' ? 'bad' : 'warn'
    const structure = cell(st.structureLabel || '\u2014', structureTone)

    const atrTone: MTFTone = st.atrPct > 2 ? 'bad' : st.atrPct > 1 ? 'warn' : 'good'
    const atrPct = cell(st.atrPct ? st.atrPct.toFixed(2) + '%' : '\u2014', atrTone)

    const volModeTone: MTFTone = st.volMode === 'expansion' ? 'good' : st.volMode === 'contraction' ? 'warn' : ''
    const volMode = cell((st.volMode || '\u2014').toUpperCase(), volModeTone)

    const squeezeActive = !!st.squeeze
    const squeeze: MTFSnapshot['squeeze'] = { text: squeezeActive ? 'ACTIV' : 'OFF', tone: squeezeActive ? 'warn' : '' }

    const adxTone: MTFTone = st.adx > 30 ? 'good' : st.adx > 15 ? 'warn' : 'bad'
    const adx = cell(st.adx != null ? String(st.adx) : '\u2014', adxTone)

    const vrMap: Record<string, MTFTone> = { 'EXTREME': 'bad', 'HIGH': 'warn', 'MED': '', 'LOW': 'good' }
    const volRegime = cell(BM.volRegime || '\u2014', vrMap[BM.volRegime] || '')

    const volPctValue = BM.volPct
    const volPctTone: MTFTone = volPctValue != null ? (volPctValue >= 85 ? 'bad' : volPctValue >= 60 ? 'warn' : volPctValue < 30 ? 'good' : '') : ''
    const volPct = cell(volPctValue != null ? volPctValue + 'th percentila' : '\u2014 (acumulez date)', volPctTone)

    let sweep: MTFCell
    const sw = lc.sweepSimple
    if (sw && sw.dir !== '\u2014') {
      sweep = cell(sw.dir + (sw.strength > 0 ? ' ' + sw.strength + '%' : ''), sw.dir === 'BULL' ? 'good' : 'warn')
    } else {
      const swMap: Record<string, string> = { 'above': '\u2B06 ABOVE', 'below': '\u2B07 BELOW', 'none': '\u2014' }
      const text = swMap[lc.currentSweep] || '\u2014'
      const tone: MTFTone = lc.currentSweep !== 'none' ? (lc.sweepDisplacement ? 'good' : 'warn') : ''
      sweep = cell(text, tone)
    }

    let trapRate: MTFCell
    if (lc.trapRate != null) {
      const trPct = Math.round(lc.trapRate * 100)
      const tone: MTFTone = trPct >= 70 ? 'bad' : trPct >= 40 ? 'warn' : 'good'
      trapRate = cell(trPct + '% (' + lc.trapsTotal + '/' + lc.sweepsTotal + ')', tone)
    } else {
      trapRate = cell('\u2014 (date insuficiente)', '')
    }

    const magAboveTone: MTFTone = lc.magnetAboveDist != null ? (lc.magnetAboveDist < 0.5 ? 'warn' : '') : ''
    const magnetAbove = cell(lc.magnetAboveDist != null ? '+' + lc.magnetAboveDist + '%' : '\u2014', magAboveTone)

    const magBelowTone: MTFTone = lc.magnetBelowDist != null ? (lc.magnetBelowDist < 0.5 ? 'warn' : '') : ''
    const magnetBelow = cell(lc.magnetBelowDist != null ? '-' + lc.magnetBelowDist + '%' : '\u2014', magBelowTone)

    const biasMap: Record<string, string> = { 'above': '\u2B06 ABOVE', 'below': '\u2B07 BELOW', '\u2014': '\u2014' }
    const biasTone: MTFTone = lc.magnetBias === 'above' ? 'good' : lc.magnetBias === 'below' ? 'warn' : ''
    const magnetBias = cell(biasMap[lc.magnetBias] || '\u2014', biasTone)

    const align: MTFSnapshot['align'] = { '15m': { dir: 'neut', text: '15m \u2014' }, '1h': { dir: 'neut', text: '1h \u2014' }, '4h': { dir: 'neut', text: '4h \u2014' } }
    ;(['15m', '1h', '4h'] as const).forEach((tf) => {
      const dir: MTFDir = (st.mtfAlign && st.mtfAlign[tf]) || 'neut'
      const arrow = dir === 'bull' ? '\u25B2' : dir === 'bear' ? '\u25BC' : '\u2014'
      align[tf] = { dir, text: tf + ' ' + arrow }
    })

    const reRegimeMap: Record<string, MTFTone> = { 'TREND_UP': 'good', 'TREND_DOWN': 'bad', 'EXPANSION': 'good', 'SQUEEZE': 'warn', 'RANGE': '', 'CHAOS': 'bad', 'LIQUIDATION_EVENT': 'bad' }
    const reRegime = cell(re.regime || '\u2014', reRegimeMap[re.regime] || '')

    const reTrapTone: MTFTone = re.trapRisk >= 60 ? 'bad' : re.trapRisk >= 30 ? 'warn' : 'good'
    const reTrapRisk = cell(re.trapRisk != null ? re.trapRisk + '%' : '\u2014', reTrapTone)

    const reConfTone: MTFTone = re.confidence >= 70 ? 'good' : re.confidence >= 40 ? 'warn' : 'bad'
    const reConfidence = cell(re.confidence != null ? re.confidence + '%' : '\u2014', reConfTone)

    const pfMap: Record<string, MTFTone> = { 'TREND': 'good', 'EXPANSION': 'good', 'RANGE': '', 'SQUEEZE': 'warn', 'CHAOS': 'bad', 'LIQ_EVENT': 'bad' }
    const pfPhase = cell((pf.phase || '\u2014') + (pf.allow ? '' : ' \u2718'), pfMap[pf.phase] || '')

    const pfRiskTone: MTFTone = pf.riskMode === 'normal' ? 'good' : pf.riskMode === 'reduced' ? 'warn' : 'bad'
    const pfRiskMode = cell(pf.riskMode || '\u2014', pfRiskTone)

    const pfSizeTone: MTFTone = pf.sizeMultiplier >= 1 ? 'good' : pf.sizeMultiplier >= 0.6 ? 'warn' : 'bad'
    const pfSizeMult = cell(pf.sizeMultiplier != null ? '\u00D7' + pf.sizeMultiplier : '\u2014', pfSizeTone)

    const score = st.score || 0
    const snapshot: MTFSnapshot = {
      regime, structure, atrPct, volMode, squeeze, adx, volRegime, volPct,
      sweep, trapRate, magnetAbove, magnetBelow, magnetBias,
      align,
      score,
      scoreText: fmtScore(score),
      updatedAt: st.lastUpdate || null,
      updatedText: fmtUpdated(st.lastUpdate || null),
      re: { regime: reRegime, trapRisk: reTrapRisk, confidence: reConfidence },
      pf: { phase: pfPhase, riskMode: pfRiskMode, sizeMultiplier: pfSizeMult },
    }

    useMTFStore.getState().setSnapshot(snapshot)
  } catch (e: any) {
    console.warn('[MTF-SYNC] error:', e?.message || e)
  }
}
