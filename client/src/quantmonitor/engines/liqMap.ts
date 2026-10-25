// QM Liquidation Map — [BUG5.5] Real liquidation aggregation (rolling 24h)
// Replaces the prior synthetic bracket-MMR model (OI × weight × price) which
// produced multi-billion-dollar phantom clusters. Now reads from live feeds:
//   1. w.S.llvBuckets   — Binance + Bybit real liqs (populated by procLiq)
//   2. QM.liqAgg.okx    — OKX real liqs (populated by addLiq via WS)
// Each event is bucketed by %-from-current-price at 0.25% granularity so the
// render layer can offer fine resolution near price and aggregate farther out.
import { QM } from '../state'

const w = window as any

const WINDOW_MS = 24 * 3600 * 1000   // rolling 24-hour window
const MAX_PCT = 35                    // clip far-out noise (matches prior UI)
const MIN_PCT = 0.05                  // ignore micro-jitter at price

export function buildLiqEstimate(): void {
  const c = w.S; if (!c || !c.price) return
  const p = c.price
  const cutoff = Date.now() - WINDOW_MS

  c._qmLiqBuckets = {} as Record<number, { price: number; longVol: number; shortVol: number; lev: string[] }>

  const addBucket = (pct: number, bPrice: number, isLong: boolean, usd: number) => {
    if (!Number.isFinite(usd) || usd <= 0) return
    if (Math.abs(pct) < MIN_PCT || Math.abs(pct) > MAX_PCT) return
    const bk = Math.round(pct * 4) / 4
    if (!c._qmLiqBuckets[bk]) c._qmLiqBuckets[bk] = { price: bPrice, longVol: 0, shortVol: 0, lev: [] }
    if (isLong) c._qmLiqBuckets[bk].longVol += usd
    else c._qmLiqBuckets[bk].shortVol += usd
    c._qmLiqBuckets[bk].price = bPrice
  }

  // 0) [LIQ-HISTORY 2026-10-25] Istoricul de pe server, daca a sosit.
  //
  //    Operatorul: „nivele de lichidari sunt putine, vreau sa vad lichidari
  //    pana sus si pana jos, dar cu date reale". Randurile goale NU erau un
  //    bug: harta arata numai lichidari care chiar s-au intamplat, pe 24h, iar
  //    BTC s-a miscat +0,6% / -0,6% in 24h. Masurat pe pretul real, 30 de zile
  //    acopera +8,3% / -1,7%. Deci fereastra e tot ce lipsea — nu un model.
  //
  //    Reperul `asOf` exista ca sa NU numaram de doua ori: serverul are tot
  //    istoricul si trimite aceleasi evenimente si in direct. Istoricul e
  //    BAZA; local adaugam doar ce e mai nou decat reperul.
  const srv = (w.__qmLiqServer && typeof w.__qmLiqServer === 'object') ? w.__qmLiqServer : null
  const srvAsOf = srv && Number.isFinite(+srv.asOf) ? +srv.asOf : 0
  // De UNDE incepe acoperirea serverului. 0 = nu acopera nimic pe simbolul
  // asta, deci nu avem voie sa aruncam NIMIC din ce are clientul.
  //
  // [REGRESIE 2026-10-25 23:22, prinsa dintr-o captura] Prima varianta sarea
  // peste orice eveniment local mai vechi decat `asOf`, pe presupunerea ca
  // „serverul are tot ce are clientul". FALS: serverul a inceput sa
  // inregistreze azi la 20:28, clientul avea 24h in localStorage. Pe BTC
  // serverul avea ZERO randuri si trimitea asOf=acum -> tot istoricul local
  // era aruncat si nu venea nimic in loc. Scara, care avea 6 randuri cu date,
  // a ramas complet goala.
  const srvSince = srv && Number.isFinite(+srv.since) ? +srv.since : 0
  if (srv && Array.isArray(srv.buckets)) {
    srv.buckets.forEach((b: any) => {
      if (!b || !Number.isFinite(+b.pct)) return
      const bPrice = Number.isFinite(+b.price) ? +b.price : p * (1 + (+b.pct) / 100)
      if (+b.longUsd > 0) addBucket(+b.pct, bPrice, true, +b.longUsd)
      if (+b.shortUsd > 0) addBucket(+b.pct, bPrice, false, +b.shortUsd)
    })
  }

  // 1) Per-event buffers from all 3 exchanges (populated by addLiq via
  //    zeus:liq / zeus:okxLiq). These bypass the liqMinUsd threshold, so the
  //    map stays populated even when big liqs are sparse.
  const allEvents = ([] as any[])
    .concat(QM.liqAgg.binance.btc || [])
    .concat(QM.liqAgg.bybit.btc || [])
    .concat(QM.liqAgg.okx.btc || [])
  allEvents.forEach(liq => {
    if (!liq || !liq.p || !liq.vol) return
    if (liq.time && liq.time < cutoff) return
    // Deja numarat de server: il sarim, altfel bara ar arata dublu fata de
    // adevar — exact genul de cifra umflata pentru care modelul sintetic a
    // fost scos la BUG5.5.
    if (srvSince && srvAsOf && liq.time && liq.time >= srvSince && liq.time <= srvAsOf) return
    const isLong = liq.side === 'SELL' || !!liq.isLong
    const pct = ((+liq.p - p) / p) * 100
    addBucket(pct, +liq.p, isLong, +liq.vol)
  })

  // 2) Fallback: w.S.llvBuckets (classic Zeus llv feed, already per-price
  //    aggregated but subject to liqMinUsd). Adds extra density from liqs
  //    that may have missed the dispatch path.
  const llv = c.llvBuckets || {}
  for (const pkey in llv) {
    const b = llv[pkey]; if (!b || !b.price) continue
    if (b.ts && b.ts < cutoff) continue
    if (srvSince && srvAsOf && b.ts && b.ts >= srvSince && b.ts <= srvAsOf) continue   // deja in istoric

    const pct = ((b.price - p) / p) * 100
    if (b.longUSD > 0) addBucket(pct, b.price, true, b.longUSD)
    if (b.shortUSD > 0) addBucket(pct, b.price, false, b.shortUSD)
  }
}

