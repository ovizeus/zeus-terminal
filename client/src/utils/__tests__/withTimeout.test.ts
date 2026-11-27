import { describe, it, expect, vi, afterEach } from 'vitest'
import { withTimeout } from '../withTimeout'

// [2026-11-27] „Close all" ramanea pe „Closing…" cat timp serverul intarzia (pana la 40 s, 22 nov).
afterEach(() => vi.useRealTimers())

describe('withTimeout', () => {
  it('raspunsul vine la timp → {timedOut:false, value}', async () => {
    expect(await withTimeout(Promise.resolve(7), 1000)).toEqual({ timedOut: false, value: 7 })
  })
  it('raspunsul intarzie → {timedOut:true} dupa limita, fara sa astepte cererea', async () => {
    vi.useFakeTimers()
    const p = withTimeout(new Promise(() => {}), 20000)
    vi.advanceTimersByTime(20000)
    expect(await p).toEqual({ timedOut: true })
  })
  it('eroarea cererii trece mai departe', async () => {
    await expect(withTimeout(Promise.reject(new Error('net')), 1000)).rejects.toThrow('net')
  })
})
