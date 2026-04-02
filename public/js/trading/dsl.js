// Zeus v122 — trading/dsl.js
// Dynamic Stop Loss — brain logic, widget render, intervals
'use strict';

// ══════════════════════════════════════════════════════
// [DSL MAGNET] Per-position toggle
// ══════════════════════════════════════════════════════
function dslToggleMagnet(posId) {
  posId = String(posId);
  const pos = [...(TP.demoPositions || []), ...(TP.livePositions || [])].find(p => String(p.id) === posId);
  if (!pos) return;
  if (!pos.dslParams) pos.dslParams = {};
  pos.dslParams.magnetEnabled = !pos.dslParams.magnetEnabled;
  const on = pos.dslParams.magnetEnabled;
  if (!Array.isArray(pos.dslHistory)) pos.dslHistory = [];
  pos.dslHistory.push({ ts: Date.now(), msg: on ? 'MAGNET ON' : 'MAGNET OFF' });
  if (typeof ZState !== 'undefined') ZState.save();
}

// ══════════════════════════════════════════════════════
// [DSL MAGNET] Pure helper — computes snap candidate
// Returns { applied, snappedPrice, source, confidence, reason }
// NEVER writes state. Safe to call in any context.
// ══════════════════════════════════════════════════════
function _computeDslMagnetSnap(basePrice, pos, side, kind, ctx) {
  const out = { applied: false, snappedPrice: basePrice, source: '', confidence: 0, reason: '' };
  try {
    const isLong = side === 'LONG';
    const cur = ctx.cur;
    if (!cur || cur <= 0 || !Number.isFinite(basePrice) || basePrice <= 0) return out;

    // ATR% as proximity threshold (use existing BRAIN.regimeAtrPct, fallback 1%)
    const atrPct = (typeof BRAIN !== 'undefined' ? BRAIN.regimeAtrPct : 0) || 1;
    // Max snap distance = 0.2 * ATR%  (as fraction of price)
    const maxSnapDist = cur * atrPct / 100 * 0.2;
    // Min safety distance from current price = 0.1% of price
    const minSafetyDist = cur * 0.001;

    // Gather candidate levels from S.magnets (liquidity) + BM.structure
    const magnets = (typeof S !== 'undefined' && S.magnets) ? S.magnets : { above: [], below: [] };
    const candidates = [];

    // For PL (stop-loss protection): look for levels that TIGHTEN protection
    // LONG PL: we want levels BELOW current price but ABOVE basePrice (tighter SL)
    // SHORT PL: we want levels ABOVE current price but BELOW basePrice (tighter SL)
    if (kind === 'PL') {
      const pool = isLong ? (magnets.below || []) : (magnets.above || []);
      pool.forEach(function (m) {
        if (!m || !m.price || !Number.isFinite(m.price) || m.price <= 0) return;
        const lvl = m.price;
        // Must be tighter than base (closer to cur)
        const isTighter = isLong ? (lvl > basePrice) : (lvl < basePrice);
        if (!isTighter) return;
        // Must maintain minimum distance from current price
        const distFromCur = Math.abs(cur - lvl);
        if (distFromCur < minSafetyDist) return;
        // Must be within maxSnapDist of base
        const distFromBase = Math.abs(lvl - basePrice);
        if (distFromBase > maxSnapDist) return;
        candidates.push({ price: lvl, source: 'liq', dist: distFromBase });
      });
    }

    if (!candidates.length) return out;

    // Pick closest candidate to base
    candidates.sort(function (a, b) { return a.dist - b.dist; });
    const best = candidates[0];

    // Confidence: based on proximity (closer = higher confidence) + atmosphere
    let conf = Math.round(Math.max(20, 100 - (best.dist / maxSnapDist * 80)));
    // Reduce confidence in toxic atmosphere
    const atmos = (typeof BM !== 'undefined' && BM.atmosphere) ? BM.atmosphere : null;
    if (atmos && !atmos.allow) conf = Math.max(10, conf - 30);
    // Reduce confidence if sweep active (volatile environment)
    const sweep = (typeof BM !== 'undefined' && BM.sweep) ? BM.sweep : null;
    if (sweep && sweep.type && sweep.type !== 'none') conf = Math.max(10, conf - 15);

    // Only apply if confidence >= 30
    if (conf < 30) return out;

    out.applied = true;
    out.snappedPrice = best.price;
    out.source = best.source;
    out.confidence = conf;
    out.reason = kind + ' snap ' + (isLong ? 'up' : 'dn') + ' $' + (typeof fP === 'function' ? fP(basePrice) : basePrice.toFixed(2)) + '→$' + (typeof fP === 'function' ? fP(best.price) : best.price.toFixed(2)) + ' (' + best.source + ' conf:' + conf + ')';
    return out;
  } catch (e) {
    // Fail safe — return unmodified base
    return out;
  }
}

// DSL toggle + assist
function toggleDSL() {
  const _mode = (S.mode || 'assist').toLowerCase();
  // AUTO: DSL is AI-controlled — user cannot toggle
  if (_mode === 'auto') {
    atLog('info', '[AI] AI controls DSL in AUTO — nu poți schimba manual');
    toast('AUTO: DSL e controlat de AI', 0, _ZI.robot);
    return;
  }
  // ASSIST: allow but log clearly
  atLog('info', DSL.enabled ? '[WARN] ASSIST: DSL oprit de user' : '[OK] ASSIST: DSL pornit de user (USER DSL)');
  DSL.enabled = !DSL.enabled;
  S.dsl.active = DSL.enabled;   // keep S.* in sync
  // [FIX C7] Clear DSL intervals when disabled, restart when enabled
  if (!DSL.enabled && typeof stopDSLIntervals === 'function') { stopDSLIntervals(); }
  if (DSL.enabled && typeof startDSLIntervals === 'function' && !DSL.checkInterval) { startDSLIntervals(); }
  const btn = el('dslToggleBtn');
  const dot = el('dslStatusDot');
  if (btn) { btn.textContent = DSL.enabled ? 'DSL ENGINE ON' : 'DSL ENGINE OFF'; btn.className = 'dsl-toggle' + (DSL.enabled ? '' : ' off'); }
  if (dot) { dot.style.color = DSL.enabled ? '#00ffcc' : '#333'; dot.style.background = DSL.enabled ? '#00ffcc' : '#333'; }
  atLog('info', DSL.enabled ? '[DSL] Dynamic SL ACTIV — Brain urmareste pozitiile' : '[WARN] Dynamic SL OPRIT');
  brainThink(DSL.enabled ? 'ok' : 'bad', DSL.enabled ? _ZI.tgt + ' DSL activat — trailing brain pornit' : 'DSL oprit');
  dslUpdateBanner();
}

// ── ASSIST ARM TOGGLE ────────────────────────────────────────
function toggleAssistArm() {
  const _m = (S.mode || 'assist').toLowerCase();
  if (_m !== 'assist') { toast('ARM disponibil doar în ASSIST mode'); return; }
  S.assistArmed = !S.assistArmed;
  // [FIX] Sync ARM_ASSIST object used by isArmAssistValid() in AutoTrade
  if (typeof ARM_ASSIST !== 'undefined') {
    ARM_ASSIST.armed = S.assistArmed;
    ARM_ASSIST.ts = S.assistArmed ? Date.now() : 0;
  }
  _syncDslAssistUI();
  brainThink(S.assistArmed ? 'ok' : 'info', S.assistArmed ? _ZI.dYlw + ' ASSIST ARMAT — DSL va executa la semnal' : _ZI.unlk + ' ASSIST dezarmat — DSL în preview only');
  dslUpdateBanner();
}

function _syncDslAssistUI() {
  const _m = (S.mode || 'assist').toLowerCase();
  const overlay = el('dslLockOverlay');
  const assistBar = el('dslAssistBar');
  const armBtn = el('dslAssistArmBtn');
  const armStatus = el('dslAssistStatus');
  const dslConf = document.querySelectorAll('.dsl-config input, .dsl-config select');

  // Always hide global overlay — per-position lock replaces it
  if (overlay) overlay.classList.remove('show');

  if (_m === 'auto') {
    // AUTO: panel stays visible, inputs enabled for NEW position defaults
    // Per-position lock is handled in renderDSLWidget
    if (assistBar) assistBar.classList.remove('show');
    const dz = el('dslZone');
    if (dz) dz.style.pointerEvents = '';
    dslConf.forEach(i => { i.disabled = false; i.style.pointerEvents = ''; });
    const dslBtn2 = el('dslToggleBtn');
    if (dslBtn2) { dslBtn2.disabled = false; dslBtn2.textContent = DSL.enabled ? 'DSL ENGINE ON' : 'DSL ENGINE OFF'; dslBtn2.title = 'Global DSL defaults for new positions'; }
  } else if (_m === 'assist') {
    // Unlock inputs, show assist arm bar
    if (assistBar) assistBar.classList.add('show');
    const dz = el('dslZone');
    if (dz) dz.style.pointerEvents = '';
    dslConf.forEach(i => { i.disabled = false; i.style.pointerEvents = ''; });
    const dslBtn2 = el('dslToggleBtn');
    if (dslBtn2) { dslBtn2.disabled = false; dslBtn2.textContent = DSL.enabled ? 'DSL ENGINE ON' : 'DSL ENGINE OFF'; dslBtn2.title = ''; }
    if (armBtn) {
      armBtn.innerHTML = S.assistArmed ? _ZI.dYlw + ' ASSIST ARMAT' : _ZI.lock + ' ARM ASSIST';
      armBtn.className = 'dsl-assist-arm' + (S.assistArmed ? ' armed' : '');
    }
    if (armStatus) {
      armStatus.textContent = S.assistArmed ? 'ASSIST ARMAT — DSL va executa la semnal' : 'Dezarmat — DSL în preview only (fără execuție)';
    }
  } else {
    // Fallback (should not happen — no manual mode)
    if (assistBar) assistBar.classList.remove('show');
    const dz = el('dslZone');
    if (dz) dz.style.pointerEvents = '';
    dslConf.forEach(i => { i.disabled = false; i.style.pointerEvents = ''; });
    const dslBtn2 = el('dslToggleBtn');
    if (dslBtn2) { dslBtn2.disabled = false; dslBtn2.textContent = DSL.enabled ? 'DSL ENGINE ON' : 'DSL ENGINE OFF'; dslBtn2.title = ''; }
  }
}

// ─── INIT BUBBLES (neon water cooling effect) ────────────────
function initDSLBubbles() {
  const bg = el('dslLiquidBg');
  const cascade = el('dslCascade');
  if (!bg || !cascade) return;

  // Floating bubbles
  bg.innerHTML = Array.from({ length: 12 }, (_, i) => {
    const size = 4 + Math.random() * 8;
    const left = 5 + Math.random() * 90;
    const dur = 3 + Math.random() * 5;
    const delay = Math.random() * 4;
    const col = Math.random() > .5 ? '#00ffcc' : '#0066ff';
    return `<div class="dsl-bubble" style="width:${size}px;height:${size}px;left:${left}%;background:${col};opacity:.15;animation-duration:${dur}s;animation-delay:${delay}s;box-shadow:0 0 ${size}px ${col}44"></div>`;
  }).join('');

  // Cascade drops
  cascade.innerHTML = Array.from({ length: 20 }, (_, i) => {
    const h = 4 + Math.random() * 10;
    const dur = 0.4 + Math.random() * 0.6;
    const del = Math.random() * 1.5;
    const col = Math.random() > .4 ? '#00ffcc' : '#0088ff';
    return `<div class="dsl-drop" style="height:${h}px;background:${col};animation-duration:${dur}s;animation-delay:${del}s;opacity:.7"></div>`;
  }).join('');
}


