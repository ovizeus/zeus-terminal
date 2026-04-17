// Zeus — trading/risk.ts
// Ported 1:1 from public/js/trading/risk.js (Phase 6B)
// Macro cortex, adaptive parameters, performance tracking

import { fmtNow } from '../data/marketDataHelpers'
import { _clamp } from '../utils/math'
import { _safeLocalStorageSet } from '../services/storage'
import { _ZI } from '../constants/icons'
import { MACRO_MULT } from '../constants/trading'
import { DEV , devLog } from '../utils/dev'
import { atLog } from './autotrade'
import { getSymPrice } from '../data/marketDataPositions'
import { useATStore } from '../stores/atStore'

const w = window as any

// Macro cortex computation
export function computeMacroCortex(): void {
  try {
    var now = Date.now()
    var prev = w.BM.macro.composite || 0

    // Regime component (0..40)
    var reg = (typeof w.BRAIN !== 'undefined') ? (w.BRAIN.regime || 'unknown') : 'unknown'
    var regConf = _clamp((typeof w.BRAIN !== 'undefined' ? (w.BRAIN.regimeConfidence || 0) : 0), 0, 100) / 100
    var regScore: any = 20
    if (reg.includes('trend')) regScore = 30
    if (reg.includes('breakout')) regScore = 34
    if (reg.includes('range')) regScore = 18
    if (reg.includes('volatile')) regScore = 14
    regScore *= (0.6 + 0.4 * regConf)

    // Volatility penalty via ATR% (0..25)
    var atrPct = _clamp((typeof w.BRAIN !== 'undefined' ? (w.BRAIN.regimeAtrPct || 0) : 0) * 100, 0, 8)
    var volScore = _clamp(25 - atrPct * 3, 0, 25)

    // Flow score from OFI (0..20)
    var flowScore = 10
    if (typeof w.BRAIN !== 'undefined' && w.BRAIN.ofi) {
      var buy = w.BRAIN.ofi.buy || 0
      var sell = w.BRAIN.ofi.sell || 0
      var bias = (buy + sell > 0) ? (buy - sell) / (buy + sell) : 0
      flowScore = 10 + bias * 10
    }

    // Sentiment (0..15)
    var sentScore = 7
    try {
      // [R29] Read from w.S.fearGreed (canonical, set by fetchFG in
      // marketDataFeeds.ts). Previous DOM read from #fgval.textContent was
      // a DOM-as-state anti-pattern.
      var fgRaw = typeof w.S !== 'undefined' ? Number(w.S.fearGreed) : NaN
      if (Number.isFinite(fgRaw) && fgRaw >= 0 && fgRaw <= 100) {
        sentScore = _clamp(Math.round((fgRaw / 100) * 15), 0, 15)
      }
    } catch (_) { }

    var composite = _clamp(Math.round(regScore + volScore + flowScore + sentScore), 0, 100)
    var slope = _clamp((composite - prev) / 25, -1, 1)

    w.BM.macro.cycleScore = composite
    w.BM.macro.flowScore = _clamp(Math.round(flowScore * 5), 0, 100)
    w.BM.macro.sentimentScore = _clamp(Math.round(sentScore * 6.6), 0, 100)
    w.BM.macro.composite = composite
    w.BM.macro.slope = parseFloat(slope.toFixed(3))
    w.BM.macro.phase = _macroPhaseFromComposite(composite)
    w.BM.macro.confidence = _clamp(Math.round(30 + (typeof w.BRAIN !== 'undefined' ? (w.BRAIN.regimeConfidence || 0) : 0) * 0.7), 0, 100)
    w.BM.macro.lastUpdate = now

    // Update adapt.lastPhase if changed
    if (w.BM.adapt.lastPhase !== w.BM.macro.phase) {
      if (DEV.enabled) devLog('[Macro] Phase: ' + w.BM.adapt.lastPhase + ' → ' + w.BM.macro.phase + ' (' + composite + ')', 'info')
      w.BM.adapt.lastPhase = w.BM.macro.phase
    }

    // Recompute sizing after macro update
    computePositionSizingMult()
    // Update UI
    updateMacroUI()

  } catch (e: any) {
    console.warn('[Macro] computeMacroCortex error:', e.message)
  }
}

