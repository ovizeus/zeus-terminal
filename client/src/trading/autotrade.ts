// Zeus — trading/autotrade.ts
// Ported 1:1 from public/js/trading/autotrade.js (Phase 6C)
// AutoTrade engine: conditions, execution, monitoring, kill switch
// [8C-4A1] AT/TC/DSL/BRAIN reads migrated to accessors. AT writes remain.

import { getATEnabled, getATMode, getATKillTriggered, getATLastTradeTs, getATClosedToday, getATDailyPnL, getTCMaxPos, getTCSignalMin, getTCDslTrailPct, getTCDslTrailSusPct, getTCDslExtendPct, getDSLEnabled, getDSLPositions, getDSLMode, getDSLObject, getBrainObject, getPrice, getSymbol, getSignalData, getMagnetBias, getTimezone } from '../services/stateAccessors'
import { AT } from '../engine/events'
import { TP } from '../core/state'
import { BM } from '../core/config'
import { useBrainStore } from '../stores/brainStore'
import { useATStore } from '../stores/atStore'
import type { ATUI } from '../stores/atStore'
import { isValidMarketPrice, escHtml, el } from '../utils/dom'
import { fmtNow, toast } from '../data/marketDataHelpers'
import { fP } from '../utils/format'
import { _ZI } from '../constants/icons'
import { STALL_GRACE_MS } from '../constants/trading'
import { TabLeader } from '../services/tabLeader'
import { api } from '../services/api'
import { atSetStopLoss, atSetTakeProfit, liveApiPlaceOrder, liveApiSetLeverage } from '../trading/liveApi'
import { getTimeUTC, getCurrentADX, isCurrentTimeOK, renderDHF } from '../ui/render'
import { runPostMortem } from '../engine/postMortem'
import { onTradeExecuted } from '../trading/positions'
import { _bmPostClose, _bmResetDailyIfNeeded } from '../trading/orders'
import { _isExecAllowed , _safePnl } from '../utils/guards'
import { _showConfirmDialog, _showConfirmDialog3 } from '../data/marketDataTrading'
import { computeProbScore } from '../engine/forecast'
import { PREDATOR, computePredatorState } from '../engine/events'
import { aubBBSnapshot } from '../engine/aub'
import { calcLiqPrice } from '../data/marketDataTrading'
import { calcDslTargetPrice, brainThink } from '../engine/brain'
import { runSignalScan } from '../engine/indicators'
import { calcConfluenceScore } from '../engine/confluence'
import { renderTradeMarkers } from '../data/marketDataOverlays'
import { attachConfirmClose } from '../engine/events'
import { closeLivePos, renderLivePositions , renderDemoPositions , getSymPrice } from '../data/marketDataPositions'
import { onPositionOpened } from '../trading/positions'
import { sendAlert } from '../data/marketDataWS'
import { addTradeToJournal } from '../services/storage'
import { liveApiSyncState } from '../trading/liveApi'
import { closeDemoPos } from '../data/marketDataClose'
import { playEntrySound } from '../ui/dom2'

const w = window as any // kept for w.S self-ref (mode/profile/alerts), fn calls
function _atUI(p: Partial<ATUI>) { useATStore.getState().patchUI(p) }

// [Phase 6] BlockReason mirror-write helpers — brainStore canonical
// blockReason kept in sync with backing w.BlockReason facade.
// Backing .set/.clear keeps legacy UI updates (DOM + atLog);
// store mirror publishes the typed canonical value to React consumers.
function _setBR(code: string, text: string, source?: string): void {
  w.BlockReason.set(code, text, source)
  useBrainStore.getState().setBlockReason({ code, text })
}
function _clearBR(): void {
  w.BlockReason.clear()
  useBrainStore.getState().setBlockReason(null)
}
function _emitATChanged() { try { window.dispatchEvent(new CustomEvent('zeus:atStateChanged')) } catch (_) {} }

// AT UI helpers
export function toggleAutoTrade(): void {
  if (getATKillTriggered()) {
    toast('Kill switch active — press RESET in status bar or wait', 0, _ZI.noent)
    if (useATStore.getState().ui.status.action !== 'resetKill') {
      var _lossExtra = (AT.killLoss && AT.killLimit) ? ` (loss $${(+AT.killLoss).toFixed(2)} / limit $${(+AT.killLimit).toFixed(2)})` : ''
      _atUI({ status: { icon: 'siren', text: `KILL ACTIVE${_lossExtra}`, action: 'resetKill' } })
    }
    return
  }
  // [ZT-AUD-001] Block AT enable if server hasn't confirmed mode yet
  if (!getATEnabled() && !AT._modeConfirmed) {
    toast('Waiting for server mode confirmation...', 0, _ZI.timer)
    if (typeof w.ZState !== 'undefined' && w.ZState.startATPolling) w.ZState.startATPolling()
    return
  }
  // [DSL-OFF] When enabling AT while DSL engine is OFF, warn the user first.
  // New AT positions will NOT attach DSL — they run with native TP/SL from RISK MANAGEMENT.
  if (!getATEnabled() && !getDSLEnabled()) {
    _showConfirmDialog3(
      'DSL Engine is OFF',
      'You are about to enable AutoTrade while DSL is disabled.\n\nDSL functions (including DSL Brain) will NOT manage new AT positions. The AT engine will place native TP and SL on the exchange using values from RISK MANAGEMENT.\n\nMake sure Stop Loss, Take Profit (R:R), and size settings are correctly configured.\n\nActivate DSL first, continue without DSL, or cancel.',
      'Activate DSL', 'Continue without DSL', 'Cancel',
      function () { try { (window as any).toggleDSL?.() } catch (_) {} ; toggleAutoTrade() },
      function () { _continueAutoTradeEnable() },
    )
    return
  }
  _continueAutoTradeEnable()
}

function _continueAutoTradeEnable(): void {
  // ── Live mode confirmation gate ──
  const _atGlobalMode = (typeof AT !== 'undefined' && getATMode()) ? getATMode() : 'demo'
  if (!getATEnabled() && _atGlobalMode === 'live') {
    // Block without API keys
    if (!w._apiConfigured) {
      toast('Cannot enable AT in LIVE mode — API keys not configured. Go to Settings → Exchange API.', 0, _ZI.w)
      _atUI({ status: { icon: 'lock', text: 'EXEC LOCKED — Exchange not configured', action: null } })
      return
    }
    // [MODE-P4] Require explicit confirmation — wording matches resolved environment
    if (typeof _showConfirmDialog === 'function') {
      var _atEnv = w._resolvedEnv || 'REAL'
      var _atTest = _atEnv === 'TESTNET'
      _showConfirmDialog(
        _atTest ? 'Enable AutoTrade in TESTNET Mode?' : 'Enable AutoTrade in LIVE Mode?',
        _atTest
          ? 'You are about to enable AutoTrade on Binance TESTNET.\n\nThe system will automatically execute orders with TEST funds.\nStop-Loss and Take-Profit orders will be placed automatically.\n\nMake sure your risk settings are configured before proceeding.'
          : 'You are about to enable AutoTrade while in LIVE mode.\n\nThe system will automatically execute REAL orders on Binance using REAL funds.\nStop-Loss and Take-Profit orders will be placed automatically.\n\nMake sure your risk settings, leverage, and position size are correctly configured before proceeding.',
        'Cancel', _atTest ? 'Enable Testnet AT' : 'Enable Live AT',
        function () { _doEnableAT() }
      )
      return
    }
  }
  _doEnableAT()
}

export function _doEnableAT(): void {
  var _newState = !getATEnabled()
  // [AT-TOGGLE-FIX] Server-authoritative toggle — call dedicated endpoint
  api.raw<any>('POST', '/api/at/toggle', { active: _newState }).then(function(data: any) {
    if (!data.ok) {
      toast('AT toggle failed: ' + (data.error || 'Unknown error'), 3000, _ZI.x)
      return
    }
    // Server confirmed — now update client state
    AT.enabled = _newState
    _applyATToggleUI(_newState)
    if (typeof w._atPollOnce === 'function') setTimeout(w._atPollOnce, 500)
  }).catch(function(_err: any) {
    toast('AT toggle failed: network error', 3000, _ZI.x)
  })
}

export function _applyATToggleUI(enabled: any): void {
  if (enabled) {
    // FIX v118: reset zi dacă s-a schimbat data
    _bmResetDailyIfNeeded()
    // ── INIT: Recalculate daily counters from journal (no stale state) ──
    const _todayRO = new Date().toLocaleDateString('ro-RO', { timeZone: getTimezone() || 'Europe/Bucharest' })
    const _jToday = (TP.journal || []).filter((j: any) => {
      try { return new Date(j.time || 0).toLocaleDateString('ro-RO', { timeZone: getTimezone() || 'Europe/Bucharest' }) === _todayRO } catch (_) { return false }
    })
    // FIX v118: numără DOAR trade-urile AutoTrade (nu Paper) pentru dailyTrades / closedTradesToday
    // [KILL-LOOP FIX] Skip entries closed BEFORE last kill reset — server zeros pnlAtReset, we mirror via killResetTs
    const _resetAfter = +(AT.killResetTs || 0)
    const _jTodayAT = _jToday.filter((j: any) => j.autoTrade === true && (!_resetAfter || (+(j.closedAt || 0) > _resetAfter)))
    AT.realizedDailyPnL = _jTodayAT.reduce((acc: any, j: any) => acc + (Number.isFinite(+j.pnl) ? +j.pnl : 0), 0)
    AT.closedTradesToday = _jTodayAT.length
    BM.dailyTrades = getATClosedToday()
    AT.dailyStart = new Date().toISOString().slice(0, 10)
    // [KILL-LOOP FIX R5] Snapshot AT-enable timestamp. Positions opened before
    // this point (e.g. old server-side AT positions from previous sessions)
    // will NOT count toward the current session's kill unrealized PnL.
    AT.enabledAt = Date.now()
    // [C3] Kill switch auto-clear REMOVED — require explicit user reset
    // Kill switch is cleared ONLY by: 1) resetKillSwitch() user action, 2) UTC day change (server-side)
    if (getATKillTriggered()) {
      AT.enabled = false
      toast('Kill switch active — press RESET or wait for next day', 0, _ZI.noent)
      return
    }
    _atUI({ btnClass: 'at-main-btn on', dotBg: 'var(--grn-bright)', dotShadow: '0 0 10px var(--grn-bright)', btnText: 'AUTO TRADE ON', status: { icon: 'dGrn', text: 'Active — scan every 30s', action: null } })
    atLog('info', `[AT] Auto Trade STARTED. RealPnL today: $${getATDailyPnL().toFixed(2)} | Trades: ${getATClosedToday()}`)
    if (!AT.interval) AT.interval = w.Intervals.set('atCheck', runAutoTradeCheck, 30000)
    // Recalculate signals + confluence BEFORE first AT check (avoids stale score=50)
    try { runSignalScan() } catch (_) {}
    if (typeof calcConfluenceScore === 'function') try { calcConfluenceScore() } catch (_) {}
    setTimeout(runAutoTradeCheck, 2000) // first check with fresh confluence
    // [FIX] Force balance sync when AT starts in LIVE mode — prevents $10k fallback
    if (getATMode() === 'live' && typeof liveApiSyncState === 'function') {
      liveApiSyncState().then(function () {
        if (TP.liveBalance <= 0) {
          atLog('warn', '[WARN] LIVE balance = $0 after sync — AT blocked until balance confirmed')
          AT.enabled = false
          _atUI({ status: { icon: 'x', text: 'Live balance = 0 — check API', action: null } })
          w.Intervals.clear('atCheck'); clearInterval(AT.interval ?? undefined); AT.interval = null
        } else {
          atLog('info', '[BAL] LIVE balance synced: $' + TP.liveBalance.toFixed(2))
        }
      }).catch(function () {
        atLog('warn', '[WARN] Live balance sync failed at AT start — AT blocked')
        AT.enabled = false
        _atUI({ status: { icon: 'x', text: 'Balance sync failed — AT blocked', action: null } })
        w.Intervals.clear('atCheck'); clearInterval(AT.interval ?? undefined); AT.interval = null
      })
    }
    w.atUpdateBanner(); w.ptUpdateBanner()
    w.ZState.save()  // persist AT.enabled = true + push to server for cross-device sync
    if (typeof w._usScheduleSave === 'function') w._usScheduleSave() // also push AT state via user-context
    _emitATChanged()
  } else {
    _atUI({ btnClass: 'at-main-btn off', dotBg: 'var(--pur)', dotShadow: '0 0 6px var(--pur)', btnText: 'AUTO TRADE OFF', status: { icon: null, text: 'Configure below', action: null } })
    atLog('warn', '[AT] Auto Trade STOPPED.')
    w.Intervals.clear('atCheck'); clearInterval(AT.interval ?? undefined); AT.interval = null
    w.atUpdateBanner(); w.ptUpdateBanner()
    w.ZState.save()  // persist AT.enabled = false + push to server for cross-device sync
    if (typeof w._usScheduleSave === 'function') w._usScheduleSave() // also push AT state via user-context
    _emitATChanged()
  }
}

export function updateATMode(): void {
  const mode = (typeof AT !== 'undefined' && AT._serverMode) ? AT._serverMode : 'demo'
  AT.mode = mode as 'demo' | 'live'
  var _env = w._resolvedEnv || (mode === 'demo' ? 'DEMO' : 'REAL')
  if (mode === 'live') {
    var _isTest = _env === 'TESTNET'
    var _col = _isTest ? 'var(--gold)' : 'var(--red-bright)'
    var _colDim = _isTest ? '#f0c04044' : '#ff444444'
    var _short = _isTest ? 'TESTNET' : 'LIVE'
    var _long = _isTest ? 'TESTNET MODE' : 'LIVE MODE'
    var _icoKind: 'dYlw' | 'dRed' = _isTest ? 'dYlw' : 'dRed'
    _atUI({
      modeLabel: { icon: _icoKind, text: _short, color: _col },
      modeDisplay: { icon: _icoKind, text: _long, lockSuffix: false, color: _col, border: _colDim },
      liveWarnVisible: true,
    })
  } else {
    _atUI({
      modeLabel: { icon: 'pad', text: 'DEMO', color: 'var(--pur)' },
      modeDisplay: { icon: 'pad', text: 'DEMO MODE', lockSuffix: false, color: 'var(--pur)', border: '#aa44ff44' },
      liveWarnVisible: false,
    })
  }
}

