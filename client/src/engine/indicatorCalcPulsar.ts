// ═══════════════════════════════════════════════════════════════════════════
// PULSAR — colaps, incarcare, puls. Instrument de chart principal.
//
// Cerut de operator 2026-10-19: un indicator care schimba culorile PE CHARTUL
// MARE, cu compresie, zona de extindere, masuratori si linii.
//
// Ce exista deja si de ce asta NU e o repetare:
//   ASTRAPE   masoara incarcarea (compresie + volum) si aprinde la expansiune,
//             dar e un OSCILATOR intr-un panou: nu stie unde e cutia si nu
//             proiecteaza nimic.
//   KERAUNOS  deseneaza plicul de squeeze (Bollinger in interiorul Keltner),
//             dar e un plic continuu, nu o cutie masurata cu tinte.
//
// PULSAR e geometric, nu doar un semnal: construieste CUTIA de compresie
// (sus, jos, de cand), o MASOARA (inaltime, durata, cat de stransa fata de
// propriul istoric), iar cand pretul iese proiecteaza MISCAREA MASURATA —
// tinta clasica „inaltimea cutiei de la punctul de iesire" plus extensia
// 1,618 — cu nivelul care o invalideaza. Lumanarile se recoloreaza pe faze,
// cu intensitate data de incarcare.
//
// Numele: o stea care se prabuseste in sine si apoi pulseaza. Exact ciclul.
// ═══════════════════════════════════════════════════════════════════════════

export type PulsarPhase =
    | 'COMPRESSION'   // se strange, se incarca
    | 'CHARGED'       // strans de mult timp si foarte strans: gata de plecare
    | 'RELEASE_UP'    // bara care a spart cutia in sus
    | 'RELEASE_DOWN'  // bara care a spart cutia in jos
    | 'EXPANSION_UP'  // continua dupa iesire
    | 'EXPANSION_DOWN'
    | 'EXHAUSTED'     // expansiunea si-a pierdut impulsul
    | 'NEUTRAL'       // nimic de spus

export interface PulsarBox {
    startIndex: number
    endIndex: number
    top: number
    bottom: number
    heightPct: number   // inaltimea cutiei ca procent din pret
    bars: number
    tightness: number   // inaltime / ATR mediu — mic inseamna strans
}

export interface PulsarRelease {
    index: number
    dir: 'up' | 'down'
    trigger: number     // marginea cutiei prin care a iesit
    entry: number       // inchiderea barei de iesire
    target1: number     // miscarea masurata: inaltimea cutiei
    target2: number     // extensia 1,618
    invalid: number     // marginea opusa: aici ideea e gresita
    boxHeight: number
    /**
     * [PULSAR-INVALID 2026-10-19] Pretul a trecut de nivelul de invalidare dupa
     * iesire. Verificat pe date vii: pe 4h exista o iesire UP de la 86064 cu
     * invalidarea la 82724, iar pretul e la ~81900 — demult sub ea. Fara steagul
     * asta chartul ar fi desenat o tinta pentru un scenariu care a esuat deja,
     * adica exact genul de minciuna pe care o vanez prin codul vechi.
     */
    invalidated: boolean
}

export interface Pulsar {
    phase: (PulsarPhase | null)[]
    charge: (number | null)[]       // 0..100
    boxes: PulsarBox[]
    activeBox: PulsarBox | null
    release: PulsarRelease | null
    panel: {
        phase: PulsarPhase
        charge: number
        boxHeightPct: number | null
        boxBars: number | null
        tightness: number | null
        targetPct: number | null     // distanta pana la tinta 1, in procente
        reachedPct: number | null    // cat din miscarea masurata s-a facut
    }
}

// ── ajutoare locale (fara dependente, ca modulul sa rămână pur) ──

function _sma(xs: (number | null)[], p: number): (number | null)[] {
    const out: (number | null)[] = new Array(xs.length).fill(null)
    let sum = 0, cnt = 0
    for (let i = 0; i < xs.length; i++) {
        const v = xs[i]
        if (v != null && Number.isFinite(v)) { sum += v; cnt++ }
        if (i >= p) {
            const old = xs[i - p]
            if (old != null && Number.isFinite(old)) { sum -= old; cnt-- }
        }
        if (i >= p - 1 && cnt > 0) out[i] = sum / cnt
    }
    return out
}

