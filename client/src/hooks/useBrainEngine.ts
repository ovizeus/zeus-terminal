/**
 * Brain engine hook — runs brain computation on kline/market updates.
 *
 * Reads: marketStore (klines, price, rsi), atStore (enabled, stats), positionsStore
 * Writes: brainStore (all brain state)
 *
 * Runs on: every kline array change (new candle or candle update)
 */
import { useEffect, useRef } from 'react'
import { useMarketStore, useATStore, usePositionsStore } from '../stores'
import { useBrainStore } from '../stores/brainStore'
import { computeBrain, type BrainInputs, type Kline } from '../engine/brainCompute'

// Throttle brain computation to max once per 2 seconds
const THROTTLE_MS = 2000

export function useBrainEngine(authenticated: boolean) {
  const lastRunRef = useRef(0)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (!authenticated) return

    // Subscribe to market store changes
    const unsub = useMarketStore.subscribe((_state) => {
      const now = Date.now()
      if (now - lastRunRef.current < THROTTLE_MS) {
        // Schedule a delayed run if not already scheduled
        if (!timerRef.current) {
          timerRef.current = setTimeout(() => {
            timerRef.current = null
            runBrain()
          }, THROTTLE_MS)
        }
        return
      }
      runBrain()
    })

    // Initial run after a short delay (wait for klines to load)
    const initTimer = setTimeout(runBrain, 3000)

    return () => {
      unsub()
      clearTimeout(initTimer)
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [authenticated])
}

function runBrain() {
  const market = useMarketStore.getState().market
  const at = useATStore.getState()
  const pos = usePositionsStore.getState()
  const brain = useBrainStore.getState()
  const profile = brain.brain?.profile ?? 'fast'

  // Need klines to compute
  const klines = market.klines || []
  if (klines.length < 20) return // not enough data

  // Build inputs
  const inputs: BrainInputs = {
    klines: klines as Kline[],
    rsi: market.rsi as Record<string, number> || {},
    signalData: null, // no signal data available yet
    fr: typeof market.fr === 'number' ? market.fr : 0,
    ofiBlendBuy: 50, // no OF data yet
    atEnabled: at.enabled,
    openPositionCount: pos.demoPositions.length + pos.livePositions.length,
    lastTradeSide: at.lastTradeSide ?? null,
    lastTradeTs: at.lastTradeTs,
    lossStreak: brain.brain.lossStreak ?? 0,
    dailyTrades: brain.brain.dailyTrades ?? 0,
    profile,
  }

  const result = computeBrain(inputs)

  // Map results to brainStore shape
  useBrainStore.getState().patch({
    mode: brain.brain.mode || 'assist',
    confluenceScore: result.entryScore, // confluence ~ entry score
    danger: result.danger,
    entryScore: result.entryScore,
    entryReady: result.entryReady,
    conviction: result.conviction,
    convictionMult: result.convictionMult,
    volRegime: result.regime.volMode === 'expansion' ? 'HIGH' :
               result.regime.volMode === 'contraction' ? 'LOW' : 'MED',

    regimeEngine: {
      regime: result.regime.regime.toUpperCase(),
      confidence: result.regime.confidence,
      trendBias: result.regime.slope20 > 0 ? 'bull' : 'bear',
      volatilityState: result.regime.atrPct > 2.0 ? 'extreme' :
                        result.regime.atrPct > 1.0 ? 'elevated' : 'normal',
      trapRisk: 0,
      notes: [],
    },

    phaseFilter: {
      phase: result.phase.phase,
      allow: result.phase.allow,
      reason: result.phase.reason,
      riskMode: result.phase.riskMode as 'blocked' | 'reduced' | 'normal',
      sizeMultiplier: result.phase.sizeMultiplier,
      allowedSetups: result.phase.allowedSetups,
      blockedSetups: result.phase.blockedSetups,
    },

    atmosphere: {
      category: result.atmosphere.category as 'trap_risk' | 'toxic_volatility' | 'range' | 'clean_trend' | 'neutral',
      allowEntry: result.atmosphere.allowEntry,
      cautionLevel: result.atmosphere.cautionLevel as 'low' | 'medium' | 'high',
      confidence: result.atmosphere.confidence,
      reasons: result.atmosphere.reasons,
      sizeMultiplier: result.atmosphere.sizeMultiplier,
    },

    structure: {
      regime: result.regime.regime,
      adx: result.regime.adx,
      atrPct: result.regime.atrPct,
      squeeze: result.regime.squeeze,
      volMode: result.regime.volMode,
      structureLabel: result.regime.structure,
      mtfAlign: result.mtf,
      score: result.entryScore,
      lastUpdate: Date.now(),
    },

    // Sweep / flow for brain panels
    sweep: { type: result.sweep.type, reclaim: result.sweep.reclaim, displacement: result.sweep.displacement },
    flow: { cvd: result.flow.cvd, delta: result.flow.delta, ofi: result.flow.ofi },
    mtf: result.mtf,

    // Position sizing from phase filter
    positionSizing: {
      baseRiskPct: 1.0,
      regimeMult: result.phase.sizeMultiplier,
      perfMult: 1.0,
      finalMult: result.phase.sizeMultiplier * result.convictionMult,
    },

    // Liq cycle from sweep data
    liqCycle: {
      ...brain.brain.liqCycle,
      currentSweep: result.sweep.type,
      sweepDisplacement: result.sweep.displacement,
      magnetBias: result.dir === 'long' ? 'up' : 'down',
    },
  })
}
