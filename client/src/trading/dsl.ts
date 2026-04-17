// Zeus — trading/dsl.ts
// Ported 1:1 from public/js/trading/dsl.js (Phase 6B)
// Dynamic Stop Loss — brain logic, widget render, intervals
// [8C-3A] DSL/TC/BM/BRAIN reads migrated to accessors

import { getTCDslActivatePct, getTCDslTrailPct, getTCDslTrailSusPct, getTCDslExtendPct, getBrainMetrics, getBrainObject, getATMode, getPrice, getSymbol, getMagnets, getDemoPositions, getLivePositions } from '../services/stateAccessors'
import { DSL } from '../core/config'
import { useDslStore } from '../stores/dslStore'
import type { DSLUI } from '../stores/dslStore'
import { el } from '../utils/dom'
import { fP } from '../utils/format'
import { toast } from '../data/marketDataHelpers'
import { _ZI } from '../constants/icons'
import { updateATStats , atLog , renderATPositions } from './autotrade'
import { closeLivePos } from '../data/marketDataPositions'
import { manualLiveSetSL } from './liveApi'
import { brainThink } from '../engine/brain'
import { _safePnl } from '../utils/guards'
import { closeDemoPos } from '../data/marketDataClose'

const w = window as any // kept for w.S self-ref (mode/assistArmed/dsl), w.AT writes, function calls
function _dslUI(p: Partial<DSLUI>) { useDslStore.getState().patchUI(p) }

// [Phase 6 C3] Engine write inversion. Backing DSL stays as the engine's
// per-tick scratch space; canonical state lives in useDslStore. Helpers
// mirror engine writes to BOTH backing (for legacy direct importers and
// in-tick reads) and store (canonical surface for React + window.DSL Proxy).
// _attachedIds, visualInterval, history are intentionally backing-only.
function _pushDslEnabled(next: boolean): void {
  DSL.enabled = next
  useDslStore.getState().setEnabled(next)
}
function _pushDslCheckInterval(handle: number | null): void {
  DSL.checkInterval = handle
  useDslStore.getState().setCheckIntervalActive(!!handle)
}
function _pushDslPosition(posId: string): void {
  const snap = DSL.positions[posId]
  if (snap) useDslStore.getState().upsertPosition(posId, { ...snap })
}
function _removeDslPosition(posId: string): void {
  delete DSL.positions[posId]
  useDslStore.getState().removePosition(posId)
}

// Sync DSL SL to exchange for live positions (client-side AT only)
function _syncLiveSL(pos: any, newSL: number): void {
  if (!pos.isLive || w._serverATEnabled) return
  if (!newSL || newSL <= 0 || !Number.isFinite(newSL)) return
  const qty = pos.qty || (pos.size && pos.entry && pos.lev ? +(pos.size / pos.entry * pos.lev).toFixed(6) : 0)
  if (!qty) return
  manualLiveSetSL({ symbol: pos.sym, side: pos.side, quantity: String(qty), stopPrice: newSL }).catch(function (e: any) { atLog('warn', '[DSL] Live SL sync failed: ' + (e.message || e)) })
}

// ══════════════════════════════════════════════════════
// [DSL MAGNET] Per-position toggle
// ══════════════════════════════════════════════════════
export function dslToggleMagnet(posId: any): void {
  posId = String(posId)
  const pos = [...(getDemoPositions()), ...(getLivePositions())].find((p: any) => String(p.id) === posId)
  if (!pos) return
  if (!pos.dslParams) pos.dslParams = {}
  pos.dslParams.magnetEnabled = !pos.dslParams.magnetEnabled
  const on = pos.dslParams.magnetEnabled
  if (!Array.isArray(pos.dslHistory)) pos.dslHistory = []
  pos.dslHistory.push({ ts: Date.now(), msg: on ? 'MAGNET ON' : 'MAGNET OFF' })
  if (typeof w.ZState !== 'undefined') w.ZState.save()
}

// ══════════════════════════════════════════════════════
// [DSL MAGNET] Pure helper — computes snap candidate
// ══════════════════════════════════════════════════════
export function _computeDslMagnetSnap(basePrice: any, pos: any, side: any, kind: any, ctx: any): any {
  const out = { applied: false, snappedPrice: basePrice, source: '', confidence: 0, reason: '' }
  try {
    const isLong = side === 'LONG'
    const cur = ctx.cur
    if (!cur || cur <= 0 || !Number.isFinite(basePrice) || basePrice <= 0) return out

    const atrPct = getBrainObject()?.regimeAtrPct || 1
    const maxSnapDist = cur * atrPct / 100 * 0.2
    const minSafetyDist = cur * 0.001

    const magnets = getMagnets()
    const candidates: any[] = []

    if (kind === 'PL') {
      const pool = isLong ? (magnets.below || []) : (magnets.above || [])
      pool.forEach(function (m: any) {
        if (!m || !m.price || !Number.isFinite(m.price) || m.price <= 0) return
        const lvl = m.price
        const isTighter = isLong ? (lvl > basePrice) : (lvl < basePrice)
        if (!isTighter) return
        const distFromCur = Math.abs(cur - lvl)
        if (distFromCur < minSafetyDist) return
        const distFromBase = Math.abs(lvl - basePrice)
        if (distFromBase > maxSnapDist) return
        candidates.push({ price: lvl, source: 'liq', dist: distFromBase })
      })
    }

    if (!candidates.length) return out

    candidates.sort(function (a: any, b: any) { return a.dist - b.dist })
    const best = candidates[0]

    let conf = Math.round(Math.max(20, 100 - (best.dist / maxSnapDist * 80)))
    const atmos = getBrainMetrics()?.atmosphere || null
    if (atmos && !atmos.allow) conf = Math.max(10, conf - 30)
    const sweep = getBrainMetrics()?.sweep || null
    if (sweep && sweep.type && sweep.type !== 'none') conf = Math.max(10, conf - 15)

    if (conf < 30) return out

    out.applied = true
    out.snappedPrice = best.price
    out.source = best.source
    out.confidence = conf
    out.reason = kind + ' snap ' + (isLong ? 'up' : 'dn') + ' $' + fP(basePrice) + '→$' + fP(best.price) + ' (' + best.source + ' conf:' + conf + ')'
    return out
  } catch (e) {
    return out
  }
}

// DSL toggle + assist
export function toggleDSL(): void {
  try {
    const _mode = (w.S?.mode || 'assist').toLowerCase()
    if (_mode === 'auto') {
      toast('AUTO: DSL e controlat de AI', 0, _ZI?.robot)
      return
    }
    if (typeof DSL === 'undefined') return
    _pushDslEnabled(!DSL.enabled)
    if (!w.S.dsl) w.S.dsl = {}
    w.S.dsl.active = DSL.enabled
    if (!DSL.enabled && typeof stopDSLIntervals === 'function') { stopDSLIntervals() }
    if (DSL.enabled && typeof startDSLIntervals === 'function' && !DSL.checkInterval) { startDSLIntervals() }
    _dslUI({
      toggleBtnText: DSL.enabled ? 'DSL ENGINE ON' : 'DSL ENGINE OFF',
      toggleBtnClass: 'dsl-toggle' + (DSL.enabled ? '' : ' off'),
      statusDotColor: DSL.enabled ? 'var(--grn-bright)' : '#333',
      statusDotBg: DSL.enabled ? 'var(--grn-bright)' : '#333',
    })
    atLog('info', DSL.enabled ? '[DSL] Dynamic SL ACTIV' : '[WARN] Dynamic SL OPRIT')
    brainThink(DSL.enabled ? 'ok' : 'bad', DSL.enabled ? (_ZI?.tgt || '') + ' DSL activat' : 'DSL oprit')
    if (typeof w.dslUpdateBanner === 'function') w.dslUpdateBanner()
    // [DSL-OFF] Propagate DSL on/off to server so new AT + manual positions respect it.
    try {
      fetch('/api/dsl/toggle', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: DSL.enabled }),
      }).catch(function () { /* silent */ })
    } catch (_) {}
    _emitDSLChanged()
  } catch (e) { console.warn('[DSL] toggleDSL error:', e) }
}

// ── ASSIST ARM TOGGLE ────────────────────────────────────────
export function toggleAssistArm(): void {
  const _m = (w.S.mode || 'assist').toLowerCase()
  if (_m !== 'assist') { toast('ARM disponibil doar în ASSIST mode'); return }
  w.S.assistArmed = !w.S.assistArmed
  if (typeof w.ARM_ASSIST !== 'undefined') {
    w.ARM_ASSIST.armed = w.S.assistArmed
    w.ARM_ASSIST.ts = w.S.assistArmed ? Date.now() : 0
  }
  _syncDslAssistUI()
  brainThink(w.S.assistArmed ? 'ok' : 'info', w.S.assistArmed ? _ZI.dYlw + ' ASSIST ARMAT — DSL va executa la semnal' : _ZI.unlk + ' ASSIST dezarmat — DSL în preview only')
  w.dslUpdateBanner()
}

export function _syncDslAssistUI(): void {
  const _m = (w.S.mode || 'assist').toLowerCase()
  const dslConf = document.querySelectorAll('.dsl-config input, .dsl-config select')
  dslConf.forEach((i: any) => { i.disabled = false; i.style.pointerEvents = '' })
  // [R10] pointerEvents reset on #dslZone removed — React owns the node and no
  // codepath sets `pointerEvents = 'none'` on it anymore, so the reset was a
  // no-op write on a React-owned element.

  const _btnText = DSL.enabled ? 'DSL ENGINE ON' : 'DSL ENGINE OFF'
  _dslUI({ lockOverlayVisible: false, toggleBtnDisabled: false, toggleBtnText: _btnText })

  if (_m === 'auto') {
    _dslUI({ assistBarVisible: false, toggleBtnTitle: 'Global DSL defaults for new positions' })
  } else if (_m === 'assist') {
    _dslUI({
      assistBarVisible: true, toggleBtnTitle: '',
      assistArmHtml: w.S.assistArmed ? _ZI.dYlw + ' ASSIST ARMAT' : _ZI.lock + ' ARM ASSIST',
      assistArmClass: 'dsl-assist-arm' + (w.S.assistArmed ? ' armed' : ''),
      assistStatusText: w.S.assistArmed ? 'ASSIST ARMAT \u2014 DSL va executa la semnal' : 'Dezarmat \u2014 DSL \u00een preview only (f\u0103r\u0103 execu\u021Bie)',
    })
  } else {
    _dslUI({ assistBarVisible: false, toggleBtnTitle: '' })
  }
}

