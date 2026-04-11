// Zeus — engine/postMortem.ts
// Ported 1:1 from public/js/brain/deepdive.js lines 6-396 (Phase 5B1)
// PM (Post-Mortem) — pattern matcher + visual panel

import { _safeLocalStorageSet } from '../services/storage'
import { escHtml } from '../utils/dom'
import { atLog } from '../trading/autotrade'

const w = window as any

// ── PM Module (IIFE → object) ───────────────────────────────────
const KEY = 'zeus_postmortem_v1'
const MAX_REC = 200
const DECAY_48 = 0.50
const DECAY_96 = 0.25

function _load(): any[] {
  try { const r = localStorage.getItem(KEY); return r ? JSON.parse(r) : [] }
  catch (_) { return [] }
}

function _save(records: any[]): void {
  try { _safeLocalStorageSet(KEY, records.slice(0, MAX_REC)) }
  catch (_) { }
  if (typeof w._ucMarkDirty === 'function') w._ucMarkDirty('postmortem')
  if (typeof w._userCtxPush === 'function') w._userCtxPush()
}

function _calcATR(klines: any[], period?: number): number | null {
  period = period || 14
  if (!klines || klines.length < period + 1) return null
  let sum = 0
  for (let i = klines.length - period; i < klines.length; i++) {
    const k = klines[i], prev = klines[i - 1]
    const tr = Math.max(k.high - k.low, Math.abs(k.high - prev.close), Math.abs(k.low - prev.close))
    sum += tr
  }
  return sum / period
}

function _simWiderSL(klines: any[], entryIdx: number, side: string, entryPrice: number, slMultiplier: number, atr: number | null, tpPrice: number | null): any {
  if (!atr || entryIdx < 0 || entryIdx >= klines.length) return null
  const widerSL = side === 'LONG' ? entryPrice - atr * slMultiplier : entryPrice + atr * slMultiplier
  let slHit = false, tpHit = false
  for (let i = entryIdx + 1; i < Math.min(entryIdx + 60, klines.length); i++) {
    const k = klines[i]
    if (side === 'LONG') {
      if (k.low <= widerSL) { slHit = true; break }
      if (tpPrice && k.high >= tpPrice) { tpHit = true; break }
    } else {
      if (k.high >= widerSL) { slHit = true; break }
      if (tpPrice && k.low <= tpPrice) { tpHit = true; break }
    }
  }
  return { slHit, tpHit, widerSL: +widerSL.toFixed(4) }
}

function _simLateEntry(klines: any[], entryIdx: number, side: string, originalSL: number, tpPrice: number | null, delay: number): any {
  const lateIdx = entryIdx + delay
  if (lateIdx >= klines.length) return null
  const latePrice = klines[lateIdx].close
  let slHit = false, tpHit = false
  for (let i = lateIdx + 1; i < Math.min(lateIdx + 60, klines.length); i++) {
    const k = klines[i]
    if (side === 'LONG') {
      if (k.low <= originalSL) { slHit = true; break }
      if (tpPrice && k.high >= tpPrice) { tpHit = true; break }
    } else {
      if (k.high >= originalSL) { slHit = true; break }
      if (tpPrice && k.low <= tpPrice) { tpHit = true; break }
    }
  }
  const latePnlPct = side === 'LONG'
    ? ((tpHit ? tpPrice! : originalSL) - latePrice) / latePrice * 100
    : (latePrice - (tpHit ? tpPrice! : originalSL)) / latePrice * 100
  return { slHit, tpHit, latePrice: +latePrice.toFixed(4), estPnlPct: +latePnlPct.toFixed(2) }
}

function _checkRebound(klines: any[], exitIdx: number, side: string, entryPrice: number, windowCandles?: number): boolean {
  windowCandles = windowCandles || 8
  if (exitIdx < 0) return false
  const end = Math.min(exitIdx + windowCandles, klines.length)
  for (let i = exitIdx + 1; i < end; i++) {
    if (side === 'LONG' && klines[i].close > entryPrice) return true
    if (side === 'SHORT' && klines[i].close < entryPrice) return true
  }
  return false
}

function _buildInsight(pnl: number, slAtrRatio: number | null, sim15: any, sim20: any, lateEntry: any[], rebound: boolean, atr: number | null): string {
  const parts: string[] = []
  if (pnl < 0) {
    if (slAtrRatio && slAtrRatio < 1.0) parts.push('SL sub 1\u00D7ATR \u2014 posibil prea str\u00E2ns')
    if (sim15 && !sim15.slHit && sim15.tpHit) parts.push('SL 1.5\u00D7ATR ar fi prins TP')
    else if (sim20 && !sim20.slHit && sim20.tpHit) parts.push('SL 2\u00D7ATR ar fi prins TP')
    if (rebound) parts.push('Pre\u021Bul a revenit \u00EEn direc\u021Bie dup\u0103 SL \u2014 probabil noise')
  }
  const betterLate = lateEntry.find((l: any) => l && l.tpHit && !l.slHit)
  if (betterLate) parts.push(`Intrare +${lateEntry.indexOf(betterLate) + 1} lum\u00E2n\u0103ri ar fi prins TP`)
  return parts.length ? parts.join(' \u00B7 ') : (pnl >= 0 ? 'Execu\u021Bie conform\u0103' : '\u2014')
}

