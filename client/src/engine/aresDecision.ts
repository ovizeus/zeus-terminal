// Zeus — engine/aresDecision.ts
// Ported 1:1 from public/js/brain/deepdive.js lines 1200-1378 (Phase 5B2)
// ARES DECISION ENGINE — Minimal Rule-Based

const w = window as any

const MIN_CONFIDENCE = 68
const MIN_ENTRY_SCORE = 55
const MAX_OPEN_POSITIONS = 1
const MIN_BALANCE_USDT = 5
const COOLDOWN_MS = 5 * 60 * 1000
const LOSS_STREAK_BLOCK = 3
const REVENGE_COOLDOWN_MS = 10 * 60 * 1000
const TRADE_REGIMES = new Set(['trend', 'breakout'])
const TRADE_SESSIONS = new Set(['LONDON', 'NEW YORK'])

let _lastTradeTs = 0
let _lastDecision: any = null
try { _lastTradeTs = parseInt(localStorage.getItem('ARES_LAST_TRADE_TS') || '0', 10) || 0 } catch (_) { }

function _block(reasons: string[], sources: any) {
  _lastDecision = { shouldTrade: false, side: null, confidence: 0, reasons, sources, ts: Date.now() }
  return _lastDecision
}

function evaluate(): any {
  const reasons: string[] = []
  const blocks: string[] = []
  const sources: any = {}

  if (typeof w.ARES === 'undefined') return _block(['ARES not loaded'], sources)
  const bal = w.ARES.balance(); sources.balance = bal
  if (bal < MIN_BALANCE_USDT) blocks.push('Wallet too low: $' + bal.toFixed(2) + ' < $' + MIN_BALANCE_USDT)

  const avail = w.ARES.wallet.available; sources.available = avail
  if (avail < MIN_BALANCE_USDT) blocks.push('No available funds: $' + avail.toFixed(2))

  const openPos = w.ARES.positions.getOpen(); sources.openPositions = openPos.length
  if (openPos.length >= MAX_OPEN_POSITIONS) blocks.push('Max open positions reached: ' + openPos.length + '/' + MAX_OPEN_POSITIONS)

  try { if (typeof w.AT !== 'undefined' && (w.AT.killTriggered || w.AT.killSwitch)) blocks.push('Kill switch active') } catch (_) { }

  const now = Date.now()
  if (_lastTradeTs > 0 && (now - _lastTradeTs) < COOLDOWN_MS) blocks.push('Cooldown active: ' + Math.round((COOLDOWN_MS - (now - _lastTradeTs)) / 1000) + 's remaining')

  const regime = w.ARES.regime(); sources.regime = regime
  if (!TRADE_REGIMES.has(regime)) blocks.push('Regime not favorable: ' + regime + ' (need trend/breakout)')

  const session = w.ARES.session(); sources.session = session
  if (!TRADE_SESSIONS.has(session)) blocks.push('Session inactive: ' + session)

  const state = w.ARES.getState(); sources.state = state.current.id
  if (state.current.id === 'DEFENSIVE' || state.current.id === 'REVENGE_GUARD') blocks.push('ARES state: ' + state.current.id + ' \u2014 blocking trades')

  if (state.consecutiveLoss >= LOSS_STREAK_BLOCK) {
    const sinceLoss = now - state.lastLossTs
    if (sinceLoss < REVENGE_COOLDOWN_MS) blocks.push('Loss streak ' + state.consecutiveLoss + ' \u2014 revenge cooldown: ' + Math.round((REVENGE_COOLDOWN_MS - sinceLoss) / 1000) + 's')
  }

  const entryScore = w.ARES.entryScore(); sources.entryScore = entryScore
  if (entryScore < MIN_ENTRY_SCORE) blocks.push('Entry score too low: ' + entryScore + ' < ' + MIN_ENTRY_SCORE)

  const confidence = state.confidence; sources.confidence = confidence
  if (confidence < MIN_CONFIDENCE) blocks.push('Confidence too low: ' + confidence + ' < ' + MIN_CONFIDENCE)

  let side: string | null = null
  try {
    const bulls = (typeof w.S !== 'undefined' && w.S.signalData) ? (w.S.signalData.bullCount || 0) : 0
    const bears = (typeof w.S !== 'undefined' && w.S.signalData) ? (w.S.signalData.bearCount || 0) : 0
    sources.bullCount = bulls; sources.bearCount = bears
    if (bulls > bears && (regime === 'trend' || regime === 'breakout')) { side = 'LONG'; reasons.push('Signals favor LONG (' + bulls + ' bull vs ' + bears + ' bear)') }
    else if (bears > bulls && (regime === 'trend' || regime === 'breakout')) { side = 'SHORT'; reasons.push('Signals favor SHORT (' + bears + ' bear vs ' + bulls + ' bull)') }
    else blocks.push('No clear signal direction (bull=' + bulls + ' bear=' + bears + ')')
  } catch (_) { blocks.push('Signal data unavailable') }

  const atr = w.ARES.atr(); sources.atr = atr
  try {
    const price = (typeof w.S !== 'undefined' && w.S.price) ? w.S.price : 0
    if (price > 0 && atr > 0) { const atrPct = (atr / price) * 100; sources.atrPct = atrPct; if (atrPct > 3.0) blocks.push('Extreme volatility: ATR ' + atrPct.toFixed(2) + '% > 3%') }
  } catch (_) { }

  if (blocks.length > 0) return _block(blocks, sources)

  reasons.push('Regime: ' + regime); reasons.push('Session: ' + session); reasons.push('Confidence: ' + confidence)
  reasons.push('EntryScore: ' + entryScore); reasons.push('Balance: $' + bal.toFixed(2))
  _lastDecision = { shouldTrade: true, side, confidence, reasons, sources, ts: now }
  return _lastDecision
}

function recordTrade() {
  _lastTradeTs = Date.now()
  try { localStorage.setItem('ARES_LAST_TRADE_TS', String(_lastTradeTs)) } catch (_) { }
  if (typeof w._ucMarkDirty === 'function') w._ucMarkDirty('aresData')
}

function getLastDecision() { return _lastDecision }

export const ARES_DECISION = { evaluate, recordTrade, getLastDecision }
