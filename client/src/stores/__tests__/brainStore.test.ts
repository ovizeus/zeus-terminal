import { describe, it, expect, beforeEach } from 'vitest'
import { useBrainStore } from '../brainStore'

describe('brainStore', () => {
  beforeEach(() => {
    useBrainStore.setState(useBrainStore.getInitialState())
  })

  it('has correct defaults', () => {
    const s = useBrainStore.getState()
    expect(s.brain.mode).toBe('assist')
    expect(s.brain.profile).toBe('fast')
    expect(s.brain.confluenceScore).toBe(50)
    expect(s.brain.entryReady).toBe(false)
    expect(s.brain.regimeEngine.regime).toBe('RANGE')
    expect(s.brain.phaseFilter.allow).toBe(false)
    expect(s.brainState).toBe('scanning')
    expect(s.brainMode).toBe('assist')
    expect(s.thoughts).toEqual([])
    expect(s.adaptParams).toBeNull()
    expect(s.blockReason).toBeNull()
  })

  it('patch merges partial brain state', () => {
    useBrainStore.getState().patch({ confluenceScore: 85, entryReady: true })
    const { brain } = useBrainStore.getState()
    expect(brain.confluenceScore).toBe(85)
    expect(brain.entryReady).toBe(true)
    expect(brain.mode).toBe('assist') // unchanged
  })

  it('setMode updates both brain.mode and top-level brainMode atomically', () => {
    useBrainStore.getState().setMode('auto')
    const s = useBrainStore.getState()
    expect(s.brain.mode).toBe('auto')
    expect(s.brainMode).toBe('auto')
  })

  it('setProfile updates brain.profile without touching other fields', () => {
    useBrainStore.getState().patch({ confluenceScore: 77 })
    useBrainStore.getState().setProfile('swing')
    const { brain } = useBrainStore.getState()
    expect(brain.profile).toBe('swing')
    expect(brain.confluenceScore).toBe(77) // retained
  })

  it('setEngineState updates top-level brainState', () => {
    useBrainStore.getState().setEngineState('ready')
    expect(useBrainStore.getState().brainState).toBe('ready')
    useBrainStore.getState().setEngineState('blocked')
    expect(useBrainStore.getState().brainState).toBe('blocked')
  })

  it('setEntry updates ready and score; partial retains unset field', () => {
    useBrainStore.getState().setEntry({ ready: true, score: 72 })
    let b = useBrainStore.getState().brain
    expect(b.entryReady).toBe(true)
    expect(b.entryScore).toBe(72)

    useBrainStore.getState().setEntry({ score: 55 })
    b = useBrainStore.getState().brain
    expect(b.entryReady).toBe(true) // retained
    expect(b.entryScore).toBe(55)

    useBrainStore.getState().setEntry({ ready: false })
    b = useBrainStore.getState().brain
    expect(b.entryReady).toBe(false)
    expect(b.entryScore).toBe(55) // retained
  })

  it('setFlow replaces flow snapshot', () => {
    useBrainStore.getState().setFlow({ cvd: 'bull', delta: 1500, ofi: 'bull' })
    const { flow } = useBrainStore.getState().brain
    expect(flow.cvd).toBe('bull')
    expect(flow.delta).toBe(1500)
    expect(flow.ofi).toBe('bull')
  })

  it('setMtf replaces mtf alignment', () => {
    useBrainStore.getState().setMtf({ '15m': 'bull', '1h': 'bull', '4h': 'bear' })
    const { mtf } = useBrainStore.getState().brain
    expect(mtf['15m']).toBe('bull')
    expect(mtf['1h']).toBe('bull')
    expect(mtf['4h']).toBe('bear')
  })

  it('setSweep replaces sweep snapshot', () => {
    useBrainStore.getState().setSweep({ type: 'bull', reclaim: true, displacement: true })
    const { sweep } = useBrainStore.getState().brain
    expect(sweep.type).toBe('bull')
    expect(sweep.reclaim).toBe(true)
    expect(sweep.displacement).toBe(true)
  })

  it('setGates replaces gates map', () => {
    useBrainStore.getState().setGates({ a: true, b: false, c: 42 })
    const { gates } = useBrainStore.getState().brain
    expect(gates.a).toBe(true)
    expect(gates.b).toBe(false)
    expect(gates.c).toBe(42)
  })

  it('setBlockReason sets and clears block reason', () => {
    useBrainStore.getState().setBlockReason({ code: 'NEWS_HIGH', text: 'High-impact news window' })
    expect(useBrainStore.getState().blockReason).toEqual({ code: 'NEWS_HIGH', text: 'High-impact news window' })
    useBrainStore.getState().setBlockReason(null)
    expect(useBrainStore.getState().blockReason).toBeNull()
  })

  it('setThoughts replaces thoughts log atomically', () => {
    useBrainStore.getState().setThoughts([
      { ts: 1, kind: 'info', msg: 'hello' },
      { ts: 2, kind: 'warn', msg: 'watch out' },
    ])
    const { thoughts } = useBrainStore.getState()
    expect(thoughts).toHaveLength(2)
    expect(thoughts[0].msg).toBe('hello')
    expect(thoughts[1].kind).toBe('warn')

    useBrainStore.getState().setThoughts([])
    expect(useBrainStore.getState().thoughts).toEqual([])
  })

  it('setAdaptParams sets and clears adapt params', () => {
    useBrainStore.getState().setAdaptParams({ sl: 100, size: 0.5, adjustCount: 3 })
    expect(useBrainStore.getState().adaptParams).toEqual({ sl: 100, size: 0.5, adjustCount: 3 })
    useBrainStore.getState().setAdaptParams(null)
    expect(useBrainStore.getState().adaptParams).toBeNull()
  })

  it('syncFromEngine remains active and reads window.BM/BRAIN/S atomically', () => {
    const w = window as any
    w.BM = {
      profile: 'swing',
      confluenceScore: 80,
      confMin: 70,
      entryScore: 66,
      entryReady: true,
      gates: { q: true },
      mtf: { '15m': 'bull', '1h': 'bull', '4h': 'bull' },
      sweep: { type: 'bear', reclaim: true, displacement: false },
      flow: { cvd: 'bull', delta: 500, ofi: 'bull' },
    }
    w.BRAIN = {
      state: 'ready',
      thoughts: [{ ts: 1, msg: 'ok' }],
      adaptParams: { sl: 99 },
    }
    w.S = { mode: 'auto' }
    w.BlockReason = { get: () => ({ code: 'X', text: 'blocked X' }) }

    useBrainStore.getState().syncFromEngine()
    const s = useBrainStore.getState()
    expect(s.brain.profile).toBe('swing')
    expect(s.brain.confluenceScore).toBe(80)
    expect(s.brain.entryReady).toBe(true)
    expect(s.brain.entryScore).toBe(66)
    expect(s.brainState).toBe('ready')
    expect(s.brainMode).toBe('auto')
    expect(s.thoughts).toHaveLength(1)
    expect(s.adaptParams).toEqual({ sl: 99 })
    expect(s.blockReason).toEqual({ code: 'X', text: 'blocked X' })

    delete w.BM
    delete w.BRAIN
    delete w.S
    delete w.BlockReason
  })

  it('syncFromEngine no-ops when window.BM absent', () => {
    const w = window as any
    delete w.BM
    useBrainStore.getState().setEngineState('ready')
    useBrainStore.getState().syncFromEngine()
    expect(useBrainStore.getState().brainState).toBe('ready') // untouched
  })
})
