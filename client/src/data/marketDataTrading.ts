// Zeus — data/marketDataTrading.ts
// Ported 1:1 from public/js/data/marketData.js lines 2036-2660 (Chunk E)
// Trading panel UI: mode switch, add funds, demo/live orders, leverage, liq price

const w = window as any

// ═══════════════════════════════════════════════════════
// GLOBAL MODE SWITCH
// ═══════════════════════════════════════════════════════
export function switchGlobalMode(mode: any): void {
  const currentMode = (typeof w.AT !== 'undefined' && w.AT._serverMode) ? w.AT._serverMode : 'demo'
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
  fetch('/api/at/mode', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify({ mode }) }).then(function (r) { return r.json() }).then(function (data: any) {
    if (data.ok) {
      if (typeof w.AT !== 'undefined') w.AT._serverMode = mode
      _applyGlobalModeUI(mode)
      if (mode === 'demo') { w.toast('Demo Mode Activated', 3000, w._ZI.ok) }
      else { const _toastEnv = w._resolvedEnv || (w._exchangeMode === 'testnet' ? 'TESTNET' : 'REAL'); if (!w._apiConfigured) w.toast('Live Mode Locked \u2014 Execution unavailable until API keys are configured', 3000, w._ZI.w); else if (_toastEnv === 'TESTNET') w.toast('Testnet Trading Mode Activated', 3000, w._ZI.ok); else w.toast('Real Trading Mode Activated', 3000, w._ZI.ok) }
      _showManualPanel()
      if (typeof w.runDSLBrain === 'function') w.runDSLBrain()
      if (typeof w._atPollOnce === 'function') setTimeout(w._atPollOnce, 500)
    } else { const _fails = (data.checks || []).filter(function (c: any) { return !c.ok }); const _reason = _fails.length > 0 ? _fails.slice(0, 2).map(function (c: any) { return c.detail }).join('. ') : (data.error || 'Unknown error'); w.toast('Cannot switch to LIVE: ' + _reason, 5000, w._ZI.lock) }
  }).catch(function () { w.toast('Network error', 3000, w._ZI.x) })
}

