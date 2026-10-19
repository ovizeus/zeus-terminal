// ═══════════════════════════════════════════════════════════════════════════
// FLOW INDICATORS — cinci instrumente pe date care nu erau folosite de nimeni
//
// Cerut de operator 2026-10-19: cinci indicatori „total diferiti", pe date
// reale. Masurat inainte de a proiecta: toti cei 91 de indicatori existenti
// citesc EXCLUSIV OHLCV. In `indicatorCalc.ts` numarul de referinte la
// `S.bids`, `S.asks`, `S.buckets` si `oiHistory` este ZERO. Deci cartea de
// ordine, feed-ul de lichidari, open interest-ul si premium-ul perp sunt date
// reale pe care Zeus le primeste si le arunca.
//
// Fiecare dintre cele cinci sta pe una dintre ele:
//   HECATE   — cartea de ordine        (S.bids / S.asks)
//   THANATOS — lichidari               (S.buckets, ferestrele 1m/5m/15m)
//   AION     — open interest + funding (oiHistory, S.fr)
//   HYPNOS   — sezonalitate orara      (marcajele de timp din klines)
//   NOTOS    — premium perp            (S.markPrice vs S.indexPrice, S.fr)
//
// Niciunul nu e o variatie pe o medie mobila. Toate functiile de aici sunt
// pure: primesc date, intorc numere. Randarea sta in `indicators.ts`.
// ═══════════════════════════════════════════════════════════════════════════

export interface DepthLevel { p: number; q: number }

// ───────────────────────────────────────────────────────────────────────────
// HECATE — presiunea cartii de ordine
//
// Dezechilibrul nu e un singur numar: o carte poate fi grea pe cumparare la
// 5 puncte de baza si grea pe vanzare la 50. Deci se masoara pe benzi de
// distanta de la mijloc, iar presiunea compusa pondereaza benzile apropiate
// mai mult, pentru ca ele sunt cele care chiar opresc pretul acum.
// ───────────────────────────────────────────────────────────────────────────

export const HECATE_BANDS = [0.0005, 0.001, 0.0025, 0.005] as const

export interface HecateBand {
  pct: number        // distanta de la mijloc, ca fractie (0.0005 = 5 bps)
  bidUsd: number
  askUsd: number
  imbalance: number  // -100 (tot vanzare) .. +100 (tot cumparare)
}

export interface HecateWall {
  price: number
  usd: number
  side: 'bid' | 'ask'
  ratio: number      // de cate ori e mai mare decat nivelul median din banda
}

export interface Hecate {
  mid: number | null
  bands: HecateBand[]
  pressure: number          // compus, ponderat pe benzi, -100..100
  state: 'BID_WALL' | 'BID_LEAN' | 'BALANCED' | 'ASK_LEAN' | 'ASK_WALL'
  walls: HecateWall[]
  spreadBps: number | null
  depthUsd: number          // lichiditate totala masurata, in dolari
}

