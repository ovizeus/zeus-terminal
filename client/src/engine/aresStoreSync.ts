/* R28.2-B — Engine→Store UI sync adapter.
 *
 * Reads `window.ARES`, `ARES_MIND`, `ARES_DECISION`, `w.BM`, `w.S`, `w.AT`
 * on each aresUI render tick and publishes the derived UI state to the
 * Zustand store via `useAresStore.getState().patchUi(...)`.
 *
 * This is a DUAL-WRITER phase adapter: the imperative `_aresRender` in
 * `aresUI.ts` continues to write #ares-* nodes directly; this module
 * mirrors the same derivation into the store so that React components
 * can begin subscribing without a cutover. Subsequent R28.2-C..G lots
 * migrate components to subscribe to this store and remove the
 * corresponding imperative writes.
 */

import { useAresStore } from '../stores/aresStore'
import { ARES_DECISION } from './aresDecision'
import { ARES_MIND } from './aresMind'
import type {
  AresCognitiveUI,
  AresCoreState,
  AresDecisionLine,
  AresHistoryMark,
  AresObjective,
  AresPositionCard,
  AresStageUI,
  AresStatsUI,
  AresStoreUI,
  AresWalletUI,
  AresWoundState,
} from '../types/ares'

const w = window as any

const STAGES = [
  { name: 'SEED', from: 0, to: 1000, next: '1,000' },
  { name: 'ASCENT', from: 1000, to: 10000, next: '10,000' },
  { name: 'SOVEREIGN', from: 10000, to: 1000000, next: '1,000,000' },
] as const

const OBJ_DEFS = [
  { id: 0, from: 100, to: 1000, label: '100 \u2192 1,000', col: 'rgba(0,255,140,0.95)', colDim: 'rgba(0,255,140,0.55)' },
  { id: 1, from: 1000, to: 10000, label: '1,000 \u2192 10,000', col: 'rgba(70,200,255,0.95)', colDim: 'rgba(70,200,255,0.55)' },
  { id: 2, from: 10000, to: 1000000, label: '10,000 \u2192 1M', col: 'rgba(255,200,60,0.95)', colDim: 'rgba(255,200,60,0.55)' },
] as const

const EMOTION_MAP: Record<string, string> = {
  DETERMINED: 'Focused',
  RESILIENT: 'Recovering',
  FOCUSED: 'Calm',
  STRATEGIC: 'Ambition Rising',
  MOMENTUM: 'High Energy',
  FRUSTRATED: 'Pain Detected',
  DEFENSIVE: 'Guard Mode',
  REVENGE_GUARD: 'Revenge Guard',
}

function _rangeProgress(x: number, a: number, b: number): number {
  if (!Number.isFinite(x) || x <= a) return 0
  if (x >= b) return 1
  return (x - a) / (b - a)
}

function _core(st: any): AresCoreState {
  return {
    id: String(st?.current?.id || 'FOCUSED'),
    label: String(st?.current?.label || 'FOCUSED'),
    emoji: String(st?.current?.emoji || ''),
    color: String(st?.current?.color || '#6ef'),
    glow: String(st?.current?.glow || '#6ef8'),
    consecutiveLoss: Number(st?.consecutiveLoss || 0),
  }
}

function _wound(st: any, balance: number): AresWoundState {
  const sid = String(st?.current?.id || '')
  const cl = Number(st?.consecutiveLoss || 0)
  if (balance < 5 && balance >= 0) {
    return {
      visible: true,
      kind: 'mission_failed',
      text: ' MISSION FAILED \u2014 Wallet depleted ($' + balance.toFixed(2) + '). REFILL to resume trading.',
      color: '#ff0044',
    }
  }
  if ((sid === 'DEFENSIVE' || sid === 'REVENGE_GUARD') && cl >= 3) {
    return {
      visible: true,
      kind: 'wound',
      text: ' MORTAL WOUND \u2014 ' + cl + ' consecutive losses \u00b7 Risk Reduced',
      color: '',
    }
  }
  return { visible: false, kind: 'none', text: '', color: '' }
}

