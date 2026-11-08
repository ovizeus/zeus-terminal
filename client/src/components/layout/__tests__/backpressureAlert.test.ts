import { describe, it, expect } from 'vitest'
import { initialState, onPoll, REMIND_AFTER_MS } from '../backpressureAlert'

describe('telling the user the server is refusing its own requests', () => {
  it('says nothing on the first poll — pre-existing trouble is not news', () => {
    const s = initialState()
    expect(onPoll(s, 500, 1000).kind).toBe('none')
  })

  it('speaks once when rejections start climbing', () => {
    const s = initialState()
    onPoll(s, 0, 0)
    expect(onPoll(s, 31, 1000)).toEqual({ kind: 'started', delta: 31 })
  })

  it('then stays QUIET while it keeps climbing — this is the flood', () => {
    // during a Binance ban the counter rises on every single poll; the old
    // code toasted every time, for as long as the ban lasted
    const s = initialState()
    onPoll(s, 0, 0)
    onPoll(s, 31, 1000)
    for (let i = 2; i < 40; i++) {
      expect(onPoll(s, 31 * i, 1000 + i * 15_000).kind).toBe('none')
    }
  })

  it('reminds once after a long episode, not every cycle', () => {
    const s = initialState()
    onPoll(s, 0, 0)
    onPoll(s, 10, 1000)
    expect(onPoll(s, 20, 1000 + REMIND_AFTER_MS - 1).kind).toBe('none')
    expect(onPoll(s, 30, 1000 + REMIND_AFTER_MS).kind).toBe('ongoing')
    // and then goes quiet again
    expect(onPoll(s, 40, 1000 + REMIND_AFTER_MS + 15_000).kind).toBe('none')
  })

  it('says when it is over — the end of a problem is news too', () => {
    const s = initialState()
    onPoll(s, 0, 0)
    onPoll(s, 31, 1000)
    expect(onPoll(s, 31, 2000)).toEqual({ kind: 'cleared' })
  })

  it('does not announce the end twice', () => {
    const s = initialState()
    onPoll(s, 0, 0)
    onPoll(s, 31, 1000)
    onPoll(s, 31, 2000)
    expect(onPoll(s, 31, 3000).kind).toBe('none')
  })

  it('a second episode speaks again', () => {
    const s = initialState()
    onPoll(s, 0, 0)
    onPoll(s, 10, 1000)      // started
    onPoll(s, 10, 2000)      // cleared
    expect(onPoll(s, 20, 3000).kind).toBe('started')
  })

  it('never throws on nonsense counters', () => {
    const s = initialState()
    expect(() => onPoll(s, NaN, 0)).not.toThrow()
    expect(() => onPoll(s, undefined as never, 1)).not.toThrow()
  })
})
