// Zeus — core/bootstrapError.ts
// Ported 1:1 from public/js/core/bootstrap.js lines 1722-2108 (Chunk D)
// Error boundary, __ZEUS_INIT__ guard, status bar, app update, DLOG panel, activity feed

import { AT } from '../engine/events'
import { TP } from '../core/state'
import { updateModeBar } from '../ui/modebar'
import { escHtml } from '../utils/dom'
const w = window as any // kept for w.DLog, w._SAFETY, w._resolvedEnv, w._zeusWS, w._pvState, w.ncAdd, fn calls

// ===== GLOBAL ERROR BOUNDARY =====
// [ZT-AUD-#15 / C13] Catch errors thrown anywhere in legacy code (intervals,
// event handlers, async callbacks) that escape the React ErrorBoundary. Show
// a Degraded banner so user knows something is broken instead of seeing a
// frozen UI silently. Also handle unhandledrejection for promise paths.
function _ensureEngineBanner(): HTMLElement | null {
  let b = document.getElementById('engineErrorBanner') as HTMLElement | null
  if (b) return b
  if (!document.body) return null
  b = document.createElement('div')
  b.id = 'engineErrorBanner'
  b.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:99999;background:linear-gradient(90deg,#ff3355,#aa1133);color:#fff;font-family:var(--ff,monospace);font-size:11px;font-weight:700;letter-spacing:0.5px;padding:6px 12px;text-align:center;display:none;border-bottom:1px solid #000;box-shadow:0 2px 8px rgba(0,0,0,0.4)'
  b.textContent = '\u26A0 DEGRADED MODE \u2014 engine error caught. Refresh recommended.'
  document.body.appendChild(b)
  return b
}

function _reportClientError(payload: Record<string, any>) {
  try {
    fetch('/api/client-error', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Zeus-Request': '1' },
      body: JSON.stringify(payload),
      credentials: 'same-origin',
      keepalive: true,
    }).catch(function () { /* best-effort */ })
  } catch (_) { /* */ }
}

let _bannerShown = false
function _showDegradedBanner(reason: string, meta?: Record<string, any>) {
  if (_bannerShown) return
  _bannerShown = true
  const b = _ensureEngineBanner()
  if (b) b.style.display = 'block'
  _reportClientError({ kind: 'engine-error', reason, ts: Date.now(), ...(meta || {}) })
}

window.addEventListener('error', function (e: any) {
  console.error('[ZEUS][GlobalError]', e.message, e.filename, e.lineno)
  const fn = (e.filename || '').toLowerCase()
  const isCoreEngine = fn.indexOf('/brain/') !== -1 || fn.indexOf('/core/') !== -1 || fn.indexOf('/trading/') !== -1 || fn.indexOf('/data/') !== -1 || fn.indexOf('/engine/') !== -1 || fn.indexOf('/bridge/') !== -1
  if (isCoreEngine && e.message && !/resizeobserver|script error/i.test(e.message)) {
    _showDegradedBanner(e.message, { filename: e.filename, lineno: e.lineno })
  }
})

window.addEventListener('unhandledrejection', function (e: any) {
  const reason = (e.reason && (e.reason.stack || e.reason.message)) || String(e.reason || 'unknown')
  console.error('[ZEUS][UnhandledRejection]', reason)
  if (/resizeobserver|abort/i.test(reason)) return
  _showDegradedBanner('unhandledrejection: ' + String(reason).slice(0, 200))
})

// ===== APP UPDATE CHECKER =====
let _updateCheckInterval: any = null
export function _checkAppUpdate(): void {
  if (!localStorage.getItem('zeus_app_version')) {
    fetch('/api/version').then(function (r) { return r.ok ? r.json() : null }).then(function (data: any) { if (data && data.version) { localStorage.setItem('zeus_app_version', data.version); console.log('[UPDATE] First run — saved version:', data.version) } }).catch(function () { })
  }
  if (_updateCheckInterval) clearInterval(_updateCheckInterval)
  _updateCheckInterval = setInterval(_pollForUpdate, 45000)
  setTimeout(_pollForUpdate, 5000)
}

