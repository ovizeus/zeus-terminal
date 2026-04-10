// Zeus v122 — core/config.js
// Configuration constants, indicator definitions, profile timeframes
'use strict';

// ── MOVED-TO-TOP state objects (originally L2055-L2117) ──────────
const AUB = {
  expanded: false,
  sfxEnabled: false,
  audioCtx: null,
  guardCount: 0,
  guardLast: '\u2014',
  domSkips: 0,
  rafFPS: 0,
  _rafLast: 0,
  _rafFrames: 0,
  _perfHeavy: false,
  bb: [],
  macroEvents: [],
  simResult: null,
  simRunning: false,
  simPendingApply: null,
  corr: { eth: null, sol: null },
  mtfStrength: { '5m': 0, '15m': 0, '1h': 0, '4h': 0 },
};
const AUB_COMPAT = {
  ws: false, audio: false, sw: false, crypto: false,
  swDisabled: false,
};
const AUB_PERF = {
  _domCache: {},
  setDOM(id, val) {
    const el_p = document.getElementById(id);
    if (!el_p) return false;
    if (el_p.textContent === String(val)) { AUB.domSkips++; return false; }
    el_p.textContent = val;
    return true;
  },
  setHTML(id, val) {
    const el_p = document.getElementById(id);
    if (!el_p) return false;
    if (el_p.innerHTML === val) { AUB.domSkips++; return false; }
    el_p.innerHTML = val;
    return true;
  }
};
const AUB_SIM_KEY = 'aub_sim_last';
const ARIA_STATE = {
  expanded: false,
  pattern: null,
  _barKey: '',
  _rafPending: false,
  _updateTs: 0,
  _patternAge: 0,
};
const NOVA_STATE = {
  expanded: false,
  log: [],
  lastMsg: null,
  _verdictTs: 0,
  _cooldowns: { danger: 30000, warn: 15000, info: 8000, ok: 8000 },
  _lastBySeverity: {},
};
const _AN_KEY_A = 'aria_v1';
const _AN_KEY_N = 'nova_v1';
let _dslStripOpen = false;
let _atStripOpen = false;
let _ptStripOpen = false;

// Indicators array
const INDICATORS = [
  { id: 'ema', ico: _ZI.tup, name: 'EMA 50/200', desc: 'Exponential Moving Average', cat: 'trend', def: true },
  { id: 'wma', ico: _ZI.wave, name: 'WMA 20/50', desc: 'Weighted Moving Average', cat: 'trend', def: true },
  { id: 'st', ico: _ZI.dia, name: 'Supertrend', desc: 'Trend + Stop Loss dinamic', cat: 'trend', def: true },
  { id: 'vp', ico: _ZI.chart, name: 'Volume Profile', desc: 'Volum pe niveluri de pret', cat: 'volume', def: true },
  { id: 'cvd', ico: _ZI.chart, name: 'CVD', desc: 'Cumulative Volume Delta', cat: 'volume', def: false },
  { id: 'macd', ico: _ZI.bolt, name: 'MACD', desc: 'Moving Avg Convergence Div', cat: 'momentum', def: false },
  { id: 'bb', ico: _ZI.tgt, name: 'Bollinger Bands', desc: 'Volatilitate si trend', cat: 'vol', def: false },
  { id: 'stoch', ico: _ZI.wave, name: 'Stochastic RSI', desc: 'RSI imbunatatit cu Stoch', cat: 'momentum', def: false },
  { id: 'obv', ico: _ZI.chart, name: 'OBV', desc: 'On-Balance Volume', cat: 'volume', def: false },
  { id: 'atr', ico: _ZI.ruler, name: 'ATR', desc: 'Average True Range - volat', cat: 'vol', def: false },
  { id: 'vwap', ico: _ZI.chart, name: 'VWAP', desc: 'Volume Weighted Avg Price', cat: 'trend', def: false },
  { id: 'ichimoku', ico: _ZI.cloud, name: 'Ichimoku Cloud', desc: 'Sistem complet japonez', cat: 'trend', def: false },
  { id: 'fib', ico: _ZI.hex, name: 'Fibonacci', desc: 'Retracement auto pe swing', cat: 'support', def: false },
  { id: 'pivot', ico: _ZI.tgt, name: 'Pivot Points', desc: 'Suport/Rezistenta zilnice', cat: 'support', def: false },
  { id: 'rsi14', ico: _ZI.bolt, name: 'RSI 14', desc: 'Relative Strength Index', cat: 'momentum', def: false },
  { id: 'mfi', ico: _ZI.money, name: 'Money Flow Index', desc: 'RSI bazat pe volum', cat: 'volume', def: false },
  { id: 'cci', ico: _ZI.ruler, name: 'CCI', desc: 'Commodity Channel Index', cat: 'momentum', def: false },
];
let _macdChart = null, _macdLineSeries = null, _macdSigSeries = null, _macdHistSeries = null;
let _macdInited = false;
let _audioCtx = null;
let _audioReady = false;

// Watchlist symbols — declared in state.js (loads first)
// WL_SYMS, wlPrices, allPrices removed here to avoid duplicate const

// Signal Registry (L404-L627)
const SIGNAL_REGISTRY = {
  signals: [],   // { id, ts, source, type, direction, score, tf, entryPrice, tradeId, outcome, pnl, closedAt }
  stats: { total: 0, wins: 0, losses: 0, winRate: 0, expectancy: 0 },
  _lastConfluenceKey: null,   // debounce: nu înregistrăm acelaşi scor de 2 ori
  _lastScanKey: null,         // debounce semnale individuale
};

// ── Înregistrare semnal nou ──────────────────────────────────────
function srRecord(source, type, direction, score, extra) {
  // Debounce: acelaşi tip+direcţie+sursă → max 1 înregistrare la 30s
  const key = source + '|' + type + '|' + direction;
  const now = Date.now();
  const recent = SIGNAL_REGISTRY.signals.find(s =>
    s._key === key && (now - s.ts) < 30000
  );
  if (recent) return recent;   // duplicate — returnăm cel existent

  const id = now + '-' + Math.random().toString(36).substr(2, 4);
  const entry = {
    id,
    _key: key,
    ts: now,
    source,                    // 'confluence' | 'scan'
    type,                      // ex: 'STRONG BULL', 'MACD Crossover' etc.
    direction,                 // 'LONG' | 'SHORT' | 'NEUTRAL'
    score,                     // 0-100 (confluence) sau strength string (scan)
    tf: S.chartTf || '5m',
    entryPrice: S.price || 0,
    tradeId: null,          // completat de srLinkTrade()
    outcome: null,          // 'win' | 'loss' | null
    pnl: null,
    closedAt: null,
  };

  SIGNAL_REGISTRY.signals.unshift(entry);
  if (SIGNAL_REGISTRY.signals.length > 500) SIGNAL_REGISTRY.signals.pop();

  _srSave();
  _srRenderList();            // actualizăm lista dacă panoul e deschis
  srStripUpdateBar();         // actualizăm banner-ul
  return entry;
}

// ── Leagă un trade deschis de cel mai recent semnal neasociat ───
function srLinkTrade(pos) {
  const dir = pos.side === 'LONG' ? 'LONG' : 'SHORT';
  // Căutăm cel mai recent semnal neocupat, cu aceeaşi direcţie, din ultimele 2 min
  const sig = SIGNAL_REGISTRY.signals.find(s =>
    !s.tradeId && s.direction === dir && (Date.now() - s.ts) < 120000
  );
  if (sig && !sig.tradeId) {
    sig.tradeId = pos.id;
    pos.signalId = sig.id;     // stocăm pe poziţie referinţa înapoi
    _srSave();
  }
}

// ── Actualizează outcome la închiderea unui trade ────────────────
function srUpdateOutcome(pos, pnl) {
  if (!pos.signalId) return;
  const sig = SIGNAL_REGISTRY.signals.find(s => s.id === pos.signalId);
  if (!sig) return;
  sig.outcome = pnl >= 0 ? 'win' : 'loss';
  sig.pnl = pnl;
  sig.closedAt = Date.now();
  _srUpdateStats();
  _srSave();
  _srRenderList();
}

// ── Recalculează statisticile ────────────────────────────────────
function _srUpdateStats() {
  const closed = SIGNAL_REGISTRY.signals.filter(s => s.outcome);
  const wins = closed.filter(s => s.outcome === 'win').length;
  const losses = closed.length - wins;
  const totalPnl = closed.reduce((acc, s) => acc + (s.pnl || 0), 0);
  SIGNAL_REGISTRY.stats = {
    total: closed.length,
    wins,
    losses,
    winRate: closed.length ? +(wins / closed.length * 100).toFixed(1) : 0,
    expectancy: closed.length ? +(totalPnl / closed.length).toFixed(2) : 0,
  };
  _srRenderStats();
}

// ── Render statistici (header tabel) ────────────────────────────
function _srRenderStats() {
  const el_s = document.getElementById('sr-stats');
  if (!el_s) return;
  const st = SIGNAL_REGISTRY.stats;
  const wr = st.total ? st.winRate : '—';
  const exp = st.total ? (st.expectancy >= 0 ? '+' : '') + st.expectancy : '—';
  el_s.innerHTML =
    `<span class="sr-stat">${_ZI.chart} ${st.total} semnale</span>` +
    `<span class="sr-stat ${st.wins >= st.losses ? 'sr-win' : 'sr-loss'}">${_ZI.ok} ${st.wins}W / ${_ZI.x} ${st.losses}L</span>` +
    `<span class="sr-stat">WR: <b>${wr}%</b></span>` +
    `<span class="sr-stat">Exp: <b>${exp}$</b></span>`;
  srStripUpdateBar();
}

// ── Render lista semnale ─────────────────────────────────────────
function _srRenderList() {
  const el_l = document.getElementById('sr-list');
  if (!el_l) return;
  const items = SIGNAL_REGISTRY.signals.slice(0, 30);
  if (!items.length) {
    el_l.innerHTML = '<div class="sr-empty">Niciun semnal înregistrat încă</div>';
    return;
  }
  el_l.innerHTML = items.map(s => {
    const t = new Date(s.ts).toLocaleTimeString('ro-RO', {
      timeZone: S.tz || 'Europe/Bucharest',
      hour: '2-digit', minute: '2-digit'
    });
    const _type = typeof escHtml === 'function' ? escHtml(s.type || '') : (s.type || '');
    const _typeShort = _type.length > 18 ? _type.slice(0, 16) + '…' : _type;
    const dirCls = s.direction === 'LONG' ? 'sr-long' : s.direction === 'SHORT' ? 'sr-short' : 'sr-neut';
    const outCls = s.outcome === 'win' ? 'sr-win' : s.outcome === 'loss' ? 'sr-loss' : 'sr-pend';
    const outTxt = s.outcome === 'win' ? `${_ZI.ok} +$${s.pnl?.toFixed(2)}` :
      s.outcome === 'loss' ? `${_ZI.x} $${s.pnl?.toFixed(2)}` : `${_ZI.ld} —`;
    const srcIco = s.source === 'confluence' ? _ZI.brain : _ZI.eye;
    return `<div class="sr-row">
      <span class="sr-time">${t}</span>
      <span class="sr-src">${srcIco}</span>
      <span class="sr-type" title="${_type}">${_typeShort}</span>
      <span class="sr-dir ${dirCls}">${s.direction}</span>
      <span class="sr-score">${typeof s.score === 'number' ? s.score : s.score}</span>
      <span class="sr-outcome ${outCls}">${outTxt}</span>
    </div>`;
  }).join('');
}

// ── Persistenţă ─────────────────────────────────────────────────
function _srSave() {
  // [v105 FIX Bug8] _safeLocalStorageSet — protejeaza la depasirea quotei (anterior direct setItem)
  _safeLocalStorageSet('zeus_signal_registry', {
    signals: SIGNAL_REGISTRY.signals.slice(0, 100),
    stats: SIGNAL_REGISTRY.stats,
  });
  _ucMarkDirty('signalRegistry');
  if (typeof _userCtxPush === 'function') _userCtxPush();
}
function _srLoad() {
  try {
    const raw = localStorage.getItem('zeus_signal_registry');
    if (!raw) return;
    const data = JSON.parse(raw);
    SIGNAL_REGISTRY.signals = data.signals || [];
    SIGNAL_REGISTRY.stats = data.stats || SIGNAL_REGISTRY.stats;
  } catch (_) { }
}

// ── Fallback: garantează că #sr-strip ajunge în zeus-groups după AUB ────────
function _srEnsureVisible() {
  try {
    const srSec = document.getElementById('sr-strip') || document.getElementById('sr-sec');
    if (!srSec) return;

    const mi = document.getElementById('zeus-groups');
    if (!mi) return;

    // Asigurăm că nu e ascuns de clase reziduale
    srSec.classList.remove('zg-pending-move');
    srSec.style.removeProperty('visibility');
    srSec.style.removeProperty('display');
    srSec.style.removeProperty('max-height');
    srSec.style.removeProperty('overflow');

    // Verificăm dacă e deja în zeus-groups
    const alreadyIn = srSec.closest('#zeus-groups') !== null;

    if (!alreadyIn) {
      const aub = mi.querySelector('#aub');
      if (aub && aub.nextSibling) {
        mi.insertBefore(srSec, aub.nextSibling);
      } else if (aub) {
        mi.appendChild(srSec);
      } else {
        mi.insertBefore(srSec, mi.firstChild);
      }
      console.log('[SR] Fallback: sr-sec forțat în zeus-groups');
    } else {
      const aub = mi.querySelector('#aub');
      if (aub) {
        const nodes = Array.from(mi.children);
        const aubIdx = nodes.indexOf(aub);
        const srIdx = nodes.indexOf(srSec);
        if (srIdx !== aubIdx + 1) {
          if (aub.nextSibling) {
            mi.insertBefore(srSec, aub.nextSibling);
          } else {
            mi.appendChild(srSec);
          }
          console.log('[SR] Fallback: sr-sec repoziționat după AUB');
        }
      }
    }

    // Randăm conținutul (poate că n-a rulat încă)
    _srUpdateStats();
    _srRenderList();
  } catch (e) {
    console.warn('[SR] Fallback _srEnsureVisible error:', e.message);
  }
}

// ╔══════════════════════════════════════════════════════════════╗
// ║  NOTIFICATION CENTER — colecție centralizată de notificări  ║
// ║  Paralel cu toast() și atLog() — nu le înlocuiește          ║
// ╚══════════════════════════════════════════════════════════════╝

// Notification Center (L628-L1463)
const NOTIFICATION_CENTER = {
  items: [],
  maxItems: 100,
  _filter: 'all',   // 'all' | 'critical' | 'warning' | 'info'
};

