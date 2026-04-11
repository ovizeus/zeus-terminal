// Zeus — teacher/teacherPanel.ts
// Ported 1:1 from public/js/teacher/teacherPanel.js (Phase 7C)
// THE TEACHER V2 — AUTONOMOUS DASHBOARD PANEL
// [8E-3] w.TEACHER reads migrated to getTeacher()
import { getTeacher } from '../services/stateAccessors'
import { _ZI } from '../constants/icons'

const w = window as any

/* ── helpers ── */
function _tEl(id: any): any { return document.getElementById(id) }
function _tHide(el: any): void { if (el) el.style.display = 'none' }
function _tShow(el: any, d?: any): void { if (el) el.style.display = d || 'block' }
function _tText(id: any, v: any): void { const e = _tEl(id); if (e) e.textContent = v }
function _tHtml(id: any, v: any): void { const e = _tEl(id); if (e) e.innerHTML = v }
function _tPct(v: any): string { return v != null ? (v >= 0 ? '+' : '') + v.toFixed(2) + '%' : '—' }
function _tUSD(v: any): string { return v != null ? '$' + v.toFixed(2) : '—' }
function _tNum(v: any, d?: any): string { return v != null ? Number(v).toFixed(d || 0) : '—' }
function _tClr(v: any): string { return v > 0 ? '#00e676' : v < 0 ? '#ff5252' : '#778899' }

/* ── state ── */
let _teacherPanelOpen = false
let _teacherTab = 'replay'
let _teacherV2RefreshTimer: any = null

/* ═══════════════════════════════════════════════════════════════
   TOGGLE
   ═══════════════════════════════════════════════════════════════ */
export function teacherToggle(): void {
  _teacherPanelOpen = !_teacherPanelOpen
  const strip = _tEl('teacher-strip')
  if (strip) strip.classList.toggle('teacher-open', _teacherPanelOpen)
  try { localStorage.setItem('zeus_teacher_panel_open', _teacherPanelOpen ? '1' : '0') } catch (_) { /* silent */ }
  if (!_teacherPanelOpen) _teacherUpdateBarInfo()
}

function _teacherUpdateBarInfo(): void {
  const info = _tEl('teacher-bar-info'); const sum = _tEl('teacher-bar-summary')
  if (!info || !sum) return
  const T = getTeacher()
  if (!T || !T.v2) { info.textContent = 'IDLE · sandbox'; sum.style.display = 'none'; return }
  const v2 = T.v2; const parts: any[] = []
  parts.push(v2.running ? 'TRAINING' : 'IDLE'); parts.push('CAP ' + v2.capability); parts.push(v2.capabilityLabel)
  if (v2.lifetimeSessions) parts.push(v2.lifetimeSessions + ' sess')
  if (v2.lifetimeTrades.length) parts.push(v2.lifetimeTrades.length + ' tr')
  info.textContent = parts.join(' · ')
  if (v2.lifetimeTrades.length > 0 && v2.lifetimeStats) {
    const ls = v2.lifetimeStats
    sum.innerHTML = '<span class="teacher-bar-pill" style="color:' + _tClr(ls.totalPnl) + '">' + _tUSD(ls.totalPnl) + '</span>' + '<span class="teacher-bar-pill">WR ' + _tPct(ls.winRate) + '</span>' + '<span class="teacher-bar-pill">CAP ' + v2.capability + '</span>'
    sum.style.display = 'flex'
  } else { sum.style.display = 'none' }
}

/* ═══════════════════════════════════════════════════════════════
   initTeacher()
   ═══════════════════════════════════════════════════════════════ */
