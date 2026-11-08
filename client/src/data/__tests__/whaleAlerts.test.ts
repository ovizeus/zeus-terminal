import { describe, it, expect, beforeEach } from 'vitest'
import { checkWhaleAlerts } from '../whaleAlerts'

let sent: Array<{ title: string; body: string; tag?: string }>
let last: Record<string, number>
const send = (title: string, body: string, tag?: string) => { sent.push({ title, body, tag }) }
beforeEach(() => { sent = []; last = {} })

const base = { alerts: { enabled: true, whaleOrders: true, whaleMinBtc: 100 }, send, symbol: 'BTCUSDT', seeded: true }
const run = (o: Partial<Parameters<typeof checkWhaleAlerts>[0]>) =>
  checkWhaleAlerts({ prevBids: [], bids: [], prevAsks: [], asks: [], last, now: 1_000_000, ...base, ...o } as never)

describe('the first book is never announced', () => {
  it('says nothing before a book has been seen, however big the walls', () => {
    const got = run({ seeded: false, prevBids: [], bids: [{ p: 100, q: 9999 }] })
    expect(got).toEqual([])
    expect(sent).toEqual([])
  })

  it('and announces changes once it has', () => {
    expect(run({ prevBids: [], bids: [{ p: 100, q: 500 }] }).length).toBe(1)
  })
})

describe('what it announces', () => {
  it('a new wall on the bid', () => {
    const got = run({ prevBids: [{ p: 100, q: 5 }], bids: [{ p: 100, q: 5 }, { p: 99, q: 400 }] })
    expect(got).toHaveLength(1)
    expect(sent[0].title).toBe('BID WALL')
    expect(sent[0].body).toMatch(/BTCUSDT/)
    expect(sent[0].body).toMatch(/400/)
  })

  it('a new wall on the ask', () => {
    run({ prevAsks: [], asks: [{ p: 101, q: 300 }] })
    expect(sent[0].title).toBe('ASK WALL')
  })

  it('a wall being pulled, when asked for', () => {
    const got = run({
      alerts: { ...base.alerts, whaleRem: true },
      prevBids: [{ p: 99, q: 400 }], bids: [],
    } as never)
    expect(got).toHaveLength(1)
    expect(sent[0].title).toBe('BID WALL PULLED')
  })

  it('nothing for a wall being pulled by default', () => {
    expect(run({ prevBids: [{ p: 99, q: 400 }], bids: [] })).toEqual([])
  })
})

describe('the switches are obeyed', () => {
  it('the group switch', () => {
    expect(run({ alerts: { enabled: true, whaleOrders: false, whaleMinBtc: 100 }, prevBids: [], bids: [{ p: 1, q: 500 }] } as never)).toEqual([])
  })

  it('the master switch', () => {
    expect(run({ alerts: { enabled: false, whaleOrders: true }, prevBids: [], bids: [{ p: 1, q: 500 }] } as never)).toEqual([])
  })

  it('each side separately', () => {
    expect(run({ alerts: { ...base.alerts, whaleBid: false }, prevBids: [], bids: [{ p: 1, q: 500 }] } as never)).toEqual([])
    sent = []; last = {}
    expect(run({ alerts: { ...base.alerts, whaleBid: false }, prevAsks: [], asks: [{ p: 1, q: 500 }] } as never)).toHaveLength(1)
  })

  it('the minimum size', () => {
    expect(run({ prevBids: [], bids: [{ p: 1, q: 99 }] })).toEqual([])
    expect(run({ alerts: { ...base.alerts, whaleMinBtc: 50 }, prevBids: [], bids: [{ p: 1, q: 99 }] } as never)).toHaveLength(1)
  })
})

describe('a churning book cannot become a siren', () => {
  it('does not repeat the same level within its cooldown', () => {
    expect(run({ prevBids: [], bids: [{ p: 99, q: 400 }], now: 1_000_000 })).toHaveLength(1)
    expect(run({ prevBids: [], bids: [{ p: 99, q: 400 }], now: 1_010_000 })).toHaveLength(0)
    expect(run({ prevBids: [], bids: [{ p: 99, q: 400 }], now: 1_070_000 })).toHaveLength(1)
  })

  it('caps how much one update may say, and keeps the biggest', () => {
    const got = run({
      prevBids: [],
      bids: [{ p: 1, q: 200 }, { p: 2, q: 900 }, { p: 3, q: 500 }, { p: 4, q: 300 }],
    })
    expect(got).toHaveLength(2)
    expect(got.map((e) => e.qty)).toEqual([900, 500])
  })

  it('holds a second burst back even at different prices', () => {
    expect(run({ prevBids: [], bids: [{ p: 10, q: 900 }], now: 1_000_000 })).toHaveLength(1)
    expect(run({ prevBids: [], bids: [{ p: 20, q: 900 }], now: 1_001_000 })).toHaveLength(0)
    expect(run({ prevBids: [], bids: [{ p: 30, q: 900 }], now: 1_010_000 })).toHaveLength(1)
  })
})

describe('it never breaks the feed', () => {
  it('survives a malformed or missing book', () => {
    expect(() => run({ bids: null, asks: undefined, prevBids: [{} as never] })).not.toThrow()
    expect(() => checkWhaleAlerts({ seeded: true, alerts: null, send, last } as never)).not.toThrow()
  })
})
