// ═══════════════════════════════════════════════════════════════════════════
// ICHNOS — footprint: calculele pe fiecare lumanare (functii pure)
// ═══════════════════════════════════════════════════════════════════════════
// [2026-11-16] Din capturile „Orderflow Trader Lab" cerute de operator: pe fiecare
// nivel „vandut x cumparat", Σ volum si Δ delta deasupra si dedesubt, POC
// incadrat, dezechilibrele diagonale scrise aldin (albastru = cumparatori,
// rosu = vanzatori), dezechilibrele stivuite marcate ca zona, nivelurile cu
// ordine mari marcate ca linie.
//
// Datele vin de la /api/market/footprint (tranzactii Bybit, in dolari):
//   lv = [[pret, bid, ask], ...]  descrescator dupa pret
//   bid = vandut agresiv (a lovit bid-ul), ask = cumparat agresiv.

export interface FpCandle { t: number; o: number; h: number; l: number; c: number; lv: Array<[number, number, number]> }
export interface FpZone { side: 'buy' | 'sell'; low: number; high: number; fromT: number }
export interface FpDerived {
    total: number
    delta: number                 // ask − bid
    poc: number | null            // pretul nivelului cu cel mai mare volum
    maxCell: number
    buyImb: Set<number>           // preturi unde CUMPARATORII domina diagonal
    sellImb: Set<number>          // preturi unde VANZATORII domina diagonal
    stacked: FpZone[]
}
export interface FpOpts { ratio?: number; minShare?: number; stackMin?: number }

/**
 * Dezechilibrul DIAGONAL, ca in orice footprint: cumparatorii de la pretul p se
 * compara cu vanzatorii de la nivelul de DEDESUBT (cei care le-au dat marfa), iar
 * vanzatorii de la p cu cumparatorii de la nivelul de DEASUPRA. Un nivel trebuie
 * sa aiba si volum (minShare din totalul lumanarii), altfel 3 dolari vs 0 = „infinit".
 */
export function deriveCandle(c: FpCandle, bin: number, opts: FpOpts = {}): FpDerived {
    const ratio = opts.ratio ?? 3
    const minShare = opts.minShare ?? 0.02
    const stackMin = Math.max(2, Math.round(opts.stackMin ?? 3))
    const byP = new Map<number, [number, number]>()
    let total = 0, delta = 0, poc: number | null = null, maxCell = 0
    for (const [p, bid, ask] of c.lv) {
        byP.set(p, [bid, ask])
        total += bid + ask
        delta += ask - bid
        if (bid + ask > maxCell) { maxCell = bid + ask; poc = p }
    }
    const minVol = total * minShare
    const key = (p: number) => +p.toFixed(8)
    const at = (p: number) => byP.get(key(p)) || byP.get(p)
    const buyImb = new Set<number>(), sellImb = new Set<number>()
    for (const [p, bid, ask] of c.lv) {
        // La capete nu exista nivelul cu care se compara: nu e dezechilibru (nu „infinit").
        const below = at(key(p - bin))          // vanzatorii de dedesubt
        const above = at(key(p + bin))          // cumparatorii de deasupra
        if (below && ask > 0 && ask >= minVol && ask >= ratio * Math.max(below[0], 1e-9)) buyImb.add(p)
        if (above && bid > 0 && bid >= minVol && bid >= ratio * Math.max(above[1], 1e-9)) sellImb.add(p)
    }
    // Stivuite: cel putin `stackMin` niveluri ALATURATE cu dezechilibru de aceeasi parte.
    const stacked: FpZone[] = []
    const prices = c.lv.map((x) => x[0]).sort((a, b) => a - b)
    for (const side of ['buy', 'sell'] as const) {
        const set = side === 'buy' ? buyImb : sellImb
        let run: number[] = []
        const flush = () => {
            if (run.length >= stackMin) stacked.push({ side, low: run[0], high: +(run[run.length - 1] + bin).toFixed(8), fromT: c.t })
            run = []
        }
        for (const p of prices) {
            if (set.has(p) && (run.length === 0 || Math.abs(p - run[run.length - 1] - bin) < bin * 1e-6)) run.push(p)
            else { flush(); if (set.has(p)) run.push(p) }
        }
        flush()
    }
    return { total, delta, poc, maxCell, buyImb, sellImb, stacked }
}

/**
 * Nivelurile cu ordine mari pe fereastra vazuta: o celula cu volum de cel putin
 * `mult` ori mediana tuturor celulelor. Intoarce cele mai mari `max`, cele mai noi intai.
 */
export function bigLevels(candles: FpCandle[], mult = 4, max = 3): Array<{ price: number; vol: number; t: number }> {
    const vols: number[] = []
    for (const c of candles) for (const [, b, a] of c.lv) vols.push(b + a)
    if (vols.length < 10) return []
    const s = vols.slice().sort((x, y) => x - y)
    const med = s[Math.floor(s.length / 2)]
    if (!(med > 0)) return []
    const out: Array<{ price: number; vol: number; t: number }> = []
    for (const c of candles) for (const [p, b, a] of c.lv) if (b + a >= mult * med) out.push({ price: p, vol: b + a, t: c.t })
    return out.sort((x, y) => y.vol - x.vol).slice(0, max).sort((x, y) => y.t - x.t)
}

/** „179" din 179.400 $ — afisajul in mii de dolari, intregi (ca in capturi). */
export function kfmt(usd: number): string {
    const k = usd / 1000
    if (k >= 100) return String(Math.round(k))
    if (k >= 10) return String(Math.round(k))
    if (k >= 1) return k.toFixed(0)
    return k > 0 ? k.toFixed(1).replace(/^0/, '') : '0'
}

/** Σ cu separator de mii: 1806 → „1,806". */
export function sumFmt(usd: number): string {
    return Math.round(usd / 1000).toLocaleString('en-US')
}
