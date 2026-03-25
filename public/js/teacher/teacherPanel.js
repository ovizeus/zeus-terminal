'use strict';
/* ═══════════════════════════════════════════════════════════════
   THE TEACHER V2 — AUTONOMOUS DASHBOARD PANEL
   ─────────────────────────────────────────────────────────────
   Full rewrite for Teacher V2 autonomous engine.
   CAPABILITY score, 5 tabs, TEACH/STOP buttons, live feed.
   100% sandboxed — no live bot interaction.
   ═══════════════════════════════════════════════════════════════ */

/* ── helpers ──────────────────────────────────────────────────── */
function _tEl(id) { return document.getElementById(id); }
function _tHide(el) { if (el) el.style.display = 'none'; }
function _tShow(el, d) { if (el) el.style.display = d || 'block'; }
function _tText(id, v) { var e = _tEl(id); if (e) e.textContent = v; }
function _tHtml(id, v) { var e = _tEl(id); if (e) e.innerHTML = v; }
function _tPct(v) { return v != null ? (v >= 0 ? '+' : '') + v.toFixed(2) + '%' : '—'; }
function _tUSD(v) { return v != null ? '$' + v.toFixed(2) : '—'; }
function _tNum(v, d) { return v != null ? Number(v).toFixed(d || 0) : '—'; }
function _tClr(v) { return v > 0 ? '#00e676' : v < 0 ? '#ff5252' : '#778899'; }

/* ── state ────────────────────────────────────────────────────── */
var _teacherPanelOpen = false;
var _teacherTab = 'replay';  // replay | trades | stats | memory | review
var _teacherLoading = false;
var _teacherTickRef = null;
var _teacherV2RefreshTimer = null;

/* ═══════════════════════════════════════════════════════════════
   TOGGLE — open / close strip
   ═══════════════════════════════════════════════════════════════ */
function teacherToggle() {
  _teacherPanelOpen = !_teacherPanelOpen;
  var strip = _tEl('teacher-strip');
  if (strip) strip.classList.toggle('teacher-open', _teacherPanelOpen);
  try { localStorage.setItem('zeus_teacher_panel_open', _teacherPanelOpen ? '1' : '0'); } catch (_) {}
  if (!_teacherPanelOpen) _teacherUpdateBarInfo();
}

function _teacherUpdateBarInfo() {
  var info = _tEl('teacher-bar-info');
  var sum = _tEl('teacher-bar-summary');
  if (!info || !sum) return;
  var T = window.TEACHER;
  if (!T || !T.v2) {
    info.textContent = 'IDLE · sandbox';
    sum.style.display = 'none';
    return;
  }
  var v2 = T.v2;
  var parts = [];
  parts.push(v2.running ? 'TRAINING' : 'IDLE');
  parts.push('CAP ' + v2.capability);
  parts.push(v2.capabilityLabel);
  if (v2.lifetimeSessions) parts.push(v2.lifetimeSessions + ' sess');
  if (v2.lifetimeTrades.length) parts.push(v2.lifetimeTrades.length + ' tr');
  info.textContent = parts.join(' · ');
  if (v2.lifetimeTrades.length > 0 && v2.lifetimeStats) {
    var ls = v2.lifetimeStats;
    sum.innerHTML = '<span class="teacher-bar-pill" style="color:' + _tClr(ls.totalPnl) + '">' + _tUSD(ls.totalPnl) + '</span>'
      + '<span class="teacher-bar-pill">WR ' + _tPct(ls.winRate) + '</span>'
      + '<span class="teacher-bar-pill">CAP ' + v2.capability + '</span>';
    sum.style.display = 'flex';
  } else {
    sum.style.display = 'none';
  }
}

/* ═══════════════════════════════════════════════════════════════
   initTeacher() — called from bootstrap.js
   ═══════════════════════════════════════════════════════════════ */
