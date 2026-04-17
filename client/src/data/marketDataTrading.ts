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
import { _startLivePendingSync , renderDemoPositions } from './marketDataPositions'
import { runDSLBrain, toggleDSL } from '../trading/dsl'
import { manualLivePlaceOrder, manualLiveSetSL, manualLiveSetTP } from '../trading/liveApi'
import { calcDslTargetPrice } from '../engine/brain'
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
  api.raw<any>('POST', '/api/at/mode', { mode }).then(function (data: any) {
    if (data.ok) {
      if (typeof AT !== 'undefined') AT._serverMode = mode
      _applyGlobalModeUI(mode)
      if (mode === 'demo') { toast('Demo Mode Activated', 3000, _ZI.ok) }
      else { const _toastEnv = w._resolvedEnv || (w._exchangeMode === 'testnet' ? 'TESTNET' : 'REAL'); if (!w._apiConfigured) toast('Live Mode Locked \u2014 Execution unavailable until API keys are configured', 3000, _ZI.w); else if (_toastEnv === 'TESTNET') toast('Testnet Trading Mode Activated', 3000, _ZI.ok); else toast('Real Trading Mode Activated', 3000, _ZI.ok) }
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
  const _env = w._resolvedEnv || (mode === 'demo' ? 'DEMO' : 'REAL')
  const atModeDisp = el('atModeDisplay'), atModeLbl = el('atModeLabel'), atWarn = el('atLiveWarn')
  const execLocked = mode === 'live' && !w._apiConfigured
  if (mode === 'live') {
    const _atIsTestnet = _env === 'TESTNET'; const _atEnvLabel = _atIsTestnet ? 'TESTNET MODE' : 'LIVE MODE'; const _atEnvShort = _atIsTestnet ? 'TESTNET' : 'LIVE'; const _atEnvColor = _atIsTestnet ? 'var(--gold)' : 'var(--red-bright)'; const _atEnvColorDim = _atIsTestnet ? '#f0c04044' : '#ff444444'; const _atEnvIcon = _atIsTestnet ? _ZI.dYlw : _ZI.dRed
    if (atModeDisp) { atModeDisp.innerHTML = execLocked ? _atEnvIcon + ' ' + _atEnvLabel + ' &middot; ' + _ZI.w + ' EXEC LOCKED' : _atEnvIcon + ' ' + _atEnvLabel; atModeDisp.style.color = execLocked ? 'var(--orange)' : _atEnvColor; atModeDisp.style.borderColor = execLocked ? '#ff880044' : _atEnvColorDim }
    if (atModeLbl) { atModeLbl.innerHTML = execLocked ? _atEnvIcon + ' ' + _atEnvShort + ' ' + _ZI.w : _atEnvIcon + ' ' + _atEnvShort; atModeLbl.style.color = execLocked ? 'var(--orange)' : _atEnvColor }
    if (atWarn) { atWarn.style.display = 'block'; atWarn.textContent = execLocked ? 'EXECUTION LOCKED \u2014 Exchange not configured.' : (_atIsTestnet ? 'TESTNET MODE ACTIVE: Auto trades will execute on Binance TESTNET' : 'LIVE MODE ACTIVE: Auto trades will execute with REAL funds'); atWarn.style.color = execLocked ? 'var(--orange)' : '' }
  } else {
    if (atModeDisp) { atModeDisp.innerHTML = _ZI.pad + ' DEMO MODE'; atModeDisp.style.color = 'var(--pur)'; atModeDisp.style.borderColor = '#aa44ff44' }
    if (atModeLbl) { atModeLbl.innerHTML = _ZI.pad + ' DEMO'; atModeLbl.style.color = 'var(--pur)' }
    if (atWarn) { atWarn.style.display = 'none'; atWarn.style.color = '' }
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
export function getDemoLev(): number { const sel = el('demoLev'); if (!sel) return 1; if (sel.value === 'custom') { const c = +(el('demoCustomLev')?.value) || 20; return Math.min(150, Math.max(1, c)) }; return parseInt(sel.value) || 1 }
export function getLiveLev(): number { const sel = el('liveLev'); if (!sel) return 1; if (sel.value === 'custom') { const c = +(el('liveCustomLev')?.value) || 20; return Math.min(150, Math.max(1, c)) }; return parseInt(sel.value) || 1 }
export function onDemoLevChange(): void { const sel = el('demoLev'); const row = el('demoCustomLevRow'); if (sel && row) row.style.display = sel.value === 'custom' ? 'flex' : 'none'; updateDemoLiqPrice(); if (typeof w._usScheduleSave === 'function') w._usScheduleSave() }
export function onLiveLevChange(): void { const sel = el('liveLev'); const row = el('liveCustomLevRow'); if (sel && row) row.style.display = sel.value === 'custom' ? 'flex' : 'none'; updateLiveLiqPrice(); if (typeof w._usScheduleSave === 'function') w._usScheduleSave() }

// ===== LIQUIDATION PRICE =====
export function calcLiqPrice(entry: any, lev: any, side: string): number | null {
  const e = w._safe.num(entry, 'liq_entry', 0); const l = w._safe.num(lev, 'liq_lev', 0)
  if (!e || !l || l <= 0) return null; const mm = 0.025 // Binance baseline maintenance margin 2.5%
  if (side === 'LONG') return e * (1 - 1 / l + mm); else return e * (1 + 1 / l - mm)
}
export function updateDemoLiqPrice(): void { const entry = parseFloat(el('demoEntry')?.value) || getPrice(); const lev = getDemoLev(); const liq = calcLiqPrice(entry, lev, TP.demoSide); const e = el('demoLiqPrice'); if (e) e.textContent = liq ? '$' + fP(liq) : '\u2014' }
export function updateLiveLiqPrice(): void { const entry = parseFloat(el('liveEntry')?.value) || getPrice(); const lev = getLiveLev(); const liq = calcLiqPrice(entry, lev, TP.liveSide); const e = el('liveLiqPrice'); if (e) e.textContent = liq ? '$' + fP(liq) : '\u2014' }

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
  const _curEnv = w._resolvedEnv || (_curMode === 'demo' ? 'DEMO' : 'REAL')
  if (_curMode === 'live' && !w._apiConfigured) { toast('Cannot place order \u2014 exchange not configured', 3000, _ZI.lock); return }

  // [DSL-OFF] Pre-open guard: if DSL engine is OFF, prompt user before placing any manual order
  const _continueToLiveOrPlace = function () {
    if (_curMode === 'live' && w._apiConfigured) {
      const _isTestnet = _curEnv === 'TESTNET'
      _showConfirmDialog(
        _isTestnet ? 'Place Testnet Order?' : 'Place Real Order?',
        _isTestnet ? 'You are about to place an order on Binance TESTNET with TEST funds.' : 'You are about to place a REAL order on Binance with REAL funds.\n\nThis action cannot be undone.',
        'Cancel', _isTestnet ? 'Place Testnet Order' : 'Place Real Order',
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
  const tp = parseFloat(el('demoTP')?.value) || null; const sl = parseFloat(el('demoSL')?.value) || null
  let entry: number
  if (orderType === 'MARKET') { entry = getPrice() } else { entry = parseFloat(el('demoEntry')?.value); if (!entry || entry <= 0) { toast('Limit price is required', 3000, _ZI.w); return } }
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
  const payload = { symbol: pos.sym, side: pos.side, entryPrice: pos.entry, qty: pos.qty || (pos.size && pos.entry && pos.lev ? +(pos.size / pos.entry * pos.lev).toFixed(6) : 0), leverage: pos.lev || 1, sl: pos.sl || null, tp: pos.tp || null, mode: pos.mode || 'demo', dslParams: pos.dslParams || null }
  api.raw<any>('POST', '/api/at/register-manual', payload).then(function (d: any) { if (d.ok && d.seq) { pos._serverSeq = d.seq; if (typeof w.ZState !== 'undefined' && w.ZState.save) w.ZState.save() } }).catch(function (err: any) { console.warn('[registerManualOnServer]', err.message || err) })
}

let _lastDemoOrderTs = 0
function _executeDemoManualOrder(orderType: string, size: number, entry: number, lev: number, tp: any, sl: any): void {
  const now = Date.now()
  if (now - _lastDemoOrderTs < 1000) return
  _lastDemoOrderTs = now
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
}

function _executeLiveManualOrder(orderType: string, size: number, entry: number, lev: number, tp: any, sl: any): void {
  if (typeof manualLivePlaceOrder !== 'function') { toast('Live API not available', 3000, _ZI.lock); return }
  if (!TP.liveBalance || size > TP.liveBalance) { toast('Insufficient live balance', 3000, _ZI?.x); return }
  if (lev < 1 || lev > 125) { toast('Leverage must be 1-125x', 3000, _ZI?.x); return }
  const refPrice = (orderType === 'MARKET') ? getPrice() : entry; if (!refPrice || refPrice <= 0) { toast('Price unavailable — cannot place order', 3000, _ZI.x); return }; const qty = (size * lev) / refPrice; const binanceSide = (TP.demoSide === 'LONG') ? 'BUY' : 'SELL'
  const execBtn = el('demoExec'); if (execBtn) { execBtn.disabled = true; execBtn.textContent = 'Placing...' }
  manualLivePlaceOrder({ symbol: getSymbol(), side: binanceSide, type: orderType, quantity: qty.toFixed(8), price: (orderType === 'LIMIT') ? String(entry) : undefined, leverage: lev, referencePrice: getPrice() }).then(function (result: any) {
    if (execBtn) { execBtn.disabled = false; setDemoSide(TP.demoSide) }
    if (orderType === 'MARKET') {
      const fillPrice = parseFloat(result.avgPrice) || getPrice(); const liqPrice = calcLiqPrice(fillPrice, lev, TP.demoSide)
      const pos = _buildManualPosition(fillPrice, size, lev, tp, sl, liqPrice, 'live', 'MARKET'); pos.isLive = true; pos.fromExchange = true; pos.qty = parseFloat(result.executedQty) || qty
      TP.livePositions.push(pos); renderLivePositions()
      if (typeof onPositionOpened === 'function') onPositionOpened(pos, 'manual_live')
      if (typeof w.ZState !== 'undefined' && w.ZState.save) w.ZState.save()
      try { window.dispatchEvent(new CustomEvent('zeus:positionsChanged')) } catch (_) {}
      if (typeof renderTradeMarkers === 'function') renderTradeMarkers()
      toast('LIVE MARKET ' + binanceSide + ' filled @$' + fP(fillPrice))
      if (sl) { manualLiveSetSL({ symbol: getSymbol(), side: TP.demoSide, quantity: qty.toFixed(8), stopPrice: sl }).catch(function (e: any) { toast('SL failed: ' + (e.message || e)) }) }
      if (tp) { manualLiveSetTP({ symbol: getSymbol(), side: TP.demoSide, quantity: qty.toFixed(8), stopPrice: tp }).catch(function (e: any) { toast('TP failed: ' + (e.message || e)) }) }
      if (typeof liveApiSyncState === 'function') setTimeout(liveApiSyncState, 1000)
    } else {
      const pendingLive = { id: result.orderId || Date.now(), exchangeOrderId: result.orderId, side: TP.demoSide, binanceSide, sym: getSymbol(), limitPrice: entry, size, qty, lev, tp, sl, mode: 'live', orderType: 'LIMIT', status: 'WAITING', createdAt: Date.now() }
      TP.manualLivePending.push(pendingLive); w.renderPendingOrders(); w.ZState.save()
      toast('LIVE LIMIT placed orderId=' + (result.orderId || '')); _startLivePendingSync()
    }
  }).catch(function (err: any) { if (execBtn) { execBtn.disabled = false; setDemoSide(TP.demoSide) }; toast('LIVE order failed: ' + (err.message || err)) })
}

function _buildManualPosition(fillPrice: number, size: number, lev: number, tp: any, sl: any, liqPrice: any, mode: string, orderType: string): any {
  return {
    id: Date.now() + Math.floor(Math.random() * 1000), side: TP.demoSide, sym: getSymbol(), entry: fillPrice, size, lev, tp, sl, liqPrice, pnl: 0,
    mode, orderType, sourceMode: (mode === 'live') ? 'manual' : 'paper', controlMode: (mode === 'live') ? 'user' : 'paper',
    brainModeAtOpen: (w.S.mode || 'assist'),
    dslParams: (() => {
      // [DSL-OFF] If DSL engine is OFF, do NOT attach DSL. Server will treat null as "skip DSL" and
      // place native TP/SL from Risk Management instead.
      if (!getDSLEnabled()) return null
      // [MANUAL DSL] Manual positions use user-set DSL inputs directly — no Brain.
      // Brain-driven AT positions get params via serverDSL.getPreset() on server.
      const _openDsl = parseFloat(el('dslActivatePct')?.value) || 0.50
      const _pl = parseFloat(el('dslTrailPct')?.value) || 0.60
      const _pr = parseFloat(el('dslTrailSusPct')?.value) || 0.50
      const _iv = parseFloat(el('dslExtendPct')?.value) || 0.25
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
