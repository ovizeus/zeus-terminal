import { describe, test, expect, vi } from 'vitest'
import { debounce } from '../debounce'

describe('debounce — trailing edge', () => {
    test('calls fn once after delay when invoked once', async () => {
        const fn = vi.fn()
        const deb = debounce(fn, 50)
        deb('a')
        expect(fn).not.toHaveBeenCalled()
        await new Promise(r => setTimeout(r, 70))
        expect(fn).toHaveBeenCalledTimes(1)
        expect(fn).toHaveBeenCalledWith('a')
    })

    test('multiple rapid calls coalesce into one call with last args', async () => {
        const fn = vi.fn()
        const deb = debounce(fn, 50)
        deb('a')
        deb('b')
        deb('c')
        await new Promise(r => setTimeout(r, 70))
        expect(fn).toHaveBeenCalledTimes(1)
        expect(fn).toHaveBeenCalledWith('c')
    })

    test('calls separated by more than delay each fire', async () => {
        const fn = vi.fn()
        const deb = debounce(fn, 30)
        deb('a')
        await new Promise(r => setTimeout(r, 50))
        deb('b')
        await new Promise(r => setTimeout(r, 50))
        expect(fn).toHaveBeenCalledTimes(2)
    })

    test('cancel() prevents pending call', async () => {
        const fn = vi.fn()
        const deb = debounce(fn, 50)
        deb('a')
        deb.cancel()
        await new Promise(r => setTimeout(r, 70))
        expect(fn).not.toHaveBeenCalled()
    })
})