let _teacherInited = false
export function initTeacher(): void {
  if (_teacherInited) return
  // Ensure TEACHER state exists
  if (typeof w._initTeacherState === 'function' && !getTeacher()) w._initTeacherState()
  if (!getTeacher()) return
  if (typeof w.teacherLoadAllPersistent === 'function') w.teacherLoadAllPersistent()
  if (typeof w.teacherInitV2State === 'function') w.teacherInitV2State()
  if (typeof w.teacherLoadV2State === 'function') w.teacherLoadV2State()
  try { _teacherPanelOpen = localStorage.getItem('zeus_teacher_panel_open') === '1' } catch (_) { /* silent */ }
  const strip = _tEl('teacher-strip'); if (strip && _teacherPanelOpen) strip.classList.add('teacher-open')
  // React TeacherDockPanel renders teacher-panel-body with static HTML — skip innerHTML
  const body = _tEl('teacher-panel-content')
  if (body && !_tEl('teacher-v2-status-text')?.textContent) {
    // DOM exists but empty — build HTML (old app path)
    body.innerHTML = _teacherBuildHTML()
  }
  _teacherWireEvents(); _teacherRefreshDashboard(); _teacherUpdateBarInfo()
  if (typeof w.teacherSetV2TickCallback === 'function') { w.teacherSetV2TickCallback(function () { _teacherRefreshDashboard() }) }
  _teacherV2RefreshTimer = setInterval(function () { _teacherRefreshDashboard(); _teacherUpdateBarInfo() }, 1500)
  _teacherInited = true
}

/* ═══════════════════════════════════════════════════════════════
   HTML BUILDER
   ═══════════════════════════════════════════════════════════════ */
function _teacherBuildHTML(): string {
  return '<div id="teacher-panel-body">'
  + '<div id="teacher-cap-hero" class="teacher-cap-hero"><div id="teacher-cap-score" class="teacher-cap-score">0</div><div id="teacher-cap-label" class="teacher-cap-label">WEAK</div><div id="teacher-cap-subtitle" class="teacher-cap-sub">TEACHER CAPABILITY</div></div>'
  + '<div id="teacher-status-bar" class="teacher-bar"><span id="teacher-v2-status-icon" class="teacher-status-dot">●</span><span id="teacher-v2-status-text" style="font-size:10px;color:#88aacc">IDLE</span><span id="teacher-v2-status-detail" style="font-size:13px;color:#556677;margin-left:auto"></span></div>'
  + '<div class="teacher-quick-stats"><div class="teacher-qs"><span class="teacher-qs-lbl">CAPITAL</span><span id="teacher-v2-capital" class="teacher-qs-val">$10,000</span></div><div class="teacher-qs"><span class="teacher-qs-lbl">SESSIONS</span><span id="teacher-v2-sessions" class="teacher-qs-val">0</span></div><div class="teacher-qs"><span class="teacher-qs-lbl">TRADES</span><span id="teacher-v2-trades" class="teacher-qs-val">0</span></div><div class="teacher-qs"><span class="teacher-qs-lbl">FAILS</span><span id="teacher-v2-fails" class="teacher-qs-val">0</span></div></div>'
  + '<div class="teacher-controls"><button id="teacher-v2-teach-btn" class="teacher-btn teacher-btn-teach" onclick="teacherUITeach()">▶ TEACH</button><button id="teacher-v2-stop-btn" class="teacher-btn teacher-btn-stop" onclick="teacherUIStopV2()" style="display:none">■ STOP</button><button class="teacher-btn teacher-btn-sm" onclick="teacherUIExport()">EXPORT</button><button class="teacher-btn teacher-btn-sm teacher-btn-danger" onclick="teacherUIResetV2()">RESET</button></div>'
  + '<div id="teacher-tabs" class="teacher-tabs"><button class="teacher-tab active" data-tab="replay">REPLAY</button><button class="teacher-tab" data-tab="trades">TRADES</button><button class="teacher-tab" data-tab="stats">STATS</button><button class="teacher-tab" data-tab="memory">MEMORY</button><button class="teacher-tab" data-tab="review">REVIEW</button></div>'
  + '<div id="teacher-tab-replay" class="teacher-tab-content"><div class="teacher-section"><div class="teacher-section-title">CURRENT SESSION</div><div class="teacher-grid-4"><div class="teacher-cell"><span class="teacher-cell-lbl">TF</span><span id="teacher-v2-tf">—</span></div><div class="teacher-cell"><span class="teacher-cell-lbl">PROFILE</span><span id="teacher-v2-profile">—</span></div><div class="teacher-cell"><span class="teacher-cell-lbl">REGIME</span><span id="teacher-v2-regime">—</span></div><div class="teacher-cell"><span class="teacher-cell-lbl">BARS</span><span id="teacher-v2-bars">0</span></div></div></div><div class="teacher-section"><div class="teacher-section-title">LAST DECISION</div><div id="teacher-v2-decision" class="teacher-decision-box">Waiting for session...</div></div><div class="teacher-section"><div class="teacher-section-title">ACTIVITY</div><div id="teacher-v2-activity" class="teacher-activity-feed" style="max-height:150px;overflow-y:auto"></div></div></div>'
  + '<div id="teacher-tab-trades" class="teacher-tab-content" style="display:none"><div id="teacher-v2-trades-empty" class="teacher-empty">No trades yet.</div><div id="teacher-v2-trades-list" style="display:none;max-height:350px;overflow-y:auto"></div></div>'
  + '<div id="teacher-tab-stats" class="teacher-tab-content" style="display:none"><div id="teacher-v2-stats-empty" class="teacher-empty">No statistics available.</div><div id="teacher-v2-stats-body" style="display:none"></div></div>'
  + '<div id="teacher-tab-memory" class="teacher-tab-content" style="display:none"><div id="teacher-v2-memory-empty" class="teacher-empty">Memory is empty.</div><div id="teacher-v2-memory-body" style="display:none"></div></div>'
  + '<div id="teacher-tab-review" class="teacher-tab-content" style="display:none"><div id="teacher-v2-review-body"></div></div>'
  + '</div>'
}

