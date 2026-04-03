import { useUiStore, useMarketStore } from '../../stores'
import type { ThemeId } from '../../types'

const THEMES: { id: ThemeId; label: string }[] = [
  { id: 'native', label: 'Obsidian' },
  { id: 'dark', label: 'Onyx' },
  { id: 'light', label: 'Ivory' },
]

export function Header() {
  const theme = useUiStore((s) => s.theme)
  const setTheme = useUiStore((s) => s.setTheme)
  const connected = useUiStore((s) => s.connected)
  const toggleSettings = useUiStore((s) => s.toggleSettings)
  const symbol = useMarketStore((s) => s.market.symbol)
  const price = useMarketStore((s) => s.market.price)

  return (
    <header className="zr-header">
      <div className="zr-header__left">
        <span className="zr-header__logo">Zeus Terminal</span>
        <span className="zr-header__badge">React</span>
      </div>
      <div className="zr-header__center">
        <span className="zr-header__symbol">{symbol}</span>
        {price > 0 && (
          <span className="zr-header__price">${price.toLocaleString()}</span>
        )}
      </div>
      <div className="zr-header__right">
        <span className={`zr-header__dot ${connected ? 'zr-header__dot--on' : ''}`} />
        <select
          className="zr-header__theme-select"
          value={theme}
          onChange={(e) => setTheme(e.target.value as ThemeId)}
        >
          {THEMES.map((t) => (
            <option key={t.id} value={t.id}>{t.label}</option>
          ))}
        </select>
        <button className="zr-header__settings-btn" onClick={toggleSettings} title="Settings">
          &#9881;
        </button>
      </div>
    </header>
  )
}
