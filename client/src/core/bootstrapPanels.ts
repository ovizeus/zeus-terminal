// Zeus — core/bootstrapPanels.ts
// Ported 1:1 from public/js/core/bootstrap.js lines 2109-2803 (Chunk E)
// 7 analytic panels: Exposure, ExpoInline, CmdPalette, MissedTrades, SessionReview, RegimeHistory, Performance, Compare

import { escHtml } from '../utils/dom'
import { openM } from '../data/marketDataWS'
import { _toggleDecisionPanel } from './bootstrapError'
import { hubPopulate } from '../utils/dev'
import { toggleFS } from '../data/marketDataFeeds'
import { setSymbol } from '../data/marketDataWS'

const w = window as any

// ===== EXPOSURE DASHBOARD =====
let _exposureOpen = false
export function _toggleExposurePanel(): void { _exposureOpen = !_exposureOpen; const panel = document.getElementById('exposurePanel'); if (!panel) return; panel.style.display = _exposureOpen ? 'flex' : 'none'; if (_exposureOpen) _fetchExposure() }
export function _fetchExposure(): void {
  const content = document.getElementById('exposureContent'); if (!content) return
  content.innerHTML = '<div style="text-align:center;color:#333">Loading...</div>'
  fetch('/api/exposure', { credentials: 'same-origin' }).then(function (r) { return r.json() }).then(function (data: any) {
    if (!data.ok) { content.innerHTML = '<div style="color:#ff4444">Error: ' + escHtml(data.error || 'unknown') + '</div>'; return }
    let html = ''
    html += '<div class="expo-row"><span class="expo-label">Mode</span><span class="expo-val" style="color:' + (data.mode === 'live' ? '#ff4444' : '#00d4ff') + '">' + data.mode.toUpperCase() + '</span></div>'
    html += '<div class="expo-row"><span class="expo-label">Balance</span><span class="expo-val">$' + data.balance.toFixed(2) + '</span></div>'
    html += '<div class="expo-row"><span class="expo-label">Total Margin Used</span><span class="expo-val">$' + data.totalMargin.toFixed(2) + '</span></div>'
    const marginClass = data.marginUsagePct > 80 ? 'negative' : (data.marginUsagePct > 50 ? 'warn' : '')
    html += '<div class="expo-row"><span class="expo-label">Margin Usage</span><span class="expo-val ' + marginClass + '">' + data.marginUsagePct.toFixed(1) + '%</span></div>'
    html += '<div class="expo-bar"><div class="expo-bar-fill" style="width:' + Math.min(100, data.marginUsagePct) + '%"></div></div>'
    const pnlClass = data.unrealizedPnl > 0 ? 'positive' : (data.unrealizedPnl < 0 ? 'negative' : '')
    html += '<div class="expo-row"><span class="expo-label">Unrealized PnL</span><span class="expo-val ' + pnlClass + '">$' + data.unrealizedPnl.toFixed(2) + '</span></div>'
    html += '<div class="expo-row"><span class="expo-label">Open Positions</span><span class="expo-val">' + data.positionCount.total + ' (' + data.positionCount.demo + 'D / ' + data.positionCount.live + 'L)</span></div>'
    html += '<div class="expo-row"><span class="expo-label">Max Concentration</span><span class="expo-val ' + (data.maxConcentrationPct > 70 ? 'warn' : '') + '">' + data.maxConcentrationPct.toFixed(1) + '%</span></div>'
    html += '<div class="expo-row"><span class="expo-label">Kill Switch</span><span class="expo-val" style="color:' + (data.killActive ? '#ff4444' : '#00ff88') + '">' + (data.killActive ? 'ACTIVE' : 'OK') + '</span></div>'
    if (data.bySymbol && data.bySymbol.length > 0) { html += '<div class="expo-sym"><div class="expo-sym-hdr">PER-SYMBOL EXPOSURE</div>'; data.bySymbol.forEach(function (s: any) { html += '<div class="expo-sym-row"><span>' + s.symbol.replace('USDT', '') + ' <span style="color:#555">(' + s.sides.join('/') + ')</span></span><span>$' + s.margin.toFixed(0) + ' <span style="color:#555">' + s.concentrationPct.toFixed(0) + '%</span></span></div>'; html += '<div class="expo-bar"><div class="expo-bar-fill" style="width:' + Math.min(100, s.concentrationPct) + '%"></div></div>' }); html += '</div>' }
    content.innerHTML = html
  }).catch(function (err: any) { content.innerHTML = '<div style="color:#ff4444">Failed to load: ' + escHtml(err.message) + '</div>' })
}