// ── Adaugă o notificare nouă ─────────────────────────────────────
function ncAdd(severity, type, message) {
  // Deduplicare: același mesaj+tip → max 1 la 30s
  const now = Date.now();
  const dup = NOTIFICATION_CENTER.items.find(i =>
    i.message === message && i.type === type && (now - i.ts) < 30000
  );
  if (dup) return;

  const item = {
    id: now + '-' + Math.random().toString(36).substr(2, 4),
    ts: now,
    severity,   // 'info' | 'warning' | 'critical'
    type,       // 'trade' | 'alert' | 'system' | 'signal'
    message,
    read: false,
  };

  NOTIFICATION_CENTER.items.unshift(item);
  if (NOTIFICATION_CENTER.items.length > NOTIFICATION_CENTER.maxItems) {
    NOTIFICATION_CENTER.items.pop();
  }

  _ncSave();
  _ncUpdateBadge();

  // Redăm lista doar dacă panoul e deschis
  const panel = document.getElementById('mnotifications');
  if (panel && panel.classList.contains('open')) _ncRenderList();
}

// ── Render lista filtrată ─────────────────────────────────────────
function _ncRenderList() {
  const list = document.getElementById('nc-list');
  if (!list) return;

  const f = NOTIFICATION_CENTER._filter;
  const items = NOTIFICATION_CENTER.items.filter(i =>
    f === 'all' || i.severity === f
  );

  if (!items.length) {
    list.innerHTML = '<div class="nc-empty">Nicio notificare' +
      (f !== 'all' ? ' pentru filtrul selectat' : '') + '</div>';
    return;
  }

  list.innerHTML = items.map(i => {
    const t = new Date(i.ts).toLocaleTimeString('ro-RO', {
      timeZone: (typeof S !== 'undefined' && S.tz) || 'Europe/Bucharest',
      hour: '2-digit', minute: '2-digit', second: '2-digit'
    });
    const ico = i.severity === 'critical' ? _ZI.dRed :
      i.severity === 'warning' ? _ZI.dYlw : '<span class="z-dot" style="background:#4488ff;box-shadow:0 0 4px #4488ff66"></span>';
    // [FIX R12] Sanitize notification fields to prevent stored XSS
    const _esc = typeof escHtml === 'function' ? escHtml : function (s) { return s; };
    return `<div class="nc-item ${_esc(i.severity)} ${i.read ? 'nc-read' : ''}" data-id="${_esc(i.id)}">
      <div class="nc-item-hdr">
        <span class="nc-ico">${ico}</span>
        <span class="nc-type">${_esc(i.type)}</span>
        <span class="nc-time">${t}</span>
        <button class="nc-mark" onclick="ncMarkRead('${_esc(i.id)}')">✓</button>
      </div>
      <div class="nc-msg">${_esc(i.message)}</div>
    </div>`;
  }).join('');
}

// ── Actualizare badge ─────────────────────────────────────────
function _ncUpdateBadge() {
  const badge = document.getElementById('nc-badge');
  if (!badge) return;
  const unread = NOTIFICATION_CENTER.items.filter(i => !i.read).length;
  badge.textContent = unread > 9 ? '9+' : String(unread);
  badge.style.display = unread > 0 ? 'inline-block' : 'none';
}

// ── Filtrare ─────────────────────────────────────────────────────
function ncFilter(sev, tabEl) {
  NOTIFICATION_CENTER._filter = sev;
  document.querySelectorAll('#mnotifications .nc-tab').forEach(t =>
    t.classList.remove('act')
  );
  if (tabEl) tabEl.classList.add('act');
  _ncRenderList();
}

// ── Mark single read ─────────────────────────────────────────────
function ncMarkRead(id) {
  const item = NOTIFICATION_CENTER.items.find(i => i.id === id);
  if (item) { item.read = true; _ncSave(); _ncRenderList(); _ncUpdateBadge(); }
}

// ── Mark all read ────────────────────────────────────────────────
function ncMarkAllRead() {
  NOTIFICATION_CENTER.items.forEach(i => { i.read = true; });
  _ncSave(); _ncRenderList(); _ncUpdateBadge();
}

// ── Clear all ────────────────────────────────────────────────────
function ncClear() {
  NOTIFICATION_CENTER.items = [];
  _ncSave(); _ncRenderList(); _ncUpdateBadge();
}

// ── Persistență ──────────────────────────────────────────────────
function _ncSave() {
  // [v105 FIX Bug8] _safeLocalStorageSet — protejeaza la QuotaExceededError (anterior direct setItem)
  _safeLocalStorageSet('zeus_notifications', {
    items: NOTIFICATION_CENTER.items.slice(0, 100),
  });
  _ucMarkDirty('notifications');
  if (typeof _userCtxPush === 'function') _userCtxPush();
}
function _ncLoad() {
  try {
    const raw = localStorage.getItem('zeus_notifications');
    if (!raw) return;
    const data = JSON.parse(raw);
    NOTIFICATION_CENTER.items = data.items || [];
  } catch (_) { }
}

// ══════════════════════════════════════════════════════════════════
// UI Context Persistence — isolated display-only state (sound, AT log)
// Zero interaction with trading/brain/signal/execution paths
// ══════════════════════════════════════════════════════════════════
let _ctxSaveTimer = null;
function _ctxSave() {
  if (_ctxSaveTimer) clearTimeout(_ctxSaveTimer);
  _ctxSaveTimer = setTimeout(function _ctxSaveNow() {
    try {
      _safeLocalStorageSet('zeus_ui_context', {
        _v: 1,
        ts: Date.now(),
        soundOn: typeof S !== 'undefined' ? !!S.soundOn : false,
        atLog: (typeof AT !== 'undefined' && Array.isArray(AT.log)) ? AT.log.slice(0, 50) : [],
      });
      _ucMarkDirty('uiContext');
      if (typeof _userCtxPush === 'function') _userCtxPush();
    } catch (_) { }
  }, 1000);
}
function _ctxLoad() {
  try {
    const raw = localStorage.getItem('zeus_ui_context');
    if (!raw) return;
    const ctx = JSON.parse(raw);
    if (!ctx || ctx._v !== 1) return;
    // Sound toggle — display only, no trading impact
    if (typeof S !== 'undefined' && typeof ctx.soundOn === 'boolean') {
      S.soundOn = ctx.soundOn;
      const sndEl = document.getElementById('snd');
      if (sndEl) sndEl.innerHTML = S.soundOn ? _ZI.bell : _ZI.bellX;
    }
    // AT log — display only, never read by any decision function
    if (typeof AT !== 'undefined' && Array.isArray(ctx.atLog) && ctx.atLog.length > 0 && AT.log.length === 0) {
      AT.log = ctx.atLog;
      if (typeof renderATLog === 'function') renderATLog();
    }
    console.log('[CTX] UI context restored (sound:', ctx.soundOn, ', atLog:', (ctx.atLog || []).length, 'entries)');
  } catch (_) { }
}

// ══════════════════════════════════════════════════════════════════
// Cross-Device Per-User Sync — preferences only, zero trading impact
// Pushes safe settings to server, pulls on boot + tab-resume
// ══════════════════════════════════════════════════════════════════
let _ucPushTimer = null;
let _ucPulling = false;
let _ucVersion = 4; // v4: per-section dirty timestamps, hot-reload on pull, push triggers on all saves
let _ucPushPending = false; // offline queue flag — retry on next opportunity

// ── Per-section dirty timestamp registry ──
// Each section gets its own last-modified timestamp — prevents global overwrite on multi-device
var _ucDirtyTs = {};
try { _ucDirtyTs = JSON.parse(localStorage.getItem('zeus_uc_dirty_ts') || '{}'); } catch (_) { _ucDirtyTs = {}; }
// Upgrade migration: if no dirty-ts exists, seed all 19 sections with Date.now()
// so existing localStorage data gets a valid ts on first push after upgrade
if (!localStorage.getItem('zeus_uc_dirty_ts')) {
  var _seedTs = Date.now();
  ['settings', 'uiContext', 'panels', 'indSettings', 'llvSettings', 'uiScale',
    'signalRegistry', 'perfStats', 'dailyPnl', 'postmortem', 'adaptive',
    'notifications', 'scannerSyms', 'midstackOrder', 'aubData', 'ofHud',
    'teacherData', 'ariaNovaHud', 'aresData'].forEach(function (s) { _ucDirtyTs[s] = _seedTs; });
  try { localStorage.setItem('zeus_uc_dirty_ts', JSON.stringify(_ucDirtyTs)); } catch (_) { }
}
function _ucMarkDirty(section) {
  _ucDirtyTs[section] = Date.now();
  try { localStorage.setItem('zeus_uc_dirty_ts', JSON.stringify(_ucDirtyTs)); } catch (_) { }
}
window._ucMarkDirty = _ucMarkDirty;

// ── Build ALL sync sections from localStorage (shared by push + beacon) ──
function _buildAllSections() {
  var _t = function (s) { return _ucDirtyTs[s] || 0; };
  var _g = function (k) { try { return localStorage.getItem(k); } catch (_) { return null; } };
  var _j = function (k) { try { return JSON.parse(_g(k) || 'null'); } catch (_) { return null; } };
  return {
    // ── Core 6 ──
    settings: { ts: _t('settings'), data: _j('zeus_user_settings') },
    uiContext: { ts: _t('uiContext'), data: _j('zeus_ui_context') },
    panels: { ts: _t('panels'), data: { groups: _j('zeus_groups'), dslStrip: _g('zeus_dsl_strip_open'), atStrip: _g('zeus_at_strip_open'), ptStrip: _g('zeus_pt_strip_open'), mtfOpen: _g('zeus_mtf_open'), dslMode: _g('zeus_dsl_mode'), adaptStrip: _g('zeus_adaptive_strip_open') } },
    indSettings: { ts: _t('indSettings'), data: _j('zeus_ind_settings') },
    llvSettings: { ts: _t('llvSettings'), data: _j('zeus_llv_settings') },
    uiScale: { ts: _t('uiScale'), data: _g('zeus_ui_scale') },
    // ── Extended 12 ──
    signalRegistry: { ts: _t('signalRegistry'), data: _j('zeus_signal_registry') },
    perfStats: { ts: _t('perfStats'), data: _j('zeus_perf_v1') },
    dailyPnl: { ts: _t('dailyPnl'), data: _j('zeus_daily_pnl_v1') },
    postmortem: { ts: _t('postmortem'), data: _j('zeus_postmortem_v1') },
    adaptive: { ts: _t('adaptive'), data: _j('zeus_adaptive_v1') },
    notifications: { ts: _t('notifications'), data: _j('zeus_notifications') },
    scannerSyms: { ts: _t('scannerSyms'), data: _j('zeus_mscan_syms') },
    midstackOrder: { ts: _t('midstackOrder'), data: _j('zt_midstack_order') },
    aubData: { ts: _t('aubData'), data: { bb: _j('aub_bb'), macro: _j('aub_macro'), sim: _j('aub_sim_last'), expanded: _g('aub_expanded') } },
    ofHud: { ts: _t('ofHud'), data: { v2: _g('of_hud_v2'), pos: _g('of_hud_pos_v1'), anchor: _g('of_hud_anchor_x_v1') } },
    teacherData: { ts: _t('teacherData'), data: { config: _j('zeus_teacher_config'), sessions: _j('zeus_teacher_sessions'), lessons: _j('zeus_teacher_lessons'), stats: _j('zeus_teacher_stats'), memory: _j('zeus_teacher_memory'), v2state: _j('zeus_teacher_v2state'), panelOpen: _g('zeus_teacher_panel_open') } },
    ariaNovaHud: { ts: _t('ariaNovaHud'), data: { aria: _j('aria_v1'), nova: _j('nova_v1') } },
    // ── ARES data (simulation engine — synced for cross-device continuity) ──
    aresData: { ts: _t('aresData'), data: { wallet: _j('ARES_MISSION_STATE_V1_vw2'), positions: _j('ARES_POSITIONS_V1'), state: _j('ARES_STATE_V1'), init: _j('ares_init_v1'), lastTradeTs: _g('ARES_LAST_TRADE_TS'), journal: _j('ARES_JOURNAL_V1') } },
  };
}

// Immediate push (no debounce) — for explicit user actions like Apply Colors, toggle indicator
function _userCtxPushNow() {
  if (_ucPushTimer) { clearTimeout(_ucPushTimer); _ucPushTimer = null; }
  _ucPushBeacon();
}
window._userCtxPushNow = _userCtxPushNow;

function _userCtxPush() {
  if (_ucPushTimer) clearTimeout(_ucPushTimer);
  _ucPushTimer = setTimeout(function _ucPushExec() {
    try {
      var payload = { _v: _ucVersion, ts: Date.now(), sections: _buildAllSections() };
      fetch('/api/sync/user-context', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        credentials: 'same-origin'
      }).then(function (r) {
        if (!r.ok) { console.warn('[UC] push failed:', r.status); _ucPushPending = true; return null; }
        return r.json();
      }).then(function (json) {
        if (!json) return;
        console.log('[UC] \u2705 pushed'); _ucPushPending = false;
        // [C3] Validate server stored settings match what we sent
        if (json.storedSettings && json.storedSettings.data) {
          try {
            var sent = payload.sections.settings ? payload.sections.settings.data : null;
            var stored = json.storedSettings.data;
            if (sent && stored) {
              var sentAT = typeof sent === 'string' ? JSON.parse(sent) : sent;
              var storedAT = typeof stored === 'string' ? JSON.parse(stored) : stored;
              if (sentAT.autoTrade && storedAT.autoTrade) {
                var keys = ['lev', 'sl', 'rr', 'size', 'maxPos', 'killPct', 'confMin', 'sigMin'];
                var mismatches = [];
                keys.forEach(function (k) {
                  if (sentAT.autoTrade[k] !== storedAT.autoTrade[k]) {
                    mismatches.push(k + ':sent=' + sentAT.autoTrade[k] + '/stored=' + storedAT.autoTrade[k]);
                  }
                });
                if (mismatches.length > 0) {
                  console.error('[UC] \u26a0\ufe0f SETTINGS MISMATCH:', mismatches.join(', '));
                  if (typeof ZLOG !== 'undefined') ZLOG.push('WARN', '[UC] settings mismatch after push', { mismatches: mismatches });
                } else {
                  console.log('[UC] \u2705 settings validated \u2014 server matches client');
                }
              }
            }
          } catch (_) { }
        }
      }).catch(function (e) { console.warn('[UC] push err:', e.message); _ucPushPending = true; });
    } catch (_) { }
  }, 1000);
}

