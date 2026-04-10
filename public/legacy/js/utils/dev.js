// Zeus v122 — utils/dev.js
// Development tools, ZLOG logging, Hub settings, safeAsync
'use strict';

const DEV = {
  enabled: false,
  log: [],
  maxLog: 50,
  replayInterval: null,
  replayIndex: 0,
  replayKlines: [],
  _errorModules: {},   // tracks modules disabled due to errors
};

// ── Logging ──────────────────────────────────────────────────────
function devLog(msg, type) {
  try {
    type = type || 'info';
    const time = (typeof fmtNow === 'function') ? fmtNow(true) : new Date().toLocaleTimeString();
    DEV.log.unshift({ time, msg, type });
    if (DEV.log.length > DEV.maxLog) DEV.log.pop();
    _devRenderLog();
    // Mirror to Notification Center for warnings/errors
    if ((type === 'error' || type === 'warning') && typeof ncAdd === 'function') {
      ncAdd('warning', 'dev', '[DEV] ' + msg);
    }
  } catch (e) { /* silent */ }
}

function _devRenderLog() {
  try {
    const logEl = document.getElementById('dev-log');
    if (!logEl) return;
    if (!DEV.log.length) {
      logEl.innerHTML = '<div class="dev-log-empty">No events yet.</div>';
      return;
    }
    logEl.innerHTML = DEV.log.slice(0, 20).map(function (e) {
      const col = e.type === 'error' ? '#ff8866' :
        e.type === 'success' ? '#66ff99' :
          e.type === 'warning' ? '#f0c040' : '#9ab';
      return '<div class="dev-log-entry">'
        + '<span class="dev-log-time">' + e.time + '</span>'
        + '<span class="dev-log-msg" style="color:' + col + '">' + e.msg + '</span>'
        + '</div>';
    }).join('');
    // Update timestamp
    const upd = document.getElementById('dev-upd');
    if (upd) upd.textContent = 'last: ' + DEV.log[0].time;
  } catch (e) { /* silent */ }
}

function devClearLog() {
  try {
    DEV.log = [];
    _devRenderLog();
  } catch (e) { /* silent */ }
}

