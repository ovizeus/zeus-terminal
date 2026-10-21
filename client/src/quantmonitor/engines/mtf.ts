// QM MTF — stiva multi-timeframe construita din klines ADEVARATE.
//
// [2026-10-21 b295] Inlocuieste stiva care se calcula din `S._qmBuf`.
// Tamponul acela primeste un pret la fiecare 500 ms (index.ts, startRenderLoop),
// deci randurile etichetate 5m/15m/30m/1h/4h acopereau in realitate
// 4/10/20/30/60 SECUNDE — toate din acelasi minut — iar '1D' era hardcodat 0.
// Cu alte cuvinte panoul raporta "4 din 6 timeframe-uri de acord" cand de fapt
// masurase un singur trend de un minut, de cinci ori.
//
// Sursele: trei fetch-uri pe simbolul CURENT, prin proxy-ul cu cache de pe
// server (nu direct la Binance). Din ele derivam cele 6 randuri prin agregare,
// ca sa nu facem sase cereri unde ajung trei:
//   5m  (limit 1000, ~3,5 zile) -> 5m, 15m (×3), 30m (×6)
//   1h  (limit 1000, ~41 zile)  -> 1h, 4h (×4)
//   1d  (limit 400)             -> 1D
//
// Regula de onestitate: un rand fara destule bare da 0 = NECUNOSCUT, pe care
// panoul randeaza "─ ─". NU cade niciodata inapoi pe tamponul de secunde si nu
// ghiceste o direcţie.
const w = window as any

export interface Bar { o: number; h: number; l: number; c: number; v: number; t: number }

export type Trend = 1 | -1 | 0

export const MIN_MS = 60000
export const SRC_BASE_MS: Record<string, number> = { m5: 5 * MIN_MS, h1: 60 * MIN_MS, d1: 1440 * MIN_MS }

/** Cele 6 randuri pe care le afiseaza panoul, cu sursa si agregarea fiecaruia. */
export const MTF_SPEC: { tf: string; src: 'm5' | 'h1' | 'd1'; factor: number; fast: number; slow: number }[] = [
  { tf: '5m', src: 'm5', factor: 1, fast: 3, slow: 6 },
  { tf: '15m', src: 'm5', factor: 3, fast: 5, slow: 12 },
  { tf: '30m', src: 'm5', factor: 6, fast: 8, slow: 20 },
  { tf: '1h', src: 'h1', factor: 1, fast: 10, slow: 30 },
  { tf: '4h', src: 'h1', factor: 4, fast: 15, slow: 40 },
  { tf: '1D', src: 'd1', factor: 1, fast: 10, slow: 30 },
]

/**
 * Grupeaza bare intr-un timeframe mai mare, pe galeti ALINIATE LA CEAS.
 *
 * Alinierea se face pe `floor(t / span)`, nu pe prima bara primita: o bara de
 * 15m trebuie sa inceapa la :00/:15/:30/:45 ca la bursa, altfel "15m"-ul nostru
 * e decalat fata de 15m-ul pe care il vede oricine altcineva.
 * Ultima galeata poate fi incompleta — e bara in formare, o pastram.
 */
export function aggregateBars(bars: Bar[], factor: number, baseMs: number): Bar[] {
  if (!Array.isArray(bars) || !bars.length) return []
  if (!Number.isFinite(factor) || factor < 1) return []
  if (factor === 1) return bars
  const span = baseMs * factor
  if (!Number.isFinite(span) || span <= 0) return []
  const out: Bar[] = []
  let cur: Bar | null = null
  let curKey = NaN
  for (const b of bars) {
    if (!b || !Number.isFinite(b.t)) continue
    const key = Math.floor(b.t / span)
    if (!cur || key !== curKey) {
      if (cur) out.push(cur)
      cur = { o: b.o, h: b.h, l: b.l, c: b.c, v: b.v || 0, t: key * span }
      curKey = key
    } else {
      if (b.h > cur.h) cur.h = b.h
      if (b.l < cur.l) cur.l = b.l
      cur.c = b.c
      cur.v += b.v || 0
    }
  }
  if (cur) out.push(cur)
  return out
}

function _ema(d: number[], p: number): number {
  const k = 2 / (p + 1)
  let v = d[0]
  for (let i = 1; i < d.length; i++) v = d[i] * k + v * (1 - k)
  return v
}

/**
 * Semnul trendului pe un timeframe: media rapida peste cea lenta = bull.
 * Fara destule bare pentru media LENTA raspunde 0 (necunoscut) — nu 'bear'.
 */
