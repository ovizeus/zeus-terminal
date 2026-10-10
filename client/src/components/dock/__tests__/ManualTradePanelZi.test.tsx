/**
 * [2026-10-10] Institutional rebuild of the Manual Trade panel — Task 2.
 *
 * "doar design, logica tot aia": these tests assert the FRAME (built on the
 * shared zi primitives) AND that every money-path control survived the
 * restyle. The rows are components in PositionRows.tsx holding closeLivePos /
 * savePosSLTP / cancelPendingOrder / modifyPendingPrice call sites; the
 * original plan would have replaced them with inert cells. They must stay.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, act, fireEvent } from '@testing-library/react'
import { ManualTradePanel } from '../ManualTradePanel'
import { LivePositionRow, DemoPositionRow, PendingOrderRow } from '../PositionRows'
import { useATStore, usePositionsStore, useUiStore } from '../../../stores'
import { POSITION_COLUMNS } from '../../zi'

vi.mock('../../../services/storage', async (importOriginal) => {
  const actual: any = await importOriginal()
  return { ...actual, exportJournalCSV: vi.fn() }
})
vi.mock('../../../trading/autotrade', async (importOriginal) => {
  const actual: any = await importOriginal()
  return { ...actual, closeAllDemoPos: vi.fn() }
})
vi.mock('../../../data/marketDataTrading', async (importOriginal) => {
  const actual: any = await importOriginal()
  return {
    ...actual,
    onDemoLevChange: vi.fn(),
    placeDemoOrder: vi.fn(),
    onDemoOrdTypeChange: vi.fn(),
    promptResetDemo: vi.fn(),
    promptAddFunds: vi.fn(),
  }
})
vi.mock('../../../engine/events', async (importOriginal) => {
  const actual: any = await importOriginal()
  return { ...actual, attachConfirmClose: vi.fn() }
})
vi.mock('../../../data/marketDataPositions', async (importOriginal) => {
  const actual: any = await importOriginal()
  return {
    ...actual,
    getSymPrice: vi.fn(() => 81000),
    closeLivePos: vi.fn(),
    calcPosPnL: vi.fn(() => 50),
    savePosSLTP: vi.fn(),
    cancelPendingOrder: vi.fn(),
    modifyPendingPrice: vi.fn(),
  }
})
vi.mock('../../../data/marketDataHelpers', () => ({
  toast: vi.fn(),
  fmtNow: vi.fn(() => '12:00:00'),
}))

import { getSymPrice, closeLivePos, savePosSLTP, cancelPendingOrder, modifyPendingPrice } from '../../../data/marketDataPositions'

const livePos = (id: number) => ({
  id, seq: id, sym: 'BTCUSDT', side: 'LONG', entry: 80000, lev: 5,
  size: 100, qty: 0.006, tp: 82000, sl: 79000, liqPrice: 70000,
  mode: 'live', autoTrade: false, status: 'OPEN', closed: false, pnl: 50,
})
const demoPos = (id: number) => ({ ...livePos(id), mode: 'demo' })
const pendingOrd = (id: number) => ({
  id, sym: 'BTCUSDT', side: 'LONG', lev: 5, limitPrice: 79000, size: 100,
  mode: 'demo', status: 'WAITING', createdAt: Date.now(),
})

const ACTION_TRACK_AFTER_SHARED = POSITION_COLUMNS.map((c) => c.width).join(' ')

beforeEach(() => {
  vi.clearAllMocks()
  ;(window as any).allPrices = { BTCUSDT: 81000 }
  useATStore.setState(useATStore.getInitialState())
  usePositionsStore.setState(usePositionsStore.getInitialState())
  useUiStore.setState(useUiStore.getInitialState())
})

describe('Manual Trade panel, rebuilt on the zi primitives', () => {
  it('is gated behind the .zi theme class', () => {
    const { container } = render(<ManualTradePanel />)
    expect(container.querySelector('.zi')).toBeTruthy()
  })

  it('keeps #panelDemo as the node that carries the .zi gate (legacy code moves it by id)', () => {
    const { container } = render(<ManualTradePanel />)
    const panel = container.querySelector('#panelDemo') as HTMLElement
    expect(panel).toBeTruthy()
    expect(panel.querySelector('.zi')).toBeTruthy()
  })

  it('draws the positions through the SHARED column template, with the action cell after it', () => {
    useATStore.setState({ mode: 'demo' })
    usePositionsStore.setState({ demoPositions: [demoPos(1)] as any })
    const { container } = render(<ManualTradePanel />)
    const grids = Array.from(container.querySelectorAll<HTMLElement>('[data-zi-grid]'))
    const posGrids = grids.filter((g) => g.style.gridTemplateColumns.startsWith(ACTION_TRACK_AFTER_SHARED))
    // header + the one position row
    expect(posGrids.length).toBeGreaterThanOrEqual(2)
  })

  it('draws the journal through the SHARED journal template', () => {
    useATStore.setState({ mode: 'demo' })
    usePositionsStore.setState({
      journal: [{ id: 1, sym: 'BTCUSDT', side: 'LONG', entry: 1, exit: 2, pnl: 5, time: '10:00', mode: 'demo', journalEvent: 'CLOSE', closedAt: 5 }] as any,
    })
    const { container } = render(<ManualTradePanel />)
    const grids = Array.from(container.querySelectorAll<HTMLElement>('[data-zi-grid]'))
    expect(grids.filter((g) => g.style.gridTemplateColumns === '46px 1fr 56px').length).toBeGreaterThanOrEqual(2)
  })

  it('still labels every id-bearing input, so the order ticket stays usable', () => {
    useATStore.setState({ mode: 'demo' })
    usePositionsStore.setState({ demoPositions: [demoPos(1)] as any })
    const { container } = render(<ManualTradePanel />)
    const inputs = Array.from(container.querySelectorAll('input'))
    expect(inputs.length).toBeGreaterThan(0)
    for (const input of inputs) {
      const id = input.getAttribute('id')
      if (!id) continue
      expect(container.querySelector(`label[for="${id}"]`), `label for #${id}`).toBeTruthy()
    }
  })

  it('keeps every id the legacy engine looks up by id', () => {
    const { container } = render(<ManualTradePanel />)
    for (const id of [
      'panelDemo', 'demoBalance', 'btnAddFunds', 'btnResetDemo', 'demoLongBtn', 'demoShortBtn',
      'demoOrdType', 'demoMarginMode', 'demoLev', 'demoEntry', 'demoEntryLabel', 'demoSize',
      'demoLiqPrice', 'demoTP', 'demoSL', 'demoExec', 'pendingOrdersTable', 'closeAllBtn',
      'demoPosTable', 'livePositionsInDemo', 'livePositionsDemo', 'journalBody', 'btnDemo', 'btnLive',
    ]) {
      expect(container.querySelector('#' + id), `#${id}`).toBeTruthy()
    }
  })

  it('renders an em dash, not an invented number, for an empty liquidation preview', () => {
    const { container } = render(<ManualTradePanel />)
    expect(container.querySelector('#demoLiqPrice')!.textContent).toBe('—')
  })
})

describe('money-path controls survive the restyle', () => {
  it('LivePositionRow: the CLOSE button exists, is a 52px touch target, sits in a zi grid, and still closes on the 2nd click', () => {
    const pos = livePos(1776859652887)
    render(<LivePositionRow pos={pos} />)
    const btn = screen.getByText(/✕ CLOSE/) as HTMLButtonElement
    expect(btn.tagName).toBe('BUTTON')
    expect(btn.style.minHeight).toBe('52px')
    expect(btn.closest('[data-zi-grid]')).toBeTruthy()
    act(() => { btn.click() })
    expect(closeLivePos).not.toHaveBeenCalled()
    act(() => { screen.getByText(/CONFIRM/).click() })
    expect(closeLivePos).toHaveBeenCalledTimes(1)
    expect(closeLivePos).toHaveBeenCalledWith(pos.id)
  })

  it('LivePositionRow: SAVE still calls savePosSLTP(id, "live")', () => {
    render(<LivePositionRow pos={livePos(7)} />)
    fireEvent.click(screen.getByText('SAVE'))
    expect(savePosSLTP).toHaveBeenCalledWith(7, 'live')
  })

  it('LivePositionRow: the close button survives the price-unavailable branch too', () => {
    ;(window as any).allPrices = {}
    vi.mocked(getSymPrice).mockReturnValue(0 as any)
    try {
      render(<LivePositionRow pos={livePos(8)} />)
      expect((screen.getByText(/✕ CLOSE/) as HTMLElement).style.minHeight).toBe('52px')
    } finally {
      vi.mocked(getSymPrice).mockReturnValue(81000 as any)
    }
  })

  it('DemoPositionRow: CLOSE (52px) and SAVE (savePosSLTP demo) both exist', () => {
    render(<DemoPositionRow pos={demoPos(3)} />)
    expect((screen.getByText(/✕ CLOSE/) as HTMLElement).style.minHeight).toBe('52px')
    fireEvent.click(screen.getByText('SAVE'))
    expect(savePosSLTP).toHaveBeenCalledWith(3, 'demo')
  })

  it('PendingOrderRow: CANCEL and MODIFY still call cancelPendingOrder / modifyPendingPrice', () => {
    render(<PendingOrderRow ord={pendingOrd(5)} />)
    fireEvent.click(screen.getByText(/CANCEL/))
    fireEvent.click(screen.getByText(/MODIFY/))
    expect(cancelPendingOrder).toHaveBeenCalledWith(5)
    expect(modifyPendingPrice).toHaveBeenCalledWith(5)
  })

  it('the panel renders the live position row inside live mode, close button included', () => {
    useATStore.setState({ mode: 'live' })
    usePositionsStore.setState({ livePositions: [livePos(11)] as any })
    render(<ManualTradePanel />)
    expect(screen.getByText(/^✕ CLOSE$/)).toBeInTheDocument()
  })
})
