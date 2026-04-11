// Zeus — engine/ares.ts
// Ported 1:1 from public/js/brain/deepdive.js lines 406-1193 (Phase 5B2)
// ARES 1.0 — Adaptive Reinforcement Engine for Strategic growth
// + ARES_openPosition (DEBUG-ONLY)

import { safeLastKline } from '../utils/dom'

const w = window as any

const TARGET = 1_000_000
const DAYS_MAX = 365

const STATES: Record<string, any> = {
  DETERMINED: { id: 'DETERMINED', color: '#00d9ff', glow: '#00d9ff', label: 'DETERMINED', emoji: w._ZI?.bolt || '' },
  RESILIENT: { id: 'RESILIENT', color: '#00ff88', glow: '#00ff88', label: 'RESILIENT', emoji: w._ZI?.rfsh || '' },
  FOCUSED: { id: 'FOCUSED', color: '#f0c040', glow: '#f0c040', label: 'FOCUSED', emoji: w._ZI?.tgt || '' },
  STRATEGIC: { id: 'STRATEGIC', color: '#aa44ff', glow: '#aa44ff', label: 'STRATEGIC', emoji: w._ZI?.hex || '' },
  MOMENTUM: { id: 'MOMENTUM', color: '#00ff44', glow: '#00ff44', label: 'MOMENTUM', emoji: w._ZI?.tup || '' },
  FRUSTRATED: { id: 'FRUSTRATED', color: '#ff8800', glow: '#ff8800', label: 'FRUSTRATED', emoji: w._ZI?.w || '' },
  DEFENSIVE: { id: 'DEFENSIVE', color: '#ff3355', glow: '#ff3355', label: 'DEFENSIVE', emoji: w._ZI?.sh || '' },
  REVENGE_GUARD: { id: 'REVENGE_GUARD', color: '#ff0044', glow: '#ff0044', label: 'REVENGE GUARD', emoji: w._ZI?.noent || '' },
}

// ══════════════════════════════════════════════════════════════
// ARES WALLET
// ══════════════════════════════════════════════════════════════
const ARES_LS_KEY = 'ARES_MISSION_STATE_V1'
const ARES_WALLET = (function () {
  const FEE_MAKER = 0.0002
  const FEE_TAKER = 0.00055
  const WK = ARES_LS_KEY + '_vw2'
  let _w: any = { balance: 0, locked: 0, realizedPnL: 0, fundedTotal: 0, updatedTs: 0 }
  try {
    const stored = JSON.parse(localStorage.getItem(WK) || 'null')
    if (stored && Number.isFinite(stored.balance)) _w = Object.assign(_w, stored)
  } catch (_) { }

  function recalc() {
    _w.balance = Math.max(0, _w.balance)
    _w.locked = Math.max(0, Math.min(_w.locked, _w.balance))
    _w.updatedTs = Date.now()
  }
  function _save() {
    recalc()
    try { localStorage.setItem(WK, JSON.stringify(_w)) } catch (_) { }
    if (typeof w._ucMarkDirty === 'function') w._ucMarkDirty('aresData')
    if (typeof w._userCtxPush === 'function') w._userCtxPush()
    try { window.dispatchEvent(new CustomEvent('zeus:aresStateChanged')) } catch (_) { }
  }
  recalc()
  if (_w.locked > 0) { _w.locked = 0; _save() }

  return {
    get balance() { return _w.balance },
    get available() { return Math.max(0, _w.balance - _w.locked) },
    get locked() { return _w.locked },
    get realizedPnL() { return _w.realizedPnL },
    get fundedTotal() { return _w.fundedTotal },
    get updatedTs() { return _w.updatedTs },
    fund(amount: any) { const v = parseFloat(amount); if (!Number.isFinite(v) || v <= 0) return false; _w.balance += v; _w.fundedTotal += v; _save(); return true },
    withdraw(amount: any, openPositionsCount?: number) { if (_w.locked > 0 || (openPositionsCount || 0) > 0) return false; const v = parseFloat(amount); if (!Number.isFinite(v) || v <= 0) return false; _w.balance = Math.max(0, _w.balance - v); _save(); return true },
    canSpend(amount: number) { return Number.isFinite(amount) && (Math.max(0, _w.balance - _w.locked)) >= amount },
    reserve(amount: any) { const v = parseFloat(amount); const avail = Math.max(0, _w.balance - _w.locked); if (!Number.isFinite(v) || v <= 0 || avail < v) return false; _w.locked += v; _save(); return true },
    release(amount: any) { const v = parseFloat(amount); if (!Number.isFinite(v) || v <= 0) return false; _w.locked = Math.max(0, _w.locked - Math.min(v, _w.locked)); _save(); return true },
    applyPnL(pnlNet: any) { const v = parseFloat(pnlNet); if (!Number.isFinite(v)) return false; _w.balance += v; _w.realizedPnL += v; _save(); return true },
    feesFor(notional: number, isMaker: boolean) { return notional * (isMaker ? FEE_MAKER : FEE_TAKER) },
    roundTripFees(notional: number) { return notional * FEE_TAKER * 2 },
    get equity() { return _w.balance },
    get isActive() { return _w.updatedTs > 0 && (Date.now() - _w.updatedTs) < 300000 },
    get isLive() { return this.isActive },
  }
})()

