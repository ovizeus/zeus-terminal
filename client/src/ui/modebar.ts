// Zeus Terminal — ui/modebar.ts (ported from ui/modebar.js)
// Global Execution Mode Bar — visual control for demo/live mode
import { getATObject } from '../services/stateAccessors'
import { toast } from '../data/marketDataHelpers'
import { switchGlobalMode } from '../data/marketDataTrading'
const w = window as any; // kept for w._executionEnv, w._apiConfigured

// ── RENDER ─────────────────────────────────────────────────────
export function initModeBar(): void {
  var bar = document.getElementById('zeus-mode-bar');
  if (!bar || bar.children.length > 0) return;

  bar.innerHTML =
    '<div class="zmb-status">' +
      '<div class="zmb-indicator" id="zmbIndicator"></div>' +
      '<div class="zmb-info">' +
        '<span class="zmb-label" id="zmbLabel">EXECUTION MODE</span>' +
        '<span class="zmb-mode" id="zmbMode">\u2014</span>' +
      '</div>' +
    '</div>' +
    '<button class="zmb-btn" id="zmbBtn" data-action="modeBarSwitch">\u2014</button>';

  // Event delegation — replaces onclick="_modeBarSwitch()"
  bar.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest('[data-action]')
    if (btn && btn.getAttribute('data-action') === 'modeBarSwitch') _modeBarSwitch()
  })

  updateModeBar();
}

// ── UPDATE (called from _applyGlobalModeUI + _updateStatusBar) ──
export function updateModeBar(): void {
  var modeEl = document.getElementById('zmbMode');
  var btnEl = document.getElementById('zmbBtn');
  var indEl = document.getElementById('zmbIndicator');
  var bar = document.getElementById('zeus-mode-bar');
  if (!modeEl || !btnEl || !bar) return;

  var AT = getATObject();
  var mode = (typeof AT !== 'undefined' && AT && AT._serverMode) ? AT._serverMode : 'demo';
  // Phase 2C: canonical truth — null means non-demo blocked.
  var env = w._executionEnv;

  // Remove all state classes
  bar.className = 'zeus-mode-bar';

  if (mode === 'demo' || env === 'DEMO') {
    bar.classList.add('zmb-demo');
    modeEl.textContent = 'DEMO MODE';
    btnEl.textContent = 'EXIT DEMO';
    btnEl.className = 'zmb-btn zmb-btn-exit';
    if (indEl) indEl.className = 'zmb-indicator zmb-ind-demo';
  } else if (env === 'TESTNET') {
    bar.classList.add('zmb-testnet');
    modeEl.textContent = 'LIVE \u2014 TESTNET';
    btnEl.textContent = 'ACTIVATE DEMO';
    btnEl.className = 'zmb-btn zmb-btn-demo';
    if (indEl) indEl.className = 'zmb-indicator zmb-ind-testnet';
  } else if (env === null && mode === 'live') {
    bar.classList.add('zmb-locked');
    modeEl.textContent = 'LIVE \u2014 LOCKED';
    btnEl.textContent = 'CONFIGURE LIVE';
    btnEl.className = 'zmb-btn zmb-btn-locked';
    if (indEl) indEl.className = 'zmb-indicator zmb-ind-locked';
  } else if (env === 'REAL') {
    bar.classList.add('zmb-real');
    modeEl.textContent = 'LIVE \u2014 REAL';
    btnEl.textContent = 'ACTIVATE DEMO';
    btnEl.className = 'zmb-btn zmb-btn-demo';
    if (indEl) indEl.className = 'zmb-indicator zmb-ind-real';
  } else {
    bar.classList.add('zmb-locked');
    modeEl.textContent = 'LIVE \u2014 LOCKED';
    btnEl.textContent = 'CONFIGURE LIVE';
    btnEl.className = 'zmb-btn zmb-btn-locked';
    if (indEl) indEl.className = 'zmb-indicator zmb-ind-locked';
  }
}

// ── SWITCH ACTION (delegates to existing switchGlobalMode) ──────
export function _modeBarSwitch(): void {
  var AT = getATObject();
  var mode = (typeof AT !== 'undefined' && AT && AT._serverMode) ? AT._serverMode : 'demo';
  var env = w._executionEnv;
  var blockedReason = w._executionBlockedReason;

  // LOCKED state: non-demo with no canonical exec env — guide user to settings
  if (mode === 'live' && env === null) {
    toast('LIVE MODE LOCKED: ' + (blockedReason === 'INVALID_ACTIVE_API_CONFIGURATION' ? 'Invalid active API configuration' : 'No valid API credentials configured'), 3500);
    return;
  }

  switchGlobalMode(mode === 'demo' ? 'live' : 'demo');
}
