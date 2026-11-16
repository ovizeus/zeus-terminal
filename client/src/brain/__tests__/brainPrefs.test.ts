import { describe, it, expect, beforeEach } from 'vitest'
import { loadPref, savePref, satsOf, radarCoins, DEFAULT_COINS } from '../brainPrefs'
import { LS_KEY } from '../brainStrings'

describe('lista radarului — atingerea unui satelit face schimb de colturi', () => {
  beforeEach(() => { localStorage.clear() })

  it('implicit BTC, SOL, ETH; cu BTC principala: SOL in coltul 0, ETH in coltul 1', () => {
    expect(loadPref().coins).toEqual(DEFAULT_COINS)
    expect(satsOf('BTCUSDT')).toEqual(['SOLUSDT', 'ETHUSDT'])
  })

  it('[bug 16 nov] atingi SOL: BTC NU dispare, ia coltul lui SOL', () => {
    loadPref()
    expect(satsOf('SOLUSDT')).toEqual(['BTCUSDT', 'ETHUSDT'])
    expect(satsOf('ETHUSDT')).toEqual(['BTCUSDT', 'SOLUSDT'])
    expect(radarCoins('SOLUSDT')).toEqual(['SOLUSDT', 'BTCUSDT', 'ETHUSDT'])
  })

  it('migreaza forma de ieri ({sats:[SOL,ETH]}) fara sa piarda BTC', () => {
    localStorage.setItem(LS_KEY, JSON.stringify({ focus: true, sats: ['SOLUSDT', 'ETHUSDT'] }))
    expect(loadPref().coins).toEqual(['BTCUSDT', 'SOLUSDT', 'ETHUSDT'])
  })

  it('maximum 3 sateliti; o principala din afara listei vede primele 3', () => {
    savePref({ focus: true, snd: false, coins: ['BTCUSDT', 'SOLUSDT', 'ETHUSDT', 'XRPUSDT', 'BNBUSDT'] })
    expect(loadPref().coins.length).toBe(4)
    expect(satsOf('DOGEUSDT')).toEqual(['BTCUSDT', 'SOLUSDT', 'ETHUSDT'])
    expect(satsOf('ETHUSDT')).toEqual(['BTCUSDT', 'SOLUSDT', 'XRPUSDT'])
  })
})
