/**
 * [2026-10-21 b294] `_syncQmVars()` e puntea dintre starea Zeus (`S.foo`) si
 * numele pe care le citeste randarea (`S._qmFoo`). Portarea din HTML a aliasat
 * CITIRILE la `_qm*`, dar puntea a rămas la ~20 de campuri din 157.
 *
 * Masurat pe tot repo-ul (1014 fisiere): 71 de campuri citite de frame.ts nu
 * au niciun scriitor. 28 dintre ele sunt PUNTE NETERMINATA — valoarea exista
 * deja pe S, calculata la fiecare 60s de calcS2F/calcLogRegression/
 * calcMarketCycle si de basisRate — si e aruncata.
 *
 * Exemplu masurat pe date vii: Mayer Multiple real 1,137 (BTC $82.743 /
 * media 200 zile $72.767) in timp ce panoul afisa 0.
 */
import { describe, test, expect, beforeEach } from 'vitest'
import { _syncQmVars } from '../index'

const w = window as unknown as Record<string, any>

// camp citit de frame.ts  ->  sursa reala de pe S
const BRIDGE: Array<[string, string, unknown]> = [
  ['_qmAtr', 'atr', 1234.5],
  ['_qmMarkPrice', 'markPrice', 82743.1],
  ['_qmIndexPrice', 'indexPrice', 82700.2],
  ['_qmFundingRate', 'fr', 0.0001],
  ['_qmOiValue', 'oi', 98765],
  ['_qmS2fValue', 's2fValue', 56.7],
  ['_qmS2fModelPrice', 's2fModelPrice', 123456],
  ['_qmS2fDeviation', 's2fDeviation', -12.3],
  ['_qmMayer200dma', 'mayer200dma', 72767],
  ['_qmMayerMultiple', 'mayerMultiple', 1.137],
  ['_qmWma200', 'wma200', 71000],
  ['_qmWmaRatio', 'wmaRatio', 1.05],
  ['_qmLogRegMid', 'logRegMid', 80000],
  ['_qmLogRegHigh', 'logRegHigh', 120000],
  ['_qmLogRegLow', 'logRegLow', 50000],
  ['_qmLogRegPos', 'logRegPos', 42.5],
  ['_qmNupl', 'nupl', 33.3],
  ['_qmRealizedProxy', 'realizedProxy', 55000],
  ['_qmRhodlScore', 'rhodlScore', 7.7],
  ['_qmPuell', 'puell', 0.9],
  ['_qmPi111', 'pi111', 81000],
  ['_qmPi350x2', 'pi350x2', 150000],
  ['_qmPiSignal', 'piSignal', 'NEUTRAL'],
  ['_qmCyclePct', 'cyclePct', 61],
  ['_qmCyclePhase', 'cyclePhase', 'EUPHORIA'],
  ['_qmCyclePhaseClr', 'cyclePhaseClr', 'yb'],
  ['_qmCycleDaysElapsed', 'cycleDaysElapsed', 900],
  ['_qmCycleDaysRemain', 'cycleDaysRemain', 500],
]

beforeEach(() => {
  w.S = { price: 82743 }
})

describe('_syncQmVars — puntea S.foo -> S._qmFoo', () => {
  test('ASTA E REPARATIA: toate cele 28 de valori existente ajung la randare', () => {
    BRIDGE.forEach(([, src, val]) => { w.S[src] = val })
    _syncQmVars()
    const lipsa = BRIDGE.filter(([dst, , val]) => w.S[dst] !== val)
      .map(([dst, src]) => `${dst} (din S.${src})`)
    expect(lipsa).toEqual([])
  })

  test('zero si sirurile goale trec corect, nu sunt inlocuite cu alt default', () => {
    w.S.mayerMultiple = 0
    w.S.cyclePhase = ''
    _syncQmVars()
    expect(w.S._qmMayerMultiple).toBe(0)
    expect(w.S._qmCyclePhase).toBe('')
  })

  test('cand sursa lipseste, nu inventeaza valori', () => {
    _syncQmVars()
    expect(w.S._qmMayerMultiple).toBe(0)
    expect(w.S._qmCyclePhase).toBe('')
    expect(w.S._qmPiSignal).toBe('')
  })

  test('nu strica puntea care mergea deja', () => {
    w.S.ls = { l: 55, s: 45 }
    w.S.chg24hPct = 2.5
    w.S.vol24h = 1e9
    _syncQmVars()
    expect(w.S._qmLongRatio).toBeCloseTo(0.55)
    expect(w.S._qmShortRatio).toBeCloseTo(0.45)
    expect(w.S._qmChgP).toBe(2.5)
    expect(w.S._qmVol).toBe(1e9)
  })

  test('nu explodeaza cand S nu exista', () => {
    delete w.S
    expect(() => _syncQmVars()).not.toThrow()
  })
})
