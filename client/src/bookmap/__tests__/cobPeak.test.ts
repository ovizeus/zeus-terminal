import { describe, it, expect } from 'vitest'
import { cobPeak, rowToPrice, fmtBookPrice } from '../book'

// [BOOK 2026-11-12] Langa total, operatorul vrea si PRETUL la care sta cel mai
// gros nivel de pe fiecare parte — ca „Liq max 48.86M → 72,426" la Coinglass.

const COB = [
    { row: 0, bidUsd: 30, askUsd: 0 },
    { row: 1, bidUsd: 50, askUsd: 0 },
    { row: 2, bidUsd: 20, askUsd: 5 },
    { row: 3, bidUsd: 0, askUsd: 10 },
    { row: 5, bidUsd: 0, askUsd: 40 },
]

describe('cobPeak — the thickest level on each side', () => {
    it('finds the row and the amount, per side', () => {
        expect(cobPeak(COB, 'ask')).toEqual({ row: 5, usd: 40 })
        expect(cobPeak(COB, 'bid')).toEqual({ row: 1, usd: 50 })
    })
    it('on a tie keeps the level nearest the spread', () => {
        const tie = [{ row: 0, bidUsd: 9, askUsd: 0 }, { row: 1, bidUsd: 9, askUsd: 0 },
            { row: 2, bidUsd: 0, askUsd: 7 }, { row: 3, bidUsd: 0, askUsd: 7 }]
        expect(cobPeak(tie, 'bid')!.row).toBe(1)
        expect(cobPeak(tie, 'ask')!.row).toBe(2)
    })
    it('returns null when the side is empty or the input is garbage', () => {
        expect(cobPeak([{ row: 0, bidUsd: 5, askUsd: 0 }], 'ask')).toBeNull()
        expect(cobPeak([], 'bid')).toBeNull()
        expect(cobPeak(null as any, 'bid')).toBeNull()
        expect(cobPeak([{ row: 0, bidUsd: NaN as any, askUsd: -1 }], 'bid')).toBeNull()
    })
})

describe('rowToPrice — the price at the middle of a row (row 0 is the bottom)', () => {
    it('maps rows onto the drawn price range', () => {
        expect(rowToPrice(0, 10, 100, 200)).toBe(105)
        expect(rowToPrice(9, 10, 100, 200)).toBe(195)
    })
    it('is the inverse of the row a price falls in', () => {
        const lo = 71422, hi = 71815, rows = 60
        const p = rowToPrice(37, rows, lo, hi)!
        expect(Math.floor((p - lo) / ((hi - lo) / rows))).toBe(37)
    })
    it('refuses a meaningless grid instead of inventing a price', () => {
        expect(rowToPrice(3, 0, 100, 200)).toBeNull()
        expect(rowToPrice(3, 10, 200, 100)).toBeNull()
        expect(rowToPrice(-1, 10, 100, 200)).toBeNull()
        expect(rowToPrice(10, 10, 100, 200)).toBeNull()
        expect(rowToPrice(NaN as any, 10, 100, 200)).toBeNull()
    })
})

describe('fmtBookPrice', () => {
    it('keeps the digits that matter for the size of the price', () => {
        expect(fmtBookPrice(71790.4)).toBe('71,790')
        expect(fmtBookPrice(655.9)).toBe('655.9')
        expect(fmtBookPrice(81.352)).toBe('81.35')
        expect(fmtBookPrice(0.61234)).toBe('0.6123')
        expect(fmtBookPrice(0)).toBe('')
        expect(fmtBookPrice(NaN)).toBe('')
    })
})
