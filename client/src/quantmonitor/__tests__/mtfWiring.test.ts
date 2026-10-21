// [2026-10-21 b295] Cablajul: ARIA scrie stiva reala, scorul si increderea;
// iar eticheta de structura nu mai minte cand nu are date.
import { describe, it, expect, beforeEach } from 'vitest'
import { calcARIA } from '../engines/aria'
import { renderFrame } from '../render/frame'
import type { Bar } from '../engines/mtf'

const w = window as any
const M5 = 300000

function bars(n: number, stepMs: number, priceAt: (i: number) => number): Bar[] {
  const base = Math.floor(1700000000000 / stepMs) * stepMs
  return Array.from({ length: n }, (_, i) => {
    const c = priceAt(i)
    return { o: c, h: c, l: c, c, v: 1, t: base + i * stepMs }
  })
}

/** Stare minima ca `calcARIA` sa treaca de ieşirea devreme si sa prinda un pattern. */
function baseState(symbol = 'BTCUSDT') {
  const kl = Array.from({ length: 30 }, (_, i) => ({ o: 100, h: 100.5, l: 99.5, c: 100, v: 10, t: i }))
  return {
    symbol,
    price: 100,
    klines: kl,
    _qmBuf: Array.from({ length: 30 }, () => 100),
    _qmAriaPatterns: [],
  }
}

describe('ARIA scrie stiva MTF reala', () => {
  beforeEach(() => { w.S = baseState() })

  it('scrie toate 6 randurile din klines, inclusiv 1D', () => {
    w.S._qmMtfKlines = {
      symbol: 'BTCUSDT',
      m5: bars(600, M5, i => 100 + i),
      h1: bars(300, 3600000, i => 100 + i),
      d1: bars(60, 86400000, i => 100 + i),
    }
    calcARIA()
    expect(w.S._qmAriaMTF).toEqual({ '5m': 1, '15m': 1, '30m': 1, '1h': 1, '4h': 1, '1D': 1 })
    expect(w.S._qmAriaMTF['1D']).not.toBe(0)   // nu mai e hardcodat
  })

  it('scrie scorul de aliniere si detaliul — amandoua erau fara scriitor', () => {
    w.S._qmMtfKlines = {
      symbol: 'BTCUSDT',
      m5: bars(600, M5, i => 100 + i),
      h1: bars(300, 3600000, i => 500 - i),
      d1: bars(60, 86400000, i => 100 + i),
    }
    calcARIA()
    // 4 bull (5m,15m,30m,1D) vs 2 bear (1h,4h) -> |4-2|/6 = 33
    expect(w.S._qmMtfAlignScore).toBe(33)
    expect(w.S._qmMtfAlignDetailed).toEqual({ '15m': 1, '1h': -1, '4h': -1 })
  })

  it('NU mai calculeaza stiva din tamponul de 500 ms', () => {
    // Tampon clar crescator, dar NICIO sursa de klines: randurile trebuie sa
    // ramana necunoscute. Varianta veche ar fi raportat bull peste tot.
    w.S._qmBuf = Array.from({ length: 200 }, (_, i) => 100 + i)
    delete w.S._qmMtfKlines
    calcARIA()
    expect(Object.values(w.S._qmAriaMTF)).toEqual([0, 0, 0, 0, 0, 0])
    expect(w.S._qmMtfAlignScore).toBe(0)
    expect(w.S._qmAriaWatch).toBe('WATCH')
  })

  it('ignora klines-urile altui simbol la comutare', () => {
    w.S.symbol = 'ETHUSDT'
    w.S._qmMtfKlines = { symbol: 'BTCUSDT', m5: bars(600, M5, i => 100 + i) }
    calcARIA()
    expect(w.S._qmAriaMTF['5m']).toBe(0)
  })

  it('calculeaza stiva chiar si inainte sa fie klines de chart (ieşire devreme)', () => {
    w.S.klines = []
    w.S._qmBuf = []
    w.S._qmMtfKlines = { symbol: 'BTCUSDT', m5: bars(600, M5, i => 100 + i) }
    calcARIA()
    expect(w.S._qmAriaMTF['5m']).toBe(1)
  })
})

