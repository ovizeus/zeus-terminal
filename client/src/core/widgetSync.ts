/**
 * widgetSync — pushes live Zeus snapshot into the native Android widget via the
 * ZeusWidget Capacitor plugin. No-op on web (plugin absent). Runs every 30s.
 */
const w = window as any

function num(x: any, def = 0): number {
  const n = Number(x)
  return Number.isFinite(n) ? n : def
}

function fmtMoney(v: number): string {
  const sign = v < 0 ? '-' : ''
  const a = Math.abs(v)
  if (a >= 10000) return sign + '$' + a.toLocaleString('en-US', { maximumFractionDigits: 0 })
  if (a >= 100) return sign + '$' + a.toFixed(0)
  return sign + '$' + a.toFixed(2)
}

function fmtPnl(v: number): string {
  if (v === 0) return '$0'
  const sign = v > 0 ? '+' : '-'
  const a = Math.abs(v)
  if (a >= 1000) return sign + '$' + a.toLocaleString('en-US', { maximumFractionDigits: 0 })
  return sign + '$' + a.toFixed(2)
}

function buildSnapshot(): any {
  const AT = w.AT || {}
  const TP = w.TP || {}
  const BM = w.BM || {}
  const isLive = AT.mode === 'live'
  const balance = isLive ? num(TP.liveBalance) : num(TP.demoBalance)
  const positions = isLive ? (TP.livePositions || []) : (TP.demoPositions || [])
  const openCount = Array.isArray(positions) ? positions.filter((p: any) => !p.closed).length : 0
  const pnlToday = num(AT.realizedDailyPnL)
  const brainScore = Math.round(num(BM.confluenceScore))
  return {
    balance: fmtMoney(balance),
    pnlToday: fmtPnl(pnlToday),
    pnlTodayNum: pnlToday,
    openPositions: openCount,
    atEnabled: !!AT.enabled,
    atMode: (AT.mode || 'demo').toUpperCase(),
    brainMode: (BM.mode || 'assist').toUpperCase(),
    brainScore,
  }
}

let _widgetInterval: any = null

export function startWidgetSync() {
  const cap = w.Capacitor
  if (!cap || !cap.isNativePlatform || !cap.isNativePlatform()) return
  const plugin = cap.Plugins && cap.Plugins.ZeusWidget
  if (!plugin || typeof plugin.updateSnapshot !== 'function') return

  async function push() {
    try {
      const snap = buildSnapshot()
      await plugin.updateSnapshot(snap)
    } catch (e: any) {
      try { console.warn('[WIDGET]', e?.message || e) } catch (_) {}
    }
  }

  push()
  if (!_widgetInterval) _widgetInterval = setInterval(push, 30000)

  try {
    document.addEventListener('visibilitychange', () => { if (!document.hidden) push() })
    window.addEventListener('zeus:atStateChanged', push)
  } catch (_) {}
}
