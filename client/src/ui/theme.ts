/**
 * Zeus Terminal — Theme engine (ported from public/js/ui/theme.js)
 * Themes: native (obsidian), dark (onyx), light (ivory)
 */



const THEMES = ['native', 'dark', 'light']
const LS_KEY = 'zeus_theme'

function get(): string {
  try {
    const t = localStorage.getItem(LS_KEY)
    return (t && THEMES.indexOf(t) !== -1) ? t : 'native'
  } catch (_e) { return 'native' }
}

function apply(id?: string): string {
  if (!id || THEMES.indexOf(id) === -1) id = 'native'
  try { localStorage.setItem(LS_KEY, id) } catch (_e) { /* quota */ }

  // Set or remove data-theme attribute
  if (id === 'native') {
    document.documentElement.removeAttribute('data-theme')
  } else {
    document.documentElement.setAttribute('data-theme', id)
  }

  // Update theme-color meta tag with computed --bg
  requestAnimationFrame(function () {
    const bg = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim()
    if (bg) {
      const meta = document.querySelector('meta[name="theme-color"]')
      if (meta) meta.setAttribute('content', bg)
    }
  })

  // Sync select if visible
  const sel = document.getElementById('themeSelect') as HTMLSelectElement | null
  if (sel) sel.value = id

  return id
}

export const zeusApplyTheme = apply
export const zeusGetTheme = get

// zeusApplyTheme — exported, consumers import directly
// zeusGetTheme — exported, consumers import directly

// Apply saved theme immediately
apply(get())
