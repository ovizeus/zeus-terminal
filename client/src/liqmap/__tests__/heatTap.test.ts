import { describe, it, expect } from 'vitest'
import { heatGrid, heatLayout, nearestCell, cellTimeRange, fmtCellTime, heatCellColor, HEAT } from '../heat'

// [HEATMAP 2026-11-12] Punctul 7: atingi un patrat si vezi ce e in el. Pe
// telefon o coloana are sub 3px, deci nimeni nu nimereste un patrat cu degetul:
// se alege cel mai APROPIAT patrat cu date, pe o raza mica.

const DATA = {
    cols: 10, bucket: 4, tMin: Date.UTC(2026, 10, 12, 10, 0), tMax: Date.UTC(2026, 10, 12, 20, 0), maxUsd: 90,
    cells: [
        { t: 0, pct: 0.5, longUsd: 0, shortUsd: 40, n: 2 },
        { t: 5, pct: 0, longUsd: 7, shortUsd: 0, n: 1 },
        { t: 9, pct: -0.75, longUsd: 90, shortUsd: 0, n: 4 },
    ],
}

describe('heatLayout — one geometry for drawing and for tapping', () => {
    const g = heatGrid(DATA)!
    const L = heatLayout(320, 384, g)
    it('map + profile + price axis fill the width; the time strip sits under the map', () => {
        expect(L.mapW + 2 + L.profW + 2 + L.axisW).toBe(320)
        expect(L.mapH + L.timeH).toBe(384)
        expect(L.cw).toBeCloseTo(L.mapW / 10, 9)
        expect(L.rh).toBeCloseTo(L.mapH / 6, 9)
    })
    it('row 0 is at the bottom', () => {
        expect(L.yTop(-0.75)).toBeCloseTo(L.mapH - L.rh, 9)
        expect(L.yTop(0.5)).toBeCloseTo(0, 9)
    })
})

describe('nearestCell', () => {
    const g = heatGrid(DATA)!
    const L = heatLayout(320, 384, g)
    const centre = (c: any) => [c.t * L.cw + L.cw / 2, L.yTop(c.pct) + L.rh / 2]
    it('returns the cell under the finger', () => {
        const [x, y] = centre(DATA.cells[1])
        expect(nearestCell(DATA.cells, x, y, L)).toBe(DATA.cells[1])
    })
    it('forgives a near miss', () => {
        const [x, y] = centre(DATA.cells[2])
        expect(nearestCell(DATA.cells, x - L.cw / 2 - 6, y, L, 16)).toBe(DATA.cells[2])
    })
    it('picks the closer of two candidates', () => {
        const cells = [{ t: 2, pct: 0, longUsd: 1, shortUsd: 0, n: 1 }, { t: 4, pct: 0, longUsd: 1, shortUsd: 0, n: 1 }]
        const y = L.yTop(0) + L.rh / 2
        expect(nearestCell(cells, 4 * L.cw + 1, y, L, 200)).toBe(cells[1])
    })
    it('returns null far from any cell, outside the map, or on garbage', () => {
        expect(nearestCell(DATA.cells, L.mapW / 2, L.mapH - 2, L, 10)).toBeNull()
        expect(nearestCell(DATA.cells, L.mapW + 20, 10, L)).toBeNull()
        expect(nearestCell(DATA.cells, NaN, 10, L)).toBeNull()
        expect(nearestCell(null as any, 10, 10, L)).toBeNull()
    })
    it('ignores cells that hold nothing', () => {
        const cells = [{ t: 5, pct: 0, longUsd: 0, shortUsd: 0, n: 0 }]
        expect(nearestCell(cells, 5 * L.cw + L.cw / 2, L.yTop(0) + L.rh / 2, L)).toBeNull()
    })
})

describe('cellTimeRange / fmtCellTime', () => {
    it('a column covers an equal slice of the drawn span', () => {
        const r = cellTimeRange(5, 10, DATA.tMin, DATA.tMax)!
        expect(r.from).toBe(Date.UTC(2026, 10, 12, 15, 0))
        expect(r.to).toBe(Date.UTC(2026, 10, 12, 16, 0))
        expect(cellTimeRange(10, 10, DATA.tMin, DATA.tMax)).toBeNull()
        expect(cellTimeRange(0, 10, 0, 0)).toBeNull()
    })
    it('writes the slice in the viewer time, with the day', () => {
        const r = cellTimeRange(5, 10, DATA.tMin, DATA.tMax)!
        expect(fmtCellTime(r.from, r.to, 120)).toBe('12/11 17:00 – 18:00')
    })
    it('shows both days when the slice crosses midnight', () => {
        expect(fmtCellTime(Date.UTC(2026, 10, 11, 21, 0), Date.UTC(2026, 10, 12, 3, 0), 0))
            .toBe('11/11 21:00 – 12/11 03:00')
    })
})

describe('heat colours — the chart red and green', () => {
    it('longs liquidated are the chart red, shorts the chart green', () => {
        expect(HEAT.long).toBe('#ff3355')
        expect(HEAT.short).toBe('#00d97a')
        expect(heatCellColor(true, 1)).toBe('rgba(255, 51, 85, 1.000)')
        expect(heatCellColor(false, 1)).toBe('rgba(0, 217, 122, 1.000)')
    })
    it('an empty cell is transparent and a faint one stays visible', () => {
        expect(heatCellColor(true, 0)).toBe('rgba(255, 51, 85, 0)')
        expect(heatCellColor(false, 0.01)).toBe('rgba(0, 217, 122, 0.120)')
        expect(heatCellColor(true, NaN)).toBe('rgba(255, 51, 85, 0)')
    })
})
