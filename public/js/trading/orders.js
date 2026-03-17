// Zeus v122 — trading/orders.js  
// Order execution flow, confirm close
'use strict';

// Exec overlay
function _showExecOverlay(html, cssClass, duration) {
  const div = document.createElement('div');
  div.className = 'zeus-exec-overlay ' + cssClass;
  div.innerHTML = html;
  document.body.appendChild(div);
  requestAnimationFrame(() => requestAnimationFrame(() => div.classList.add('show')));
  setTimeout(() => {
    div.classList.add('exit-anim');
    setTimeout(() => {
      try { document.body.removeChild(div); } catch(_) {}
      _execActive = false;
      if(_execQueue.length) { const next=_execQueue.shift(); _showExecOverlay(...next); }
    }, 350);
  }, duration || 2500);
}

function _queueExecOverlay(html, cssClass, duration) {
  if(_execActive) { _execQueue.push([html, cssClass, duration]); return; }
  _execActive = true;
  _showExecOverlay(html, cssClass, duration);
}

// ── ENTRY POPUP ──────────────────────────────────────────

// BM post close
function _dayKeyLocal(){
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth()+1).padStart(2,'0');
  const da = String(d.getDate()).padStart(2,'0');
  return `${y}-${m}-${da}`;
}

function _bmResetDailyIfNeeded(){
  const k = _dayKeyLocal();
  if (BM._dayKey !== k){
    BM._dayKey = k;
    BM.dailyTrades = 0;
    BM.dailyPnL = 0;
    BM.lossStreak = 0;
    AT.closedTradesToday = 0;
    // reset protect automat la schimbare zi
    BM.protectMode = false;
    BM.protectReason = '';
    atLog('info', `📅 Zi nouă (${k}) — dailyTrades/lossStreak/protect resetate automat`);
  }
}

// BM stats updated via postClose hook
function _bmPostClose(pos, reason) {
  // backward compat: dacă primul param e string, era vechiul apel fără pos
  if (typeof pos === 'string') { reason = pos; pos = null; }

  const isAT = !!(pos && pos.autoTrade);

  // IMPORTANT: dailyTrades = DOAR AutoTrade (nu Paper)
  if (isAT) BM.dailyTrades = (BM.dailyTrades||0) + 1;

  if(isAT) {
    if(reason && (reason.includes('SL') || reason.includes('DSL HIT') || reason.includes('LIQ'))) {
      BM.lossStreak = (BM.lossStreak||0) + 1;
    } else if(reason && reason.includes('TP')) {
      BM.lossStreak = 0;
    }
  }
  if(typeof AT !== 'undefined') AT.lastTradeTs = Date.now();
}


// ===== MODULE: EXECUTION =====
// ===================================================================
// ⚡ ZEUS AUTO TRADE ENGINE v1.0
// Logic: Confluence Score + Multi-Signal Confirmation + Risk Mgmt
// ===================================================================
// [MOVED TO TOP] AT

