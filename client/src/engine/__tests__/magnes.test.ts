import { describe, it, expect } from 'vitest'
import { magnes, magnesHeat } from '../indicatorCalc'

function gen(n: number, base = 100): { highs: number[]; lows: number[]; closes: number[]; volumes: number[] } {
  const highs: number[] = [], lows: number[] = [], closes: number[] = [], volumes: number[] = []
  for (let i = 0; i < n; i++) {
    const c = base + Math.sin(i / 5) * 5 + i * 0.1
    closes.push(c); highs.push(c + 1); lows.push(c - 1); volumes.push(100 + (i % 7))
  }
  return { highs, lows, closes, volumes }
}

describe('magnes (volume-profile liquidity heatmap)', () => {
  it('produces buckets.length === rows when data present', () => {
    const { highs, lows, closes, volumes } = gen(300)
    const r = magnes(highs, lows, closes, volumes, 50, 240)
    expect(r.buckets.length).toBe(50)
  })

  it('sum of bucket vols ≈ total window volume', () => {
    const { highs, lows, closes, volumes } = gen(120)
    const rows = 40, lookback = 240
    const r = magnes(highs, lows, closes, volumes, rows, lookback)
    const used = Math.min(lookback, volumes.length)
    const windowVol = volumes.slice(volumes.length - used).reduce((a, b) => a + b, 0)
    const sumBuckets = r.buckets.reduce((a, b) => a + b.vol, 0)
    expect(sumBuckets).toBeCloseTo(windowVol, 6)
  })

  it('poc points at the genuinely-largest bucket', () => {
    // cluster many closes at one price with huge volume → that bucket is poc
    const highs: number[] = [], lows: number[] = [], closes: number[] = [], volumes: number[] = []
    for (let i = 0; i < 100; i++) {
      const c = 50 + (i % 10) // spread closes 50..59
      closes.push(c); highs.push(c + 0.5); lows.push(c - 0.5); volumes.push(10)
    }
    // big spike of volume at a specific price (55)
    for (let i = 0; i < 30; i++) { closes.push(55); highs.push(55.5); lows.push(54.5); volumes.push(1000) }
    const r = magnes(highs, lows, closes, volumes, 50, 500)
    expect(r.poc).toBeGreaterThanOrEqual(0)
    expect(r.maxVol).toBeGreaterThan(0)
    // the poc bucket priceMid should be near 55
    expect(Math.abs(r.buckets[r.poc].priceMid - 55)).toBeLessThan(1.5)
    // poc is truly the max
    const maxFound = Math.max(...r.buckets.map(b => b.vol))
    expect(r.buckets[r.poc].vol).toBe(maxFound)
  })

  it('loIdx anchors at window start', () => {
    const { highs, lows, closes, volumes } = gen(300)
    const r = magnes(highs, lows, closes, volumes, 50, 240)
    expect(r.loIdx).toBe(300 - 240)
  })

  it('guards empty / zero-volume / hi<=lo', () => {
    expect(magnes([], [], [], []).buckets.length).toBe(0)
    expect(magnes([], [], [], []).poc).toBe(-1)
    const flat = magnes([5, 5], [5, 5], [5, 5], [10, 10], 50, 240)
    expect(flat.poc).toBe(-1)
    expect(flat.buckets.length).toBe(0)
    const zeroVol = magnes([6, 5], [4, 3], [5, 4], [0, 0], 50, 240)
    expect(zeroVol.maxVol).toBe(0)
  })

  it('magnesHeat returns valid #rrggbb, red at t=1, blue at t=0', () => {
    const hot = magnesHeat(1)
    const cold = magnesHeat(0)
    expect(hot).toMatch(/^#[0-9a-f]{6}$/i)
    expect(cold).toMatch(/^#[0-9a-f]{6}$/i)
    const rHot = parseInt(hot.slice(1, 3), 16), bHot = parseInt(hot.slice(5, 7), 16)
    const rCold = parseInt(cold.slice(1, 3), 16), bCold = parseInt(cold.slice(5, 7), 16)
    expect(rHot).toBeGreaterThan(bHot) // hot is reddish
    expect(bCold).toBeGreaterThan(rCold) // cold is bluish
    // clamps out-of-range
    expect(magnesHeat(2)).toMatch(/^#[0-9a-f]{6}$/i)
    expect(magnesHeat(-1)).toMatch(/^#[0-9a-f]{6}$/i)
  })
})
