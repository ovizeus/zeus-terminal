import { describe, it, expect } from 'vitest'
import { BrainRenderer } from '../brainRender'
import { Derived, type Raw } from '../brainDerived'

// [2026-11-16] Masurat pe telefonul operatorului: prefers-reduced-motion = true, deci
// unda radarului nu aparea niciodata, nici cu Focus OFF. Focus OFF e alegerea omului.
function countingCtx() {
    const calls: Record<string, number> = {}
    const ctx: any = new Proxy({}, {
        get(t: any, k: string) {
            if (k in t) return t[k]
            if (k === 'createLinearGradient' || k === 'createRadialGradient') return () => ({ addColorStop() {} })
            return () => { calls[k] = (calls[k] || 0) + 1 }
        },
        set(t: any, k, v) { t[k] = v; return true },
    })
    return { ctx, calls }
}
const raw: Raw = { rt: new Array(12).fill(0.5), tf: new Array(12).fill(0.5), sl: new Array(12).fill(0.5), att: null, ml: null, gatesFailing: [], gatesUnknown: [1],
    conf: 50, thr: 65, mode: 'LONG', modeLabel: 'LONG MODE', signalActive: false, dead: false, position: null, closeMsg: '', main: 'BTC', sats: [] }

function arcs(focus: boolean, reduced: boolean): number {
    const { ctx, calls } = countingCtx()
    const r = new BrainRenderer(ctx)
    r.render(new Derived().build(raw), 1, 0.016, null, { focus, reduced, best: null, sound: () => {}, info: () => {} })
    return calls.arc || 0
}

describe('unda radarului', () => {
    it('⛔ cu animatii reduse, Focus OFF tot deseneaza unda (24 de felii)', () => {
        expect(arcs(false, true) - arcs(true, true)).toBeGreaterThanOrEqual(24)
    })
    it('Focus ON o ascunde', () => {
        expect(arcs(true, false)).toBe(arcs(true, true))
    })
})
