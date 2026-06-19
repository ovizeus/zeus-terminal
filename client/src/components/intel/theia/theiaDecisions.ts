// THEIA recent-decisions pure helpers — formatting only, no data access. Unit-tested.

// Relative time label from a ms timestamp. '—' for missing/invalid.
export function _relTime(ts: number, nowMs: number): string {
  if (!ts || typeof ts !== 'number' || !isFinite(ts)) return '—'
  const d = Math.max(0, nowMs - ts)
  if (d < 10_000) return 'now'
  if (d < 60_000) return `${Math.floor(d / 1000)}s ago`
  if (d < 3_600_000) return `${Math.floor(d / 60_000)}m ago`
  if (d < 86_400_000) return `${Math.floor(d / 3_600_000)}h ago`
  return `${Math.floor(d / 86_400_000)}d ago`
}

// Color for a decision action/direction: green long, red short, dim otherwise.
export function _decisionColor(action: string): string {
  const a = (action || '').toUpperCase()
  if (a === 'LONG' || a === 'BUY') return '#00d97a'
  if (a === 'SHORT' || a === 'SELL') return '#ff6680'
  return '#7a9ab8'
}
