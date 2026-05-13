// Zeus — data/marketDataTrading.ts
// Ported 1:1 from public/js/data/marketData.js lines 2036-2660 (Chunk E)
// Trading panel UI: mode switch, add funds, demo/live orders, leverage, liq price

import { getPrice, getSymbol, getDSLEnabled } from '../services/stateAccessors'
import { AT } from '../engine/events'
import { TP } from '../core/state'
import { fmt, fP } from '../utils/format'
import { escHtml, el } from '../utils/dom'
import { toast } from './marketDataHelpers'
import { _ZI } from '../constants/icons'
import { useATStore } from '../stores/atStore'
import { useUiStore } from '../stores/uiStore'
import { _startLivePendingSync , renderDemoPositions } from './marketDataPositions'
import { runDSLBrain, toggleDSL } from '../trading/dsl'
import { manualLivePlaceOrder, manualLiveSetSL, manualLiveSetTP } from '../trading/liveApi'

import { api } from '../services/api'
import { updateModeBar } from '../ui/modebar'
import { renderTradeMarkers } from './marketDataOverlays'
import { onPositionOpened } from '../trading/positions'
import { renderLivePositions } from './marketDataPositions'
import { liveApiSyncState } from '../trading/liveApi'
import { usePositionsStore } from '../stores/positionsStore'
const w = window as any // kept for w.S.mode (self-ref SKIP), w.ZState, fn calls

// ═══════════════════════════════════════════════════════
// GLOBAL MODE SWITCH
// ═══════════════════════════════════════════════════════
export function switchGlobalMode(mode: any): void {
  const currentMode = (typeof AT !== 'undefined' && AT._serverMode) ? AT._serverMode : 'demo'
  console.log('[BRAIN-SPLIT] switchGlobalMode(' + mode + ') currentMode=' + currentMode)
  if (currentMode === mode) { _toggleManualPanel(); return }
  if (mode === 'demo') {
    _showConfirmDialog('Activate Demo Mode?', 'You are about to switch the entire system to DEMO mode.\n\nAll new manual and auto trades will run in simulated mode.\nNo real Binance orders will be executed.\nLive mode will be turned off.\n\nExisting live positions will remain live and continue independently.', 'Cancel', 'Activate Demo', function () { _executeGlobalModeSwitch('demo') })
  } else {
    const _switchEnv = w._exchangeMode === 'testnet' ? 'TESTNET' : 'REAL'
    const _switchIsTestnet = _switchEnv === 'TESTNET'
    _showConfirmDialog(_switchIsTestnet ? 'Activate Testnet Mode?' : 'Activate Real Trading Mode?', _switchIsTestnet ? 'You are about to switch to exchange-backed TESTNET mode.\n\nAll new trades will execute on Binance TESTNET with TEST funds.\nNo real money is involved.\nDemo mode will be turned off.\n\nExisting demo positions will remain demo and continue independently.' : 'You are about to switch the entire system to LIVE mode.\n\nAll new manual and auto trades may use REAL funds.\nReal Binance execution requires valid API keys configured in Settings.\nDemo mode will be turned off.\n\nExisting demo positions will remain demo and continue independently.\n\nOnly continue if you understand the risks of real-money trading.', 'Cancel', _switchIsTestnet ? 'Activate Testnet' : 'Activate Live', function () { _executeGlobalModeSwitch('live') })
  }
}