function devExportLog() {
  try {
    if (!DEV.log.length) { if (typeof toast === 'function') toast('No log to export'); return; }
    const csv = 'Time,Message,Type\n' + DEV.log.map(function (e) {
      return '"' + e.time + '","' + e.msg.replace(/"/g, '\'') + '","' + e.type + '"';
    }).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'dev_log_' + new Date().toISOString().slice(0, 10) + '.csv';
    a.click();
    devLog('Log exported to CSV', 'success');
  } catch (e) {
    devLog('Export failed: ' + e.message, 'error');
  }
}

// ╔══════════════════════════════════════════════════════════════════╗
// ║  ZLOG — Central Logging Buffer v90                               ║
// ║  Collects atLog + devLog + safeAsync errors in one place.        ║
// ║  MaxEntries: 400 (mobile-friendly). Export CSV/JSON/Clipboard.   ║
// ╚══════════════════════════════════════════════════════════════════╝
const ZLOG = (function () {
  const MAX = 400;
  const _buf = [];   // [{ts, t, lvl, msg, meta}]
  // Dedup state: skip if same lvl+msg within 2s
  let _lastMsg = '', _lastLvl = '', _lastTs = 0;

  function _ts() {
    try {
      return new Date().toLocaleTimeString('ro-RO', {
        timeZone: (typeof S !== 'undefined' && S.tz) ? S.tz : 'Europe/Bucharest',
        hour: '2-digit', minute: '2-digit', second: '2-digit'
      });
    } catch (e) { return new Date().toLocaleTimeString(); }
  }

  function push(lvl, msg, meta) {
    try {
      lvl = lvl || 'INFO';
      msg = String(msg || '');
      // Dedup: identical lvl+msg within 2s → skip
      const now = Date.now();
      if (lvl === _lastLvl && msg === _lastMsg && (now - _lastTs) < 2000) return;
      _lastLvl = lvl; _lastMsg = msg; _lastTs = now;
      // Push entry
      _buf.unshift({ ts: _ts(), t: now, lvl, msg, meta: meta || null });
      if (_buf.length > MAX) _buf.length = MAX;
      // Update UI counter if rendered
      _updateCounter();
    } catch (e) { /* silent — never throw from logger */ }
  }

  function _updateCounter() {
    try {
      const el = document.getElementById('zlog-counter');
      if (el) el.textContent = 'ZLOG: ' + _buf.length + ' / ' + MAX;
    } catch (e) { }
  }

  function _toCSV() {
    const header = 'Time,Level,Message,Meta\n';
    const rows = _buf.map(function (e) {
      const meta = e.meta ? JSON.stringify(e.meta).replace(/"/g, "'") : '';
      return '"' + e.ts + '","' + e.lvl + '","' + e.msg.replace(/"/g, "'") + '","' + meta + '"';
    });
    return header + rows.join('\n');
  }

  function _toJSON() {
    return JSON.stringify(_buf, null, 2);
  }

  function exportCSV() {
    try {
      const blob = new Blob([_toCSV()], { type: 'text/csv' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'zlog_' + new Date().toISOString().slice(0, 10) + '.csv';
      a.click();
    } catch (e) { console.warn('[ZLOG] exportCSV error:', e.message); }
  }

  function exportJSON() {
    try {
      const blob = new Blob([_toJSON()], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'zlog_' + new Date().toISOString().slice(0, 10) + '.json';
      a.click();
    } catch (e) { console.warn('[ZLOG] exportJSON error:', e.message); }
  }

  function copyCSV() {
    try {
      if (!_buf.length) { if (typeof toast === 'function') toast('ZLOG empty'); return; }
      const text = _toCSV();
      // [v119-p14] clipboard fallback: writeText → execCommand → prompt
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(function () {
          if (typeof toast === 'function') toast('ZLOG CSV copied (' + _buf.length + ' entries)');
        }).catch(function () { _clipboardFallback(text, 'ZLOG CSV'); });
      } else { _clipboardFallback(text, 'ZLOG CSV'); }
    } catch (e) { console.warn('[ZLOG] copyCSV error:', e.message); }
  }

  function copyJSON() {
    try {
      if (!_buf.length) { if (typeof toast === 'function') toast('ZLOG empty'); return; }
      const text = _toJSON();
      // [v119-p14] clipboard fallback
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(function () {
          if (typeof toast === 'function') toast('ZLOG JSON copied (' + _buf.length + ' entries)');
        }).catch(function () { _clipboardFallback(text, 'ZLOG JSON'); });
      } else { _clipboardFallback(text, 'ZLOG JSON'); }
    } catch (e) { console.warn('[ZLOG] copyJSON error:', e.message); }
  }

  function clear() {
    try {
      _buf.length = 0;
      _lastMsg = ''; _lastLvl = ''; _lastTs = 0;
      _updateCounter();
      if (typeof toast === 'function') toast('ZLOG cleared');
    } catch (e) { }
  }

  function stats() {
    const counts = {};
    _buf.forEach(function (e) { counts[e.lvl] = (counts[e.lvl] || 0) + 1; });
    return { total: _buf.length, max: MAX, byLevel: counts };
  }

  // Patch atLog + devLog non-invasively (called once at boot)
  function install() {
    try {
      if (typeof window.atLog === 'function' && !window.atLog._zlPatched) {
        var _orig = window.atLog;
        window.atLog = function (type, msg) {
          ZLOG.push('AT', msg, { type: type });
          return _orig(type, msg);
        };
        window.atLog._zlPatched = true;
      }
    } catch (e) { console.warn('[ZLOG] atLog patch error:', e.message); }

    try {
      if (typeof window.devLog === 'function' && !window.devLog._zlPatched) {
        var _origDev = window.devLog;
        window.devLog = function (msg, type) {
          ZLOG.push('DEV', msg, { type: type });
          return _origDev(msg, type);
        };
        window.devLog._zlPatched = true;
      }
    } catch (e) { console.warn('[ZLOG] devLog patch error:', e.message); }
  }

  // [v119-p14] _clipboardFallback — execCommand → prompt → console.dir
  // Acoperă: HTTP (fără permisiune), iOS Safari, focus pierdut, Android WebView
  function _clipboardFallback(text, label) {
    try {
      // Încercare 1: execCommand (legacy, merge în majority de browsere mobile)
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.cssText = 'position:fixed;top:-9999px;left:-9999px;opacity:0;';
      document.body.appendChild(ta);
      ta.focus(); ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      if (ok) {
        if (typeof toast === 'function') toast((label || 'Text') + ' copied (fallback)');
        return;
      }
    } catch (_) { }
    try {
      // Încercare 2: prompt — merge aproape universal, user poate copia manual
      window.prompt('Copy ' + (label || 'text') + ' (Ctrl+C / Cmd+C):', text.substring(0, 2000));
    } catch (_) {
      // Încercare 3: console.dir ca ultimă instanță
      console.dir({ label: label, data: text.substring(0, 5000) });
      if (typeof toast === 'function') toast((label || 'Text') + ': vezi Console (F12)');
    }
  }

  return { push, exportCSV, exportJSON, copyCSV, copyJSON, clear, stats, install };
})();

// ── safeAsync(fn, name, opts) — wraps async functions with catch+ZLOG ──
// Returns a new async function. Original fn is called unchanged internally.
// opts.silent = true → no atLog UI noise (just ZLOG + console)
function safeAsync(fn, name, opts) {
  opts = opts || {};
  return async function () {
    try {
      return await fn.apply(this, arguments);
    } catch (e) {
      var msg = '[ERR][' + (name || '?') + '] ' + (e && e.message ? e.message : String(e));
      var stack = (e && e.stack) ? e.stack.split('\n').slice(0, 3).join(' | ') : '';
      // Log to ZLOG always
      ZLOG.push('ERROR', msg, { name: name, stack: stack });
      // Log to devLog if available (dev mode)
      if (typeof devLog === 'function') devLog(msg, 'error');
      // Log to atLog only if not silent (avoids UI spam for fetchers)
      if (!opts.silent && typeof atLog === 'function') atLog('warn', msg);
      // Always console
      console.warn('[safeAsync]', msg, stack);
      // Return null safe — callers must handle null
      return null;
    }
  };
}

// ── Gate check helper ─────────────────────────────────────────────
function _devModuleOk(name) {
  if (DEV._errorModules[name]) {
    devLog(name + ' module disabled due to previous error', 'warning');
    return false;
  }
  return true;
}
function _devModuleError(name, err) {
  DEV._errorModules[name] = true;
  devLog('Module "' + name + '" disabled due to error: ' + (err && err.message ? err.message : err), 'error');
}

// ── Event Injectors ───────────────────────────────────────────────
function devInjectSignal(dir) {
  if (!_devModuleOk('injectSignal')) return;
  try {
    var score = 85;
    var type = dir === 'LONG' ? 'DEV BULL SIGNAL' : 'DEV BEAR SIGNAL';
    if (typeof srRecord === 'function') {
      srRecord('dev', type, dir, score);
    } else {
      devLog('srRecord not available', 'warning');
    }
    devLog('Injected ' + dir + ' signal (score ' + score + ')', 'success');
    if (typeof updateDeepDive === 'function') updateDeepDive();
  } catch (e) { _devModuleError('injectSignal', e); }
}

function devInjectLiquidation(side) {
  if (!_devModuleOk('injectLiq')) return;
  try {
    var isLong = side === 'LONG';
    var usd = Math.floor(Math.random() * 5000000) + 500000;
    var price = (S && S.price) ? S.price : 50000;
    var qty = usd / price;
    var sym = (S && S.symbol) ? S.symbol : 'BTCUSDT';
    var ev = { sym: sym.replace('USDT', ''), isLong: isLong, usd: usd, price: price, qty: qty, ts: Date.now() };
    if (S && S.events) {
      S.events.unshift(ev);
      if (S.events.length > 100) S.events.pop();
      if (typeof updLiqStats === 'function') updLiqStats();
      if (typeof renderFeed === 'function') renderFeed();
    } else {
      devLog('S.events not available', 'warning');
    }
    if (typeof checkLiqAlert === 'function') {
      checkLiqAlert(usd, qty, side, sym.replace('USDT', ''));
    }
    var fmtFn = typeof fmt === 'function' ? fmt : function (n) { return n.toFixed(0); };
    var fPFn = typeof fP === 'function' ? fP : function (n) { return n.toFixed(1); };
    devLog('Injected ' + side + ' liquidation $' + fmtFn(usd) + ' @ $' + fPFn(price), 'success');
  } catch (e) { _devModuleError('injectLiq', e); }
}

function devInjectWhale() {
  if (!_devModuleOk('injectWhale')) return;
  try {
    if (typeof injectFakeWhale === 'function') {
      injectFakeWhale();
      devLog('Injected fake whale event', 'success');
    } else {
      devLog('injectFakeWhale not available', 'warning');
    }
  } catch (e) { _devModuleError('injectWhale', e); }
}

function devFeedDisconnect() {
  if (!_devModuleOk('feedDisconnect')) return;
  try {
    if (typeof _enterRecoveryMode === 'function') {
      _enterRecoveryMode('DEV');
      devLog('Simulated feed disconnect (recovery mode)', 'warning');
    } else {
      devLog('_enterRecoveryMode not available', 'warning');
    }
  } catch (e) { _devModuleError('feedDisconnect', e); }
}

function devFeedRecover() {
  if (!_devModuleOk('feedRecover')) return;
  try {
    if (typeof _exitRecoveryMode === 'function') {
      _exitRecoveryMode();
      devLog('Simulated feed reconnect', 'success');
    } else {
      devLog('_exitRecoveryMode not available', 'warning');
    }
  } catch (e) { _devModuleError('feedRecover', e); }
}

function devTriggerKillSwitch() {
  if (!_devModuleOk('killSwitch')) return;
  try {
    if (typeof triggerKillSwitch === 'function') {
      triggerKillSwitch('manual');
      devLog('Triggered kill switch (manual)', 'warning');
    } else {
      devLog('triggerKillSwitch not available', 'warning');
    }
  } catch (e) { _devModuleError('killSwitch', e); }
}

function devResetProtect() {
  if (!_devModuleOk('resetProtect')) return;
  try {
    if (typeof resetProtectMode === 'function') {
      resetProtectMode();
      devLog('Protect mode reset', 'success');
    } else {
      devLog('resetProtectMode not available', 'warning');
    }
  } catch (e) { _devModuleError('resetProtect', e); }
}

// ── Replay Mode (log-only viewer — does NOT touch WebSocket or live data) ──
function devReplayStart() {
  if (!_devModuleOk('replay')) return;
  try {
    if (DEV.replayInterval) { devLog('Replay already running', 'warning'); return; }
    if (!S || !S.klines || S.klines.length < 10) {
      devLog('Not enough klines for replay (need ≥10)', 'error'); return;
    }
    DEV.replayKlines = S.klines.slice();
    DEV.replayIndex = 0;
    var speedEl = document.getElementById('dev-replay-speed');
    var speed = speedEl ? (parseFloat(speedEl.value) || 1) : 1;
    var ms = Math.max(100, Math.round(1000 / speed));
    devLog('Replay started: ' + DEV.replayKlines.length + ' bars at ' + speed + 'x', 'info');
    var statusEl = document.getElementById('dev-replay-status');
    DEV.replayInterval = setInterval(function () {
      try {
        if (DEV.replayIndex >= DEV.replayKlines.length) { devReplayStop(); devLog('Replay finished', 'success'); return; }
        var bar = DEV.replayKlines[DEV.replayIndex];
        var fPFn = typeof fP === 'function' ? fP : function (n) { return n.toFixed(1); };
        devLog('Bar ' + (DEV.replayIndex + 1) + '/' + DEV.replayKlines.length
          + ' O=' + fPFn(bar.open) + ' H=' + fPFn(bar.high)
          + ' L=' + fPFn(bar.low) + ' C=' + fPFn(bar.close), 'info');
        DEV.replayIndex++;
        if (statusEl) statusEl.textContent = 'Playing ' + DEV.replayIndex + '/' + DEV.replayKlines.length;
      } catch (e) { devReplayStop(); _devModuleError('replay', e); }
    }, ms);
  } catch (e) { _devModuleError('replay', e); }
}

function devReplayStop() {
  try {
    if (DEV.replayInterval) {
      clearInterval(DEV.replayInterval);
      DEV.replayInterval = null;
      var statusEl = document.getElementById('dev-replay-status');
      if (statusEl) statusEl.textContent = 'Stopped';
    }
  } catch (e) { /* silent */ }
}

// ── Toggle Developer panel visibility ────────────────────────────
function hubToggleDev(enabled) {
  try {
    DEV.enabled = !!enabled;

    // Persist to localStorage so next boot restores correctly
    try { localStorage.setItem('zeus_dev_enabled', enabled ? 'true' : 'false'); } catch (_) { }

    var panel = document.getElementById('dev-sec');
    if (!panel) {
      devLog('dev-sec element not found in DOM', 'error');
      return;
    }

    if (enabled) {
      panel.style.display = 'block';
      // Move into #zeus-groups if not already there — fallback for any boot order issue
      var mi = document.getElementById('zeus-groups');
      if (mi && panel.closest('#zeus-groups') === null) {
        mi.appendChild(panel);
        console.log('[DEV] dev-sec moved into #zeus-groups dynamically');
      }
      // Full ensure + scroll
      _devEnsureVisible();
      devLog('Developer Mode activated', 'success');
    } else {
      panel.style.display = 'none';
    }

    // Sync both checkboxes
    var cb1 = document.getElementById('hubDevEnabled');
    var cb2 = document.getElementById('hubDevEnabled2');
    if (cb1) cb1.checked = !!enabled;
    if (cb2) cb2.checked = !!enabled;

  } catch (e) {
    console.warn('[DEV] hubToggleDev error:', e);
  }
}

// ── _devEnsureVisible — same pattern as _srEnsureVisible ─────────
// Guards, retry-safe, inserts after deepdive-sec (anchor), expands MI,
// renders log. Safe to call multiple times.
function _devEnsureVisible() {
  try {
    var devSec = document.getElementById('dev-sec');
    if (!devSec) return; // panel not in DOM yet — nothing to do

    var mi = document.getElementById('zeus-groups');
    if (!mi) return;

    // Only proceed if DEV is enabled
    if (!DEV.enabled) return;

    // Remove any residual classes/styles left by initZeusGroups recovery paths
    devSec.classList.remove('zg-pending-move');
    devSec.style.removeProperty('visibility');
    devSec.style.removeProperty('max-height');
    devSec.style.removeProperty('overflow');
    // Explicit display:block — do NOT use removeProperty here;
    // the element starts with inline display:none so removeProperty would hide it
    devSec.style.display = 'block';

    // Check if already in MI
    var alreadyInMI = devSec.closest('#zeus-groups') !== null;

    if (!alreadyInMI) {
      // Not in MI — insert after deepdive-sec (natural anchor), fallback to append
      var anchor = mi.querySelector('#deepdive-sec');
      if (anchor && anchor.nextSibling) {
        mi.insertBefore(devSec, anchor.nextSibling);
      } else if (anchor) {
        mi.appendChild(devSec);
      } else {
        // deepdive-sec not in MI either — append at end
        mi.appendChild(devSec);
      }
      console.log('[DEV] Fallback: dev-sec forțat în zeus-groups');
    } else {
      // Already in MI — verify it is after deepdive-sec
      var anchor2 = mi.querySelector('#deepdive-sec');
      if (anchor2) {
        var nodes = Array.from(mi.children);
        var anchorIdx = nodes.indexOf(anchor2);
        var devIdx = nodes.indexOf(devSec);
        if (devIdx <= anchorIdx) {
          // Out of order — reposition after anchor
          if (anchor2.nextSibling) {
            mi.insertBefore(devSec, anchor2.nextSibling);
          } else {
            mi.appendChild(devSec);
          }
          console.log('[DEV] Fallback: dev-sec repoziționat după deepdive-sec');
        }
      }
    }

    // Render log so panel shows content immediately
    _devRenderLog();

    // Fix C — scroll panel into view with a brief blink so user sees it instantly
    try {
      devSec.scrollIntoView({ behavior: 'smooth', block: 'start' });
      devSec.style.outline = '1px solid #aa88ff';
      setTimeout(function () {
        try { devSec.style.removeProperty('outline'); } catch (_) { }
      }, 900);
    } catch (_) { }

  } catch (e) {
    console.warn('[DEV] Fallback _devEnsureVisible error:', e.message);
  }
}

// ════════════════════════════════════════════════════════════════
// UI SCALE — CSS variable + localStorage persistence
// ════════════════════════════════════════════════════════════════
function setUiScale(val) {
  var v = parseFloat(val);
  if (isNaN(v) || v < 0.5 || v > 3) v = 1;
  document.documentElement.style.setProperty('--ui-scale', v);
  try { localStorage.setItem('zeus_ui_scale', v); } catch (_) { }
  if (typeof _ucMarkDirty === 'function') _ucMarkDirty('uiScale');
  if (typeof _userCtxPush === 'function') _userCtxPush();
  var sel = document.getElementById('hubUiScale');
  if (sel) sel.value = String(v);
}
// Restore on script load
(function () {
  try {
    var saved = parseFloat(localStorage.getItem('zeus_ui_scale'));
    if (!isNaN(saved) && saved >= 0.5 && saved <= 3) {
      document.documentElement.style.setProperty('--ui-scale', saved);
    }
  } catch (_) { }
})();

// ════════════════════════════════════════════════════════════════
// SETTINGS HUB
// Reads/writes ONLY: S, USER_SETTINGS, S.alerts
// Old modals preserved — Hub is additive, not a replacement.
// ════════════════════════════════════════════════════════════════

function hubPopulate() {
  try {
    // ── General ─────────────────────────────────────────────────
    var ceEl = document.getElementById('hubCloudEmail');
    if (ceEl) ceEl.value = ''; // [FIX v85 BUG1] Nu afișăm emailul din S (nu se stochează în clar)

    var notEl = document.getElementById('hubNotifyEnabled');
    if (notEl) notEl.checked = (S && S.alerts) ? (S.alerts.enabled !== false) : true;

    var devCb = document.getElementById('hubDevEnabled');
    if (devCb) devCb.checked = DEV.enabled;
    var devCb2 = document.getElementById('hubDevEnabled2');
    if (devCb2) devCb2.checked = DEV.enabled;

    // ── Theme ────────────────────────────────────────────────────
    var _ts = document.getElementById('themeSelect');
    if (_ts) _ts.value = zeusGetTheme ? zeusGetTheme() : 'native';

    // ── UI Scale ────────────────────────────────────────────────
    var scaleSel = document.getElementById('hubUiScale');
    if (scaleSel) {
      var sv = localStorage.getItem('zeus_ui_scale');
      scaleSel.value = (sv && !isNaN(parseFloat(sv))) ? String(parseFloat(sv)) : '1';
    }

    // ── (Chart TF / Timezone / Indicators removed — single source of truth is chart toolbar) ──

    var _setV = function (id, val) {
      var el = document.getElementById(id);
      if (el) el.value = val;
    };

    // ── Alerts ───────────────────────────────────────────────────
    var al = (S && S.alerts) ? S.alerts : {};
    var _setC = function (id, val) {
      var el = document.getElementById(id);
      if (el) el.checked = val !== false;
    };
    _setC('hubAlertMaster', al.enabled);
    _setC('hubAlertVol', al.volSpike);
    _setC('hubAlertWhale', al.whaleOrders);
    _setC('hubAlertLiq', al.liqAlerts);
    _setC('hubAlertDiv', al.divergence);
    _setC('hubAlertRsi', al.rsiAlerts);
    _setV('hubWhaleMin', al.whaleMinBtc !== undefined ? al.whaleMinBtc : 100);
    _setV('hubLiqMin', al.liqMinBtc !== undefined ? al.liqMinBtc : 1);

    // ── Auto Trade (populate AT panel toggles) ──────────────────
    var at = (typeof USER_SETTINGS !== 'undefined' && USER_SETTINGS.autoTrade)
      ? USER_SETTINGS.autoTrade : {};
    var atSeEl = document.getElementById('atSmartExit');
    if (atSeEl) atSeEl.checked = at.smartExitEnabled === true;
    var atAdaptEl = document.getElementById('atAdaptEnabled');
    if (atAdaptEl) atAdaptEl.checked = BM.adapt && BM.adapt.enabled === true;
    var atAdaptLiveEl = document.getElementById('atAdaptLive');
    if (atAdaptLiveEl) atAdaptLiveEl.checked = BM.adapt && BM.adapt.allowLiveAdjust === true;

    // ── Telegram ──────────────────────────────────────────────────
    if (typeof hubTgPopulate === 'function') hubTgPopulate();

  } catch (e) {
    console.warn('[Hub] hubPopulate error:', e);
  }
}

function hubSaveAll() {
  try {
    // ── General ─────────────────────────────────────────────────
    var ceEl = document.getElementById('hubCloudEmail');
    // [FIX v85 BUG1] Nu salvăm emailul în S.cloudEmail — emailul nu se stochează în memorie

    var notEl = document.getElementById('hubNotifyEnabled');
    if (notEl && S && S.alerts) S.alerts.enabled = notEl.checked;

    // ── (Chart TF / Timezone / Candle colors / Indicators removed — single source of truth is chart toolbar) ──

    // ── Alerts ───────────────────────────────────────────────────
    if (S) {
      if (!S.alerts) S.alerts = {};
      var _getC = function (id, def) {
        var el = document.getElementById(id);
        return el ? el.checked : def;
      };
      S.alerts.enabled = _getC('hubAlertMaster', true);
      S.alerts.volSpike = _getC('hubAlertVol', true);
      S.alerts.whaleOrders = _getC('hubAlertWhale', true);
      S.alerts.liqAlerts = _getC('hubAlertLiq', true);
      S.alerts.divergence = _getC('hubAlertDiv', true);
      S.alerts.rsiAlerts = _getC('hubAlertRsi', true);
      S.alerts.whaleMinBtc = parseFloat(document.getElementById('hubWhaleMin')?.value) || 100;
      S.alerts.liqMinBtc = parseFloat(document.getElementById('hubLiqMin')?.value) || 1;
    }

    // ── (AT Hub inputs removed — AT panel is single source of truth) ──

    // ── Persist ───────────────────────────────────────────────────
    if (typeof _usSave === 'function') {
      try { _usSave(); } catch (_) { }
    }

    // ── Telegram (push to server) ─────────────────────────────────
    var tgToken = document.getElementById('hubTgBotToken');
    var tgChat = document.getElementById('hubTgChatId');
    if (tgToken && tgChat && tgToken.value.trim() && tgChat.value.trim()) {
      hubTgSave();
    }

    if (typeof toast === 'function') toast('All settings saved', 0, _ZI.ok);
    devLog('Settings saved via Hub', 'info');

  } catch (e) {
    console.warn('[Hub] hubSaveAll error:', e);
    if (typeof toast === 'function') toast('Save error — check console');
  }
}

function hubLoadAll() {
  try {
    if (typeof loadUserSettings === 'function') loadUserSettings();
    hubPopulate();
    if (typeof toast === 'function') toast('Settings loaded', 0, _ZI.fold);
  } catch (e) {
    console.warn('[Hub] hubLoadAll error:', e);
  }
}

// ── Telegram Settings ─────────────────────────────────────────────
function hubTgSave() {
  var tokenEl = document.getElementById('hubTgBotToken');
  var chatEl = document.getElementById('hubTgChatId');
  var statusEl = document.getElementById('hubTgStatus');
  var token = tokenEl ? tokenEl.value.trim() : '';
  var chatId = chatEl ? chatEl.value.trim() : '';
  if (!token || !chatId) {
    if (statusEl) statusEl.innerHTML = '<span style="color:#ff6655">' + _ZI.w + ' Completează ambele câmpuri</span>';
    return;
  }
  localStorage.setItem('zeus_tg_bot_token', token);
  localStorage.setItem('zeus_tg_chat_id', chatId);
  // Push to server runtime config
  fetch('/api/user/telegram', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ botToken: token, chatId: chatId })
  }).then(function (r) { return r.json(); }).then(function (d) {
    if (d.ok) {
      if (statusEl) statusEl.innerHTML = '<span style="color:#00d97a">' + _ZI.ok + ' Salvat + trimis la server</span>';
      if (typeof toast === 'function') toast('Telegram saved', 0, _ZI.ok);
    } else {
      if (statusEl) statusEl.innerHTML = '<span style="color:#ff6655">' + _ZI.w + ' Server: ' + (d.error || 'error') + '</span>';
    }
  }).catch(function (e) {
    if (statusEl) statusEl.innerHTML = '<span style="color:#ff6655">' + _ZI.w + ' ' + e.message + '</span>';
  });
}

function hubTgTest() {
  var statusEl = document.getElementById('hubTgStatus');
  // Save first to ensure server has the latest creds
  hubTgSave();
  setTimeout(function () {
    if (statusEl) statusEl.innerHTML = '<span style="color:#4fc3f7">' + _ZI.mail + ' Sending test...</span>';
    fetch('/api/user/telegram/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }).then(function (r) { return r.json(); }).then(function (d) {
      if (d.ok) {
        if (statusEl) statusEl.innerHTML = '<span style="color:#00d97a">' + _ZI.ok + ' Test trimis — verifică Telegram!</span>';
      } else {
        if (statusEl) statusEl.innerHTML = '<span style="color:#ff6655">' + _ZI.w + ' Mesajul nu s-a trimis — verifică token/chat ID</span>';
      }
    }).catch(function (e) {
      if (statusEl) statusEl.innerHTML = '<span style="color:#ff6655">' + _ZI.w + ' ' + e.message + '</span>';
    });
  }, 500);
}

