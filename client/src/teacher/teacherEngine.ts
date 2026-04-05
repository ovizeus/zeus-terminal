// Zeus — teacher/teacherEngine.ts
// Ported 1:1 from public/js/teacher/teacherEngine.js (Phase 7C)
// THE TEACHER — Replay engine

const w = window as any

let _teacherPlayTimer: any = null
let _teacherOnTick: any = null
let _teacherOnComplete: any = null

export function teacherInitReplay(dataset: any, opts?: any): any {
  opts = opts || {}; const T = w.TEACHER; if (!T) throw new Error('TEACHER state not initialized')
  const validation = w.teacherValidateDataset(dataset); if (!validation.valid) throw new Error('Invalid dataset: ' + validation.errors.join(', '))
  teacherStopReplay()
  T.dataset = dataset; T.cursor = opts.startBar || Math.min(w.TEACHER_REPLAY_DEFAULTS.lookback, dataset.bars.length - 1)
  T.replaying = false; T.paused = false; T.openTrade = null; T.trades = []; T.stats = null
  _teacherOnTick = typeof opts.onTick === 'function' ? opts.onTick : null
  _teacherOnComplete = typeof opts.onComplete === 'function' ? opts.onComplete : null
  _teacherComputeAtCursor()
  return { totalBars: dataset.bars.length, startCursor: T.cursor, tf: dataset.tf, range: dataset.range }
}

function _teacherComputeAtCursor(): any {
  const T = w.TEACHER; if (!T || !T.dataset || !T.dataset.bars) return
  const visibleBars = T.dataset.bars.slice(0, T.cursor + 1)
  T.indicators = w.teacherComputeIndicators(visibleBars)
  return T.indicators
}

export function teacherStep(n?: any): any {
  n = n || 1; const T = w.TEACHER; if (!T || !T.dataset) return null
  const maxCursor = T.dataset.bars.length - 1
  if (T.cursor >= maxCursor) { _teacherReplayEnd(); return null }
  T.cursor = Math.min(T.cursor + n, maxCursor); _teacherComputeAtCursor()
  const bar = T.dataset.bars[T.cursor]; const prevBar = T.cursor > 0 ? T.dataset.bars[T.cursor - 1] : null
  const tick: any = { barIndex: T.cursor, bar, prevBar, indicators: T.indicators, progress: T.cursor / maxCursor, barsLeft: maxCursor - T.cursor, openTrade: T.openTrade }
  if (T.openTrade) _teacherProcessTradeBar(tick)
  if (_teacherOnTick) { try { _teacherOnTick(tick) } catch (e: any) { console.warn('[TEACHER] onTick error:', e.message) } }
  if (T.cursor >= maxCursor) _teacherReplayEnd()
  return tick
}

export function teacherStepBack(n?: any): any {
  n = n || 1; const T = w.TEACHER; if (!T || !T.dataset) return null
  T.cursor = Math.max(0, T.cursor - n); _teacherComputeAtCursor()
  const bar = T.dataset.bars[T.cursor]
  return { barIndex: T.cursor, bar, indicators: T.indicators, progress: T.cursor / (T.dataset.bars.length - 1), barsLeft: T.dataset.bars.length - 1 - T.cursor, openTrade: T.openTrade }
}

export function teacherJumpTo(index: any): any {
  const T = w.TEACHER; if (!T || !T.dataset) return null
  index = Math.max(0, Math.min(index, T.dataset.bars.length - 1)); T.cursor = index; _teacherComputeAtCursor()
  const bar = T.dataset.bars[T.cursor]
  return { barIndex: T.cursor, bar, indicators: T.indicators, progress: T.cursor / (T.dataset.bars.length - 1), barsLeft: T.dataset.bars.length - 1 - T.cursor, openTrade: T.openTrade }
}

export function teacherPlay(): boolean {
  const T = w.TEACHER; if (!T || !T.dataset) return false; if (T.replaying && !T.paused) return false
  T.replaying = true; T.paused = false; const speed = T.config.speedMs || w.TEACHER_REPLAY_DEFAULTS.speedMs
  _teacherPlayTimer = setInterval(function () { const result = teacherStep(1); if (!result) teacherStopReplay() }, speed)
  return true
}