export function _applyGlobalModeUI(mode: string): void {
  const btnD = w.el('btnDemo'), btnL = w.el('btnLive')
  if (mode === 'live') { if (btnD) btnD.classList.remove('active'); if (btnL) btnL.classList.add('active') }
  else { if (btnD) btnD.classList.add('active'); if (btnL) btnL.classList.remove('active') }
  const _env = w._resolvedEnv || (mode === 'demo' ? 'DEMO' : 'REAL')
  const atModeDisp = w.el('atModeDisplay'), atModeLbl = w.el('atModeLabel'), atWarn = w.el('atLiveWarn')
  const execLocked = mode === 'live' && !w._apiConfigured
  if (mode === 'live') {
    const _atIsTestnet = _env === 'TESTNET'; const _atEnvLabel = _atIsTestnet ? 'TESTNET MODE' : 'LIVE MODE'; const _atEnvShort = _atIsTestnet ? 'TESTNET' : 'LIVE'; const _atEnvColor = _atIsTestnet ? 'var(--gold)' : 'var(--red-bright)'; const _atEnvColorDim = _atIsTestnet ? '#f0c04044' : '#ff444444'; const _atEnvIcon = _atIsTestnet ? w._ZI.dYlw : w._ZI.dRed
    if (atModeDisp) { atModeDisp.innerHTML = execLocked ? _atEnvIcon + ' ' + _atEnvLabel + ' &middot; ' + w._ZI.w + ' EXEC LOCKED' : _atEnvIcon + ' ' + _atEnvLabel; atModeDisp.style.color = execLocked ? 'var(--orange)' : _atEnvColor; atModeDisp.style.borderColor = execLocked ? '#ff880044' : _atEnvColorDim }
    if (atModeLbl) { atModeLbl.innerHTML = execLocked ? _atEnvIcon + ' ' + _atEnvShort + ' ' + w._ZI.w : _atEnvIcon + ' ' + _atEnvShort; atModeLbl.style.color = execLocked ? 'var(--orange)' : _atEnvColor }
    if (atWarn) { atWarn.style.display = 'block'; atWarn.textContent = execLocked ? 'EXECUTION LOCKED \u2014 Exchange not configured.' : (_atIsTestnet ? 'TESTNET MODE ACTIVE: Auto trades will execute on Binance TESTNET' : 'LIVE MODE ACTIVE: Auto trades will execute with REAL funds'); atWarn.style.color = execLocked ? 'var(--orange)' : '' }
  } else {
    if (atModeDisp) { atModeDisp.innerHTML = w._ZI.pad + ' DEMO MODE'; atModeDisp.style.color = 'var(--pur)'; atModeDisp.style.borderColor = '#aa44ff44' }
    if (atModeLbl) { atModeLbl.innerHTML = w._ZI.pad + ' DEMO'; atModeLbl.style.color = 'var(--pur)' }
    if (atWarn) { atWarn.style.display = 'none'; atWarn.style.color = '' }
  }
  const af = w.el('btnAddFunds'), rd = w.el('btnResetDemo')
  if (af) af.style.display = mode === 'demo' ? '' : 'none'
  if (rd) rd.style.display = mode === 'demo' ? '' : 'none'
  // NOTE: #demoExec, #panelDemo header, #demoBalance are React-controlled.
  // Do NOT set innerHTML on them — React owns those DOM nodes.
  // Only set non-destructive properties (disabled, opacity, dataset).
  const execBtn = w.el('demoExec')
  if (execBtn) {
    if (mode === 'live' && !w._apiConfigured) { execBtn.disabled = false; execBtn.style.opacity = '0.6'; execBtn.dataset.execMode = 'locked' }
    else if (mode === 'live') { execBtn.disabled = false; execBtn.style.opacity = ''; execBtn.dataset.execMode = 'live' }
    else { execBtn.disabled = false; execBtn.style.opacity = ''; execBtn.dataset.execMode = 'demo' }
  }
  if (typeof w.renderTradeMarkers === 'function') w.renderTradeMarkers()
  if (typeof w.updateModeBar === 'function') w.updateModeBar()
}

function _toggleManualPanel(): void { w.TP.demoOpen = !w.TP.demoOpen; const p = w.el('panelDemo'); if (p) p.style.display = w.TP.demoOpen ? 'block' : 'none'; if (w.TP.demoOpen && w.S.price) { const ei = w.el('demoEntry'); if (ei) ei.placeholder = '$' + w.fP(w.S.price) } }
function _showManualPanel(): void { w.TP.demoOpen = true; const p = w.el('panelDemo'); if (p) p.style.display = 'block'; if (w.S.price) { const ei = w.el('demoEntry'); if (ei) ei.placeholder = '$' + w.fP(w.S.price) } }