// ===== EXPOSURE INLINE =====
let _expoInlineOpen = false
export function _toggleExpoInline(): void { _expoInlineOpen = !_expoInlineOpen; const panel = document.getElementById('expoInlinePanel'); const btn = document.getElementById('expoToggleBtn'); if (!panel) return; panel.style.display = _expoInlineOpen ? '' : 'none'; if (btn) btn.classList.toggle('active', _expoInlineOpen); if (_expoInlineOpen) _fetchExpoInline() }
function _fetchExpoInline(): void {
  const content = document.getElementById('expoInlineContent'); if (!content) return
  content.innerHTML = '<span style="color:#333">Loading...</span>'
  fetch('/api/exposure', { credentials: 'same-origin' }).then(function (r) { return r.json() }).then(function (data: any) {
    if (!data.ok) { content.innerHTML = '<span style="color:#ff4444">' + escHtml(data.error || 'Error') + '</span>'; return }
    let html = '<div style="display:flex;flex-wrap:wrap;gap:8px 16px">'
    html += '<div class="expo-row" style="border:0;padding:0"><span class="expo-label">Mode</span> <span class="expo-val" style="color:' + (data.mode === 'live' ? '#ff4444' : '#00d4ff') + '">' + data.mode.toUpperCase() + '</span></div>'
    html += '<div class="expo-row" style="border:0;padding:0"><span class="expo-label">Bal</span> <span class="expo-val">$' + data.balance.toFixed(0) + '</span></div>'
    html += '<div class="expo-row" style="border:0;padding:0"><span class="expo-label">Margin</span> <span class="expo-val">$' + data.totalMargin.toFixed(0) + ' (' + data.marginUsagePct.toFixed(0) + '%)</span></div>'
    const pnlColor = data.unrealizedPnl > 0 ? '#00ff88' : (data.unrealizedPnl < 0 ? '#ff4444' : '#555')
    html += '<div class="expo-row" style="border:0;padding:0"><span class="expo-label">uPnL</span> <span class="expo-val" style="color:' + pnlColor + '">$' + data.unrealizedPnl.toFixed(2) + '</span></div>'
    html += '<div class="expo-row" style="border:0;padding:0"><span class="expo-label">Pos</span> <span class="expo-val">' + data.positionCount.total + '</span></div>'
    if (data.maxConcentrationPct > 0) html += '<div class="expo-row" style="border:0;padding:0"><span class="expo-label">Conc</span> <span class="expo-val" style="color:' + (data.maxConcentrationPct > 70 ? '#ff8800' : '#bbb') + '">' + data.maxConcentrationPct.toFixed(0) + '%</span></div>'
    if (data.killActive) html += '<div class="expo-row" style="border:0;padding:0"><span class="expo-label">Kill</span> <span class="expo-val" style="color:#ff4444">ACTIVE</span></div>'
    html += '</div>'
    if (data.bySymbol && data.bySymbol.length > 0) { html += '<div style="margin-top:4px;display:flex;flex-wrap:wrap;gap:2px 12px">'; data.bySymbol.forEach(function (s: any) { html += '<span style="color:#666">' + s.symbol.replace('USDT', '') + ' <span style="color:#999">$' + s.margin.toFixed(0) + '</span> <span style="color:#444">' + s.concentrationPct.toFixed(0) + '%</span></span>' }); html += '</div>' }
    content.innerHTML = html
  }).catch(function (err: any) { content.innerHTML = '<span style="color:#ff4444">' + escHtml(err.message) + '</span>' })
}

