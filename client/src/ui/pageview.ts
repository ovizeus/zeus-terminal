/**
 * Zeus Terminal — PageView (ported from public/js/ui/pageview.js)
 * Full-screen dedicated page view for dock modules
 */

import { aubRefreshAll } from '../engine/aub'
import { dockClearActive } from './dock'
import { renderPnlLab } from './panels'
import { _srRenderStats } from '../core/config'

const w = window as any

// ── MODULE REGISTRY ──────────────────────────────────────────
export const PAGE_VIEW_MODULES: Record<string, any> = {
  'autotrade': {
    panelId: 'atPanel',
    title: 'AutoTrade'
  },
  'manual-trade': {
    title: 'Manual Trade'
  },
  'dsl': {
    panelId: 'dslZone',
    title: 'DSL'
  },
  'ares': {
    title: 'ARES'
  },
  'postmortem': {
    title: 'Post-Mortem'
  },
  'pnllab': {
    title: 'PnL Lab'
  },
  'aria': {
    title: 'ARIA'
  },
  'nova': {
    title: 'Nova'
  },
  'adaptive': {
    title: 'Adaptive'
  },
  'flow': {
    title: 'Flow'
  },
  'mtf': {
    title: 'MTF'
  },
  'teacher': {
    title: 'Teacher'
  },
  'sigreg': {
    title: 'Signals'
  },
  'activity': {
    title: 'Activity'
  },
  'aub': {
    title: 'Alien Upgrade'
  }
}
w.PAGE_VIEW_MODULES = PAGE_VIEW_MODULES

// ── STATE ────────────────────────────────────────────────────
const _pvState: any = {
  open: false,
  dockId: null,
  panelEl: null,
  originalParent: null,
  originalNextSibling: null,
  extras: [] as any[]
}

// ── INIT (called once from bootstrap) ────────────────────────
export function initPageView() {
  const pv = document.getElementById('zeus-page-view')
  if (!pv || pv.children.length > 0) return

  pv.innerHTML =
    '<div class="zpv-header">' +
      '<button class="zpv-back" onclick="closePageView()">' +
        '<svg viewBox="0 0 24 24" width="20" height="20"><path d="M19 12H5M12 19l-7-7 7-7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>' +
        '<span>Back</span>' +
      '</button>' +
      '<span class="zpv-title" id="zpvTitle"></span>' +
    '</div>' +
    '<div class="zpv-content" id="zpvContent"></div>'
}
w.initPageView = initPageView

// ── Helper: save + move element into page view content ───────
export function _pvMoveIn(el: any, content: any) {
  if (!el) return
  _pvState.extras.push({
    el: el,
    origParent: el.parentNode,
    origNext: el.nextSibling
  })
  content.appendChild(el)
}