function _executeGlobalModeSwitch(mode: string): void {
  console.log('[BRAIN-SPLIT] _executeGlobalModeSwitch(' + mode + ') POSTing...')
  // [R5] Flush pending _usSave BEFORE the POST, not in the .then callback.
  // The server broadcasts a WS at_update as soon as it flips the mode, which
  // races the HTTP response: _applyServerATState (state.ts) and applyATUpdate
  // (useServerSync.ts) both flip AT.mode + useATStore.mode on that frame. If
  // the flush ran in .then, _currentATModeKey() read the already-flipped NEW
  // mode and _usSave wrote the outgoing mode's pending flat values (profile,
  // DSL mode) into the WRONG brain slot (the new mode). Flushing pre-POST
  // locks in the correct OLD-mode slot before any WS frame can arrive.
  try { if (typeof w._usFlush === 'function') w._usFlush() } catch (_) {}
  // [BUG-SAFE-1] Server-side consent: live mode requires explicit confirm:true + env declaration (TESTNET|REAL).
  // Resolved env comes from w._executionEnv (already populated by exchange-creds resolver). Fallback to TESTNET on null/unknown for safety.
  const _safe1Env = (w._executionEnv === 'REAL') ? 'REAL' : 'TESTNET'
  const _safe1Body = mode === 'live' ? { mode, confirm: true, env: _safe1Env } : { mode }
  api.raw<any>('POST', '/api/at/mode', _safe1Body).then(function (data: any) {
    console.log('[BRAIN-SPLIT] _executeGlobalModeSwitch(' + mode + ') response ok=' + data.ok)
    if (data.ok) {
      const _prevMode = (typeof AT !== 'undefined' && (AT as any).mode) ? (AT as any).mode : 'demo'
      const _usBefore = (window as any).USER_SETTINGS || {}
      console.log('[BRAIN-SPLIT] switch: ' + _prevMode + ' → ' + mode + ' | prev flat=' + _usBefore.profile + '/' + _usBefore.bmMode + ' | brain=' + JSON.stringify(_usBefore.brain || {}))
      // [BRAIN-MODE-SPLIT b74 hotfix] Flip BOTH AT.mode and atStore.mode synchronously,
      // not only AT._serverMode. getATMode() reads useATStore.mode, so without this the
      // badge, _currentATModeKey (for _usSave) and any getATMode consumer stayed on the
      // OLD mode until the async atPollOnce → updateATMode → useATBridge chain caught
      // up (~500ms+). Any save during that window landed in the wrong brain namespace.
      if (typeof AT !== 'undefined') { AT._serverMode = mode; (AT as any).mode = mode }
      // [BUG-T7 FOLLOWUP-2 2026-05-13] Patch BOTH mode AND enabled din response server.
      // Pre-fix: doar mode era patched optimistic → atStore.enabled rămânea STALE
      // until WS frame arrival (~50-200ms). Race window: dacă user clicked toggle în
      // acest interval, UI button reflected stale state → click sent unintended toggle
      // (e.g. „turn OFF" când user wanted „turn ON"). Operator-reported 2026-05-13.
      // Fix: server setMode now returns enriched response cu atActive computed pentru
      // new engineMode; client patches enabled imediat → zero race window.
      try {
        const _atActive = typeof data.atActive === 'boolean' ? data.atActive : useATStore.getState().enabled;
        useATStore.getState().patch({ mode: mode as 'demo' | 'live', enabled: _atActive });
      } catch (_) {}
      console.log('[BRAIN-SPLIT] after flip: AT.mode=' + (AT as any).mode + ' store.mode=' + useATStore.getState().mode)
      // [BRAIN-MODE-SPLIT b74] Apply the new mode's brain namespace now, so S,
      // BM and the brainStore reflect the per-mode profile + bmMode the user
      // set for this mode previously (or the migration seed on first run).
      try { if (typeof w.applyBrainCfgForMode === 'function') w.applyBrainCfgForMode(mode) } catch (_) {}
      _applyGlobalModeUI(mode)
      if (mode === 'demo') { toast('Demo Mode Activated', 3000, _ZI.ok) }
      else { const _toastEnv = w._executionEnv; if (_toastEnv === null) toast('LIVE MODE LOCKED: ' + (w._executionBlockedReason === 'INVALID_ACTIVE_API_CONFIGURATION' ? 'Invalid active API configuration' : 'No valid API credentials configured'), 3500, _ZI.w); else if (_toastEnv === 'TESTNET') toast('Testnet Trading Mode Activated', 3000, _ZI.ok); else if (_toastEnv === 'REAL') toast('Real Trading Mode Activated', 3000, _ZI.ok); else toast('Live Trading Mode Activated', 3000, _ZI.ok) }
      _showManualPanel()
      if (typeof runDSLBrain === 'function') runDSLBrain()
      if (typeof w._atPollOnce === 'function') setTimeout(w._atPollOnce, 500)
      // [9A-4] Notify React after mode switch
      try { window.dispatchEvent(new CustomEvent('zeus:atStateChanged')) } catch (_) {}
    } else { const _fails = (data.checks || []).filter(function (c: any) { return !c.ok }); const _reason = _fails.length > 0 ? _fails.slice(0, 2).map(function (c: any) { return c.detail }).join('. ') : (data.error || 'Unknown error'); toast('Cannot switch to LIVE: ' + _reason, 5000, _ZI.lock) }
  }).catch(function () { toast('Network error', 3000, _ZI.x) })
}

export function _applyGlobalModeUI(mode: string): void {
  const btnD = el('btnDemo'), btnL = el('btnLive')
  if (mode === 'live') { if (btnD) btnD.classList.remove('active'); if (btnL) btnL.classList.add('active') }
  else { if (btnD) btnD.classList.add('active'); if (btnL) btnL.classList.remove('active') }
  const _env = w._executionEnv
  const execLocked = mode === 'live' && (_env === null || !w._apiConfigured)
  if (mode === 'live') {
    const _atIsTestnet = _env === 'TESTNET'
    const _atEnvLabel = _atIsTestnet ? 'TESTNET MODE' : (_env === 'REAL' ? 'LIVE MODE' : 'LIVE MODE LOCKED')
    const _atEnvShort = _atIsTestnet ? 'TESTNET' : (_env === 'REAL' ? 'LIVE' : 'LOCKED')
    const _atEnvColor = _atIsTestnet ? 'var(--gold)' : 'var(--red-bright)'
    const _atEnvColorDim = _atIsTestnet ? '#f0c04044' : '#ff444444'
    const _icoKind: 'dYlw' | 'dRed' = _atIsTestnet ? 'dYlw' : 'dRed'
    useATStore.getState().patchUI({
      modeDisplay: {
        icon: _icoKind,
        text: _atEnvLabel,
        lockSuffix: execLocked,
        color: execLocked ? 'var(--orange)' : _atEnvColor,
        border: execLocked ? '#ff880044' : _atEnvColorDim,
      },
      modeLabel: {
        icon: _icoKind,
        text: execLocked ? _atEnvShort + ' LOCKED' : _atEnvShort,
        color: execLocked ? 'var(--orange)' : _atEnvColor,
      },
      liveWarnVisible: true,
    })
  } else {
    useATStore.getState().patchUI({
      modeDisplay: { icon: 'pad', text: 'DEMO MODE', lockSuffix: false, color: 'var(--pur)', border: '#aa44ff44' },
      modeLabel: { icon: 'pad', text: 'DEMO', color: 'var(--pur)' },
      liveWarnVisible: false,
    })
  }
  const af = el('btnAddFunds'), rd = el('btnResetDemo')
  if (af) af.style.display = mode === 'demo' ? '' : 'none'
  if (rd) rd.style.display = mode === 'demo' ? '' : 'none'
  // NOTE: #demoExec, #panelDemo header, #demoBalance are React-controlled.
  // Do NOT set innerHTML on them — React owns those DOM nodes.
  // Only set non-destructive properties (disabled, opacity, dataset).
  const execBtn = el('demoExec')
  if (execBtn) {
    if (mode === 'live' && !w._apiConfigured) { execBtn.disabled = false; execBtn.style.opacity = '0.6'; execBtn.dataset.execMode = 'locked' }
    else if (mode === 'live') { execBtn.disabled = false; execBtn.style.opacity = ''; execBtn.dataset.execMode = 'live' }
    else { execBtn.disabled = false; execBtn.style.opacity = ''; execBtn.dataset.execMode = 'demo' }
  }
  if (typeof renderTradeMarkers === 'function') renderTradeMarkers()
  if (typeof updateModeBar === 'function') updateModeBar()
  // [batch3-W-hotfix2] When engine enters live mode with API configured, make
  // sure the live balance + positions are fetched from Binance. Prior to this
  // the only trigger was the user clicking CONNECT in Settings → Exchange API
  // (connectLiveAPI). After the ModeBar/Manual React migration, users switch
  // demo→live via ModeBar without going through Settings, so TP.liveBalance
  // stayed 0 and the Manual panel showed BAL: $0 and rejected orders with
  // "Insufficient live balance". Idempotent: only the first transition fires
  // the sync; periodic 120s sync keeps it fresh from then on.
  if (mode === 'live' && w._apiConfigured) {
    const _wasConnected = !!w.TP.liveConnected
    w.TP.liveConnected = true
    if (!_wasConnected && typeof liveApiSyncState === 'function') {
      liveApiSyncState()
    }
  }
}

