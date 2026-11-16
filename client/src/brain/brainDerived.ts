// ZeuS Brain v7 — valori derivate DOAR pentru afisaj (port [DERIVED] + functii pure).
// Nimic de aici nu e citit de motor (spec 0.2). Intrari = date reale (brainAdapter).
import { N, MODECOL, MC, PRE_MOODS, type Mode, type Mood, type Rgb } from './brainStrings'

export type Num = number | null

export interface RawPosition {
  symbol: string
  side: 'LONG' | 'SHORT'
  pnlPct: Num
  progress: Num          // −1..+1; null = fara SL → aura ascunsa
  noTp: boolean
}
export interface RawSat { symbol: string; full: string; axes: Num[] | null; score: Num; mode: Mode; slot?: number }
export interface Raw {
  rt: Num[]; tf: Num[]; sl: Num[]
  att: Num[] | null
  ml: Num
  gatesFailing: number[]
  gatesUnknown: number[]
  conf: Num
  thr: Num
  mode: Mode
  modeLabel: string
  signalActive: boolean
  dead: boolean
  position: RawPosition | null
  closeMsg: string
  main: string
  sats: RawSat[]
}

export interface StSat { s: string; full: string; v: Num[] | null; c: Rgb; sc: Num; cons: boolean; slot: number }
export interface St {
  rt: Num[]; tf: Num[]; sl: Num[]; att: Num[] | null; ml: Num
  fails: number[]; unk: number[]
  conf: Num; thr: Num
  hes: boolean; div: number; zz: boolean
  c: Rgb; n: string
  pos: { sym: string; dir: 1 | -1; pnl: Num; pct: Num; noTp: boolean } | null
  posMsg: string
  mood: [Mood, string]
  cons: number
  sats: StSat[]
  main: string
  sig: boolean
  i?: number
  evt?: string | null
}

export const clamp01 = (x: Num | undefined): number => Math.max(0, Math.min(1, x == null || !Number.isFinite(x) ? 0 : x))
export const dirOf = (m: Mode): number => (m === 'SHORT' ? -1 : m === 'RANGE' ? 0 : 1)

/** Asemanarea a doua forme (spec 7.4): 1 − media|a−b|·2,2, intre 0 si 1. */
export function simil(a: Num[], b: Num[]): number {
  const n = Math.min(a.length, b.length)
  if (!n) return 0
  let s = 0
  for (let i = 0; i < n; i++) s += Math.abs(clamp01(a[i]) - clamp01(b[i]))
  return Math.max(0, Math.min(1, 1 - (s / n) * 2.2))
}

/** Forma la intrare: lipsurile devin 0,1 (podeaua desenata), spec 4.2. */
export function entryShapeOf(rt: Num[]): number[] {
  return rt.map((x) => (x == null || !Number.isFinite(x) ? 0.1 : Math.round(clamp01(x) * 1000) / 1000))
}

/** EMA pe cadre, independenta de rata de cadre (α dat la 60 fps). O axa fara valoare ramane null. */
export function emaStep(prev: Num[], next: Num[], alpha60: number, dt: number): Num[] {
  const a = 1 - Math.pow(1 - alpha60, Math.max(0, Math.min(0.25, dt)) * 60)
  const out: Num[] = new Array(N).fill(null)
  for (let i = 0; i < N; i++) {
    const x = next[i]
    if (x == null || !Number.isFinite(x)) { out[i] = null; continue }
    const p = prev[i]
    out[i] = p == null ? x : p + (x - p) * a
  }
  return out
}

/** Directia + regimul → modul afisat. Regim necunoscut → RANGE (spec 3). */
export function modeOf(bull: Num, bear: Num, regime: unknown): { mode: Mode; label: string } {
  const r = String(regime || '').toLowerCase()
  if (r === 'squeeze') return { mode: 'SQUEEZE', label: 'SQUEEZE' }
  // Regimurile reale (engine/regimeEnhanced.ts): trend, breakout, range, squeeze, panic, unknown.
  if (r === 'trend' || r === 'breakout' || r === 'panic') {
    const b = Number(bull) || 0, s = Number(bear) || 0
    if (b === 0 && s === 0) return { mode: 'RANGE', label: 'RANGE' }
    return b >= s ? { mode: 'LONG', label: 'LONG MODE' } : { mode: 'SHORT', label: 'SHORT MODE' }
  }
  return { mode: 'RANGE', label: 'RANGE' }
}

/** Pozitia pe drumul SL ↔ TP (spec 3). Fara SL → null. Fara TP → inelul exterior = 2R. */
export function progressOf(side: 'LONG' | 'SHORT', entry: number, mark: number, sl: number, tp: number): { progress: Num; noTp: boolean } {
  if (!(entry > 0) || !(mark > 0) || !(sl > 0)) return { progress: null, noTp: !(tp > 0) }
  const risk = Math.abs(entry - sl)
  if (!(risk > 0)) return { progress: null, noTp: !(tp > 0) }
  const noTp = !(tp > 0)
  const dir = side === 'LONG' ? 1 : -1
  const target = noTp ? entry + dir * 2 * risk : tp
  const reward = Math.abs(target - entry)
  const move = (mark - entry) * dir
  let p: number
  if (move >= 0) p = reward > 0 ? move / reward : 0
  else p = -(-move) / risk
  return { progress: Math.max(-1, Math.min(1, p)), noTp }
}

