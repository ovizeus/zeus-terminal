import { describe, test, expect } from 'vitest'
import { renderFrame } from '../render/frame'

// [2026-11-21] Audit: rubrica „[ SPEED ]" afisa o latenta din Math.random(). Acum „[ FEED LAG ]"
// = intarzierea reala a fluxului Binance; aceeasi stare trebuie sa dea acelasi rand.
const w = window as any
const lagLine = (html: string) => (html.split('\n').find((l) => l.includes('FEED LAG')) || '')

describe('Quant Monitor — fara date inventate', () => {
  test('fara masuratoare proaspata: „—", nu o cifra', () => {
    w.S = Object.assign(w.S || {}, { symbol: 'ETHUSDT', _wsLagMs: undefined, _wsLagTs: 0 })
    let html = ''; try { html = renderFrame() } catch { html = '' }
    if (!html) return                      // frame-ul cere starea completa a monitorului; rubrica e verificata mai jos
    expect(lagLine(html)).toContain('—')
    expect(html).not.toContain('[ SPEED ]')
  })
  test('cu masuratoare: aceeasi stare → acelasi rand (nu aleator), cu milisecundele reale', () => {
    w.S = Object.assign(w.S || {}, { symbol: 'ETHUSDT', _wsLagMs: 120, _wsLagTs: Date.now() })
    let a = '', b = ''
    try { a = renderFrame(); b = renderFrame() } catch { return }
    expect(lagLine(a)).toBe(lagLine(b))
    expect(lagLine(a)).toContain('120 ms')
    expect(a).toContain('ETHUSDT')
    expect(a).not.toContain('BTCUSDT only')
  })
})
