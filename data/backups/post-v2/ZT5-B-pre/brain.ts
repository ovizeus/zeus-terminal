// Zeus — engine/brain.ts
// Ported 1:1 from public/js/brain/brain.js (Phase 5B4)
// Brain state machine, neurons, update loop, cockpit
// [8C-2A1] w.AT/TC/DSL/TP reads migrated to stateAccessors
'use strict'

import { getATEnabled, getATMode, getATKillTriggered, getATLastTradeTs, getATClosedToday, getATDailyPnL, getTCMaxPos, getTCSL, getTCSize, getDSLEnabled, getDSLPositions, getDSLMode, getDemoPositions, getLivePositions, getJournal, getPrice, getKlines, getRSI, getSignalData, getFR, getVol24h, getMagnetBias } from '../services/stateAccessors'
import { fmtTime, fmtDate, fmtNow, toast } from '../data/marketDataHelpers'
import { fP } from '../utils/format'
import { el } from '../utils/dom'
import { _ZI } from '../constants/icons'
import { _neuroLastScan, _SESS_DEF, _SESS_PRIORITY, _regimeHistory, PROFILE_TF , DSL_PRESETS, _NEURO_SYMS, BM, BRAIN as BR } from '../core/config'
import { calcConfluenceScore } from './confluence'
import { getCurrentADX } from '../ui/render'
import { GATE_DEFS } from '../constants/trading'
import { _syncDslAssistUI } from '../trading/dsl'
import { RegimeEngine } from './regime'
import { atLog } from '../trading/autotrade'
import { _safePnl } from '../utils/guards'
import { detectRegimeEnhanced } from './regimeEnhanced'
import { useBrainStore } from '../stores/brainStore'
import { useBrainStatsStore, type BrainStatsTone } from '../stores/brainStatsStore'
import type { BrainMode, TradingProfile, BrainEngineState, BrainState, BrainAdaptParams } from '../types'

const w = window as any // kept for function calls, w.S writes + self-ref

// ── Phase 6 C6: Brain engine → brainStore write-inversion helpers ──
// Mirror-write pattern: each helper updates the backing object first
// (preserves legacy direct importers like trading/risk.ts, trading/orders.ts,
// data/klines.ts which `import { BM, BRAIN as BR } from '../core/config'`)
// and then publishes the canonical value to useBrainStore.
//
// Scope — only the canonical Brain surface enumerated in C5 mutators:
//   mode / profile / engineState / entry(ready+score) /
//   flow / mtf / sweep / gates / thoughts / adaptParams
// BM fields outside this set (structure, volRegime, liqCycle, macro,
// adaptive, performance, confMin, etc.) are NOT inverted here; they remain
// backing-only (runtime engine scratch, not exposed through the store).
function _pushBrainMode(mode: BrainMode): void {
  BM.mode = mode
  useBrainStore.getState().setMode(mode)
}
function _pushBrainProfile(profile: TradingProfile): void {
  BM.profile = profile
  useBrainStore.getState().setProfile(profile)
}
function _pushBrainEngineState(state: BrainEngineState): void {
  BR.state = state
  useBrainStore.getState().setEngineState(state)
}
function _pushBrainEntry(score: number, ready: boolean): void {
  BM.entryScore = score
  BM.entryReady = ready
  useBrainStore.getState().setEntry({ ready, score })
}
function _pushBrainFlow(flow: BrainState['flow']): void {
  BM.flow = flow
  useBrainStore.getState().setFlow(flow)
}
function _pushBrainSweep(sweep: BrainState['sweep']): void {
  BM.sweep = sweep
  useBrainStore.getState().setSweep(sweep)
}
function _pushBrainGates(gates: Record<string, unknown>): void {
  BM.gates = gates
  useBrainStore.getState().setGates(gates)
}
function _pushBrainThought(thought: { time: string; type: string; msg: string }): void {
  BR.thoughts.unshift(thought)
  if (BR.thoughts.length > 5) BR.thoughts.pop()
  useBrainStore.getState().setThoughts(BR.thoughts.slice())
}
function _pushBrainAdaptParams(params: BrainAdaptParams | null): void {
  BR.adaptParams = params
  useBrainStore.getState().setAdaptParams(params)
}

// Neuron updater
export function updateNeurons(): void {
  const rsiV = getRSI('5m')
  void (getRSI('1h'))
  const sigs = getSignalData().signals
  void (getSignalData().bullCount)
  void (getSignalData().bearCount)

  // RSI neuron
  if (rsiV !== null && rsiV !== undefined) {
    const rsiOk = rsiV > 55 || rsiV < 45
    const rsiDir = rsiV > 55 ? '▲' : rsiV < 45 ? '▼' : '—'
    setNeuron('rsi', rsiOk ? (rsiV > 55 ? 'ok' : 'fail') : 'wait', rsiDir + rsiV.toFixed(0))
  }

  // MACD neuron
  const hasMacd = sigs.some((s: any) => s.name.includes('MACD'))
  const macdDir = sigs.find((s: any) => s.name.includes('MACD'))
  setNeuron('macd', hasMacd ? (macdDir?.dir === 'bull' ? 'ok' : 'fail') : 'wait', hasMacd ? (macdDir?.dir === 'bull' ? '▲' : '▼') : '—')

  // SuperTrend neuron
  const hasST = sigs.some((s: any) => s.name.includes('Supertrend'))
  const stDir = sigs.find((s: any) => s.name.includes('Supertrend'))
  setNeuron('st', hasST ? (stDir?.dir === 'bull' ? 'ok' : 'fail') : 'wait', hasST ? (stDir?.dir === 'bull' ? 'BULL' : 'BEAR') : 'N/A')

  // Volume neuron
  const hasVol = sigs.some((s: any) => s.name.toLowerCase().includes('vol'))
  setNeuron('vol', hasVol ? 'ok' : 'wait', getVol24h() ? '↑' : '—')

  // Funding Rate neuron
  if (getFR() !== null) {
    const frBull = getFR()! < 0
    const frExtreme = Math.abs(getFR()!) * 10000 > 5
    setNeuron('fr', frExtreme ? (frBull ? 'ok' : 'fail') : 'wait',
      ((getFR() || 0) >= 0 ? '+' : '') + ((getFR() || 0) * 100).toFixed(3) + '%')
  }

  // Magnet neuron
  const mb = getMagnetBias()
  setNeuron('mag', mb === 'bull' ? 'ok' : mb === 'bear' ? 'fail' : 'wait',
    mb === 'bull' ? '↑BULL' : mb === 'bear' ? '↓BEAR' : 'NEUT')

  // Regime neuron
  const r = BR.regime
  setNeuron('reg', r === 'trend' ? 'ok' : r === 'volatile' ? 'fail' : 'wait',
    r === 'trend' ? 'TREND' : r === 'volatile' ? 'VOLAT' : r === 'range' ? 'RANGE' : '—')

  // OFI neuron
  const ofi = BR.ofi.blendBuy || 50
  setNeuron('ofi', ofi > 57 ? 'ok' : ofi < 43 ? 'fail' : 'wait',
    ofi.toFixed(0) + '%B')

  // ADX neuron — update with live value
  const liveADX = getCurrentADX()
  if (liveADX !== null) {
    setNeuron('adx', liveADX >= 25 ? 'ok' : liveADX >= 18 ? 'wait' : liveADX > 0 ? 'fail' : 'wait',
      'ADX ' + (liveADX || '—'))
  }

  // Activate neuron dots on SVG
  const dotColors: any = {
    0: getNeuronColor('rsi'), 1: getNeuronColor('macd'), 2: getNeuronColor('st'),
    3: getNeuronColor('vol'), 4: getNeuronColor('fr'), 5: getNeuronColor('mag')
  }
  Object.entries(dotColors).forEach(([i, col]: any) => {
    const dot = el('bdot' + i)
    const line = el('bline' + i)
    if (dot) { dot.setAttribute('fill', col + '33'); dot.setAttribute('stroke', col) }
    if (line) { line.setAttribute('stroke', col); line.setAttribute('opacity', '.6') }
  })
}

export function getNeuronColor(id: any): string {
  const n = BR.neurons[id]
  return n === 'ok' ? '#00ff88' : n === 'fail' ? '#ff4444' : n === 'wait' ? '#f0c040' : '#333'
}

export function setNeuron(id: any, state: any, val: any): void {
  BR.neurons[id] = state
  const el2 = el('bn-' + id)
  const valEl = el('bnv-' + id)
  if (el2) el2.className = 'neuron ' + state
  if (valEl) valEl.textContent = val
}


// Brain arc
export function updateBrainArc(score: any): void {
  const arc = el('brainScoreArc')
  const num = el('brainScoreNum')
  if (!arc) return

  const circumference = 2 * Math.PI * 38 // ~239
  const dashArray = (score / 100 * circumference).toFixed(1) + ' ' + circumference

  // Color based on score
  const col = score >= 70 ? '#00ff88' : score >= 55 ? '#f0c040' : score >= 40 ? '#ff8800' : '#ff4444'
  arc.style.strokeDasharray = dashArray
  arc.style.stroke = col

  if (num) {
    num.textContent = score > 0 ? score : '—'
    num.style.color = col
    num.style.textShadow = `0 0 20px ${col}88`
  }
}


// Brain state machine
export function updateBrainState(): void {
  // FIX: Calculeaza scorul direct, nu citeste din DOM (poate fi stale)
  calcConfluenceScore()
  const score = (typeof BM !== 'undefined' ? BM.confluenceScore : 0) || 0 // [FIX v85.1 F3] din memorie
  const bulls = getSignalData().bullCount
  const bears = getSignalData().bearCount
  const sigs = bulls + bears
  const hasAutoPos = (getDemoPositions()).some((p: any) => p.autoTrade && !p.closed) || (getLivePositions()).some((p: any) => p.autoTrade && !p.closed) // [FIX M2+LIVE]

  let state = 'scanning'
  let ticker = ''

  if (hasAutoPos) {
    state = 'trading'
    const pos = (getDemoPositions()).find((p: any) => p.autoTrade && !p.closed) || (getLivePositions()).find((p: any) => p.autoTrade && !p.closed)
    const pnl = pos ? ((pos.side === 'LONG' ? getPrice() - pos.entry : pos.entry - getPrice()) / pos.entry * pos.size * (pos.lev || 1)) : 0
    ticker = `POZITIE ACTIVA ${pos?.side} @$${fP(pos?.entry || 0)} | PnL: ${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)} | MONITORIZEZ TP/SL...`
  } else if (score >= 68 && sigs >= 3) {
    state = 'ready'
    const dir = bulls >= bears ? 'LONG' : 'SHORT'
    ticker = `SEMNAL ${dir} CONFIRMAT! Score:${score} | ${Math.max(bulls, bears)} semnale | REGIM:${BR.regime.toUpperCase()} | ${getATEnabled() ? 'TRIMIT ORDIN...' : 'AUTO TRADE OPRIT'}`
  } else if (score > 0 && sigs >= 1) {
    state = 'analyzing'
    const needing = 3 - sigs
    const confNeed = Math.max(0, 68 - score)
    ticker = `ANALIZEZ... Score:${score}/68 | ${sigs}/3 semnale | Mai trebuie: ${confNeed > 0 ? '+' + confNeed + ' confluenta' : ''}${needing > 0 ? ' +' + needing + ' semnale' : ''} | OFI:${(BR.ofi.blendBuy || 50).toFixed(0)}%B`
  } else if (getATKillTriggered()) {
    state = 'blocked'
    ticker = `KILL SWITCH ACTIVE — BLOCKED. Waiting for reset...`
  } else {
    state = 'scanning'
    ticker = `SCANEZ... RSI:${(getRSI('5m') || 0).toFixed(0)} | FR:${getFR() !== null ? ((getFR() || 0) * 100).toFixed(3) + '%' : '—'} | REGIM:${BR.regime.toUpperCase()} | MAGNET:${(getMagnetBias() || 'neut').toUpperCase()} | ${fmtNow(true)}`
  }

  // [PATCH BRAIN-AT-IDLE] No READY/decision state when AT is OFF
  if (!getATEnabled() && state === 'ready') {
    state = 'analyzing'
    ticker = `ANALIZEZ... Score:${score}/68 | ${sigs} semnale | AT OFF`
  }

  _pushBrainEngineState(state)
  updateBrainArc(score)

  // State badge
  const badge = el('brainStateBadge')
  if (badge) {
    const labels: any = { scanning: 'SCANNING', analyzing: 'ANALYZING', ready: _ZI.bolt + ' READY', blocked: _ZI.noent + ' BLOCKED', trading: _ZI.dRed + ' TRADING' }
    badge.innerHTML = labels[state] || state.toUpperCase()
    badge.className = 'brain-state-badge ' + state
  }

  // Ticker
  { const _oe = el('brainTickerText'); if (_oe) _oe.textContent = ticker }

  // Regime badge
  const regime = detectMarketRegime(getKlines())
  const regimeBadge = el('brainRegimeBadge')
  const regimeLabels: any = { trend: _ZI.tup + ' TREND', range: _ZI.chart + ' RANGE', volatile: _ZI.bolt + ' VOLATIL', unknown: _ZI.clock + ' LOADING' }
  if (regimeBadge) {
    regimeBadge.innerHTML = regimeLabels[regime] || regime
    regimeBadge.className = 'brain-regime ' + regime
  }

  // Update neurons
  updateNeurons()
  updateOrderFlow()
}

// ─── THOUGHT LOG ───────────────────────────────────────────────

// Thought log
export function brainThink(type: any, msg: any): void {
  const log = el('brainThoughtLog')
  if (!log) return
  const now = fmtNow(true)
  _pushBrainThought({ time: now, type, msg })
  log.innerHTML = BR.thoughts.map((t: any, i: number) =>
    `<div class="thought-line ${i === 0 ? t.type + ' fresh' : t.type}">
      <span style="color:#8a6ab0;flex-shrink:0">${t.time}</span>
      <span>${t.msg}</span>
    </div>`).join('')
}


// Brain main loop
export function runBrainUpdate(): void {
  if (!getPrice()) return
  // [FIX H6] Removed unconditional AT.enabled gate — brain must observe even when AT is off
  // Entry scoring and param adaptation are independently gated inside their own functions
  // [PATCH MODE-SWITCH] Skip brain cycle while mode switch modal is open
  if (w.__brainModeSwitching) return
  // [PATCH BRAIN-GUARD] Re-entry guard — prevents multi-fire from timer + WS overlap
  if (w.__brainCycleRunning) return
  w.__brainCycleRunning = true
  // Safety timeout — if try block crashes before finally, unlock after 10s
  const _brainSafetyTimer = setTimeout(() => { w.__brainCycleRunning = false }, 10000)
  try {
    updateBrainState()
    adaptAutoTradeParams()

    // Log thoughts when state changes
    const prevState = BR._prevState
    if (BR.state !== prevState) {
      const msgs: any = {
        scanning: _ZI.mag + ' Scanez piata... astept semnale',
        analyzing: _ZI.ruler + ' Semnal detectat — verific confluenta',
        ready: _ZI.ok + ' Toate conditiile OK — gata de intrare',
        blocked: _ZI.noent + ' Kill switch activ — suspendat',
        trading: _ZI.dRed + ' Pozitie activa — monitorizez TP/SL'
      }
      brainThink(BR.state === 'ready' ? 'ok' : BR.state === 'blocked' ? 'bad' : 'info',
        msgs[BR.state] || BR.state)
      BR._prevState = BR.state
    }
  } finally {
    clearTimeout(_brainSafetyTimer); w.__brainCycleRunning = false
    // Notify React brainStore — one event per complete brain cycle
    try { window.dispatchEvent(new CustomEvent('zeus:brainStateChanged')) } catch (_) {}
  }
}
// [runBrainUpdate loop managed in startApp — single instance]

// ===================================================================
// END ZEUS BRAIN
// ===================================================================

// ===================================================================
// GRAND UPDATE — Brain Modes, Gates, Entry Score, Risk Rails
// ===================================================================

// ── BRAIN MODE STATE ─────────────────────────────────────────────
// [MOVED TO TOP] BM

// ══════════════════════════════════════════════════════════════════
// SINGLE SOURCE OF TRUTH
// S.mode / S.profile / S.dsl.* are canonical.
// BM.* = read-only mirror. Engine reads S.* only.
// UI buttons → call setMode()/setProfile() only.
// AT.enabled is the sole command for brain scan + execution (no more S.runMode).
// ══════════════════════════════════════════════════════════════════
// Guard: S may not exist yet at import time (state.js loads later via bridge)
// These defaults are applied on first syncBrainFromState() call when S is ready
if (typeof w.S !== 'undefined' && w.S) {
  w.S.mode = (w.S.mode && w.S.mode !== 'manual') ? w.S.mode : 'assist'
  w.S.profile = w.S.profile || 'fast'
  // [B2] S.runMode REMOVED — AT.enabled is sole command
  w.S.tz = w.S.tz || 'Europe/Bucharest'
  if (!w.S.dsl) w.S.dsl = { active: false, state: 'OFF', pivotL: 1.2, pivotR: 1.4, impulseV: 70, openDsl: 50 }
  w.S.assistArmed = w.S.assistArmed || false
}   // ASSIST mode: must arm before DSL executes

// ── PROFILE → TF mapping (canonical) ─────────────────────────────
// [MOVED TO TOP] PROFILE_TF

// ── ARM_ASSIST ────────────────────────────────────────────────────
// [MOVED TO TOP] ARM_ASSIST

// Arm assist, sync functions  (no timeout — stays armed until user/mode-switch disarms)
export function armAssist(): void {
  w.ARM_ASSIST.armed = true; w.ARM_ASSIST.ts = Date.now()
  w.S.assistArmed = true
  brainThink('ok', _ZI.lock + ' ARM ASSIST activ')
  _syncDslAssistUI()
  if (typeof w._usScheduleSave === 'function') w._usScheduleSave()
}
export function disarmAssist(): void {
  w.ARM_ASSIST.armed = false; w.ARM_ASSIST.ts = 0
  w.S.assistArmed = false
  _syncDslAssistUI()
  if (typeof w._usScheduleSave === 'function') w._usScheduleSave()
}
export function isArmAssistValid(): boolean {
  return !!w.ARM_ASSIST.armed
}

// ── RADIO BUTTON HELPER ───────────────────────────────────────────
export function _setRadio(ids: any, activeId: any, baseClass: any, activeClass: any): void {
  // Force-clear ALL then set one — prevents "stuck" states even after rapid toggling
  ids.forEach((id: any) => {
    const b = el(id)
    if (!b) return
    // Strip all possible active variants first
    b.className = baseClass
    // Then apply exactly one
    if (id === activeId) b.className = baseClass + ' ' + activeClass
  })
}

