// Zeus v122 — trading/positions.js
// Position management, open/close handlers
'use strict';

// On position opened
function onPositionOpened(pos, source) {
  if (!pos || !pos.id) return;
  try {
    // Dedupe: never attach same position twice
    const idKey = String(pos.id);
    if (DSL._attachedIds.has(idKey)) return;
    DSL._attachedIds.add(idKey);

    // Initialize DSL tracking entry — ensure all fields even if entry exists (race condition fix)
    const _initKey = String(pos.id);
    DSL.positions[_initKey] = DSL.positions[_initKey] || {};
    const _d = DSL.positions[_initKey];
    if (_d.active == null) _d.active = false;
    if (_d.pivotLeft == null) _d.pivotLeft = null;
    if (_d.pivotRight == null) _d.pivotRight = null;
    if (_d.impulseVal == null) _d.impulseVal = null;
    if (_d.yellowLine == null) _d.yellowLine = null;
    if (_d.originalSL == null) _d.originalSL = pos.sl ?? null;
    if (_d.originalTP == null) _d.originalTP = pos.tp ?? null;
    if (_d.currentSL == null) _d.currentSL = pos.sl ?? null;
    if (!Array.isArray(_d.log)) _d.log = [];
    if (_d.source == null) _d.source = source || 'unknown';
    if (_d.attachedTs == null) _d.attachedTs = Date.now();
    // Immediate DSL UI update — [PATCH DSL-ALL] include manual paper + live
    const activePosns = [
      ...(TP.demoPositions || []),
      ...(TP.livePositions || [])
    ].filter(p => !p.closed);
    if (typeof renderDSLWidget === 'function') {
      try { renderDSLWidget(activePosns); } catch (_) { }
    }
    if (typeof renderBrainCockpit === 'function') {
      try { setTimeout(renderBrainCockpit, 0); } catch (_) { }
    }
    atLog('info', '[DSL] DSL attached: ' + (pos.sym || '?') + ' ' + (pos.side || '?') + ' @$' + (pos.entry || '?') + ' [' + (source || '?') + ']');
    if (typeof aubBBSnapshot === 'function') aubBBSnapshot('DSL_ATTACH', { sym: pos.sym, side: pos.side, source });
  } catch (e) {
    console.warn('[DSL attach failed]', e);
  }
}


// On trade executed overlay
function onTradeExecuted(pos) {
  if (!pos) return;
  const sym = (pos.sym || 'BTC').replace('USDT', '');
  const dir = pos.side || 'LONG';
  const mode = (S.mode || 'assist').toUpperCase();
  const score = BM?.entryScore || pos.score || '—';
  const price = pos.entry ? fP(pos.entry) : '—';
  const tf1 = PROFILE_TF?.[S.profile || 'fast']?.trigger || S.triggerTF || '5m';
  const tf2 = PROFILE_TF?.[S.profile || 'fast']?.context || S.contextTF || '15m';
  const isLive = pos.isLive;
  const isSim = AT.mode === 'demo';
  const simTag = isLive
    ? `<div class="zeus-exec-sim">LIVE TRADE</div>`
    : `<div class="zeus-exec-sim">SIMULATION</div>`;

  const html = `
    <div class="zeus-exec-label">${_ZI.bolt} ZEUS EXECUTION</div>
    <div class="zeus-exec-title">${typeof escHtml === 'function' ? escHtml(dir) : dir} ${typeof escHtml === 'function' ? escHtml(sym) : sym}</div>
    <div class="zeus-exec-info">
      ${typeof escHtml === 'function' ? escHtml(mode) : mode} · SCORE: ${typeof escHtml === 'function' ? escHtml(String(score)) : score}<br>
      SIGNAL TF: ${typeof escHtml === 'function' ? escHtml(tf1) : tf1} / ${typeof escHtml === 'function' ? escHtml(tf2) : tf2}<br>
      PRICE: $${price}
    </div>
    <div class="zeus-exec-corner">ENGINE: ${typeof escHtml === 'function' ? escHtml(mode) : mode}</div>
    ${simTag}`;

  _queueExecOverlay(html, 'entry', 2500);

  // Orb pulse green
  const core = el('zncCore');
  if (core) {
    core.style.filter = 'brightness(2.2) drop-shadow(0 0 18px #00ff9c)';
    setTimeout(() => { if (core) core.style.filter = ''; }, 600);
  }
  // Also trigger old cinematic (shock ring)
  triggerExecCinematic(dir, sym);
}

