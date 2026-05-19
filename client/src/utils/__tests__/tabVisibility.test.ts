import { describe, test, expect, beforeEach, vi } from 'vitest'
import { isTabVisible, onVisibilityChange } from '../tabVisibility'

describe('tabVisibility', () => {
    beforeEach(() => {
        Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
    })

    test('isTabVisible returns true when document.visibilityState is visible', () => {
        Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
        expect(isTabVisible()).toBe(true)
    })

    test('isTabVisible returns false when document.visibilityState is hidden', () => {
        Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true })
        expect(isTabVisible()).toBe(false)
    })

    test('isTabVisible returns false when document.visibilityState is prerender', () => {
        Object.defineProperty(document, 'visibilityState', { value: 'prerender', configurable: true })
        expect(isTabVisible()).toBe(false)
    })

    test('onVisibilityChange registers listener and fires on visibilitychange event', () => {
        const cb = vi.fn()
        const off = onVisibilityChange(cb)
        document.dispatchEvent(new Event('visibilitychange'))
        expect(cb).toHaveBeenCalledTimes(1)
        off()
    })

    test('onVisibilityChange off() removes listener', () => {
        const cb = vi.fn()
        const off = onVisibilityChange(cb)
        off()
        document.dispatchEvent(new Event('visibilitychange'))
        expect(cb).not.toHaveBeenCalled()
    })

    test('onVisibilityChange passes current isVisible to callback', () => {
        const cb = vi.fn()
        onVisibilityChange(cb)
        Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true })
        document.dispatchEvent(new Event('visibilitychange'))
        expect(cb).toHaveBeenCalledWith(false)
    })
})
