import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'

// [2026-11-28] Procentul de langa pretul din header era tick-la-tick (pret vs pretul de acum 3 s),
// deci statea pe „▲ 0.00%". Acum e schimbarea pe 24h, calculata LA FIECARE TICK din pretul live
// fata de deschiderea de acum 24h (open = last / (1 + pct/100)), ca sa mearga sincron cu pretul.

import { open24From, chg24For, noteRef24, _resetHeader24ForTest, pollHeader24 } from '../header24'

const w = window as any
beforeEach(() => { _resetHeader24ForTest(); vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(1_000_000) })
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

describe('procentul pe 24h din header', () => {
  it('deschiderea se scoate din ultimul pret si procent', () => {
    expect(open24From(110, 10)).toBeCloseTo(100, 9)
    expect(open24From(90, -10)).toBeCloseTo(100, 9)
    expect(open24From(0, 5)).toBeNull()
    expect(open24From(100, -100)).toBeNull()
    expect(open24From(100, NaN)).toBeNull()
  })
  it('procentul se misca odata cu pretul live (nu sta pe 0.00)', () => {
    noteRef24('BTCUSDT', 110, 10)            // open 100
    expect(chg24For('BTCUSDT', 110)).toBeCloseTo(10, 9)
    expect(chg24For('BTCUSDT', 105)).toBeCloseTo(5, 9)
    expect(chg24For('BTCUSDT', 95)).toBeCloseTo(-5, 9)
  })
  it('fara referinta → null (nu inventam 0.00%)', () => {
    expect(chg24For('BTCUSDT', 100)).toBeNull()
    noteRef24('ETHUSDT', 110, 10)
    expect(chg24For('BTCUSDT', 100)).toBeNull()
  })
  it('referinta veche (> 5 min) nu mai e folosita', () => {
    noteRef24('BTCUSDT', 110, 10)
    vi.setSystemTime(1_000_000 + 5 * 60_000 + 1)
    expect(chg24For('BTCUSDT', 110)).toBeNull()
  })
  it('evenimentul watchlist-ului (zeus:wlPrice) aduce referinta', () => {
    window.dispatchEvent(new CustomEvent('zeus:wlPrice', { detail: { sym: 'SOLUSDT', price: 220, chg: 10 } }))
    expect(chg24For('SOLUSDT', 220)).toBeCloseTo(10, 9)
  })
  it('evenimentul cu chg 0 si pret invalid e ignorat corect', () => {
    window.dispatchEvent(new CustomEvent('zeus:wlPrice', { detail: { sym: 'SOLUSDT', price: 0, chg: 3 } }))
    expect(chg24For('SOLUSDT', 220)).toBeNull()
  })
  it('moneda din chart fara watchlist: se citeste din ticker24hr; cu referinta proaspata NU se mai cere', async () => {
    w.S = { symbol: 'PEPEUSDT' }; w.WL_SYMS = ['BTCUSDT']
    const f = vi.fn(async () => ({ ok: true, status: 200, json: async () => [{ symbol: 'PEPEUSDT', lastPrice: '0.000012', priceChangePercent: '20' }] }))
    vi.stubGlobal('fetch', f)
    await pollHeader24()
    // aceeasi cheie de cache ca watchlist-ul (Binance futures da oricum TOATE monedele) → fara greutate noua
    expect(decodeURIComponent(String((f.mock.calls[0] as any)[0]))).toContain('["BTCUSDT"]')
    expect(chg24For('PEPEUSDT', 0.000012)).toBeCloseTo(20, 6)
    await pollHeader24()
    expect(f).toHaveBeenCalledTimes(1)
  })
  it('moneda lipseste din raspunsul listei → abia atunci se cere doar ea', async () => {
    w.S = { symbol: 'PEPEUSDT' }; w.WL_SYMS = ['BTCUSDT']
    const f = vi.fn(async (u: string) => ({ ok: true, status: 200, json: async () =>
      decodeURIComponent(u).includes('["PEPEUSDT"]') ? [{ symbol: 'PEPEUSDT', lastPrice: '2', priceChangePercent: '100' }] : [{ symbol: 'BTCUSDT', lastPrice: '1', priceChangePercent: '1' }] }))
    vi.stubGlobal('fetch', f)
    await pollHeader24()
    expect(f).toHaveBeenCalledTimes(2)
    expect(chg24For('PEPEUSDT', 2)).toBeCloseTo(100, 6)
  })
  it('raspuns pentru moneda schimbata intre timp e aruncat', async () => {
    w.S = { symbol: 'PEPEUSDT' }; w.WL_SYMS = []
    vi.stubGlobal('fetch', vi.fn(async () => { w.S.symbol = 'DOGEUSDT'; return { ok: true, status: 200, json: async () => [{ symbol: 'PEPEUSDT', lastPrice: '1', priceChangePercent: '20' }] } }))
    await pollHeader24()
    expect(chg24For('PEPEUSDT', 1)).toBeNull()
  })
})