export function atLog(type: any, msg: any): void {
  const now = new Date().toLocaleTimeString('ro-RO', { timeZone: getTimezone() || 'Europe/Bucharest', hour: '2-digit', minute: '2-digit', second: '2-digit' })
  AT.log.unshift({ time: now, type, msg })
  if (AT.log.length > 80) AT.log.pop()
  renderATLog()
  // [NC] trimitem doar evenimentele importante (warn, kill, buy, sell)
  if (type === 'warn') w.ncAdd('warning', 'system', msg)
  if (type === 'kill') w.ncAdd('critical', 'system', msg)
  if (type === 'buy') w.ncAdd('info', 'trade', msg)
  if (type === 'sell') w.ncAdd('info', 'trade', msg)
  // Persist AT log to UI context (debounced, display-only)
  if (typeof w._ctxSave === 'function') w._ctxSave()
}

export function renderATLog(): void {
  _atUI({ logEntries: AT.log.map((l: any) => ({ time: String(l.time), type: String(l.type), msg: String(l.msg) })) })
}

export function updateATStats(): void {
  // [v3] Mode-aware stats: pick demo or live stats based on current mode
  var _gm = (typeof AT !== 'undefined' && AT._serverMode) ? AT._serverMode : 'demo'
  var ss: any
  if (_gm === 'live') {
    ss = (typeof AT !== 'undefined' && AT._serverLiveStats) ? AT._serverLiveStats : null
  } else {
    ss = (typeof AT !== 'undefined' && AT._serverDemoStats) ? AT._serverDemoStats :
      (typeof AT !== 'undefined' && AT._serverStats) ? AT._serverStats : null
  }
  const wins = ss ? (ss.wins || 0) : AT.wins
  const losses = ss ? (ss.losses || 0) : AT.losses
  const tot = wins + losses
  const wr = tot ? Math.round(wins / tot * 100) : 0
  const totalPnL = ss ? (ss.pnl || 0) : AT.totalPnL
  const dailyPnl = ss ? (ss.dailyPnL || 0) : AT.dailyPnL
  const trades = ss ? (ss.entries || 0) : AT.totalTrades

  const uiPatch: Partial<ATUI> = {
    totalTradesText: String(trades),
    winRateText: tot ? wr + '%' : '\u2014',
    winRateColor: wr >= 55 ? 'var(--grn)' : wr >= 40 ? 'var(--ylw)' : 'var(--red)',
    totalPnLText: (totalPnL >= 0 ? '+' : '') + '$' + totalPnL.toFixed(0),
    totalPnLColor: totalPnL >= 0 ? 'var(--grn)' : 'var(--red)',
    dailyLossText: (dailyPnl >= 0 ? '+' : '-') + '$' + Math.abs(dailyPnl).toFixed(0),
    dailyLossColor: dailyPnl < 0 ? 'var(--red)' : 'var(--grn)',
    dailyLabel: dailyPnl >= 0 ? 'DAILY WIN' : 'DAILY LOSS',
  }
  if (_gm === 'live') {
    if (w._apiConfigured && typeof TP !== 'undefined' && TP.liveBalance > 0) {
      uiPatch.balanceText = '$' + TP.liveBalance.toLocaleString('en-US', { maximumFractionDigits: 0 })
      uiPatch.balanceColor = totalPnL >= 0 ? 'var(--grn)' : 'var(--red)'
    } else {
      uiPatch.balanceText = 'Exchange not configured'
      uiPatch.balanceColor = 'var(--dim)'
    }
  } else {
    var balance = (typeof TP !== 'undefined') ? (TP.demoBalance || 10000) : 10000
    uiPatch.balanceText = '$' + balance.toLocaleString('en-US', { maximumFractionDigits: 0 })
    uiPatch.balanceColor = totalPnL >= 0 ? 'var(--grn)' : 'var(--red)'
  }
  _atUI(uiPatch)
}

// ─── CONDITION CHECKER ─────────────────────────────────────────

// Condition checker
export function checkATConditions(): any {
  const confMin = (typeof BM !== 'undefined' ? BM.confMin : 65) || 65 // [FIX v85.1 F2] sursă unică — era ||68 inconsistent
  // [P1] Read from TC (server-safe), DOM fallback
  const sigMin = getTCSignalMin() // TC.sigMin bridge — no dedicated getter yet

  // 1. Confluence Score — read from canonical BM state, not DOM
  const score = (typeof BM !== 'undefined' && Number.isFinite(BM.confluenceScore)) ? BM.confluenceScore : 50
  const isBull = score >= confMin
  const isBear = score <= (100 - confMin)
  setCondUI('atCondConf', isBull || isBear, isBull ? 'BULL ' + score : isBear ? 'BEAR ' + score : score + ' (neutru)')

  // 2. Signal count
  const { bullCount = 0, bearCount = 0 } = getSignalData() || {}
  const sigOk = bullCount >= sigMin || bearCount >= sigMin
  const sigDir = bullCount >= bearCount ? 'bull' : 'bear'
  setCondUI('atCondSig', sigOk, sigOk ? `${Math.max(bullCount, bearCount)}/${sigMin}` : `${Math.max(bullCount, bearCount)}/${sigMin}`)

  // 3. Supertrend direction
  const stFlip = getSignalData()?.signals?.find((s: any) => s.name.includes('Supertrend'))
  const stDir = stFlip?.dir
  const stOk = !!stFlip
  setCondUI('atCondST', stOk, stOk ? stDir === 'bull' ? 'BULL ✓' : 'BEAR ✓' : 'Nu e flip')

  // 4. ADX filter
  const adxVal = getCurrentADX()
  const adxOk = adxVal === null || adxVal >= 18
  setCondUI('atCondADX', adxOk, adxVal !== null ? 'ADX ' + adxVal + (adxOk ? ' ✓' : ' ← slab') : 'Se calc...')

  // 5. Hour filter - BUG3 FIX: UTC
  const hourOk = isCurrentTimeOK()
  const { day: curDay2, hour: curHour2 } = getTimeUTC()
  const hourWR2 = w.DHF.hours[curHour2]?.wr || 60
  setCondUI('atCondHour', hourOk, hourOk ? `${curDay2} ${String(curHour2).padStart(2, '0')}h UTC WR:${hourWR2}% ✓` : `${String(curHour2).padStart(2, '0')}h UTC WR:${hourWR2}% — EVITA`)

  // 6. No opposite open position
  // [PATCH P1-1] Include live positions when in live mode (was always [])
  const autoPositions = getATMode() === 'demo'
    ? (TP.demoPositions || []).filter((p: any) => p.autoTrade)
    : (TP.livePositions || []).filter((p: any) => p.autoTrade)
  const dir = isBull ? 'LONG' : 'SHORT'
  const hasOpposite = autoPositions.some((p: any) => (dir === 'LONG' && p.side === 'SHORT') || (dir === 'SHORT' && p.side === 'LONG'))
  setCondUI('atCondOpp', !hasOpposite, hasOpposite ? 'Opposite position active' : 'OK')

  // 7. Magnet alignment bonus
  void getMagnetBias()
  // Not a hard block, but logged

  // Max positions check — read from TC.maxPos (source: atMaxPos)
  const maxPos = getTCMaxPos()
  const openAuto = autoPositions.length
  // BUG FIX: Also prevent opening same symbol twice in single-symbol mode
  const symAlreadyOpen = autoPositions.some((p: any) => p.sym === getSymbol())
  const posOk = openAuto < maxPos && !symAlreadyOpen

  // Cooldown check — per-symbol in multi-symbol mode
  const nowTs = Date.now()
  const _symCd = (AT._cooldownBySymbol && AT._cooldownBySymbol[getSymbol()]) || 0
  const coolOk = (nowTs - Math.max(getATLastTradeTs(), _symCd)) > AT.cooldownMs

  const allOk = (isBull || isBear) && sigOk && stOk && adxOk && hourOk && !hasOpposite && posOk && coolOk

  // [AUDIT-L1] Diagnostic: build list of gates that blocked this tick (no behavior change)
  const _blockReasons: string[] = []
  if (!(isBull || isBear)) _blockReasons.push(`conf=${score}(need ${confMin}+ or ${100 - confMin}-)`)
  if (!sigOk) _blockReasons.push(`sig=${Math.max(bullCount, bearCount)}/${sigMin}`)
  if (!stOk) _blockReasons.push('st=no-flip')
  if (!adxOk) _blockReasons.push(`adx=${adxVal}<18`)
  if (!hourOk) _blockReasons.push(`hour=${String(curHour2).padStart(2, '0')}UTC WR${hourWR2}%`)
  if (hasOpposite) _blockReasons.push('opp=open')
  if (!posOk) _blockReasons.push(symAlreadyOpen ? 'pos=sym-already-open' : `pos=${openAuto}/${maxPos}`)
  if (!coolOk) _blockReasons.push(`cool=${Math.max(0, Math.round((AT.cooldownMs - (nowTs - Math.max(getATLastTradeTs(), _symCd))) / 1000))}s`)
  AT._lastBlockReason = _blockReasons.join(' | ')
  AT._lastBlockTs = nowTs
  // Throttled log: emit only if AT enabled, blocked, and reasons changed OR 60s since last log
  if (!allOk && getATEnabled()) {
    const _rk = _blockReasons.join('|')
    const _lastLogged = AT._lastBlockLogKey
    const _lastLoggedTs = AT._lastBlockLogTs || 0
    if (_rk !== _lastLogged || (nowTs - _lastLoggedTs) > 60000) {
      atLog('info', `[AT-BLOCK] ${_blockReasons.join(' | ')}`)
      AT._lastBlockLogKey = _rk
      AT._lastBlockLogTs = nowTs
    }
  }

  const _atResult = {
    allOk,
    isBull: isBull && sigDir === 'bull',
    isBear: isBear && sigDir === 'bear',
    score, bullCount, bearCount,
    stDir, posOk, coolOk, adxOk, hourOk,
    blockReasons: _blockReasons
  }
  // [P0.4] Decision log — AT gate check
  if (typeof w.DLog !== 'undefined') w.DLog.record('at_gate', _atResult)
  return _atResult
}

export function setCondUI(id: any, ok: any, txt: any): void {
  const cls = 'at-cond-val ' + (ok ? 'ok' : 'fail')
  if (id === 'atCondConf') _atUI({ condConf: txt, condConfClass: cls })
  else if (id === 'atCondSig') _atUI({ condSig: txt, condSigClass: cls })
  else { const e = el(id); if (e) { e.textContent = txt; e.className = cls } }
}


// ══════════════════════════════════════════════════════════════
// ZEUS SAFETY ENGINE v1.0 — 10 protection systems
// ══════════════════════════════════════════════════════════════

// ── GLOBAL SAFETY STATE ──────────────────────────────────────
// [MOVED TO TOP] _SAFETY

// ── 2. NaN / Infinity GUARD ───────────────────────────────────
// Safe math helpers used everywhere
// [MOVED TO TOP] _safe

// ── 4. PRICE SANITY CHECK ─────────────────────────────────────

// Data quality for autotrade
// ─── STALL GRACE PERIOD FOR AUTOTRADE ─────────────────────────
// STALL_GRACE_MS declared in constants.js (loads first)
export function isDataOkForAutoTrade(): any {
  // [v119-p16] Tab hidden gate
  if (w._SAFETY.tabHidden) return false
  // [P2-5] Tab restore grace: wait 5s after tab becomes visible for fresh data
  if (w._SAFETY.tabRestoreTs && (Date.now() - w._SAFETY.tabRestoreTs) < 5000) return false
  if (!w._SAFETY.dataStalled) return true
  return (Date.now() - (w._SAFETY.dataStalledSince || 0)) < STALL_GRACE_MS
}

// ═══════════════════════════════════════════════════════════════
//  FUSION BRAIN v1 — agregator toate modulele → decision verdict
//  Injectat: PATCH v118.2.6 (chirurgical, nu rupe nimic existent)
// ═══════════════════════════════════════════════════════════════

// Fusion decision
export function _clampFB01(x: any): any { x = +x; return !Number.isFinite(x) ? 0 : Math.max(0, Math.min(1, x)) }
export function _clampFB(x: any, a: any, b: any): any { x = +x; return !Number.isFinite(x) ? a : Math.max(a, Math.min(b, x)) }

export function computeFusionDecision(): any {
  const reasons: any[] = []
  const out: any = { ts: Date.now(), dir: 'neutral', decision: 'NO_TRADE', confidence: 0, score: 0 }

  // 1) Confluence (0..100)
  const conf = Number.isFinite(+BM?.confluenceScore) ? +BM.confluenceScore : 50
  const confN = _clampFB01((conf - 50) / 50)
  reasons.push('Confluence:' + conf.toFixed(0))

  // 2) Scenario / ProbScore
  let prob: any = null
  try {
    if (typeof computeProbScore === 'function') {
      const r: any = (computeProbScore as any)()
      if (Number.isFinite(+r)) prob = +r
      else if (r && Number.isFinite(+r.score)) prob = +r.score
      else if (r && Number.isFinite(+r.confidence)) prob = +r.confidence
    }
  } catch (_) { }
  const probN = prob == null ? 0.5 : _clampFB01(prob / 100)
  if (prob != null) reasons.push('Scenario:' + prob.toFixed(0))

  // 3) Regime
  let regime = (getBrainObject() && getBrainObject().regime) ? String(getBrainObject().regime) : 'unknown'
  let regimeN = 0.5
  if (regime.includes('trend')) regimeN = 0.75
  if (regime.includes('range')) regimeN = 0.55
  if (regime.includes('chop') || regime.includes('unstable')) regimeN = 0.35
  reasons.push('Regime:' + regime)

  // 4) OFI / Orderflow
  const buy = Number.isFinite(+getBrainObject()?.ofi?.buy) ? +getBrainObject().ofi.buy : 0
  const sell = Number.isFinite(+getBrainObject()?.ofi?.sell) ? +getBrainObject().ofi.sell : 0
  const ofi = (buy + sell) > 0 ? (buy - sell) / (buy + sell) : 0
  const ofiN = (ofi + 1) / 2
  if ((buy + sell) > 0) reasons.push('OFI:' + (ofi * 100).toFixed(0) + '%')

  // 5) Liquidity danger
  let liqDangerN = 0.2
  try {
    const nearPct = Number.isFinite(+w.MAGNETS?.nearPct) ? +w.MAGNETS.nearPct : null
    if (nearPct != null) { liqDangerN = _clampFB01(nearPct / 100); reasons.push('LiqDanger:' + nearPct.toFixed(0) + '%') }
  } catch (_) { }

  // 6) Hard veto: KillSwitch / Session
  if (!!AT?.killTriggered) {
    out.decision = 'NO_TRADE'; out.confidence = 0; out.dir = 'neutral'
    reasons.push('VETO:KillSwitch')
    return { ...out, reasons }
  }

  // 7) Direction score
  let dirScore = 0
  dirScore += (ofi * 0.55)
  dirScore += ((conf - 50) / 50) * 0.30
  try {
    if (w.LAST_SCAN && Date.now() - w.LAST_SCAN.ts > 120000) {
      w.LAST_SCAN.sigDir = null
    }
    const sigDir = w.LAST_SCAN?.sigDir
    if (sigDir === 'bull') dirScore += 0.25
    if (sigDir === 'bear') dirScore -= 0.25
  } catch (_) { }
  dirScore = _clampFB(dirScore, -1, 1)
  out.dir = dirScore > 0.15 ? 'long' : dirScore < -0.15 ? 'short' : 'neutral'
  reasons.push('DirScore:' + (dirScore * 100).toFixed(0) + '%')

  // 8) Confidence fusion
  const alignN = out.dir === 'neutral' ? 0 : (out.dir === 'long' ? ofiN : (1 - ofiN))
  let confF = (confN * 0.35) + (probN * 0.25) + (regimeN * 0.20) + (alignN * 0.20)
  confF *= (1 - (liqDangerN * 0.55))
  confF = _clampFB01(confF)
  out.confidence = Math.round(confF * 100)

  // 9) Entry tier
  if (out.dir === 'neutral') {
    out.decision = 'NO_TRADE'
  } else if (out.confidence >= 82 && conf >= 75 && regimeN >= 0.55) {
    out.decision = 'LARGE'
  } else if (out.confidence >= 72 && conf >= 68) {
    out.decision = 'MEDIUM'
  } else if (out.confidence >= 62 && conf >= 60) {
    out.decision = 'SMALL'
  } else {
    out.decision = 'NO_TRADE'
  }

  // [P0.1] ARES wallet is 100% independent — never veto AT decisions.
  // ARES manages its own capital, AT manages its own. No cross-interference.

  reasons.push('Decision:' + out.decision + '(' + out.confidence + '%)')
  out.score = Math.round(dirScore * out.confidence)
  // [P0.4] Decision log — fusion decision
  if (typeof w.DLog !== 'undefined') w.DLog.record('fusion', { dir: out.dir, decision: out.decision, confidence: out.confidence, score: out.score })
  return { ...out, reasons }
}