function pmRun(pos: any, pnl: number, exitPrice: number): void {
  try {
    const klines = w.S.klines
    if (!klines || klines.length < 20) return

    const entryTime = Math.floor((pos.openTs || pos.id) / 1000)
    const entryIdx = klines.findIndex((k: any) => k.time >= entryTime)
    if (entryIdx < 2) return

    const atr = _calcATR(klines)
    const slDist = pos.entry && pos.sl ? Math.abs(pos.entry - pos.sl) : null
    const slAtrRatio = (atr && slDist) ? +(slDist / atr).toFixed(2) : null
    const isLoss = pnl < 0

    const sim15 = _simWiderSL(klines, entryIdx, pos.side, pos.entry, 1.5, atr, pos.tp)
    const sim20 = _simWiderSL(klines, entryIdx, pos.side, pos.entry, 2.0, atr, pos.tp)
    const lateEntry = [1, 2, 3].map(d => _simLateEntry(klines, entryIdx, pos.side, pos.sl, pos.tp, d))

    const exitIdx = klines.findIndex((k: any) => k.time >= Math.floor(Date.now() / 1000) - 60)
    const rebound = isLoss ? _checkRebound(klines, exitIdx < 0 ? klines.length - 1 : exitIdx, pos.side, pos.entry) : false

    const record = {
      ts: Date.now(),
      sym: pos.sym,
      side: pos.side,
      regime: w.BM?.regime || '\u2014',
      session: (typeof w._detectSession === 'function' ? w._detectSession() : '\u2014'),
      profile: w.S.profile || 'fast',
      entry: pos.entry,
      exitPrice: +exitPrice,
      sl: pos.sl,
      tp: pos.tp,
      lev: pos.lev,
      pnl: +pnl.toFixed(2),
      isLoss,
      atr: atr ? +atr.toFixed(4) : null,
      slAtrRatio,
      entryScore: w.BM?.entryScore || null,
      sim: { sl15x: sim15, sl20x: sim20, lateEntry1: lateEntry[0], lateEntry2: lateEntry[1], lateEntry3: lateEntry[2] },
      rebound,
      insight: _buildInsight(pnl, slAtrRatio, sim15, sim20, lateEntry, rebound, atr),
    }

    const records = _load()
    records.unshift(record)
    _save(records)

    if (typeof w.PM_render === 'function') w.PM_render()
  } catch (e: any) {
    console.warn('[PostMortem] run() error:', e.message)
  }
}

function pmGetStats(): any {
  const records = _load()
  if (!records.length) return null
  const now = Date.now()
  let slTightCount = 0, lateEntryWouldHelp = 0, reboundCount = 0
  let lossCount = 0, totalWeight = 0
  let sumSlAtr = 0, countSlAtr = 0

  records.forEach((r: any) => {
    const ageH = (now - r.ts) / 3600000
    const weight = ageH > 96 ? DECAY_96 : ageH > 48 ? DECAY_48 : 1.0
    totalWeight += weight
    if (r.isLoss) {
      lossCount += weight
      if (r.slAtrRatio && r.slAtrRatio < 1.0) slTightCount += weight
      if (r.rebound) reboundCount += weight
      const bl = r.sim && [r.sim.lateEntry1, r.sim.lateEntry2, r.sim.lateEntry3].find((l: any) => l && l.tpHit && !l.slHit)
      if (bl) lateEntryWouldHelp += weight
    }
    if (r.slAtrRatio) { sumSlAtr += r.slAtrRatio; countSlAtr++ }
  })

  return {
    total: records.length,
    slTightPct: lossCount > 0 ? Math.round(slTightCount / lossCount * 100) : 0,
    reboundPct: lossCount > 0 ? Math.round(reboundCount / lossCount * 100) : 0,
    lateEntryHelpPct: lossCount > 0 ? Math.round(lateEntryWouldHelp / lossCount * 100) : 0,
    avgSlAtrRatio: countSlAtr > 0 ? +(sumSlAtr / countSlAtr).toFixed(2) : null,
    lastRecord: records[0] || null,
  }
}

export const PM = { run: pmRun, getStats: pmGetStats, load: _load }

