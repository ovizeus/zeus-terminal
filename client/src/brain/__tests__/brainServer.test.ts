import { describe, it, expect, afterEach } from 'vitest'
import { capToRec, framesToStates, entryState, serverAxes, _setServerAxesForTest, type ServerCapture, type ServerEntry, type ServerFrame } from '../brainServer'
import { buildJournal, brainCaptured } from '../brainJournal'
import { satsFrom } from '../brainAdapter'

// [2026-11-20] Radarul pe server: inregistrarile serverului ajung in jurnal ca inregistrari
// de creier (poza, replay, deja vu, sablon) — si pentru tranzactiile intrate cu telefonul inchis.
const shape = [0.6, 0.5, 0.7, 0.3, 0.6, 0.2, 0.4, 0.6, 0.7, 0.5, 0.6, 0.8]
const entry: ServerEntry = {
  seq: 1791754242012, symbol: 'BTCUSDT', side: 'SHORT', env: 'DEMO', entryTs: 1000, entryPrice: 63851.6, sl: 64500, tp: 58564, size: 817, lev: 5,
  entryShape: shape, rt: shape, conf: 80, thr: 65, profile: 'swing', regime: 'VOLATILE', radarRegime: 'panic', bull: 1, bear: 4,
  gatesFailing: [2], gatesUnknown: [1, 3, 5], radarCoins: ['BTCUSDT', 'ETHUSDT'], late: false, pre: 'HESITANT',
}
const cap: ServerCapture = { seq: entry.seq, symbol: 'BTCUSDT', env: 'DEMO', side: 'SHORT', entryTs: 1000, exitTs: 61000, status: 'closed', nFrames: 90, entry }

describe('brainServer — inregistrarile serverului in jurnal', () => {
  afterEach(() => _setServerAxesForTest('BTCUSDT', null))

  it('capToRec: inregistrare de creier completa, marcata „server"', () => {
    const r = capToRec(cap, '1')!
    expect(r).toMatchObject({ key: '1:s1791754242012', id: '1791754242012', symbol: 'BTC', side: 'SHORT', env: 'DEMO',
      confAtEntry: 80, thrAtEntry: 65, profile: 'SWING', pre: 'HESITANT', hasSnapshot: true, hasFrames: true, status: 'closed',
      radarCoin: true, source: 'server', noSnapReason: null })
    expect(r.meta).toMatchObject({ radarMode: 'SHORT MODE', regime: 'VOLATILE', gatesFailing: [2] })
    expect(r.entryShape).toEqual(shape)
  })

  it('pornita tarziu (fara forma de la intrare): fara poza, cu motivul; replay tot exista', () => {
    const r = capToRec({ ...cap, entry: { ...entry, entryShape: null, rt: null, late: true } }, '1')!
    expect(r.hasSnapshot).toBe(false)
    expect(r.noSnapReason).toBe('opened before the server radar was running')
    expect(r.hasFrames).toBe(true)
  })

  it('[bug 20 nov] rand din istoric + inregistrarea serverului = rand CU date de creier (nu „added from history")', () => {
    const rows = [{ seq: entry.seq, symbol: 'BTCUSDT', side: 'SHORT', mode: 'demo', env: 'DEMO', entryPrice: 63851.6, size: 817.3, pnl: 33.27, exitReason: 'DSL_PL', openTs: 1000, closeTs: 61000 }]
    const list = buildJournal({ rows, recs: [capToRec(cap, '1')!], open: [], env: 'DEMO', coins: ['BTCUSDT'] })
    expect(list[0].origin).toBe('brain')
    expect(list[0].rec?.source).toBe('server')
    const H = brainCaptured(list)
    expect(H).toHaveLength(1)                       // intra in psych / deja vu / sablon
    expect(H[0].pnlPct).toBe(4.07)
  })

  it('rand fara inregistrare: pastreaza decizia serverului (entryMeta) pentru fereastra de detalii', () => {
    const em = { conf: 100, finalConf: 63, regime: 'VOLATILE', tier: 'SMALL', gates: { failing: [], unknown: [1, 3, 5] }, trendBias: null, volatility: 'high' }
    const list = buildJournal({ rows: [{ seq: 5, symbol: 'BTCUSDT', side: 'SHORT', mode: 'demo', env: 'DEMO', size: 100, pnl: 1, exitReason: 'DSL_PL', openTs: 1, closeTs: 2, entryMeta: em }], recs: [], open: [], env: 'DEMO', coins: ['BTCUSDT'] })
    expect(list[0].origin).toBe('history')
    expect(list[0].entryMeta).toEqual(em)
  })

  it('framesToStates: cadrele serverului (1/s) devin stari de desenat; la intrare ATTACK, apoi pozitia', () => {
    const fr = (t: number, p?: ServerFrame['p']): ServerFrame => ({ t, rt: shape, b: 1, r: 4, rg: 'panic', c: 80, h: 65, f: [2], u: [1, 3, 5], p })
    const frames = [fr(0), fr(1000), fr(2000, { pct: 0, prog: 0, noTp: false }), fr(3000, { pct: 0.5, prog: 0.1, noTp: false }), fr(4000, { pct: 1, prog: 0.4, noTp: false }), fr(5000, { pct: 1, prog: 0.4, noTp: false })]
    const st = framesToStates(entry, frames)
    expect(st).toHaveLength(6)
    expect(st[0].mood[0]).toBe('HESITANT')            // conf 80 ≥ 65 − 8 si o poarta pica
    expect(st[2].mood[0]).toBe('ATTACK')
    expect(st[5].mood[0]).toBe('CONFIDENT')           // progres 0,4 > 0,35
    expect(st[5].pos).toMatchObject({ sym: 'BTC', dir: -1, pct: 1 })
    expect(st[5].n).toBe('SHORT MODE')
    expect(st[4].i).toBe(4)
  })

  it('entryState: starea de la intrare pentru poza', () => {
    const st = entryState(entry)!
    expect(st.rt).toEqual(shape)
    expect(st.pos).toMatchObject({ sym: 'BTC', dir: -1 })
    expect(entryState({ ...entry, rt: null, entryShape: null })).toBeNull()
  })

  it('axele live: proaspete se folosesc, altfel null; satelitii primesc forma lor', () => {
    expect(serverAxes('BTCUSDT')).toBeNull()
    _setServerAxesForTest('BTCUSDT', { t: Date.now(), rt: shape, bull: 1, bear: 4, regime: 'panic', score: 80 })
    expect(serverAxes('btcusdt')?.rt).toEqual(shape)
    const s = satsFrom({}, 'ETHUSDT', ['BTCUSDT', 'ETHUSDT'], (f) => (f === 'BTCUSDT' ? shape : null))
    expect(s[0].axes).toEqual(shape)
    expect(s[1].axes).toBeNull()
  })

  it('refacuta din istoric: marcata, cu lentila care spune de unde vine', () => {
    const r = capToRec({ ...cap, entry: { ...entry, reconstructed: true } }, '1')!
    expect(r.reconstructed).toBe(true)
    expect(r.meta?.lens).toContain('rebuilt')
    expect(r.hasSnapshot).toBe(true)
  })
})

