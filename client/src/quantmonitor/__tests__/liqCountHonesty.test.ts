/**
 * [2026-10-21 b294] Tabelul „REAL LIQUIDATIONS THIS SESSION" punea alaturi
 * doua numere care descriu seturi DIFERITE odata ce sesiunea devine activa:
 *   COUNT = `liqAgg[ex].btc.length`, plafonat la 300 de `addLiq` (inel)
 *   TOTAL = `liqAgg[ex].totalBtc`, acumulat la infinit
 * Deci dupa 300 de lichidari pe o bursa, COUNT ingheata pe 300 in timp ce
 * TOTAL continua sa urce. Pe o ora volatila, 300 se atinge usor.
 *
 * Eticheta spune „THIS SESSION", deci TOTAL e cel corect — l-am lasat in pace
 * si am facut COUNT sa fie tot pe sesiune. Inelul de 300 rămâne, dar doar
 * pentru fluxul de evenimente afisat, nu pentru numaratoare.
 */
import { describe, test, expect, beforeEach } from 'vitest'
import { QM, addLiq, getLiqTotals } from '../state'

beforeEach(() => {
  ;(['binance', 'bybit', 'okx'] as const).forEach((ex) => {
    QM.liqAgg[ex].btc.length = 0
    QM.liqAgg[ex].totalBtc = 0
    ;(QM.liqAgg[ex] as unknown as Record<string, number>).countBtc = 0
  })
})

describe('numaratoarea de lichidari', () => {
  test('inelul de 300 rămâne, ca fluxul afisat sa nu creasca nelimitat', () => {
    for (let i = 0; i < 450; i++) addLiq('binance', { vol: 1, p: 80000, time: Date.now() })
    expect(QM.liqAgg.binance.btc.length).toBe(300)
  })

  test('ASTA E REPARATIA: COUNT nu mai ingheata la 300', () => {
    for (let i = 0; i < 450; i++) addLiq('binance', { vol: 1, p: 80000, time: Date.now() })
    expect(getLiqTotals().count).toBe(450)
  })

  test('COUNT si TOTAL descriu ACELASI set', () => {
    for (let i = 0; i < 700; i++) addLiq('bybit', { vol: 2, p: 80000, time: Date.now() })
    const { count, total } = getLiqTotals()
    expect(count).toBe(700)
    expect(total).toBe(1400)          // 700 x 2
    expect(total / count).toBe(2)     // media per eveniment are sens
  })

  test('aduna peste cele trei burse', () => {
    for (let i = 0; i < 10; i++) addLiq('binance', { vol: 1, p: 1, time: 1 })
    for (let i = 0; i < 5; i++) addLiq('bybit', { vol: 1, p: 1, time: 1 })
    for (let i = 0; i < 2; i++) addLiq('okx', { vol: 1, p: 1, time: 1 })
    expect(getLiqTotals().count).toBe(17)
  })

  test('o bursa necunoscuta e ignorata, nu numarata', () => {
    addLiq('kraken', { vol: 99, p: 1, time: 1 })
    expect(getLiqTotals().count).toBe(0)
    expect(getLiqTotals().total).toBe(0)
  })

  test('un eveniment fara volum nu strica totalul (garda NaN rămâne)', () => {
    addLiq('okx', { p: 1, time: 1 })
    addLiq('okx', { vol: 5, p: 1, time: 1 })
    expect(getLiqTotals().total).toBe(5)
    expect(getLiqTotals().count).toBe(2)
  })
})