// ===== COMMAND PALETTE =====
let _cmdOpen = false
let _cmdIdx = 0
const _CMD_ACTIONS: any[] = [
  { cat: 'symbol', label: 'BTC \u2014 Bitcoin', icon: '\u20BF', action: function () { (typeof w.setSymbol === 'function' ? w.setSymbol : setSymbol)('BTCUSDT') }, keys: 'btc bitcoin' },
  { cat: 'symbol', label: 'ETH \u2014 Ethereum', icon: '\u039E', action: function () { (typeof w.setSymbol === 'function' ? w.setSymbol : setSymbol)('ETHUSDT') }, keys: 'eth ethereum' },
  { cat: 'symbol', label: 'SOL \u2014 Solana', icon: '\u25CE', action: function () { (typeof w.setSymbol === 'function' ? w.setSymbol : setSymbol)('SOLUSDT') }, keys: 'sol solana' },
  { cat: 'nav', label: 'Open Settings', icon: '\u2699', action: function () { document.dispatchEvent(new CustomEvent('zeus:openModal', { detail: 'settings' })); hubPopulate() }, keys: 'settings config preferences' },
  { cat: 'nav', label: 'Open Decision Log', icon: '\uD83D\uDCCB', action: function () { document.dispatchEvent(new CustomEvent('zeus:openModal', { detail: 'decisionlog' })) }, keys: 'decisions dlog brain' },
  { cat: 'nav', label: 'View Missed Trades', icon: '\uD83D\uDEAB', action: function () { document.dispatchEvent(new CustomEvent('zeus:openModal', { detail: 'missed' })); setTimeout(_showMissedTrades, 50) }, keys: 'missed trades blocked' },
  { cat: 'nav', label: 'Session Review', icon: '\uD83D\uDCD1', action: function () { document.dispatchEvent(new CustomEvent('zeus:openModal', { detail: 'session' })); setTimeout(_showSessionReview, 50) }, keys: 'session review summary today' },
  { cat: 'nav', label: 'Regime History', icon: '\uD83C\uDF10', action: function () { document.dispatchEvent(new CustomEvent('zeus:openModal', { detail: 'regime' })); setTimeout(_showRegimeHistory, 50) }, keys: 'regime history timeline' },
  { cat: 'nav', label: 'Performance Dashboard', icon: '\uD83C\uDFC6', action: function () { document.dispatchEvent(new CustomEvent('zeus:openModal', { detail: 'performance' })); setTimeout(function () { _showPerformance() }, 50) }, keys: 'performance stats equity' },
  { cat: 'nav', label: 'Strategy Comparison', icon: '\u2696', action: function () { document.dispatchEvent(new CustomEvent('zeus:openModal', { detail: 'compare' })); setTimeout(_showCompare, 50) }, keys: 'compare strategy' },
  { cat: 'action', label: 'Toggle AutoTrade', icon: '\u26A1', action: function () { if (typeof w.toggleAutoTrade === 'function') w.toggleAutoTrade() }, keys: 'at autotrade toggle' },
  { cat: 'action', label: 'Toggle Fullscreen', icon: '\u26F6', action: function () { toggleFS() }, keys: 'fullscreen chart' },
  { cat: 'info', label: 'Keyboard Shortcuts', icon: '\u2328', action: function () { document.dispatchEvent(new KeyboardEvent('keydown', { key: '?' })) }, keys: 'hotkeys shortcuts help' },
]

export function _toggleCmdPalette(): void { _cmdOpen = !_cmdOpen; const el = document.getElementById('cmdPalette'); if (!el) return; el.style.display = _cmdOpen ? 'flex' : 'none'; if (_cmdOpen) { const input = document.getElementById('cmdInput') as HTMLInputElement | null; if (input) { input.value = ''; setTimeout(function () { input.focus() }, 50); setTimeout(function () { input.focus() }, 200) }; _cmdIdx = 0; _cmdRender('') } }
export function _cmdSetOpen(v: boolean): void { _cmdOpen = v }

