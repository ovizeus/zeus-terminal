/**
 * [2026-10-10] Task 3 — the Auto Trade configuration drawer.
 *
 * DESIGN DEVIATION FROM THE PLAN'S EXAMPLE TEST (deliberate, verified): the
 * plan expected "renders nothing when not visible". But legacy code reads these
 * inputs by DOM id (core/config.ts saveUserSettings uses _iv('atSL', 1.5) etc.,
 * which silently falls back to DEFAULTS when the element is missing, and would
 * persist those defaults over the user's settings). So the drawer stays mounted
 * and merely hidden, exactly like every ModalOverlay ("always in DOM so old JS
 * can find elements by ID"). It is portaled to document.body so the Auto Trade
 * panel body itself holds no setting control.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { AutoTradeConfigDrawer, type ATConfigFormProps } from '../AutoTradeConfigDrawer'

const noop = () => {}
function makeForm(over: Partial<ATConfigFormProps> = {}): ATConfigFormProps {
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
    symPickerOpen: false, setSymPickerOpen: noop, mscanLabel: 'ACTIVE — 1 symbols',
    ui: {
      condConf: '—', condConfClass: 'at-cond-val wait', condSig: '—', condSigClass: 'at-cond-val wait',
      modeDisplay: { icon: null, text: 'DEMO MODE', lockSuffix: false, color: '#aa44ff', border: '#aa44ff44' },
    },
    ...over,
  }
}
const drawer = (props: Partial<{ visible: boolean; onClose: () => void; onSave: () => void }> = {}, form = makeForm()) =>
  render(<AutoTradeConfigDrawer visible onClose={noop} form={form} {...props} />)

describe('AutoTradeConfigDrawer', () => {
  it('is hidden when not visible but STAYS in the DOM, so legacy getElementById readers still find the inputs', () => {
    drawer({ visible: false })
    const overlay = document.getElementById('matcfg') as HTMLElement
    expect(overlay).toBeTruthy()
    expect(overlay.style.display).toBe('none')
    expect(document.getElementById('atSL')).toBeTruthy()
    expect(document.getElementById('atSmartExit')).toBeTruthy()
    expect(document.getElementById('atMultiSym')).toBeTruthy()
  })

  it('offers the four tabs', () => {
    drawer()
    for (const t of ['Symbols', 'Entry', 'Risk', 'Advanced']) {
      expect(screen.getByRole('tab', { name: t })).toBeTruthy()
    }
  })

  it('shows one tab panel at a time and switches on click', () => {
    drawer()
    const risk = screen.getByRole('tab', { name: 'Risk' })
    fireEvent.click(risk)
    expect(risk.getAttribute('aria-selected')).toBe('true')
    expect(screen.getByRole('tab', { name: 'Entry' }).getAttribute('aria-selected')).toBe('false')
    const panels = Array.from(document.querySelectorAll<HTMLElement>('[role="tabpanel"]'))
    expect(panels.filter((p) => !p.hidden).length).toBe(1)
  })

  it('carries every moved control by its original id', () => {
    drawer()
    for (const id of ['atConfMin', 'atSigMin', 'atSize', 'atRiskPct', 'atMaxDay', 'atMaxPos', 'atSL', 'atRR',
      'atKillPct', 'atLossStreak', 'atMaxAddon', 'atLev', 'atAdaptEnabled', 'atAdaptLive', 'atSmartExit',
      'atMultiSym', 'atSymbolSection', 'atSymbolGrid', 'atMscanRow']) {
      expect(document.getElementById(id), id).toBeTruthy()
    }
  })

  it('binds a moved input to the value and setter it was given (logic moved, not rewritten)', () => {
    const setAtSL = vi.fn()
    drawer({}, makeForm({ atSL: '2.5', setAtSL }))
    const sl = document.getElementById('atSL') as HTMLInputElement
    expect(sl.value).toBe('2.5')
    fireEvent.change(sl, { target: { value: '3' } })
    expect(setAtSL).toHaveBeenCalledWith('3')
  })

  it('Save calls onSave and then closes', () => {
    const onSave = vi.fn(); const onClose = vi.fn()
    drawer({ onSave, onClose })
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }))
    expect(onSave).toHaveBeenCalledTimes(1)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('labels the live-adaptive control as the dangerous one', () => {
    drawer()
    expect(screen.getByLabelText(/allow live position adjustment/i)).toBeTruthy()
  })
})
