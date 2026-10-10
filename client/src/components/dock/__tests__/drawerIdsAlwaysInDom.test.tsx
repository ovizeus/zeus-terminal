import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { AutoTradeConfigDrawer, type ATConfigFormProps } from '../AutoTradeConfigDrawer'

// [LOGIC AUDIT 2026-10-10] The most dangerous failure mode left in this
// redesign, and the one no visual check would reveal.
//
// core/config.ts builds the Auto Trade settings by reading the DOM BY ID:
//
//   lev: _iv('atLev', 5), sl: _iv('atSL', 1.5), ...
//   const _iv = (id, def) => { const el = getElementById(id); return el ? ... : def }
//
// A missing element does not fail. It returns the DEFAULT, and the next save
// writes that default over the operator's real setting — silently. That is the
// R-C-6 clobber class, which destroyed eight keys earlier today and which the
// live database shows has been quietly nulling manualLive for all nine users.
//
// Moving the settings into a tabbed drawer created two new ways to trigger it:
//   1. unmounting the drawer when closed (avoided: it stays mounted, hidden);
//   2. rendering only the ACTIVE tab, which would hide the Risk inputs whenever
//      any other tab is selected.
//
// The second is what this test pins. The tab panels must use the `hidden`
// ATTRIBUTE, never conditional rendering, so every id is in the DOM no matter
// which tab is on screen.

// Every id core/config.ts reads for the Auto Trade block.
const LEGACY_IDS = [
  'atLev', 'atSL', 'atRR', 'atSize', 'atMaxPos', 'atKillPct', 'atRiskPct',
  'atMaxDay', 'atLossStreak', 'atMaxAddon', 'atConfMin', 'atSigMin',
  'atMultiSym', 'atSmartExit',
]

const noop = () => {}
// Same shape the drawer's own test uses — the panel owns this state and passes
// it down as one prop.
function makeForm(): ATConfigFormProps {
  return {
    confMin: '65', setConfMin: noop, sigMin: '3', setSigMin: noop,
    atSize: '200', setAtSize: noop, atRiskPct: '1', setAtRiskPct: noop,
    atMaxDay: '5', setAtMaxDay: noop, atMaxPos: '3', setAtMaxPos: noop,
    atSL: '1.5', setAtSL: noop, atRR: '2', setAtRR: noop,
    atKillPct: '5', setAtKillPct: noop, atLossStreak: '3', setAtLossStreak: noop,
    atMaxAddon: '2', setAtMaxAddon: noop, atLev: '5', setAtLev: noop, commitLev: noop,
    adaptEnabled: false, setAdaptEnabled: noop, adaptLive: false, setAdaptLive: noop,
    smartExit: false, setSmartExit: noop,
    mscanEnabled: true, setMscanEnabled: noop, mscanSyms: ['BTCUSDT'], toggleSym: noop, pickAll: noop,
    symPickerOpen: false, setSymPickerOpen: noop, mscanLabel: 'ACTIVE \u2014 1 symbols',
    ui: {
      condConf: '\u2014', condConfClass: 'at-cond-val wait', condSig: '\u2014', condSigClass: 'at-cond-val wait',
      modeDisplay: { icon: null, text: 'DEMO MODE', lockSuffix: false, color: '#aa44ff', border: '#aa44ff44' },
    },
  } as ATConfigFormProps
}

beforeEach(() => {
  vi.clearAllMocks()
  ;(window as any).S = { symbol: 'BTCUSDT', overlays: {}, activeInds: {}, indicators: {} }
})

describe('every setting the legacy save reads stays in the DOM', () => {
  it('finds all of them on the default tab', () => {
    const { baseElement } = render(<AutoTradeConfigDrawer visible onClose={noop} form={makeForm()} />)
    const missing = LEGACY_IDS.filter((id) => !baseElement.querySelector(`#${id}`))
    expect(missing).toEqual([])
  })

  it.each(['Symbols', 'Entry', 'Risk', 'Advanced'])(
    'still finds all of them with the %s tab selected',
    (tabName) => {
      const { baseElement } = render(<AutoTradeConfigDrawer visible onClose={noop} form={makeForm()} />)
      fireEvent.click(screen.getByRole('tab', { name: tabName }))
      const missing = LEGACY_IDS.filter((id) => !baseElement.querySelector(`#${id}`))
      expect(missing).toEqual([])
    },
  )

  it('hides inactive panels with the hidden ATTRIBUTE, not by unmounting', () => {
    // The mechanism matters: conditional rendering would pass the assertions
    // above only for the active tab and silently clobber the rest.
    const { baseElement } = render(<AutoTradeConfigDrawer visible onClose={noop} form={makeForm()} />)
    const panes = Array.from(baseElement.querySelectorAll('[role="tabpanel"]'))
    expect(panes.length).toBe(4)
    expect(panes.filter((p) => p.hasAttribute('hidden')).length).toBe(3)
  })
})