// ── OPEN ─────────────────────────────────────────────────────
export function openPageView(dockId: string) {
  const mod = PAGE_VIEW_MODULES[dockId]
  if (!mod) return

  if (_pvState.open) closePageView()

  const pv = document.getElementById('zeus-page-view')
  const content = document.getElementById('zpvContent')
  const title = document.getElementById('zpvTitle')
  const home = document.getElementById('zeus-groups')
  if (!pv || !content || !home) return

  content.innerHTML = ''

  _pvState.dockId = dockId
  _pvState.extras = []

  // ── AutoTrade ──
  if (dockId === 'autotrade') {
    const panel = document.getElementById(mod.panelId)
    if (!panel) return
    _pvState.panelEl = panel
    _pvState.originalParent = panel.parentNode
    _pvState.originalNextSibling = panel.nextSibling

    if (title) title.textContent = mod.title

    const atSep = document.querySelector('.at-sep')
    _pvMoveIn(atSep, content)

    content.appendChild(panel)
    panel.style.display = 'block'
  }

  // ── Manual Trade ──
  if (dockId === 'manual-trade') {
    const env = w._resolvedEnv || 'DEMO'
    if (title) title.textContent = 'Manual Trade (' + env + ')'

    const demoPanel = document.getElementById('panelDemo')
    _pvMoveIn(demoPanel, content)

    if (typeof w._showManualPanel === 'function') w._showManualPanel()
    else if (demoPanel) demoPanel.style.display = 'block'
  }

  // ── Adaptive ──
  if (dockId === 'adaptive') {
    const adaptStrip = document.getElementById('adaptive-strip')
    if (!adaptStrip) return
    if (title) title.textContent = mod.title
    _pvMoveIn(adaptStrip, content)
    if (!adaptStrip.classList.contains('adaptive-open')) {
      adaptStrip.classList.add('adaptive-open')
    }
  }

  // ── Nova ──
  if (dockId === 'nova') {
    const novaStrip = document.getElementById('nova-strip')
    if (!novaStrip) return
    if (title) title.textContent = mod.title
    _pvMoveIn(novaStrip, content)
    if (!novaStrip.classList.contains('nova-open')) {
      novaStrip.classList.add('nova-open')
    }
  }

  // ── ARIA ──
  if (dockId === 'aria') {
    const ariaStrip = document.getElementById('aria-strip')
    if (!ariaStrip) return
    if (title) title.textContent = mod.title
    _pvMoveIn(ariaStrip, content)
    if (!ariaStrip.classList.contains('aria-open')) {
      ariaStrip.classList.add('aria-open')
    }
  }

  // ── PnL Lab ──
  if (dockId === 'pnllab') {
    const pnlStrip = document.getElementById('pnl-lab-strip')
    if (!pnlStrip) return
    if (title) title.textContent = mod.title
    _pvMoveIn(pnlStrip, content)
    const pnlWrap = document.getElementById('pnlLabWrap')
    if (pnlWrap && !pnlWrap.classList.contains('open')) {
      pnlWrap.classList.add('open')
    }
    if (typeof renderPnlLab === 'function') renderPnlLab()
  }

  // ── Post-Mortem ──
  if (dockId === 'postmortem') {
    const pmStrip = document.getElementById('pm-strip')
    if (!pmStrip) return
    if (title) title.textContent = mod.title
    _pvMoveIn(pmStrip, content)
    if (!pmStrip.classList.contains('open')) {
      pmStrip.classList.add('open')
    }
    if (typeof w.PM_render === 'function') w.PM_render()
  }

  // ── ARES ──
  if (dockId === 'ares') {
    const aresStrip = document.getElementById('ares-strip')
    if (!aresStrip) return
    if (title) title.textContent = mod.title
    _pvMoveIn(aresStrip, content)
    if (!aresStrip.classList.contains('open')) {
      aresStrip.classList.add('open')
    }
    if (typeof w._aresRender === 'function') w._aresRender()
  }

  // ── DSL ──
  if (dockId === 'dsl') {
    const dslZone = document.getElementById(mod.panelId)
    if (!dslZone) return
    if (title) title.textContent = mod.title
    _pvMoveIn(dslZone, content)
    dslZone.style.display = 'block'
  }

  // ── Flow ──
  if (dockId === 'flow') {
    const flowPanel = document.getElementById('flow-panel')
    if (!flowPanel) return
    if (title) title.textContent = mod.title
    _pvMoveIn(flowPanel, content)
    flowPanel.classList.remove('collapsed')
    flowPanel.classList.add('expanded')
  }

  // ── Alien Upgrade Bay ──
  if (dockId === 'aub') {
    const aubEl = document.getElementById('aub')
    if (!aubEl) return
    if (title) title.textContent = mod.title
    _pvMoveIn(aubEl, content)
    aubEl.classList.remove('collapsed')
    aubEl.classList.add('expanded')
    if (typeof aubRefreshAll === 'function') aubRefreshAll()
  }

  // ── Activity ──
  if (dockId === 'activity') {
    const actStrip = document.getElementById('actfeed-strip')
    if (!actStrip) return
    if (title) title.textContent = mod.title
    _pvMoveIn(actStrip, content)
    const actPanel = document.getElementById('actfeed-panel')
    if (actPanel) actPanel.style.display = ''
    if (typeof w._actfeedRender === 'function') w._actfeedRender()
  }

  // ── Signals (Signal Registry) ──
  if (dockId === 'sigreg') {
    const srStrip = document.getElementById('sr-strip')
    if (!srStrip) return
    if (title) title.textContent = mod.title
    _pvMoveIn(srStrip, content)
    if (!srStrip.classList.contains('sr-strip-open')) {
      srStrip.classList.add('sr-strip-open')
    }
    if (typeof w._srRenderList === 'function') w._srRenderList()
    _srRenderStats()
  }

  // ── Teacher ──
  if (dockId === 'teacher') {
    const teacherStrip = document.getElementById('teacher-strip')
    if (!teacherStrip) return
    if (title) title.textContent = mod.title
    _pvMoveIn(teacherStrip, content)
    if (!teacherStrip.classList.contains('teacher-open')) {
      teacherStrip.classList.add('teacher-open')
    }
    if (typeof w.initTeacher === 'function') w.initTeacher()
  }

  // ── MTF ──
  if (dockId === 'mtf') {
    const mtfStrip = document.getElementById('mtf-strip')
    if (!mtfStrip) return
    if (title) title.textContent = mod.title
    _pvMoveIn(mtfStrip, content)
    if (!mtfStrip.classList.contains('mtf-open')) {
      mtfStrip.classList.add('mtf-open')
    }
    if (typeof w.renderMTFPanel === 'function') w.renderMTFPanel()
  }

  // Hide home, show page view
  home.style.display = 'none'
  pv.style.display = ''
  _pvState.open = true
  pv.scrollTop = 0

  // Persist active dock for refresh survival
  try { sessionStorage.setItem('zeusDock', dockId) } catch (_e) { /* */ }
}
// openPageView — exported, consumers import directly

