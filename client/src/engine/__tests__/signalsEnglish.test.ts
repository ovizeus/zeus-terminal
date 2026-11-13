import { describe, it, expect, vi, beforeEach } from 'vitest'

// [2026-11-13] Operatorul a vazut in panoul Adaptive „SEMNAL BULLISH (2/3) ·
// 2 indicatori aliniati · Confluenta MEDIE" si „0 oportunitati". Tot textul
// vizibil e in ENGLEZA (R-P-10); comentariile raman in romana.
vi.mock('../brain', () => ({ runBrainUpdate: () => {}, brainThink: () => {} }))

import { renderSignals } from '../signals'

const RO = /semnal|indicatori|aliniat|confluent[aă]|puternic|medie\b|oportunit/i

describe('banda de semnal din Signal Scanner', () => {
    beforeEach(() => {
        document.body.innerHTML = '<div id="sigGrid"></div><div id="megaSigBox"></div><span id="sigScanTime"></span>'
    })
    const mega = () => (document.getElementById('megaSigBox') as HTMLElement).textContent || ''
    const sig = (dir: string) => ({ name: 'x', det: 'y', dir, str: 'z' })

    it('bullish, confluenta medie — in engleza', () => {
        renderSignals([sig('bull'), sig('bull'), sig('bear')], 2, 1)
        expect(mega()).toContain('BULLISH SIGNAL (2/3)')
        expect(mega()).toContain('2 indicators aligned · MEDIUM confluence')
        expect(mega()).not.toMatch(RO)
    })
    it('bearish, confluenta puternica — in engleza', () => {
        renderSignals([sig('bear'), sig('bear'), sig('bear'), sig('bear')], 0, 4)
        expect(mega()).toContain('BEARISH SIGNAL (4/4)')
        expect(mega()).toContain('4 indicators aligned · STRONG confluence')
        expect(mega()).not.toMatch(RO)
    })
    it('sub trei semnale nu scrie nicio banda', () => {
        renderSignals([sig('bull')], 1, 0)
        expect(mega().trim()).toBe('')
    })
})

describe('textele scanerului din Adaptive', () => {
    // Sursa, nu randarea: `data/klines.ts` trage dupa el jumatate din aplicatia
    // veche. Se verifica exact sirurile care ajung pe ecran.
    const read = (rel: string) => require('fs').readFileSync(require('path').resolve(__dirname, rel), 'utf8') as string

    it('numaratoarea de oportunitati e in engleza, cu singular si plural', () => {
        const src = read('../../data/klines.ts')
        expect(src).toContain("opps + ' opportunit' + (opps === 1 ? 'y' : 'ies')")
        expect(src).not.toMatch(/oportunit/)
    })
    it('panoul Adaptive nu mai are text in romana', () => {
        const visible = read('../../components/dock/AdaptivePanel.tsx')
            .split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*|\{\/\*)/.test(l)).join('\n')
        expect(visible).toContain('0 opportunities')
        expect(visible).not.toMatch(RO)
    })
})