export function _cmdRender(query: string): void {
  const results = document.getElementById('cmdResults') as any; if (!results) return
  const q = (query || '').toLowerCase().trim()
  const filtered = q ? _CMD_ACTIONS.filter(function (a: any) { return a.label.toLowerCase().indexOf(q) !== -1 || a.keys.indexOf(q) !== -1 }) : _CMD_ACTIONS
  if (filtered.length === 0) { results.innerHTML = '<div class="cmd-empty">No results for "' + q + '"</div>'; return }
  _cmdIdx = Math.max(0, Math.min(_cmdIdx, filtered.length - 1))
  results.innerHTML = filtered.map(function (a: any, i: number) { return '<div class="cmd-item' + (i === _cmdIdx ? ' active' : '') + '" data-cmd-idx="' + i + '"><span class="cmd-item-icon">' + a.icon + '</span><span class="cmd-item-label">' + a.label + '</span><span class="cmd-item-hint">' + a.cat + '</span></div>' }).join('')
  results._cmdFiltered = filtered
  const active = results.querySelector('.active'); if (active) active.scrollIntoView({ block: 'nearest' })
}

document.addEventListener('keydown', function (e: any) {
  if ((e.ctrlKey || e.metaKey) && e.key === 'k') { e.preventDefault(); _toggleCmdPalette(); return }
  if (!_cmdOpen) return
  if (e.key === 'Escape') { _closeCmdPalette(); return }
  if (e.key === 'ArrowDown') { e.preventDefault(); _cmdIdx++; _cmdRender((document.getElementById('cmdInput') as any)?.value || ''); return }
  if (e.key === 'ArrowUp') { e.preventDefault(); _cmdIdx = Math.max(0, _cmdIdx - 1); _cmdRender((document.getElementById('cmdInput') as any)?.value || ''); return }
  if (e.key === 'Enter') { e.preventDefault(); const results = document.getElementById('cmdResults') as any; const filtered = results?._cmdFiltered || []; if (filtered[_cmdIdx]) { _closeCmdPalette(); filtered[_cmdIdx].action() }; return }
})
document.addEventListener('input', function (e: any) { if (e.target && e.target.id === 'cmdInput') { _cmdIdx = 0; _cmdRender(e.target.value) } })
function _closeCmdPalette(): void { _cmdOpen = false; document.dispatchEvent(new CustomEvent('zeus:closeModal')) }
document.addEventListener('click', function (e: any) { const panel = document.getElementById('cmdPalette'); if (!panel || panel.style.display === 'none') return; if (e.target && e.target.id === 'cmdPalette') { _closeCmdPalette(); return }; const item = e.target.closest ? e.target.closest('.cmd-item') : null; if (item && item.dataset.cmdIdx != null) { const idx = parseInt(item.dataset.cmdIdx, 10); const results = document.getElementById('cmdResults') as any; const filtered = results?._cmdFiltered || []; if (filtered[idx]) { _closeCmdPalette(); filtered[idx].action() } } })

