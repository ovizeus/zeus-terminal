import { describe, it, expect, beforeEach } from 'vitest'
import { useDslStore } from '../dslStore'

describe('dslStore', () => {
  beforeEach(() => {
    useDslStore.setState(useDslStore.getInitialState())
  })

  it('has correct defaults', () => {
    const s = useDslStore.getState()
    expect(s.enabled).toBe(true)
    expect(s.mode).toBeNull()
    expect(s.magnetEnabled).toBe(false)
    expect(s.magnetMode).toBe('soft')
    expect(s.positions).toEqual({})
    expect(s.checkIntervalActive).toBe(false)
  })

  it('setEnabled flips top-level flag without touching positions', () => {
    useDslStore.getState().upsertPosition('p1', { active: true })
    useDslStore.getState().setEnabled(false)
    const s = useDslStore.getState()
    expect(s.enabled).toBe(false)
    expect(s.positions.p1).toBeDefined()
  })

  it('setMode accepts string and null', () => {
    useDslStore.getState().setMode('aggressive')
    expect(useDslStore.getState().mode).toBe('aggressive')
    useDslStore.getState().setMode(null)
    expect(useDslStore.getState().mode).toBeNull()
  })

  it('setMagnet sets enabled and mode atomically; mode optional retains previous', () => {
    useDslStore.getState().setMagnet(true, 'hard')
    let s = useDslStore.getState()
    expect(s.magnetEnabled).toBe(true)
    expect(s.magnetMode).toBe('hard')

    useDslStore.getState().setMagnet(false)
    s = useDslStore.getState()
    expect(s.magnetEnabled).toBe(false)
    expect(s.magnetMode).toBe('hard') // retained
  })

  it('setCheckIntervalActive toggles flag', () => {
    useDslStore.getState().setCheckIntervalActive(true)
    expect(useDslStore.getState().checkIntervalActive).toBe(true)
    useDslStore.getState().setCheckIntervalActive(false)
    expect(useDslStore.getState().checkIntervalActive).toBe(false)
  })

  it('upsertPosition inserts new and merges into existing', () => {
    useDslStore.getState().upsertPosition('p1', { active: true, currentSL: 100 } as any)
    useDslStore.getState().upsertPosition('p1', { currentSL: 105 } as any)
    const p = useDslStore.getState().positions.p1
    expect(p.active).toBe(true)
    expect(p.currentSL).toBe(105)
  })

  it('removePosition is a no-op for unknown id and removes for known id', () => {
    useDslStore.getState().upsertPosition('p1', { active: true } as any)
    const beforeRef = useDslStore.getState().positions
    useDslStore.getState().removePosition('missing')
    expect(useDslStore.getState().positions).toBe(beforeRef) // unchanged ref

    useDslStore.getState().removePosition('p1')
    expect(useDslStore.getState().positions.p1).toBeUndefined()
  })

  it('replacePositions atomically swaps the map', () => {
    useDslStore.getState().upsertPosition('p1', { active: true } as any)
    useDslStore.getState().replacePositions({
      p2: { active: false } as any,
      p3: { active: true } as any,
    })
    const s = useDslStore.getState()
    expect(s.positions.p1).toBeUndefined()
    expect(s.positions.p2).toBeDefined()
    expect(s.positions.p3).toBeDefined()
  })

  it('clearPositions wipes the map', () => {
    useDslStore.getState().upsertPosition('p1', { active: true } as any)
    useDslStore.getState().clearPositions()
    expect(useDslStore.getState().positions).toEqual({})
  })

  it('syncFromEngine remains active and reads window.DSL atomically', () => {
    const w = window as any
    w.DSL = {
      enabled: false,
      mode: 'aggressive',
      magnetEnabled: true,
      magnetMode: 'hard',
      positions: { px: { active: true, currentSL: 50 } },
      checkInterval: 123,
    }
    useDslStore.getState().syncFromEngine()
    const s = useDslStore.getState()
    expect(s.enabled).toBe(false)
    expect(s.mode).toBe('aggressive')
    expect(s.magnetEnabled).toBe(true)
    expect(s.magnetMode).toBe('hard')
    expect(s.checkIntervalActive).toBe(true)
    expect(s.positions.px.active).toBe(true)
    delete w.DSL
  })

  it('syncFromEngine no-ops when window.DSL absent', () => {
    const w = window as any
    delete w.DSL
    useDslStore.getState().setEnabled(false)
    useDslStore.getState().syncFromEngine()
    expect(useDslStore.getState().enabled).toBe(false) // untouched
  })

  it('patch merges shallow partial', () => {
    useDslStore.getState().patch({ enabled: false, mode: 'x' })
    const s = useDslStore.getState()
    expect(s.enabled).toBe(false)
    expect(s.mode).toBe('x')
  })
})
