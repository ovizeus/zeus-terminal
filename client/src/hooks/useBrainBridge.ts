/**
 * useBrainBridge — syncs brainStore from engine brain cycle events.
 *
 * Engine (brain.ts) emits 'zeus:brainStateChanged' once at the end of
 * each complete brain cycle (runBrainUpdate). config.ts _coreTickMI() and
 * marketDataWS.ts setSymbol() also emit after BM writes.
 * This hook reads a COMPLETE SNAPSHOT from window.BM + window.BRAIN and
 * applies it atomically to brainStore via syncFromEngine() (single set() call).
 *
 * [9A-2] Event-only — polling removed (3 dispatch sites cover all BM/BRAIN writes).
 */
import { useEffect } from 'react'
import { useBrainStore } from '../stores'

export function useBrainBridge() {
  useEffect(() => {
    function onBrainChanged() {
      useBrainStore.getState().syncFromEngine()
    }

    window.addEventListener('zeus:brainStateChanged', onBrainChanged)
    // Initial read after bridge loads
    const initTimer = setTimeout(onBrainChanged, 3000)

    return () => {
      window.removeEventListener('zeus:brainStateChanged', onBrainChanged)
      clearTimeout(initTimer)
    }
  }, [])
}