// ══════════════════════════════════════════════════════════════
// ARES POSITIONS
// ══════════════════════════════════════════════════════════════
const ARES_POSITIONS = (function () {
  const POS_LS_KEY = 'ARES_POSITIONS_V1'
  let _positions: any[] = []
  let _posIdCtr = 1
  let _closingAll = false

  try {
    const stored = JSON.parse(localStorage.getItem(POS_LS_KEY) || 'null')
    if (Array.isArray(stored) && stored.length > 0) {
      _positions = stored
      _posIdCtr = _positions.reduce((m: number, p: any) => {
        const n = parseInt(String(p.id).replace('ARES_POS_', ''), 10)
        return (n >= m) ? n + 1 : m
      }, _posIdCtr)
    }
  } catch (_) { }

  function _savePositions() {
    try { localStorage.setItem(POS_LS_KEY, JSON.stringify(_positions)) } catch (_) { }
    if (typeof w._ucMarkDirty === 'function') w._ucMarkDirty('aresData')
    if (typeof w._userCtxPush === 'function') w._userCtxPush()
    try { window.dispatchEvent(new CustomEvent('zeus:aresStateChanged')) } catch (_) { }
  }
  function _makeClientId() { return 'ARES_' + Date.now() + '_' + Math.floor(Math.random() * 9999) }
  function calcUPnL(pos: any, markPrice: number) {
    if (!pos || !markPrice) return 0
    const direction = pos.side === 'LONG' ? 1 : -1
    const priceDiff = (markPrice - pos.entryPrice) * direction
    return (priceDiff / pos.entryPrice) * pos.notional
  }
  function calcLiqPrice(pos: any) {
    const marginRatio = 1 / pos.leverage
    if (pos.side === 'LONG') return pos.entryPrice * (1 - marginRatio + 0.005)
    return pos.entryPrice * (1 + marginRatio - 0.005)
  }

  function open(params: any) {
    const id = 'ARES_POS_' + (_posIdCtr++)
    const clientOrderId = _makeClientId()
    const fees = ARES_WALLET.roundTripFees(params.notional)
    const pos: any = {
      id, clientOrderId, symbol: 'BTCUSDT', owner: 'ARES',
      meta: { owner: 'ARES', missionId: 'ARES_V1', createdTs: Date.now(), policy: params.policy || 'BALANCED', reason: params.reason || 'signal' },
      side: params.side, leverage: params.leverage, marginMode: 'ISOLATED',
      notional: params.notional, stakeVirtual: params.stakeVirtual || 0,
      entryPrice: params.entryPrice, liqPrice: 0, markPrice: params.entryPrice,
      uPnL: 0, uPnLPct: 0, feesEstimate: fees,
      targetNetPnL: params.targetNetPnL || 10, openTs: Date.now(),
      confidence: params.confidence || 50, status: 'OPEN',
    }
    pos.liqPrice = calcLiqPrice(pos)
    _positions.push(pos)
    _savePositions()
    return pos
  }

  function updatePrices(markPrice: number) {
    if (!markPrice || !Number.isFinite(markPrice)) return
    _positions.filter((p: any) => p.status === 'OPEN').forEach((pos: any) => {
      pos.markPrice = markPrice
      pos.uPnL = calcUPnL(pos, markPrice)
      pos.uPnLPct = (pos.uPnL / pos.notional) * 100
    })
  }

  function closePosition(posId: string) {
    const pos = _positions.find((p: any) => p.id === posId && p.status === 'OPEN')
    if (!pos) return null
    pos.status = 'CLOSED'
    pos.closeTs = Date.now()
    const netPnL = (pos.netPnl !== undefined && pos.netPnl !== null) ? pos.netPnl : (pos.uPnL - pos.feesEstimate)
    const stakeVirtual = pos.stakeVirtual || 0
    if (stakeVirtual > 0) ARES_WALLET.release(stakeVirtual)
    ARES_WALLET.applyPnL(netPnL)
    _savePositions()
    return { posId, netPnL, feesEstimate: pos.feesEstimate }
  }

  function closeAll() {
    if (_closingAll) return 0
    _closingAll = true
    const openP = _positions.filter((p: any) => p.status === 'OPEN')
    const results: any[] = []
    openP.forEach((pos: any) => { const r = closePosition(pos.id); if (r) results.push(r) })
    _closingAll = false
    return results.length
  }

  function getOpen() { return _positions.filter((p: any) => p.status === 'OPEN') }
  function getAll() { return _positions }
  function getClosed() { return _positions.filter((p: any) => p.status === 'CLOSED') }
  function save() { _savePositions() }
  function updatePos(posId: string, fields: any) {
    const pos = _positions.find((p: any) => p.id === posId)
    if (!pos) return null
    Object.assign(pos, fields)
    _savePositions()
    return pos
  }

  return { open, updatePrices, closePosition, closeAll, getOpen, getAll, getClosed, save, updatePos }
})()

