// [HEATMAP 2026-11-12] Tot ce harta de caldura scrie in plus fata de patrate:
// axe, profil pe pret, maxime, totaluri, scara de culoare. Totul se CALCULEAZA
// din celulele masurate trimise de server ({t, pct, longUsd, shortUsd, n}) —
// nimic nu se estimeaza. Functii pure, ca sa poata fi verificate fara panza.
import { intensity, ladderSides, type LadderSides, type Rung } from './scale'

const pos = (v: any): number => { const x = Number(v); return Number.isFinite(x) && x > 0 ? x : 0 }
const snap = (pct: number, step: number): number => Math.round(Math.round(pct / step) * step * 1e6) / 1e6

export type HeatGrid = {
    lo: number; hi: number; step: number; rows: number; cols: number
    /** randul 0 e pretul cel mai de JOS */
    rowOf: (pct: number) => number
}

export function heatGrid(heat: any): HeatGrid | null {
    const cells = heat && Array.isArray(heat.cells) ? heat.cells : []
    const pcts = cells.map((c: any) => Number(c && c.pct)).filter(Number.isFinite)
    if (!pcts.length) return null
    const b = Number(heat.bucket)
    const step = Number.isFinite(b) && b > 0 ? 1 / b : 0.25
    const lo = snap(Math.min(...pcts), step), hi = snap(Math.max(...pcts), step)
    const rows = Math.max(1, Math.round((hi - lo) / step) + 1)
    const cols = Math.max(1, Math.floor(Number(heat.cols)) || 90)
    return { lo, hi, step, rows, cols, rowOf: (pct: number) => Math.round((Number(pct) - lo) / step) }
}

export type HeatSideSum = { usd: number; n: number; share: number; peak: { pct: number; usd: number } | null }
export type HeatProfile = {
    rows: Array<{ pct: number; longUsd: number; shortUsd: number; n: number }>   // de SUS in jos
    maxRowUsd: number
    long: HeatSideSum
    short: HeatSideSum
    heavier: 'long' | 'short' | 'even'
    step: number
}

/** Tot ce s-a intamplat la un nivel de pret, adunat pe toata perioada. */
export function heatProfile(heat: any): HeatProfile {
    const side = (): HeatSideSum => ({ usd: 0, n: 0, share: 0, peak: null })
    const out: HeatProfile = { rows: [], maxRowUsd: 0, long: side(), short: side(), heavier: 'even', step: 0.25 }
    const g = heatGrid(heat)
    if (!g) return out
    out.step = g.step
    const acc = Array.from({ length: g.rows }, (_, r) => ({
        pct: snap(g.lo + r * g.step, g.step), longUsd: 0, shortUsd: 0, n: 0,
    }))
    for (const c of heat.cells) {
        const r = g.rowOf(Number(c && c.pct))
        if (!(r >= 0 && r < g.rows)) continue
        const lu = pos(c.longUsd), su = pos(c.shortUsd)
        acc[r].longUsd += lu; acc[r].shortUsd += su
        // Numarul de lichidari nu e despartit pe parti in celula: il punem la
        // partea care domina celula, altfel ar fi numarat de doua ori.
        const n = pos(c.n)
        acc[r].n += n
        if (lu + su > 0) { if (lu >= su) out.long.n += n; else out.short.n += n }
    }
    for (const r of acc) {
        out.long.usd += r.longUsd; out.short.usd += r.shortUsd
        if (r.longUsd + r.shortUsd > out.maxRowUsd) out.maxRowUsd = r.longUsd + r.shortUsd
        if (r.longUsd > 0 && (!out.long.peak || r.longUsd > out.long.peak.usd)) out.long.peak = { pct: r.pct, usd: r.longUsd }
        if (r.shortUsd > 0 && (!out.short.peak || r.shortUsd > out.short.peak.usd)) out.short.peak = { pct: r.pct, usd: r.shortUsd }
    }
    const both = out.long.usd + out.short.usd
    if (both > 0) { out.long.share = out.long.usd / both; out.short.share = out.short.usd / both }
    out.heavier = out.long.usd > out.short.usd ? 'long' : out.short.usd > out.long.usd ? 'short' : 'even'
    out.rows = acc.reverse()
    return out
}

/** Deasupra / dedesubtul pretului, adunat in afara — aceeasi socoteala ca pe scara din MAP. */
export function heatSides(p: HeatProfile): LadderSides {
    const rungs: Rung[] = (p && p.rows ? p.rows : []).map((r) => ({
        pct: r.pct, price: 0, longUsd: r.longUsd, shortUsd: r.shortUsd, n: r.n,
        empty: r.longUsd + r.shortUsd <= 0, isPrice: Math.abs(r.pct) < p.step / 2,
    }))
    return ladderSides(rungs)
}