function _pollForUpdate(): void {
  fetch('/api/version').then(function (r) { return r.ok ? r.json() : null }).then(function (data: any) {
    if (!data || !data.version) return
    const current = localStorage.getItem('zeus_app_version')
    console.log('[UPDATE] Server:', data.version, '| Local:', current)
    if (!current) { localStorage.setItem('zeus_app_version', data.version); return }
    if (current === data.version) return
    if (_updateCheckInterval) { clearInterval(_updateCheckInterval); _updateCheckInterval = null }
    _showUpdateBanner(data)
  }).catch(function (e: any) { console.log('[UPDATE] Poll failed:', e.message) })
}

function _showUpdateBanner(data: any): void {
  if (document.getElementById('zeus-update-banner')) return
  const overlay = document.createElement('div'); overlay.id = 'zeus-update-banner'
  overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,.6);z-index:999999;display:flex;align-items:center;justify-content:center;animation:fadeIn .3s ease'
  const box = document.createElement('div'); box.style.cssText = 'background:linear-gradient(135deg,#0a1628,#132040);border:1px solid #1e3a5f;border-radius:16px;padding:20px 24px;max-width:360px;width:90vw;max-height:85vh;display:flex;flex-direction:column;text-align:center;box-shadow:0 8px 40px rgba(0,0,0,.7)'
  const icon = document.createElement('div'); icon.style.cssText = 'font-size:40px;margin-bottom:8px;flex-shrink:0'; icon.textContent = '\u26A1'
  const title = document.createElement('div'); title.style.cssText = 'color:#fff;font-size:17px;font-weight:700;margin-bottom:10px;flex-shrink:0'; title.textContent = 'Update ' + data.version
  const desc = document.createElement('div'); desc.style.cssText = 'color:#8899bb;font-size:12px;margin-bottom:16px;line-height:1.5;flex:1 1 auto;overflow-y:auto;min-height:0;text-align:left;padding:0 4px'; desc.textContent = data.changelog || 'New version available'
  const btn = document.createElement('button'); btn.style.cssText = 'background:linear-gradient(135deg,#1565c0,#0d47a1);color:#fff;border:none;border-radius:10px;padding:14px 40px;font-size:15px;font-weight:700;cursor:pointer;width:100%;letter-spacing:.5px;text-transform:uppercase;flex-shrink:0'
  btn.textContent = '\uD83D\uDD04 INSTALL'; btn.onclick = function () { btn.textContent = 'Updating...'; btn.style.opacity = '0.6'; localStorage.setItem('zeus_app_version', data.version); setTimeout(function () { location.reload() }, 500) }
  const skip = document.createElement('div'); skip.style.cssText = 'color:#556;font-size:11px;margin-top:10px;cursor:pointer;flex-shrink:0'; skip.textContent = 'Later'
  skip.onclick = function () { overlay.remove(); _updateCheckInterval = setInterval(_pollForUpdate, 300000) }
  box.appendChild(icon); box.appendChild(title); box.appendChild(desc); box.appendChild(btn); box.appendChild(skip)
  overlay.appendChild(box); document.body.appendChild(overlay)
  if (typeof w.ncAdd === 'function') w.ncAdd('info', 'system', '\uD83C\uDD95 Update ' + data.version + (data.changelog ? ' \u2014 ' + data.changelog : ''))
}

