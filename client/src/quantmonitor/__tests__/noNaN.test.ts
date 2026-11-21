import { describe, test, expect } from 'vitest'
import { _syncQmVars } from '../index'
import { runIntel } from '../engines/intel'
import { calcFLOW } from '../engines/flow'
import { calcARIA } from '../engines/aria'
import { calcWyckoff, calcCVDDivergence, calcVolumeProfile } from '../engines/wyckoff'
import { normalizeKlines } from '../engines/klinesNorm'

// [2026-11-21] Audit: un camp care iese NaN se afiseaza ca implicitul lui (`|| 50`) si arata ca o piata
// linistita — asa a stat Fear & Greed pe „50 NEUTRAL" luni de zile. Dupa un ciclu complet al motoarelor
// pe o stare REALISTA (forme reale: ls = {l,s}, carte {p,q}, lumanari Zeus), niciun camp _qm nu e NaN.
const w = window as any
function realistic() {
  const kl = Array.from({ length: 300 }, (_, i) => {
    const c = 90000 + Math.sin(i / 9) * 400 + i * 2
    return { time: 1_795_000_000 + i * 300, open: c - 30, high: c + 60, low: c - 70, close: c, volume: 50 + (i % 7) * 10 }
  })
  const px = kl[kl.length - 1].close
  return {
    symbol: 'BTCUSDT', price: px, _qmPrice: px, klines: kl, rsi: { '5m': 58, '1h': 55 }, fr: 0.0001, oi: 9.1e9, atr: 180,
    ls: { l: 62, s: 38 }, bnbOk: true,
    bids: Array.from({ length: 20 }, (_, i) => ({ p: px - 1 - i, q: 1 + (i % 5) })),
    asks: Array.from({ length: 20 }, (_, i) => ({ p: px + 1 + i, q: 1 + (i % 4) })),
    _qmBuf: Array.from({ length: 200 }, (_, i) => px - 50 + i * 0.5),
    magnets: { above: [{ price: px * 1.01 }], below: [{ price: px * 0.99 }] },
    signalData: { bullCount: 4, bearCount: 2, signals: [] },
  }
}
describe('Quant Monitor — niciun camp NaN dupa un ciclu', () => {
  test('starea realista → zero NaN', () => {
    w.S = realistic()
    const bad: string[] = []
    for (let k = 0; k < 3; k++) {
      _syncQmVars()
      normalizeKlines(w.S.klines)   // in loc, ca ciclul real
      for (const f of [runIntel, calcFLOW, calcARIA, calcWyckoff, calcCVDDivergence, calcVolumeProfile]) { try { (f as any)() } catch (e) { bad.push(`${(f as any).name} threw: ${String(e).slice(0, 80)}`) } }
    }
    for (const [key, v] of Object.entries(w.S)) {
      if (!key.startsWith('_qm')) continue
      if (typeof v === 'number' && Number.isNaN(v)) bad.push(key)
      if (v && typeof v === 'object' && !Array.isArray(v)) for (const [k2, v2] of Object.entries(v as any)) if (typeof v2 === 'number' && Number.isNaN(v2)) bad.push(`${key}.${k2}`)
    }
    expect(bad).toEqual([])
  })
})
