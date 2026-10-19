// ═══════════════════════════════════════════════════════════════════════════
// ARACHNE — tesatoarea de linii. Trendline-uri si S/R desenate singure.
//
// Cerut de operator 2026-10-19, cu doua poze de pe un chart TradingView:
// diagonale rosii descendente (rezistenta), diagonale verzi ascendente
// (suport), orizontale galbene, fiecare etichetata, plus semnalul cand se rupe
// si unde poti intra.
//
// Verificat INAINTE ca sa nu fie o repetare: in Zeus nu exista nicaieri linii
// de trend geometrice. Cele patru potriviri pentru „trendline/slope" din
// indicatorCalc.ts sunt despre PANTA unei medii adaptive, nu despre o dreapta
// prin puncte de pivot. Iar `calcSRTable` nu e S/R: sunt multipli de ATR in
// jurul pretului curent, deci niveluri care se misca odata cu pretul si nu au
// fost atinse niciodata de nimic.
//
// ARACHNE porneste de la PIVOTI REALI (fractali) si tese:
//   1. niveluri ORIZONTALE prin gruparea pivotilor apropiati (2+ atingeri)
//   2. linii DIAGONALE prin perechi de pivoti, validate: o dreapta are voie
//      sa fie linie de trend doar daca pretul NU a trecut prin ea intre cele
//      doua ancore. Fara regula asta, orice doua varfuri dau o „linie".
//   3. RUPERI, cu toleranta — o umbra care atinge nu e rupere
//   4. INTRARI: ruperea confirmata, si retestul care tine (cel mai bun)
// ═══════════════════════════════════════════════════════════════════════════

export interface Pivot { index: number; price: number; kind: 'high' | 'low' }

export interface ArachneLevel {
    price: number
    touches: number
    firstIndex: number
    lastIndex: number
    /** Rolul afisat ACUM (un suport rupt devine rezistenta). */
    kind: 'support' | 'resistance'
    /** Rolul pe care l-a avut cand s-a format — dupa el se judeca ruperea. */
    role: 'support' | 'resistance'
    broken: boolean
    label: string
}

export interface ArachneTrendline {
    /** y = slope * index + intercept, in spatiul indicilor de bara */
    slope: number
    intercept: number
    fromIndex: number
    toIndex: number
    /**
     * [ARACHNE-EXTEND] Pana unde are voie sa fie desenata spre dreapta.
     * Verificat pe date vii: o linie ancorata demult si prelungita la infinit
     * ajungea sa proiecteze 93.037 cand pretul era 81.967 — o dreapta care nu
     * mai inseamna nimic, dar arata ca o linie de trend. Prelungirea se
     * limiteaza la cat a durat formarea ei.
     */
    extendTo: number
    touches: number
    kind: 'support' | 'resistance'
    broken: boolean
    brokenAt: number | null
    label: string
}

export type ArachneSignalKind = 'BREAK_LONG' | 'BREAK_SHORT' | 'RETEST_LONG' | 'RETEST_SHORT'

export interface ArachneSignal {
    index: number
    kind: ArachneSignalKind
    dir: 'long' | 'short'
    price: number
    stop: number
    target: number | null
    from: 'level' | 'trendline'
    /** Pretul liniei sau nivelului din care a venit semnalul. Stopul sta dincolo de el. */
    ref: number
    label: string
}

export interface Arachne {
    pivots: Pivot[]
    levels: ArachneLevel[]
    trendlines: ArachneTrendline[]
    signals: ArachneSignal[]
    panel: {
        levelCount: number
        trendlineCount: number
        lastSignal: ArachneSignalKind | null
        lastSignalBarsAgo: number | null
        nearestResistance: number | null
        nearestSupport: number | null
    }
}

/** Valoarea unei drepte la o bara oarecare — asta e „prelungirea spre dreapta". */
export function lineValueAt(line: { slope: number; intercept: number }, index: number): number {
    return line.slope * index + line.intercept
}

// ── pivoti ────────────────────────────────────────────────────────────────

/**
 * Pivot fractal: un maxim local care e cel mai mare din `width` bare la stanga
 * SI la dreapta. Barele de la capete nu pot fi pivoti — nu au inca dreapta
 * confirmata, iar a le numara ar insemna sa desenez linii pe varfuri care se
 * pot muta la urmatorul tick.
 */
