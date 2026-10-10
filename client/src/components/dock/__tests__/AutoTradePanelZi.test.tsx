/**
 * [2026-10-10] Task 3 — Auto Trade panel rebuilt on the zi primitives.
 * Design only: handlers keep their bodies, the imperative positions div stays.
 */
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