function _atr(highs: number[], lows: number[], closes: number[], p: number): (number | null)[] {
    const n = closes.length
    const tr: (number | null)[] = new Array(n).fill(null)
    for (let i = 0; i < n; i++) {
        if (!Number.isFinite(highs[i]) || !Number.isFinite(lows[i])) continue
        if (i === 0) { tr[i] = highs[i] - lows[i]; continue }
        const pc = closes[i - 1]
        if (!Number.isFinite(pc)) { tr[i] = highs[i] - lows[i]; continue }
        tr[i] = Math.max(highs[i] - lows[i], Math.abs(highs[i] - pc), Math.abs(lows[i] - pc))
    }
    return _sma(tr, p)
}

/** Procentul din valorile anterioare care sunt sub `v`. 0 = cel mai mic vazut. */
function _percentileOf(v: number, hist: number[]): number {
    if (!hist.length) return 50
    let below = 0
    for (const h of hist) if (h < v) below++
    return (below / hist.length) * 100
}

export function pulsar(
    highs: number[], lows: number[], closes: number[], _volumes: number[],
    opts?: {
        window?: number        // cate bare formeaza cutia
        atrPeriod?: number
        tightPct?: number      // sub ce percentila de stramtime numim compresie
        chargedBars?: number   // de cate bare de compresie incolo e CHARGED
        expandMult?: number    // cat de mare trebuie sa fie bara de iesire, in ATR
    },
): Pulsar {
    const window = Math.max(5, Math.round(opts?.window ?? 20))
    const atrPeriod = Math.max(2, Math.round(opts?.atrPeriod ?? 14))
    const tightPct = Math.min(99, Math.max(1, opts?.tightPct ?? 25))
    const chargedBars = Math.max(2, Math.round(opts?.chargedBars ?? 8))
    const expandMult = Math.max(0.2, opts?.expandMult ?? 1.1)

    const n = Math.min(highs?.length || 0, lows?.length || 0, closes?.length || 0)
    const empty: Pulsar = {
        phase: [], charge: [], boxes: [], activeBox: null, release: null,
        panel: {
            phase: 'NEUTRAL', charge: 0, boxHeightPct: null, boxBars: null,
            tightness: null, targetPct: null, reachedPct: null,
        },
    }
    if (n < window + 2) return empty

    const atr = _atr(highs, lows, closes, atrPeriod)
    const phase: (PulsarPhase | null)[] = new Array(n).fill(null)
    const charge: (number | null)[] = new Array(n).fill(null)

    // Stramtimea barei i: inaltimea ferestrei raportata la ATR. Raportul la ATR
    // face marimea comparabila intre simboluri si intre regimuri de pret.
    const tight: (number | null)[] = new Array(n).fill(null)
    const boxTop: (number | null)[] = new Array(n).fill(null)
    const boxBot: (number | null)[] = new Array(n).fill(null)
    for (let i = window - 1; i < n; i++) {
        let hi = -Infinity, lo = Infinity
        for (let j = i - window + 1; j <= i; j++) {
            if (Number.isFinite(highs[j]) && highs[j] > hi) hi = highs[j]
            if (Number.isFinite(lows[j]) && lows[j] < lo) lo = lows[j]
        }
        const a = atr[i]
        if (!isFinite(hi) || !isFinite(lo) || a == null || a <= 0) continue
        boxTop[i] = hi; boxBot[i] = lo
        tight[i] = (hi - lo) / a
    }

    // Compresia nu e un prag fix: o fereastra e „stransa" fata de propriul
    // istoric. Un prag absolut ar numi compresie orice pe un simbol linistit si
    // nimic pe unul agitat.
    const compressed: boolean[] = new Array(n).fill(false)
    const hist: number[] = []
    for (let i = 0; i < n; i++) {
        const t = tight[i]
        if (t == null) continue
        if (hist.length >= window) {
            const pct = _percentileOf(t, hist)
            compressed[i] = pct <= tightPct
            // Incarcarea: cu cat percentila e mai jos, cu atat mai incarcat.
            charge[i] = Math.round(Math.max(0, Math.min(100, 100 - pct)))
        } else {
            charge[i] = null
        }
        hist.push(t)
        if (hist.length > 400) hist.shift()
    }

    // Cutiile: serii neintrerupte de bare comprimate.
    const boxes: PulsarBox[] = []
    let runStart = -1
    const closeBox = (endIdx: number) => {
        if (runStart < 0) return
        const bars = endIdx - runStart + 1
        if (bars >= 3) {
            let hi = -Infinity, lo = Infinity
            for (let j = Math.max(0, runStart - window + 1); j <= endIdx; j++) {
                if (Number.isFinite(highs[j]) && highs[j] > hi) hi = highs[j]
                if (Number.isFinite(lows[j]) && lows[j] < lo) lo = lows[j]
            }
            const ref = closes[endIdx]
            const a = atr[endIdx]
            if (isFinite(hi) && isFinite(lo) && Number.isFinite(ref) && ref > 0) {
                boxes.push({
                    startIndex: Math.max(0, runStart - window + 1),
                    endIndex: endIdx,
                    top: hi, bottom: lo,
                    heightPct: ((hi - lo) / ref) * 100,
                    bars,
                    tightness: a && a > 0 ? (hi - lo) / a : 0,
                })
            }
        }
        runStart = -1
    }
    for (let i = 0; i < n; i++) {
        if (compressed[i]) { if (runStart < 0) runStart = i }
        else if (runStart >= 0) closeBox(i - 1)
    }
    if (runStart >= 0) closeBox(n - 1)

    // Fazele, bara cu bara.
    let compressRun = 0
    let lastRelease: PulsarRelease | null = null
    let sinceRelease = -1
    for (let i = 0; i < n; i++) {
        const a = atr[i]
        const rng = (Number.isFinite(highs[i]) && Number.isFinite(lows[i])) ? highs[i] - lows[i] : null

        if (compressed[i]) {
            compressRun++
            phase[i] = compressRun >= chargedBars ? 'CHARGED' : 'COMPRESSION'
            continue
        }

        // Iesirea se judeca fata de cutia de DINAINTE, nu fata de fereastra
        // curenta — altfel bara care sparge isi muta singura marginea si
        // breakout-ul nu s-ar detecta niciodata.
        const prevTop = boxTop[i - 1], prevBot = boxBot[i - 1]
        const wasCoiled = compressRun >= 3
        const expanded = (rng != null && a != null && a > 0) ? rng >= a * expandMult : false

        if (wasCoiled && prevTop != null && prevBot != null && expanded && Number.isFinite(closes[i])) {
            const boxHeight = prevTop - prevBot
            if (closes[i] > prevTop) {
                phase[i] = 'RELEASE_UP'
                lastRelease = {
                    index: i, dir: 'up', trigger: prevTop, entry: closes[i],
                    target1: closes[i] + boxHeight,
                    target2: closes[i] + boxHeight * 1.618,
                    invalid: prevBot, boxHeight, invalidated: false,
                }
                sinceRelease = 0
                compressRun = 0
                continue
            }
            if (closes[i] < prevBot) {
                phase[i] = 'RELEASE_DOWN'
                lastRelease = {
                    index: i, dir: 'down', trigger: prevBot, entry: closes[i],
                    target1: closes[i] - boxHeight,
                    target2: closes[i] - boxHeight * 1.618,
                    invalid: prevTop, boxHeight, invalidated: false,
                }
                sinceRelease = 0
                compressRun = 0
                continue
            }
        }

        compressRun = 0

        if (sinceRelease >= 0 && lastRelease) {
            sinceRelease++
            // Expansiunea tine cat timp barele rămân mari si merg in directia
            // iesirii. Cand se micsoreaza, pulsul s-a stins.
            const stillBig = (rng != null && a != null && a > 0) ? rng >= a * 0.8 : false
            const withDir = lastRelease.dir === 'up'
                ? closes[i] >= closes[i - 1]
                : closes[i] <= closes[i - 1]
            if (stillBig && withDir) {
                phase[i] = lastRelease.dir === 'up' ? 'EXPANSION_UP' : 'EXPANSION_DOWN'
            } else if (sinceRelease <= 10) {
                phase[i] = 'EXHAUSTED'
            } else {
                phase[i] = 'NEUTRAL'
                sinceRelease = -1
            }
            continue
        }

        phase[i] = 'NEUTRAL'
    }

    // [PULSAR-INVALID 2026-10-19] O iesire care si-a rupt propriul nivel de
    // invalidare nu mai e un scenariu valid. Se marcheaza, iar randarea nu mai
    // deseneaza tinte pentru ea.
    if (lastRelease) {
        for (let i = lastRelease.index + 1; i < n; i++) {
            const c = closes[i]
            if (!Number.isFinite(c)) continue
            const broken = lastRelease.dir === 'up' ? c < lastRelease.invalid : c > lastRelease.invalid
            if (broken) { lastRelease = { ...lastRelease, invalidated: true }; break }
        }
    }

    // Cutia activa: ultima care se intinde pana la ultima bara.
    const last = n - 1
    const activeBox = boxes.length && boxes[boxes.length - 1].endIndex === last
        ? boxes[boxes.length - 1] : null

    const lastPhase = (phase[last] ?? 'NEUTRAL') as PulsarPhase
    const lastCharge = charge[last] ?? 0
    const px = closes[last]

    let targetPct: number | null = null
    let reachedPct: number | null = null
    if (lastRelease && !lastRelease.invalidated && Number.isFinite(px) && lastRelease.boxHeight > 0) {
        targetPct = ((lastRelease.target1 - px) / px) * 100
        const moved = lastRelease.dir === 'up' ? px - lastRelease.entry : lastRelease.entry - px
        reachedPct = Math.max(0, Math.min(200, (moved / lastRelease.boxHeight) * 100))
    }

    return {
        phase, charge, boxes, activeBox, release: lastRelease,
        panel: {
            phase: lastPhase,
            charge: Math.round(lastCharge),
            boxHeightPct: activeBox ? Math.round(activeBox.heightPct * 1000) / 1000 : null,
            boxBars: activeBox ? activeBox.bars : null,
            tightness: activeBox ? Math.round(activeBox.tightness * 100) / 100 : null,
            targetPct: targetPct == null ? null : Math.round(targetPct * 100) / 100,
            reachedPct: reachedPct == null ? null : Math.round(reachedPct),
        },
    }
}

