// Quantitative Monitor — State layer
// Reads from Zeus w.S where available, manages QM-specific state locally
const w = window as any

// QM-local state that doesn't belong on w.S
export const QM = {
  logs: [] as { t: string; tag: string; msg: string }[],
  wallet: { address: '', btcSize: 0, usdValue: 0, note: '', riskPct: 1 },
  session: { entries: [] as any[], pnl: 0, peak: 0, drawdown: 0, startTime: Date.now(), lastAct: 'HOLD', lastPrice: 0, wins: 0, losses: 0, totalTrades: 0 },
  macroEvents: [
    { name: 'FOMC', date: new Date('2025-05-07T18:00:00Z') },
    { name: 'FOMC', date: new Date('2025-06-18T18:00:00Z') },
    { name: 'FOMC', date: new Date('2025-07-30T18:00:00Z') },
    { name: 'CPI', date: new Date('2025-05-13T12:30:00Z') },
    { name: 'CPI', date: new Date('2025-06-11T12:30:00Z') },
    { name: 'CPI', date: new Date('2025-07-15T12:30:00Z') },
    { name: 'NFP', date: new Date('2025-05-02T12:30:00Z') },
    { name: 'NFP', date: new Date('2025-06-06T12:30:00Z') },
    { name: 'NFP', date: new Date('2025-07-03T12:30:00Z') },
  ],
  liqAgg: {
    binance: { btc: [] as any[], totalBtc: 0 },
    bybit: { btc: [] as any[], totalBtc: 0 },
    okx: { btc: [] as any[], totalBtc: 0 },
  },
  // QM extended state on w.S (populated by engines)
  // fearGreed, cascadeRisk, cascadeZone, orderFlowDelta, ofdHist,
  // bbUpper, bbLower, bbMiddle, bbWidth, bbSqueeze, bbPos
  // srLevels, nearestSupport, nearestResist
  // trend1m, trend5m, trend15m, emaCrossStr
  // divergence, tapeSpeed, ticksPerSec
  // ariaPatterns, ariaMTF, ariaWatch, ariaCandleType
  // wyckoffPhase, wyckoffEvent, wyckoffBias
  // vpNodes, vpPOC, vpVAH, vpVAL
  // flow: vacVel, vacDir, iceActive, flipActive, mmState, exhaustActive, voidActive, stopState, smfState, flowState
  // mtf: mtfAlignScore, trapRatePct, magnetUpPct, magnetDnPct, reRegime, pfPhase, pfRisk
  // cvdDivergence, cvdDivDir
}

export function qmLog(tag: string, msg: string): void {
  const d = new Date()
  const t = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`
  QM.logs.unshift({ t, tag, msg })
  if (QM.logs.length > 80) QM.logs.pop()
}

export function addLiq(exchange: string, liq: any): void {
  const ex = (QM.liqAgg as any)[exchange]
  if (!ex) return
  ex.btc.push(liq)
  if (ex.btc.length > 300) ex.btc.shift()
  ex.totalBtc += liq.vol
}

export function getLiqTotals(): { total: number; count: number } {
  let total = 0, count = 0
  ;(['binance', 'bybit', 'okx'] as const).forEach(ex => {
    total += (QM.liqAgg as any)[ex].totalBtc
    count += (QM.liqAgg as any)[ex].btc.length
  })
  return { total, count }
}

// Bridge: read Zeus data or QM-local data
export function getPrice(): number { return w.S?.price || 0 }
export function getKlines(): any[] { return w.S?.klines || [] }
export function getBids(): any[] { return w.S?.bids || [] }
export function getAsks(): any[] { return w.S?.asks || [] }
export function getSymbol(): string { return w.S?.symbol || 'BTCUSDT' }