// Wire Fusion Brain into runAutoTradeCheck (post-call observer)
;(function _wireFusionIntoAT() {
  // Will wrap after definition — see sentinel below
  w._FUSION_BRAIN_WIRE_PENDING = true
})()


// Main AT check loop
export function runAutoTradeCheck(): void {
  // [AT-UNIFY] Server is source of truth — skip client AT engine
  if (w._serverATEnabled) {
    // Update AT conditions UI from server state so panel doesn't appear frozen
    try {
      var _se = function(id: any, ok: any) { var e = el(id); if (e) { e.textContent = ok ? 'OK' : '\u2014'; e.className = ok ? 'atcond-ok' : 'atcond-fail' } }
      _atUI({ condConf: 'OK', condConfClass: 'at-cond-val ok', condSig: 'OK', condSigClass: 'at-cond-val ok' })
      _se('atCondST', true)
      _se('atCondADX', true)
      _se('atCondHour', true)
      _se('atCondOpp', true)
      if (getATEnabled()) _atUI({ status: { icon: null, text: 'SERVER AT ACTIVE — brain controls execution', action: null } })
    } catch (_) {}
    return
  }
  // [B1] Multi-tab protection — only leader tab runs AT
  if (typeof TabLeader !== 'undefined' && !TabLeader.checkLeader()) return
  // [p19] Predator state refresh — always runs
  computePredatorState()
  // Prevent overlapping AT check cycles
  if (AT.running) return
  // AT.enabled gates the entire scan/analysis loop (single command — no more S.runMode)
  if (!getATEnabled() || getATKillTriggered()) return
  AT.running = true
  try {
    // B: Data stall grace period check BEFORE exec lock
    if (!isDataOkForAutoTrade()) {
      _setBR('DATA_STALL', 'Data stalled > 10s — AT paused', 'autoCheck')
      return
    }
    // Safety engine check
    const [_execOk, _execReason] = _isExecAllowed()
    if (!_execOk) { atLog('wait', `[WAIT] AT wait: ${_execReason}`); return }

    // Reset daily P&L if new day — use server day if synced, else local
    const _serverDay = w._SAFETY.storedDayId ? w._SAFETY.storedDayId : 0
    const _localDay = new Date().toISOString().slice(0, 10)
    if (AT.dailyStart !== _localDay || (_serverDay && _serverDay !== w._SAFETY._prevServerDay)) {
      AT.dailyPnL = 0; AT.realizedDailyPnL = 0; AT.closedTradesToday = 0; AT.totalTrades = 0; AT.wins = 0; AT.losses = 0; AT.totalPnL = 0
      AT.dailyStart = _localDay
      w._SAFETY._prevServerDay = _serverDay
      atLog('info', '[RESET] Daily counters reset (server UTC sync)')
    }

    // ── KILL SWITCH — realized + unrealized loss ──
    const killPct = parseFloat(el('atKillPct')?.value || '') || 5
    // [FIX BUG2] No phantom $10k fallback — skip kill check if balance unknown (consistent with checkKillThreshold)
    const bal = +(getATMode() === 'demo' ? TP.demoBalance : TP.liveBalance) || 0
    if (bal <= 0) { /* skip inline kill check — checkKillThreshold handles it when balance loads */ }
    const _realPnL = +(getATDailyPnL()) || 0
    // [PATCH3 R2] Include unrealized PnL in kill switch check
    let _unrealPnL2 = 0
    const _openList2 = getATMode() === 'demo' ? (TP.demoPositions || []) : (TP.livePositions || [])
    for (let i = 0; i < _openList2.length; i++) {
      const _p = _openList2[i]
      if (_p.closed || _p.status === 'closing') continue
      const _cur = getSymPrice(_p)
      if (_cur != null && _cur > 0 && _p.entry > 0) {
        // [PATCH P1-6] Use _safePnl for consistency
        const _diff2 = _cur - _p.entry
        _unrealPnL2 += _safePnl(_p.side, _diff2, _p.entry, _p.size || 0, _p.lev || 1, true)
      }
    }
    const _totalDayPnL2 = _realPnL + _unrealPnL2
    const _closedToday = +(getATClosedToday()) || 0
    // Guard: need at least one closed trade OR significant unrealized loss
    if (_closedToday === 0 && _unrealPnL2 >= 0) { /* skip */ }
    else if (bal > 0 && Number.isFinite(_totalDayPnL2) && _totalDayPnL2 < 0 && Math.abs(_totalDayPnL2) / bal * 100 >= killPct) {
      triggerKillSwitch('daily_loss', _totalDayPnL2, _closedToday, killPct, bal)
      return
    }

    // Multi-symbol mode: scan all symbols
    const multiOn = el('atMultiSym')?.checked !== false
    if (multiOn) {
      if (typeof w.runMultiSymbolScan === 'function') w.runMultiSymbolScan()
      return // multi-sym scan handles entries
    }

    // Single symbol mode (original)
    const cond = checkATConditions()

    // [PATCH B2] AT_SCAN log for single-symbol path
    {
      const _dir2 = cond.isBull ? 'bull' : cond.isBear ? 'bear' : 'neut'
      atLog('info', 'AT_SCAN ' + (getSymbol() || '').replace('USDT', '') + ' score=' + cond.score + ' dir=' + _dir2)
    }

    // [v119-p7] FUSION_CACHE — actualizat la FIECARE tick, citit de ML vizual (read-only)
    // Separat de FUSION_LAST (care se scrie doar pe semnal). Nu afectează sizing/trade/DSL.
    try {
      if (typeof computeFusionDecision === 'function') {
        const _fcRaw = computeFusionDecision()
        w.FUSION_CACHE = {
          ts: Date.now(),
          dir: _fcRaw.dir || 'neutral',
          decision: _fcRaw.decision || 'NO_TRADE',
          confidence: _fcRaw.confidence || 0,
          score: _fcRaw.score || 0,
        }
      }
    } catch (_) { /* silent — nu blochează AT */ }

    if (!cond.allOk) {
      // [PATCH B3] AT_BLOCK log with context
      {
        const _bDir = cond.isBull ? 'bull' : cond.isBear ? 'bear' : 'neut'
        const _bRe = (typeof BM !== 'undefined' && BM.regimeEngine) ? BM.regimeEngine.regime : '—'
        const _bPh = (typeof BM !== 'undefined' && BM.phaseFilter) ? BM.phaseFilter.phase : '—'
        const _bParts: any[] = []
        if (!cond.posOk) _bParts.push('max_pos')
        if (!cond.coolOk) _bParts.push('cooldown')
        if (!cond.adxOk) _bParts.push('adx_low')
        if (!cond.hourOk) _bParts.push('hour_filter')
        if (!cond.isBull && !cond.isBear) _bParts.push('no_signal')
        atLog('info', 'AT_BLOCK ' + (getSymbol() || '').replace('USDT', '') + ' regime=' + _bRe + ' phase=' + _bPh + ' score=' + cond.score + ' dir=' + _bDir + ' reason=' + (_bParts.join(',') || 'conds_unmet'))
        // [P0.4] Decision log — AT blocked
        if (typeof w.DLog !== 'undefined') w.DLog.record('at_block', { sym: getSymbol(), regime: _bRe, phase: _bPh, score: cond.score, dir: _bDir, reasons: _bParts })
      }
      // Update status
      const reasons: any[] = []
      if (!cond.posOk) reasons.push('max positions reached')
      if (!cond.coolOk) reasons.push('cooldown')
      _atUI({ status: reasons.length
        ? { icon: 'timer', text: 'Wait: ' + reasons.join(', '), action: null }
        : { icon: 'mag', text: 'Scan... conditions not met', action: null } })
      return
    }

    // All conditions met — clear any stale block reason
    _clearBR()
    w.ZState.scheduleSave()

    // AT gates execution — if AT OFF, scan still shows signals but no trade
    if (!getATEnabled()) {
      const _sigDir = cond.isBull ? 'LONG' : 'SHORT'
      atLog('info', `[SCAN] Signal ${_sigDir} (score:${cond.score}) but AT OFF — no execution`)
      _atUI({ status: { icon: 'mag', text: 'Signal found \u2014 AT OFF', action: null } })
      return
    }

    // [FIX BUG1] Guard: confluence/signal direction disagree → no clear direction, skip
    if (!cond.isBull && !cond.isBear) {
      atLog('info', 'AT_SKIP ' + (getSymbol() || '').replace('USDT', '') + ' confluence/signal disagree — no clear direction')
      _atUI({ status: { icon: 'mag', text: 'Confluence/signals conflict \u2014 skip', action: null } })
      return
    }

    const side = cond.isBull ? 'LONG' : 'SHORT'
    // [PATCH B4] AT_SIGNAL log for allowed entry
    {
      const _sPh = (typeof BM !== 'undefined' && BM.phaseFilter) ? BM.phaseFilter.phase : '—'
      const _sConf = (typeof BM !== 'undefined' && BM.regimeEngine) ? BM.regimeEngine.confidence : 0
      atLog('info', 'AT_SIGNAL ' + (getSymbol() || '').replace('USDT', '') + ' side=' + side + ' conf=' + _sConf + ' score=' + cond.score + ' phase=' + _sPh)
      // [P0.4] Decision log — AT signal allowed
      if (typeof w.DLog !== 'undefined') w.DLog.record('at_signal', { sym: getSymbol(), side: side, conf: _sConf, score: cond.score, phase: _sPh })
    }
    atLog(side === 'LONG' ? 'buy' : 'sell',
      `[SIGNAL] SIGNAL ${side} confirmed! Score:${cond.score} | ${Math.max(cond.bullCount, cond.bearCount)} signals | ST:${cond.stDir} | Magnet:${getMagnetBias() || 'neut'}`)

    // ── FUSION BRAIN v1 — final arbiter before exec ──────────────
    try {
      if (typeof computeFusionDecision === 'function') {
        const _fd = computeFusionDecision()
        w.FUSION_LAST = _fd
        w.FUSION_SIZE_MULT = _fd.decision === 'LARGE' ? 1.75 : _fd.decision === 'MEDIUM' ? 1.35 : 1.0
        // Log reasons
        {
          const _ic = _fd.decision === 'NO_TRADE' ? 'bad' : _fd.decision === 'LARGE' ? 'ok' : 'info'
          brainThink(_ic, _ZI.brain + ' Fusion: ' + _fd.dir.toUpperCase() + ' | ' + _fd.decision + ' | ' + _fd.confidence + '%')
        }
        {
          const _rr = (_fd.reasons || []).slice(0, 4).join(' • ')
          atLog(_fd.decision === 'NO_TRADE' ? 'warn' : 'info', 'Fusion → ' + _fd.dir + '/' + _fd.decision + '/' + _fd.confidence + '% | ' + _rr)
        }
        if (_fd.decision === 'NO_TRADE') {
          w._FUSION_VETO = true
          _setBR('FUSION', 'Fusion Brain: NO_TRADE (' + _fd.confidence + '%) — ' + (_fd.reasons || []).slice(0, 2).join(', '), 'fusionBrain')
          return
        }
        w._FUSION_VETO = false
      }
    } catch (_fb_err) { /* fusion non-blocking */ }
    // ─────────────────────────────────────────────────────────────

    placeAutoTrade(side, cond)
  } finally { AT.running = false }
}

// ─── PLACE AUTO TRADE ──────────────────────────────────────────

