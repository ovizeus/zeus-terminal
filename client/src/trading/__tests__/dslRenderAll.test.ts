import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { renderDSLWidget, runDSLBrain } from '../dsl'
import { DSL } from '../../core/config'
import { useATStore } from '../../stores/atStore'
import { usePositionsStore } from '../../stores/positionsStore'

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

  // [2026-06-14] renderDSLWidget is called from paths that pass RAW w.TP positions
  // (e.g. _pushDslPosition in positions.ts), bypassing _collectDslPositions. A
  // limbo (autoTrade:null) live position therefore rendered as a "PAPER" card.
  // Reclassify at the render choke point so EVERY caller gets the correct AT label.
  it('labels a limbo (autoTrade:null) live position as AT when the server snapshot confirms it', () => {
    useATStore.setState({ mode: 'live' })
    w._lastServerPositions = [{ symbol: 'BNBUSDT', side: 'SHORT', autoTrade: true }]
    const pos = { id: 'BNBUSDT_SHORT_16.05', sym: 'BNBUSDT', side: 'SHORT', mode: 'live', isLive: true, autoTrade: null, sourceMode: 'unknown', entry: 605, size: 100, lev: 10, sl: 610, tp: 590 }
    renderDSLWidget([pos] as any)
    const container = document.getElementById('dslPositionCards')!
    const srcSpan = container.querySelector('.dsl-pos-card span')
    expect(srcSpan?.textContent || '').toMatch(/^AT\b/)
    expect(srcSpan?.textContent || '').not.toMatch(/PAPER/)
    delete w._lastServerPositions
    useATStore.setState({ mode: 'demo' })
  })

  // [2026-06-14] When the DSL engine is OFF, runDSLBrain's legacy branch used to
  // `return` without rendering, freezing the panel on its last (possibly
  // boot-race-mislabeled) render until a DSL on/off toggle. It must still render.
  it('runDSLBrain renders positions even when the DSL engine is OFF', () => {
    DSL.enabled = false
    w._serverATEnabled = false
    w._SAFETY = {}
    w.S = w.S || {}
    useATStore.setState({ mode: 'demo' })
    usePositionsStore.setState({
      demoPositions: [{ id: 'x1', sym: 'BTCUSDT', side: 'LONG', mode: 'demo', autoTrade: false, entry: 60000, size: 100, lev: 10, sl: 59000, tp: 62000 }] as any,
      livePositions: [],
    })
    runDSLBrain()
    const container = document.getElementById('dslPositionCards')!
    expect(container.querySelectorAll('.dsl-pos-card').length).toBe(1)
    DSL.enabled = true
    delete w._serverATEnabled
    usePositionsStore.setState({ demoPositions: [], livePositions: [] })
  })
})
