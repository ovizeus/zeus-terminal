// ══════════════════════════════════════════════════════════════════
// PREDICŢIA — citirea rubricii, şi mai ales ce NU are voie să spună
// ══════════════════════════════════════════════════════════════════
//
// [LIQ-PREDICT 2026-10-26] Operatorul a cerut o rubrică de predicţie long/short
// pe BTC şi ETH, „date reale, nu fake", şi a ales explicit: până sunt destule
// cazuri măsurate, panoul scrie CALIBRATING, nu un procent.
//
// Funcţiile de aici sunt singurul loc care decide CE se scrie pe ecran. Dacă
// serverul spune `calibrating`, niciun drum din fişierul ăsta nu produce un
// procent. Un test ţine exact asta.
//
// ⚠️ TOT TEXTUL VIZIBIL E ÎN ENGLEZĂ (R-P-10). Comentariile — în română.

export type Horizon = {
    horizonMs: number
    calibrating: boolean
    pct: number | null
    resolved: number
    hits: number
    need: number
    pendingTotal?: number
    // Oglinda: rata aceleiaşi distanţe în partea opusă, pe aceleaşi bare.
    // Fără ea procentul nu se poate citi — vezi liftLabel.
    controlPct?: number | null
    lift?: number | null
    controlResolved?: number
    avgTargetPct?: number | null
}

export type PredictTarget = { price: number; usd: number; n: number; pct: number }

export type PredictSignal = {
    symbol: string | null
    side: 'UP' | 'DOWN' | 'NONE'
    strength: number
    reason: string
    longBurnedUsd: number
    shortBurnedUsd: number
    imbalance: number
    events: number
    target: PredictTarget | null
    crowdLongPct: number | null
    oiChangePct: number | null
}

export type PredictSymbol = {
    symbol: string
    price: number | null
    at: number
    signal: PredictSignal
    windowMs: number
    eventsInWindow: number
    oldestEventTs: number | null
    context: { oiChangePct: number | null; oiValueUsd: number | null; crowdLongPct: number | null; at: number | null }
    horizons: Horizon[]
    minSamples: number
    // Linia de baza a simbolului. Pleaca spre client dinadins: fara ea,
    // afirmatia „burn split is normal for this market" ar fi neverificabila
    // din panou — iar tot rostul panoului e sa poata fi verificat.
    baseline: {
        imbalance: number; n: number; hours: number
        longUsd: number; shortUsd: number
        minEvents: number; minHours: number; established: boolean
    } | null
}

/** Eticheta direcţiei. 'NONE' NU devine o direcţie slabă — devine NO EDGE. */
export function sideLabel(side: string): string {
    if (side === 'UP') return 'MAGNET ↑ UP'
    if (side === 'DOWN') return 'MAGNET ↓ DOWN'
    return 'NO EDGE'
}

/**
 * Ce scrie în locul procentului.
 *
 * Singura cale prin care un procent ajunge pe ecran. Dacă serverul spune că
 * încă se calibrează, aici NU se poate obţine o cifră — nici prin rotunjire,
 * nici din `hits/resolved`.
 */
export function hitLabel(h: Horizon | null | undefined): string {
    if (!h) return 'NO DATA'
    if (h.calibrating) return `CALIBRATING ${h.resolved}/${h.need}`
    return `${h.pct}% hit rate`
}

/**
 * Rata, rata de BAZA, si raportul dintre ele.
 *
 * ⚠️ DE CE NU DOAR PROCENTUL, cu masuratoarea care a impus-o (125h de bare
 * reale, 2026-10-26): o ţinta la -0,58% pe BTC e atinsa NECONDITIONAT in 9%
 * din cazuri pe 1h, dar in 86% pe 24h.
 *
 * Deci „30% hit rate pe 1h" pare slab desi e de 3,3 ori intamplarea, iar „86%
 * pe 24h" pare excelent desi e EXACT intamplarea. Un procent singur induce in
 * eroare in AMBELE direcţii, si pe telefon nimeni n-are de unde sa ştie care.
 * Raportul e singura cifra care se poate citi.
 */
export function liftLabel(h: Horizon | null | undefined): string {
    if (!h) return 'NO DATA'
    if (h.calibrating) return `CALIBRATING ${h.resolved}/${h.need}`
    const pct = h.pct
    const ctrl = h.controlPct
    const lf = h.lift
    if (ctrl === null || ctrl === undefined || lf === null || lf === undefined) {
        return `${pct}%  (unbenchmarked)`
    }
    const ratio = lf.toFixed(1)
    // Raportul ~1 inseamna ca semnalul n-a adus nimic peste intamplare. Se
    // spune, nu se lasa cifra mare sa para o izbanda.
    const verdict = lf < 1.15 ? '  no edge' : ''
    return `${pct}% vs ${ctrl}% base  ×${ratio}${verdict}`
}