function _toggleManualPanel(): void { TP.demoOpen = !TP.demoOpen; const p = el('panelDemo'); if (p) p.style.display = TP.demoOpen ? 'block' : 'none'; if (TP.demoOpen && getPrice()) { const ei = el('demoEntry'); if (ei) ei.placeholder = '$' + fP(getPrice()) } }
function _showManualPanel(): void { TP.demoOpen = true; const p = el('panelDemo'); if (p) p.style.display = 'block'; if (getPrice()) { const ei = el('demoEntry'); if (ei) ei.placeholder = '$' + fP(getPrice()) } }

// ═══════════════════════════════════════════════════════
// CONFIRM DIALOG
// ═══════════════════════════════════════════════════════
export function _showConfirmDialog(title: string, message: string, cancelText: string, confirmText: string, onConfirm: () => void): void {
  const old = document.getElementById('zeusConfirmOverlay'); if (old) old.remove()
  const overlay = document.createElement('div'); overlay.id = 'zeusConfirmOverlay'
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.85);z-index:99999;display:flex;align-items:center;justify-content:center;padding:20px'
  const safeTitle = escHtml(title)
  const safeMsg = escHtml(message).replace(/\n/g, '<br>')
  const safeCancelText = escHtml(cancelText)
  const safeConfirmText = escHtml(confirmText)
  const isLive = confirmText.toLowerCase().includes('live') || confirmText.toLowerCase().includes('real')
  const confirmColor = isLive ? 'var(--red-bright)' : 'var(--cyan)'; const confirmBg = isLive ? '#2a0000' : '#001a33'; const confirmBorder = isLive ? '#ff4444' : '#00aaff'
  overlay.innerHTML = '<div style="background:#0a0a1a;border:1px solid ' + confirmBorder + '66;border-radius:8px;max-width:420px;width:100%;padding:24px;font-family:var(--ff,monospace)"><div style="font-size:14px;font-weight:700;color:' + confirmColor + ';margin-bottom:16px;letter-spacing:1px">' + safeTitle + '</div><div style="font-size:11px;color:#ccc;line-height:1.7;margin-bottom:24px">' + safeMsg + '</div><div style="display:flex;gap:12px;justify-content:flex-end"><button id="zeusConfirmCancel" style="padding:8px 20px;background:#1a1a2e;border:1px solid #333;color:#888;border-radius:4px;cursor:pointer;font-family:var(--ff,monospace);font-size:11px;letter-spacing:1px">' + safeCancelText + '</button><button id="zeusConfirmOk" style="padding:8px 20px;background:' + confirmBg + ';border:1px solid ' + confirmBorder + ';color:' + confirmColor + ';border-radius:4px;cursor:pointer;font-family:var(--ff,monospace);font-size:11px;font-weight:700;letter-spacing:1px">' + safeConfirmText + '</button></div></div>'
  document.body.appendChild(overlay)
  ;(document.getElementById('zeusConfirmCancel') as any).onclick = function () { overlay.remove() }
  overlay.onclick = function (e: any) { if (e.target === overlay) overlay.remove() }
  ;(document.getElementById('zeusConfirmOk') as any).onclick = function () { overlay.remove(); if (typeof onConfirm === 'function') onConfirm() }
}

// 3-button variant for DSL-off flow: primary / secondary / cancel
export function _showConfirmDialog3(
  title: string, message: string,
  primaryText: string, secondaryText: string, cancelText: string,
  onPrimary: () => void, onSecondary: () => void,
): void {
  const old = document.getElementById('zeusConfirmOverlay'); if (old) old.remove()
  const overlay = document.createElement('div'); overlay.id = 'zeusConfirmOverlay'
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.85);z-index:99999;display:flex;align-items:center;justify-content:center;padding:20px'
  const safeTitle = escHtml(title)
  const safeMsg = escHtml(message).replace(/\n/g, '<br>')
  const safePri = escHtml(primaryText), safeSec = escHtml(secondaryText), safeCan = escHtml(cancelText)
  overlay.innerHTML = '<div style="background:#0a0a1a;border:1px solid #00ffcc66;border-radius:8px;max-width:460px;width:100%;padding:24px;font-family:var(--ff,monospace)">'
    + '<div style="font-size:14px;font-weight:700;color:#00ffcc;margin-bottom:16px;letter-spacing:1px">' + safeTitle + '</div>'
    + '<div style="font-size:11px;color:#ccc;line-height:1.7;margin-bottom:24px">' + safeMsg + '</div>'
    + '<div style="display:flex;gap:10px;justify-content:flex-end;flex-wrap:wrap">'
    + '<button id="zeusConfirmCancel" style="padding:8px 16px;background:#1a1a2e;border:1px solid #333;color:#888;border-radius:4px;cursor:pointer;font-family:var(--ff,monospace);font-size:11px;letter-spacing:1px">' + safeCan + '</button>'
    + '<button id="zeusConfirmSec" style="padding:8px 16px;background:#1a2a1a;border:1px solid #f0c040;color:#f0c040;border-radius:4px;cursor:pointer;font-family:var(--ff,monospace);font-size:11px;font-weight:600;letter-spacing:1px">' + safeSec + '</button>'
    + '<button id="zeusConfirmPri" style="padding:8px 16px;background:#001a33;border:1px solid #00aaff;color:#00ffcc;border-radius:4px;cursor:pointer;font-family:var(--ff,monospace);font-size:11px;font-weight:700;letter-spacing:1px">' + safePri + '</button>'
    + '</div></div>'
  document.body.appendChild(overlay)
  ;(document.getElementById('zeusConfirmCancel') as any).onclick = function () { overlay.remove() }
  overlay.onclick = function (e: any) { if (e.target === overlay) overlay.remove() }
  ;(document.getElementById('zeusConfirmPri') as any).onclick = function () { overlay.remove(); if (typeof onPrimary === 'function') onPrimary() }
  ;(document.getElementById('zeusConfirmSec') as any).onclick = function () { overlay.remove(); if (typeof onSecondary === 'function') onSecondary() }
}

