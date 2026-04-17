import { atLog } from '../trading/autotrade'
/**
 * Zeus Terminal — AT state + Predator + ConfirmClose (ported from public/js/core/events.js)
 *
 * NOTE: AT object must remain a plain mutable object on window.AT
 * because 15+ old JS modules mutate it directly (AT.enabled = true, AT.totalPnL += x, etc.)
 * It is NOT backed by a React store — just a global mutable object.
 */

// ── AutoTrade engine state ──
export const AT = {
  enabled: false,
  mode: 'demo' as 'demo' | 'live',
  running: false,
  killTriggered: false,
  interval: null as ReturnType<typeof setInterval> | null,
  totalTrades: 0,
  wins: 0,
  losses: 0,
  totalPnL: 0,
  dailyPnL: 0,
  realizedDailyPnL: 0,
  closedTradesToday: 0,
  dailyStart: new Date().toDateString(),
  lastTradeSide: null as string | null,
  lastTradeTs: 0,
  cooldownMs: 120000,
  _cooldownBySymbol: {} as Record<string, number>,
  _killTriggeredTs: 0,
  log: [] as unknown[],
  // Server mode fields (set by bridge/server sync)
  _serverMode: '' as string,
  _serverStats: null as unknown,
  _enabledPerMode: {} as Record<string, boolean>,
  // [R34] Diagnostics fields previously stashed via `(AT as any).x = …`.
  // Typed here so trading/autotrade.ts decision path stays inside the
  // structural type — no more ad-hoc widening on a trading surface.
  enabledAt: 0,
  killResetTs: 0,
  _lastBlockReason: '' as string,
  _lastBlockTs: 0,
  _lastBlockLogKey: '' as string,
  _lastBlockLogTs: 0,
  killLoss: 0,
  killLimit: 0,
  killBalRef: 0,
  killReason: null as string | null,
  killModeAtTrigger: null as string | null,
  killActiveAt: 0,
  _modeConfirmed: false,
  _liveExecInFlight: false,
  _wrLogTs: 0,
}

// ── Predator state ──
export const PREDATOR = {
  state: 'HUNT' as string,
  reason: 'INIT' as string,
  since: 0,
  _lastState: 'HUNT' as string,
  _lastLogTs: 0,
}

export function computePredatorState(): void {
  try {
    const w = window as Record<string, any>
    const BM = w.BM
    const _SAFETY = w._SAFETY

    const volRegime = (BM?.volRegime) ? String(BM.volRegime).toUpperCase() : 'MED'
    const lossStreak = (BM && Number.isFinite(BM.lossStreak)) ? BM.lossStreak : 0
    const dataStall = _SAFETY ? !!_SAFETY.dataStalled : false
    const riskState = BM?.riskState || 'RISK_ON'
    const alignScore = (BM?.mtf && Number.isFinite(BM.mtf.score)) ? BM.mtf.score : 50
    const cscore = (BM && Number.isFinite(BM.confluenceScore)) ? BM.confluenceScore : 50

    let ns = 'KILL'
    let nr = 'OK'

    if (dataStall) { ns = 'SLEEP'; nr = 'DATA_STALL' }
    else if (volRegime === 'EXTREME') { ns = 'SLEEP'; nr = 'VOL_EXTREME' }
    else if (lossStreak >= 3) { ns = 'SLEEP'; nr = 'LOSS_STREAK' }
    else if (riskState === 'RISK_OFF') { ns = 'HUNT'; nr = 'RISK_OFF' }
    else if (riskState === 'CHOP') { ns = 'HUNT'; nr = 'CHOP' }
    else if (volRegime === 'HIGH') { ns = 'HUNT'; nr = 'VOL_HIGH' }
    else if (alignScore < 35) { ns = 'HUNT'; nr = 'MTF_MISALIGN' }
    else if (cscore < 40) { ns = 'HUNT'; nr = 'SCORE_LOW' }

    if (ns !== PREDATOR.state) { PREDATOR.since = Date.now() }
    PREDATOR.state = ns
    PREDATOR.reason = nr

    if (typeof w.DLog !== 'undefined') {
      w.DLog.record('predator', { state: ns, reason: nr, vol: volRegime, streak: lossStreak, risk: riskState, mtf: alignScore, cscore })
    }

    // UI update — predator pills
    try {
      const pills: Record<string, string> = { SLEEP: 'pred-sleep', HUNT: 'pred-hunt', KILL: 'pred-kill' }
      const colors: Record<string, string> = { SLEEP: 'var(--red-bright)', HUNT: '#ffcc00', KILL: 'var(--grn-bright)' }
      const glows: Record<string, string> = { SLEEP: '#ff444466', HUNT: '#ffcc0066', KILL: '#00ff8866' }
      Object.keys(pills).forEach(st => {
        const el2 = document.getElementById(pills[st])
        if (!el2) return
        if (st === ns) {
          el2.style.color = colors[st]; el2.style.borderColor = colors[st]
          el2.style.boxShadow = '0 0 6px ' + glows[st]; el2.style.background = glows[st]
        } else {
          el2.style.color = '#333'; el2.style.borderColor = '#2a2a2a'
          el2.style.boxShadow = 'none'; el2.style.background = 'transparent'
        }
      })
    } catch { /* non-blocking */ }

    const now2 = Date.now()
    if (ns !== PREDATOR._lastState || (now2 - PREDATOR._lastLogTs > 30000)) {
      PREDATOR._lastState = ns; PREDATOR._lastLogTs = now2
      const msg = '[PREDATOR] ' + ns + ' [' + nr + '] vol:' + volRegime + ' streak:' + lossStreak + ' risk:' + riskState + ' mtf:' + alignScore + ' score:' + cscore
      atLog(ns === 'KILL' ? 'ok' : ns === 'HUNT' ? 'wait' : 'warn', msg)
    }
  } catch (e) {
    console.warn('[PREDATOR] error:', e)
    PREDATOR.state = 'HUNT'; PREDATOR.reason = 'ERR'
  }
}

