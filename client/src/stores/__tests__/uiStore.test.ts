import { describe, it, expect, beforeEach } from 'vitest'
import { useUiStore } from '../uiStore'

describe('uiStore', () => {
  beforeEach(() => {
    useUiStore.setState(useUiStore.getInitialState())
    localStorage.clear()
    document.documentElement.removeAttribute('data-theme')
  })

  it('has correct defaults', () => {
    const s = useUiStore.getState()
    expect(s.theme).toBe('native')
    expect(s.activePanel).toBe('chart')
    expect(s.settingsOpen).toBe(false)
    expect(s.connected).toBe(false)
  })

  it('setTheme persists to localStorage and sets data-theme', () => {
    useUiStore.getState().setTheme('dark')
    expect(useUiStore.getState().theme).toBe('dark')
    expect(localStorage.getItem('zeus_theme')).toBe('dark')
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
  })

  it('setTheme native removes data-theme attribute', () => {
    useUiStore.getState().setTheme('dark')
    useUiStore.getState().setTheme('native')
    expect(document.documentElement.getAttribute('data-theme')).toBeNull()
  })

  it('toggleSettings flips state', () => {
    expect(useUiStore.getState().settingsOpen).toBe(false)
    useUiStore.getState().toggleSettings()
    expect(useUiStore.getState().settingsOpen).toBe(true)
    useUiStore.getState().toggleSettings()
    expect(useUiStore.getState().settingsOpen).toBe(false)
  })
})