export function findPivots(highs: number[], lows: number[], width = 3): Pivot[] {
    const n = Math.min(highs?.length || 0, lows?.length || 0)
    const w = Math.max(1, Math.round(width))
    const out: Pivot[] = []
    for (let i = w; i < n - w; i++) {
        const h = highs[i], l = lows[i]
        if (Number.isFinite(h)) {
            let isHigh = true
            for (let j = i - w; j <= i + w; j++) {
                if (j === i) continue
                if (Number.isFinite(highs[j]) && highs[j] >= h) { isHigh = false; break }
            }
            if (isHigh) out.push({ index: i, price: h, kind: 'high' })
        }
        if (Number.isFinite(l)) {
            let isLow = true
            for (let j = i - w; j <= i + w; j++) {
                if (j === i) continue
                if (Number.isFinite(lows[j]) && lows[j] <= l) { isLow = false; break }
            }
            if (isLow) out.push({ index: i, price: l, kind: 'low' })
        }
    }
    return out.sort((a, b) => a.index - b.index)
}

// ── niveluri orizontale ───────────────────────────────────────────────────

/**
 * Pivoti apropiati ca pret = acelasi nivel. Un nivel cu o singura atingere nu
 * e nivel, e un varf: pragul minim e 2, pentru ca „suport" inseamna ca pretul
 * a fost acolo si s-a intors de mai multe ori.
 */
export function clusterLevels(
    pivots: Pivot[], tolerance: number, minTouches = 2,
): Array<{ price: number; touches: number; firstIndex: number; lastIndex: number }> {
    if (!pivots.length || !(tolerance > 0)) return []
    const sorted = [...pivots].sort((a, b) => a.price - b.price)
    const groups: Pivot[][] = []
    let cur: Pivot[] = [sorted[0]]
    for (let i = 1; i < sorted.length; i++) {
        if (Math.abs(sorted[i].price - cur[cur.length - 1].price) <= tolerance) cur.push(sorted[i])
        else { groups.push(cur); cur = [sorted[i]] }
    }
    groups.push(cur)
    return groups
        .filter(g => g.length >= minTouches)
        .map(g => ({
            price: g.reduce((a, p) => a + p.price, 0) / g.length,
            touches: g.length,
            firstIndex: Math.min(...g.map(p => p.index)),
            lastIndex: Math.max(...g.map(p => p.index)),
        }))
}

// ── linii diagonale ───────────────────────────────────────────────────────

/**
 * O dreapta prin doi pivoti e linie de trend DOAR daca pretul nu a trecut prin
 * ea intre ancore. Asta e regula care separa o linie reala de doua puncte unite
 * la intamplare — si fara ea orice chart ar arata zeci de „trendline-uri".
 *
 * `tolerance` lasa umbrele sa atinga linia fara s-o invalideze.
 */
function _validateLine(
    slope: number, intercept: number, from: number, to: number,
    series: number[], kind: 'support' | 'resistance', tolerance: number,
): { ok: boolean; touches: number } {
    let touches = 0
    for (let i = from; i <= to; i++) {
        const v = series[i]
        if (!Number.isFinite(v)) continue
        const lv = slope * i + intercept
        const diff = v - lv
        if (kind === 'resistance') {
            if (diff > tolerance) return { ok: false, touches: 0 }   // a strapuns pe deasupra
            if (diff >= -tolerance) touches++
        } else {
            if (diff < -tolerance) return { ok: false, touches: 0 }  // a strapuns pe dedesubt
            if (diff <= tolerance) touches++
        }
    }
    return { ok: true, touches }
}