// ── DSL SYNC FROM PROFILE ─────────────────────────────────────────
export function syncDslFromProfile(): void {
  const p = (w.S.profile || 'fast').toLowerCase()
  if (!w.S.dsl) w.S.dsl = {}
  if (p === 'fast') { w.S.dsl.pivotL = 0.8; w.S.dsl.pivotR = 1.0; w.S.dsl.impulseV = 85; w.S.dsl.openDsl = 40 }
  else if (p === 'swing') { w.S.dsl.pivotL = 1.2; w.S.dsl.pivotR = 1.4; w.S.dsl.impulseV = 70; w.S.dsl.openDsl = 50 }
  else { w.S.dsl.pivotL = 1.6; w.S.dsl.pivotR = 1.8; w.S.dsl.impulseV = 55; w.S.dsl.openDsl = 60 }
  _pushBrainProfile(p as TradingProfile) // keep mirror in sync
  // Update DSL UI inputs + labels if they exist
  const dslInputs: any = {
    dslPivotL: w.S.dsl.pivotL, dslPivotR: w.S.dsl.pivotR,
    dslImpulse: w.S.dsl.impulseV, dslOpen: w.S.dsl.openDsl
  }
  Object.entries(dslInputs).forEach(([id, v]: any) => { const e = el(id); if (e) e.value = v })
  // Visual hint: DSL params changed badge
  const dslProfileHint = el('zncDslContract')
  if (dslProfileHint && !w.S.dsl.active) {
    const p2 = (w.S.profile || 'fast').toLowerCase()
    const pLabel: any = ({ fast: 'FAST↑ trail agresiv', swing: 'SWING moderat', defensive: 'DEF↓ trail larg' } as Record<string, string>)[p2] || p2
    dslProfileHint.innerHTML = `DSL: <b>OFF</b> · Profile: <b>${pLabel}</b> · PL:${w.S.dsl.pivotL}% PR:${w.S.dsl.pivotR}%`
  }
}

// ── TF PROFILE SYNC (MTF badges + engine) ────────────────────────
export function syncTFProfile(): void {
  const p = (w.S.profile || 'fast').toLowerCase()
  const tfMap = PROFILE_TF[p] || PROFILE_TF.fast
  // Update trigger TF badge in cockpit
  const trig = el('mtfTrig')
  if (trig) trig.textContent = 'TRIG:' + tfMap.trigger + ' —'
  // Store in S for engine use
  w.S.triggerTF = tfMap.trigger
  w.S.contextTF = tfMap.context
  w.S.biasTF = tfMap.bias
  w.S.htfTF = tfMap.htf
  w.S.cooldownCloses = tfMap.cooldown
}

// ── SYNC BRAIN FROM STATE (master sync) ──────────────────────────
export function syncBrainFromState(): void {
  // Fallback: if old state had 'manual', convert to 'assist'
  if (w.S.mode === 'manual') w.S.mode = 'assist'
  const mode = (w.S.mode || 'assist').toLowerCase()
  const prof = (w.S.profile || 'fast').toLowerCase()

  // Mirror to BM (read-only; engine uses S.*)
  _pushBrainMode(mode as BrainMode)
  _pushBrainProfile(prof as TradingProfile)
  // [B2] BM.runMode removed — AT.enabled is sole command

  // Radio buttons — exact one active (no more manual)
  _setRadio(['bmode-assist', 'bmode-auto'], 'bmode-' + mode, 'znc-mbtn', 'act-' + mode)
  _setRadio(['prof-fast', 'prof-swing', 'prof-defensive'], 'prof-' + prof, 'znc-pbtn', 'act-' + prof)

  // DSL mode radio sync
  const dslMode = getDSLMode()
  if (dslMode) {
    _setRadio(['dsl-atr', 'dsl-fast', 'dsl-swing', 'dsl-defensive', 'dsl-tp'], 'dsl-' + dslMode, 'znc-dbtn', 'act-dsl-' + dslMode)
  }

  // [B2] RUN button removed — AT ON/OFF is the single command
  // Extra safety: ensure no leftover classes on mode/profile buttons
  document.querySelectorAll('.znc-mbtn').forEach((b: any) => {
    const id = b.id; if (id && id !== 'bmode-manual') b.className = 'znc-mbtn' + (id === 'bmode-' + w.S.mode ? ' act-' + w.S.mode : '')
  })
  document.querySelectorAll('.znc-pbtn').forEach((b: any) => {
    const id = b.id; if (id) b.className = 'znc-pbtn' + (id === 'prof-' + w.S.profile ? ' act-' + w.S.profile : '')
  })

  // Control source badge (no more manual)
  const src = el('znc-src')
  if (src) { const m: any = { assist: ['ASSIST', 'assist'], auto: ['AI', 'ai'] }; src.textContent = (m[mode] || m.assist)[0]; src.className = 'znc-src ' + (m[mode] || m.assist)[1] }

  // [R10] DSL zone opacity reset removed — React owns #dslZone, and there is no
  // codepath left that sets opacity < 1 (manual mode was removed), so the reset
  // was a no-op write on a React-owned node.

  // Sync TF + DSL params
  syncTFProfile()
  syncDslFromProfile()

  // ── DSL UI control — delegated to _syncDslAssistUI ──
  _syncDslAssistUI()
  // ── Trigger cockpit render (single render path) ──
  requestAnimationFrame(() => { if (typeof renderBrainCockpit === 'function') renderBrainCockpit() })
}

// ── PUBLIC MODE / PROFILE SETTERS (only these touch S.*) ─────────
// Pending mode switch state for confirmation modal
let _pendingModeSwitch: any = null

export function setMode(mode: any): void {
  mode = mode.toLowerCase()
  if (mode === 'manual') mode = 'assist' // legacy fallback
  if (mode !== 'assist' && mode !== 'auto') mode = 'assist'
  if (mode === w.S.mode) return // no change

  const openAT = [
    ...(getDemoPositions()).filter((p: any) => p.autoTrade && !p.closed),
    ...(getLivePositions()).filter((p: any) => !p.closed),
  ]
  const showDlg = (window as any)._showConfirmDialog
  if (typeof showDlg !== 'function') { _applyModeSwitch(mode); return }

  let msg: string
  if (mode === 'auto') {
    msg = 'Switch Brain mode to AUTO?\n\n' +
      'In AUTO mode, the Brain executes trades automatically when its conviction score passes the threshold. You will not be asked to confirm each trade.\n\n' +
      'This change applies only to FUTURE positions.'
  } else {
    msg = 'Switch Brain mode to ASSIST?\n\n' +
      'In ASSIST mode, the Brain opens positions automatically — same as AUTO — but you can TAKE DSL CONTROL on any open position to override its parameters manually (activation, pivots, impulse).\n\n' +
      'This change applies only to FUTURE positions.'
  }
  if (openAT.length > 0) {
    msg += '\n\n' + openAT.length + ' open position' + (openAT.length > 1 ? 's' : '') + ' will keep their current control mode.'
  }
  const confirmBtn = mode === 'auto' ? 'Activate AUTO' : 'Activate ASSIST'
  const title = mode === 'auto' ? 'Switch Brain Mode to AUTO?' : 'Switch Brain Mode to ASSIST?'
  // [PATCH MODE-SWITCH] Lock brain during async modal.
  w.__brainModeSwitching = true
  if (w.__brainModeSwitchTimer) clearTimeout(w.__brainModeSwitchTimer)
  w.__brainModeSwitchTimer = setTimeout(() => { w.__brainModeSwitching = false }, 30000)
  showDlg(title, msg, 'Cancel', confirmBtn, function () {
    _applyModeSwitch(mode)
    if (w.__brainModeSwitchTimer) clearTimeout(w.__brainModeSwitchTimer)
    w.__brainModeSwitching = false
  })
}

export function _applyModeSwitch(mode: any): void {
  const prev = w.S.mode
  w.S.mode = mode
  // Auto-arm / auto-disarm ASSIST on mode switch
  if (mode === 'assist') { armAssist() }
  else { disarmAssist() }
  if (typeof w.ZLOG !== 'undefined') w.ZLOG.push('INFO', '[BRAIN] mode=' + prev + '→' + mode, { prev: prev, next: mode })
  brainThink('info', _ZI.bolt + ` Mode → ${w.S.mode.toUpperCase()}`)
  syncBrainFromState()
  setTimeout(renderBrainCockpit, 30)
  w.dslUpdateBanner()
  w.atUpdateBanner(); w.ptUpdateBanner()
  // [BRAIN-MODE-PERSIST] Push to server so ASSIST/AUTO survives refresh.
  if (typeof w._usScheduleSave === 'function') w._usScheduleSave()
}

export function confirmBrainModeSwitch(): void {
  const modal = el('brainModeModal')
  if (modal) modal.style.display = 'none'
  if (_pendingModeSwitch) {
    _applyModeSwitch(_pendingModeSwitch)
    _pendingModeSwitch = null
  }
  // [PATCH MODE-SWITCH] Unlock brain after mode fully applied
  if (w.__brainModeSwitchTimer) clearTimeout(w.__brainModeSwitchTimer)
  w.__brainModeSwitching = false
}

export function cancelBrainModeSwitch(): void {
  const modal = el('brainModeModal')
  if (modal) modal.style.display = 'none'
  _pendingModeSwitch = null
  // [PATCH MODE-SWITCH] Unlock brain on cancel
  if (w.__brainModeSwitchTimer) clearTimeout(w.__brainModeSwitchTimer)
  w.__brainModeSwitching = false
  // Re-sync radio buttons to current mode
  syncBrainFromState()
}
// Keep legacy alias for onclick handlers
export function setBrainMode(mode: any): void { setMode(mode) }

function _applyProfileSwitch(profile: string): void {
  w.S.profile = profile.toLowerCase()
  brainThink('info', _ZI.chart + ` Profile → ${w.S.profile.toUpperCase()} | Trig:${PROFILE_TF[w.S.profile]?.trigger || '?'}`)
  syncBrainFromState()
  setTimeout(renderBrainCockpit, 30)
  if (typeof w._usScheduleSave === 'function') w._usScheduleSave() // persist profile
}

export function setProfile(profile: any): void {
  const p = (profile || '').toLowerCase()
  if (p !== 'fast' && p !== 'swing' && p !== 'defensive') return
  if (p === (w.S.profile || 'fast')) return
  const tf = PROFILE_TF[p] || PROFILE_TF.fast
  const cooldownMin = p === 'fast' ? 5 : p === 'swing' ? 30 : 60
  const readyThresh = p === 'fast' ? 65 : p === 'defensive' ? 80 : 75
  const blurbs: any = {
    fast: 'Fast profile reacts quickly to short-term moves. More trades, more noise.',
    swing: 'Swing profile waits for clearer setups. Fewer trades, larger moves.',
    defensive: 'Defensive profile prioritizes capital preservation. Only high-conviction setups.',
  }
  const label = p.toUpperCase()
  const msg =
    'Switch Brain profile to ' + label + '?\n\n' +
    'Trigger TF: ' + tf.trigger + '  \u00B7  Context: ' + tf.context + '  \u00B7  Bias: ' + tf.bias + '  \u00B7  HTF: ' + tf.htf + '\n' +
    'Cooldown: ' + tf.cooldown + ' closes (~' + cooldownMin + ' min)  \u00B7  Ready threshold: ' + readyThresh + '\n\n' +
    blurbs[p] + '\n\n' +
    'Applies to all future Brain/AT decisions. Open positions are not affected.'
  const showDlg = (window as any)._showConfirmDialog
  if (typeof showDlg !== 'function') { _applyProfileSwitch(p); return }
  showDlg('Switch Profile to ' + label + '?', msg, 'Cancel', 'Apply ' + label, function () {
    _applyProfileSwitch(p)
  })
}

// [B2] setRunMode / toggleRunMode REMOVED — AT.enabled is sole command

// ── DSL MODE SETTER ──────────────────────────────────────────────
function _applyDslMode(mode: string): void {
  const _dsl = (window as any).DSL; if (_dsl) _dsl.mode = mode
  const _dslKey = (window as any)._zeusUserId ? 'zeus_dsl_mode:' + (window as any)._zeusUserId : 'zeus_dsl_mode'
  try { localStorage.setItem(_dslKey, mode) } catch (_) { }
  const labels: any = { atr: _ZI.plug + ' ATR', fast: _ZI.bolt + ' FAST', swing: _ZI.wave + ' SWING', defensive: _ZI.sh + ' DEF', tp: _ZI.tgt + ' TP' }
  brainThink('info', _ZI.bolt + ' DSL Mode → ' + (labels[mode] || mode.toUpperCase()))
  _setRadio(['dsl-atr', 'dsl-fast', 'dsl-swing', 'dsl-defensive', 'dsl-tp'], 'dsl-' + mode, 'znc-dbtn', 'act-dsl-' + mode)
}

export function setDslMode(mode: any): void {
  const valid = ['atr', 'fast', 'swing', 'defensive', 'tp']
  mode = (mode || '').toLowerCase()
  if (!valid.includes(mode)) return
  const curMode = ((window as any).DSL && (window as any).DSL.mode) || getDSLMode() || 'atr'
  if (mode === curMode) return
  const preset = DSL_PRESETS[mode] || DSL_PRESETS.atr
  const label = mode.toUpperCase()
  const blurbs: any = {
    atr:       'ATR mode: activation distance is computed dynamically from current volatility. Adaptive to market conditions.',
    fast:      'FAST mode: tight trailing, SL locks into profit quickly. Best for scalping.',
    swing:     'SWING mode: wider trailing, tolerates normal retraces. Best for larger moves.',
    defensive: 'DEFENSIVE mode: wide trailing, trade needs a strong move before SL locks profit. Best for volatile markets.',
    tp:        'TP mode: activation distance scales to 30% of entry\u2192TP distance (falls back to ATR if TP is not set).',
  }
  const activationLine = mode === 'atr'
    ? 'Activation: dynamic (ATR-based)  \u00B7  typical \u2248 ' + preset.openDslPct.toFixed(2) + '%'
    : mode === 'tp'
      ? 'Activation: 30% of entry\u2192TP distance  \u00B7  fallback \u2248 ' + preset.openDslPct.toFixed(2) + '%'
      : 'Activation: ' + preset.openDslPct.toFixed(2) + '%'
  const msg =
    'Switch DSL mode to ' + label + '?\n\n' +
    activationLine + '\n' +
    'Pivot Left (SL trail): ' + preset.pivotLeftPct.toFixed(2) + '%\n' +
    'Pivot Right (impulse zone): ' + preset.pivotRightPct.toFixed(2) + '%\n' +
    'Impulse V (extension): ' + preset.impulseVPct.toFixed(2) + '% (delta from PR)\n\n' +
    blurbs[mode] + '\n\n' +
    'Applies to NEW Brain/AT positions only. Open positions keep their current DSL parameters. Manual positions continue to use the DSL Zone panel defaults.'
  const showDlg = (window as any)._showConfirmDialog
  if (typeof showDlg !== 'function') { _applyDslMode(mode); return }
  showDlg('Switch DSL Mode to ' + label + '?', msg, 'Cancel', 'Apply ' + label, function () {
    _applyDslMode(mode)
  })
}

// ── DSL TARGET PRICE CALCULATOR ──────────────────────────────────
// Returns full DSL param set { openDslPct, pivotLeftPct, pivotRightPct, impulseVPct, dslTargetPrice }
// based on active DSL.mode preset (DSL_PRESETS in config.ts, mirrors server serverDSL.js).
// Applied ONLY to Brain/AT positions at open time. Manual positions use TC globals.
export function calcDslTargetPrice(side: any, entry: any, tp: any): any {
  const mode = (getDSLMode() || 'atr').toLowerCase()
  const preset = DSL_PRESETS[mode] || DSL_PRESETS.atr
  let openPct = preset.openDslPct
  // Special handling for ATR: dynamic activation based on volatility.
  if (mode === 'atr') {
    openPct = _calcAtrPct(entry)
  }
  // Special handling for TP: activation scaled to 30% of entry→TP distance when TP set.
  if (mode === 'tp' && tp && tp !== 0) {
    openPct = 0.3 * Math.abs(tp - entry) / entry * 100
  }
  // Safety clamp activation: 0.1% – 10%.
  openPct = Math.max(0.1, Math.min(10, openPct))
  // Round to 2 decimals so stored/displayed values stay clean (float garbage
  // like 0.8999999999 from ATR/TP derivations would otherwise leak into the
  // UI and persist through serialize/pullMerge cycles).
  const _r2 = (n: number) => Math.round(n * 100) / 100
  const openPctR = _r2(openPct)
  const target = side === 'LONG'
    ? entry * (1 + openPctR / 100)
    : entry * (1 - openPctR / 100)
  return {
    openDslPct: openPctR,
    pivotLeftPct: _r2(preset.pivotLeftPct),
    pivotRightPct: _r2(preset.pivotRightPct),
    impulseVPct: _r2(preset.impulseVPct),
    dslTargetPrice: target,
  }
}

export function _calcAtrPct(entry: any): number {
  const atr = (typeof w.S !== 'undefined' && w.S.atr) ? w.S.atr : 0
  if (!atr || !entry) return 1.5 // safe fallback
  let pct = (2 * atr / entry) * 100
  return Math.max(0.3, Math.min(5, pct))
}

// ── TIMEZONE FIX ─────────────────────────────────────────────────
export function applyTimezone(tz: any): void {
  tz = tz || w.S.tz || 'Europe/Bucharest'
  w.S.tz = tz
  // Re-apply localization to all charts so crosshair + labels use new TZ
  const lf = { timeFormatter: (ts: any) => fmtTime(ts), dateFormatter: (ts: any) => fmtDate(ts) };
  [w.mainChart, w.cvdChart].forEach((ch: any) => { try { if (ch) ch.applyOptions({ localization: lf }) } catch (_) { } })
  const fmt = {
    timeFormatter: (ts: any) => new Date(ts * 1000).toLocaleTimeString('ro-RO', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false }),
    dateFormatter: (ts: any) => {
      const d = new Date(ts * 1000)
      const months = ['ian', 'feb', 'mar', 'apr', 'mai', 'iun', 'iul', 'aug', 'sep', 'oct', 'nov', 'dec']
      const day = d.toLocaleDateString('en-US', { timeZone: tz, day: 'numeric' })
      const month = parseInt(d.toLocaleDateString('en-US', { timeZone: tz, month: 'numeric' })) - 1
      const year = d.toLocaleDateString('en-US', { timeZone: tz, year: '2-digit' })
      return day + ' ' + months[month] + '. \'' + year
    }
  };
  [w.mainChart, w.cvdChart].forEach((c: any) => {
    if (c) try { c.applyOptions({ timeScale: { localization: fmt } }) } catch (_) { }
  })
}

// ── REGIME DETECTOR (ENHANCED) ────────────────────────────────────

// Enhanced regime detection — extracted to regimeEnhanced.ts to break brain↔regime circular dep
export { detectRegimeEnhanced } from './regimeEnhanced'

// ── MTF ALIGNMENT ─────────────────────────────────────────────────
export function updateMTFAlignment(): void {
  const tfs = ['15m', '1h', '4h']
  tfs.forEach(tf => {
    const rsi = getRSI(tf) || 50
    const dir = rsi > 55 ? 'bull' : rsi < 45 ? 'bear' : 'neut'
    BM.mtf[tf] = dir
    const badge = el('mtf' + tf)
    if (badge) {
      badge.textContent = tf + ' ' + (dir === 'bull' ? '▲' : dir === 'bear' ? '▼' : '—')
      badge.className = 'mtf-badge ' + dir
    }
  })
}