function _userCtxPull() {
  if (_ucPulling) return;
  _ucPulling = true;
  // Retry pending push before pulling (offline queue recovery)
  if (_ucPushPending) {
    console.log('[UC] retrying pending push before pull');
    _ucPushBeacon();
    _ucPushPending = false;
  }
  fetch('/api/sync/user-context', { credentials: 'same-origin' })
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (json) {
      _ucPulling = false;
      if (!json || !json.ok || !json.data || !json.data.sections) return;
      var sec = json.data.sections;
      var _dirty = false; // track if any dirty-ts changed this pull cycle

      // Boot verify: if local settings are newer than server, re-push (last beacon was lost)
      var localUS = JSON.parse(localStorage.getItem('zeus_user_settings') || 'null');
      var localTs = (localUS && localUS._syncTs) ? localUS._syncTs : 0;
      var serverSettingsTs = (sec.settings && sec.settings.ts) ? sec.settings.ts : 0;
      if (localTs > serverSettingsTs && localTs > 0) {
        console.log('[UC] local newer than server (' + localTs + ' > ' + serverSettingsTs + ') — re-pushing');
        _ucPushBeacon();
      }

      // ── settings section (field-level merge) ──
      if (sec.settings && sec.settings.data) {
        var localUS = JSON.parse(localStorage.getItem('zeus_user_settings') || 'null');
        var localTs = (localUS && localUS._syncTs) ? localUS._syncTs : 0;
        // Only apply server data if genuinely newer AND no local edits since boot
        var bootTs = window._zeusBootTs || 0;
        var localEditedSinceBoot = localTs > bootTs;
        if (sec.settings.ts > (_ucDirtyTs.settings || 0) && !localEditedSinceBoot) {
          var sData = sec.settings.data;
          if (sData) {
            if (localUS && typeof localUS === 'object') {
              for (var fk in sData) {
                if (fk === '_syncTs' || fk === '_version') continue;
                localUS[fk] = sData[fk];
              }
              localUS._syncTs = sec.settings.ts;
              localStorage.setItem('zeus_user_settings', JSON.stringify(localUS));
            } else {
              sData._syncTs = sec.settings.ts;
              localStorage.setItem('zeus_user_settings', JSON.stringify(sData));
            }
            _ucDirtyTs.settings = sec.settings.ts; _dirty = true;
            if (typeof loadUserSettings === 'function') loadUserSettings();
            console.log('[UC] \u2705 settings field-merged from server');
          }
        }
      }

      // ── uiContext section ──
      if (sec.uiContext && sec.uiContext.data) {
        if (sec.uiContext.ts > (_ucDirtyTs.uiContext || 0)) {
          localStorage.setItem('zeus_ui_context', JSON.stringify(sec.uiContext.data));
          _ucDirtyTs.uiContext = sec.uiContext.ts; _dirty = true;
          if (typeof _ctxLoad === 'function') _ctxLoad();
          console.log('[UC] \u2705 uiContext merged from server');
        }
      }

      // ── panels section ──
      if (sec.panels && sec.panels.data) {
        if (sec.panels.ts > (_ucDirtyTs.panels || 0)) {
          var pd = sec.panels.data;
          if (pd.groups) localStorage.setItem('zeus_groups', JSON.stringify(pd.groups));
          if (pd.dslStrip != null) localStorage.setItem('zeus_dsl_strip_open', pd.dslStrip);
          if (pd.atStrip != null) localStorage.setItem('zeus_at_strip_open', pd.atStrip);
          if (pd.ptStrip != null) localStorage.setItem('zeus_pt_strip_open', pd.ptStrip);
          if (pd.mtfOpen != null) localStorage.setItem('zeus_mtf_open', pd.mtfOpen);
          if (pd.dslMode != null) localStorage.setItem('zeus_dsl_mode', pd.dslMode);
          if (pd.adaptStrip != null) localStorage.setItem('zeus_adaptive_strip_open', pd.adaptStrip);
          _ucDirtyTs.panels = sec.panels.ts; _dirty = true;
          console.log('[UC] \u2705 panels merged from server');
        }
      }

      // ── indSettings section (indicator parameters) ──
      if (sec.indSettings && sec.indSettings.data) {
        if (sec.indSettings.ts > (_ucDirtyTs.indSettings || 0)) {
          localStorage.setItem('zeus_ind_settings', JSON.stringify(sec.indSettings.data));
          _ucDirtyTs.indSettings = sec.indSettings.ts; _dirty = true;
          if (typeof _indSettingsLoad === 'function') _indSettingsLoad();
          if (typeof renderChart === 'function') renderChart();
          console.log('[UC] \u2705 indSettings merged from server');
        }
      }

      // ── llvSettings section (liquidation levels) ──
      if (sec.llvSettings && sec.llvSettings.data) {
        if (sec.llvSettings.ts > (_ucDirtyTs.llvSettings || 0)) {
          localStorage.setItem('zeus_llv_settings', JSON.stringify(sec.llvSettings.data));
          _ucDirtyTs.llvSettings = sec.llvSettings.ts; _dirty = true;
          console.log('[UC] \u2705 llvSettings merged from server');
        }
      }

      // ── uiScale section ──
      if (sec.uiScale && sec.uiScale.data != null) {
        if (sec.uiScale.ts > (_ucDirtyTs.uiScale || 0)) {
          localStorage.setItem('zeus_ui_scale', sec.uiScale.data);
          _ucDirtyTs.uiScale = sec.uiScale.ts; _dirty = true;
          document.documentElement.style.fontSize = sec.uiScale.data + 'px';
          console.log('[UC] \u2705 uiScale merged from server');
        }
      }

      // ── Extended sections pull — use _ucDirtyTs for comparison + hot-reload ──
      var _restoreJSON = function (sectionName, lsKey, reloadFn) {
        if (sec[sectionName] && sec[sectionName].data != null) {
          var localDirty = _ucDirtyTs[sectionName] || 0;
          if (sec[sectionName].ts > localDirty) {
            localStorage.setItem(lsKey, JSON.stringify(sec[sectionName].data));
            _ucDirtyTs[sectionName] = sec[sectionName].ts; _dirty = true;
            if (reloadFn) reloadFn();
            console.log('[UC] \u2705 ' + sectionName + ' merged from server');
          }
        }
      };
      _restoreJSON('signalRegistry', 'zeus_signal_registry', function () { if (typeof _srLoad === 'function') _srLoad(); });
      _restoreJSON('perfStats', 'zeus_perf_v1', function () { if (typeof loadPerfFromStorage === 'function') loadPerfFromStorage(); });
      _restoreJSON('dailyPnl', 'zeus_daily_pnl_v1', function () { if (typeof loadDailyPnl === 'function') loadDailyPnl(); });
      _restoreJSON('postmortem', 'zeus_postmortem_v1', null);
      _restoreJSON('adaptive', 'zeus_adaptive_v1', function () { if (typeof _adaptLoad === 'function') _adaptLoad(); });
      _restoreJSON('notifications', 'zeus_notifications', function () { if (typeof _ncLoad === 'function') { _ncLoad(); if (typeof _ncRenderList === 'function') _ncRenderList(); if (typeof _ncUpdateBadge === 'function') _ncUpdateBadge(); } });
      _restoreJSON('scannerSyms', 'zeus_mscan_syms', null);
      _restoreJSON('midstackOrder', 'zt_midstack_order', null);
      // AUB compound section
      if (sec.aubData && sec.aubData.data) {
        var aubLocalDirty = _ucDirtyTs['aubData'] || 0;
        if (sec.aubData.ts > aubLocalDirty) {
          var ad = sec.aubData.data;
          if (ad.bb != null) localStorage.setItem('aub_bb', JSON.stringify(ad.bb));
          if (ad.macro != null) localStorage.setItem('aub_macro', JSON.stringify(ad.macro));
          if (ad.sim != null) localStorage.setItem('aub_sim_last', JSON.stringify(ad.sim));
          if (ad.expanded != null) localStorage.setItem('aub_expanded', ad.expanded);
          _ucDirtyTs['aubData'] = sec.aubData.ts; _dirty = true;
          console.log('[UC] \u2705 aubData merged from server');
        }
      }
      // Orderflow HUD compound section
      if (sec.ofHud && sec.ofHud.data) {
        var ofLocalDirty = _ucDirtyTs['ofHud'] || 0;
        if (sec.ofHud.ts > ofLocalDirty) {
          var od = sec.ofHud.data;
          if (od.v2 != null) localStorage.setItem('of_hud_v2', od.v2);
          if (od.pos != null) localStorage.setItem('of_hud_pos_v1', od.pos);
          if (od.anchor != null) localStorage.setItem('of_hud_anchor_x_v1', od.anchor);
          _ucDirtyTs['ofHud'] = sec.ofHud.ts; _dirty = true;
          console.log('[UC] \u2705 ofHud merged from server');
        }
      }
      // Teacher compound section
      if (sec.teacherData && sec.teacherData.data) {
        var tLocalDirty = _ucDirtyTs['teacherData'] || 0;
        if (sec.teacherData.ts > tLocalDirty) {
          var td = sec.teacherData.data;
          if (td.config != null) localStorage.setItem('zeus_teacher_config', JSON.stringify(td.config));
          if (td.sessions != null) localStorage.setItem('zeus_teacher_sessions', JSON.stringify(td.sessions));
          if (td.lessons != null) localStorage.setItem('zeus_teacher_lessons', JSON.stringify(td.lessons));
          if (td.stats != null) localStorage.setItem('zeus_teacher_stats', JSON.stringify(td.stats));
          if (td.memory != null) localStorage.setItem('zeus_teacher_memory', JSON.stringify(td.memory));
          if (td.v2state != null) localStorage.setItem('zeus_teacher_v2state', JSON.stringify(td.v2state));
          if (td.panelOpen != null) localStorage.setItem('zeus_teacher_panel_open', td.panelOpen);
          _ucDirtyTs['teacherData'] = sec.teacherData.ts; _dirty = true;
          if (typeof teacherLoadAllPersistent === 'function') teacherLoadAllPersistent();
          console.log('[UC] \u2705 teacherData merged from server');
        }
      }
      // ARIA/NOVA HUD
      if (sec.ariaNovaHud && sec.ariaNovaHud.data) {
        var anLocalDirty = _ucDirtyTs['ariaNovaHud'] || 0;
        if (sec.ariaNovaHud.ts > anLocalDirty) {
          var an = sec.ariaNovaHud.data;
          if (an.aria != null) localStorage.setItem('aria_v1', JSON.stringify(an.aria));
          if (an.nova != null) localStorage.setItem('nova_v1', JSON.stringify(an.nova));
          _ucDirtyTs['ariaNovaHud'] = sec.ariaNovaHud.ts; _dirty = true;
          console.log('[UC] \u2705 ariaNovaHud merged from server');
        }
      }
      // ARES data (simulation engine — wallet, positions, state, journal)
      if (sec.aresData && sec.aresData.data) {
        var arLocalDirty = _ucDirtyTs['aresData'] || 0;
        if (sec.aresData.ts > arLocalDirty) {
          var ad = sec.aresData.data;
          if (ad.wallet != null) localStorage.setItem('ARES_MISSION_STATE_V1_vw2', JSON.stringify(ad.wallet));
          if (ad.positions != null) localStorage.setItem('ARES_POSITIONS_V1', JSON.stringify(ad.positions));
          if (ad.state != null) localStorage.setItem('ARES_STATE_V1', JSON.stringify(ad.state));
          if (ad.init != null) localStorage.setItem('ares_init_v1', JSON.stringify(ad.init));
          if (ad.lastTradeTs != null) localStorage.setItem('ARES_LAST_TRADE_TS', ad.lastTradeTs);
          if (ad.journal != null) localStorage.setItem('ARES_JOURNAL_V1', JSON.stringify(ad.journal));
          _ucDirtyTs['aresData'] = sec.aresData.ts; _dirty = true;
          console.log('[UC] \u2705 aresData merged from server');
        }
      }
      // Persist dirty-ts changes from this pull cycle
      if (_dirty) { try { localStorage.setItem('zeus_uc_dirty_ts', JSON.stringify(_ucDirtyTs)); } catch (_) { } }
    })
    .catch(function (e) { _ucPulling = false; console.warn('[UC] pull err:', e.message); });
}

// ── CSS inline ───────────────────────────────────────────────────
(function _ncInjectCSS() {
  const s = document.createElement('style');
  s.textContent = `
  #nc-bell-wrap { position:relative; display:inline-flex; }
  #nc-badge {
    display:none; position:absolute; top:-4px; right:-5px;
    background:var(--red); color:#fff; border-radius:50%;
    font-size:10px; min-width:12px; height:12px; line-height:12px;
    text-align:center; padding:0 2px; font-family:var(--ff);
    pointer-events:none; font-weight:700;
  }
  #mnotifications .modal { max-height:85vh; display:flex; flex-direction:column; }
  .nc-tabs { display:flex; gap:2px; padding:6px 10px;
    background:#040810; border-bottom:1px solid #0a1a2a; flex-shrink:0; }
  .nc-tab { font-size:11px; padding:3px 10px; border-radius:2px; cursor:pointer;
    border:1px solid #0a1a2a; color:var(--dim); font-family:var(--ff);
    letter-spacing:1px; background:transparent; }
  .nc-tab.act { border-color:var(--gold); color:var(--gold); background:#f0c04011; }
  .nc-actions { display:flex; gap:6px; padding:6px 10px;
    border-bottom:1px solid #0a1a2a; flex-shrink:0; }
  #nc-list { flex:1; overflow-y:auto; max-height:55vh; }
  .nc-item { padding:6px 10px; border-bottom:1px solid #0a1020; }
  .nc-item.nc-read { opacity:.5; }
  .nc-item.critical { border-left:3px solid var(--red); }
  .nc-item.warning  { border-left:3px solid var(--ylw); }
  .nc-item.info     { border-left:3px solid #44aaff; }
  .nc-item-hdr { display:flex; align-items:center; gap:5px; margin-bottom:2px; }
  .nc-ico   { font-size:12px; }
  .nc-type  { font-size:11px; color:var(--gold); letter-spacing:1px;
    text-transform:uppercase; flex:1; }
  .nc-time  { font-size:11px; color:var(--dim); }
  .nc-mark  { background:none; border:1px solid #0a1a2a; color:var(--dim);
    font-size:11px; padding:0 4px; border-radius:2px; cursor:pointer;
    font-family:var(--ff); flex-shrink:0; }
  .nc-mark:hover { color:var(--grn); border-color:var(--grn); }
  .nc-msg   { font-size:12px; color:var(--txt); line-height:1.5; }
  .nc-empty { padding:20px; text-align:center; color:var(--dim); font-size:12px; }
  `;
  document.head.appendChild(s);
})();

