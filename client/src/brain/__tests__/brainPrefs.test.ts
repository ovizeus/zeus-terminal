import { describe, it, expect, beforeEach } from 'vitest'
import { loadPref, savePref, satsOf, radarCoins, DEFAULT_COINS } from '../brainPrefs'
import { satsFrom } from '../brainAdapter'
import { LS_KEY } from '../brainStrings'

describe('colturi FIXE: BTC stanga sus, ETH dreapta sus, SOL dreapta jos (cerut 16 nov)', () => {
  beforeEach(() => { localStorage.clear() })

  it('implicit BTC, ETH, SOL in ordinea colturilor', () => {
    expect(loadPref().coins).toEqual(DEFAULT_COINS)
    expect(DEFAULT_COINS).toEqual(['BTCUSDT', 'ETHUSDT', 'SOLUSDT'])
  })

  it('oricare e principala, toate trei raman pe locul lor; principala e doar marcata', () => {
    loadPref()
    for (const main of ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'DOGEUSDT']) {
      const s = satsFrom({}, main, satsOf(main))
      expect(s.map((x) => [x.symbol, x.slot])).toEqual([['BTC', 0], ['ETH', 1], ['SOL', 2]])
      expect(s.filter((x) => x.isMain).map((x) => x.full)).toEqual(DEFAULT_COINS.includes(main) ? [main] : [])
    }
  })

  it('monedele radarului: principala + cele trei, fara dubluri', () => {
    loadPref()
    expect(radarCoins('SOLUSDT')).toEqual(['SOLUSDT', 'BTCUSDT', 'ETHUSDT'])
    expect(radarCoins('DOGEUSDT')).toEqual(['DOGEUSDT', 'BTCUSDT', 'ETHUSDT', 'SOLUSDT'])
  })

  it('migreaza ordinea veche (sats SOL, ETH / coins BTC, SOL, ETH) la colturile cerute', () => {
    localStorage.setItem(LS_KEY, JSON.stringify({ focus: true, sats: ['SOLUSDT', 'ETHUSDT'] }))
    expect(loadPref().coins).toEqual(DEFAULT_COINS)
    localStorage.setItem(LS_KEY, JSON.stringify({ focus: true, coins: ['BTCUSDT', 'SOLUSDT', 'ETHUSDT'] }))
    expect(loadPref().coins).toEqual(DEFAULT_COINS)
  })

  it('maximum 3 monede (trei colturi)', () => {
    savePref({ focus: true, snd: false, coins: ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'XRPUSDT'] })
    expect(loadPref().coins).toEqual(DEFAULT_COINS)
  })
})
