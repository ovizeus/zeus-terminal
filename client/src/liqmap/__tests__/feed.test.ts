import { describe, it, expect, vi, afterEach } from 'vitest'
import { fetchPanel, normalizeLive, pushTape, EMPTY } from '../feed'

afterEach(() => vi.restoreAllMocks())

describe('aducerea istoricului', () => {
  it('o cerere, toate vederile', async () => {
    const spy = vi.fn(async () => ({ ok: true, json: async () => ({ map: { events: 3 }, heat: { cells: [] }, stats: { events: 3 } }) }))
    vi.stubGlobal('fetch', spy)
    const d = await fetchPanel('BTCUSDT', 80000, 90, 90)
    expect(spy).toHaveBeenCalledTimes(1)          // NU trei cereri
    expect(spy.mock.calls[0][0]).toContain('liq-panel')
    expect(d.map!.events).toBe(3)
  })

  it('un ref invalid nu trimite cererea deloc', async () => {
    const spy = vi.fn()
    vi.stubGlobal('fetch', spy)
    for (const ref of [0, -1, NaN]) {
      expect(await fetchPanel('BTCUSDT', ref, 90, 90)).toEqual(EMPTY)
    }
    expect(spy).not.toHaveBeenCalled()
  })

  it('server cazut / raspuns stricat => panou gol, nu exceptie', async () => {
    for (const impl of [
      async () => { throw new Error('retea') },
      async () => ({ ok: false, status: 500 }),
      async () => ({ ok: true, json: async () => null }),
      async () => ({ ok: true, json: async () => { throw new Error('json') } }),
    ]) {
      vi.stubGlobal('fetch', impl as any)
      await expect(fetchPanel('BTCUSDT', 80000, 90, 90)).resolves.toEqual(EMPTY)
    }
  })
})

describe('evenimentul live', () => {
  it('trece intreg si deduce partea', () => {
    const e = normalizeLive({ exchange: 'gate', p: 80000, vol: 1234, side: 'SELL', time: 1792965000000 })!
    expect(e.isLong).toBe(true)
    expect(e.vol).toBe(1234)
    expect(e.exchange).toBe('gate')
  })

  it('SHORT lichidat e marcat ca atare', () => {
    expect(normalizeLive({ p: 1, vol: 1, side: 'BUY' })!.isLong).toBe(false)
  })

  it('ce nu se poate desena corect e ARUNCAT, nu desenat gresit', () => {
    for (const bad of [null, {}, { p: 0, vol: 1, side: 'SELL' }, { p: 1, vol: 0, side: 'SELL' },
                       { p: 1, vol: 1, side: 'X' }, { p: NaN, vol: 1, side: 'SELL' }]) {
      expect(normalizeLive(bad)).toBe(null)
    }
  })

  it('fara timp, primeste acum — nu cade in 1970', () => {
    expect(normalizeLive({ p: 1, vol: 1, side: 'SELL' })!.time).toBeGreaterThan(1.7e12)
  })
})

describe('tape-ul', () => {
  const mk = (v: number) => ({ exchange: 'g', side: 'SELL', isLong: true, p: 1, vol: v, time: v } as any)

  it('cel mai nou primul', () => {
    let t: any[] = []
    t = pushTape(t, mk(1)); t = pushTape(t, mk(2))
    expect(t[0].vol).toBe(2)
  })

  it('e MARGINIT — un panou lasat deschis o noapte nu creste la infinit', () => {
    let t: any[] = []
    for (let i = 0; i < 500; i++) t = pushTape(t, mk(i), 60)
    expect(t).toHaveLength(60)
    expect(t[0].vol).toBe(499)
  })

  it('null nu schimba nimic', () => {
    const t = [mk(1)]
    expect(pushTape(t, null)).toBe(t)
  })
})
