// Zeus — core/bootstrapError.ts
// Ported 1:1 from public/js/core/bootstrap.js lines 1722-2108 (Chunk D)
// Error boundary, __ZEUS_INIT__ guard, status bar, app update, DLOG panel, activity feed

import { getATObject, getTPObject } from '../services/stateAccessors'
import { updateModeBar } from '../ui/modebar'
const w = window as any // kept for w.DLog, w._SAFETY, w._resolvedEnv, w._zeusWS, w._pvState, w.ncAdd, fn calls
// [8D-4A] mutable refs
const AT = (window as any).AT || ((window as any).AT = {})
const TP = (window as any).TP || ((window as any).TP = {})

// ===== GLOBAL ERROR BOUNDARY =====
window.addEventListener('error', function (e: any) {
  console.error('[ZEUS][GlobalError]', e.message, e.filename, e.lineno)
  const fn = (e.filename || '').toLowerCase()
  const isCoreEngine = fn.indexOf('/brain/') !== -1 || fn.indexOf('/core/') !== -1 || fn.indexOf('/trading/') !== -1 || fn.indexOf('/data/') !== -1
  if (isCoreEngine && e.message && !/resizeobserver|script error/i.test(e.message)) {
    const banner = document.getElementById('engineErrorBanner')
    if (banner) banner.style.display = 'block'
  }
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
  const box = document.createElement('div'); box.style.cssText = 'background:linear-gradient(135deg,#0a1628,#132040);border:1px solid #1e3a5f;border-radius:16px;padding:28px 32px;max-width:360px;width:90vw;text-align:center;box-shadow:0 8px 40px rgba(0,0,0,.7)'
  const icon = document.createElement('div'); icon.style.cssText = 'font-size:48px;margin-bottom:12px'; icon.textContent = '\u26A1'
  const title = document.createElement('div'); title.style.cssText = 'color:#fff;font-size:18px;font-weight:700;margin-bottom:8px'; title.textContent = 'Update ' + data.version
  const desc = document.createElement('div'); desc.style.cssText = 'color:#8899bb;font-size:13px;margin-bottom:20px;line-height:1.4'; desc.textContent = data.changelog || 'New version available'
  const btn = document.createElement('button'); btn.style.cssText = 'background:linear-gradient(135deg,#1565c0,#0d47a1);color:#fff;border:none;border-radius:10px;padding:14px 40px;font-size:15px;font-weight:700;cursor:pointer;width:100%;letter-spacing:.5px;text-transform:uppercase'
  btn.textContent = '\uD83D\uDD04 INSTALL'; btn.onclick = function () { btn.textContent = 'Updating...'; btn.style.opacity = '0.6'; localStorage.setItem('zeus_app_version', data.version); setTimeout(function () { location.reload() }, 500) }
  const skip = document.createElement('div'); skip.style.cssText = 'color:#556;font-size:11px;margin-top:12px;cursor:pointer'; skip.textContent = 'Later'
  skip.onclick = function () { overlay.remove(); _updateCheckInterval = setInterval(_pollForUpdate, 300000) }
  box.appendChild(icon); box.appendChild(title); box.appendChild(desc); box.appendChild(btn); box.appendChild(skip)
  overlay.appendChild(box); document.body.appendChild(overlay)
  if (typeof w.ncAdd === 'function') w.ncAdd('info', 'system', '\uD83C\uDD95 Update ' + data.version + (data.changelog ? ' \u2014 ' + data.changelog : ''))
}

// ===== STATUS BAR =====
;(function _initStatusBar() {
  function _updateStatusBar() {
    try {
      const modeEl = document.getElementById('zsbMode')
      if (modeEl && typeof AT !== 'undefined') { const mode = AT._serverMode || AT.mode || 'demo'; const _sbEnv = w._resolvedEnv || (mode === 'demo' ? 'DEMO' : 'REAL'); modeEl.textContent = _sbEnv === 'TESTNET' ? 'TESTNET' : mode.toUpperCase(); modeEl.className = 'zsb-item zsb-mode ' + (_sbEnv === 'TESTNET' ? 'zsb-testnet' : (mode === 'live' ? 'zsb-live' : 'zsb-demo')) }
      const atEl = document.getElementById('zsbAT'); if (atEl && typeof AT !== 'undefined') { const on = !!AT.enabled; atEl.innerHTML = '<span class="zsb-dot ' + (on ? 'zsb-on' : 'zsb-off') + '"></span>AT ' + (on ? 'ON' : 'OFF') }
      const wsEl = document.getElementById('zsbWS'); if (wsEl) { const wsOk = !!(w._zeusWS && w._zeusWS.readyState === 1); wsEl.innerHTML = '<span class="zsb-dot ' + (wsOk ? 'zsb-on' : 'zsb-warn') + '"></span>' + (wsOk ? 'WS' : 'WS...') }
      const dataEl = document.getElementById('zsbData'); if (dataEl && typeof w._SAFETY !== 'undefined') { const stale = !!w._SAFETY.dataStalled; const degraded = w._SAFETY.degradedFeeds && w._SAFETY.degradedFeeds.size > 0; const cls = stale ? 'zsb-warn' : (degraded ? 'zsb-stale' : 'zsb-on'); const txt = stale ? 'STALE' : (degraded ? 'DEGRADED' : 'DATA'); dataEl.innerHTML = '<span class="zsb-dot ' + cls + '"></span>' + txt }
      const killEl = document.getElementById('zsbKill'); const killSep = document.getElementById('zsbKillSep'); if (killEl && typeof AT !== 'undefined') { const killActive = !!AT.killTriggered; killEl.style.display = killActive ? '' : 'none'; if (killSep) killSep.style.display = killActive ? '' : 'none'; if (killActive) killEl.innerHTML = '<span class="zsb-dot zsb-warn"></span>KILL ACTIVE' }
      const posEl = document.getElementById('zsbPos'); if (posEl && typeof TP !== 'undefined') { const demoCount = (TP.demoPositions || []).filter(function (p: any) { return !p.closed }).length; const liveCount = (TP.livePositions || []).filter(function (p: any) { return !p.closed }).length; const total = demoCount + liveCount; posEl.textContent = total + ' pos'; posEl.style.color = total > 0 ? 'var(--cyan)' : '#555' }
      const pnlEl = document.getElementById('zsbPnl'); if (pnlEl && typeof AT !== 'undefined') { const pnl = AT.totalPnL || AT.realizedDailyPnL || 0; pnlEl.textContent = '$' + pnl.toFixed(2); pnlEl.style.color = pnl > 0 ? 'var(--grn-bright)' : (pnl < 0 ? 'var(--red-bright)' : '#555') }
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

function _renderDlog(): void {
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
    if (cat === 'at_block') return '<span class="dlog-detail"><b>' + (d.sym || '?') + '</b> \u2014 ' + (Array.isArray(d.reasons) ? d.reasons.join(', ') : (d.reason || '?')) + (d.score != null ? ' | score=' + d.score : '') + (d.regime ? ' | regime=' + d.regime : '') + '</span>'
    if (cat === 'at_entry') return '<span class="dlog-detail"><b>' + (d.sym || d.symbol || '?') + ' ' + (d.side || '') + '</b>' + (d.tier ? ' tier=' + d.tier : '') + (d.conf != null ? ' conf=' + d.conf + '%' : '') + (d.size ? ' $' + d.size : '') + '</span>'
    if (cat === 'at_gate') return '<span class="dlog-detail"><b>' + (d.sym || '?') + '</b> gates: ' + (d.allOk ? '<b style="color:#00ff88">PASS</b>' : '<b style="color:#ff4444">FAIL</b>') + (Array.isArray(d.reasons) && d.reasons.length ? ' [' + d.reasons.join(', ') + ']' : '') + '</span>'
    if (cat === 'confluence') return '<span class="dlog-detail">score=<b>' + (d.score || '?') + '</b>' + (d.regime ? ' regime=' + d.regime : '') + '</span>'
    if (cat === 'regime') return '<span class="dlog-detail"><b>' + (d.regime || '?') + '</b> conf=' + (d.confidence || '?') + '%' + (d.trendBias ? ' bias=' + d.trendBias : '') + '</span>'
    if (cat === 'fusion') return '<span class="dlog-detail"><b>' + (d.decision || '?') + '</b> ' + (d.dir || '') + ' conf=' + (d.confidence || '?') + '%' + '</span>'
    if (cat === 'kill_switch') return '<span class="dlog-detail"><b style="color:#ff0000">KILL SWITCH</b> ' + (d.action || d.reason || '') + '</span>'
    const keys = Object.keys(d).slice(0, 6); const parts = keys.map(function (k) { return k + '=' + (typeof d[k] === 'object' ? JSON.stringify(d[k]) : d[k]) })
    return '<span class="dlog-detail">' + parts.join(' | ') + '</span>'
  } catch (_) { return '<span class="dlog-detail">' + JSON.stringify(d).substring(0, 120) + '</span>' }
}

// ===== ACTIVITY FEED =====
let _actfeedOpen = false
const _ACTFEED_ICONS: any = { at_entry: '\uD83D\uDCE5', at_block: '\uD83D\uDEAB', at_gate: '\uD83D\uDEA7', confluence: '\uD83D\uDD17', regime: '\uD83C\uDF10', fusion: '\u26A1', kill_switch: '\uD83D\uDED1', sizing: '\uD83D\uDCCF', dsl_move: '\uD83C\uDFAF', dsl_close: '\uD83D\uDCE4', predator: '\uD83D\uDC3E', signal: '\uD83D\uDCE1' }

export function _actfeedToggle(): void { _actfeedOpen = !_actfeedOpen; const panel = document.getElementById('actfeed-panel'); if (panel) panel.style.display = _actfeedOpen ? '' : 'none'; if (_actfeedOpen) _actfeedRender() }

function _actfeedRender(): void {
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