function initTeacher() {
  if (_tEl('teacher-panel-body')) return;
  if (typeof _initTeacherState === 'function' && !window.TEACHER) _initTeacherState();
  if (!window.TEACHER) return;
  if (typeof teacherLoadAllPersistent === 'function') teacherLoadAllPersistent();
  if (typeof teacherInitV2State === 'function') teacherInitV2State();
  if (typeof teacherLoadV2State === 'function') teacherLoadV2State();

  try { _teacherPanelOpen = localStorage.getItem('zeus_teacher_panel_open') === '1'; } catch (_) {}
  var strip = _tEl('teacher-strip');
  if (strip && _teacherPanelOpen) strip.classList.add('teacher-open');

  var body = _tEl('teacher-panel-content');
  if (!body) return;
  body.innerHTML = _teacherBuildHTML();
  _teacherWireEvents();
  _teacherRefreshDashboard();
  _teacherUpdateBarInfo();

  if (typeof teacherSetV2TickCallback === 'function') {
    teacherSetV2TickCallback(function () { _teacherRefreshDashboard(); });
  }
  _teacherV2RefreshTimer = setInterval(function () {
    if (_teacherPanelOpen) _teacherRefreshDashboard();
    _teacherUpdateBarInfo();
  }, 1500);
}

/* ═══════════════════════════════════════════════════════════════
   HTML BUILDER — V2 autonomous dashboard
   ═══════════════════════════════════════════════════════════════ */
function _teacherBuildHTML() {
  return '<div id="teacher-panel-body">'
  // ── CAPABILITY HERO ──
  + '<div id="teacher-cap-hero" class="teacher-cap-hero">'
  +   '<div id="teacher-cap-score" class="teacher-cap-score">0</div>'
  +   '<div id="teacher-cap-label" class="teacher-cap-label">WEAK</div>'
  +   '<div id="teacher-cap-subtitle" class="teacher-cap-sub">TEACHER CAPABILITY</div>'
  + '</div>'

  // ── STATUS BAR ──
  + '<div id="teacher-status-bar" class="teacher-bar">'
  +   '<span id="teacher-v2-status-icon" class="teacher-status-dot">●</span>'
  +   '<span id="teacher-v2-status-text" style="font-size:10px;color:#88aacc">IDLE</span>'
  +   '<span id="teacher-v2-status-detail" style="font-size:13px;color:#556677;margin-left:auto"></span>'
  + '</div>'

  // ── QUICK STATS ROW ──
  + '<div class="teacher-quick-stats">'
  +   '<div class="teacher-qs"><span class="teacher-qs-lbl">CAPITAL</span><span id="teacher-v2-capital" class="teacher-qs-val">$10,000</span></div>'
  +   '<div class="teacher-qs"><span class="teacher-qs-lbl">SESSIONS</span><span id="teacher-v2-sessions" class="teacher-qs-val">0</span></div>'
  +   '<div class="teacher-qs"><span class="teacher-qs-lbl">TRADES</span><span id="teacher-v2-trades" class="teacher-qs-val">0</span></div>'
  +   '<div class="teacher-qs"><span class="teacher-qs-lbl">FAILS</span><span id="teacher-v2-fails" class="teacher-qs-val">0</span></div>'
  + '</div>'

  // ── CONTROL BUTTONS ──
  + '<div class="teacher-controls">'
  +   '<button id="teacher-v2-teach-btn" class="teacher-btn teacher-btn-teach" onclick="teacherUITeach()">▶ TEACH</button>'
  +   '<button id="teacher-v2-stop-btn" class="teacher-btn teacher-btn-stop" onclick="teacherUIStopV2()" style="display:none">■ STOP</button>'
  +   '<button class="teacher-btn teacher-btn-sm" onclick="teacherUIExport()">EXPORT</button>'
  +   '<button class="teacher-btn teacher-btn-sm teacher-btn-danger" onclick="teacherUIResetV2()">RESET</button>'
  + '</div>'

  // ── TABS ──
  + '<div id="teacher-tabs" class="teacher-tabs">'
  +   '<button class="teacher-tab active" data-tab="replay">REPLAY</button>'
  +   '<button class="teacher-tab" data-tab="trades">TRADES</button>'
  +   '<button class="teacher-tab" data-tab="stats">STATS</button>'
  +   '<button class="teacher-tab" data-tab="memory">MEMORY</button>'
  +   '<button class="teacher-tab" data-tab="review">REVIEW</button>'
  + '</div>'

  // ══ TAB: REPLAY — Live autonomous session view ══
  + '<div id="teacher-tab-replay" class="teacher-tab-content">'
  +   '<div class="teacher-section">'
  +     '<div class="teacher-section-title">CURRENT SESSION</div>'
  +     '<div class="teacher-grid-4">'
  +       '<div class="teacher-cell"><span class="teacher-cell-lbl">TF</span><span id="teacher-v2-tf">—</span></div>'
  +       '<div class="teacher-cell"><span class="teacher-cell-lbl">PROFILE</span><span id="teacher-v2-profile">—</span></div>'
  +       '<div class="teacher-cell"><span class="teacher-cell-lbl">REGIME</span><span id="teacher-v2-regime">—</span></div>'
  +       '<div class="teacher-cell"><span class="teacher-cell-lbl">BARS</span><span id="teacher-v2-bars">0</span></div>'
  +     '</div>'
  +   '</div>'

  +   '<div class="teacher-section">'
  +     '<div class="teacher-section-title">LAST DECISION</div>'
  +     '<div id="teacher-v2-decision" class="teacher-decision-box">Waiting for session...</div>'
  +   '</div>'

  +   '<div class="teacher-section">'
  +     '<div class="teacher-section-title">ACTIVITY</div>'
  +     '<div id="teacher-v2-activity" class="teacher-activity-feed" style="max-height:150px;overflow-y:auto"></div>'
  +   '</div>'
  + '</div>'

  // ══ TAB: TRADES — Trade history ══
  + '<div id="teacher-tab-trades" class="teacher-tab-content" style="display:none">'
  +   '<div id="teacher-v2-trades-empty" class="teacher-empty">No trades yet.</div>'
  +   '<div id="teacher-v2-trades-list" style="display:none;max-height:350px;overflow-y:auto"></div>'
  + '</div>'

  // ══ TAB: STATS — Lifetime statistics ══
  + '<div id="teacher-tab-stats" class="teacher-tab-content" style="display:none">'
  +   '<div id="teacher-v2-stats-empty" class="teacher-empty">No statistics available.</div>'
  +   '<div id="teacher-v2-stats-body" style="display:none"></div>'
  + '</div>'

  // ══ TAB: MEMORY — Lessons + patterns ══
  + '<div id="teacher-tab-memory" class="teacher-tab-content" style="display:none">'
  +   '<div id="teacher-v2-memory-empty" class="teacher-empty">Memory is empty.</div>'
  +   '<div id="teacher-v2-memory-body" style="display:none"></div>'
  + '</div>'

  // ══ TAB: REVIEW — Capability breakdown + cross-validation ══
  + '<div id="teacher-tab-review" class="teacher-tab-content" style="display:none">'
  +   '<div id="teacher-v2-review-body"></div>'
  + '</div>'

  + '</div>';
}