/**
 * [LIQ-HISTORY 2026-10-25] Aduce istoricul de lichidari de pe server.
 *
 * Fara asta, unirea din buildLiqEstimate e cod mort — exact capcana
 * `SMART_CUT`, care a stat luni de zile in spatele unui comutator ce parea
 * pornit. Un esec lasa harta exact cum era inainte (doar direct, 24h), deci
 * degradeaza, nu cade.
 */
export async function fetchLiqHistory(): Promise<void> {
  const c = w.S; if (!c || !c.price) return
  try {
    const sym = (c.symbol || 'BTCUSDT').toUpperCase()
    const r = await fetch(`/api/market/liq-map?symbol=${sym}&ref=${c.price}&days=30`)
    if (!r || !r.ok) return
    const m = await r.json()
    if (m && Array.isArray(m.buckets)) w.__qmLiqServer = m
  } catch (_) { /* harta ramane pe direct; nu stricam ce merge deja */ }
}

export async function fetchTopTraderPositionRatio(): Promise<void> {
  const c = w.S; if (!c) return
  try {
    // [P2-QM 2026-06-10] was hardcoded BTCUSDT — use the active symbol.
    // Server route /api/market/topLongShort passes symbol through (no whitelist).
    const sym = (c.symbol || 'BTCUSDT').toUpperCase()
    const tp = await (await fetch(`/api/market/topLongShort?symbol=${sym}&period=5m&limit=1`)).json()
    if (tp.length) { c._qmPosLongRatio = +tp[0].longAccount; c._qmPosShortRatio = +tp[0].shortAccount }
  } catch (_) {
    // c.ls is the {l, s} percentage split (sum≈100) — the old scalar fallback
    // assigned the whole object, silently breaking `posLongRatio > 0` in frame.
    c._qmPosLongRatio = c.ls?.l ? c.ls.l / 100 : 0.5
    c._qmPosShortRatio = c.ls?.s ? c.ls.s / 100 : 0.5
  }
}