function hubTgPopulate() {
  var token = localStorage.getItem('zeus_tg_bot_token') || '';
  var chatId = localStorage.getItem('zeus_tg_chat_id') || '';
  var tokenEl = document.getElementById('hubTgBotToken');
  var chatEl = document.getElementById('hubTgChatId');
  if (tokenEl) tokenEl.value = token;
  if (chatEl) chatEl.value = chatId;
  // Also fetch server-side config to show if configured
  fetch('/api/user/telegram').then(function (r) { return r.json(); }).then(function (d) {
    if (d.configured && chatEl && !chatEl.value) chatEl.value = d.chatId || '';
    var statusEl = document.getElementById('hubTgStatus');
    if (statusEl && d.configured) statusEl.innerHTML = '<span style="color:#4fc3f7">' + _ZI.inf + ' Telegram configurat (chat: ' + d.chatId + ')</span>';
  }).catch(function () { });
}

function hubResetDefaults() {
  try {
    if (!confirm('Reset all settings to defaults?')) return;
    if (S) {
      S.chartTf = '5m';
      S.tz = 'Europe/Bucharest';
      if (!S.activeInds) S.activeInds = {};
      S.activeInds = {
        ema: true, wma: true, st: true, vp: true,
        macd: false, bb: false, stoch: false, obv: false,
        atr: false, vwap: false, ichimoku: false, fib: false,
        pivot: false, rsi14: false, mfi: false, cci: false
      };
      S.alerts = {
        enabled: true, volSpike: true, whaleOrders: true, liqAlerts: true,
        divergence: true, rsiAlerts: true, whaleMinBtc: 100, liqMinBtc: 1
      };
      S.rsiPeriod = 14; S.macdFast = 12; S.macdSlow = 26; S.macdSig = 9;
    }
    if (typeof USER_SETTINGS !== 'undefined') {
      USER_SETTINGS.autoTrade = {
        lev: 5, sl: 1.5, rr: 2, size: 200, maxPos: 4,
        killPct: 5, confMin: 65, sigMin: 3, multiSym: true
      };
    }
    hubPopulate();
    hubSaveAll();
    if (typeof toast === 'function') toast('↺ Defaults restored');
  } catch (e) {
    console.warn('[Hub] hubResetDefaults error:', e);
  }
}

