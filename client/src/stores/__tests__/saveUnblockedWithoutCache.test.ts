import { describe, it, expect, beforeEach, vi } from 'vitest'
import { loadUserSettings, _usApplyDoneForTest } from '../../core/config'

// [SAVE DEADLOCK 2026-10-08] Nothing the operator changed had persisted since
// 2026-07-11 — user_settings.updated_at was frozen on that date while he kept
// toggling indicators, timeframes and TERMINATOR.
//
// loadUserSettings() bails on its FIRST line when there is no
// `zeus_user_settings` in localStorage:
//     const raw = localStorage.getItem('zeus_user_settings')
//     if (!raw) return                      // ← _usApply() below never runs
// and _usSave() opens with:
//     if (!_usApplyDone) { return }         // ← so every save is skipped
//
// His app auto-updates its APK, and a WebView reinstall wipes localStorage. From
// that moment the session could never save again, and because the LS cache is
// only rewritten BY a save, it could never heal itself either. Silent and
// permanent.
//
// Saving must not depend on a cache that may legitimately be absent (fresh
// install, new device, cleared data). The boot-window protection that guard
// actually provides is already covered by the settingsStore `loaded` check
// right below it.

describe('a missing localStorage cache must not disable saving', () => {
  beforeEach(() => {
    try { localStorage.clear() } catch { /* */ }
    vi.restoreAllMocks()
  })

  it('exposes the flag for this check', () => {
    expect(typeof _usApplyDoneForTest).toBe('function')
  })

  it('marks apply-done even when there is no cached settings blob', () => {
    expect(localStorage.getItem('zeus_user_settings')).toBeNull()
    loadUserSettings()
    expect(_usApplyDoneForTest()).toBe(true)
  })

  it('still marks apply-done when the cached blob is unparseable', () => {
    localStorage.setItem('zeus_user_settings', '{not json')
    loadUserSettings()
    expect(_usApplyDoneForTest()).toBe(true)
  })

  it('marks apply-done on the normal path too', () => {
    localStorage.setItem('zeus_user_settings', JSON.stringify({ chart: { tf: '15m' } }))
    loadUserSettings()
    expect(_usApplyDoneForTest()).toBe(true)
  })
})