export function teacherPause(): boolean {
  const T = w.TEACHER; if (!T) return false; T.paused = true
  if (_teacherPlayTimer) { clearInterval(_teacherPlayTimer); _teacherPlayTimer = null }; return true
}

export function teacherStopReplay(): void {
  const T = w.TEACHER; if (T) { T.replaying = false; T.paused = false }
  if (_teacherPlayTimer) { clearInterval(_teacherPlayTimer); _teacherPlayTimer = null }
}

export function teacherSetSpeed(ms: any): void {
  const T = w.TEACHER; if (!T) return; ms = Math.max(50, Math.min(5000, ms || 500)); T.config.speedMs = ms
  if (T.replaying && !T.paused) { teacherPause(); teacherPlay() }
}

function _teacherProcessTradeBar(tick: any): void {
  const T = w.TEACHER; const trade = T.openTrade; if (!trade) return; const bar = tick.bar; const isLong = trade.side === 'LONG'
  if (trade.dsl && trade.dsl.enabled) {
    const moveFromEntry = isLong ? (bar.high - trade.entry) / trade.entry * 100 : (trade.entry - bar.low) / trade.entry * 100
    if (!trade.dsl.active && moveFromEntry >= trade.dsl.activation) { trade.dsl.active = true; trade.dsl.bestPrice = isLong ? bar.high : bar.low }
    if (trade.dsl.active) {
      if (isLong) { if (bar.high > trade.dsl.bestPrice) trade.dsl.bestPrice = bar.high; trade.sl = trade.dsl.bestPrice * (1 - trade.dsl.trailPct / 100) }
      else { if (bar.low < trade.dsl.bestPrice) trade.dsl.bestPrice = bar.low; trade.sl = trade.dsl.bestPrice * (1 + trade.dsl.trailPct / 100) }
    }
  }
  if (trade.sl) { const slHit = isLong ? (bar.low <= trade.sl) : (bar.high >= trade.sl); if (slHit) { const reason = (trade.dsl && trade.dsl.active) ? 'DSL_HIT' : 'SL_HIT'; _teacherCloseTrade(trade.sl, reason, tick); return } }
  if (trade.tp) { const tpHit = isLong ? (bar.high >= trade.tp) : (bar.low <= trade.tp); if (tpHit) { _teacherCloseTrade(trade.tp, 'TP_HIT', tick); return } }
  trade.unrealizedPnl = _teacherCalcPnl(trade, bar.close); trade.barsHeld = tick.barIndex - trade.entryBar
}

