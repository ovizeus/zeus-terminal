// Proprietarul culorii lumanarilor.
//
// Gasit la auditul cerut de operator: OPT indicatori recoloreaza lumanarile si
// fiecare scrie necondiționat peste celalalt (METIS, APOLLO, MENTOR, KRONOS,
// MORPHEUS, HARMONIA, TERMINATOR, PULSAR). Zero garzi. Castiga ultimul din
// dispecer, tacut — iar HARMONIA, care coloreaza FIECARE bara in curcubeu, le
// masca pe toate celelalte complet.

import { describe, it, expect } from 'vitest'
import {
  CANDLE_TINT_IDS, isCandleTinter, canTintCandles, nextTintOwner, tintRivals,
} from '../candleTint'

describe('cine are voie sa coloreze', () => {
  it('fara proprietar, primul care cere primeste', () => {
    expect(canTintCandles('metis', null, { metis: true })).toBe(true)
    expect(canTintCandles('metis', undefined, { metis: true })).toBe(true)
  })

  it('proprietarul se poate recolora oricat', () => {
    expect(canTintCandles('terminator', 'terminator', { terminator: true })).toBe(true)
  })

  it('UN AL DOILEA aprins NU mai are voie — asta e tot bug-ul', () => {
    // HARMONIA aprinsa peste TERMINATOR ii masca toate culorile.
    expect(canTintCandles('harmonia', 'terminator', { terminator: true, harmonia: true })).toBe(false)
  })

  it('cand proprietarul e stins, locul se elibereaza', () => {
    expect(canTintCandles('harmonia', 'terminator', { terminator: false, harmonia: true })).toBe(true)
    expect(canTintCandles('harmonia', 'terminator', { harmonia: true })).toBe(true)
  })

  it('fara id nu se coloreaza nimic', () => {
    expect(canTintCandles('', null, {})).toBe(false)
  })

  it('stare lipsa nu arunca', () => {
    expect(canTintCandles('metis', 'terminator', null)).toBe(true)
    expect(canTintCandles('metis', 'terminator', undefined)).toBe(true)
  })
})

describe('cine devine proprietar', () => {
  it('ultimul APRINS castiga — singura regula pe care operatorul o poate prezice', () => {
    expect(nextTintOwner('terminator', 'pulsar', true)).toBe('pulsar')
  })

  it('stingerea elibereaza locul doar daca chiar el il tinea', () => {
    expect(nextTintOwner('pulsar', 'pulsar', false)).toBeNull()
    expect(nextTintOwner('pulsar', 'metis', false)).toBe('pulsar')
  })

  it('un indicator care NU coloreaza nu schimba proprietarul', () => {
    expect(nextTintOwner('pulsar', 'rsi14', true)).toBe('pulsar')
    expect(nextTintOwner('pulsar', 'rsi14', false)).toBe('pulsar')
    expect(nextTintOwner(null, 'macd', true)).toBeNull()
  })
})

describe('lista celor care coloreaza', () => {
  it('ii contine pe toti cei opt gasiti la audit', () => {
    for (const id of ['metis', 'apollo', 'mentor', 'kronos', 'morpheus', 'harmonia', 'terminator', 'pulsar']) {
      expect(isCandleTinter(id)).toBe(true)
    }
    expect(CANDLE_TINT_IDS).toHaveLength(8)
  })

  it('un indicator obisnuit nu e in lista', () => {
    expect(isCandleTinter('rsi14')).toBe(false)
    expect(isCandleTinter('arachne')).toBe(false)
  })
})

describe('cine a pierdut culoarea', () => {
  it('ii numeste pe ceilalti aprinsi, ca sa nu fie o surpriza tacuta', () => {
    const r = tintRivals('pulsar', { pulsar: true, harmonia: true, metis: true, rsi14: true })
    expect(r.sort()).toEqual(['harmonia', 'metis'])
  })

  it('niciun rival cand e singurul aprins', () => {
    expect(tintRivals('pulsar', { pulsar: true, rsi14: true })).toEqual([])
  })

  it('stare lipsa nu arunca', () => {
    expect(tintRivals('pulsar', null)).toEqual([])
  })
})
