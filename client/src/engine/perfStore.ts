/**
 * Zeus Terminal — PERF persistence + expectancy (ported from public/js/analytics/perfStore.js)
 * Reads/writes PERF global (defined in config.js, still bridge-loaded)
 */

const w = window as Record<string, any>
const _PERF_STORAGE_KEY = 'zeus_perf_v1'

export function savePerfToStorage(): void {
  try {
    const payload: Record<string, any> = {}
    Object.keys(w.PERF).forEach(k => {
      const p = w.PERF[k]
      payload[k] = { wins: p.wins, losses: p.losses, weight: p.weight, pnlSum: p.pnlSum || 0, feeSum: p.feeSum || 0, winPnl: p.winPnl || 0, lossPnl: p.lossPnl || 0 }
    })
    if (typeof w._safeLocalStorageSet === 'function') w._safeLocalStorageSet(_PERF_STORAGE_KEY, payload)
    if (typeof w._ucMarkDirty === 'function') w._ucMarkDirty('perfStats')
    if (typeof w._userCtxPush === 'function') w._userCtxPush()
  } catch (e: any) { console.warn('[perfStore] save failed:', e.message) }
}

export function loadPerfFromStorage(): void {
  try {
    const raw = localStorage.getItem(_PERF_STORAGE_KEY); if (!raw) return
    const data = JSON.parse(raw); if (!data || typeof data !== 'object') return
    Object.keys(data).forEach(k => {
      if (!w.PERF[k]) return
      const d = data[k]
      w.PERF[k].wins = d.wins || 0; w.PERF[k].losses = d.losses || 0; w.PERF[k].weight = d.weight || 1.0
      w.PERF[k].pnlSum = d.pnlSum || 0; w.PERF[k].feeSum = d.feeSum || 0; w.PERF[k].winPnl = d.winPnl || 0; w.PERF[k].lossPnl = d.lossPnl || 0
    })
    if (typeof w.renderPerfTracker === 'function') w.renderPerfTracker()
  } catch (e: any) { console.warn('[perfStore] load failed:', e.message) }
}

export function recordIndicatorPnl(indicatorId: string, pnl: number, fees: number): void {
  const p = w.PERF[indicatorId]; if (!p) return
  const pnlVal = Number.isFinite(pnl) ? pnl : 0
  const feeVal = Number.isFinite(fees) ? fees : 0
  p.pnlSum = (p.pnlSum || 0) + pnlVal; p.feeSum = (p.feeSum || 0) + feeVal
  if (pnlVal >= 0) p.winPnl = (p.winPnl || 0) + pnlVal
  else p.lossPnl = (p.lossPnl || 0) + Math.abs(pnlVal)
}

export function calcExpectancy(indicatorId: string): number {
  const p = w.PERF[indicatorId]; if (!p) return 0
  const tot = p.wins + p.losses; if (tot < 1) return 0
  const wr = p.wins / tot
  const avgWin = p.wins > 0 ? (p.winPnl || 0) / p.wins : 0
  const avgLoss = p.losses > 0 ? (p.lossPnl || 0) / p.losses : 0
  return (wr * avgWin) - ((1 - wr) * avgLoss)
}

export function calcGlobalExpectancy(): number {
  let totalWins = 0, totalLosses = 0, totalWinPnl = 0, totalLossPnl = 0
  Object.values(w.PERF).forEach((p: any) => { totalWins += p.wins || 0; totalLosses += p.losses || 0; totalWinPnl += p.winPnl || 0; totalLossPnl += p.lossPnl || 0 })
  const tot = totalWins + totalLosses; if (tot < 1) return 0
  const wr = totalWins / tot
  return (wr * (totalWins > 0 ? totalWinPnl / totalWins : 0)) - ((1 - wr) * (totalLosses > 0 ? totalLossPnl / totalLosses : 0))
}

export function calcExpectancyByProfile(profile: string): { expectancy: number; trades: number; wr: number } {
  const journal = (w.TP && Array.isArray(w.TP.journal)) ? w.TP.journal : []
  const trades = journal.filter((t: any) => t.journalEvent === 'CLOSE' && t.exit !== null && Number.isFinite(t.pnl) && (t.profile || 'fast') === profile)
  if (!trades.length) return { expectancy: 0, trades: 0, wr: 0 }
  const wins = trades.filter((t: any) => t.pnl >= 0)
  const losses = trades.filter((t: any) => t.pnl < 0)
  const wr = wins.length / trades.length
  const avgWin = wins.length > 0 ? wins.reduce((s: number, t: any) => s + t.pnl, 0) / wins.length : 0
  const avgLoss = losses.length > 0 ? losses.reduce((s: number, t: any) => s + Math.abs(t.pnl), 0) / losses.length : 0
  return { expectancy: (wr * avgWin) - ((1 - wr) * avgLoss), trades: trades.length, wr: Math.round(wr * 100) }
}

export function resetPerfStore(): void {
  Object.keys(w.PERF).forEach(k => { w.PERF[k].wins = 0; w.PERF[k].losses = 0; w.PERF[k].weight = 1.0; w.PERF[k].pnlSum = 0; w.PERF[k].feeSum = 0; w.PERF[k].winPnl = 0; w.PERF[k].lossPnl = 0 })
  savePerfToStorage()
  if (typeof w.renderPerfTracker === 'function') w.renderPerfTracker()
}