function _decision(): AresDecisionLine {
  try {
    const lastDec = ARES_DECISION?.getLastDecision?.()
    if (!lastDec) return { visible: false, shouldTrade: false, side: null, reasons: [], color: '' }
    const reasons = Array.isArray(lastDec.reasons) ? lastDec.reasons.slice(0, 3).map(String) : []
    if (lastDec.shouldTrade) {
      return {
        visible: true,
        shouldTrade: true,
        side: String(lastDec.side || ''),
        reasons,
        color: '#00ff88',
      }
    }
    return {
      visible: true,
      shouldTrade: false,
      side: null,
      reasons: reasons.slice(0, 2),
      color: '#ff8800',
    }
  } catch (_) {
    return { visible: false, shouldTrade: false, side: null, reasons: [], color: '' }
  }
}

function _stage(balance: number): AresStageUI {
  let active = STAGES[0] as typeof STAGES[number]
  for (const s of STAGES) { if (balance >= s.from) active = s }
  const pct = Math.min(100, Math.max(0, Math.round(
    ((balance - active.from) / (active.to - active.from)) * 100
  )))
  const filled = Math.floor(pct / 10)
  const bar = '\u2588'.repeat(filled) + '\u2591'.repeat(10 - filled) + ' ' + pct + '%'
  const complete = balance >= active.to
  return {
    name: active.name,
    from: active.from,
    to: active.to,
    pct,
    bar,
    next: complete ? '\u2713 COMPLETE' : 'Next: ' + active.next,
    complete,
  }
}

function _objectives(balance: number): AresObjective[] {
  const eq = balance > 0 ? balance : null
  return OBJ_DEFS.map((o) => {
    const prog = eq !== null ? _rangeProgress(eq, o.from, o.to) : 0
    const pct = Math.round(prog * 100)
    const notStarted = eq === null || eq <= o.from
    const done = prog >= 1
    const status: AresObjective['status'] = done ? 'done' : notStarted ? 'notstarted' : 'active'
    return {
      id: o.id,
      label: o.label,
      from: o.from,
      to: o.to,
      pct,
      status,
      color: o.col,
      colorDim: o.colDim,
    }
  })
}

function _objectivesTitle(balance: number): { text: string; color: string } {
  if (balance <= 0) return { text: 'OBJECTIVES', color: '#ff335566' }
  if (balance < 100) return { text: 'OBJECTIVES \u2014 SEED NOT FUNDED', color: '#f0c04099' }
  return { text: 'OBJECTIVES', color: '#0080ff66' }
}

function _wallet(): AresWalletUI {
  const wlt = w.ARES?.wallet || null
  const balance = Number(wlt?.balance || 0)
  const locked = Number(wlt?.locked || 0)
  const available = Number(wlt?.available != null ? wlt.available : (balance - locked))
  const realizedPnL = Number(wlt?.realizedPnL || 0)
  const fundedTotal = Number(wlt?.fundedTotal || 0)
  const openCnt = (typeof w.ARES !== 'undefined' && w.ARES.positions) ? w.ARES.positions.getOpen().length : 0
  const withdrawBlocked = (locked > 0 || openCnt > 0)
  return {
    balance,
    locked,
    available,
    realizedPnL,
    fundedTotal,
    withdrawEnabled: !withdrawBlocked,
    withdrawTip: withdrawBlocked ? 'Close all positions before withdrawing' : '',
    failBannerVisible: available <= 0 && balance > 0,
    failMessage: '',
  }
}

function _cognitive(): AresCognitiveUI {
  return {
    clarity: Number(ARES_MIND?.getClarity?.() || 0),
    predictionAccuracy: Number(ARES_MIND?.getPredictionAccuracy?.() || 0),
    pulseSpeed: Number(ARES_MIND?.getPulseSpeed?.() || 1),
  }
}

function _stats(st: any): AresStatsUI {
  const d = Number(st?.trajectoryDelta || 0)
  const predAcc = ARES_MIND?.getPredictionAccuracy?.()
  return {
    day: Math.floor(Number(st?.daysPassed || 0)) + ' / 365',
    delta: (d >= 0 ? '+' : '') + d + '%',
    prediction: predAcc != null ? predAcc + '%' : '\u2014',
    winRate: Number(st?.winRate10 || 0) + '%',
  }
}