// DSL Brain logic
// ── DSL Safety Guard: reject invalid DSL price values ──
function _dslSafePrice(val, fallback, label) {
  if (!Number.isFinite(val) || val <= 0 || val > 1e12) {
    console.warn('[DSL GUARD] Invalid', label, ':', val, '→ fallback', fallback);
    return fallback;
  }
  return val;
}

// ── DSL Parameter Sanitizer (NON-BLOCKING) ──
// Validates and clamps DSL percentages to sane ranges.
// Never blocks a trade. Only corrects bad DSL params.
// Returns { openDslPct, pivotLeftPct, pivotRightPct, impulseVPct, corrected: bool }
function _dslSanitizeParams(raw, posId) {
  const DEFAULTS = { openDslPct: 40, pivotLeftPct: 0.8, pivotRightPct: 1.0, impulseVPct: 2.0 };
  const CLAMPS = {
    openDslPct: { min: 0.01, max: 100 },
    pivotLeftPct: { min: 0.01, max: 100 },
    pivotRightPct: { min: 0.01, max: 100 },
    impulseVPct: { min: 0.01, max: 100 },
  };
  let corrected = false;
  const fixes = [];
  const out = {};

  for (const key of ['openDslPct', 'pivotLeftPct', 'pivotRightPct', 'impulseVPct']) {
    let v = raw[key];
    const c = CLAMPS[key];
    const d = DEFAULTS[key];
    // Replace NaN / Infinity / non-number with default
    if (!Number.isFinite(v) || v === null || v === undefined) {
      fixes.push(`${key}: ${v}→${d} (invalid)`);
      v = d; corrected = true;
    }
    // Clamp to range
    if (v < c.min) { fixes.push(`${key}: ${v}→${c.min} (below min)`); v = c.min; corrected = true; }
    if (v > c.max) { fixes.push(`${key}: ${v}→${c.max} (above max)`); v = c.max; corrected = true; }
    out[key] = v;
  }
  // Rule: impulse must be > pivotRight (otherwise IV would never trigger)
  if (out.impulseVPct <= out.pivotRightPct) {
    const safe = Math.round((out.pivotRightPct + 0.01) * 100) / 100;
    out.impulseVPct = Math.min(safe, CLAMPS.impulseVPct.max);
    // [FIX M2] If still deadlocked (PR at max), reduce PR to make room for IV > PR
    if (out.impulseVPct <= out.pivotRightPct) {
      out.pivotRightPct = Math.round((out.impulseVPct - 0.01) * 100) / 100;
      fixes.push(`pivotRightPct: →${out.pivotRightPct} (reduced for IV>PR)`);
    }
    fixes.push(`impulseVPct: ${out.impulseVPct} (must exceed PR%)`);
    corrected = true;
  }
  if (corrected) {
    const msg = `DSL SANITIZE [${posId}]: ` + fixes.join(' | ');
    console.warn(msg);
    if (typeof atLog === 'function') atLog('warn', msg);
  }
  out.corrected = corrected;
  return out;
}

function runDSLBrain() {
  // [AT-UNIFY] When server AT is active, server DSL handles SL management.
  // We still need to bridge server DSL state into DSL.positions for rendering.
  if (window._serverATEnabled) {
    const allOpenPosns = [
      ...(TP.demoPositions || []),
      ...(TP.livePositions || [])
    ].filter(p => !p.closed);
    if (!allOpenPosns.length) { renderDSLWidget([]); return; }

    // Separate AT positions (server-controlled DSL) from manual positions (client DSL)
    const _atPositions = allOpenPosns.filter(p => !!p.autoTrade && p._dsl);
    const _manualPositions = allOpenPosns.filter(p => !p.autoTrade || !p._dsl);

    // Bridge server DSL state for AT positions
    _atPositions.forEach(pos => {
      const _dslKey = String(pos.id);
      const serverDsl = pos._dsl;
      DSL.positions[_dslKey] = DSL.positions[_dslKey] || {};
      const dsl = DSL.positions[_dslKey];
      const cur = pos.sym === S.symbol ? S.price : (allPrices[pos.sym] || wlPrices[pos.sym]?.price || pos.entry);

      // [ZT-AUD-008] Stale detection — warn if server DSL hasn't ticked in 60s
      if (serverDsl.lastTickTs && Date.now() - serverDsl.lastTickTs > 60000) {
        dsl._stale = true;
        if (!dsl._staleLogged) {
          dsl._staleLogged = true;
          if (typeof atLog === 'function') atLog('warn', '[STALE] DSL state stale for pos ' + _dslKey + ' (>' + Math.round((Date.now() - serverDsl.lastTickTs) / 1000) + 's)');
        }
      } else {
        dsl._stale = false;
        dsl._staleLogged = false;
      }
      // Bridge server DSL state into client DSL.positions
      dsl.active = !!serverDsl.active;
      dsl.progress = serverDsl.progress || 0;
      dsl.currentSL = serverDsl.currentSL || pos.sl;
      dsl.originalSL = serverDsl.originalSL || pos.sl;
      dsl.originalTP = dsl.originalTP || pos.tp;
      dsl.pivotLeft = serverDsl.pivotLeft || null;
      dsl.pivotRight = serverDsl.pivotRight || null;
      dsl.impulseVal = serverDsl.impulseVal || null;
      dsl._activationPrice = serverDsl.activationPrice || 0;
      dsl.ttpArmed = serverDsl.ttpArmed || false;
      dsl.ttpPeak = serverDsl.ttpPeak || 0;
      dsl.impulseTriggered = (serverDsl.phase === 'IMPULSE');
      dsl.yellowLine = dsl.active ? cur : null;
      // Compute visual bar values locally (server doesn't send these)
      dsl._barGreenPct = serverDsl.progress || 0;
      dsl._barYellowPct = 100;
      // Build log from server lastLog
      if (!Array.isArray(dsl.log)) dsl.log = [];
      if (serverDsl.lastLog && (!dsl.log.length || dsl.log[dsl.log.length - 1].msg !== serverDsl.lastLog)) {
        dsl.log.push({ ts: Date.now(), msg: serverDsl.lastLog });
        if (dsl.log.length > 20) dsl.log = dsl.log.slice(-20);
      }
    });

    // Cleanup DSL states for closed positions
    Object.keys(DSL.positions).forEach(id => {
      if (!allOpenPosns.find(p => String(p.id) === String(id))) delete DSL.positions[id];
    });

    // Manual positions need client-side DSL logic (server only runs DSL for AT)
    if (!_manualPositions.length || !Number.isFinite(S.price) || S.price <= 0
        || _SAFETY.dataStalled || _SAFETY.isReconnecting) {
      renderDSLWidget(allOpenPosns);
      renderATPositions();
      return;
    }

    // Run client-side DSL engine on manual positions, then render ALL
    _runClientDSLOnPositions(_manualPositions);
    renderDSLWidget(allOpenPosns);
    renderATPositions();
    return;
  }
  if (!DSL.enabled) return;
  // ── 6. DSL SAFETY LOCK: no SL move if data invalid ──
  if (!Number.isFinite(S.price) || S.price <= 0) return;
  if (_SAFETY.dataStalled || _SAFETY.isReconnecting) return;
  // [PATCH DSL-ALL] Include toate pozițiile deschise: auto + manual paper + live
  const allOpenPosns = [
    ...(TP.demoPositions || []),
    ...(TP.livePositions || [])
  ].filter(p => !p.closed);
  if (!allOpenPosns.length) { renderDSLWidget([]); return; }

  _runClientDSLOnPositions(allOpenPosns);

  // Cleanup DSL states pentru pozitii inchise
  // [PATCH DSL-ALL] Verifică față de allOpenPosns (include manual + live)
  Object.keys(DSL.positions).forEach(id => {
    if (!allOpenPosns.find(p => String(p.id) === String(id))) {
      delete DSL.positions[id];
      if (DSL._attachedIds) DSL._attachedIds.delete(String(id));
    }
  });

  renderDSLWidget(allOpenPosns);
  renderATPositions();
}

