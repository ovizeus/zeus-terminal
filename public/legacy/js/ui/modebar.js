// Zeus Terminal — ui/modebar.js
// Global Execution Mode Bar — visual control for demo/live mode
'use strict';

// ── RENDER ─────────────────────────────────────────────────────
function initModeBar() {
  var bar = document.getElementById('zeus-mode-bar');
  if (!bar || bar.children.length > 0) return;

  bar.innerHTML =
    '<div class="zmb-status">' +
      '<div class="zmb-indicator" id="zmbIndicator"></div>' +
      '<div class="zmb-info">' +
        '<span class="zmb-label" id="zmbLabel">EXECUTION MODE</span>' +
        '<span class="zmb-mode" id="zmbMode">—</span>' +
      '</div>' +
    '</div>' +
    '<button class="zmb-btn" id="zmbBtn" onclick="_modeBarSwitch()">—</button>';

  updateModeBar();
}

// ── UPDATE (called from _applyGlobalModeUI + _updateStatusBar) ──
function updateModeBar() {
  var modeEl = document.getElementById('zmbMode');
  var btnEl = document.getElementById('zmbBtn');
  var indEl = document.getElementById('zmbIndicator');
  var bar = document.getElementById('zeus-mode-bar');
  if (!modeEl || !btnEl || !bar) return;

  var mode = (typeof AT !== 'undefined' && AT._serverMode) ? AT._serverMode : 'demo';
  var env = window._resolvedEnv || (mode === 'demo' ? 'DEMO' : 'REAL');
  var apiConfigured = !!window._apiConfigured;

  // Remove all state classes
  bar.className = 'zeus-mode-bar';

  if (mode === 'demo') {
    bar.classList.add('zmb-demo');
    modeEl.textContent = 'DEMO MODE';
    btnEl.textContent = 'EXIT DEMO';
    btnEl.className = 'zmb-btn zmb-btn-exit';
    if (indEl) indEl.className = 'zmb-indicator zmb-ind-demo';
  } else if (env === 'TESTNET') {
    bar.classList.add('zmb-testnet');
    modeEl.textContent = 'LIVE — TESTNET';
    btnEl.textContent = 'ACTIVATE DEMO';
    btnEl.className = 'zmb-btn zmb-btn-demo';
    if (indEl) indEl.className = 'zmb-indicator zmb-ind-testnet';
  } else if (!apiConfigured && mode === 'live') {
    bar.classList.add('zmb-locked');
    modeEl.textContent = 'LIVE — LOCKED';
    btnEl.textContent = 'CONFIGURE LIVE';
    btnEl.className = 'zmb-btn zmb-btn-locked';
    if (indEl) indEl.className = 'zmb-indicator zmb-ind-locked';
  } else {
    bar.classList.add('zmb-real');
    modeEl.textContent = 'LIVE — REAL';
    btnEl.textContent = 'ACTIVATE DEMO';
    btnEl.className = 'zmb-btn zmb-btn-demo';
    if (indEl) indEl.className = 'zmb-indicator zmb-ind-real';
  }
}

// ── SWITCH ACTION (delegates to existing switchGlobalMode) ──────
function _modeBarSwitch() {
  var mode = (typeof AT !== 'undefined' && AT._serverMode) ? AT._serverMode : 'demo';
  var apiConfigured = !!window._apiConfigured;

  // LOCKED state: no API keys — guide user to settings
  if (mode === 'live' && !apiConfigured) {
    if (typeof toast === 'function') {
      toast('Live trading unavailable — configure API keys in Settings first.', 3000);
    }
    return;
  }

  if (typeof switchGlobalMode === 'function') {
    switchGlobalMode(mode === 'demo' ? 'live' : 'demo');
  }
}
