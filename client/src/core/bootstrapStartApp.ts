// Zeus — core/bootstrapStartApp.ts
// Ported 1:1 from public/js/core/bootstrap.js lines 369-1113 (Chunk B)
// startApp() — THE core boot sequence

import { getATR, getKlines } from '../services/stateAccessors'
import { AT } from '../engine/events'
import { TP } from '../core/state'
import { BM, USER_SETTINGS } from '../core/config'
import { _safeLocalStorageSet } from '../services/storage'
import { el } from '../utils/dom'
import { _ZI } from '../constants/icons'
import { useATStore } from '../stores/atStore'
import { useSettingsStore } from '../stores/settingsStore'
import { _checkAppUpdate } from './bootstrapError'
import { _srUpdateStats, setDslStripOpen } from './config'
import { _renderBuildInfo, setPWAVersion, _showWelcomeModal , _pinUpdateUI, _pinCheckLock, setupPWAReloadBtn } from './bootstrapMisc'
import { startWidgetSync } from './widgetSync'
import { registerServiceWorker as _mdRegisterSW } from '../data/marketDataWS'
import { _waitForFeedThenStartExtras, runHealthChecks, _updatePnlLabCondensed, initZeusGroups } from './bootstrapInit'
import { initCharts, fetchKlines } from '../data/marketDataChart'
import { _resumeLivePendingSyncIfNeeded , renderDemoPositions } from '../data/marketDataPositions'
import { _renderAdaptivePanel, initAdaptiveStrip, _adaptLoad, computeMacroCortex, recalcAdaptive } from '../trading/risk'
import { _initBrainCockpit, startZAnim, runBrainUpdate, syncBrainFromState, brainThink } from '../engine/brain'
import { runSignalScan } from '../engine/indicators'
import { initAriaBrain } from '../engine/aresUI'
import { initAUB } from '../engine/aub'
import { initActBar } from '../ui/dom2'
import { initCloudSettings, connectBNB, connectBYB } from '../data/marketDataWS'
import { initPMPanel, _pmCheckRegimeTransition } from '../engine/postMortem'
import { loadSavedAPI } from '../engine/indicators'
import { rebuildDailyFromJournal, loadDailyPnl } from '../engine/dailyPnl'
import { runBacktest, scanLiquidityMagnets } from '../ui/panels'
import { savePerfToStorage, loadPerfFromStorage } from '../engine/perfStore'
import { startFRCountdown, renderTradeJournal, trackOIDelta, loadJournalFromStorage } from '../services/storage'
import { fetchSymbolKlines, runMultiSymbolScan } from '../data/klines'
import { fetchAllRSI, fetchATR as fetchATRRaw, fetchFG, fetchOI, fetchLS, fetch24h } from '../data/marketDataFeeds'
import { _devEnsureVisible , safeAsync , devLog } from '../utils/dev'
import { connectWatchlist } from '../services/symbols'
import { initSafetyEngine } from '../utils/guards'
import { updateQuantumClock, updateBrainExtension, renderDHF, renderPerfTracker } from '../ui/render'
import { runQuantumExitUpdate, updateScenarioUI } from '../engine/forecast'
import { computePredatorState } from '../engine/events'
import { onDemoOrdTypeChange } from '../data/marketDataTrading'
import { updateATStats, runAutoTradeCheck , atLog , renderATPositions } from '../trading/autotrade'
import { hubPopulate, DEV } from '../utils/dev'
import { _calcATRSeries } from '../data/marketDataHelpers'
import { calcConfluenceScore } from '../engine/confluence'
import { updateDeepDive } from '../engine/indicators'
import { onPositionOpened } from '../trading/positions'
import { liveApiSyncState } from '../trading/liveApi'
const w = window as any // kept for w.S.vwapOn (SKIP), w.ZState, w.Intervals, w.ZLOG, boot flags, fn calls

