/**
 * [ARIA PATTERN VISION 2026-06-06] Pure display helpers for the real-candle
 * pattern drawing in the ARIA dock page.
 *
 * Operator brief (calibrated on the classic chart-pattern cheat-sheet posters
 * he sent): REAL candles of the window where the pattern fired, the pattern's
 * structure as a zigzag overlay, and poster-style labeled level pills —
 * ENTRY (cyan) / TARGET (green) / STOP (red) — on dashed horizontal lines.
 *
 * STRICTLY a display layer: detection (arianova.ts) is untouched — it feeds
 * the brain (money-path). Everything here is pure (klines in → svg/levels
 * out) and unit-tested.
 */
'use strict'

export interface Kline { time: number; open: number; high: number; low: number; close: number; volume?: number }
export interface PatternLevels { entry: number; sl: number; tp: number; rr: number }

// ── ATR (simple high-low average — display sizing only) ──────────────
export function atr(kl: Kline[], n = 14): number {
    if (!kl || kl.length === 0) return 0
    const win = kl.slice(-n)
    const s = win.reduce((a, k) => a + (k.high - k.low), 0)
    return s / win.length
}

// ── How many trailing bars a pattern spans (highlight window) ────────
const _SPANS: Record<string, number> = {
    // single/multi candle
    doji: 1, hammer: 1, invhammer: 1, shootingstar: 1, hangingman: 1,
    pinbarbull: 1, pinbarbear: 1,
    engulfbull: 2, engulfbear: 2, tweezertop: 2, tweezerbottom: 2,
    darkcloud: 2, piercing: 2,
    morningstar: 3, eveningstar: 3, soldiers: 3, crows: 3,
    // smart money
    fvg_bull: 3, fvg_bear: 3, ob_bull: 12, ob_bear: 12,
    liq_sweep: 12, bos_bull: 12, bos_bear: 12, choch_bull: 12, choch_bear: 12,
    // chart patterns
    doubletop: 20, doublebottom: 20, tripletop: 24, triplebottom: 24,
    hs: 24, ihs: 24,
    tri_asc: 20, tri_desc: 20, tri_sym: 20,
    wedge_rise: 20, wedge_fall: 20,
}
const _MEASURED_MOVE = new Set([
    'doubletop', 'doublebottom', 'tripletop', 'triplebottom', 'hs', 'ihs',
    'tri_asc', 'tri_desc', 'tri_sym', 'wedge_rise', 'wedge_fall',
])

export function patternSpan(svgType: string): number {
    return _SPANS[svgType] || 8
}

// ── ENTRY / STOP / TARGET per pattern (poster semantics) ─────────────
// entry = last close (confirmation bar). STOP beyond the pattern extreme
// (±0.25 ATR buffer). TARGET = measured move for chart patterns (pattern
// height projected from entry), otherwise 2R.
export function computePatternLevels(
    dir: 'bull' | 'bear' | 'watch' | string,
    svgType: string,
    kl: Kline[],
): PatternLevels | null {
    if (!kl || kl.length < 2) return null
    if (dir !== 'bull' && dir !== 'bear') return null

    const span = Math.min(patternSpan(svgType), kl.length)
    const win = kl.slice(-span)
    const entry = kl[kl.length - 1].close
    const buf = 0.25 * atr(kl, 14)
    const hi = Math.max(...win.map(k => k.high))
    const lo = Math.min(...win.map(k => k.low))
    const height = hi - lo

    let sl: number, tp: number
    if (dir === 'bull') {
        sl = lo - buf
        const risk = entry - sl
        if (risk <= 0) return null
        tp = _MEASURED_MOVE.has(svgType) ? entry + height : entry + 2 * risk
    } else {
        sl = hi + buf
        const risk = sl - entry
        if (risk <= 0) return null
        tp = _MEASURED_MOVE.has(svgType) ? entry - height : entry - 2 * risk
    }
    const rr = Math.abs(tp - entry) / Math.abs(entry - sl)
    return { entry, sl, tp, rr: +rr.toFixed(2) }
}

// ── Zigzag swing points (poster structure overlay) ───────────────────
function _zigzagPoints(kl: Kline[]): Array<{ i: number; v: number }> {
    if (kl.length < 5) return []
    const pts: Array<{ i: number; v: number }> = []
    const w2 = Math.max(1, Math.floor(kl.length / 10))
    let lastKind: 'h' | 'l' | null = null
    for (let i = 0; i < kl.length; i++) {
        const lwr = Math.max(0, i - w2), upr = Math.min(kl.length - 1, i + w2)
        let isH = true, isL = true
        for (let j = lwr; j <= upr; j++) {
            if (kl[j].high > kl[i].high) isH = false
            if (kl[j].low < kl[i].low) isL = false
        }
        if (isH && lastKind !== 'h') { pts.push({ i, v: kl[i].high }); lastKind = 'h' }
        else if (isL && lastKind !== 'l') { pts.push({ i, v: kl[i].low }); lastKind = 'l' }
    }
    return pts
}