// ═══════════════════════════════════════════════════════
// ADD FUNDS / RESET DEMO
// ═══════════════════════════════════════════════════════
export function promptAddFunds(): void {
  const amount = prompt('Enter amount to add to demo balance (USD):', '5000'); if (!amount) return
  const num = parseFloat(amount); if (!num || num <= 0 || num > 1000000) { toast('Invalid amount', 3000, _ZI.w); return }
  api.raw<any>('POST', '/api/at/demo/add-funds', { amount: num }).then(function (data: any) { if (data.ok) { TP.demoBalance = data.balance; w.updateDemoBalance(); toast('Added $' + num.toLocaleString() + ' to demo balance'); if (typeof w._atPollOnce === 'function') setTimeout(w._atPollOnce, 500) } else { toast((data.error || 'Failed'), 3000, _ZI.x) } }).catch(function () { toast('Network error', 3000, _ZI.x) })
}

export function promptResetDemo(): void {
  _showConfirmDialog('Reset Demo Balance?', 'This will reset your demo balance to $10,000 and clear all trading statistics.\n\nOpen positions will NOT be closed.\n\nThis action cannot be undone.', 'Cancel', 'Reset Demo', function () {
    api.raw<any>('POST', '/api/at/demo/reset-balance').then(function (data: any) { if (data.ok) { TP.demoBalance = data.balance; TP._serverStartBalance = data.startBalance; TP.demoPnL = 0; TP.demoWins = 0; TP.demoLosses = 0; if (typeof AT !== 'undefined') { AT.totalTrades = 0; AT.wins = 0; AT.losses = 0; AT.totalPnL = 0; AT.dailyPnL = 0; AT.realizedDailyPnL = 0; AT.closedTradesToday = 0 }; w.updateDemoBalance(); toast('Demo balance reset to $10,000', 3000, _ZI.ok); if (typeof w._atPollOnce === 'function') setTimeout(w._atPollOnce, 500) } else { toast((data.error || 'Reset failed'), 3000, _ZI.x) } }).catch(function () { toast('Network error', 3000, _ZI.x) })
  })
}

export function toggleTradePanel(_type: any): void { _toggleManualPanel() }
export function setDemoSide(side: string): void { TP.demoSide = side; el('demoLongBtn')?.classList.toggle('act', side === 'LONG'); el('demoShortBtn')?.classList.toggle('act', side === 'SHORT'); updateDemoLiqPrice() }
export function setLiveSide(side: string): void { TP.liveSide = side; el('liveLongBtn')?.classList.toggle('act', side === 'LONG'); el('liveShortBtn')?.classList.toggle('act', side === 'SHORT'); updateLiveLiqPrice() }

// ===== ORDER TYPE TOGGLE =====
export function onDemoOrdTypeChange(): void {
  const sel = el('demoOrdType'); const entryInput = el('demoEntry'); const entryLabel = el('demoEntryLabel')
  if (!sel || !entryInput) return; const isMarket = sel.value === 'market'
  if (isMarket) { entryInput.readOnly = true; entryInput.value = ''; entryInput.placeholder = 'Market Price'; entryInput.style.opacity = '0.5'; if (entryLabel) entryLabel.textContent = 'ENTRY PRICE (MARKET)' }
  else { entryInput.readOnly = false; entryInput.value = getPrice() ? fP(getPrice()) : ''; entryInput.placeholder = 'Limit Price'; entryInput.style.opacity = '1'; if (entryLabel) entryLabel.textContent = 'LIMIT PRICE' }
  updateDemoLiqPrice()
}

// ===== LEVERAGE =====
export function getDemoLev(): number { const sel = el('demoLev'); if (!sel) return 1; if (sel.value === 'custom') { const c = +(el('demoCustomLev')?.value ?? '') || 20; return Math.min(150, Math.max(1, c)) }; return parseInt(sel.value) || 1 }
export function getLiveLev(): number { const sel = el('liveLev'); if (!sel) return 1; if (sel.value === 'custom') { const c = +(el('liveCustomLev')?.value ?? '') || 20; return Math.min(150, Math.max(1, c)) }; return parseInt(sel.value) || 1 }
export function onDemoLevChange(): void { const sel = el('demoLev'); const row = el('demoCustomLevRow'); if (sel && row) row.style.display = sel.value === 'custom' ? 'flex' : 'none'; updateDemoLiqPrice(); if (typeof w._usScheduleSave === 'function') w._usScheduleSave() }
export function onLiveLevChange(): void { const sel = el('liveLev'); const row = el('liveCustomLevRow'); if (sel && row) row.style.display = sel.value === 'custom' ? 'flex' : 'none'; updateLiveLiqPrice(); if (typeof w._usScheduleSave === 'function') w._usScheduleSave() }

// ===== LIQUIDATION PRICE =====
export function calcLiqPrice(entry: any, lev: any, side: string): number | null {
  const e = w._safe.num(entry, 'liq_entry', 0); const l = w._safe.num(lev, 'liq_lev', 0)
  if (!e || !l || l <= 0) return null; const mm = 0.025 // Binance baseline maintenance margin 2.5%
  if (side === 'LONG') return e * (1 - 1 / l + mm); else return e * (1 + 1 / l - mm)
}
export function updateDemoLiqPrice(): void { const entry = parseFloat(el('demoEntry')?.value || '') || getPrice(); const lev = getDemoLev(); const liq = calcLiqPrice(entry, lev, TP.demoSide); const e = el('demoLiqPrice'); if (e) e.textContent = liq ? '$' + fP(liq) : '\u2014' }
export function updateLiveLiqPrice(): void { const entry = parseFloat(el('liveEntry')?.value || '') || getPrice(); const lev = getLiveLev(); const liq = calcLiqPrice(entry, lev, TP.liveSide); const e = el('liveLiqPrice'); if (e) e.textContent = liq ? '$' + fP(liq) : '\u2014' }

