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

    describe('BUG-T3+T7 hard-disable mode switch on opposite-mode positions', () => {
        beforeEach(() => {
            usePositionsStore.setState({ demoPositions: [], livePositions: [] })
        })

        it('button enabled when no opposite-mode positions exist (demo current, no live positions)', () => {
            useATStore.setState({ mode: 'demo' })
            useUiStore.setState({ executionEnv: 'TESTNET' })
            usePositionsStore.setState({ demoPositions: [], livePositions: [] })
            const { container } = render(<ModeBar />)
            const btn = container.querySelector('#zmbBtn') as HTMLButtonElement | null
            expect(btn).toBeInTheDocument()
            expect(btn?.disabled).toBe(false)
        })

        it('button disabled when current=demo + open live positions exist', () => {
            useATStore.setState({ mode: 'demo' })
            useUiStore.setState({ executionEnv: 'TESTNET' })
            usePositionsStore.setState({
                demoPositions: [],
                livePositions: [makePos({ mode: 'live', closed: false })],
            })
            const { container } = render(<ModeBar />)
            const btn = container.querySelector('#zmbBtn') as HTMLButtonElement | null
            expect(btn?.disabled).toBe(true)
        })

        it('button disabled when current=live + open demo positions exist', () => {
            useATStore.setState({ mode: 'live' })
            useUiStore.setState({ executionEnv: 'TESTNET' })
            usePositionsStore.setState({
                demoPositions: [makePos({ mode: 'demo', closed: false })],
                livePositions: [],
            })
            const { container } = render(<ModeBar />)
            const btn = container.querySelector('#zmbBtn') as HTMLButtonElement | null
            expect(btn?.disabled).toBe(true)
        })

        it('closed opposite-mode positions do NOT disable the button', () => {
            useATStore.setState({ mode: 'demo' })
            useUiStore.setState({ executionEnv: 'TESTNET' })
            usePositionsStore.setState({
                demoPositions: [],
                livePositions: [makePos({ mode: 'live', closed: true })],
            })
            const { container } = render(<ModeBar />)
            const btn = container.querySelector('#zmbBtn') as HTMLButtonElement | null
            expect(btn?.disabled).toBe(false)
        })

        it('disabled button carries title tooltip with count + close-first instruction', () => {
            useATStore.setState({ mode: 'demo' })
            useUiStore.setState({ executionEnv: 'TESTNET' })
            usePositionsStore.setState({
                demoPositions: [],
                livePositions: [
                    makePos({ mode: 'live', closed: false }),
                    makePos({ mode: 'live', closed: false }),
                ],
            })
            const { container } = render(<ModeBar />)
            const btn = container.querySelector('#zmbBtn') as HTMLButtonElement | null
            expect(btn?.getAttribute('title')).toMatch(/2.*LIVE.*close/i)
        })

        it('disabled state adds zmb-btn-disabled-locked class for CSS targeting', () => {
            useATStore.setState({ mode: 'demo' })
            useUiStore.setState({ executionEnv: 'TESTNET' })
            usePositionsStore.setState({
                demoPositions: [],
                livePositions: [makePos({ mode: 'live', closed: false })],
            })
            const { container } = render(<ModeBar />)
            const btn = container.querySelector('#zmbBtn') as HTMLButtonElement | null
            expect(btn?.className).toContain('zmb-btn-disabled-locked')
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
