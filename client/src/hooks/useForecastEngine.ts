/**
 * Forecast engine hook — runs QEB, probability score, and scenario engine.
 *
 * Reads: marketStore (klines, price, rsi, fr, oi, magnetBias),
 *        brainStore (regime, confidence, slope, adapt),
 *        positionsStore (open positions for posDir)
 * Writes: brainStore (qexit, probScore, probBreakdown, scenario via market.scenario)
 *
 * Runs on: every brainStore.structure change (regime updates from brainCompute)
 * Throttled to max once per 3 seconds.
 */
import { useEffect, useRef } from 'react'
import { useMarketStore, usePositionsStore } from '../stores'
import { useBrainStore } from '../stores/brainStore'
import { computeForecast, type ForecastInputs } from '../engine/forecastCompute'
import type { Kline } from '../engine/brainCompute'

const THROTTLE_MS = 3000

export function useForecastEngine(authenticated: boolean) {
  const lastRunRef = useRef(0)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const prevRegimeRef = useRef<string | null>(null)
  const confirmRef = useRef({ div: 0, climax: 0 })

  useEffect(() => {
    if (!authenticated) return

    // Subscribe to brain store changes (structure updates = new regime data)
    const unsub = useBrainStore.subscribe((_state) => {
      const now = Date.now()
      if (now - lastRunRef.current < THROTTLE_MS) {
        if (!timerRef.current) {
          timerRef.current = setTimeout(() => {
            timerRef.current = null
            runForecast()
          }, THROTTLE_MS)
        }
        return
      }
      runForecast()
    })

    // Initial run after brain has had time to compute
    const initTimer = setTimeout(runForecast, 5000)

    return () => {
      unsub()
      clearTimeout(initTimer)
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [authenticated])

  function runForecast() {
    lastRunRef.current = Date.now()

    const market = useMarketStore.getState().market
    const brain = useBrainStore.getState().brain
    const pos = usePositionsStore.getState()

    const klines = (market.klines || []) as Kline[]
    if (klines.length < 40) return // need enough bars for divergence

    // Determine position direction from open positions
    const allPositions = [...pos.demoPositions, ...pos.livePositions]
    const openPos = allPositions.find(p => p.status === 'OPEN')
    const posDir: 'LONG' | 'SHORT' = openPos?.side === 'SHORT' ? 'SHORT' : 'LONG'
    const hasOpenPosition = !!openPos

    const inputs: ForecastInputs = {
      klines,
      price: market.price,
      rsi5m: (market.rsi as Record<string, number>)?.['5m'] ?? 50,
      regime: brain.structure?.regime || brain.regimeEngine?.regime?.toLowerCase() || 'unknown',
      regimeConfidence: brain.regimeEngine?.confidence ?? brain.structure?.score ?? 0,
      regimeSlope: brain.structure?.regime === 'trend' ? 1 : (brain.regimeEngine?.trendBias === 'bull' ? 1 : -1),
      ofiBlendBuy: 50, // No OrderFlow data yet
      fr: typeof market.fr === 'number' ? market.fr : null,
      oi: typeof market.oi === 'number' ? market.oi : null,
      oiPrev: typeof market.oiPrev === 'number' ? market.oiPrev : null,
      magnetBias: market.magnetBias || 'neutral',
      posDir,
      hasOpenPosition,
      prevRegime: prevRegimeRef.current,
      prevConfirm: confirmRef.current,
      adaptEnabled: brain.adapt?.enabled ?? false,
      adaptExitMult: brain.adapt?.exitMult ?? 1.0,
      atrPct: brain.structure?.atrPct ?? 0,
      prevMacroComposite: brain.macro?.composite ?? 0,
    }

    const result = computeForecast(inputs)

    // Update stateful refs
    prevRegimeRef.current = result.currentRegime
    confirmRef.current = result.qexit.confirm

    // Write to brainStore
    useBrainStore.getState().patch({
      qexit: {
        ...brain.qexit,
        risk: result.qexit.risk,
        action: result.qexit.action,
        signals: result.qexit.signals,
        confirm: result.qexit.confirm,
      },
      probScore: result.probScore,
      probBreakdown: result.probBreakdown,
      macro: result.macro,
    })

    // Write scenario to marketStore (matching old S.scenario)
    useMarketStore.getState().patch({
      scenario: result.scenario,
    })
  }
}