// ── SWEEP / DISPLACEMENT DETECTOR ─────────────────────────────────
export function detectSweepDisplacement(klines: any): any {
  if (!klines || klines.length < 20) return { type: 'none', reclaim: false, displacement: false }
  const last = klines.slice(-20)
  const cur = last[last.length - 1]
  const prev20High = Math.max(...last.slice(0, -1).map((k: any) => k.high))
  const prev20Low = Math.min(...last.slice(0, -1).map((k: any) => k.low))
  const atr = last.slice(-5).reduce((a: number, k: any) => a + (k.high - k.low), 0) / 5

  let sweep: any = { type: 'none', reclaim: false, displacement: false, liqDist: 0 }

  // Sweep above: wick above prev high then came back
  if (cur.high > prev20High && cur.close < prev20High) {
    sweep.type = 'above'
    sweep.reclaim = cur.close < prev20High
    sweep.displacement = (prev20High - cur.close) > atr * 0.5
    sweep.liqDist = ((cur.high - cur.close) / cur.close * 100).toFixed(2)
  }
  // Sweep below: wick below prev low then came back
  else if (cur.low < prev20Low && cur.close > prev20Low) {
    sweep.type = 'below'
    sweep.reclaim = cur.close > prev20Low
    sweep.displacement = (cur.close - prev20Low) > atr * 0.5
    sweep.liqDist = ((cur.close - cur.low) / cur.close * 100).toFixed(2)
  }

  _pushBrainSweep(sweep)
  return sweep
}

// ── FLOW ENGINE ───────────────────────────────────────────────────
export function updateFlowEngine(klines: any): void {
  if (!klines || klines.length < 10) return
  const last = klines.slice(-10)

  // CVD: cumulative delta approximation
  let cvd = 0
  last.forEach((k: any) => {
    const buyVol = k.close > k.open ? k.volume * 0.6 : k.volume * 0.4
    const sellVol = k.volume - buyVol
    cvd += buyVol - sellVol
  })
  const cvdDir = cvd > 0 ? 'rising' : 'falling'
  const deltaLast = last[last.length - 1]
  const delta = deltaLast.close > deltaLast.open
    ? (deltaLast.volume * 0.2).toFixed(0)
    : (-deltaLast.volume * 0.2).toFixed(0)

  const ofi = BR.ofi?.blendBuy || 50
  const ofiDir = ofi > 57 ? 'buy' : ofi < 43 ? 'sell' : 'neut'

  _pushBrainFlow({ cvd: cvdDir, delta: parseFloat(delta), ofi: ofiDir })

  // Update UI
  const cvdEl = el('flowCVD'); if (cvdEl) { cvdEl.textContent = cvdDir.toUpperCase(); cvdEl.className = 'flow-cell-val ' + (cvdDir === 'rising' ? 'ok' : 'fail') }
  const deltaEl = el('flowDelta'); if (deltaEl) { deltaEl.textContent = (parseFloat(delta) >= 0 ? '+' : '') + delta; deltaEl.className = 'flow-cell-val ' + (parseFloat(delta) >= 0 ? 'ok' : 'fail') }
  const ofiEl = el('flowOFI'); if (ofiEl) { ofiEl.textContent = ofiDir.toUpperCase(); ofiEl.className = 'flow-cell-val ' + (ofiDir === 'buy' ? 'ok' : ofiDir === 'sell' ? 'fail' : 'neut') }

  // Sweep UI
  const sw = BM.sweep
  const swEl = el('flowSweep'); if (swEl) { swEl.textContent = sw.type === 'none' ? 'NONE' : sw.type.toUpperCase(); swEl.className = 'flow-cell-val ' + (sw.type !== 'none' ? 'ok' : 'neut') }
  const rclEl = el('flowReclaim'); if (rclEl) { rclEl.textContent = sw.reclaim ? 'OK' : '—'; rclEl.className = 'flow-cell-val ' + (sw.reclaim ? 'ok' : 'neut') }
  const dispEl = el('flowDisplacement'); if (dispEl) { dispEl.textContent = sw.displacement ? 'OK' : '—'; dispEl.className = 'flow-cell-val ' + (sw.displacement ? 'ok' : 'neut') }
}

// ── ENTRY GATES ENGINE ────────────────────────────────────────────

// Gates computation
export function computeGates(dir: any): any {
  const regime = BR.regime || 'unknown'
  const ofi = BR.ofi?.blendBuy || 50
  void (getRSI('5m') || 50)
  void (getRSI('1h') || 50)
  void (getRSI('4h') || 50)

  void (getFR() || 0)
  const oi = w.S.oi || 0
  const oiPrev = w.S.oiPrev || oi
  void (getVol24h() || 0)
  const isLong = dir === 'long'
  const sw = BM.sweep
  const profile = BM.profile
  void (detectRegimeEnhanced(getKlines()))

  // Current session
  const h = new Date().getUTCHours()
  const sessionOk = (h >= 7 && h < 11) || (h >= 13 && h < 17) || (h >= 19 && h < 23) // London/NY/Asia overlap

  // Cooldown
  const lastTradeTs = getATLastTradeTs() || 0
  const cooldownMs = profile === 'fast' ? 5 * 60 * 1000 : profile === 'swing' ? 30 * 60 * 1000 : 60 * 60 * 1000
  const cooldownOff = (Date.now() - lastTradeTs) > cooldownMs

  // Volume
  const klines = getKlines()
  let volConfirm = false
  if (klines.length >= 20) {
    const recent = klines.slice(-5).reduce((a: number, k: any) => a + k.volume, 0) / 5
    const baseline = klines.slice(-20, -5).reduce((a: number, k: any) => a + k.volume, 0) / 15
    volConfirm = recent > baseline * 1.1
  }

  // OI
  const oiChange = oiPrev > 0 ? Math.abs(oi - oiPrev) / oiPrev * 100 : 0
  const oiConfirm = oiChange > 0.05

  // Risk limits
  const maxDay = parseInt(el('atMaxDay')?.value || '') || 5
  const maxConc = getTCMaxPos()
  const lossLim = parseInt(el('atLossStreak')?.value || '') || 3
  // [RISK RAILS FIX] Count positions per AT.mode (not always demo)
  const _rrPosList = getATMode() === 'live' ? (getLivePositions()) : (getDemoPositions())
  const concurrent = _rrPosList.filter((p: any) => p.autoTrade && !p.closed).length
  // [RISK RAILS] DD removed from client gate — server kill switch is sole authority
  const riskOk = !BM.protectMode &&
    BM.dailyTrades < maxDay &&
    concurrent < maxConc &&
    BM.lossStreak < lossLim

  const gates: any = {
    regime: regime === 'trend' || regime === 'breakout' ? 'ok' : regime === 'range' ? 'wait' : 'fail',
    mtf: (BM.mtf['1h'] === dir && BM.mtf['4h'] !== (isLong ? 'bear' : 'bull')) ? 'ok' : BM.mtf['1h'] === 'neut' ? 'wait' : 'fail',
    volume: volConfirm ? 'ok' : 'wait',
    oi: oiConfirm ? 'ok' : 'wait',
    orderflow: isLong ? (ofi > 57 ? 'ok' : ofi < 43 ? 'fail' : 'wait') : (ofi < 43 ? 'ok' : ofi > 57 ? 'fail' : 'wait'),
    sweep: sw.type !== 'none' && (isLong ? sw.type === 'below' : sw.type === 'above') ? 'ok' : sw.type !== 'none' ? 'fail' : 'wait',
    displacement: sw.displacement ? 'ok' : 'wait',
    session: sessionOk ? 'ok' : 'wait',
    spread: 'ok', // assume ok without real data
    cooldown: cooldownOff ? 'ok' : 'fail',
    risk: riskOk ? 'ok' : 'fail',
    news: BM.newsRisk === 'low' ? 'ok' : BM.newsRisk === 'med' ? 'wait' : 'fail'
  }

  _pushBrainGates(gates)
  return gates
}

export function renderGates(gates: any): void {
  const grid = el('gatesGrid'); if (!grid) return
  const okCount = Object.values(gates).filter((v: any) => v === 'ok').length
  const okEl = el('gatesOkCount'); if (okEl) okEl.textContent = okCount + '/' + GATE_DEFS.length + ' OK'

  // Animate synapse dots on brain SVG for gate status
  const dotIds = ['bdot0', 'bdot1', 'bdot2', 'bdot3', 'bdot4', 'bdot5', 'bdot6', 'bdot7']
  const lineIds = ['bline0', 'bline1', 'bline2', 'bline3', 'bline4', 'bline5']
  const gateVals = Object.values(gates)
  dotIds.forEach((id, i) => {
    const dot = el(id); if (!dot) return
    const st: any = gateVals[i] || 'wait'
    const c = st === 'ok' ? '#39ff14' : st === 'fail' ? '#ff3355' : '#f0c040'
    dot.setAttribute('fill', c + '33')
    dot.setAttribute('stroke', c)
  })
  lineIds.forEach((id, i) => {
    const line = el(id); if (!line) return
    const st: any = gateVals[i] || 'wait'
    const c = st === 'ok' ? '#39ff14' : st === 'fail' ? '#ff3355' : '#f0c040'
    line.setAttribute('stroke', c)
    line.setAttribute('opacity', st === 'ok' ? '0.8' : '0.3')
  })

  grid.innerHTML = GATE_DEFS.map((g: any) => {
    const st = gates[g.id] || 'wait'
    return `<div class="gate-row">
      <div class="gate-led ${st}"></div>
      <span class="gate-lbl ${st}">${g.label}${g.required ? '' : ' ◦'}</span>
    </div>`
  }).join('')
}

// ── ENTRY SCORE ENGINE ────────────────────────────────────────────
export function computeEntryScore(gates: any, dir: any): any {
  const profile = BM.profile
  const readyThreshold = profile === 'fast' ? 65 : profile === 'defensive' ? 80 : 75

  // Base score from gates
  let score = 0
  const reasons: any[] = []
  const weights: any = {
    regime: 15, mtf: 15, volume: 10, oi: 8,
    orderflow: 12, sweep: 10, displacement: 8,
    session: 8, spread: 4, cooldown: 5, risk: 10, news: 5
  }

  GATE_DEFS.forEach((g: any) => {
    const st = gates[g.id]
    const wt = weights[g.id] || 5
    if (st === 'ok') { score += wt; reasons.push({ pos: true, txt: '+ ' + g.label }) }
    else if (st === 'fail') { score -= wt * 0.5; reasons.push({ pos: false, txt: '- ' + g.label }) }
  })

  // Bonuses
  if (BM.sweep.reclaim && BM.sweep.displacement) { score += 10; reasons.push({ pos: true, txt: '+ Sweep+Reclaim+Disp' }) }
  // RUN is now a scan gate (not a score bonus) — removed legacy +8 bonus
  const rsi5m = getRSI('5m') || 50
  if (dir === 'long' && rsi5m > 55 && rsi5m < 70) { score += 5; reasons.push({ pos: true, txt: '+ RSI bullish zone' }) }
  if (dir === 'short' && rsi5m < 45 && rsi5m > 30) { score += 5; reasons.push({ pos: true, txt: '+ RSI bearish zone' }) }

  score = Math.round(Math.max(0, Math.min(100, score)))

  const label = score >= readyThreshold ? 'READY' : score >= 60 ? 'WAIT' : 'BLOCK'
  const col = score >= readyThreshold ? '#39ff14' : score >= 60 ? '#f0c040' : '#ff3355'

  _pushBrainEntry(score, score >= readyThreshold)
  // [L1-SHIELD-DIAG] Capture failed gate labels for SHIELD diagnostic surfacing
  // (underscore-prefixed runtime-only escape hatch — not canonical, stays on backing)
  ;(BM as any)._entryFailedGates = GATE_DEFS
    .filter((g: any) => gates[g.id] === 'fail')
    .map((g: any) => g.id)

  // Update UI
  const numEl = el('entryScoreNum')
  const fillEl = el('entryScoreFill')
  const lblEl = el('entryScoreLabel')
  const reasonsEl = el('entryScoreReasons')
  if (numEl) { numEl.textContent = String(score); numEl.style.color = col }
  if (fillEl) { fillEl.style.width = score + '%'; fillEl.style.background = col }
  if (lblEl) { lblEl.textContent = label; lblEl.style.color = col }
  if (reasonsEl) {
    const top3 = reasons.slice(0, 4)
    reasonsEl.innerHTML = top3.map((r: any) => `<div class="score-reason ${r.pos ? 'pos' : 'neg'}">${r.txt}</div>`).join('')
  }

  return { score, label, col, readyThreshold }
}

// ── MARKET ATMOSPHERE AGGREGATOR ──────────────────────────────────
// Reads ONLY existing state. Produces BM.atmosphere for pre-filter.
// Priority: trap_risk > toxic_volatility > range > clean_trend > neutral
export function computeMarketAtmosphere(): void {
  try {
    const re = BM.regimeEngine || {}
    const pf = BM.phaseFilter || {}
    const sw = BM.sweep || {}
    const fakeBlocked = (typeof w._fakeout !== 'undefined') ? !!w._fakeout.invalid : false
    const ofTrap = (typeof w.OF !== 'undefined' && w.OF.trap) ? !!w.OF.trap.active : false
    const ofCascade = (typeof w.OF !== 'undefined' && w.OF.cascade) ? (w.OF.cascade.state === 'fired') : false
    const trapRisk = re.trapRisk || 0
    const volState = re.volatilityState || 'normal'

    const regime = (re.regime || 'RANGE').toUpperCase()
    const phase = (pf.phase || 'RANGE').toUpperCase()
    const reConf = re.confidence || 0
    const brainRegime = (typeof BR !== 'undefined' && BR.regime) ? BR.regime : 'unknown'
    const atrPct = (typeof BR !== 'undefined') ? (BR.regimeAtrPct || 0) : 0
    const volRegime = (typeof BM !== 'undefined') ? (BM.volRegime || 'MED') : 'MED'
    const sweepNoDisp = sw.type !== 'none' && !sw.displacement

    const reasons: string[] = []
    let category = 'neutral'
    let allowEntry = true
    let cautionLevel = 'low'
    let confidence = 50
    let sizeMult = pf.sizeMultiplier || 1.0

    // ── 1. TRAP RISK (highest priority) ─────────────
    if (ofTrap || ofCascade || trapRisk >= 60 || (fakeBlocked && sweepNoDisp)) {
      category = 'trap_risk'
      allowEntry = false
      cautionLevel = 'high'
      confidence = Math.min(95, 50 + trapRisk)
      sizeMult = 0
      if (ofTrap) reasons.push('OF trap active')
      if (ofCascade) reasons.push('OF cascade fired')
      if (trapRisk >= 60) reasons.push('trapRisk ' + trapRisk + '%')
      if (fakeBlocked) reasons.push('fakeout blocked')
      if (sweepNoDisp) reasons.push('sweep without displacement')
    }
    // ── 2. TOXIC VOLATILITY ──────────────────────────
    else if (volState === 'extreme' || regime === 'CHAOS' || regime === 'LIQUIDATION_EVENT' || atrPct > 2.5 || volRegime === 'EXTREME') {
      category = 'toxic_volatility'
      allowEntry = false
      cautionLevel = 'high'
      confidence = Math.min(95, 40 + Math.round(atrPct * 20))
      sizeMult = 0
      if (volState === 'extreme') reasons.push('volatility extreme')
      if (regime === 'CHAOS') reasons.push('regime CHAOS')
      if (regime === 'LIQUIDATION_EVENT') reasons.push('liquidation event')
      if (atrPct > 2.5) reasons.push('ATR ' + atrPct.toFixed(2) + '% > 2.5')
      if (volRegime === 'EXTREME') reasons.push('volRegime EXTREME')
    }
    // ── 3. RANGE ─────────────────────────────────────
    else if (phase === 'RANGE' || phase === 'SQUEEZE' || brainRegime === 'range' || brainRegime === 'squeeze') {
      category = 'range'
      allowEntry = true // allowed but conservative
      cautionLevel = 'medium'
      confidence = Math.max(20, reConf)
      sizeMult = Math.min(sizeMult, 0.7)
      if (phase === 'RANGE') reasons.push('phase RANGE')
      if (phase === 'SQUEEZE') reasons.push('phase SQUEEZE')
      if (brainRegime === 'range') reasons.push('regime range')
      if (brainRegime === 'squeeze') reasons.push('regime squeeze')
    }
    // ── 4. CLEAN TREND ───────────────────────────────
    else if (phase === 'TREND' || phase === 'EXPANSION' || brainRegime === 'trend' || brainRegime === 'breakout') {
      category = 'clean_trend'
      allowEntry = true
      cautionLevel = 'low'
      confidence = Math.max(60, reConf)
      sizeMult = Math.max(sizeMult, 1.0)
      if (phase === 'TREND') reasons.push('phase TREND')
      if (phase === 'EXPANSION') reasons.push('phase EXPANSION')
      if (brainRegime === 'trend') reasons.push('regime trend')
      if (brainRegime === 'breakout') reasons.push('regime breakout')
    }
    // ── 5. NEUTRAL (fallback) ────────────────────────
    else {
      category = 'neutral'
      allowEntry = true
      cautionLevel = 'medium'
      confidence = Math.max(30, reConf)
      sizeMult = Math.min(sizeMult, 0.8)
      reasons.push('no clear regime classification')
    }

    // Additional caution bumps (cross-checks)
    if (category !== 'trap_risk' && category !== 'toxic_volatility') {
      if (trapRisk >= 30) { cautionLevel = 'high'; reasons.push('elevated trapRisk ' + trapRisk + '%') }
      if (volRegime === 'HIGH') { if (cautionLevel === 'low') cautionLevel = 'medium'; reasons.push('volRegime HIGH') }
      if (fakeBlocked) { reasons.push('fakeout flagged') }
    }

    if (reasons.length === 0) reasons.push('data insufficient')

    BM.atmosphere = {
      category: category,
      allowEntry: allowEntry,
      cautionLevel: cautionLevel,
      confidence: Math.round(Math.min(100, Math.max(0, confidence))),
      reasons: reasons,
      sizeMultiplier: Math.round(Math.max(0, Math.min(1.5, sizeMult)) * 100) / 100
    }
  } catch (e: any) {
    console.warn('[Atmosphere] error:', e.message)
    BM.atmosphere = { category: 'neutral', allowEntry: true, cautionLevel: 'medium', confidence: 0, reasons: ['error: ' + (e.message || 'unknown')], sizeMultiplier: 1.0 }
  }
}

// ── CHAOS / RISK BAR ─────────────────────────────────────────────

// Chaos bar, news shield, protect mode
export function updateChaosBar(): void {
  const atrPct = BR.regimeAtrPct || 0
  const newsW = BM.newsRisk === 'high' ? 40 : BM.newsRisk === 'med' ? 20 : 0
  const spreadW = 0 // no real spread data
  const chaos = Math.min(100, Math.round(atrPct * 15 + newsW + spreadW))

  const fill = el('chaosBarFill')
  const val = el('chaosVal')
  const col = chaos < 33 ? '#39ff14' : chaos < 66 ? '#f0c040' : '#ff3355'
  if (fill) { fill.style.width = chaos + '%'; fill.style.background = col }
  if (val) { val.textContent = chaos + '%'; val.style.color = col }
}

// ── NEWS SHIELD ───────────────────────────────────────────────────
// [MOVED TO TOP] NEWS