// ===== STATUS BAR =====
// [R8] StatusBar is React/store-owned. This loop polls AT/TP/_SAFETY every 2s
// and writes the derived state into useUiStore via patch(). Zero direct DOM
// writes to zsb* nodes — React renders everything from store fields.
import { useUiStore } from '../stores/uiStore'
;(function _initStatusBar() {
  function _updateStatusBar() {
    try {
      const patch: Record<string, any> = {}
      if (typeof AT !== 'undefined') {
        const mode = AT._serverMode || AT.mode || 'demo'
        const _sbEnv = w._resolvedEnv || (mode === 'demo' ? 'DEMO' : 'REAL')
        patch.sbMode = _sbEnv === 'TESTNET' ? 'TESTNET' : mode.toUpperCase()
        patch.sbModeClass = _sbEnv === 'TESTNET' ? 'zsb-testnet' : (mode === 'live' ? 'zsb-live' : 'zsb-demo')
        patch.sbAtEnabled = !!AT.enabled
        patch.sbKillActive = !!AT.killTriggered
        patch.sbPnl = AT.totalPnL || AT.realizedDailyPnL || 0
      }
      patch.sbWsReady = !!(w._zeusWS && w._zeusWS.readyState === 1)
      if (typeof w._SAFETY !== 'undefined') {
        const stale = !!w._SAFETY.dataStalled
        const degraded = w._SAFETY.degradedFeeds && w._SAFETY.degradedFeeds.size > 0
        patch.sbDataState = stale ? 'stale' : degraded ? 'degraded' : 'ok'
      }
      if (typeof TP !== 'undefined') {
        const demoCount = (TP.demoPositions || []).filter(function (p: any) { return !p.closed }).length
        const liveCount = (TP.livePositions || []).filter(function (p: any) { return !p.closed }).length
        patch.sbPosCount = demoCount + liveCount
      }
      useUiStore.getState().patch(patch)
      if (typeof updateModeBar === 'function') updateModeBar()
    } catch (_) { }
  }
  function _startStatusBar() { if (w.__statusBarInterval) clearInterval(w.__statusBarInterval); w.__statusBarInterval = setInterval(_updateStatusBar, 2000); _updateStatusBar() }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', _startStatusBar)
  else _startStatusBar()
})()

// ===== DECISION LOG PANEL =====
let _dlogOpen = false
let _dlogFilter = 'all'
const _DLOG_CATS = ['all', 'at_block', 'at_entry', 'at_gate', 'confluence', 'regime', 'fusion', 'signal', 'sizing', 'kill_switch', 'dsl_move', 'dsl_close', 'predator']

export function _toggleDecisionPanel(): void {
  _dlogOpen = !_dlogOpen; const panel = document.getElementById('dlogPanel'); if (!panel) return
  panel.style.display = _dlogOpen ? 'flex' : 'none'; if (_dlogOpen) _renderDlog()
}

export function _renderDlog(): void {
  if (typeof w.DLog === 'undefined') return
  const filtersEl = document.getElementById('dlogFilters')
  if (filtersEl && !filtersEl.dataset.init) {
    filtersEl.dataset.init = '1'
    _DLOG_CATS.forEach(function (cat) { const btn = document.createElement('button'); btn.className = 'dlog-fbtn' + (cat === 'at_block' ? ' dlog-block' : (cat === 'at_entry' ? ' dlog-entry' : '')) + (cat === _dlogFilter ? ' active' : ''); btn.textContent = cat === 'all' ? 'ALL' : cat.replace(/_/g, ' ').toUpperCase(); btn.onclick = function () { _dlogFilter = cat; _renderDlogEntries(); _updateDlogFilterUI() }; filtersEl.appendChild(btn) })
  }
  _updateDlogFilterUI()
  const statsEl = document.getElementById('dlogStats')
  if (statsEl) { const st = w.DLog.stats(); const parts = ['Total: <span>' + st.total + '</span>']; for (const c in st.categories) { parts.push(c + ': <span>' + st.categories[c] + '</span>') }; statsEl.innerHTML = parts.join(' | ') }
  _renderDlogEntries()
}

function _updateDlogFilterUI(): void { const filtersEl = document.getElementById('dlogFilters'); if (!filtersEl) return; const btns = filtersEl.querySelectorAll('.dlog-fbtn'); btns.forEach(function (btn: any, i: number) { const cat = _DLOG_CATS[i]; if (cat === _dlogFilter) btn.classList.add('active'); else btn.classList.remove('active') }) }

