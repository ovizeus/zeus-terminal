// ZeuS Brain v7 — inregistrator (port [RECORDER], spec 4).
// Cadre la 4 Hz intr-un inel de 20 min; intrarile si iesirile vin din
// evenimentele REALE ale pozitiilor (o pozitie noua = intrare, o pozitie
// disparuta = iesire), iar rezultatul si PnL-ul din randul real de inchidere de
// pe server. Animatia creierului nu creeaza niciodata o tranzactie.
import { REC_HZ, PRE_SEC, POST_SEC, REPLAY_KEEP, type Mood } from './brainStrings'
import { entryShapeOf, resultOf, closeMsgOf, roundFrame, type St } from './brainDerived'
import { brainStorage, type TradeRecord } from './brainStorage'
import { currentPositions, currentUid, currentProfile, setCloseMsg, currentEnv, shortSym } from './brainAdapter'
import { radarCoins } from './brainPrefs'
import { BRAIN } from '../core/config'
import { getATMode } from '../services/stateAccessors'

const RING = REC_HZ * 60 * 20
const NEW_ENTRY_MAX_AGE_MS = 60_000
const CLOSE_LOOKUP_MAX_MS = 120_000

export interface Frame extends St { i: number; evt: string | null; t?: number }   // t: ora reala (cadrele serverului)

type JournalRow = { seq: number | string; symbol: string; side: string; mode?: string; entryPrice?: number; exitPrice?: number | null; size?: number; pnl?: number; exitReason?: string; openTs?: number; closeTs?: number }

/** Randul real de inchidere pentru o pozitie: dupa seq, sau dupa moneda + parte + ora intrarii. */
export function matchCloseRow(rows: JournalRow[], t: { id: string; symbol: string; side: string; entryTime: number }): JournalRow | null {
  if (!Array.isArray(rows)) return null
  const bySeq = rows.find((r) => String(r.seq) === String(t.id))
  if (bySeq) return bySeq
  return rows.find((r) => String(r.symbol || '').toUpperCase().replace(/USDT$/, '') === t.symbol
    && String(r.side) === t.side && Math.abs((Number(r.openTs) || 0) - t.entryTime) < 5000) || null
}

/** Rand real → campurile tranzactiei. PnL % ca in restul Zeus: pnl / size × 100. */
export function closeFieldsFrom(row: JournalRow): Pick<TradeRecord, 'result' | 'pnlPct' | 'pnlAbs' | 'exitPrice' | 'exitTime' | 'entryPrice'> {
  const pnl = Number(row.pnl)
  const size = Number(row.size)
  return {
    result: resultOf(row.exitReason),
    pnlAbs: Number.isFinite(pnl) ? +pnl.toFixed(2) : null,
    pnlPct: Number.isFinite(pnl) && size > 0 ? +(pnl / size * 100).toFixed(2) : null,
    exitPrice: Number.isFinite(Number(row.exitPrice)) && Number(row.exitPrice) > 0 ? Number(row.exitPrice) : null,
    exitTime: Number(row.closeTs) || null,
    entryPrice: Number(row.entryPrice) > 0 ? Number(row.entryPrice) : null,
  }
}

async function fetchJournal(): Promise<JournalRow[]> {
  try {
    const r = await fetch('/api/journal?limit=60', { credentials: 'same-origin' })
    if (!r.ok) return []
    const j = await r.json()
    return j && Array.isArray(j.trades) ? j.trades : []
  } catch { return [] }
}

export class Recorder {
  frames: Frame[] = []
  n = 0
  private lastRec = 0
  trades: TradeRecord[] = []            // inchise, cele mai noi primele
  open = new Map<string, TradeRecord & { a: number }>()
  private closing: Array<{ tr: TradeRecord & { a: number }; b: number }> = []
  private pendingEvt: string | null = null
  snapQ: { key: string; at: number } | null = null
  private seen = new Map<string, any>()
  private started = 0
  private uid: string | null = null
  lastPreMood: () => Mood = () => 'CALM'
  /** Focus la intrare (din interfata). */
  focusNow: () => boolean | null = () => null
  lastSt: St | null = null
  onChange: () => void = () => {}

  async load(): Promise<void> {
    this.uid = currentUid()
    if (!this.uid) return
    const all = await brainStorage.loadTrades(this.uid)
    for (const t of all) {
      if (t.status === 'closed') this.trades.push(t)
      else this.open.set(t.id, Object.assign(t, { a: -1 }))
    }
    this.trades.sort((a, b) => (b.exitTime || b.entryTime) - (a.exitTime || a.entryTime))
    this.onChange()
  }

  /** Cheama-l la fiecare cadru; inregistreaza la 4 Hz si urmareste pozitiile reale. */
  tick(nowMs: number, st: St): void {
    this.lastSt = st
    if (!this.started) this.started = nowMs
    if (nowMs - this.lastRec < 1000 / REC_HZ) return
    this.lastRec = nowMs
    const f = roundFrame(Object.assign({}, st, { i: this.n++, evt: this.pendingEvt })) as Frame
    this.pendingEvt = null
    this.frames.push(f)
    if (this.frames.length > RING) this.frames.shift()
    this.watchPositions(nowMs)
    for (let q = this.closing.length - 1; q >= 0; q--) {
      const c = this.closing[q]
      if (this.n >= c.b) { this.closing.splice(q, 1); void this.finishFrames(c.tr, c.b) }
    }
  }