/** Orizontul, scurt: 1H / 4H / 24H. */
export function horizonLabel(ms: number): string {
    const h = Math.round(Number(ms) / 3600000)
    if (!Number.isFinite(h) || h <= 0) return '—'
    return `${h}H`
}

/** Bara de putere, din blocuri — se citeşte dintr-o privire pe telefon. */
export function strengthBar(strength: number, width = 10): string {
    const s = Math.max(0, Math.min(100, Number(strength) || 0))
    const full = Math.round((s / 100) * width)
    return '█'.repeat(full) + '░'.repeat(Math.max(0, width - full))
}

/**
 * Ţinta, cu distanţa în dolari ŞI în procente.
 *
 * Operatorul a cerut „să urce 1000$ plus pe BTC sau 2 sau 3". Cifra vine din
 * palierul măsurat, nu dintr-o rotunjire: de asta se afişează amândouă — una
 * spune cât, cealaltă spune cât de departe e.
 */
export function targetLabel(t: PredictTarget | null | undefined, price: number | null): string {
    if (!t || !Number.isFinite(Number(t.price)) || Number(t.price) <= 0) return 'no mapped cluster'
    const p = Number(price)
    const tp = Number(t.price)
    const abs = Number.isFinite(p) && p > 0 ? tp - p : null
    const sign = abs !== null && abs >= 0 ? '+' : '−'
    const pct = Number(t.pct)
    const pctTxt = Number.isFinite(pct) ? `${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%` : ''
    const absTxt = abs !== null ? `${sign}${Math.abs(Math.round(abs)).toLocaleString('en-US')}` : ''
    return `${Math.round(tp).toLocaleString('en-US')}${absTxt ? `  ${absTxt}` : ''}${pctTxt ? `  ${pctTxt}` : ''}`
}

/**
 * Cât istoric stă de fapt sub semnal. Operatorul a cerut „azi, ieri, acum 3
 * zile"; la 13 ore de colectare, „acum 3 zile" nu există, şi rubrica trebuie să
 * poată spune asta în loc să lase impresia unei ferestre pe care n-o are.
 */
export function historyLabel(oldestTs: number | null | undefined, now = Date.now()): string {
    const t = num(oldestTs)
    if (t === null || t <= 0) return 'no history yet'
    const h = (now - t) / 3600000
    if (h < 1) return `${Math.max(1, Math.round(h * 60))}m of history`
    if (h < 48) return `${h < 10 ? h.toFixed(1) : Math.round(h)}h of history`
    return `${Math.round(h / 24)}d of history`
}

/**
 * Numărul, SAU nimic. `Number(null)` e 0 şi `Number.isFinite(0)` e true, deci
 * un `null` trecut prin Number() devine o cifră adevărată la vedere.
 *
 * [2026-10-26] Exact aici m-au prins testele: `crowdLabel(null)` scria
 * „0% long / 100% short", adică o afirmaţie categorică despre piaţă construită
 * dintr-un context care LIPSEA. Aceeaşi familie cu `Object.isFrozen(undefined)`
 * care e `true` — o funcţie care răspunde politicos la o întrebare fără obiect.
 * Într-un panou al cărui singur scop e să nu mintă, asta era cea mai urâtă
 * cifră posibilă.
 */
function num(v: unknown): number | null {
    if (v === null || v === undefined || v === '') return null
    const n = Number(v)
    return Number.isFinite(n) ? n : null
}

/** Starea mulţimii, spusă ca înclinare, nu ca mărime absolută. */
export function crowdLabel(pct: number | null | undefined): string {
    const v = num(pct)
    if (v === null) return 'crowd unknown'
    return `${v.toFixed(0)}% long / ${(100 - v).toFixed(0)}% short`
}

/** Open Interest: semnul contează — ce URCĂ în timp ce arde se reface. */
export function oiLabel(changePct: number | null | undefined): string {
    const v = num(changePct)
    if (v === null) return 'OI unknown'
    return `OI ${v >= 0 ? '+' : ''}${v.toFixed(2)}% /1h`
}

export async function fetchPredict(signal?: AbortSignal): Promise<PredictSymbol[]> {
    try {
        const r = await fetch('/api/market/liq-predict', {
            credentials: 'same-origin',
            signal,
        })
        if (!r.ok) return []
        const j = await r.json()
        return Array.isArray(j?.symbols) ? j.symbols : []
    } catch {
        return []
    }
}
