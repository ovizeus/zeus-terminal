import { describe, it, expect, vi, afterEach } from 'vitest'
import { initIchnos, clearIchnos } from '../ichnosChart'

// [2026-11-16] A doua versiune ICHNOS: panou propriu, casute ca in capturi.
// Prima desena peste chart si pe 30m „nu se vedea nimic".
const w = window as any
const texts: string[] = []
function fakeCtx(): any {
    return new Proxy({}, {
        get(t: any, k) {
            if (k in t) return t[k]
            if (k === 'fillText') return (s: string) => texts.push(String(s))
            if (k === 'measureText') return (s: string) => ({ width: String(s).length * 7 })
            return () => {}
        },
        set(t: any, k, v) { t[k] = v; return true },
    })
}
const FP = { ok: true, symbol: 'BTCUSDT', tf: '5m', bin: 10, unit: 'usd', source: 'bybit', candles: [
    { t: Date.UTC(2026, 10, 16, 9, 20), o: 64300, h: 64350, l: 64290, c: 64340, lv: [[64340, 50000, 120000], [64330, 30000, 40000], [64320, 20000, 15000], [64300, 9000, 4000], [64290, 3000, 2000]] },
] }

describe('ICHNOS — panoul', () => {
    afterEach(() => { clearIchnos(); vi.unstubAllGlobals(); document.body.innerHTML = '' })
    it('se deschide sub chart si deseneaza casutele, Σ si Δ din datele reale', async () => {
        document.body.innerHTML = '<div id="ichnosPanel" style="display:none"></div>'
        const el = document.getElementById('ichnosPanel') as HTMLElement
        Object.defineProperty(el, 'clientWidth', { value: 420 }); Object.defineProperty(el, 'clientHeight', { value: 460 })
        HTMLCanvasElement.prototype.getContext = (() => fakeCtx()) as any
        w.S = { symbol: 'BTCUSDT', chartTf: '5m' }
        vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => FP })))
        texts.length = 0
        initIchnos()
        expect(el.style.display).toBe('')
        await new Promise((r) => setTimeout(r, 0)); await new Promise((r) => setTimeout(r, 0))
        expect(texts).toContain('50')            // vandut 50k la 64340
        expect(texts).toContain('120')           // cumparat 120k
        expect(texts).toContain('Σ 293')         // total 293k
        expect(texts).toContain('Δ 69')          // delta: 181k cumparat − 112k vandut
        expect(texts.some((t) => t.startsWith('ICHNOS · FOOTPRINT · BTC'))).toBe(true)
    })
    it('moneda fara date spune clar, nu deseneaza nimic inventat', async () => {
        document.body.innerHTML = '<div id="ichnosPanel"></div>'
        HTMLCanvasElement.prototype.getContext = (() => fakeCtx()) as any
        w.S = { symbol: 'XRPUSDT', chartTf: '5m' }
        vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ ok: false, error: 'unsupported' }) })))
        texts.length = 0
        initIchnos()
        await new Promise((r) => setTimeout(r, 0)); await new Promise((r) => setTimeout(r, 0))
        expect(texts.some((t) => t.includes('No trade data for XRP'))).toBe(true)
    })
})