export function emaTrend(closes: number[], fast: number, slow: number): Trend {
  if (!Array.isArray(closes) || closes.length < slow) return 0
  const f = _ema(closes, fast), s = _ema(closes, slow)
  if (!Number.isFinite(f) || !Number.isFinite(s)) return 0
  // Epsilon RELATIV, nu `f === s`. Pe o piata perfect plata cele doua medii
  // ar trebui sa iasa identice, dar `_ema` acumuleaza altfel pentru k diferiti,
  // iar virgula mobila lasa o diferenta de ordinul 1e-14. Fara epsilon,
  // compararea lor producea un trend INCREZATOR (bull sau bear) din zgomot de
  // rotunjire, pe o piata care nu se misca deloc. Prins la test.
  if (Math.abs(f - s) < Math.abs(s) * 1e-9) return 0
  return f > s ? 1 : -1
}

/** Cele 6 randuri, din sursele disponibile. Lipsa unei surse = 0 pe randurile ei. */
export function computeMtfStack(src: { m5?: Bar[]; h1?: Bar[]; d1?: Bar[] }): Record<string, Trend> {
  const out: Record<string, Trend> = {}
  for (const s of MTF_SPEC) {
    const bars = src && (src as any)[s.src]
    // Doar `isArray`: un tablou GOL nu are nevoie de garda proprie, fiindca
    // `aggregateBars([])` da `[]` si `emaTrend([])` da 0. Testul de mutatie a
    // arata ca `|| !bars.length` nu schimba niciun rezultat — era cod care
    // parea sa apere ceva.
    if (!Array.isArray(bars)) { out[s.tf] = 0; continue }
    const agg = aggregateBars(bars, s.factor, SRC_BASE_MS[s.src])
    out[s.tf] = emaTrend(agg.map(b => b.c), s.fast, s.slow)
  }
  return out
}

/**
 * Cat de aliniate sunt timeframe-urile, 0..100 — scala pe care o randeaza deja
 * panoul ("ALIGN SCORE x / 100", bara de progres, praguri 70/40).
 * Randurile necunoscute sunt IGNORATE, nu numarate ca dezacord; dar zero surse
 * da 0, nu 100 — lipsa datelor nu e aliniere perfecta.
 */
export function computeAlignScore(stack: Record<string, number>): number {
  const vals = Object.values(stack || {}).filter(v => v === 1 || v === -1)
  if (!vals.length) return 0
  const bull = vals.filter(v => v === 1).length
  const bear = vals.length - bull
  const score = Math.round(Math.abs(bull - bear) / vals.length * 100)
  return Math.max(0, Math.min(100, score))
}

/** Verdictul, fail-closed: fara 4 timeframe-uri de acord ramane WATCH. */
export function mtfWatch(stack: Record<string, number>): 'BULL' | 'BEAR' | 'WATCH' {
  const vals = Object.values(stack || {})
  const bull = vals.filter(v => v === 1).length
  const bear = vals.filter(v => v === -1).length
  return bull >= 4 ? 'BULL' : bear >= 4 ? 'BEAR' : 'WATCH'
}

// ===== sursa de date =====

function _mapKlines(raw: any): Bar[] {
  if (!Array.isArray(raw)) return []
  return raw
    .map((k: any) => ({ o: +k[1], h: +k[2], l: +k[3], c: +k[4], v: +k[5], t: +k[0] }))
    .filter((b: Bar) => Number.isFinite(b.c) && b.c > 0 && Number.isFinite(b.t))
}

async function _one(symbol: string, interval: string, limit: number): Promise<Bar[]> {
  const r = await fetch(`/api/market/klines?symbol=${encodeURIComponent(symbol)}&interval=${interval}&limit=${limit}`, { credentials: 'include' })
  if (!r.ok) return []
  return _mapKlines(await r.json())
}

/**
 * Aduce cele trei surse pentru simbolul curent in `S._qmMtfKlines`.
 * Stocheaza si simbolul: la comutarea de simbol, consumatorul vede ca datele
 * sunt ale altui simbol si le ignora, in loc sa citeasca un trend strain
 * (acelasi fel de capcana pentru care marketDataChart filtreaza raspunsurile
 * invechite la schimbarea simbolului).
 */
export async function fetchMtfKlines(): Promise<void> {
  if (!w.S) return
  const symbol = w.S.symbol || 'BTCUSDT'
  try {
    const [m5, h1, d1] = await Promise.all([
      _one(symbol, '5m', 1000).catch(() => [] as Bar[]),
      _one(symbol, '1h', 1000).catch(() => [] as Bar[]),
      _one(symbol, '1d', 400).catch(() => [] as Bar[]),
    ])
    if (!w.S) return
    if (!m5.length && !h1.length && !d1.length) return  // pastram ce aveam
    const prev = w.S._qmMtfKlines
    const keep = prev && prev.symbol === symbol ? prev : null
    w.S._qmMtfKlines = {
      symbol,
      ts: Date.now(),
      m5: m5.length ? m5 : (keep ? keep.m5 : []),
      h1: h1.length ? h1 : (keep ? keep.h1 : []),
      d1: d1.length ? d1 : (keep ? keep.d1 : []),
    }
  } catch (_) { /* silent — randurile ramand necunoscute, nu inventate */ }
}