export function updateMacroUI(): void {
  try {
    var m = w.BM.macro
    var ps = w.BM.positionSizing
    var ph = m.phase || 'NEUTRAL'
    // [R34] Typed Record<string,string> replaces `{…} as any` lookup.
    var _phaseCol: Record<string, string> = {
      ACCUMULATION: 'var(--grn)', EARLY_BULL: '#44eebb', LATE_BULL: 'var(--gold)',
      DISTRIBUTION: 'var(--orange)', TOP_RISK: 'var(--red)', NEUTRAL: 'var(--txt-dim)'
    }
    var col = _phaseCol[ph] || 'var(--txt-dim)'

    var badge = document.getElementById('macro-phase-badge')
    if (badge) {
      badge.textContent = ph.replace('_', ' ')
      badge.className = 'macro-phase-' + ph
    }
    var conf = document.getElementById('macro-conf')
    if (conf) conf.textContent = 'conf ' + m.confidence + '%'

    var adaptSt = document.getElementById('macro-adapt-status')
    if (adaptSt) {
      adaptSt.textContent = w.BM.adapt.enabled ? 'ADAPT ON' : 'ADAPT OFF'
      adaptSt.style.color = w.BM.adapt.enabled ? 'var(--grn)' : 'var(--dim)'
    }

    // [R34] `getElementById` returns `HTMLElement | null` which already has
    // `.style` and `.textContent` — dropped redundant `as any` casts.
    var bar = document.getElementById('macro-composite-bar')
    if (bar) { bar.style.width = m.composite + '%'; bar.style.background = col }
    var compVal = document.getElementById('macro-composite-val')
    if (compVal) { compVal.textContent = m.composite; compVal.style.color = col }

    var setTxt = function (id: string, val: any) { var e = document.getElementById(id); if (e) e.textContent = val }
    setTxt('macro-cycle-val', m.cycleScore)
    setTxt('macro-flow-val', m.flowScore)
    setTxt('macro-sent-val', m.sentimentScore)
    setTxt('macro-slope-val', m.slope > 0 ? '▲' + m.slope.toFixed(2) : m.slope < 0 ? '▼' + Math.abs(m.slope).toFixed(2) : '—')

    var sizeMult = document.getElementById('macro-size-mult')
    if (sizeMult) { sizeMult.textContent = '×' + (ps.finalMult || 1).toFixed(2); sizeMult.style.color = ps.finalMult > 1 ? 'var(--grn)' : ps.finalMult < 1 ? 'var(--orange)' : 'var(--gold)' }
    var perfMult = document.getElementById('macro-perf-mult')
    if (perfMult) perfMult.textContent = '×' + (ps.perfMult || 1).toFixed(2)

    // Per-regime perf table
    var tbl = document.getElementById('macro-perf-table')
    if (tbl && w.BM.performance && w.BM.performance.byRegime) {
      tbl.innerHTML = Object.keys(w.BM.performance.byRegime).map(function (k: string) {
        var r = w.BM.performance.byRegime[k]
        var wr = r.trades > 0 ? Math.round(r.wins / r.trades * 100) : null
        var isCur = (k === ph)
        return '<div style="display:flex;justify-content:space-between;' + (isCur ? 'color:var(--gold)' : '') + '">'
          + '<span>' + k.replace('_', ' ') + (isCur ? ' ◀' : '') + '</span>'
          + '<span>' + (wr !== null ? wr + '% (' + r.trades + 't)' : '—') + '</span>'
          + '<span>×' + (r.mult || 1).toFixed(2) + '</span>'
          + '</div>'
      }).join('')
    }

    var upd = document.getElementById('macro-upd')
    if (upd && m.lastUpdate) upd.textContent = 'updated ' + fmtNow()

  } catch (e) { /* silent */ }
}

// ══════════════════════════════════════════════════════════════════
// FEE / SLIPPAGE MODEL
// ══════════════════════════════════════════════════════════════════

export const FEE_MODEL: any = {
  makerPct: 0.0002,
  takerPct: 0.0004,
  slippagePct: {
    fast: 0.0003,
    swing: 0.0002,
    defensive: 0.0001,
  },
}

export function estimateRoundTripFees(notional: any, orderType: any, profile: any): any {
  var n = Math.abs(notional) || 0
  var isLimit = (orderType || '').toUpperCase() === 'LIMIT'
  var feePct = isLimit ? FEE_MODEL.makerPct : FEE_MODEL.takerPct
  var prof = (profile || w.S.profile || 'fast').toLowerCase()
  var slipPct = FEE_MODEL.slippagePct[prof] || FEE_MODEL.slippagePct.fast
  if (isLimit) slipPct = 0
  var entryFee = n * feePct
  var exitFee = n * feePct
  var slippage = n * slipPct * 2
  return { entryFee: entryFee, exitFee: exitFee, slippage: slippage, total: entryFee + exitFee + slippage }
}
// estimateRoundTripFees — exported, consumers import directly