// ── CLOSE ────────────────────────────────────────────────────
export function closePageView() {
  const pv = document.getElementById('zeus-page-view')
  const home = document.getElementById('zeus-groups')
  if (!pv || !home) return
  if (!_pvState.open) return

  // ── Cleanup ──
  const did = _pvState.dockId
  let _el: HTMLElement | null
  if (did === 'adaptive') { _el = document.getElementById('adaptive-strip'); if (_el) _el.classList.remove('adaptive-open') }
  if (did === 'nova') { _el = document.getElementById('nova-strip'); if (_el) _el.classList.remove('nova-open') }
  if (did === 'aria') { _el = document.getElementById('aria-strip'); if (_el) _el.classList.remove('aria-open') }
  if (did === 'pnllab') { _el = document.getElementById('pnlLabWrap'); if (_el) _el.classList.remove('open') }
  if (did === 'postmortem') { _el = document.getElementById('pm-strip'); if (_el) _el.classList.remove('open') }
  if (did === 'ares') { _el = document.getElementById('ares-strip'); if (_el) _el.classList.remove('open') }
  if (did === 'sigreg') { _el = document.getElementById('sr-strip'); if (_el) _el.classList.remove('sr-strip-open') }
  if (did === 'teacher') { _el = document.getElementById('teacher-strip'); if (_el) _el.classList.remove('teacher-open') }
  if (did === 'mtf') { _el = document.getElementById('mtf-strip'); if (_el) _el.classList.remove('mtf-open') }
  if (did === 'flow') { _el = document.getElementById('flow-panel'); if (_el) { _el.classList.remove('expanded'); _el.classList.add('collapsed') } }
  if (did === 'aub') { _el = document.getElementById('aub'); if (_el) { _el.classList.remove('expanded'); _el.classList.add('collapsed') } }
  if (did === 'autotrade') { _el = document.getElementById('atPanel'); if (_el) _el.style.display = '' }
  if (did === 'dsl') { _el = document.getElementById('dslZone'); if (_el) _el.style.display = '' }
  if (did === 'activity') { _el = document.getElementById('actfeed-panel'); if (_el) _el.style.display = 'none' }

  // Restore all extra elements to original positions (reverse order)
  for (let i = _pvState.extras.length - 1; i >= 0; i--) {
    const ex = _pvState.extras[i]
    if (ex.el && ex.origParent) {
      if (ex.origNext) {
        ex.origParent.insertBefore(ex.el, ex.origNext)
      } else {
        ex.origParent.appendChild(ex.el)
      }
    }
  }

  // Restore main panel (AT)
  if (_pvState.panelEl && _pvState.originalParent) {
    if (_pvState.originalNextSibling) {
      _pvState.originalParent.insertBefore(_pvState.panelEl, _pvState.originalNextSibling)
    } else {
      _pvState.originalParent.appendChild(_pvState.panelEl)
    }
  }

  // Hide page view, show home
  pv.style.display = 'none'
  home.style.display = ''

  // Clear dock active state
  dockClearActive()

  // Clear persisted dock
  try { sessionStorage.removeItem('zeusDock') } catch (_e) { /* */ }

  // Reset state
  _pvState.open = false
  _pvState.dockId = null
  _pvState.panelEl = null
  _pvState.originalParent = null
  _pvState.originalNextSibling = null
  _pvState.extras = []
}
// closePageView — no window mapping needed (defined in this file)