function _renderDlogEntries(): void {
  if (typeof w.DLog === 'undefined') return
  const listEl = document.getElementById('dlogList'); if (!listEl) return
  const entries = _dlogFilter === 'all' ? w.DLog.entries(200) : w.DLog.byCategory(_dlogFilter, 200)
  if (entries.length === 0) { listEl.innerHTML = '<div style="padding:20px;text-align:center;color:#333;font-size:11px">No decisions logged yet.</div>'; return }
  let html = ''
  for (let i = 0; i < entries.length; i++) { const e = entries[i]; const ts = new Date(e.ts).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' }); const catClass = 'dlog-cat-' + (e.cat || 'unknown'); const detail = _dlogFormatDetail(e.cat, e.d); html += '<div class="dlog-entry-row"><span class="dlog-ts">' + ts + '</span><span class="dlog-cat ' + catClass + '">' + (e.cat || '?').toUpperCase() + '</span>' + detail + '</div>' }
  listEl.innerHTML = html
}

function _dlogFormatDetail(cat: string, d: any): string {
  if (!d) return ''
  try {
    if (cat === 'at_block') return '<span class="dlog-detail"><b>' + escHtml(d.sym || '?') + '</b> \u2014 ' + escHtml(Array.isArray(d.reasons) ? d.reasons.join(', ') : (d.reason || '?')) + (d.score != null ? ' | score=' + escHtml(d.score) : '') + (d.regime ? ' | regime=' + escHtml(d.regime) : '') + '</span>'
    if (cat === 'at_entry') return '<span class="dlog-detail"><b>' + escHtml(d.sym || d.symbol || '?') + ' ' + escHtml(d.side || '') + '</b>' + (d.tier ? ' tier=' + escHtml(d.tier) : '') + (d.conf != null ? ' conf=' + escHtml(d.conf) + '%' : '') + (d.size ? ' $' + escHtml(d.size) : '') + '</span>'
    if (cat === 'at_gate') return '<span class="dlog-detail"><b>' + escHtml(d.sym || '?') + '</b> gates: ' + (d.allOk ? '<b style="color:#00ff88">PASS</b>' : '<b style="color:#ff4444">FAIL</b>') + (Array.isArray(d.reasons) && d.reasons.length ? ' [' + escHtml(d.reasons.join(', ')) + ']' : '') + '</span>'
    if (cat === 'confluence') return '<span class="dlog-detail">score=<b>' + escHtml(d.score || '?') + '</b>' + (d.regime ? ' regime=' + escHtml(d.regime) : '') + '</span>'
    if (cat === 'regime') return '<span class="dlog-detail"><b>' + escHtml(d.regime || '?') + '</b> conf=' + escHtml(d.confidence || '?') + '%' + (d.trendBias ? ' bias=' + escHtml(d.trendBias) : '') + '</span>'
    if (cat === 'fusion') return '<span class="dlog-detail"><b>' + escHtml(d.decision || '?') + '</b> ' + escHtml(d.dir || '') + ' conf=' + escHtml(d.confidence || '?') + '%' + '</span>'
    if (cat === 'kill_switch') return '<span class="dlog-detail"><b style="color:#ff0000">KILL SWITCH</b> ' + escHtml(d.action || d.reason || '') + '</span>'
    const keys = Object.keys(d).slice(0, 6); const parts = keys.map(function (k) { return escHtml(k) + '=' + (typeof d[k] === 'object' ? escHtml(JSON.stringify(d[k])) : escHtml(d[k])) })
    return '<span class="dlog-detail">' + parts.join(' | ') + '</span>'
  } catch (_) { return '<span class="dlog-detail">' + escHtml(JSON.stringify(d).substring(0, 120)) + '</span>' }
}

// ===== ACTIVITY FEED =====
let _actfeedOpen = false
const _ACTFEED_ICONS: any = { at_entry: '\uD83D\uDCE5', at_block: '\uD83D\uDEAB', at_gate: '\uD83D\uDEA7', confluence: '\uD83D\uDD17', regime: '\uD83C\uDF10', fusion: '\u26A1', kill_switch: '\uD83D\uDED1', sizing: '\uD83D\uDCCF', dsl_move: '\uD83C\uDFAF', dsl_close: '\uD83D\uDCE4', predator: '\uD83D\uDC3E', signal: '\uD83D\uDCE1' }

export function _actfeedToggle(): void { _actfeedOpen = !_actfeedOpen; const panel = document.getElementById('actfeed-panel'); if (panel) panel.style.display = _actfeedOpen ? '' : 'none'; if (_actfeedOpen) _actfeedRender() }

export function _actfeedRender(): void {
  if (typeof w.DLog === 'undefined') return; const listEl = document.getElementById('actfeedList'); if (!listEl) return
  const important = ['at_entry', 'at_block', 'at_gate', 'regime', 'kill_switch', 'dsl_move', 'dsl_close', 'fusion']
  const all = w.DLog.entries(500); const filtered = all.filter(function (e: any) { return important.indexOf(e.cat) !== -1 }).slice(0, 50)
  if (filtered.length === 0) { listEl.innerHTML = '<div class="actfeed-empty">No activity yet.</div>'; return }
  let html = ''; for (let i = 0; i < filtered.length; i++) { const e = filtered[i]; const ts = new Date(e.ts).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' }); const icon = _ACTFEED_ICONS[e.cat] || '\u2022'; const msg = _actfeedMsg(e.cat, e.d); html += '<div class="actfeed-row"><span class="actfeed-ts">' + ts + '</span><span class="actfeed-icon">' + icon + '</span><span class="actfeed-msg">' + msg + '</span></div>' }
  listEl.innerHTML = html
}

function _actfeedMsg(cat: string, d: any): string {
  if (!d) return cat
  try {
    if (cat === 'at_entry') return '<b>' + (d.side || '') + ' ' + (d.sym || d.symbol || '?') + '</b> \u2014 entry ' + (d.tier || '') + (d.conf ? ' conf=' + d.conf + '%' : '')
    if (cat === 'at_block') return '<b>' + (d.sym || '?') + '</b> blocked \u2014 ' + (Array.isArray(d.reasons) ? d.reasons.join(', ') : (d.reason || '?'))
    if (cat === 'at_gate') return '<b>' + (d.sym || '?') + '</b> gates ' + (d.allOk ? '<b style="color:#00ff88">PASS</b>' : '<b style="color:#ff4444">FAIL</b>')
    if (cat === 'regime') return 'Regime: <b>' + (d.regime || '?') + '</b> conf=' + (d.confidence || '?') + '%'
    if (cat === 'kill_switch') return '<b style="color:#ff0000">KILL SWITCH</b> ' + (d.action || d.reason || 'activated')
    if (cat === 'fusion') return '<b>' + (d.decision || '?') + '</b> ' + (d.dir || '') + ' conf=' + (d.confidence || '?') + '%'
    if (cat === 'dsl_move') return 'DSL ' + (d.sym || d.symbol || '?') + ' SL moved'
    if (cat === 'dsl_close') return 'DSL exit ' + (d.sym || d.symbol || '?') + ' \u2014 ' + (d.reason || d.exitType || '?')
    return cat + ': ' + JSON.stringify(d).substring(0, 80)
  } catch (_) { return cat }
}

// Badge update loop
;(function _actfeedBadgeLoop() {
  function _updateBadge() {
    try {
      if (typeof w.DLog === 'undefined') return
      if (typeof w._pvState !== 'undefined' && w._pvState.open && w._pvState.dockId === 'activity') {
        const important = ['at_entry', 'at_block', 'at_gate', 'regime', 'kill_switch', 'dsl_move', 'dsl_close', 'fusion']
        const cutoff = Date.now() - 300000; const all = w.DLog.entries(200)
        const recent = all.filter(function (e: any) { return e.ts > cutoff && important.indexOf(e.cat) !== -1 })
        const el = document.getElementById('actfeedBadge'); if (el) el.textContent = recent.length + ' events (5m)'
        if (_actfeedOpen) _actfeedRender()
      }
    } catch (_) { }
  }
  setInterval(_updateBadge, 3000)
})()

export {}