/* ═══════════════════════════════════════════════════════════════
   EVENT WIRING
   ═══════════════════════════════════════════════════════════════ */
function _teacherWireEvents() {
  var tabs = document.querySelectorAll('#teacher-tabs .teacher-tab');
  for (var i = 0; i < tabs.length; i++) {
    (function (btn) {
      btn.addEventListener('click', function () {
        _teacherTab = this.dataset.tab;
        for (var j = 0; j < tabs.length; j++) tabs[j].classList.remove('active');
        this.classList.add('active');
        _teacherRenderTabs();
      });
    })(tabs[i]);
  }
}

function _teacherRenderTabs() {
  var panels = ['replay', 'trades', 'stats', 'memory', 'review'];
  for (var i = 0; i < panels.length; i++) {
    var el = _tEl('teacher-tab-' + panels[i]);
    if (el) el.style.display = panels[i] === _teacherTab ? 'block' : 'none';
  }
  _teacherRefreshActiveTab();
}

/* ═══════════════════════════════════════════════════════════════
   MAIN REFRESH — Updates all live elements
   ═══════════════════════════════════════════════════════════════ */
function _teacherRefreshDashboard() {
  var T = window.TEACHER;
  if (!T || !T.v2) return;
  var v2 = T.v2;

  // Capability hero
  var scoreEl = _tEl('teacher-cap-score');
  if (scoreEl) {
    scoreEl.textContent = v2.capability;
    scoreEl.className = 'teacher-cap-score teacher-cap-' + (v2.capabilityLabel || 'WEAK').toLowerCase();
  }
  _tText('teacher-cap-label', v2.capabilityLabel || 'WEAK');

  // Status
  var dotEl = _tEl('teacher-v2-status-icon');
  if (dotEl) {
    dotEl.className = 'teacher-status-dot teacher-dot-' + (v2.status || 'IDLE').toLowerCase();
  }
  _tText('teacher-v2-status-text', v2.status || 'IDLE');
  _tText('teacher-v2-status-detail', v2.statusDetail || '');

  // Quick stats
  _tText('teacher-v2-capital', _tUSD(v2.currentCapital));
  _tText('teacher-v2-sessions', v2.lifetimeSessions);
  _tText('teacher-v2-trades', v2.lifetimeTrades.length);
  var failsEl = _tEl('teacher-v2-fails');
  if (failsEl) {
    failsEl.textContent = v2.failCount;
    failsEl.style.color = v2.failCount > 0 ? '#ff5252' : '#778899';
  }

  // Buttons
  var teachBtn = _tEl('teacher-v2-teach-btn');
  var stopBtn = _tEl('teacher-v2-stop-btn');
  if (v2.running) {
    if (teachBtn) teachBtn.style.display = 'none';
    if (stopBtn) stopBtn.style.display = 'inline-block';
  } else {
    if (teachBtn) teachBtn.style.display = 'inline-block';
    if (stopBtn) stopBtn.style.display = 'none';
  }

  // Active tab content
  _teacherRefreshActiveTab();
}

