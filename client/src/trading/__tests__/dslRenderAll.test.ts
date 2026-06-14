import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { renderDSLWidget } from '../dsl'
import { DSL } from '../../core/config'

const w = globalThis as any

// [2026-06-14] Bug: positions visible in the AT panel were missing from the DSL
// panel ("AT has 2 positions, DSL shows none"). Root cause: renderDSLWidget only
// rendered positions that had a DSL.positions[id] ATTACHMENT object; the AT panel
// renders the position array directly. When attachment lagged (id churn from
// qty-derived ids, or gated-off re-attach), positions silently vanished from DSL
// while staying in AT. Fix: the DSL panel renders ALL mode-filtered positions;
// unattached ones render as plain "WAITING" cards (native SL/TP).
describe('renderDSLWidget — renders positions even without a DSL attachment', () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="dslPositionCards"></div>'
    DSL.enabled = true
    DSL.positions = {}
    w.allPrices = {}
    w.wlPrices = {}
  })
  afterEach(() => {
    document.body.innerHTML = ''
    DSL.positions = {}
    delete w.allPrices
    delete w.wlPrices
  })

  it('renders a position card even when DSL.positions has no entry for it', () => {
    const pos = {
      id: 'BTCUSDT_SHORT_0.1', sym: 'BTCUSDT', side: 'SHORT',
      entry: 60000, size: 100, lev: 10, mode: 'demo', autoTrade: true,
      sl: 61000, tp: 58000,
    }
    renderDSLWidget([pos] as any)
    const container = document.getElementById('dslPositionCards')!
    // Before the fix: dslAttached is empty → WAITING radar, zero cards.
    expect(container.querySelectorAll('.dsl-pos-card').length).toBe(1)
    expect(container.querySelector('.dsl-radar-txt')).toBeNull()
  })

  it('still shows the WAITING radar when there are genuinely no positions', () => {
    renderDSLWidget([] as any)
    const container = document.getElementById('dslPositionCards')!
    expect(container.querySelectorAll('.dsl-pos-card').length).toBe(0)
    expect(container.querySelector('.dsl-radar-txt')).not.toBeNull()
  })
})