export function updateNewsShield(): void {
  // Simulated news risk based on time + volatility + macro calendar
  const atrPct = BR.regimeAtrPct || 0
  const now = Date.now()

  // Check macro events countdown
  let macroMsg = ''
  BM.macroEvents.forEach((ev: any) => {
    const diff = ev.time - now
    if (diff > 0 && diff < 30 * 60 * 1000) {
      macroMsg = `${ev.name} in ${Math.ceil(diff / 60000)}m`
      BM.newsRisk = 'high'
    }
  })

  // Simulated: high volatility → raise news risk
  if (atrPct > 2.0) BM.newsRisk = 'high'
  else if (atrPct > 1.2) BM.newsRisk = 'med'
  else BM.newsRisk = BM.newsRisk === 'high' ? 'med' : 'low' // slow decay

  const badge = el('newsRiskBadge')
  const headline = el('newsHeadline')
  const macroCd = el('macroCd')

  if (badge) { badge.textContent = BM.newsRisk.toUpperCase(); badge.className = 'news-risk-badge ' + BM.newsRisk }
  if (headline) headline.textContent = macroMsg || (BM.newsRisk === 'high' ? 'High volatility detected — caution' : 'No significant news detected')
  if (macroCd) macroCd.textContent = macroMsg
}

// ── PROTECT MODE ─────────────────────────────────────────────────
// PROTECT = only: execution risk, news HIGH, REAL risk limit breach
// NOT: session off, regime unstable (those are BLOCK/WAIT only)
export function checkProtectMode(): void {
  const lossLim = parseInt(el('atLossStreak')?.value || '') || 3
  const maxDay = parseInt(el('atMaxDay')?.value || '') || 5
  const _closedToday = +(getATClosedToday()) || 0

  let reason: any = null
  // Loss streak — only if we actually have closed trades
  if (_closedToday > 0 && BM.lossStreak >= lossLim)
    reason = `PROTECT: ${lossLim} CONSECUTIVE LOSSES (${_closedToday} trades)`
  // Max daily trades
  if (BM.dailyTrades >= maxDay)
    reason = `PROTECT: MAX TRADES/DAY (${BM.dailyTrades}/${maxDay})`
  // [RISK RAILS] Daily DD condition REMOVED — server kill switch is sole authority
  // News HIGH — block not protect (keep compatible but only in auto)
  if (BM.newsRisk === 'high' && (w.S.mode || 'assist') === 'auto')
    reason = `PROTECT: NEWS HIGH — volatilitate extremă`
  // Kill switch — only if already triggered legitimately
  if (getATKillTriggered()) reason = 'BLOCKED: KILL SWITCH'

  if (reason && !BM.protectMode) {
    BM.protectMode = true
    BM.protectReason = reason
    if (typeof w.ZLOG !== 'undefined') w.ZLOG.push('WARN', '[BRAIN PROTECT] ON ' + reason)
    if (getATEnabled() && (w.S.mode || 'assist') === 'auto') { if (typeof w.AT !== 'undefined') w.AT.enabled = false }
    brainThink('bad', reason)
    toast(reason)
  }

  const banner = el('protectBanner')
  const bannerTxt = el('protectBannerTxt')
  if (banner) banner.className = 'protect-banner' + (BM.protectMode ? ' show' : '')
  if (bannerTxt && BM.protectMode) bannerTxt.textContent = BM.protectReason
}

export function resetProtectMode(): void {
  BM.protectMode = false
  BM.protectReason = ''
  if (typeof w.ZLOG !== 'undefined') w.ZLOG.push('INFO', '[BRAIN PROTECT] OFF')
  BM.lossStreak = 0
  const banner = el('protectBanner')
  if (banner) banner.className = 'protect-banner'
  brainThink('ok', _ZI.ok + ' Protect mode resetat manual')
  toast('Protect mode resetat', 0, _ZI.ok)
}

// ── DSL TELEMETRY UPDATE ──────────────────────────────────────────

// DSL telemetry
export function updateDSLTelemetry(): void {
  const tele = el('dslTelemetry'); if (!tele) return
  const posns = (getDemoPositions()).filter((p: any) => p.autoTrade && !p.closed)

  if (!posns.length || !getDSLEnabled()) {
    tele.innerHTML = `<div class="dsl-tele-title">DSL TELEMETRY — BRAIN READ</div><div style="font-size:11px;color:#00ffcc22">No active DSL positions</div>`
    return
  }

  const pivotLeftPct = parseFloat(el('dslTrailPct')?.value || '') || 0.8
  const pivotRightPct = parseFloat(el('dslTrailSusPct')?.value || '') || 1.0
  const impulseValPct = parseFloat(el('dslExtendPct')?.value || '') || 20

  let html = `<div class="dsl-tele-title">DSL TELEMETRY — BRAIN READ</div>`
  posns.forEach((pos: any) => {
    const dsl = getDSLPositions()[String(pos.id)]
    const cur = pos.sym === w.S.symbol ? getPrice() : (w.allPrices[pos.sym] || w.wlPrices[pos.sym]?.price || pos.entry) // [FIX v85 B7]
    const sym = pos.sym.replace('USDT', '')
    const isActive = dsl?.active || false
    const pnl = _safePnl(pos.side, cur, pos.entry, pos.size, pos.lev, false)
    const plPrice = dsl?.pivotLeft || 0
    const plPnl = plPrice ? ((pos.side === 'LONG' ? plPrice - pos.entry : pos.entry - plPrice) / pos.entry * pos.size * pos.lev) : 0
    const steps = dsl?.log?.filter((l: any) => l.msg.includes('IMPULSE')).length || 0
    const nextStepDist = dsl?.impulseVal && dsl?.pivotRight
      ? Math.abs(dsl.impulseVal - dsl.pivotRight) / dsl.pivotRight * 100
      : 0

    html += `<div style="margin-bottom:4px;padding:4px 5px;background:#030a0d;border:1px solid #00ffcc11;border-radius:2px">
      <div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:3px">
        <span style="color:${isActive ? '#00ffcc' : '#3a5068'}">${pos.side} ${sym} ${isActive ? '● DSL ON' : '○ WAIT'}</span>
        <span style="color:${pnl >= 0 ? '#39ff14' : '#ff3355'}">${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)}</span>
      </div>
      <div class="dsl-tele-grid">
        <div class="dsl-tele-cell"><div class="dsl-tele-lbl">DSL STATE</div><div class="dsl-tele-val">${isActive ? 'ACTIVE' : 'WAIT'}</div></div>
        <div class="dsl-tele-cell"><div class="dsl-tele-lbl">PIVOT LEFT</div><div class="dsl-tele-val" style="color:#ff69b4">${pivotLeftPct}% / $${fP(plPrice)}</div></div>
        <div class="dsl-tele-cell"><div class="dsl-tele-lbl">PIVOT RIGHT</div><div class="dsl-tele-val" style="color:#39ff14">${pivotRightPct}%</div></div>
        <div class="dsl-tele-cell"><div class="dsl-tele-lbl">IMPULSE V</div><div class="dsl-tele-val" style="color:#aa44ff">${impulseValPct}%</div></div>
        <div class="dsl-tele-cell"><div class="dsl-tele-lbl">STEPS DONE</div><div class="dsl-tele-val">${steps}</div></div>
        <div class="dsl-tele-cell"><div class="dsl-tele-lbl">PL PNL IF HIT</div><div class="dsl-tele-val" style="color:${plPnl >= 0 ? '#ff69b4' : '#ff3355'}">${plPnl >= 0 ? '+' : ''}$${plPnl.toFixed(2)}</div></div>
        ${isActive ? `<div class="dsl-tele-cell"><div class="dsl-tele-lbl">NEXT IV DIST</div><div class="dsl-tele-val">${nextStepDist.toFixed(2)}%</div></div>` : ''}
      </div>
    </div>`
  })
  tele.innerHTML = html
}

// ── EXECUTION CINEMATIC ───────────────────────────────────────────
export function showExecCinematic(side: any, sym: any): void {
  const banner = document.createElement('div')
  banner.className = 'exec-banner' + (side === 'SHORT' ? ' short' : '')
  banner.innerHTML = _ZI.bolt + ` ZEUS EXECUTION: ${side} ${sym}`
  document.body.appendChild(banner)
  setTimeout(() => { try { document.body.removeChild(banner) } catch (_) { } }, 3000)
}

// ── GRAND UPDATE MAIN LOOP ────────────────────────────────────────

// Exec cinematic placeholder
// ─── REGIME STABILIZATION (anti-flip: valid only after 3 closes same) ─────
// [MOVED TO TOP] _regimeHistory
export function getStableRegime(current: any): any {
  // Only add if different from last (candle-close trigger)
  if (!_regimeHistory.length || _regimeHistory[_regimeHistory.length - 1] !== current) {
    _regimeHistory.push(current)
  }
  if (_regimeHistory.length > 5) _regimeHistory.shift()
  // Locked = same regime for last 3 consecutive entries
  if (_regimeHistory.length < 3) return null
  const last3 = _regimeHistory.slice(-3)
  const allSame = last3.every((r: any) => r === last3[0])
  return allSame ? last3[0] : null
}

// ─── ANTI-FAKEOUT STATE ───────────────────────────────────────────
// [MOVED TO TOP] _fakeout
export function checkAntiFakeout(klines: any, dir: any): boolean {
  if (!klines || klines.length < 4) return false
  const isLong = dir === 'long'
  // [FIX v85 BUG7] Extins de la 2 la ultimele 3 lumânări, confirmare = minim 2 din 3
  // Previne false invalidare pe o singură lumânare contrară
  const c1 = klines[klines.length - 1]
  const c2 = klines[klines.length - 2]
  const c3 = klines[klines.length - 3]
  const bullish = (b: any) => b.close > b.open
  const bearish = (b: any) => b.close < b.open
  let confirmCount = 0
  if (isLong) {
    if (bullish(c1)) confirmCount++
    if (bullish(c2)) confirmCount++
    if (bullish(c3)) confirmCount++
  } else {
    if (bearish(c1)) confirmCount++
    if (bearish(c2)) confirmCount++
    if (bearish(c3)) confirmCount++
  }
  const followThrough = confirmCount >= 2 // cel puțin 2 din 3 confirmă direcția
  if (!followThrough) {
    w._fakeout.invalid = true
    return false
  }
  w._fakeout.invalid = false
  return true
}

// ─── HARD SAFETY GATES (AUTO) ────────────────────────────────────

// Safety gates
export function computeSafetyGates(dir: any): any {
  const maxDay = parseInt(el('atMaxDay')?.value || '') || 5
  const maxConc = getTCMaxPos()
  const lossLim = parseInt(el('atLossStreak')?.value || '') || 3
  // [RISK RAILS FIX] Count positions per AT.mode
  const _sgPosList = getATMode() === 'live' ? (getLivePositions()) : (getDemoPositions())
  const concurrent = _sgPosList.filter((p: any) => p.autoTrade && !p.closed).length
  const hasOpposite = _sgPosList.some((p: any) => p.autoTrade && !p.closed && p.side !== (dir === 'long' ? 'LONG' : 'SHORT'))
  // [RISK RAILS] DD removed from client gate — server kill switch is sole authority
  const riskOk = !BM.protectMode && BM.dailyTrades < maxDay && concurrent < maxConc && BM.lossStreak < lossLim
  const h = new Date().getUTCHours()
  // C: Session gate only applies when session filter checkbox is ON
  const sessionFilterEnabled = el('dhfEnabled')?.checked !== false  // default ON
  const sessionHourOk = (h >= 7 && h < 11) || (h >= 13 && h < 17) || (h >= 19 && h < 23)
  const sessionOk = !sessionFilterEnabled || sessionHourOk  // pass if filter OFF
  // [B7 FIX] Use cached regime from renderBrainCockpit instead of re-calling detectRegimeEnhanced
  const regDat = { regime: BR.regime || 'unknown' }
  const stableRegime = getStableRegime(regDat.regime)
  // C: Regime — only hard-block on truly unstable; extreme panic = reduce size not full block
  const regimeOk = stableRegime !== null &&
    (stableRegime === 'trend' || stableRegime === 'breakout' || stableRegime === 'range' ||
      stableRegime === 'squeeze')  // squeeze is risky but not an outright block

  return {
    risk: riskOk,
    spread: true, // no real spread data
    cooldown: (Date.now() - (getATLastTradeTs() || 0)) > _getCooldownMs(),
    news: BM.newsRisk !== 'high',
    session: sessionOk,
    noOpposite: !hasOpposite,
    regime: regimeOk
  }
}

export function _getCooldownMs(): number {
  const prof = (w.S.profile || 'fast').toLowerCase()
  const closes = w.S.cooldownCloses || PROFILE_TF[prof]?.cooldown || 2
  // Use trigger TF candle size for cooldown period
  const trigTf = w.S.triggerTF || PROFILE_TF[prof]?.trigger || '5m'
  const tfMs: any = { '1m': 60000, '3m': 180000, '5m': 300000, '15m': 900000, '30m': 1800000, '1h': 3600000, '4h': 14400000, '1D': 86400000 }
  const candleMs = tfMs[trigTf] || 300000
  const base = closes * candleMs
  return BM.lossStreak > 0 ? base * 2 : base
}

export function allSafetyPass(safety: any): boolean {
  return Object.values(safety).every((v: any) => v === true)
}

// ─── CONTEXT GATES ────────────────────────────────────────────────
export function computeContextGates(dir: any, klines: any): any {
  const ofi = BR.ofi?.blendBuy || 50
  const isLong = dir === 'long'
  const mtfCount = ['15m', '1h', '4h'].filter(tf => BM.mtf[tf] === (isLong ? 'bull' : 'bear')).length
  const flowOk = isLong ? (ofi > 57 && BM.flow.cvd === 'rising') : (ofi < 43 && BM.flow.cvd === 'falling')
  const sw = BM.sweep
  const triggerOk = sw.type !== 'none' && (isLong ? sw.type === 'below' : sw.type === 'above') && sw.reclaim
  const antiFakeout = checkAntiFakeout(klines, dir)
  return {
    mtf: mtfCount >= 2,
    flow: flowOk,
    trigger: triggerOk,
    antifake: antiFakeout
  }
}

// ─── COCKPIT RENDER ───────────────────────────────────────────────
// ── SESSION BAR — updates both bottom bar + orb overlay ──────────
// ── SESSION BOUNDARIES (real market sessions, UTC) ──────────────
// ASIA:   00:00–08:00 UTC
// LONDON: 08:00–16:00 UTC  (extended to include pre-close)
// NY:     13:00–21:00 UTC
// Overlap: LONDON + NY  13:00–16:00 UTC  → PRIMARY = NY (higher vol)
// [MOVED TO TOP] _SESS_DEF
// Priority order for overlap (higher index = higher priority = PRIMARY)
// [MOVED TO TOP] _SESS_PRIORITY


// Session management
export function _getActiveSessions(hUTC: any): any {
  const active: string[] = []
  if (!_SESS_DEF) return { active: [], primary: null }
  Object.entries(_SESS_DEF).forEach(([key, def]: any) => {
    if (hUTC >= def.start && hUTC < def.end) active.push(key)
  })
  // Determine primary (highest priority in active list)
  let primary: any = null
  _SESS_PRIORITY.forEach((s: any) => { if (active.includes(s)) primary = s })
  return { active, primary }
}

export function updateSessionPills(): void {
  const hUTC = new Date().getUTCHours()
  const { active, primary } = _getActiveSessions(hUTC);

  ['asia', 'london', 'ny'].forEach(s => {
    const isActive = active.includes(s)
    const isPrimary = (s === primary)

    // Orb pills (primary display)
    const pill = el('osess-' + s)
    if (pill) {
      // Build class string cleanly
      let cls = 'orb-sess'
      if (isActive) cls += ' active ' + s
      if (isPrimary) cls += ' primary'
      pill.className = cls
    }

    // Bottom bar compat stubs
    const b1 = el('zsess-' + s)
    if (b1) {
      b1.className = isActive ? 'active ' + s : ''
    }
  })
}

// Alias for backward compatibility
export function renderSessionBar(): void { updateSessionPills() }

// ── SINGLE INTERVAL GUARD ────────────────────────────────────────
// Deferred: _SESS_DEF comes from config.js (bridge-loaded later).
// Run after a short delay so bridge has time to load config.js.
if (!w._sessIntervalId && typeof w.Intervals !== 'undefined') {
  setTimeout(() => { try { updateSessionPills() } catch (_) { } }, 2000)
  w._sessIntervalId = w.Intervals.set('sessionPills', updateSessionPills, 60000)
}

// ── NEURON SCAN — live coin LED pulse ──────────────────────────────
// [MOVED TO TOP] _NEURO_SYMS
// [MOVED TO TOP] _neuroLastScan
export function initNeuroCoinLEDs(): void {
  // Primary: inside orb; secondary: legacy stub (hidden)
  const wrap = el('orbNeuroCoin') || el('zncNeuroCoin')
  if (!wrap) return
  // Tiny dots only in orb (no label text to save space)
  wrap.innerHTML = _NEURO_SYMS.map((sym: any) => `<div class="znc-nc" id="zncnc-${sym}" title="${sym}"><div class="znc-nc-dot" id="zncndot-${sym}"></div></div>`).join('')
}

export function pulseNeuronCoin(sym: any): void {
  // sym can be 'BTCUSDT' or 'BTC'
  const base = sym.replace('USDT', '').replace('usdt', '').toUpperCase()
  const el2 = el('zncnc-' + base)
  if (!el2) return
  el2.classList.add('pulse')
  setTimeout(() => el2.classList.remove('pulse'), 400)
}

// Hook into wlPrices update — call pulseNeuronCoin when symbol gets update
// Called from the wlWS onmessage handler
export function onNeuronScanUpdate(sym: any): void {
  const now = Date.now()
  if ((now - (_neuroLastScan[sym] || 0)) > 1500) { // throttle per coin
    _neuroLastScan[sym] = now
    pulseNeuronCoin(sym)
  }
}

