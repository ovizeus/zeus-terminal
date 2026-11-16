import { describe, it, expect } from 'vitest'
import { buildJournal, rowEnv, pnlPctOf, brainCaptured, type ServerRow } from '../brainJournal'
import type { TradeRecord } from '../brainStorage'

const rec = (o: any): TradeRecord => ({
  uid: '1', isDemo: true, symbol: 'BTC', side: 'LONG', entryTime: 1000, exitTime: 2000,
  entryPrice: 100, exitPrice: 102, result: 'TP', pnlPct: 2, pnlAbs: 20, confAtEntry: 70, thrAtEntry: 65, profile: 'FAST',
  pre: 'ALERT', entryShape: new Array(12).fill(0.5), hasSnapshot: true, hasFrames: true, status: 'closed',
  env: 'DEMO', radarCoin: true, radarCoins: ['BTCUSDT', 'SOLUSDT', 'ETHUSDT'], onMain: true, ...o, id: String(o.id), key: '1:' + o.id,
})
const row = (o: Partial<ServerRow>): ServerRow => ({ seq: 1, symbol: 'BTCUSDT', side: 'LONG', mode: 'demo', env: 'DEMO', entryPrice: 100, exitPrice: 102, size: 1000, pnl: 20, exitReason: 'HIT_TP', openTs: 1000, closeTs: 2000, ...o })
const COINS = ['BTCUSDT', 'SOLUSDT', 'ETHUSDT']

describe('jurnalul radarului', () => {
  it('⛔ doar monedele radarului: DOGE nu intra', () => {
    const j = buildJournal({ env: 'DEMO', coins: COINS, recs: [], open: [{ id: 9, sym: 'DOGEUSDT', side: 'LONG', entry: 0.05912, size: 100, pnl: 1, openTs: 5 }],
      rows: [row({ seq: 2, symbol: 'DOGEUSDT' }), row({ seq: 3, symbol: 'SOLUSDT' })] })
    expect(j.map((r) => r.symbol)).toEqual(['SOL'])
  })
  it('⛔ nu amesteca mediile: doar mediul activ', () => {
    const rows = [row({ seq: 1, env: 'DEMO' }), row({ seq: 2, env: 'TESTNET', mode: 'live' }), row({ seq: 3, env: 'REAL', mode: 'live' })]
    expect(buildJournal({ env: 'TESTNET', coins: COINS, recs: [], open: [], rows }).map((r) => r.seq)).toEqual(['2'])
    expect(buildJournal({ env: 'REAL', coins: COINS, recs: [], open: [], rows }).map((r) => r.env)).toEqual(['REAL'])
    expect(buildJournal({ env: 'DEMO', coins: COINS, recs: [], open: [], rows }).map((r) => r.seq)).toEqual(['1'])
  })
  it('deschise sus, cu PnL viu (pnl / size); inchise dupa, cele mai noi primele', () => {
    const j = buildJournal({ env: 'DEMO', coins: COINS, recs: [], open: [{ id: 50, sym: 'BTCUSDT', side: 'LONG', entry: 100, size: 1000, pnl: 31, openTs: 9000 }],
      rows: [row({ seq: 1, closeTs: 2000 }), row({ seq: 2, closeTs: 3000 })] })
    expect(j.map((r) => [r.seq, r.status])).toEqual([['50', 'open'], ['2', 'closed'], ['1', 'closed']])
    expect(j[0].pnlPct).toBe(3.1)
  })
  it('o pozitie deschisa nevazuta la intrare e „adoptata", fara date inventate', () => {
    const j = buildJournal({ env: 'DEMO', coins: COINS, recs: [], open: [{ id: 51, sym: 'SOLUSDT', side: 'SHORT', entry: 70, size: 500, pnl: -2, openTs: 1 }], rows: [] })
    expect(j[0]).toMatchObject({ origin: 'adopted', reason: 'app closed at entry', rec: null })
  })
  it('istoricul fara date de creier: „added from history"; cu inregistrare: datele creierului', () => {
    const j = buildJournal({ env: 'DEMO', coins: COINS, recs: [rec({ id: 1 })], open: [], rows: [row({ seq: 1 }), row({ seq: 2, symbol: 'ETHUSDT' })] })
    expect(j.find((r) => r.seq === '1')).toMatchObject({ origin: 'brain' })
    expect(j.find((r) => r.seq === '2')).toMatchObject({ origin: 'history', reason: 'added from history' })
  })
  it('⛔ apartenenta se decide la intrare: SOL scos din sateliti → tranzactia veche pe SOL ramane', () => {
    const j = buildJournal({ env: 'DEMO', coins: ['BTCUSDT', 'ETHUSDT'], recs: [rec({ id: 7, symbol: 'SOL' })], open: [], rows: [row({ seq: 7, symbol: 'SOLUSDT' }), row({ seq: 8, symbol: 'SOLUSDT' })] })
    expect(j.map((r) => r.seq)).toEqual(['7'])     // 7 prinsa pe radar; 8 doar istoric, moneda nu mai e in lista
  })
  it('rezultatul si PnL-ul vin din randul REAL; ENTRY_FAILED nu intra', () => {
    const j = buildJournal({ env: 'DEMO', coins: COINS, recs: [], open: [], rows: [row({ seq: 1, exitReason: 'HIT_SL', pnl: -12 }), row({ seq: 2, exitReason: 'ENTRY_FAILED_ERROR' }), row({ seq: 3, exitReason: 'DSL_PL', pnl: 4 })] })
    expect(j.map((r) => [r.seq, r.result, r.pnlPct])).toEqual([['1', 'SL', -1.2], ['3', 'DSL', 0.4]])
  })
  it('mediul unui rand: env, apoi demo vechi = DEMO, live vechi fara env = necunoscut', () => {
    expect(rowEnv(row({ env: 'TESTNET' }))).toBe('TESTNET')
    expect(rowEnv(row({ env: null, mode: 'demo' }))).toBe('DEMO')
    expect(rowEnv(row({ env: null, mode: 'live' }))).toBeNull()
    expect(pnlPctOf(24, 1000)).toBe(2.4)
    expect(pnlPctOf(24, 0)).toBeNull()
  })
  it('psych / deja vu: doar tranzactiile cu date de creier', () => {
    const j = buildJournal({ env: 'DEMO', coins: COINS, recs: [rec({ id: 1 })], open: [], rows: [row({ seq: 1 }), row({ seq: 2 })] })
    expect(brainCaptured(j).map((t) => t.id)).toEqual(['1'])
  })
})
