import { describe, it, expect, beforeEach } from 'vitest'
import { livePnlOf, calcPosPnL } from '../marketDataPositions'

// [2026-11-21] Bug gasit la audit: pozitiile AUTOTRADE ramaneau cu pnl 0 (renderDemoPositions le
// sare), deci jurnalul creierului, radarul si „ACTIVE POSITION" aratau +$0.00 cu pretul miscat.
const w = window as any
describe('livePnlOf — PnL-ul viu din pretul de acum', () => {
  beforeEach(() => { w.allPrices = {}; w.wlPrices = {} })
  it('pozitie autotrade cu pnl ramas 0: calculeaza din pretul de acum, ca restul aplicatiei', () => {
    w.allPrices = { BTCUSDT: 59099 }
    const pos = { sym: 'BTCUSDT', side: 'LONG', entry: 59045, size: 637, lev: 5, pnl: 0, autoTrade: true }
    const v = livePnlOf(pos) as number
    expect(v).toBeCloseTo(calcPosPnL(pos, 59099), 6)
    expect(v).toBeGreaterThan(2.5)
  })
  it('pozitie de la bursa: pastreaza PnL-ul bursei', () => {
    w.allPrices = { BTCUSDT: 70000 }
    expect(livePnlOf({ sym: 'BTCUSDT', side: 'LONG', entry: 59045, size: 637, lev: 5, pnl: 12.5, fromExchange: true })).toBe(12.5)
  })
  it('fara pret: ramane pe valoarea stiuta; fara nimic: null', () => {
    expect(livePnlOf({ sym: 'NOPEUSDT', side: 'LONG', entry: 1, size: 1, lev: 1, pnl: 3 })).toBe(3)
    expect(livePnlOf(null)).toBeNull()
  })
})