/* ═══════════════════════════════════════════════════════════════
   EVENT WIRING
   ═══════════════════════════════════════════════════════════════ */
function _teacherWireEvents(): void {
  const tabs = document.querySelectorAll('#teacher-tabs .teacher-tab')
  for (let i = 0; i < tabs.length; i++) {
    (function (btn: any) {
      btn.addEventListener('click', function (this: any) { _teacherTab = this.dataset.tab; for (let j = 0; j < tabs.length; j++) tabs[j].classList.remove('active'); this.classList.add('active'); _teacherRenderTabs() })
    })(tabs[i])
  }
}

function _teacherRenderTabs(): void {
  const panels = ['replay', 'trades', 'stats', 'memory', 'review']
  for (let i = 0; i < panels.length; i++) { const el = _tEl('teacher-tab-' + panels[i]); if (el) el.style.display = panels[i] === _teacherTab ? 'block' : 'none' }
  _teacherRefreshActiveTab()
}

/* ═══════════════════════════════════════════════════════════════
   MAIN REFRESH
   ═══════════════════════════════════════════════════════════════ */
function _teacherRefreshDashboard(): void {
  const T = getTeacher(); if (!T || !T.v2) return; const v2 = T.v2
  const scoreEl = _tEl('teacher-cap-score')
  if (scoreEl) { scoreEl.textContent = v2.capability; scoreEl.className = 'teacher-cap-score teacher-cap-' + (v2.capabilityLabel || 'WEAK').toLowerCase() }
  _tText('teacher-cap-label', v2.capabilityLabel || 'WEAK')
  const dotEl = _tEl('teacher-v2-status-icon'); if (dotEl) dotEl.className = 'teacher-status-dot teacher-dot-' + (v2.status || 'IDLE').toLowerCase()
  _tText('teacher-v2-status-text', v2.status || 'IDLE'); _tText('teacher-v2-status-detail', v2.statusDetail || '')
  _tText('teacher-v2-capital', _tUSD(v2.currentCapital)); _tText('teacher-v2-sessions', v2.lifetimeSessions); _tText('teacher-v2-trades', v2.lifetimeTrades.length)
  const failsEl = _tEl('teacher-v2-fails'); if (failsEl) { failsEl.textContent = v2.failCount; failsEl.style.color = v2.failCount > 0 ? 'var(--red)' : 'var(--txt-dim)' }
  const teachBtn = _tEl('teacher-v2-teach-btn'); const stopBtn = _tEl('teacher-v2-stop-btn')
  if (v2.running) { if (teachBtn) teachBtn.style.display = 'none'; if (stopBtn) stopBtn.style.display = 'inline-block' }
  else { if (teachBtn) teachBtn.style.display = 'inline-block'; if (stopBtn) stopBtn.style.display = 'none' }
  _teacherRefreshActiveTab()
}

