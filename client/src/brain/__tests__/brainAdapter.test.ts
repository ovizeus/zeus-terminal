import { describe, it, expect, beforeEach } from 'vitest'
import { axesFromPayload, gatesFrom, satsFrom, buildRawFromZeusState, _resetAdapterForTest, shortSym } from '../brainAdapter'
import { BM, BRAIN } from '../../core/config'
import { useBrainStore } from '../../stores/brainStore'

const w = window as any

describe('adaptorul citeste valorile reale', () => {
  beforeEach(() => { _resetAdapterForTest(); delete w.__zeusBrainAxes; w.S = { symbol: 'BTCUSDT' }; delete w.MSCAN })

  it('axele, in ordinea spec, din pachetul trimis de creier', () => {
    const p = { trend: 0.8, delta: 0.1, flow: 0.6, oi: null, volume: 0.3, funding: 0.2, volatility: 0.4, imbalance: 0.5, momentum: 0.7, sentiment: 0.9, structure: 0.66, liquidity: null, __ts: 1000 }
    expect(axesFromPayload(p, 2000)).toEqual([0.8, 0.1, 0.6, null, 0.3, 0.2, 0.4, 0.5, 0.7, 0.9, 0.66, null])
  })
  it('⛔ un pachet vechi (peste 60 s) sau lipsa = toate null, nu valorile vechi', () => {
    expect(axesFromPayload({ trend: 0.8, __ts: 0 }, 61_000)).toEqual(new Array(12).fill(null))
    expect(axesFromPayload(null, 1)).toEqual(new Array(12).fill(null))
  })
  it('⛔ portile: spread e NECUNOSCUTA chiar daca motorul zice true', () => {
    const g = gatesFrom({ risk: true, spread: true, cooldown: false, news: true, session: false, noOpposite: true, regime: true })
    expect(g.failing).toEqual([2, 4])
    expect(g.unknown).toEqual([1])
  })
  it('fara cache de porti: toate necunoscute, niciuna picata', () => {
    expect(gatesFrom(undefined)).toEqual({ failing: [], unknown: [0, 1, 2, 3, 4, 5, 6] })
  })
  it('satelitii: primii 3 dupa scor, fara moneda principala, ca cercuri (fara axe)', () => {
    const s = satsFrom([{ sym: 'BTCUSDT', score: 99, dir: 'bull' }, { sym: 'SOLUSDT', score: 88, dir: 'bull' }, { sym: 'ETHUSDT', score: 81, dir: 'bear' },
      { sym: 'XRPUSDT', score: 50, dir: 'neutral' }, { sym: 'DOGEUSDT', score: 20, dir: 'bull' }], 'BTCUSDT')
    expect(s.map((x) => x.symbol)).toEqual(['SOL', 'ETH', 'XRP'])
    expect(s.map((x) => x.mode)).toEqual(['LONG', 'SHORT', 'RANGE'])
    expect(s.every((x) => x.axes === null)).toBe(true)
    expect(shortSym('ethusdt')).toBe('ETH')
  })
  it('contractul complet: conf si prag reale (confMin), ML si atentia lipsa = null', () => {
    ;(BM as any).confluenceScore = 61; (BM as any).confMin = 65
    ;(BRAIN as any)._safetyCache = { risk: true, spread: true, cooldown: true, news: true, session: true, noOpposite: true, regime: false }
    ;(BRAIN as any).regime = 'trend'
    w.__zeusBrainAxes = { trend: 0.5, bullCount: 4, bearCount: 1, __ts: Date.now() }
    const r = buildRawFromZeusState(Date.now())
    expect(r.conf).toBe(61); expect(r.thr).toBe(65)
    expect(r.gatesFailing).toEqual([6]); expect(r.gatesUnknown).toEqual([1])
    expect(r.ml).toBeNull(); expect(r.att).toBeNull()
    expect(r.mode).toBe('LONG'); expect(r.main).toBe('BTC')
    expect(r.rt[0]).toBe(0.5); expect(r.rt[1]).toBeNull()
  })
  it('⛔ pragul nu e niciodata inventat (fara confMin → null)', () => {
    const prev = (BM as any).confMin
    ;(BM as any).confMin = undefined
    expect(buildRawFromZeusState(Date.now()).thr).toBeNull()
    ;(BM as any).confMin = prev
  })
  it('SIGNAL CONFIRMED: aprins 2,2 s la intrarea creierului in starea ready', () => {
    useBrainStore.getState().setEngineState('scanning' as any)
    buildRawFromZeusState(10_000)
    useBrainStore.getState().setEngineState('ready' as any)
    expect(buildRawFromZeusState(20_000).signalActive).toBe(true)
    expect(buildRawFromZeusState(22_100).signalActive).toBe(true)
    expect(buildRawFromZeusState(22_300).signalActive).toBe(false)
    useBrainStore.getState().setEngineState('scanning' as any)
  })
})