// Brain Cockpit render (massive)
export function renderBrainCockpit(): void {
  const _price = getPrice()
  if (!_price) {
    // [FIX] Still render safety gates + basic UI even without price
    // Price arrives after WS connects — don't block entire cockpit
    try {
      const _ledEl = el('brainStateBadge')
      if (_ledEl) { _ledEl.textContent = 'WAITING FOR FEED'; _ledEl.className = 'znc-state scanning' }
    } catch (_) {}
    return
  }
  const klines = getKlines()
  const dir = (getSignalData().bullCount) >= (getSignalData().bearCount) ? 'long' : 'short'

  // 1. Timezone
  applyTimezone(w.S.tz || 'Europe/Bucharest')

  // 2. Regime
  const regDat = detectRegimeEnhanced(klines)
  BR.regime = regDat.regime
  BR.regimeAtrPct = regDat.atrPct
  // [FIX R8] regimeConfidence from same detector as regime (single writer)
  BR.regimeConfidence = regDat.confidence || 0
  // [PATCH 6] Wire BM.regime from BRAIN.regime so state.js/deepdive consumers see real value
  BM.regime = regDat.regime

  // 3. MTF + Flow + Sweep
  updateMTFAlignment()
  detectSweepDisplacement(klines)
  updateFlowEngine(klines)

  // 4. Safety gates
  const safety = computeSafetyGates(dir)
  const safetyPass = allSafetyPass(safety)
  // FIX v118: cache pentru renderCircuitBrain (nu mai citește DOM)
  BR._safetyCache = safety

  // 5. Context gates
  const ctx = computeContextGates(dir, klines)
  // FIX v118: cache pentru renderCircuitBrain
  BR._ctxCache = ctx

  // 6. Entry score
  // [PATCH BRAIN-AT-IDLE] Skip decision score pipeline when AT is OFF
  if (getATEnabled()) {
    const gates = computeGates(dir)
    computeEntryScore(gates, dir)
  } else {
    _pushBrainEntry(0, false)
  }

  // 6b. Market Atmosphere (aggregator — reads all existing signals)
  computeMarketAtmosphere()

  // 6c. WHY ENGINE NARRATOR — builds S.why from all existing brain data
  ;(function buildWhyNarrative() {
    try {
      const _whyReasons: string[] = []
      const _whyRisks: string[] = []
      const _dir = dir // 'long' or 'short'
      const _isLong = _dir === 'long'
      const _regime = BR.regime || 'unknown'
      const _regConf = BR.regimeConfidence || 0
      const _atrPct = BR.regimeAtrPct || 0
      const _rsi5m = getRSI('5m') || 50
      void (getRSI('1h') || 50)
      const _ofi = BR.ofi?.blendBuy || 50
      const _sw = BM.sweep || {}
      const _fr = getFR() || 0
      const _oi = w.S.oi || 0
      const _oiPrev = w.S.oiPrev || _oi
      const _oiDelta = _oiPrev > 0 ? ((_oi - _oiPrev) / _oiPrev * 100) : 0
      const _atmo = BM.atmosphere || {}
      const _sigs = getSignalData()
      const _bulls = _sigs.bullCount || 0
      const _bears = _sigs.bearCount || 0
      const _sigTotal = _bulls + _bears
      const _gates = BM.gates || {}

      // ── WHY REASONS (bullish/bearish confirmation) ──
      // Regime
      if (_regime === 'trend' || _regime === 'breakout') {
        _whyReasons.push(_regime === 'trend'
          ? 'Trend regime (conf ' + _regConf + '%) — directional move active'
          : 'Breakout regime — expansion detected')
      }
      // Sweep + Reclaim
      if (_sw.type !== 'none' && _sw.reclaim) {
        const _swDir = _sw.type === 'below' ? 'sub suport' : 'peste rezistență'
        _whyReasons.push('Liquidity sweep ' + _swDir + ' → reclaimed' + (_sw.displacement ? ' + displacement' : ''))
      } else if (_sw.type !== 'none') {
        _whyReasons.push('Liquidity sweep detectat (' + _sw.type + ')' + (_sw.liqDist ? ' — wick ' + _sw.liqDist + '%' : ''))
      }
      // Orderflow
      if ((_isLong && _ofi > 57) || (!_isLong && _ofi < 43)) {
        _whyReasons.push('Orderflow ' + (_isLong ? 'bullish' : 'bearish') + ' (' + _ofi.toFixed(0) + '% buy bias)')
      }
      // OI change
      if (Math.abs(_oiDelta) > 0.1) {
        const _oiDir = _oiDelta > 0 ? 'increasing' : 'decreasing'
        _whyReasons.push('OI ' + _oiDir + ' ' + Math.abs(_oiDelta).toFixed(1) + '% → ' + (_oiDelta > 0 ? 'fresh positions entering' : 'positions closing'))
      }
      // RSI
      if (_isLong && _rsi5m > 40 && _rsi5m < 70) {
        _whyReasons.push('RSI 5m ' + _rsi5m.toFixed(0) + (_rsi5m < 50 ? ' — oversold bounce zone' : ' — bullish momentum'))
      } else if (!_isLong && _rsi5m > 30 && _rsi5m < 60) {
        _whyReasons.push('RSI 5m ' + _rsi5m.toFixed(0) + (_rsi5m > 50 ? ' — overbought fade zone' : ' — bearish momentum'))
      }
      // Signal confluence
      if (_sigTotal >= 2) {
        const _dominant = _bulls >= _bears ? _bulls : _bears
        _whyReasons.push(_dominant + '/' + _sigTotal + ' signals ' + (_bulls >= _bears ? 'bullish' : 'bearish') + ' aligned')
      }
      // MTF alignment
      if (_gates.mtf === 'ok') {
        const _1h = BM.mtf?.['1h'] || '?'
        const _4h = BM.mtf?.['4h'] || '?'
        _whyReasons.push('MTF aligned: 1h ' + _1h + ' + 4h ' + _4h)
      }
      // Volume confirm
      if (_gates.volume === 'ok') {
        _whyReasons.push('Volume confirming — above baseline')
      }
      // Funding rate as reason
      if ((_isLong && _fr < -0.0001) || (!_isLong && _fr > 0.0001)) {
        _whyReasons.push('Funding rate ' + (_fr * 100).toFixed(3) + '% — ' + (_isLong ? 'shorts paying longs' : 'longs paying shorts'))
      }

      // ── RISK FACTORS ──
      // ATR volatility
      if (_atrPct > 1.5) {
        _whyRisks.push('Volatility ' + (_atrPct > 2.5 ? 'extreme' : 'high') + ' (ATR ' + _atrPct.toFixed(1) + '%) — wider stops needed')
      }
      // Opposing orderflow
      if ((_isLong && _ofi < 45) || (!_isLong && _ofi > 55)) {
        _whyRisks.push('Orderflow ' + (_isLong ? 'bearish' : 'bullish') + ' divergence (' + _ofi.toFixed(0) + '%)')
      }
      // RSI extremes
      if (_rsi5m > 75) {
        _whyRisks.push('RSI overbought (' + _rsi5m.toFixed(0) + ') — reversal risk')
      } else if (_rsi5m < 25) {
        _whyRisks.push('RSI oversold (' + _rsi5m.toFixed(0) + ') — bounce risk')
      }
      // Funding against direction
      if ((_isLong && _fr > 0.0003) || (!_isLong && _fr < -0.0003)) {
        _whyRisks.push('Funding rate against direction (' + (_fr * 100).toFixed(3) + '%)')
      }
      // News risk
      if (BM.newsRisk === 'high') {
        _whyRisks.push('High news/macro risk active')
      } else if (BM.newsRisk === 'med') {
        _whyRisks.push('Medium news risk — caution advised')
      }
      // Trap risk from atmosphere
      if (_atmo.category === 'trap_risk') {
        _whyRisks.push('Trap risk detected — fakeout probability elevated')
      }
      // Session warning
      if (_gates.session !== 'ok') {
        _whyRisks.push('Outside optimal session hours')
      }
      // Regime against trade
      if (_regime === 'range') {
        _whyRisks.push('Range regime — breakout signals less reliable')
      } else if (_regime === 'panic' || _regime === 'chaos') {
        _whyRisks.push('Chaotic regime — signals may be noisy')
      }
      // OI decreasing (liquidation drain)
      if (_oiDelta < -0.3) {
        _whyRisks.push('OI dropping ' + Math.abs(_oiDelta).toFixed(1) + '% — deleveraging in progress')
      }
      // MTF misaligned
      if (_gates.mtf === 'fail') {
        _whyRisks.push('MTF misaligned against direction')
      }

      // ARIA pattern in reasons
      const _aria = (typeof w.ARIA_STATE !== 'undefined' && w.ARIA_STATE.pattern) ? w.ARIA_STATE.pattern : null
      if (_aria && _aria.conf > 50) {
        const _ariaAligned = (_aria.dir === 'bull' && _isLong) || (_aria.dir === 'bear' && !_isLong)
        if (_ariaAligned) _whyReasons.push('ARIA pattern: ' + _aria.name + ' (' + _aria.conf + '%) aligned')
        else _whyRisks.push('ARIA pattern: ' + _aria.name + ' (' + _aria.dir + ') opposes direction')
      }

      // ── Determine state from score + reasons ──
      const _score = BM.entryScore || 0
      const _whyState = _score >= (BM.profile === 'fast' ? 65 : 75) ? 'READY'
        : _score >= 50 ? 'ANALYZING'
          : _whyReasons.length === 0 ? 'SCANNING'
            : 'WAIT'

      // Build combined reasons display
      const _combined: string[] = []
      _whyReasons.slice(0, 4).forEach(function (r: string) { _combined.push('[OK] ' + r) })
      _whyRisks.slice(0, 3).forEach(function (r: string) { _combined.push('[!] ' + r) })
      if (_combined.length === 0) _combined.push('Scanning market...')

      w.S.why = { state: _whyState, reasons: _combined, whyList: _whyReasons, riskList: _whyRisks, dir: _dir, score: _score, ts: Date.now() }
    } catch (_whyErr) {
      w.S.why = { state: 'WAIT', reasons: ['—'], whyList: [], riskList: [], dir: dir, score: 0, ts: Date.now() }
    }
  })()

  // 6d. ADAPTIVE SHIELD — Market Danger Score (0-100)
  ;(function computeDangerScore() {
    try {
      const _db: any = { volatility: 0, spread: 0, liquidations: 0, volume: 0, funding: 0 }
      // Volatility component (0-25) — ATR% severity
      const _atrP = BR.regimeAtrPct || 0
      _db.volatility = _atrP > 3.0 ? 25 : _atrP > 2.0 ? 18 : _atrP > 1.5 ? 12 : _atrP > 1.0 ? 6 : 0
      // Volume anomaly component (0-20) — recent volume spike vs baseline
      const _kl = getKlines()
      if (_kl.length >= 20) {
        const _r5 = _kl.slice(-5).reduce((a: number, k: any) => a + (k.volume || 0), 0) / 5
        const _b15 = _kl.slice(-20, -5).reduce((a: number, k: any) => a + (k.volume || 0), 0) / 15
        const _vRatio = _b15 > 0 ? _r5 / _b15 : 1
        _db.volume = _vRatio > 3.0 ? 20 : _vRatio > 2.0 ? 14 : _vRatio > 1.5 ? 8 : 0
      }
      // Funding rate spike component (0-20)
      const _frAbs = Math.abs(getFR() || 0)
      _db.funding = _frAbs > 0.002 ? 20 : _frAbs > 0.001 ? 14 : _frAbs > 0.0005 ? 7 : 0
      // Liquidation cascade component (0-20) — trap rate from liq cycle
      const _tr = BM.liqCycle?.trapRate
      _db.liquidations = typeof _tr === 'number' ? Math.round(_tr * 20) : 0
      // Spread/regime chaos component (0-15)
      const _reg = BR.regime || 'unknown'
      _db.spread = (_reg === 'panic' || _reg === 'chaos') ? 15
        : _reg === 'range' ? 8
          : BM.atmosphere?.category === 'trap_risk' ? 10 : 0
      // Sum all components (0-100)
      BM.danger = Math.min(100, _db.volatility + _db.spread + _db.liquidations + _db.volume + _db.funding)
      BM.dangerBreakdown = _db
    } catch (_de) { BM.danger = 0 }
  })()

  // 6e. CONVICTION SCORE (0-100) — how confident Brain is in the current direction
  ;(function computeConvictionScore() {
    try {
      let _cv = 0
      // Gate score contribution (0-40) — entry score normalized
      const _es = BM.entryScore || 0
      _cv += Math.min(40, _es * 0.4)
      // Atmosphere confidence (0-15)
      const _ac = BM.atmosphere?.confidence || 0
      _cv += Math.min(15, _ac * 0.15)
      // ARIA pattern match (0-15) — aligned pattern boosts conviction
      const _ap = (typeof w.ARIA_STATE !== 'undefined' && w.ARIA_STATE.pattern) ? w.ARIA_STATE.pattern : null
      if (_ap && _ap.conf > 50) {
        const _aligned = (_ap.dir === 'bull' && dir === 'long') || (_ap.dir === 'bear' && dir === 'short')
        _cv += _aligned ? Math.min(15, _ap.conf * 0.15) : -5
      }
      // MTF alignment (0-15)
      const _1h = BM.mtf?.['1h'] || 'neut'
      const _4h = BM.mtf?.['4h'] || 'neut'
      const _mtfDir = dir === 'long' ? 'bull' : 'bear'
      if (_1h === _mtfDir) _cv += 7
      if (_4h === _mtfDir) _cv += 8
      // Orderflow alignment (0-10)
      const _ofi = BR.ofi?.blendBuy || 50
      if ((dir === 'long' && _ofi > 57) || (dir === 'short' && _ofi < 43)) _cv += 10
      else if ((dir === 'long' && _ofi < 43) || (dir === 'short' && _ofi > 57)) _cv -= 5
      // Signal consensus (0-5)
      const _sd = getSignalData()
      const _bul = _sd.bullCount || 0, _ber = _sd.bearCount || 0
      if ((dir === 'long' && _bul > _ber) || (dir === 'short' && _ber > _bul)) _cv += 5
      // Clamp 0-100
      BM.conviction = Math.max(0, Math.min(100, Math.round(_cv)))
      // Compute sizing multiplier from conviction + danger
      // Conviction: <40%=skip(0.0), 40-60%=half(0.5), 60-80%=normal(1.0), >80%=full(1.0)
      // Danger: >80=pause(0.0), 60-80=reduce(0.6), 40-60=caution(0.85), <40=normal(1.0)
      let _cMult = BM.conviction >= 60 ? 1.0 : BM.conviction >= 40 ? 0.5 : 0.0
      let _dMult = BM.danger >= 80 ? 0.0 : BM.danger >= 60 ? 0.6 : BM.danger >= 40 ? 0.85 : 1.0
      BM.convictionMult = Math.round((_cMult * _dMult) * 100) / 100
      // [L1-SHIELD-DIAG] Stash component breakdown for diagnostic logging at SHIELD block site
      ;(BM as any)._convictionBreakdown = {
        entryScore: _es,
        entryPart: Math.round(Math.min(40, _es * 0.4)),
        atmConf: _ac,
        atmPart: Math.round(Math.min(15, _ac * 0.15)),
        mtf1h: _1h,
        mtf4h: _4h,
        mtfPart: (_1h === _mtfDir ? 7 : 0) + (_4h === _mtfDir ? 8 : 0),
        ofi: Math.round(_ofi),
        ofiPart: ((dir === 'long' && _ofi > 57) || (dir === 'short' && _ofi < 43)) ? 10 : (((dir === 'long' && _ofi < 43) || (dir === 'short' && _ofi > 57)) ? -5 : 0),
        sigBull: _bul,
        sigBear: _ber,
        sigPart: ((dir === 'long' && _bul > _ber) || (dir === 'short' && _ber > _bul)) ? 5 : 0,
        dir,
        danger: BM.danger || 0,
      }
    } catch (_ce) { BM.conviction = 0; BM.convictionMult = 1.0 }
  })()

  // 7. News + chaos
  updateNewsShield()
  updateChaosBar()

  // 8. Protect mode
  const activePnL = (getDemoPositions()).filter((p: any) => p.autoTrade && !p.closed).reduce((a: number, p: any) => {
    const cur = p.sym === w.S.symbol ? getPrice() : (w.wlPrices[p.sym]?.price || p.entry)
    return a + (p.side === 'LONG' ? cur - p.entry : p.entry - cur) / p.entry * p.size * p.lev
  }, 0)
  BM.dailyPnL = (getATDailyPnL()) + activePnL
  checkProtectMode()

  // 9. Determine ARM state
  const score = BM.entryScore || 0

  const thresholds: any = { fast: [65, 55], swing: [72, 60], defensive: [80, 65] }
  const prof = w.S.profile || 'fast'
  const [scoreThresh, confThresh] = thresholds[prof] || [65, 55]
  const tfMap = PROFILE_TF[prof] || PROFILE_TF.fast
  const confluenceScore = (typeof BM !== 'undefined' ? BM.confluenceScore : 0) || 0 // [FIX v85.1 F3] din memorie
  const triggerOk = ctx.trigger
  // [ATMOSPHERE] Pre-filter: block ARM if atmosphere forbids entry
  const atmosAllow = BM.atmosphere ? BM.atmosphere.allowEntry !== false : true
  const isArmed = !BM.protectMode && safetyPass && ctx.mtf && ctx.flow && triggerOk && !w._fakeout.invalid && score >= scoreThresh && confluenceScore >= confThresh && atmosAllow
  const hasPos = (getDemoPositions()).some((p: any) => p.autoTrade && !p.closed)
  const mode = w.S.mode || 'manual'

  let state = BM.protectMode ? 'protect' : getATKillTriggered() ? 'blocked' : hasPos ? 'trading' : isArmed ? 'armed' : score > 40 ? 'analyzing' : 'scanning'
  _pushBrainEngineState((state === 'armed' ? 'ready' : state) as BrainEngineState)

  // ── SAFETY LED ROWS ──
  const safetyMap: any = {
    risk: { led: 'led-risk', lbl: 'lbl-risk', txt: 'Risk ' + (safety.risk ? 'OK' : 'FAIL') },
    spread: { led: 'led-spread', lbl: 'lbl-spread', txt: 'Spread/Slip ' + (safety.spread ? 'OK' : 'FAIL') },
    cooldown: { led: 'led-cooldown', lbl: 'lbl-cooldown', txt: 'Cooldown ' + (safety.cooldown ? 'OFF' : 'WAIT') },
    news: { led: 'led-news', lbl: 'lbl-news', txt: 'News ' + (safety.news ? 'OK' : 'BLOCK-HIGH') },
    session: { led: 'led-session', lbl: 'lbl-session', txt: 'Session ' + (safety.session ? 'OK' : 'OFF') },
    noOpposite: { led: 'led-noopposite', lbl: 'lbl-noopposite', txt: 'No Opposite ' + (safety.noOpposite ? 'OK' : 'FAIL') },
    regime: { led: 'led-regime', lbl: 'lbl-regime', txt: 'Regime ' + (safety.regime ? 'STABLE' : 'UNSTABLE') }
  }
  Object.entries(safetyMap).forEach(([key, { led, lbl, txt }]: any) => {
    const pass = safety[key]
    const ledEl = el(led), lblEl = el(lbl)
    if (ledEl) ledEl.className = 'znc-led ' + (pass ? 'ok' : 'fail')
    if (lblEl) { lblEl.textContent = txt; lblEl.className = 'znc-gate-lbl ' + (pass ? 'ok' : 'fail') }
  })
  // ── CONTEXT LED ROWS ──
  const mtfTFs = ['15m', '1h', '4h']
  const mtfAlignCount = mtfTFs.filter(tf => BM.mtf[tf] === (dir === 'long' ? 'bull' : 'bear')).length
  const ctxMap: any = {
    mtf: { led: 'led-mtf', lbl: 'lbl-mtf', txt: `MTF Align ${mtfAlignCount}/3`, pass: ctx.mtf },
    flow: { led: 'led-flow', lbl: 'lbl-flow', txt: `Flow ${ctx.flow ? 'CONFIRM' : 'WEAK'}`, pass: ctx.flow },
    trigger: { led: 'led-trigger', lbl: 'lbl-trigger', txt: `Trigger: ${ctx.trigger ? 'Sweep+Reclaim' : 'NONE'}`, pass: ctx.trigger, wait: true },
    antifake: { led: 'led-antifake', lbl: 'lbl-antifake', txt: `Anti-Fakeout ${w._fakeout.invalid ? 'BLOCK' : 'OK'}`, pass: !w._fakeout.invalid }
  }
  Object.entries(ctxMap).forEach(([, o]: any) => {
    const { led, lbl, txt, pass, wait } = o
    const ledEl = el(led), lblEl = el(lbl)
    const cls = pass ? 'ok' : (wait && !pass) ? 'wait' : 'fail'
    if (ledEl) ledEl.className = 'znc-led ' + cls
    if (lblEl) { lblEl.textContent = txt; lblEl.className = 'znc-gate-lbl ' + cls }
  })

  // ── MTF TF BADGES (per profile) ──
  const tfsToShow = prof === 'fast' ? ['5m', '15m', '1h'] : prof === 'swing' ? ['15m', '1h', '4h'] : ['30m', '1h', '4h'];
  ['mtf15m', 'mtf1h', 'mtf4h'].forEach((id, i) => {
    const b = el(id); if (!b) return
    const tf = tfsToShow[i] || mtfTFs[i]
    const rsi = getRSI(tf) || 50
    const tdir = rsi > 55 ? 'bull' : rsi < 45 ? 'bear' : 'neut'
    BM.mtf[tf] = tdir
    b.textContent = tf + ' ' + (tdir === 'bull' ? '▲' : tdir === 'bear' ? '▼' : '—')
    b.className = 'znc-tf-badge ' + tdir + (i === 0 ? ' trigger' : '')
  })
  const trigBadge = el('mtfTrig')
  if (trigBadge) { trigBadge.textContent = 'TRIG:' + tfMap.trigger + ' ' + (BM.flow?.cvd === 'rising' ? '▲' : BM.flow?.cvd === 'falling' ? '▼' : '—') }

  // ── ORB SCORE ARC ──
  const arc = el('zncScoreArc')
  const numEl = el('zncScoreNum')
  const scoreLbl = el('zncScoreLbl')
  const circum = 302 // 2π×48
  const col = score >= scoreThresh ? '#39ff14' : score >= 60 ? '#f0c040' : '#ff3355'
  if (arc) { arc.setAttribute('stroke-dasharray', `${score / 100 * circum} ${circum}`); arc.setAttribute('stroke', col) }
  if (numEl) { numEl.textContent = score || '—'; numEl.style.color = col; numEl.style.textShadow = `0 0 16px ${col}` }
  if (scoreLbl) { scoreLbl.textContent = score >= scoreThresh ? 'READY' : score >= 60 ? 'WAIT' : 'BLOCK'; scoreLbl.className = 'znc-state ' + (score >= scoreThresh ? 'armed' : score >= 60 ? 'analyzing' : 'blocked') }

  // ── ORB LED NODES (gate state → LED ring dots) ──
  const ledStates = [safety.risk, safety.spread, safety.cooldown, safety.news, safety.session, ctx.mtf, ctx.flow, ctx.trigger, !w._fakeout.invalid]
  ledStates.forEach((pass: any, i: number) => {
    const dot = el('zled' + i); if (!dot) return
    const c2 = pass ? '#39ff14' : '#ff3355'
    dot.setAttribute('fill', c2 + '22')
    dot.setAttribute('stroke', c2)
    dot.setAttribute('r', pass ? '6' : '4')
  })

  // ── STATE / ARM BADGES ──
  const badge = el('brainStateBadge')
  const stLabels: any = { scanning: 'SCANNING', analyzing: 'ANALYZING', armed: _ZI.bolt + ' ARMED', trading: _ZI.dRed + ' TRADING', protect: _ZI.sh + ' PROTECT', blocked: _ZI.noent + ' BLOCKED' }
  if (badge) { badge.innerHTML = stLabels[state] || state.toUpperCase(); badge.className = 'znc-state ' + state }
  const armBadge = el('zncArmBadge')
  if (armBadge) {
    const armTxt = isArmed ? 'ARMED' : BM.protectMode ? 'PROTECT' : hasPos ? 'TRADING' : 'SCANNING'
    armBadge.textContent = armTxt
    armBadge.className = 'znc-arm-badge ' + (isArmed ? 'armed' : BM.protectMode ? 'protect' : hasPos ? 'trading' : 'scanning')
  }

  // ── CONTROL SOURCE ──
  const srcEl = el('znc-src')
  if (srcEl) {
    const srcMap: any = { manual: ['USER', 'user'], assist: ['ASSIST', 'assist'], auto: ['AI', 'ai'] }
    srcEl.textContent = srcMap[mode][0]
    srcEl.className = 'znc-src ' + srcMap[mode][1]
  }

  // ── REGIME BADGES ──
  const regLabels: any = { trend: 'TREND ▲', range: 'RANGE —', breakout: 'BREAKOUT ↑', squeeze: 'SQUEEZE ' + _ZI.hex, panic: 'PANIC ' + _ZI.fire, unknown: '—' };
  [el('brainRegimeBadge'), el('brainRegimeBadge2')].forEach((b: any) => {
    if (!b) return
    b.innerHTML = regLabels[BR.regime] || BR.regime
    b.className = 'znc-regime-val ' + (BR.regime || 'unknown')
  })
  const rd = el('zncRegimeDetail')
  if (rd) rd.textContent = `ADX: ${regDat.adx || '—'} | VOL: ${regDat.volMode || '—'} | ${regDat.structure || '—'}${regDat.squeeze ? ' | SQZ' : ''}`

  // ── INSIGHT CARDS (use card IDs directly) ──
  const sw = BM.sweep
  const delta = BM.flow?.delta || 0
  const chaos = Math.round((BR.regimeAtrPct || 0) * 15 + (BM.newsRisk === 'high' ? 40 : BM.newsRisk === 'med' ? 20 : 0))
  const _card = (cardId: any, titleId: any, subId: any, t: any, s: any, cls: any) => {
    const ca = el(cardId), ti = el(titleId), si = el(subId)
    if (ca) ca.className = 'znc-card ' + cls
    if (ti) ti.innerHTML = t
    if (si) si.textContent = s
  }
  _card('card-flow', 'card-flow-t', 'card-flow-s', 'Flow ' + (ctx.flow ? 'CONFIRM' : 'WEAK'), 'Delta ' + (delta >= 0 ? '+' : '') + delta, ctx.flow ? 'ok' : 'fail')
  _card('card-sweep', 'card-sweep-t', 'card-sweep-s', sw.type !== 'none' ? 'Sweep ' + sw.type.toUpperCase() + ' ✦' : 'Sweep NONE', sw.reclaim ? '$' + fP(getPrice()) + ' reclaimed' : 'No reclaim', sw.reclaim ? 'ok' : 'warn')
  _card('card-mtf', 'card-mtf-t', 'card-mtf-s', 'MTF ' + mtfAlignCount + '/3', tfMap.trigger + ' – ' + tfMap.bias, mtfAlignCount >= 2 ? 'ok' : 'warn')
  _card('card-chaos', 'card-chaos-t', 'card-chaos-s', 'Chaos ' + (chaos < 33 ? 'OK' : chaos < 66 ? 'MED' : 'HIGH'), 'ATR ' + (BR.regimeAtrPct || 0).toFixed(2) + '%', chaos < 33 ? 'ok' : chaos < 66 ? 'warn' : 'fail')

  // ── ATMOSPHERE CARD ──
  const atmos = BM.atmosphere || {}
  const aCat = (atmos.category || 'neutral').toLowerCase()
  const aCls = aCat === 'clean_trend' ? 'ok' : aCat === 'range' ? 'warn' : aCat === 'toxic_volatility' ? 'toxic' : aCat === 'trap_risk' ? 'fail' : 'neut'
  const aLabel = (atmos.category || 'NEUTRAL').toUpperCase().replace('_', ' ')
  const aAllow = atmos.allowEntry !== false ? 'ALLOW' : 'BLOCK'
  const aSub = aAllow + ' · conf:' + (atmos.confidence || 0) + ' · ×' + (atmos.sizeMultiplier != null ? atmos.sizeMultiplier : '?')
  _card('card-atmos', 'card-atmos-t', 'card-atmos-s', _ZI.bolt + ' ' + aLabel, aSub, aCls)
  // Chaos shimmer CSS
  const orbWrap = el('zncOrbWrap')
  if (orbWrap) orbWrap.style.animation = chaos > 80 ? 'zHeat .15s infinite' : ''

  // ── THREAT CIRCLES ──
  const newsScore = BM.newsRisk === 'high' ? 80 : BM.newsRisk === 'med' ? 40 : 10
  const liqScore = Math.round((BR.ofi?.sell || 50) / 100 * 60)
  const volScore = Math.round(Math.min(100, (BR.regimeAtrPct || 0) * 20));
  [[newsScore, 'threat-news', 'threatNewsVal'], [liqScore, 'threat-liq', 'threatLiqVal'], [volScore, 'threat-vol', 'threatVolVal']].forEach(([v, cid, vid]: any) => {
    const c = el(cid), vv = el(vid)
    const col2 = v < 33 ? '#39ff14' : v < 66 ? '#f0c040' : '#ff3355'
    if (c) c.className = 'znc-circ ' + (v < 33 ? 'low' : v < 66 ? 'med' : 'high')
    if (vv) { vv.textContent = v; vv.style.color = col2 }
  })

  // ── GAUGES ──
  const na = el('newsGaugeArc'); if (na) na.setAttribute('stroke-dasharray', `${newsScore / 100 * 75} 75`)
  const la = el('liqGaugeArc'); if (la) la.setAttribute('stroke-dasharray', `${liqScore / 100 * 75}  75`)
  const nv = el('newsGaugeVal'); if (nv) { nv.textContent = String(newsScore); nv.style.color = newsScore < 33 ? '#39ff14' : newsScore < 66 ? '#f0c040' : '#ff3355' }
  const lv = el('liqGaugeVal'); if (lv) { lv.textContent = String(liqScore); lv.style.color = liqScore < 33 ? '#39ff14' : liqScore < 66 ? '#f0c040' : '#ff3355' }

  // ── ARM DETAIL + TOP BLOCK REASON (uses S.* canonical) ──
  const trigType = sw.reclaim ? 'Sweep+Reclaim' : sw.displacement ? 'Displacement' : '—'
  const cdLeft = Math.max(0, Math.round((_getCooldownMs() - (Date.now() - (getATLastTradeTs() || 0))) / 60000))
  const _ad = (id: any, v: any, arm?: any) => { const e = el(id); if (e) { e.textContent = v; if (arm !== undefined) e.style.color = arm ? '#39ff14' : '#2a4030' } }
  _ad('zad-mode', mode.toUpperCase(), isArmed)
  _ad('zad-profile', prof.toUpperCase() + '  ' + tfMap.trigger + '/' + tfMap.context + '/' + tfMap.bias)
  _ad('zad-score', score + '/' + (isArmed ? '✓' : scoreThresh + '↑'), isArmed)
  _ad('zad-trigger', trigType, ctx.trigger)
  _ad('zad-tf', 'Trig:' + tfMap.trigger + ' Ctx:' + tfMap.context)
  _ad('zad-cd', cdLeft > 0 ? cdLeft + 'm WAIT' : 'READY', cdLeft === 0)

  // ── GATES SUMMARY + TOP BLOCK REASON ──
  const allGates = Object.assign({}, safety, { mtfCtx: ctx.mtf, flowCtx: ctx.flow, triggerCtx: ctx.trigger, antifakeCtx: !w._fakeout.invalid })
  const gatesOk = Object.values(allGates).filter(Boolean).length
  const gatesTotal = Object.keys(allGates).length
  const gatesSumEl = el('zad-gates-summary')
  if (gatesSumEl) gatesSumEl.textContent = `Gates: ${gatesOk}/${gatesTotal} pass`

  // Compute single TOP REASON why not entering
  let topReason = ''
  let reasonCls = 'wait'
  if (BM.protectMode) { topReason = `AUTO BLOCKED: ${BM.protectReason}`; reasonCls = 'block' }
  else if (getATKillTriggered()) { topReason = 'AUTO BLOCKED: Kill switch activ'; reasonCls = 'block' }
  else if (!safety.news) { topReason = 'AUTO BLOCKED: NewsRisk HIGH → prea periculos'; reasonCls = 'block' }
  else if (!safety.regime) { topReason = 'AUTO WAIT: Regime unstable (not locked 3 closes)'; reasonCls = 'wait' }
  else if (!safety.cooldown) { topReason = `AUTO WAIT: Cooldown ${cdLeft}m rămas (${prof})`; reasonCls = 'wait' }
  else if (!safety.session) { topReason = 'AUTO WAIT: Session OFF — oră nefavorabilă'; reasonCls = 'wait' }
  else if (!safety.noOpposite) { topReason = 'AUTO BLOCKED: Poziție opusă deschisă'; reasonCls = 'block' }
  else if (!safety.risk) { topReason = 'AUTO BLOCKED: Risk Limits atinse (DD/Streak/MaxPos)'; reasonCls = 'block' }
  else if (!ctx.trigger) { topReason = 'AUTO WAIT: Trigger neconfirmat (Sweep+Reclaim sau Disp)'; reasonCls = 'wait' }
  else if (!ctx.flow) { topReason = 'AUTO WAIT: FlowConfirm FAIL — CVD/Delta neutru'; reasonCls = 'wait' }
  else if (w._fakeout.invalid) { topReason = 'AUTO WAIT: Anti-fakeout — 2 closes fără follow-through'; reasonCls = 'wait' }
  else if (!ctx.mtf) { topReason = `AUTO WAIT: MTF Align ${mtfAlignCount}/3 (min 2 cerut)`; reasonCls = 'wait' }
  else if (score < scoreThresh) { topReason = `AUTO WAIT: EntryScore ${score} < ${scoreThresh} (${prof})`; reasonCls = 'wait' }
  else if (confluenceScore < confThresh) { topReason = `AUTO WAIT: Confluence ${confluenceScore} < ${confThresh}`; reasonCls = 'wait' }
  else if (!atmosAllow) { topReason = `AUTO BLOCK: Atmosphere ${(BM.atmosphere?.category || '?').toUpperCase()} — ${(BM.atmosphere?.reasons || []).slice(0, 2).join(', ')}`; reasonCls = 'block' }
  else if (mode === 'assist' && !getATEnabled()) { topReason = 'ASSIST: Brain monitoring — enable AutoTrade to execute'; reasonCls = 'wait' }
  else if (mode === 'assist') { topReason = isArmAssistValid() ? 'ASSIST ARMED: Waiting user confirm' : 'ASSIST: Needs ARM + manual confirm'; reasonCls = 'wait' }
  else if (isArmed) { topReason = `AUTO ARMED: Entry score ${score} ✓ — waiting close`; reasonCls = 'ok' }
  else { topReason = `AUTO SCANNING: Score ${score} | ${BR.regime?.toUpperCase() || '—'}`; reasonCls = 'wait' }

  // [R30] route to brainStore.blockReasonDisplay; <BlockReasonText/> renders the pill
  useBrainStore.getState().setBlockReasonDisplay({ text: topReason, className: 'znc-block-reason ' + reasonCls })

  // ── PROTECT BANNER ──
  const pb = el('protectBanner')
  if (pb) pb.className = 'znc-protect' + (BM.protectMode ? ' show' : '')
  const pbt = el('protectBannerTxt')
  if (pbt && BM.protectMode) pbt.textContent = BM.protectReason

  // ── DSL STATUS (clear, non-ambiguous) ──
  const dslEl = el('zncDslContract')
  if (dslEl) {
    const _dslMode = (w.S.mode || 'assist').toLowerCase()
    const _modeTag = _dslMode === 'auto' ? '<span style="color:#39ff14;font-size:10px">●AI</span>' : _dslMode === 'assist' ? '<span style="color:#f0c040;font-size:10px">●USR</span>' : '<span style="color:#2a4030;font-size:10px">●MAN</span>'
    const autoPosnsAll = (getDemoPositions()).filter((p: any) => p.autoTrade && !p.closed)
    const activeDSLPosns = autoPosnsAll.filter((p: any) => getDSLPositions()?.[p.id]?.active)
    const waitDSLPosns = autoPosnsAll.filter((p: any) => getDSLPositions()?.[p.id] && !getDSLPositions()[p.id].active)
    if (!getDSLEnabled()) {
      // Engine completely off
      dslEl.innerHTML = `DSL ENGINE: <b style="color:#aa2233">OFF</b> ${_modeTag} | Activează engine-ul.`
    } else if (!autoPosnsAll.length) {
      // Engine ready but no auto positions yet
      dslEl.innerHTML = `DSL ENGINE: <b style="color:#f0c040">READY</b> ${_modeTag} · Nicio poziție AUTO deschisă`
    } else if (!activeDSLPosns.length && waitDSLPosns.length) {
      // Positions exist, waiting for activation threshold
      dslEl.innerHTML = `DSL ENGINE: <b style="color:#f0c040">WAIT</b> ${_modeTag} · ${waitDSLPosns.length} poz. asteaptă activare`
    } else if (activeDSLPosns.length) {
      // At least one position actively trailed
      const p = activeDSLPosns[0], dsl = getDSLPositions()[p.id]
      const steps = dsl.log?.filter((l: any) => l.msg?.includes('IMPULSE')).length || 0
      const sym2 = (p.sym || '').replace('USDT', '')
      dslEl.innerHTML = `DSL: <b style="color:#00ffcc">TRAILING</b> ${_modeTag} · ${sym2} PL:<b>$${fP(dsl.pivotLeft)}</b> PR:<b>$${fP(dsl.pivotRight)}</b> · Steps:<b>${steps}</b>`
    } else {
      dslEl.innerHTML = `DSL ENGINE: <b style="color:#f0c040">READY</b> ${_modeTag} · ${autoPosnsAll.length} poz. monitorizate`
    }
  }

  // ── RECEIPT (ARM state) ──
  if (isArmed || hasPos) {
    ['rec-mode', 'rec-score', 'rec-trigger', 'rec-tf'].forEach((id, i) => {
      const e = el(id); if (e) e.textContent = [mode.toUpperCase(), score, trigType, tfMap.trigger + '/' + tfMap.context][i]
    })
  }

  // ── Q-FORECAST DISPLAY (pure display — S.quantumForecast set by Brain engine) ──
  ;(function renderQForecast() {
    const mainEl = el('bf-main')
    const rangeEl = el('bf-range')
    const stateEl = el('bf-state')
    if (!mainEl) return

    const qf = w.S.quantumForecast
    const sent = qf?.sentiment || 'neutral'
    const strength = +(qf?.strength) || 0
    const rangeLow = qf?.rangeLow
    const rangeHigh = qf?.rangeHigh
    const qfState = qf?.state || '—'

    // Sentiment → css class
    const sentLower = sent.toLowerCase()
    const sentCls = sentLower.includes('bull') ? 'bull'
      : sentLower.includes('bear') ? 'bear'
        : 'neut'
    // strength modifiers
    const glowCls = strength > 70 ? ' glow' : ''
    const dimCls = strength < 40 ? ' dim' : ''

    const sentLabel = strength > 0
      ? sent.charAt(0).toUpperCase() + sent.slice(1).toLowerCase() + ' (' + strength + ')'
      : 'Neutral (0)'

    mainEl.textContent = sentLabel
    mainEl.className = 'bf-main ' + sentCls + glowCls + dimCls

    if (rangeEl) {
      rangeEl.textContent = (rangeLow && rangeHigh)
        ? fP(rangeLow) + ' – ' + fP(rangeHigh)
        : '—'
    }
    if (stateEl) stateEl.textContent = strength > 0 ? qfState : '—'
  })()

  // ── WHY ENGINE DISPLAY (pure display — S.why set by brain narrator) ──
  ;(function renderWhyEngine() {
    const stateEl = el('bw-state')
    const reasonsEl = el('bw-reasons')
    if (!stateEl) return

    const why = w.S.why
    const whyState = (why?.state || 'WAIT').toUpperCase()
    const whyList = Array.isArray(why?.whyList) ? why.whyList : []
    const riskList = Array.isArray(why?.riskList) ? why.riskList : []

    // State → css class
    const stateCls = whyState === 'READY' ? 'executed'
      : whyState === 'BLOCKED' ? 'blocked'
        : whyState === 'ANALYZING' ? 'analyzing'
          : 'wait'

    stateEl.textContent = whyState + (why?.dir ? ' (' + why.dir.toUpperCase() + ')' : '')
    stateEl.className = 'bw-state ' + stateCls

    if (reasonsEl) {
      let html = ''
      if (whyList.length > 0) {
        html += '<div class="bw-section-label why-label">WHY:</div>'
        html += whyList.slice(0, 4).map(function (r: any) { return '<span class="bw-why">' + _ZI.ok + ' ' + String(r).replace(/</g, '&lt;') + '</span>' }).join('')
      }
      if (riskList.length > 0) {
        html += '<div class="bw-section-label risk-label">RISK:</div>'
        html += riskList.slice(0, 3).map(function (r: any) { return '<span class="bw-risk">' + _ZI.w + ' ' + String(r).replace(/</g, '&lt;') + '</span>' }).join('')
      }
      if (!html) html = '<span>Scanning market...</span>'
      reasonsEl.innerHTML = html
    }
  })()

  // ── AUB sync — update data badges from brain state ──
  if (typeof w._aubUpdateDataBadge === 'function') w._aubUpdateDataBadge()
  // ── NEURON COMPAT (setNeuron still called by updateNeurons) ──
  updateNeurons()
  updateOrderFlow()

  // ── MARKET CORE REACTOR — feed real data to Canvas visualization ──
  if (w.MarketCoreReactor) {
    try {
      var clamp = function (v: number, lo: number, hi: number) { return v < lo ? lo : v > hi ? hi : v }
      // --- TREND (0→1): ADX/50 + abs(slope)/2 + SuperTrend confirm ---
      const _mcrAdx = regDat.adx || 0
      const _mcrSlope = regDat.slope20 || 0
      const _stDir = (getSignalData().signals).find((s: any) => s.name && s.name.toLowerCase().includes('supertrend'))
      const _stMatch = _stDir ? (_stDir.direction === dir || _stDir.side === dir) : false
      const _trendVal = clamp(_mcrAdx / 50, 0, 1) * 0.6 + clamp(Math.abs(_mcrSlope) / 2, 0, 1) * 0.3 + (_stMatch ? 0.1 : 0)

      // --- FLOW (0→1): power-curve blendBuy + OF.z + detectors ---
      const _blendBuy = (typeof BR !== 'undefined' && BR.ofi) ? BR.ofi.blendBuy : 50
      const _flowRaw = Math.abs((_blendBuy || 50) - 50) / 50
      const _flowScaled = Math.pow(_flowRaw, 0.6)
      const _ofZ = (typeof w.OF !== 'undefined' && w.OF.z) ? w.OF.z : 0
      const _flowZ = clamp(Math.abs(_ofZ) / 2, 0, 1)
      const _flowBonus = (typeof w.OF !== 'undefined' && ((w.OF.abs && w.OF.abs.active) || (w.OF.dFlip && w.OF.dFlip.active))) ? 0.15 : 0
      const _flowVal = clamp(0.45 * _flowScaled + 0.40 * _flowZ + 0.15 * _flowBonus, 0, 1)

      // --- VOLUME (0→1): continuous ratio from klines ---
      let _volVal = 0.3
      if (klines.length >= 25) {
        const _recentV = klines.slice(-5).reduce((a: number, k: any) => a + (k.volume || 0), 0) / 5
        const _baseV = klines.slice(-25, -5).reduce((a: number, k: any) => a + (k.volume || 0), 0) / 20
        const _volRatio = _baseV > 0 ? _recentV / _baseV : 1
        const _volNorm = clamp((_volRatio - 0.5) / 1.5, 0, 1)
        _volVal = _volNorm * _volNorm * (3 - 2 * _volNorm) // smoothstep
      }

      // --- VOLATILITY (0→1): ATR% + wickChaos + volMode ---
      const _atrPct2 = BR.regimeAtrPct || 0
      const _wickChaos = (typeof RegimeEngine !== 'undefined' && RegimeEngine._wickChaos) ? RegimeEngine._wickChaos(klines, 10) : 0
      const _volExpansion = (regDat.volMode === 'expansion') ? 0.2 : 0
      const _volatVal = clamp(_atrPct2 / 3, 0, 1) * 0.5 + clamp(_wickChaos / 80, 0, 1) * 0.3 + _volExpansion

      // --- MOMENTUM (0→1): RSI distance + signal ratio + slope ---
      const _rsi5m2 = (getRSI('5m')) || 50
      const _bullC = getSignalData().bullCount
      const _bearC = getSignalData().bearCount
      const _sigTotal2 = _bullC + _bearC || 1
      const _momVal = clamp(Math.abs(_rsi5m2 - 50) / 50, 0, 1) * 0.4
        + clamp(Math.abs(_bullC - _bearC) / _sigTotal2, 0, 1) * 0.3
        + clamp(Math.abs(_mcrSlope) / 2, 0, 1) * 0.3

      // --- STRUCTURE (0→1): magnet proximity + organization + range ---
      let _magnetScore = 0.5
      if (w.S.magnets && w.S.magnets.above && w.S.magnets.above.length && w.S.magnets.below && w.S.magnets.below.length && getPrice() > 0) {
        const _aboveDists = w.S.magnets.above.map(function (m: any) { return Math.abs((typeof m === 'number' ? m : m.price || 0) - getPrice()) / getPrice() }).filter(function (d: any) { return Number.isFinite(d) })
        const _belowDists = w.S.magnets.below.map(function (m: any) { return Math.abs((typeof m === 'number' ? m : m.price || 0) - getPrice()) / getPrice() }).filter(function (d: any) { return Number.isFinite(d) })
        if (_aboveDists.length && _belowDists.length) {
          const _nearAbove = Math.min.apply(null, _aboveDists)
          const _nearBelow = Math.min.apply(null, _belowDists)
          _magnetScore = 1 - clamp(Math.min(_nearAbove, _nearBelow) / 0.02, 0, 1)
        }
      }
      const _orgScore = 1 - clamp(_wickChaos / 100, 0, 1)
      let _rangeScore = 0.5
      if (klines.length >= 20) {
        const _rKl = klines.slice(-20)
        const _hh = Math.max.apply(null, _rKl.map(function (k: any) { return k.high }))
        const _ll = Math.min.apply(null, _rKl.map(function (k: any) { return k.low }))
        const _rangePct = getPrice() > 0 ? (_hh - _ll) / getPrice() : 0
        _rangeScore = clamp(_rangePct / 0.04, 0, 1)
      }
      const _structVal = clamp(0.35 * _magnetScore + 0.35 * _orgScore + 0.30 * _rangeScore, 0, 1)

      // --- GATES (count passing out of 7 key gates) ---
      const _safetyG = BR._safetyCache || {}
      const _ctxG = BR._ctxCache || {}
      const _gateChecks = [_safetyG.regime, (_ctxG.mtf), _safetyG.news, (_ctxG.flow), _safetyG.risk, _safetyG.cooldown, _safetyG.session]
      const _gatesOpen = _gateChecks.filter(Boolean).length

      // --- DIRECTION ---
      const _mcrDir = _bullC >= _bearC ? 'LONG' : 'SHORT'

      // --- CONFIDENCE (confluence score, 0-100) ---
      const _confScore = BM.confluenceScore || 0

      w.MarketCoreReactor.update({
        trend: _trendVal,
        flow: _flowVal,
        volume: _volVal,
        volatility: _volatVal,
        momentum: _momVal,
        structure: _structVal,
        gatesOpen: _gatesOpen,
        gatesTotal: 7,
        direction: _mcrDir,
        confidence: _confScore,
        entryScore: BM.entryScore || 0
      })
    } catch (_mcrErr) { /* silently continue */ }
  }
}