// ═══════════════════════════════════════════════════════
// CONFIRM DIALOG
// ═══════════════════════════════════════════════════════
export function _showConfirmDialog(title: string, message: string, cancelText: string, confirmText: string, onConfirm: () => void): void {
  const old = document.getElementById('zeusConfirmOverlay'); if (old) old.remove()
  const overlay = document.createElement('div'); overlay.id = 'zeusConfirmOverlay'
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.85);z-index:99999;display:flex;align-items:center;justify-content:center;padding:20px'
  const safeTitle = typeof w.escHtml === 'function' ? w.escHtml(title) : title
  const safeMsg = (typeof w.escHtml === 'function' ? w.escHtml(message) : message).replace(/\n/g, '<br>')
  const safeCancelText = typeof w.escHtml === 'function' ? w.escHtml(cancelText) : cancelText
  const safeConfirmText = typeof w.escHtml === 'function' ? w.escHtml(confirmText) : confirmText
  const isLive = confirmText.toLowerCase().includes('live') || confirmText.toLowerCase().includes('real')
  const confirmColor = isLive ? 'var(--red-bright)' : 'var(--cyan)'; const confirmBg = isLive ? '#2a0000' : '#001a33'; const confirmBorder = isLive ? '#ff4444' : '#00aaff'
  overlay.innerHTML = '<div style="background:#0a0a1a;border:1px solid ' + confirmBorder + '66;border-radius:8px;max-width:420px;width:100%;padding:24px;font-family:var(--ff,monospace)"><div style="font-size:14px;font-weight:700;color:' + confirmColor + ';margin-bottom:16px;letter-spacing:1px">' + safeTitle + '</div><div style="font-size:11px;color:#ccc;line-height:1.7;margin-bottom:24px">' + safeMsg + '</div><div style="display:flex;gap:12px;justify-content:flex-end"><button id="zeusConfirmCancel" style="padding:8px 20px;background:#1a1a2e;border:1px solid #333;color:#888;border-radius:4px;cursor:pointer;font-family:var(--ff,monospace);font-size:11px;letter-spacing:1px">' + safeCancelText + '</button><button id="zeusConfirmOk" style="padding:8px 20px;background:' + confirmBg + ';border:1px solid ' + confirmBorder + ';color:' + confirmColor + ';border-radius:4px;cursor:pointer;font-family:var(--ff,monospace);font-size:11px;font-weight:700;letter-spacing:1px">' + safeConfirmText + '</button></div></div>'
  document.body.appendChild(overlay)
  ;(document.getElementById('zeusConfirmCancel') as any).onclick = function () { overlay.remove() }
  overlay.onclick = function (e: any) { if (e.target === overlay) overlay.remove() }
  ;(document.getElementById('zeusConfirmOk') as any).onclick = function () { overlay.remove(); if (typeof onConfirm === 'function') onConfirm() }
}

// ═══════════════════════════════════════════════════════
// ADD FUNDS / RESET DEMO
// ═══════════════════════════════════════════════════════
export function promptAddFunds(): void {
  const amount = prompt('Enter amount to add to demo balance (USD):', '5000'); if (!amount) return
  const num = parseFloat(amount); if (!num || num <= 0 || num > 1000000) { w.toast('Invalid amount', 3000, w._ZI.w); return }
  fetch('/api/at/demo/add-funds', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify({ amount: num }) }).then(function (r) { return r.json() }).then(function (data: any) { if (data.ok) { w.TP.demoBalance = data.balance; w.updateDemoBalance(); w.toast('Added $' + num.toLocaleString() + ' to demo balance'); if (typeof w._atPollOnce === 'function') setTimeout(w._atPollOnce, 500) } else { w.toast((data.error || 'Failed'), 3000, w._ZI.x) } }).catch(function () { w.toast('Network error', 3000, w._ZI.x) })
}