// ── Global entry point ─────────────────────────────────────────
export function runPostMortem(pos: any, pnl: number, exitPrice: number): void { PM.run(pos, pnl, exitPrice) }

// ── PM Render ──────────────────────────────────────────────────
export function PM_render(): void {
  const container = document.getElementById('pm-panel-body')
  if (!container) return
  const stats = PM.getStats()
  const records = PM.load()

  if (!stats || !records.length) {
    container.innerHTML = '<div style="padding:12px;text-align:center;font-size:12px;color:#445566;letter-spacing:1px">Nicio tranzac\u021Bie analizat\u0103 \u00EEnc\u0103.</div>'
    return
  }

  const last = stats.lastRecord
  const insightHtml = last
    ? `<div style="padding:5px 10px 3px;font-size:11px;color:#f0c04099;letter-spacing:.5px;border-bottom:1px solid #0a1520;line-height:1.7">
        <b style="color:#f0c040">LAST:</b> ${escHtml(last.insight)}
       </div>`
    : ''

  const statsHtml = `
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:3px;padding:6px 10px;border-bottom:1px solid #0a1520">
      <div style="text-align:center">
        <div style="font-size:10px;color:#445566;letter-spacing:1px;margin-bottom:2px">SL PREA STR\u00C2NS</div>
        <div style="font-size:11px;font-weight:700;color:${stats.slTightPct > 50 ? '#ff4466' : '#00d97a'}">${stats.slTightPct}%</div>
        <div style="font-size:10px;color:#334455">din pierderi</div>
      </div>
      <div style="text-align:center">
        <div style="font-size:10px;color:#445566;letter-spacing:1px;margin-bottom:2px">REBOUND DUP\u0102 SL</div>
        <div style="font-size:11px;font-weight:700;color:${stats.reboundPct > 40 ? '#ff4466' : '#778899'}">${stats.reboundPct}%</div>
        <div style="font-size:10px;color:#334455">pierderi evitabile</div>
      </div>
      <div style="text-align:center">
        <div style="font-size:10px;color:#445566;letter-spacing:1px;margin-bottom:2px">ATR OPTIM</div>
        <div style="font-size:11px;font-weight:700;color:#00d9ff">${stats.avgSlAtrRatio ? stats.avgSlAtrRatio + '\u00D7' : '\u2014'}</div>
        <div style="font-size:10px;color:#334455">raport SL/ATR mediu</div>
      </div>
    </div>
    ${insightHtml}`

  const listHtml = records.slice(0, 5).map((r: any) => {
    const pnlCol = r.pnl >= 0 ? '#00d97a' : '#ff4466'
    const sideCol = r.side === 'LONG' ? '#00ff88' : '#ff3355'
    return `<div style="padding:5px 10px;border-bottom:1px solid #06080e;font-size:11px;line-height:1.8">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:2px">
        <span style="color:${sideCol};font-weight:700">${escHtml(r.side)}</span>
        <span style="color:#778899">${escHtml(r.sym.replace('USDT', ''))}</span>
        <span style="color:#445566">${escHtml(r.regime)}</span>
        <span style="color:${pnlCol};font-weight:700">${r.pnl >= 0 ? '+' : ''}$${r.pnl.toFixed(2)}</span>
      </div>
      <div style="color:#556677;font-size:11px;line-height:1.6">${escHtml(r.insight)}</div>
    </div>`
  }).join('')

  container.innerHTML = statsHtml + listHtml
}

// ── CSS injection (runs on import) ─────────────────────────────
;(function _pmInjectCSS() {
  const s = document.createElement('style')
  s.textContent = `
  #pm-strip { background:transparent; border-bottom:none; margin:3px 6px; }
  #pm-strip-bar { display:flex;align-items:center;justify-content:space-between;padding:0;min-height:44px;cursor:pointer;user-select:none;gap:0;transition:border-color .25s,box-shadow .25s;background:none;border:none;border-radius:10px;opacity:1;position:relative;overflow:hidden; }
  #pm-strip-bar:hover { }
  #pm-strip-title { font-size:13px;font-weight:700;letter-spacing:2px;color:#f0c040;display:flex;align-items:center;gap:5px; }
  #pm-strip-stat { display:none; }
  #pm-strip-chev { font-size:8px;color:#f0c04044;transition:transform .25s;flex-shrink:0;opacity:.35; }
  #pm-strip-panel { max-height:0;overflow:hidden;transition:max-height .3s ease; }
  #pm-strip.open #pm-strip-panel { max-height:400px; }
  #pm-strip.open #pm-strip-chev { transform:rotate(180deg); }
  #pm-strip.open #pm-strip-bar { opacity:1; }
  #pm-strip.open #pm-strip-stat { display:inline; }
  #pm-panel-body { background:#010508;border-top:1px solid #f0c04015;border-radius:0 0 10px 10px;margin:2px 8px 0; }
  `
  document.head.appendChild(s)
})()