export function teacherOpenTrade(side: any, overrides?: any): any {
  const T = w.TEACHER; if (!T || !T.dataset) return null; if (T.openTrade) return null; if (side !== 'LONG' && side !== 'SHORT') return null
  const bar = T.dataset.bars[T.cursor]; if (!bar) return null
  const cfg = T.config; const ov = overrides || {}; const entry = bar.close
  const leverage = Math.min(ov.leverageX || cfg.leverageX, w.TEACHER_TRADE_DEFAULTS.maxLeverage)
  const capital = cfg.capitalUSD; const notional = capital * leverage; const qty = notional / entry
  const slPct = ov.slPct || cfg.slPct; const tpPct = ov.tpPct || cfg.tpPct
  let slPrice: any, tpPrice: any
  if (side === 'LONG') { slPrice = entry * (1 - slPct / 100); tpPrice = entry * (1 + tpPct / 100) }
  else { slPrice = entry * (1 + slPct / 100); tpPrice = entry * (1 - tpPct / 100) }
  const feeProfile = ov.feeProfile || cfg.feeProfile; const orderType = ov.orderType || cfg.orderType
  const fees = w.teacherEstimateFees(notional, orderType, feeProfile)
  const dslEnabled = ov.dslEnabled !== undefined ? ov.dslEnabled : cfg.dslEnabled
  const dsl = dslEnabled ? { enabled: true, active: false, activation: ov.dslActivation || cfg.dslActivation, trailPct: ov.dslTrailPct || cfg.dslTrailPct, bestPrice: entry } : { enabled: false, active: false }
  const entryReasons = _teacherAutoTagEntry(side, T.indicators)
  const trade = { id: 'T_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6), side, entry, sl: slPrice, tp: tpPrice, dsl, entryBar: T.cursor, entryTs: bar.time, leverage, qty, notional, capital, entryFee: fees.entryFee + fees.slippage / 2, feeProfile, orderType, entryReasons, unrealizedPnl: 0, barsHeld: 0 }
  T.openTrade = trade; return trade
}

function _teacherCloseTrade(exitPrice: any, reason: any, tick: any): any {
  const T = w.TEACHER; if (!T || !T.openTrade) return null
  const trade = T.openTrade; const isLong = trade.side === 'LONG'; const bar = tick ? tick.bar : (T.dataset ? T.dataset.bars[T.cursor] : null)
  const priceDiff = isLong ? (exitPrice - trade.entry) : (trade.entry - exitPrice); const pnlRaw = priceDiff * trade.qty
  const exitFees = w.teacherEstimateFees(trade.notional, trade.orderType, trade.feeProfile); const exitFee = exitFees.exitFee + exitFees.slippage / 2; const totalFees = trade.entryFee + exitFee
  const pnlNet = pnlRaw - totalFees; const pnlPct = trade.capital > 0 ? (pnlNet / trade.capital) * 100 : 0
  const closedTrade = { id: trade.id, side: trade.side, entry: trade.entry, exit: exitPrice, sl: trade.sl, tp: trade.tp, leverage: trade.leverage, qty: trade.qty, notional: trade.notional, capital: trade.capital, entryBar: trade.entryBar, exitBar: T.cursor, entryTs: trade.entryTs, exitTs: bar ? bar.time : 0, barsHeld: T.cursor - trade.entryBar, pnlRaw: parseFloat(pnlRaw.toFixed(4)), pnlNet: parseFloat(pnlNet.toFixed(4)), pnlPct: parseFloat(pnlPct.toFixed(2)), totalFees: parseFloat(totalFees.toFixed(4)), exitReason: reason, entryReasons: trade.entryReasons, outcome: pnlNet > 0.01 ? 'WIN' : pnlNet < -0.01 ? 'LOSS' : 'BREAKEVEN', dslUsed: trade.dsl && trade.dsl.active, indicators: { entryRSI: null, exitRSI: T.indicators.rsi, entryConfluence: null, exitConfluence: T.indicators.confluence, regime: T.indicators.regime } }
  T.trades.push(closedTrade); if (T.trades.length > 1000) T.trades = T.trades.slice(-1000); T.openTrade = null; return closedTrade
}

export function teacherCloseTrade(reason?: any): any {
  const T = w.TEACHER; if (!T || !T.openTrade || !T.dataset) return null
  const bar = T.dataset.bars[T.cursor]; if (!bar) return null
  return _teacherCloseTrade(bar.close, reason || 'MANUAL_EXIT', { bar, barIndex: T.cursor })
}

function _teacherCalcPnl(trade: any, currentPrice: any): number {
  if (!trade) return 0; const diff = trade.side === 'LONG' ? (currentPrice - trade.entry) : (trade.entry - currentPrice)
  return parseFloat((diff * trade.qty).toFixed(4))
}

function _teacherAutoTagEntry(side: any, ind: any): any[] {
  const tags: any[] = []; if (!ind) return tags; const isLong = side === 'LONG'
  if (ind.rsi !== null) { if (ind.rsi < 30 && isLong) tags.push('RSI_OVERSOLD'); if (ind.rsi > 70 && !isLong) tags.push('RSI_OVERBOUGHT') }
  if (ind.macdDir === 'bull' && isLong) tags.push('MACD_CROSS_BULL'); if (ind.macdDir === 'bear' && !isLong) tags.push('MACD_CROSS_BEAR')
  if (ind.stDir === 'bull' && isLong) tags.push('ST_FLIP_BULL'); if (ind.stDir === 'bear' && !isLong) tags.push('ST_FLIP_BEAR')
  if (ind.bbSqueeze) tags.push('BB_SQUEEZE_BREAK')
  if (ind.adx !== null) { if (ind.adx >= 25) tags.push('HIGH_ADX_TREND'); else tags.push('LOW_ADX_RANGE') }
  if (ind.confluence >= 70 && isLong) tags.push('CONFLUENCE_HIGH'); if (ind.confluence <= 30 && !isLong) tags.push('CONFLUENCE_LOW')
  if (ind.divergence) { if (ind.divergence.type === 'bull' && isLong) tags.push('DIVERGENCE_BULL'); if (ind.divergence.type === 'bear' && !isLong) tags.push('DIVERGENCE_BEAR') }
  if (ind.climax) tags.push('VOLUME_CLIMAX')
  if (ind.regime === 'TREND') tags.push('REGIME_TREND'); if (ind.regime === 'BREAKOUT') tags.push('REGIME_BREAKOUT'); if (ind.regime === 'RANGE') tags.push('REGIME_RANGE')
  return tags
}

function _teacherReplayEnd(): void {
  teacherStopReplay(); const T = w.TEACHER; if (!T) return
  if (T.openTrade && T.dataset && T.dataset.bars.length) { const lastBar = T.dataset.bars[T.dataset.bars.length - 1]; _teacherCloseTrade(lastBar.close, 'MAX_BARS_EXIT', { bar: lastBar, barIndex: T.dataset.bars.length - 1 }) }
  const summary = _teacherBuildSessionSummary()
  if (_teacherOnComplete) { try { _teacherOnComplete(summary) } catch (e: any) { console.warn('[TEACHER] onComplete error:', e.message) } }
}

function _teacherBuildSessionSummary(): any {
  const T = w.TEACHER; if (!T) return null; const trades = T.trades
  let wins = 0, losses = 0, breakeven = 0, totalPnl = 0, grossProfit = 0, grossLoss = 0, totalFees = 0
  for (let i = 0; i < trades.length; i++) { const t = trades[i]; totalPnl += t.pnlNet; totalFees += t.totalFees; if (t.outcome === 'WIN') { wins++; grossProfit += t.pnlNet } else if (t.outcome === 'LOSS') { losses++; grossLoss += Math.abs(t.pnlNet) } else breakeven++ }
  const totalTrades = trades.length; const winRate = totalTrades > 0 ? (wins / totalTrades) * 100 : 0
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? 999 : 0
  const avgWin = wins > 0 ? grossProfit / wins : 0; const avgLoss = losses > 0 ? grossLoss / losses : 0
  return { sessionId: 'S_' + Date.now(), tf: T.dataset ? T.dataset.tf : '?', totalBars: T.dataset ? T.dataset.bars.length : 0, barsReplayed: T.cursor + 1, totalTrades, wins, losses, breakeven, winRate: parseFloat(winRate.toFixed(1)), totalPnl: parseFloat(totalPnl.toFixed(2)), grossProfit: parseFloat(grossProfit.toFixed(2)), grossLoss: parseFloat(grossLoss.toFixed(2)), profitFactor: parseFloat(profitFactor.toFixed(2)), avgWin: parseFloat(avgWin.toFixed(2)), avgLoss: parseFloat(avgLoss.toFixed(2)), totalFees: parseFloat(totalFees.toFixed(2)), trades }
}

export function teacherGetSnapshot(): any {
  const T = w.TEACHER; if (!T || !T.dataset) return null; const maxCursor = T.dataset.bars.length - 1; const bar = T.dataset.bars[T.cursor]
  return { cursor: T.cursor, totalBars: T.dataset.bars.length, progress: maxCursor > 0 ? T.cursor / maxCursor : 0, barsLeft: maxCursor - T.cursor, bar, indicators: T.indicators, openTrade: T.openTrade, tradeCount: T.trades.length, replaying: T.replaying, paused: T.paused, tf: T.dataset.tf }
}

;(function _teacherEngineGlobals() {
  if (typeof window !== 'undefined') {
    w.teacherInitReplay = teacherInitReplay; w.teacherStep = teacherStep; w.teacherStepBack = teacherStepBack
    w.teacherJumpTo = teacherJumpTo; w.teacherPlay = teacherPlay; w.teacherPause = teacherPause
    w.teacherStopReplay = teacherStopReplay; w.teacherSetSpeed = teacherSetSpeed
    w.teacherOpenTrade = teacherOpenTrade; w.teacherCloseTrade = teacherCloseTrade
    w._teacherCloseTrade = _teacherCloseTrade; w._teacherAutoTagEntry = _teacherAutoTagEntry
    w.teacherGetSnapshot = teacherGetSnapshot
  }
})()