// ── SR Strip toggle ──────────────────────────────────────────────
function srStripToggle() {
  const strip = document.getElementById('sr-strip');
  if (!strip) return;
  strip.classList.toggle('sr-strip-open');
  if (strip.classList.contains('sr-strip-open')) {
    _srRenderList();
    _srRenderStats();
  }
}

function srStripUpdateBar() {
  const st = SIGNAL_REGISTRY.stats;
  const totalEl = document.getElementById('sr-strip-total');
  const wrEl = document.getElementById('sr-strip-wr');
  const lastEl = document.getElementById('sr-strip-last');
  if (totalEl) totalEl.innerHTML = `<b>${st.total || 0}</b> semnale`;
  if (wrEl) {
    if (st.total) {
      const wrGood = st.winRate >= 50;
      wrEl.innerHTML = `WR: <b class="${wrGood ? 'sr-strip-wr-good' : 'sr-strip-wr-bad'}">${st.winRate}%</b>`;
    } else {
      wrEl.innerHTML = '';
    }
  }
  if (lastEl) {
    const last = SIGNAL_REGISTRY.signals[0];
    if (last) {
      const dirCol = last.direction === 'LONG' ? '#00ff88' : last.direction === 'SHORT' ? '#ff3355' : '#f0c040';
      lastEl.innerHTML = `<span style="color:${dirCol}">${last.direction}</span> <span style="color:#00d9ff88">${(last.type || '').slice(0, 12)}</span>`;
    } else {
      lastEl.innerHTML = '';
    }
  }
}

// ── CSS inline pentru Signal Registry ───────────────────────────
(function _srInjectCSS() {
  const style = document.createElement('style');
  style.textContent = `
  #sr-sec { font-family: var(--ff); }
  /* ── SR Strip banner colapsibil ── */
  #sr-strip { background:transparent; border-bottom:none; margin:3px 6px; position:relative; }
  #sr-strip-bar { display:flex; align-items:center; justify-content:space-between; padding:0; min-height:44px; cursor:pointer; user-select:none; gap:0; transition:border-color .25s,box-shadow .25s; color:#00d9ff77; background:none; border:none; border-radius:10px; opacity:1; position:relative; overflow:hidden; }
  #sr-strip-bar:hover { }
  #sr-strip-title { font-size:13px; font-weight:700; letter-spacing:2px; color:#00d9ff; display:flex; align-items:center; gap:5px; }
  #sr-strip-info { display:flex; align-items:center; gap:8px; }
  .sr-strip-stat { font-size:11px; color:#00d9ff66; letter-spacing:0.5px; padding:2px 6px; border-radius:999px; background:#00d9ff11; border:1px solid #00d9ff22; }
  .sr-strip-stat b { color:#00d9ff; }
  .sr-strip-wr-good { color:#00ff88 !important; }
  .sr-strip-wr-bad  { color:#ff3355 !important; }
  .sr-strip-chev { font-size:8px; color:#00d9ff44; transition:transform .25s; margin-left:2px; flex-shrink:0; opacity:.35; }
  #sr-strip.sr-strip-open .sr-strip-chev { transform:rotate(180deg); }
  #sr-strip.sr-strip-open #sr-strip-bar { opacity:1; }
  #sr-strip-info { display:none; }
  #sr-strip.sr-strip-open #sr-strip-info { display:flex; }
  #sr-strip-panel { display:none; border-top:1px solid #00d9ff12; }
  #sr-strip.sr-strip-open #sr-strip-panel { display:block; }

  /* ── MTF Structural Model Panel (Etapa 1) ───────────────────── */
  #mtf-strip { background:transparent; border-bottom:none; margin:3px 6px; }
  #mtf-strip-bar { display:flex; align-items:center; gap:0; padding:0; cursor:pointer; min-height:44px; user-select:none; -webkit-tap-highlight-color:transparent; transition:border-color .25s,box-shadow .25s; color:#00d9ff77; background:none; border:none; border-radius:10px; opacity:1; position:relative; overflow:hidden; }
  #mtf-strip-bar:hover { }
  #mtf-strip-title { font-family:var(--ff); font-size:13px; letter-spacing:2px; color:#00d9ff; flex-shrink:0; }
  #mtf-strip-score { font-family:var(--ff); font-size:13px; color:#00d9ff66; margin-left:auto; }
  /* info condensat pe bara MTF când e închis */
  #mtf-bar-condensed { display:flex; align-items:center; gap:6px; margin-left:6px; flex:1; overflow:hidden; }
  .mtf-bar-pill { font-size:11px; padding:2px 6px; border-radius:999px; background:#00d9ff11; border:1px solid #00d9ff22; color:#00d9ff88; white-space:nowrap; }
  .mtf-bar-pill.bull { background:#00d97a11; border-color:#00d97a33; color:#00d97a; }
  .mtf-bar-pill.bear { background:#ff335511; border-color:#ff335533; color:#ff3355; }
  .mtf-bar-pill.squeeze { background:#f0c04011; border-color:#f0c04033; color:#f0c040; }
  #mtf-strip.mtf-open #mtf-bar-condensed { display:none; }
  #mtf-strip-chev { font-size:8px; color:#00d9ff44; transition:transform .25s; margin-left:2px; flex-shrink:0; opacity:.35; }
  #mtf-strip.mtf-open #mtf-strip-chev { transform:rotate(180deg); }
  #mtf-strip.mtf-open #mtf-strip-bar { opacity:1; }
  #mtf-strip-panel { display:none; padding:8px 12px 10px; border-top:1px solid #00d9ff12; border-radius:0 0 10px 10px; margin:2px 8px 0; }
  #mtf-strip.mtf-open #mtf-strip-panel { display:block; }
  .mtf-row { display:flex; align-items:center; gap:6px; margin-bottom:5px; font-family:var(--ff); font-size:13px; }
  .mtf-lbl { color:#00d9ff44; letter-spacing:1px; width:82px; flex-shrink:0; }
  .mtf-val { color:#7a9ab8; }
  .mtf-val.good { color:#00d97a; text-shadow:0 0 6px #00d97a55; }
  .mtf-val.warn { color:#f0c040; text-shadow:0 0 6px #f0c04055; }
  .mtf-val.bad  { color:#ff3355; text-shadow:0 0 6px #ff335555; }
  .mtf-score-bar { height:4px; border-radius:2px; background:#0a1525; margin-top:6px; overflow:hidden; }
  .mtf-score-fill { height:100%; border-radius:2px; transition:width .5s; background:linear-gradient(90deg,#00d9ff,#00ffcc); }
  .mtf-tf-row { display:flex; gap:5px; margin-top:4px; }
  .mtf-tf-badge { font-family:var(--ff); font-size:12px; letter-spacing:1px; padding:3px 7px; border-radius:2px; border:1px solid #00d9ff22; color:#00d9ff66; }
  .mtf-tf-badge.bull { color:#00d97a; border-color:#00d97a44; background:#00d97a0a; }
  .mtf-tf-badge.bear { color:#ff3355; border-color:#ff335544; background:#ff33550a; }
  .mtf-tf-badge.neut { color:#7a9ab8; border-color:#7a9ab822; }
  .mtf-update-ts { font-family:var(--ff); font-size:11px; color:#00d9ff22; letter-spacing:1px; margin-top:6px; }
  #sr-stats { display:flex; flex-wrap:wrap; gap:6px; padding:6px 8px;
    background:#040810; border-bottom:1px solid #0a1a2a; }
  .sr-stat { font-size:12px; color:var(--dim); }
  .sr-stat b { color:var(--gold); }
  .sr-win  { color:var(--grn) !important; }
  .sr-loss { color:var(--red) !important; }
  #sr-list { max-height:220px; overflow-y:auto; }
  .sr-row  { display:flex; align-items:center; gap:4px; padding:3px 8px;
    border-bottom:1px solid #0a1020; font-size:12px; }
  .sr-row:hover { background:#05081a; }
  .sr-time  { color:var(--dim); width:32px; flex-shrink:0; }
  .sr-src   { width:14px; flex-shrink:0; }
  .sr-type  { color:#9ab; flex:1; min-width:0; white-space:nowrap; overflow:hidden; }
  .sr-dir   { width:36px; text-align:center; flex-shrink:0; font-size:11px; border-radius:2px; padding:1px 3px; }
  .sr-long  { background:#00d97a22; color:var(--grn); }
  .sr-short { background:#ff335522; color:var(--red); }
  .sr-neut  { background:#f0c04011; color:var(--gold); }
  .sr-score { width:28px; text-align:right; color:var(--gold); flex-shrink:0; }
  .sr-outcome { width:72px; text-align:right; flex-shrink:0; }
  .sr-pend  { color:var(--dim); }
  .sr-empty { padding:16px; text-align:center; color:var(--dim); font-size:12px; }
  `;
  document.head.appendChild(style);
})();

// ═══════════════════════════════════════════════════════════════════
// MTF STRUCTURAL MODEL — Etapa 1 (read-only, gated interval, OFF by default)
// ═══════════════════════════════════════════════════════════════════

// ── buildMTFStructure() — citește funcțiile existente, agregă în BM.structure ──
function buildMTFStructure() {
  try {
    const klines = (typeof S !== 'undefined' && S.klines) ? S.klines : [];
    if (!klines.length || klines.length < 50) {
      // Fail-safe: date insuficiente — placeholder
      BM.structure.regime = 'insufficient data';
      BM.structure.score = 0;
      BM.structure.lastUpdate = Date.now();
      return BM.structure;
    }

    // ── 1. Regime Enhanced (citește funcția existentă) ──
    const reg = (typeof detectRegimeEnhanced === 'function')
      ? detectRegimeEnhanced(klines) : { regime: 'unknown', adx: 0, atrPct: 0, squeeze: false, volMode: '—', structure: '—' };

    BM.structure.regime = reg.regime || 'unknown';
    BM.structure.adx = reg.adx || 0;
    BM.structure.atrPct = reg.atrPct || 0;
    BM.structure.squeeze = !!reg.squeeze;
    BM.structure.volMode = reg.volMode || '—';
    BM.structure.structureLabel = reg.structure || '—';

    // ── 2. MTF Alignment (citește BM.mtf populat de updateMTFAlignment) ──
    if (typeof updateMTFAlignment === 'function') updateMTFAlignment();
    BM.structure.mtfAlign = {
      '15m': BM.mtf?.['15m'] || 'neut',
      '1h': BM.mtf?.['1h'] || 'neut',
      '4h': BM.mtf?.['4h'] || 'neut',
    };

    // ── 3. Calcul alignmentScore 0–100 ──
    // Factori: ADX (trend putere), squeeze (potențial), MTF align, volMode
    let score = 0;

    // ADX contribuie max 30 pts
    score += Math.min(30, Math.round((BM.structure.adx / 50) * 30));

    // MTF align: fiecare TF aliniat = 15 pts (max 45)
    const mainDir = reg.slope20 >= 0 ? 'bull' : 'bear';
    ['15m', '1h', '4h'].forEach(tf => {
      const dir = BM.structure.mtfAlign[tf];
      if (dir === mainDir) score += 15;
      else if (dir === 'neut') score += 5;
    });

    // volMode expansion = +15 pts, contraction = -5
    if (BM.structure.volMode === 'expansion') score += 15;
    else if (BM.structure.volMode === 'contraction') score -= 5;

    // squeeze activ = +10 pts (potențial breakout)
    if (BM.structure.squeeze) score += 10;

    BM.structure.score = Math.max(0, Math.min(100, score));
    BM.structure.lastUpdate = Date.now();

    // ── 4. Volatility Regime Clustering (Etapa 2) ──
    updateVolRegime(reg.atrPct || 0);

    return BM.structure;
  } catch (e) {
    console.warn('[MTF] buildMTFStructure error:', e.message);
    return BM.structure;
  }
}

// ── updateVolRegime() — Etapa 2: Volatility Regime Clustering ──
// Ring buffer ATR%, percentilă curentă → LOW/MED/HIGH/EXTREME
function updateVolRegime(atrPct) {
  try {
    if (!atrPct || !Number.isFinite(atrPct)) return;

    // Push în ring buffer — cap strict 200
    BM.volBuffer.push(atrPct);
    if (BM.volBuffer.length > 200) BM.volBuffer.shift();

    // Nevoie de minim 10 valori pentru percentilă semnificativă
    if (BM.volBuffer.length < 10) {
      BM.volRegime = '—';
      BM.volPct = null;
      return;
    }

    // Calculăm percentila curentă față de buffer sortat
    const sorted = BM.volBuffer.slice().sort((a, b) => a - b);
    const rank = sorted.filter(v => v <= atrPct).length;
    const pct = Math.round((rank / sorted.length) * 100);
    BM.volPct = pct;

    // Clasificare în 4 regimuri
    if (pct >= 85) BM.volRegime = 'EXTREME';
    else if (pct >= 60) BM.volRegime = 'HIGH';
    else if (pct >= 30) BM.volRegime = 'MED';
    else BM.volRegime = 'LOW';

  } catch (e) {
    console.warn('[VOL] updateVolRegime error:', e.message);
  }
}