// ===== MISSED TRADES =====
export function _showMissedTrades(): void {
  const content = document.getElementById('missedContent'); if (!content) return
  content.innerHTML = '<div style="text-align:center;color:#333;padding:16px">Loading...</div>'
  fetch('/api/missed-trades?limit=100', { credentials: 'same-origin' }).then(function (r) { return r.json() }).then(function (data: any) {
    if (!data.ok || !data.trades || data.trades.length === 0) { content.innerHTML = '<div style="text-align:center;color:#333;padding:20px;font-size:11px">No missed trades recorded yet.</div>'; return }
    const reasons: any = {}; data.trades.forEach(function (t: any) { reasons[t.reason] = (reasons[t.reason] || 0) + 1 })
    let statsHtml = '<div style="padding:8px 16px;font-size:9px;color:#555;border-bottom:1px solid #0f0f1a;display:flex;gap:10px;flex-wrap:wrap">'; statsHtml += '<span>Total: <b style="color:#888">' + data.trades.length + '</b></span>'
    for (const r in reasons) { const color = r === 'KILL_SWITCH' ? '#ff4444' : (r === 'AT_DISABLED' ? '#aa44ff' : '#ff8800'); statsHtml += '<span>' + r.replace(/_/g, ' ') + ': <b style="color:' + color + '">' + reasons[r] + '</b></span>' }
    statsHtml += '</div>'
    const rowsHtml = data.trades.map(function (t: any) { const sideColor = t.side === 'LONG' ? '#00ff88' : '#ff4444'; const reasonColor = t.reason === 'KILL_SWITCH' ? '#ff4444' : (t.reason === 'AT_DISABLED' ? '#aa44ff' : '#ff8800'); const ts = new Date(t.created_at).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }); return '<div class="dlog-entry-row"><span class="dlog-ts">' + ts + '</span><span style="color:' + sideColor + ';font-weight:700;font-size:9px;margin-right:4px">' + t.side + '</span><span style="color:#ccc;margin-right:6px">' + (t.symbol || '').replace('USDT', '') + '</span><span style="color:' + reasonColor + ';font-size:9px;font-weight:600">' + t.reason.replace(/_/g, ' ') + '</span><span style="color:#555;margin-left:auto;font-size:9px">$' + (t.price || 0).toFixed(0) + ' | ' + (t.tier || '?') + ' | conf=' + (t.confidence || 0) + '%</span></div>' }).join('')
    content.innerHTML = statsHtml + rowsHtml
  }).catch(function (err: any) { content.innerHTML = '<div style="color:#ff4444;padding:16px">' + escHtml(err.message) + '</div>' })
}

// ===== SESSION REVIEW =====
export function _showSessionReview(): void {
  const content = document.getElementById('sessionContent'); const dateEl = document.getElementById('sessionDate')
  if (!content) return; content.innerHTML = '<div style="text-align:center;color:#333;padding:20px">Loading...</div>'
  fetch('/api/session-review', { credentials: 'same-origin' }).then(function (r) { return r.json() }).then(function (data: any) {
    if (!data.ok) { content.innerHTML = '<div style="color:#ff4444">' + escHtml(data.error || 'Error') + '</div>'; return }
    if (dateEl) dateEl.textContent = data.date; const s = data.summary; let html = ''
    const pnlClass = s.totalPnl > 0 ? 'positive' : (s.totalPnl < 0 ? 'negative' : 'zero')
    html += '<div class="sr-hero"><div class="sr-pnl ' + pnlClass + '">$' + s.totalPnl.toFixed(2) + '</div>'
    html += '<div class="sr-sub">' + s.totalTrades + ' trades | ' + s.wins + 'W / ' + s.losses + 'L | WR: ' + s.winRate + '%</div>'
    if (data.missedCount > 0) html += '<div class="sr-sub" style="color:#ff8800">' + data.missedCount + ' missed</div>'; html += '</div>'
    html += '<div class="sr-grid">'
    html += '<div class="sr-card"><div class="sr-card-label">Avg PnL</div><div class="sr-card-val" style="color:' + (s.avgPnl >= 0 ? '#00ff88' : '#ff4444') + '">$' + s.avgPnl.toFixed(2) + '</div></div>'
    html += '<div class="sr-card"><div class="sr-card-label">Avg Hold</div><div class="sr-card-val">' + s.avgHoldMin + 'min</div></div>'
    if (s.bestTrade) html += '<div class="sr-card"><div class="sr-card-label">Best</div><div class="sr-card-val" style="color:#00ff88">$' + (s.bestTrade.pnl || 0).toFixed(2) + '</div></div>'
    if (s.worstTrade) html += '<div class="sr-card"><div class="sr-card-label">Worst</div><div class="sr-card-val" style="color:#ff4444">$' + (s.worstTrade.pnl || 0).toFixed(2) + '</div></div>'
    html += '</div>'
    if (data.symbols && Object.keys(data.symbols).length > 0) { html += '<div class="sr-section"><div class="sr-section-title">PER SYMBOL</div>'; const maxSymPnl = Math.max.apply(null, Object.values(data.symbols).map(function (v: any) { return Math.abs(v.pnl) })) || 1; for (const sym in data.symbols) { const sv = data.symbols[sym]; const pct = Math.abs(sv.pnl) / maxSymPnl * 100; const color = sv.pnl >= 0 ? '#00ff88' : '#ff4444'; html += '<div class="sr-bar-row"><span class="sr-bar-label">' + sym.replace('USDT', '') + '</span><div class="sr-bar-track"><div class="sr-bar-fill" style="width:' + pct + '%;background:' + color + '"></div></div><span class="sr-bar-val" style="color:' + color + '">$' + sv.pnl.toFixed(2) + ' (' + sv.count + ')</span></div>' }; html += '</div>' }
    if (s.totalTrades === 0) html = '<div style="text-align:center;padding:30px;color:#333;font-size:12px">No trades closed today yet.</div>'
    content.innerHTML = html
  }).catch(function (err: any) { content.innerHTML = '<div style="color:#ff4444;padding:16px">' + escHtml(err.message) + '</div>' })
}