export function setDemoPct(pct: number): void { const e = el('demoSize'); if (e) e.value = (TP.demoBalance * pct / 100).toFixed(0) }
export function setLivePct(pct: number): void { const e = el('liveSize'); if (e) e.value = ((TP.liveBalance || 100) * pct / 100).toFixed(0) }
export function updateDemoBalance(): void {
  // React owns #demoBalance rendering (ManualTradePanel.tsx).
  // Propagate TP.demoBalance → positionsStore so React re-renders reactively.
  if (typeof TP !== 'undefined' && Number.isFinite(TP.demoBalance)) {
    usePositionsStore.getState().setDemoBalance(TP.demoBalance)
  }
}

// ===== PLACE ORDER =====
export function placeDemoOrder(): void {
  const _curMode = (typeof AT !== 'undefined' && AT._serverMode) ? AT._serverMode : 'demo'
  const _curEnv = w._executionEnv
  if (_curMode === 'live' && (_curEnv === null || !w._apiConfigured)) { const _r = w._executionBlockedReason; toast('Cannot place order \u2014 ' + (_r === 'INVALID_ACTIVE_API_CONFIGURATION' ? 'Invalid active API configuration' : 'No valid API credentials configured'), 3500, _ZI.lock); return }

  // [DSL-OFF] Pre-open guard: if DSL engine is OFF, prompt user before placing any manual order
  // [Phase 12.A — Batch F] REAL manual order confirm. TESTNET skips confirm (flow remains
  //   identical to DEMO). REAL branch reads live order parameters (side/symbol/size/leverage
  //   /entry type / price / TP / SL) and exchange label from useUiStore.activeExchange —
  //   no more hardcoded "Binance" lies. DEMO and LOCKED also skip this confirm.
  const _continueToLiveOrPlace = function () {
    if (_curMode === 'live' && w._apiConfigured && _curEnv === 'REAL') {
      const _side = TP.demoSide === 'LONG' ? 'LONG' : 'SHORT'
      const _sym = getSymbol()
      const _ordTypeSel = el('demoOrdType')
      const _ordType = (_ordTypeSel && _ordTypeSel.value === 'limit') ? 'LIMIT' : 'MARKET'
      const _size = parseFloat(el('demoSize')?.value || '0')
      const _lev = getDemoLev()
      const _tp = parseFloat(el('demoTP')?.value || '') || null
      const _sl = parseFloat(el('demoSL')?.value || '') || null
      const _entryPrice = _ordType === 'MARKET' ? getPrice() : (parseFloat(el('demoEntry')?.value || '') || 0)
      const _activeExch = useUiStore.getState().activeExchange
      const _exchLabel = _activeExch === 'binance' ? 'BINANCE' : _activeExch === 'bybit' ? 'BYBIT' : 'ACTIVE EXCHANGE'
      const _entryTxt = _entryPrice > 0 ? ('$' + _entryPrice.toFixed(2)) : '—'
      const _lines: string[] = []
      _lines.push(_side + ' ' + _sym + ' \u2014 ' + _ordType + ' @ ' + _entryTxt)
      _lines.push('Size: $' + (Number.isFinite(_size) ? _size.toFixed(2) : '—') + '  \u00B7  Leverage: ' + _lev + 'x')
      _lines.push('Exchange: ' + _exchLabel + '  \u00B7  Env: REAL')
      if (_tp) _lines.push('TP: $' + _tp.toFixed(2))
      if (_sl) _lines.push('SL: $' + _sl.toFixed(2))
      _lines.push('')
      _lines.push('This order will execute with REAL funds. This action cannot be undone.')
      _showConfirmDialog(
        'Place REAL order on ' + _exchLabel + '?',
        _lines.join('\n'),
        'Cancel', 'Place REAL Order',
        function () { _executePlaceDemoOrder() }
      )
      return
    }
    _executePlaceDemoOrder()
  }

  if (!getDSLEnabled()) {
    _showConfirmDialog3(
      'DSL Engine is OFF',
      'Dynamic Stop Loss is disabled.\n\nIf you continue, this position will NOT be attached to DSL. TP/SL from Risk Management (or the TP/SL fields above) will be placed natively on the exchange.\n\nActivate DSL now to attach the position to the DSL engine, or continue without DSL.',
      'Activate DSL', 'Continue without DSL', 'Cancel',
      function () { try { toggleDSL() } catch (_) {} ; _continueToLiveOrPlace() },
      function () { _continueToLiveOrPlace() },
    )
    return
  }
  _continueToLiveOrPlace()
}