// ── updateLiqCycle() — Etapa 3: Liquidity Cycle Tracking ──
// Cap strict 200 bare, interval separat 60s, read-only
function updateLiqCycle() {
  try {
    const klines = (typeof S !== 'undefined' && S.klines) ? S.klines : [];
    const curPrice = (typeof S !== 'undefined' && S.price) ? S.price : 0;
    const lc = BM.liqCycle;

    if (klines.length < 20) {
      lc.currentSweep = 'none';
      lc.lastUpdate = Date.now();
      return;
    }

    // ── 1. Sweep curent (pe ultimele 20 bare, cap 200) ──
    const workKlines = klines.slice(-200);
    const sweep = (typeof detectSweepDisplacement === 'function')
      ? detectSweepDisplacement(workKlines)
      : { type: 'none', reclaim: false, displacement: false };

    lc.currentSweep = sweep.type || 'none';
    lc.sweepDisplacement = !!sweep.displacement;

    // ── 2. TrapRate — pe ultimele 50 bare (ferestre de 20) ──
    // Un sweep e "trap" dacă are reclaim=true dar displacement=false
    // Analizăm ultimele 50 bare în ferestre de 20, pas 1
    const window50 = klines.slice(-50);
    let sweepsCount = 0;
    let trapsCount = 0;

    if (window50.length >= 20) {
      // Rulăm detectSweepDisplacement pe 6 sub-ferestre de 20
      const step = Math.floor((window50.length - 20) / 5) || 1;
      for (let i = 0; i + 20 <= window50.length; i += step) {
        const sub = window50.slice(i, i + 20);
        // Inline calcul simplu — nu apelăm funcția ca să evităm side effects pe BM.sweep
        const cur = sub[sub.length - 1];
        const prevHigh = Math.max(...sub.slice(0, -1).map(k => k.high));
        const prevLow = Math.min(...sub.slice(0, -1).map(k => k.low));
        const atr = sub.slice(-5).reduce((a, k) => a + (k.high - k.low), 0) / 5;

        if (cur.high > prevHigh && cur.close < prevHigh) {
          sweepsCount++;
          const isDisplacement = (prevHigh - cur.close) > atr * 0.5;
          if (!isDisplacement) trapsCount++; // sweep fără displacement = trap
        } else if (cur.low < prevLow && cur.close > prevLow) {
          sweepsCount++;
          const isDisplacement = (cur.close - prevLow) > atr * 0.5;
          if (!isDisplacement) trapsCount++;
        }
      }
    }

    lc.sweepsTotal = sweepsCount;
    lc.trapsTotal = trapsCount;
    lc.trapRate = sweepsCount > 0 ? Math.round((trapsCount / sweepsCount) * 100) / 100 : null;

    // ── 3. Magnet Proximity ──
    const magnets = (typeof S !== 'undefined' && S.magnets) ? S.magnets : { above: [], below: [] };
    const nearAbove = magnets.above?.[0];
    const nearBelow = magnets.below?.[0];

    lc.magnetAboveDist = (nearAbove && curPrice)
      ? Math.round(((nearAbove.price - curPrice) / curPrice) * 10000) / 100  // %
      : null;
    lc.magnetBelowDist = (nearBelow && curPrice)
      ? Math.round(((curPrice - nearBelow.price) / curPrice) * 10000) / 100
      : null;

    // Bias: magnetul mai aproape trage prețul
    if (lc.magnetAboveDist != null && lc.magnetBelowDist != null) {
      lc.magnetBias = lc.magnetAboveDist < lc.magnetBelowDist ? 'above' : 'below';
    } else if (lc.magnetAboveDist != null) {
      lc.magnetBias = 'above';
    } else if (lc.magnetBelowDist != null) {
      lc.magnetBias = 'below';
    } else {
      lc.magnetBias = '—';
    }

    lc.lastUpdate = Date.now();

  } catch (e) {
    console.warn('[LIQ] updateLiqCycle error:', e.message);
  }
}

