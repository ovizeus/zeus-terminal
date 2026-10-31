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
export function buildLadder(buckets: any[], price: number, stepArg: number = 0.25, pad = 2): Rung[] {
    const out: Rung[] = []
    const p = Number(price)
    if (!Array.isArray(buckets) || !buckets.length || !Number.isFinite(p) || p <= 0) return out
    // O treapta invalida ar imparti la zero si ar da o scara de NaN.
    const st = Number(stepArg)
    const step = Number.isFinite(st) && st > 0 ? st : 0.25

    // ⛔ Se ADUNA, nu se suprascrie. Versiunea anterioara facea `byPct.set(...)`
    // si, cand doua galeti cadeau pe acelasi rand, a doua o STERGEA pe prima —
    // dolari dispariti in liniste. Nu se vedea cat timp treapta scarii era
    // egala cu treapta serverului (ambele 0,25%); la zoom, serverul a trecut la
    // 0,005% si 39 din 44 de galeti se pierdeau. Gasit RANDAND.
    const byPct = new Map<number, { longUsd: number; shortUsd: number; n: number; price: number }>()
    let hi = -Infinity, lo = Infinity
    for (const b of buckets) {
        const pct = Number(b && b.pct)
        if (!Number.isFinite(pct)) continue
        const key = Math.round(pct / step) * step
        const acc = byPct.get(key) || { longUsd: 0, shortUsd: 0, n: 0, price: 0 }
        acc.longUsd += Number(b.longUsd) || 0
        acc.shortUsd += Number(b.shortUsd) || 0
        acc.n += Number(b.n) || 0
        if (!acc.price && Number(b.price) > 0) acc.price = Number(b.price)
        byPct.set(key, acc)
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

/**
 * Intervalul CHIAR desenat, scris scurt.
 *
 * [2026-10-26] Axa de timp se întinde pe datele care există, nu pe fereastra
 * cerută — altfel 12 ore de istoric într-o fereastră de 90 de zile cad toate
 * într-o coloană şi harta pare stricată. Dar atunci eticheta trebuie să spună
 * CE interval s-a desenat, altfel cineva citeşte 12 ore crezând că vede 90 de
 * zile — şi aia nu mai e o hartă goală, e una care minte.
 */
export function fmtSpan(tMin: number, tMax: number): string {
    const a = Number(tMin), b = Number(tMax)
    if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a) return ''
    const min = (b - a) / 60000
    if (min < 90) return Math.round(min) + 'm'
    const h = min / 60
    if (h < 48) return h.toFixed(h < 10 ? 1 : 0) + 'h'
    return Math.round(h / 24) + 'd'
}

// ── ZOOM pe axa de PREŢ (2026-10-31) ────────────────────────────────────────
// Cererea lui: „si fa zoom daa poti pe chart stii ce zic". Timpul se alegea
// deja cu butoanele 4H..90D; lipsea preţul.
//
// Fereastra e SIMETRICĂ faţă de preţ, fiindcă asta e întregul înţeles al axei:
// cât de departe de preţul de ACUM a ars fiecare grămadă. Deci un tap nu alege
// un centru — alege o ADÂNCIME. Centrul rămâne preţul.

/** Cea mai strânsă fereastră; sub ea nu mai sunt date, doar tremurat de preţ. */
export const SPAN_MIN_PCT = 0.05
/** Cât taie un tap din fereastra curentă. */
export const SPAN_FACTOR = 2.5
/** De unde porneşte, când acoperirea măsurată nu spune nimic. */
export const SPAN_START_PCT = 5

/**
 * Fereastra după un tap. Prima dată porneşte din acoperirea **măsurată** —
 * partea cea mai depărtată, nu media, altfel primul tap ar tăia deja ce există.
 */
export function spanStep(
    cur: number | null | undefined,
    coverage: { upPct?: number | null; downPct?: number | null } | null | undefined,
): number {
    const c = Number(cur)
    let from = Number.isFinite(c) && c > 0 ? c : NaN
    if (!Number.isFinite(from)) {
        // ⚠️ `Math.abs` e ce apara aici, si merita spus de ce: `downPct` e
        // MEREU negativ (e cea mai de jos lichidare), deci fara abs un
        // `Math.max` l-ar arunca si fereastra ar porni doar din partea de sus.
        // Pe o acoperire 0% / -4% ar fi dat 5% in loc de 4%.
        //
        // Scrisesem aici o garda `Number.isFinite` cu un comentariu care spunea
        // ca apara `Number(null) === 0`. O mutatie a dovedit ca NU apara nimic:
        // `Number(null) || 0` se purta identic, fiindca si NaN si null cad pe 0.
        // Deci comentariul meu era mai sigur decat codul. Scos.
        const far = Math.max(
            Math.abs(Number(coverage?.upPct) || 0),
            Math.abs(Number(coverage?.downPct) || 0),
        )
        from = far > 0 ? far : SPAN_START_PCT
    }
    return Math.max(SPAN_MIN_PCT, from / SPAN_FACTOR)
}

/** Eticheta ferestrei. Fără zoom o spune pe litere, nu cu o cifră goală. */
export function spanLabel(span: number | null | undefined): string {
    const s = Number(span)
    if (!Number.isFinite(s) || s <= 0) return 'FULL'
    return '±' + s.toFixed(3).replace(/0+$/, '').replace(/\.$/, '') + '%'
}

/**
 * Un pas ÎNAPOI. `null` înseamnă fereastră plină.
 *
 * ⚠️ Are nevoie de un REPER (`home`): unde era fereastra înainte de primul tap.
 * Nu poate folosi acoperirea raportată, fiindcă aceea e **tăiată** la fereastra
 * curentă — deci ar scădea odată cu zoom-ul şi n-ai mai ieşi niciodată.
 */
export function spanStepOut(
    cur: number | null | undefined,
    home: number | null | undefined,
): number | null {
    const c = Number(cur)
    if (!Number.isFinite(c) || c <= 0) return null
    const h = Number(home)
    const lim = Number.isFinite(h) && h > 0 ? h : SPAN_START_PCT
    const next = c * SPAN_FACTOR
    return next >= lim ? null : next
}
