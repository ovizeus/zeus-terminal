/**
 * Zeus Terminal — Unit Tests: ManualTradePanel opposite-mode banner (BUG-T3 FIX)
 *
 * Verifies the persistent banner visible when opposite-mode open positions
 * exist — the visual surface that prevents forgotten unprotected exposure
 * after engine-mode switch.
 *
 * Coverage:
 *   - engineMode=live + N>0 demo positions → banner visible with count + DEMO label
 *   - engineMode=demo + N>0 live positions → banner visible with count + LIVE label
 *   - opposite count = 0 → banner NOT in DOM
 *   - singular vs plural phrasing
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ManualTradePanel } from '../dock/ManualTradePanel'
import { useATStore, usePositionsStore, useUiStore } from '../../stores'

// Mock heavy side-effect imports the panel pulls in (autotrade, storage,
// market data) — they're not under test here and would touch globals.
vi.mock('../../services/storage', async (importOriginal) => {
    const actual: any = await importOriginal()
    return { ...actual, exportJournalCSV: vi.fn() }
})
vi.mock('../../trading/autotrade', async (importOriginal) => {
    const actual: any = await importOriginal()
    return { ...actual, closeAllDemoPos: vi.fn() }
})
vi.mock('../../data/marketDataTrading', async (importOriginal) => {
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
vi.mock('../../engine/events', async (importOriginal) => {
    const actual: any = await importOriginal()
    return { ...actual, attachConfirmClose: vi.fn() }
})

const livePos = (id: number) => ({
    seq: id, symbol: 'BTCUSDT', side: 'LONG', size: 100, lev: 10, price: 80000,
    sl: 79000, tp: 82000, mode: 'live', autoTrade: false, status: 'OPEN', closed: false,
})
const demoPos = (id: number) => ({
    seq: id, symbol: 'ETHUSDT', side: 'SHORT', size: 200, lev: 10, price: 3000,
    sl: 3100, tp: 2900, mode: 'demo', autoTrade: false, status: 'OPEN', closed: false,
})

describe('ManualTradePanel BUG-T3 opposite-mode banner', () => {
    beforeEach(() => {
        useATStore.setState(useATStore.getInitialState())
        usePositionsStore.setState(usePositionsStore.getInitialState())
        useUiStore.setState(useUiStore.getInitialState())
    })

    it('shows banner with LIVE count + label when engineMode=demo and live positions exist', () => {
        useATStore.setState({ mode: 'demo' })
        usePositionsStore.setState({
            livePositions: [livePos(1), livePos(2), livePos(3)] as any,
            demoPositions: [],
        })
        render(<ManualTradePanel />)
        const banner = screen.getByTestId('bug-t3-opposite-mode-banner')
        expect(banner).toBeInTheDocument()
        expect(banner.textContent).toMatch(/3\s+LIVE positions/)
        expect(banner.textContent?.toLowerCase()).toContain('hidden')
    })

    it('shows banner with DEMO label when engineMode=live and demo positions exist', () => {
        useATStore.setState({ mode: 'live' })
        usePositionsStore.setState({
            livePositions: [],
            demoPositions: [demoPos(1), demoPos(2)] as any,
        })
        render(<ManualTradePanel />)
        const banner = screen.getByTestId('bug-t3-opposite-mode-banner')
        expect(banner).toBeInTheDocument()
        expect(banner.textContent).toMatch(/2\s+DEMO positions/)
    })

    it('uses singular phrasing for count=1', () => {
        useATStore.setState({ mode: 'demo' })
        usePositionsStore.setState({
            livePositions: [livePos(1)] as any,
            demoPositions: [],
        })
        render(<ManualTradePanel />)
        const banner = screen.getByTestId('bug-t3-opposite-mode-banner')
        expect(banner.textContent).toMatch(/1\s+LIVE position\b/)
        expect(banner.textContent).not.toMatch(/positions/)
    })

    it('does NOT render banner when no opposite-mode positions exist', () => {
        useATStore.setState({ mode: 'demo' })
        usePositionsStore.setState({
            livePositions: [],
            demoPositions: [demoPos(1)] as any, // current-mode positions are fine
        })
        render(<ManualTradePanel />)
        expect(screen.queryByTestId('bug-t3-opposite-mode-banner')).toBeNull()
    })

    it('excludes closed positions from count', () => {
        useATStore.setState({ mode: 'demo' })
        usePositionsStore.setState({
            livePositions: [livePos(1), { ...livePos(2), closed: true }] as any,
            demoPositions: [],
        })
        render(<ManualTradePanel />)
        const banner = screen.getByTestId('bug-t3-opposite-mode-banner')
        expect(banner.textContent).toMatch(/1\s+LIVE position\b/)
    })
})