// ── renderMTFPanel() — actualizează UI-ul panoului ──
function renderMTFPanel() {
  try {
    const st = BM.structure;
    const _el = id => document.getElementById(id);
    const _cls = (el, cls) => { if (el) { el.className = 'mtf-val'; if (cls) el.classList.add(cls); } };

    // Regime
    const rEl = _el('mtf-regime');
    if (rEl) {
      const rMap = { trend: 'good', breakout: 'good', squeeze: 'warn', range: 'warn', panic: 'bad', volatile: 'bad', unknown: '', 'insufficient data': '' };
      rEl.textContent = (st.regime || '—').toUpperCase();
      _cls(rEl, rMap[st.regime] || '');
    }

    // Structure label
    const sEl = _el('mtf-structure');
    if (sEl) {
      sEl.textContent = st.structureLabel || '—';
      _cls(sEl, st.structureLabel === 'HH/HL' ? 'good' : st.structureLabel === 'LH/LL' ? 'bad' : 'warn');
    }

    // ATR%
    const aEl = _el('mtf-atr');
    if (aEl) {
      aEl.textContent = st.atrPct ? st.atrPct.toFixed(2) + '%' : '—';
      _cls(aEl, st.atrPct > 2 ? 'bad' : st.atrPct > 1 ? 'warn' : 'good');
    }

    // Vol mode
    const vEl = _el('mtf-vol');
    if (vEl) {
      vEl.textContent = (st.volMode || '—').toUpperCase();
      _cls(vEl, st.volMode === 'expansion' ? 'good' : st.volMode === 'contraction' ? 'warn' : '');
    }

    // Squeeze
    const sqEl = _el('mtf-squeeze');
    if (sqEl) {
      sqEl.innerHTML = st.squeeze ? _ZI.bolt + ' ACTIV' : 'OFF';
      _cls(sqEl, st.squeeze ? 'warn' : '');
    }

    // ADX
    const adxEl = _el('mtf-adx');
    if (adxEl) {
      adxEl.textContent = st.adx || '—';
      _cls(adxEl, st.adx > 30 ? 'good' : st.adx > 15 ? 'warn' : 'bad');
    }

    // Vol Regime (Etapa 2)
    const vrEl = _el('mtf-vol-regime');
    if (vrEl) {
      vrEl.textContent = BM.volRegime || '—';
      const vrMap = { 'EXTREME': 'bad', 'HIGH': 'warn', 'MED': '', 'LOW': 'good' };
      _cls(vrEl, vrMap[BM.volRegime] || '');
    }
    const vpEl = _el('mtf-vol-pct');
    if (vpEl) {
      vpEl.textContent = BM.volPct != null ? BM.volPct + 'th percentilă' : '— (acumulez date)';
      _cls(vpEl, BM.volPct != null ? (BM.volPct >= 85 ? 'bad' : BM.volPct >= 60 ? 'warn' : BM.volPct < 30 ? 'good' : '') : '');
    }

    // Liq Cycle (Etapa 3)
    const lc = BM.liqCycle;
    const swEl = _el('mtf-sweep');
    if (swEl) {
      const sw = lc.sweepSimple;
      if (sw && sw.dir !== '—') {
        // FIX B: afișăm direcția + strength% din detectSweepSimple (live, 5s)
        swEl.textContent = sw.dir + (sw.strength > 0 ? ' ' + sw.strength + '%' : '');
        _cls(swEl, sw.dir === 'BULL' ? 'good' : 'warn');
      } else {
        const swMap = { 'above': '⬆ ABOVE', 'below': '⬇ BELOW', 'none': '—' };
        swEl.textContent = swMap[lc.currentSweep] || '—';
        _cls(swEl, lc.currentSweep !== 'none' ? (lc.sweepDisplacement ? 'good' : 'warn') : '');
      }
    }
    const trEl = _el('mtf-trap-rate');
    if (trEl) {
      if (lc.trapRate != null) {
        const trPct = Math.round(lc.trapRate * 100);
        trEl.textContent = trPct + '% (' + lc.trapsTotal + '/' + lc.sweepsTotal + ')';
        _cls(trEl, trPct >= 70 ? 'bad' : trPct >= 40 ? 'warn' : 'good');
      } else {
        trEl.textContent = '— (date insuficiente)';
        _cls(trEl, '');
      }
    }
    const maEl = _el('mtf-mag-above');
    if (maEl) {
      maEl.textContent = lc.magnetAboveDist != null ? '+' + lc.magnetAboveDist + '%' : '—';
      _cls(maEl, lc.magnetAboveDist != null ? (lc.magnetAboveDist < 0.5 ? 'warn' : '') : '');
    }
    const mbEl = _el('mtf-mag-below');
    if (mbEl) {
      mbEl.textContent = lc.magnetBelowDist != null ? '-' + lc.magnetBelowDist + '%' : '—';
      _cls(mbEl, lc.magnetBelowDist != null ? (lc.magnetBelowDist < 0.5 ? 'warn' : '') : '');
    }
    const mbsEl = _el('mtf-mag-bias');
    if (mbsEl) {
      const biasMap = { 'above': '⬆ ABOVE', 'below': '⬇ BELOW', '—': '—' };
      mbsEl.textContent = biasMap[lc.magnetBias] || '—';
      _cls(mbsEl, lc.magnetBias === 'above' ? 'good' : lc.magnetBias === 'below' ? 'warn' : '');
    }

    // MTF badges
    ['15m', '1h', '4h'].forEach(tf => {
      const b = _el('mtf-' + tf);
      if (b) {
        const dir = st.mtfAlign[tf] || 'neut';
        b.className = 'mtf-tf-badge ' + dir;
        b.textContent = tf + ' ' + (dir === 'bull' ? '▲' : dir === 'bear' ? '▼' : '—');
      }
    });

    // Score
    const sc = st.score || 0;
    const scTxt = _el('mtf-score-txt');
    const scFill = _el('mtf-score-fill');
    const scBar = _el('mtf-strip-score');
    if (scTxt) scTxt.textContent = sc + ' / 100';
    if (scFill) scFill.style.width = sc + '%';
    if (scBar) scBar.textContent = sc + ' / 100';

    // Timestamp
    const tsEl = _el('mtf-ts');
    if (tsEl && st.lastUpdate) {
      const d = new Date(st.lastUpdate);
      tsEl.textContent = 'actualizat ' + d.toLocaleTimeString('ro-RO', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    }

    // ── Regime Engine rows ──────────────────────────────────────
    const re = BM.regimeEngine || {};
    const reEl = _el('re-regime');
    if (reEl) {
      const reMap = { 'TREND_UP': 'good', 'TREND_DOWN': 'bad', 'EXPANSION': 'good', 'SQUEEZE': 'warn', 'RANGE': '', 'CHAOS': 'bad', 'LIQUIDATION_EVENT': 'bad' };
      reEl.textContent = (re.regime || '—');
      _cls(reEl, reMap[re.regime] || '');
    }
    const reTrap = _el('re-trap');
    if (reTrap) {
      reTrap.textContent = (re.trapRisk != null ? re.trapRisk + '%' : '—');
      _cls(reTrap, re.trapRisk >= 60 ? 'bad' : re.trapRisk >= 30 ? 'warn' : 'good');
    }
    const reConf = _el('re-conf');
    if (reConf) {
      reConf.textContent = (re.confidence != null ? re.confidence + '%' : '—');
      _cls(reConf, re.confidence >= 70 ? 'good' : re.confidence >= 40 ? 'warn' : 'bad');
    }
    // ── Phase Filter rows ───────────────────────────────────────
    const pf = BM.phaseFilter || {};
    const pfPhase = _el('pf-phase');
    if (pfPhase) {
      pfPhase.textContent = (pf.phase || '—') + (pf.allow ? '' : ' ✘');
      const pfMap = { 'TREND': 'good', 'EXPANSION': 'good', 'RANGE': '', 'SQUEEZE': 'warn', 'CHAOS': 'bad', 'LIQ_EVENT': 'bad' };
      _cls(pfPhase, pfMap[pf.phase] || '');
    }
    const pfRisk = _el('pf-risk');
    if (pfRisk) {
      pfRisk.textContent = (pf.riskMode || '—');
      _cls(pfRisk, pf.riskMode === 'normal' ? 'good' : pf.riskMode === 'reduced' ? 'warn' : 'bad');
    }
    const pfSize = _el('pf-size');
    if (pfSize) {
      pfSize.textContent = (pf.sizeMultiplier != null ? '×' + pf.sizeMultiplier : '—');
      _cls(pfSize, pf.sizeMultiplier >= 1 ? 'good' : pf.sizeMultiplier >= 0.6 ? 'warn' : 'bad');
    }
    // Condensed bar pill for RE
    const reBarPill = _el('mtf-bar-re');
    if (reBarPill) {
      reBarPill.textContent = (re.regime || '—');
      reBarPill.className = 'mtf-bar-pill' + (re.regime === 'TREND_UP' || re.regime === 'EXPANSION' ? ' bull' : re.regime === 'CHAOS' || re.regime === 'LIQUIDATION_EVENT' ? ' bear' : '');
    }

    // ── Update bara condensată (vizibilă când strip-ul e ÎNCHIS) ──
    const brRegime = _el('mtf-bar-regime');
    if (brRegime) {
      brRegime.textContent = (st.regime || '—').toUpperCase();
      brRegime.className = 'mtf-bar-pill' + (st.regime === 'trend' || st.regime === 'breakout' ? ' bull' : st.regime === 'panic' || st.regime === 'volatile' ? ' bear' : '');
    }
    const brScore = _el('mtf-bar-score');
    if (brScore) brScore.textContent = (st.score || 0) + '/100';
    const brVol = _el('mtf-bar-vol');
    if (brVol) brVol.textContent = (BM.volRegime || '—');
    const brSqz = _el('mtf-bar-squeeze');
    if (brSqz) { brSqz.style.display = st.squeeze ? '' : 'none'; }

  } catch (e) {
    console.warn('[MTF] renderMTFPanel error:', e.message);
  }
}

// ── _coreTickMI() — CoreTick unificat pentru Market Intelligence (v89) ──
// Rulează la 10s când panoul MTF e deschis.
// LiqCycle e mai costisitor → se execută max 1x/60s via sub-timer intern.
// ── refreshLiqCycleLight() — recalc magnet distances la fiecare tick (5s), fără heavy scan ──
// Folosește S.magnets.above/below (arrays cu .price) setate de scanLiquidityMagnets (60s).
function refreshLiqCycleLight() {
  try {
    const p = (BM && Number.isFinite(BM.lastPrice)) ? BM.lastPrice
      : (S && Number.isFinite(S.lastPrice)) ? S.lastPrice
        : (S && Number.isFinite(S.price)) ? S.price
          : null;
    if (!Number.isFinite(p) || p <= 0) return;
    if (!BM.liqCycle) BM.liqCycle = {};
    const lc = BM.liqCycle;
    const magnets = (S && S.magnets) ? S.magnets : { above: [], below: [] };
    const nearAbove = magnets.above?.[0];
    const nearBelow = magnets.below?.[0];
    lc.magnetAboveDist = (nearAbove && nearAbove.price)
      ? Math.round(((nearAbove.price - p) / p) * 10000) / 100
      : null;
    lc.magnetBelowDist = (nearBelow && nearBelow.price)
      ? Math.round(((p - nearBelow.price) / p) * 10000) / 100
      : null;
    if (lc.magnetAboveDist != null && lc.magnetBelowDist != null) {
      lc.magnetBias = lc.magnetAboveDist < lc.magnetBelowDist ? 'above' : 'below';
    } else if (lc.magnetAboveDist != null) {
      lc.magnetBias = 'above';
    } else if (lc.magnetBelowDist != null) {
      lc.magnetBias = 'below';
    } else {
      lc.magnetBias = '—';
    }
  } catch (e) { /* silent — nu rupe core loop */ }
}

// ── detectSweepSimple() — sweep detector simplu pe bars (FIX B) ──
function detectSweepSimple(bars, lookback) {
  lookback = lookback || 20;
  try {
    if (!bars || bars.length < lookback + 2) return { dir: '—', strength: 0 };
    const slice = bars.slice(-(lookback + 1), -1);
    const prevHigh = Math.max.apply(null, slice.map(function (b) { return b.high; }));
    const prevLow = Math.min.apply(null, slice.map(function (b) { return b.low; }));
    const last = bars[bars.length - 1];
    var dir = '—';
    if (last.high > prevHigh && last.close < prevHigh) dir = 'BEAR';
    else if (last.low < prevLow && last.close > prevLow) dir = 'BULL';
    const rng = Math.max(1e-9, last.high - last.low);
    const wick = (dir === 'BEAR') ? Math.max(0, last.high - prevHigh)
      : (dir === 'BULL') ? Math.max(0, prevLow - last.low)
        : 0;
    const strength = dir === '—' ? 0 : Math.max(0, Math.min(100, Math.round((wick / rng) * 100)));
    return { dir: dir, strength: strength };
  } catch (e) { return { dir: '—', strength: 0 }; }
}

// ── refreshSweepLight() — recalc sweep pe fiecare tick, update BM.liqCycle ──
function refreshSweepLight() {
  try {
    if (!BM.liqCycle) BM.liqCycle = {};
    const bars = (S && S.klines && S.klines.length > 22) ? S.klines.slice(-100) : null;
    const sw = bars ? detectSweepSimple(bars, 20) : { dir: '—', strength: 0 };
    BM.liqCycle.sweepSimple = sw;
    // Sincronizăm cu câmpurile existente folosite de renderMTFPanel
    if (sw.dir === 'BEAR') {
      BM.liqCycle.currentSweep = 'below';
      BM.liqCycle.sweepDisplacement = true;
    } else if (sw.dir === 'BULL') {
      BM.liqCycle.currentSweep = 'above';
      BM.liqCycle.sweepDisplacement = true;
    } else {
      BM.liqCycle.currentSweep = 'none';
      BM.liqCycle.sweepDisplacement = false;
    }
  } catch (e) { /* silent */ }
}

// NU apelați buildMTFStructure/updateLiqCycle/renderMTFPanel din alte intervale MI.
function _coreTickMI() {
  try {
    BM.core.ticks++;
    // 1. MTF Structure + Vol Regime (light, 10s)
    buildMTFStructure();
    // 2. Liq Cycle (heavy, max 1x/60s)
    const now = Date.now();
    if (now - BM.core.lastLiqTs >= 60000) {
      updateLiqCycle();
      BM.core.lastLiqTs = now;
    }
    // 2b. Regime Engine (adapter layer, light)
    if (typeof RegimeEngine !== 'undefined') {
      BM.regimeEngine = RegimeEngine.compute();
    }
    // 2c. Phase Filter (analysis-only, consumes RegimeEngine output)
    if (typeof PhaseFilter !== 'undefined') {
      BM.phaseFilter = PhaseFilter.evaluate(BM.regimeEngine);
    }
    // 2d. Market Atmosphere (aggregator, consumes all existing signals)
    if (typeof computeMarketAtmosphere === 'function') {
      computeMarketAtmosphere();
    }
    // 3. Recalc magnet distances + sweep cu prețul curent (light, fiecare tick 5s)
    refreshLiqCycleLight();
    refreshSweepLight();
    // 4. Render panel o singură dată la final
    renderMTFPanel();
    // 4. [v108] ARES visual refresh — light, doar dacă panoul e deschis
    if (typeof ARES !== 'undefined' && document.getElementById('ares-strip')?.classList.contains('open')) {
      _aresRender();
    }
  } catch (e) {
    console.warn('[CORE] _coreTickMI error:', e.message);
  }
}

// [v119-p6 FIX3] ZT_capArr — universal memory cap helper
function ZT_capArr(arr, max) {
  try {
    if (!arr || !arr.length || !Number.isFinite(max) || max <= 0) return;
    if (arr.length > max) arr.splice(0, arr.length - max);
  } catch (_) { }
}

// [v119-p6 FIX2] ZT_safeInterval — wraps interval callbacks; self-heals after 3 errors
function ZT_safeInterval(name, fn, ms) {
  try {
    if (!window.__ZT_INT_ERR__) window.__ZT_INT_ERR__ = {};
    var wrap = function () {
      try { fn(); }
      catch (e) {
        window.__ZT_INT_ERR__[name] = (window.__ZT_INT_ERR__[name] || 0) + 1;
        console.warn('[ZT interval error]', name, e && e.message ? e.message : e);
        if (window.__ZT_INT_ERR__[name] === 3) {
          try { if (window.Intervals && Intervals.clear) Intervals.clear(name); } catch (_) { }
          try {
            if (window.Intervals && Intervals.set) Intervals.set(name, wrap, ms);
            else setInterval(wrap, ms);
          } catch (_) { }
        }
      }
    };
    return wrap;
  } catch (_) { return fn; }
}

// ── _safeCoreTickMI() — safe wrapper (guard dacă _coreTickMI nu e încă definit) ──
function _safeCoreTickMI() {
  try {
    if (typeof _coreTickMI === 'function') _coreTickMI();
  } catch (e) {
    console.warn('[MTF] _coreTickMI error', e);
  }
  if (typeof computePredatorState === 'function') { computePredatorState(); }
}

// ── mtfStripToggle() — open/close + interval gating ──
function mtfStripToggle() {
  const strip = document.getElementById('mtf-strip');
  if (!strip) return;

  const isOpen = strip.classList.toggle('mtf-open');
  // Sync chevron
  const chev = document.getElementById('mtf-strip-chev');
  if (chev) chev.style.transform = isOpen ? 'rotate(180deg)' : '';

  // CoreTick gating: un singur interval activ, anti-duplicate guard
  if (isOpen) {
    BM.core.mtfOn = true;
    // Render imediat la deschidere
    buildMTFStructure();
    updateLiqCycle();
    BM.core.lastLiqTs = Date.now();
    renderMTFPanel();
    // Anti-duplicate: clear întotdeauna înainte de set
    Intervals.clear('coreMI');
    _safeCoreTickMI();                                    // refresh imediat la deschidere
    Intervals.set('coreMI', ZT_safeInterval('coreMI', _safeCoreTickMI, 5000), 5000); // [v119-p6 FIX2A]
    // Retry arm: dacă _coreTickMI nu era gata, re-armăm după 2s
    setTimeout(function () { if (BM.core.mtfOn) { _safeCoreTickMI(); Intervals.set('coreMI', ZT_safeInterval('coreMI', _safeCoreTickMI, 5000), 5000); } }, 2000);
    console.log('[CORE] coreMI started | ticks:', BM.core.ticks);
  } else {
    // coreMI ramane activ — calcul in background chiar si cu panoul inchis
    console.log('[CORE] MTF panel closed — coreMI stays active | ticks:', BM.core.ticks);
  }

  // Persistență UI
  try { localStorage.setItem('zeus_mtf_open', isOpen ? '1' : '0'); } catch (_) { }
}

// ── initMTFStrip() — restaurează starea panoului la boot ──
function initMTFStrip() {
  try {
    if (localStorage.getItem('zeus_mtf_open') === '1') {
      const strip = document.getElementById('mtf-strip');
      if (strip) {
        strip.classList.add('mtf-open');
        const chev = document.getElementById('mtf-strip-chev');
        if (chev) chev.style.transform = 'rotate(180deg)';
        // Delay la boot să nu blocheze render-ul inițial
        setTimeout(function () {
          try {
            BM.core.mtfOn = true;
            buildMTFStructure();
            updateLiqCycle();
            BM.core.lastLiqTs = Date.now();
            renderMTFPanel();
            // Anti-duplicate guard înainte de set
            Intervals.clear('coreMI');
            _safeCoreTickMI();                                    // refresh imediat la restore
            Intervals.set('coreMI', ZT_safeInterval('coreMI', _safeCoreTickMI, 5000), 5000); // [v119-p6 FIX2A]
            // Retry arm după boot delay
            setTimeout(function () { if (BM.core.mtfOn) { _safeCoreTickMI(); Intervals.set('coreMI', ZT_safeInterval('coreMI', _safeCoreTickMI, 5000), 5000); } }, 2000);
            console.log('[CORE] coreMI started (restore) | ticks:', BM.core.ticks);
          } catch (e) {
            console.warn('[CORE] initMTFStrip restore error:', e.message);
          }
        }, 1500);
      }
    } else {
      // coreMI ruleaza MEREU — calculeaza MTF/Regime/Phase in background
      setTimeout(function () {
        try {
          BM.core.mtfOn = true;
          buildMTFStructure();
          updateLiqCycle();
          BM.core.lastLiqTs = Date.now();
          Intervals.clear('coreMI');
          _safeCoreTickMI();
          Intervals.set('coreMI', ZT_safeInterval('coreMI', _safeCoreTickMI, 5000), 5000);
          console.log('[CORE] coreMI started (always-on) | ticks:', BM.core.ticks);
        } catch (e) {
          console.warn('[CORE] initMTFStrip always-on error:', e.message);
        }
      }, 1500);
    }
  } catch (e) {
    console.warn('[MTF] initMTFStrip error:', e.message);
  }
}

// User Settings (L1464-L1671)
const USER_SETTINGS = {
  _version: 1,          // pentru migraţii viitoare
  chart: {
    tf: '5m',
    tz: 'Europe/Bucharest',
    heatmap: null,      // se populează din S.heatmapSettings la save
    colors: null,       // culorile chart: bull/bear/wick/priceBg/priceText
  },
  indicators: null,     // { ema:true, wma:true, ... } — sync cu S.activeInds
  alerts: null,         // sync cu S.alerts
  profile: 'fast',      // S.profile — fast/swing/defensive
  bmMode: null,         // BM.mode
  // [B2] runMode REMOVED — AT.enabled is sole command
  assistArmed: false,   // S.assistArmed — DSL arm state
  autoTrade: {
    lev: 5,
    sl: 1.5,
    rr: 2,
    size: 200,
    maxPos: 4,
    killPct: 5,
    confMin: 65,
    sigMin: 3,
    multiSym: true,
    smartExitEnabled: false,  // Quantum Exit Brain — auto-exec OFF by default
  },
};

// ── Debounce timer pentru salvare ────────────────────────────────
let _usSettingsTimer = null;
function _usScheduleSave() {
  if (_usSettingsTimer) clearTimeout(_usSettingsTimer);
  _usSettingsTimer = setTimeout(_usSave, 800);
}
// Flush pending saves immediately (called on beforeunload / visibilitychange)
function _usFlush() {
  if (_usSettingsTimer) { clearTimeout(_usSettingsTimer); _usSettingsTimer = null; _usSave(); }
  // Execute the server push instead of just canceling it
  if (_ucPushTimer) { clearTimeout(_ucPushTimer); _ucPushTimer = null; _ucPushBeacon(); }
}
// Reliable sync push via sendBeacon (works during beforeunload)
// [C6] Saves payload to LS before sending — on next boot, verifies delivery
var _UC_BEACON_PENDING_KEY = 'zeus_uc_beacon_pending';
function _ucPushBeacon() {
  try {
    var payload = JSON.stringify({
      _v: _ucVersion,
      ts: Date.now(),
      sections: _buildAllSections()
    });
    // [C6] Save to LS before sending — if beacon fails (offline), next boot will re-push
    try { localStorage.setItem(_UC_BEACON_PENDING_KEY, payload); } catch (_) { }
    if (navigator.sendBeacon) {
      var sent = navigator.sendBeacon('/api/sync/user-context', new Blob([payload], { type: 'application/json' }));
      if (sent) {
        try { localStorage.removeItem(_UC_BEACON_PENDING_KEY); } catch (_) { }
        console.log('[UC] beacon pushed (all sections)');
      } else {
        console.warn('[UC] sendBeacon returned false — payload saved in LS for retry');
      }
    } else {
      // fallback: fire-and-forget fetch
      fetch('/api/sync/user-context', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: payload, credentials: 'same-origin', keepalive: true })
        .then(function () { try { localStorage.removeItem(_UC_BEACON_PENDING_KEY); } catch (_) { } })
        .catch(function () { /* LS pending will be retried on next boot */ });
    }
  } catch (_) { }
}
// [C6] On boot, check for unsent beacon payload and re-push
function _ucRetryPendingBeacon() {
  try {
    var pending = localStorage.getItem(_UC_BEACON_PENDING_KEY);
    if (!pending) return;
    var parsed = JSON.parse(pending);
    // Only retry if payload is < 5 min old (avoid pushing ancient state)
    if (parsed.ts && (Date.now() - parsed.ts) > 300000) {
      localStorage.removeItem(_UC_BEACON_PENDING_KEY);
      console.log('[UC] Discarded stale pending beacon (>5min old)');
      return;
    }
    console.log('[UC] Retrying unsent beacon from previous session...');
    fetch('/api/sync/user-context', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: pending, credentials: 'same-origin' })
      .then(function (r) { if (r.ok) { localStorage.removeItem(_UC_BEACON_PENDING_KEY); console.log('[UC] Pending beacon re-sent successfully'); } })
      .catch(function () { console.warn('[UC] Pending beacon retry failed — will retry next boot'); });
  } catch (_) { localStorage.removeItem(_UC_BEACON_PENDING_KEY); }
}
window._usFlush = _usFlush;

// Guard: skip saves before _usApply() has run (prevents baking HTML defaults)
let _usApplyDone = false;

