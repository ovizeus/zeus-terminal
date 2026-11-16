// ZeuS Brain v7 — adaptorul DOAR-CITIRE (spec 1 si 3).
// buildRawFromZeusState() citeste starea pe care motorul o calculeaza deja si
// intoarce contractul `raw`. Nu cere nimic de la server (e chemat la fiecare cadru)
// si nu scrie nimic inapoi. Nimic din motor nu importa acest modul.
import { BM, BRAIN } from '../core/config'
import { usePositionsStore } from '../stores/positionsStore'
import { useBrainStore } from '../stores/brainStore'
import { getATMode } from '../services/stateAccessors'
import { getSymPrice } from '../data/marketDataPositions'
import { N, type Mode } from './brainStrings'
import { satsOf } from './brainPrefs'
import { modeOf, progressOf, emaStep, DeadDetector, type Num, type Raw, type RawSat } from './brainDerived'

const w = window as any

// Ordinea axelor in payload-ul trimis de engine/brain.ts → MarketCoreReactor.update().
const AXIS_KEYS = ['trend', 'delta', 'flow', 'oi', 'volume', 'funding', 'volatility', 'imbalance', 'momentum', 'sentiment', 'structure', 'liquidity']
// Ordinea portilor (spec 3) → cheile din BRAIN._safetyCache (engine/brain.ts computeSafetyGates).
const GATE_KEYS = ['risk', 'spread', 'cooldown', 'news', 'session', 'noOpposite', 'regime']
// Porti fara date reale in spate: motorul pune `spread: true` cu comentariul
// „no real spread data". Se arata NECUNOSCUTE, nu „trece" (cerut de operator).
export const GATES_NOT_BACKED = new Set([1])
const AXES_STALE_MS = 60_000
const SIGNAL_MS = 2200

export const shortSym = (s: string) => String(s || '').toUpperCase().replace(/USDT$|USDC$|BUSD$/, '')

function finite01(v: unknown): Num {
  if (v == null) return null
  const n = +v
  return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : null
}

/** Axele RT, din ultimul pachet trimis de creier radarului. Pachet vechi → null (asteptam). */
export function axesFromPayload(p: any, nowMs: number): Num[] {
  if (!p || !(nowMs - (p.__ts || 0) < AXES_STALE_MS)) return new Array(N).fill(null)
  return AXIS_KEYS.map((k) => finite01(p[k]))
}

/** Portile: din aceeasi cache care aprinde LED-urile din SAFETY GATES. Fara cache → toate necunoscute. */
export function gatesFrom(cache: any): { failing: number[]; unknown: number[] } {
  if (!cache || typeof cache !== 'object') return { failing: [], unknown: [0, 1, 2, 3, 4, 5, 6] }
  const failing: number[] = [], unknown: number[] = []
  GATE_KEYS.forEach((k, i) => {
    if (GATES_NOT_BACKED.has(i) || typeof cache[k] !== 'boolean') unknown.push(i)
    else if (cache[k] === false) failing.push(i)
  })
  return { failing, unknown }
}

// [2026-11-16] Satelitii = lista FIXA din preferintele radarului (brainPrefs), nu primele
// din scaner. Fiecare isi pastreaza coltul (indexul din lista). Scorul si directia se iau in
// continuare din scaner (`MSCAN.data[sym]`); o moneda nescanata arata „—".
export function satsFrom(scan: any, main: string, sats: string[]): RawSat[] {
  const m = String(main || '').toUpperCase()
  const out: RawSat[] = []
  sats.slice(0, 3).forEach((full, slot) => {
    const r = scan && typeof scan === 'object' ? scan[full] : null
    const sc = r ? Number(r.score) : NaN
    const mode: Mode = r && r.dir === 'bull' ? 'LONG' : r && r.dir === 'bear' ? 'SHORT' : 'RANGE'
    // Scanerul nu calculeaza cele 12 axe pe moneda → satelit desenat ca cerc (spec 3).
    // principala ramane in coltul ei, doar marcata (colturi fixe, cerut de operator)
    out.push({ symbol: shortSym(full), full, axes: null, score: Number.isFinite(sc) ? sc : null, mode, slot, isMain: full === m })
  })
  return out
}

export type Env = 'DEMO' | 'TESTNET' | 'REAL'
/** Mediul activ acum: DEMO, sau pentru live TESTNET / REAL (din `_executionEnv`). */
export function currentEnv(): Env {
  if (getATMode() !== 'live') return 'DEMO'
  return w._executionEnv === 'REAL' ? 'REAL' : 'TESTNET'
}

/** Pozitiile reale din modul curent (demo sau live). */
export function currentPositions(): any[] {
  try {
    const st = usePositionsStore.getState()
    const live = getATMode() === 'live'
    const list = live ? st.livePositions : st.demoPositions
    return (Array.isArray(list) ? list : []).filter((p: any) => p && !p.closed)
  } catch { return [] }
}

