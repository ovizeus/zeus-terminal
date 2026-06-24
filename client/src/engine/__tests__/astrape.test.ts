import { describe, it, expect } from 'vitest'
import { astrape } from '../indicatorCalc'

function series(rows: number[][]) {
  return {
    highs: rows.map((r) => r[1]),
    lows: rows.map((r) => r[2]),
    closes: rows.map((r) => r[3]),
    volumes: rows.map((r) => r[4]),
  }
}
// "normal" volatility: moderate range (~0.5% of px), establishes the medium-term ATR baseline.
function normal(n: number, px: number, vol: number): number[][] {
  const out: number[][] = []
  let p = px
  for (let i = 0; i < n; i++) {
    const amp = 0.005 * p
    const c = p + (i % 2 ? 0.15 : -0.15) * amp
    out.push([p, p + amp, p - amp, c, vol])
    p = c
  }
  return out
}
// "squeeze": tiny range (~0.08% of px) → ATR drops far below its 50-avg = compression. Volume = vol.
function squeeze(n: number, px: number, vol: number): number[][] {
  const out: number[][] = []
  for (let i = 0; i < n; i++) {
    const amp = 0.0008 * px
    const c = px + (i % 2 ? 0.0002 : -0.0002) * px
    out.push([px, px + amp, px - amp, c, vol])
  }
  return out
}

describe('astrape (Storm Charge & Ignition)', () => {
  it('exports + returns aligned arrays', () => {
    const s = series(normal(80, 100, 1000))
    const a = astrape(s.highs, s.lows, s.closes, s.volumes)
    expect(a.charge.length).toBe(80)
    expect(a.state.length).toBe(80)
    expect(a.ignite.length).toBe(80)
  })

  it('ACCUM (charging): real compression + volume building, no breakout yet', () => {
    const rows = [...normal(80, 100, 1000), ...squeeze(16, 100, 2200)] // tight range, ~2.2x volume
    const s = series(rows)
    const a = astrape(s.highs, s.lows, s.closes, s.volumes)
    const i = a.state.length - 1
    expect(a.state[i]).toBe('ACCUM')
    expect(a.charge[i] as number).toBeGreaterThan(55)
    expect(a.ignite[i]).toBe(false)
  })

  it('IGNITE_UP: compression then an expanding bullish breakout candle', () => {
    const rows = [...normal(55, 100, 1000), ...squeeze(15, 100, 1000)]
    rows.push([100, 103.5, 99.9, 103.2, 4000]) // big bullish expansion, closes near high
    const s = series(rows)
    const a = astrape(s.highs, s.lows, s.closes, s.volumes)
    const i = a.state.length - 1
    expect(a.state[i]).toBe('IGNITE_UP')
    expect(a.ignite[i]).toBe(true)
  })

  it('IGNITE_DOWN: compression then an expanding bearish breakout candle', () => {
    const rows = [...normal(55, 100, 1000), ...squeeze(15, 100, 1000)]
    rows.push([100, 100.1, 96.5, 96.8, 4000]) // big bearish expansion, closes near low
    const s = series(rows)
    const a = astrape(s.highs, s.lows, s.closes, s.volumes)
    const i = a.state.length - 1
    expect(a.state[i]).toBe('IGNITE_DOWN')
    expect(a.ignite[i]).toBe(true)
  })

  it('COOL / trend on normal vol — no ignition, low charge', () => {
    const s = series(normal(90, 100, 1000))
    const a = astrape(s.highs, s.lows, s.closes, s.volumes)
    const i = a.state.length - 1
    expect(['COOL', 'UP', 'DOWN']).toContain(a.state[i])
    expect(a.ignite[i]).toBe(false)
    expect(a.charge[i] as number).toBeLessThan(55)
  })

  it('warmup region is null, never throws on short/empty input', () => {
    const s = series(squeeze(10, 100, 1000))
    const a = astrape(s.highs, s.lows, s.closes, s.volumes)
    expect(a.charge[0]).toBeNull()
    expect(() => astrape([], [], [], [])).not.toThrow()
  })
})