// ─── INIT BUBBLES (neon water cooling effect) ────────────────
export function initDSLBubbles(): void {
  const bg = el('dslLiquidBg')
  const cascade = el('dslCascade')
  if (!bg || !cascade) return

  bg.innerHTML = Array.from({ length: 12 }, (_: any, i: number) => {
    const size = 4 + Math.random() * 8
    const left = 5 + Math.random() * 90
    const dur = 3 + Math.random() * 5
    const delay = Math.random() * 4
    const col = Math.random() > .5 ? '#00ffcc' : '#0066ff'
    return `<div class="dsl-bubble" style="width:${size}px;height:${size}px;left:${left}%;background:${col};opacity:.15;animation-duration:${dur}s;animation-delay:${delay}s;box-shadow:0 0 ${size}px ${col}44"></div>`
  }).join('')

  cascade.innerHTML = Array.from({ length: 20 }, (_: any, i: number) => {
    const h = 4 + Math.random() * 10
    const dur = 0.4 + Math.random() * 0.6
    const del = Math.random() * 1.5
    const col = Math.random() > .4 ? '#00ffcc' : '#0088ff'
    return `<div class="dsl-drop" style="height:${h}px;background:${col};animation-duration:${dur}s;animation-delay:${del}s;opacity:.7"></div>`
  }).join('')
}


// DSL Brain logic
// ── DSL Safety Guard: reject invalid DSL price values ──
export function _dslSafePrice(val: any, fallback: any, label: any): any {
  if (!Number.isFinite(val) || val <= 0 || val > 1e12) {
    console.warn('[DSL GUARD] Invalid', label, ':', val, '→ fallback', fallback)
    return fallback
  }
  return val
}

// ── DSL Parameter Sanitizer (NON-BLOCKING) ──
export function _dslSanitizeParams(raw: any, posId: any): any {
  const DEFAULTS: any = { openDslPct: 40, pivotLeftPct: 0.8, pivotRightPct: 1.0, impulseVPct: 2.0 }
  const CLAMPS: any = {
    openDslPct: { min: 0.01, max: 100 },
    pivotLeftPct: { min: 0.01, max: 100 },
    pivotRightPct: { min: 0.01, max: 100 },
    impulseVPct: { min: 0.01, max: 100 },
  }
  let corrected = false
  const fixes: string[] = []
  const out: any = {}

  for (const key of ['openDslPct', 'pivotLeftPct', 'pivotRightPct', 'impulseVPct']) {
    let v = raw[key]
    const c = CLAMPS[key]
    const d = DEFAULTS[key]
    if (!Number.isFinite(v) || v === null || v === undefined) {
      fixes.push(`${key}: ${v}→${d} (invalid)`)
      v = d; corrected = true
    }
    if (v < c.min) { fixes.push(`${key}: ${v}→${c.min} (below min)`); v = c.min; corrected = true }
    if (v > c.max) { fixes.push(`${key}: ${v}→${c.max} (above max)`); v = c.max; corrected = true }
    out[key] = v
  }
  // [DSL-SEMANTIC-FIX] impulseVPct is independent of pivotRightPct —
  // all presets intentionally have IV < PR (e.g. FAST PR=0.40 / IV=0.20).
  // The old IV>PR cross-field clamp was silently overwriting every user
  // IV edit on the next DSL tick. Server-side sanitizer (serverDSL.js)
  // already dropped this constraint; client is now aligned.
  if (corrected) {
    const msg = `DSL SANITIZE [${posId}]: ` + fixes.join(' | ')
    console.warn(msg)
    atLog('warn', msg)
  }
  out.corrected = corrected
  return out
}

export function runDSLBrain(): void {
  // [AT-UNIFY] When server AT is active, server DSL handles SL management.
  if (w._serverATEnabled) {
    const allOpenPosns = [
      ...(getDemoPositions()),
      ...(getLivePositions())
    ].filter((p: any) => !p.closed)
    if (!allOpenPosns.length) { renderDSLWidget([]); return }

    const _atPositions = allOpenPosns.filter((p: any) => !!p.autoTrade && p._dsl)
    const _manualPositions = allOpenPosns.filter((p: any) => !p.autoTrade || !p._dsl)

    // Bridge server DSL state for AT positions
    _atPositions.forEach((pos: any) => {
      const _dslKey = String(pos.id)
      const serverDsl = pos._dsl
      DSL.positions[_dslKey] = DSL.positions[_dslKey] || {}
      const dsl = DSL.positions[_dslKey]
      const cur = pos.sym === getSymbol() ? getPrice() : (w.allPrices[pos.sym] || w.wlPrices[pos.sym]?.price || pos.entry)

      // [ZT-AUD-008] Stale detection
      if (serverDsl.lastTickTs && Date.now() - serverDsl.lastTickTs > 60000) {
        dsl._stale = true
        if (!dsl._staleLogged) {
          dsl._staleLogged = true
          atLog('warn', '[STALE] DSL state stale for pos ' + _dslKey + ' (>' + Math.round((Date.now() - serverDsl.lastTickTs) / 1000) + 's)')
        }
      } else {
        dsl._stale = false
        dsl._staleLogged = false
      }
      dsl.active = !!serverDsl.active
      dsl.progress = serverDsl.progress || 0
      dsl.currentSL = serverDsl.currentSL || pos.sl
      dsl.originalSL = serverDsl.originalSL || pos.sl
      dsl.originalTP = dsl.originalTP || pos.tp
      dsl.pivotLeft = serverDsl.pivotLeft || null
      dsl.pivotRight = serverDsl.pivotRight || null
      dsl.impulseVal = serverDsl.impulseVal || null
      dsl._activationPrice = serverDsl.activationPrice || 0
      dsl.ttpArmed = serverDsl.ttpArmed || false
      dsl.ttpPeak = serverDsl.ttpPeak || 0
      dsl.impulseTriggered = (serverDsl.phase === 'IMPULSE')
      dsl.yellowLine = dsl.active ? cur : null
      dsl._barGreenPct = serverDsl.progress || 0
      dsl._barYellowPct = 100
      if (!Array.isArray(dsl.log)) dsl.log = []
      if (serverDsl.lastLog && (!dsl.log.length || dsl.log[dsl.log.length - 1].msg !== serverDsl.lastLog)) {
        dsl.log.push({ ts: Date.now(), msg: serverDsl.lastLog })
        if (dsl.log.length > 20) dsl.log = dsl.log.slice(-20)
      }
      _pushDslPosition(_dslKey)
    })

    // Cleanup DSL states for closed positions
    Object.keys(DSL.positions).forEach((id: string) => {
      if (!allOpenPosns.find((p: any) => String(p.id) === String(id))) _removeDslPosition(id)
    })

    if (!_manualPositions.length || !Number.isFinite(getPrice()) || getPrice() <= 0
        || w._SAFETY.dataStalled || w._SAFETY.isReconnecting) {
      renderDSLWidget(allOpenPosns)
      renderATPositions()
      return
    }

    _runClientDSLOnPositions(_manualPositions)
    renderDSLWidget(allOpenPosns)
    renderATPositions()
    return
  }
  if (!DSL.enabled) return
  if (!Number.isFinite(getPrice()) || getPrice() <= 0) return
  if (w._SAFETY.dataStalled || w._SAFETY.isReconnecting) return
  const allOpenPosns = [
    ...(getDemoPositions()),
    ...(getLivePositions())
  ].filter((p: any) => !p.closed)
  if (!allOpenPosns.length) { renderDSLWidget([]); return }

  _runClientDSLOnPositions(allOpenPosns)

  Object.keys(DSL.positions).forEach((id: string) => {
    if (!allOpenPosns.find((p: any) => String(p.id) === String(id))) {
      _removeDslPosition(id)
      if (DSL._attachedIds) DSL._attachedIds.delete(String(id))
    }
  })

  renderDSLWidget(allOpenPosns)
  renderATPositions()
}

