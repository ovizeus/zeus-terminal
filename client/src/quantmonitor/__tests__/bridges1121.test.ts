import { describe, test, expect, beforeEach, vi } from 'vitest'
import { _syncQmVars } from '../index'
import { BM } from '../../core/config'
import { QM } from '../state'
import { detectWhales } from '../engines/intel'

// [2026-11-21] Audit (R-C-15): campuri citite de monitor, fara scriitor, aratau implicite inventate:
// AI CONF 50%, SIGNAL 0%, regim „RANGING", risc NORMAL, ×1.0, lichidari 24h $0.
const w = window as any

describe('Quant Monitor — puntile din 21 nov', () => {
  beforeEach(() => {
    w.S = Object.assign(w.S || {}, { symbol: 'BTCUSDT' })
  })

  test('regimul si faza vin din RegimeEngine / PhaseFilter, nu din implicite', () => {
    ;(BM as any).regimeEngine = { regime: 'trend', confidence: 72, trapRisk: 15 }
    ;(BM as any).phaseFilter = { phase: 'expansion', riskMode: 'reduced', sizeMultiplier: 0.5 }
    _syncQmVars()
    expect(w.S._qmReRegime).toBe('TREND')
    expect(w.S._qmReConf).toBe(72)
    expect(w.S._qmReTrap).toBe(15)
    expect(w.S._qmPfPhase).toBe('EXPANSION')
    expect(w.S._qmPfRisk).toBe('REDUCED')
    expect(w.S._qmPfSize).toBe(0.5)
  })

  test('AI CONF = confluenta reala; SLOPE si DIFF din lumanari', () => {
    ;(BM as any).confluenceScore = 83
    w.S.klines = Array.from({ length: 60 }, (_, i) => ({ time: i, open: 100 + i, high: 101 + i, low: 99 + i, close: 100 + i, volume: 1 }))
    _syncQmVars()
    expect(w.S._qmConf).toBe(83)
    expect(w.S._qmSlope).toBeGreaterThan(0)          // pret in crestere → panta pozitiva
    expect(w.S._qmMom).toBeCloseTo(1 / 158, 6)       // 159 vs 158
  })

  test('MAGNET / MAG BIAS din magnetii reali: cel mai apropiat nivel si partea lui', () => {
    w.S.price = 100; w.S._qmPrice = 100; w.S.magnetBias = 'neut'
    w.S.magnets = { above: [{ price: 103 }, { price: 101.5 }], below: [{ price: 97 }] }
    _syncQmVars()
    expect(w.S._qmLiqMagnet).toBe(101.5)
    expect(w.S._qmLiqSide).toBe('ABOVE')
    expect(w.S._qmMagnetUpPct).toBeCloseTo(1.5, 6)
    expect(w.S._qmMagnetDnPct).toBeCloseTo(-3, 6)
    expect(w.S._qmMagBias).toBe('ABOVE')
  })

  test('pereti din carte: nivelurile >= 3,5× media, cele mai mari primele', () => {
    w.S.bids = [{ p: 99, q: 1 }, { p: 98, q: 1 }, { p: 97, q: 1 }, { p: 96, q: 1 }, { p: 95, q: 1 }, { p: 94, q: 1 }, { p: 93, q: 1 }, { p: 92, q: 1 }, { p: 91, q: 1 }, { p: 90, q: 40 }]
    w.S.asks = [{ p: 101, q: 1 }, { p: 102, q: 1 }]
    _syncQmVars()
    expect(w.S._qmBidWalls.map((x: any) => x.p)).toEqual([90])
    expect(w.S._qmAskWalls).toEqual([])
  })

  test('TREND MATRIX: fara istoric destul = 0 (afisat „—"), nu „DN"', () => {
    w.S._qmPxRing = []
    _syncQmVars()
    expect(w.S._qmTrend15m).toBe(0)
    // cu 16 minute de pret in crestere → sus
    const now = Date.now()
    w.S._qmPxRing = Array.from({ length: 960 }, (_, i) => ({ t: now - (960 - i) * 1000, v: 90 + i * 0.01 }))
    w.S.price = 120; w.S._qmPrice = 120
    _syncQmVars()
    expect(w.S._qmTrend15m).toBe(1)
    expect(w.S._qmTrend1m).toBe(1)
  })

  test('SIGNAL ACCURACY LOG: BUY notat, verificat dupa 30 s (HIT cand pretul urca)', () => {
    vi.useFakeTimers(); vi.setSystemTime(1_800_000_000_000)
    try {
      w.S._qmTrapHist = []; w.S._qmLastAct = 'HOLD'; w.S.price = 100; w.S._qmPrice = 100
      ;(BM as any).confluenceScore = 90; (BM as any).confMin = 65
      w.S.signalData = { bullCount: 4, bearCount: 1, signals: [] }
      _syncQmVars()
      expect(w.S._qmAct).toBe('BUY')
      expect(w.S._qmTrapHist).toHaveLength(1)
      vi.setSystemTime(1_800_000_031_000); w.S.price = 101; w.S._qmPrice = 101
      _syncQmVars()
      expect(w.S._qmTrapHist[0]).toMatchObject({ checked: true, hit: true })
    } finally { vi.useRealTimers() }
  })

  test('Trap rate: capcana SHORT confirmata cand pretul scade in 30 s; fara verificari = „─"', () => {
    vi.useFakeTimers(); vi.setSystemTime(1_800_000_000_000)
    try {
      w.S._qmTrapSeen = []; w.S._qmMmtrapHist = []; w.S.price = 100; w.S._qmPrice = 100
      _syncQmVars()
      expect(w.S._qmTrapRateStr).toBe('─')
      w.S._qmMmtrapHist = [{ type: 'SHORT', pct: -0.05, time: Date.now() }]
      _syncQmVars()
      vi.setSystemTime(1_800_000_031_000); w.S.price = 99; w.S._qmPrice = 99
      _syncQmVars()
      expect(w.S._qmTrapRatePct).toBe(100)
      expect(w.S._qmTrapRateStr).toBe('100% (1/1)')
    } finally { vi.useRealTimers() }
  })

  test('24h LIQUIDATIONS: fara istoric = null („—"), nu $0', () => {
    w.S.symbol = 'NOHISTUSDT'
    _syncQmVars()
    expect(w.S._qmLiq24hTotal).toBeNull()
  })

  test('SESSION P&L urmareste pe hartie semnalele: BUY la 100, inchis la 102 = +2%, 1 castig', () => {
    const ses: any = (QM as any).session
    Object.assign(ses, { entries: [], pnl: 0, peak: 0, drawdown: 0, wins: 0, losses: 0, totalTrades: 0, _open: null })
    ;(BM as any).confluenceScore = 90; (BM as any).confMin = 65
    w.S.signalData = { bullCount: 4, bearCount: 1, signals: [] }; w.S.price = 100; w.S._qmPrice = 100
    _syncQmVars()
    expect(ses._open).toMatchObject({ side: 'BUY', entry: 100 })
    ;(BM as any).confluenceScore = 30; w.S.price = 102; w.S._qmPrice = 102
    _syncQmVars()
    expect(ses.totalTrades).toBe(1)
    expect(ses.wins).toBe(1)
    expect(ses.pnl).toBeCloseTo(2, 6)
    expect(ses.entries[0]).toMatchObject({ side: 'BUY', entry: 100, exit: 102 })
  })
})

describe('WHALE DETECTOR — prag in dolari pe orice moneda', () => {
  test('3 SOL ($450) nu e balena; 2.000 SOL ($300K) e', () => {
    w.S.bids = [{ p: 150, q: 3 }, { p: 149, q: 2000 }]; w.S.asks = [{ p: 151, q: 1 }]; w.S._qmWhales = []
    detectWhales()
    expect(w.S._qmWhales.map((x: any) => x.q)).toEqual([2000])
  })
})
