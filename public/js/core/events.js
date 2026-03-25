// Zeus v122 — core/events.js
// AutoTrade state, execution queue, pending close, interval manager
'use strict';

// AutoTrade engine state
const AT = {
  enabled: false,
  mode: 'demo',         // 'demo' | 'live'
  running: false,
  killTriggered: false,
  interval: null,
  // Stats
  totalTrades: 0,
  wins: 0,
  losses: 0,
  totalPnL: 0,
  dailyPnL: 0,           // includes unrealized (for display)
  realizedDailyPnL: 0,   // ONLY closed trades (for kill switch)
  closedTradesToday: 0,  // count of closed trades today (kill switch guard)
  dailyStart: new Date().toDateString(),
  // Cooldown: don't re-enter same direction within X seconds
  lastTradeSide: null,
  lastTradeTs: 0,
  cooldownMs: 120000,   // 2 min cooldown
  _cooldownBySymbol: {}, // [P3-3] per-symbol cooldown map
  _killTriggeredTs: 0,   // [P3-5] timestamp when kill was triggered
  // Log
  log: [],
};

// [p19 PREDATOR START]
window.PREDATOR = {
  state: 'HUNT',
  reason: 'INIT',
  since: 0,
  _lastState: 'HUNT',
  _lastLogTs: 0
};

function computePredatorState() {
  try {
    var volRegime = (typeof BM !== 'undefined' && BM.volRegime) ? String(BM.volRegime).toUpperCase() : 'MED';
    var lossStreak = (typeof BM !== 'undefined' && Number.isFinite(BM.lossStreak)) ? BM.lossStreak : 0;
    var dataStall = (typeof _SAFETY !== 'undefined') ? !!_SAFETY.dataStalled : false;
    var riskState = (typeof BM !== 'undefined' && BM.riskState) ? BM.riskState : 'RISK_ON';
    var alignScore = (typeof BM !== 'undefined' && BM.mtf && Number.isFinite(BM.mtf.score)) ? BM.mtf.score : 50;
    var cscore = (typeof BM !== 'undefined' && Number.isFinite(BM.confluenceScore)) ? BM.confluenceScore : 50;

    var ns = 'KILL';
    var nr = 'OK';

    if (dataStall) {
      ns = 'SLEEP'; nr = 'DATA_STALL';
    } else if (volRegime === 'EXTREME') {
      ns = 'SLEEP'; nr = 'VOL_EXTREME';
    } else if (lossStreak >= 3) {
      ns = 'SLEEP'; nr = 'LOSS_STREAK';
    } else if (riskState === 'RISK_OFF') {
      ns = 'HUNT'; nr = 'RISK_OFF';
    } else if (riskState === 'CHOP') {
      ns = 'HUNT'; nr = 'CHOP';
    } else if (volRegime === 'HIGH') {
      ns = 'HUNT'; nr = 'VOL_HIGH';
    } else if (alignScore < 35) {
      ns = 'HUNT'; nr = 'MTF_MISALIGN';
    } else if (cscore < 40) {
      ns = 'HUNT'; nr = 'SCORE_LOW';
    }

    if (ns !== PREDATOR.state) { PREDATOR.since = Date.now(); }
    PREDATOR.state = ns;
    PREDATOR.reason = nr;
    // [P0.4] Decision log — predator state
    if (typeof DLog !== 'undefined') DLog.record('predator', { state: ns, reason: nr, vol: volRegime, streak: lossStreak, risk: riskState, mtf: alignScore, cscore: cscore });

    // [p19 UI] Update PREDATOR HUD pills
    try {
      var _pills = { SLEEP: 'pred-sleep', HUNT: 'pred-hunt', KILL: 'pred-kill' };
      var _colors = { SLEEP: '#ff4444', HUNT: '#ffcc00', KILL: '#00ff88' };
      var _glows = { SLEEP: '#ff444466', HUNT: '#ffcc0066', KILL: '#00ff8866' };
      Object.keys(_pills).forEach(function (st) {
        var el2 = document.getElementById(_pills[st]);
        if (!el2) return;
        if (st === ns) {
          el2.style.color = _colors[st];
          el2.style.borderColor = _colors[st];
          el2.style.boxShadow = '0 0 6px ' + _glows[st];
          el2.style.background = _glows[st];
        } else {
          el2.style.color = '#333';
          el2.style.borderColor = '#2a2a2a';
          el2.style.boxShadow = 'none';
          el2.style.background = 'transparent';
        }
      });
    } catch (e2) { /* non-blocking */ }

    var now2 = Date.now();
    if (ns !== PREDATOR._lastState || (now2 - PREDATOR._lastLogTs > 30000)) {
      PREDATOR._lastState = ns;
      PREDATOR._lastLogTs = now2;
      var lvl = ns === 'KILL' ? 'ok' : ns === 'HUNT' ? 'wait' : 'warn';
      var msg = '[PREDATOR] ' + ns + ' [' + nr + '] vol:' + volRegime + ' streak:' + lossStreak + ' risk:' + riskState + ' mtf:' + alignScore + ' score:' + cscore;
      if (typeof atLog === 'function') { atLog(lvl, msg); }
    }
  } catch (e) {
    console.warn('[PREDATOR] error:', e);
    if (typeof PREDATOR !== 'undefined') { PREDATOR.state = 'HUNT'; PREDATOR.reason = 'ERR'; }
  }
}
// [p19 PREDATOR END]