// ── Client-side DSL engine — runs activation + phases on given positions ──
export function _runClientDSLOnPositions(positions: any[]): void {
  const _globalDslPct = getTCDslActivatePct()
  const _globalPivotL = getTCDslTrailPct()
  const _globalPivotR = getTCDslTrailSusPct()
  const _globalImpulseV = getTCDslExtendPct()

  positions.forEach((pos: any) => {
    const _pp = pos.dslParams || {}
    const _rawParams = {
      openDslPct: _pp.openDslPct ?? _globalDslPct,
      pivotLeftPct: _pp.pivotLeftPct ?? _globalPivotL,
      pivotRightPct: _pp.pivotRightPct ?? _globalPivotR,
      impulseVPct: _pp.impulseVPct ?? _globalImpulseV,
    }
    const _san = _dslSanitizeParams(_rawParams, pos.id)
    if (_san.corrected) {
      if (!pos.dslParams) pos.dslParams = {}
      pos.dslParams.openDslPct = _san.openDslPct
      pos.dslParams.pivotLeftPct = _san.pivotLeftPct
      pos.dslParams.pivotRightPct = _san.pivotRightPct
      pos.dslParams.impulseVPct = _san.impulseVPct
    }
    const openDSLpct = _san.openDslPct
    const pivotLeftPct = _san.pivotLeftPct
    const pivotRightPct = _san.pivotRightPct
    const impulseValPct = _san.impulseVPct

    const _posMode = (pos.controlMode || (pos.autoTrade ? (pos.sourceMode || 'auto') : 'paper')).toLowerCase()
    const _canMoveSL = _posMode === 'auto' || _posMode === 'paper'
      || (_posMode === 'assist' && w.S.assistArmed)
    const cur = pos.sym === getSymbol() ? getPrice() : (w.allPrices[pos.sym] || w.wlPrices[pos.sym]?.price || pos.entry)
    if (!cur || cur <= 0) return
    const _wasRestored = !!pos._restored
    if (pos._restored) { pos._restored = false }
    const isLong = pos.side === 'LONG'

    // ── INIT DSL state ──
    const _dslKey = String(pos.id)
    DSL.positions[_dslKey] = DSL.positions[_dslKey] || {}
    const _rb = DSL.positions[_dslKey]
    if (_rb.active == null) _rb.active = false
    if (_rb.pivotLeft == null) _rb.pivotLeft = null
    if (_rb.pivotRight == null) _rb.pivotRight = null
    if (_rb.impulseVal == null) _rb.impulseVal = null
    if (_rb.yellowLine == null) _rb.yellowLine = null
    if (_rb.originalSL == null) _rb.originalSL = pos.sl
    if (_rb.originalTP == null) _rb.originalTP = pos.tp
    if (_rb.currentSL == null) _rb.currentSL = pos.sl
    if (!Array.isArray(_rb.log)) _rb.log = []
    if (!Array.isArray(pos.dslHistory)) pos.dslHistory = []
    if (pos.dslHistory.length > 30) pos.dslHistory = pos.dslHistory.slice(-30)
    if (_rb.log.length > 20) _rb.log = _rb.log.slice(-20)

    const dsl = DSL.positions[_dslKey]

    // ── DSL activation target (STORED, not recalculated per tick) ──
    if (!pos.dslParams) pos.dslParams = {}
    if (!(pos.dslParams.dslTargetPrice > 0)) {
      pos.dslParams.dslTargetPrice = isLong
        ? cur * (1 + openDSLpct / 100)
        : cur * (1 - openDSLpct / 100)
    }
    let _storedTarget = pos.dslParams.dslTargetPrice

    const _targetWrong = isLong ? (_storedTarget <= pos.entry) : (_storedTarget >= pos.entry)
    if (_targetWrong) {
      _storedTarget = isLong
        ? pos.entry * (1 + openDSLpct / 100)
        : pos.entry * (1 - openDSLpct / 100)
      pos.dslParams.dslTargetPrice = _storedTarget
    }

    const _entryToTarget = isLong ? (_storedTarget - pos.entry) : (pos.entry - _storedTarget)
    const _entryToCur = isLong ? (cur - pos.entry) : (pos.entry - cur)
    let progress = 0
    if (_entryToTarget > 0) {
      progress = Math.max(0, Math.min(100, (_entryToCur / _entryToTarget) * 100))
    }
    dsl.progress = progress
    dsl._activationPrice = _storedTarget
    dsl._barGreenPct = progress
    dsl._barYellowPct = 100

    // ══════════════════════════════════════════════════════
    // FAZA 1: ACTIVARE
    // ══════════════════════════════════════════════════════
    const _activationHit = isLong ? (cur >= _storedTarget) : (cur <= _storedTarget)
    if (_canMoveSL && !dsl.active && _activationHit) {
      dsl.active = true
      dsl.yellowLine = cur

      dsl.pivotLeft = isLong
        ? cur * (1 - pivotLeftPct / 100)
        : cur * (1 + pivotLeftPct / 100)

      dsl.pivotRight = isLong
        ? cur * (1 + pivotRightPct / 100)
        : cur * (1 - pivotRightPct / 100)

      // [DSL-SEMANTIC-FIX] IV is measured FROM PR, not from current price.
      // PR is already offset from cur by pivotRightPct, so IV = PR * (1 + ivPct/100).
      dsl.impulseVal = isLong
        ? dsl.pivotRight * (1 + impulseValPct / 100)
        : dsl.pivotRight * (1 - impulseValPct / 100)

      dsl.pivotLeft = _dslSafePrice(dsl.pivotLeft, pos.sl, 'PL-init')
      dsl.pivotRight = _dslSafePrice(dsl.pivotRight, cur, 'PR-init')
      dsl.impulseVal = _dslSafePrice(dsl.impulseVal, dsl.pivotRight, 'IV-init')

      // [DSL MAGNET] Hook A
      const _magnetOn_A = !!(pos.dslParams && pos.dslParams.magnetEnabled)
      if (_magnetOn_A) {
        const _magSnap = _computeDslMagnetSnap(dsl.pivotLeft, pos, pos.side, 'PL', { cur: cur })
        if (_magSnap.applied) {
          const _preMag = dsl.pivotLeft
          dsl.pivotLeft = _magSnap.snappedPrice
          dsl.pivotLeft = _dslSafePrice(dsl.pivotLeft, _preMag, 'PL-mag-A')
          if (typeof pos.sl === 'number' && pos.sl > 0) {
            if (isLong) { dsl.pivotLeft = Math.max(dsl.pivotLeft, pos.sl) }
            else { dsl.pivotLeft = Math.min(dsl.pivotLeft, pos.sl) }
          }
          dsl.log.push({ ts: Date.now(), msg: '[MAG-A] ' + _magSnap.reason })
          if (!Array.isArray(pos.dslHistory)) pos.dslHistory = []
          pos.dslHistory.push({ ts: Date.now(), msg: '[MAG] ' + _magSnap.reason })
          if (pos.dslParams) pos.dslParams.magnetSnappedPL = dsl.pivotLeft
        }
        dsl._magnetPreview = _magSnap
      } else {
        dsl._magnetPreview = null
      }

      dsl.currentSL = dsl.pivotLeft
      _syncLiveSL(pos, dsl.currentSL)

      dsl.log.push({ ts: Date.now(), msg: `DSL activat @$${fP(cur)} | PL=$${fP(dsl.pivotLeft)} | PR=$${fP(dsl.pivotRight)} | IV=$${fP(dsl.impulseVal)}` })
      if (!Array.isArray(pos.dslHistory)) pos.dslHistory = []
      pos.dslHistory.push({ ts: Date.now(), msg: `[DSL] activated @$${fP(cur)} — SL→$${fP(dsl.pivotLeft)}` })
      if (typeof w.DLog !== 'undefined') w.DLog.record('dsl_move', { event: 'activate', sym: pos.sym, side: pos.side, price: cur, pivotLeft: dsl.pivotLeft, pivotRight: dsl.pivotRight, impulseVal: dsl.impulseVal })
      if (_wasRestored) {
        // [DSL-RESUME] Position was restored from snapshot with in-memory DSL state missing.
        // Price is already past target, so activation fires immediately. Don't spam atLog —
        // silently mark active; user already saw the original activation in prior session.
        dsl.log.push({ ts: Date.now(), msg: `[RESUME] DSL state rehydrated @$${fP(cur)}` })
      } else {
        atLog('buy', `[DSL] ACTIVAT: ${pos.sym.replace('USDT', '')} @$${fP(cur)} | Pivot Left(SL)=$${fP(dsl.pivotLeft)} | Impulse=$${fP(dsl.impulseVal)}`)
        brainThink('ok', _ZI.tgt + ` DSL activat pe ${pos.sym.replace('USDT', '')} — Pivot Left preia SL la $${fP(dsl.pivotLeft)}`)
      }
    }

    // ══════════════════════════════════════════════════════
    // FAZA 2: ACTIV
    // ══════════════════════════════════════════════════════
    if (dsl.active) {
      dsl.yellowLine = cur

      dsl.pivotRight = isLong
        ? cur * (1 + pivotRightPct / 100)
        : cur * (1 - pivotRightPct / 100)

      // ══════════════════════════════════════════════════════
      // PHASE 2.5: PIVOT LEFT EXIT
      // ══════════════════════════════════════════════════════
      if (_canMoveSL && dsl.pivotLeft > 0 && !_wasRestored) {
        const _plHit = isLong ? (cur <= dsl.pivotLeft) : (cur >= dsl.pivotLeft)
        if (_plHit) {
          const _plReason = `DSL PL Exit @$${fP(cur)} (PL=$${fP(dsl.pivotLeft)})`
          dsl.log.push({ ts: Date.now(), msg: _plReason })
          if (!Array.isArray(pos.dslHistory)) pos.dslHistory = []
          pos.dslHistory.push({ ts: Date.now(), msg: _plReason })
          if (typeof w.DLog !== 'undefined') w.DLog.record('dsl_move', { event: 'pl_exit', sym: pos.sym, side: pos.side, price: cur, pivotLeft: dsl.pivotLeft })
          atLog('sell', `[DSL] PL EXIT: ${pos.sym.replace('USDT', '')} ${pos.side} @$${fP(cur)}`)
          brainThink('info', _ZI.tgt + ` DSL PL exit: ${pos.sym.replace('USDT', '')} ${pos.side} @$${fP(cur)}`)
          toast(`DSL PL Exit: ${pos.sym.replace('USDT', '')} ${pos.side} @$${fP(cur)}`)
          if (pos.isLive && typeof closeLivePos === 'function') {
            closeLivePos(pos.id, _plReason)
            if (pos.autoTrade && w.AT && typeof w.AT === 'object') {
              const _dslPnl = typeof w.calcPosPnL === 'function' ? w.calcPosPnL(pos, cur) : 0
              if (Number.isFinite(_dslPnl)) {
                w.AT.totalPnL = (w.AT.totalPnL || 0) + _dslPnl
                w.AT.dailyPnL = (w.AT.dailyPnL || 0) + _dslPnl
                w.AT.realizedDailyPnL = (w.AT.realizedDailyPnL || 0) + _dslPnl
                w.AT.closedTradesToday = (w.AT.closedTradesToday || 0) + 1
                if (_dslPnl >= 0) w.AT.wins = (w.AT.wins || 0) + 1; else w.AT.losses = (w.AT.losses || 0) + 1
              }
              setTimeout(updateATStats, 50)
            }
          } else {
            closeDemoPos(pos.id, _plReason)
          }
          return
        }
      }

      // ══════════════════════════════════════════════════════
      // FAZA 3: IMPULSE VALIDATION trigger
      // ══════════════════════════════════════════════════════
      if (_canMoveSL) {
        const _prDistPct = cur > 0 ? Math.abs(cur - (dsl.pivotRight || 0)) / cur * 100 : 0
        const ivConditionMet = _prDistPct >= 0.05 && dsl.pivotRight != null && dsl.impulseVal != null && (isLong
          ? (dsl.pivotRight >= dsl.impulseVal)
          : (dsl.pivotRight <= dsl.impulseVal))

        if (ivConditionMet) {
          if (!dsl.impulseTriggered) {
            dsl.impulseTriggered = true

            const oldPL = dsl.pivotLeft
            const oldIV = dsl.impulseVal

            // [DSL-SEMANTIC-FIX] At impulse, PL anchors to current price (tightens).
            // New PR = cur + pivotRightPct (will continue trailing on Faza 2).
            // IV = new PR * (1 + ivPct/100) — always relative to PR.
            const _newPR = isLong
              ? cur * (1 + pivotRightPct / 100)
              : cur * (1 - pivotRightPct / 100)
            dsl.impulseVal = isLong
              ? _newPR * (1 + impulseValPct / 100)
              : _newPR * (1 - impulseValPct / 100)

            dsl.pivotLeft = isLong
              ? cur * (1 - pivotLeftPct / 100)
              : cur * (1 + pivotLeftPct / 100)

            dsl.impulseVal = _dslSafePrice(dsl.impulseVal, oldIV, 'IV-step')
            dsl.pivotLeft = _dslSafePrice(dsl.pivotLeft, oldPL, 'PL-step')

            // [PATCH PL-MONO] Monotonic guard
            if (isLong) {
              dsl.pivotLeft = Math.max(oldPL, dsl.pivotLeft)
            } else {
              dsl.pivotLeft = Math.min(oldPL, dsl.pivotLeft)
            }

            // [DSL MAGNET] Hook B
            const _magnetOn_B = !!(pos.dslParams && pos.dslParams.magnetEnabled)
            if (_magnetOn_B) {
              const _magSnapB = _computeDslMagnetSnap(dsl.pivotLeft, pos, pos.side, 'PL', { cur: cur })
              if (_magSnapB.applied) {
                const _preSnapB = dsl.pivotLeft
                dsl.pivotLeft = _magSnapB.snappedPrice
                dsl.pivotLeft = _dslSafePrice(dsl.pivotLeft, _preSnapB, 'PL-mag-B')
                if (isLong) {
                  dsl.pivotLeft = Math.max(oldPL, dsl.pivotLeft)
                } else {
                  dsl.pivotLeft = Math.min(oldPL, dsl.pivotLeft)
                }
                dsl.log.push({ ts: Date.now(), msg: '[MAG-B] ' + _magSnapB.reason })
                if (!Array.isArray(pos.dslHistory)) pos.dslHistory = []
                pos.dslHistory.push({ ts: Date.now(), msg: '[MAG] ' + _magSnapB.reason })
                if (pos.dslParams) pos.dslParams.magnetSnappedPL = dsl.pivotLeft
              }
              dsl._magnetPreview = _magSnapB
            } else {
              dsl._magnetPreview = null
            }

            dsl.currentSL = dsl.pivotLeft
            _syncLiveSL(pos, dsl.currentSL)

            dsl.log.push({ ts: Date.now(), msg: `[IMP] IMPULSE: PL $${fP(oldPL)}→$${fP(dsl.pivotLeft)} | IV $${fP(oldIV)}→$${fP(dsl.impulseVal)}` })
            if (!Array.isArray(pos.dslHistory)) pos.dslHistory = []
            pos.dslHistory.push({ ts: Date.now(), msg: `[IMP] Impulse hit — SL $${fP(oldPL)}→$${fP(dsl.pivotLeft)}` })
            if (typeof w.DLog !== 'undefined') w.DLog.record('dsl_move', { event: 'impulse', sym: pos.sym, side: pos.side, price: cur, oldPL: oldPL, newPL: dsl.pivotLeft, newIV: dsl.impulseVal })
            atLog('buy', `[IMP] IMPULSE HIT: ${pos.sym.replace('USDT', '')} | SL $${fP(oldPL)}→$${fP(dsl.pivotLeft)} | IV→$${fP(dsl.impulseVal)}`)
            brainThink('ok', _ZI.bolt + ` Impulse atins pe ${pos.sym.replace('USDT', '')} — SL mutat la $${fP(dsl.pivotLeft)}`)
            toast(`${pos.sym.replace('USDT', '')} Impulse Validation atins! SL → $${fP(dsl.pivotLeft)}`)
          }
        } else {
          if (dsl.impulseTriggered) {
            dsl.impulseTriggered = false
          }
        }
      } // end _canMoveSL

      // [DSL MAGNET] Preview-only for non-mutation modes
      if (!_canMoveSL && dsl.pivotLeft > 0) {
        const _magnetOnPreview = !!(pos.dslParams && pos.dslParams.magnetEnabled)
        if (_magnetOnPreview) {
          dsl._magnetPreview = _computeDslMagnetSnap(dsl.pivotLeft, pos, pos.side, 'PL', { cur: cur })
        } else {
          dsl._magnetPreview = null
        }
      }

      // ══════════════════════════════════════════════════════
      // PHASE 7: AI ADAPTIVE STATE per position
      // ══════════════════════════════════════════════════════
      if (_posMode === 'auto' || _posMode === 'assist') {
        const _slDist = Math.abs(cur - dsl.currentSL) / pos.entry * 100
        let _newAdapt: string = 'calm'
        if (progress > 80 || _slDist < 0.3) _newAdapt = 'aggressive'
        else if (progress > 50 || _slDist < 0.6) _newAdapt = 'tense'

        const _prevAdapt = pos.dslAdaptiveState || 'calm'
        if (_newAdapt !== _prevAdapt) {
          pos.dslAdaptiveState = _newAdapt
          if (!Array.isArray(pos.dslHistory)) pos.dslHistory = []
          const _aMap: any = { calm: '[CALM]', tense: '[TENSE]', aggressive: '[AGG]' }
          pos.dslHistory.push({ ts: Date.now(), msg: `${_aMap[_newAdapt]} AI state → ${_newAdapt.toUpperCase()} (progress:${progress.toFixed(0)}% slDist:${_slDist.toFixed(2)}%)` })
        }
      }
    }
    _pushDslPosition(_dslKey)
  })
}