// ══════════════════════════════════════════════════════════════════
// ETAPA 5 — ADAPTIVE CONTROL ENGINE
// ══════════════════════════════════════════════════════════════════

export function _adaptSave(): void {
  try {
    const payload = {
      enabled: w.BM.adaptive.enabled,
      lastRecalcTs: w.BM.adaptive.lastRecalcTs,
      entryMult: w.BM.adaptive.entryMult,
      sizeMult: w.BM.adaptive.sizeMult,
      exitMult: w.BM.adaptive.exitMult,
      buckets: w.BM.adaptive.buckets,
    }
    _safeLocalStorageSet('zeus_adaptive_v1', payload)
    if (typeof w._ucMarkDirty === 'function') w._ucMarkDirty('adaptive')
    if (typeof w._userCtxPush === 'function') w._userCtxPush()
  } catch (_) { }
}

export function _adaptLoad(): void {
  try {
    const raw = localStorage.getItem('zeus_adaptive_v1')
    if (!raw) return
    const p = JSON.parse(raw)
    if (!p || typeof p !== 'object') return
    w.BM.adaptive.enabled = !!p.enabled
    w.BM.adaptive.lastRecalcTs = p.lastRecalcTs || 0
    w.BM.adaptive.entryMult = _adaptClamp(p.entryMult, 1.0)
    w.BM.adaptive.sizeMult = _adaptClamp(p.sizeMult, 1.0)
    w.BM.adaptive.exitMult = _adaptClamp(p.exitMult, 1.0)
    w.BM.adaptive.buckets = (p.buckets && typeof p.buckets === 'object') ? p.buckets : {}
    // Sync UI toggle
    const tog = document.getElementById('adaptiveToggleBtn')
    if (tog) tog.innerHTML = w.BM.adaptive.enabled ? _ZI.brain + ' ADAPTIVE ON' : _ZI.brain + ' ADAPTIVE OFF'
    if (tog) tog.style.borderColor = w.BM.adaptive.enabled ? 'var(--grn)' : '#2a3a4a'
    if (tog) tog.style.color = w.BM.adaptive.enabled ? 'var(--grn)' : 'var(--txt-dim)'
  } catch (e: any) {
    console.warn('[_adaptLoad] Restore failed:', e.message)
    if (typeof w.ZLOG !== 'undefined') w.ZLOG.push('ERROR', '[_adaptLoad] ' + e.message)
  }
}

export function _adaptClamp(v: any, def: number): number {
  var n = parseFloat(v)
  if (!Number.isFinite(n)) return def
  return Math.max(0.8, Math.min(1.2, n))
}