function _teacherRefreshActiveTab(): void {
  if (_teacherTab === 'replay') _teacherRenderReplay(); if (_teacherTab === 'trades') _teacherRenderTrades()
  if (_teacherTab === 'stats') _teacherRenderStats(); if (_teacherTab === 'memory') _teacherRenderMemory()
  if (_teacherTab === 'review') _teacherRenderReview()
}

/* ═══════════════════════════════════════════════════════════════
   UI ACTIONS
   ═══════════════════════════════════════════════════════════════ */
export function teacherUITeach(): void { if (typeof w.teacherIsRunning === 'function' && w.teacherIsRunning()) return; if (typeof w.teacherStartAutonomous === 'function') w.teacherStartAutonomous() }
export function teacherUIStopV2(): void { if (typeof w.teacherStopAutonomous === 'function') w.teacherStopAutonomous() }
export function teacherUIExport(): void { if (typeof w.teacherExportAll === 'function') w.teacherExportAll() }
export function teacherUIResetV2(): void {
  if (!confirm('Reset ALL Teacher V2 data? Capability score, trades, memory — everything will be cleared.')) return
  if (typeof w.teacherStopAutonomous === 'function') w.teacherStopAutonomous()
  if (typeof w.teacherResetState === 'function') w.teacherResetState()
  if (typeof w.teacherClearAllStorage === 'function') w.teacherClearAllStorage()
  if (typeof w.teacherInitV2State === 'function') w.teacherInitV2State()
  _teacherRefreshDashboard()
}

/* ═══════════════════════════════════════════════════════════════
   TAB: REPLAY
   ═══════════════════════════════════════════════════════════════ */
function _teacherRenderReplay(): void {
  const T = getTeacher(); if (!T || !T.v2) return; const v2 = T.v2
  _tText('teacher-v2-tf', v2.currentTF || '—'); _tText('teacher-v2-profile', v2.currentProfile ? v2.currentProfile.name : '—')
  const regEl = _tEl('teacher-v2-regime')
  if (regEl && v2.currentRegime) { regEl.textContent = v2.currentRegime.regime; regEl.className = 'teacher-regime-' + v2.currentRegime.regime.toLowerCase() } else if (regEl) { regEl.textContent = '—' }
  _tText('teacher-v2-bars', T.cursor || 0)
  const decEl = _tEl('teacher-v2-decision')
  if (decEl && v2.lastDecision) { const d = v2.lastDecision; let dhtml = '<span style="color:' + (d.action === 'NO_TRADE' ? '#778899' : d.action === 'LONG' ? '#00e676' : '#ff5252') + ';font-weight:700">' + d.action + '</span>'; if (d.reasons && d.reasons.length) dhtml += ' <span style="font-size:13px;color:#556677">' + d.reasons.join(', ') + '</span>'; if (d.confidence) dhtml += ' <span style="font-size:13px;color:#88aacc">conf:' + d.confidence + '</span>'; decEl.innerHTML = dhtml }
  const actEl = _tEl('teacher-v2-activity')
  if (actEl && v2.recentActivity && v2.recentActivity.length > 0) {
    let ahtml = ''; const count = Math.min(v2.recentActivity.length, 20)
    for (let i = 0; i < count; i++) { const a = v2.recentActivity[i]; let clr = '#778899'; if (a.type === 'trade') clr = '#88aacc'; if (a.type === 'review') clr = '#ffab40'; if (a.type === 'fail') clr = '#ff5252'; if (a.type === 'learn') clr = '#00e676'; if (a.type === 'warn') clr = '#ff9800'; const ts = new Date(a.ts); const timeStr = String(ts.getHours()).padStart(2, '0') + ':' + String(ts.getMinutes()).padStart(2, '0') + ':' + String(ts.getSeconds()).padStart(2, '0'); ahtml += '<div class="teacher-activity-row" style="color:' + clr + '"><span class="teacher-act-ts">' + timeStr + '</span> ' + a.msg + '</div>' }
    actEl.innerHTML = ahtml
  } else if (actEl) { actEl.innerHTML = '<div class="teacher-activity-row" style="color:#556677">Waiting for session...</div>' }
}

