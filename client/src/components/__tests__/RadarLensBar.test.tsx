import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

// [RADAR LENS, THE UI HALF 2026-10-10] The wire half lives in
// radarLensPersist.test.ts. This is the other half, and it exists because
// wiring only one half is precisely what made the candle type look repaired
// for three days: the lens must be RESTORED on mount and PERSISTED on click,
// or the round trip is still broken in a way tests would not notice.

const scheduleSave = vi.fn()
vi.mock('../../core/config', async (orig) => {
  const actual = await (orig() as Promise<Record<string, unknown>>)
  return { ...actual, _usScheduleSave: () => scheduleSave() }
})

import { RadarLensBar } from '../brain/BrainCockpit'
import { USER_SETTINGS } from '../../core/config'

const setLens = vi.fn()

beforeEach(() => {
  scheduleSave.mockClear(); setLens.mockClear()
  ;(window as unknown as Record<string, unknown>).MarketCoreReactor = { setLens }
  delete (USER_SETTINGS as Record<string, unknown>).radarLens
})

describe('RadarLensBar', () => {
  it('restores the saved lens on mount instead of falling back to hybrid', () => {
    ;(USER_SETTINGS as Record<string, unknown>).radarLens = { lens: 'slow', tf: '4h' }
    render(<RadarLensBar />)
    // The applied lens is what the reactor was told, not just what is painted.
    expect(setLens).toHaveBeenCalledWith('slow', '4h')
  })

  it('falls back to hybrid/5m when nothing was ever saved', () => {
    render(<RadarLensBar />)
    expect(setLens).toHaveBeenCalledWith('hybrid', '5m')
  })

  it('persists the choice when a lens is clicked', () => {
    render(<RadarLensBar />)
    fireEvent.click(screen.getByText('SLOW'))
    expect((USER_SETTINGS as Record<string, unknown>).radarLens).toEqual({ lens: 'slow', tf: '5m' })
    expect(scheduleSave).toHaveBeenCalled()
  })

  it('ignores a saved lens id it does not recognise rather than applying garbage', () => {
    ;(USER_SETTINGS as Record<string, unknown>).radarLens = { lens: 'nonsense', tf: '9y' }
    render(<RadarLensBar />)
    expect(setLens).toHaveBeenCalledWith('hybrid', '5m')
  })
})