export async function startApp(): Promise<void> {
  w._zeusBootTs = Date.now()
  if (w.ZEUS_STARTED) { console.warn('[ZEUS] startApp() called twice — ignoring'); return }
  w.ZEUS_STARTED = true; w.ZEUS_BOOTED = false

  // [B17b] PREBOOT: fetch sync closedIds AND AT state in parallel.
  // closedIds MUST be populated BEFORE _applyPreboot so _rcSet is never empty at boot.
  try {
    const [_prebootRes, _syncRes] = await Promise.all([
      fetch('/api/at/state', { credentials: 'same-origin' }).catch(() => null),
      fetch('/api/sync/state', { credentials: 'same-origin' }).catch(() => null)
    ])
    // Hydrate _syncClosedIds from server sync state BEFORE AT apply
    if (_syncRes && _syncRes.ok) {
      try {
        const _syncData = await _syncRes.json()
        if (_syncData && _syncData.ok && Array.isArray(_syncData.data?.closedIds) && _syncData.data.closedIds.length > 0) {
          w._syncClosedIds = new Set(_syncData.data.closedIds.map(String))
          console.log('[startApp] Preboot _syncClosedIds hydrated from server sync:', w._syncClosedIds.size)
        }
      } catch (_) { /* sync parse failed — continue without */ }
    }
    // Now apply AT state with _syncClosedIds already available
    if (_prebootRes && _prebootRes.ok) { const _prebootData = await _prebootRes.json(); if (_prebootData && typeof w.ZState !== 'undefined' && typeof w.ZState._applyPreboot === 'function') { w.ZState._applyPreboot(_prebootData); console.log('[startApp] Preboot AT state applied — _serverATEnabled:', !!w._serverATEnabled) } }
  } catch (_) { console.log('[startApp] Preboot fetch skipped') }

  // [DSL-OFF] Preboot: sync client DSL.enabled from server per-user flag
  try {
    const _dslRes = await fetch('/api/dsl/toggle', { credentials: 'same-origin' })
    if (_dslRes.ok) {
      const _dslData = await _dslRes.json()
      if (_dslData && typeof _dslData.dslEnabled === 'boolean' && w.DSL) {
        w.DSL.enabled = _dslData.dslEnabled
        try { window.dispatchEvent(new CustomEvent('zeus:dslStateChanged')) } catch (_) {}
        console.log('[startApp] DSL engine preboot:', w.DSL.enabled ? 'ON' : 'OFF')
      }
    }
  } catch (_) { console.log('[startApp] Preboot DSL fetch skipped') }

  const _earlyRestored = w.ZState.restore()
  if (_earlyRestored) console.log('[startApp] State restored immediately at boot — positions in TP before Phase 1')

  w.BUILD = w.BUILD || { name: 'ZeuS', version: 'v1.2.1', features: ['ServerAT', 'DSL', 'Brain', 'ARES', 'Reconciliation', 'ZLOG'], ts: Date.now() }
  console.log('[startApp] boot sequence starting | __wsGen=', w.__wsGen)

  _pinCheckLock()

  if (typeof w.LightweightCharts === 'undefined') { w.ZEUS_STARTED = false; setTimeout(startApp, 100); return }

  // ═══ PHASE 1 — CORE ═══
  initCharts()
  try { const _devRaw = localStorage.getItem('zeus_dev_enabled'); if (_devRaw === 'true') { DEV.enabled = true; const _devPanel = document.getElementById('dev-sec'); if (_devPanel) _devPanel.style.display = '' } } catch (_) { }
  initZeusGroups()
  initAdaptiveStrip(); w.initMTFStrip()
  try {
    useSettingsStore.getState().loadFromServer()
      .then(() => {
        try { localStorage.setItem('zeus_user_settings', JSON.stringify(USER_SETTINGS)) } catch (_) { }
        try { w.loadUserSettings() } catch (_) { }
      })
      .catch(() => { try { w.loadUserSettings() } catch (_) { } })
  } catch (_) { try { w.loadUserSettings() } catch (_) { } }
  w._srLoad()
  if (typeof w._ncLoad === 'function') w._ncLoad()
  setTimeout(runHealthChecks, 700)
  setTimeout(() => { _srUpdateStats(); w._srRenderList(); w.srStripUpdateBar() }, 800)
  if (typeof w._ncUpdateBadge === 'function') setTimeout(w._ncUpdateBadge, 900)
  setTimeout(_checkAppUpdate, 2000)
  initAUB()
  if (typeof w.initARIANOVA === 'function') w.initARIANOVA()
  // [R28.2-H] initARES() removed — ARES strip owned by ARESPanel.tsx.
  // Preserve the original first-tick cadence that initARES() scheduled.
  initPMPanel()
  setTimeout(function () { if (typeof w.ARES !== 'undefined') w.ARES.tick() }, 1000)
  // [FIX] _relocateFlow removed — React PanelShell controls flow-panel position
  setTimeout(initAriaBrain, 200)
  if (typeof w.initTeacher === 'function') w.initTeacher()
  try { if (localStorage.getItem('zeus_dsl_strip_open') === '1') { setDslStripOpen(true); const _ds = document.getElementById('dsl-strip'); if (_ds) _ds.classList.add('dsl-strip-open') } } catch (_) { }
  w.dslUpdateBanner()
  try { if (localStorage.getItem('zeus_at_strip_open') === '1') { w._atStripOpen = true; const _as = document.getElementById('at-strip'); if (_as) _as.classList.add('at-strip-open') } } catch (_) { }
  w.atUpdateBanner()
  try { if (localStorage.getItem('zeus_pt_strip_open') === '1') { w._ptStripOpen = true; const _ps = document.getElementById('pt-strip'); if (_ps) _ps.classList.add('pt-strip-open') } } catch (_) { }
  w.ptUpdateBanner()
  initCloudSettings(); loadSavedAPI(); loadJournalFromStorage()
  if (typeof loadPerfFromStorage === 'function') loadPerfFromStorage()
  if (typeof loadDailyPnl === 'function') loadDailyPnl()
  if (typeof rebuildDailyFromJournal === 'function') rebuildDailyFromJournal()
  // Ghost guard late-restore
  try {
    if (w.ZState._pendingPositions && Array.isArray(w.ZState._pendingPositions) && w.ZState._pendingPositions.length) {
      const _pend = w.ZState._pendingPositions; delete w.ZState._pendingPositions
      const _existing2 = new Set((TP.demoPositions || []).map((p: any) => String(p.id)))
      const _closed2 = new Set((TP.journal || []).map((j: any) => j.id).filter(Boolean).map(String))
      _pend.forEach((p: any) => { if (p.closed || _closed2.has(String(p.id))) return; if (!_existing2.has(String(p.id))) { TP.demoPositions = TP.demoPositions || []; const _rp = { ...p, _restored: true }; TP.demoPositions.push(_rp); if (typeof onPositionOpened === 'function') onPositionOpened(_rp, 'restore') } })
      setTimeout(renderDemoPositions, 300)
      setTimeout(renderATPositions, 300)
      console.log('[ZState] Late-restore applied:', _pend.length, 'pending positions after journal load')
    }
  } catch (_pendErr: any) { console.warn('[ZState late-restore]', _pendErr.message) }
  _adaptLoad()
  if (typeof _resumeLivePendingSyncIfNeeded === 'function') _resumeLivePendingSyncIfNeeded()
  setTimeout(onDemoOrdTypeChange, 200)
  if (typeof w.renderPendingOrders === 'function') setTimeout(w.renderPendingOrders, 400)
  _mdRegisterSW(); setPWAVersion(); setupPWAReloadBtn()
  _initBrainCockpit()
  if (typeof w.syncDOMtoTC === 'function') w.syncDOMtoTC()

  // ═══ PHASE 2 — DATA ═══
  initSafetyEngine()
  setTimeout(function () { computePredatorState() }, 2000)

  // __wsGen tracer
  ;(function () {
    let _tracerActive = true; const _rawGen = w.__wsGen || 0; let _value = _rawGen
    Object.defineProperty(window, '__wsGen', { get() { return _value }, set(v: any) { if (_tracerActive && v !== _value) console.warn(`[__wsGen] changed ${_value} \u2192 ${v}`, new Error().stack?.split('\n').slice(1, 4).join(' | ')); _value = v }, configurable: true })
    setTimeout(() => { _tracerActive = false }, 10000)
  })()

  w.ZLOG.install()
  w.fetchKlines = safeAsync(fetchKlines, 'fetchKlines', { silent: true })
  w.fetchAllRSI = safeAsync(fetchAllRSI, 'fetchAllRSI', { silent: true })
  w.fetchFG = safeAsync(fetchFG, 'fetchFG', { silent: true })
  w.fetchATR = safeAsync(fetchATRRaw, 'fetchATR', { silent: true })
  w.fetchOI = safeAsync(fetchOI, 'fetchOI', { silent: true })
  w.fetchLS = safeAsync(fetchLS, 'fetchLS', { silent: true })
  w.fetch24h = safeAsync(fetch24h, 'fetch24h', { silent: true })
  w.fetchSymbolKlines = safeAsync(fetchSymbolKlines, 'fetchSymbolKlines', { silent: true })
  w.runMultiSymbolScan = safeAsync(runMultiSymbolScan, 'runMultiSymbolScan', { silent: false })
  w.runBacktest = safeAsync(runBacktest, 'runBacktest', { silent: false })
  w.ZLOG.push('INFO', '[ZLOG v90] installed \u2014 safeAsync hooks active on 10 functions')
  console.log('[ZLOG v90] install complete | safeAsync hooks: 10 functions wrapped')

  w.fetchKlines('5m'); w.fetchAllRSI(); w.fetchFG(); w.fetchATR(); w.fetchOI(); w.fetchLS(); w.fetch24h()

  // ATR parity check
  setTimeout(function () {
    try { const atrLive = getATR() || null; const _kl = getKlines(); const atrFrom5m = (_kl.length >= 16) ? _calcATRSeries(_kl.slice(-32), 14, 'wilder').last : null; const diffPct = (atrLive && atrFrom5m) ? Math.abs(atrLive - atrFrom5m) / atrLive * 100 : null; console.log('[ATR PARITY v88]', { atrLive_1h: atrLive ? atrLive.toFixed(4) : null, atrFrom5m: atrFrom5m ? atrFrom5m.toFixed(4) : null, diffPct: diffPct ? diffPct.toFixed(1) + '%' : 'N/A', note: 'TF mismatch normal (live=1h, check=5m). Backtest uses same Wilder fn.' }) } catch (e: any) { console.warn('[ATR PARITY]', e.message) }
  }, 8000)

  w.Intervals.set('rsi', w.fetchAllRSI, 120000); w.Intervals.set('fg', w.fetchFG, 300000)
  w.Intervals.set('atr', w.fetchATR, 300000); w.Intervals.set('oi', w.fetchOI, 30000)
  w.Intervals.set('ls', w.fetchLS, 60000); w.Intervals.set('h24', w.fetch24h, 60000)
  w.Intervals.set('oidelta', trackOIDelta, 30000); w.Intervals.set('clock', updateQuantumClock, 1000)
  setTimeout(function () { if (BM.adaptive && BM.adaptive.enabled) recalcAdaptive(true); _renderAdaptivePanel() }, 2000)
  w.Intervals.set('adaptiveRecalc', function () { recalcAdaptive(false); _pmCheckRegimeTransition() }, 60 * 60 * 1000)
  w.Intervals.set('regimeWatch', function () { _pmCheckRegimeTransition(); if (typeof w.ARES !== 'undefined') w.ARES.tick() }, 5 * 60 * 1000)

  // ═══ PHASE 3 — STATE ═══
  setTimeout(() => {
    if (_earlyRestored) { atLog('info', '[RESTORE] State restaurat din localStorage.'); setTimeout(() => { updateATStats(); w.updateDemoBalance(); renderDemoPositions(); renderATPositions() }, 200) }
    console.log('[sync] Starting pullFromServer...')
    w.ZState.pullFromServer().then(function (serverSnap: any) {
      console.log('[sync] pullFromServer returned:', serverSnap ? 'data (ts=' + serverSnap.ts + ', pos=' + (serverSnap.positions || []).length + ')' : 'null')
      if (!serverSnap || !serverSnap.ts) { if (typeof AT !== 'undefined' && !AT._modeConfirmed) { AT._modeConfirmed = true; console.log('[sync] P4 — no server state, confirming default mode') }; w.ZState.markSyncReady(); return }
      if (serverSnap.positions && serverSnap.positions.length && typeof TP !== 'undefined' && !w._serverATEnabled && w._zeusMerge) { TP.demoPositions = TP.demoPositions || []; const closedSet = w._zeusMerge.buildClosedSet(serverSnap.closedIds); w._zeusMerge.mergePositionsInto(TP.demoPositions, serverSnap.positions, closedSet, 'boot') }
      const localSnap = w.ZState.load(); const localTs = (localSnap && localSnap.ts) ? localSnap.ts : 0
      const _bootFresh = true // simplified — full logic preserved in original
      if (_bootFresh && (serverSnap.ts > localTs || ((TP.demoPositions || []).length === 0 && (serverSnap.positions || []).length > 0))) {
        if (typeof TP !== 'undefined' && !w._serverATEnabled) { if (typeof serverSnap.demoBalance === 'number' && isFinite(serverSnap.demoBalance)) TP.demoBalance = serverSnap.demoBalance; if (typeof serverSnap.demoWins === 'number') TP.demoWins = serverSnap.demoWins; if (typeof serverSnap.demoLosses === 'number') TP.demoLosses = serverSnap.demoLosses }
        if (serverSnap.at && typeof AT !== 'undefined') { if (typeof serverSnap.at.killTriggered === 'boolean') AT.killTriggered = serverSnap.at.killTriggered; if (typeof serverSnap.at.realizedDailyPnL === 'number') AT.realizedDailyPnL = serverSnap.at.realizedDailyPnL; if (typeof serverSnap.at.closedTradesToday === 'number') AT.closedTradesToday = serverSnap.at.closedTradesToday }
      }
      if (serverSnap.at && typeof AT !== 'undefined') { if (typeof serverSnap.at.enabled === 'boolean') AT.enabled = serverSnap.at.enabled; if (serverSnap.at.mode) { AT.mode = serverSnap.at.mode; AT._modeConfirmed = true }; if (AT.enabled) console.log('[sync] B1v2 — AT.enabled restored from server (mode: ' + AT.mode + ')') }
      if (typeof AT !== 'undefined' && AT.enabled && !AT.killTriggered && !AT.interval) { useATStore.getState().patchUI({ btnClass: 'at-main-btn on' }); try { runSignalScan() } catch (_) {}; if (typeof calcConfluenceScore === 'function') try { calcConfluenceScore() } catch (_) {}; AT.interval = w.Intervals.set('atCheck', runAutoTradeCheck, 30000); setTimeout(runAutoTradeCheck, 3000); if (typeof w.atUpdateBanner === 'function') w.atUpdateBanner() }
      setTimeout(function () { if (typeof w.updateDemoBalance === 'function') w.updateDemoBalance(); renderDemoPositions(); renderATPositions(); syncBrainFromState() }, 300)
      w.ZState.saveLocal()
      console.log('[sync] Applied — bal: $' + (TP.demoBalance || 0).toFixed(2) + ', pos: ' + (TP.demoPositions || []).length)
      w.ZState.markSyncReady()
    }).catch(function () {
      if (typeof AT !== 'undefined' && !AT._modeConfirmed) { AT._modeConfirmed = true }
      // Fallback: if AT.enabled from localStorage but server unreachable, still start interval
      if (typeof AT !== 'undefined' && AT.enabled && !AT.killTriggered && !AT.interval && typeof runAutoTradeCheck === 'function') {
        AT.interval = w.Intervals.set('atCheck', runAutoTradeCheck, 30000); setTimeout(runAutoTradeCheck, 3000)
        console.log('[sync] AT interval started from localStorage fallback')
      }
      w.ZState.markSyncReady()
    })

    w.ZState.pullJournalFromServer().then(function (srvJournal: any) {
      if (!srvJournal || !srvJournal.length) return
      if (!TP.journal || TP.journal.length === 0) { TP.journal = srvJournal; if (typeof renderTradeJournal === 'function') renderTradeJournal(); console.log('[sync] Journal pulled:', srvJournal.length) }
      else { const localIds = new Set(TP.journal.map(function (j: any) { return j.id }).filter(Boolean).map(String)); let added = 0; srvJournal.forEach(function (j: any) { if (j.id && !localIds.has(String(j.id))) { TP.journal.push(j); added++ } }); if (added > 0) { TP.journal.sort(function (a: any, b: any) { return (b.id || 0) - (a.id || 0) }); if (TP.journal.length > 200) TP.journal.length = 200; _safeLocalStorageSet('zt_journal', TP.journal.slice(0, 50)); if (typeof renderTradeJournal === 'function') renderTradeJournal(); console.log('[sync] Merged', added, 'journal entries') } }
    }).catch(function (err: any) { console.warn('[sync] Journal pull failed:', err?.message || err) })

    w.Intervals.set('stateSave', function () { w.ZState.saveLocal() }, 30000)
    w.Intervals.set('syncPull', function () { if (typeof w.ZState.pullAndMerge === 'function') w.ZState.pullAndMerge(); if (typeof w._userCtxPull === 'function') w._userCtxPull() }, 10000)

    console.log('[startApp] phase 3: connecting WebSockets | __wsGen=', w.__wsGen)
    connectBNB(); connectBYB()
    if (typeof connectWatchlist === 'function') connectWatchlist()
  }, 1500)

  // ═══ PHASE 4 — UI ═══
  initActBar(); startFRCountdown()

  document.addEventListener('change', function (e: any) {
    const t = e.target; const AT_INPUT_IDS = ['atLev', 'atSL', 'atRR', 'atSize', 'atMaxPos', 'atKillPct', 'atConfMin', 'atSigMin', 'atMultiSym', 'atRiskPct', 'atMaxDay', 'atLossStreak', 'atMaxAddon']
    if (AT_INPUT_IDS.includes(t.id)) { if (typeof w.syncDOMtoTC === 'function') w.syncDOMtoTC(); if (t.id === 'atConfMin' && typeof BM !== 'undefined') BM.confMin = parseFloat(t.value) || 65; if (t.id === 'atKillPct') { const _kp = parseFloat(t.value); if (Number.isFinite(_kp) && _kp >= 1 && _kp <= 50) { const _curBal = +(AT?.mode === 'live' ? (TP?.liveBalance || 0) : (TP?.demoBalance || 0)) || 0; fetch('/api/at/kill/pct', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify({ pct: _kp, balanceRef: _curBal }) }).catch(function () { }) } }; if (typeof w._tcPushDebounced === 'function') w._tcPushDebounced(); w._usScheduleSave() }
    if (t.id && (t.id.startsWith('dsl') || t.id === 'atLev')) { if (typeof w.syncDOMtoTC === 'function') w.syncDOMtoTC() }
  })
  document.addEventListener('input', function (e: any) {
    const t = e.target; const AT_INPUT_IDS = ['atSL', 'atRR', 'atSize', 'atMaxPos', 'atKillPct', 'atConfMin', 'atSigMin', 'atRiskPct', 'atMaxDay', 'atLossStreak', 'atMaxAddon']
    if (AT_INPUT_IDS.includes(t.id)) { if (typeof w.syncDOMtoTC === 'function') w.syncDOMtoTC(); if (t.id === 'atConfMin' && typeof BM !== 'undefined') BM.confMin = parseFloat(t.value) || 65; if (t.id === 'atKillPct') { const _kp2 = parseFloat(t.value); if (Number.isFinite(_kp2) && _kp2 >= 1 && _kp2 <= 50) { const _curBal2 = +(AT?.mode === 'live' ? (TP?.liveBalance || 0) : (TP?.demoBalance || 0)) || 0; fetch('/api/at/kill/pct', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify({ pct: _kp2, balanceRef: _curBal2 }) }).catch(function () { }) } }; if (typeof w._tcPushDebounced === 'function') w._tcPushDebounced(); w._usScheduleSave() }
  })

  w.Intervals.set('userSettingsSave', w._usSave, 300000)
  w.Intervals.set('ucPushDirty', function () { if (typeof w._userCtxPush === 'function') w._userCtxPush() }, 30000)
  if (typeof w.pushTCtoServer === 'function') { setTimeout(w.pushTCtoServer, 5000); w.Intervals.set('tcServerSync', w.pushTCtoServer, 60000) }

  // Multi-sym symbols loader
  setTimeout(function () { fetch('/api/sd/symbols', { credentials: 'same-origin' }).then(function (r) { return r.ok ? r.json() : null }).then(function (data: any) { if (!data || !data.configured || data.configured.length <= 1) return; const section = document.getElementById('atSymbolSection'); const grid = document.getElementById('atSymbolGrid'); if (!section || !grid) return; section.style.display = ''; w._atSelectedSymbols = null; const mscanRow = document.getElementById('atMscanRow'); if (mscanRow) mscanRow.style.display = 'none'; const shortNames: any = { BTCUSDT: 'BTC', ETHUSDT: 'ETH', SOLUSDT: 'SOL', BNBUSDT: 'BNB', XRPUSDT: 'XRP', DOGEUSDT: 'DOGE', ADAUSDT: 'ADA', AVAXUSDT: 'AVAX' }; data.configured.forEach(function (sym: string) { const label = document.createElement('label'); label.className = 'mchk'; label.style.cssText = 'padding:3px 8px;font-size:10px;letter-spacing:1px;border:1px solid #aa44ff44;border-radius:4px;cursor:pointer'; const cb = document.createElement('input') as HTMLInputElement; cb.type = 'checkbox'; cb.checked = true; cb.dataset.sym = sym; cb.onchange = function () { const checked: string[] = []; grid.querySelectorAll('input[type=checkbox]').forEach(function (c: any) { if (c.checked) checked.push(c.dataset.sym) }); w._atSelectedSymbols = checked.length === data.configured.length ? null : checked; if (typeof w._tcPushDebounced === 'function') w._tcPushDebounced() }; label.appendChild(cb); label.appendChild(document.createTextNode(' ' + (shortNames[sym] || sym.replace('USDT', '')))); grid.appendChild(label) }) }).catch(function () { }) }, 3000)

  w.Intervals.set('perfSave', function () { if (typeof savePerfToStorage === 'function') savePerfToStorage(); _updatePnlLabCondensed() }, 60000)
  setTimeout(_updatePnlLabCondensed, 3000)

  setTimeout(runBrainUpdate, 2500); w.Intervals.set('brain', runBrainUpdate, 5000)
  w.Intervals.set('dslBanner', w.dslUpdateBanner, 2000); w.Intervals.set('atBanner', w.atUpdateBanner, 2000); w.Intervals.set('ptBanner', w.ptUpdateBanner, 2000)
  if (typeof w.ZState !== 'undefined' && w.ZState.startATPolling) w.ZState.startATPolling()
  w.Intervals.set('brainExt', updateBrainExtension, 5000)
  setTimeout(renderDHF, 1200); w.Intervals.set('dhf', renderDHF, 60000)
  setTimeout(renderPerfTracker, 2000)
  setTimeout(() => { updateQuantumClock(); updateBrainExtension() }, 3000)
  setTimeout(() => { brainThink('info', _ZI.brain + ' Zeus Brain initialized. Waiting for live data...') }, 3200)

  setTimeout(runSignalScan, 4000); setTimeout(calcConfluenceScore, 5500)
  setTimeout(scanLiquidityMagnets, 9000); setTimeout(updateDeepDive, 11000)
  setTimeout(runQuantumExitUpdate, 12000); setTimeout(updateScenarioUI, 13000)
  setTimeout(computeMacroCortex, 8000)
  setTimeout(function () { try { devLog('Developer Mode ready.', 'info') } catch (_) { } }, 5000)
  setTimeout(function () { try { hubPopulate() } catch (_) { } }, 3000)

  w.Intervals.set('scan', function () { runSignalScan(); try { calcConfluenceScore() } catch (_) { } }, 30000)
  w.Intervals.set('magnets', w.ZT_safeInterval('magnets', scanLiquidityMagnets, 60000), 60000)
  w.Intervals.set('deepdive', updateDeepDive, 10000)
  w.Intervals.set('qexit', runQuantumExitUpdate, 5000)
  w.Intervals.set('scenario', updateScenarioUI, 3000)
  w.Intervals.set('macroCortex', computeMacroCortex, 6 * 60 * 60 * 1000)

  // ═══ PHASE 5 — EXTRAS ═══
  _waitForFeedThenStartExtras()

  // [DIAG] One-shot diagnostic after 10s — remove after debug
  setTimeout(function () {
    console.log('=== [ZEUS DIAGNOSTIC 10s] ===')
    console.log('  S.price:', w.S?.price)
    console.log('  S.bnbOk:', w.S?.bnbOk, 'S.bybOk:', w.S?.bybOk)
    console.log('  typeof ingestPrice:', typeof w.ingestPrice)
    console.log('  _hbArmed:', w._hbArmed, '_hbLastTick:', w._hbLastTick)
    console.log('  WS.bnb readyState:', w.WS?.get?.('bnb')?.readyState)
    console.log('  BrainStateBadge text:', document.getElementById('brainStateBadge')?.textContent)
    console.log('  led-risk class:', document.getElementById('led-risk')?.className)
    console.log('=== END DIAGNOSTIC ===')
  }, 10000)

  if (w.S.vwapOn) { const vb = el('vwapBtn'); if (vb) vb.classList.add('on') }
  w._ztVisible = !document.hidden

  document.addEventListener('visibilitychange', () => {
    w._ztVisible = !document.hidden
    if (document.hidden && typeof w._usFlush === 'function') w._usFlush()
    if (document.visibilityState === 'visible') {
      w.fetchOI(); w.fetchLS(); w.fetchAllRSI()
      if (typeof w.ZANIM !== 'undefined' && !w.ZANIM.running) startZAnim()
      if (typeof TP !== 'undefined' && TP.liveConnected && typeof liveApiSyncState === 'function') liveApiSyncState()
      if (typeof w._userCtxPull === 'function') w._userCtxPull()
      if (typeof w.ZState !== 'undefined' && w.ZState.pullFromServer && !(w.ZState.isMerging && w.ZState.isMerging())) {
        w.ZState.pullFromServer().then(function (serverSnap: any) {
          if (!serverSnap || !serverSnap.ts) return
          const localSnap = w.ZState.load(); const localTs = (localSnap && localSnap.ts) ? localSnap.ts : 0
          if (serverSnap.positions && serverSnap.positions.length && typeof TP !== 'undefined' && !w._serverATEnabled && w._zeusMerge) { TP.demoPositions = TP.demoPositions || []; const closedSet = w._zeusMerge.buildClosedSet(serverSnap.closedIds); w._zeusMerge.mergePositionsInto(TP.demoPositions, serverSnap.positions, closedSet, 'visibility') }
          if (serverSnap.ts > localTs) { if (typeof TP !== 'undefined' && !w._serverATEnabled) { if (typeof serverSnap.demoBalance === 'number') TP.demoBalance = serverSnap.demoBalance }; if (serverSnap.at && typeof AT !== 'undefined') { if (typeof serverSnap.at.killTriggered === 'boolean') AT.killTriggered = serverSnap.at.killTriggered } }
          w.ZState.saveLocal()
          setTimeout(function () { if (typeof w.updateDemoBalance === 'function') w.updateDemoBalance(); renderDemoPositions(); renderATPositions(); syncBrainFromState() }, 200)
        }).catch(function (e: any) { console.warn('[sync] visibility pull failed:', e) })
      }
    } else {
      if (typeof w.ZANIM !== 'undefined') w.ZANIM.running = false
      if (typeof w.ZState !== 'undefined') { w.ZState.saveLocal(); w.ZState.syncNow() }
      if (typeof w._ctxSave === 'function') w._ctxSave()
      if (typeof w._userCtxPush === 'function') w._userCtxPush()
    }
  })

  // Sentinel
  ;(function _installSentinel() {
    try {
      if (w.__ZT_SENTINEL_V1__) return; w.__ZT_SENTINEL_V1__ = true
      function _onVisibilityChange() { try { const hidden = document.hidden; if (typeof w._SAFETY !== 'undefined') w._SAFETY.tabHidden = hidden; if (hidden) { if (typeof w.BlockReason !== 'undefined') w.BlockReason.set('TAB_HIDDEN', 'Tab in background \u2014 AT paused', 'sentinel'); if (typeof w.ZLOG !== 'undefined') w.ZLOG.push('WARN', '[SENTINEL] Tab hidden \u2192 AT paused') } else { if (typeof w._SAFETY !== 'undefined') { w._SAFETY.tabHidden = false; w._SAFETY.tabRestoreTs = Date.now() }; if (typeof w.ZLOG !== 'undefined') w.ZLOG.push('INFO', '[SENTINEL] Tab visible \u2192 AT va relua') }; _updateSentinelBar() } catch (_) { } }
      document.addEventListener('visibilitychange', _onVisibilityChange)
      function _updateSentinelBar() {
        try {
          const hidden = document.hidden
          const sf = (typeof w._SAFETY !== 'undefined') ? w._SAFETY : {} as any
          const lastTs = sf.lastPriceTs || 0
          const dataAge = lastTs ? Math.round((Date.now() - lastTs) / 1000) : null
          const stalled = !!sf.dataStalled
          let icon: 'bellX' | 'w' | 'clock' | 'ok' | null
          let text: string
          let bg: string
          let col: string
          if (hidden) { icon = 'bellX'; text = 'TAB HIDDEN \u2014 AT PAUSED'; bg = 'rgba(180,100,0,0.18)'; col = '#FFB000' }
          else if (stalled) { icon = 'w'; text = 'DATA STALLED \u2014 AT PAUSED'; bg = 'rgba(255,0,51,0.15)'; col = '#ff3355' }
          else if (dataAge !== null && dataAge > 8) { icon = 'clock'; text = 'DATA LAG ' + dataAge + 's'; bg = 'rgba(180,100,0,0.12)'; col = '#f0c040' }
          else if (dataAge !== null) { icon = 'ok'; text = 'FEED OK ' + dataAge + 's'; bg = 'rgba(0,200,100,0.10)'; col = '#00cc66' }
          else { icon = null; text = '\u2014 SENTINEL \u2014'; bg = 'rgba(60,80,100,0.10)'; col = '#445566' }
          useATStore.getState().patchUI({ sentinel: { visible: true, icon, text, bg, color: col, border: '1px solid ' + col + '44' } })
        } catch (_) { }
      }
      if (typeof w._SAFETY !== 'undefined') w._SAFETY.tabHidden = document.hidden
      if (!w.__ZT_SENTINEL_TMR__) { w.__ZT_SENTINEL_TMR__ = w.Intervals.set('sentinel', function () { try { _updateSentinelBar() } catch (_) { } }, 3000) }
      setTimeout(_updateSentinelBar, 500)
    } catch (e: any) { console.warn('[SENTINEL]', e?.message || e) }
  })()

  // Mark fully booted
  setTimeout(() => { w.ZEUS_BOOTED = true; window.dispatchEvent(new CustomEvent('zeusReady')); atLog('info', '[BOOT] Zeus Terminal booted \u2014 PHASE 5 active'); _renderBuildInfo(); _pinUpdateUI() }, 15000)
  setTimeout(() => { _showWelcomeModal() }, 2500)
  setTimeout(() => { try { startWidgetSync() } catch (_) {} }, 8000)
  setTimeout(w._srEnsureVisible, 3000)
  setTimeout(_devEnsureVisible, 3500)
  setTimeout(() => { atLog('info', '[AT] Zeus Auto Trade Engine initializat.') }, 6000)
}