/* ═══════════════════════════════════════════════════════════════
   TAB: TRADES
   ═══════════════════════════════════════════════════════════════ */
function _teacherRenderTrades(): void {
  const T = getTeacher(); if (!T || !T.v2) return; const trades = T.v2.lifetimeTrades || []
  const empty = _tEl('teacher-v2-trades-empty'); const list = _tEl('teacher-v2-trades-list')
  if (!trades.length) { _tShow(empty); _tHide(list); return }; _tHide(empty); _tShow(list)
  let html = '<div class="teacher-trades-header"><span>#</span><span>SIDE</span><span>PnL</span><span>CLASS</span><span>TF</span><span>REGIME</span></div>'
  const start = Math.max(0, trades.length - 50)
  for (let i = trades.length - 1; i >= start; i--) { const t = trades[i]; const pnl = t.pnlNet || t.pnlPct || 0; const clr = _tClr(pnl); const cls = t._classification || '—'; html += '<div class="teacher-trade-row"><span>' + (i + 1) + '</span><span class="teacher-side-' + (t.side || 'long').toLowerCase() + '">' + (t.side || '?') + '</span><span style="color:' + clr + '">' + (typeof t.pnlNet === 'number' ? _tUSD(t.pnlNet) : _tPct(pnl)) + '</span><span class="teacher-class-' + cls.toLowerCase().replace(/_/g, '') + '" style="font-size:12px">' + cls + '</span><span style="font-size:12px">' + (t._tf || '—') + '</span><span style="font-size:12px">' + (t._regime || '—') + '</span></div>' }
  _tHtml('teacher-v2-trades-list', html)
}

/* ═══════════════════════════════════════════════════════════════
   TAB: STATS
   ═══════════════════════════════════════════════════════════════ */
function _statCard(label: any, value: any, color?: any): string {
  return '<div class="teacher-stat-card"><span class="teacher-stat-lbl">' + label + '</span><span class="teacher-stat-val"' + (color ? ' style="color:' + color + '"' : '') + '>' + value + '</span></div>'
}

function _teacherRenderStats(): void {
  const T = getTeacher(); if (!T || !T.v2) return; const v2 = T.v2
  const empty = _tEl('teacher-v2-stats-empty'); const body = _tEl('teacher-v2-stats-body')
  if (!v2.lifetimeTrades.length) { _tShow(empty); _tHide(body); return }; _tHide(empty); _tShow(body)
  const s = v2.lifetimeStats; if (!s) { _tHtml('teacher-v2-stats-body', ''); return }
  let html = '<div class="teacher-stats-grid">'
  html += _statCard('TRADES', s.totalTrades); html += _statCard('WIN RATE', _tPct(s.winRate)); html += _statCard('PnL', _tUSD(s.totalPnl), _tClr(s.totalPnl)); html += _statCard('PROFIT F', _tNum(s.profitFactor, 2)); html += _statCard('EXPECT', _tUSD(s.expectancy), _tClr(s.expectancy)); html += _statCard('W/L', _tNum(s.wlRatio, 2)); html += _statCard('AVG WIN', _tUSD(s.avgWin), '#00e676'); html += _statCard('AVG LOSS', _tUSD(s.avgLoss), '#ff5252'); html += _statCard('BEST', _tUSD(s.bestTrade), '#00e676'); html += _statCard('WORST', _tUSD(s.worstTrade), '#ff5252')
  html += '</div>'
  html += '<div class="teacher-stats-grid" style="margin-top:4px">'; html += _statCard('CAPITAL', _tUSD(v2.currentCapital)); html += _statCard('START', _tUSD(v2.startCapital)); html += _statCard('FAILS', v2.failCount, v2.failCount > 0 ? '#ff5252' : '#778899'); html += _statCard('SESSIONS', v2.lifetimeSessions); html += '</div>'
  if (v2.curriculum && typeof w.teacherComputeCrossValidation === 'function') {
    const cv = w.teacherComputeCrossValidation(v2.curriculum)
    if (cv && cv.sampleIS >= 5) { html += '<div class="teacher-section-title" style="margin-top:6px">CROSS-VALIDATION</div><div class="teacher-stats-grid">'; html += _statCard('IS WR', _tPct(cv.wrIS)); html += _statCard('OOS WR', _tPct(cv.wrOOS)); html += _statCard('IS PF', _tNum(cv.pfIS, 2)); html += _statCard('OOS PF', _tNum(cv.pfOOS, 2)); html += '</div>'; if (cv.overfitDetected) html += '<div style="font-size:13px;color:#ff9800;padding:3px 0">' + _ZI.w + ' OVERFIT DETECTED — IS-OOS gap too large</div>' }
  }
  _tHtml('teacher-v2-stats-body', html)
}