// ===== REGIME HISTORY =====
export function _showRegimeHistory(): void {
  const content = document.getElementById('regimeContent'); if (!content) return
  content.innerHTML = '<div style="text-align:center;color:#333;padding:20px">Loading...</div>'
  fetch('/api/regime-history?limit=200', { credentials: 'same-origin' }).then(function (r) { return r.json() }).then(function (data: any) {
    if (!data.ok || !data.history || data.history.length === 0) { content.innerHTML = '<div style="text-align:center;color:#333;padding:20px;font-size:11px">No regime changes recorded yet.</div>'; return }
    const counts: any = {}; data.history.forEach(function (h: any) { counts[h.regime] = (counts[h.regime] || 0) + 1 })
    let statsHtml = '<div class="rh-stats">'; statsHtml += '<span>Total: <b style="color:#888">' + data.history.length + '</b></span>'
    for (const reg in counts) { statsHtml += '<span><span class="rh-regime rh-regime-' + reg + '">' + reg + '</span> ' + counts[reg] + '</span>' }; statsHtml += '</div>'
    const rowsHtml = data.history.map(function (h: any) { const ts = h.created_at ? new Date(h.created_at + 'Z').toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '?'; return '<div class="rh-row"><span class="rh-ts">' + ts + '</span><span class="rh-sym">' + (h.symbol || '').replace('USDT', '') + '</span>' + (h.prev_regime ? '<span class="rh-regime rh-regime-' + h.prev_regime + '">' + h.prev_regime + '</span>' : '') + '<span class="rh-arrow">&rarr;</span><span class="rh-regime rh-regime-' + h.regime + '">' + h.regime + '</span><span class="rh-conf">' + (h.confidence || 0) + '%</span><span class="rh-price">$' + (h.price || 0).toFixed(h.price >= 100 ? 0 : 2) + '</span></div>' }).join('')
    content.innerHTML = statsHtml + rowsHtml
  }).catch(function (err: any) { content.innerHTML = '<div style="color:#ff4444;padding:16px">' + escHtml(err.message) + '</div>' })
}