// ── CIRCUIT BRAIN render hook ── [B1 FIX] removed parse-time call; now only called from runGrandUpdate

// ══════════════════════════════════════════════════════════════════
// RAF ANIMATION ENGINE — orb pulse, radar sweep, particles
// SVG + CSS only, no WebGL — performant on Android
// ════════��═════════════════════════════════════════════════════════
// [MOVED TO TOP] ZANIM


// Z Particles animation
export function initZParticles(): void {
  const wrap = el('zncParticles')
  if (!wrap) return
  wrap.innerHTML = ''
  const colors = ['#39ff14', '#00ffcc', '#f0c040', '#aa44ff', '#ff8800']
  for (let i = 0; i < 18; i++) {
    const d = document.createElement('div')
    d.className = 'znc-particle'
    const x = Math.random() * 100
    const y = Math.random() * 100
    const dx = (Math.random() - 0.5) * 80
    const dy = (Math.random() - 0.5) * 80
    const dur = 3 + Math.random() * 5
    const col = colors[Math.floor(Math.random() * colors.length)]
    d.style.cssText = `left:${x}%;top:${y}%;background:${col};--dx:${dx}px;--dy:${dy}px;--dur:${dur}s;animation-delay:${Math.random() * dur}s`
    wrap.appendChild(d)
  }
}