export function recalcAdaptive(isStartup?: any): void {
  try {
    if (!w.BM.adaptive.enabled && !isStartup) return

    var now = Date.now()
    var THROTTLE_MS = 30 * 60 * 1000
    if ((now - w.BM.adaptive.lastRecalcTs) < THROTTLE_MS) return

    var journal = (w.TP && w.TP.journal) ? w.TP.journal : []
    var closedTrades = journal
      .filter(function (t: any) { return t.journalEvent === 'CLOSE' && t.exit !== null && Number.isFinite(t.pnl) })
      .slice(0, 1000)

    if (!closedTrades.length) return

    // Phase 3 C5: read AT config from atStore (canonical source). DOM
    // fallback via document.getElementById('atSL'/'atRR') removed.
    var _atCfg = useATStore.getState().config
    var slPct = _atCfg.slPct
    var rrRatio = _atCfg.rr

    var newBuckets: any = {}
    closedTrades.forEach(function (t: any) {
      var regime = t.regime || '—'
      var profile = t.profile || '—'
      var volRegime = t.volRegime || '—'
      var key = regime + '|' + profile + '|' + volRegime

      if (!newBuckets[key]) {
        newBuckets[key] = { trades: 0, wins: 0, totalR: 0, avgR: 0, winrate: 0, mult: 1.0 }
      }
      var b = newBuckets[key]
      b.trades++
      var entryPrice = t.entry || 1
      var slAbs = entryPrice * slPct / 100
      var slValue = (t.size || 200) * (slPct / 100)
      var R = slValue > 0 ? t.pnl / slValue : 0
      if (t.pnl >= 0) b.wins++
      b.totalR += R
    })

    var BUCKET_MIN_TRADES = 30
    var CLAMP_LO = 0.8
    var CLAMP_HI = 1.2

    Object.keys(newBuckets).forEach(function (key: string) {
      var b = newBuckets[key]
      b.avgR = b.trades > 0 ? parseFloat((b.totalR / b.trades).toFixed(3)) : 0
      b.winrate = b.trades > 0 ? parseFloat((b.wins / b.trades).toFixed(3)) : 0

      if (b.trades < BUCKET_MIN_TRADES) {
        b.mult = 1.0
        return
      }

      var adj = 1.0
      if (b.winrate > 0.60) {
        adj = 1.0 + Math.min((b.winrate - 0.60) * 0.5, 0.2)
      } else if (b.winrate < 0.40) {
        adj = 1.0 - Math.min((0.40 - b.winrate) * 0.5, 0.2)
      }
      b.mult = parseFloat(Math.max(CLAMP_LO, Math.min(CLAMP_HI, adj)).toFixed(3))
    })

    w.BM.adaptive.buckets = newBuckets

    var validBuckets = Object.values(newBuckets).filter(function (b: any) { return b.trades >= BUCKET_MIN_TRADES })
    if (validBuckets.length > 0) {
      var avgMult = validBuckets.reduce(function (s: number, b: any) { return s + b.mult }, 0) / validBuckets.length
      w.BM.adaptive.entryMult = _adaptClamp(avgMult, 1.0)
      w.BM.adaptive.sizeMult = _adaptClamp(avgMult, 1.0)
      w.BM.adaptive.exitMult = _adaptClamp(avgMult, 1.0)
    } else {
      w.BM.adaptive.entryMult = 1.0
      w.BM.adaptive.sizeMult = 1.0
      w.BM.adaptive.exitMult = 1.0
    }

    w.BM.adaptive.lastRecalcTs = now
    _adaptSave()
    _renderAdaptivePanel()

    {
      atLog('info', '[ADAPT] Adaptive recalc: ' + Object.keys(newBuckets).length + ' buckets | valid:' + validBuckets.length
        + ' | entryMult:' + w.BM.adaptive.entryMult.toFixed(2)
        + ' sizeMult:' + w.BM.adaptive.sizeMult.toFixed(2)
        + ' exitMult:' + w.BM.adaptive.exitMult.toFixed(2))
    }
  } catch (e: any) {
    atLog('warn', '[ERR] recalcAdaptive error: ' + e.message)
  }
}

export function _renderAdaptivePanel(): void {
  try {
    var body = document.getElementById('adaptive-panel-body')
    if (!body) return

    var ad = w.BM.adaptive
    var buckets = ad.buckets || {}
    var keys = Object.keys(buckets)

    var headerEl = document.getElementById('adaptive-mults-row')
    if (headerEl) {
      var color = function (v: number) { return v > 1.0 ? 'var(--grn)' : v < 1.0 ? 'var(--orange)' : 'var(--txt-dim)' }
      headerEl.innerHTML =
        '<span style="color:var(--dim)">ENTRY</span><span style="color:' + color(ad.entryMult) + ';font-weight:700">×' + ad.entryMult.toFixed(2) + '</span>' +
        '<span style="color:var(--dim)">SIZE</span><span style="color:' + color(ad.sizeMult) + ';font-weight:700">×' + ad.sizeMult.toFixed(2) + '</span>' +
        '<span style="color:var(--dim)">EXIT</span><span style="color:' + color(ad.exitMult) + ';font-weight:700">×' + ad.exitMult.toFixed(2) + '</span>'
    }

    var tbl = document.getElementById('adaptive-bucket-table')
    if (!tbl) return
    if (!keys.length) {
      tbl.innerHTML = '<div style="color:var(--dim);font-size:11px;padding:4px 0">Niciun trade cu context — rulează după prime trades CLOSE.</div>'
      return
    }

    tbl.innerHTML = keys.map(function (k: string) {
      var b = buckets[k]
      var wr = b.trades > 0 ? Math.round(b.winrate * 100) : null
      var hasData = b.trades >= 30
      var wrColor = hasData ? (b.winrate > 0.60 ? 'var(--grn)' : b.winrate < 0.40 ? 'var(--red)' : 'var(--gold)') : '#556677'
      var multColor = hasData ? (b.mult > 1.0 ? 'var(--grn)' : b.mult < 1.0 ? 'var(--orange)' : 'var(--txt-dim)') : '#556677'
      return '<div style="display:grid;grid-template-columns:1fr 40px 40px 45px;gap:2px;font-size:11px;padding:2px 0;border-bottom:1px solid #0d1520;color:#6a8090">'
        + '<span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="' + k + '">' + k + '</span>'
        + '<span>' + b.trades + 't</span>'
        + '<span style="color:' + wrColor + '">' + (wr !== null ? wr + '%' : '—') + '</span>'
        + '<span style="color:' + multColor + '">' + (hasData ? '×' + b.mult.toFixed(2) : '<30 ' + _ZI.lock + '') + '</span>'
        + '</div>'
    }).join('')

    var tsEl = document.getElementById('adaptive-last-upd')
    if (tsEl && ad.lastRecalcTs) {
      tsEl.textContent = 'upd ' + new Date(ad.lastRecalcTs).toLocaleTimeString()
    }
    if (typeof _updateAdaptiveBarTxt === 'function') _updateAdaptiveBarTxt()
  } catch (_) { }
}

