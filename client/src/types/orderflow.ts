/** Order flow state — from orderflow.js OF object */
export interface OrderFlowState {
  deltaPct: number
  deltaVel: number
  z: number
  flags: { instAct: boolean }
  abs: { active: boolean; side: string; peakDeltaPct: number }
  exhaust: { ts: number; side: string; strength: number }
  trap: {
    active: boolean
    dir: string
    ts: number
    price: number
    absorbSide: string
    exhaustZ: number
    priceMovePct: number
  }
  vacuum: { active: boolean; dir: string; movePct: number; tps: number; vol: number }
  dFlip: {
    active: boolean
    dir: string
    prevDeltaPct: number
    curDeltaPct: number
    z: number
    priceMovePct: number
  }
  ice: {
    active: boolean
    side: string
    tps: number
    vol: number
    priceMovePct: number
    sliceDeltaPct: number
    topShare: number
  }
  health: 'OK' | 'THIN' | 'DEAD'
}

/** Teacher capability state */
export interface TeacherState {
  score: number
  label: string
  status: 'IDLE' | 'TRAINING' | 'REVIEWING'
  capital: number
  sessions: number
  trades: number
  fails: number
  currentReplay: {
    tf: string
    profile: string
    regime: string
    bars: number
    lastDecision: {
      action: string
      reasons: string[]
      confidence: number
    }
  }
  activity: Array<{
    type: 'trade' | 'review' | 'fail' | 'learn' | 'warn'
    text: string
    ts: number
  }>
  tradeHistory: Array<{
    side: string
    pnl: number
    pnlPct: number
    classification: string
    tf: string
    regime: string
  }>
  stats: {
    totalTrades: number
    winRate: number
    pnl: number
    profitFactor: number
    expectancy: number
    avgWin: number
    avgLoss: number
    best: number
    worst: number
  }
}

/** Journal entry — closed trade from /api/sync/journal */
export interface JournalEntry {
  id: string
  symbol: string
  side: 'LONG' | 'SHORT'
  entryPrice: number
  exitPrice: number
  pnl: number
  reason: string
  openTs: number
  closeTs: number
  mode: 'demo' | 'live'
}