export function promptResetDemo(): void {
  _showConfirmDialog('Reset Demo Balance?', 'This will reset your demo balance to $10,000 and clear all trading statistics.\n\nOpen positions will NOT be closed.\n\nThis action cannot be undone.', 'Cancel', 'Reset Demo', function () {
    fetch('/api/at/demo/reset-balance', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin' }).then(function (r) { return r.json() }).then(function (data: any) { if (data.ok) { w.TP.demoBalance = data.balance; w.TP._serverStartBalance = data.startBalance; w.updateDemoBalance(); w.toast('Demo balance reset to $10,000', 3000, w._ZI.ok); if (typeof w._atPollOnce === 'function') setTimeout(w._atPollOnce, 500) } else { w.toast((data.error || 'Reset failed'), 3000, w._ZI.x) } }).catch(function () { w.toast('Network error', 3000, w._ZI.x) })
  })
}

export function toggleTradePanel(_type: any): void { _toggleManualPanel() }
export function setDemoSide(side: string): void { w.TP.demoSide = side; w.el('demoLongBtn')?.classList.toggle('act', side === 'LONG'); w.el('demoShortBtn')?.classList.toggle('act', side === 'SHORT'); updateDemoLiqPrice() }
export function setLiveSide(side: string): void { w.TP.liveSide = side; w.el('liveLongBtn')?.classList.toggle('act', side === 'LONG'); w.el('liveShortBtn')?.classList.toggle('act', side === 'SHORT'); updateLiveLiqPrice() }

// ===== ORDER TYPE TOGGLE =====
export function onDemoOrdTypeChange(): void {
  const sel = w.el('demoOrdType'); const entryInput = w.el('demoEntry'); const entryLabel = w.el('demoEntryLabel')
  if (!sel || !entryInput) return; const isMarket = sel.value === 'market'
  if (isMarket) { entryInput.readOnly = true; entryInput.value = ''; entryInput.placeholder = 'Market Price'; entryInput.style.opacity = '0.5'; if (entryLabel) entryLabel.textContent = 'ENTRY PRICE (MARKET)' }
  else { entryInput.readOnly = false; entryInput.value = w.S.price ? w.fP(w.S.price) : ''; entryInput.placeholder = 'Limit Price'; entryInput.style.opacity = '1'; if (entryLabel) entryLabel.textContent = 'LIMIT PRICE' }
  updateDemoLiqPrice()
}

// ===== LEVERAGE =====
export function getDemoLev(): number { const sel = w.el('demoLev'); if (!sel) return 1; if (sel.value === 'custom') { const c = +(w.el('demoCustomLev')?.value) || 20; return Math.min(150, Math.max(1, c)) }; return parseInt(sel.value) || 1 }
export function getLiveLev(): number { const sel = w.el('liveLev'); if (!sel) return 1; if (sel.value === 'custom') { const c = +(w.el('liveCustomLev')?.value) || 20; return Math.min(150, Math.max(1, c)) }; return parseInt(sel.value) || 1 }
export function onDemoLevChange(): void { const sel = w.el('demoLev'); const row = w.el('demoCustomLevRow'); if (sel && row) row.style.display = sel.value === 'custom' ? 'flex' : 'none'; updateDemoLiqPrice(); if (typeof w._usScheduleSave === 'function') w._usScheduleSave() }
export function onLiveLevChange(): void { const sel = w.el('liveLev'); const row = w.el('liveCustomLevRow'); if (sel && row) row.style.display = sel.value === 'custom' ? 'flex' : 'none'; updateLiveLiqPrice(); if (typeof w._usScheduleSave === 'function') w._usScheduleSave() }

// ===== LIQUIDATION PRICE =====
export function calcLiqPrice(entry: any, lev: any, side: string): number | null {
  const e = w._safe.num(entry, 'liq_entry', 0); const l = w._safe.num(lev, 'liq_lev', 0)
  if (!e || !l || l <= 0) return null; const mm = 0.004
  if (side === 'LONG') return e * (1 - 1 / l + mm); else return e * (1 + 1 / l - mm)
}
export function updateDemoLiqPrice(): void { const entry = parseFloat(w.el('demoEntry')?.value) || w.S.price; const lev = getDemoLev(); const liq = calcLiqPrice(entry, lev, w.TP.demoSide); const e = w.el('demoLiqPrice'); if (e) e.textContent = liq ? '$' + w.fP(liq) : '\u2014' }
export function updateLiveLiqPrice(): void { const entry = parseFloat(w.el('liveEntry')?.value) || w.S.price; const lev = getLiveLev(); const liq = calcLiqPrice(entry, lev, w.TP.liveSide); const e = w.el('liveLiqPrice'); if (e) e.textContent = liq ? '$' + w.fP(liq) : '\u2014' }

export function setDemoPct(pct: number): void { const e = w.el('demoSize'); if (e) e.value = (w.TP.demoBalance * pct / 100).toFixed(0) }
export function setLivePct(pct: number): void { const e = w.el('liveSize'); if (e) e.value = ((w.TP.liveBalance || 100) * pct / 100).toFixed(0) }
export function updateDemoBalance(): void {
  const e = w.el('demoBalance'); if (!e) return
  const _gm = (typeof w.AT !== 'undefined' && w.AT._serverMode) ? w.AT._serverMode : 'demo'
  if (_gm === 'live') { if (w._apiConfigured && typeof w.TP !== 'undefined' && w.TP.liveBalance > 0) { const _balPrefix = (w._resolvedEnv === 'TESTNET') ? 'BAL (TESTNET): $' : 'BAL: $'; e.textContent = _balPrefix + w.TP.liveBalance.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) } else { e.textContent = 'BAL: Exchange not configured' } }
  else { e.textContent = 'BAL: $' + w.TP.demoBalance.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) }
}