// ── stare intre cadre (lentilele derivate, semnalul, somnul) ──
let _tf: Num[] = new Array(N).fill(null)
let _sl: Num[] = new Array(N).fill(null)
let _lastMs = 0
let _prevReady = false
let _lastReadyMs = 0
let _sigUntil = 0
const _dead = new DeadDetector()
let _closeMsg = '', _closeUntil = 0

/** Mesajul de inchidere (2,5 s), pus de recorder la o inchidere REALA. */
export function setCloseMsg(msg: string, nowMs: number): void { _closeMsg = msg; _closeUntil = nowMs + 2500 }

export function _resetAdapterForTest(): void {
  _tf = new Array(N).fill(null); _sl = new Array(N).fill(null); _lastMs = 0
  _prevReady = false; _lastReadyMs = 0; _sigUntil = 0; _closeMsg = ''; _closeUntil = 0
}

export function buildRawFromZeusState(nowMs: number = Date.now()): Raw {
  const S = w.S || {}
  const payload = w.__zeusBrainAxes
  const rt = axesFromPayload(payload, nowMs)
  const dt = _lastMs ? (nowMs - _lastMs) / 1000 : 0
  _lastMs = nowMs
  // Lentilele TIMEFRAME si SLOW nu exista ca valori in motor: EMA din RT (spec 3, „derived, not engine").
  _tf = emaStep(_tf, rt, 0.025, dt)
  _sl = emaStep(_sl, _tf, 0.007, dt)

  const g = gatesFrom((BRAIN as any)?._safetyCache)
  const c = Number((BM as any)?.confluenceScore)
  const conf: Num = Number.isFinite(c) ? Math.round(c) : null
  const t = Number((BM as any)?.confMin)
  const thr: Num = Number.isFinite(t) && t > 0 ? t : null

  const bull = payload && Number.isFinite(+payload.bullCount) ? +payload.bullCount : null
  const bear = payload && Number.isFinite(+payload.bearCount) ? +payload.bearCount : null
  const { mode, label } = modeOf(bull, bear, (BRAIN as any)?.regime)

  // SIGNAL CONFIRMED: starea „ready" a creierului (cea care scrie „SIGNAL … CONFIRMED! … SENDING ORDER").
  // Starea are doi scriitori, deci tinem 5 s de pauza intre doua aprinderi.
  let ready = false
  try { ready = useBrainStore.getState().brainState === 'ready' } catch { ready = false }
  if (ready && !_prevReady && nowMs - _lastReadyMs > 5000) _sigUntil = nowMs + SIGNAL_MS
  if (ready) _lastReadyMs = nowMs
  _prevReady = ready

  const main = String(S.symbol || 'BTCUSDT').toUpperCase()
  const positions = currentPositions()
  const mp = positions.find((p: any) => String(p.sym || '').toUpperCase() === main && p.autoTrade)
    || positions.find((p: any) => String(p.sym || '').toUpperCase() === main)
  let position: Raw['position'] = null
  if (mp) {
    const side: 'LONG' | 'SHORT' = mp.side === 'SHORT' ? 'SHORT' : 'LONG'
    let mark: number | null = null
    try { mark = getSymPrice(mp) } catch { mark = null }
    const pr = progressOf(side, +mp.entry || 0, +(mark || 0), +mp.sl || 0, +mp.tp || 0)
    const size = +mp.size || 0
    const pnl = Number(mp.pnl)
    // Acelasi procent ca randul pozitiei (components/dock/PositionRows.tsx).
    const pnlPct: Num = size > 0 && Number.isFinite(pnl) ? (pnl / size) * 100 : null
    position = { symbol: shortSym(main), side, pnlPct, progress: pr.progress, noTp: pr.noTp }
  }

  const dead = _dead.update(nowMs, positions.length > 0, g.failing.includes(4), rt[4], rt[6], conf, thr)
  return {
    rt, tf: _tf.slice(), sl: _sl.slice(),
    att: null,      // FALLBACK: motorul nu publica atentia ML pe axe
    ml: null,       // FALLBACK: motorul nu publica o incredere ML de intrare
    gatesFailing: g.failing, gatesUnknown: g.unknown,
    conf, thr, mode, modeLabel: label,
    signalActive: nowMs < _sigUntil,
    dead,
    position,
    closeMsg: nowMs < _closeUntil ? _closeMsg : '',
    main: shortSym(main),
    sats: satsFrom(w.MSCAN?.data, main, satsOf(main)),
  }
}

/** Schimba moneda principala cu functia EXISTENTA din Zeus. */
export function switchMain(fullSym: string): void {
  try { if (typeof w.setSymbol === 'function') w.setSymbol(fullSym) } catch { /* nimic */ }
}

export function currentUid(): string | null {
  const u = w._zeusUserId
  return u != null && String(u) !== '' ? String(u) : null
}
export function currentProfile(): string | null {
  const p = String(w.S?.profile || '').toLowerCase()
  return p === 'fast' ? 'FAST' : p === 'swing' ? 'SWING' : p === 'defensive' ? 'DEF' : null
}
