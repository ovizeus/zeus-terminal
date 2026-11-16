import { describe, it, expect } from 'vitest'
import { simil, entryShapeOf, emaStep, modeOf, progressOf, resultOf, closeMsgOf, DeadDetector, Derived, type Raw } from '../brainDerived'

const raw = (o: Partial<Raw> = {}): Raw => ({
  rt: new Array(12).fill(0.5), tf: new Array(12).fill(0.5), sl: new Array(12).fill(0.5), att: null, ml: null,
  gatesFailing: [], gatesUnknown: [1], conf: 50, thr: 65, mode: 'LONG', modeLabel: 'LONG MODE',
  signalActive: false, dead: false, position: null, closeMsg: '', main: 'BTC', sats: [], ...o,
})

describe('functii pure', () => {
  it('asemanarea formelor (spec 7.4)', () => {
    expect(simil([0.5, 0.5], [0.5, 0.5])).toBe(1)
    expect(simil([0, 0], [1, 1])).toBe(0)
    expect(simil([0.5, 0.5], [0.6, 0.6])).toBeCloseTo(0.78, 2)
  })
  it('forma la intrare: lipsurile devin 0,1', () => {
    expect(entryShapeOf([0.42, null, 1.4])).toEqual([0.42, 0.1, 1])
  })
  it('EMA: pornește din prima valoare reala, o axa fara valoare ramane null', () => {
    const a = emaStep(new Array(12).fill(null), [0.8, null, ...new Array(10).fill(0.5)], 0.025, 1 / 60)
    expect(a[0]).toBe(0.8); expect(a[1]).toBeNull()
    const b = emaStep(a, [0, null, ...new Array(10).fill(0.5)], 0.025, 1 / 60)
    expect(b[0]).toBeCloseTo(0.78, 3)
  })
  it('modul: regimul real alege SQUEEZE / RANGE, altfel directia', () => {
    expect(modeOf(5, 2, 'trend')).toEqual({ mode: 'LONG', label: 'LONG MODE' })
    expect(modeOf(1, 4, 'breakout')).toEqual({ mode: 'SHORT', label: 'SHORT MODE' })
    expect(modeOf(5, 2, 'squeeze').mode).toBe('SQUEEZE')
    expect(modeOf(5, 2, 'range').mode).toBe('RANGE')
    expect(modeOf(5, 2, 'unknown').mode).toBe('RANGE')
    expect(modeOf(5, 2, undefined).mode).toBe('RANGE')
  })
  it('progresul pozitiei: +1 la TP, −1 la SL, 2R fara TP, null fara SL', () => {
    expect(progressOf('LONG', 100, 110, 95, 110).progress).toBe(1)
    expect(progressOf('LONG', 100, 95, 95, 110).progress).toBe(-1)
    expect(progressOf('SHORT', 100, 95, 105, 90).progress).toBeCloseTo(0.5)
    expect(progressOf('LONG', 100, 105, 95, 0)).toEqual({ progress: 0.5, noTp: true })   // 2R = 110
    expect(progressOf('LONG', 100, 105, 0, 110).progress).toBeNull()
  })
  it('⛔ rezultatul vine doar din motivul REAL; necunoscut = OTHER', () => {
    expect(resultOf('HIT_TP')).toBe('TP'); expect(resultOf('HIT_SL')).toBe('SL')
    expect(resultOf('DSL_PL')).toBe('DSL'); expect(resultOf('DSL_ML_CUT')).toBe('DSL')
    expect(resultOf('MANUAL_CLIENT')).toBe('MANUAL'); expect(resultOf('Close All Manual')).toBe('MANUAL')
    for (const r of ['RESET', 'RECON_PHANTOM', 'EMERGENCY_CLOSED', '', null, 'SMART_CUT']) expect(resultOf(r)).toBe('OTHER')
  })
  it('mesajul de inchidere', () => {
    expect(closeMsgOf('TP', 2.4)).toBe('TP HIT +2.40%')
    expect(closeMsgOf('MANUAL', -1.2)).toBe('CLOSED -1.20%')
    expect(closeMsgOf('DSL', 0.5)).toBe('DSL CLOSED +0.50%')
  })
})

describe('somnul (doar afisaj)', () => {
  it('doarme dupa 60 s neintrerupte; se trezeste imediat', () => {
    const d = new DeadDetector()
    expect(d.update(0, false, true, 0.5, 0.5, 50, 65)).toBe(false)
    expect(d.update(59_000, false, true, 0.5, 0.5, 50, 65)).toBe(false)
    expect(d.update(60_000, false, true, 0.5, 0.5, 50, 65)).toBe(true)
    expect(d.update(60_500, true, true, 0.5, 0.5, 50, 65)).toBe(false)     // pozitie deschisa
  })
  it('piata linistita fara date = nu doarme (nu ghicim)', () => {
    const d = new DeadDetector()
    d.update(0, false, false, null, 0.1, 10, 65)
    expect(d.update(90_000, false, false, null, 0.1, 10, 65)).toBe(false)
  })
})

describe('dispozitia (spec 5)', () => {
  it('ordinea de prioritate', () => {
    const D = new Derived()
    expect(D.build(raw({ signalActive: true })).mood[0]).toBe('ATTACK')
    expect(D.build(raw({ position: { symbol: 'BTC', side: 'LONG', pnlPct: 1, progress: 0.5, noTp: false } })).mood[0]).toBe('CONFIDENT')
    expect(D.build(raw({ position: { symbol: 'BTC', side: 'LONG', pnlPct: -1, progress: -0.7, noTp: false } })).mood[0]).toBe('FEARFUL')
    expect(D.build(raw({ dead: true })).mood[0]).toBe('SLEEPING')
    expect(D.build(raw({ conf: 60, gatesFailing: [4] })).mood[0]).toBe('HESITANT')
    expect(D.build(raw({ conf: 56 })).mood[0]).toBe('ALERT')
    expect(D.build(raw({ conf: 20 })).mood[0]).toBe('CALM')
  })
  it('⛔ o poarta NECUNOSCUTA nu face creierul sa ezite', () => {
    const D = new Derived()
    const st = D.build(raw({ conf: 64, gatesFailing: [], gatesUnknown: [1] }))
    expect(st.hes).toBe(false)
    expect(st.fails).toEqual([]); expect(st.unk).toEqual([1])
  })
  it('fara ML (null) nu exista CONFUSED', () => {
    expect(new Derived().build(raw({ ml: null, conf: 10 })).mood[0]).toBe('CALM')
  })
  it('consensul: doar satelitii cu aceeasi directie, nu RANGE', () => {
    const st = new Derived().build(raw({ sats: [
      { symbol: 'SOL', full: 'SOLUSDT', axes: null, score: 88, mode: 'LONG' },
      { symbol: 'ETH', full: 'ETHUSDT', axes: null, score: 80, mode: 'RANGE' },
      { symbol: 'BNB', full: 'BNBUSDT', axes: null, score: 70, mode: 'SHORT' },
    ] }))
    expect(st.cons).toBe(1)
  })
})