// Place auto trade
export function placeAutoTrade(side: any, cond: any, _sym?: any, _price?: any): void {
  // [AT-UNIFY] Server handles all trade placement
  if (w._serverATEnabled) { atLog('info', '[LOCKED] Server AT active — client trade blocked'); return }
  // ── KILL SWITCH: check before exec (2. kill timing) ──────────
  if (getATKillTriggered()) {
    _setBR('KILL_SWITCH', 'Kill switch active — AT blocked', 'placeAutoTrade')
    return
  }
  // [FIX C5] Prevent re-entrant live execution
  if (AT._liveExecInFlight) {
    atLog('warn', '[WARN] Live exec already in flight — skipping duplicate')
    return
  }
  if (BM?.protectMode) {
    _setBR('PROTECT_MODE', BM.protectReason || 'Protect mode activ', 'placeAutoTrade')
    return
  }

  // [DSL MODE GUARD] Auto-fallback to 'atr' if not set (prevents silent permanent block)
  if (!getDSLMode()) {
    w.DSL.mode = 'atr'
    atLog('info', '[INFO] DSL mode auto-set to ATR (default)')
    try { localStorage.setItem('zeus_dsl_mode', 'atr') } catch (_) { }
  }

  // [p19 PREDATOR VETO]
  // PREDATOR semantics: KILL=green/all-clear, HUNT=caution, SLEEP=danger
  // Block trades when NOT in KILL (clear) state
  if (typeof PREDATOR !== 'undefined' && PREDATOR.state !== 'KILL') {
    var _pr = 'PREDATOR ' + PREDATOR.state + ' [' + PREDATOR.reason + ']'
    _setBR('PREDATOR', _pr, 'placeAutoTrade')
    atLog('warn', '[PREDATOR] VETO: ' + PREDATOR.state + ' / ' + PREDATOR.reason)
    return
  }
  // [/p19 PREDATOR VETO]

  // === PATCH B: WR FILTER (by UTC hour → DHF.hours) — EXEC VETO ONLY ===
  // Brain/MI/scoruri rămân active. Doar execuția e blocată în orele slabe.
  // Data layer: UTC (consistent cu DHF.hours indexing și trade logging)
  // UI/log: afișăm și ora RO pentru claritate
  try {
    const _wrCfg = (w.WVE_CONFIG && w.WVE_CONFIG.wrFilter) || null
    if (_wrCfg && _wrCfg.enabled) {
      const _utcHour = getTimeUTC().hour                    // lookup UTC — consistent cu DHF
      const _wrVal = w.DHF.hours?.[_utcHour]?.wr
      if (typeof _wrVal === 'number' && _wrVal < _wrCfg.minWR) {
        _setBR('WR_FILTER', 'WR ' + _wrVal + '% < ' + _wrCfg.minWR + '% @ UTC' + String(_utcHour).padStart(2, '0') + 'h', 'placeAutoTrade')
        if (!AT._wrLogTs || (Date.now() - AT._wrLogTs) > _wrCfg.warnEveryMs) {
          AT._wrLogTs = Date.now()
          const _roH = typeof w.getRoTime === 'function' ? w.getRoTime().hh : _utcHour
          atLog('warn', '[WR] WR_FILTER veto: UTC' + String(_utcHour).padStart(2, '0') + 'h (RO ' + String(_roH).padStart(2, '0') + 'h) WR=' + _wrVal + '% < min=' + _wrCfg.minWR + '%')
        }
        return
      }
    }
  } catch (_wrE) { /* non-blocking — nu oprim execuția dacă filtrul crapă */ }
  // === /WR FILTER ===
  const _snap = typeof w.buildExecSnapshot === 'function' ? w.buildExecSnapshot(side, cond) : null
  // [PATCH1 B1] buildExecSnapshot returns null if price invalid — reject early
  if (!_snap) {
    _setBR('INVALID_PRICE', 'Snapshot rejected — invalid price', 'placeAutoTrade')
    atLog('warn', '[FAIL] buildExecSnapshot rejected (price invalid)'); return
  }
  // Use snapshot values exclusively — never re-read global state
  const sym = _sym || _snap.symbol
  const entry = _price || _snap.price
  if (!isValidMarketPrice(entry)) {
    _setBR('INVALID_PRICE', 'Invalid price at exec', 'placeAutoTrade')
    atLog('warn', '[FAIL] No current price at exec'); return
  }
  // [FIX H2] Dedup: reject if same symbol already has open AT position
  const _existingPos = (getATMode() === 'demo' ? (TP.demoPositions || []) : (TP.livePositions || []))
    .filter((p: any) => p.autoTrade && !p.closed && p.sym === sym)
  if (_existingPos.length > 0) {
    atLog('warn', '[DEDUP] ' + sym + ' already has open AT position — skipping')
    return
  }

  const lev = _snap.lev
  const size = _snap.size  // margin cap from atSize
  const riskPct = _snap.riskPct || 1 // [RISK RAILS] risk % per trade
  const slPctForSize = _snap.slPct   // SL% used for risk-based sizing

  // ── RISK-BASED POSITION SIZING ──────────────────────────────────
  // Formula: riskSize = (balance × riskPct%) / (slPct%)
  // riskSize = margin that, at this SL%, risks exactly riskPct% of balance
  // Capped by TC.size (atSize) as absolute margin ceiling
  const _rrBalance = (typeof AT !== 'undefined' && getATMode() === 'live')
    ? (+(TP.liveBalance) || 0)
    : (+(TP.demoBalance) || 1000)
  const _riskSizeRaw = (_rrBalance * (riskPct / 100)) / (slPctForSize / 100)
  const _riskSizeCapped = Math.min(_riskSizeRaw, size) // atSize = margin cap
  // [Level 5] Adaptive position sizing — gated: BM.adapt.enabled
  // Fusion Brain size multiplier (SMALL=1.0 / MEDIUM=1.35 / LARGE=1.75)
  const _fusionMult = Number.isFinite(+w.FUSION_SIZE_MULT) ? +w.FUSION_SIZE_MULT : 1.0
  // Conviction × Danger sizing multiplier (Adaptive Shield)
  const _convDangerMult = (typeof BM !== 'undefined' && Number.isFinite(BM.convictionMult)) ? BM.convictionMult : 1.0
  if (_convDangerMult <= 0) {
    _setBR('CONVICTION_LOW', 'Conviction ' + (BM.conviction || 0) + '% / Danger ' + (BM.danger || 0) + ' — trade skipped', 'placeAutoTrade')
    atLog('warn', '[SHIELD] conviction=' + (BM.conviction || 0) + '% danger=' + (BM.danger || 0) + ' mult=0 → SKIP')
    // [L1-SHIELD-DIAG] Throttled breakdown: show WHY conviction is low (60s dedup by signature)
    // [R34] Dropped redundant `(w as any)` / `(BM as any)` casts — both are
    // already typed `any` at import time (core/config.ts:BM, line 43 above:w).
    try {
      const _bd: any = BM._convictionBreakdown || null
      const _fg: any[] = BM._entryFailedGates || []
      if (_bd) {
        const _sig = 'es=' + _bd.entryScore + '|atm=' + _bd.atmPart + '|mtf=' + _bd.mtfPart + '|ofi=' + _bd.ofiPart + '|sig=' + _bd.sigPart + '|fg=' + _fg.join(',')
        const _lastSig = w._lastShieldDiagSig
        const _lastTs = w._lastShieldDiagTs || 0
        const _now = Date.now()
        if (_sig !== _lastSig || (_now - _lastTs) > 60000) {
          w._lastShieldDiagSig = _sig
          w._lastShieldDiagTs = _now
          const parts = [
            '[SHIELD-DIAG] dir=' + _bd.dir,
            'entryScore=' + _bd.entryScore + '(→' + _bd.entryPart + '/40)',
            'atm=' + _bd.atmConf + '(→' + _bd.atmPart + '/15)',
            'mtf1h=' + _bd.mtf1h + '/4h=' + _bd.mtf4h + '(→' + _bd.mtfPart + '/15)',
            'ofi=' + _bd.ofi + '(→' + _bd.ofiPart + ')',
            'sig=' + _bd.sigBull + 'b/' + _bd.sigBear + 's(→' + _bd.sigPart + '/5)',
            'danger=' + _bd.danger,
          ]
          if (_fg.length) parts.push('failed_gates=[' + _fg.join(',') + ']')
          atLog('info', parts.join(' | '))
        }
      }
    } catch (_) { /* diag never throws */ }
    return
  }
  const _sizeMult = ((BM.adapt && BM.adapt.enabled) ? (BM.positionSizing && BM.positionSizing.finalMult ? BM.positionSizing.finalMult : 1) : 1) * _fusionMult * _convDangerMult
  const _sizeRaw = Math.round(_riskSizeCapped * _sizeMult)
  const _sizeMin = Math.round(_riskSizeCapped * 0.5)
  const _sizeMax = Math.round(_riskSizeCapped * 1.6)
  const safeFinalSize = Math.max(_sizeMin, Math.min(_sizeMax, _sizeRaw))
  // [Etapa 5] Adaptive sizeMult — aplicat ca ULTIM în lanț, după Level 5 sizing
  // Gated: BM.adaptive.enabled. Clamp explicit min/max.
  const _adaptSizeMult = (BM.adaptive && BM.adaptive.enabled) ? (BM.adaptive.sizeMult || 1.0) : 1.0
  const _adaptSizeRaw = Math.round(safeFinalSize * _adaptSizeMult)
  const adaptFinalSize = Math.max(_sizeMin, Math.min(_sizeMax, _adaptSizeRaw))
  const slPct = _snap.slPct
  // [v105 FIX Bug4] rr citit din _snap (atomic snapshot) — anterior era re-citit din DOM dupa snapshot
  // Daca utilizatorul modifica atRR intre decizie si executie, ordinul ar fi plasat cu parametri diferiti
  const rr = (Number.isFinite(_snap.rr) && _snap.rr > 0) ? _snap.rr : 2 // [v119-p6 FIX1] snapshot-only, NO DOM fallback

  const slDist = entry * slPct / 100
  const tpDist = slDist * rr

  const sl = side === 'LONG' ? entry - slDist : entry + slDist
  const tp = side === 'LONG' ? entry + tpDist : entry - tpDist
  const liq = calcLiqPrice(entry, lev, side)

  // [FIX P8] QTY = notional / price (with leverage), margin = adaptFinalSize (IS the margin)
  const qty = (adaptFinalSize * lev) / entry   // contracts/coins (notional / price)
  const margin = adaptFinalSize                  // adaptFinalSize IS the margin deducted from balance
  const tpPnl = (tpDist / entry) * adaptFinalSize * lev   // $ profit at TP
  const slPnl = -(slDist / entry) * adaptFinalSize * lev  // $ loss at SL (negative)

  // ── EXECUTION FAIL-SAFE ──────────────────────────────────────────
  // Check entry price sanity (slippage guard)
  // [v105 FIX Bug4] slipPct din _snap — consistent cu restul valorilor atomice
  // [v119-p15] eliminat DOM fallback (|| el('atSL')) — _snap.slPct e mereu >= 0.1 (clamped în buildExecSnapshot)
  // [FIX P14] totalTrades++ AFTER all early validation returns (including price check)
  if (!entry || entry <= 0) {
    atLog('warn', '[BLOCK] EXEC FAIL-SAFE: invalid price → PROTECT activated')
    BM.protectMode = true; BM.protectReason = 'BLOCKED: ExecutionRisk (invalid price)'
    if (getATEnabled() && (w.S.mode || 'assist') === 'auto') AT.enabled = false
    const pb = el('protectBanner'); if (pb) pb.className = 'znc-protect show'
    const pbt = el('protectBannerTxt'); if (pbt) pbt.textContent = BM.protectReason
    return
  }
  AT.totalTrades++
  _emitATChanged()
  // [P0.4] Decision log — AT entry (trade placed)
  if (typeof w.DLog !== 'undefined') w.DLog.record('at_entry', { sym: sym, side: side, entry: entry, size: adaptFinalSize, lev: lev, sl: sl, tp: tp, score: cond?.score, fusionMult: _fusionMult, convMult: _convDangerMult, riskPct: riskPct, riskSize: _riskSizeCapped })

  atLog(side === 'LONG' ? 'buy' : 'sell',
    `[EXEC] ${side} ${sym} @$${fP(entry)} | Lev:${lev}x | SL:$${fP(sl)} | TP:$${fP(tp)} | Size:$${safeFinalSize} (risk:${riskPct}%→$${_riskSizeCapped.toFixed(0)} cap:$${size}) | [SH]C:${BM.conviction || 0}% D:${BM.danger || 0}`)

  if (getATMode() === 'demo') {
    const pos: any = {
      id: Date.now() + Math.floor(Math.random() * 1000), side, sym, entry, size: adaptFinalSize, lev,
      tp, sl, liqPrice: liq, pnl: 0,
      slPct: slPct, rr: rr, // [RISK RAILS] stored for add-on SL/TP recalc
      qty, margin, tpPnl, slPnl,
      autoTrade: true, openTs: Date.now(),
      mode: 'demo',
      label: 'AUTO ' + side,
      addOnCount: 0, // [RISK RAILS] add-on counter (phase 1: demo only)
      // [Level 5] sizing debug fields
      sizeBase: size, sizeFinal: adaptFinalSize, sizeMult: _sizeMult,
      // [RISK RAILS] risk-based sizing debug
      riskPct: riskPct, riskSizeRaw: _riskSizeRaw, riskSizeCapped: _riskSizeCapped,
      // [Etapa 5] adaptive sizing debug
      adaptSizeMult: _adaptSizeMult,
      // Per-position control mode metadata
      sourceMode: (w.S.mode || 'assist').toLowerCase(), // [PATCH1] immutable — original source
      controlMode: (w.S.mode || 'assist').toLowerCase(), // mutable — AI or MANUAL
      brainModeAtOpen: (w.S.mode || 'assist').toLowerCase(),
      // [DSL MODE] Snapshot the selected Brain DSL mode at open time so the
      // UI and journal can show WHICH preset (SWING/ATR/DEF/TP/FAST) owned the
      // position — independent of later mode changes (those only apply to new
      // positions, per setDslMode contract).
      dslModeAtOpen: (typeof getDSLMode === 'function' ? getDSLMode() : 'atr'),
      dslParams: Object.assign({
        pivotLeftPct: getTCDslTrailPct(),
        pivotRightPct: getTCDslTrailSusPct(),
        impulseVPct: getTCDslExtendPct(),
      }, typeof calcDslTargetPrice === 'function' ? calcDslTargetPrice(side, entry, tp) : {
        openDslPct: 0.50, dslTargetPrice: side === 'LONG' ? entry * 1.005 : entry * 0.995
      }),
      dslAdaptiveState: 'calm',
      dslHistory: [],
    }
    // [FIX P3] Margin check — reject if insufficient balance (check matches deduction)
    if (TP.demoBalance < adaptFinalSize) {
      AT.totalTrades--
      _setBR('MARGIN', 'Margin insuficient: need $' + adaptFinalSize.toFixed(2) + ' have $' + TP.demoBalance.toFixed(2), 'placeAutoTrade')
      atLog('warn', '[BLOCK] MARGIN REJECT: need $' + adaptFinalSize.toFixed(2) + ' but demoBalance=$' + TP.demoBalance.toFixed(2))
      return
    }
    if (!Array.isArray(TP.demoPositions)) TP.demoPositions = []
    if (TP.demoPositions.some((p: any) => p.id === pos.id)) { atLog('warn', '[DEDUP] Position ' + pos.id + ' already exists'); return }
    TP.demoPositions.push(pos)
    try { window.dispatchEvent(new CustomEvent('zeus:positionsChanged')) } catch (_) {}
    AT.lastTradeSide = side
    AT.lastTradeTs = Date.now()
    if (!AT._cooldownBySymbol) AT._cooldownBySymbol = {}
    AT._cooldownBySymbol[sym] = Date.now()
    TP.demoBalance -= adaptFinalSize
    w.updateDemoBalance()
    renderDemoPositions()
    renderATPositions()
    onPositionOpened(pos, 'auto_demo')  // 3: DSL attach for auto-trade positions
    w.srLinkTrade(pos)  // [SR] leagă cel mai recent semnal de această poziţie
    aubBBSnapshot('TRADE_OPEN', { sym: pos.sym, side: pos.side, entry: pos.entry, size: pos.size, lev: pos.lev, score: (typeof BM !== 'undefined' ? BM.entryScore : 0) })
    addTradeToJournal({
      time: fmtNow(),
      side, sym: sym.replace('USDT', ''),
      entry, exit: null, pnl: 0, reason: 'AUTO — Score:' + cond.score, lev,
      // [Etapa 4] Journal Context — salvat la OPEN (citit de Etapa 5 doar dacă journalEvent==='CLOSE')
      journalEvent: 'OPEN',
      regime: BM.regime || BM.structure?.regime || '—',
      alignmentScore: BM.structure?.score ?? null,
      volRegime: BM.volRegime || '—',
      profile: w.S.profile || 'fast',
    })
    _atUI({ status: { icon: 'ok', text: String(side) + ' opened @$' + fP(entry), action: null } })
    toast(`AUTO ${side} ${sym.replace('USDT', '')} opened! SL:$${fP(sl)} TP:$${fP(tp)}`, 0, _ZI.robot)
    w.ncAdd('info', 'trade', `AUTO ${side} ${sym.replace('USDT', '')} @$${fP(entry)} | SL:$${fP(sl)} TP:$${fP(tp)}`)  // [NC]
    playEntrySound()  // [BUG5.1] sound on AT/manual demo entry (gated by SOUND READY)
    if (typeof onTradeExecuted === 'function') onTradeExecuted({ ...pos, score: cond?.score || BM?.entryScore || 0 })
    scheduleAutoClose(pos)
    w.ZState.scheduleSave()  // persist new position
    if (typeof renderTradeMarkers === 'function') renderTradeMarkers()  // [CHART MARKERS]
  } else {
    if (!TP.liveConnected) {
      atLog('warn', '[FAIL] LIVE: API disconnected! Connect it in the LIVE TRADING panel.')
      toast('API disconnected — auto-trade cancelled', 0, _ZI.x)
      AT.totalTrades--
      return
    }
    // ─── LIVE EXECUTION via backend API ───
    AT._liveExecInFlight = true // [FIX C5] guard against concurrent live exec
    ;(async function _liveExec() {
      let _livePosPushed = false // [PATCH2 B2] track if position was added to array
      // [FIX R10] Declare pos outside try so catch block can access it
      let pos: any = null
      try {
        // Set leverage first (best-effort — some exchanges reject if already set)
        try { await liveApiSetLeverage(sym, lev) } catch (_levErr: any) {
          atLog('warn', '[WARN] Leverage set failed (may already be set): ' + (_levErr.message || _levErr))
        }
        // Place MARKET order through backend proxy → Binance Testnet
        // [FIX P2] quantity must include leverage: (margin × lev) / price = notional / price
        const result = await liveApiPlaceOrder({
          symbol: sym,
          side: side === 'LONG' ? 'BUY' : 'SELL',
          type: 'MARKET',
          quantity: String((adaptFinalSize * lev) / entry),
          referencePrice: entry,
        })
        // Build position from exchange response
        const fillPrice = parseFloat(result.avgPrice) || entry
        // [FIX A1] Recalculate SL/TP from actual fill price, not pre-fill entry
        const _liveSlDist = fillPrice * slPct / 100
        const _liveTpDist = _liveSlDist * rr
        const _liveSL = side === 'LONG' ? fillPrice - _liveSlDist : fillPrice + _liveSlDist
        const _liveTP = side === 'LONG' ? fillPrice + _liveTpDist : fillPrice - _liveTpDist
        const _liveLiq = calcLiqPrice(fillPrice, lev, side)
        pos = {
          id: result.orderId || Date.now(),
          orderId: result.orderId,
          side: side,
          sym: sym,
          entry: fillPrice,
          size: adaptFinalSize,
          lev: lev,
          tp: _liveTP,
          sl: _liveSL,
          liqPrice: _liveLiq,
          pnl: 0,
          qty: parseFloat(result.executedQty) || (adaptFinalSize / fillPrice),
          margin: adaptFinalSize, // [FIX BUG3] Consistent with demo — margin = notional size (not divided by lev)
          tpPnl: (_liveTpDist / fillPrice) * adaptFinalSize * lev,
          slPnl: -(_liveSlDist / fillPrice) * adaptFinalSize * lev,
          autoTrade: true,
          isLive: true,
          mode: 'live',
          status: 'open', // [PATCH2 B3] explicit lifecycle status
          label: 'LIVE AUTO ' + side,
          // Per-position control mode metadata
          sourceMode: (w.S.mode || 'assist').toLowerCase(), // [PATCH1] immutable — original source
          controlMode: (w.S.mode || 'assist').toLowerCase(), // mutable — AI or MANUAL
          brainModeAtOpen: (w.S.mode || 'assist').toLowerCase(),
          // [DSL MODE] See demo branch above — snapshot selected DSL mode.
          dslModeAtOpen: (typeof getDSLMode === 'function' ? getDSLMode() : 'atr'),
          dslParams: Object.assign({
            pivotLeftPct: getTCDslTrailPct(),
            pivotRightPct: getTCDslTrailSusPct(),
            impulseVPct: getTCDslExtendPct(),
          }, typeof calcDslTargetPrice === 'function' ? calcDslTargetPrice(side, fillPrice, _liveTP) : {
            openDslPct: 0.50, dslTargetPrice: side === 'LONG' ? fillPrice * 1.005 : fillPrice * 0.995
          }),
          dslAdaptiveState: 'calm',
          dslHistory: [],
        }
        if (!Array.isArray(TP.livePositions)) TP.livePositions = []
        TP.livePositions.push(pos)
        try { window.dispatchEvent(new CustomEvent('zeus:positionsChanged')) } catch (_) {}
        _livePosPushed = true // [PATCH2 B2] mark: position now in array
        TP.liveBalance -= adaptFinalSize // [FIX BUG2] Optimistic balance deduction prevents duplicate trades
        AT.lastTradeSide = side
        AT.lastTradeTs = Date.now()
        if (!AT._cooldownBySymbol) AT._cooldownBySymbol = {}
        AT._cooldownBySymbol[sym] = Date.now()
        renderLivePositions()
        atLog('buy', '[LIVE] LIVE ORDER FILLED: ' + side + ' ' + sym + ' @$' + fP(fillPrice) + ' qty:' + pos.qty + ' orderId:' + pos.orderId)
        toast('LIVE ' + side + ' ' + sym.replace('USDT', '') + ' FILLED @$' + fP(fillPrice), 0, _ZI.dRed)
        w.ncAdd('info', 'trade', 'LIVE ' + side + ' ' + sym.replace('USDT', '') + ' @$' + fP(fillPrice) + ' | SL:$' + fP(_liveSL) + ' TP:$' + fP(_liveTP))
        playEntrySound()  // [BUG5.1] sound on AT/manual live entry (gated by SOUND READY)
        scheduleAutoClose(pos)
        // [FIX QA-H2 + R4] Place exchange-level SL/TP with retry logic
        // If both SL and TP fail after retries, mark position as UNPROTECTED
        let _slOk = false, _tpOk = false
        for (let _slRetry = 0; _slRetry < 3 && !_slOk; _slRetry++) {
          try {
            await atSetStopLoss({ symbol: sym, side: side === 'LONG' ? 'BUY' : 'SELL', quantity: String(pos.qty), stopPrice: _liveSL })
            _slOk = true
            atLog('info', '[OK] LIVE SL set @$' + fP(_liveSL))
          } catch (_slErr: any) {
            atLog('warn', '[WARN] LIVE SL attempt ' + (_slRetry + 1) + '/3 failed: ' + (_slErr.message || _slErr))
            if (_slRetry < 2) await new Promise(r => setTimeout(r, 1000))
          }
        }
        for (let _tpRetry = 0; _tpRetry < 3 && !_tpOk; _tpRetry++) {
          try {
            await atSetTakeProfit({ symbol: sym, side: side === 'LONG' ? 'BUY' : 'SELL', quantity: String(pos.qty), stopPrice: _liveTP })
            _tpOk = true
            atLog('info', '[OK] LIVE TP set @$' + fP(_liveTP))
          } catch (_tpErr: any) {
            atLog('warn', '[WARN] LIVE TP attempt ' + (_tpRetry + 1) + '/3 failed: ' + (_tpErr.message || _tpErr))
            if (_tpRetry < 2) await new Promise(r => setTimeout(r, 1000))
          }
        }
        // [FIX R4] If protection failed, flag position and alert user
        if (!_slOk || !_tpOk) {
          pos._unprotected = true
          pos._unprotectedReason = (!_slOk && !_tpOk) ? 'SL+TP failed' : !_slOk ? 'SL failed' : 'TP failed'
          atLog('warn', '[ALERT] LIVE POSITION UNPROTECTED: ' + pos._unprotectedReason + ' for ' + sym + ' after 3 retries each')
          w.ncAdd('critical', 'alert', 'UNPROTECTED LIVE: ' + sym + ' ' + side + ' — ' + pos._unprotectedReason + '. Check exchange manually!')
          toast(sym + ' UNPROTECTED — ' + pos._unprotectedReason, 0, _ZI.siren)
        }
        // [FIX C4] Persist live position to local state immediately after push
        w.ZState.save()
        // Sync balance after trade
        try { await liveApiSyncState() } catch (err: any) { console.warn('[AT] Post-trade sync failed:', err && err.message || err) }
      } catch (err: any) {
        AT.totalTrades--
        // [PATCH2 B2] If position was pushed but post-processing failed, remove zombie
        if (_livePosPushed) {
          const _zIdx = TP.livePositions.findIndex((p: any) => p.orderId && p.orderId === err?._orderId)
          // BUG-09 FIX: Fallback matches by the specific position ID, not just symbol
          // [FIX AT-J1] Guard against pos being null if error thrown before pos assignment
          const _zIdx2 = _zIdx >= 0 ? _zIdx : (pos ? TP.livePositions.findIndex((p: any) => p.id === pos.id) : -1)
          if (_zIdx2 >= 0) {
            TP.livePositions.splice(_zIdx2, 1)
            atLog('warn', '[CLEAN] ZOMBIE CLEANUP: removed orphan live position for ' + sym)
          }
          renderLivePositions()
        }
        atLog('warn', '[FAIL] LIVE ORDER FAILED: ' + (err.message || err))
      } finally {
        AT._liveExecInFlight = false // [FIX C5] release guard
      }
    })()
  }
  updateATStats()
}

