// [2026-11-28] Procentul de langa pretul din header = schimbarea pe 24h.
//
// Inainte era (pret − pretul de acum un tick) / pret, adica aproape mereu „▲ 0.00%".
// Ca sa mearga SINCRON cu pretul de langa el, procentul se calculeaza la fiecare tick din
// pretul live fata de deschiderea de acum 24h. Deschiderea vine din:
//   1) evenimentul `zeus:wlPrice` (watchlist-ul serverului, ticker/24hr la 10 s);
//   2) pentru moneda din chart care nu e in watchlist: /api/market/ticker24hr la 30 s
//      (aceeasi cerere ca a listei cand moneda e in ea → acelasi cache pe server).
import { tickerQuery } from '../quantmonitor/engines/ticker24'

const w = window as any
const REF_MAX_AGE_MS = 5 * 60_000
const POLL_MS = 30_000
const _ref = new Map<string, { open: number; ms: number }>()
let _timer: ReturnType<typeof setInterval> | null = null
let _busy = false

/** Deschiderea de acum 24h din ultimul pret si procentul pe 24h. */
export function open24From(last: number, chgPct: number): number | null {
  if (!(last > 0) || !Number.isFinite(chgPct) || chgPct <= -100) return null
  const o = last / (1 + chgPct / 100)
  return Number.isFinite(o) && o > 0 ? o : null
}

export function noteRef24(sym: string, last: number, chgPct: number): void {
  const o = open24From(+last, +chgPct)
  if (o == null) return
  _ref.set(String(sym).toUpperCase(), { open: o, ms: Date.now() })
}

/** Procentul pe 24h pentru pretul dat, sau null cand nu avem o deschidere proaspata. */
export function chg24For(sym: string, price: number): number | null {
  const r = _ref.get(String(sym || '').toUpperCase())
  if (!r || !(price > 0) || Date.now() - r.ms > REF_MAX_AGE_MS) return null
  return (price - r.open) / r.open * 100
}

function _fresh(sym: string): boolean {
  const r = _ref.get(sym)
  return !!r && Date.now() - r.ms < POLL_MS + 10_000
}

export async function pollHeader24(): Promise<void> {
  if (_busy) return
  const sym = String(w.S?.symbol || '').toUpperCase()
  if (!sym || _fresh(sym)) return
  if (typeof document !== 'undefined' && document.hidden) return
  _busy = true
  try {
    // Binance futures ignora `symbols` si da TOATE monedele (greutate 40 pe fiecare cheie de cache
    // distincta pe server). Deci cerem cu cheia listei de urmarire, pe care o folosesc deja ceilalti;
    // doar daca moneda lipseste din raspuns (Binance a inceput sa filtreze) cerem moneda singura.
    const wl = Array.isArray(w.WL_SYMS) ? w.WL_SYMS.map((x: any) => String(x).toUpperCase()) : []
    const tries: string[][] = wl.length ? [wl] : []
    if (!wl.includes(sym)) tries.push(tickerQuery(sym, []))
    for (const q of tries) {
      const r = await fetch('/api/market/ticker24hr?symbols=' + encodeURIComponent(JSON.stringify(q)), { signal: AbortSignal.timeout(8000) })
      if (!r.ok) continue
      const arr = await r.json()
      if (String(w.S?.symbol || '').toUpperCase() !== sym) return   // moneda s-a schimbat intre timp
      const t = Array.isArray(arr) ? arr.find((x: any) => x && String(x.symbol).toUpperCase() === sym) : null
      if (t) { noteRef24(sym, parseFloat(t.lastPrice), parseFloat(t.priceChangePercent)); return }
    }
  } catch (_) { /* fara retea: la urmatorul ciclu */ } finally { _busy = false }
}

function _onWl(e: any): void {
  const d = e && e.detail
  if (d && d.sym) noteRef24(d.sym, +d.price, +d.chg)
}

/** Porneste o singura data: ascultatorul watchlist-ului + citirea pentru moneda din chart. */
export function startHeader24(): void {
  if (_timer) return
  void pollHeader24()
  _timer = setInterval(() => void pollHeader24(), POLL_MS)
}

if (typeof window !== 'undefined' && !w.__ZEUS_HDR24_BOUND__) {
  w.__ZEUS_HDR24_BOUND__ = true
  window.addEventListener('zeus:wlPrice', _onWl)
}

export function _resetHeader24ForTest(): void {
  _ref.clear(); _busy = false
  if (_timer) { clearInterval(_timer); _timer = null }
}