// ===== PLACE ORDER =====
export function placeDemoOrder(): void {
  const _curMode = (typeof w.AT !== 'undefined' && w.AT._serverMode) ? w.AT._serverMode : 'demo'
  const _curEnv = w._resolvedEnv || (_curMode === 'demo' ? 'DEMO' : 'REAL')
  if (_curMode === 'live' && !w._apiConfigured) { w.toast('Cannot place order \u2014 exchange not configured', 3000, w._ZI.lock); return }
  if (_curMode === 'live' && w._apiConfigured) { const _isTestnet = _curEnv === 'TESTNET'; _showConfirmDialog(_isTestnet ? 'Place Testnet Order?' : 'Place Real Order?', _isTestnet ? 'You are about to place an order on Binance TESTNET with TEST funds.' : 'You are about to place a REAL order on Binance with REAL funds.\n\nThis action cannot be undone.', 'Cancel', _isTestnet ? 'Place Testnet Order' : 'Place Real Order', function () { _executePlaceDemoOrder() }); return }
  _executePlaceDemoOrder()
}

function _executePlaceDemoOrder(): void {
  const _curMode = (typeof w.AT !== 'undefined' && w.AT._serverMode) ? w.AT._serverMode : 'demo'
  const orderTypeSel = w.el('demoOrdType'); const orderType = (orderTypeSel && orderTypeSel.value === 'limit') ? 'LIMIT' : 'MARKET'
  const size = parseFloat(w.el('demoSize')?.value || '100'); const lev = getDemoLev()
  const tp = parseFloat(w.el('demoTP')?.value) || null; const sl = parseFloat(w.el('demoSL')?.value) || null
  let entry: number
  if (orderType === 'MARKET') { entry = w.S.price } else { entry = parseFloat(w.el('demoEntry')?.value); if (!entry || entry <= 0) { w.toast('Limit price is required', 3000, w._ZI.w); return } }
  if (!entry || !size) { w.toast('Entry price and size required', 3000, w._ZI.w); return }
  if (size <= 0) { w.toast('Size must be positive', 3000, w._ZI.w); return }
  if (entry <= 0) { w.toast('Entry price must be positive', 3000, w._ZI.w); return }
  if (orderType === 'LIMIT') { if (w.TP.demoSide === 'LONG' && entry >= w.S.price) { w.toast('LONG LIMIT must be below current price'); return }; if (w.TP.demoSide === 'SHORT' && entry <= w.S.price) { w.toast('SHORT LIMIT must be above current price'); return } }
  const _valEntry = (orderType === 'LIMIT') ? entry : w.S.price
  if (sl) { if (w.TP.demoSide === 'LONG' && sl >= _valEntry) { w.toast('LONG SL must be below entry'); return }; if (w.TP.demoSide === 'SHORT' && sl <= _valEntry) { w.toast('SHORT SL must be above entry'); return } }
  if (tp) { if (w.TP.demoSide === 'LONG' && tp <= _valEntry) { w.toast('LONG TP must be above entry'); return }; if (w.TP.demoSide === 'SHORT' && tp >= _valEntry) { w.toast('SHORT TP must be below entry'); return } }
  if (_curMode === 'live') { _executeLiveManualOrder(orderType, size, entry, lev, tp, sl) } else { _executeDemoManualOrder(orderType, size, entry, lev, tp, sl) }
}