// ─── RENDER DSL WIDGET ─────────────────────────────────────────

// ── Take Control handler (AUTO + ASSIST positions) ─────────────
export function dslTakeControl(posId: any): void {
  posId = String(posId)
  const pos = [...(getDemoPositions()), ...(getLivePositions())].find((p: any) => String(p.id) === posId)
  if (!pos) return
  const _cm = (pos.controlMode || (pos.autoTrade ? (pos.sourceMode || 'auto') : 'paper')).toLowerCase()
  if (_cm !== 'auto' && _cm !== 'assist') { toast('Take Control: doar pentru AUTO/ASSIST'); return }
  if (!pos.sourceMode) pos.sourceMode = _cm
  pos.controlMode = 'user'
  if (w._serverATEnabled && pos._serverSeq) {
    fetch('/api/at/control', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ seq: pos._serverSeq, controlMode: 'user' }) }).catch(function () { })
  }
  if (!Array.isArray(pos.dslHistory)) pos.dslHistory = []
  pos.dslHistory.push({ ts: Date.now(), msg: '[USER] TOOK CONTROL — manual override active' })
  brainThink('info', _ZI.hand + ` User took control of ${pos.sym.replace('USDT', '')} ${pos.side}`)
  toast(`Control taken: ${pos.sym.replace('USDT', '')} ${pos.side}`)
  if (typeof w.ZState !== 'undefined') w.ZState.save()
  // [TAKE-CTRL] Immediate re-render so the 4 editable DSL inputs appear right
  // away — without this, user has to wait for the next DSL tick (every few
  // seconds) before the UI switches from the TAKE CONTROL button to the
  // MANUAL CONTROL ACTIVE panel with DSL/PL/PR/IV inputs.
  try {
    const _allOpen = [...(getDemoPositions()), ...(getLivePositions())].filter(function (p: any) { return !p.closed })
    renderDSLWidget(_allOpen)
  } catch (_) { /* best-effort */ }
}

// ── Let AI Control handler ───────────
export function dslReleaseControl(posId: any): void {
  posId = String(posId)
  const pos = [...(getDemoPositions()), ...(getLivePositions())].find((p: any) => String(p.id) === posId)
  if (!pos) return
  if ((pos.controlMode || 'paper') !== 'user') { toast('Această poziție nu e în MANUAL'); return }
  const _origSource = (pos.sourceMode || pos.brainModeAtOpen || 'assist').toLowerCase()
  pos.controlMode = _origSource
  if (w._serverATEnabled && pos._serverSeq) {
    var _releasePayload: any = { seq: pos._serverSeq, controlMode: _origSource }
    if (pos.dslParams) {
      var _clean: any = {}
      ;['openDslPct', 'pivotLeftPct', 'pivotRightPct', 'impulseVPct', 'dslTargetPrice'].forEach(function (k: string) {
        if (Number.isFinite(pos.dslParams[k])) _clean[k] = pos.dslParams[k]
      })
      _releasePayload.dslParams = _clean
    }
    fetch('/api/at/control', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(_releasePayload) }).catch(function () { })
  }
  pos._dslParamsPushedAt = Date.now()
  if (!Array.isArray(pos.dslHistory)) pos.dslHistory = []
  pos.dslHistory.push({ ts: Date.now(), msg: `[AI] CONTROL RESUMED (${_origSource.toUpperCase()}) — continuing from current DSL values` })
  brainThink('ok', _ZI.robot + ` AI resumed control of ${pos.sym.replace('USDT', '')} ${pos.side} — from current state`)
  toast(`AI control resumed: ${pos.sym.replace('USDT', '')} ${pos.side}`)
  if (typeof w.ZState !== 'undefined') w.ZState.save()
  // [LET-AI] Immediate re-render so the MANUAL panel collapses back to the
  // TAKE CONTROL button without waiting for the next DSL tick.
  try {
    const _allOpen = [...(getDemoPositions()), ...(getLivePositions())].filter(function (p: any) { return !p.closed })
    renderDSLWidget(_allOpen)
  } catch (_) { /* best-effort */ }
}