// ── EXIT POPUP ───────────────────────────────────────────
function onTradeClosed(result) {
  if (!result) return;
  const sym = (result.sym || result.symbol || 'BTC').replace('USDT', '');
  const pnl = typeof result.pnl === 'number' ? result.pnl : 0;
  const pnlStr = (pnl >= 0 ? '+' : '') + '$' + pnl.toFixed(2);
  const pct = result.percent != null ? result.percent : (result.size ? (pnl / result.size * 100) : 0);
  const pctStr = (pct >= 0 ? '+' : '') + pct.toFixed(2) + '%';
  const dur = result.duration || '—';
  const reason = result.reason || 'CLOSE';
  const isProfit = pnl >= 0;
  const cssClass = isProfit ? 'exit-profit' : 'exit-loss';
  const isLive = result.isLive;
  const simTag = isLive
    ? `<div class="zeus-exec-sim">LIVE TRADE</div>`
    : `<div class="zeus-exec-sim">SIMULATION</div>`;

  const html = `
    <div class="zeus-exec-label">ZEUS EXIT</div>
    <div class="zeus-exec-title">${typeof escHtml === 'function' ? escHtml(sym) : sym} CLOSED</div>
    <div class="zeus-exec-sub">${pnlStr} · ${pctStr}</div>
    <div class="zeus-exec-info">
      Duration: ${typeof escHtml === 'function' ? escHtml(dur) : dur}<br>
      Reason: ${typeof escHtml === 'function' ? escHtml(reason.toUpperCase()) : reason.toUpperCase()}
    </div>
    ${simTag}`;

  _queueExecOverlay(html, cssClass, 2200);

  // Flash on loss
  if (!isProfit) {
    document.body.style.boxShadow = 'inset 0 0 60px #ff335540';
    setTimeout(() => { document.body.style.boxShadow = ''; }, 400);
  }

  // [Level 5] Regime performance memory — record R-multiple for this trade
  try {
    var _ph = (BM.macro && BM.macro.phase) ? BM.macro.phase : 'NEUTRAL';
    // Approximate R: use pnl / size as proxy if _posR not available at this point
    var _R = (result.size && result.size > 0) ? pnl / result.size : (isProfit ? 1 : -1);
    perfRecordTrade(_ph, _R);
    if (DEV.enabled) devLog('[Perf] Trade closed — phase:' + _ph + ' R:' + _R.toFixed(2) + ' wins:' + (BM.performance.byRegime[_ph] || {}).wins + '/' + (BM.performance.byRegime[_ph] || {}).trades, 'info');
  } catch (_) { }
}

// ── CINEMATIC EXECUTION EFFECT ────────────────────────────────────

// Exec cinematic
function triggerExecCinematic(side, sym) {
  // Banner
  const banner = document.createElement('div');
  banner.className = 'exec-banner' + (side === 'SHORT' ? ' short' : '');
  banner.innerHTML = _ZI.bolt + ` ZEUS EXECUTION: ${side} ${sym}`;
  document.body.appendChild(banner);
  setTimeout(() => { try { document.body.removeChild(banner); } catch (_) { } }, 3200);

  // Shock ring on SVG
  const shock = el('zncShock');
  if (shock) {
    shock.setAttribute('r', '30');
    shock.setAttribute('opacity', '0.9');
    shock.setAttribute('stroke', side === 'LONG' ? '#39ff14' : '#ff3355');
    // Animate: expand and fade
    let r = 30, op = 0.9;
    const shockAnim = () => {
      r += 5; op -= 0.05;
      if (op <= 0) { shock.setAttribute('opacity', '0'); return; }
      shock.setAttribute('r', r);
      shock.setAttribute('opacity', op);
      requestAnimationFrame(shockAnim);
    };
    requestAnimationFrame(shockAnim);
  }

  // Orb thump — brightness spike
  const core2 = el('zncCore');
  if (core2) {
    core2.style.filter = 'brightness(2.5) drop-shadow(0 0 20px ' + (side === 'LONG' ? '#39ff14' : '#ff3355') + ')';
    setTimeout(() => { if (core2) core2.style.filter = ''; }, 500);
  }

  // Update receipt
  const mode = S.mode?.toUpperCase() || 'AUTO';
  const score = BM.entryScore || 0;
  const trig = BM.sweep?.type !== 'none' ? 'Sweep+Reclaim' : 'Displacement';
  const tfMap = PROFILE_TF?.[S.profile || 'fast'];
  if (!tfMap) return;
  ['rec-mode', 'rec-score', 'rec-trigger', 'rec-tf'].forEach((id, i) => {
    const e = el(id);
    if (e) e.textContent = [mode, score, trig, tfMap.trigger + '/' + tfMap.context][i];
  });
}

// ── ALIAS & LOOP ──────────────────────────────────────────────────
// FIX 19: dirty flag cache — skip DOM write if value unchanged