// ── State intern ARES ────────────────────────────────────────
const STATE_LS_KEY = 'ARES_STATE_V1'
let _state: any = {
  current: STATES.DETERMINED, confidence: 72, trajectoryDelta: 0,
  startBalance: null, startTs: null, daysPassed: 0, targetBalance: 0,
  nodes: {
    trajectory: { label: 'TRAJECTORY', value: '\u2014', active: false, score: 0 },
    regime: { label: 'REGIME', value: '\u2014', active: false, score: 0 },
    signal: { label: 'SIGNAL', value: '\u2014', active: false, score: 0 },
    memory: { label: 'MEMORY', value: '\u2014', active: false, score: 0 },
    volatility: { label: 'VOLATILITY', value: '\u2014', active: false, score: 0 },
    session: { label: 'SESSION', value: '\u2014', active: false, score: 0 },
  },
  thoughtLines: [] as string[], lastLesson: '\u2014', tradeHistory: [] as boolean[],
  consecutiveLoss: 0, consecutiveWin: 0, lastLossTs: 0, winRate10: 0,
  lastUpdateTs: 0, totalAresTrades: 0, totalAresWins: 0, totalAresLosses: 0,
}
try {
  const _saved = JSON.parse(localStorage.getItem(STATE_LS_KEY) || 'null')
  if (_saved) {
    _state.tradeHistory = Array.isArray(_saved.tradeHistory) ? _saved.tradeHistory : []
    _state.consecutiveLoss = _saved.consecutiveLoss || 0
    _state.consecutiveWin = _saved.consecutiveWin || 0
    _state.lastLossTs = _saved.lastLossTs || 0
    _state.totalAresTrades = _saved.totalAresTrades || 0
    _state.totalAresWins = _saved.totalAresWins || 0
    _state.totalAresLosses = _saved.totalAresLosses || 0
  }
} catch (_) { }

