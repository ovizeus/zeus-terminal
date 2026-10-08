/**
 * Zeus Terminal — Unit Tests: ModeBar (NEON PULSE redesign 2026-05-14)
 *
 * Snapshot tests verifying that ModeBar renders `data-zmb-mode` attribute
 * correctly across all 4 mode states. CSS animations + glow attached via
 * `app.css` `#zeus-mode-bar[data-zmb-mode="..."]` selectors.
 *
 * Spec: _review/audit/MODEBAR_REDESIGN_20260514.md §6.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { render } from '@testing-library/react'
import { ModeBar } from '../layout/ModeBar'
import { useATStore, useUiStore, usePositionsStore } from '../../stores'

function makePos(overrides: Partial<{ mode: string; closed: boolean; status: string }> = {}) {
    return {
        seq: 1, symbol: 'BTCUSDT', side: 'LONG', size: 100, lev: 5,
        price: 50000, sl: 0, tp: 0, autoTrade: false,
        mode: 'demo', closed: false, status: 'OPEN',
        ...overrides,
    } as any
}

describe('ModeBar (NEON PULSE redesign)', () => {
    beforeEach(() => {
        useATStore.setState(useATStore.getInitialState())
        useUiStore.setState(useUiStore.getInitialState())
    })

    it('renders data-zmb-mode="demo" when engineMode=demo', () => {
        useATStore.setState({ mode: 'demo' })
        const { container } = render(<ModeBar />)
        const bar = container.querySelector('#zeus-mode-bar')
        expect(bar).toBeInTheDocument()
        expect(bar?.getAttribute('data-zmb-mode')).toBe('demo')
    })

    it('renders data-zmb-mode="testnet" when engineMode=live + executionEnv=TESTNET', () => {
        useATStore.setState({ mode: 'live' })
        useUiStore.setState({ executionEnv: 'TESTNET' })
        const { container } = render(<ModeBar />)
        expect(container.querySelector('#zeus-mode-bar')?.getAttribute('data-zmb-mode')).toBe('testnet')
    })

    it('renders data-zmb-mode="real" when engineMode=live + executionEnv=REAL', () => {
        useATStore.setState({ mode: 'live' })
        useUiStore.setState({ executionEnv: 'REAL' })
        const { container } = render(<ModeBar />)
        expect(container.querySelector('#zeus-mode-bar')?.getAttribute('data-zmb-mode')).toBe('real')
    })

    it('renders data-zmb-mode="locked" when engineMode=live + executionEnv=null', () => {
        useATStore.setState({ mode: 'live' })
        useUiStore.setState({ executionEnv: null })
        const { container } = render(<ModeBar />)
        expect(container.querySelector('#zeus-mode-bar')?.getAttribute('data-zmb-mode')).toBe('locked')
    })

    it('keeps existing className barClass alongside data-zmb-mode (zero regression)', () => {
        useATStore.setState({ mode: 'demo' })
        const { container } = render(<ModeBar />)
        const bar = container.querySelector('#zeus-mode-bar')
        expect(bar?.className).toContain('zeus-mode-bar')
        expect(bar?.className).toContain('zmb-demo')
    })

    // [2026-10-07] This block used to assert a hard-disable: the mode-switch
    // button was blocked while opposite-mode positions were open (BUG-T3+T7,
    // 2026-05-17). The operator REVERSED that on 2026-05-18 — demo and live are
    // independent sandboxes, positions keep running on their own side, and the
    // confirm dialog already surfaces the count. ModeBar has carried
    // `hardDisableForOppositePositions = false` ever since, so the old
    // assertions were testing a feature that no longer exists by design and had
    // been failing silently among the other red tests. Rewritten to pin the
    // CURRENT contract instead: switching stays available.
    describe('mode switch stays enabled with opposite-mode positions (hard-disable reversed 2026-05-18)', () => {
        beforeEach(() => {
            usePositionsStore.setState({ demoPositions: [], livePositions: [] })
        })

        it('enabled when no opposite-mode positions exist', () => {
            useATStore.setState({ mode: 'demo' })
            useUiStore.setState({ executionEnv: 'TESTNET' })
            usePositionsStore.setState({ demoPositions: [], livePositions: [] })
            const { container } = render(<ModeBar />)
            const btn = container.querySelector('#zmbBtn') as HTMLButtonElement | null
            expect(btn?.disabled).toBe(false)
        })

        it('STILL enabled on demo with open live positions', () => {
            useATStore.setState({ mode: 'demo' })
            useUiStore.setState({ executionEnv: 'TESTNET' })
            usePositionsStore.setState({
                demoPositions: [],
                livePositions: [makePos({ mode: 'live', closed: false })],
            })
            const { container } = render(<ModeBar />)
            const btn = container.querySelector('#zmbBtn') as HTMLButtonElement | null
            expect(btn?.disabled).toBe(false)
        })

        it('STILL enabled on live with open demo positions', () => {
            useATStore.setState({ mode: 'live' })
            useUiStore.setState({ executionEnv: 'TESTNET' })
            usePositionsStore.setState({
                demoPositions: [makePos({ mode: 'demo', closed: false })],
                livePositions: [],
            })
            const { container } = render(<ModeBar />)
            const btn = container.querySelector('#zmbBtn') as HTMLButtonElement | null
            expect(btn?.disabled).toBe(false)
        })

        it('carries no lock tooltip or lock class any more', () => {
            useATStore.setState({ mode: 'demo' })
            useUiStore.setState({ executionEnv: 'TESTNET' })
            usePositionsStore.setState({
                demoPositions: [],
                livePositions: [makePos({ mode: 'live', closed: false })],
            })
            const { container } = render(<ModeBar />)
            const btn = container.querySelector('#zmbBtn') as HTMLButtonElement | null
            expect(btn?.getAttribute('title')).toBeFalsy()
            expect(btn?.className || '').not.toContain('zmb-btn-disabled-locked')
        })
    })

    describe('BUG-T7 opposite-mode AT visibility badge', () => {
        beforeEach(() => {
            usePositionsStore.setState({ demoPositions: [], livePositions: [] })
            useATStore.setState({
                mode: 'demo', enabled: false,
                _serverDemoStats: null, _serverLiveStats: null,
            } as any)
            useUiStore.setState({ executionEnv: 'TESTNET' })
        })

        it('shows opposite-mode AT badge when current=demo + opposite live AT is enabled', () => {
            useATStore.setState({ mode: 'demo', enabled: false } as any)
            useUiStore.setState({ executionEnv: 'TESTNET', oppositeModeAtEnabled: true } as any)
            const { container } = render(<ModeBar />)
            const badge = container.querySelector('[data-zmb-opp-at-badge]')
            expect(badge).toBeInTheDocument()
            expect(badge?.textContent || '').toMatch(/LIVE.*AT.*ON/i)
        })

        it('shows opposite-mode AT badge when current=live + opposite demo AT is enabled', () => {
            useATStore.setState({ mode: 'live', enabled: false } as any)
            useUiStore.setState({ executionEnv: 'TESTNET', oppositeModeAtEnabled: true } as any)
            const { container } = render(<ModeBar />)
            const badge = container.querySelector('[data-zmb-opp-at-badge]')
            expect(badge).toBeInTheDocument()
            expect(badge?.textContent || '').toMatch(/DEMO.*AT.*ON/i)
        })

        it('hides badge when opposite mode AT is off', () => {
            useATStore.setState({ mode: 'demo', enabled: true } as any)
            useUiStore.setState({ executionEnv: 'TESTNET', oppositeModeAtEnabled: false } as any)
            const { container } = render(<ModeBar />)
            const badge = container.querySelector('[data-zmb-opp-at-badge]')
            expect(badge).not.toBeInTheDocument()
        })
    })
})