function _positions(): AresPositionCard[] {
  try {
    const posApi = w.ARES?.positions
    if (!posApi?.getOpen) return []
    const open = posApi.getOpen() || []
    return open.map((p: any): AresPositionCard => ({
      id: String(p.id),
      side: String(p.side || ''),
      symbol: 'BTCUSDT',
      entry: Number(p.entryPrice || 0),
      size: Number(p.notional || 0),
      pnl: Number(p.uPnL || 0),
      pnlPct: Number(p.uPnLPct || 0),
      live: !!p.isLive,
      durationMs: Number(p.openedAt ? Date.now() - p.openedAt : 0),
      tag: p._slMovedBE ? 'BE' : undefined,
      closable: true,
    }))
  } catch (_) {
    return []
  }
}

function _history(st: any): AresHistoryMark[] {
  const arr = Array.isArray(st?.tradeHistory) ? st.tradeHistory : []
  return arr.slice(-40).map((x: any, i: number): AresHistoryMark => ({
    pnl: typeof x === 'number' ? x : 0,
    win: !!x,
    ts: i,
  }))
}

function _lobeColors(st: any): string[] {
  const sid = String(st?.current?.id || '')
  const cl = Number(st?.consecutiveLoss || 0)
  const isBad = sid === 'DEFENSIVE' || sid === 'REVENGE_GUARD'
  const isMortal = isBad && cl >= 3
  const reg = (typeof w.BM !== 'undefined' && w.BM.regime) ? String(w.BM.regime).toUpperCase() : '\u2014'
  const visionOk = reg !== '\u2014' && reg !== 'UNKNOWN' && reg !== 'STALLED'
  const visionClear = reg === 'STRONG_TREND' || reg === 'TREND' || reg === 'RANGE'
  const eqs = Number(st?.winRate10 > 0 ? st.winRate10 : -1)
  const ksActive = (typeof w.AT !== 'undefined' && w.AT.killSwitch)
  const C = { ok: '#00E5FF', bad: '#C1121F', warn: '#FFB000' }
  const frontal = isMortal ? C.bad : isBad ? C.warn : C.ok
  const temporal = cl >= 3 ? C.bad : cl >= 1 ? C.warn : C.ok
  const occipital = !visionOk ? C.bad : visionClear ? C.ok : C.warn
  const cerebel = eqs < 0 ? C.warn : eqs >= 70 ? C.ok : eqs >= 50 ? C.warn : C.bad
  const trunchi = ksActive ? C.bad : isMortal ? C.warn : C.ok
  return [frontal, temporal, occipital, cerebel, trunchi]
}

/** Publish the full UI slice to the store. Called at the start of _aresRender(). */
export function syncAresUIToStore(): void {
  try {
    const aresState = w.ARES?.getState?.()
    if (!aresState) return

    const balance = Number(w.ARES?.wallet?.balance || 0)
    const core = _core(aresState)
    const immPct = balance > 0 ? Math.min(100, +(balance / 10000).toFixed(2)) : 0
    const emotion = EMOTION_MAP[core.id] || ''
    const thoughts = Array.isArray(aresState.thoughtLines)
      ? aresState.thoughtLines.map(String)
      : []

    const partial: Partial<AresStoreUI> = {
      core,
      confidence: Number(aresState.confidence || 0),
      immPct,
      emotion,
      wound: _wound(aresState, balance),
      decision: _decision(),
      stage: _stage(balance),
      objectives: _objectives(balance),
      objectivesTitle: _objectivesTitle(balance),
      wallet: _wallet(),
      cognitive: _cognitive(),
      stats: _stats(aresState),
      positions: _positions(),
      closeAllVisible: (_positions().length >= 2),
      history: _history(aresState),
      lesson: String(aresState.lastLesson || ''),
      thoughts,
      lobeColors: _lobeColors(aresState),
    }
    useAresStore.getState().patchUi(partial)
  } catch (e) {
    if (import.meta.env?.DEV) console.warn('[aresStoreSync]', e)
  }
}
