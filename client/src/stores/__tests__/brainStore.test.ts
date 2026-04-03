import { describe, it, expect, beforeEach } from 'vitest'
import { useBrainStore } from '../brainStore'

describe('brainStore', () => {
  beforeEach(() => {
    useBrainStore.setState(useBrainStore.getInitialState())
  })

  it('has correct defaults', () => {
    const { brain } = useBrainStore.getState()
    expect(brain.mode).toBe('assist')
    expect(brain.profile).toBe('fast')
    expect(brain.confluenceScore).toBe(50)
    expect(brain.entryReady).toBe(false)
    expect(brain.regimeEngine.regime).toBe('RANGE')
    expect(brain.phaseFilter.allow).toBe(false)
  })

  it('patch merges partial brain state', () => {
    useBrainStore.getState().patch({ confluenceScore: 85, entryReady: true })
    const { brain } = useBrainStore.getState()
    expect(brain.confluenceScore).toBe(85)
    expect(brain.entryReady).toBe(true)
    expect(brain.mode).toBe('assist') // unchanged
  })
})