// ── Manual DSL param update ───
export function dslManualParam(posId: any, param: any, value: any): void {
  posId = String(posId)
  const pos = [...(getDemoPositions()), ...(getLivePositions())].find((p: any) => String(p.id) === posId)
  if (!pos) return
  const _cm = (pos.controlMode || (pos.autoTrade ? (pos.sourceMode || 'auto') : 'paper')).toLowerCase()
  if (_cm !== 'user' && _cm !== 'paper') return
  const v = parseFloat(value)
  if (!isFinite(v) || v <= 0) return
  if (!pos.dslParams) pos.dslParams = {}
  pos.dslParams[param] = v
  // [USER-EDIT] Mark position as user-edited so server-sync merge logic
  // preserves these manual values across ticks/reloads (see state.ts merge).
  pos._dslUserEdited = true
  if (param === 'openDslPct') {
    const _dslCheck = DSL.positions[posId]
    if (!_dslCheck?.active) {
      const _livePr = pos.sym === getSymbol() ? getPrice() : (w.allPrices[pos.sym] || w.wlPrices[pos.sym]?.price || pos.entry)
      if (_livePr > 0) {
        pos.dslParams.dslTargetPrice = pos.side === 'LONG'
          ? _livePr * (1 + v / 100)
          : _livePr * (1 - v / 100)
      }
    }
  }
  if (!Array.isArray(pos.dslHistory)) pos.dslHistory = []
  pos.dslHistory.push({ ts: Date.now(), msg: `[EDIT] Manual ${param}: ${v}` })

  // ── LIVE RECALC ──
  const _dslKey = String(posId)
  const _dsl = DSL.positions[_dslKey]
  if (_dsl?.active) {
    const _pp = pos.dslParams
    const _gDsl = getTCDslActivatePct()
    const _gPL = getTCDslTrailPct()
    const _gPR = getTCDslTrailSusPct()
    const _gIV = getTCDslExtendPct()
    const _san = _dslSanitizeParams({
      openDslPct: _pp.openDslPct ?? _gDsl,
      pivotLeftPct: _pp.pivotLeftPct ?? _gPL,
      pivotRightPct: _pp.pivotRightPct ?? _gPR,
      impulseVPct: _pp.impulseVPct ?? _gIV,
    }, posId)
    const cur = pos.sym === getSymbol() ? getPrice() : (w.allPrices[pos.sym] || w.wlPrices[pos.sym]?.price || pos.entry)
    if (cur > 0) {
      const isLong = pos.side === 'LONG'
      _dsl.pivotLeft = isLong ? cur * (1 - _san.pivotLeftPct / 100) : cur * (1 + _san.pivotLeftPct / 100)
      _dsl.pivotRight = isLong ? cur * (1 + _san.pivotRightPct / 100) : cur * (1 - _san.pivotRightPct / 100)
      _dsl.impulseVal = isLong ? cur * (1 + _san.impulseVPct / 100) : cur * (1 - _san.impulseVPct / 100)
      _dsl.pivotLeft = _dslSafePrice(_dsl.pivotLeft, pos.sl, 'PL-manual')
      _dsl.pivotRight = _dslSafePrice(_dsl.pivotRight, cur, 'PR-manual')
      _dsl.impulseVal = _dslSafePrice(_dsl.impulseVal, cur, 'IV-manual')
      _dsl.currentSL = _dsl.pivotLeft
      _syncLiveSL(pos, _dsl.currentSL)
      _dsl.yellowLine = cur
      var _ivReached = isLong ? (cur >= _dsl.impulseVal) : (cur <= _dsl.impulseVal)
      if (!_ivReached) _dsl.impulseTriggered = false
      _dsl.log.push({ ts: Date.now(), msg: `[EDIT] LIVE recalc: PL=$${fP(_dsl.pivotLeft)} PR=$${fP(_dsl.pivotRight)} IV=$${fP(_dsl.impulseVal)}` })
    }
    _pushDslPosition(_dslKey)
  }

  if (typeof w.ZState !== 'undefined') w.ZState.save()

  var _allOpen = [...(getDemoPositions()), ...(getLivePositions())].filter(function (p: any) { return !p.closed })
  renderDSLWidget(_allOpen)

  pos._dslParamsPushedAt = Date.now()
  if (pos._serverSeq) {
    _dslPushParamsDebounced(pos._serverSeq, pos.dslParams)
  } else if (pos.isLive || pos.fromExchange) {
    var _retryPos = pos; var _retryAttempt = 0
    function _retryPush() {
      _retryAttempt++
      if (_retryAttempt > 4) { atLog('warn', '[DSL] Server sync params failed after 4 retries for ' + _retryPos.sym); return }
      if (_retryPos._serverSeq) { _dslPushParamsDebounced(_retryPos._serverSeq, _retryPos.dslParams); return }
      setTimeout(_retryPush, Math.min(3000 * Math.pow(2, _retryAttempt - 1), 30000))
    }
    setTimeout(_retryPush, 3000)
  }
}

// Debounced server push for manual DSL param edits
var _dslPushTimers: any = {}
export function _dslPushParamsDebounced(seq: any, dslParams: any): void {
  clearTimeout(_dslPushTimers[seq])
  _dslPushTimers[seq] = setTimeout(function () {
    var clean: any = {}
    ;['openDslPct', 'pivotLeftPct', 'pivotRightPct', 'impulseVPct', 'dslTargetPrice'].forEach(function (k: string) {
      if (Number.isFinite(dslParams[k])) clean[k] = dslParams[k]
    })
    fetch('/api/at/dslparams', {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ seq: seq, dslParams: clean })
    }).catch(function () { })
  }, 500)
}

// ── Drag handler for yellow DSL ON line (mouse + touch) ──────
;(function _initDslDrag() {
  let _dragPosId: any = null, _dragBar: any = null
  function _pctFromX(bar: any, clientX: number) {
    const rect = bar.getBoundingClientRect()
    const pct = Math.round((clientX - rect.left) / rect.width * 100)
    return Math.max(1, Math.min(100, pct))
  }
  const _dragBarScale = 0.55
  const _dragMaxVisualPct = Math.round(100 * _dragBarScale)
  function _onMove(e: any) {
    if (!_dragBar || !_dragPosId) return
    e.preventDefault()
    const x = e.touches ? e.touches[0].clientX : e.clientX
    const pct = Math.min(_dragMaxVisualPct, _pctFromX(_dragBar, x))
    const line = _dragBar.querySelector('.dsl-yellow-line')
    if (line) line.style.left = pct + '%'
  }
  function _onEnd() {
    if (!_dragBar || !_dragPosId) { _dragPosId = null; _dragBar = null; return }
    const line = _dragBar.querySelector('.dsl-yellow-line')
    if (line) {
      const visualPct = parseInt(line.style.left, 10) || 40
      const realPct = Math.round(Math.min(100, Math.max(1, visualPct / _dragBarScale)))
      dslManualParam(_dragPosId, 'openDslPct', realPct)
    }
    document.body.style.userSelect = ''
    _dragPosId = null; _dragBar = null
  }
  document.addEventListener('mouseup', _onEnd)
  document.addEventListener('touchend', _onEnd)
  document.addEventListener('mousemove', _onMove)
  document.addEventListener('touchmove', _onMove, { passive: false })

  document.addEventListener('mousedown', function (e: any) {
    const bar = e.target.closest('.dsl-prog-bar[data-dsl-drag]')
    if (!bar || bar.dataset.dslEditable !== '1') return
    _dragPosId = bar.dataset.dslDrag
    _dragBar = bar
    document.body.style.userSelect = 'none'
    _onMove(e)
  })
  document.addEventListener('touchstart', function (e: any) {
    const bar = e.target.closest('.dsl-prog-bar[data-dsl-drag]')
    if (!bar || bar.dataset.dslEditable !== '1') return
    _dragPosId = bar.dataset.dslDrag
    _dragBar = bar
    document.body.style.userSelect = 'none'
    _onMove(e)
  }, { passive: false })
})()

export function renderDSLWidget(positions: any[]): void {
  const container = el('dslPositionCards')
  if (!container) return

  const _activeMode = getATMode() || 'demo'
  const modeFiltered = positions.filter(function (p: any) {
    var posMode = p.mode || 'demo'
    return posMode === _activeMode
  })

  const dslAttached = modeFiltered.filter((p: any) => DSL.positions[String(p.id)])

  if (container.contains(document.activeElement) && document.activeElement!.tagName === 'INPUT') {
    _dslUI({ activeCountText: dslAttached.filter((p: any) => DSL.positions[String(p.id)]?.active).length + ' active' })
    return
  }

  const allDisplayPosns = dslAttached
  const activeCount = allDisplayPosns.filter((p: any) => DSL.positions[String(p.id)]?.active).length
  _dslUI({ activeCountText: activeCount + ' active' })

  if (!allDisplayPosns.length) {
    // [DSL-OFF] Distinct waiting text when engine is off vs. scanning for activation
    const _engineOff = !DSL.enabled
    const _headline = _engineOff ? 'DSL ENGINE OFF' : 'WAITING DYNAMIC SL...'
    const _sub = _engineOff
      ? 'WAITING FOR ACTIVATION — NEW POSITIONS WILL RUN WITH NATIVE TP/SL'
      : (_activeMode === 'live' ? 'SCANNING LIVE POSITIONS FOR ACTIVATION' : 'SCANNING DEMO POSITIONS FOR ACTIVATION')
    const _color = _engineOff ? '#f0c04088' : '#00ffcc'
    const _colorDim = _engineOff ? '#f0c04044' : '#00ffcc22'
    const _stroke = _engineOff ? '#f0c04022' : '#00ffcc11'
    container.innerHTML = `<div class="dsl-waiting" id="dslWaitingState">
      <div class="dsl-radar">
        <svg class="dsl-radar-svg" viewBox="0 0 80 80">
          <circle cx="40" cy="40" r="36" fill="none" stroke="${_stroke}" stroke-width="1"/>
          <circle cx="40" cy="40" r="26" fill="none" stroke="${_stroke}" stroke-width="1"/>
          <circle cx="40" cy="40" r="16" fill="none" stroke="${_stroke}" stroke-width="1"/>
          ${_engineOff ? '' : `<g class="dsl-radar-sweep"><path d="M40,40 L76,40 A36,36,0,0,0,40,4 Z" fill="url(#radarGrad)" opacity=".6"/></g>`}
          <circle cx="40" cy="40" r="3" fill="${_color}" opacity=".8"><animate attributeName="opacity" values="1;0.2;1" dur="1.5s" repeatCount="indefinite"/></circle>
        </svg>
      </div>
      <div>
        <div class="dsl-radar-txt" style="color:${_color}">${_headline}</div>
        <div style="font-size:12px;color:${_colorDim};margin-top:3px;letter-spacing:1px">${_sub}</div>
      </div>
    </div>`
    return
  }

  const atPositions = allDisplayPosns.filter((p: any) => p.autoTrade)
  const paperPositions = allDisplayPosns.filter((p: any) => !p.autoTrade)

  let html = ''

  // [DSL-OFF] Warning banner when engine is off but DSL-attached positions are still tracked
  if (!DSL.enabled) {
    html += `<div style="background:linear-gradient(90deg,#2a1400,#1a0a00);border:1px solid #f0c04066;border-radius:4px;padding:8px 12px;margin-bottom:8px;font-size:11px;color:#f0c040;letter-spacing:1px;text-align:center">
      DSL ENGINE OFF — următoarele poziții nu vor trece în DSL
    </div>`
  }

  if (atPositions.length) {
    html += `<div style="font-size:14px;color:#00ffcc55;letter-spacing:2px;padding:6px 12px 4px;border-bottom:1px solid #00ffcc11;margin-bottom:6px">AT POSITIONS (${atPositions.length})</div>`
    html += atPositions.map((pos: any) => _renderDslCard(pos)).join('')
  }

  if (paperPositions.length) {
    html += `<div style="font-size:14px;color:#f0c04055;letter-spacing:2px;padding:6px 12px 4px;border-bottom:1px solid #f0c04011;margin-bottom:6px;${atPositions.length ? 'margin-top:10px' : ''}">PAPER POSITIONS (${paperPositions.length})</div>`
    html += paperPositions.map((pos: any) => _renderDslCard(pos)).join('')
  }

  container.innerHTML = html

  // Event delegation for DSL card buttons + inputs
  if (!container.dataset.dslDelegated) {
    container.dataset.dslDelegated = '1'
    // Click delegation: dslToggleMagnet, dslTakeControl, dslReleaseControl
    container.addEventListener('click', (e: Event) => {
      const btn = (e.target as HTMLElement).closest('[data-action]') as HTMLElement
      if (!btn) return
      const action = btn.dataset.action
      const id = btn.dataset.id
      if (action === 'dslToggleMagnet') dslToggleMagnet(id)
      else if (action === 'dslTakeControl') dslTakeControl(id)
      else if (action === 'dslReleaseControl') dslReleaseControl(id)
    })
    // Change delegation: dslManualParam (input onchange)
    container.addEventListener('change', (e: Event) => {
      const input = (e.target as HTMLElement).closest('[data-action="dslManualParam"]') as HTMLInputElement
      if (input) dslManualParam(input.dataset.id, input.dataset.param, input.value)
    })
  }

  _emitDSLChanged()
}

