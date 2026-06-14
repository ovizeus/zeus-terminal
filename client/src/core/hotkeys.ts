/**
 * Zeus Terminal — Global Keyboard Shortcuts (ported from public/js/core/hotkeys.js)
 * Pure UI overlay — calls existing toggle functions only.
 */

const w = window as any

// ── Guard: load only once ──
;(function () {
  if (w.__ZEUS_HOTKEYS__) return
  w.__ZEUS_HOTKEYS__ = true

  // ── Blocked element check — never fire hotkeys while typing ──
  const BLOCKED_TAGS: Record<string, number> = { INPUT: 1, TEXTAREA: 1, SELECT: 1 }
  function _isBlocked(el: any) {
    if (!el) return false
    if (BLOCKED_TAGS[el.tagName]) return true
    if (el.isContentEditable) return true
    return false
  }

  // ── Timeframe map: number keys → TF values ──
  const TF_MAP: Record<string, string> = {
    '1': '1m',
    '2': '5m',
    '3': '15m',
    '4': '1h',
    '5': '4h',
    '6': '1d'
  }

  // ── Help overlay (built lazily) ──
  let _helpEl: HTMLElement | null = null
  function _buildHelp() {
    if (_helpEl) return _helpEl
    // [2026-06-13] Amethyst theme + a real ✕ button and tap-outside backdrop —
    // on mobile there's no keyboard so "press ? / Esc" left no way out.
    const d = document.createElement('div')
    d.id = 'zeus-hotkey-help'
    d.style.cssText = [
      'display:none', 'position:fixed', 'inset:0', 'z-index:100000',
      'align-items:center', 'justify-content:center', 'padding:20px',
      'background:#0a0612cc', '-webkit-backdrop-filter:blur(3px)', 'backdrop-filter:blur(3px)'
    ].join(';')
    d.innerHTML = [
      '<div id="hkHelpPanel" style="position:relative;max-height:84vh;overflow-y:auto;background:radial-gradient(130% 80% at 50% 0%,#1c1430 0%,#0e0a18 58%,#0b0712 100%);border:1px solid #b07cff55;border-radius:14px;padding:24px 28px;color:#b3a2d4;font-family:var(--ff,monospace);font-size:13px;min-width:300px;max-width:440px;box-shadow:0 28px 80px -22px #000000e6,0 0 60px -20px #b07cffaa,inset 0 1px 0 #ffffff12">',
      '<button id="hkHelpClose" title="Close" style="position:absolute;top:12px;right:14px;width:28px;height:28px;border-radius:8px;background:#b07cff1a;border:1px solid #b07cff44;color:#c9a8ff;cursor:pointer;font-size:14px;line-height:1">✕</button>',
      '<div style="color:#e4d6ff;font-weight:700;font-size:15px;margin-bottom:14px;letter-spacing:1px;text-shadow:0 0 16px #b07cff66">KEYBOARD SHORTCUTS</div>',
      _row('?', 'Show / hide this help'),
      _row('Esc', 'Close modal or panel'),
      _row('F', 'Fullscreen chart'),
      '<div style="margin:10px 0 6px;color:#8a7ca8;font-size:11px;letter-spacing:1px">TIMEFRAMES</div>',
      _row('1', '1m'), _row('2', '5m'), _row('3', '15m'),
      _row('4', '1h'), _row('5', '4h'), _row('6', '1d'),
      '<div style="margin:10px 0 6px;color:#8a7ca8;font-size:11px;letter-spacing:1px">PANELS  (Alt + key)</div>',
      _row('Alt+A', 'AutoTrade panel'),
      _row('Alt+D', 'DSL panel'),
      _row('Alt+P', 'PnL Lab'),
      _row('Alt+V', 'VWAP overlay'),
      _row('Alt+R', 'ARIA panel'),
      _row('Alt+S', 'Settings'),
      _row('Alt+N', 'Notifications'),
      _row('Alt+E', 'Exposure Dashboard'),
      _row('Ctrl+K', 'Command Palette / Search'),
      '<div style="margin:10px 0 6px;color:#8a7ca8;font-size:11px;letter-spacing:1px">OVERLAYS</div>',
      _row('L', 'Liquidity (LIQ)'),
      _row('S', 'Support / Resistance'),
      _row('V', 'VWAP / Supremus'),
      _row('T', 'Time &amp; Sales tape'),
      _row('H', 'Horizontal line tool'),
      '<div style="margin-top:16px;text-align:center;color:#8a7ca8;font-size:10px">Tap ✕ or press ? / Esc to close</div>',
      '</div>'
    ].join('')
    document.body.appendChild(d)
    // close on backdrop tap or ✕ (mobile has no keyboard)
    d.addEventListener('click', function (e: any) { if (e.target === d) _toggleHelp() })
    const _cb = d.querySelector('#hkHelpClose'); if (_cb) _cb.addEventListener('click', function () { _toggleHelp() })
    _helpEl = d
    return d
  }
  function _row(key: string, desc: string) {
    return '<div style="display:flex;justify-content:space-between;padding:3px 0">' +
      '<kbd style="background:#1b1430;border:1px solid #b07cff3a;border-radius:4px;padding:1px 8px;color:#d9c7ff;font-size:12px;min-width:50px;text-align:center">' + key + '</kbd>' +
      '<span style="color:#b3a2d4;margin-left:16px;flex:1;text-align:right">' + desc + '</span></div>'
  }
  function _toggleHelp() {
    const h = _buildHelp()
    h.style.display = h.style.display === 'none' ? 'flex' : 'none'
  }

  // ── Toast feedback (non-intrusive, bottom-right) ──
  let _toastTimer: any = null
  function _toast(msg: string) {
    let t = document.getElementById('zeus-hk-toast')
    if (!t) {
      t = document.createElement('div')
      t.id = 'zeus-hk-toast'
      t.style.cssText = [
        'position:fixed', 'bottom:20px', 'right:20px', 'z-index:100001',
        'background:#1a2530', 'border:1px solid #2a3540', 'border-radius:8px',
        'padding:8px 16px', 'color:#f0c040', 'font-family:var(--ff,monospace)',
        'font-size:12px', 'opacity:0', 'transition:opacity .2s',
        'pointer-events:none'
      ].join(';')
      document.body.appendChild(t)
    }
    t.textContent = msg
    t.style.opacity = '1'
    clearTimeout(_toastTimer)
    _toastTimer = setTimeout(function () { t!.style.opacity = '0' }, 1200)
  }

  // ── Find first visible modal ──
  function _findOpenModal() {
    const movers = document.querySelectorAll('.mover') as NodeListOf<HTMLElement>
    for (let i = 0; i < movers.length; i++) {
      if (movers[i].style.display === 'flex' || movers[i].style.display === 'block') {
        return movers[i].id
      }
    }
    return null
  }

  // ── Safe caller — only call if function exists ──
  function _call(fn: string, args?: any[]) {
    if (typeof w[fn] === 'function') {
      w[fn].apply(null, args || [])
      return true
    }
    return false
  }

  // ── Overlay toggle helper ──
  function _togOverlay(name: string) {
    const btns = document.querySelectorAll('#csec .ctrls button') as NodeListOf<HTMLElement>
    for (let i = 0; i < btns.length; i++) {
      const oc = btns[i].getAttribute('onclick') || ''
      if (oc.indexOf("togOvr('" + name + "'") !== -1) {
        _call('togOvr', [name, btns[i]])
        return
      }
    }
    _call('togOvr', [name, null])
  }

  // ── Main keydown handler ──
  function _onKey(e: KeyboardEvent) {
    const tag = e.target as HTMLElement

    // Always allow Escape
    if (e.key === 'Escape') {
      if (_helpEl && _helpEl.style.display !== 'none') {
        _helpEl.style.display = 'none'
        e.preventDefault()
        return
      }
      const mId = _findOpenModal()
      if (mId && typeof w.closeM === 'function') {
        w.closeM(mId)
        e.preventDefault()
        return
      }
      const ztfW = document.getElementById('ztfWrap')
      if (ztfW && ztfW.classList.contains('open')) {
        ztfW.classList.remove('open')
        e.preventDefault()
      }
      return
    }

    // Block all other hotkeys when typing in inputs
    if (_isBlocked(tag)) return

    // Block when a modal is open (except help toggle)
    const modalOpen = _findOpenModal()
    if (modalOpen && e.key !== '?') return

    const key = e.key
    const alt = e.altKey
    const ctrl = e.ctrlKey || e.metaKey

    // ── ? — Help ──
    if (key === '?' || (key === '/' && e.shiftKey)) {
      e.preventDefault()
      _toggleHelp()
      return
    }

    // ── Alt + key combos ──
    if (alt && !ctrl) {
      switch (key.toLowerCase()) {
        case 'a':
          e.preventDefault()
          _call('atStripToggle')
          _toast('AutoTrade panel')
          return
        case 'd':
          e.preventDefault()
          _call('toggleDSL')
          _toast('DSL panel')
          return
        case 'p':
          e.preventDefault()
          _call('togglePnlLab')
          _toast('PnL Lab')
          return
        case 'v':
          e.preventDefault()
          _call('toggleVWAP')
          _toast('VWAP overlay')
          return
        case 'r':
          e.preventDefault()
          _call('ariaToggle')
          _toast('ARIA panel')
          return
        case 's':
          e.preventDefault()
          _call('openM', ['msettings'])
          _toast('Settings')
          return
        case 'n':
          e.preventDefault()
          _call('openM', ['mnotifications'])
          _toast('Notifications')
          return
        case 'e':
          e.preventDefault()
          _call('_toggleExposurePanel')
          _toast('Exposure')
          return
      }
      return
    }

    // ── Plain keys (no modifier) ──
    if (!alt && !ctrl) {
      if (key === 'f' || key === 'F') {
        e.preventDefault()
        _call('toggleFS')
        _toast('Fullscreen')
        return
      }

      if (key === 'l' || key === 'L') {
        e.preventDefault()
        _togOverlay('liq')
        _toast('LIQ overlay')
        return
      }

      if (key === 's') {
        e.preventDefault()
        _togOverlay('sr')
        _toast('S/R overlay')
        return
      }

      if (key === 'v') {
        e.preventDefault()
        _togOverlay('zs')
        _toast('SUPREMUS overlay')
        return
      }

      if (key === 't') {
        e.preventDefault()
        _call('toggleTimeSales')
        _toast('Time & Sales')
        return
      }

      if (key === 'h') {
        e.preventDefault()
        _call('drawToolActivate', ['hline'])
        _toast('H-Line tool')
        return
      }

      if (TF_MAP[key]) {
        e.preventDefault()
        const tf = TF_MAP[key]
        _call('ztfPick', [tf, null])
        _toast('TF: ' + tf)
        return
      }
    }
  }

  // ── Attach (capture phase so we fire before any inner handler) ──
  document.addEventListener('keydown', _onKey, true)

  console.log('[hotkeys] Zeus keyboard shortcuts loaded — press ? for help')
})()

export {}
