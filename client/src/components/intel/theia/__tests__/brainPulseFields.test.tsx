import { describe, it, expect, beforeEach } from 'vitest'
import { render } from '@testing-library/react'
import { BrainPulseCard } from '../BrainPulseCard'
import { useBrainStore } from '../../../../stores/brainStore'

// [2026-10-11] BrainPulseCard read four of its five fields from the WRONG level
// of the store. The store's top level holds brain, brainState, brainMode,
// thoughts, adaptParams, blockReason, safetyPill and blockReasonDisplay —
// everything else lives under `brain`. The card did:
//
//   useBrainStore((s) => s.regimeEngine?.regime)   // undefined, always
//   useBrainStore((s) => s.entryReady)             // undefined, always
//   useBrainStore((s) => s.entryScore)             // undefined, always
//   useBrainStore((s) => s.gates)                  // undefined, always
//
// So Regime, Entry ready, Entry score and Gates showed an em dash forever, and
// only Engine (brainState, genuinely top-level) ever had a value. Visible in a
// screenshot of the card taken during this work, and identical at the
// pre-institutional-redesign tag — pre-existing, not caused by the rebuild.
//
// It failed silently because the card is typed `(s: any)`, so TypeScript could
// not see it, and because an absent value renders as an em dash by design,
// which looks like "no data yet" rather than like a bug.

beforeEach(() => {
  useBrainStore.setState(useBrainStore.getInitialState())
})

describe('BrainPulseCard reads the fields where they actually live', () => {
  it('shows the regime from brain.regimeEngine', () => {
    useBrainStore.setState((s: any) => ({
      brain: { ...s.brain, regimeEngine: { ...s.brain.regimeEngine, regime: 'TREND' } },
    }))
    const { container } = render(<BrainPulseCard />)
    expect(container.textContent).toContain('TREND')
  })

  it('shows the entry score from brain.entryScore', () => {
    useBrainStore.setState((s: any) => ({ brain: { ...s.brain, entryScore: 73 } }))
    const { container } = render(<BrainPulseCard />)
    expect(container.textContent).toContain('73')
  })

  it('shows entry readiness from brain.entryReady', () => {
    useBrainStore.setState((s: any) => ({ brain: { ...s.brain, entryReady: true } }))
    const { container } = render(<BrainPulseCard />)
    // 'ready' alone would match the LABEL 'Entry ready' and pass for the wrong
    // reason, which is exactly what it did before this was tightened.
    expect(container.textContent).toContain('YES')
  })

  it('counts the passed gates from brain.gates', () => {
    useBrainStore.setState((s: any) => ({
      brain: { ...s.brain, gates: { a: true, b: true, c: false } },
    }))
    const { container } = render(<BrainPulseCard />)
    expect(container.textContent).toMatch(/2\s*\/\s*3|2 of 3/)
  })

  it('still renders an em dash when the store really is empty', () => {
    // The dash must mean "no data", which is only true once the card looks in
    // the right place.
    const { container } = render(<BrainPulseCard />)
    expect(container.textContent).toContain('—')
  })
})