describe('increderea ARIA nu mai e constanta 48%', () => {
  beforeEach(() => { w.S = baseState() })

  /** Fabrica un Liquidity Sweep pe klines, ca sa existe un pattern cu `conf`. */
  function sweepKlines() {
    const kl = Array.from({ length: 30 }, (_, i) => ({ o: 100, h: 101, l: 99, c: 100, v: 10, t: i }))
    kl[kl.length - 1] = { o: 100, h: 101.5, l: 99, c: 100, v: 10, t: 30 }  // depaseste maximul, inchide sub
    return kl
  }

  it('da o incredere MARE cand toate timeframe-urile sunt de acord', () => {
    w.S.klines = sweepKlines()
    w.S._qmMtfKlines = {
      symbol: 'BTCUSDT',
      m5: bars(600, M5, i => 100 + i),
      h1: bars(300, 3600000, i => 100 + i),
      d1: bars(60, 86400000, i => 100 + i),
    }
    calcARIA()
    const pat = w.S._qmAriaCurrentPat
    expect(pat).toBeTruthy()
    expect(pat.conf).toBe(95)      // scor 100 -> 35 + 60
    expect(pat.conf).not.toBe(48)
  })

  it('da increderea MINIMA cand nu exista aliniere', () => {
    w.S.klines = sweepKlines()
    w.S._qmMtfKlines = {
      symbol: 'BTCUSDT',
      m5: bars(600, M5, i => 100 + i),      // 5m,15m,30m bull
      h1: bars(300, 3600000, i => 500 - i), // 1h,4h bear
      d1: bars(60, 86400000, i => 200 - i), // 1D bear
    }
    calcARIA()
    expect(w.S._qmMtfAlignScore).toBe(0)
    expect(w.S._qmAriaCurrentPat.conf).toBe(35)
  })

  it('increderea VARIAZA intre doua stari de piata diferite', () => {
    // Inima bug-ului: inainte ieşea 48 orice se intampla.
    const confFor = (h1Dir: number) => {
      w.S = baseState()
      w.S.klines = sweepKlines()
      w.S._qmMtfKlines = {
        symbol: 'BTCUSDT',
        m5: bars(600, M5, i => 100 + i),
        h1: bars(300, 3600000, i => 100 + h1Dir * i),
        d1: bars(60, 86400000, i => 100 + i),
      }
      calcARIA()
      return w.S._qmAriaCurrentPat.conf
    }
    const aligned = confFor(1)
    const split = confFor(-1)
    expect(aligned).not.toBe(split)
    expect(aligned).toBeGreaterThan(split)
  })
})

describe('eticheta STRUCTURE nu mai raporteaza BEAR pe lipsa de date', () => {
  beforeEach(() => { w.S = baseState() })

  function structureOf(): string {
    const html = renderFrame()
    const m = html.match(/STRUCTURE\s*<\/span>\s*<span class="w">([^<]+)<\/span>/)
    return m ? m[1].trim() : '(negasit)'
  }

  it('spune NO DATA cand niciun timeframe nu are date', () => {
    // Regresia exacta: cu `_qmMtfAlignDetailed` gol, `u === 0` trecea prin
    // ramura `u === 0 -> 'ALIGNED BEAR'` si panoul raporta o structura
    // ferm bearish pe absenţa totala de informaţie.
    w.S._qmMtfAlignDetailed = {}
    expect(structureOf()).toBe('NO DATA')
    w.S._qmMtfAlignDetailed = { '15m': 0, '1h': 0, '4h': 0 }
    expect(structureOf()).toBe('NO DATA')
  })

  it('spune ALIGNED BEAR doar cand timeframe-urile sunt chiar bearish', () => {
    w.S._qmMtfAlignDetailed = { '15m': -1, '1h': -1, '4h': -1 }
    expect(structureOf()).toBe('ALIGNED BEAR')
  })

  it('spune ALIGNED BULL pe acord deplin', () => {
    w.S._qmMtfAlignDetailed = { '15m': 1, '1h': 1, '4h': 1 }
    expect(structureOf()).toBe('ALIGNED BULL')
  })

  it('numara doar randurile cunoscute pe majoritate', () => {
    w.S._qmMtfAlignDetailed = { '15m': 1, '1h': 1, '4h': -1 }
    expect(structureOf()).toBe('MOSTLY BULL')
    w.S._qmMtfAlignDetailed = { '15m': -1, '1h': -1, '4h': 1 }
    expect(structureOf()).toBe('MOSTLY BEAR')
    // Doua randuri necunoscute nu trebuie sa impinga verdictul spre bear.
    w.S._qmMtfAlignDetailed = { '15m': 1, '1h': 0, '4h': 0 }
    expect(structureOf()).toBe('ALIGNED BULL')
  })
})