// ── RISK RAILS: ADD-ON INFRASTRUCTURE (Batch B — server-authoritative) ────
// canAddOn(pos) — lightweight client gate for UI (server does final validation)
export function canAddOn(pos: any): any {
  if (!pos || pos.closed || !pos.autoTrade) return false
  // [Batch B] Removed demo-only gate — server decides mode eligibility
  const maxAddon = parseInt(el('atMaxAddon')?.value || '') || 3
  if ((pos.addOnCount || 0) >= maxAddon) return false
  // Must be in profit to add on (UI hint — server re-validates)
  const curPrice = (true) ? getSymPrice(pos) : getPrice()
  if (!curPrice || curPrice <= 0) return false
  const diff = curPrice - pos.entry
  const inProfit = pos.side === 'LONG' ? diff > 0 : diff < 0
  if (!inProfit) return false
  // [Batch B] Removed balance check — server validates balance
  return true
}

// openAddOn(posId) — [Batch B] RPC to server POST /api/addon
export function openAddOn(posId: any): any {
  const posList = ([] as any[]).concat(TP.demoPositions || [], TP.livePositions || [])
  const pos = posList.find((p: any) => p.id === posId)
  if (!pos) {
    atLog('warn', '[ADD-ON] Position not found: ' + posId)
    return Promise.resolve(false)
  }
  if (!canAddOn(pos)) {
    atLog('warn', '[ADD-ON] Cannot add-on to position ' + posId)
    return Promise.resolve(false)
  }
  const seq = pos._serverSeq || pos.id
  const maxAddon = parseInt(el('atMaxAddon')?.value || '') || 3
  atLog('info', '[ADD-ON] Requesting server add-on for seq=' + seq + '...')
  return api.raw<any>('POST', '/api/addon', { seq: seq, maxAddon: maxAddon })
    .then(function (j: any) {
      if (j.ok) {
        atLog('buy', '[ADD-ON #' + j.addOnCount + '] ' + (pos.side || '') + ' ' + (pos.sym || '') +
          ' +$' + (j.addOnSize || 0) + ' @$' + (j.price || 0).toFixed(2) +
          ' | New entry:$' + (j.newEntry || 0).toFixed(2) + ' | Total:$' + (j.newSize || 0))
        // Server broadcasts via WS → _applyServerATState updates client state
        // Force re-render in case WS is slightly delayed
        setTimeout(function () {
          renderATPositions()
          if (typeof w.updateDemoBalance === 'function') w.updateDemoBalance()
        }, 300)
        return true
      } else {
        atLog('warn', '[ADD-ON] Server rejected: ' + (j.error || 'unknown'))
        toast('Add-on rejected: ' + (j.error || 'unknown'), 0, '⚠️')
        return false
      }
    })
    .catch(function (err: any) {
      atLog('warn', '[ADD-ON] Network error: ' + (err.message || err))
      toast('Add-on failed: network error', 0, '⚠️')
      return false
    })
}
// openAddOn — self-ref removed (direct call)

// ─── AUTO-CLOSE MONITOR ────────────────────────────────────────