function _saveState() {
  try {
    localStorage.setItem(STATE_LS_KEY, JSON.stringify({
      tradeHistory: _state.tradeHistory, consecutiveLoss: _state.consecutiveLoss,
      consecutiveWin: _state.consecutiveWin, lastLossTs: _state.lastLossTs,
      totalAresTrades: _state.totalAresTrades, totalAresWins: _state.totalAresWins,
      totalAresLosses: _state.totalAresLosses,
    }))
  } catch (_) { }
  if (typeof w._ucMarkDirty === 'function') w._ucMarkDirty('aresData')
  if (typeof w._userCtxPush === 'function') w._userCtxPush()
}

// ── Utilities ────────────────────────────────────────────────
function _balance() { try { return ARES_WALLET.balance || 0 } catch (_) { return 0 } }
function _regime() { try { return (typeof w.BRAIN !== 'undefined' && w.BRAIN.regime) ? w.BRAIN.regime : '\u2014' } catch (_) { return '\u2014' } }
function _atr() { try { return (typeof w.S !== 'undefined' && w.S.atr) ? w.S.atr : 0 } catch (_) { return 0 } }
function _entryScore() { try { return (w.BM && w.BM.entryScore) ? w.BM.entryScore : 0 } catch (_) { return 0 } }
function _session() {
  const h = new Date().getUTCHours()
  if (h >= 1 && h < 8) return 'ASIA'
  if (h >= 7 && h < 12) return 'LONDON'
  if (h >= 13 && h < 21) return 'NEW YORK'
  return 'OFF-HOURS'
}
function _push(line: string) {
  _state.thoughtLines.unshift(line)
  if (_state.thoughtLines.length > 28) _state.thoughtLines = _state.thoughtLines.slice(0, 28)
}

function _calcTrajectory(balance: number) {
  const KEY_INIT = 'ares_init_v1'
  let init: any
  try { init = JSON.parse(localStorage.getItem(KEY_INIT) || 'null') } catch (_) { init = null }
  if (!init || !init.balance || !init.ts) {
    init = { balance: balance || 1000, ts: Date.now() }
    try { localStorage.setItem(KEY_INIT, JSON.stringify(init)) } catch (_) { }
  }
  _state.startBalance = init.balance
  _state.startTs = init.ts
  const daysPassed = Math.max(1, (Date.now() - init.ts) / 86400000)
  _state.daysPassed = +daysPassed.toFixed(1)
  const dailyRate = Math.pow(TARGET / init.balance, 1 / DAYS_MAX) - 1
  const expectedNow = init.balance * Math.pow(1 + dailyRate, daysPassed)
  _state.targetBalance = expectedNow
  const delta = balance > 0 ? ((balance - expectedNow) / expectedNow * 100) : 0
  _state.trajectoryDelta = +delta.toFixed(2)
  return { dailyRate: +(dailyRate * 100).toFixed(3), expectedNow: +expectedNow.toFixed(2), delta, daysLeft: +(Math.max(1, DAYS_MAX - daysPassed)).toFixed(0) }
}

function _computeState(traj: any, balance: number) {
  const { delta } = traj
  const cl = _state.consecutiveLoss, cw = _state.consecutiveWin, wr = _state.winRate10
  const timeSinceLoss = Date.now() - _state.lastLossTs
  if (cl >= 3 && timeSinceLoss < 300000) return STATES.REVENGE_GUARD
  if (cl >= 4 || delta < -15 || (w.AT && w.AT.killTriggered)) return STATES.DEFENSIVE
  if (cl >= 3 || delta < -8) return STATES.FRUSTRATED
  if (cw >= 3 && wr >= 65) return STATES.MOMENTUM
  if (delta > 5 && wr >= 55) return STATES.STRATEGIC
  if (wr < 50 || delta < -3) return STATES.FOCUSED
  if (cl >= 1 && cl <= 2) return STATES.RESILIENT
  return STATES.DETERMINED
}