/* ═══════════════════════════════════════════════════════════════
   TAB: MEMORY
   ═══════════════════════════════════════════════════════════════ */
function _teacherRenderMemory(): void {
  const empty = _tEl('teacher-v2-memory-empty'); const body = _tEl('teacher-v2-memory-body')
  if (typeof w.teacherMemorySummary !== 'function') { _tShow(empty); _tHide(body); return }
  const mem = w.teacherMemorySummary()
  if (!mem || (mem.totalPatterns + mem.totalEdges + mem.totalMistakes === 0)) { _tShow(empty); _tHide(body); return }
  _tHide(empty); _tShow(body)
  let html = '<div class="teacher-stats-grid">'; html += _statCard('PATTERNS', mem.totalPatterns); html += _statCard('EDGES', mem.totalEdges); html += _statCard('MISTAKES', mem.totalMistakes); html += '</div>'
  if (mem.topEdge) html += '<div style="font-size:13px;color:#00e676;padding:3px 0">TOP EDGE: ' + mem.topEdge.description + '</div>'
  if (mem.worstMistake) html += '<div style="font-size:13px;color:#ff5252;padding:3px 0">WORST MISTAKE: ' + mem.worstMistake.description + '</div>'
  const _Tp = getTeacher()
  if (_Tp && _Tp.memory && _Tp.memory.patterns && _Tp.memory.patterns.length) {
    html += '<div class="teacher-section-title" style="margin-top:4px">PATTERNS</div>'
    const pats = _Tp.memory.patterns.slice(0, 10)
    for (let i = 0; i < pats.length; i++) { const p = pats[i]; html += '<div class="teacher-memory-row"><span class="teacher-pill">' + (p.name || p.type || '?') + '</span><span style="font-size:13px;color:#88aacc">' + (p.count || 0) + '× · WR ' + _tPct(p.winRate) + '</span></div>' }
  }
  const _Tl = getTeacher()
  if (_Tl && _Tl.lessons && _Tl.lessons.length) {
    html += '<div class="teacher-section-title" style="margin-top:4px">RECENT LESSONS</div>'
    const les = _Tl.lessons.slice(-5).reverse()
    for (let j = 0; j < les.length; j++) html += '<div style="font-size:13px;color:#778899;padding:2px 0;border-bottom:1px solid #1a2530">' + les[j].description + '</div>'
  }
  _tHtml('teacher-v2-memory-body', html)
}

/* ═══════════════════════════════════════════════════════════════
   TAB: REVIEW
   ═══════════════════════════════════════════════════════════════ */