// Auto-close monitor
export function scheduleAutoClose(pos: any): void {
  // [AT-UNIFY] Server monitors SL/TP/DSL exits
  if (w._serverATEnabled) return
  function getPosPrice(): any {
    // BUG2 FIX: use allPrices (works for any symbol, live or demo)
    if (w.allPrices[pos.sym] && w.allPrices[pos.sym] > 0) return w.allPrices[pos.sym]
    if (pos.sym === getSymbol() || !pos.sym) return getPrice()
    // [v105 FIX Bug3] Verifica freshness wlPrices — nu folosi pret stale pentru SL/TP
    const wlEntry = w.wlPrices[pos.sym] || w.wlPrices[pos.sym + 'USDT']
    if (wlEntry?.price && wlEntry.price > 0) {
      const age = wlEntry.ts ? (Date.now() - wlEntry.ts) : 0
      if (age < 30000) return wlEntry.price
      console.warn('[getPosPrice] Stale WS price for', pos.sym, '— skip SL/TP check')
      return null
    }
    return null
  }

  // [v119-p18] TTP — Trailing Take Profit (watch-only → live-ready)
  // Init la launch — nu persistat, nu rehydratat (resetat automat la fiecare scheduleAutoClose)
  pos.ttpPeak = null  // cel mai bun pret atins de la open
  pos.ttpPeakTs = 0     // timestamp peak — pentru log peakAge
  pos.ttpActive = false // true dupa armare completa
  pos.ttpArmTs = 0     // timestamp cand profit a depasit pragul (anti-flicker)
  pos.ttpArmProfit = 0     // profitPct la momentul armarii — black-box diagnostic
  pos.ttpCoolTick = 0     // tick-counter cooldown dupa armare (anti-wick)

  // Configurare TTP — suprascris din window.WVE_CONFIG.ttp daca exista
  const TTP_CFG = Object.assign({
    armPct: 0.008,
    trailPct: 0.003,
    armHoldMs: 20000,
    coolTicks: 2,
    watchOnly: true,
  }, (w.WVE_CONFIG && w.WVE_CONFIG.ttp) || {})

  const _posKey = 'posCheck_' + pos.id
  w.Intervals.set(_posKey, () => {
    if (pos.closed) { w.Intervals.clear(_posKey); return }
    const cur = getPosPrice()
    if (!cur) { return }

    const effectiveSL = (getDSLEnabled() && getDSLPositions()[String(pos.id)]?.active)
      ? getDSLPositions()[String(pos.id)].currentSL : pos.sl

    // Ordinea: TP -> SL/DSL -> LIQ -> TTP
    let reason: any = null
    if (pos.side === 'LONG') {
      if (cur >= pos.tp) reason = 'TP \u2705'
      else if (cur <= effectiveSL) reason = getDSLPositions()[String(pos.id)]?.active ? '\uD83C\uDFAF DSL HIT \uD83D\uDED1' : 'SL \uD83D\uDED1'
      else if (cur <= pos.liqPrice) reason = '\uD83D\uDC80 LIQ'
    } else {
      if (cur <= pos.tp) reason = 'TP \u2705'
      else if (cur >= effectiveSL) reason = getDSLPositions()[String(pos.id)]?.active ? '\uD83C\uDFAF DSL HIT \uD83D\uDED1' : 'SL \uD83D\uDED1'
      else if (cur >= pos.liqPrice) reason = '\uD83D\uDC80 LIQ'
    }

    // [v119-p18] TTP — ruleaza DOAR daca TP/SL/LIQ nu au decis deja
    if (!reason) {
      try {
        const now = Date.now()
        const origTP = getDSLPositions()[String(pos.id)]?.originalTP
        const tpManual = (origTP != null && Math.abs(pos.tp - origTP) > 0.01)

        if (!tpManual && pos.entry && cur && Number.isFinite(cur)) {
          const profitPct = pos.side === 'LONG'
            ? (cur - pos.entry) / pos.entry
            : (pos.entry - cur) / pos.entry

          // Peak tracking separat pe side
          if (pos.side === 'LONG') {
            if (pos.ttpPeak === null || cur > pos.ttpPeak) { pos.ttpPeak = cur; pos.ttpPeakTs = now }
          } else {
            if (pos.ttpPeak === null || cur < pos.ttpPeak) { pos.ttpPeak = cur; pos.ttpPeakTs = now }
          }

          // Armare cu anti-flicker
          if (!pos.ttpActive) {
            if (profitPct >= TTP_CFG.armPct) {
              if (!pos.ttpArmTs) pos.ttpArmTs = now
              if ((now - pos.ttpArmTs) >= TTP_CFG.armHoldMs) {
                pos.ttpActive = true; pos.ttpArmProfit = profitPct; pos.ttpCoolTick = 0
                if (typeof w.ZLOG !== 'undefined')
                  w.ZLOG.push('INFO', '[TTP] ARMED pos#' + pos.id + ' side=' + pos.side +
                    ' profitAtArm=' + (profitPct * 100).toFixed(2) + '%' +
                    ' peak=' + pos.ttpPeak?.toFixed(2) + ' heldMs=' + (now - pos.ttpArmTs))
              }
            } else {
              // Sync reset — nicio fantoma
              pos.ttpArmTs = 0; pos.ttpPeak = null; pos.ttpPeakTs = 0; pos.ttpArmProfit = 0
            }
          }

          // Cooldown dupa armare
          if (pos.ttpActive) {
            if (pos.ttpCoolTick < TTP_CFG.coolTicks) {
              pos.ttpCoolTick++
            } else if (pos.ttpPeak !== null) {
              const retracePct = pos.side === 'LONG'
                ? (pos.ttpPeak - cur) / pos.ttpPeak
                : (cur - pos.ttpPeak) / pos.ttpPeak

              if (retracePct >= TTP_CFG.trailPct) {
                const peakAgeMs = pos.ttpPeakTs ? (now - pos.ttpPeakTs) : 0
                const armedForMs = pos.ttpArmTs ? (now - pos.ttpArmTs) : 0
                const profitAtPeak = pos.side === 'LONG'
                  ? (pos.ttpPeak - pos.entry) / pos.entry
                  : (pos.entry - pos.ttpPeak) / pos.entry

                if (TTP_CFG.watchOnly) {
                  if (typeof w.ZLOG !== 'undefined')
                    w.ZLOG.push('WARN', '[TTP WOULD CLOSE] pos#' + pos.id +
                      ' side=' + pos.side +
                      ' entry=' + pos.entry?.toFixed(2) +
                      ' peak=' + pos.ttpPeak?.toFixed(2) +
                      ' peakAgeMs=' + peakAgeMs +
                      ' cur=' + cur?.toFixed(2) +
                      ' retrace=' + (retracePct * 100).toFixed(2) + '%' +
                      ' profitNow=' + (profitPct * 100).toFixed(2) + '%' +
                      ' profitAtPeak=' + (profitAtPeak * 100).toFixed(2) + '%' +
                      ' profitAtArm=' + (pos.ttpArmProfit * 100).toFixed(2) + '%' +
                      ' armedForMs=' + armedForMs)
                  pos.ttpPeak = cur; pos.ttpPeakTs = now
                } else {
                  if (!pos.closed) reason = 'TTP HIT'
                }
              }
            }
          }
        }
      } catch (ttpErr: any) {
        try { console.warn('[TTP]', ttpErr && ttpErr.message ? ttpErr.message : ttpErr) } catch (_) { }
      }
    }

    if (reason) {
      w.Intervals.clear(_posKey) // [v105 FIX Bug5] Intervals.clear — sincronizat cu harta interna, evita intervale orfane
      // Guard: daca pozitia a fost deja inchisa manual, oprim doar intervalul
      if (pos.closed) return
      if (reason.includes('DSL HIT') && typeof w.ZLOG !== 'undefined') w.ZLOG.push('AT', '[DSL CLOSE TRIGGER] ' + pos.sym + ' ' + pos.side + ' posId=' + pos.id)

      // ─── LIVE vs DEMO branch ───
      if (pos.isLive) {
        // LIVE: verify position still exists in livePositions
        const liveIdx = Array.isArray(TP.livePositions) ? TP.livePositions.findIndex((p: any) => p.id === pos.id) : -1
        if (liveIdx < 0 || TP.livePositions[liveIdx].closed) {
          if (liveIdx >= 0) TP.livePositions.splice(liveIdx, 1)
          setTimeout(function () { renderLivePositions(); renderATPositions() }, 0)
          return
        }
        const cur2 = getPosPrice()
        if (!cur2) return // stale price — skip this tick, interval will retry
        const diff2 = cur2 - pos.entry
        const pnl2 = _safePnl(pos.side, diff2, pos.entry, pos.size || 0, pos.lev || 1, true)

        // [PATCH P1-3] Guard: if already closing, skip this tick
        if (pos.status === 'closing') return
        pos.status = 'closing'

        // Close live position via backend
        closeLivePos(pos.id, 'AUTO ' + reason)

        // AT stats — live close accounting done here (closeLivePos does NOT do AT stats)
        AT.totalPnL += pnl2; AT.dailyPnL += pnl2
        if (Number.isFinite(pnl2)) { AT.realizedDailyPnL += pnl2; AT.closedTradesToday++ }
        const won2 = pnl2 >= 0
        if (won2) AT.wins++; else AT.losses++

        const pnlStr = (pnl2 >= 0 ? '+' : '') + '$' + pnl2.toFixed(2)
        atLog(pnl2 >= 0 ? 'buy' : 'sell', '[LIVE] ' + reason + ' — PnL: ' + pnlStr + ' | Close @$' + fP(cur2))
        setTimeout(function () { updateATStats() }, 50)
        if (w.S.alerts?.enabled) sendAlert('Zeus LIVE Auto Trade ' + reason, pos.side + ' ' + pos.sym + ' PnL: ' + pnlStr, 'auto')
      } else {
        // DEMO: original logic (unchanged)
        // Verifica si daca pozitia exista inca in array (poate a fost inchisa manual din UI)
        // FIX CRITIC: Daca pozitia nu mai exista sau e closed, sterge din array si oprim
        const posIdx2 = TP.demoPositions.findIndex((p: any) => p.id === pos.id)
        if (posIdx2 < 0 || TP.demoPositions[posIdx2].closed) {
          // Pozitia deja inchisa manual - sterge din array daca mai e acolo
          if (posIdx2 >= 0) TP.demoPositions.splice(posIdx2, 1)
          setTimeout(() => { w.updateDemoBalance(); renderDemoPositions(); renderATPositions() }, 0)
          return
        }

        const cur2 = getPosPrice()
        if (!cur2) return // stale price — skip this tick, interval will retry
        const diff2 = cur2 - pos.entry
        const pnl2 = _safePnl(pos.side, diff2, pos.entry, pos.size || 0, pos.lev || 1, true)

        // Inchidem pozitia — closeDemoPos handles AT.realizedDailyPnL + closedTradesToday
        closeDemoPos(pos.id, 'AUTO ' + reason)

        // [FIX BUG4] Use closeDemoPos PnL if available (prevents price-race drift)
        const _finalPnl2 = Number.isFinite(pos._closePnl) ? pos._closePnl : pnl2
        // [PATCH P0-2] Removed duplicate AT stat accounting — closeDemoPos is single source of truth
        // Only keep AT.totalPnL and AT.dailyPnL (NOT tracked by closeDemoPos)
        AT.totalPnL += _finalPnl2; AT.dailyPnL += _finalPnl2
        const won2 = _finalPnl2 >= 0
        if (won2) AT.wins++; else AT.losses++

        if (typeof w.recordAllIndicators === 'function') w.recordAllIndicators(pos, won2) // BUG6 FIX: all indicators from signalData
        const tradeNow = new Date()
        const dayNms = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
        const tDay = dayNms[tradeNow.getUTCDay()]
        const tHour = tradeNow.getUTCHours()
        if (w.DHF.days[tDay]) { w.DHF.days[tDay].trades++; if (won2) w.DHF.days[tDay].wins++; w.DHF.days[tDay].wr = Math.round(w.DHF.days[tDay].wins / w.DHF.days[tDay].trades * 100) }
        if (w.DHF.hours[tHour] !== undefined) { w.DHF.hours[tHour].trades++; if (won2) w.DHF.hours[tHour].wins++; w.DHF.hours[tHour].wr = Math.round(w.DHF.hours[tHour].wins / w.DHF.hours[tHour].trades * 100) }
        setTimeout(renderDHF, 500)

        const pnlStr = (pnl2 >= 0 ? '+' : '') + '$' + pnl2.toFixed(2)
        atLog(pnl2 >= 0 ? 'buy' : 'sell', reason + ' — PnL: ' + pnlStr + ' | Close @$' + fP(cur2))
        setTimeout(() => updateATStats(), 50)
        if (w.S.alerts?.enabled) sendAlert(`Zeus Auto Trade ${reason}`, `${pos.side} ${pos.sym} PnL: ${pnlStr}`, 'auto')
      } // end DEMO branch
    }
  }, 3000)  // [P2-2] 3s polling for responsive SL/TP detection

  // BUG-08 FIX: Removed 24h forced timeout — positions stay monitored indefinitely
  // Interval self-clears when pos.closed is detected
}

// ─── KILL SWITCH ───────────────────────────────────────────────

// ── KILL SWITCH FAST-PATH — call after any PnL update ────────────

// Kill switch
export function checkKillThreshold(): void {
  if (getATKillTriggered()) return
  // [KILL-LOOP FIX R4] Defer kill check until server confirms AT state.
  // Prevents firing on boot while TP.demoPositions still has zombie AT positions
  // from localStorage that haven't been reconciled with server's open-position list.
  if (!AT._modeConfirmed) return
  const killPct = parseFloat(el('atKillPct')?.value || '') || 5
  const bal = +(getATMode() === 'demo' ? TP.demoBalance : TP.liveBalance) || 0
  if (bal <= 0) return // [FIX BUG4] Skip kill check if balance unknown — prevents $10k fallback distortion
  const _realPnL = +(getATDailyPnL()) || 0
  // [PATCH3 R2] Include unrealized PnL from open positions in daily loss check
  // [KILL-LOOP FIX] Only AT positions count toward AT kill — manual/zombie positions
  // from stale localStorage must not trigger AT kill switch
  let _unrealPnL = 0
  const _openList = getATMode() === 'demo' ? (TP.demoPositions || []) : (TP.livePositions || [])
  for (let i = 0; i < _openList.length; i++) {
    const _p = _openList[i]
    if (_p.closed || _p.status === 'closing') continue
    if (!_p.autoTrade) continue
    // [KILL-LOOP FIX R4] Only server-confirmed AT positions count toward kill.
    // Unconfirmed positions may be localStorage zombies still pending prune.
    if (!_p._serverSeq) continue
    // [KILL-LOOP FIX R6] Daily kill = loss from positions opened TODAY only.
    // Old open positions (from previous days/sessions) have their unrealized PnL
    // tracked elsewhere (Total PnL banner) but they are NOT today's loss — they
    // would retrigger kill infinitely right after user resets. Cutoff is the
    // later of: start-of-day (UTC), last kill reset, and explicit AT.enabledAt.
    const _openTs = +(_p.ts || _p.openTs || 0)
    const _dayStart = new Date(); _dayStart.setUTCHours(0, 0, 0, 0)
    const _cutoff = Math.max(_dayStart.getTime(), +(AT.killResetTs || 0), +(AT.enabledAt || 0))
    if (_openTs > 0 && _openTs < _cutoff) continue
    const _cur = getSymPrice(_p)
    if (_cur != null && _cur > 0 && _p.entry > 0) {
      // [PATCH P1-6] Use _safePnl for consistency with closeDemoPos/triggerKillSwitch
      const _diff = _cur - _p.entry
      _unrealPnL += _safePnl(_p.side, _diff, _p.entry, _p.size || 0, _p.lev || 1, true)
    }
  }
  const _totalDayPnL = _realPnL + _unrealPnL
  // Guard: need at least one closed trade OR significant unrealized loss
  if (getATClosedToday() === 0 && _unrealPnL >= 0) return
  if (Number.isFinite(_totalDayPnL) && _totalDayPnL < 0 && Math.abs(_totalDayPnL) / bal * 100 >= killPct) {
    triggerKillSwitch('daily_loss', _totalDayPnL, getATClosedToday(), killPct, bal)
  }
}

