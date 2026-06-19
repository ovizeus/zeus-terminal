// [STATS-FIX 2026-06-01] Compute the Manual panel's Total PnL / Win Rate / Trades
// from the SAME journal entries the panel displays, so the numbers always coincide
// with the list below them. Scope (operator-decided): MANUAL trades only
// (autoTrade !== true), CURRENT mode only (demo|live), CLOSED trades only.

export interface ManualStats {
  entries: any[]   // filtered + sorted (newest first) — the rows to display
  trades: number
  pnl: number
  pnlClass: 'pos' | 'neg' | 'neut'
  wr: string
}

export function computeManualClosedStats(journal: any[], engineMode: string): ManualStats {
  const mode = engineMode === 'live' ? 'live' : 'demo'
  const entries = (Array.isArray(journal) ? journal : [])
    .filter((e: any) =>
      e
      && e.autoTrade !== true                                   // manual only
      && String(e.mode || 'demo') === mode                      // current mode only
      && (e.journalEvent === 'CLOSE' || (!e.journalEvent && (e.closedAt || e.exit != null))) // closed only
    )
    .sort((a: any, b: any) => (+(b.closedAt || b.openTs || 0)) - (+(a.closedAt || a.openTs || 0)))

  let pnl = 0
  let wins = 0
  for (const e of entries) {
    const p = Number(e.pnl) || 0
    pnl += p
    if (p > 0) wins++  // [AUDIT-20260619 P3] win = pnl>0 (match server; a 0/scratch close is not a win)
  }
  const trades = entries.length
  const pnlClass: ManualStats['pnlClass'] = pnl > 0 ? 'pos' : pnl < 0 ? 'neg' : 'neut'
  const wr = trades ? Math.round((wins / trades) * 100) + '%' : '0%'
  return { entries, trades, pnl, pnlClass, wr }
}