function _registerManualOnServer(pos: any): void {
  if (!pos || pos._serverSeq) return
  const payload = { symbol: pos.sym, side: pos.side, entryPrice: pos.entry, qty: pos.qty || (pos.size && pos.entry && pos.lev ? +(pos.size / pos.entry * pos.lev).toFixed(6) : 0), leverage: pos.lev || 1, sl: pos.sl || null, tp: pos.tp || null, mode: pos.mode || 'demo', dslParams: pos.dslParams || null }
  fetch('/api/at/register-manual', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }).then(function (r) { return r.json() }).then(function (d: any) { if (d.ok && d.seq) { pos._serverSeq = d.seq; if (typeof w.ZState !== 'undefined' && w.ZState.save) w.ZState.save() } }).catch(function (err: any) { console.warn('[registerManualOnServer]', err.message || err) })
}

function _executeDemoManualOrder(orderType: string, size: number, entry: number, lev: number, tp: any, sl: any): void {
  if (size > w.TP.demoBalance) { w.toast('Insufficient demo balance', 3000, w._ZI.x); return }
  if (orderType === 'MARKET') {
    const fillPrice = w.S.price; const liqPrice = calcLiqPrice(fillPrice, lev, w.TP.demoSide)
    const pos = _buildManualPosition(fillPrice, size, lev, tp, sl, liqPrice, 'demo', orderType)
    w.TP.demoPositions.push(pos); w.TP.demoBalance -= size
    w.updateDemoBalance(); w.renderDemoPositions()
    if (typeof w.onPositionOpened === 'function') w.onPositionOpened(pos, 'manual_demo')
    w.ZState.save(); _registerManualOnServer(pos)
    if (typeof w.renderTradeMarkers === 'function') w.renderTradeMarkers()
    w.toast(pos.side + ' ' + pos.sym.replace('USDT', '') + ' $' + w.fmt(size) + ' @$' + w.fP(fillPrice) + ' ' + lev + 'x MARKET')
  } else {
    const pending = { id: Date.now(), side: w.TP.demoSide, sym: w.S.symbol, limitPrice: entry, size, lev, tp, sl, mode: 'demo', orderType: 'LIMIT', status: 'WAITING', createdAt: Date.now() }
    w.TP.pendingOrders.push(pending); w.TP.demoBalance -= size
    w.updateDemoBalance(); w.renderPendingOrders(); w.ZState.save()
    w.toast(' LIMIT ' + pending.side + ' @$' + w.fP(entry) + ' $' + w.fmt(size) + ' ' + lev + 'x \u2014 waiting')
  }
}