export function triggerKillSwitch(reason: any, realPnL: any, closedCount2: any, killPct2: any, bal2: any): void {
  // [FIX v85 BUG8] Guard complet: dacă deja triggered, nu mai facem nimic (previne race condition)
  if (getATKillTriggered()) return
  AT.killTriggered = true // setăm imediat, înainte de orice operațiune async
  AT._killTriggeredTs = Date.now() // [P3-5] timestamp for reset cooldown
  // [P0.4] Decision log — kill switch
  if (typeof w.DLog !== 'undefined') w.DLog.record('kill_switch', { reason: reason, pnl: realPnL, trades: closedCount2, killPct: killPct2, bal: bal2 })
  // Log exact values for kill switch
  if (reason === 'daily_loss') {
    atLog('kill', `[KILL] KILL SWITCH: Daily loss ${(+(realPnL) || 0).toFixed(2)}$ >= ${(+(killPct2) || 5).toFixed(1)}% of $${(+(bal2) || 10000).toFixed(0)} | ${+(closedCount2) || 0} trades`)
  }

  AT.enabled = false
  AT.killTriggered = true
  w.Intervals.clear('atCheck'); clearInterval(AT.interval ?? undefined); AT.interval = null

  // Inchidem toate pozitiile auto cu PnL corect
  let closedCount = 0
  let totalEmergencyPnL = 0
  TP.demoPositions = TP.demoPositions.filter((p: any) => {
    if (!p.autoTrade) return true
    if (p.closed) return false
    p.closed = true
    const closePrice = getSymPrice(p)
    if (closePrice == null) return false
    const diff = closePrice - p.entry
    const pnl = _safePnl(p.side, diff, p.entry, p.size, p.lev, true)
    totalEmergencyPnL += pnl
    TP.demoBalance += p.size + pnl
    AT.totalPnL += pnl; AT.dailyPnL += pnl
    if (pnl >= 0) AT.wins++; else AT.losses++
    if (getDSLObject()?.positions?.[p.id]) delete getDSLObject().positions[p.id]
    if (getDSLObject()?._attachedIds) getDSLObject()?._attachedIds.delete(String(p.id))  // 4: cleanup dedupe on close
    addTradeToJournal({
      id: p.id, // [FIX v85.1 F4] necesar pentru closedPosIds la restore
      time: fmtNow(),
      side: p.side, sym: p.sym,
      entry: p.entry, exit: closePrice, size: p.size, pnl,
      reason: 'Emergency Stop', lev: p.lev,
      // [Etapa 4] Journal Context — salvat la CLOSE pentru Historical Regime Memory
      journalEvent: 'CLOSE',
      regime: BM.regime || BM.structure?.regime || '—',
      alignmentScore: BM.structure?.score ?? null,
      volRegime: BM.volRegime || '—',
      profile: w.S.profile || 'fast',
      openTs: p.openTs || p.id,
      closedAt: Date.now(),
      mode: p.mode || ((typeof AT !== 'undefined' && AT._serverMode) || 'demo'),
    })
    closedCount++
    // [FIX C4] Fire side-effects skipped by inline close
    if (typeof _bmPostClose === 'function') _bmPostClose(p, 'Emergency Stop')
    if (typeof w.srUpdateOutcome === 'function') w.srUpdateOutcome(p, pnl)
    if (typeof runPostMortem === 'function') setTimeout(function () { runPostMortem(p, pnl, closePrice) }, 200)
    if (Array.isArray(w._demoCloseHooks)) { var _hp = p, _hpnl = pnl; w._demoCloseHooks.forEach(function (fn: any) { try { fn(_hp, _hpnl, 'Emergency Stop') } catch (_) { } }) }
    return false
  })
  // [PATCH P0-1] Close live positions too (kill switch must cover both modes)
  // [B2] Use server-authoritative mode — AT._serverMode is set by server sync, AT.mode can be stale
  if (AT._serverMode === 'live' && Array.isArray(TP.livePositions)) {
    var _liveAT = TP.livePositions.filter(function (p: any) { return p.autoTrade && !p.closed && p.status !== 'closing' })
    for (var _li = 0; _li < _liveAT.length; _li++) {
      closeLivePos(_liveAT[_li].id, 'Emergency Stop')
      closedCount++
    }
  }
  setTimeout(() => { w.updateDemoBalance(); renderDemoPositions(); renderATPositions(); updateATStats() }, 0)
  w.ZState.save()  // immediate save on kill switch (not debounced)

  const reasonMap: any = { manual: 'Manual stop', daily_loss: 'Daily loss limit reached' }
  const msg = reasonMap[reason] || reason
  const pnlStr = (totalEmergencyPnL >= 0 ? '+' : '') + '$' + totalEmergencyPnL.toFixed(2)
  const _lossStr = (reason === 'daily_loss' && Number.isFinite(+realPnL)) ? ` (loss $${(+realPnL).toFixed(2)} / ${(+(killPct2) || 5).toFixed(1)}% of $${(+(bal2) || 0).toFixed(0)})` : ''
  _atUI({ btnClass: 'at-main-btn off', btnText: 'AUTO TRADE OFF', killBtnTriggered: true, status: { icon: 'siren', text: `KILL ACTIVE${_lossStr}`, action: 'resetKill' } })
  atLog('kill', `[KILL] KILL SWITCH: ${msg} — ${closedCount} positions closed | PnL: ${pnlStr}`)
  toast(closedCount + ' positions closed | PnL: ' + pnlStr, 0, _ZI.siren)
  if (w.S.alerts?.enabled) sendAlert('Zeus Kill Switch', msg, 'kill')
  // [FIX UI] Update banners immediately after kill trigger
  if (typeof w.atUpdateBanner === 'function') w.atUpdateBanner()
  if (typeof w.ptUpdateBanner === 'function') w.ptUpdateBanner()
  _emitATChanged()
  // [9A-5] Notify React — positions mass-closed by kill switch
  try { window.dispatchEvent(new CustomEvent('zeus:positionsChanged')) } catch (_) {}
}

// Reset kill switch — server is authoritative (5min cooldown enforced there)
export function resetKillSwitch(): void {
  var _bal = +(getATMode() === 'demo' ? TP.demoBalance : (TP.liveBalance || TP.demoBalance)) || 0
  _atUI({ status: { icon: 'timer', text: 'Resetting kill switch...', action: null } })
  api.raw<any>('POST', '/api/at/kill/reset', { balanceRef: _bal })
    .then(function (j: any) {
      if (j && j.ok) {
        AT.killTriggered = false
        AT._killTriggeredTs = 0
        AT.killResetTs = Date.now()
        AT.realizedDailyPnL = 0
        AT.closedTradesToday = 0
        AT.dailyPnL = 0
        AT.enabled = false
        // [KILL-LOOP FIX R5] Reset enabledAt — old positions won't count after next enable.
        AT.enabledAt = Date.now()
        var _killPct = j.killPct || parseFloat((document.getElementById('atKillPct') as HTMLInputElement)?.value) || 5
        _atUI({ killBtnTriggered: false, status: { icon: 'bolt', text: 'Kill switch reset \u2014 re-armed at ' + _killPct + '% loss threshold', action: null } })
        atLog('info', '[OK] Kill switch reset — re-armed at ' + _killPct + '%')
        toast('Kill switch reset — re-armed at ' + _killPct + '%', 0, _ZI.ok)
        if (typeof w.ZState !== 'undefined') w.ZState.save()
        w.atUpdateBanner(); w.ptUpdateBanner()
        _emitATChanged()
      } else {
        var _err = (j && j.error) || 'unknown error'
        atLog('warn', '[WARN] Server rejected reset: ' + _err)
        toast('Cannot reset: ' + _err, 0, _ZI.timer)
        w.atUpdateBanner()
      }
    })
    .catch(function () {
      atLog('warn', '[WARN] Server kill reset network error')
      toast('Reset failed — network error', 0, _ZI.timer)
      w.atUpdateBanner()
    })
}


// Render AT positions — [PERF] throttled to 500ms min interval
var _lastRenderAT = 0, _pendingRenderAT: any = 0
export function renderATPositions(): void {
  var _now = Date.now()
  if (_now - _lastRenderAT < 500) { if (!_pendingRenderAT) _pendingRenderAT = setTimeout(renderATPositions, 500 - (_now - _lastRenderAT)); return }
  _lastRenderAT = _now; _pendingRenderAT = 0
  const panel = el('atActivePosPanel')
  if (!panel) return
  // [FIX A2] Include AT positions filtered by globalMode
  const _globalMode = (typeof AT !== 'undefined' && AT._serverMode) ? AT._serverMode : 'demo'
  const autoPosns = [
    ...(TP.demoPositions || []).filter((p: any) => p.autoTrade && !p.closed),
    ...(TP.livePositions || []).filter((p: any) => p.autoTrade && !p.closed && p.status !== 'closing'),
  ].filter((p: any) => (p.mode || p._serverMode || 'demo') === _globalMode)
   .sort((a: any, b: any) => (a.seq || 0) - (b.seq || 0))
  _atUI({ posCountText: autoPosns.length + ' position' + (autoPosns.length === 1 ? '' : 's') })
  if (!autoPosns.length) {
    panel.innerHTML = '<div style="text-align:center;font-size:13px;color:var(--dim);padding:8px">No auto position open</div>'
    return
  }
  // Build HTML
  panel.innerHTML = autoPosns.map((pos: any) => {
    // [FIX A5] Use allPrices (consistent with getPosPrice/engine)
    const symPrice = (w.allPrices[pos.sym] && w.allPrices[pos.sym] > 0) ? w.allPrices[pos.sym]
      : (pos.sym === getSymbol() ? getPrice() : (w.wlPrices[pos.sym]?.price || pos.entry))
    const diff = symPrice - pos.entry
    const pnl = _safePnl(pos.side, diff, pos.entry, pos.size, pos.lev, true)
    const pnlStr = (pnl >= 0 ? '+' : '') + '$' + pnl.toFixed(2)
    const pnlPct = (w._safe.num(pos.size, null, 1) > 0 ? (pnl / w._safe.num(pos.size, null, 1) * 100).toFixed(2) : '0.00')
    const col = pos.side === 'LONG' ? '#00ff88' : '#ff4466'
    const symBase = escHtml((pos.sym || 'BTC').replace('USDT', ''))  // [v105 FIX Bug6] escHtml
    const safeSide = escHtml(pos.side)                           // [v105 FIX Bug6] escHtml
    const posMode = (pos.mode || pos._serverMode || 'demo')
    var _atPosEnv = w._resolvedEnv || (posMode === 'demo' ? 'DEMO' : 'REAL')
    const modeBadge = posMode === 'live'
      ? (_atPosEnv === 'TESTNET'
        ? '<span style="background:#f0c04022;color:#f0c040;padding:1px 5px;border-radius:3px;font-size:10px;font-weight:700;margin-left:6px">TESTNET</span>'
        : '<span style="background:#ff444422;color:#ff4444;padding:1px 5px;border-radius:3px;font-size:10px;font-weight:700;margin-left:6px">LIVE</span>')
      : '<span style="background:#aa44ff22;color:#aa44ff;padding:1px 5px;border-radius:3px;font-size:10px;font-weight:700;margin-left:6px">DEMO</span>'

    // TP/SL expected P&L
    const tpPnl2 = pos.tpPnl || (pos.tp ? Math.abs(pos.tp - pos.entry) / pos.entry * pos.size * pos.lev : 0)
    const slPnl2 = pos.slPnl || (pos.sl ? -Math.abs(pos.sl - pos.entry) / pos.entry * pos.size * pos.lev : 0)
    const distToTP = pos.tp ? ((Math.abs(symPrice - pos.tp) / symPrice) * 100).toFixed(2) : null
    const distToSL = pos.sl ? ((Math.abs(symPrice - pos.sl) / symPrice) * 100).toFixed(2) : null

    // QTY and Margin
    const qty2 = pos.qty || (pos.size / pos.entry)
    const margin2 = pos.margin || (pos.size / pos.lev)

    return `<div style="background:#0a0518;border:1px solid ${col}33;border-left:3px solid ${col};border-radius:4px;padding:8px 10px;margin-bottom:6px;font-size:12px">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:5px">
        <span style="color:${col};font-weight:700;font-size:14px">${_ZI.robot} ${safeSide} ${symBase}${modeBadge}</span>
        <span style="color:${pnl >= 0 ? '#00ff88' : '#ff4466'};font-size:16px;font-weight:700">${pnlStr} <span style="font-size:12px;opacity:.8">(${pnlPct}%)</span></span>
      </div>
            <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:4px;margin-bottom:5px">
        <div style="color:var(--dim);font-size:11px">${(pos.addOnCount || 0) > 0 ? 'Avg Entry' : 'Entry'}<br><span style="color:var(--whi);font-size:13px;font-weight:700">$${fP(pos.entry)}</span></div>
        <div style="color:var(--dim);font-size:11px">Now (${symBase})<br><span style="color:${col};font-size:13px;font-weight:700">$${fP(symPrice)}</span></div>
        <div style="color:var(--dim);font-size:11px">Leverage<br><span style="color:#f0c040;font-size:13px;font-weight:700">${pos.lev}x</span></div>
      </div>
            ${(pos.addOnCount || 0) > 0 ? `<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:4px;margin-bottom:5px;padding:4px 6px;background:#0d0a1a;border-radius:3px;border:1px solid #2a1a40">
        <div style="color:var(--dim);font-size:11px">Orig Entry<br><span style="color:#f0c040;font-size:12px;font-weight:700">$${fP(pos.originalEntry || pos.entry)}</span></div>
        <div style="color:var(--dim);font-size:11px">Add-Ons<br><span style="color:#00b8d4;font-size:12px;font-weight:700">${pos.addOnCount}x</span></div>
        <div style="color:var(--dim);font-size:11px">Orig Size<br><span style="color:#aa44ff;font-size:12px;font-weight:700">$${(pos.originalSize || pos.size).toFixed(0)}</span></div>
      </div>` : ''}
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px;margin-bottom:5px;padding:4px 6px;background:#060212;border-radius:3px;border:1px solid #1a0a30">
        <div style="color:var(--dim);font-size:11px">QTY (${symBase})<br><span style="color:#00b8d4;font-size:13px;font-weight:700">${qty2 > 1 ? qty2.toFixed(4) : qty2.toFixed(6)}</span></div>
        <div style="color:var(--dim);font-size:11px">Margin (USDT)<br><span style="color:#aa44ff;font-size:13px;font-weight:700">$${margin2.toFixed(2)}</span></div>
      </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px;margin-bottom:5px">
        <div style="padding:3px 5px;background:#00d97a0a;border:1px solid #00d97a22;border-radius:3px">
          <div style="font-size:10px;color:#00d97a55;letter-spacing:1px">TP PROFIT</div>
          <div style="font-size:13px;color:#00d97a;font-weight:700">+$${tpPnl2.toFixed(2)}</div>
          <div style="font-size:11px;color:var(--dim)">@$${fP(pos.tp)} ${distToTP ? '(' + distToTP + '%)' : ''}</div>
        </div>
        <div style="padding:3px 5px;background:#ff446608;border:1px solid #ff446622;border-radius:3px">
          <div style="font-size:10px;color:#ff446655;letter-spacing:1px">SL RISC</div>
          <div style="font-size:13px;color:#ff4466;font-weight:700">$${slPnl2.toFixed(2)}</div>
          <div style="font-size:11px;color:var(--dim)">@$${fP(pos.sl)} ${distToSL ? '(' + distToSL + '%)' : ''}</div>
        </div>
      </div>
            ${pos.liqPrice ? `<div style="font-size:11px;color:#ff8800;margin-bottom:5px">${_ZI.skull} LIQ: $${fP(pos.liqPrice)}</div>` : ''}
            <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:4px">
        <button data-close-id="${pos.id}"
          style="padding:10px 6px;background:#2a0010;border:2px solid #ff4466;color:#ff4466;border-radius:4px;font-size:12px;font-weight:700;cursor:pointer;font-family:var(--ff);touch-action:manipulation;min-height:48px;width:100%;display:block;letter-spacing:.5px;user-select:none;">
          \u2715 CLOSE
        </button>
        <button data-partial-id="${pos.id}"
          style="padding:10px 6px;background:#0d0020;border:2px solid #aa44ff;color:#aa44ff;border-radius:4px;font-size:12px;font-weight:700;cursor:pointer;font-family:var(--ff);touch-action:manipulation;min-height:48px;width:100%;display:block;letter-spacing:.5px;user-select:none;">
          \u25D1 PARTIAL
        </button>
        <button data-addon-id="${pos.id}" ${canAddOn(pos) ? '' : 'disabled'}
          style="padding:10px 6px;background:${canAddOn(pos) ? '#001a10' : '#111'};border:2px solid ${canAddOn(pos) ? '#00ff88' : '#333'};color:${canAddOn(pos) ? '#00ff88' : '#555'};border-radius:4px;font-size:12px;font-weight:700;cursor:${canAddOn(pos) ? 'pointer' : 'not-allowed'};font-family:var(--ff);touch-action:manipulation;min-height:48px;width:100%;display:block;letter-spacing:.5px;user-select:none;opacity:${canAddOn(pos) ? '1' : '.5'}">
          \u2795 ADD-ON
        </button>
      </div>
    </div>`
  }).join('')
  // Long-press attachment - previne inchideri accidentale la scroll
  panel.querySelectorAll('button[data-close-id]').forEach(function (btn: any) {
    const id = parseInt(btn.getAttribute('data-close-id'), 10)
    attachConfirmClose(btn, function () { closeAutoPos(id) })
  })
  panel.querySelectorAll('button[data-partial-id]').forEach(function (btn: any) {
    const id = parseInt(btn.getAttribute('data-partial-id'), 10)
    attachConfirmClose(btn, function () { openPartialClose(id) })
  })
  // [Batch B] Add-on button — single tap with server RPC
  panel.querySelectorAll('button[data-addon-id]').forEach(function (btn: any) {
    if (btn.disabled) return
    const id = parseInt(btn.getAttribute('data-addon-id'), 10)
    attachConfirmClose(btn, function () { openAddOn(id) })
  })
}