function _teacherRefreshActiveTab() {
  if (_teacherTab === 'replay') _teacherRenderReplay();
  if (_teacherTab === 'trades') _teacherRenderTrades();
  if (_teacherTab === 'stats') _teacherRenderStats();
  if (_teacherTab === 'memory') _teacherRenderMemory();
  if (_teacherTab === 'review') _teacherRenderReview();
}

/* ═══════════════════════════════════════════════════════════════
   UI ACTIONS — TEACH / STOP / EXPORT / RESET
   ═══════════════════════════════════════════════════════════════ */
function teacherUITeach() {
  if (typeof teacherIsRunning === 'function' && teacherIsRunning()) return;
  if (typeof teacherStartAutonomous === 'function') teacherStartAutonomous();
}

function teacherUIStopV2() {
  if (typeof teacherStopAutonomous === 'function') teacherStopAutonomous();
}

function teacherUIExport() {
  if (typeof teacherExportAll === 'function') teacherExportAll();
}

function teacherUIResetV2() {
  if (!confirm('Reset ALL Teacher V2 data? Capability score, trades, memory — everything will be cleared.')) return;
  if (typeof teacherStopAutonomous === 'function') teacherStopAutonomous();
  if (typeof teacherResetState === 'function') teacherResetState();
  if (typeof teacherClearAllStorage === 'function') teacherClearAllStorage();
  if (typeof teacherInitV2State === 'function') teacherInitV2State();
  _teacherRefreshDashboard();
}

/* ═══════════════════════════════════════════════════════════════
   TAB: REPLAY — Current autonomous session
   ═══════════════════════════════════════════════════════════════ */
function _teacherRenderReplay() {
  var T = window.TEACHER;
  if (!T || !T.v2) return;
  var v2 = T.v2;

  // Current session info
  _tText('teacher-v2-tf', v2.currentTF || '—');
  _tText('teacher-v2-profile', v2.currentProfile ? v2.currentProfile.name : '—');
  var regEl = _tEl('teacher-v2-regime');
  if (regEl && v2.currentRegime) {
    regEl.textContent = v2.currentRegime.regime;
    regEl.className = 'teacher-regime-' + v2.currentRegime.regime.toLowerCase();
  } else if (regEl) {
    regEl.textContent = '—';
  }
  _tText('teacher-v2-bars', T.cursor || 0);

  // Last decision
  var decEl = _tEl('teacher-v2-decision');
  if (decEl && v2.lastDecision) {
    var d = v2.lastDecision;
    var dhtml = '<span style="color:' + (d.action === 'NO_TRADE' ? '#778899' : d.action === 'LONG' ? '#00e676' : '#ff5252') + ';font-weight:700">' + d.action + '</span>';
    if (d.reasons && d.reasons.length) dhtml += ' <span style="font-size:13px;color:#556677">' + d.reasons.join(', ') + '</span>';
    if (d.confidence) dhtml += ' <span style="font-size:13px;color:#88aacc">conf:' + d.confidence + '</span>';
    decEl.innerHTML = dhtml;
  }

  // Activity feed
  var actEl = _tEl('teacher-v2-activity');
  if (actEl && v2.recentActivity && v2.recentActivity.length > 0) {
    var ahtml = '';
    var count = Math.min(v2.recentActivity.length, 20);
    for (var i = 0; i < count; i++) {
      var a = v2.recentActivity[i];
      var clr = '#778899';
      if (a.type === 'trade') clr = '#88aacc';
      if (a.type === 'review') clr = '#ffab40';
      if (a.type === 'fail') clr = '#ff5252';
      if (a.type === 'learn') clr = '#00e676';
      if (a.type === 'warn') clr = '#ff9800';
      var ts = new Date(a.ts);
      var timeStr = String(ts.getHours()).padStart(2, '0') + ':' + String(ts.getMinutes()).padStart(2, '0') + ':' + String(ts.getSeconds()).padStart(2, '0');
      ahtml += '<div class="teacher-activity-row" style="color:' + clr + '"><span class="teacher-act-ts">' + timeStr + '</span> ' + a.msg + '</div>';
    }
    actEl.innerHTML = ahtml;
  } else if (actEl) {
    actEl.innerHTML = '<div class="teacher-activity-row" style="color:#556677">Waiting for session...</div>';
  }
}