// ── Client-side DSL engine — runs activation + phases on given positions ──
// Used for: demo positions (always), manual live positions (when serverAT is active)
function _runClientDSLOnPositions(positions) {
  // Global DSL defaults (used for positions without per-position params)
  // [P1] Read from TC (server-safe), DOM fallback
  const _globalDslPct = (typeof TC !== 'undefined' && Number.isFinite(TC.dslActivatePct)) ? TC.dslActivatePct : (parseFloat(el('dslActivatePct')?.value) || 0.50);
  const _globalPivotL = (typeof TC !== 'undefined' && Number.isFinite(TC.dslTrailPct)) ? TC.dslTrailPct : (parseFloat(el('dslTrailPct')?.value) || 0.70);
  const _globalPivotR = (typeof TC !== 'undefined' && Number.isFinite(TC.dslTrailSusPct)) ? TC.dslTrailSusPct : (parseFloat(el('dslTrailSusPct')?.value) || 1.00);
  const _globalImpulseV = (typeof TC !== 'undefined' && Number.isFinite(TC.dslExtendPct)) ? TC.dslExtendPct : (parseFloat(el('dslExtendPct')?.value) || 1.30);

  positions.forEach(pos => {
    // Per-position DSL params (snapshot at open) or fallback to global
    const _pp = pos.dslParams || {};
    const _rawParams = {
      openDslPct: _pp.openDslPct ?? _globalDslPct,
      pivotLeftPct: _pp.pivotLeftPct ?? _globalPivotL,
      pivotRightPct: _pp.pivotRightPct ?? _globalPivotR,
      impulseVPct: _pp.impulseVPct ?? _globalImpulseV,
    };
    const _san = _dslSanitizeParams(_rawParams, pos.id);
    // [PATCH3] Write corrected params back to pos.dslParams to stop repeated sanitize spam
    if (_san.corrected) {
      if (!pos.dslParams) pos.dslParams = {};
      pos.dslParams.openDslPct = _san.openDslPct;
      pos.dslParams.pivotLeftPct = _san.pivotLeftPct;
      pos.dslParams.pivotRightPct = _san.pivotRightPct;
      pos.dslParams.impulseVPct = _san.impulseVPct;
    }
    const openDSLpct = _san.openDslPct;
    const pivotLeftPct = _san.pivotLeftPct;
    const pivotRightPct = _san.pivotRightPct;
    const impulseValPct = _san.impulseVPct;

    // Per-position control mode decisions (fix: infer from autoTrade if missing)
    const _posMode = (pos.controlMode || (pos.autoTrade ? (pos.sourceMode || 'auto') : 'paper')).toLowerCase();
    // Determine if this position can move SL
    // AUTO positions: always can move SL
    // ASSIST positions: only if armed
    // PAPER positions: always can move SL (user has full control)
    // USER override: BLOCKED — manual control means AI does NOT modify DSL
    const _canMoveSL = _posMode === 'auto' || _posMode === 'paper'
      || (_posMode === 'assist' && S.assistArmed);
    // [FIX v85 B7] Folosim allPrices (mai frecvent actualizat) în loc de wlPrices direct
    const cur = pos.sym === S.symbol ? S.price : (allPrices[pos.sym] || wlPrices[pos.sym]?.price || pos.entry);
    if (!cur || cur <= 0) return;
    // [PATCH6 FIX] Snapshot _restored flag BEFORE clearing — PL exit check needs the original value
    const _wasRestored = !!pos._restored;
    if (pos._restored) { pos._restored = false; }
    const isLong = pos.side === 'LONG';

    // ── INIT DSL state ──
    // [FIX v85 B5] Normalizăm cheia la String pentru consistență (p.id poate fi număr sau string)
    const _dslKey = String(pos.id);
    DSL.positions[_dslKey] = DSL.positions[_dslKey] || {};
    const _rb = DSL.positions[_dslKey];
    if (_rb.active == null) _rb.active = false;
    if (_rb.pivotLeft == null) _rb.pivotLeft = null;
    if (_rb.pivotRight == null) _rb.pivotRight = null;
    if (_rb.impulseVal == null) _rb.impulseVal = null;
    if (_rb.yellowLine == null) _rb.yellowLine = null;
    if (_rb.originalSL == null) _rb.originalSL = pos.sl;
    if (_rb.originalTP == null) _rb.originalTP = pos.tp;
    if (_rb.currentSL == null) _rb.currentSL = pos.sl;
    if (!Array.isArray(_rb.log)) _rb.log = [];
    // [FIX L4+C2] Cap dslHistory + dsl.log — aligned with _dslTrimAll caps
    if (!Array.isArray(pos.dslHistory)) pos.dslHistory = [];
    if (pos.dslHistory.length > 30) pos.dslHistory = pos.dslHistory.slice(-30);
    if (_rb.log.length > 20) _rb.log = _rb.log.slice(-20);

    const dsl = DSL.positions[_dslKey];

    // ── DSL activation target (STORED, not recalculated per tick) ──
    // Initialize target on first engine run if not yet stored
    if (!pos.dslParams) pos.dslParams = {};
    if (!(pos.dslParams.dslTargetPrice > 0)) {
      pos.dslParams.dslTargetPrice = isLong
        ? cur * (1 + openDSLpct / 100)
        : cur * (1 - openDSLpct / 100);
    }
    let _storedTarget = pos.dslParams.dslTargetPrice;

    // [FIX BUG2] Guard: if target is on wrong side of entry, recalculate from entry
    const _targetWrong = isLong ? (_storedTarget <= pos.entry) : (_storedTarget >= pos.entry);
    if (_targetWrong) {
      _storedTarget = isLong
        ? pos.entry * (1 + openDSLpct / 100)
        : pos.entry * (1 - openDSLpct / 100);
      pos.dslParams.dslTargetPrice = _storedTarget;
    }

    // Progress & bar: 0% = entry, 100% = storedTarget
    const _entryToTarget = isLong ? (_storedTarget - pos.entry) : (pos.entry - _storedTarget);
    const _entryToCur = isLong ? (cur - pos.entry) : (pos.entry - cur);
    let progress = 0;
    if (_entryToTarget > 0) {
      progress = Math.max(0, Math.min(100, (_entryToCur / _entryToTarget) * 100));
    }
    dsl.progress = progress;
    dsl._activationPrice = _storedTarget;
    dsl._barGreenPct = progress;
    dsl._barYellowPct = 100;

    // ══════════════════════════════════════════════════════
    // FAZA 1: ACTIVARE — cand live_price >= storedTarget
    // ══════════════════════════════════════════════════════
    const _activationHit = isLong ? (cur >= _storedTarget) : (cur <= _storedTarget);
    if (_canMoveSL && !dsl.active && _activationHit) {
      dsl.active = true;
      dsl.yellowLine = cur;  // linia galbena porneste de la pretul de activare

      // Pivot Left = SL nou, fix in spatele DSL anchor la pivotLeftPct%
      dsl.pivotLeft = isLong
        ? cur * (1 - pivotLeftPct / 100)
        : cur * (1 + pivotLeftPct / 100);

      // Pivot Right = in fata DSL anchor la pivotRightPct%
      dsl.pivotRight = isLong
        ? cur * (1 + pivotRightPct / 100)
        : cur * (1 - pivotRightPct / 100);

      // Impulse = impulseValPct% in fata DSL anchor (NOT from Pivot Right)
      dsl.impulseVal = isLong
        ? cur * (1 + impulseValPct / 100)
        : cur * (1 - impulseValPct / 100);

      // Safety guards
      dsl.pivotLeft = _dslSafePrice(dsl.pivotLeft, pos.sl, 'PL-init');
      dsl.pivotRight = _dslSafePrice(dsl.pivotRight, cur, 'PR-init');
      dsl.impulseVal = _dslSafePrice(dsl.impulseVal, cur, 'IV-init');

      // [DSL MAGNET] Hook A — Phase 1 activation post-calc refinement
      const _magnetOn_A = !!(pos.dslParams && pos.dslParams.magnetEnabled);
      if (_magnetOn_A) {
        const _magSnap = _computeDslMagnetSnap(dsl.pivotLeft, pos, pos.side, 'PL', { cur: cur });
        if (_magSnap.applied) {
          const _preMag = dsl.pivotLeft;
          dsl.pivotLeft = _magSnap.snappedPrice;
          dsl.pivotLeft = _dslSafePrice(dsl.pivotLeft, _preMag, 'PL-mag-A');
          // [FIX BUG4] Monotonic guard at Phase 1: magnet cannot weaken PL beyond original SL
          if (isLong) { dsl.pivotLeft = Math.max(dsl.pivotLeft, pos.sl); }
          else { dsl.pivotLeft = Math.min(dsl.pivotLeft, pos.sl); }
          dsl.log.push({ ts: Date.now(), msg: '[MAG-A] ' + _magSnap.reason });
          if (!Array.isArray(pos.dslHistory)) pos.dslHistory = [];
          pos.dslHistory.push({ ts: Date.now(), msg: '[MAG] ' + _magSnap.reason });
        }
        // Store preview for UI even when not applied
        dsl._magnetPreview = _magSnap;
      } else {
        dsl._magnetPreview = null;
      }

      // Pivot Left devine noul SL nativ (inlocuieste SL-ul original)
      dsl.currentSL = dsl.pivotLeft;

      dsl.log.push({ ts: Date.now(), msg: `DSL activat @$${fP(cur)} | PL=$${fP(dsl.pivotLeft)} | PR=$${fP(dsl.pivotRight)} | IV=$${fP(dsl.impulseVal)}` });
      // Push to per-position history journal
      if (!Array.isArray(pos.dslHistory)) pos.dslHistory = [];
      pos.dslHistory.push({ ts: Date.now(), msg: `[DSL] activated @$${fP(cur)} — SL→$${fP(dsl.pivotLeft)}` });
      // [P0.4] Decision log — DSL activation
      if (typeof DLog !== 'undefined') DLog.record('dsl_move', { event: 'activate', sym: pos.sym, side: pos.side, price: cur, pivotLeft: dsl.pivotLeft, pivotRight: dsl.pivotRight, impulseVal: dsl.impulseVal });
      atLog('buy', `[DSL] ACTIVAT: ${pos.sym.replace('USDT', '')} @$${fP(cur)} | Pivot Left(SL)=$${fP(dsl.pivotLeft)} | Impulse=$${fP(dsl.impulseVal)}`);
      brainThink('ok', _ZI.tgt + ` DSL activat pe ${pos.sym.replace('USDT', '')} — Pivot Left preia SL la $${fP(dsl.pivotLeft)}`);
    }

    // ══════════════════════════════════════════════════════
    // FAZA 2: ACTIV — update linie galbena + Pivot Right
    // Linia galbena si Pivot Right urmaresc pretul sus/jos
    // Pivot Left ramane FIX (nu se misca) pana la Impulse trigger
    // ══════════════════════════════════════════════════════
    if (dsl.active) {
      // Linia galbena urmareste pretul (sus si jos)
      dsl.yellowLine = cur;

      // Pivot Right sincronizat 100% cu linia galbena
      dsl.pivotRight = isLong
        ? cur * (1 + pivotRightPct / 100)
        : cur * (1 - pivotRightPct / 100);

      // ══════════════════════════════════════════════════════
      // PHASE 2.5: PIVOT LEFT EXIT — close position if price reaches PL
      // [PATCH6] Skip PL exit on first tick after restore — prevents false-close from stale restore values
      // [FIX C1] Gate behind _canMoveSL — only owner mode can trigger PL exit
      // ══════════════════════════════════════════════════════
      if (_canMoveSL && dsl.pivotLeft > 0 && !_wasRestored) {
        const _plHit = isLong ? (cur <= dsl.pivotLeft) : (cur >= dsl.pivotLeft);
        if (_plHit) {
          const _plReason = `DSL PL Exit @$${fP(cur)} (PL=$${fP(dsl.pivotLeft)})`;
          dsl.log.push({ ts: Date.now(), msg: _plReason });
          if (!Array.isArray(pos.dslHistory)) pos.dslHistory = [];
          pos.dslHistory.push({ ts: Date.now(), msg: _plReason });
          // [P0.4] Decision log — DSL PL exit
          if (typeof DLog !== 'undefined') DLog.record('dsl_move', { event: 'pl_exit', sym: pos.sym, side: pos.side, price: cur, pivotLeft: dsl.pivotLeft });
          atLog('sell', `[DSL] PL EXIT: ${pos.sym.replace('USDT', '')} ${pos.side} @$${fP(cur)}`);
          brainThink('info', _ZI.tgt + ` DSL PL exit: ${pos.sym.replace('USDT', '')} ${pos.side} @$${fP(cur)}`);
          toast(`DSL PL Exit: ${pos.sym.replace('USDT', '')} ${pos.side} @$${fP(cur)}`);
          if (pos.isLive && typeof closeLivePos === 'function') {
            closeLivePos(pos.id, _plReason);
            // [FIX BUG5] Update AT stats for DSL PL exit on live positions
            if (pos.autoTrade && typeof AT !== 'undefined') {
              const _dslPnl = typeof calcPosPnL === 'function' ? calcPosPnL(pos, cur) : 0;
              AT.totalPnL += _dslPnl; AT.dailyPnL += _dslPnl;
              if (Number.isFinite(_dslPnl)) { AT.realizedDailyPnL += _dslPnl; AT.closedTradesToday++; }
              if (_dslPnl >= 0) AT.wins++; else AT.losses++;
              if (typeof updateATStats === 'function') setTimeout(updateATStats, 50);
            }
          } else if (typeof closeDemoPos === 'function') {
            closeDemoPos(pos.id, _plReason);
          }
          return; // skip further processing for this closed position
        }
      }

      // ══════════════════════════════════════════════════════
      // FAZA 3: IMPULSE VALIDATION trigger (only if canMoveSL)
      // ══════════════════════════════════════════════════════
      if (_canMoveSL) {
        // [FIX BUG5] PR micro guard: skip impulse check if PR distance from cur < 0.05%
        const _prDistPct = Math.abs(cur - dsl.pivotRight) / cur * 100;
        const ivConditionMet = _prDistPct >= 0.05 && (isLong
          ? (dsl.pivotRight >= dsl.impulseVal)
          : (dsl.pivotRight <= dsl.impulseVal));

        if (ivConditionMet) {
          if (!dsl.impulseTriggered) {
            // Trigger proaspăt — prețul a atins IV pentru prima dată (sau după reset)
            dsl.impulseTriggered = true;

            const oldPL = dsl.pivotLeft;
            const oldIV = dsl.impulseVal;

            // Impulse Val recalculated from current price anchor (NOT from Pivot Right)
            dsl.impulseVal = isLong
              ? cur * (1 + impulseValPct / 100)
              : cur * (1 - impulseValPct / 100);

            // Pivot Left se muta la pretul curent - pivotLeftPct% (SL urca)
            dsl.pivotLeft = isLong
              ? cur * (1 - pivotLeftPct / 100)
              : cur * (1 + pivotLeftPct / 100);

            // Safety guards
            dsl.impulseVal = _dslSafePrice(dsl.impulseVal, oldIV, 'IV-step');
            dsl.pivotLeft = _dslSafePrice(dsl.pivotLeft, oldPL, 'PL-step');

            // [PATCH PL-MONO] Monotonic guard: PL can only tighten, never weaken
            // LONG: PL can only go UP (higher stop = tighter)
            // SHORT: PL can only go DOWN (lower stop = tighter)
            if (isLong) {
              dsl.pivotLeft = Math.max(oldPL, dsl.pivotLeft);
            } else {
              dsl.pivotLeft = Math.min(oldPL, dsl.pivotLeft);
            }

            // [DSL MAGNET] Hook B — Phase 3 impulse post-mono refinement
            const _magnetOn_B = !!(pos.dslParams && pos.dslParams.magnetEnabled);
            if (_magnetOn_B) {
              const _magSnapB = _computeDslMagnetSnap(dsl.pivotLeft, pos, pos.side, 'PL', { cur: cur });
              if (_magSnapB.applied) {
                const _preSnapB = dsl.pivotLeft;
                dsl.pivotLeft = _magSnapB.snappedPrice;
                dsl.pivotLeft = _dslSafePrice(dsl.pivotLeft, _preSnapB, 'PL-mag-B');
                // Re-apply monotonic guard AFTER magnet snap
                if (isLong) {
                  dsl.pivotLeft = Math.max(oldPL, dsl.pivotLeft);
                } else {
                  dsl.pivotLeft = Math.min(oldPL, dsl.pivotLeft);
                }
                dsl.log.push({ ts: Date.now(), msg: '[MAG-B] ' + _magSnapB.reason });
                if (!Array.isArray(pos.dslHistory)) pos.dslHistory = [];
                pos.dslHistory.push({ ts: Date.now(), msg: '[MAG] ' + _magSnapB.reason });
              }
              dsl._magnetPreview = _magSnapB;
            } else {
              dsl._magnetPreview = null;
            }

            // SL nativ se updateaza
            dsl.currentSL = dsl.pivotLeft;

            dsl.log.push({ ts: Date.now(), msg: `[IMP] IMPULSE: PL $${fP(oldPL)}→$${fP(dsl.pivotLeft)} | IV $${fP(oldIV)}→$${fP(dsl.impulseVal)}` });
            // Push to per-position history journal
            if (!Array.isArray(pos.dslHistory)) pos.dslHistory = [];
            pos.dslHistory.push({ ts: Date.now(), msg: `[IMP] Impulse hit — SL $${fP(oldPL)}→$${fP(dsl.pivotLeft)}` });
            // [P0.4] Decision log — DSL impulse
            if (typeof DLog !== 'undefined') DLog.record('dsl_move', { event: 'impulse', sym: pos.sym, side: pos.side, price: cur, oldPL: oldPL, newPL: dsl.pivotLeft, newIV: dsl.impulseVal });
            atLog('buy', `[IMP] IMPULSE HIT: ${pos.sym.replace('USDT', '')} | SL $${fP(oldPL)}→$${fP(dsl.pivotLeft)} | IV→$${fP(dsl.impulseVal)}`);
            brainThink('ok', _ZI.bolt + ` Impulse atins pe ${pos.sym.replace('USDT', '')} — SL mutat la $${fP(dsl.pivotLeft)}`);
            toast(`${pos.sym.replace('USDT', '')} Impulse Validation atins! SL → $${fP(dsl.pivotLeft)}`);
          }
          // dacă era deja triggered, prețul rămâne în zonă — nu facem nimic
        } else {
          // Prețul a ieșit din zona IV → resetăm guard-ul
          // Permite un nou impulse dacă prețul revine și depășește din nou impulseVal
          if (dsl.impulseTriggered) {
            dsl.impulseTriggered = false;
          }
        }
      } // end _canMoveSL

      // [DSL MAGNET] Preview-only for non-mutation modes (ASSIST disarmed / USER takeover)
      // When _canMoveSL is false but magnet is ON, compute where magnet WOULD snap — display only
      if (!_canMoveSL && dsl.pivotLeft > 0) {
        const _magnetOnPreview = !!(pos.dslParams && pos.dslParams.magnetEnabled);
        if (_magnetOnPreview) {
          dsl._magnetPreview = _computeDslMagnetSnap(dsl.pivotLeft, pos, pos.side, 'PL', { cur: cur });
        } else {
          dsl._magnetPreview = null;
        }
      }

      // ══════════════════════════════════════════════════════
      // PHASE 7: AI ADAPTIVE STATE per position
      // Computes calm / tense / aggressive based on progress + volatility
      // Only for AT positions (auto/assist) — paper stays calm
      // ══════════════════════════════════════════════════════
      if (_posMode === 'auto' || _posMode === 'assist') {
        // Simple volatility proxy: distance from SL as % of entry
        const _slDist = Math.abs(cur - dsl.currentSL) / pos.entry * 100;
        // State machine: aggressive if progress>80 or SL very close, tense if progress>50, else calm
        let _newAdapt = 'calm';
        if (progress > 80 || _slDist < 0.3) _newAdapt = 'aggressive';
        else if (progress > 50 || _slDist < 0.6) _newAdapt = 'tense';

        const _prevAdapt = pos.dslAdaptiveState || 'calm';
        if (_newAdapt !== _prevAdapt) {
          pos.dslAdaptiveState = _newAdapt;
          if (!Array.isArray(pos.dslHistory)) pos.dslHistory = [];
          const _aMap = { calm: '[CALM]', tense: '[TENSE]', aggressive: '[AGG]' };
          pos.dslHistory.push({ ts: Date.now(), msg: `${_aMap[_newAdapt]} AI state → ${_newAdapt.toUpperCase()} (progress:${progress.toFixed(0)}% slDist:${_slDist.toFixed(2)}%)` });
        }
      }
    }
  });
}

