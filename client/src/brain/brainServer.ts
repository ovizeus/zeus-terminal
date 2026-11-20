// ZeuS Brain v7 — legatura cu RADARUL DE PE SERVER (2026-11-20).
// Serverul calculeaza cele 12 axe pentru monedele radarului si inregistreaza fiecare
// intrare (server/services/radarCapture.js), deci poza, replay-ul, deja vu si sablonul
// exista si pentru tranzactiile intrate cu telefonul inchis. Aici:
//   - axele LIVE (afisaj) — aceeasi sursa ca inregistrarile, ca deja vu sa compare corect;
//   - monedele radarului, salvate si pe server;
//   - inregistrarile serverului → inregistrari de creier pentru jurnal (functii PURE);
//   - cadrele serverului (1 pe secunda) → stari de desenat pentru replay si poza.
import { startPoll } from '../utils/poll'
import { Derived, emaStep, modeOf, type Num, type Raw, type St } from './brainDerived'
import type { TradeRecord } from './brainStorage'
import type { Frame } from './brainRecorder'

const short = (s: string) => String(s || '').toUpperCase().replace(/USDT$/, '')

// ── axele live ────────────────────────────────────────────────────
export interface LiveAxes { t: number; rt: Num[]; bull: number; bear: number; regime: string; score: number | null }
const _live = new Map<string, LiveAxes & { at: number }>()
const LIVE_FRESH_MS = 8000

/** Axele de pe server pentru o moneda, daca sunt proaspete; altfel null (aplicatia ramane pe ale ei). */
export function serverAxes(sym: string): LiveAxes | null {
  const v = _live.get(String(sym || '').toUpperCase())
  return v && Date.now() - v.at < LIVE_FRESH_MS && Array.isArray(v.rt) && v.rt.length === 12 ? v : null
}
export function _setServerAxesForTest(sym: string, v: LiveAxes | null): void {
  if (v) _live.set(sym.toUpperCase(), { ...v, at: Date.now() }); else _live.delete(sym.toUpperCase())
}
/** Cere axele o data la 1,5 s (nimic in fundal, fara suprapuneri — utils/poll). */
export function startServerAxes(symbols: () => string[]): () => void {
  return startPoll(async () => {
    const s = symbols().filter(Boolean).slice(0, 6)
    if (!s.length) return
    const r = await fetch('/api/market/radar?symbols=' + encodeURIComponent(s.join(',')), { credentials: 'same-origin' })
    if (!r.ok) return
    const j = await r.json()
    const now = Date.now()
    for (const [k, v] of Object.entries((j && j.axes) || {})) {
      if (v && Array.isArray((v as any).rt)) _live.set(k, { ...(v as LiveAxes), at: now })
    }
  }, 1500)
}

// ── monedele radarului ────────────────────────────────────────────
/** Lista de pe server: array = aleasa; null = inca n-a ales; undefined = serverul nu raspunde. */
export async function getServerCoins(): Promise<string[] | null | undefined> {
  try {
    const r = await fetch('/api/brain/radar/coins', { credentials: 'same-origin' })
    if (!r.ok) return undefined
    const j = await r.json()
    return Array.isArray(j && j.coins) ? j.coins : null
  } catch { return undefined }
}
export function putServerCoins(coins: string[]): void {
  try {
    void fetch('/api/brain/radar/coins', {
      method: 'PUT', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'X-Zeus-Request': '1' },
      body: JSON.stringify({ coins }),
    }).catch(() => { /* ramane salvata pe telefon */ })
  } catch { /* idem */ }
}

// ── inregistrarile serverului ─────────────────────────────────────
export interface ServerEntry {
  seq: number; symbol: string; side: 'LONG' | 'SHORT'; env: string; entryTs: number
  entryPrice: number | null; sl: number | null; tp: number | null; size: number | null; lev: number | null
  entryShape: number[] | null; rt: Num[] | null; conf: number | null; thr: number | null; profile: string | null
  regime: string | null; radarRegime: string | null; bull: number | null; bear: number | null
  gatesFailing: number[]; gatesUnknown: number[]; radarCoins: string[]; late: boolean; pre: string | null
  reconstructed?: boolean
}
export interface ServerCapture {
  seq: number; symbol: string; env: string; side: string; entryTs: number; exitTs: number | null
  status: 'open' | 'closed'; nFrames: number; entry: ServerEntry | null
}
export interface ServerFrame {
  t: number; rt: Num[]; b: number; r: number; rg: string; c: number | null; h: number | null
  f: number[]; u: number[]; p?: { pct: number; prog: number | null; noTp: boolean }
}

export async function fetchCaptures(): Promise<ServerCapture[] | null> {
  try {
    const r = await fetch('/api/brain/radar/captures?limit=1000', { credentials: 'same-origin' })
    if (!r.ok) return null
    const j = await r.json()
    return Array.isArray(j && j.captures) ? j.captures : null
  } catch { return null }
}
export async function fetchCaptureFrames(seq: string | number): Promise<{ entry: ServerEntry; frames: ServerFrame[] } | null> {
  try {
    const r = await fetch('/api/brain/radar/captures/' + encodeURIComponent(String(seq)), { credentials: 'same-origin' })
    if (!r.ok) return null
    const j = await r.json()
    return j && j.ok && j.entry && Array.isArray(j.frames) ? { entry: j.entry, frames: j.frames } : null
  } catch { return null }
}

