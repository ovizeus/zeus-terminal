// THEIA verdict — pure synthesis of REAL readiness inputs into one honest traffic-light.
// No data fetching here; callers pass real values read from stores/endpoints.
export interface TheiaVerdictInput {
  circuitOpen: boolean        // exchange circuit breaker open (real: /api/health or telemetry)
  halted: boolean             // global trading halt (real: /api/.../halt)
  dataStalled: boolean        // price/kline feed stalled (real: window.S.dataStalled)
  killTriggered: boolean      // kill-switch fired (real: useATStore)
  parityPct: number | null    // brain↔server parity match % 0..1 (real: /api/parity/report); null = unknown
  regimeStable: boolean       // regime not flipping (real: brain/market regime recent stability)
  testnetPnlTrend: 'up' | 'flat' | 'down' | 'unknown'  // real: closed-trade pnl trend
}

export interface TheiaVerdict {
  level: 'green' | 'amber' | 'red'
  reason: string
  breakdown: { key: string; ok: boolean; soft?: boolean; note: string }[]
}

const PARITY_FLOOR = 0.85

export function computeTheiaVerdict(i: TheiaVerdictInput): TheiaVerdict {
  const breakdown: TheiaVerdict['breakdown'] = []
  // Hard (RED) gates — any one fails → not fit to run autonomously.
  const hard: { key: string; bad: boolean; note: string }[] = [
    { key: 'circuit', bad: i.circuitOpen, note: 'exchange circuit breaker open' },
    { key: 'halt', bad: i.halted, note: 'global trading halt active' },
    { key: 'data', bad: i.dataStalled, note: 'price/data feed stalled' },
    { key: 'kill', bad: i.killTriggered, note: 'kill-switch triggered' },
  ]
  for (const h of hard) breakdown.push({ key: h.key, ok: !h.bad, note: h.bad ? h.note : 'ok' })
  const firstHard = hard.find(h => h.bad)

  // Soft (AMBER) concerns.
  const soft: { key: string; bad: boolean; note: string }[] = [
    { key: 'parity', bad: i.parityPct != null && i.parityPct < PARITY_FLOOR, note: `brain parity below ${Math.round(PARITY_FLOOR * 100)}%` },
    { key: 'regime', bad: !i.regimeStable, note: 'regime unstable / flipping' },
    { key: 'pnl', bad: i.testnetPnlTrend === 'down', note: 'testnet P&L trending down' },
  ]
  for (const s of soft) breakdown.push({ key: s.key, ok: !s.bad, soft: true, note: s.bad ? s.note : 'ok' })
  const firstSoft = soft.find(s => s.bad)

  if (firstHard) return { level: 'red', reason: `Not fit to run — ${firstHard.note}.`, breakdown }
  if (firstSoft) return { level: 'amber', reason: `Caution — ${firstSoft.note}.`, breakdown }
  return { level: 'green', reason: 'Fit to run autonomously — all checks healthy.', breakdown }
}
