import { useState } from 'react'
import { useUiStore, useSettingsStore, useAuthStore } from '../../stores'
import { authApi } from '../../services/api'
import type { ThemeId } from '../../types'

const THEMES: { id: ThemeId; label: string }[] = [
  { id: 'native', label: 'Obsidian' },
  { id: 'dark', label: 'Onyx' },
  { id: 'light', label: 'Ivory' },
]

type Tab = 'general' | 'trading' | 'account'

export function SettingsModal() {
  const open = useUiStore((s) => s.settingsOpen)
  const toggleSettings = useUiStore((s) => s.toggleSettings)
  const theme = useUiStore((s) => s.theme)
  const setTheme = useUiStore((s) => s.setTheme)
  const tc = useSettingsStore((s) => s.tc)
  const setTC = useSettingsStore((s) => s.setTC)
  const email = useAuthStore((s) => s.email)
  const clearAuth = useAuthStore((s) => s.clearAuth)
  const [tab, setTab] = useState<Tab>('general')

  if (!open) return null

  async function handleLogout() {
    await authApi.logout()
    clearAuth()
  }

  return (
    <div className="zr-modal-overlay" onClick={toggleSettings}>
      <div className="zr-modal" onClick={(e) => e.stopPropagation()}>
        <div className="zr-modal__header">
          <span>Settings</span>
          <button className="zr-modal__close" onClick={toggleSettings}>×</button>
        </div>

        <div className="zr-modal__tabs">
          {(['general', 'trading', 'account'] as Tab[]).map((t) => (
            <button
              key={t}
              className={`zr-modal__tab ${tab === t ? 'zr-modal__tab--active' : ''}`}
              onClick={() => setTab(t)}
            >
              {t.toUpperCase()}
            </button>
          ))}
        </div>

        <div className="zr-modal__body">
          {tab === 'general' && (
            <div className="zr-settings-section">
              <label className="zr-settings__label">
                Theme
                <select
                  className="zr-settings__select"
                  value={theme}
                  onChange={(e) => setTheme(e.target.value as ThemeId)}
                >
                  {THEMES.map((t) => (
                    <option key={t.id} value={t.id}>{t.label}</option>
                  ))}
                </select>
              </label>
            </div>
          )}

          {tab === 'trading' && (
            <div className="zr-settings-section">
              <label className="zr-settings__label">
                Leverage
                <input
                  className="zr-settings__input"
                  type="number"
                  min={1}
                  max={125}
                  value={tc.lev}
                  onChange={(e) => setTC({ lev: Number(e.target.value) || 1 })}
                />
              </label>
              <label className="zr-settings__label">
                Position Size ($)
                <input
                  className="zr-settings__input"
                  type="number"
                  min={10}
                  value={tc.size}
                  onChange={(e) => setTC({ size: Number(e.target.value) || 10 })}
                />
              </label>
              <label className="zr-settings__label">
                Stop Loss %
                <input
                  className="zr-settings__input"
                  type="number"
                  min={0.1}
                  step={0.1}
                  value={tc.slPct}
                  onChange={(e) => setTC({ slPct: Number(e.target.value) || 0.5 })}
                />
              </label>
              <label className="zr-settings__label">
                Risk:Reward
                <input
                  className="zr-settings__input"
                  type="number"
                  min={0.5}
                  step={0.1}
                  value={tc.rr}
                  onChange={(e) => setTC({ rr: Number(e.target.value) || 1 })}
                />
              </label>
              <label className="zr-settings__label">
                Max Positions
                <input
                  className="zr-settings__input"
                  type="number"
                  min={1}
                  max={10}
                  value={tc.maxPos}
                  onChange={(e) => setTC({ maxPos: Number(e.target.value) || 1 })}
                />
              </label>
              <label className="zr-settings__label">
                Confluence Min
                <input
                  className="zr-settings__input"
                  type="number"
                  min={0}
                  max={100}
                  value={tc.confMin}
                  onChange={(e) => setTC({ confMin: Number(e.target.value) || 50 })}
                />
              </label>
            </div>
          )}

          {tab === 'account' && (
            <div className="zr-settings-section">
              <div className="zr-kv">
                <span className="zr-kv__label">Email</span>
                <span className="zr-kv__value">{email ?? '—'}</span>
              </div>
              <button className="zr-login__btn zr-login__btn--danger" onClick={handleLogout}>
                Logout
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