// ─── RENDER DSL WIDGET ─────────────────────────────────────────

// DSL Widget render
// ── Take Control handler (AUTO + ASSIST positions) ─────────────
function dslTakeControl(posId) {
  posId = String(posId);
  const pos = [...(TP.demoPositions || []), ...(TP.livePositions || [])].find(p => String(p.id) === posId);
  if (!pos) return;
  const _cm = (pos.controlMode || (pos.autoTrade ? (pos.sourceMode || 'auto') : 'paper')).toLowerCase();
  if (_cm !== 'auto' && _cm !== 'assist') { toast('Take Control: doar pentru AUTO/ASSIST'); return; }
  if (!pos.sourceMode) pos.sourceMode = _cm;  // preserve original if missing
  pos.controlMode = 'user';
  // [BUG3 FIX] Notify server of controlMode change for server-managed positions
  if (window._serverATEnabled && pos._serverSeq) {
    fetch('/api/at/control', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ seq: pos._serverSeq, controlMode: 'user' }) }).catch(function () { });
  }
  if (!Array.isArray(pos.dslHistory)) pos.dslHistory = [];
  pos.dslHistory.push({ ts: Date.now(), msg: '[USER] TOOK CONTROL — manual override active' });
  brainThink('info', _ZI.hand + ` User took control of ${pos.sym.replace('USDT', '')} ${pos.side}`);
  toast(`Control taken: ${pos.sym.replace('USDT', '')} ${pos.side}`);
  if (typeof ZState !== 'undefined') ZState.save();
}

// ── Let AI Control handler (return from MANUAL → AI) ───────────
function dslReleaseControl(posId) {
  posId = String(posId);
  const pos = [...(TP.demoPositions || []), ...(TP.livePositions || [])].find(p => String(p.id) === posId);
  if (!pos) return;
  if ((pos.controlMode || 'paper') !== 'user') { toast('Această poziție nu e în MANUAL'); return; }
  // Resume AI from CURRENT manual values — NO reset
  const _origSource = (pos.sourceMode || pos.brainModeAtOpen || 'assist').toLowerCase();
  pos.controlMode = _origSource;  // restore to auto or assist
  // [BUG3 FIX] Notify server of controlMode change + send user-edited dslParams
  if (window._serverATEnabled && pos._serverSeq) {
    var _releasePayload = { seq: pos._serverSeq, controlMode: _origSource };
    if (pos.dslParams) {
      var _clean = {};
      ['openDslPct', 'pivotLeftPct', 'pivotRightPct', 'impulseVPct', 'dslTargetPrice'].forEach(function (k) {
        if (Number.isFinite(pos.dslParams[k])) _clean[k] = pos.dslParams[k];
      });
      _releasePayload.dslParams = _clean;
    }
    fetch('/api/at/control', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(_releasePayload) }).catch(function () { });
  }
  // Mark transition timestamp so _mapServerPos preserves params during race window
  pos._dslParamsPushedAt = Date.now();
  if (!Array.isArray(pos.dslHistory)) pos.dslHistory = [];
  pos.dslHistory.push({ ts: Date.now(), msg: `[AI] CONTROL RESUMED (${_origSource.toUpperCase()}) — continuing from current DSL values` });
  brainThink('ok', _ZI.robot + ` AI resumed control of ${pos.sym.replace('USDT', '')} ${pos.side} — from current state`);
  toast(`AI control resumed: ${pos.sym.replace('USDT', '')} ${pos.side}`);
  if (typeof ZState !== 'undefined') ZState.save();
}