function _executePlaceDemoOrder(): void {
  const _curMode = (typeof AT !== 'undefined' && AT._serverMode) ? AT._serverMode : 'demo'
  const orderTypeSel = el('demoOrdType'); const orderType = (orderTypeSel && orderTypeSel.value === 'limit') ? 'LIMIT' : 'MARKET'
  const size = parseFloat(el('demoSize')?.value || '100'); const lev = getDemoLev()
  const tp = parseFloat(el('demoTP')?.value || '') || null; const sl = parseFloat(el('demoSL')?.value || '') || null
  let entry: number
  if (orderType === 'MARKET') { entry = getPrice() } else { entry = parseFloat(el('demoEntry')?.value || ''); if (!entry || entry <= 0) { toast('Limit price is required', 3000, _ZI.w); return } }
  if (!entry || !size) { toast('Entry price and size required', 3000, _ZI.w); return }
  if (size <= 0) { toast('Size must be positive', 3000, _ZI.w); return }
  if (entry <= 0) { toast('Entry price must be positive', 3000, _ZI.w); return }
  if (orderType === 'LIMIT') { if (TP.demoSide === 'LONG' && entry >= getPrice()) { toast('LONG LIMIT must be below current price'); return }; if (TP.demoSide === 'SHORT' && entry <= getPrice()) { toast('SHORT LIMIT must be above current price'); return } }
  const _valEntry = (orderType === 'LIMIT') ? entry : getPrice()
  if (sl) { if (TP.demoSide === 'LONG' && sl >= _valEntry) { toast('LONG SL must be below entry'); return }; if (TP.demoSide === 'SHORT' && sl <= _valEntry) { toast('SHORT SL must be above entry'); return } }
  if (tp) { if (TP.demoSide === 'LONG' && tp <= _valEntry) { toast('LONG TP must be above entry'); return }; if (TP.demoSide === 'SHORT' && tp >= _valEntry) { toast('SHORT TP must be below entry'); return } }
  if (_curMode === 'live') { _executeLiveManualOrder(orderType, size, entry, lev, tp, sl) } else { _executeDemoManualOrder(orderType, size, entry, lev, tp, sl) }
}

function _registerManualOnServer(pos: any): void {
  if (!pos || pos._serverSeq) return
  // [Phase 9D1] clientReqId: idempotency token for the server dedup window.
  // Two rapid clicks that somehow slip past the client-side lock would hit
  // register-manual with distinct client ids but can share a reqId only if
  // the caller reuses it — so we generate a fresh one per registration.
  // The server stamps it onto the registered position so a second register
  // attempt for the same logical order (retry after transient network fail)
  // can be folded onto the existing seq.
  if (!pos._clientReqId) pos._clientReqId = pos.id + '-' + Math.random().toString(36).slice(2, 8)
  const payload = { symbol: pos.sym, side: pos.side, entryPrice: pos.entry, qty: pos.qty || (pos.size && pos.entry && pos.lev ? +(pos.size / pos.entry * pos.lev).toFixed(6) : 0), leverage: pos.lev || 1, sl: pos.sl || null, tp: pos.tp || null, mode: pos.mode || 'demo', dslParams: pos.dslParams || null, clientReqId: pos._clientReqId }
  api.raw<any>('POST', '/api/at/register-manual', payload).then(function (d: any) { if (d.ok && d.seq) { pos._serverSeq = d.seq; if (typeof w.ZState !== 'undefined' && w.ZState.save) w.ZState.save() } }).catch(function (err: any) { console.warn('[registerManualOnServer]', err.message || err) })
}

// [Phase 9D1] Demo manual-open click-lock — mirrors the live pattern.
//   _demoOrderInFlight: synchronous re-entry guard, held for the full sync
//     body of _executeDemoManualOrder. Prevents two handler invocations
//     (back-to-back React event loop turns) from both pushing a pos into
//     TP.demoPositions before the cooldown ts updates.
//   _DEMO_ORDER_COOLDOWN_MS: post-complete cooldown. 1000ms is conservative
//     for user intent; manual orders are not high-frequency.
let _lastDemoOrderTs = 0
let _demoOrderInFlight = false
const _DEMO_ORDER_COOLDOWN_MS = 1000
function _executeDemoManualOrder(orderType: string, size: number, entry: number, lev: number, tp: any, sl: any): void {
  // [Phase 9D1] Click-lock + cooldown gates — block before any work.
  if (_demoOrderInFlight) { toast('Order already in progress', 2000, _ZI?.lock); return }
  const now = Date.now()
  if (now - _lastDemoOrderTs < _DEMO_ORDER_COOLDOWN_MS) { toast('Order too fast — wait a moment', 2000, _ZI?.lock); return }
  _demoOrderInFlight = true
  _lastDemoOrderTs = now
  try {
    if (size > TP.demoBalance) { toast('Insufficient demo balance', 3000, _ZI.x); return }
    if ((TP.demoPositions || []).filter((p: any) => !p.closed).length >= 20) { toast('Max 20 demo positions', 3000, _ZI?.x); return }
    if (orderType === 'MARKET') {
      const fillPrice = getPrice(); const liqPrice = calcLiqPrice(fillPrice, lev, TP.demoSide)
      const pos = _buildManualPosition(fillPrice, size, lev, tp, sl, liqPrice, 'demo', orderType)
      if (TP.demoPositions.some((p: any) => p.id === pos.id)) return
      TP.demoPositions.push(pos); TP.demoBalance -= size
      usePositionsStore.getState().syncSnapshot({ demoPositions: TP.demoPositions, demoBalance: TP.demoBalance, source: 'bridge' })
      w.updateDemoBalance(); renderDemoPositions()
      if (typeof onPositionOpened === 'function') onPositionOpened(pos, 'manual_demo')
      w.ZState.save(); _registerManualOnServer(pos)
      try { window.dispatchEvent(new CustomEvent('zeus:positionsChanged')) } catch (_) {}
      if (typeof renderTradeMarkers === 'function') renderTradeMarkers()
      toast(pos.side + ' ' + pos.sym.replace('USDT', '') + ' $' + fmt(size) + ' @$' + fP(fillPrice) + ' ' + lev + 'x MARKET')
    } else {
      const pending = { id: Date.now() + Math.floor(Math.random() * 1000), side: TP.demoSide, sym: getSymbol(), limitPrice: entry, size, lev, tp, sl, mode: 'demo', orderType: 'LIMIT', status: 'WAITING', createdAt: Date.now() }
      TP.pendingOrders.push(pending); TP.demoBalance -= size
      w.updateDemoBalance(); w.renderPendingOrders(); w.ZState.save()
      toast(' LIMIT ' + pending.side + ' @$' + fP(entry) + ' $' + fmt(size) + ' ' + lev + 'x \u2014 waiting')
    }
  } finally {
    _demoOrderInFlight = false
  }
}

