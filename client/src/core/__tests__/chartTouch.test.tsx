import { describe, it, expect } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import { installAxisVerticalDrag } from '../chartTouch'
import { jumpTarget } from '../../components/layout/ScrollJumpButton'

// [2026-11-16] „Cu multi indicatori nu mai merge scroll-ul, gesturile se duc in charturi."
const SRC = path.join(__dirname, '..', '..')
const read = (p: string) => fs.readFileSync(path.join(SRC, p), 'utf8')

describe('sus-jos pe chart deruleaza pagina', () => {
    it('⛔ niciun chart nu mai prinde tragerea verticala', () => {
        for (const f of ['components/chart/TradingChart.tsx', 'data/marketDataChart.ts', 'engine/indicators.ts']) {
            const s = read(f)
            expect(s).not.toMatch(/vertTouchDrag:\s*true/)
            for (const m of s.matchAll(/handleScroll:\s*\{([^}]*)\}/g)) expect(m[1]).toContain('vertTouchDrag: false')
        }
    })
    it('pe axa de pret tragerea verticala e a chartului, doar cat tine atingerea', () => {
        const opts: any[] = []
        const chart = { applyOptions: (o: any) => opts.push(o), priceScale: () => ({ width: () => 60 }) }
        const el = document.createElement('div')
        el.getBoundingClientRect = () => ({ left: 0, top: 0, width: 400, height: 300, right: 400, bottom: 300, x: 0, y: 0, toJSON() {} }) as any
        document.body.appendChild(el)
        const off = installAxisVerticalDrag(chart, el)
        const touch = (x: number) => { const e: any = new Event('touchstart', { bubbles: true }); e.touches = [{ clientX: x, clientY: 10 }]; el.dispatchEvent(e) }
        touch(100)                                   // pe chart: nimic
        expect(opts).toEqual([])
        touch(370)                                   // pe axa (ultimii 60 px)
        expect(opts).toEqual([{ handleScroll: { vertTouchDrag: true } }])
        window.dispatchEvent(new Event('touchend'))
        expect(opts[1]).toEqual({ handleScroll: { vertTouchDrag: false } })
        off(); el.remove()
    })
    it('panoul ICHNOS lasa pagina sa se deruleze (pan-y)', () => {
        expect(read('components/layout/PanelShell.tsx')).toMatch(/id="ichnosPanel"[^>]*touchAction: 'pan-y'/)
    })
})

describe('butonul ⇅', () => {
    it('sus de jumatate → jos; dincolo de jumatate → sus', () => {
        expect(jumpTarget(0, 3000)).toBe('bottom')
        expect(jumpTarget(1400, 3000)).toBe('bottom')
        expect(jumpTarget(1600, 3000)).toBe('top')
    })
})

import { render, act } from '@testing-library/react'
import { ScrollJumpButton, IDLE_HIDE_MS } from '../../components/layout/ScrollJumpButton'
import { vi } from 'vitest'
import { tailOffenders } from '../layoutTailProbe'

describe('[2026-11-16] butonul ⇅ apare doar cat derulezi', () => {
    it('se arata la derulare pe o pagina lunga si dispare dupa pauza', async () => {
        vi.useFakeTimers()
        const raf = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb: any) => { cb(0); return 1 })
        document.body.innerHTML = '<div class="bot"></div>'
        const bot = document.querySelector('.bot') as HTMLElement
        bot.getBoundingClientRect = () => ({ bottom: 5000, top: 4990, height: 10, width: 300, left: 0, right: 300, x: 0, y: 0, toJSON() {} }) as any
        const { container } = render(<ScrollJumpButton />)
        const btn = container.querySelector('.zscroll-jump') as HTMLElement
        expect(btn.className).not.toContain(' on')
        act(() => { window.dispatchEvent(new Event('scroll')) })
        expect(btn.className).toContain(' on')
        act(() => { vi.advanceTimersByTime(IDLE_HIDE_MS + 50) })
        expect(btn.className).not.toContain(' on')
        raf.mockRestore(); vi.useRealTimers()
    })
})

describe('sonda cozii goale', () => {
    it('gaseste elementele care coboara sub continut, cele mai adanci intai, fara cele fixe', () => {
        document.body.innerHTML = '<div id="a"></div><div id="b" class="x y"></div><div id="c"></div>'
        const set = (id: string, bottom: number, pos = 'static') => {
            const e = document.getElementById(id) as HTMLElement
            e.style.position = pos
            e.getBoundingClientRect = () => ({ bottom, top: bottom - 50, height: 50, width: 10, left: 0, right: 10, x: 0, y: 0, toJSON() {} }) as any
        }
        set('a', 900); set('b', 4000); set('c', 9000, 'fixed')
        const off = tailOffenders(1000)
        expect(off.map((o) => o.el)).toEqual(['div#b.x.y'])
    })
})
