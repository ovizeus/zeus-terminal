import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { startPoll } from '../poll'

let vis: DocumentVisibilityState = 'visible'
const setVis = (v: DocumentVisibilityState) => { vis = v; document.dispatchEvent(new Event('visibilitychange')) }

describe('startPoll — furtuna de cereri', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vis = 'visible'
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => vis })
  })
  afterEach(() => { vi.useRealTimers() })

  it('ruleaza imediat si apoi la fiecare interval', async () => {
    const fn = vi.fn(async () => {})
    const stop = startPoll(fn, 1000)
    await vi.advanceTimersByTimeAsync(3100)
    expect(fn).toHaveBeenCalledTimes(4)
    stop()
  })

  it('o cerere fara raspuns NU lasa sa porneasca alta (coada nu se formeaza)', async () => {
    let release: () => void = () => {}
    const fn = vi.fn(() => new Promise<void>((r) => { release = r }))
    const stop = startPoll(fn, 1000)
    await vi.advanceTimersByTimeAsync(20_000)       // 20 de ticuri cu reteaua blocata
    expect(fn).toHaveBeenCalledTimes(1)
    release(); await vi.advanceTimersByTimeAsync(1000)
    expect(fn).toHaveBeenCalledTimes(2)
    stop()
  })

  it('o cerere blocata mai mult de stuckMs nu opreste bucla pentru totdeauna', async () => {
    const fn = vi.fn(() => new Promise<void>(() => {}))
    const stop = startPoll(fn, 1000, { stuckMs: 5000 })
    await vi.advanceTimersByTimeAsync(5500)
    expect(fn).toHaveBeenCalledTimes(2)
    stop()
  })

  it('in fundal nu cere nimic; la revenire cere O SINGURA data, imediat', async () => {
    const fn = vi.fn(async () => {})
    const stop = startPoll(fn, 1500)
    setVis('hidden')
    const n = fn.mock.calls.length
    await vi.advanceTimersByTimeAsync(150_000)       // ~2,5 minute in fundal
    expect(fn.mock.calls.length).toBe(n)
    setVis('visible')
    await vi.advanceTimersByTimeAsync(0)
    expect(fn.mock.calls.length).toBe(n + 1)
    stop()
  })

  it('runHidden: continua si in fundal, tot fara suprapuneri', async () => {
    const fn = vi.fn(async () => {})
    const stop = startPoll(fn, 1000, { runHidden: true })
    setVis('hidden')
    await vi.advanceTimersByTimeAsync(3100)
    expect(fn).toHaveBeenCalledTimes(4)
    stop()
  })

  it('dupa oprire nu mai cere nimic, nici la revenire', async () => {
    const fn = vi.fn(async () => {})
    const stop = startPoll(fn, 1000)
    stop()
    await vi.advanceTimersByTimeAsync(5000)
    setVis('hidden'); setVis('visible')
    await vi.advanceTimersByTimeAsync(0)
    expect(fn).toHaveBeenCalledTimes(1)
  })
})