function _computeConfidence(traj: any) {
  let score = 50
  const regime = _regime(), es = _entryScore(), atrVal = _atr()
  if (regime === 'STRONG BULL' || regime === 'STRONG BEAR') score += 15
  else if (regime === 'BULL' || regime === 'BEAR') score += 8
  else if (regime === 'RANGE') score -= 10
  if (es >= 80) score += 12; else if (es >= 65) score += 5; else if (es < 45) score -= 12
  if (traj.delta > 5) score += 8; else if (traj.delta > 0) score += 3; else if (traj.delta < -10) score -= 15; else if (traj.delta < -3) score -= 7
  score += Math.round((_state.winRate10 - 50) * 0.3)
  const atrNode = _state.nodes.volatility
  if (atrNode.score > 0) score += 5; else if (atrNode.score < 0) score -= 5
  return Math.min(99, Math.max(1, score))
}

function _updateNodes(traj: any, balance: number) {
  const regime = _regime(), es = _entryScore(), session = _session()
  const pmStats = (typeof w.PM !== 'undefined') ? w.PM.getStats() : null
  const n_traj = _state.nodes.trajectory
  n_traj.value = (traj.delta >= 0 ? '+' : '') + traj.delta + '%'; n_traj.score = traj.delta; n_traj.active = Math.abs(traj.delta) > 1
  const n_reg = _state.nodes.regime
  n_reg.value = regime; n_reg.score = (regime.includes('STRONG')) ? 2 : (regime === 'RANGE') ? -1 : 1; n_reg.active = regime !== '\u2014'
  const n_sig = _state.nodes.signal
  n_sig.value = es ? es + ' pts' : '\u2014'; n_sig.score = es >= 70 ? 1 : es < 50 ? -1 : 0; n_sig.active = es > 0
  const n_mem = _state.nodes.memory
  if (pmStats) { n_mem.value = pmStats.slTightPct + '% SL tight'; n_mem.score = pmStats.slTightPct > 60 ? -1 : 0; n_mem.active = pmStats.total > 0 }
  else { n_mem.value = 'learning...'; n_mem.score = 0; n_mem.active = false }
  const n_vol = _state.nodes.volatility
  const atr = _atr()
  if (atr > 0 && w.S?.klines && w.S.klines.length > 20) {
    const recent = w.S.klines.slice(-20).map((k: any) => k.high - k.low)
    const mean = recent.reduce((a: number, b: number) => a + b, 0) / recent.length
    const ratio = atr / mean
    n_vol.value = ratio > 0 ? ratio.toFixed(2) + '\u00D7' : '\u2014'; n_vol.score = ratio > 1.5 ? 1 : ratio < 0.7 ? -1 : 0; n_vol.active = true
  } else { n_vol.value = '\u2014'; n_vol.score = 0; n_vol.active = false }
  const n_ses = _state.nodes.session
  n_ses.value = session; n_ses.score = (session === 'LONDON' || session === 'NEW YORK') ? 1 : session === 'ASIA' ? 0 : -1; n_ses.active = session !== 'OFF-HOURS'
}