/* ═══════════════════════════════════════════════════════════════
   TAB: TRADES — Lifetime trade history
   ═══════════════════════════════════════════════════════════════ */
function _teacherRenderTrades() {
  var T = window.TEACHER;
  if (!T || !T.v2) return;
  var trades = T.v2.lifetimeTrades || [];
  var empty = _tEl('teacher-v2-trades-empty');
  var list = _tEl('teacher-v2-trades-list');
  if (!trades.length) { _tShow(empty); _tHide(list); return; }
  _tHide(empty); _tShow(list);

  var html = '<div class="teacher-trades-header"><span>#</span><span>SIDE</span><span>PnL</span><span>CLASS</span><span>TF</span><span>REGIME</span></div>';
  var start = Math.max(0, trades.length - 50);
  for (var i = trades.length - 1; i >= start; i--) {
    var t = trades[i];
    var pnl = t.pnlNet || t.pnlPct || 0;
    var clr = _tClr(pnl);
    var cls = t._classification || '—';
    html += '<div class="teacher-trade-row">';
    html += '<span>' + (i + 1) + '</span>';
    html += '<span class="teacher-side-' + (t.side || 'long').toLowerCase() + '">' + (t.side || '?') + '</span>';
    html += '<span style="color:' + clr + '">' + (typeof t.pnlNet === 'number' ? _tUSD(t.pnlNet) : _tPct(pnl)) + '</span>';
    html += '<span class="teacher-class-' + cls.toLowerCase().replace(/_/g, '') + '" style="font-size:12px">' + cls + '</span>';
    html += '<span style="font-size:12px">' + (t._tf || '—') + '</span>';
    html += '<span style="font-size:12px">' + (t._regime || '—') + '</span>';
    html += '</div>';
  }
  _tHtml('teacher-v2-trades-list', html);
}

/* ═══════════════════════════════════════════════════════════════
   TAB: STATS — Lifetime aggregated statistics
   ═══════════════════════════════════════════════════════════════ */
