/**
 * Zeus Terminal — Unit Tests: LivePositionRow close button React-native pattern
 *
 * BUG-CLOSE 2026-05-14: operator reported clicking ✕ CLOSE on LivePositionRow
 * does nothing visible. Root cause: attachConfirmClose() pattern mutated DOM
 * (`btn.innerHTML = '✓ CONFIRM?'`) but React reconciliation on price-tick
 * re-renders wiped innerHTML back. User saw NO visible state change → never
 * clicked second time to fire closeLivePos.
 *
 * Fix: refactor to React-native useState pattern — button text driven by
 * render, survives reconciliation. 2-click confirm UX preserved.
 *
 * Coverage:
 *   - First click: button shows "✓ CONFIRM?" (state-driven, persists across re-render)
 *   - Second click within window: closeLivePos called with pos.id
 *   - First click + 3s wait: button reverts to "✕ CLOSE"
 *   - Two independent positions: clicking one doesn't affect other
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import { LivePositionRow } from '../dock/PositionRows'

vi.mock('../../data/marketDataPositions', async (importOriginal) => {
    const actual: any = await importOriginal()
    return {
        ...actual,
        getSymPrice: vi.fn(() => 81000),
        closeLivePos: vi.fn(),
        calcPosPnL: vi.fn(() => 50),
        savePosSLTP: vi.fn(),
    }
})

vi.mock('../../engine/events', async (importOriginal) => {
    const actual: any = await importOriginal()
    return { ...actual, attachConfirmClose: vi.fn() }
})

import { closeLivePos } from '../../data/marketDataPositions'

const livePos = (id: number, sym = 'BTCUSDT', overrides: any = {}) => ({
    id, seq: id, sym, side: 'LONG', entry: 80000, lev: 5,
    size: 100, qty: 0.006, tp: 82000, sl: 79000, liqPrice: 70000,
    mode: 'live', autoTrade: false, status: 'OPEN', closed: false,
    pnl: 50,
    ...overrides,
})

describe('LivePositionRow close button (BUG-CLOSE FIX)', () => {
    beforeEach(() => {
        vi.useFakeTimers()
        ;(closeLivePos as any).mockReset()
        // Populate window.allPrices so _getCurPrice returns price (price-available path)
        ;(window as any).allPrices = { BTCUSDT: 81000 }
    })

    it('first click switches button text to "CONFIRM?" via React render', () => {
        const pos = livePos(1776859652887)
        render(<LivePositionRow pos={pos} />)
        const btn = screen.getByText(/✕ CLOSE/i)
        expect(btn).toBeInTheDocument()
        act(() => { btn.click() })
        // After first click, button text should switch (state-driven, NOT DOM mutation)
        expect(screen.getByText(/CONFIRM/i)).toBeInTheDocument()
        expect(closeLivePos).not.toHaveBeenCalled()
    })

    it('second click within window fires closeLivePos with pos.id', () => {
        const pos = livePos(1776859652887)
        render(<LivePositionRow pos={pos} />)
        const btn = screen.getByText(/✕ CLOSE/i)
        act(() => { btn.click() })
        const confirmBtn = screen.getByText(/CONFIRM/i)
        act(() => { confirmBtn.click() })
        expect(closeLivePos).toHaveBeenCalledTimes(1)
        expect(closeLivePos).toHaveBeenCalledWith(pos.id)
    })

    it('first click + 3s timeout reverts button to "✕ CLOSE"', () => {
        const pos = livePos(1776859652887)
        render(<LivePositionRow pos={pos} />)
        const btn = screen.getByText(/✕ CLOSE/i)
        act(() => { btn.click() })
        expect(screen.getByText(/CONFIRM/i)).toBeInTheDocument()
        // After 3s wait (longer than 2.5s timeout), button should revert
        act(() => { vi.advanceTimersByTime(3000) })
        expect(screen.queryByText(/CONFIRM/i)).toBeNull()
        expect(screen.getByText(/✕ CLOSE/i)).toBeInTheDocument()
        expect(closeLivePos).not.toHaveBeenCalled()
    })

    it('two positions: clicking one does not affect the other', () => {
        const posA = livePos(1, 'BTCUSDT')
        const posB = livePos(2, 'BTCUSDT', { side: 'SHORT' })
        const { rerender: _r } = render(
            <>
                <LivePositionRow pos={posA} />
                <LivePositionRow pos={posB} />
            </>
        )
        // First position click — should change ONLY that button
        const closeButtons = screen.getAllByText(/✕ CLOSE/i)
        expect(closeButtons).toHaveLength(2)
        act(() => { closeButtons[0].click() })
        // Now exactly one CONFIRM and one CLOSE button visible
        expect(screen.getAllByText(/CONFIRM/i)).toHaveLength(1)
        expect(screen.getAllByText(/✕ CLOSE/i)).toHaveLength(1)
        expect(closeLivePos).not.toHaveBeenCalled()
    })
})