function _generateThought(traj: any, prevState: any, newState: any) {
  const regime = _regime(), es = _entryScore(), session = _session(), balance = _balance()
  const thoughts: string[] = []
  thoughts.push(`Regime scan \u2192 ${regime || 'undefined'}${regime.includes('STRONG') ? ' \u2713 high conviction' : regime === 'RANGE' ? ' ! low conviction' : ''}`)
  if (es > 0) thoughts.push(`Entry score ${es} / 100 \u2192 ${es >= 70 ? 'ABOVE threshold' : es >= 55 ? 'marginal' : 'BELOW threshold \u2014 caution'}`)
  thoughts.push(`Trajectory \u0394 ${traj.delta >= 0 ? '+' : ''}${traj.delta}% vs curve day ${_state.daysPassed} \u2192 ${Math.abs(traj.delta) < 1 ? 'ON TRACK' : traj.delta > 0 ? 'AHEAD \u2014 conserve gains' : 'BEHIND \u2014 controlled pressure'}`)
  thoughts.push(`Session: ${session} \u2192 ${session === 'LONDON' || session === 'NEW YORK' ? 'prime liquidity window' : session === 'ASIA' ? 'reduced volume' : 'low activity period'}`)
  if (_state.winRate10 > 0) thoughts.push(`Win rate last 10: ${_state.winRate10}% \u2192 ${_state.winRate10 >= 60 ? 'edge confirmed' : _state.winRate10 >= 50 ? 'edge marginal' : 'edge degraded \u2014 reassess'}`)
  if (prevState && prevState.id !== newState.id) thoughts.push(`STATE TRANSITION: ${prevState.label} \u2192 ${newState.label}`)
  const pmStats = (typeof w.PM !== 'undefined') ? w.PM.getStats() : null
  if (pmStats && pmStats.slTightPct > 60) thoughts.push(`Memory alert: ${pmStats.slTightPct}% losses had SL < 1\u00D7ATR \u2014 widening threshold recommended`)
  if (pmStats && pmStats.reboundPct > 50) thoughts.push(`Memory alert: ${pmStats.reboundPct}% SL hits reversed \u2014 noise filtering needed`)
  const pctToTarget = balance > 0 ? ((balance / TARGET) * 100).toFixed(4) : '0'
  thoughts.push(`Mission: $${balance.toFixed(0)} / $1,000,000 \u2192 ${pctToTarget}% complete \u2014 day ${_state.daysPassed}/${DAYS_MAX}`)
  thoughts.forEach(t => _push(t))
}

// ── Reconciliation ──
let _reconciled = false
async function _reconcile() {
  if (_reconciled) return
  _reconciled = true
  const openLocal = ARES_POSITIONS.getOpen()
  if (openLocal.length === 0) return
  try {
    if (typeof w.liveApiGetPositions !== 'function') return
    const exchangePositions = await w.liveApiGetPositions()
    const btcPos = exchangePositions.find(function (p: any) { return p.symbol === 'BTCUSDT' })
    openLocal.forEach(function (pos: any) {
      const sideMatch = btcPos && btcPos.side === pos.side && btcPos.size > 0
      if (!sideMatch) {
        _push('[RECONCILE] Position ' + pos.id + ' closed externally (SL/TP hit while offline)')
        ARES_POSITIONS.closePosition(pos.id)
        onTradeClosed(pos.uPnL - pos.feesEstimate, pos)
      }
    })
  } catch (e: any) { console.warn('[ARES] reconciliation error:', e.message) }
}