function _teacherRenderStats() {
  var T = window.TEACHER;
  if (!T || !T.v2) return;
  var v2 = T.v2;
  var empty = _tEl('teacher-v2-stats-empty');
  var body = _tEl('teacher-v2-stats-body');
  if (!v2.lifetimeTrades.length) { _tShow(empty); _tHide(body); return; }
  _tHide(empty); _tShow(body);

  var s = v2.lifetimeStats;
  if (!s) { _tHtml('teacher-v2-stats-body', ''); return; }

  var html = '<div class="teacher-stats-grid">';
  html += _statCard('TRADES', s.totalTrades);
  html += _statCard('WIN RATE', _tPct(s.winRate));
  html += _statCard('PnL', _tUSD(s.totalPnl), _tClr(s.totalPnl));
  html += _statCard('PROFIT F', _tNum(s.profitFactor, 2));
  html += _statCard('EXPECT', _tUSD(s.expectancy), _tClr(s.expectancy));
  html += _statCard('W/L', _tNum(s.wlRatio, 2));
  html += _statCard('AVG WIN', _tUSD(s.avgWin), '#00e676');
  html += _statCard('AVG LOSS', _tUSD(s.avgLoss), '#ff5252');
  html += _statCard('BEST', _tUSD(s.bestTrade), '#00e676');
  html += _statCard('WORST', _tUSD(s.worstTrade), '#ff5252');
  html += '</div>';

  // Capital row
  html += '<div class="teacher-stats-grid" style="margin-top:4px">';
  html += _statCard('CAPITAL', _tUSD(v2.currentCapital));
  html += _statCard('START', _tUSD(v2.startCapital));
  html += _statCard('FAILS', v2.failCount, v2.failCount > 0 ? '#ff5252' : '#778899');
  html += _statCard('SESSIONS', v2.lifetimeSessions);
  html += '</div>';

  // Cross-validation
  if (v2.curriculum && typeof teacherComputeCrossValidation === 'function') {
    var cv = teacherComputeCrossValidation(v2.curriculum);
    if (cv && cv.sampleIS >= 5) {
      html += '<div class="teacher-section-title" style="margin-top:6px">CROSS-VALIDATION</div>';
      html += '<div class="teacher-stats-grid">';
      html += _statCard('IS WR', _tPct(cv.wrIS));
      html += _statCard('OOS WR', _tPct(cv.wrOOS));
      html += _statCard('IS PF', _tNum(cv.pfIS, 2));
      html += _statCard('OOS PF', _tNum(cv.pfOOS, 2));
      html += '</div>';
      if (cv.overfitDetected) {
        html += '<div style="font-size:13px;color:#ff9800;padding:3px 0">' + _ZI.w + ' OVERFIT DETECTED — IS-OOS gap too large</div>';
      }
    }
  }

  _tHtml('teacher-v2-stats-body', html);
}

function _statCard(label, value, color) {
  return '<div class="teacher-stat-card"><span class="teacher-stat-lbl">' + label + '</span><span class="teacher-stat-val"' + (color ? ' style="color:' + color + '"' : '') + '>' + value + '</span></div>';
}

/* ═══════════════════════════════════════════════════════════════
   TAB: MEMORY — Patterns, edges, mistakes, lessons
   ═══════════════════════════════════════════════════════════════ */
function _teacherRenderMemory() {
  var empty = _tEl('teacher-v2-memory-empty');
  var body = _tEl('teacher-v2-memory-body');
  if (typeof teacherMemorySummary !== 'function') { _tShow(empty); _tHide(body); return; }

  var mem = teacherMemorySummary();
  if (!mem || (mem.totalPatterns + mem.totalEdges + mem.totalMistakes === 0)) {
    _tShow(empty); _tHide(body); return;
  }
  _tHide(empty); _tShow(body);

  var html = '<div class="teacher-stats-grid">';
  html += _statCard('PATTERNS', mem.totalPatterns);
  html += _statCard('EDGES', mem.totalEdges);
  html += _statCard('MISTAKES', mem.totalMistakes);
  html += '</div>';

  if (mem.topEdge) {
    html += '<div style="font-size:13px;color:#00e676;padding:3px 0">TOP EDGE: ' + mem.topEdge.description + '</div>';
  }
  if (mem.worstMistake) {
    html += '<div style="font-size:13px;color:#ff5252;padding:3px 0">WORST MISTAKE: ' + mem.worstMistake.description + '</div>';
  }

  // Patterns
  if (window.TEACHER && TEACHER.memory && TEACHER.memory.patterns && TEACHER.memory.patterns.length) {
    html += '<div class="teacher-section-title" style="margin-top:4px">PATTERNS</div>';
    var pats = TEACHER.memory.patterns.slice(0, 10);
    for (var i = 0; i < pats.length; i++) {
      var p = pats[i];
      html += '<div class="teacher-memory-row">';
      html += '<span class="teacher-pill">' + (p.name || p.type || '?') + '</span>';
      html += '<span style="font-size:13px;color:#88aacc">' + (p.count || 0) + '× · WR ' + _tPct(p.winRate) + '</span>';
      html += '</div>';
    }
  }

  // Lessons
  if (window.TEACHER && TEACHER.lessons && TEACHER.lessons.length) {
    html += '<div class="teacher-section-title" style="margin-top:4px">RECENT LESSONS</div>';
    var les = TEACHER.lessons.slice(-5).reverse();
    for (var j = 0; j < les.length; j++) {
      html += '<div style="font-size:13px;color:#778899;padding:2px 0;border-bottom:1px solid #1a2530">' + les[j].description + '</div>';
    }
  }

  _tHtml('teacher-v2-memory-body', html);
}