// ── Manual DSL param update (per-position, MANUAL mode only) ───
function dslManualParam(posId, param, value) {
  posId = String(posId);
  const pos = [...(TP.demoPositions || []), ...(TP.livePositions || [])].find(p => String(p.id) === posId);
  if (!pos) return;
  const _cm = (pos.controlMode || (pos.autoTrade ? (pos.sourceMode || 'auto') : 'paper')).toLowerCase();
  if (_cm !== 'user' && _cm !== 'paper') return;
  const v = parseFloat(value);
  if (!isFinite(v) || v <= 0) return;
  if (!pos.dslParams) pos.dslParams = {};
  pos.dslParams[param] = v;
  // [FIX BUG3] Re-sanitize IV vs PR after manual update
  if (param === 'impulseVPct' || param === 'pivotRightPct') {
    const _pr = pos.dslParams.pivotRightPct ?? 1.0;
    const _iv = pos.dslParams.impulseVPct ?? 20;
    if (_iv <= _pr) {
      pos.dslParams.impulseVPct = Math.round((_pr + 0.01) * 100) / 100;
    }
  }
  // When openDslPct changes before activation → recalculate target from CURRENT LIVE PRICE
  if (param === 'openDslPct') {
    const _dslCheck = DSL.positions[posId];
    if (!_dslCheck?.active) {
      const _livePr = pos.sym === S.symbol ? S.price : (allPrices[pos.sym] || wlPrices[pos.sym]?.price || pos.entry);
      if (_livePr > 0) {
        pos.dslParams.dslTargetPrice = pos.side === 'LONG'
          ? _livePr * (1 + v / 100)
          : _livePr * (1 - v / 100);
      }
    }
  }
  if (!Array.isArray(pos.dslHistory)) pos.dslHistory = [];
  pos.dslHistory.push({ ts: Date.now(), msg: `[EDIT] Manual ${param}: ${v}` });

  // ── LIVE RECALC: if DSL is active, rebind structure immediately ──
  const _dslKey = String(posId);
  const _dsl = DSL.positions[_dslKey];
  if (_dsl?.active) {
    const _pp = pos.dslParams;
    // [P1] Read from TC (server-safe), DOM fallback
    const _gDsl = (typeof TC !== 'undefined' && Number.isFinite(TC.dslActivatePct)) ? TC.dslActivatePct : (parseFloat(el('dslActivatePct')?.value) || 40);
    const _gPL = (typeof TC !== 'undefined' && Number.isFinite(TC.dslTrailPct)) ? TC.dslTrailPct : (parseFloat(el('dslTrailPct')?.value) || 0.8);
    const _gPR = (typeof TC !== 'undefined' && Number.isFinite(TC.dslTrailSusPct)) ? TC.dslTrailSusPct : (parseFloat(el('dslTrailSusPct')?.value) || 1.0);
    const _gIV = (typeof TC !== 'undefined' && Number.isFinite(TC.dslExtendPct)) ? TC.dslExtendPct : (parseFloat(el('dslExtendPct')?.value) || 20);
    const _san = _dslSanitizeParams({
      openDslPct: _pp.openDslPct ?? _gDsl,
      pivotLeftPct: _pp.pivotLeftPct ?? _gPL,
      pivotRightPct: _pp.pivotRightPct ?? _gPR,
      impulseVPct: _pp.impulseVPct ?? _gIV,
    }, posId);
    const cur = pos.sym === S.symbol ? S.price : (allPrices[pos.sym] || wlPrices[pos.sym]?.price || pos.entry);
    if (cur > 0) {
      const isLong = pos.side === 'LONG';
      _dsl.pivotLeft = isLong ? cur * (1 - _san.pivotLeftPct / 100) : cur * (1 + _san.pivotLeftPct / 100);
      _dsl.pivotRight = isLong ? cur * (1 + _san.pivotRightPct / 100) : cur * (1 - _san.pivotRightPct / 100);
      _dsl.impulseVal = isLong ? cur * (1 + _san.impulseVPct / 100) : cur * (1 - _san.impulseVPct / 100);
      _dsl.pivotLeft = _dslSafePrice(_dsl.pivotLeft, pos.sl, 'PL-manual');
      _dsl.pivotRight = _dslSafePrice(_dsl.pivotRight, cur, 'PR-manual');
      _dsl.impulseVal = _dslSafePrice(_dsl.impulseVal, cur, 'IV-manual');
      _dsl.currentSL = _dsl.pivotLeft;
      _dsl.yellowLine = cur;
      // [FIX H5] Don't unconditionally reset impulseTriggered — preserve if already fired
      // Only reset if price hasn't reached new IV yet (prevents double SL extension)
      var _ivReached = isLong ? (cur >= _dsl.impulseVal) : (cur <= _dsl.impulseVal);
      if (!_ivReached) _dsl.impulseTriggered = false;
      _dsl.log.push({ ts: Date.now(), msg: `[EDIT] LIVE recalc: PL=$${fP(_dsl.pivotLeft)} PR=$${fP(_dsl.pivotRight)} IV=$${fP(_dsl.impulseVal)}` });
    }
  }

  if (typeof ZState !== 'undefined') ZState.save();

  // ── Immediate re-render so derived price sublabels update ──
  var _allOpen = [...(TP.demoPositions || []), ...(TP.livePositions || [])].filter(function (p) { return !p.closed; });
  renderDSLWidget(_allOpen);

  // ── Push edited dslParams to server (debounced) ──
  pos._dslParamsPushedAt = Date.now();
  if (pos._serverSeq) {
    _dslPushParamsDebounced(pos._serverSeq, pos.dslParams);
  } else if (pos.isLive || pos.fromExchange) {
    // Live position without _serverSeq yet — retry after state sync assigns it
    var _retryPos = pos;
    setTimeout(function () {
      if (_retryPos._serverSeq) _dslPushParamsDebounced(_retryPos._serverSeq, _retryPos.dslParams);
    }, 3000);
  }
}

// Debounced server push for manual DSL param edits
var _dslPushTimers = {};
function _dslPushParamsDebounced(seq, dslParams) {
  clearTimeout(_dslPushTimers[seq]);
  _dslPushTimers[seq] = setTimeout(function () {
    var clean = {};
    ['openDslPct', 'pivotLeftPct', 'pivotRightPct', 'impulseVPct', 'dslTargetPrice'].forEach(function (k) {
      if (Number.isFinite(dslParams[k])) clean[k] = dslParams[k];
    });
    fetch('/api/at/dslparams', {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ seq: seq, dslParams: clean })
    }).catch(function () { });
  }, 500);
}

// ── Drag handler for yellow DSL ON line (mouse + touch) ──────
(function _initDslDrag() {
  let _dragPosId = null, _dragBar = null;
  function _pctFromX(bar, clientX) {
    const rect = bar.getBoundingClientRect();
    const pct = Math.round((clientX - rect.left) / rect.width * 100);
    return Math.max(1, Math.min(100, pct));
  }
  // [FIX BUG1+BUG6] Visual bar scale factor — must match _renderDslCard _barScale
  const _dragBarScale = 0.55;
  const _dragMaxVisualPct = Math.round(100 * _dragBarScale); // max drag zone = 55%
  function _onMove(e) {
    if (!_dragBar || !_dragPosId) return;
    e.preventDefault();
    const x = e.touches ? e.touches[0].clientX : e.clientX;
    const pct = Math.min(_dragMaxVisualPct, _pctFromX(_dragBar, x)); // [FIX BUG6] clamp to active zone
    const line = _dragBar.querySelector('.dsl-yellow-line');
    if (line) line.style.left = pct + '%';
  }
  function _onEnd() {
    if (!_dragBar || !_dragPosId) { _dragPosId = null; _dragBar = null; return; }
    const line = _dragBar.querySelector('.dsl-yellow-line');
    if (line) {
      const visualPct = parseInt(line.style.left, 10) || 40;
      const realPct = Math.round(Math.min(100, Math.max(1, visualPct / _dragBarScale))); // [FIX BUG1] invert scale
      dslManualParam(_dragPosId, 'openDslPct', realPct);
    }
    document.body.style.userSelect = '';
    _dragPosId = null; _dragBar = null;
  }
  document.addEventListener('mouseup', _onEnd);
  document.addEventListener('touchend', _onEnd);
  document.addEventListener('mousemove', _onMove);
  document.addEventListener('touchmove', _onMove, { passive: false });

  document.addEventListener('mousedown', function (e) {
    const bar = e.target.closest('.dsl-prog-bar[data-dsl-drag]');
    if (!bar || bar.dataset.dslEditable !== '1') return;
    _dragPosId = bar.dataset.dslDrag;
    _dragBar = bar;
    document.body.style.userSelect = 'none';
    _onMove(e);
  });
  document.addEventListener('touchstart', function (e) {
    const bar = e.target.closest('.dsl-prog-bar[data-dsl-drag]');
    if (!bar || bar.dataset.dslEditable !== '1') return;
    _dragPosId = bar.dataset.dslDrag;
    _dragBar = bar;
    document.body.style.userSelect = 'none';
    _onMove(e);
  }, { passive: false });
})();

function renderDSLWidget(positions) {
  const container = el('dslPositionCards');
  const countEl = el('dslActiveCount');
  if (!container) return;

  // [v5] Filter positions by active global mode for UI display only
  const _activeMode = (typeof AT !== 'undefined' && AT._serverMode) ? AT._serverMode : 'demo';
  const modeFiltered = positions.filter(function (p) {
    var posMode = p.mode || 'demo';
    return posMode === _activeMode;
  });

  // BUG1 FIX: Skip innerHTML re-render if user is editing a DSL input (prevents desktop typing interruption)
  if (container.contains(document.activeElement) && document.activeElement.tagName === 'INPUT') {
    // Still update the active count badge
    if (countEl) countEl.textContent = modeFiltered.filter(p => DSL.positions[String(p.id)]?.active).length + ' active';
    return;
  }

  const allDisplayPosns = modeFiltered;
  const activeCount = allDisplayPosns.filter(p => DSL.positions[String(p.id)]?.active).length;
  if (countEl) countEl.textContent = activeCount + ' active';

  if (!allDisplayPosns.length) {
    const _waitLabel = _activeMode === 'live' ? 'SCANNING LIVE POSITIONS FOR ACTIVATION' : 'SCANNING DEMO POSITIONS FOR ACTIVATION';
    container.innerHTML = `<div class="dsl-waiting" id="dslWaitingState">
      <div class="dsl-radar">
        <svg class="dsl-radar-svg" viewBox="0 0 80 80">
          <circle cx="40" cy="40" r="36" fill="none" stroke="#00ffcc11" stroke-width="1"/>
          <circle cx="40" cy="40" r="26" fill="none" stroke="#00ffcc0d" stroke-width="1"/>
          <circle cx="40" cy="40" r="16" fill="none" stroke="#00ffcc0a" stroke-width="1"/>
          <g class="dsl-radar-sweep"><path d="M40,40 L76,40 A36,36,0,0,0,40,4 Z" fill="url(#radarGrad)" opacity=".6"/></g>
          <circle cx="40" cy="40" r="3" fill="#00ffcc" opacity=".8"><animate attributeName="opacity" values="1;0.2;1" dur="1.5s" repeatCount="indefinite"/></circle>
        </svg>
      </div>
      <div>
        <div class="dsl-radar-txt">WAITING DYNAMIC SL...</div>
        <div style="font-size:12px;color:#00ffcc22;margin-top:3px;letter-spacing:1px">${_waitLabel}</div>
      </div>
    </div>`;
    return;
  }

  // Separate positions into groups
  const atPositions = allDisplayPosns.filter(p => p.autoTrade);
  const paperPositions = allDisplayPosns.filter(p => !p.autoTrade);

  let html = '';

  // AT Positions section
  if (atPositions.length) {
    html += `<div style="font-size:14px;color:#00ffcc55;letter-spacing:2px;padding:6px 12px 4px;border-bottom:1px solid #00ffcc11;margin-bottom:6px">AT POSITIONS (${atPositions.length})</div>`;
    html += atPositions.map(pos => _renderDslCard(pos)).join('');
  }

  // Paper Positions section
  if (paperPositions.length) {
    html += `<div style="font-size:14px;color:#f0c04055;letter-spacing:2px;padding:6px 12px 4px;border-bottom:1px solid #f0c04011;margin-bottom:6px;${atPositions.length ? 'margin-top:10px' : ''}">PAPER POSITIONS (${paperPositions.length})</div>`;
    html += paperPositions.map(pos => _renderDslCard(pos)).join('');
  }

  container.innerHTML = html;
}