function fmtTickPrice(v: number, stepAbs: number): string {
    if (stepAbs >= 1) return Math.round(v).toLocaleString('en-US')
    const d = Math.min(8, Math.max(0, Math.ceil(-Math.log10(stepAbs))))
    return v.toFixed(d)
}

/** Preturi ROTUNDE din intervalul desenat (1/2/5 × 10^k), cu locul lor pe axa. */
export function priceTicks(loPct: number, hiPct: number, ref: number, want = 5):
    Array<{ pct: number; price: number; label: string }> {
    const lo = Number(loPct), hi = Number(hiPct), p = Number(ref)
    if (![lo, hi, p].every(Number.isFinite) || !(hi > lo) || !(p > 0)) return []
    const pLo = p * (1 + lo / 100), pHi = p * (1 + hi / 100)
    const raw = (pHi - pLo) / Math.max(1, want)
    const mag = Math.pow(10, Math.floor(Math.log10(raw)))
    const nice = [1, 2, 5, 10].map((m) => m * mag).find((s) => s >= raw) || 10 * mag
    const out: Array<{ pct: number; price: number; label: string }> = []
    for (let k = Math.ceil(pLo / nice); k * nice <= pHi + nice * 1e-9; k++) {
        const price = Number((k * nice).toPrecision(12))
        const pct = (price / p - 1) * 100
        if (pct < lo || pct > hi) continue
        out.push({ pct, price, label: fmtTickPrice(price, nice) })
        if (out.length > 12) break
    }
    return out
}

const two = (n: number) => (n < 10 ? '0' : '') + n

/**
 * Repere pe axa de timp. `tzOffsetMin` = minute fata de UTC ale celui care
 * priveste (in browser: `-new Date().getTimezoneOffset()`), dat din afara ca
 * functia sa ramana pura.
 */
export function timeTicks(tMin: number, tMax: number, want = 5, tzOffsetMin = 0):
    Array<{ f: number; label: string }> {
    const a = Number(tMin), b = Number(tMax)
    if (![a, b].every(Number.isFinite) || !(b > a) || a <= 0) return []
    const n = Math.max(2, Math.floor(want))
    const byDay = b - a > 2 * 86_400_000
    const out: Array<{ f: number; label: string }> = []
    for (let i = 0; i < n; i++) {
        const f = i / (n - 1)
        if (i === n - 1) { out.push({ f: 1, label: 'Now' }); break }
        const d = new Date(a + f * (b - a) + tzOffsetMin * 60_000)
        out.push({
            f,
            label: byDay ? `${two(d.getUTCDate())}/${two(d.getUTCMonth() + 1)}`
                : `${two(d.getUTCHours())}:${two(d.getUTCMinutes())}`,
        })
    }
    return out
}

/** Trepte pentru legenda culorii: cat valoreaza un patrat stins si unul aprins. */
export function scaleSteps(maxUsd: number, n = 5): Array<{ usd: number; i: number }> {
    const m = Number(maxUsd)
    if (!Number.isFinite(m) || m <= 0) return []
    const k = Math.max(2, Math.floor(n))
    const out: Array<{ usd: number; i: number }> = []
    for (let j = 0; j < k; j++) {
        // trepte egale pe INTENSITATE (scara e logaritmica), nu pe dolari
        const i = (j + 1) / k
        const usd = j === k - 1 ? m : Math.pow(1 + m, i) - 1
        out.push({ usd, i: j === k - 1 ? 1 : intensity(usd, m) })
    }
    return out
}

// ── Culorile hartii de caldura (2026-11-12) ─────────────────────────────────
// Cerut de operator: rosul si verdele lumanarilor de pe chart (`#ff3355`,
// `#00d97a`, din marketDataChart.ts). Long lichidat = vanzare fortata = rosu;
// short lichidat = cumparare fortata = verde. Doar harta de caldura — MAP,
// LIVE si BOOK isi pastreaza chihlimbarul si cyanul.
export const HEAT = {
    long: '#ff3355',
    short: '#00d97a',
    longRgb: [255, 51, 85] as [number, number, number],
    shortRgb: [0, 217, 122] as [number, number, number],
}

export function heatCellColor(isLong: boolean, i: number): string {
    let a = Number(i)
    if (!Number.isFinite(a)) a = 0
    a = Math.max(0, Math.min(1, a))
    const [r, g, b] = isLong ? HEAT.longRgb : HEAT.shortRgb
    if (a === 0) return `rgba(${r}, ${g}, ${b}, 0)`
    return `rgba(${r}, ${g}, ${b}, ${Math.max(0.12, a).toFixed(3)})`
}