// [Bug#3 STEP 1] Module-level synchronous re-entry + cooldown guard for live manual order.
// React's useUiStore.setIsPlacingLive is async; button's disabled= and handler's guard
// both read stale state during a rapid double-click → 2 POSTs fire → 2 exchange orders.
// These two flags run sync, in the same tick, so re-entry is blocked BEFORE any await.
let _liveOrderInFlight = false
let _lastLiveOrderCompleteTs = 0
const _LIVE_ORDER_COOLDOWN_MS = 750

function _executeLiveManualOrder(orderType: string, size: number, entry: number, lev: number, tp: any, sl: any): void {
  // [Bug#3 STEP 1] Re-entry + cooldown gates — block before any async work.
  if (_liveOrderInFlight) { toast('Order already in progress', 2000, _ZI?.lock); return }
  if (Date.now() - _lastLiveOrderCompleteTs < _LIVE_ORDER_COOLDOWN_MS) { toast('Order too fast — wait a moment', 2000, _ZI?.lock); return }
  if (typeof manualLivePlaceOrder !== 'function') { toast('Live API not available', 3000, _ZI.lock); return }
  if (!TP.liveBalance || size > TP.liveBalance) { toast('Insufficient live balance', 3000, _ZI?.x); return }
  if (lev < 1 || lev > 125) { toast('Leverage must be 1-125x', 3000, _ZI?.x); return }
  const refPrice = (orderType === 'MARKET') ? getPrice() : entry; if (!refPrice || refPrice <= 0) { toast('Price unavailable — cannot place order', 3000, _ZI.x); return }; const qty = (size * lev) / refPrice; const binanceSide = (TP.demoSide === 'LONG') ? 'BUY' : 'SELL'
  // [batch3-W+] Button text/disabled is React-owned via uiStore.isPlacingLive.
  // Legacy DOM mutation (textContent='Placing...') is removed — React would
  // skip the DOM update on re-render since the VDOM text hadn't changed,
  // leaving the button stuck on "Placing...".
  _liveOrderInFlight = true  // [Bug#3 STEP 1] committed — released in finally
  useUiStore.getState().setIsPlacingLive(true)
  // [Phase 7 — Manual Parity GAP-1] Pre-compute DSL preset from the same DOM inputs used by
  // _buildManualPosition (manual DEMO flow). Forward through manualLivePlaceOrder so the server's
  // registerManualPosition gets the user's preset instead of falling back to DSL_DEFAULTS.
  // null = DSL engine OFF → server skips DSL attach (parity with demo at _registerManualOnServer call).
  const _liveDslParams: any = (function () {
    if (!getDSLEnabled()) return null
    // [Phase 9F1] Prefer the persisted TC (Trading Config) store values over
    // the hidden DOM inputs — settingsStore/config.ts already persists TC
    // across sessions, so reloading the page no longer resets DSL params to
    // the input `defaultValue`. Falls back to DOM for legacy paths.
    const TC = (w as any).TC || {}
    const _openDsl = (Number.isFinite(TC.dslActivatePct) && TC.dslActivatePct > 0) ? TC.dslActivatePct : (parseFloat(el('dslActivatePct')?.value || '') || 0.50)
    const _pl = (Number.isFinite(TC.dslTrailPct) && TC.dslTrailPct > 0) ? TC.dslTrailPct : (parseFloat(el('dslTrailPct')?.value || '') || 0.60)
    const _pr = (Number.isFinite(TC.dslTrailSusPct) && TC.dslTrailSusPct > 0) ? TC.dslTrailSusPct : (parseFloat(el('dslTrailSusPct')?.value || '') || 0.50)
    const _iv = (Number.isFinite(TC.dslExtendPct) && TC.dslExtendPct > 0) ? TC.dslExtendPct : (parseFloat(el('dslExtendPct')?.value || '') || 0.25)
    return { openDslPct: _openDsl, pivotLeftPct: _pl, pivotRightPct: _pr, impulseVPct: _iv }
  })()
  manualLivePlaceOrder({ symbol: getSymbol(), side: binanceSide, type: orderType, quantity: qty.toFixed(8), price: (orderType === 'LIMIT') ? String(entry) : undefined, leverage: lev, referencePrice: getPrice(), dslParams: _liveDslParams }).then(function (result: any) {
    useUiStore.getState().setIsPlacingLive(false)
    if (orderType === 'MARKET') {
      const fillPrice = parseFloat(result.avgPrice) || getPrice(); const liqPrice = calcLiqPrice(fillPrice, lev, TP.demoSide)
      // [Bug#2] Reconcile size to actual fill — exchange stepSize rounds qty DOWN, so user-intent drifts (e.g. $100 → $90).
      const _execQty = parseFloat(result.executedQty) || qty
      const _actualSize = (lev > 0) ? (_execQty * fillPrice) / lev : (_execQty * fillPrice)
      const pos = _buildManualPosition(fillPrice, _actualSize, lev, tp, sl, liqPrice, 'live', 'MARKET'); pos.isLive = true; pos.fromExchange = true; pos.qty = _execQty
      TP.livePositions.push(pos); renderLivePositions()
      // [batch3-W] Notify React store — legacy TP.livePositions mutation doesn't
      // reach PositionsStore, so without this the live position never renders
      // in the React UI (PositionTable / AT panel / ZeusDock).
      usePositionsStore.getState().syncSnapshot({ livePositions: TP.livePositions.slice(), source: 'bridge' })
      if (typeof onPositionOpened === 'function') onPositionOpened(pos, 'manual_live')
      if (typeof w.ZState !== 'undefined' && w.ZState.save) w.ZState.save()
      try { window.dispatchEvent(new CustomEvent('zeus:positionsChanged')) } catch (_) {}
      if (typeof renderTradeMarkers === 'function') renderTradeMarkers()
      toast('LIVE MARKET ' + binanceSide + ' filled @$' + fP(fillPrice) + ' ($' + fmt(_actualSize) + ')')
      // [Phase 8C4] Parity with AT LIVE (autotrade.ts ~L1135–1162): 3x retry
      // per SL and per TP with 1s backoff; on exhaustion mark pos._unprotected
      // and raise a critical alert. Previously manual LIVE fired a single
      // attempt and only toasted on failure — leaving a real position on the
      // exchange without protection and no visible flag.
      const _slTpSym = getSymbol()
      const _slTpSide = TP.demoSide
      const _slTpQty = _execQty.toFixed(8)
      ;(async () => {
        let _slOk = !sl, _tpOk = !tp
        if (sl) {
          for (let _r = 0; _r < 3 && !_slOk; _r++) {
            try {
              await manualLiveSetSL({ symbol: _slTpSym, side: _slTpSide, quantity: _slTpQty, stopPrice: sl })
              _slOk = true
            } catch (e: any) {
              if (_r < 2) await new Promise(res => setTimeout(res, 1000))
              else toast('SL failed after 3 retries: ' + (e.message || e))
            }
          }
        }
        if (tp) {
          for (let _r = 0; _r < 3 && !_tpOk; _r++) {
            try {
              await manualLiveSetTP({ symbol: _slTpSym, side: _slTpSide, quantity: _slTpQty, stopPrice: tp })
              _tpOk = true
            } catch (e: any) {
              if (_r < 2) await new Promise(res => setTimeout(res, 1000))
              else toast('TP failed after 3 retries: ' + (e.message || e))
            }
          }
        }
        if (!_slOk || !_tpOk) {
          pos._unprotected = true
          pos._unprotectedReason = (!_slOk && !_tpOk) ? 'SL+TP failed' : !_slOk ? 'SL failed' : 'TP failed'
          try { w.ncAdd && w.ncAdd('critical', 'alert', 'UNPROTECTED LIVE (manual): ' + _slTpSym + ' ' + _slTpSide + ' — ' + pos._unprotectedReason + '. Check exchange manually!') } catch (_) {}
          toast(_slTpSym + ' MANUAL UNPROTECTED — ' + pos._unprotectedReason, 0, _ZI.siren)
          try { window.dispatchEvent(new CustomEvent('zeus:positionsChanged')) } catch (_) {}
        }
      })()
      if (typeof liveApiSyncState === 'function') setTimeout(liveApiSyncState, 1000)
    } else {
      const pendingLive = { id: result.orderId || Date.now(), exchangeOrderId: result.orderId, side: TP.demoSide, binanceSide, sym: getSymbol(), limitPrice: entry, size, qty, lev, tp, sl, mode: 'live', orderType: 'LIMIT', status: 'WAITING', createdAt: Date.now() }
      TP.manualLivePending.push(pendingLive); w.renderPendingOrders(); w.ZState.save()
      toast('LIVE LIMIT placed orderId=' + (result.orderId || '')); _startLivePendingSync()
    }
  }).catch(function (err: any) { useUiStore.getState().setIsPlacingLive(false); toast('LIVE order failed: ' + (err.message || err)) })
    .finally(function () { _liveOrderInFlight = false; _lastLiveOrderCompleteTs = Date.now() })
}