  private watchPositions(nowMs: number): void {
    const uid = currentUid()
    if (!uid) return
    if (uid !== this.uid) { this.uid = uid; this.trades = []; this.open.clear(); this.seen.clear(); void this.load() ; return }
    const list = currentPositions()
    const now = new Map<string, any>()
    for (const p of list) if (p && p.id != null) now.set(String(p.id), p)
    // intrari: o pozitie noua, deschisa de curand (nu una gasita la pornire), si DOAR pe
    // monedele radarului de acum (principala + satelitii). Apartenenta se fixeaza aici.
    const main = String((window as any).S?.symbol || 'BTCUSDT').toUpperCase()
    const coins = radarCoins(main)
    for (const [id, p] of now) {
      if (this.seen.has(id) || this.open.has(id)) continue
      const sym = String(p.sym || '').toUpperCase()
      if (!coins.includes(sym)) continue
      const openTs = Number(p.openTs) || 0
      if (openTs && nowMs - openTs < NEW_ENTRY_MAX_AGE_MS) this.onEntry(p, nowMs, main, coins)
    }
    // iesiri: o pozitie pe care o urmaream a disparut — doar din modul curent:
    // la trecerea demo ↔ live pozitiile celuilalt mod dispar din lista fara sa fie inchise.
    const demoNow = getATMode() !== 'live'
    for (const [id, tr] of this.open) {
      if (tr.isDemo !== demoNow) continue
      if (now.has(id) && tr.status === 'closing') {
        // a reaparut (de ex. dupa o reconectare): nu era o inchidere
        tr.status = 'open'; this.closing = this.closing.filter((c) => c.tr !== tr); void brainStorage.putTrade(strip(tr)); continue
      }
      if (!now.has(id) && tr.status === 'open' && (this.seen.has(id) || tr.a < 0)) {
        // dupa o repornire asteptam 10 s ca pozitiile sa se incarce inainte sa declaram iesirea
        if (tr.a < 0 && nowMs - this.started < 10_000) continue
        this.onExit(tr, nowMs)
      }
    }
    this.seen = now
  }

  onEntry(p: any, nowMs: number, main: string = String((window as any).S?.symbol || 'BTCUSDT').toUpperCase(), coins: string[] = radarCoins(main)): void {
    const st = this.lastSt
    const symbol = String(p.sym || '').toUpperCase().replace(/USDT$/, '')
    const onMain = String(p.sym || '').toUpperCase() === main
    const visible = typeof document === 'undefined' || !document.hidden
    // Poza si replay-ul arata RADARUL de pe ecran: au sens doar pentru moneda de pe chart,
    // cu aplicatia vizibila. Altfel spunem de ce lipsesc — niciodata alta moneda in poza.
    const noSnapReason = !onMain ? `other symbol on screen (${shortSym(main)})` : !visible ? 'app closed at entry' : null
    const tr: TradeRecord & { a: number } = {
      key: `${this.uid}:${p.id}`, uid: String(this.uid), id: String(p.id),
      isDemo: getATMode() !== 'live',
      symbol, side: p.side === 'SHORT' ? 'SHORT' : 'LONG',
      entryTime: Number(p.openTs) || nowMs, exitTime: null,
      entryPrice: Number(p.entry) > 0 ? Number(p.entry) : null, exitPrice: null,
      result: null, pnlPct: null, pnlAbs: null,
      confAtEntry: st ? st.conf : null, thrAtEntry: st ? st.thr : null, profile: currentProfile(),
      pre: this.lastPreMood(), entryShape: entryShapeOf(st ? st.rt : []),
      hasSnapshot: false, hasFrames: false, status: 'open', a: onMain ? this.n : -2,
      env: currentEnv(), radarCoin: true, radarCoins: coins.slice(), onMain, noSnapReason,
      meta: {
        radarMode: st ? st.n : null, regime: (BRAIN as any)?.regime ? String((BRAIN as any).regime).toUpperCase() : null,
        focus: this.focusNow(), lens: 'v7 (RT + TIMEFRAME + SLOW)',
        gatesFailing: st ? st.fails.slice() : [], gatesUnknown: st ? (st.unk || []).slice() : [], ml: st ? st.ml : null,
      },
    }
    this.open.set(tr.id, tr)
    if (!noSnapReason) this.snapQ = { key: tr.key, at: nowMs + 350 }
    void brainStorage.putTrade(strip(tr))
  }

  private onExit(tr: TradeRecord & { a: number }, nowMs: number): void {
    tr.status = 'closing'
    void brainStorage.putTrade(strip(tr))
    this.closing.push({ tr, b: this.n + POST_SEC * REC_HZ })
    void this.resolveClose(tr, nowMs)
  }

