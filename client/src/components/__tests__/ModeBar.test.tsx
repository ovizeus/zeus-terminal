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
import { useATStore, useUiStore } from '../../stores'

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
})