// ── Pending close state ──
export const _pendingClose: Record<string, { timer: ReturnType<typeof setTimeout>; btnRef: HTMLElement; callback: () => void }> = {}

function _applyPendingStyle(btn: HTMLElement): void {
  btn.innerHTML = '✓ CONFIRMĂ?'
  btn.style.background = '#1a1200'
  btn.style.borderColor = 'var(--gold)'
  btn.style.color = 'var(--gold)'
}

function _resetCloseBtn(btn: HTMLElement): void {
  if (btn.getAttribute('data-close-id')) {
    btn.innerHTML = '✕ INCHIDE TOT'; btn.style.background = '#2a0010'; btn.style.borderColor = 'var(--red)'; btn.style.color = 'var(--red)'
  } else if (btn.getAttribute('data-id')) {
    btn.innerHTML = '✕ CLOSE'; btn.style.background = '#2a0010'; btn.style.borderColor = 'var(--red)'; btn.style.color = 'var(--red)'
  } else if (btn.id === 'closeAllBtn') {
    btn.innerHTML = '✕ CLOSE ALL'; btn.style.background = '#2a0010'; btn.style.borderColor = 'var(--red)'; btn.style.color = 'var(--red)'
  }
}

function _handleConfirm(posId: string, btn: HTMLElement, callback: () => void): void {
  if (_pendingClose[posId]) {
    clearTimeout(_pendingClose[posId].timer)
    delete _pendingClose[posId]
    _resetCloseBtn(btn)
    callback()
  } else {
    _applyPendingStyle(btn)
    const timer = setTimeout(() => { delete _pendingClose[posId]; _resetCloseBtn(btn) }, 2500)
    _pendingClose[posId] = { timer, btnRef: btn, callback }
  }
}

export function attachConfirmClose(btn: HTMLElement, callback: () => void): void {
  const posId = btn.getAttribute('data-id') || btn.getAttribute('data-live-id') ||
    btn.getAttribute('data-close-id') || btn.getAttribute('data-partial-id') || btn.id
  if (!posId) return

  if (_pendingClose[posId]) {
    _applyPendingStyle(btn)
    _pendingClose[posId].btnRef = btn
  }

  let touchStartX = 0, touchStartY = 0, touchMoved = false
  btn.addEventListener('touchstart', (e: TouchEvent) => { touchStartX = e.touches[0].clientX; touchStartY = e.touches[0].clientY; touchMoved = false }, { passive: true })
  btn.addEventListener('touchmove', (e: TouchEvent) => { if (Math.abs(e.touches[0].clientX - touchStartX) > 10 || Math.abs(e.touches[0].clientY - touchStartY) > 10) touchMoved = true }, { passive: true })
  btn.addEventListener('touchend', (e: Event) => { if (touchMoved) return; e.preventDefault(); _handleConfirm(posId, btn, callback) }, { passive: false })
  btn.addEventListener('click', () => { if ('ontouchstart' in window) return; _handleConfirm(posId, btn, callback) })
}

// ── Interval helpers ──
export function _safeSetInterval(fn: () => void, ms: number, name?: string): ReturnType<typeof setInterval> | null {
  const w = window as Record<string, any>
  const key = name || ('_safe_' + Math.random().toString(36).slice(2, 7))
  if (w.Intervals?.set) return w.Intervals.set(key, fn, ms)
  return setInterval(fn, ms)
}

export function _clearAllIntervals(): void {
  const w = window as Record<string, any>
  if (w.Intervals?.clearAll) w.Intervals.clearAll()
}

// Self-registration — makes phase1Adapters mapping redundant
;(window as any).AT = AT
