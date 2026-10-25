// ══════════════════════════════════════════════════════════════════
// Harta de lichidări — cum devin dolarii culoare şi text citibil
// ══════════════════════════════════════════════════════════════════
//
// [LIQ-PANEL 2026-10-25] Partea pură, deci partea testabilă. Operatorul a
// cerut explicit „să se citească uşor, să se înţeleagă" — pe telefon.
//
// Paleta nu e neonul obişnuit de cripto. Subiectul e o IEŞIRE FORŢATĂ, şi sunt
// două lucruri opuse care nu trebuie confundate niciodată:
//
//   LONG lichidat  = cineva a fost vândut cu forţa  → chihlimbar spre roşu
//   SHORT lichidat = cineva a fost cumpărat cu forţa → cyan spre verde rece
//
// Nu roşu/verde clasic de lumânări: acolo verdele înseamnă „preţ sus". Aici
// verdele ar însemna „short lichidat", care se întâmplă tot când preţul urcă —
// deci s-ar citi greşit exact în momentul care contează. Două familii distincte
// de nuanţe, nu două capete ale aceleiaşi.

export const LIQ = {
    long: '#ff8c42',    // chihlimbar-foc: vânzare forţată
    short: '#35e0d0',   // cyan rece: cumpărare forţată
    longRgb: [255, 140, 66] as [number, number, number],
    shortRgb: [53, 224, 208] as [number, number, number],
}

/** Culoarea plină a unei bare, după partea lichidată. */
export function barColor(isLong: boolean): string {
    return isLong ? LIQ.long : LIQ.short
}

/**
 * Dolari → text scurt care NU minte.
 *
 * 300 $ se arată ca „$300", nu ca „$0K": o lichidare mică e tot o lichidare, şi
 * o cifră rotunjită la zero face o celulă plină să pară goală.
 */
export function fmtUsd(v: number): string {
    const n = Number(v)
    if (!Number.isFinite(n) || n <= 0) return '—'
    if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B'
    if (n >= 1e6) return '$' + (n / 1e6).toFixed(2) + 'M'
    if (n >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K'
    return '$' + Math.round(n)
}

/** Procente cu semn — direcţia e jumătate din informaţie. */
export function fmtPct(v: number): string {
    const n = Number(v)
    if (!Number.isFinite(n)) return '—'
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%'
}

/**
 * Intensitate LOGARITMICĂ, şi asta nu e o preferinţă estetică.
 *
 * Lichidările se întind pe ordine de mărime: o celulă de 10 mii lângă una de
 * 10 milioane. Liniar, prima ar da 0,001 — adică negru, adică „nu s-a
 * întâmplat nimic acolo". Logaritmic rămâne vizibilă, ceea ce e adevărul:
 * s-a întâmplat ceva, mai puţin.
 */
export function intensity(usd: number, maxUsd: number): number {
    const v = Number(usd)
    const m = Number(maxUsd)
    if (!Number.isFinite(v) || v <= 0) return 0
    if (!Number.isFinite(m) || m <= 0) return 0
    const i = Math.log10(1 + v) / Math.log10(1 + m)
    if (!Number.isFinite(i)) return 0
    return Math.max(0, Math.min(1, i))
}

/**
 * Culoarea unei celule din grilă. Intensitate 0 ⇒ complet transparent, ca o
 * grilă goală să arate goală — nu „slab plină".
 */
export function cellColor(isLong: boolean, i: number): string {
    let a = Number(i)
    if (!Number.isFinite(a)) a = 0
    a = Math.max(0, Math.min(1, a))
    const [r, g, b] = isLong ? LIQ.longRgb : LIQ.shortRgb
    // Prag minim de vizibilitate peste zero: altfel cele mai mici celule
    // dispar pe un ecran de telefon şi harta pare mai goală decât e.
    if (a === 0) return `rgba(${r}, ${g}, ${b}, 0)`
    const alpha = Math.max(0.12, a)
    return `rgba(${r}, ${g}, ${b}, ${alpha.toFixed(3)})`
}

export type Rung = {
    pct: number
    price: number
    longUsd: number
    shortUsd: number
    n: number
    empty: boolean
    isPrice: boolean
}

/**
 * Scara CONTINUĂ, de sus până jos, cu preţul ancorat la mijloc.
 *
 * [2026-10-25] Prima variantă randa doar coşurile care AVEAU date: cinci
 * rânduri, una sub alta. Se citea ca o listă, nu ca o hartă — şi pierdea
 * exact informaţia care contează: **cât de departe** e fiecare grămadă de
 * preţ, şi **cât gol** e între ele. Un nivel fără lichidări nu e absenţa unei
 * date, e o informaţie: acolo n-a murit nimeni.
 *
 * Deci treptele goale se desenează şi ele, palid. Scara se opreşte la ultima
 * treaptă cu date (plus o margine), nu la un ±10% fix: altfel pe o piaţă
 * liniştită ar fi 80 de rânduri goale şi 5 pline, şi tot n-ai vedea nimic.
 */
export function buildLadder(buckets: any[], price: number, step = 0.25, pad = 2): Rung[] {
    const out: Rung[] = []
    const p = Number(price)
    if (!Array.isArray(buckets) || !buckets.length || !Number.isFinite(p) || p <= 0) return out

    const byPct = new Map<number, any>()
    let hi = -Infinity, lo = Infinity
    for (const b of buckets) {
        const pct = Number(b && b.pct)
        if (!Number.isFinite(pct)) continue
        byPct.set(Math.round(pct / step) * step, b)
        if (pct > hi) hi = pct
        if (pct < lo) lo = pct
    }
    if (!byPct.size) return out

    // Marginea ne lasă să vedem că deasupra/dedesubt chiar nu mai e nimic.
    hi = Math.max(hi, 0) + pad * step
    lo = Math.min(lo, 0) - pad * step
    const steps = Math.round((hi - lo) / step)
    if (!Number.isFinite(steps) || steps <= 0 || steps > 400) return out

    for (let i = steps; i >= 0; i--) {
        const pct = Math.round((lo + i * step) / step) * step
        const b = byPct.get(pct)
        const lu = b ? Number(b.longUsd) || 0 : 0
        const su = b ? Number(b.shortUsd) || 0 : 0
        out.push({
            pct,
            price: b && Number(b.price) > 0 ? Number(b.price) : p * (1 + pct / 100),
            longUsd: lu,
            shortUsd: su,
            n: b ? Number(b.n) || 0 : 0,
            empty: lu + su <= 0,
            isPrice: Math.abs(pct) < step / 2,
        })
    }
    return out
}