function _executeLiveManualOrder(orderType: string, size: number, entry: number, lev: number, tp: any, sl: any): void {
  if (typeof w.manualLivePlaceOrder !== 'function') { w.toast('Live API not available', 3000, w._ZI.lock); return }
  const refPrice = (orderType === 'MARKET') ? w.S.price : entry; if (!refPrice || refPrice <= 0) { w.toast('Price unavailable — cannot place order', 3000, w._ZI.x); return }; const qty = (size * lev) / refPrice; const binanceSide = (w.TP.demoSide === 'LONG') ? 'BUY' : 'SELL'
  const execBtn = w.el('demoExec'); if (execBtn) { execBtn.disabled = true; execBtn.textContent = 'Placing...' }
  w.manualLivePlaceOrder({ symbol: w.S.symbol, side: binanceSide, type: orderType, quantity: qty.toFixed(8), price: (orderType === 'LIMIT') ? String(entry) : undefined, leverage: lev, referencePrice: w.S.price }).then(function (result: any) {
    if (execBtn) { execBtn.disabled = false; setDemoSide(w.TP.demoSide) }
    if (orderType === 'MARKET') {
      const fillPrice = parseFloat(result.avgPrice) || w.S.price; const liqPrice = calcLiqPrice(fillPrice, lev, w.TP.demoSide)
      const pos = _buildManualPosition(fillPrice, size, lev, tp, sl, liqPrice, 'live', 'MARKET'); pos.isLive = true; pos.fromExchange = true; pos.qty = parseFloat(result.executedQty) || qty
      w.TP.livePositions.push(pos); w.renderLivePositions()
      if (typeof w.onPositionOpened === 'function') w.onPositionOpened(pos, 'manual_live')
      if (typeof w.ZState !== 'undefined' && w.ZState.save) w.ZState.save()
      if (typeof w.renderTradeMarkers === 'function') w.renderTradeMarkers()
      w.toast('LIVE MARKET ' + binanceSide + ' filled @$' + w.fP(fillPrice))
      if (sl) { w.manualLiveSetSL({ symbol: w.S.symbol, side: w.TP.demoSide, quantity: qty.toFixed(8), stopPrice: sl }).catch(function (e: any) { w.toast('SL failed: ' + (e.message || e)) }) }
      if (tp) { w.manualLiveSetTP({ symbol: w.S.symbol, side: w.TP.demoSide, quantity: qty.toFixed(8), stopPrice: tp }).catch(function (e: any) { w.toast('TP failed: ' + (e.message || e)) }) }
      if (typeof w.liveApiSyncState === 'function') setTimeout(w.liveApiSyncState, 1000)
    } else {
      const pendingLive = { id: result.orderId || Date.now(), exchangeOrderId: result.orderId, side: w.TP.demoSide, binanceSide, sym: w.S.symbol, limitPrice: entry, size, qty, lev, tp, sl, mode: 'live', orderType: 'LIMIT', status: 'WAITING', createdAt: Date.now() }
      w.TP.manualLivePending.push(pendingLive); w.renderPendingOrders(); w.ZState.save()
      w.toast('LIVE LIMIT placed orderId=' + (result.orderId || '')); w._startLivePendingSync()
    }
  }).catch(function (err: any) { if (execBtn) { execBtn.disabled = false; setDemoSide(w.TP.demoSide) }; w.toast('LIVE order failed: ' + (err.message || err)) })
}

function _buildManualPosition(fillPrice: number, size: number, lev: number, tp: any, sl: any, liqPrice: any, mode: string, orderType: string): any {
  return {
    id: Date.now(), side: w.TP.demoSide, sym: w.S.symbol, entry: fillPrice, size, lev, tp, sl, liqPrice, pnl: 0,
    mode, orderType, sourceMode: (mode === 'live') ? 'manual' : 'paper', controlMode: (mode === 'live') ? 'user' : 'paper',
    brainModeAtOpen: (w.S.mode || 'assist'),
    dslParams: Object.assign({ pivotLeftPct: parseFloat(w.el('dslTrailPct')?.value) || 0.70, pivotRightPct: parseFloat(w.el('dslTrailSusPct')?.value) || 1.00, impulseVPct: parseFloat(w.el('dslExtendPct')?.value) || 1.30 }, typeof w.calcDslTargetPrice === 'function' ? w.calcDslTargetPrice(w.TP.demoSide, fillPrice, tp) : { openDslPct: 1.5, dslTargetPrice: w.TP.demoSide === 'LONG' ? fillPrice * 1.015 : fillPrice * 0.985 }),
    dslAdaptiveState: 'calm', dslHistory: [], openTs: Date.now(), filledAt: Date.now(),
  }
}

// ===== getSymPrice (used by many modules) =====
export function getSymPrice(pos: any): number {
  if (!pos) return 0
  const sym = pos.sym || pos.symbol || w.S.symbol
  if (sym === w.S.symbol && w.S.price > 0) return w.S.price
  if (w.allPrices && w.allPrices[sym] > 0) return w.allPrices[sym]
  if (w.wlPrices && w.wlPrices[sym]?.price > 0) return w.wlPrices[sym].price
  return pos.entry || 0
}