export function buildTrendlines(
    pivots: Pivot[], highs: number[], lows: number[], tolerance: number,
    opts?: { maxPerSide?: number; minSpan?: number; minTouches?: number },
): ArachneTrendline[] {
    const maxPerSide = Math.max(1, Math.round(opts?.maxPerSide ?? 2))
    const minSpan = Math.max(2, Math.round(opts?.minSpan ?? 8))
    const minTouches = Math.max(2, Math.round(opts?.minTouches ?? 2))
    const n = Math.min(highs?.length || 0, lows?.length || 0)
    if (!(tolerance > 0) || n < 3) return []

    const out: ArachneTrendline[] = []
    for (const kind of ['resistance', 'support'] as const) {
        const want = kind === 'resistance' ? 'high' : 'low'
        const series = kind === 'resistance' ? highs : lows
        const ps = pivots.filter(p => p.kind === want)
        const cands: ArachneTrendline[] = []
        // Perechile se iau de la cele mai recente spre inapoi: o linie veche
        // care nu mai e atinsa de 300 de bare nu intereseaza pe nimeni.
        for (let a = Math.max(0, ps.length - 12); a < ps.length; a++) {
            for (let b = a + 1; b < ps.length; b++) {
                const p1 = ps[a], p2 = ps[b]
                const span = p2.index - p1.index
                if (span < minSpan) continue
                const slope = (p2.price - p1.price) / span
                const intercept = p1.price - slope * p1.index
                const v = _validateLine(slope, intercept, p1.index, p2.index, series, kind, tolerance)
                if (!v.ok || v.touches < minTouches) continue
                cands.push({
                    slope, intercept,
                    fromIndex: p1.index, toIndex: p2.index,
                    // O linie formata pe 50 de bare se prelungeste cel mult 50
                    // de bare. Dincolo de atat, extrapolarea e inventie.
                    extendTo: p2.index + span,
                    touches: v.touches, kind,
                    broken: false, brokenAt: null,
                    label: kind === 'resistance' ? 'TL ▼ RES' : 'TL ▲ SUP',
                })
            }
        }
        // Cele mai bune: multe atingeri, apoi cat mai recente.
        cands.sort((x, y) => (y.touches - x.touches) || (y.toIndex - x.toIndex))
        out.push(...cands.slice(0, maxPerSide))
    }
    return out
}


/**
 * Retestul: dupa ce un nivel a fost rupt, pretul se intoarce la el si TINE pe
 * partea noua. E intrarea pe care o asteapta traderii, pentru ca nivelul si-a
 * dovedit schimbarea de rol.
 *
 * Scos ca functie proprie ca sa fie testabil direct: prin `arachne` intreaga
 * calea asta depinde de unde cad pivotii, si a rămas necoperita de teste la
 * prima incercare — adica exact genul de cod care pare ca merge.
 *
 * `long` = nivelul era rezistenta si a fost rupt in sus.
 * Intoarce indicele barei de retest, sau -1.
 */
export function findRetest(
    levelPrice: number, long: boolean, fromIndex: number,
    highs: number[], lows: number[], closes: number[], tol: number,
): number {
    const n = Math.min(highs?.length || 0, lows?.length || 0, closes?.length || 0)
    if (!(tol > 0) || !Number.isFinite(levelPrice)) return -1
    for (let i = Math.max(0, fromIndex); i < n; i++) {
        const touched = long ? lows[i] <= levelPrice + tol : highs[i] >= levelPrice - tol
        // „Tine" inseamna ca inchiderea rămâne pe partea noua. Fara asta, orice
        // simpla atingere ar trece drept retest reusit — inclusiv bara care
        // tocmai reintra in vechiul interval si anuleaza ideea.
        const held = long ? closes[i] > levelPrice : closes[i] < levelPrice
        if (touched && held) return i
    }
    return -1
}

// ── instrumentul complet ──────────────────────────────────────────────────

function _atrLike(highs: number[], lows: number[], closes: number[], p: number): number {
    const n = closes.length
    let sum = 0, cnt = 0
    for (let i = Math.max(1, n - p); i < n; i++) {
        if (!Number.isFinite(highs[i]) || !Number.isFinite(lows[i])) continue
        sum += highs[i] - lows[i]; cnt++
    }
    return cnt ? sum / cnt : 0
}

