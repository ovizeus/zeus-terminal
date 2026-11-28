import { describe, it, expect } from 'vitest'
import { tfSeconds, mergeTick } from '../liveBar'

// [2026-11-28] „pretul la chart nu e live". Serverul (Hetzner) primeste ZERO cadre de la
// fstream.binance.com — masurat: conexiunea se deschide, 0 mesaje in 10 s. Deci `market.kline`
// nu vine niciodata, iar lumanarea de pe ecran ramane inghetata pana la refresh. Pretul
// (market.price, din puntea REST a serverului, la ~3 s) vine — il punem pe ultima lumanare.

describe('tfSeconds', () => {
  it('intervalele obisnuite', () => {
    expect(tfSeconds('1m')).toBe(60)
    expect(tfSeconds('15m')).toBe(900)
    expect(tfSeconds('4h')).toBe(14400)
    expect(tfSeconds('1d')).toBe(86400)
    expect(tfSeconds('1w')).toBe(604800)
  })
  it('lunar sau necunoscut → 0 (nu ghicim)', () => {
    expect(tfSeconds('1M')).toBe(0)
    expect(tfSeconds('abc')).toBe(0)
    expect(tfSeconds('')).toBe(0)
  })
})

describe('mergeTick', () => {
  const last = { time: 1000 * 300, open: 100, high: 105, low: 95, close: 101, volume: 7 }
  it('in aceeasi lumanare: close nou, high/low largite, volumul pastrat', () => {
    expect(mergeTick(last, 110, last.time + 10, 300)).toEqual({ ...last, close: 110, high: 110 })
    expect(mergeTick(last, 90, last.time + 10, 300)).toEqual({ ...last, close: 90, low: 90 })
    expect(mergeTick(last, 102, last.time + 299, 300)).toEqual({ ...last, close: 102 })
  })
  it('a trecut intervalul: lumanare NOUA care incepe de la close-ul vechi', () => {
    expect(mergeTick(last, 103, last.time + 300, 300)).toEqual({ time: last.time + 300, open: 101, high: 103, low: 101, close: 103, volume: 0 })
  })
  it('peste mai multe intervale (telefon adormit): timpul cade pe granita corecta', () => {
    expect(mergeTick(last, 99, last.time + 1000, 300)!.time).toBe(last.time + 900)
  })
  it('nimic de facut: fara lumanare, pret invalid, interval necunoscut, ceas in urma', () => {
    expect(mergeTick(undefined, 100, 1, 300)).toBeNull()
    expect(mergeTick(last, 0, last.time + 1, 300)).toBeNull()
    expect(mergeTick(last, NaN, last.time + 1, 300)).toBeNull()
    expect(mergeTick(last, 100, last.time + 1, 0)).toBeNull()
    expect(mergeTick(last, 100, last.time - 5, 300)).toBeNull()
  })
  it('nu modifica lumanarea primita', () => {
    const copy = { ...last }
    mergeTick(last, 200, last.time + 1, 300)
    expect(last).toEqual(copy)
  })
})