function _teacherRenderReview(): void {
  const T = getTeacher(); if (!T || !T.v2) return; const v2 = T.v2; const reviewEl = _tEl('teacher-v2-review-body'); if (!reviewEl) return
  let html = '<div class="teacher-section-title">CAPABILITY BREAKDOWN</div>'
  if (v2.capabilityBreakdown) { html += '<div class="teacher-cap-breakdown">'; const bd = v2.capabilityBreakdown; for (const key in bd) { const comp = bd[key]; const barWidth = Math.round(comp.fraction * 100); html += '<div class="teacher-cap-row"><span class="teacher-cap-name">' + key + '</span><span class="teacher-cap-bar-wrap"><span class="teacher-cap-bar" style="width:' + barWidth + '%"></span></span><span class="teacher-cap-pts">' + comp.points.toFixed(1) + '/' + comp.weight + '</span></div>' }; html += '</div>' }
  else { html += '<div class="teacher-empty">Train more to see breakdown.</div>' }
  if (v2.capabilityBreakdown && typeof w.teacherComputeCapability === 'function') { const cap = w.teacherComputeCapability(v2); if (cap.penalties && cap.penalties.length > 0) { html += '<div class="teacher-section-title" style="margin-top:6px">PENALTIES</div>'; for (let p = 0; p < cap.penalties.length; p++) { const pen = cap.penalties[p]; html += '<div style="font-size:13px;color:#ff9800;padding:2px 0">−' + pen.value + ' ' + pen.name + ': ' + pen.reason + '</div>' }; html += '<div style="font-size:10px;color:#ff5252;padding:3px 0;font-weight:700">Total penalty: −' + cap.penaltyTotal + '</div>' } }
  if (v2.curriculum && typeof w.teacherGetCoverageMetrics === 'function') { const cov = w.teacherGetCoverageMetrics(v2.curriculum); html += '<div class="teacher-section-title" style="margin-top:6px">COVERAGE</div><div class="teacher-stats-grid">'; html += _statCard('REGIME', cov.regimePct.toFixed(0) + '%'); html += _statCard('TIMEFRAME', cov.tfPct.toFixed(0) + '%'); html += _statCard('PROFILE', cov.profilePct.toFixed(0) + '%'); html += '</div>' }
  if (v2.curriculum) { html += '<div class="teacher-section-title" style="margin-top:6px">CURRICULUM</div><div style="font-size:10px;color:#88aacc">Phase: <span style="color:#ffd700;font-weight:700">' + (v2.curriculum.phase || 'EXPLORE') + '</span></div><div style="font-size:13px;color:#556677">Total sessions recorded: ' + (v2.curriculum.sessionHistory ? v2.curriculum.sessionHistory.length : 0) + '</div>' }
  if (v2.lastReview) { html += '<div class="teacher-section-title" style="margin-top:6px">LAST TRADE REVIEW</div>'; const lr = v2.lastReview; html += '<div style="font-size:13px;color:#88aacc;padding:2px 0">'; if (lr.grade) html += 'Grade: ' + lr.grade + ' (' + lr.score + '/100)'; if (lr.whyEntered) html += '<br>Entry: ' + lr.whyEntered.summary; if (lr.whyExited) html += '<br>Exit: ' + lr.whyExited.summary; if (lr.whyOutcome) html += '<br>Outcome: ' + lr.whyOutcome.summary; html += '</div>' }
  if (v2.lastLesson) { html += '<div class="teacher-section-title" style="margin-top:6px">LAST LESSON</div><div style="font-size:13px;color:#00e676;padding:2px 0">' + (v2.lastLesson.description || JSON.stringify(v2.lastLesson)) + '</div>' }
  reviewEl.innerHTML = html
}

// suppress unused
void _teacherV2RefreshTimer

;(function _teacherPanelGlobals() {
  if (typeof window !== 'undefined') {
    w.teacherToggle = teacherToggle; w.initTeacher = initTeacher
    w.teacherUITeach = teacherUITeach; w.teacherUIStopV2 = teacherUIStopV2
    w.teacherUIExport = teacherUIExport; w.teacherUIResetV2 = teacherUIResetV2
  }
})()