// ── Colectează valorile curente şi scrie în localStorage ─────────
function _usSave() {
  if (!_usApplyDone) { console.log('[US] skip save — _usApply not yet run'); return; }
  try {
    // Chart
    USER_SETTINGS.chart.tf = S.chartTf || '5m';
    USER_SETTINGS.chart.tz = S.tz || 'Europe/Bucharest';
    USER_SETTINGS.chart.heatmap = S.heatmapSettings
      ? Object.assign({}, S.heatmapSettings) : null;

    // Chart colors — citim din DOM (input color)
    const _cv = (id, def) => { const e = document.getElementById(id); return (e && e.value) ? e.value : def; };
    USER_SETTINGS.chart.colors = {
      bull: _cv('ccBull', '#00d97a'),
      bear: _cv('ccBear', '#ff3355'),
      bullW: _cv('ccBullW', '#00d97a'),
      bearW: _cv('ccBearW', '#ff3355'),
      priceText: _cv('ccPriceText', '#7a9ab8'),
      priceBg: _cv('ccPriceBg', '#0a0f16'),
    };

    // Indicators — copie din S.activeInds
    USER_SETTINGS.indicators = Object.assign({}, S.activeInds);

    // Alerts — copie din S.alerts
    USER_SETTINGS.alerts = Object.assign({}, S.alerts);

    // Profile + BM mode
    USER_SETTINGS.profile = S.profile || 'fast';
    USER_SETTINGS.bmMode = (typeof BM !== 'undefined' ? BM.mode : null) || null;
    // [B2] runMode REMOVED — AT.enabled is sole command
    USER_SETTINGS.assistArmed = !!S.assistArmed;

    // Auto-trade — citeşte direct din DOM (valorile live)
    const _iv = (id, def) => {
      const el = document.getElementById(id);
      return el ? (parseFloat(el.value) || def) : def;
    };
    USER_SETTINGS.autoTrade = {
      lev: parseInt(document.getElementById('atLev')?.value) || 5,
      sl: _iv('atSL', 1.5),
      rr: _iv('atRR', 2),
      size: _iv('atSize', 200),
      maxPos: parseInt(document.getElementById('atMaxPos')?.value) || 4,
      killPct: _iv('atKillPct', 5),
      riskPct: _iv('atRiskPct', 1),
      maxDay: parseInt(document.getElementById('atMaxDay')?.value) || 5,
      lossStreak: parseInt(document.getElementById('atLossStreak')?.value) || 3,
      maxAddon: parseInt(document.getElementById('atMaxAddon')?.value) || 2,
      confMin: _iv('atConfMin', 65),
      sigMin: parseInt(document.getElementById('atSigMin')?.value) || 3,
      multiSym: document.getElementById('atMultiSym')?.checked !== false,
      smartExitEnabled: document.getElementById('atSmartExit')?.checked === true,
      adaptEnabled: (typeof BM !== 'undefined' && BM.adapt) ? !!BM.adapt.enabled : false,
      adaptLive: (typeof BM !== 'undefined' && BM.adapt) ? !!BM.adapt.allowLiveAdjust : false,
    };

    // [LIVE-PERSIST] Manual trade params — live panel
    USER_SETTINGS.manualLive = {
      size: _iv('liveSize', null),
      sl: _iv('liveSL', null),
      tp: _iv('liveTP', null),
    };

    // [LEV-PERSIST] PT leverage + margin mode per panel
    USER_SETTINGS.ptLevDemo = (typeof getDemoLev === 'function') ? getDemoLev() : null;
    USER_SETTINGS.ptLevLive = (typeof getLiveLev === 'function') ? getLiveLev() : null;
    var _dmm = document.getElementById('demoMarginMode');
    if (_dmm) USER_SETTINGS.ptMarginMode = _dmm.value;

    USER_SETTINGS._syncTs = Date.now();
    localStorage.setItem('zeus_user_settings', JSON.stringify(USER_SETTINGS));
    _ucMarkDirty('settings');
    console.log('[US] Settings saved');
    // Cross-device push — piggyback on existing save trigger
    if (typeof _userCtxPush === 'function') _userCtxPush();
  } catch (e) {
    console.warn('[US] Save failed:', e.message);
  }
}

// ── Aplică setările restaurate în DOM şi în stările globale ──────
function _usApply() {
  try {
    _usApplyDone = true; // allow saves from this point
    // Chart TF — apelăm funcţia existentă fără efecte secundare
    if (USER_SETTINGS.chart.tf && USER_SETTINGS.chart.tf !== S.chartTf) {
      S.chartTf = USER_SETTINGS.chart.tf;  // setat direct; setTF() se apelează mai târziu în boot
      // Activăm butonul corect în bara TF
      document.querySelectorAll('.tfb').forEach(b => {
        if (b.textContent && b.textContent.trim() === USER_SETTINGS.chart.tf) {
          b.classList.add('act');
        } else {
          b.classList.remove('act');
        }
      });
    }

    // Timezone
    if (USER_SETTINGS.chart.tz) {
      S.tz = USER_SETTINGS.chart.tz;
    }

    // Heatmap settings
    if (USER_SETTINGS.chart.heatmap) {
      Object.assign(S.heatmapSettings, USER_SETTINGS.chart.heatmap);
    }

    // Chart colors — setăm input-urile din DOM și stocăm în S pentru aplicare după init chart
    if (USER_SETTINGS.chart.colors) {
      const c = USER_SETTINGS.chart.colors;
      const _si = (id, val) => { const e = document.getElementById(id); if (e && val) e.value = val; };
      _si('ccBull', c.bull);
      _si('ccBear', c.bear);
      _si('ccBullW', c.bullW);
      _si('ccBearW', c.bearW);
      _si('ccPriceText', c.priceText);
      _si('ccPriceBg', c.priceBg);
      // Stocăm și în S pentru a fi aplicat după ce cSeries e creat
      S._savedChartColors = c;
      // Dacă cSeries există deja (boot tardiv), aplicăm direct
      if (typeof cSeries !== 'undefined' && cSeries) {
        cSeries.applyOptions({ upColor: c.bull, downColor: c.bear, borderUpColor: c.bull, borderDownColor: c.bear, wickUpColor: (c.bullW || c.bull) + '77', wickDownColor: (c.bearW || c.bear) + '77' });
      }
      if (typeof mainChart !== 'undefined' && mainChart) {
        mainChart.applyOptions({ layout: { background: { color: c.priceBg || '#0a0f16' }, textColor: c.priceText || '#7a9ab8' }, rightPriceScale: { textColor: c.priceText || '#7a9ab8' } });
      }
    }

    // Indicators — sync BOTH dicts so renderChart() and _indRenderHook() agree
    if (USER_SETTINGS.indicators) {
      Object.assign(S.activeInds, USER_SETTINGS.indicators);
      Object.assign(S.indicators, USER_SETTINGS.indicators);
    }

    // Profile — setăm S.profile și activăm butonul corect
    if (USER_SETTINGS.profile) {
      S.profile = USER_SETTINGS.profile;
      // Activăm butonul de profil corect în UI (dacă există deja în DOM)
      const _profBtn = document.getElementById('prof-' + S.profile);
      if (_profBtn && typeof setProfile === 'function') {
        // Nu apelăm setProfile() direct (ar putea trigera brain) — doar UI
        document.querySelectorAll('.znc-pbtn').forEach(b => b.className = 'znc-pbtn');
        _profBtn.classList.add('act-' + S.profile);
      }
    }

    // Alerts
    if (USER_SETTINGS.alerts) {
      Object.assign(S.alerts, USER_SETTINGS.alerts);
    }

    // [B2] runMode REMOVED — AT.enabled is sole command
    // DSL Assist Armed
    if (USER_SETTINGS.assistArmed) {
      S.assistArmed = true;
      if (typeof ARM_ASSIST !== 'undefined') { ARM_ASSIST.armed = true; ARM_ASSIST.ts = Date.now(); }
    }

    // Auto-trade inputs — setăm valorile în DOM
    const _setInp = (id, val) => {
      const el = document.getElementById(id);
      if (el) el.value = val;
    };
    const at = USER_SETTINGS.autoTrade;
    // AT.enabled/mode now synced exclusively via ZState (single source of truth)
    if (typeof AT !== 'undefined') {
      var _atModeEl = document.getElementById('atMode');
      if (_atModeEl && AT.mode) _atModeEl.value = AT.mode;
    }
    _setInp('atLev', at.lev);
    _setInp('atSL', at.sl);
    _setInp('atRR', at.rr);
    _setInp('atSize', at.size);
    _setInp('atMaxPos', at.maxPos);
    _setInp('atKillPct', at.killPct);
    if (at.riskPct) _setInp('atRiskPct', at.riskPct);
    if (at.maxDay) _setInp('atMaxDay', at.maxDay);
    if (at.lossStreak) _setInp('atLossStreak', at.lossStreak);
    if (at.maxAddon !== undefined) _setInp('atMaxAddon', at.maxAddon);
    _setInp('atConfMin', at.confMin);
    // [FIX v85.1 F2] Sync BM.confMin la restaurare settings
    if (typeof BM !== 'undefined' && at.confMin) BM.confMin = parseFloat(at.confMin) || 65;
    _setInp('atSigMin', at.sigMin);
    const multiChk = document.getElementById('atMultiSym');
    if (multiChk) {
      multiChk.checked = at.multiSym;
      // Actualizăm şi label-ul via _mscanUpdateLabel
      if (typeof _mscanUpdateLabel === 'function') _mscanUpdateLabel();
      else {
        const lbl = document.getElementById('atMultiSymLbl');
        if (lbl) lbl.textContent = at.multiSym ? 'ACTIV' : 'DEZACTIVAT';
      }
    }

    // Restore 3 advanced toggles
    if (typeof BM !== 'undefined' && BM.adapt) {
      if (at.adaptEnabled !== undefined) BM.adapt.enabled = !!at.adaptEnabled;
      if (at.adaptLive !== undefined) BM.adapt.allowLiveAdjust = !!at.adaptLive;
    }
    const _atAdaptEl = document.getElementById('atAdaptEnabled');
    if (_atAdaptEl) _atAdaptEl.checked = BM.adapt && BM.adapt.enabled === true;
    const _atAdaptLiveEl = document.getElementById('atAdaptLive');
    if (_atAdaptLiveEl) _atAdaptLiveEl.checked = BM.adapt && BM.adapt.allowLiveAdjust === true;
    const _atSmartExitEl = document.getElementById('atSmartExit');
    if (_atSmartExitEl) _atSmartExitEl.checked = at.smartExitEnabled === true;

    // [LIVE-PERSIST] Restore manual live trade params into DOM
    if (USER_SETTINGS.manualLive) {
      const ml = USER_SETTINGS.manualLive;
      if (ml.size != null) _setInp('liveSize', ml.size);
      if (ml.sl != null) _setInp('liveSL', ml.sl);
      if (ml.tp != null) _setInp('liveTP', ml.tp);
    }

    console.log('[US] Settings applied');
  } catch (e) {
    console.warn('[US] Apply failed:', e.message);
  }
}

// ── Settings migration registry ──────────────────────────────────
// Fiecare funcţie primeşte obiectul parsed şi îl transformă in-place.
// Convenţie: migraţia N actualizează de la versiunea N-1 → N.
const _SETTINGS_MIGRATIONS = {
  // 2: function(s) { /* exemplu: s.chart.newField = s.chart.oldField; delete s.chart.oldField; */ },
};
const _CURRENT_SETTINGS_VERSION = 1;

function _migrateSettings(parsed) {
  let v = parsed._version || 0;
  while (v < _CURRENT_SETTINGS_VERSION) {
    v++;
    if (_SETTINGS_MIGRATIONS[v]) {
      try { _SETTINGS_MIGRATIONS[v](parsed); console.log('[US] migrated →', v); }
      catch (e) { console.warn('[US] migration', v, 'failed:', e.message); break; }
    }
  }
  parsed._version = _CURRENT_SETTINGS_VERSION;
}

// ── Încarcă setările din localStorage şi le aplică ───────────────
function loadUserSettings() {
  try {
    const raw = localStorage.getItem('zeus_user_settings');
    if (!raw) return;
    const parsed = JSON.parse(raw);
    // Aplică migraţii dacă versiunea e mai veche
    if ((parsed._version || 0) < _CURRENT_SETTINGS_VERSION) {
      _migrateSettings(parsed);
      localStorage.setItem('zeus_user_settings', JSON.stringify(parsed));
      console.log('[US] settings migrated & saved');
    }
    // Merge recursiv superficial (nu suprascrie chei lipsă)
    if (parsed.chart) Object.assign(USER_SETTINGS.chart, parsed.chart);
    if (parsed.indicators) USER_SETTINGS.indicators = parsed.indicators;
    if (parsed.alerts) USER_SETTINGS.alerts = parsed.alerts;
    if (parsed.autoTrade) Object.assign(USER_SETTINGS.autoTrade, parsed.autoTrade);
    if (parsed.profile) USER_SETTINGS.profile = parsed.profile;
    if (parsed.bmMode) USER_SETTINGS.bmMode = parsed.bmMode;
    // [B2] runMode REMOVED — AT.enabled is sole command
    if (typeof parsed.assistArmed === 'boolean') USER_SETTINGS.assistArmed = parsed.assistArmed;
    // [LEV-PERSIST] Restore PT leverage + margin mode
    if (parsed.ptMarginMode) {
      var _mmSel = document.getElementById('demoMarginMode');
      if (_mmSel && (parsed.ptMarginMode === 'cross' || parsed.ptMarginMode === 'isolated')) {
        _mmSel.value = parsed.ptMarginMode;
      }
    }
    if (parsed.ptLevDemo) {
      var _dls = document.getElementById('demoLev');
      if (_dls) {
        var _found = Array.from(_dls.options).some(function(o) { return o.value === String(parsed.ptLevDemo); });
        if (_found) { _dls.value = String(parsed.ptLevDemo); }
        else { _dls.value = 'custom'; var _dcl = document.getElementById('demoCustomLev'); if (_dcl) _dcl.value = parsed.ptLevDemo; var _dcr = document.getElementById('demoCustomLevRow'); if (_dcr) _dcr.style.display = 'flex'; }
      }
    }
    if (parsed.ptLevLive) {
      var _lls = document.getElementById('liveLev');
      if (_lls) {
        var _foundL = Array.from(_lls.options).some(function(o) { return o.value === String(parsed.ptLevLive); });
        if (_foundL) { _lls.value = String(parsed.ptLevLive); }
        else { _lls.value = 'custom'; var _lcl = document.getElementById('liveCustomLev'); if (_lcl) _lcl.value = parsed.ptLevLive; var _lcr = document.getElementById('liveCustomLevRow'); if (_lcr) _lcr.style.display = 'flex'; }
      }
    }
    // [LIVE-PERSIST] Restore manual live trade params
    if (parsed.manualLive) {
      USER_SETTINGS.manualLive = parsed.manualLive;
    }
    _usApply();
    console.log('[US] Settings loaded from localStorage');
  } catch (e) {
    console.warn('[US] Load failed:', e.message);
  }
}

