import { describe, it, expect, beforeEach } from 'vitest'
import { useATStore } from '../atStore'

describe('atStore', () => {
  beforeEach(() => {
    useATStore.setState(useATStore.getInitialState())
  })

  it('has correct defaults', () => {
    const s = useATStore.getState()
    expect(s.enabled).toBe(false)
    expect(s.mode).toBe('demo')
    expect(s.killTriggered).toBe(false)
    expect(s.totalTrades).toBe(0)
    expect(s.log).toEqual([])
  })

  it('patch merges partial state', () => {
    useATStore.getState().patch({ enabled: true, mode: 'live', totalTrades: 42 })
    const s = useATStore.getState()
    expect(s.enabled).toBe(true)
    expect(s.mode).toBe('live')
    expect(s.totalTrades).toBe(42)
    expect(s.killTriggered).toBe(false) // unchanged
  })

  it('addLog appends and caps at 100', () => {
    const store = useATStore.getState()
    for (let i = 0; i < 105; i++) {
      store.addLog({ ts: i, action: `test-${i}` })
    }
    expect(useATStore.getState().log).toHaveLength(100)
    expect(useATStore.getState().log[99].action).toBe('test-104')
  })
})