// ── Hub helpers ───────────────────────────────────────────────────
function hubSetTf(tf, btn) {
  try {
    document.querySelectorAll('#hubTfGroup .qb').forEach(function (b) { b.classList.remove('act'); });
    if (btn) btn.classList.add('act');
  } catch (e) { }
}

function hubSetTZ(tz, btn) {
  try {
    document.querySelectorAll('#hubTzGroup .qb').forEach(function (b) { b.classList.remove('act'); });
    if (btn) btn.classList.add('act');
  } catch (e) { }
}

function hubApplyChartColors() {
  try {
    var bull = document.getElementById('hubCcBull')?.value || '#00d97a';
    var bear = document.getElementById('hubCcBear')?.value || '#ff3355';
    if (typeof cSeries !== 'undefined' && cSeries) {
      cSeries.applyOptions({
        upColor: bull, downColor: bear,
        borderUpColor: bull, borderDownColor: bear,
        wickUpColor: bull, wickDownColor: bear
      });
    }
  } catch (e) { console.warn('[Hub] hubApplyChartColors error:', e); }
}

function hubCloudSave() {
  try {
    var email = document.getElementById('hubCloudEmail')?.value || '';
    if (!email) { if (typeof toast === 'function') toast('Enter an email address'); return; }
    // [FIX v85 BUG1] Nu salvăm emailul în S.cloudEmail
    // Sincronizăm câmpul cloudEmail din panoul cloud dacă există
    var mainEmailEl = el('cloudEmail'); if (mainEmailEl) mainEmailEl.value = email;
    if (typeof cloudSave === 'function') { cloudSave(); }
    else if (typeof toast === 'function') toast('cloudSave not available');
  } catch (e) { console.warn('[Hub] hubCloudSave error:', e); }
}

function hubCloudLoad() {
  try {
    var email = document.getElementById('hubCloudEmail')?.value || '';
    if (!email) { if (typeof toast === 'function') toast('Enter an email address'); return; }
    // [FIX v85 BUG1] Nu salvăm emailul în S.cloudEmail
    var mainEmailEl = el('cloudEmail'); if (mainEmailEl) mainEmailEl.value = email;
    if (typeof cloudLoad === 'function') { cloudLoad(); }
    else if (typeof toast === 'function') toast('cloudLoad not available');
  } catch (e) { console.warn('[Hub] hubCloudLoad error:', e); }
}

function hubCloudClear() {
  try {
    var emailEl = document.getElementById('hubCloudEmail');
    if (emailEl) emailEl.value = '';
    // [FIX v85 BUG1] Nu resetăm S.cloudEmail (nu mai e folosit)
    if (typeof cloudClear === 'function') { cloudClear(); }
  } catch (e) { console.warn('[Hub] hubCloudClear error:', e); }
}

// ════════════════════════════════════════════════════════════════
// ADAPTIVE CYCLE INTELLIGENCE — Level 5
// Additive only. Default OFF. No DSL touch.
// ════════════════════════════════════════════════════════════════

// ── Shared utility ───────────────────────────────────────────────