// Chart overlay state
let vwapSeries = [];
let oviSeries = [];   // all LightweightCharts series for pockets
let oviPriceSeries = []; // price label series
const BT = { running: false, results: null };
const BT_INDICATORS = [
  { id: 'rsi_ob', name: 'RSI >70 (OB)', ico: _ZI.bolt, color: '#f5c842' },
  { id: 'rsi_os', name: 'RSI <30 (OS)', ico: _ZI.bolt, color: '#f5c842' },
  { id: 'macd_cross', name: 'MACD Cross ↑', ico: _ZI.chart, color: '#00e5ff' },
  { id: 'macd_under', name: 'MACD Cross ↓', ico: _ZI.chart, color: '#00e5ff' },
  { id: 'st_bull', name: 'SuperTrend ↑', ico: _ZI.dia, color: '#ff8800' },
  { id: 'st_bear', name: 'SuperTrend ↓', ico: _ZI.dia, color: '#ff8800' },
  { id: 'ema_cross', name: 'EMA50>EMA200', ico: _ZI.tup, color: '#f0c040' },
  { id: 'vol_spike', name: 'Volume Spike', ico: _ZI.chart, color: '#00b8d4' },
  { id: 'confluence_bull', name: 'Confluence ≥65', ico: _ZI.tgt, color: '#aa44ff' },
];
const DSL = {
  enabled: true,
  mode: null,              // [DSL MODE] null=not set, 'atr'|'fast'|'swing'|'defensive'|'tp'
  magnetEnabled: false,  // [DSL MAGNET] global default — per-position via pos.dslParams.magnetEnabled
  magnetMode: 'soft',    // [DSL MAGNET] only 'soft' implemented; 'hard' reserved for future
  positions: {},      // posId -> { active, currentSL, highWater, tpExtended, log[] }
  checkInterval: null,
  _attachedIds: new Set(),  // dedupe: prevent double-attach per position id
};
const MSCAN_SYMS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT', 'DOGEUSDT', 'ADAUSDT', 'ZECUSDT'];
const MSCAN = {
  data: {},        // per symbol: { price, chg, rsi, macd, st, adx, score, dir, signal }
  wsPool: {},      // kline websockets per symbol
  lastScan: 0,
  scanning: false,
};

// Day/Hour Filter
const DHF = {
  days: {
    Sun: { wr: 57, trades: 0, wins: 0 },
    Mon: { wr: 72, trades: 0, wins: 0 },
    Tue: { wr: 63, trades: 0, wins: 0 },
    Wed: { wr: 68, trades: 0, wins: 0 },
    Thu: { wr: 61, trades: 0, wins: 0 },
    Fri: { wr: 64, trades: 0, wins: 0 },
    Sat: { wr: 55, trades: 0, wins: 0 },
  },
  hours: {}, // 0-23 UTC -> {wr, trades, wins}
};
// Initialize hour stats with research-based priors
(function initHourPriors() {
  const priors = [
    64, 29, 75, 69, 89, 88, 90, 50, 29, 55, 60, 58,
    62, 58, 56, 60, 64, 66, 68, 63, 57, 55, 60, 62
  ];
  for (let h = 0; h < 24; h++) {
    DHF.hours[h] = { wr: priors[h] || 60, trades: 0, wins: 0 };
  }
})();

// Performance tracker — extended with pnlSum, feeSum, winPnl, lossPnl for analytics
const PERF = {
  rsi: { wins: 0, losses: 0, weight: 1.0, pnlSum: 0, feeSum: 0, winPnl: 0, lossPnl: 0 },
  macd: { wins: 0, losses: 0, weight: 1.0, pnlSum: 0, feeSum: 0, winPnl: 0, lossPnl: 0 },
  supertrend: { wins: 0, losses: 0, weight: 1.0, pnlSum: 0, feeSum: 0, winPnl: 0, lossPnl: 0 },
  volume: { wins: 0, losses: 0, weight: 0.8, pnlSum: 0, feeSum: 0, winPnl: 0, lossPnl: 0 },
  funding: { wins: 0, losses: 0, weight: 0.8, pnlSum: 0, feeSum: 0, winPnl: 0, lossPnl: 0 },
  adx: { wins: 0, losses: 0, weight: 0.9, pnlSum: 0, feeSum: 0, winPnl: 0, lossPnl: 0 },
  confluence: { wins: 0, losses: 0, weight: 1.2, pnlSum: 0, feeSum: 0, winPnl: 0, lossPnl: 0 },
};

// Daily PnL analytics store — aggregated from TP.journal
const DAILY_STATS = {
  days: {},       // 'YYYY-MM-DD' → { trades,wins,losses,grossPnl,fees,netPnl }
  peak: 0,        // peak cumulative equity for drawdown calc
  currentDD: 0,   // current drawdown from peak ($)
  maxDD: 0,       // worst drawdown ever ($)
  cumPnl: 0,      // cumulative net PnL across all days
};
window.DAILY_STATS = DAILY_STATS;
const BEXT = {
  priceHistory: {}, // sym -> last 14 prices for mini sparkline bars
  tickerItems: [],
};

const SESSION_HOURS_BT = {
  asia: { start: 0, end: 8 },
  london: { start: 8, end: 13 },
  ny: { start: 13, end: 21 }
};
let _sessLastBt = { ts: 0 };
const SESS_CFG = {
  asia: { label: 'ASIA', col: '#f0c040', h: { start: 0, end: 8 } },
  london: { label: 'LON', col: '#4488ff', h: { start: 8, end: 13 } },
  ny: { label: 'NY', col: '#00ff88', h: { start: 13, end: 21 } }
};

// Brain & BM state
const BRAIN = {
  state: 'scanning',   // scanning | analyzing | ready | blocked | trading
  score: 0,
  regime: 'unknown',
  thoughts: [],
  neurons: {},
  ofi: { buy: 0, sell: 0, blendBuy: 50, tape: [] },
  tickerQueue: [],
  tickerInterval: null,
  adaptParams: { sl: 1.5, tp: 3.0, size: 200, adjustCount: 0 },
};
const BM = {
  mode: 'assist',      // 'assist' | 'auto'
  profile: 'fast',    // 'fast' | 'swing' | 'defensive'
  // [FIX v85.1 F2+F3] Sursă unică de adevăr — nu mai citim din DOM
  confluenceScore: 50, // scris de calcConfluenceScore(), citit de toți
  confMin: 65,         // scris când UI se schimbă, citit de toți
  // [B2] runMode REMOVED — AT.enabled is sole command
  applyToOpen: false,
  protectMode: false,
  protectReason: '',
  dailyTrades: 0,
  dailyPnL: 0,
  lossStreak: 0,
  // addonCount removed — per-position pos.addOnCount is authoritative [RISK RAILS]
  newsRisk: 'low',     // 'low' | 'med' | 'high'
  gates: {},
  entryScore: 0,
  entryReady: false,
  mtf: { '15m': 'neut', '1h': 'neut', '4h': 'neut' },
  sweep: { type: 'none', reclaim: false, displacement: false },
  flow: { cvd: 'neut', delta: 0, ofi: 'neut' },
  macroEvents: [
    // Add upcoming events manually: { name, time (ms) }
  ],
  // ── Quantum Exit Brain state (advisory-first, additive) ──────
  qexit: {
    risk: 0,
    signals: {
      divergence: { type: null, conf: 0 },
      climax: { dir: null, mult: 0 },
      regimeFlip: { from: null, to: null, conf: 0 },
      liquidity: { nearestAboveDistPct: null, nearestBelowDistPct: null, bias: 'neutral' },
    },
    action: 'HOLD',
    lastTs: 0,
    lastReason: '',
    shadowStop: null,
    confirm: { div: 0, climax: 0 },   // 2-bar confirm counters
  },
  // ── Probabilistic Confluence Score (additive) ────────────────
  probScore: 0,
  probBreakdown: { regime: 0, liquidity: 0, signals: 0, flow: 0 },
  // ── Adaptive Cycle Intelligence (Level 5) ───────────────────
  macro: {
    cycleScore: 0,      // 0..100
    sentimentScore: 0,      // 0..100
    flowScore: 0,      // 0..100
    composite: 0,      // 0..100 final
    slope: 0,      // -1..+1
    phase: 'NEUTRAL',
    confidence: 0,      // 0..100
    lastUpdate: 0,
  },
  adapt: {
    enabled: false,  // MASTER toggle — OFF by default
    allowLiveAdjust: false,  // if false: only UI/advisory
    exitMult: 1.0,   // QEB emergency threshold multiplier
    lastTs: 0,
    lastPhase: 'NEUTRAL',
  },
  positionSizing: {
    baseRiskPct: 1.0,
    regimeMult: 1.0,
    perfMult: 1.0,
    finalMult: 1.0,
  },
  // ── Regime Engine (adapter/normalizer, read-only) ─────────────
  regimeEngine: {
    regime: 'RANGE', confidence: 0, trendBias: 'neutral',
    volatilityState: 'normal', trapRisk: 0, notes: ['waiting'],
  },
  // ── Phase Filter (analysis-only, read-only) ──────────────────
  phaseFilter: {
    allow: false, phase: 'RANGE', reason: 'insufficient data',
    riskMode: 'reduced', sizeMultiplier: 0.5,
    allowedSetups: [], blockedSetups: [],
  },
  // ── Market Atmosphere Aggregator (pre-filter, read-only) ─────
  atmosphere: {
    category: 'neutral', allowEntry: true, cautionLevel: 'medium',
    confidence: 0, reasons: ['waiting for data'], sizeMultiplier: 1.0,
  },
  // ── Multi-TF Structural Model (Etapa 1, read-only) ───────────
  structure: {
    regime: 'unknown',
    adx: 0,
    atrPct: 0,
    squeeze: false,
    volMode: '—',
    structureLabel: '—',
    mtfAlign: { '15m': 'neut', '1h': 'neut', '4h': 'neut' },
    score: 0,      // alignmentScore 0–100
    lastUpdate: 0,
  },
  // ── Volatility Regime Clustering (Etapa 2, read-only) ────────
  volBuffer: [],           // ring buffer ATR% — max 200 valori
  volRegime: '—',          // LOW / MED / HIGH / EXTREME
  volPct: null,         // percentila curentă 0–100 față de buffer
  // ── Liquidity Cycle Tracking (Etapa 3, read-only) ─────────────
  liqCycle: {
    currentSweep: 'none',   // 'above' | 'below' | 'none'
    sweepDisplacement: false,
    trapRate: null,     // 0–1, null = date insuficiente
    trapsTotal: 0,        // sweeps false din ultimele 50
    sweepsTotal: 0,        // total sweeps din ultimele 50
    magnetAboveDist: null,     // % față de preț curent
    magnetBelowDist: null,
    magnetBias: '—',      // 'above' | 'below' | 'neut'
    lastUpdate: 0,
  },
  // ── Adaptive Shield — Market Danger Score (0-100) ────────────
  danger: 0,
  dangerBreakdown: { volatility: 0, spread: 0, liquidations: 0, volume: 0, funding: 0 },
  // ── Conviction Score (0-100) ──────────────────────────────────
  conviction: 0,
  convictionMult: 1.0,  // sizing multiplier derived from conviction+danger
  // ── CoreTick Scheduler State (Etapa 2 v89) ───────────────────
  core: {
    lastLiqTs: 0,    // timestamp ultima rulare updateLiqCycle
    mtfOn: false, // panoul MTF e deschis?
    ticks: 0,    // debug counter — crește la fiecare coreMI tick
  },
};

// Profile Timeframes
const PROFILE_TF = {
  fast: { trigger: '5m', context: '15m', bias: '30m', htf: '1h', cooldown: 2 },
  swing: { trigger: '15m', context: '30m', bias: '1h', htf: '4h', cooldown: 4 },
  defensive: { trigger: '30m', context: '1h', bias: '4h', htf: '4h', cooldown: 6 }
};
// ── Regime Performance Memory (additive, Level 5) ────────────────
BM.performance = BM.performance || {};
BM.performance.byRegime = BM.performance.byRegime || {
  ACCUMULATION: { trades: 0, wins: 0, avgR: 0, mult: 1.00 },
  EARLY_BULL: { trades: 0, wins: 0, avgR: 0, mult: 1.00 },
  LATE_BULL: { trades: 0, wins: 0, avgR: 0, mult: 1.00 },
  DISTRIBUTION: { trades: 0, wins: 0, avgR: 0, mult: 1.00 },
  TOP_RISK: { trades: 0, wins: 0, avgR: 0, mult: 1.00 },
  NEUTRAL: { trades: 0, wins: 0, avgR: 0, mult: 1.00 },
};
// ── Adaptive Control State (Etapa 5) — OFF by default ────────────
BM.adaptive = BM.adaptive || {
  enabled: false,   // MASTER toggle — OFF by default
  lastRecalcTs: 0,       // guard anti-spam: nu recalculăm dacă < 30min
  entryMult: 1.0,     // ajustează confMin: confMinAdj = confMin / entryMult
  sizeMult: 1.0,     // aplicat pe safeFinalSize ca ultim în lanț
  exitMult: 1.0,     // ajustează emergency threshold: baseEmergency / exitMult
  buckets: {},      // { "regime|profile|volRegime": { trades, wins, avgR, mult } }
};

// ARM_ASSIST, NEWS, regime history, fakeout, session defs
const ARM_ASSIST = { armed: false, ts: 0, TIMEOUT: 5 * 60 * 1000 };
const NEWS = {
  events: [],
  risk: 'low',
  lastUpdate: 0
};
const _regimeHistory = [];
const _fakeout = { signalTs: 0, signalDir: null, confirmCount: 0, invalid: false };
const _SESS_DEF = {
  asia: { start: 0, end: 8, color: 'asia' },
  london: { start: 8, end: 16, color: 'london' },
  ny: { start: 13, end: 21, color: 'ny' },
};
const _SESS_PRIORITY = ['asia', 'london', 'ny'];
const _NEURO_SYMS = ['BTC', 'ETH', 'SOL', 'BNB', 'XRP', 'DOGE', 'ADA'];
let _neuroLastScan = {};
const ZANIM = {
  radarAngle: 0,
  orbScale: 1,
  orbDir: 0.002,
  lastFrame: 0,
  running: false,
  particles: []
};
const _execQueue = [];   // queue if multiple trades fast
let _execActive = false;

// Window exports
window.INDICATORS = INDICATORS;
window.WL_SYMS = WL_SYMS;
window.SIGNAL_REGISTRY = SIGNAL_REGISTRY;
window.NOTIFICATION_CENTER = NOTIFICATION_CENTER;
window.USER_SETTINGS = USER_SETTINGS;
window.BT = BT;
window.BT_INDICATORS = BT_INDICATORS;
window.DSL = DSL;
window.MSCAN_SYMS = MSCAN_SYMS;
window.MSCAN = MSCAN;
window.DHF = DHF;
window.PERF = PERF;
window.DAILY_STATS = DAILY_STATS;
window.BEXT = BEXT;
window.SESSION_HOURS_BT = SESSION_HOURS_BT;
window.SESS_CFG = SESS_CFG;
window.BRAIN = BRAIN;
window.BM = BM;
window.PROFILE_TF = PROFILE_TF;
window.ARM_ASSIST = ARM_ASSIST;
window.NEWS = NEWS;
window.ZANIM = ZANIM;