// ── Tick principal ──
function tick() {
  try {
    if (!_reconciled) _reconcile()
    if (typeof w._bmResetDailyIfNeeded === 'function') w._bmResetDailyIfNeeded()
    const balance = _balance()
    const traj = _calcTrajectory(balance)
    const prevState = _state.current

    try {
      let markPrice = 0
      if (typeof w.S !== 'undefined' && w.S.price) markPrice = w.S.price
      else { const _lk = (typeof safeLastKline === 'function') ? safeLastKline() : null; if (_lk) markPrice = _lk.close }
      if (markPrice > 0) ARES_POSITIONS.updatePrices(markPrice)
    } catch (_) { }

    try {
      const ksActive = (typeof w.AT !== 'undefined') && (w.AT.killTriggered || w.AT.killSwitch)
      if (ksActive && ARES_POSITIONS.getOpen().length > 0) {
        let markPrice = 0
        try { if (typeof w.S !== 'undefined' && w.S.price) markPrice = w.S.price } catch (_) { }
        const openPos = ARES_POSITIONS.getOpen()
        let liveClosed = 0, virtualClosed = 0
        for (const pos of openPos) {
          if (pos.isLive && typeof w.ARES_MONITOR !== 'undefined' && w.ARES_MONITOR.closeLivePosition) {
            try { w.ARES_MONITOR.closeLivePosition(pos, markPrice || pos.markPrice || 0, 'kill_switch'); liveClosed++ }
            catch (ksErr: any) { _push('[KILL] Live close failed for ' + (pos.symbol || 'pos') + ' \u2014 ' + (ksErr.message || ksErr)) }
          } else { ARES_POSITIONS.closePosition(pos.id); virtualClosed++ }
        }
        _push('[KILL] ARES positions closed (live=' + liveClosed + ' virtual=' + virtualClosed + ')')
      }
    } catch (_) { }

    _updateNodes(traj, balance)
    const newState = _computeState(traj, balance)
    _state.current = newState
    _state.confidence = _computeConfidence(traj)
    _generateThought(traj, prevState, newState)

    try { const pmR = w.PM?.load(); if (pmR && pmR[0] && pmR[0].insight) _state.lastLesson = pmR[0].insight } catch (_) { }

    try {
      if (typeof w.ARES_MONITOR !== 'undefined' && w.ARES_MONITOR.check) {
        w.ARES_MONITOR.check().catch(function (e: any) { console.warn('[ARES] monitor async error:', e.message) })
      }
    } catch (monErr: any) { console.warn('[ARES] monitor error:', monErr.message) }

    try {
      if (typeof w.ARES_DECISION !== 'undefined' && typeof w.ARES_EXECUTE === 'function') {
        const decision = w.ARES_DECISION.evaluate()
        if (decision.shouldTrade) {
          _push('[DECISION] GO ' + decision.side + ' \u2014 ' + decision.reasons.join(', '))
          w.ARES_EXECUTE(decision).catch(function (e: any) { _push('[EXEC ERROR] ' + (e.message || e)); console.error('[ARES] execution async error:', e) })
        }
      }
    } catch (decErr: any) { console.warn('[ARES] decision error:', decErr.message) }

    _state.lastUpdateTs = Date.now()
    if (typeof w._aresRender === 'function') w._aresRender()
  } catch (e: any) { console.warn('[ARES] tick error:', e.message) }
}

function onTradeClosed(pnl: number, pos?: any) {
  try {
    const isWin = pnl > 0, isNeutral = pnl === 0
    _state.tradeHistory.unshift(isWin)
    if (_state.tradeHistory.length > 10) _state.tradeHistory = _state.tradeHistory.slice(0, 10)
    _state.totalAresTrades++
    if (isWin) { _state.consecutiveWin++; _state.consecutiveLoss = 0; _state.totalAresWins++ }
    else if (!isNeutral) { _state.consecutiveLoss++; _state.consecutiveWin = 0; _state.lastLossTs = Date.now(); _state.totalAresLosses++ }
    const wins10 = _state.tradeHistory.filter(Boolean).length
    _state.winRate10 = _state.tradeHistory.length > 0 ? Math.round(wins10 / _state.tradeHistory.length * 100) : 0
    _saveState()
    fetch('/api/risk/pnl', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pnl, owner: 'ARES' }) }).catch(() => { })
    tick()
  } catch (_) { }
}

function getState() { return _state }

export const ARES = {
  tick, onTradeClosed, getState, reconcile: _reconcile,
  wallet: ARES_WALLET, positions: ARES_POSITIONS,
  saveState: _saveState, push: _push,
  balance: _balance, regime: _regime, atr: _atr, entryScore: _entryScore, session: _session,
}

