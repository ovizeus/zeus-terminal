// ZeuS Brain v7 — jurnalul radarului (pasul B), functii PURE.
// [2026-11-16] Jurnalul e al RADARULUI: doar tranzactiile pe monedele radarului (principala +
// satelitii), doar din mediul activ (DEMO / TESTNET / REAL), fiecare cu eticheta lui.
// Surse: istoricul de pe server (/api/journal = at_closed), inregistrarile creierului
// (IndexedDB, legate prin seq) si pozitiile deschise acum. Apartenenta se decide LA INTRARE
// (radarCoin pe inregistrare); istoricul si ce s-a prins cu aplicatia inchisa intra daca
// moneda e in lista CURENTA („added from history" / „app closed at entry").
import type { TradeRecord } from './brainStorage'
import { resultOf } from './brainDerived'

export type Env = 'DEMO' | 'TESTNET' | 'REAL'
export interface ServerRow {
  seq: number | string; symbol: string; side: string; mode?: string; env?: string | null
  entryPrice?: number; exitPrice?: number | null; size?: number; margin?: number; leverage?: number
  sl?: number; tp?: number; pnl?: number; exitReason?: string; openTs?: number; closeTs?: number
  serverScore?: number | null; regime?: string | null
  entryMeta?: EntryMeta | null
}
/** [2026-11-20] Ce a retinut SERVERUL la intrare (brain_decisions legat prin seq). */
export interface EntryMeta {
  conf: number | null; finalConf: number | null; regime: string | null; tier: string | null
  gates: { failing: number[]; unknown: number[] } | null; trendBias: string | null; volatility: string | null
}
export interface OpenPos { id: string | number; sym: string; side: string; entry?: number; sl?: number; tp?: number; size?: number; lev?: number; pnl?: number; openTs?: number }
export interface JRow {
  key: string; seq: string; env: Env; symbol: string; full: string; side: 'LONG' | 'SHORT'
  status: 'open' | 'closed'
  entryTime: number | null; exitTime: number | null
  entryPrice: number | null; exitPrice: number | null; exitCalc: boolean
  sl: number | null; tp: number | null; size: number | null; lev: number | null
  result: string | null; closeReason: string | null
  pnlPct: number | null; pnlAbs: number | null
  serverScore: number | null; regime: string | null
  entryMeta: EntryMeta | null
  origin: 'brain' | 'history' | 'adopted'
  reason: string | null          // de ce lipsesc datele creierului / poza
  rec: TradeRecord | null
}

const full = (s: string) => { const u = String(s || '').toUpperCase(); return u.endsWith('USDT') ? u : u + 'USDT' }
const short = (s: string) => String(s || '').toUpperCase().replace(/USDT$/, '')
const num = (v: unknown): number | null => { const n = Number(v); return Number.isFinite(n) && n !== 0 ? n : (v === 0 ? 0 : null) }

/** Mediul unui rand de pe server: `env` daca exista; demo vechi fara env = DEMO; live vechi fara env = necunoscut. */
export function rowEnv(r: ServerRow): Env | null {
  const e = String(r.env || '').toUpperCase()
  if (e === 'DEMO' || e === 'TESTNET' || e === 'REAL') return e
  return String(r.mode || '').toLowerCase() === 'demo' ? 'DEMO' : null
}

/** PnL % ca in restul Zeus (PositionRows.tsx:198): pnl / size × 100. */
export function pnlPctOf(pnl: unknown, size: unknown): number | null {
  const p = Number(pnl), s = Number(size)
  return Number.isFinite(p) && s > 0 ? +(p / s * 100).toFixed(2) : null
}