function _buildManualPosition(fillPrice: number, size: number, lev: number, tp: any, sl: any, liqPrice: any, mode: string, orderType: string): any {
  return {
    id: Date.now() + Math.floor(Math.random() * 1000), side: TP.demoSide, sym: getSymbol(), entry: fillPrice, size, lev, tp, sl, liqPrice, pnl: 0,
    mode, orderType,
    // [Phase 3A] Explicit ownership — never leave autoTrade as undefined (Manual filter depends on it).
    autoTrade: false,
    sourceMode: (mode === 'live') ? 'manual' : 'paper', controlMode: (mode === 'live') ? 'user' : 'paper',
    brainModeAtOpen: (w.S.mode || 'assist'),
    dslParams: (() => {
      // [DSL-OFF] If DSL engine is OFF, do NOT attach DSL. Server will treat null as "skip DSL" and
      // place native TP/SL from Risk Management instead.
      if (!getDSLEnabled()) return null
      // [MANUAL DSL] Manual positions use user-set DSL inputs directly — no Brain.
      // Brain-driven AT positions get params via serverDSL.getPreset() on server.
      // [Phase 9F1] Prefer persisted TC store values over DOM inputs so params
      // survive reload (DSLZonePanel config row is display:none, so DOM holds
      // only the defaultValue after a fresh mount until TC hydrates).
      const TC = (w as any).TC || {}
      const _openDsl = (Number.isFinite(TC.dslActivatePct) && TC.dslActivatePct > 0) ? TC.dslActivatePct : (parseFloat(el('dslActivatePct')?.value || '') || 0.50)
      const _pl = (Number.isFinite(TC.dslTrailPct) && TC.dslTrailPct > 0) ? TC.dslTrailPct : (parseFloat(el('dslTrailPct')?.value || '') || 0.60)
      const _pr = (Number.isFinite(TC.dslTrailSusPct) && TC.dslTrailSusPct > 0) ? TC.dslTrailSusPct : (parseFloat(el('dslTrailSusPct')?.value || '') || 0.50)
      const _iv = (Number.isFinite(TC.dslExtendPct) && TC.dslExtendPct > 0) ? TC.dslExtendPct : (parseFloat(el('dslExtendPct')?.value || '') || 0.25)
      const _tgt = TP.demoSide === 'LONG' ? fillPrice * (1 + _openDsl / 100) : fillPrice * (1 - _openDsl / 100)
      return { openDslPct: _openDsl, pivotLeftPct: _pl, pivotRightPct: _pr, impulseVPct: _iv, dslTargetPrice: _tgt }
    })(),
    dslAdaptiveState: 'calm', dslHistory: [], openTs: Date.now(), filledAt: Date.now(),
  }
}

// ===== getSymPrice (used by many modules) =====
export function getSymPrice(pos: any): number {
  if (!pos) return 0
  const sym = pos.sym || pos.symbol || getSymbol()
  if (sym === getSymbol() && getPrice() > 0) return getPrice()
  if (w.allPrices && w.allPrices[sym] > 0) return w.allPrices[sym]
  if (w.wlPrices && w.wlPrices[sym]?.price > 0) return w.wlPrices[sym].price
  return pos.entry || 0
}