export function toggleAdaptive(): void {
  w.BM.adaptive.enabled = !w.BM.adaptive.enabled
  var tog = document.getElementById('adaptiveToggleBtn')
  if (tog) {
    tog.innerHTML = w.BM.adaptive.enabled ? _ZI.brain + ' ADAPTIVE ON' : _ZI.brain + ' ADAPTIVE OFF'
    tog.style.borderColor = w.BM.adaptive.enabled ? 'var(--grn)' : '#2a3a4a'
    tog.style.color = w.BM.adaptive.enabled ? 'var(--grn)' : 'var(--txt-dim)'
  }
  if (!w.BM.adaptive.enabled) {
    w.BM.adaptive.entryMult = 1.0
    w.BM.adaptive.sizeMult = 1.0
    w.BM.adaptive.exitMult = 1.0
    _renderAdaptivePanel()
  }
  _adaptSave()
  _updateAdaptiveBarTxt()
  atLog('info', '[ADAPT] Adaptive Control: ' + (w.BM.adaptive.enabled ? 'ON' : 'OFF'))
}

export function _updateAdaptiveBarTxt(): void {
  var el = document.getElementById('adaptive-bar-txt')
  if (!el) return
  var ad = w.BM.adaptive
  if (!ad.enabled) {
    el.textContent = 'OFF · ×1.00 ×1.00 ×1.00'
    el.style.color = 'var(--pur)'
    return
  }
  var buckets = Object.values(ad.buckets || {}) as any[]
  var validBuckets = buckets.filter(function (b: any) { return b.trades >= 30 })
  var txt = 'ON · E×' + ad.entryMult.toFixed(2) + ' S×' + ad.sizeMult.toFixed(2) + ' X×' + ad.exitMult.toFixed(2)
  if (validBuckets.length > 0) txt += ' · ' + validBuckets.length + 'B'
  else txt += ' · <30t'
  el.textContent = txt
  var avg = (ad.entryMult + ad.sizeMult + ad.exitMult) / 3
  el.style.color = avg > 1.0 ? 'var(--grn)' : avg < 1.0 ? 'var(--orange)' : 'var(--pur)'
}

// Toggle strip open/close
let _adaptStripOpen = false
export function adaptiveStripToggle(): void {
  var strip = document.getElementById('adaptive-strip')
  if (!strip) return
  _adaptStripOpen = !_adaptStripOpen
  if (_adaptStripOpen) strip.classList.add('adaptive-open')
  else strip.classList.remove('adaptive-open')
  try { localStorage.setItem('zeus_adaptive_strip_open', _adaptStripOpen ? '1' : '0') } catch (_) { }
}

export function initAdaptiveStrip(): void {
  var panel = document.getElementById('adaptive-strip-panel')
  var src = document.getElementById('adaptive-sec')
  if (!panel || !src) return
  while (src.firstChild) panel.appendChild(src.firstChild)
  src.style.display = 'none'
  try {
    if (localStorage.getItem('zeus_adaptive_strip_open') === '1') {
      _adaptStripOpen = true
      var strip = document.getElementById('adaptive-strip')
      if (strip) strip.classList.add('adaptive-open')
    }
  } catch (_) { }
  _updateAdaptiveBarTxt()
}