/** Motivul real de inchidere → rezultatul din jurnal. Necunoscut → OTHER (spec 4.2). */
export function resultOf(closeReason: unknown): 'TP' | 'SL' | 'MANUAL' | 'DSL' | 'LIQ' | 'OTHER' {
  const r = String(closeReason || '').toUpperCase()
  if (r === 'HIT_TP') return 'TP'
  if (r === 'HIT_SL') return 'SL'
  if (r.startsWith('DSL')) return 'DSL'
  if (r.includes('LIQUIDAT')) return 'LIQ'
  if (r === 'MANUAL_CLIENT' || r === 'MANUAL' || r === 'MANUAL CLOSE' || r === 'CLOSE ALL MANUAL' || r === 'CLOSE ALL AT') return 'MANUAL'
  return 'OTHER'
}

export function closeMsgOf(result: string, pnlPct: Num): string {
  const v = pnlPct == null ? '' : ' ' + (pnlPct >= 0 ? '+' : '') + pnlPct.toFixed(2) + '%'
  if (result === 'TP' || result === 'SL') return result + ' HIT' + v
  if (result === 'MANUAL') return 'CLOSED' + v
  return result + ' CLOSED' + v
}

/**
 * Detector de „piata moarta", DOAR pentru afisaj (spec 3): fara pozitie si
 * (Session pica sau VOL, VOLAT mici si conf mult sub prag) neintrerupt 60 s.
 */
export class DeadDetector {
  private since: number | null = null
  update(nowMs: number, hasPos: boolean, sessionFailing: boolean, vol: Num, volat: Num, conf: Num, thr: Num): boolean {
    const quiet = vol != null && volat != null && conf != null && thr != null && vol < 0.15 && volat < 0.15 && conf < thr - 25
    const cond = !hasPos && (sessionFailing || quiet)
    if (!cond) { this.since = null; return false }
    if (this.since == null) this.since = nowMs
    return nowMs - this.since >= 60_000
  }
}

/** [DERIVED].build — din datele reale, starea de desenat. */
export class Derived {
  lastPreMood: Mood = 'CALM'
  build(raw: Raw): St {
    let s = 0, k = 0
    for (let i = 0; i < N; i++) {
      const a = raw.rt[i], b = raw.sl[i]
      if (a == null || b == null) continue
      s += Math.abs(a - b); k++
    }
    const div = k ? s / k : 0
    const nF = raw.gatesFailing.length
    const hes = !raw.dead && raw.conf != null && raw.thr != null && raw.conf >= raw.thr - 8 && nF > 0
    const mainDir = dirOf(raw.mode)
    const sats: StSat[] = raw.sats.map((x) => ({
      s: x.symbol, full: x.full, v: x.axes, c: MODECOL[x.mode], sc: x.score, slot: x.slot ?? 0,
      cons: x.mode !== 'RANGE' && mainDir !== 0 && dirOf(x.mode) === mainDir,
    }))
    let mood: Mood
    const p = raw.position
    if (raw.signalActive) mood = 'ATTACK'
    else if (p) mood = p.progress != null && p.progress > 0.35 ? 'CONFIDENT' : p.progress != null && p.progress < -0.5 ? 'FEARFUL' : 'FOCUSED'
    else if (raw.dead) mood = 'SLEEPING'
    else if (hes) mood = 'HESITANT'
    else if (raw.ml != null && raw.ml < 0.45) mood = 'CONFUSED'
    else if (div > 0.18) mood = 'NERVOUS'
    else if (raw.conf != null && raw.thr != null && raw.conf >= raw.thr - 10) mood = 'ALERT'
    else mood = 'CALM'
    if (PRE_MOODS.includes(mood)) this.lastPreMood = mood
    return {
      rt: raw.rt, tf: raw.tf, sl: raw.sl, att: raw.att, ml: raw.ml,
      fails: raw.gatesFailing, unk: raw.gatesUnknown, conf: raw.conf, thr: raw.thr,
      hes, div, zz: raw.dead, c: MODECOL[raw.mode], n: raw.modeLabel,
      pos: p ? { sym: p.symbol, dir: p.side === 'LONG' ? 1 : -1, pnl: p.progress, pct: p.pnlPct, noTp: p.noTp } : null,
      posMsg: raw.closeMsg, mood: [mood, MC[mood]], cons: sats.filter((x) => x.cons).length, sats, main: raw.main, sig: raw.signalActive,
    }
  }
}

/** Cadru inregistrat: numerele rotunjite la 3 zecimale (spec 4.1). */
export function roundFrame<T>(st: T): T {
  return JSON.parse(JSON.stringify(st, (_k, v) => (typeof v === 'number' ? Math.round(v * 1000) / 1000 : v)))
}
