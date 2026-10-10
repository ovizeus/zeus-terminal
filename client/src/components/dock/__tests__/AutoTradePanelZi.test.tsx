/**
 * [2026-10-10] Task 3 — Auto Trade panel rebuilt on the zi primitives.
 * Design only: handlers keep their bodies, the imperative positions div stays.
 */
import { readFileSync } from 'fs'
import { join } from 'path'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { AutoTradePanel } from '../AutoTradePanel'
import { useATStore } from '../../../stores'

vi.mock('../../../trading/autotrade', async (importOriginal) => {
  const actual: any = await importOriginal()
  return { ...actual, resetKillSwitch: vi.fn() }
})

beforeEach(() => {
  useATStore.getState().reset()
})

// The panel's own region = everything the panel renders in its container.
// The drawer is portaled to document.body, outside this container.
describe('Auto Trade panel, rebuilt', () => {
  it('is gated behind the .zi theme class', () => {
    const { container } = render(<AutoTradePanel />)
    expect(container.querySelector('.zi')).toBeTruthy()
  })

  it('CONTAINS NO SETTINGS CONTROL — the thing that would silently regress', () => {
    const { container } = render(<AutoTradePanel />)
    expect(container.querySelectorAll('input[type="number"]').length).toBe(0)
    expect(container.querySelectorAll('input[type="checkbox"]').length).toBe(0)
    expect(container.querySelectorAll('select').length).toBe(0)
    expect(container.textContent).not.toMatch(/ENTRY CONDITIONS|RISK MANAGEMENT|ADVANCED CONTROLS|TRADING SYMBOLS/i)
  })

  it('KEEPS the emergency stop in the panel, never behind the drawer', () => {
    const { container } = render(<AutoTradePanel />)
    expect(container.textContent).toMatch(/close all/i)
    expect(screen.getByRole('button', { name: /close all/i })).toBeTruthy()
  })

  it('keeps Arm/Disarm in the panel', () => {
    render(<AutoTradePanel />)
    expect(screen.getByRole('button', { name: /^arm$/i })).toBeTruthy()
  })

  it('keeps the imperatively-filled positions div untouched (ownership logic lives in renderATPositions)', () => {
    const { container } = render(<AutoTradePanel />)
    const el = container.querySelector('#atActivePosPanel')
    expect(el).toBeTruthy()
    expect(container.querySelectorAll('#atActivePosPanel').length).toBe(1)
  })

  it('no longer hosts the diagnostics that move to THEIA', () => {
    const { container } = render(<AutoTradePanel />)
    expect(container.querySelector('#brainVisionWrap')).toBeNull()
    expect(container.querySelector('#brainDashWrap')).toBeNull()
    expect(container.querySelector('#brainVisionBody')).toBeNull()
    expect(container.querySelector('#brainDashBody')).toBeNull()
    expect(container.textContent).not.toMatch(/activity log/i)
  })

  it('opens the configuration drawer from the gear', () => {
    render(<AutoTradePanel />)
    const overlay = document.getElementById('matcfg') as HTMLElement
    expect(overlay.style.display).toBe('none')
    fireEvent.click(screen.getByRole('button', { name: /open configuration/i }))
    expect(overlay.style.display).toBe('flex')
  })
})

// [2026-10-10] The Task 3 implementer reported that Close All lost the legacy
// .at-kill class, and with it `animation: zBlink 1s infinite` on
// `.at-kill.triggered`. That blink is not decoration: it is how a FIRED kill
// switch announces itself. Without it, a triggered emergency stop looks like an
// ordinary button.
//
// Restored as .zi-kill rather than by re-adding the legacy class, because
// .at-kill also carries font-family: var(--ff) — the app monospace this redesign
// exists to get rid of.
describe('the emergency stop still announces a fired kill switch', () => {
  it('marks the Close All button so a triggered kill switch can blink', () => {
    const w = window as unknown as Record<string, unknown>
    w.S = { symbol: 'BTCUSDT', overlays: {}, activeInds: {}, indicators: {} }
    const { container } = render(<AutoTradePanel />)
    const btn = Array.from(container.querySelectorAll('button')).find(
      (b) => /close all/i.test(b.textContent || ''),
    )
    expect(btn).toBeTruthy()
    expect(btn!.className).toContain('zi-kill')
  })

  it('ships the blink rule, so the class is not inert', () => {
    const css = readFileSync(
      join(__dirname, '..', '..', '..', 'styles', 'institutional.css'),
      'utf8',
    )
    expect(css).toMatch(/\.zi-kill\.triggered/)
    expect(css).toMatch(/animation:\s*zBlink/)
  })
})