// ── (2) Entry score macro-adjustment ────────────────────────────
export function macroAdjustEntryScore(dir: any, score: any): any {
  try {
    if (!w.BM.adapt || !w.BM.adapt.enabled) return score
    var ph = (w.BM.macro && w.BM.macro.phase) ? w.BM.macro.phase : 'NEUTRAL'
    var m = MACRO_MULT[ph] || MACRO_MULT.NEUTRAL
    var mult = (dir === 'bull') ? m.long : m.short
    return Math.round(score * mult)
  } catch (e) { return score }
}

// ── (3) Exit risk macro-adjustment ──────────────────────────────
export function macroAdjustExitRisk(risk: any): any {
  try {
    if (!w.BM.adapt || !w.BM.adapt.enabled) return risk
    var ph = (w.BM.macro && w.BM.macro.phase) ? w.BM.macro.phase : 'NEUTRAL'
    var m = MACRO_MULT[ph] || MACRO_MULT.NEUTRAL
    return _clamp(Math.round(risk * (m.exitRisk || 1)), 0, 100)
  } catch (e) { return risk }
}

// Position sizing
export function computePositionSizingMult(): void {
  try {
    var ph = (w.BM.macro && w.BM.macro.phase) ? w.BM.macro.phase : 'NEUTRAL'
    var rm = (MACRO_MULT[ph] && MACRO_MULT[ph].risk) ? MACRO_MULT[ph].risk : 1.0
    var pm = (w.BM.performance && w.BM.performance.byRegime && w.BM.performance.byRegime[ph])
      ? (w.BM.performance.byRegime[ph].mult || 1.0)
      : 1.0
    w.BM.positionSizing.regimeMult = _clamp(rm, 0.5, 1.5)
    w.BM.positionSizing.perfMult = _clamp(pm, 0.7, 1.3)
    w.BM.positionSizing.finalMult = _clamp(
      w.BM.positionSizing.baseRiskPct * w.BM.positionSizing.regimeMult * w.BM.positionSizing.perfMult,
      0.5, 1.6
    )
  } catch (e) { }
}

// ── (5) Regime performance memory ───────────────────────────────
export function perfRecordTrade(ph: any, R: any): void {
  try {
    if (!w.BM.performance || !w.BM.performance.byRegime) return
    var m = w.BM.performance.byRegime[ph] || w.BM.performance.byRegime.NEUTRAL
    m.trades++
    if (R > 0) m.wins++
    var a = 2 / (Math.min(50, m.trades) + 1)
    m.avgR = (m.trades === 1) ? R : parseFloat((m.avgR * (1 - a) + R * a).toFixed(3))
    if (m.trades < 20) { m.mult = 1.00; return }
    var winrate = m.wins / m.trades
    var mult = 1.0
      + (winrate - 0.5) * 0.30
      + _clamp(m.avgR, -1, 1) * 0.10
    m.mult = _clamp(parseFloat(mult.toFixed(3)), 0.80, 1.20)
    computePositionSizingMult()
  } catch (e) { }
}

// ── _posR helper (R-multiple for a position) ─────────────────────
export function _posR(pos: any): any {
  try {
    var dslPos = (typeof w.DSL !== 'undefined' && w.DSL.positions) ? w.DSL.positions[String(pos.id)] : null
    var sl = (dslPos && dslPos.currentSL) ? dslPos.currentSL : pos.sl
    if (!sl) return null
    var risk = Math.abs(pos.entry - sl)
    if (risk <= 0) return null
    var cur = (true) ? getSymPrice(pos) : (w.S.price || pos.entry)
    var pnl = (pos.side === 'LONG') ? (cur - pos.entry) : (pos.entry - cur)
    var commissionPct = 0.0004
    var commission = pos.entry * commissionPct * 2
    var netPnl = pnl - commission
    return parseFloat((netPnl / risk).toFixed(3))
  } catch (e) { return null }
}

// ── Macro Phase from Composite ──────────────────────────────
export function _macroPhaseFromComposite(x: number): string {
  if (x <= 30) return 'ACCUMULATION'
  if (x <= 55) return 'EARLY_BULL'
  if (x <= 75) return 'LATE_BULL'
  if (x <= 90) return 'DISTRIBUTION'
  return 'TOP_RISK'
}