export function zAnimFrame(ts: any): void {
  if (!w.ZANIM.running) return
  // [PERF] skip render work when tab hidden
  if (document.hidden) { requestAnimationFrame(zAnimFrame); return }
  const dt = ts - w.ZANIM.lastFrame
  w.ZANIM.lastFrame = ts

  // RADAR SWEEP (SVG rotate)
  w.ZANIM.radarAngle = (w.ZANIM.radarAngle + dt * 0.12) % 360
  const sweep = el('zncRadarSweep')
  if (sweep) sweep.setAttribute('transform', `rotate(${w.ZANIM.radarAngle},110,110)`)

  // ORB PULSE (brightness via filter on core circle)
  w.ZANIM.orbScale += w.ZANIM.orbDir
  if (w.ZANIM.orbScale > 1.08 || w.ZANIM.orbScale < 0.95) w.ZANIM.orbDir *= -1
  const core = el('zncCore')
  if (core) core.setAttribute('opacity', String(0.6 + w.ZANIM.orbScale * 0.12))

  // SCORE ARC GLOW synapse intensity
  const score = BM.entryScore || 0
  const synapseOpacity = 0.1 + (score / 100) * 0.5
  for (let i = 0; i < 9; i++) {
    const syn = el('zsyn' + i)
    if (syn) {
      const base = i < 3 ? '#39ff14' : i < 6 ? '#f0c040' : '#aa44ff'
      syn.setAttribute('stroke', base + Math.round(synapseOpacity * 255).toString(16).padStart(2, '0'))
      syn.setAttribute('stroke-width', (0.8 + synapseOpacity * 1.5).toString())
    }
  }

  requestAnimationFrame(zAnimFrame)
}

export function startZAnim(): void {
  if (w.ZANIM.running) return
  w.ZANIM.running = true
  w.ZANIM.lastFrame = performance.now()
  requestAnimationFrame(zAnimFrame)
}


// ══════════════════════════════════════════════════════════
// ZEUS EXECUTION OVERLAY — cinematic entry + exit popups
// Called from trade engine only. Never from UI directly.
// ══════════════════════════════════════════════════════════
// [MOVED TO TOP] _execQueue
// [MOVED TO TOP] _execActive


// Brain dirty cache
const _brainDirtyCache: any = {}
export function _brainDirtySet(key: any, val: any): boolean {
  if (_brainDirtyCache[key] === val) return false // no change — skip
  _brainDirtyCache[key] = val
  return true // changed — allow update
}
// Safe DOM update with dirty flag
export function _brainSafeSet(elId: any, val: any, attr: string = 'textContent'): void {
  if (!_brainDirtySet(elId, val)) return
  const e = el(elId)
  if (e) (e as any)[attr] = val
}


// FIX v118: getBrainViewSnapshot() — sursă unică de adevăr pentru Brain HUD
// Citește EXCLUSIV din BM/AT/S/_SAFETY — zero DOM reads.
// Dacă un câmp nu există încă, returnează '—' (nu 0, nu fake).
export function getBrainViewSnapshot(): any {
  const _s = typeof w.S !== 'undefined' ? w.S : {}
  const _bm = typeof BM !== 'undefined' ? BM : {}
  const _at = typeof w.AT !== 'undefined' ? w.AT : {}
  const _sf = typeof w._SAFETY !== 'undefined' ? w._SAFETY : {}
  const _br = typeof BR !== 'undefined' ? BR : {}

  const mode = (_s.mode || 'assist').toUpperCase()
  const profile = (_s.profile || 'fast').toUpperCase()
  const runMode = !!getATEnabled()

  // Data feed — aceeași sursă ca bannerul
  const price = _s.price || 0
  const stalled = !!(_sf.dataStalled || _s.dataStalled)
  const recon = !!_sf.isReconnecting
  const hasWS = !!(_s.bnbOk || _s.bybOk)
  const feedStatus = recon ? 'RECON' : stalled ? 'STALL' : (hasWS && price > 0) ? 'LIVE' : price > 0 ? 'DELAY' : 'WAIT'

  // Regime — din ultimul calc real
  const regime = _br.regime || null
  const st = _bm.structure || {}
  const adx = (st.adx != null && st.adx !== 0) ? st.adx.toFixed(1) : '—'
  const vol = st.volMode || '—'
  const struct = st.structureLabel || '—'

  // Safety gates — din cache (setat de renderBrainCockpit)
  const safety = _br._safetyCache || null
  const ctx = _br._ctxCache || null
  const gatesPass = safety ? Object.values(safety).filter(Boolean).length : null
  const gatesTotal = safety ? Object.keys(safety).length : null

  // Score
  const score = _bm.entryScore || 0

  // Risk/Cooldown
  const kill = !!_at.killTriggered
  const protect = !!_bm.protectMode
  const cdMs = typeof _getCooldownMs === 'function' ? _getCooldownMs() : 0
  const cdLeft = Math.max(0, Math.round((cdMs - (Date.now() - (_at.lastTradeTs || 0))) / 60000))

  // Brain state
  const state = _br.state || 'scanning'

  return {
    mode, profile, runMode, price, feedStatus, hasWS, regime, adx, vol, struct,
    gatesPass, gatesTotal, safety, ctx, score, kill, protect, cdLeft, state
  }
}

// ══════════════════════════════════════════════════════════════════
// CIRCUIT BRAIN RENDER — v117
// Reads existing state, updates circuit brain module nodes only.
// Zero logic changes.
// ══════════════════════════════════════════════════════════════════