// ===== PERFORMANCE =====
let _perfMode = ''
export function _showPerformance(mode?: string): void {
  _perfMode = mode || ''
  const tabs = document.getElementById('perfModeTabs') as any
  if (tabs && !tabs.dataset.init) { tabs.dataset.init = '1'; ['all', 'demo', 'live'].forEach(function (m) { const btn = document.createElement('button'); btn.className = 'perf-tab' + (m === '' || m === 'all' ? ' active' : ''); btn.textContent = m === 'all' ? 'ALL' : m.toUpperCase(); btn.onclick = function () { tabs.querySelectorAll('.perf-tab').forEach(function (b: any) { b.classList.remove('active') }); btn.classList.add('active'); _showPerformance(m === 'all' ? '' : m) }; tabs.appendChild(btn) }) }
  const content = document.getElementById('perfContent'); if (!content) return
  content.innerHTML = '<div style="text-align:center;color:#333;padding:20px">Loading...</div>'
  fetch('/api/performance' + (_perfMode ? '?mode=' + _perfMode : ''), { credentials: 'same-origin' }).then(function (r) { return r.json() }).then(function (data: any) {
    if (!data.ok) { content.innerHTML = '<div style="color:#ff4444;padding:16px">' + escHtml(data.error || 'Error') + '</div>'; return }
    if (data.empty) { content.innerHTML = '<div style="text-align:center;color:#333;padding:30px;font-size:11px">No trades yet.</div>'; return }
    let html = ''; const pnlColor = data.totalPnl > 0 ? '#00ff88' : (data.totalPnl < 0 ? '#ff4444' : '#555')
    html += '<div class="perf-hero"><div class="perf-stat"><div class="perf-stat-val" style="color:' + pnlColor + '">$' + data.totalPnl.toFixed(2) + '</div><div class="perf-stat-lbl">TOTAL PNL</div></div><div class="perf-stat"><div class="perf-stat-val">' + data.totalTrades + '</div><div class="perf-stat-lbl">TRADES</div></div><div class="perf-stat"><div class="perf-stat-val" style="color:#ff4444">-$' + data.maxDrawdown.toFixed(2) + '</div><div class="perf-stat-lbl">MAX DD</div></div><div class="perf-stat"><div class="perf-stat-val" style="color:#00ff88">' + data.bestWinStreak + '</div><div class="perf-stat-lbl">WIN STREAK</div></div><div class="perf-stat"><div class="perf-stat-val" style="color:#ff4444">' + data.worstLossStreak + '</div><div class="perf-stat-lbl">LOSS STREAK</div></div></div>'
    if (data.equity && data.equity.length > 0) { const eqRange = Math.max(Math.abs(Math.min.apply(null, data.equity.map(function (e: any) { return e.pnl }))), Math.abs(Math.max.apply(null, data.equity.map(function (e: any) { return e.pnl })))) || 1; html += '<div class="perf-eq"><div class="perf-eq-title">EQUITY CURVE</div><div class="perf-eq-bar">'; const step = Math.max(1, Math.floor(data.equity.length / 80)); for (let ei = 0; ei < data.equity.length; ei += step) { const e = data.equity[ei]; const h = Math.abs(e.pnl) / eqRange * 36; const c = e.pnl >= 0 ? '#00ff88' : '#ff4444'; html += '<div class="perf-eq-col" style="height:' + Math.max(1, h) + 'px;background:' + c + '" title="$' + e.pnl.toFixed(2) + '"></div>' }; html += '</div></div>' }
    if (data.calendar && Object.keys(data.calendar).length > 0) { const days = Object.keys(data.calendar).sort(); const calMax = Math.max.apply(null, Object.values(data.calendar).map(function (d: any) { return Math.abs(d.pnl) })) || 1; html += '<div class="perf-cal"><div class="perf-eq-title">P&L CALENDAR</div><div class="perf-cal-grid">'; days.forEach(function (day) { const d = (data.calendar as any)[day]; const intensity = Math.min(1, Math.abs(d.pnl) / calMax); const bg = d.pnl >= 0 ? 'rgba(0,255,136,' + (0.15 + intensity * 0.7) + ')' : 'rgba(255,68,68,' + (0.15 + intensity * 0.7) + ')'; html += '<div class="perf-cal-day" style="background:' + bg + '" title="' + day + ': $' + d.pnl.toFixed(2) + '">' + day.slice(8) + '</div>' }); html += '</div></div>' }
    content.innerHTML = html
  }).catch(function (err: any) { content.innerHTML = '<div style="color:#ff4444;padding:16px">' + escHtml(err.message) + '</div>' })
}

