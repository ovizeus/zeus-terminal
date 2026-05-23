import { atLog } from './autotrade'
// Zeus — trading/orders.ts
// Ported 1:1 from public/js/trading/orders.js (Phase 6B)
// Order execution flow, confirm close

const w = window as any

let _execActive = false
const _execQueue: any[] = []

// Exec overlay
// [SEC-6] TRUST CONTRACT: `html` parameter is treated as already-sanitized
// markup. Callers MUST pre-escape any user-derived sau server-derived dynamic
// values via `escHtml()` from `utils/dom` before constructing the template.
// Verified caller paths (audit 2026-05-08): positions.ts:91 + 131
// `_queueExecOverlay(html, ...)` — both build `html` cu escHtml-interpolated
// template literals (lines 82, 84-88, 123, 126-127 use escHtml on every
// dynamic field: dir/sym/mode/score/tf/dur/reason). Internal queue-recursion
// from line 23 + 31 of this file is plumbing only (passes through pre-built
// html). Adding any new caller? You MUST escape dynamic interpolations cu
// escHtml — this function does NOT perform automatic sanitization to
// preserve intentional template structure (CSS classes, icon SVG markup
// from `_ZI.*` constants). Equivalent pattern la AnalysisSections.tsx
// `dangerouslySetInnerHTML` (SEC-10 closure) — trust chain delegated la
// producer.
export function _showExecOverlay(html: any, cssClass: any, duration: any): void {
  const div = document.createElement('div')
  div.className = 'zeus-exec-overlay ' + cssClass
  div.innerHTML = html
  document.body.appendChild(div)
  requestAnimationFrame(() => requestAnimationFrame(() => div.classList.add('show')))
  setTimeout(() => {
    div.classList.add('exit-anim')
    setTimeout(() => {
      try { document.body.removeChild(div) } catch (_) {}
      _execActive = false
      if (_execQueue.length) { const next = _execQueue.shift(); _showExecOverlay(...next as [any, any, any]) }
    }, 350)
  }, duration || 2500)
}

// [SEC-6] Same trust contract as _showExecOverlay — `html` MUST be
// pre-escaped at producer site via escHtml() for any dynamic values.
export function _queueExecOverlay(html: any, cssClass: any, duration: any): void {
  if (_execActive) { _execQueue.push([html, cssClass, duration]); return }
  _execActive = true
  _showExecOverlay(html, cssClass, duration)
}

// ── ENTRY POPUP ──────────────────────────────────────────

// BM post close
export function _dayKeyLocal(): string {
  const s = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Bucharest' })
  return s // 'YYYY-MM-DD'
}

export function _bmResetDailyIfNeeded(): void {
  const k = _dayKeyLocal()
  if (w.BM._dayKey !== k) {
    w.BM._dayKey = k
    w.BM.dailyTrades = 0
    w.BM.dailyPnL = 0
    w.BM.lossStreak = 0
    w.AT.closedTradesToday = 0
    // reset protect automat la schimbare zi
    w.BM.protectMode = false
    w.BM.protectReason = ''
    atLog('info', `[DAY] New day (${k}) — dailyTrades/lossStreak/protect auto-reset`)
  }
}

// BM stats updated via postClose hook
export function _bmPostClose(pos: any, reason: any): void {
  // backward compat: dacă primul param e string, era vechiul apel fără pos
  if (typeof pos === 'string') { reason = pos; pos = null }

  const isAT = !!(pos && pos.autoTrade)

  // IMPORTANT: dailyTrades = DOAR AutoTrade (nu Paper)
  if (isAT) w.BM.dailyTrades = (w.BM.dailyTrades || 0) + 1

  if (isAT) {
    if (reason && (reason.includes('SL') || reason.includes('DSL HIT') || reason.includes('LIQ'))) {
      w.BM.lossStreak = (w.BM.lossStreak || 0) + 1
    } else if (reason && reason.includes('TP')) {
      w.BM.lossStreak = 0
    }
  }
  if (typeof w.AT !== 'undefined') w.AT.lastTradeTs = Date.now()
}


// ===== MODULE: EXECUTION =====
// ===================================================================
// ZEUS AUTO TRADE ENGINE v1.0
// Logic: Confluence Score + Multi-Signal Confirmation + Risk Mgmt
// ===================================================================
// [MOVED TO TOP] AT