function _median(xs: number[]): number {
  if (!xs.length) return 0
  const s = [...xs].sort((a, b) => a - b)
  const m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

export function hecate(
  bids: DepthLevel[], asks: DepthLevel[], wallRatio = 4,
): Hecate {
  const empty: Hecate = {
    mid: null, bands: [], pressure: 0, state: 'BALANCED',
    walls: [], spreadBps: null, depthUsd: 0,
  }
  if (!Array.isArray(bids) || !Array.isArray(asks) || !bids.length || !asks.length) return empty

  // Cartea poate veni nesortata; mijlocul se ia din cel mai bun nivel real.
  const bestBid = Math.max(...bids.map(l => l.p).filter(Number.isFinite))
  const bestAsk = Math.min(...asks.map(l => l.p).filter(Number.isFinite))
  if (!Number.isFinite(bestBid) || !Number.isFinite(bestAsk) || bestBid <= 0 || bestAsk <= 0) return empty

  const mid = (bestBid + bestAsk) / 2
  const spreadBps = mid > 0 ? ((bestAsk - bestBid) / mid) * 10000 : null

  const bands: HecateBand[] = HECATE_BANDS.map(pct => {
    // Distanta se masoara ca RAPORT, nu prin limite calculate. `mid * (1+pct)`
    // si `mid * (1-pct)` nu sunt simetrice in virgula mobila: pentru mid=100 si
    // pct=0,005 limita de sus iese 100,49999999999999, deci un nivel exact la
    // 100,5 cadea afara, in timp ce oglinda lui la 99,5 intra. Asta inclina
    // dezechilibrul spre o parte, tacut, pe o carte perfect simetrica.
    const EPS = 1e-12
    let bidUsd = 0, askUsd = 0
    for (const l of bids) {
      if (!Number.isFinite(l.p) || !Number.isFinite(l.q) || l.p > mid) continue
      if ((mid - l.p) / mid <= pct + EPS) bidUsd += l.p * l.q
    }
    for (const l of asks) {
      if (!Number.isFinite(l.p) || !Number.isFinite(l.q) || l.p < mid) continue
      if ((l.p - mid) / mid <= pct + EPS) askUsd += l.p * l.q
    }
    const tot = bidUsd + askUsd
    return { pct, bidUsd, askUsd, imbalance: tot > 0 ? ((bidUsd - askUsd) / tot) * 100 : 0 }
  })

  // Benzile apropiate conteaza mai mult: ponderi 4,3,2,1 normalizate. O banda
  // fara lichiditate deloc nu trage media spre zero — e exclusa.
  const weights = [4, 3, 2, 1]
  let wsum = 0, acc = 0
  bands.forEach((b, i) => {
    if (b.bidUsd + b.askUsd <= 0) return
    acc += b.imbalance * weights[i]
    wsum += weights[i]
  })
  const pressure = wsum > 0 ? Math.max(-100, Math.min(100, acc / wsum)) : 0

  const state: Hecate['state'] =
    pressure >= 55 ? 'BID_WALL' :
      pressure >= 18 ? 'BID_LEAN' :
        pressure > -18 ? 'BALANCED' :
          pressure > -55 ? 'ASK_LEAN' : 'ASK_WALL'

  // Ziduri: nivele anormal de mari fata de MEDIANA din propria parte. Mediana,
  // nu media, pentru ca un singur zid uriaș ar ridica media si s-ar ascunde.
  const walls: HecateWall[] = []
  const far = mid * HECATE_BANDS[HECATE_BANDS.length - 1]
  for (const [side, levels] of [['bid', bids], ['ask', asks]] as const) {
    const near = levels.filter(l => Math.abs(l.p - mid) <= far && l.q > 0)
    if (near.length < 4) continue
    const med = _median(near.map(l => l.p * l.q))
    if (med <= 0) continue
    for (const l of near) {
      const usd = l.p * l.q
      const ratio = usd / med
      if (ratio >= wallRatio) walls.push({ price: l.p, usd, side, ratio })
    }
  }
  walls.sort((a, b) => b.usd - a.usd)

  const depthUsd = bands.length ? bands[bands.length - 1].bidUsd + bands[bands.length - 1].askUsd : 0
  return { mid, bands, pressure, state, walls: walls.slice(0, 6), spreadBps, depthUsd }
}

// ───────────────────────────────────────────────────────────────────────────
// THANATOS — cascade de lichidari
//
// Nu „au fost lichidari", ci: sunt mai multe decat de obicei, pe care parte,
// si se accelereaza? Acceleratia se citeste comparand rata pe 1 minut cu rata
// implicata de fereastra de 15 minute: o cascada e, prin definitie, o rata
// instantanee mult peste media recenta.
// ───────────────────────────────────────────────────────────────────────────

export interface LiqBucket { l: number; s: number }
export interface LiqWindow { l: number; s: number }

export interface Thanatos {
  intensity: number    // rata de acum / rata normala; 1 = normal
  dominance: number    // -100 (numai shorturi lichidate) .. +100 (numai longuri)
  acceleration: number // rata 1m vs rata implicata de 15m, in multipli
  state: 'CALM' | 'ELEVATED' | 'CASCADE_LONGS' | 'CASCADE_SHORTS'
  usd1m: number
  usd15m: number
  bucketsSeen: number
}

export function thanatos(
  buckets: LiqBucket[], w1m: LiqWindow, w5m: LiqWindow, w15m: LiqWindow,
  cascadeMult = 3,
): Thanatos {
  const safe = (x: any) => (Number.isFinite(x) && x > 0 ? x : 0)
  const b = Array.isArray(buckets) ? buckets : []
  const totals = b.map(x => safe(x?.l) + safe(x?.s)).filter(v => v > 0)

  const usd1m = safe(w1m?.l) + safe(w1m?.s)
  const usd15m = safe(w15m?.l) + safe(w15m?.s)

  // „Normal" = mediana bucketilor nevizi. Cu prea putine date nu inventam o
  // normalitate: intensitatea rămâne 1 si starea CALM.
  const norm = totals.length >= 4 ? _median(totals) : 0
  const intensity = norm > 0 ? (usd1m / norm) : (usd1m > 0 && totals.length < 4 ? 1 : 0)

  const dom1 = safe(w5m?.l) + safe(w5m?.s)
  const dominance = dom1 > 0 ? ((safe(w5m?.l) - safe(w5m?.s)) / dom1) * 100 : 0

  // Rata pe minut implicata de fereastra de 15 minute, comparata cu minutul curent.
  const rate15 = usd15m / 15
  const acceleration = rate15 > 0 ? usd1m / rate15 : (usd1m > 0 ? 1 : 0)

  let state: Thanatos['state'] = 'CALM'
  if (acceleration >= cascadeMult && usd1m > 0) {
    state = dominance >= 0 ? 'CASCADE_LONGS' : 'CASCADE_SHORTS'
  } else if (acceleration >= 1.5 && usd1m > 0) {
    state = 'ELEVATED'
  }

  return {
    intensity: Math.round(intensity * 100) / 100,
    dominance: Math.round(dominance),
    acceleration: Math.round(acceleration * 100) / 100,
    state, usd1m, usd15m, bucketsSeen: totals.length,
  }
}

// ───────────────────────────────────────────────────────────────────────────
// AION — regimul de pozitionare din derivate
//
// Tabelul de adevar pe care traderii de futures il folosesc de decenii, dar
// care in Zeus nu exista nicaieri: ce face open interest-ul fata de ce face
// pretul spune CINE intra si cine iese. Funding-ul adauga cat de scump e sa
// stai in partea aglomerata.
//
//   OI sus + pret sus  → intra longuri noi      (longuri aglomerate)
//   OI sus + pret jos  → intra shorturi noi     (shorturi aglomerate)
//   OI jos + pret jos  → ies longuri            (lichidare de longuri)
//   OI jos + pret sus  → ies shorturi           (acoperire de shorturi)
// ───────────────────────────────────────────────────────────────────────────

export type AionRegime =
  | 'LONGS_CROWDED' | 'SHORTS_CROWDED' | 'LONG_UNWIND' | 'SHORT_COVER' | 'QUIET'

export interface Aion {
  regime: AionRegime
  oiChangePct: number
  priceChangePct: number
  fundingBps: number       // funding in puncte de baza, pe interval
  squeezeRisk: number      // 0..100
  crowdedSide: 'long' | 'short' | null
}

export function aion(
  oiSeries: number[], priceSeries: number[], fundingRate: number,
  deadzonePct = 0.05,
): Aion {
  const quiet: Aion = {
    regime: 'QUIET', oiChangePct: 0, priceChangePct: 0,
    fundingBps: Number.isFinite(fundingRate) ? fundingRate * 10000 : 0,
    squeezeRisk: 0, crowdedSide: null,
  }
  const oi = (oiSeries || []).filter(Number.isFinite)
  const px = (priceSeries || []).filter(Number.isFinite)
  if (oi.length < 2 || px.length < 2) return quiet

  const oi0 = oi[0], oi1 = oi[oi.length - 1]
  const px0 = px[0], px1 = px[px.length - 1]
  if (oi0 <= 0 || px0 <= 0) return quiet

  const oiChangePct = ((oi1 - oi0) / oi0) * 100
  const priceChangePct = ((px1 - px0) / px0) * 100
  const fundingBps = Number.isFinite(fundingRate) ? fundingRate * 10000 : 0

  // Sub zona moarta nu exista regim: zgomotul nu e pozitionare.
  if (Math.abs(oiChangePct) < deadzonePct && Math.abs(priceChangePct) < deadzonePct) {
    return { ...quiet, oiChangePct, priceChangePct, fundingBps }
  }

  const oiUp = oiChangePct >= 0
  const pxUp = priceChangePct >= 0
  const regime: AionRegime = oiUp
    ? (pxUp ? 'LONGS_CROWDED' : 'SHORTS_CROWDED')
    : (pxUp ? 'SHORT_COVER' : 'LONG_UNWIND')

  const crowdedSide: Aion['crowdedSide'] =
    regime === 'LONGS_CROWDED' ? 'long' : regime === 'SHORTS_CROWDED' ? 'short' : null

  // Riscul de squeeze: pozitii noi care intra (OI in creștere) PLUS un funding
  // care arata ca partea aglomerata plateste ca sa stea acolo. Cele doua
  // jumatati se aduna doar daca arata in aceeasi direcție.
  let squeezeRisk = 0
  if (crowdedSide) {
    const crowding = Math.min(60, Math.abs(oiChangePct) * 12)
    const payingToStay = (crowdedSide === 'long' && fundingBps > 0) || (crowdedSide === 'short' && fundingBps < 0)
    const cost = payingToStay ? Math.min(40, Math.abs(fundingBps) * 40) : 0
    squeezeRisk = Math.round(Math.min(100, crowding + cost))
  }

  return {
    regime,
    oiChangePct: Math.round(oiChangePct * 1000) / 1000,
    priceChangePct: Math.round(priceChangePct * 1000) / 1000,
    fundingBps: Math.round(fundingBps * 100) / 100,
    squeezeRisk, crowdedSide,
  }
}

// ───────────────────────────────────────────────────────────────────────────
// HYPNOS — ceasul de volatilitate
//
// Singurul din Zeus care nu intreaba „incotro", ci „cand". Volatilitatea
// cripto are un profil orar stabil (deschiderile Asia / Londra / New York).
// HYPNOS construieste profilul din istoricul REAL incarcat, apoi spune daca
// ora curenta e mai agitata sau mai liniștita decat e ea de obicei.
//
// Important: compara ora cu EA INSASI, nu cu media zilei. O ora liniștită
// care devine agitata e semnal; o ora agitata care e agitata nu e.
// ───────────────────────────────────────────────────────────────────────────

export interface HypnosHour { hour: number; meanRangePct: number; samples: number }

export interface Hypnos {
  profile: HypnosHour[]        // 24 de intrari, ora UTC
  currentHour: number | null
  currentRangePct: number | null
  normalRangePct: number | null
  ratio: number | null         // acum / normal pentru ora asta
  zscore: number | null
  state: 'DORMANT' | 'QUIET' | 'NORMAL' | 'ACTIVE' | 'STORM' | 'UNKNOWN'
  coverageHours: number        // cate ore au suficiente mostre
}

export function hypnos(
  times: number[], highs: number[], lows: number[], closes: number[],
  minSamples = 3,
): Hypnos {
  const unknown: Hypnos = {
    profile: [], currentHour: null, currentRangePct: null, normalRangePct: null,
    ratio: null, zscore: null, state: 'UNKNOWN', coverageHours: 0,
  }
  const n = Math.min(times?.length || 0, highs?.length || 0, lows?.length || 0, closes?.length || 0)
  if (n < 2) return unknown

  // Marcajul de timp vine in secunde (lightweight-charts) sau milisecunde.
  const toHour = (t: number): number | null => {
    if (!Number.isFinite(t) || t <= 0) return null
    const ms = t < 1e11 ? t * 1000 : t
    const h = new Date(ms).getUTCHours()
    return Number.isFinite(h) ? h : null
  }

  const byHour: number[][] = Array.from({ length: 24 }, () => [])
  const ranges: (number | null)[] = new Array(n).fill(null)
  for (let i = 0; i < n; i++) {
    const h = toHour(times[i])
    const c = closes[i]
    if (h == null || !Number.isFinite(c) || c <= 0) continue
    if (!Number.isFinite(highs[i]) || !Number.isFinite(lows[i])) continue
    const r = ((highs[i] - lows[i]) / c) * 100
    if (!Number.isFinite(r) || r < 0) continue
    ranges[i] = r
    byHour[h].push(r)
  }

  const profile: HypnosHour[] = byHour.map((xs, hour) => ({
    hour,
    meanRangePct: xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0,
    samples: xs.length,
  }))
  const coverageHours = profile.filter(p => p.samples >= minSamples).length

  // Ultima bara cu interval valid e „acum".
  let lastIdx = -1
  for (let i = n - 1; i >= 0; i--) { if (ranges[i] != null) { lastIdx = i; break } }
  if (lastIdx < 0) return { ...unknown, profile, coverageHours }

  const currentHour = toHour(times[lastIdx])
  const currentRangePct = ranges[lastIdx] as number
  if (currentHour == null) return { ...unknown, profile, coverageHours }

  // Norma orei se construieste FARA bara curenta. Altfel bara se compara cu o
  // medie care o include pe ea insasi, iar semnalul se autoamortizeaza: un salt
  // de trei ori peste normal se citea ca 2,6 ori, si cu cat istoricul e mai
  // scurt cu atat minte mai mult.
  const sameHour = byHour[currentHour].slice(0, -1)
  if (sameHour.length < minSamples) {
    return {
      profile, currentHour, currentRangePct, normalRangePct: null,
      ratio: null, zscore: null, state: 'UNKNOWN', coverageHours,
    }
  }

  const mean = sameHour.reduce((a, b) => a + b, 0) / sameHour.length
  const variance = sameHour.reduce((a, b) => a + (b - mean) * (b - mean), 0) / sameHour.length
  const sd = Math.sqrt(variance)
  const ratio = mean > 0 ? currentRangePct / mean : null
  const zscore = sd > 0 ? (currentRangePct - mean) / sd : 0

  // Starea se citeste din z-score cand ora ARE o dispersie proprie. Cand nu
  // are — un istoric scurt in care ora a fost mereu identica — z-score-ul e
  // degenerat: sd=0 l-ar face 0, adica o ora perfect stabila care se tripleaza
  // s-ar raporta NORMAL. In cazul ala decide raportul, care rămâne valid.
  const dispersed = sd > mean * 0.02 && mean > 0
  const state: Hypnos['state'] = dispersed
    ? (zscore >= 2 ? 'STORM'
      : zscore >= 0.75 ? 'ACTIVE'
        : zscore > -0.75 ? 'NORMAL'
          : zscore > -1.5 ? 'QUIET' : 'DORMANT')
    : (ratio == null ? 'UNKNOWN'
      : ratio >= 2 ? 'STORM'
        : ratio >= 1.3 ? 'ACTIVE'
          : ratio > 0.7 ? 'NORMAL'
            : ratio > 0.5 ? 'QUIET' : 'DORMANT')

  return {
    profile, currentHour, currentRangePct,
    normalRangePct: mean,
    ratio: ratio == null ? null : Math.round(ratio * 1000) / 1000,
    zscore: Math.round(zscore * 100) / 100,
    state, coverageHours,
  }
}

// ───────────────────────────────────────────────────────────────────────────
// NOTOS — premium-ul perpetual
//
// `S.basisRate` se calculeaza din 2026 si nu il citeste nimeni. Premium-ul
// (mark peste index) spune cat de sus sta perpetualul fata de spot. Partea
// utila e DIVERGENTA: cand perpetualul e scump dar funding-ul e negativ,
// cineva plateste ca sa stea short intr-o piata care urca — combustibil de
// squeeze. Cand e invers, la fel, pe partea cealalta.
// ───────────────────────────────────────────────────────────────────────────

export interface Notos {
  premiumBps: number | null
  fundingBps: number
  aligned: boolean | null      // premium si funding arata in acelasi sens?
  state: 'PERP_RICH' | 'PERP_CHEAP' | 'FAIR' | 'DIVERGENT_RICH' | 'DIVERGENT_CHEAP' | 'UNKNOWN'
  squeezeFuel: number          // 0..100, cat de puternica e divergenta
}

export function notos(
  markPrice: number, indexPrice: number, fundingRate: number,
  fairBps = 2,
): Notos {
  const fundingBps = Number.isFinite(fundingRate) ? fundingRate * 10000 : 0
  if (!Number.isFinite(markPrice) || !Number.isFinite(indexPrice) || indexPrice <= 0 || markPrice <= 0) {
    return { premiumBps: null, fundingBps, aligned: null, state: 'UNKNOWN', squeezeFuel: 0 }
  }
  const premiumBps = ((markPrice - indexPrice) / indexPrice) * 10000

  if (Math.abs(premiumBps) < fairBps) {
    return {
      premiumBps: Math.round(premiumBps * 100) / 100,
      fundingBps: Math.round(fundingBps * 100) / 100,
      aligned: null, state: 'FAIR', squeezeFuel: 0,
    }
  }

  const rich = premiumBps > 0
  // Aliniat = amandoua pozitive sau amandoua negative. Un funding exact zero
  // nu contrazice nimic, deci nu il numaram ca divergenta.
  const aligned = fundingBps === 0 ? true : (rich === (fundingBps > 0))

  const state: Notos['state'] = aligned
    ? (rich ? 'PERP_RICH' : 'PERP_CHEAP')
    : (rich ? 'DIVERGENT_RICH' : 'DIVERGENT_CHEAP')

  // Combustibilul creste cu amandoua: cat de departe e premium-ul si cat de
  // tare il contrazice funding-ul. Zero cand sunt aliniate.
  const squeezeFuel = aligned ? 0
    : Math.round(Math.min(100, Math.abs(premiumBps) * 4 + Math.abs(fundingBps) * 30))

  return {
    premiumBps: Math.round(premiumBps * 100) / 100,
    fundingBps: Math.round(fundingBps * 100) / 100,
    aligned, state, squeezeFuel,
  }
}