// Circuit brain render (updated for Neural Core v2.0)
export function renderCircuitBrain(): void {
  // ── helpers ──
  const cbn = (id: string) => document.getElementById(id)
  const setNode = (boxId: any, valId: any, subId: any, statusCls: any, valTxt: any, subTxt?: any) => {
    const box = cbn(boxId), val = cbn(valId), sub = cbn(subId)
    if (box) box.className = 'nc-sn-box ' + statusCls
    if (val) { val.className = 'nc-sn-val ' + statusCls; val.textContent = valTxt }
    if (sub && subTxt !== undefined) sub.textContent = subTxt
  }
  const svgNode = (id: any, statusCls: any) => {
    const n = cbn(id); if (!n) return
    const animMap: any = {
      ok: 'cbPulseOk 2.5s ease-in-out infinite',
      warn: 'cbPulseWarn 3.0s ease-in-out infinite',
      bad: 'cbPulseBad 2.2s ease-in-out infinite',
      mem: 'cbPulseMem 3.8s ease-in-out infinite',
      vis: 'cbPulseNeutral 2.9s ease-in-out infinite',
      neutral: 'cbPulseNeutral 3.2s ease-in-out infinite',
    }
    const colMap: any = {
      ok: '#00E5FF', // ACTIVE / ONLINE
      warn: '#FFB000', // EXEC / ACTION
      bad: '#C1121F', // RISK / FAIL
      mem: '#2962FF', // DOMINANT / POWER (cobalt)
      vis: '#00E5FF', // VISION / FEED (cyan)
      neutral: '#4B5D73'  // INACTIVE / GUNMETAL
    }
    n.setAttribute('stroke', colMap[statusCls] || '#4B5D73')
    ;(n as any).style.animation = animMap[statusCls] || animMap.neutral
  }

  // ── 1. GATES summary ──
  try {
    // FIX v118: citim din BRAIN._safetyCache (real state), NU din DOM LED class-uri
    const _sf = (typeof BR !== 'undefined' && BR._safetyCache) ? BR._safetyCache : null
    const _cx = (typeof BR !== 'undefined' && BR._ctxCache) ? BR._ctxCache : null
    let gOk = 0, gTotal = 0
    if (_sf && _cx) {
      const allGatesSnap = Object.assign({}, _sf, { mtfCtx: _cx.mtf, flowCtx: _cx.flow, triggerCtx: _cx.trigger, antifakeCtx: !((typeof w._fakeout !== 'undefined' && w._fakeout.invalid)) })
      gTotal = Object.keys(allGatesSnap).length
      gOk = Object.values(allGatesSnap).filter(Boolean).length
    } else {
      // fallback DOM (înainte de primul renderBrainCockpit)
      const safetyIds = ['led-risk', 'led-spread', 'led-cooldown', 'led-news', 'led-session', 'led-noopposite', 'led-regime']
      gTotal = safetyIds.length
      safetyIds.forEach(id => { const e = document.getElementById(id); if (e && e.className && e.className.includes('ok')) gOk++ })
    }
    const allOk = gTotal > 0 && gOk === gTotal
    const gCls = allOk ? 'ok' : gOk >= gTotal - 1 ? 'warn' : 'bad'
    // sub-linie: spread + news + cooldown din state real
    const cdLeft = (typeof _getCooldownMs === 'function') ? Math.max(0, Math.round((_getCooldownMs() - (Date.now() - ((getATLastTradeTs()) || 0))) / 60000)) : 0
    const gSub = [
      _sf ? ('Spread:' + (_sf.spread ? 'OK' : 'FAIL')) : '—',
      _sf ? ('News:' + (_sf.news ? 'OK' : 'BLK')) : '—',
      cdLeft > 0 ? ('CD:' + cdLeft + 'm') : 'CD:OK'
    ].join(' · ')
    useBrainStatsStore.getState().patchStats({
      gates: { text: gOk + '/' + gTotal, sub: gSub, tone: gCls as BrainStatsTone },
    })
    svgNode('cb-node-gates', gCls)
  } catch (_) { }

  // ── 2. REGIME ──
  try {
    // FIX v118: citim din BRAIN.regime (real state), NU din DOM text
    const _reg = (typeof BR !== 'undefined' && BR.regime) ? BR.regime : null
    const regLabels2: any = { trend: 'TREND ▲', range: 'RANGE —', breakout: 'BREAKOUT ↑', squeeze: 'SQUEEZE', panic: 'PANIC', unknown: '—' }
    const regTxt = _reg ? (regLabels2[_reg] || _reg.toUpperCase()) : '—'
    const regCls = _reg
      ? ({ trend: 'ok', range: 'neutral', breakout: 'ok', squeeze: 'warn', panic: 'bad', unknown: 'neutral' } as any)[_reg] || 'neutral'
      : 'neutral'
    // ADX/VOL din BM.structure (calculat de detectRegimeEnhanced)
    const _st = (typeof BM !== 'undefined' && BM.structure) ? BM.structure : null
    const adxVal = (_st && _st.adx) ? _st.adx.toFixed(1) : '—'
    const volVal = (_st && _st.volMode) ? _st.volMode : '—'
    const strVal = (_st && _st.structureLabel) ? _st.structureLabel : '—'
    const subTxt = ('ADX:' + adxVal + ' VOL:' + volVal + ' ' + strVal).slice(0, 28)
    useBrainStatsStore.getState().patchStats({
      regime: { text: regTxt.replace(' ▲', '').replace(' ↑', ''), sub: subTxt, tone: regCls as BrainStatsTone },
    })
    svgNode('cb-node-regime', regCls)
  } catch (_) { }

  // ── 3. SCORE (zncScoreNum & zncScoreLbl already updated by renderBrainCockpit) ──
  try {
    const score = (typeof BM !== 'undefined' ? BM.entryScore : 0) || 0
    void (document.getElementById('zncScoreLbl'))
    const scoreCls = score >= 65 ? 'ok' : score >= 50 ? 'warn' : 'bad'
    const scoreBox = cbn('cbn-score-box')
    if (scoreBox) scoreBox.className = 'nc-sn-box ' + scoreCls
    // Update score arc — r=48, circumf = 2π×48 ≈ 302
    const arc = cbn('zncScoreArc')
    if (arc) {
      const circum = 302
      arc.setAttribute('stroke-dasharray', (score / 100 * circum) + ' ' + circum)
      const col = score >= 65 ? '#39ff14' : score >= 50 ? '#f0c040' : '#ff3355'
      arc.setAttribute('stroke', col)
    }
    svgNode('cb-node-score', scoreCls)
  } catch (_) { }

  // ── 4. RISK RAILS (cooldown, kill, protect) ──
  try {
    // FIX v118: cooldown din calcul real, NU din cdEl.textContent (DOM)
    const kill = getATKillTriggered()
    const prot = (typeof BM !== 'undefined' && BM.protectMode)
    const cdMs = (typeof _getCooldownMs === 'function') ? _getCooldownMs() : 0
    const cdLeft = Math.max(0, Math.round((cdMs - (Date.now() - ((getATLastTradeTs()) || 0))) / 60000))
    const riskCls = kill || prot ? 'bad' : cdLeft > 0 ? 'warn' : 'vis'
    const riskVal = kill ? 'KILL' : prot ? 'PROTECT' : cdLeft > 0 ? cdLeft + 'm WAIT' : 'OK'
    const riskSub = 'Cooldown ' + (cdLeft > 0 ? cdLeft + 'm' : 'OFF') + ' · DD%'
    useBrainStatsStore.getState().patchStats({
      risk: { text: riskVal, sub: riskSub, tone: riskCls as BrainStatsTone },
    })
    svgNode('cb-node-risk', riskCls)
  } catch (_) { }

  // ── 5. DATA FEED ──
  try {
    // FIX v118: aceeași sursă ca bannerul de feed (S.bnbOk/S.bybOk/S.dataStalled/_SAFETY.isReconnecting)
    // S.reconnecting era NICIODATĂ setat — fix: folosim _SAFETY.isReconnecting
    const price = (typeof w.S !== 'undefined' && getPrice()) ? getPrice() : 0
    const stall = (typeof w.S !== 'undefined' && w.S.dataStalled) || (typeof w._SAFETY !== 'undefined' && w._SAFETY.dataStalled)
    const recon = (typeof w._SAFETY !== 'undefined' && w._SAFETY.isReconnecting)
    const hasWS = (typeof w.S !== 'undefined') && (w.S.bnbOk || w.S.bybOk)
    const dataCls = recon ? 'bad' : stall ? 'warn' : hasWS && price > 0 ? 'ok' : price > 0 ? 'warn' : 'neutral'
    const dataVal = recon ? 'RECON' : stall ? 'STALL' : hasWS && price > 0 ? 'LIVE' : price > 0 ? 'DELAY' : 'WAIT'
    const sym = (typeof w.S !== 'undefined' && w.S.symbol) ? w.S.symbol.replace('USDT', '') : '—'
    setNode('cbn-data-box', 'cbn-data-val', 'cbn-data-sub', dataCls, dataVal, sym + ' · ' + (price > 0 ? '$' + (price > 100 ? Math.round(price) : price.toFixed(2)) : '—'))
    svgNode('cb-node-data', dataCls)
  } catch (_) { }

  // ── 6. AUTO-TRADE ──
  try {
    // FIX v118: citim din BRAIN.state + S.mode + S.profile (real state), NU din DOM
    const _brState = (typeof BR !== 'undefined' && BR.state) ? BR.state : 'scanning'
    const _mode = (typeof w.S !== 'undefined' && w.S.mode) ? w.S.mode.toUpperCase() : 'MANUAL'
    const _prof = (typeof w.S !== 'undefined' && w.S.profile) ? w.S.profile.toUpperCase() : 'FAST'
    const stLabels2: any = { scanning: 'SCANNING', analyzing: 'ANALYZING', ready: 'ARMED', trading: 'TRADE', protect: 'PROT', blocked: 'BLOCK' }
    const armTxt = (stLabels2[_brState] || _brState.toUpperCase()).slice(0, 8)
    const armCls = (_brState === 'ready' || _brState === 'armed') ? 'ok'
      : _brState === 'trading' ? 'ok'
        : (_brState === 'protect' || _brState === 'blocked') ? 'bad'
          : 'mem'
    const subLine = _mode + ' · ' + _prof
    useBrainStatsStore.getState().patchStats({
      auto: { text: armTxt, sub: subLine.slice(0, 22), tone: armCls as BrainStatsTone },
    })
    svgNode('cb-node-auto', armCls)
  } catch (_) { }

  // ── 7. Sync state class + SVG visual state ──
  try {
    // brainViz compat — class name no longer required (Canvas system)
    void 0
  } catch (_) { }

  // ── 8. Inner orbit node values ──
  try {
    const elFn = (id: string, v: any) => { const e = cbn(id); if (e) e.textContent = v }
    // Flow
    const flowVal = (typeof BM !== 'undefined' && BM.flow != null) ? (typeof BM.flow === 'object' ? (BM.flow.cvd || '—').toUpperCase() : (typeof BM.flow === 'number' ? BM.flow.toFixed(1) : '—')) : '—'
    elFn('nc-flow-val', flowVal)
    // Volume mode
    const volMode = (typeof BM !== 'undefined' && BM.structure && BM.structure.volMode) ? BM.structure.volMode : '—'
    elFn('nc-vol-val', volMode)
    // Structure label
    const structLbl = (typeof BM !== 'undefined' && BM.structure && BM.structure.structureLabel) ? BM.structure.structureLabel : '—'
    elFn('nc-struct-val', structLbl)
    // Liquidity (from atmosphere if available)
    const liqVal = (typeof BM !== 'undefined' && BM.atmosphere && BM.atmosphere.liquidityScore != null) ? BM.atmosphere.liquidityScore.toFixed(0) : '—'
    elFn('nc-liq-val', liqVal)
    // Risk (from BRAIN neurons or safety)
    const riskN = (typeof BR !== 'undefined' && BR.neurons && BR.neurons.risk != null) ? BR.neurons.risk.toFixed(0) : '—'
    elFn('nc-risk-val', riskN)
    // ATR / Volatility
    const atrPct2 = (typeof BR !== 'undefined' && BR.regimeAtrPct != null) ? BR.regimeAtrPct.toFixed(2) + '%' : '—'
    elFn('nc-volat-val', atrPct2)
  } catch (_) { }

  // ── 9. Center info overlay ──
  try {
    const modeEl = cbn('nc-mode')
    const regimeEl = cbn('nc-regime')
    const confEl = cbn('nc-confidence')
    const scoreNumEl = cbn('zncScoreNum')
    if (modeEl) modeEl.textContent = (typeof w.S !== 'undefined' && w.S.mode) ? w.S.mode.toUpperCase() : 'MANUAL'
    if (regimeEl) {
      const reg = (typeof BR !== 'undefined' && BR.regime) ? BR.regime.toUpperCase() : '—'
      regimeEl.textContent = reg
    }
    if (confEl) {
      const atm = (typeof BM !== 'undefined' && BM.atmosphere) ? BM.atmosphere : null
      confEl.textContent = atm && atm.confidence != null ? 'CONF ' + atm.confidence.toFixed(0) + '%' : ''
    }
    // Score num colour class
    if (scoreNumEl) {
      const sc = (typeof BM !== 'undefined' ? BM.entryScore : 0) || 0
      scoreNumEl.className = 'nc-score-num ' + (sc >= 65 ? 'ok' : sc >= 50 ? 'warn' : 'bad')
    }
  } catch (_) { }
}

export function runGrandUpdate(): void {
  if (document.hidden) return // [PERF] skip cockpit rebuild when tab hidden
  // [PATCH MODE-SWITCH] Skip cockpit rebuild while mode switch modal is open
  if (w.__brainModeSwitching) return
  renderBrainCockpit()
  // FIX v118: renderCircuitBrain era apelat O SINGURĂ DATĂ la parse time — acum se refreshează la fiecare ciclu
  try { renderCircuitBrain() } catch (_) { }
}

// ─── BRAIN COCKPIT INIT — called from startApp (req 4, 8) ──────
// Was: IIFE that ran at parse time (caused race conditions)
// Now: explicit function called in PHASE 1 of boot sequence

// Grand update
// Brain cockpit init
export function _initBrainCockpit(): void {
  if (w._brainInitDone) {
    console.warn('[ZEUS] _initBrainCockpit() called twice — skipping')
    return
  }
  w._brainInitDone = true

  // Restore DSL mode from localStorage (user-scoped key)
  try {
    const _dslKey = w._zeusUserId ? 'zeus_dsl_mode:' + w._zeusUserId : 'zeus_dsl_mode'
    const savedDsl = localStorage.getItem(_dslKey) || localStorage.getItem('zeus_dsl_mode')
    if (savedDsl && ['atr', 'fast', 'swing', 'defensive', 'tp'].includes(savedDsl)) { const _dsl2 = (window as any).DSL; if (_dsl2) _dsl2.mode = savedDsl }
  } catch (_) { }

  // Single sync from S.* canonical state
  syncBrainFromState()

  // Market Core Reactor init (Canvas visualization)
  try {
    if (w.MarketCoreReactor) w.MarketCoreReactor.init()
  } catch (_) { }

  // Neuron coin LEDs
  initNeuroCoinLEDs()

  // Particles
  initZParticles()

  // Start RAF loop (single, req 8: one runRenderLoop)
  startZAnim()

  // First render after short delay [B3 FIX] reduced from 1500ms to 200ms
  setTimeout(runGrandUpdate, 200)

  // Single grandUpdate interval (req 8)
  // [PERF] 3000→5000ms — cockpit rebuild is heavy, 5s is sufficient
  if (!w._brainIntervalId && typeof w.Intervals !== 'undefined') {
    w._brainIntervalId = w.Intervals.set('grandUpdate', runGrandUpdate, 5000)
  }
}
// triggerExecCinematic lives in positions.js (loaded after brain.js)


// Track trade stats for protect mode — hook into closeDemoPos

// FIX v118: Reset automat la schimbare de zi (24h)


// ─── Market Regime Detection ─────────────────────────────────
export function detectMarketRegime(klines: any): string {
  if (!klines || klines.length < 50) return 'unknown'
  const last = klines.slice(-50)
  const closes = last.map((k: any) => k.close)
  void (last.map((k: any) => k.high))
  void (last.map((k: any) => k.low))
  void (last.map((k: any) => k.volume))

  // ATR for volatility measure
  const atrs = last.slice(1).map((k: any, i: number) =>
    Math.max(k.high - k.low, Math.abs(k.high - last[i].close), Math.abs(k.low - last[i].close)))
  const avgATR = atrs.reduce((a: number, b: number) => a + b, 0) / atrs.length
  const atrPct = avgATR / closes[closes.length - 1] * 100

  // Trend: EMA slope
  const calcEMA = (data: any, p: number) => { const k = 2 / (p + 1); let e = data[0]; return data.map((v: number) => { e = v * k + e * (1 - k); return e }) }
  const ema20 = calcEMA(closes, 20)
  const ema50 = calcEMA(closes, 50)
  const slope20 = (ema20[ema20.length - 1] - ema20[ema20.length - 10]) / ema20[ema20.length - 10] * 100

  // Range: price in tight band
  const priceRange = (Math.max(...closes) - Math.min(...closes)) / closes[closes.length - 1] * 100

  let regime = 'unknown'

  if (atrPct > 1.8) {
    regime = 'volatile'
  } else if (Math.abs(slope20) > 0.3 && (
    slope20 > 0 ? ema20[ema20.length - 1] > ema50[ema50.length - 1]
      : ema20[ema20.length - 1] < ema50[ema50.length - 1]
  )) {
    regime = 'trend'
  } else if (priceRange < 2.5) {
    regime = 'range'
  } else {
    regime = 'range'
  }

  // [FIX QA-H5] detectMarketRegime no longer writes BRAIN.regime / BM.regime.
  // Only detectRegimeEnhanced (called from renderBrainCockpit) is the single writer.
  // BRAIN.regime = regime;  // REMOVED — single writer: detectRegimeEnhanced
  // [FIX R8] REMOVED — confidence now written by detectRegimeEnhanced only
  // BRAIN.regimeConfidence = confidence;  // REMOVED — single writer
  // [FIX #36] REMOVED duplicate writes — regimeSlope/regimeAtrPct already set by detectRegimeEnhanced
  // BRAIN.regimeSlope = slope20;  // REMOVED — single writer: detectRegimeEnhanced
  // BRAIN.regimeAtrPct = atrPct;  // REMOVED — single writer: detectRegimeEnhanced
  // BM.regime = regime;  // REMOVED — single writer: detectRegimeEnhanced
  return regime
}

// ─── Order Flow Update ───────────────────────────────────────
export function updateOrderFlow(): any {
  // Use order book as proxy for OFI
  const bids = w.S.bids || []
  const asks = w.S.asks || []
  if (!bids.length || !asks.length) return

  const bidVol = bids.slice(0, 10).reduce((s: number, b: any) => s + b.q * b.p, 0)
  const askVol = asks.slice(0, 10).reduce((s: number, a: any) => s + a.q * a.p, 0)
  const total = bidVol + askVol || 1

  BR.ofi.buy = bidVol / total * 100
  BR.ofi.sell = askVol / total * 100

  // Also track trade tape delta from liquidation events
  const now = Date.now()
  const recent = (w.S.events || []).filter((e: any) => now - e.ts < 60000)
  const buyPressure = recent.filter((e: any) => e.isLong).reduce((s: number, e: any) => s + e.usd, 0)
  const sellPressure = recent.filter((e: any) => !e.isLong).reduce((s: number, e: any) => s + e.usd, 0)
  const tapeTot = buyPressure + sellPressure || 1

  // Blend OB and tape
  const blendBuy = (BR.ofi.buy * 0.6 + buyPressure / tapeTot * 100 * 0.4)
  const blendSell = 100 - blendBuy

  // Update UI
  const buyEl = el('ofiBuy'), sellEl = el('ofiSell')
  const buyPctEl = el('ofiBuyPct'), sellPctEl = el('ofiSellPct')
  if (buyEl) buyEl.style.width = blendBuy.toFixed(0) + '%'
  if (sellEl) sellEl.style.width = blendSell.toFixed(0) + '%'
  if (buyPctEl) buyPctEl.textContent = 'BUY ' + blendBuy.toFixed(0) + '%'
  if (sellPctEl) sellPctEl.textContent = 'SELL ' + blendSell.toFixed(0) + '%'

  BR.ofi.blendBuy = blendBuy
  return blendBuy
}

// ─── Adaptive Auto-Trade Params ──────────────────────────────
export function adaptAutoTradeParams(): void {
  if (!getATEnabled()) return
  // FIX debounce — only adapt max once every 5 minutes
  const now = Date.now()
  if (BR._lastAdaptTs && now - BR._lastAdaptTs < 300000) return
  BR._lastAdaptTs = now

  const recentTrades = getJournal().filter((t: any) => t.reason?.includes('AUTO')).slice(-6)
  if (recentTrades.length < 3) return

  const wins = recentTrades.filter((t: any) => t.pnl > 0).length
  const losses = recentTrades.length - wins
  const wr = wins / recentTrades.length

  const regime = BR.regime
  let newSL = getTCSL()
  let newSize = getTCSize()
  let adapted = false
  let reason = ''

  // If losing streak — tighten SL, reduce size
  if (losses >= 3) {
    newSL = Math.max(0.8, newSL * 0.85)
    newSize = Math.max(50, newSize * 0.75)
    adapted = true
    reason = `3 pierderi consecutive → SL redus la ${newSL.toFixed(1)}%, Size redus la $${Math.round(newSize)}`
  }
  // If winning streak — slightly increase size
  else if (wins >= 4 && wr >= 0.7) {
    newSize = Math.min(1000, newSize * 1.15)
    adapted = true
    reason = `Win streak ${wins}/${recentTrades.length} → Size crescut la $${Math.round(newSize)}`
  }

  // Regime adjustment (only widen SL if not in loss-protection mode)
  if (regime === 'volatile' && losses < 3) {
    newSL = Math.max(newSL, 2.5) // wider SL in volatile market
    adapted = true
    reason = (reason ? reason + ' | ' : '') + 'Piata volatila → SL extins la ' + newSL.toFixed(1) + '%'
  } else if (regime === 'range') {
    newSL = Math.min(newSL, 1.0) // tighter SL in range
    adapted = true
    reason = (reason ? reason + ' | ' : '') + 'Range → SL strans la ' + newSL.toFixed(1) + '%'
  }

  if (adapted) {
    const slEl = el('atSL'); if (slEl) slEl.value = newSL.toFixed(1)
    const sizeEl = el('atSize'); if (sizeEl) sizeEl.value = String(Math.round(newSize))
    _pushBrainAdaptParams({ sl: newSL, size: newSize, adjustCount: (BR.adaptParams.adjustCount || 0) + 1 })
    // [P1] Sync adapted values back to TC
    if (typeof w.TC !== 'undefined') { w.TC.slPct = newSL; w.TC.size = newSize }
    brainThink('trade', _ZI.bolt + ` ADAPTAT: ${reason}`)
    atLog('info', `[ADAPT] Parametri adaptati: ${reason}`)
  }
}