// ── Render a single DSL position card ──────────────────────────
function _renderDslCard(pos) {
  const dsl = DSL.positions[String(pos.id)];
  const cur = pos.sym === S.symbol ? S.price : (allPrices[pos.sym] || wlPrices[pos.sym]?.price || pos.entry);
  const symBase = pos.sym.replace('USDT', '');
  const isActive = dsl?.active || false;
  const isLong = pos.side === 'LONG';
  const progress = dsl?.progress || 0;
  const cardCls = isLong ? 'long' : 'short';

  // Per-position DSL params (or global fallback)
  const _pp = pos.dslParams || {};
  // [P1] Read from TC (server-safe), DOM fallback
  const openDSLpct = _pp.openDslPct ?? ((typeof TC !== 'undefined' && Number.isFinite(TC.dslActivatePct)) ? TC.dslActivatePct : (parseFloat(el('dslActivatePct')?.value) || 0.50));
  const pivotLeftPct = _pp.pivotLeftPct ?? ((typeof TC !== 'undefined' && Number.isFinite(TC.dslTrailPct)) ? TC.dslTrailPct : (parseFloat(el('dslTrailPct')?.value) || 0.70));
  const pivotRightPct = _pp.pivotRightPct ?? ((typeof TC !== 'undefined' && Number.isFinite(TC.dslTrailSusPct)) ? TC.dslTrailSusPct : (parseFloat(el('dslTrailSusPct')?.value) || 1.00));
  const impulseValPct = _pp.impulseVPct ?? ((typeof TC !== 'undefined' && Number.isFinite(TC.dslExtendPct)) ? TC.dslExtendPct : (parseFloat(el('dslExtendPct')?.value) || 1.30));

  // ── Control mode (fix: infer from autoTrade if controlMode missing) ──
  const _cm = (pos.controlMode || (pos.autoTrade ? (pos.sourceMode || 'auto') : 'paper')).toLowerCase();
  const _isManual = _cm === 'user';
  const _isAT = !!pos.autoTrade;

  // ── Source badge (immutable — where position came from) ──
  var _dslEnv = window._resolvedEnv || (pos.isLive ? 'REAL' : 'DEMO');
  var _paperLiveLabel = _dslEnv === 'TESTNET' ? 'PAPER TESTNET' : 'PAPER LIVE';
  var _atEnvLabel = _dslEnv === 'TESTNET' ? 'TESTNET' : (pos.isLive ? 'REAL' : 'DEMO');
  const _srcLabel = _isAT
    ? ('AT ' + _atEnvLabel)
    : (pos.isLive ? _paperLiveLabel : 'PAPER DEMO');
  const _srcMap = {
    'AT DEMO': { color: '#aa44ff', bg: '#aa44ff18', border: '#aa44ff44', icon: '' },
    'AT TESTNET': { color: '#f0c040', bg: '#f0c04018', border: '#f0c04044', icon: '' },
    'AT REAL': { color: '#ff4466', bg: '#ff446618', border: '#ff446644', icon: '' },
    'PAPER DEMO': { color: '#ffffff66', bg: '#ffffff08', border: '#ffffff22', icon: '' },
    'PAPER LIVE': { color: '#ff4466', bg: '#ff446618', border: '#ff446644', icon: '' },
    'PAPER TESTNET': { color: '#f0c040', bg: '#f0c04018', border: '#f0c04044', icon: '' },
  };
  const _sb = _srcMap[_srcLabel] || _srcMap['PAPER DEMO'];

  // ── Control badge (mutable — AI or MANUAL, only for AT positions) ──
  const _ctrlLabel = _isManual ? 'MANUAL' : 'AI';
  const _ctrlColor = _isManual ? '#f0c040' : '#00ff88';
  const _ctrlBg = _isManual ? '#f0c04018' : '#00ff8812';
  const _ctrlBorder = _isManual ? '#f0c04044' : '#00ff8833';
  const _ctrlIcon = _isManual ? '' : '';

  // AI adaptive state
  const _adaptState = pos.dslAdaptiveState || 'calm';
  const _adaptMap = {
    calm: { label: 'CALM', color: '#00ff88', icon: '' },
    tense: { label: 'TENSE', color: '#f0c040', icon: '' },
    aggressive: { label: 'AGGRESSIVE', color: '#ff4466', icon: '' },
  };
  const _as = _adaptMap[_adaptState] || _adaptMap.calm;

  // Position type label
  const posLabel = '';

  const origSL = dsl?.originalSL || pos.sl;
  const origTP = dsl?.originalTP || pos.tp;
  const currentSL = dsl?.currentSL || pos.sl;

  const yellowLine = isActive ? cur : null;
  const pivotLeft = isActive ? (dsl.pivotLeft || 0) : null;
  const pivotRight = isActive ? cur * (isLong ? 1 + pivotRightPct / 100 : 1 - pivotRightPct / 100) : null;
  const impulseVal = isActive ? (dsl.impulseVal || 0) : null;

  const pnl = _safePnl(pos.side, cur, pos.entry, pos.size, pos.lev, false);
  const pnlStr = (pnl >= 0 ? '+' : '') + '$' + pnl.toFixed(2);

  const pivotLeftPnl = isActive && pivotLeft
    ? ((isLong ? pivotLeft - pos.entry : pos.entry - pivotLeft) / pos.entry * pos.size * pos.lev)
    : null;
  const pivotLeftPnlStr = pivotLeftPnl !== null
    ? (pivotLeftPnl >= 0 ? '+' : '') + '$' + pivotLeftPnl.toFixed(2)
    : null;

  const lo = Math.min(origSL || cur, origTP || cur, cur, pivotLeft || cur, impulseVal || cur);
  const hi = Math.max(origSL || cur, origTP || cur, cur, pivotLeft || cur, impulseVal || cur);
  const totalRange = (hi - lo) || 1;
  const toPos = v => Math.min(98, Math.max(1, (v - lo) / totalRange * 100));

  const slPos = toPos(currentSL);
  const curPos = toPos(cur);
  const plPos = isActive ? toPos(pivotLeft) : null;
  const prPos = isActive ? toPos(pivotRight) : null;
  const ivPos = isActive ? toPos(impulseVal) : null;
  // Visual rescale: ODSL marker at 55% of bar, not 100% — leaves a "null trail" after it
  const _barScale = 0.55;
  const priceProgress = Math.min(100, Math.max(0, (dsl?._barGreenPct ?? 0) * _barScale));
  const yellowMarkerPct = Math.min(100, Math.max(0, (dsl?._barYellowPct ?? 0) * _barScale));

  // Mini history (last 3 entries from dslHistory + dsl.log)
  const _posHist = pos.dslHistory || [];
  const _dslLog = dsl?.log || [];
  const _allHistory = [..._posHist, ..._dslLog].sort((a, b) => (b.ts || 0) - (a.ts || 0)).slice(0, 3);
  const lastLog = _allHistory[0]?.msg || 'Awaiting activation...';

  // Take Control for AUTO/ASSIST, Release for USER mode (AT positions only)
  const _showTakeControl = _isAT && (_cm === 'auto' || _cm === 'assist');
  const _showReleaseControl = _isAT && _cm === 'user';
  // Paper positions always show their own DSL controls (they are always user-controlled)
  const _showPaperControls = !_isAT;

  // [DSL MAGNET] per-position magnet state
  const _magnetOn = !!(pos.dslParams && pos.dslParams.magnetEnabled);
  const _magnetPreview = dsl?._magnetPreview || null;
  const _magnetPreviewTxt = (_magnetOn && _magnetPreview && _magnetPreview.applied)
    ? 'MAG SNAP -> $' + (typeof fP === 'function' ? fP(_magnetPreview.snappedPrice) : _magnetPreview.snappedPrice.toFixed(2)) + ' (' + _magnetPreview.source + ' conf:' + _magnetPreview.confidence + ')'
    : null;
  // For render: can AI mutate? (mirrors _canMoveSL in runDSLBrain)
  const _canMoveSL_render = _cm === 'auto' || _cm === 'paper'
    || (_cm === 'assist' && (typeof S !== 'undefined' ? S.assistArmed : false));

  // Liquidation price
  const _liqStr = pos.liqPrice ? '$' + fP(pos.liqPrice) : '-';
  // ── Price sublabels for param boxes ──
  // DSL activation price — single source from engine stored target
  const _dslActivationPrice = dsl?._activationPrice || (pos.dslParams?.dslTargetPrice > 0
    ? pos.dslParams.dslTargetPrice
    : (isLong ? cur * (1 + openDSLpct / 100) : cur * (1 - openDSLpct / 100)));
  const _dslPriceSub = isActive ? '$' + fP(cur) : '$' + fP(_dslActivationPrice);
  // [FIX BUG5] When NOT active, show ESTIMATED PL/PR/IV at activation price, not just raw SL
  const _estPL = _dslActivationPrice > 0
    ? (isLong ? _dslActivationPrice * (1 - pivotLeftPct / 100) : _dslActivationPrice * (1 + pivotLeftPct / 100))
    : (pos.sl || 0);
  const _estPR = _dslActivationPrice > 0
    ? (isLong ? _dslActivationPrice * (1 + pivotRightPct / 100) : _dslActivationPrice * (1 - pivotRightPct / 100))
    : 0;
  const _estIV = _dslActivationPrice > 0
    ? (isLong ? _dslActivationPrice * (1 + impulseValPct / 100) : _dslActivationPrice * (1 - impulseValPct / 100))
    : 0;
  const _plPriceSub = isActive && pivotLeft ? '$' + fP(pivotLeft) : '$' + fP(_estPL);
  const _prPriceSub = isActive && pivotRight ? '$' + fP(pivotRight) : (_estPR > 0 ? '$' + fP(_estPR) : '-');
  const _ivPriceSub = isActive && impulseVal ? '$' + fP(impulseVal) : (_estIV > 0 ? '$' + fP(_estIV) : '-');
  return `<div class="dsl-pos-card ${cardCls}" style="${isActive ? 'box-shadow:0 0 12px #00ffcc18' : ''}${_isAT ? ';border-left:2px solid ' + _sb.color : ''}">
  <!-- ROW 1: Source badge + Control badge + symbol + DSL status + PnL -->
  <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
    <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
      <span style="font-size:12px;padding:2px 8px;border-radius:3px;background:${_sb.bg};border:1px solid ${_sb.border};color:${_sb.color};font-weight:700;letter-spacing:0.5px">${_sb.icon}${_sb.icon ? ' ' : ''}${_srcLabel}</span>
      ${_isAT ? `<span style="font-size:12px;padding:2px 8px;border-radius:3px;background:${_ctrlBg};border:1px solid ${_ctrlBorder};color:${_ctrlColor};font-weight:700;letter-spacing:0.5px">${_ctrlIcon}${_ctrlIcon ? ' ' : ''}${_ctrlLabel}</span>` : ''}
      <span style="color:${isActive ? '#00ffcc' : isLong ? '#00ff88' : '#ff4466'};font-weight:700;font-size:16px">${pos.side} ${symBase}</span>
      <span class="dsl-badge ${isActive ? 'active' : 'waiting'}">${isActive ? 'DSL ON' : 'WAITING'}</span>
      <button onclick="dslToggleMagnet('${pos.id}')" style="font-size:11px;padding:2px 8px;border-radius:3px;cursor:pointer;font-family:inherit;letter-spacing:0.5px;border:1px solid ${_magnetOn ? '#00ccffaa' : '#ffffff22'};background:${_magnetOn ? '#00ccff18' : 'transparent'};color:${_magnetOn ? '#00ccff' : '#ffffff44'}">${_magnetOn ? 'MAG ON' : 'MAG'}</button>
      ${_isAT ? `<span style="font-size:11px;padding:2px 6px;border-radius:3px;background:${_as.color}15;color:${_as.color};border:1px solid ${_as.color}33">${_as.icon}${_as.icon ? ' ' : ''}${_as.label}</span>` : ''}
    </div>
    <div style="display:flex;align-items:center;gap:8px">
      ${isActive && pivotLeftPnlStr ? `<span style="font-size:14px;color:${pivotLeftPnl >= 0 ? '#39ff14' : '#ff4466'}">PL:${pivotLeftPnlStr}</span>` : ''}
      <span style="color:${pnl >= 0 ? '#00ff88' : '#ff4466'};font-size:18px;font-weight:700">${pnlStr}</span>
    </div>
  </div>

  <!-- ROW 2: Entry / SL / TP / DSL Pivot / Loss@SL / Profit@TP / LIQ -->
  <div style="display:flex;justify-content:space-between;font-size:12px;color:#ffffff55;margin-bottom:4px;flex-wrap:wrap;gap:4px">
    <span>Entry: <b style="color:#ffffffaa">$${fP(pos.entry)}</b></span>
    ${pos.sl ? `<span>SL: <b style="color:#ff4466">$${fP(pos.sl)}</b></span>` : ''}
    ${pos.tp ? `<span>TP: <b style="color:#00ff88">$${fP(pos.tp)}</b></span>` : ''}
    ${isActive && pivotLeft ? `<span>DSL PL: <b style="color:#39ff14">$${fP(pivotLeft)}</b></span>` : ''}
    ${(() => { const _slRef = isActive && pivotLeft ? pivotLeft : pos.sl; if (!_slRef) return ''; const _lossAmt = Math.abs((isLong ? _slRef - pos.entry : pos.entry - _slRef) / pos.entry * pos.size * pos.lev); return '<span>Loss@SL: <b style="color:#ff4466">-$' + _lossAmt.toFixed(2) + '</b></span>'; })()}
    ${pos.tp ? (() => { const _profAmt = Math.abs((isLong ? pos.tp - pos.entry : pos.entry - pos.tp) / pos.entry * pos.size * pos.lev); return '<span>Profit@TP: <b style="color:#00ff88">+$' + _profAmt.toFixed(2) + '</b></span>'; })() : ''}
    <span>LIQ: <b style="color:#ff446688">${_liqStr}</b></span>
  </div>
  <div style="display:flex;font-size:11px;color:#ffffff33;margin-bottom:4px;flex-wrap:wrap;gap:6px">
    <span style="color:#00ffcc33">DSL: ${openDSLpct}% | PL:${pivotLeftPct}% | PR:${pivotRightPct}% | IV:${impulseValPct}%</span>
  </div>

  <!-- ROW 3: Progress bar -->
  <div style="font-size:12px;color:#00ffcc44;letter-spacing:1px;margin-bottom:3px">
    PROGRESS - ${progress.toFixed(1)}% | OPEN DSL: ${openDSLpct}% ${!isActive ? '(@$' + fP(_dslActivationPrice) + ')' : '(ACTIVATED)'}
  </div>
  <div class="dsl-prog-bar" data-dsl-drag="${pos.id}" data-dsl-editable="${(_showReleaseControl || _showPaperControls) && !isActive ? '1' : '0'}" style="height:7px;background:#0d1520;border-radius:4px;position:relative;margin-bottom:12px;cursor:${(_showReleaseControl || _showPaperControls) && !isActive ? 'ew-resize' : 'default'}">
    <div style="position:absolute;left:0;top:0;height:100%;width:${priceProgress}%;background:linear-gradient(90deg,#00ffcc22,${isActive ? '#00ffcc66' : '#00ff8866'});border-radius:3px;transition:width 0.3s ease"></div>
    <div style="position:absolute;left:${isActive ? priceProgress : yellowMarkerPct}%;top:0;height:100%;width:${100 - (isActive ? priceProgress : yellowMarkerPct)}%;background:repeating-linear-gradient(90deg,#ffffff06 0px,#ffffff06 4px,transparent 4px,transparent 8px);border-radius:0 3px 3px 0"></div>
    <div class="dsl-yellow-line" style="position:absolute;left:${isActive ? priceProgress : yellowMarkerPct}%;top:-5px;width:8px;height:15px;background:#f0c040;border-radius:3px;box-shadow:0 0 6px #f0c04088;transition:left 0.3s ease;transform:translateX(-50%);cursor:${(_showReleaseControl || _showPaperControls) && !isActive ? 'grab' : 'default'}"></div>
  </div>

  <!-- ROW 4: Visual SL/PR/IV bar -->
  <div style="position:relative;height:30px;background:#0a1018;border-radius:4px;margin-top:18px;margin-bottom:28px;overflow:visible">
    ${isActive && plPos !== null ? `<div style="position:absolute;left:${Math.min(plPos, curPos)}%;width:${Math.abs(curPos - plPos)}%;height:100%;background:#39ff1415;border-radius:2px"></div>` : ''}
    ${isActive && prPos !== null && ivPos !== null ? `<div style="position:absolute;left:${Math.min(prPos, ivPos)}%;width:${Math.abs(ivPos - prPos)}%;height:100%;background:#ff446610;border-radius:2px"></div>` : ''}
    ${isActive ?
      `<div style="position:absolute;left:${plPos}%;top:-1px;width:3px;height:calc(100%+2px);background:#39ff14;border-radius:2px;transform:translateX(-50%);box-shadow:0 0 8px #39ff14cc">
        <div style="position:absolute;bottom:-14px;left:50%;transform:translateX(-50%);font-size:11px;color:#39ff14;white-space:nowrap;letter-spacing:0.5px;font-weight:700">PL -${pivotLeftPct}%</div>
        <div style="position:absolute;bottom:-27px;left:50%;transform:translateX(-50%);font-size:11px;color:#39ff14bb;white-space:nowrap">$${fP(pivotLeft)}</div>
      </div>`:
      `<div style="position:absolute;left:${slPos}%;top:0;width:3px;height:100%;background:#ff4466;border-radius:2px;transform:translateX(-50%);box-shadow:0 0 6px #ff466699">
        <div style="position:absolute;bottom:-14px;left:50%;transform:translateX(-50%);font-size:13px;color:#ff4466;white-space:nowrap">SL</div>
        <div style="position:absolute;top:-14px;left:50%;transform:translateX(-50%);font-size:13px;color:#ff446699;white-space:nowrap">$${fP(currentSL)}</div>
      </div>`
    }
    <div style="position:absolute;left:${curPos}%;top:-2px;width:3px;height:calc(100%+4px);background:#f0c040;border-radius:2px;transform:translateX(-50%);box-shadow:0 0 8px #f0c040cc;transition:left 0.3s ease">
      <div style="position:absolute;top:-15px;left:50%;transform:translateX(-50%);font-size:11px;color:#f0c040;white-space:nowrap;font-weight:700">${isActive ? 'ODSL' : ''}</div>
      <div style="position:absolute;top:-27px;left:50%;transform:translateX(-50%);font-size:11px;color:#f0c04099;white-space:nowrap">$${fP(cur)}</div>
    </div>
    ${isActive && prPos !== null ? `<div style="position:absolute;left:${prPos}%;top:-1px;width:2px;height:calc(100%+2px);background:#39ff14;border-radius:1px;transform:translateX(-50%);box-shadow:0 0 8px #39ff14cc;transition:left 0.3s ease">
      <div style="position:absolute;top:-15px;left:50%;transform:translateX(-50%);font-size:13px;color:#39ff14;white-space:nowrap">PR +${pivotRightPct}%</div>
      <div style="position:absolute;bottom:-15px;left:50%;transform:translateX(-50%);font-size:13px;color:#39ff1499;white-space:nowrap">$${fP(pivotRight)}</div>
    </div>`: ''}
    ${isActive && ivPos !== null ? `<div style="position:absolute;left:${ivPos}%;top:-1px;width:2px;height:calc(100%+2px);background:#ff4466;border-radius:1px;transform:translateX(-50%);box-shadow:0 0 6px #ff4466aa">
      <div style="position:absolute;top:-15px;left:50%;transform:translateX(-50%);font-size:13px;color:#ff4466;white-space:nowrap;font-weight:700">IV +${impulseValPct}%</div>
      <div style="position:absolute;bottom:-15px;left:50%;transform:translateX(-50%);font-size:13px;color:#ff446699;white-space:nowrap">$${fP(impulseVal)}</div>
    </div>`: ''}
  </div>

  <!-- ROW 5: Price levels -->
  <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:4px;flex-wrap:wrap;gap:4px">
    ${isActive
      ? `<span style="color:#39ff14">PL: <b>$${fP(pivotLeft)}</b></span>
        <span style="color:#f0c040;font-weight:700">ODSL $${fP(cur)}</span>
        <span style="color:#39ff14">PR: $${fP(pivotRight)}</span>
        <span style="color:#ff4466bb">IV: $${fP(impulseVal)}</span>
        <span style="color:#00ff8855">TP: <b style="color:#00ff88">$${fP(pos.tp)}</b></span>`
      : `<span style="color:#ff4466aa">SL: <b style="color:#ff4466">$${fP(currentSL)}</b></span>
        <span style="color:#ffffff88">$${fP(cur)}</span>
        <span style="color:#00ff8855">TP: <b style="color:#00ff88">$${fP(pos.tp)}</b></span>`
    }
  </div>

  <!-- ROW 6: Mini history journal -->
  <div style="margin-top:3px;border-top:1px solid #00ffcc0a;padding-top:3px">
    ${_allHistory.length ? _allHistory.map(h => `<div style="font-size:10px;color:#00ffcc33;font-style:italic;line-height:1.6;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${h.msg}</div>`).join('') : `<div style="font-size:10px;color:#00ffcc22;font-style:italic">Awaiting activation...</div>`}
    ${_magnetPreviewTxt && !_canMoveSL_render ? `<div style="font-size:10px;color:#00ccff44;font-style:italic;line-height:1.6;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${_magnetPreviewTxt}</div>` : ''}
  </div>

  <!-- ROW 7: Take Control / Let AI Control + manual DSL inputs -->
  ${_showTakeControl ? `<div style="margin-top:6px;text-align:right"><button onclick="dslTakeControl('${pos.id}')" style="font-size:12px;padding:4px 12px;background:#f0c04012;border:1px solid #f0c04033;color:#f0c040;border-radius:4px;cursor:pointer;font-family:inherit;letter-spacing:0.5px">TAKE CONTROL</button></div>` : ''}
  ${_showReleaseControl ? `<div style="margin-top:6px;border-top:1px solid #f0c04022;padding-top:6px">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
      <span style="font-size:12px;color:#f0c040;letter-spacing:0.5px">MANUAL CONTROL ACTIVE</span>
      <button onclick="dslReleaseControl('${pos.id}')" style="font-size:12px;padding:4px 12px;background:#00ff8812;border:1px solid #00ff8833;color:#00ff88;border-radius:4px;cursor:pointer;font-family:inherit;letter-spacing:0.5px">LET AI CONTROL</button>
    </div>
    <div style="display:flex;gap:8px;flex-wrap:wrap">
      ${isActive ? `<div style="display:flex;flex-direction:column;gap:1px">
        <label style="font-size:11px;color:#ffffff22;display:flex;align-items:center;gap:4px">DSL%<input type="number" value="${openDSLpct}" disabled style="width:62px;background:#0a0e14;border:1px solid #ffffff11;color:#ffffff33;font-size:12px;padding:2px 4px;border-radius:3px;font-family:inherit;cursor:not-allowed"></label>
        <span class="dsl-price-sub" style="font-size:9px;color:#f0c04044;letter-spacing:0.3px">ACTIVATED</span>
      </div>` : `<div style="display:flex;flex-direction:column;gap:1px">
        <label style="font-size:11px;color:#ffffff44;display:flex;align-items:center;gap:4px">DSL%<input type="number" value="${openDSLpct}" min="0.01" max="100" step="0.01" onchange="dslManualParam('${pos.id}','openDslPct',this.value)" style="width:62px;background:#0d1520;border:1px solid #ffffff22;color:#fff;font-size:12px;padding:2px 4px;border-radius:3px;font-family:inherit"></label>
        <span class="dsl-price-sub" style="font-size:9px;color:#f0c04088;letter-spacing:0.3px">${_dslPriceSub}</span>
      </div>`}
      <div style="display:flex;flex-direction:column;gap:1px">
        <label style="font-size:11px;color:#ffffff44;display:flex;align-items:center;gap:4px">PL%<input type="number" value="${pivotLeftPct}" min="0.01" max="100" step="0.01" onchange="dslManualParam('${pos.id}','pivotLeftPct',this.value)" style="width:62px;background:#0d1520;border:1px solid #ffffff22;color:#fff;font-size:12px;padding:2px 4px;border-radius:3px;font-family:inherit"></label>
        <span class="dsl-price-sub" style="font-size:9px;color:#39ff1488;letter-spacing:0.3px">${_plPriceSub}</span>
      </div>
      <div style="display:flex;flex-direction:column;gap:1px">
        <label style="font-size:11px;color:#ffffff44;display:flex;align-items:center;gap:4px">PR%<input type="number" value="${pivotRightPct}" min="0.01" max="100" step="0.01" onchange="dslManualParam('${pos.id}','pivotRightPct',this.value)" style="width:62px;background:#0d1520;border:1px solid #ffffff22;color:#fff;font-size:12px;padding:2px 4px;border-radius:3px;font-family:inherit"></label>
        <span class="dsl-price-sub" style="font-size:9px;color:#aa44ff88;letter-spacing:0.3px">${_prPriceSub}</span>
      </div>
      <div style="display:flex;flex-direction:column;gap:1px">
        <label style="font-size:11px;color:#ffffff44;display:flex;align-items:center;gap:4px">IV%<input type="number" value="${impulseValPct}" min="0.01" max="100" step="0.01" onchange="dslManualParam('${pos.id}','impulseVPct',this.value)" style="width:62px;background:#0d1520;border:1px solid #ffffff22;color:#fff;font-size:12px;padding:2px 4px;border-radius:3px;font-family:inherit"></label>
        <span class="dsl-price-sub" style="font-size:9px;color:#ff446688;letter-spacing:0.3px">${_ivPriceSub}</span>
      </div>
    </div>
  </div>` : ''}
  ${_showPaperControls ? `<div style="margin-top:6px;border-top:1px solid #ffffff11;padding-top:6px">
    <div style="font-size:11px;color:#ffffff33;letter-spacing:0.5px;margin-bottom:4px">DSL PARAMS</div>
    <div style="display:flex;gap:8px;flex-wrap:wrap">
      ${isActive ? `<div style="display:flex;flex-direction:column;gap:1px">
        <label style="font-size:11px;color:#ffffff22;display:flex;align-items:center;gap:4px">DSL%<input type="number" value="${openDSLpct}" disabled style="width:62px;background:#0a0e14;border:1px solid #ffffff11;color:#ffffff33;font-size:12px;padding:2px 4px;border-radius:3px;font-family:inherit;cursor:not-allowed"></label>
        <span class="dsl-price-sub" style="font-size:9px;color:#f0c04044;letter-spacing:0.3px">ACTIVATED</span>
      </div>` : `<div style="display:flex;flex-direction:column;gap:1px">
        <label style="font-size:11px;color:#ffffff44;display:flex;align-items:center;gap:4px">DSL%<input type="number" value="${openDSLpct}" min="0.01" max="100" step="0.01" onchange="dslManualParam('${pos.id}','openDslPct',this.value)" style="width:62px;background:#0d1520;border:1px solid #ffffff22;color:#fff;font-size:12px;padding:2px 4px;border-radius:3px;font-family:inherit"></label>
        <span class="dsl-price-sub" style="font-size:9px;color:#f0c04088;letter-spacing:0.3px">${_dslPriceSub}</span>
      </div>`}
      <div style="display:flex;flex-direction:column;gap:1px">
        <label style="font-size:11px;color:#ffffff44;display:flex;align-items:center;gap:4px">PL%<input type="number" value="${pivotLeftPct}" min="0.01" max="100" step="0.01" onchange="dslManualParam('${pos.id}','pivotLeftPct',this.value)" style="width:62px;background:#0d1520;border:1px solid #ffffff22;color:#fff;font-size:12px;padding:2px 4px;border-radius:3px;font-family:inherit"></label>
        <span class="dsl-price-sub" style="font-size:9px;color:#39ff1488;letter-spacing:0.3px">${_plPriceSub}</span>
      </div>
      <div style="display:flex;flex-direction:column;gap:1px">
        <label style="font-size:11px;color:#ffffff44;display:flex;align-items:center;gap:4px">PR%<input type="number" value="${pivotRightPct}" min="0.01" max="100" step="0.01" onchange="dslManualParam('${pos.id}','pivotRightPct',this.value)" style="width:62px;background:#0d1520;border:1px solid #ffffff22;color:#fff;font-size:12px;padding:2px 4px;border-radius:3px;font-family:inherit"></label>
        <span class="dsl-price-sub" style="font-size:9px;color:#aa44ff88;letter-spacing:0.3px">${_prPriceSub}</span>
      </div>
      <div style="display:flex;flex-direction:column;gap:1px">
        <label style="font-size:11px;color:#ffffff44;display:flex;align-items:center;gap:4px">IV%<input type="number" value="${impulseValPct}" min="0.01" max="100" step="0.01" onchange="dslManualParam('${pos.id}','impulseVPct',this.value)" style="width:62px;background:#0d1520;border:1px solid #ffffff22;color:#fff;font-size:12px;padding:2px 4px;border-radius:3px;font-family:inherit"></label>
        <span class="dsl-price-sub" style="font-size:9px;color:#ff446688;letter-spacing:0.3px">${_ivPriceSub}</span>
      </div>
    </div>
  </div>` : ''}
</div>`;
}

// DSL intervals started via startDSLIntervals() called from startApp()
function stopDSLIntervals() {
  if (DSL.checkInterval) { Intervals.clear('dsl'); DSL.checkInterval = null; }
  if (DSL.visualInterval) { Intervals.clear('dslVis'); DSL.visualInterval = null; }
}
function startDSLIntervals() {
  if (DSL.checkInterval) return; // already running
  // Start DSL check loop + fast visual update
  DSL.checkInterval = Intervals.set('dsl', runDSLBrain, 3000);
  // [PERF] 2000→3000ms — DSL visual refresh doesn't need sub-3s updates
  // Early return daca nu sunt pozitii: evita re-render complet pe nimic
  DSL.visualInterval = Intervals.set('dslVis', () => {
    if (document.hidden) return; // [PERF] skip DSL render when tab hidden
    // [PATCH DSL-ALL] Include toate pozițiile deschise: auto + manual paper + live
    const posns = [
      ...(TP.demoPositions || []),
      ...(TP.livePositions || [])
    ].filter(p => !p.closed);
    if (!posns.length || !DSL.enabled) return; // [v106 FIX5] early return — fara pozitii, fara render
    renderDSLWidget(posns);
  }, 3000);
  setTimeout(() => { initDSLBubbles(); runDSLBrain(); }, 2000);
}


// ─── DSL Trim (cap logs/history) ────────────────────────────
function _dslTrimLogs(posId) {
  if (typeof DSL === 'undefined' || !DSL.positions?.[posId]) return;
  const pos = DSL.positions[posId];
  if (Array.isArray(pos.log) && pos.log.length > 20) {
    pos.log = pos.log.slice(-20);
  }
}

function _dslTrimAll() {
  if (typeof DSL === 'undefined' || !DSL.positions) return;
  Object.keys(DSL.positions).forEach(id => _dslTrimLogs(id));
  if (Array.isArray(DSL.history) && DSL.history.length > 50) {
    DSL.history = DSL.history.slice(-50);
  }
  // [FIX M9] Trim pos.dslHistory on open positions to prevent unbounded localStorage growth
  const _allPos = [...(typeof TP !== 'undefined' && Array.isArray(TP.demoPositions) ? TP.demoPositions : []),
  ...(typeof TP !== 'undefined' && Array.isArray(TP.livePositions) ? TP.livePositions : [])];
  _allPos.forEach(function (p) {
    if (Array.isArray(p.dslHistory) && p.dslHistory.length > 30) {
      p.dslHistory = p.dslHistory.slice(-30);
    }
  });
  // [FIX M9] Clean dead DSL.positions entries (positions that no longer exist)
  const _openIds = new Set(_allPos.filter(function (p) { return !p.closed; }).map(function (p) { return String(p.id); }));
  Object.keys(DSL.positions).forEach(function (id) {
    if (!_openIds.has(id)) delete DSL.positions[id];
  });
}