// ===== STRATEGY COMPARISON =====
export function _showCompare(): void {
  const content = document.getElementById('compareContent'); if (!content) return
  content.innerHTML = '<div style="text-align:center;color:#333;padding:20px">Loading...</div>'
  fetch('/api/compare', { credentials: 'same-origin' }).then(function (r) { return r.json() }).then(function (data: any) {
    if (!data.ok) { content.innerHTML = '<div style="color:#ff4444;padding:16px">' + escHtml(data.error || 'Error') + '</div>'; return }
    let html = ''
    html += _cmpSection('DEMO vs LIVE', ['Metric', 'DEMO', 'LIVE'], data.demoVsLive.demo, data.demoVsLive.live)
    html += _cmpSection(data.thisVsLast.thisLabel + ' vs ' + data.thisVsLast.lastLabel, ['Metric', 'THIS MONTH', 'LAST MONTH'], data.thisVsLast.thisMonth, data.thisVsLast.lastMonth)
    if (!data.demoVsLive.demo.trades && !data.demoVsLive.live.trades) html = '<div style="text-align:center;color:#333;padding:30px;font-size:11px">No trades yet to compare.</div>'
    content.innerHTML = html
  }).catch(function (err: any) { content.innerHTML = '<div style="color:#ff4444;padding:16px">' + escHtml(err.message) + '</div>' })
}

function _cmpSection(title: string, headers: string[], setA: any, setB: any): string {
  const metrics = [{ key: 'trades', label: 'Trades' }, { key: 'wins', label: 'Wins' }, { key: 'losses', label: 'Losses' }, { key: 'winRate', label: 'Win Rate %' }, { key: 'totalPnl', label: 'Total PnL' }, { key: 'avgPnl', label: 'Avg PnL' }, { key: 'avgHoldMin', label: 'Avg Hold (min)' }, { key: 'maxDD', label: 'Max Drawdown' }, { key: 'bestTrade', label: 'Best Trade' }, { key: 'worstTrade', label: 'Worst Trade' }]
  let html = '<div class="cmp-section"><div class="cmp-title">' + title + '</div><table class="cmp-table"><tr>'; headers.forEach(function (h) { html += '<th>' + h + '</th>' }); html += '</tr>'
  metrics.forEach(function (m) { const a = setA[m.key]; const b = setB[m.key]; let clsA = (m.key === 'totalPnl' || m.key === 'avgPnl') ? (a > 0 ? 'cmp-pos' : (a < 0 ? 'cmp-neg' : '')) : ''; let clsB = (m.key === 'totalPnl' || m.key === 'avgPnl') ? (b > 0 ? 'cmp-pos' : (b < 0 ? 'cmp-neg' : '')) : ''; if (m.key === 'winRate' || m.key === 'totalPnl' || m.key === 'avgPnl') { if (a > b) clsA += ' cmp-hi'; else if (b > a) clsB += ' cmp-hi' }; html += '<tr><td>' + m.label + '</td><td class="' + clsA + '">' + _cmpFmt(m.key, a) + '</td><td class="' + clsB + '">' + _cmpFmt(m.key, b) + '</td></tr>' })
  html += '</table></div>'; return html
}

function _cmpFmt(key: string, val: any): string {
  if (val === null || val === undefined) return '\u2014'
  if (key === 'totalPnl' || key === 'avgPnl' || key === 'maxDD' || key === 'bestTrade' || key === 'worstTrade') return '$' + val.toFixed(2)
  if (key === 'winRate' || key === 'avgCaptured') return val + '%'
  if (key === 'avgHoldMin') return val + 'm'
  return '' + val
}
