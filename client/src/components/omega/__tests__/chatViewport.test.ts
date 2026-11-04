import { describe, it, expect } from 'vitest'
import { keyboardInset, readViewport, KB_MIN_INSET_PX, KB_MAX_INSET_RATIO } from '../chatViewport'

describe('keyboardInset', () => {
    it('is zero when the visual viewport fills the window', () => {
        expect(keyboardInset({ innerHeight: 844, viewportHeight: 844 })).toBe(0)
    })

    it('reports the covered height when the keyboard is up', () => {
        // iPhone 13: 844 layout, 508 visible with the keyboard open.
        expect(keyboardInset({ innerHeight: 844, viewportHeight: 508 })).toBe(336)
    })

    it('subtracts offsetTop, so a scrolled visual viewport is not counted as keyboard', () => {
        // Same visible height, but the page is panned down 300px: not a keyboard.
        expect(keyboardInset({ innerHeight: 844, viewportHeight: 508, offsetTop: 300 })).toBe(36 >= KB_MIN_INSET_PX ? 36 : 0)
        expect(keyboardInset({ innerHeight: 844, viewportHeight: 508, offsetTop: 300 })).toBe(0)
    })

    it('ignores a delta smaller than the threshold (browser chrome settling)', () => {
        expect(keyboardInset({ innerHeight: 844, viewportHeight: 844 - (KB_MIN_INSET_PX - 1) })).toBe(0)
        expect(keyboardInset({ innerHeight: 844, viewportHeight: 844 - KB_MIN_INSET_PX })).toBe(KB_MIN_INSET_PX)
    })

    it('caps the inset so the chat can never be squeezed to nothing', () => {
        // Absurd reading: visual viewport almost zero.
        const inset = keyboardInset({ innerHeight: 800, viewportHeight: 1 })
        expect(inset).toBe(Math.floor(800 * KB_MAX_INSET_RATIO))
        expect(inset).toBeLessThan(800)
    })

    it('returns zero for missing or unusable metrics', () => {
        expect(keyboardInset(null)).toBe(0)
        expect(keyboardInset(undefined)).toBe(0)
        expect(keyboardInset({ innerHeight: 0, viewportHeight: 0 })).toBe(0)
        expect(keyboardInset({ innerHeight: NaN, viewportHeight: 508 })).toBe(0)
        expect(keyboardInset({ innerHeight: 844, viewportHeight: NaN })).toBe(0)
        // null masquerading as a number: Number(null) === 0 passes isFinite.
        expect(keyboardInset({ innerHeight: null as unknown as number, viewportHeight: 508 })).toBe(0)
        expect(keyboardInset({ innerHeight: 844, viewportHeight: null as unknown as number })).toBe(0)
    })

    it('treats a non-finite offsetTop as zero rather than poisoning the result', () => {
        expect(keyboardInset({ innerHeight: 844, viewportHeight: 508, offsetTop: NaN })).toBe(336)
    })
})

describe('readViewport', () => {
    it('returns null where visualViewport is absent', () => {
        expect(readViewport({ innerHeight: 844 } as unknown as Window)).toBeNull()
        expect(readViewport(undefined)).toBeNull()
    })

    it('reads innerHeight and the visual viewport together', () => {
        const win = { innerHeight: 844, visualViewport: { height: 508, offsetTop: 0 } } as unknown as Window
        expect(readViewport(win)).toEqual({ innerHeight: 844, viewportHeight: 508, offsetTop: 0 })
    })
})
