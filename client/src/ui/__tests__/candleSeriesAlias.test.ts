// [2026-10-24] CAUZA pentru care nu se putea desena, gasita din CAPTURA lui:
// butonul de trendline galben, si mesajul „Could not read the price there".
//
// `coordinateToPrice` intoarce `null` intr-un singur caz: seria intrebata nu are
// date. Dar lumânarile se vedeau pe ecran. Deci `_zCSeries` — aliasul pe care il
// foloseste desenul — arata spre ALTA serie decat cea care deseneaza lumânarile.
//
// `_zCSeries` e scris in exact DOUA locuri, amandoua in chartBridge (registerChart
// si unregisterChart). Iar `applyCandleType` SCHIMBA seria de lumânari —
// `removeSeries(w.cSeries)` apoi `w.cSeries = series` — si nu atinge niciodata
// aliasul. Deci dupa orice schimbare de tip, desenul intreaba seria STEARSA.
//
// Si e si mai rau: settingsStore si config cheama `applyCandleType` LA BOOT, ca sa
// restaureze tipul salvat. Deci pentru un operator care si-a ales alt tip de
// lumânare, desenul era rupt din secunda in care pornea aplicaţia, de fiecare data.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { applyCandleType } from '../candleTypeSwitcher'
import { registerChart, unregisterChart, setCandleSeries, getChartRefs } from '../../bridge/chartBridge'

vi.mock('../../data/chartBackfill', () => ({ initBackfill: () => {} }))

type W = Record<string, any>
const w = window as unknown as W

function stubSeries(tag: string) {
  return { __tag: tag, setData: () => {}, applyOptions: () => {}, update: () => {} }
}

function stubChart() {
  const mk = () => stubSeries('new')
  return {
    removeSeries: vi.fn(),
    addCandlestickSeries: mk, addBarSeries: mk, addLineSeries: mk,
    addAreaSeries: mk, addHistogramSeries: mk,
    applyOptions: () => {}, options: () => ({}),
    timeScale: () => ({ coordinateToLogical: () => 0, timeToCoordinate: () => 0 }),
  }
}

beforeEach(() => {
  try { unregisterChart() } catch (_) { /* */ }
  w.S = { klines: [], symbol: 'BTCUSDT' }
})

describe('setCandleSeries — puntea e SINGURUL proprietar al aliasurilor', () => {
  it('schimba deodata cSeries, _zCSeries si refs.candle', () => {
    const chart = stubChart()
    const first = stubSeries('first')
    registerChart({ chart, candle: first, volume: stubSeries('v'), ema50: stubSeries('a'), ema200: stubSeries('b'), wma20: stubSeries('c'), wma50: stubSeries('d'), st: stubSeries('e') } as any)
    expect(w.cSeries).toBe(first)
    expect(w._zCSeries).toBe(first)

    const replacement = stubSeries('replacement')
    setCandleSeries(replacement)
    expect(w.cSeries).toBe(replacement)
    expect(w._zCSeries).toBe(replacement)          // ← aliasul care era uitat
    expect(getChartRefs()!.candle).toBe(replacement)
  })

  it('accepta null in timpul schimbului, fara sa lase aliasul in urma', () => {
    const chart = stubChart()
    registerChart({ chart, candle: stubSeries('first'), volume: stubSeries('v'), ema50: stubSeries('a'), ema200: stubSeries('b'), wma20: stubSeries('c'), wma50: stubSeries('d'), st: stubSeries('e') } as any)
    setCandleSeries(null)
    expect(w.cSeries).toBe(null)
    expect(w._zCSeries).toBe(null)
  })
})

describe('applyCandleType nu are voie sa lase desenul pe o serie STEARSA', () => {
  it('dupa schimbarea tipului, aliasul de desen arata spre seria NOUA', () => {
    const chart = stubChart()
    const first = stubSeries('first')
    registerChart({ chart, candle: first, volume: stubSeries('v'), ema50: stubSeries('a'), ema200: stubSeries('b'), wma20: stubSeries('c'), wma50: stubSeries('d'), st: stubSeries('e') } as any)
    w.mainChart = chart

    applyCandleType('heikin', { persist: false })

    expect(w.cSeries).not.toBe(first)              // seria s-a schimbat...
    expect(w._zCSeries).toBe(w.cSeries)            // ...si aliasul a venit dupa ea
    expect(w._zCSeries).not.toBe(first)            // NU mai arata spre cea stearsa
  })

  // Exact drumul operatorului: tipul salvat se re-aplica la boot, deci daca
  // aliasul nu urmeaza, desenul e rupt inainte sa atinga el ceva.
  it('si dupa re-aplicarea tipului la boot, desenul are o serie VIE', () => {
    const chart = stubChart()
    const first = stubSeries('first')
    registerChart({ chart, candle: first, volume: stubSeries('v'), ema50: stubSeries('a'), ema200: stubSeries('b'), wma20: stubSeries('c'), wma50: stubSeries('d'), st: stubSeries('e') } as any)
    w.mainChart = chart
    applyCandleType('hollow', { persist: false })
    applyCandleType('heikin', { persist: false })
    expect(w._zCSeries).toBe(w.cSeries)
    expect(w._zCSeries).toBeTruthy()
  })
})