// Partial close modal
export function openPartialClose(posId: any): void {
  const existing = document.getElementById('partialCloseModal')
  if (existing) existing.remove()

  const pos = (TP.demoPositions || []).find((p: any) => p.id === posId) || (TP.livePositions || []).find((p: any) => p.id === posId)
  if (!pos) return
  const symPrice = (w.allPrices[pos.sym] && w.allPrices[pos.sym] > 0) ? w.allPrices[pos.sym]
    : (pos.sym === getSymbol() ? getPrice() : (w.wlPrices[pos.sym]?.price || pos.entry))
  const pnl = pos.entry > 0 ? (pos.side === 'LONG' ? symPrice - pos.entry : pos.entry - symPrice) / pos.entry * pos.size * pos.lev : 0

  const container = document.createElement('div')
  container.id = 'partialCloseModal'
  document.body.appendChild(container)

  Promise.all([
    import('react'),
    import('react-dom/client'),
    import('../components/modals/PartialCloseModal'),
  ]).then(([ReactMod, { createRoot }, { default: PartialCloseModal }]) => {
    const root = createRoot(container)
    root.render(ReactMod.createElement(PartialCloseModal, {
      posId, side: pos.side, sym: pos.sym, size: pos.size, pnl,
      onClose: (id: any, pct: number) => { root.unmount(); container.remove(); execPartialClose(id, pct) },
      onCancel: () => { root.unmount(); container.remove() },
    }))
  })
}

export function execPartialClose(posId: any, pct: any): void {
  document.getElementById('partialCloseModal')?.remove()
  if (!pct || pct <= 0 || pct >= 100) { toast('Invalid percent'); return }
  // [FIX A3] Search both demo and live positions
  let idx = (TP.demoPositions || []).findIndex((p: any) => p.id === posId)
  let _isLivePartial = false
  if (idx < 0) { idx = (TP.livePositions || []).findIndex((p: any) => p.id === posId); _isLivePartial = idx >= 0 }
  if (idx < 0) return
  const pos = _isLivePartial ? TP.livePositions[idx] : TP.demoPositions[idx]
  const symPrice = (w.allPrices[pos.sym] && w.allPrices[pos.sym] > 0) ? w.allPrices[pos.sym]
    : (pos.sym === getSymbol() ? getPrice() : (w.wlPrices[pos.sym]?.price || pos.entry))
  const fraction = pct / 100
  const partialSize = pos.size * fraction
  const diff = symPrice - pos.entry
  const partialPnl = _safePnl(pos.side, diff, pos.entry, partialSize, pos.lev, true)

  // Reduce position size
  pos.size = pos.size * (1 - fraction)
  pos.qty = (pos.qty || pos.size / pos.entry) * (1 - fraction)
  pos.margin = (pos.margin || (pos.size / pos.lev)) * (1 - fraction)
  // [FIX A3] Live partial: don't touch demoBalance
  if (!_isLivePartial) TP.demoBalance += partialSize + partialPnl
  if (partialPnl >= 0) { if (!_isLivePartial) TP.demoWins++ } else { if (!_isLivePartial) TP.demoLosses++ }

  addTradeToJournal({
    id: pos.id,
    time: fmtNow(),
    side: pos.side, sym: pos.sym,
    entry: pos.entry, exit: symPrice,
    size: partialSize, pnl: partialPnl, reason: `\u25D1 PARTIAL ${pct}%`, lev: pos.lev,
    // [Etapa 4] Journal Context — salvat la CLOSE pentru Historical Regime Memory
    journalEvent: 'CLOSE',
    regime: BM.regime || BM.structure?.regime || '—',
    alignmentScore: BM.structure?.score ?? null,
    volRegime: BM.volRegime || '—',
    profile: w.S.profile || 'fast',
    openTs: pos.openTs || pos.id,
    closedAt: Date.now(),
    mode: pos.mode || (_isLivePartial ? 'live' : ((typeof AT !== 'undefined' && AT._serverMode) || 'demo')),
  })

  atLog('info', `\u25D1 Partial close ${pct}% — ${pos.sym.replace('USDT', '')} PnL: ${partialPnl >= 0 ? '+' : ''}$${partialPnl.toFixed(2)}`)
  toast(`\u25D1 ${pct}% closed — PnL: ${partialPnl >= 0 ? '+' : ''}$${partialPnl.toFixed(2)}`)
  w.updateDemoBalance(); renderDemoPositions(); renderATPositions(); updateATStats()
  // [9A-5] Notify React — partial close updated balance + position size
  try { window.dispatchEvent(new CustomEvent('zeus:positionsChanged')) } catch (_) {}
}

export function closeAutoPos(id: any): void {
  const numId = (typeof id === 'string') ? parseInt(id, 10) : Number(id)

  // ─── Check live positions first ───
  const livePos = TP.livePositions.find((p: any) => (p.id === numId || p.id === id) && !p.closed)
  if (livePos) {
    const cur = getSymPrice(livePos)
    if (cur == null) { renderATPositions(); return }
    const diff = cur - livePos.entry
    const pnl = _safePnl(livePos.side, diff, livePos.entry, livePos.size, livePos.lev, true)
    closeLivePos(numId, 'Manual close')
    AT.totalPnL += pnl; AT.dailyPnL += pnl
    if (pnl >= 0) AT.wins++; else AT.losses++
    atLog(pnl >= 0 ? 'buy' : 'sell', '[LIVE] MANUAL CLOSE: ' + livePos.sym.replace('USDT', '') + ' PnL: ' + (pnl >= 0 ? '+' : '') + '$' + pnl.toFixed(2))
    setTimeout(function () { updateATStats(); renderATPositions(); renderLivePositions() }, 50)
    return
  }

  // ─── Demo positions (original logic) ───
  const pos = TP.demoPositions.find((p: any) => (p.id === numId || p.id === id) && !p.closed)
  if (!pos) { renderATPositions(); return }

  const cur = getSymPrice(pos)
  if (cur == null) { renderATPositions(); return }
  const diff = cur - pos.entry
  const pnl = _safePnl(pos.side, diff, pos.entry, pos.size, pos.lev, true)

  // FIX SYNC: Marchez ca autoTrade close manual INAINTE de closeDemoPos
  // asa closeDemoPos stie sa updateze AT stats corect
  pos._manualATClose = true

  // closeDemoPos sterge din array + updateaza AMBELE panouri
  closeDemoPos(numId, 'Manual close')

  // [FIX BUG4] Use closeDemoPos PnL if available (prevents price-race drift)
  const _finalPnl = Number.isFinite(pos._closePnl) ? pos._closePnl : pnl
  // AT stats
  AT.totalPnL += _finalPnl; AT.dailyPnL += _finalPnl
  if (_finalPnl >= 0) AT.wins++; else AT.losses++
  atLog(_finalPnl >= 0 ? 'buy' : 'sell', `[MANUAL] CLOSE: ${pos.sym.replace('USDT', '')} PnL: ${_finalPnl >= 0 ? '+' : ''}$${_finalPnl.toFixed(2)}`)
  setTimeout(() => { updateATStats(); renderATPositions(); renderDemoPositions() }, 50)
}

// Inchide pozitiile MANUAL (nu AT) din panoul curent
// [FIX] Close All din panoul manual NU mai inchide pozitiile AT — fiecare panou cu ale lui
export function closeAllDemoPos(): void {
  var _activeMode = (typeof AT !== 'undefined' && AT._serverMode) ? AT._serverMode : 'demo'
  // ─── Close MANUAL live positions only (skip autoTrade) ───
  const livePosns = _activeMode === 'live'
    ? [...TP.livePositions].filter((p: any) => !p.closed && !p.autoTrade)
    : []
  livePosns.forEach(function (p: any) {
    closeLivePos(p.id, 'Close All Manual')
  })
  // ─── Close MANUAL demo positions only (skip autoTrade) ───
  const posns = _activeMode === 'demo'
    ? [...TP.demoPositions].filter((p: any) => !p.closed && !p.autoTrade)
    : []
  const totalClosed = livePosns.length + posns.length
  if (!totalClosed) { toast('No manual positions open', 0, _ZI.clip); return }
  posns.forEach((p: any) => {
    closeDemoPos(p.id, 'Close All Manual')
  })
  setTimeout(() => { renderATPositions(); updateATStats(); renderDemoPositions() }, 100)
  toast('Closed ' + totalClosed + ' manual positions', 0, _ZI.ok)
}

// Inchide TOATE pozitiile AT (apelat din panoul AT / Emergency Stop)
export function closeAllATPos(): void {
  var _activeMode = (typeof AT !== 'undefined' && AT._serverMode) ? AT._serverMode : 'demo'
  // ─── Close AT live positions ───
  const livePosns = _activeMode === 'live' && Array.isArray(TP.livePositions)
    ? [...TP.livePositions].filter((p: any) => !p.closed && p.autoTrade)
    : []
  livePosns.forEach(function (p: any) {
    const cur = getSymPrice(p) || p.entry
    const pnl = typeof w.calcPosPnL === 'function' ? w.calcPosPnL(p, cur) : 0
    AT.totalPnL += pnl; AT.dailyPnL += pnl
    if (pnl >= 0) AT.wins++; else AT.losses++
    AT.realizedDailyPnL = (getATDailyPnL() || 0) + pnl
    AT.closedTradesToday = (getATClosedToday() || 0) + 1
    closeLivePos(p.id, 'Close All AT')
  })
  // ─── Close AT demo positions ───
  const posns = _activeMode === 'demo'
    ? [...TP.demoPositions].filter((p: any) => !p.closed && p.autoTrade)
    : []
  posns.forEach((p: any) => {
    closeDemoPos(p.id, 'Close All AT')
    const pnl = Number.isFinite(p._closePnl) ? p._closePnl : 0
    AT.totalPnL += pnl; AT.dailyPnL += pnl
    if (pnl >= 0) AT.wins++; else AT.losses++
  })
  const totalClosed = livePosns.length + posns.length
  if (!totalClosed) { toast('No AT positions open', 0, _ZI.clip); return }
  if (livePosns.length > 0) checkKillThreshold()
  setTimeout(() => { renderATPositions(); updateATStats() }, 100)
  toast('Closed ' + totalClosed + ' AT positions', 0, _ZI.ok)
}

// ===================================================================
// END AUTO TRADE ENGINE
// ===================================================================

// Self-registration — makes phase1Adapters mapping redundant
// aub.ts monkey-patches w.toggleAutoTrade after this, which is correct
;(window as any).toggleAutoTrade = toggleAutoTrade

// ===================================================================
// CLOSE PROTECTION — confirmare în 2 pași (state global, rezistent la HTML rebuild)
// ===================================================================
// State stocat global pe ID-ul pozitiei, nu pe elementul button
// Astfel supravietuieste rebuild-ului HTML din _demoTick