// ══════════════════════════════════════════════════════════════
// ARES_openPosition — DEBUG ONLY
// ══════════════════════════════════════════════════════════════
export function ARES_openPosition(opts: any): any {
  if (!w.__ARES_OPEN_POS_DEBUG__) {
    console.warn('[ARES_openPosition] BLOCKED \u2014 non-production function. Set window.__ARES_OPEN_POS_DEBUG__=true to enable for testing.')
    return null
  }
  const wallet = ARES.wallet, positions = ARES.positions
  if (!wallet || !positions) return null
  try { if (typeof w.AT !== 'undefined' && (w.AT.killTriggered || w.AT.killSwitch)) { console.warn('[ARES] Kill-switch active \u2014 blocking open'); return null } } catch (_) { }
  let markPrice = 0
  try { if (typeof w.S !== 'undefined' && w.S.price) markPrice = w.S.price; else { const _lk = (typeof safeLastKline === 'function') ? safeLastKline() : null; if (_lk) markPrice = _lk.close } } catch (_) { }
  if (!markPrice || markPrice <= 0) { console.warn('[ARES] No mark price \u2014 blocking open'); return null }
  const confidence = Math.min(100, Math.max(0, opts.confidence || 50))
  const bal = wallet.balance, avail = wallet.available, openCount = positions.getOpen().length
  if (avail <= 0) { console.warn('[ARES] No available funds'); return null }
  function calcStakeVirtual(balance: number, available: number, openPositionsCount: number, confidenceScore: number, volatilityScore: number) {
    let maxPos; if (balance < 300) maxPos = 1; else if (balance < 1000) maxPos = 2; else if (balance < 5000) maxPos = 3; else maxPos = 5
    if (openPositionsCount >= maxPos) return null
    let stakePct; if (balance < 300) stakePct = 0.10; else if (balance < 1000) stakePct = 0.12; else if (balance < 5000) stakePct = 0.15; else if (balance < 10000) stakePct = 0.18; else stakePct = 0.20
    if (confidenceScore >= 80) stakePct += 0.03
    const volScore = volatilityScore || 0; if (volScore >= 80) stakePct -= 0.05
    stakePct = Math.min(0.25, Math.max(0.05, stakePct))
    let stake = balance * stakePct; stake = Math.max(5, Math.min(stake, available, balance * 0.25))
    return Math.round(stake * 100) / 100
  }
  let volScore = 50
  try { if (typeof w.S !== 'undefined' && w.S.atr && markPrice > 0) { const atrPct = (w.S.atr / markPrice) * 100; volScore = Math.min(100, Math.round(atrPct / 3 * 100)) } } catch (_) { }
  const stakeVirtual = calcStakeVirtual(bal, avail, openCount, confidence, volScore)
  if (stakeVirtual === null) { console.warn('[ARES] Max positions reached'); return null }
  if (!wallet.reserve(stakeVirtual)) { console.warn('[ARES] reserve failed'); return null }
  let atrPct = 1.5
  try { if (typeof w.S !== 'undefined' && w.S.atr && markPrice > 0) atrPct = (w.S.atr / markPrice) * 100 } catch (_) { }
  const L = Math.min(100, Math.max(10, Math.round(10 + 0.5 * confidence - 2 * atrPct)))
  let notional = Math.round(stakeVirtual * L * 10) / 10; if (notional < 5) notional = 5
  const feesEst = wallet.roundTripFees(notional)
  const targetNetPnL = Math.max(5, Math.round(notional * 0.005))
  const pos = positions.open({ side: opts.side || 'LONG', leverage: L, notional, entryPrice: markPrice, confidence, policy: opts.policy || 'BALANCED', reason: opts.reason || 'signal', targetNetPnL, stakeVirtual })
  console.log(`[ARES] Opened ${pos.side} BTCUSDT x${L} ISO, notional=${notional}, stake=${stakeVirtual}, fees\u2248${feesEst.toFixed(2)}, clientId=${pos.clientOrderId}`)
  try { if (typeof w._aresRender === 'function') w._aresRender() } catch (_) { }
  return pos
}