// _execQueue, _execActive — defined in config.js (loaded earlier)

// Pending close state
const _pendingClose = {}; // { posId: { timer, btnRef } }


// Confirm close buttons
function attachConfirmClose(btn, callback) {
  const posId =
    btn.getAttribute('data-id') ||
    btn.getAttribute('data-close-id') ||
    btn.getAttribute('data-partial-id') ||
    btn.id; // fallback pentru butoane gen closeAllBtn
  if (!posId) return;

  // Restore visual state if already pending (button rebuilt by _demoTick)
  if (_pendingClose[posId]) {
    _applyPendingStyle(btn);
    _pendingClose[posId].btnRef = btn; // update ref to new DOM element
  }

  let touchStartX = 0, touchStartY = 0, touchMoved = false;

  btn.addEventListener('touchstart', function (e) {
    touchStartX = e.touches[0].clientX;
    touchStartY = e.touches[0].clientY;
    touchMoved = false;
  }, { passive: true });

  btn.addEventListener('touchmove', function (e) {
    if (Math.abs(e.touches[0].clientX - touchStartX) > 10 ||
      Math.abs(e.touches[0].clientY - touchStartY) > 10) {
      touchMoved = true;
    }
  }, { passive: true });

  btn.addEventListener('touchend', function (e) {
    if (touchMoved) return;
    e.preventDefault();
    _handleConfirm(posId, btn, callback);
  }, { passive: false });

  // Desktop fallback
  btn.addEventListener('click', function (e) {
    if ('ontouchstart' in window) return;
    _handleConfirm(posId, btn, callback);
  });
}

function _handleConfirm(posId, btn, callback) {
  if (_pendingClose[posId]) {
    // Second tap — execute
    clearTimeout(_pendingClose[posId].timer);
    delete _pendingClose[posId];
    _resetCloseBtn(btn);
    callback();
  } else {
    // First tap — await confirm
    _applyPendingStyle(btn);
    const timer = setTimeout(() => {
      delete _pendingClose[posId];
      _resetCloseBtn(btn);
    }, 2500);
    _pendingClose[posId] = { timer, btnRef: btn, callback };
  }
}

function _applyPendingStyle(btn) {
  btn.innerHTML = '✓ CONFIRMĂ?';
  btn.style.background = '#1a1200';
  btn.style.borderColor = '#f0c040';
  btn.style.color = '#f0c040';
}

function _resetCloseBtn(btn) {
  // Restore original style based on button type
  if (btn.getAttribute('data-close-id')) {
    btn.innerHTML = '✕ INCHIDE TOT';
    btn.style.background = '#2a0010';
    btn.style.borderColor = '#ff4466';
    btn.style.color = '#ff4466';
  } else if (btn.getAttribute('data-id')) {
    btn.innerHTML = '✕ CLOSE';
    btn.style.background = '#2a0010';
    btn.style.borderColor = '#ff4466';
    btn.style.color = '#ff4466';
  } else if (btn.id === 'closeAllBtn') {
    // Restaurare text pentru CLOSE ALL (identificat prin btn.id fallback)
    btn.innerHTML = '✕ CLOSE ALL';
    btn.style.background = '#2a0010';
    btn.style.borderColor = '#ff4466';
    btn.style.color = '#ff4466';
  }
}




// Interval Manager (safe wrapper)
function _safeSetInterval(fn, ms, name) {
  // Now delegates to Intervals manager for dedup + tracking
  const key = name || ('_safe_' + Math.random().toString(36).slice(2, 7));
  return Intervals.set(key, fn, ms);
}

function _clearAllIntervals() {
  // Delegates to Intervals manager
  Intervals.clearAll();
}

// FIX 21: Cleanup intervals and WebSockets on page unload

// Window exports
window.AT = AT;
window._execQueue = _execQueue;
window._pendingClose = _pendingClose;