/* ═══════════════════════════════════════════════════════════════
   TAB: REVIEW — Capability breakdown + curriculum coverage
   ═══════════════════════════════════════════════════════════════ */
function _teacherRenderReview() {
  var T = window.TEACHER;
  if (!T || !T.v2) return;
  var v2 = T.v2;
  var reviewEl = _tEl('teacher-v2-review-body');
  if (!reviewEl) return;

  var html = '';

  // Capability breakdown
  html += '<div class="teacher-section-title">CAPABILITY BREAKDOWN</div>';
  if (v2.capabilityBreakdown) {
    html += '<div class="teacher-cap-breakdown">';
    var bd = v2.capabilityBreakdown;
    for (var key in bd) {
      var comp = bd[key];
      var barWidth = Math.round(comp.fraction * 100);
      html += '<div class="teacher-cap-row">';
      html += '<span class="teacher-cap-name">' + key + '</span>';
      html += '<span class="teacher-cap-bar-wrap"><span class="teacher-cap-bar" style="width:' + barWidth + '%"></span></span>';
      html += '<span class="teacher-cap-pts">' + comp.points.toFixed(1) + '/' + comp.weight + '</span>';
      html += '</div>';
    }
    html += '</div>';
  } else {
    html += '<div class="teacher-empty">Train more to see breakdown.</div>';
  }

  // Penalties
  if (v2.capabilityBreakdown && typeof teacherComputeCapability === 'function') {
    var cap = teacherComputeCapability(v2);
    if (cap.penalties && cap.penalties.length > 0) {
      html += '<div class="teacher-section-title" style="margin-top:6px">PENALTIES</div>';
      for (var p = 0; p < cap.penalties.length; p++) {
        var pen = cap.penalties[p];
        html += '<div style="font-size:13px;color:#ff9800;padding:2px 0">−' + pen.value + ' ' + pen.name + ': ' + pen.reason + '</div>';
      }
      html += '<div style="font-size:10px;color:#ff5252;padding:3px 0;font-weight:700">Total penalty: −' + cap.penaltyTotal + '</div>';
    }
  }

  // Coverage metrics
  if (v2.curriculum && typeof teacherGetCoverageMetrics === 'function') {
    var cov = teacherGetCoverageMetrics(v2.curriculum);
    html += '<div class="teacher-section-title" style="margin-top:6px">COVERAGE</div>';
    html += '<div class="teacher-stats-grid">';
    html += _statCard('REGIME', cov.regimeCoverage.toFixed(0) + '%');
    html += _statCard('TIMEFRAME', cov.tfCoverage.toFixed(0) + '%');
    html += _statCard('PROFILE', cov.profileCoverage.toFixed(0) + '%');
    html += '</div>';
  }

  // Curriculum phase
  if (v2.curriculum) {
    html += '<div class="teacher-section-title" style="margin-top:6px">CURRICULUM</div>';
    html += '<div style="font-size:10px;color:#88aacc">Phase: <span style="color:#ffd700;font-weight:700">' + (v2.curriculum.phase || 'EXPLORE') + '</span></div>';
    html += '<div style="font-size:13px;color:#556677">Total sessions recorded: ' + (v2.curriculum.sessionHistory ? v2.curriculum.sessionHistory.length : 0) + '</div>';
  }

  // Last review
  if (v2.lastReview) {
    html += '<div class="teacher-section-title" style="margin-top:6px">LAST TRADE REVIEW</div>';
    var lr = v2.lastReview;
    html += '<div style="font-size:13px;color:#88aacc;padding:2px 0">';
    if (lr.grade) html += 'Grade: ' + lr.grade + ' (' + lr.score + '/100)';
    if (lr.whyEntered) html += '<br>Entry: ' + lr.whyEntered.summary;
    if (lr.whyExited) html += '<br>Exit: ' + lr.whyExited.summary;
    if (lr.whyOutcome) html += '<br>Outcome: ' + lr.whyOutcome.summary;
    html += '</div>';
  }

  // Last lesson
  if (v2.lastLesson) {
    html += '<div class="teacher-section-title" style="margin-top:6px">LAST LESSON</div>';
    html += '<div style="font-size:13px;color:#00e676;padding:2px 0">' + (v2.lastLesson.description || JSON.stringify(v2.lastLesson)) + '</div>';
  }

  reviewEl.innerHTML = html;
}