export interface RenderOpts {
    highlightBars?: number
    levels?: PatternLevels | null
    zigzag?: boolean
    width?: number
    height?: number
    title?: string
}

// ── REAL-candle SVG renderer ─────────────────────────────────────────
export function renderPatternSVG(kl: Kline[], opts: RenderOpts = {}): string {
    const W = opts.width || 320
    const H = opts.height || 170
    const PAD_R = opts.levels ? 56 : 8 // room for poster label pills
    const PAD = 8

    if (!kl || kl.length === 0) {
        return `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">`
            + `<text x="${W / 2}" y="${H / 2}" fill="#3a4a5a" font-size="10" text-anchor="middle" font-family="monospace">waiting for data…</text></svg>`
    }

    // y-scale must include the levels so STOP/TARGET stay on screen
    let pMin = Math.min(...kl.map(k => k.low))
    let pMax = Math.max(...kl.map(k => k.high))
    if (opts.levels) {
        pMin = Math.min(pMin, opts.levels.sl, opts.levels.tp, opts.levels.entry)
        pMax = Math.max(pMax, opts.levels.sl, opts.levels.tp, opts.levels.entry)
    }
    const range = (pMax - pMin) || 1
    pMin -= range * 0.04; pMax += range * 0.04
    const y = (p: number) => PAD + (pMax - p) / (pMax - pMin) * (H - 2 * PAD)

    const n = kl.length
    const plotW = W - PAD - PAD_R
    const step = plotW / n
    const bw = Math.max(2, Math.min(9, step * 0.62))
    const x = (i: number) => PAD + i * step + step / 2

    const GRN = '#00d97a', RED = '#ff3355'
    const hlFrom = opts.highlightBars ? n - opts.highlightBars : n + 1
    let out = ''

    // soft grid
    for (let g = 1; g <= 3; g++) {
        const gy = PAD + g * (H - 2 * PAD) / 4
        out += `<line x1="${PAD}" y1="${gy.toFixed(1)}" x2="${(W - PAD_R).toFixed(1)}" y2="${gy.toFixed(1)}" stroke="#0d1825" stroke-width="1"/>`
    }

    // candles — real OHLC
    for (let i = 0; i < n; i++) {
        const k = kl[i]
        const up = k.close >= k.open
        const c = up ? GRN : RED
        const cx = x(i)
        const bodyTop = y(Math.max(k.open, k.close))
        const bodyH = Math.max(1, Math.abs(y(k.open) - y(k.close)))
        const hl = i >= hlFrom
        out += `<line class="apv-wick" x1="${cx.toFixed(1)}" y1="${y(k.high).toFixed(1)}" x2="${cx.toFixed(1)}" y2="${y(k.low).toFixed(1)}" stroke="${c}" stroke-width="1" opacity="${hl ? 1 : 0.55}"/>`
        out += `<rect class="apv-body${hl ? ' apv-hl' : ''}" x="${(cx - bw / 2).toFixed(1)}" y="${bodyTop.toFixed(1)}" width="${bw.toFixed(1)}" height="${bodyH.toFixed(1)}"`
            + ` fill="${c}${hl ? '' : '44'}" stroke="${c}" stroke-width="${hl ? 1.4 : 0.8}"${hl ? ` filter="url(#apvGlow)"` : ''}/>`
    }

    // zigzag structure overlay (poster look)
    if (opts.zigzag) {
        const pts = _zigzagPoints(kl)
        if (pts.length >= 2) {
            const path = pts.map(p => `${x(p.i).toFixed(1)},${y(p.v).toFixed(1)}`).join(' ')
            out += `<polyline class="apv-zigzag" points="${path}" fill="none" stroke="#e8eef5" stroke-width="1.4" opacity="0.85" stroke-linejoin="round"/>`
        }
    }

    // poster-style level lines + label pills
    if (opts.levels) {
        const lv = opts.levels
        const lab = (py: number, txt: string, color: string) => {
            const ly = Math.max(PAD + 5, Math.min(H - PAD - 5, y(py)))
            return `<line class="apv-level" x1="${PAD}" y1="${ly.toFixed(1)}" x2="${(W - PAD_R + 2).toFixed(1)}" y2="${ly.toFixed(1)}" stroke="${color}" stroke-width="1" stroke-dasharray="4 3" opacity="0.9"/>`
                + `<rect x="${(W - PAD_R + 4).toFixed(1)}" y="${(ly - 7).toFixed(1)}" width="${(PAD_R - 8).toFixed(1)}" height="14" rx="2" fill="${color}22" stroke="${color}" stroke-width="0.8"/>`
                + `<text x="${(W - PAD_R / 2).toFixed(1)}" y="${(ly + 3.2).toFixed(1)}" fill="${color}" font-size="7.5" text-anchor="middle" font-family="monospace" font-weight="bold">${txt}</text>`
        }
        out += lab(lv.tp, 'TARGET', GRN)
        out += lab(lv.entry, 'ENTRY', '#00d4ff')
        out += lab(lv.sl, 'STOP', RED)
    }

    return `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">`
        + `<defs><filter id="apvGlow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="1.2" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>`
        + out + `</svg>`
}