// ── Init PM Panel ──────────────────────────────────────────────
export function initPMPanel(): void {
  if (document.getElementById('pm-strip')) return
  const srStrip = document.getElementById('sr-strip')
  if (!srStrip) return

  const panel = document.createElement('div')
  panel.id = 'pm-strip'
  panel.innerHTML = `
    <div id="pm-strip-bar" onclick="this.closest('#pm-strip').classList.toggle('open');PM_render()">
      <div class="v6-accent"><div class="v6-ico"><svg viewBox="0 0 24 24"><circle cx="12" cy="10" r="6"/><line x1="12" y1="16" x2="12" y2="22"/><line x1="8" y1="20" x2="16" y2="20"/><line x1="10" y1="8" x2="10" y2="12"/><line x1="14" y1="8" x2="14" y2="12"/></svg></div><span class="v6-lbl">POST<br>MORT</span></div>
      <div class="v6-content">
        <div id="pm-strip-title"><span>POST-MORTEM</span></div>
        <div style="display:flex;align-items:center;gap:8px">
          <span id="pm-strip-stat" style="font-size:11px;color:#f0c04066;letter-spacing:.5px"></span>
          <span id="pm-strip-chev">\u25BC</span>
        </div>
      </div>
    </div>
    <div id="pm-strip-panel">
      <div id="pm-panel-body">
        <div style="padding:12px;text-align:center;font-size:12px;color:#445566;letter-spacing:1px">Nicio tranzac\u021Bie analizat\u0103 \u00EEnc\u0103.</div>
      </div>
    </div>`

  srStrip.insertAdjacentElement('afterend', panel)

  const stat = document.getElementById('pm-strip-stat')
  if (stat) {
    const records = PM.load()
    if (records.length) stat.textContent = records.length + ' analize'
  }
}

export function _pmStripUpdateStat(): void {
  const stat = document.getElementById('pm-strip-stat')
  if (!stat) return
  const st = PM.getStats()
  if (st) stat.textContent = st.total + ' analize \u00B7 SL str\u00E2ns: ' + st.slTightPct + '%'
}

export function _pmCheckRegimeTransition(): void {
  try {
    const klines = w.S.klines
    if (!klines || klines.length < 25) return
    function _ema200slope(data: number[]): number {
      const p = Math.min(200, data.length)
      const k2 = 2 / (p + 1); let e = data[0]
      const out = data.map((v: number) => { e = v * k2 + e * (1 - k2); return e })
      const last = out.length
      return out[last - 1] - out[last - 8 < 0 ? 0 : last - 8]
    }
    const closes = klines.map((c: any) => c.close)
    const slopeRecent = _ema200slope(closes)
    const slopePrevWindow = _ema200slope(closes.slice(0, closes.length - 8))
    const slopeFlatRatio = Math.abs(slopeRecent) / (Math.abs(slopePrevWindow) + 1e-9)

    const atrNow = w.S.atr || 0
    const slice20 = klines.slice(-21)
    let atrSum = 0
    for (let i = 1; i < slice20.length; i++) {
      const k = slice20[i], pr = slice20[i - 1]
      atrSum += Math.max(k.high - k.low, Math.abs(k.high - pr.close), Math.abs(k.low - pr.close))
    }
    const atrMean = atrSum / 20
    const atrRatio = atrMean > 0 ? atrNow / atrMean : 1

    const last5 = klines.slice(-5)
    const pUp = last5[4].close > last5[0].close
    const vDown = last5[4].volume < last5[0].volume * 0.75
    const divPts = (pUp && vDown) ? 30 : 0
    const flatPts = Math.max(0, Math.min(50, (1 - Math.min(slopeFlatRatio, 2)) * 50))
    const atrPts = atrRatio < 0.7 ? 20 : (atrRatio > 1.8 ? 15 : 0)
    const score = Math.round(flatPts + atrPts + divPts)

    if (score >= 80) {
      if (typeof w.BlockReason !== 'undefined' && !w.BlockReason.get())
        w.BlockReason.set('REGIME_TRANSITION', `Tranzi\u021Bie regim iminenta (scor ${score}) \u2014 intr\u0103ri blocate`)
    } else if (score >= 60) {
      atLog('warn', `[RegimeWatch] Alert\u0103 tranzi\u021Bie regim \u2014 scor ${score}`)
    } else {
      if (typeof w.BlockReason !== 'undefined') {
        const br = w.BlockReason.get()
        if (br && br.code === 'REGIME_TRANSITION') w.BlockReason.clear()
      }
    }
  } catch (e: any) { console.warn('[RegimeWatch]', e.message) }
}
