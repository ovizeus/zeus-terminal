import { describe, it, expect, vi } from 'vitest'
import { bootScrollTop } from '../scrollBoot'

// [2026-11-16] „La intrare e negru jos": browserul restaura pozitia de scroll
// (si dupa actualizarea automata) inainte ca pagina sa fie desenata.
describe('aplicatia porneste de sus', () => {
    it('opreste restaurarea automata si urca sus imediat', () => {
        const spy = vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
        window.history.scrollRestoration = 'auto'
        bootScrollTop()
        expect(window.history.scrollRestoration).toBe('manual')
        expect(spy).toHaveBeenCalledWith(0, 0)
        spy.mockRestore()
    })
    it('urca sus si la revenirea dintr-o pagina tinuta in cache', () => {
        const spy = vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
        bootScrollTop()
        spy.mockClear()
        const e: any = new Event('pageshow'); e.persisted = true
        window.dispatchEvent(e)
        expect(spy).toHaveBeenCalledWith(0, 0)
        spy.mockRestore()
    })
    it('main.tsx il cheama la pornire', () => {
        const fs = require('fs'), path = require('path')
        expect(fs.readFileSync(path.join(__dirname, '..', '..', 'main.tsx'), 'utf8')).toContain('bootScrollTop()')
    })
})