export function buildJournal(i: { rows: ServerRow[]; recs: TradeRecord[]; open: OpenPos[]; env: Env; coins: string[] }): JRow[] {
  const coins = new Set(i.coins.map(full))
  const recBy = new Map<string, TradeRecord>()
  for (const r of i.recs) recBy.set(String(r.id), r)
  const seen = new Set<string>()
  const openRows: JRow[] = [], closed: JRow[] = []

  for (const p of i.open || []) {
    const id = String(p.id), f = full(p.sym), rec = recBy.get(id) || null
    if (!((rec && rec.radarCoin) || coins.has(f))) continue
    seen.add(id)
    openRows.push({
      key: 'o:' + id, seq: id, env: i.env, symbol: short(f), full: f, side: p.side === 'SHORT' ? 'SHORT' : 'LONG', status: 'open',
      entryTime: num(p.openTs), exitTime: null, entryPrice: num(p.entry), exitPrice: null, exitCalc: false,
      sl: num(p.sl), tp: num(p.tp), size: num(p.size), lev: num(p.lev), result: null, closeReason: null,
      pnlPct: pnlPctOf(p.pnl, p.size), pnlAbs: Number.isFinite(Number(p.pnl)) ? +Number(p.pnl).toFixed(2) : null,
      serverScore: null, regime: null, entryMeta: null,
      origin: rec ? 'brain' : 'adopted', reason: rec ? (rec.noSnapReason || null) : 'app closed at entry', rec,
    })
  }

  for (const r of i.rows || []) {
    if (String(r.exitReason || '').startsWith('ENTRY_FAILED')) continue
    if (rowEnv(r) !== i.env) continue
    const id = String(r.seq), f = full(r.symbol), rec = recBy.get(id) || null
    if (seen.has(id)) continue
    if (!((rec && rec.radarCoin) || coins.has(f))) continue
    seen.add(id)
    closed.push({
      key: 'c:' + id, seq: id, env: i.env, symbol: short(f), full: f, side: r.side === 'SHORT' ? 'SHORT' : 'LONG', status: 'closed',
      entryTime: num(r.openTs), exitTime: num(r.closeTs), entryPrice: num(r.entryPrice), exitPrice: num(r.exitPrice), exitCalc: r.exitPrice != null,
      sl: num(r.sl), tp: num(r.tp), size: num(r.size), lev: num(r.leverage), result: resultOf(r.exitReason), closeReason: r.exitReason || null,
      pnlPct: pnlPctOf(r.pnl, r.size), pnlAbs: Number.isFinite(Number(r.pnl)) ? +Number(r.pnl).toFixed(2) : null,
      serverScore: r.serverScore == null ? null : Number(r.serverScore), regime: r.regime || null, entryMeta: r.entryMeta || null,
      origin: rec ? 'brain' : 'history', reason: rec ? (rec.noSnapReason || null) : 'added from history', rec,
    })
  }

  // Inregistrari inchise ale creierului care nu mai sunt in pagina de istoric primita.
  for (const rec of i.recs) {
    if (rec.status !== 'closed' || seen.has(String(rec.id)) || !rec.radarCoin || rec.env !== i.env) continue
    seen.add(String(rec.id))
    closed.push({
      key: 'c:' + rec.id, seq: String(rec.id), env: i.env, symbol: rec.symbol, full: full(rec.symbol), side: rec.side, status: 'closed',
      entryTime: rec.entryTime, exitTime: rec.exitTime, entryPrice: rec.entryPrice, exitPrice: rec.exitPrice, exitCalc: rec.exitPrice != null,
      sl: null, tp: null, size: null, lev: null, result: rec.result, closeReason: null, pnlPct: rec.pnlPct, pnlAbs: rec.pnlAbs,
      serverScore: null, regime: rec.meta?.regime || null, entryMeta: null, origin: 'brain', reason: rec.noSnapReason || null, rec,
    })
  }

  openRows.sort((a, b) => (b.entryTime || 0) - (a.entryTime || 0))
  closed.sort((a, b) => (b.exitTime || b.entryTime || 0) - (a.exitTime || a.entryTime || 0))
  return openRows.concat(closed)
}

/** Tranzactiile care au date de creier (pentru psych / deja vu / sablon), din mediul dat. */
export function brainCaptured(rows: JRow[]): TradeRecord[] {
  const out: TradeRecord[] = []
  for (const r of rows) {
    if (r.status !== 'closed' || !r.rec || r.rec.pnlPct == null && r.pnlPct == null) continue
    out.push(Object.assign({}, r.rec, { pnlPct: r.rec.pnlPct ?? r.pnlPct, result: r.rec.result ?? r.result }))
  }
  return out
}

export const ENV_COLOR: Record<Env, string> = { DEMO: '#b48cff', TESTNET: '#ffb347', REAL: '#39ff6a' }