const PROFILE: Record<string, string> = { fast: 'FAST', swing: 'SWING', defensive: 'DEF', def: 'DEF' }

/** Inregistrarea serverului → inregistrare de creier (aceeasi forma ca a telefonului). PURA. */
export function capToRec(c: ServerCapture, uid: string): TradeRecord | null {
  const e = c && c.entry
  if (!e) return null
  const env = String(c.env || e.env || '').toUpperCase()
  const m = modeOf(e.bull, e.bear, e.radarRegime)
  const shape = Array.isArray(e.entryShape) && e.entryShape.length === 12 ? e.entryShape : null
  return {
    key: uid + ':s' + c.seq, uid, id: String(c.seq), isDemo: env === 'DEMO',
    symbol: short(c.symbol), side: c.side === 'SHORT' ? 'SHORT' : 'LONG',
    entryTime: Number(c.entryTs) || 0, exitTime: c.exitTs == null ? null : Number(c.exitTs),
    entryPrice: e.entryPrice ?? null, exitPrice: null, result: null, pnlPct: null, pnlAbs: null,
    confAtEntry: e.conf ?? null, thrAtEntry: e.thr ?? null,
    profile: e.profile ? (PROFILE[String(e.profile).toLowerCase()] || String(e.profile).toUpperCase()) : null,
    pre: e.pre || '—',
    entryShape: shape as number[],
    hasSnapshot: !!shape, hasFrames: Number(c.nFrames) > 0,
    status: c.status === 'open' ? 'open' : 'closed',
    env: env === 'DEMO' || env === 'TESTNET' || env === 'REAL' ? env : null,
    radarCoin: true, radarCoins: Array.isArray(e.radarCoins) ? e.radarCoins : [], onMain: true,
    noSnapReason: shape ? null : 'opened before the server radar was running',
    meta: { radarMode: m.label, regime: e.regime || null, focus: null,
      lens: e.reconstructed ? 'server history (rebuilt from decisions + candles, 30 s)' : 'server (RT + TIMEFRAME + SLOW)',
      gatesFailing: e.gatesFailing || [], gatesUnknown: e.gatesUnknown || [], ml: null },
    source: 'server', reconstructed: !!e.reconstructed,
  }
}

function raw(rt: Num[], tf: Num[], sl: Num[], f: { c: number | null; h: number | null; f: number[]; u: number[]; b: number | null; r: number | null; rg: string | null },
  pos: Raw['position'], main: string, sig: boolean): Raw {
  const m = modeOf(f.b, f.r, f.rg)
  return {
    rt, tf, sl, att: null, ml: null, gatesFailing: f.f || [], gatesUnknown: f.u || [],
    conf: f.c == null ? null : Math.round(f.c), thr: f.h ?? null, mode: m.mode, modeLabel: m.label,
    signalActive: sig, dead: false, position: pos, closeMsg: '', main, sats: [],
  }
}

/**
 * Cadrele serverului (1/s) → stari de desenat, ca cele inregistrate de telefon. Lentilele
 * TIMEFRAME/SLOW se calculeaza ca in aplicatie (emaStep, pasi de 0,25 s). La intrare
 * (primul cadru cu pozitie) ATTACK tine 2 s, ca semnalul din aplicatie. PURA.
 */
export function framesToStates(entry: ServerEntry, frames: ServerFrame[]): Frame[] {
  const der = new Derived()
  const main = short(entry.symbol)
  let tf: Num[] = new Array(12).fill(null), sl: Num[] = new Array(12).fill(null)
  let prevT = 0, sigLeft = 0, hadPos = false
  const out: Frame[] = []
  frames.forEach((fr, i) => {
    let dt = prevT ? (fr.t - prevT) / 1000 : 0
    prevT = fr.t
    if (!prevT || i === 0) { tf = fr.rt.slice(); sl = fr.rt.slice() }
    for (let k = 0; dt > 0 && k < 240; k++, dt -= 0.25) { tf = emaStep(tf, fr.rt, 0.025, Math.min(0.25, dt)); sl = emaStep(sl, tf, 0.007, Math.min(0.25, dt)) }
    const pos = fr.p ? { symbol: main, side: entry.side, pnlPct: fr.p.pct, progress: fr.p.prog, noTp: !!fr.p.noTp } : null
    if (pos && !hadPos) sigLeft = 2
    hadPos = !!pos
    const st = der.build(raw(fr.rt, tf, sl, { c: fr.c, h: fr.h, f: fr.f, u: fr.u, b: fr.b, r: fr.r, rg: fr.rg }, pos, main, sigLeft > 0))
    if (sigLeft > 0) sigLeft--
    out.push(Object.assign(st, { i, evt: null, t: fr.t }) as Frame)
  })
  return out
}

/** Starea de la intrare (pentru poza): forma de la intrare, pozitia abia deschisa. PURA. */
export function entryState(entry: ServerEntry): St | null {
  const rt = entry.rt || entry.entryShape
  if (!Array.isArray(rt) || rt.length !== 12) return null
  const pos = { symbol: short(entry.symbol), side: entry.side, pnlPct: 0, progress: 0, noTp: !(Number(entry.tp) > 0) }
  return new Derived().build(raw(rt as Num[], rt as Num[], rt as Num[],
    { c: entry.conf, h: entry.thr, f: entry.gatesFailing, u: entry.gatesUnknown, b: entry.bull, r: entry.bear, rg: entry.radarRegime },
    pos, short(entry.symbol), true))
}