// ── Render a single DSL position card ──────────────────────────
export function _renderDslCard(pos: any): string {
  const dsl = DSL.positions[String(pos.id)]
  const cur = pos.sym === getSymbol() ? getPrice() : (w.allPrices[pos.sym] || w.wlPrices[pos.sym]?.price || pos.entry)
  const symBase = pos.sym.replace('USDT', '')
  const isActive = dsl?.active || false
  const isLong = pos.side === 'LONG'
  const progress = dsl?.progress || 0
  const cardCls = isLong ? 'long' : 'short'

  const _pp = pos.dslParams || {}
  // Round to 2 decimals to absorb any lingering float garbage (e.g. 0.8999999
  // from older positions persisted before the round-at-source fix in brain.ts).
  const _r2 = (n: number) => Math.round(n * 100) / 100
  const openDSLpct = _r2(_pp.openDslPct ?? (getTCDslActivatePct()))
  const pivotLeftPct = _r2(_pp.pivotLeftPct ?? (getTCDslTrailPct()))
  const pivotRightPct = _r2(_pp.pivotRightPct ?? (getTCDslTrailSusPct()))
  const impulseValPct = _r2(_pp.impulseVPct ?? (getTCDslExtendPct()))

  const _cm = (pos.controlMode || (pos.autoTrade ? (pos.sourceMode || 'auto') : 'paper')).toLowerCase()
  const _isManual = _cm === 'user'
  const _isAT = !!pos.autoTrade

  var _dslEnv = w._resolvedEnv || (pos.isLive ? 'REAL' : 'DEMO')
  var _paperLiveLabel = _dslEnv === 'TESTNET' ? 'PAPER TESTNET' : 'PAPER LIVE'
  var _atEnvLabel = _dslEnv === 'TESTNET' ? 'TESTNET' : (pos.isLive ? 'REAL' : 'DEMO')
  const _srcLabel = _isAT
    ? ('AT ' + _atEnvLabel)
    : (pos.isLive ? _paperLiveLabel : 'PAPER DEMO')
  const _srcMap: any = {
    'AT DEMO': { color: '#aa44ff', bg: '#aa44ff18', border: '#aa44ff44', icon: '' },
    'AT TESTNET': { color: '#f0c040', bg: '#f0c04018', border: '#f0c04044', icon: '' },
    'AT REAL': { color: '#ff4466', bg: '#ff446618', border: '#ff446644', icon: '' },
    'PAPER DEMO': { color: '#ffffff66', bg: '#ffffff08', border: '#ffffff22', icon: '' },
    'PAPER LIVE': { color: '#ff4466', bg: '#ff446618', border: '#ff446644', icon: '' },
    'PAPER TESTNET': { color: '#f0c040', bg: '#f0c04018', border: '#f0c04044', icon: '' },
  }
  const _sb = _srcMap[_srcLabel] || _srcMap['PAPER DEMO']

  const _ctrlLabel = _isManual ? 'MANUAL' : 'AI'
  const _ctrlColor = _isManual ? '#f0c040' : '#00ff88'
  const _ctrlBg = _isManual ? '#f0c04018' : '#00ff8812'
  const _ctrlBorder = _isManual ? '#f0c04044' : '#00ff8833'
  const _ctrlIcon = _isManual ? '' : ''

  const _adaptState = pos.dslAdaptiveState || 'calm'
  const _adaptMap: any = {
    calm: { label: 'CALM', color: '#00ff88', icon: '' },
    tense: { label: 'TENSE', color: '#f0c040', icon: '' },
    aggressive: { label: 'AGGRESSIVE', color: '#ff4466', icon: '' },
  }
  const _as = _adaptMap[_adaptState] || _adaptMap.calm

  const posLabel = ''

  const origSL = dsl?.originalSL || pos.sl
  const origTP = dsl?.originalTP || pos.tp
  const currentSL = dsl?.currentSL || pos.sl

  const yellowLine = isActive ? cur : null
  const pivotLeft = isActive ? (dsl.pivotLeft || 0) : null
  const pivotRight = isActive ? cur * (isLong ? 1 + pivotRightPct / 100 : 1 - pivotRightPct / 100) : null
  const impulseVal = isActive ? (dsl.impulseVal || 0) : null

  const pnl = _safePnl(pos.side, cur, pos.entry, pos.size, pos.lev, false)
  const pnlStr = (pnl >= 0 ? '+' : '') + '$' + pnl.toFixed(2)

  const pivotLeftPnl = isActive && pivotLeft
    ? ((isLong ? pivotLeft - pos.entry : pos.entry - pivotLeft) / pos.entry * pos.size * pos.lev)
    : null
  const pivotLeftPnlStr = pivotLeftPnl !== null
    ? (pivotLeftPnl >= 0 ? '+' : '') + '$' + pivotLeftPnl.toFixed(2)
    : null

  const lo = Math.min(origSL || cur, origTP || cur, cur, pivotLeft || cur, impulseVal || cur)
  const hi = Math.max(origSL || cur, origTP || cur, cur, pivotLeft || cur, impulseVal || cur)
  const totalRange = (hi - lo) || 1
  const toPos = (v: number) => Math.min(98, Math.max(1, (v - lo) / totalRange * 100))

  const slPos = toPos(currentSL)
  const curPos = toPos(cur)
  const plPos = isActive ? toPos(pivotLeft!) : null
  const prPos = isActive ? toPos(pivotRight!) : null
  const ivPos = isActive ? toPos(impulseVal!) : null
  const _barScale = 0.55
  const priceProgress = Math.min(100, Math.max(0, (dsl?._barGreenPct ?? 0) * _barScale))
  const yellowMarkerPct = Math.min(100, Math.max(0, (dsl?._barYellowPct ?? 0) * _barScale))

  const _posHist = pos.dslHistory || []
  const _dslLog = dsl?.log || []
  const _allHistory = [..._posHist, ..._dslLog].sort((a: any, b: any) => (b.ts || 0) - (a.ts || 0)).slice(0, 3)
  const lastLog = _allHistory[0]?.msg || 'Awaiting activation...'

  const _showTakeControl = _isAT && (_cm === 'auto' || _cm === 'assist')
  const _showReleaseControl = _isAT && _cm === 'user'
  const _showPaperControls = !_isAT

  const _magnetOn = !!(pos.dslParams && pos.dslParams.magnetEnabled)
  const _magnetPreview = dsl?._magnetPreview || null
  const _magnetPreviewTxt = (_magnetOn && _magnetPreview && _magnetPreview.applied)
    ? 'MAG SNAP -> $' + fP(_magnetPreview.snappedPrice) + ' (' + _magnetPreview.source + ' conf:' + _magnetPreview.confidence + ')'
    : null
  const _canMoveSL_render = _cm === 'auto' || _cm === 'paper'
    || (_cm === 'assist' && (typeof w.S !== 'undefined' ? w.S.assistArmed : false))

  const _liqStr = pos.liqPrice ? '$' + fP(pos.liqPrice) : '-'
  const _dslActivationPrice = dsl?._activationPrice || (pos.dslParams?.dslTargetPrice > 0
    ? pos.dslParams.dslTargetPrice
    : (isLong ? cur * (1 + openDSLpct / 100) : cur * (1 - openDSLpct / 100)))
  const _dslPriceSub = isActive ? '$' + fP(cur) : '$' + fP(_dslActivationPrice)
  const _estPL = _dslActivationPrice > 0
    ? (isLong ? _dslActivationPrice * (1 - pivotLeftPct / 100) : _dslActivationPrice * (1 + pivotLeftPct / 100))
    : (pos.sl || 0)
  const _estPR = _dslActivationPrice > 0
    ? (isLong ? _dslActivationPrice * (1 + pivotRightPct / 100) : _dslActivationPrice * (1 - pivotRightPct / 100))
    : 0
  const _estIV = _dslActivationPrice > 0
    ? (isLong ? _dslActivationPrice * (1 + impulseValPct / 100) : _dslActivationPrice * (1 - impulseValPct / 100))
    : 0
  const _plPriceSub = isActive && pivotLeft ? '$' + fP(pivotLeft) : '$' + fP(_estPL)
  const _prPriceSub = isActive && pivotRight ? '$' + fP(pivotRight) : (_estPR > 0 ? '$' + fP(_estPR) : '-')
  const _ivPriceSub = isActive && impulseVal ? '$' + fP(impulseVal) : (_estIV > 0 ? '$' + fP(_estIV) : '-')
  return `<div class="dsl-pos-card ${cardCls}" style="${isActive ? 'box-shadow:0 0 12px #00ffcc18' : ''}${_isAT ? ';border-left:2px solid ' + _sb.color : ''}">
  <!-- ROW 1: Source badge + Control badge + symbol + DSL status + PnL -->
  <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
    <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
      <span style="font-size:12px;padding:2px 8px;border-radius:3px;background:${_sb.bg};border:1px solid ${_sb.border};color:${_sb.color};font-weight:700;letter-spacing:0.5px">${_sb.icon}${_sb.icon ? ' ' : ''}${_srcLabel}</span>
      ${_isAT ? `<span style="font-size:12px;padding:2px 8px;border-radius:3px;background:${_ctrlBg};border:1px solid ${_ctrlBorder};color:${_ctrlColor};font-weight:700;letter-spacing:0.5px">${_ctrlIcon}${_ctrlIcon ? ' ' : ''}${_ctrlLabel}</span>` : ''}
      <span style="color:${isActive ? '#00ffcc' : isLong ? '#00ff88' : '#ff4466'};font-weight:700;font-size:16px">${pos.side} ${symBase}</span>
      <span class="dsl-badge ${isActive ? 'active' : 'waiting'}">${isActive ? 'DSL ON' : 'WAITING'}</span>
      <button data-action="dslToggleMagnet" data-id="${pos.id}" style="font-size:11px;padding:2px 8px;border-radius:3px;cursor:pointer;font-family:inherit;letter-spacing:0.5px;border:1px solid ${_magnetOn ? '#00ccffaa' : '#ffffff22'};background:${_magnetOn ? '#00ccff18' : 'transparent'};color:${_magnetOn ? '#00ccff' : '#ffffff44'}">${_magnetOn ? 'MAG ON' : 'MAG'}</button>
      ${_isAT ? `<span style="font-size:11px;padding:2px 6px;border-radius:3px;background:${_as.color}15;color:${_as.color};border:1px solid ${_as.color}33">${_as.icon}${_as.icon ? ' ' : ''}${_as.label}</span>` : ''}
    </div>
    <div style="display:flex;align-items:center;gap:8px">
      ${isActive && pivotLeftPnlStr ? `<span style="font-size:14px;color:${pivotLeftPnl! >= 0 ? '#39ff14' : '#ff4466'}">PL:${pivotLeftPnlStr}</span>` : ''}
      <span style="color:${pnl >= 0 ? '#00ff88' : '#ff4466'};font-size:18px;font-weight:700">${pnlStr}</span>
    </div>
  </div>

  <!-- ROW 2: Entry / SL / TP / DSL Pivot / Loss@SL / Profit@TP / LIQ -->
  <div style="display:flex;justify-content:space-between;font-size:12px;color:#ffffff55;margin-bottom:4px;flex-wrap:wrap;gap:4px">
    <span>Entry: <b style="color:#ffffffaa">$${fP(pos.entry)}</b></span>
    ${pos.sl ? `<span>SL: <b style="color:#ff4466">$${fP(pos.sl)}</b></span>` : ''}
    ${pos.tp ? `<span>TP: <b style="color:#00ff88">$${fP(pos.tp)}</b></span>` : ''}
    ${isActive && pivotLeft ? `<span>DSL PL: <b style="color:#39ff14">$${fP(pivotLeft)}</b></span>` : ''}
    ${(() => { const _slRef = isActive && pivotLeft ? pivotLeft : pos.sl; if (!_slRef) return ''; const _lossAmt = Math.abs((isLong ? _slRef - pos.entry : pos.entry - _slRef) / pos.entry * pos.size * pos.lev); return '<span>Loss@SL: <b style="color:#ff4466">-$' + _lossAmt.toFixed(2) + '</b></span>' })()}
    ${pos.tp ? (() => { const _profAmt = Math.abs((isLong ? pos.tp - pos.entry : pos.entry - pos.tp) / pos.entry * pos.size * pos.lev); return '<span>Profit@TP: <b style="color:#00ff88">+$' + _profAmt.toFixed(2) + '</b></span>' })() : ''}
    <span>LIQ: <b style="color:#ff446688">${_liqStr}</b></span>
  </div>
  <div style="display:flex;font-size:11px;color:#ffffff33;margin-bottom:4px;flex-wrap:wrap;gap:6px">
    <span style="color:#00ffcc33">DSL: ${openDSLpct}% | PL:${pivotLeftPct}% | PR:${pivotRightPct}% | IV:${impulseValPct}%</span>
  </div>

  <!-- ROW 3: Progress bar -->
  <div style="font-size:12px;color:#00ffcc44;letter-spacing:1px;margin-bottom:3px">
    PROGRESS - ${progress.toFixed(1)}% | OPEN DSL: ${openDSLpct}% ${!isActive ? '(@$' + fP(_dslActivationPrice) + ')' : '(ACTIVATED)'}
  </div>
  <div class="dsl-prog-bar" data-dsl-drag="${pos.id}" data-dsl-editable="${(_showReleaseControl || _showPaperControls) && !isActive ? '1' : '0'}" style="height:7px;background:#0d1520;border-radius:4px;position:relative;margin-bottom:12px;cursor:${(_showReleaseControl || _showPaperControls) && !isActive ? 'ew-resize' : 'default'}">
    <div style="position:absolute;left:0;top:0;height:100%;width:${priceProgress}%;background:linear-gradient(90deg,#00ffcc22,${isActive ? '#00ffcc66' : '#00ff8866'});border-radius:3px;transition:width 0.3s ease"></div>
    <div style="position:absolute;left:${isActive ? priceProgress : yellowMarkerPct}%;top:0;height:100%;width:${100 - (isActive ? priceProgress : yellowMarkerPct)}%;background:repeating-linear-gradient(90deg,#ffffff06 0px,#ffffff06 4px,transparent 4px,transparent 8px);border-radius:0 3px 3px 0"></div>
    <div class="dsl-yellow-line" style="position:absolute;left:${isActive ? priceProgress : yellowMarkerPct}%;top:-5px;width:8px;height:15px;background:#f0c040;border-radius:3px;box-shadow:0 0 6px #f0c04088;transition:left 0.3s ease;transform:translateX(-50%);cursor:${(_showReleaseControl || _showPaperControls) && !isActive ? 'grab' : 'default'}"></div>
  </div>

  <!-- ROW 4: Visual SL/PR/IV bar -->
  <div style="position:relative;height:30px;background:#0a1018;border-radius:4px;margin-top:18px;margin-bottom:28px;overflow:visible">
    ${isActive && plPos !== null ? `<div style="position:absolute;left:${Math.min(plPos, curPos)}%;width:${Math.abs(curPos - plPos)}%;height:100%;background:#39ff1415;border-radius:2px"></div>` : ''}
    ${isActive && prPos !== null && ivPos !== null ? `<div style="position:absolute;left:${Math.min(prPos, ivPos)}%;width:${Math.abs(ivPos - prPos)}%;height:100%;background:#ff446610;border-radius:2px"></div>` : ''}
    ${isActive ?
      `<div style="position:absolute;left:${plPos}%;top:-1px;width:3px;height:calc(100%+2px);background:#39ff14;border-radius:2px;transform:translateX(-50%);box-shadow:0 0 8px #39ff14cc">
        <div style="position:absolute;bottom:-14px;left:50%;transform:translateX(-50%);font-size:11px;color:#39ff14;white-space:nowrap;letter-spacing:0.5px;font-weight:700">PL -${pivotLeftPct}%</div>
        <div style="position:absolute;bottom:-27px;left:50%;transform:translateX(-50%);font-size:11px;color:#39ff14bb;white-space:nowrap">$${fP(pivotLeft)}</div>
      </div>` :
      `<div style="position:absolute;left:${slPos}%;top:0;width:3px;height:100%;background:#ff4466;border-radius:2px;transform:translateX(-50%);box-shadow:0 0 6px #ff466699">
        <div style="position:absolute;bottom:-14px;left:50%;transform:translateX(-50%);font-size:13px;color:#ff4466;white-space:nowrap">SL</div>
        <div style="position:absolute;top:-14px;left:50%;transform:translateX(-50%);font-size:13px;color:#ff446699;white-space:nowrap">$${fP(currentSL)}</div>
      </div>`
    }
    <div style="position:absolute;left:${curPos}%;top:-2px;width:3px;height:calc(100%+4px);background:#f0c040;border-radius:2px;transform:translateX(-50%);box-shadow:0 0 8px #f0c040cc;transition:left 0.3s ease">
      <div style="position:absolute;top:-15px;left:50%;transform:translateX(-50%);font-size:11px;color:#f0c040;white-space:nowrap;font-weight:700">${isActive ? 'ODSL' : ''}</div>
      <div style="position:absolute;top:-27px;left:50%;transform:translateX(-50%);font-size:11px;color:#f0c04099;white-space:nowrap">$${fP(cur)}</div>
    </div>
    ${isActive && prPos !== null ? `<div style="position:absolute;left:${prPos}%;top:-1px;width:2px;height:calc(100%+2px);background:#39ff14;border-radius:1px;transform:translateX(-50%);box-shadow:0 0 8px #39ff14cc;transition:left 0.3s ease">
      <div style="position:absolute;top:-15px;left:50%;transform:translateX(-50%);font-size:13px;color:#39ff14;white-space:nowrap">PR +${pivotRightPct}%</div>
      <div style="position:absolute;bottom:-15px;left:50%;transform:translateX(-50%);font-size:13px;color:#39ff1499;white-space:nowrap">$${fP(pivotRight)}</div>
    </div>` : ''}
    ${isActive && ivPos !== null ? `<div style="position:absolute;left:${ivPos}%;top:-1px;width:2px;height:calc(100%+2px);background:#ff4466;border-radius:1px;transform:translateX(-50%);box-shadow:0 0 6px #ff4466aa">
      <div style="position:absolute;top:-15px;left:50%;transform:translateX(-50%);font-size:13px;color:#ff4466;white-space:nowrap;font-weight:700">IV +${impulseValPct}%</div>
      <div style="position:absolute;bottom:-15px;left:50%;transform:translateX(-50%);font-size:13px;color:#ff446699;white-space:nowrap">$${fP(impulseVal)}</div>
    </div>` : ''}
  </div>

  <!-- ROW 5: Price levels -->
  <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:4px;flex-wrap:wrap;gap:4px">
    ${isActive
      ? `<span style="color:#39ff14">PL: <b>$${fP(pivotLeft)}</b></span>
        <span style="color:#f0c040;font-weight:700">ODSL $${fP(cur)}</span>
        <span style="color:#39ff14">PR: $${fP(pivotRight)}</span>
        <span style="color:#ff4466bb">IV: $${fP(impulseVal)}</span>
        <span style="color:#00ff8855">TP: <b style="color:#00ff88">$${fP(pos.tp)}</b></span>`
      : `<span style="color:#ff4466aa">SL: <b style="color:#ff4466">$${fP(currentSL)}</b></span>
        <span style="color:#ffffff88">$${fP(cur)}</span>
        <span style="color:#00ff8855">TP: <b style="color:#00ff88">$${fP(pos.tp)}</b></span>`
    }
  </div>

  <!-- ROW 6: Mini history journal -->
  <div style="margin-top:3px;border-top:1px solid #00ffcc0a;padding-top:3px">
    ${_allHistory.length ? _allHistory.map((h: any) => `<div style="font-size:10px;color:#00ffcc33;font-style:italic;line-height:1.6;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${h.msg}</div>`).join('') : `<div style="font-size:10px;color:#00ffcc22;font-style:italic">Awaiting activation...</div>`}
    ${_magnetPreviewTxt && !_canMoveSL_render ? `<div style="font-size:10px;color:#00ccff44;font-style:italic;line-height:1.6;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${_magnetPreviewTxt}</div>` : ''}
  </div>

  <!-- ROW 7: Take Control / Let AI Control + manual DSL inputs -->
  ${_showTakeControl ? `<div style="margin-top:6px;text-align:right"><button data-action="dslTakeControl" data-id="${pos.id}" style="font-size:12px;padding:4px 12px;background:#f0c04012;border:1px solid #f0c04033;color:#f0c040;border-radius:4px;cursor:pointer;font-family:inherit;letter-spacing:0.5px">TAKE CONTROL</button></div>` : ''}
  ${_showReleaseControl ? `<div style="margin-top:6px;border-top:1px solid #f0c04022;padding-top:6px">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
      <span style="font-size:12px;color:#f0c040;letter-spacing:0.5px">MANUAL CONTROL ACTIVE</span>
      <button data-action="dslReleaseControl" data-id="${pos.id}" style="font-size:12px;padding:4px 12px;background:#00ff8812;border:1px solid #00ff8833;color:#00ff88;border-radius:4px;cursor:pointer;font-family:inherit;letter-spacing:0.5px">LET AI CONTROL</button>
    </div>
    <div style="display:flex;gap:8px;flex-wrap:wrap">
      <div style="display:flex;flex-direction:column;gap:1px">
        <label style="font-size:11px;color:#ffffff44;display:flex;align-items:center;gap:4px">DSL%<input type="number" value="${openDSLpct}" min="0.01" max="100" step="0.01" data-action="dslManualParam" data-id="${pos.id}" data-param="openDslPct" style="width:62px;background:#0d1520;border:1px solid #ffffff22;color:#fff;font-size:12px;padding:2px 4px;border-radius:3px;font-family:inherit"></label>
        <span class="dsl-price-sub" style="font-size:9px;color:#f0c04088;letter-spacing:0.3px">${isActive ? 'ACTIVATED' : _dslPriceSub}</span>
      </div>
      <div style="display:flex;flex-direction:column;gap:1px">
        <label style="font-size:11px;color:#ffffff44;display:flex;align-items:center;gap:4px">PL%<input type="number" value="${pivotLeftPct}" min="0.01" max="100" step="0.01" data-action="dslManualParam" data-id="${pos.id}" data-param="pivotLeftPct" style="width:62px;background:#0d1520;border:1px solid #ffffff22;color:#fff;font-size:12px;padding:2px 4px;border-radius:3px;font-family:inherit"></label>
        <span class="dsl-price-sub" style="font-size:9px;color:#39ff1488;letter-spacing:0.3px">${_plPriceSub}</span>
      </div>
      <div style="display:flex;flex-direction:column;gap:1px">
        <label style="font-size:11px;color:#ffffff44;display:flex;align-items:center;gap:4px">PR%<input type="number" value="${pivotRightPct}" min="0.01" max="100" step="0.01" data-action="dslManualParam" data-id="${pos.id}" data-param="pivotRightPct" style="width:62px;background:#0d1520;border:1px solid #ffffff22;color:#fff;font-size:12px;padding:2px 4px;border-radius:3px;font-family:inherit"></label>
        <span class="dsl-price-sub" style="font-size:9px;color:#aa44ff88;letter-spacing:0.3px">${_prPriceSub}</span>
      </div>
      <div style="display:flex;flex-direction:column;gap:1px">
        <label style="font-size:11px;color:#ffffff44;display:flex;align-items:center;gap:4px">IV%<input type="number" value="${impulseValPct}" min="0.01" max="100" step="0.01" data-action="dslManualParam" data-id="${pos.id}" data-param="impulseVPct" style="width:62px;background:#0d1520;border:1px solid #ffffff22;color:#fff;font-size:12px;padding:2px 4px;border-radius:3px;font-family:inherit"></label>
        <span class="dsl-price-sub" style="font-size:9px;color:#ff446688;letter-spacing:0.3px">${_ivPriceSub}</span>
      </div>
    </div>
  </div>` : ''}
  ${_showPaperControls ? `<div style="margin-top:6px;border-top:1px solid #ffffff11;padding-top:6px">
    <div style="font-size:11px;color:#ffffff33;letter-spacing:0.5px;margin-bottom:4px">DSL PARAMS</div>
    <div style="display:flex;gap:8px;flex-wrap:wrap">
      ${isActive ? `<div style="display:flex;flex-direction:column;gap:1px">
        <label style="font-size:11px;color:#ffffff22;display:flex;align-items:center;gap:4px">DSL%<input type="number" value="${openDSLpct}" disabled style="width:62px;background:#0a0e14;border:1px solid #ffffff11;color:#ffffff33;font-size:12px;padding:2px 4px;border-radius:3px;font-family:inherit;cursor:not-allowed"></label>
        <span class="dsl-price-sub" style="font-size:9px;color:#f0c04044;letter-spacing:0.3px">ACTIVATED</span>
      </div>` : `<div style="display:flex;flex-direction:column;gap:1px">
        <label style="font-size:11px;color:#ffffff44;display:flex;align-items:center;gap:4px">DSL%<input type="number" value="${openDSLpct}" min="0.01" max="100" step="0.01" data-action="dslManualParam" data-id="${pos.id}" data-param="openDslPct" style="width:62px;background:#0d1520;border:1px solid #ffffff22;color:#fff;font-size:12px;padding:2px 4px;border-radius:3px;font-family:inherit"></label>
        <span class="dsl-price-sub" style="font-size:9px;color:#f0c04088;letter-spacing:0.3px">${_dslPriceSub}</span>
      </div>`}
      <div style="display:flex;flex-direction:column;gap:1px">
        <label style="font-size:11px;color:#ffffff44;display:flex;align-items:center;gap:4px">PL%<input type="number" value="${pivotLeftPct}" min="0.01" max="100" step="0.01" data-action="dslManualParam" data-id="${pos.id}" data-param="pivotLeftPct" style="width:62px;background:#0d1520;border:1px solid #ffffff22;color:#fff;font-size:12px;padding:2px 4px;border-radius:3px;font-family:inherit"></label>
        <span class="dsl-price-sub" style="font-size:9px;color:#39ff1488;letter-spacing:0.3px">${_plPriceSub}</span>
      </div>
      <div style="display:flex;flex-direction:column;gap:1px">
        <label style="font-size:11px;color:#ffffff44;display:flex;align-items:center;gap:4px">PR%<input type="number" value="${pivotRightPct}" min="0.01" max="100" step="0.01" data-action="dslManualParam" data-id="${pos.id}" data-param="pivotRightPct" style="width:62px;background:#0d1520;border:1px solid #ffffff22;color:#fff;font-size:12px;padding:2px 4px;border-radius:3px;font-family:inherit"></label>
        <span class="dsl-price-sub" style="font-size:9px;color:#aa44ff88;letter-spacing:0.3px">${_prPriceSub}</span>
      </div>
      <div style="display:flex;flex-direction:column;gap:1px">
        <label style="font-size:11px;color:#ffffff44;display:flex;align-items:center;gap:4px">IV%<input type="number" value="${impulseValPct}" min="0.01" max="100" step="0.01" data-action="dslManualParam" data-id="${pos.id}" data-param="impulseVPct" style="width:62px;background:#0d1520;border:1px solid #ffffff22;color:#fff;font-size:12px;padding:2px 4px;border-radius:3px;font-family:inherit"></label>
        <span class="dsl-price-sub" style="font-size:9px;color:#ff446688;letter-spacing:0.3px">${_ivPriceSub}</span>
      </div>
    </div>
  </div>` : ''}
</div>`
}

// DSL intervals started via startDSLIntervals() called from startApp()
function _emitDSLChanged() { try { window.dispatchEvent(new CustomEvent('zeus:dslStateChanged')) } catch (_) {} }

export function stopDSLIntervals(): void {
  if (DSL.checkInterval) { w.Intervals.clear('dsl'); _pushDslCheckInterval(null) }
  if (DSL.visualInterval) { w.Intervals.clear('dslVis'); DSL.visualInterval = null }
  _emitDSLChanged()
}
export function startDSLIntervals(): void {
  if (DSL.checkInterval) return
  _emitDSLChanged()
  _pushDslCheckInterval(w.Intervals.set('dsl', runDSLBrain, 3000))
  DSL.visualInterval = w.Intervals.set('dslVis', () => {
    if (document.hidden) return
    const posns = [
      ...(getDemoPositions()),
      ...(getLivePositions())
    ].filter((p: any) => !p.closed)
    if (!posns.length || !DSL.enabled) return
    renderDSLWidget(posns)
  }, 3000)
  setTimeout(() => { initDSLBubbles(); runDSLBrain() }, 2000)
}


// ─── DSL Trim (cap logs/history) ────────────────────────────
export function _dslTrimLogs(posId: any): void {
  if (typeof DSL === 'undefined' || !DSL.positions?.[posId]) return
  const pos = DSL.positions[posId]
  if (Array.isArray(pos.log) && pos.log.length > 20) {
    pos.log = pos.log.slice(-20)
    _pushDslPosition(String(posId))
  }
}

export function _dslTrimAll(): void {
  if (typeof DSL === 'undefined' || !DSL.positions) return
  Object.keys(DSL.positions).forEach((id: string) => _dslTrimLogs(id))
  if (Array.isArray(DSL.history) && DSL.history.length > 50) {
    DSL.history = DSL.history.slice(-50)
  }
  const _allPos = [...getDemoPositions(), ...getLivePositions()]
  _allPos.forEach(function (p: any) {
    if (Array.isArray(p.dslHistory) && p.dslHistory.length > 30) {
      p.dslHistory = p.dslHistory.slice(-30)
    }
  })
  const _openIds = new Set(_allPos.filter(function (p: any) { return !p.closed }).map(function (p: any) { return String(p.id) }))
  Object.keys(DSL.positions).forEach(function (id: string) {
    if (!_openIds.has(id)) _removeDslPosition(id)
  })
}

// [DSL-OFF] Expose toggleDSL on window so other modules (e.g. autotrade) can call without circular import
;(window as any).toggleDSL = toggleDSL