export function arachne(
    highs: number[], lows: number[], closes: number[],
    opts?: {
        pivotWidth?: number
        tolAtr?: number        // toleranta ca fractie din ATR
        minTouches?: number
        maxLevels?: number
        maxLinesPerSide?: number
    },
): Arachne {
    const empty: Arachne = {
        pivots: [], levels: [], trendlines: [], signals: [],
        panel: {
            levelCount: 0, trendlineCount: 0, lastSignal: null,
            lastSignalBarsAgo: null, nearestResistance: null, nearestSupport: null,
        },
    }
    const n = Math.min(highs?.length || 0, lows?.length || 0, closes?.length || 0)
    if (n < 20) return empty

    const pivotWidth = Math.max(1, Math.round(opts?.pivotWidth ?? 3))
    const tolAtr = Math.max(0.05, opts?.tolAtr ?? 0.35)
    const minTouches = Math.max(2, Math.round(opts?.minTouches ?? 2))
    const maxLevels = Math.max(1, Math.round(opts?.maxLevels ?? 6))
    const maxLinesPerSide = Math.max(1, Math.round(opts?.maxLinesPerSide ?? 2))

    const atr = _atrLike(highs, lows, closes, 14)
    const px = closes[n - 1]
    if (!(atr > 0) || !Number.isFinite(px) || px <= 0) return empty
    const tol = atr * tolAtr

    const pivots = findPivots(highs, lows, pivotWidth)

    // ── niveluri orizontale ──
    const clusters = clusterLevels(pivots, tol, minTouches)
    const levels: ArachneLevel[] = clusters.map(c => {
        // [ARACHNE-ROLE] Rolul unui nivel se da de unde a VENIT pretul, nu de
        // unde e acum. Prima versiune il clasifica dupa pozitia fata de pretul
        // curent, si atunci un suport prin care pretul a cazut devenea
        // „rezistenta" — iar ruperea lui, cautata in sus, nu se mai detecta
        // niciodata. Testele au prins-o: zero semnale short pe o piata care
        // tocmai spărsese suportul.
        const from = Math.max(0, c.firstIndex - 10)
        let above = 0, below = 0
        for (let i = from; i < c.firstIndex; i++) {
            const cl = closes[i]
            if (!Number.isFinite(cl)) continue
            if (cl > c.price) above++; else below++
        }
        // Pretul venea de deasupra → nivelul a tinut ca SUPORT.
        const role: 'support' | 'resistance' = above >= below ? 'support' : 'resistance'

        // Rupt = o inchidere dincolo, pe partea opusa rolului.
        let broken = false
        for (let i = c.lastIndex + 1; i < n; i++) {
            const cl = closes[i]
            if (!Number.isFinite(cl)) continue
            if (role === 'support' ? cl < c.price - tol : cl > c.price + tol) { broken = true; break }
        }

        // Un nivel rupt isi schimba rolul: suportul spart devine rezistenta.
        // Asta e si ce asteapta un trader de la eticheta.
        const kind: 'support' | 'resistance' = broken
            ? (role === 'support' ? 'resistance' : 'support')
            : role

        return {
            price: c.price, touches: c.touches,
            firstIndex: c.firstIndex, lastIndex: c.lastIndex,
            kind, broken,
            label: (role === 'resistance' ? 'RES' : 'SUP') + ' ' + c.touches + 'x'
                + (broken ? ' ✕ RUPT' : ''),
            role,
        } as ArachneLevel
    })
    // Cele mai apropiate de pret conteaza cel mai mult.
    levels.sort((a, b) => Math.abs(a.price - px) - Math.abs(b.price - px))
    const keptLevels = levels.slice(0, maxLevels)

    // ── linii diagonale ──
    // Prelungirea limitata (`extendTo`) e singurul lucru care tine liniile
    // ancorate in realitate. Am avut aici si un filtru de distanta fata de
    // pret, dar niciun test nu-l putea face sa conteze — mutantul care il
    // scotea trecea tot. Un gard pe care nu-l pot dovedi e decor, deci a plecat.
    const trendlines = buildTrendlines(pivots, highs, lows, tol, {
        maxPerSide: maxLinesPerSide, minTouches,
    })
    // Ruperea unei diagonale: o inchidere dincolo de prelungirea ei, dupa a
    // doua ancora. Prelungirea e chiar rostul liniei.
    for (const tl of trendlines) {
        for (let i = tl.toIndex + 1; i < n; i++) {
            const cl = closes[i]
            if (!Number.isFinite(cl)) continue
            const lv = lineValueAt(tl, i)
            const out = tl.kind === 'resistance' ? cl > lv + tol : cl < lv - tol
            if (out) { tl.broken = true; tl.brokenAt = i; tl.label += ' ✕ RUPT'; break }
        }
    }

    // ── semnale ──
    const signals: ArachneSignal[] = []

    // Ruperea unei diagonale e semnalul clasic din poze: rosie rupta in sus,
    // verde rupta in jos.
    for (const tl of trendlines) {
        if (!tl.broken || tl.brokenAt == null) continue
        const i = tl.brokenAt
        const entry = closes[i]
        const lineAt = lineValueAt(tl, i)
        if (tl.kind === 'resistance') {
            signals.push({
                index: i, kind: 'BREAK_LONG', dir: 'long', price: entry,
                stop: lineAt - tol, target: null, from: 'trendline', ref: lineAt,
                label: 'LONG ▲ rupere TL',
            })
        } else {
            signals.push({
                index: i, kind: 'BREAK_SHORT', dir: 'short', price: entry,
                stop: lineAt + tol, target: null, from: 'trendline', ref: lineAt,
                label: 'SHORT ▼ rupere TL',
            })
        }
    }

    // Ruperea unui nivel orizontal, cu tinta la urmatorul nivel in directia
    // miscarii — o tinta care exista chiar pe chart, nu un multiplu inventat.
    for (const lv of keptLevels) {
        if (!lv.broken) continue
        let brk = -1
        for (let i = lv.lastIndex + 1; i < n; i++) {
            const cl = closes[i]
            if (!Number.isFinite(cl)) continue
            if (lv.role === 'support' ? cl < lv.price - tol : cl > lv.price + tol) { brk = i; break }
        }
        if (brk < 0) continue
        // Rezistenta rupta = long. Suport rupt = short.
        const long = lv.role === 'resistance'
        const ahead = keptLevels
            .filter(o => o !== lv && (long ? o.price > lv.price : o.price < lv.price))
            .sort((a, b) => long ? a.price - b.price : b.price - a.price)
        signals.push({
            index: brk,
            kind: long ? 'BREAK_LONG' : 'BREAK_SHORT',
            dir: long ? 'long' : 'short',
            price: closes[brk],
            stop: long ? lv.price - tol : lv.price + tol,
            target: ahead.length ? ahead[0].price : null,
            from: 'level', ref: lv.price,
            label: (long ? 'LONG ▲' : 'SHORT ▼') + ' rupere ' + lv.touches + 'x',
        })
    }

    // Retestul: dupa rupere pretul se intoarce la linie si TINE. E intrarea pe
    // care o asteapta traderii, si e mai buna decat ruperea in sine pentru ca
    // nivelul si-a dovedit schimbarea de rol.
    for (const lv of keptLevels) {
        if (!lv.broken) continue
        let brk = -1
        for (let i = lv.lastIndex + 1; i < n; i++) {
            const cl = closes[i]
            if (Number.isFinite(cl) && (lv.role === 'support' ? cl < lv.price - tol : cl > lv.price + tol)) { brk = i; break }
        }
        if (brk < 0) continue
        const long = lv.role === 'resistance'
        const rt = findRetest(lv.price, long, brk + 1, highs, lows, closes, tol)
        if (rt >= 0) {
            signals.push({
                index: rt,
                kind: long ? 'RETEST_LONG' : 'RETEST_SHORT',
                dir: long ? 'long' : 'short',
                price: closes[rt],
                stop: long ? lv.price - tol * 2 : lv.price + tol * 2,
                target: null, from: 'level', ref: lv.price,
                label: (long ? 'LONG ▲' : 'SHORT ▼') + ' retest',
            })
        }
    }

    signals.sort((a, b) => a.index - b.index)

    const res = keptLevels.filter(l => l.kind === 'resistance' && !l.broken).map(l => l.price).sort((a, b) => a - b)
    const sup = keptLevels.filter(l => l.kind === 'support' && !l.broken).map(l => l.price).sort((a, b) => b - a)
    const lastSig = signals.length ? signals[signals.length - 1] : null

    return {
        pivots, levels: keptLevels, trendlines, signals,
        panel: {
            levelCount: keptLevels.length,
            trendlineCount: trendlines.length,
            lastSignal: lastSig ? lastSig.kind : null,
            lastSignalBarsAgo: lastSig ? (n - 1 - lastSig.index) : null,
            nearestResistance: res.length ? res[0] : null,
            nearestSupport: sup.length ? sup[0] : null,
        },
    }
}
