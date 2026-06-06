/**
 * [ARIA PATTERN VISION 2026-06-06] Pure helpers for the real-candle pattern
 * drawing in the ARIA dock page. Operator: the old fixed SVG glyphs looked
 * fake — the panel must draw the REAL candles of the window where the pattern
 * fired, plus visual ENTRY/TP/SL. Detection itself is untouched (it feeds the
 * brain — money-path); this is a pure DISPLAY layer, hence pure & testable.
 */
import { atr, patternSpan, computePatternLevels, renderPatternSVG, Kline } from '../../client/src/engine/ariaPatternViz'

function mk(open: number, high: number, low: number, close: number): Kline {
    return { time: 0, open, high, low, close, volume: 1 }
}

// Synthetic uptrend ending in a bullish bar: lows rising, last close at top.
const UP: Kline[] = [
    mk(100, 102, 99, 101), mk(101, 103, 100, 102), mk(102, 104, 101, 103),
    mk(103, 105, 102, 104), mk(104, 106, 103, 105), mk(105, 107, 104, 106),
    mk(106, 108, 105, 107), mk(107, 109, 106, 108), mk(108, 110, 107, 109),
    mk(109, 111, 108, 110), mk(110, 112, 109, 111), mk(111, 113, 110, 112),
    mk(112, 114, 111, 113), mk(113, 115, 112, 114), mk(114, 116, 113, 115),
]

describe('atr', () => {
    test('average true range of constant-range bars equals the range', () => {
        expect(atr(UP, 14)).toBeCloseTo(3, 5) // every bar: high=o+2, low=o-1 → range 3
    })
    test('insufficient data → 0', () => {
        expect(atr([], 14)).toBe(0)
        expect(atr([mk(1, 2, 0.5, 1.5)], 14)).toBeGreaterThan(0) // 1 bar still gives its range
    })
})

describe('patternSpan', () => {
    test('candle patterns span few bars, chart patterns span many', () => {
        expect(patternSpan('engulfbull')).toBe(2)
        expect(patternSpan('morningstar')).toBe(3)
        expect(patternSpan('doubletop')).toBeGreaterThanOrEqual(15)
        expect(patternSpan('fvg_bull')).toBeGreaterThanOrEqual(3)
        expect(patternSpan('unknown_type')).toBeGreaterThanOrEqual(1)
    })
})

describe('computePatternLevels', () => {
    test('BULL: entry=last close, SL below recent low, TP=2R, rr≈2', () => {
        const lv = computePatternLevels('bull', 'engulfbull', UP)!
        expect(lv).toBeTruthy()
        expect(lv.entry).toBe(115)
        expect(lv.sl).toBeLessThan(113)        // below min low of the 2 pattern bars (113)
        expect(lv.tp).toBeCloseTo(lv.entry + 2 * (lv.entry - lv.sl), 5)
        expect(lv.rr).toBeCloseTo(2, 1)
    })

    test('BEAR: mirrored — SL above recent high, TP below entry', () => {
        const down = UP.map(k => mk(2 * 115 - k.open, 2 * 115 - k.low, 2 * 115 - k.high, 2 * 115 - k.close))
        const lv = computePatternLevels('bear', 'engulfbear', down)!
        expect(lv.entry).toBe(115)
        expect(lv.sl).toBeGreaterThan(117)     // above max high of pattern bars (117)
        expect(lv.tp).toBeLessThan(lv.entry)
        expect(lv.rr).toBeCloseTo(2, 1)
    })

    test('chart pattern (doubletop) uses measured move: TP = entry - pattern height', () => {
        const lv = computePatternLevels('bear', 'doubletop', UP)!
        const span = patternSpan('doubletop')
        const win = UP.slice(-span)
        const height = Math.max(...win.map(k => k.high)) - Math.min(...win.map(k => k.low))
        expect(lv.tp).toBeCloseTo(lv.entry - height, 5)
    })

    test('watch direction or empty data → null', () => {
        expect(computePatternLevels('watch', 'doji', UP)).toBeNull()
        expect(computePatternLevels('bull', 'engulfbull', [])).toBeNull()
    })
})

describe('renderPatternSVG', () => {
    test('draws one body + one wick per candle, real data', () => {
        const svg = renderPatternSVG(UP.slice(-10), {})
        expect((svg.match(/apv-body/g) || []).length).toBe(10)
        expect((svg.match(/apv-wick/g) || []).length).toBe(10)
        expect(svg.startsWith('<svg')).toBe(true)
        expect(svg).not.toMatch(/NaN/)
    })

    test('highlights exactly the requested trailing pattern bars', () => {
        const svg = renderPatternSVG(UP.slice(-12), { highlightBars: 3 })
        expect((svg.match(/apv-hl/g) || []).length).toBe(3)
    })

    test('levels render ENTRY/TARGET/STOP dashed lines with poster-style label pills', () => {
        const lv = computePatternLevels('bull', 'engulfbull', UP)!
        const svg = renderPatternSVG(UP.slice(-12), { levels: lv })
        expect(svg).toContain('ENTRY')
        expect(svg).toContain('TARGET')
        expect(svg).toContain('STOP')
        expect((svg.match(/apv-level/g) || []).length).toBe(3)
        expect(svg).not.toMatch(/NaN/)
    })

    test('zigzag structure overlay (poster look) when requested', () => {
        const svg = renderPatternSVG(UP.slice(-20), { zigzag: true })
        expect(svg).toContain('apv-zigzag')
    })

    test('empty input → empty-state svg, no crash', () => {
        const svg = renderPatternSVG([], {})
        expect(svg.startsWith('<svg')).toBe(true)
        expect(svg).not.toMatch(/NaN/)
    })
})