// ── culorile lumanarilor ───────────────────────────────────────────────────
//
// Compresia e rece si se stinge cu cat se incarca mai tare (albastru → violet
// adanc): pretul „se retrage". Iesirea e un flash. Expansiunea rămâne aprinsa.
// Epuizarea e palida. NEUTRAL inseamna „nu ma asculta": culoarea implicita.

export interface PulsarCandleColor {
    color: string
    wickColor: string
    borderColor: string
}

export function pulsarCandleColor(
    phase: PulsarPhase | null, charge: number | null, up: boolean,
): PulsarCandleColor | null {
    if (phase == null || phase === 'NEUTRAL') return null
    const c = Math.max(0, Math.min(100, charge ?? 0))
    switch (phase) {
        case 'COMPRESSION': {
            // Cu cat mai incarcat, cu atat mai adanc violetul.
            const t = c / 100
            const r = Math.round(40 + 40 * t), g = Math.round(70 - 30 * t), b = Math.round(120 + 70 * t)
            const col = `rgb(${r},${g},${b})`
            return { color: col, wickColor: col, borderColor: col }
        }
        case 'CHARGED': {
            const col = '#7c4dff'
            return { color: col, wickColor: '#b388ff', borderColor: '#b388ff' }
        }
        case 'RELEASE_UP':
            return { color: '#00e676', wickColor: '#b9f6ca', borderColor: '#ffffff' }
        case 'RELEASE_DOWN':
            return { color: '#ff1744', wickColor: '#ff8a80', borderColor: '#ffffff' }
        case 'EXPANSION_UP':
            return { color: '#00c853', wickColor: '#69f0ae', borderColor: '#00c853' }
        case 'EXPANSION_DOWN':
            return { color: '#d50000', wickColor: '#ff5252', borderColor: '#d50000' }
        case 'EXHAUSTED': {
            const col = up ? '#4e6e5d' : '#6e4e54'
            return { color: col, wickColor: col, borderColor: col }
        }
        default:
            return null
    }
}