  /** Cauta randul real de inchidere (serverul il scrie putin dupa); reincearca pana la 2 minute. */
  private async resolveClose(tr: TradeRecord & { a: number }, startMs: number): Promise<void> {
    while (Date.now() - startMs < CLOSE_LOOKUP_MAX_MS) {
      const row = matchCloseRow(await fetchJournal(), tr)
      if (row) {
        Object.assign(tr, closeFieldsFrom(row))
        if (row.seq != null && String(row.seq) !== tr.id) { /* id-ul real ramane cel al pozitiei */ }
        this.pendingEvt = tr.result
        setCloseMsg(closeMsgOf(tr.result || 'OTHER', tr.pnlPct), Date.now())
        this.finalize(tr)
        return
      }
      await new Promise((r) => setTimeout(r, 3000))
    }
    // Nicio inchidere gasita: ramane neconfirmata; se reincearca la urmatoarea pornire.
    tr.status = 'closing'
    void brainStorage.putTrade(strip(tr))
  }

  private finalize(tr: TradeRecord & { a: number }): void {
    if (tr.status === 'closed') return
    tr.status = 'closed'
    this.open.delete(tr.id)
    this.trades.unshift(tr)
    void brainStorage.putTrade(strip(tr))
    this.trimFrames()
    this.onChange()
  }

  /** La pornire: tranzactiile ramase deschise/neconfirmate isi cauta inchiderea reala. */
  async reconcile(): Promise<void> {
    const pending = [...this.open.values()].filter((t) => t.status === 'closing')
    if (!pending.length) return
    const rows = await fetchJournal()
    for (const tr of pending) {
      const row = matchCloseRow(rows, tr)
      if (row) { Object.assign(tr, closeFieldsFrom(row)); this.finalize(tr) }
    }
  }

  private async finishFrames(tr: TradeRecord & { a: number }, b: number): Promise<void> {
    if (tr.a < 0 || tr.onMain === false) return       // replay doar pentru moneda de pe chart
    const fr = capFrames(this.frames.filter((f) => f.i >= tr.a - PRE_SEC * REC_HZ && f.i <= b))
    if (!fr.length) return
    await brainStorage.putFrames(tr.key, fr)
    tr.hasFrames = true
    void brainStorage.putTrade(strip(tr))
    this.trimFrames()
    this.onChange()
  }

  /** Replay doar pentru ultimele 50 de tranzactii (spec 4.2). */
  private trimFrames(): void {
    this.trades.forEach((t, k) => {
      if (k >= REPLAY_KEEP && t.hasFrames) { t.hasFrames = false; void brainStorage.delFrames(t.key); void brainStorage.putTrade(strip(t)) }
    })
  }

  /** Poza la 350 ms dupa intrare; nu in timpul unui replay. */
  // [2026-11-16 seara] Poza nu mai e o copie de 240 px a canvas-ului (iesea neclara, cerut
  // de operator „sa se vada clar"): `capture` redeseneaza cadrul la rezolutie mare (brainUI).
  snap(nowMs: number, capture: () => string | null, replaying: boolean): void {
    if (!this.snapQ || nowMs < this.snapQ.at || replaying) return
    const key = this.snapQ.key
    this.snapQ = null
    try {
      const url = capture()
      if (!url) return
      void brainStorage.putSnapshot(key, url)
      for (const t of [...this.open.values(), ...this.trades]) if (t.key === key) { t.hasSnapshot = true; void brainStorage.putTrade(strip(t)) }
      this.onChange()
    } catch { /* fara poza */ }
  }
}

/**
 * O tranzactie lunga ar salva mii de cadre (o ora = 14.400; inelul tine 20 min = 4.800,
 * cativa MB). Pe telefon, 50 de replay-uri ar insemna sute de MB. Peste MAX_REPLAY_FRAMES
 * pastram cadrele din jurul intrarii si al iesirii si rarim uniform mijlocul. Cadrele cu
 * eveniment (intrare, TP/SL) raman toate.
 */
export const MAX_REPLAY_FRAMES = 1200
export function capFrames<T extends { evt?: string | null; sig?: boolean }>(fr: T[], max = MAX_REPLAY_FRAMES): T[] {
  if (fr.length <= max) return fr
  const edge = Math.floor(max / 4)
  const head = fr.slice(0, edge), tail = fr.slice(fr.length - edge), mid = fr.slice(edge, fr.length - edge)
  const room = max - 2 * edge, step = mid.length / room
  const keep: T[] = []
  for (let k = 0; k < room; k++) keep.push(mid[Math.floor(k * step)])
  for (const f of mid) if ((f.evt || f.sig) && !keep.includes(f)) keep.push(f)
  const idx = new Map(fr.map((f, i) => [f, i]))
  return head.concat(keep.sort((a, b) => (idx.get(a) as number) - (idx.get(b) as number)), tail)
}

function strip(t: TradeRecord & { a?: number }): TradeRecord {
  const { a: _a, ...rest } = t as any
  return rest as TradeRecord
}