// ── Geometria panzei: aceeasi la desen si la atingere ───────────────────────
export type HeatLayout = {
    W: number; H: number
    axisW: number; timeH: number; profW: number
    mapW: number; mapH: number
    px0: number; ax0: number
    cw: number; rh: number
    yTop: (pct: number) => number
    yAt: (pct: number) => number
}

export function heatCanvasSize(boxW: number): { W: number; H: number } {
    const W = Math.max(240, Math.floor(Number(boxW)) || 320)
    return { W, H: Math.max(236, Math.min(476, Math.round(W * 1.15) + 16)) }
}

export function heatLayout(W: number, H: number, grid: HeatGrid): HeatLayout {
    const axisW = 46, timeH = 16
    const profW = Math.max(34, Math.min(60, Math.round(W * 0.14)))
    const mapW = Math.max(60, W - profW - axisW - 4)
    const mapH = H - timeH
    const cw = mapW / grid.cols, rh = mapH / grid.rows
    return {
        W, H, axisW, timeH, profW, mapW, mapH,
        px0: mapW + 2, ax0: mapW + 2 + profW + 2, cw, rh,
        yTop: (pct: number) => mapH - (grid.rowOf(pct) + 1) * rh,
        yAt: (pct: number) => mapH - ((pct - grid.lo) / grid.step + 0.5) * rh,
    }
}

/**
 * Cel mai apropiat patrat CU DATE de punctul atins. O coloana are sub 3px pe
 * telefon, deci „patratul de sub deget" nu exista practic; raza iarta.
 */
export function nearestCell<T extends { t: number; pct: number; longUsd: number; shortUsd: number }>(
    cells: T[], x: number, y: number, L: HeatLayout, maxDist = 16,
): T | null {
    if (!Array.isArray(cells) || !Number.isFinite(x) || !Number.isFinite(y)) return null
    if (x < 0 || x > L.mapW || y < 0 || y > L.mapH) return null
    let best: T | null = null, bestD = Infinity
    for (const c of cells) {
        if (!c || !(pos(c.longUsd) + pos(c.shortUsd) > 0)) continue
        const x0 = c.t * L.cw, y0 = L.yTop(c.pct)
        // distanta pana la dreptunghi (0 daca punctul e inauntru)
        const dx = Math.max(x0 - x, 0, x - (x0 + L.cw))
        const dy = Math.max(y0 - y, 0, y - (y0 + L.rh))
        const d = Math.hypot(dx, dy)
        if (d < bestD) { bestD = d; best = c }
    }
    return bestD <= maxDist ? best : null
}

export function cellTimeRange(t: number, cols: number, tMin: number, tMax: number): { from: number; to: number } | null {
    const c = Number(cols), a = Number(tMin), b = Number(tMax), k = Number(t)
    if (![c, a, b, k].every(Number.isFinite) || c <= 0 || !(b > a) || a <= 0 || k < 0 || k >= c) return null
    const w = (b - a) / c
    return { from: Math.round(a + k * w), to: Math.round(a + (k + 1) * w) }
}

export function fmtCellTime(from: number, to: number, tzOffsetMin = 0): string {
    const A = new Date(Number(from) + tzOffsetMin * 60_000), B = new Date(Number(to) + tzOffsetMin * 60_000)
    if (!Number.isFinite(A.getTime()) || !Number.isFinite(B.getTime())) return ''
    const day = (d: Date) => `${two(d.getUTCDate())}/${two(d.getUTCMonth() + 1)}`
    const hm = (d: Date) => `${two(d.getUTCHours())}:${two(d.getUTCMinutes())}`
    return day(A) === day(B) ? `${day(A)} ${hm(A)} – ${hm(B)}` : `${day(A)} ${hm(A)} – ${day(B)} ${hm(B)}`
}

/** Suma scurta pentru locuri inguste. Stie si miliarde: „6698M" nu se citeste. */
export function fmtShortUsd(v: number): string {
    const n = Number(v)
    if (!Number.isFinite(n) || n <= 0) return ''
    const f = (x: number) => (x >= 10 ? Math.round(x).toString() : x.toFixed(1))
    if (n >= 999_500_000) return f(n / 1e9) + 'B'
    if (n >= 999_500) return f(n / 1e6) + 'M'
    if (n >= 1000) return Math.round(n / 1000) + 'K'
    return Math.round(n).toString()
}
