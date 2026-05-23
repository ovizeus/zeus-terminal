import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { BrainCockpit } from '../brain/BrainCockpit'
import { useBrainStatsStore, BRAIN_NEURON_IDS } from '../../stores/brainStatsStore'

describe('BrainCockpit', () => {
  // [FIX1] Original labels CONFLUENCE/PHASE FILTER were removed in ZT5-F dead-
  // id cleanup. Check labels that actually live in the static shell post-ZT.
  it('renders static shell labels', () => {
    render(<BrainCockpit />)
    expect(screen.getByText('REGIME')).toBeInTheDocument()
    expect(screen.getByText('CONTEXT GATES')).toBeInTheDocument()
    expect(screen.getByText('FLOW INSIGHT')).toBeInTheDocument()
    expect(screen.getByText('DSL STATUS')).toBeInTheDocument()
    expect(screen.getByText('THREAT RADAR')).toBeInTheDocument()
    expect(screen.getByText('ATMOSPHERE')).toBeInTheDocument()
  })

  // [FIX1] Original test targeted useBrainStore.brain.danger but the right-
  // column subscribes to useBrainStatsStore (ZT5). The "danger number" is
  // written by legacy engine/brain.ts at runtime, not available in JSDOM.
  // Replacement: verify the store-driven regime badge picks up className +
  // text from the snapshot.
  it('regime badge reflects store snapshot (danger tone)', () => {
    useBrainStatsStore.setState((s) => ({
      snapshot: {
        ...s.snapshot,
        regimeBadge2: { cls: 'znc-regime-val danger', innerHtml: 'RISK' },
      },
    }))
    render(<BrainCockpit />)
    const badge = document.getElementById('brainRegimeBadge2')
    expect(badge).not.toBeNull()
    expect(badge!.className).toContain('danger')
    expect(badge!.textContent).toContain('RISK')
  })

  // [FIX1] Neuron labels ("RSI"/"MACD"/"OFI") live inside an empty <span></span>
  // in NeuronsRow and are filled at runtime by legacy engine/indicators.ts —
  // not available in JSDOM. The store-driven parts (id, className per state,
  // value text) are testable directly.
  it('neural grid renders one element per neuron id with store state/value', () => {
    const nState = {
      rsi:  { state: 'ok' as const,       val: '72' },
      macd: { state: 'fail' as const,     val: '-0.3' },
      st:   { state: 'wait' as const,     val: 'UP' },
      vol:  { state: 'ok' as const,       val: '1.3x' },
      fr:   { state: 'inactive' as const, val: '—' },
      mag:  { state: 'ok' as const,       val: 'NEAR' },
      reg:  { state: 'wait' as const,     val: 'TREND' },
      ofi:  { state: 'fail' as const,     val: '60%' },
    }
    useBrainStatsStore.setState((s) => ({
      snapshot: { ...s.snapshot, neurons: nState },
    }))
    render(<BrainCockpit />)
    for (const n of BRAIN_NEURON_IDS) {
      const cell = document.getElementById(`bn-${n}`)
      expect(cell, `neuron cell bn-${n} must exist`).not.toBeNull()
      expect(cell!.className).toContain(nState[n].state)
      const valEl = document.getElementById(`bnv-${n}`)
      expect(valEl?.textContent).toBe(nState[n].val)
    }
  })
})
