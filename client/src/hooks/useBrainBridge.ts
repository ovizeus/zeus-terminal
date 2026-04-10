/**
 * useBrainBridge — syncs brainStore from engine brain cycle events.
 *
 * Engine (brain.ts) emits 'zeus:brainStateChanged' once at the end of
 * each complete brain cycle (runBrainUpdate). This hook reads a COMPLETE
 * SNAPSHOT from window.BM + window.BRAIN and applies it atomically to
 * brainStore via syncFromEngine() (single set() call).
 *
 * Safety:
 * - cleanup on unmount
 * - useRef guard against double registration in StrictMode
 * - polling fallback every 5s
 */
import { useEffect, useRef } from 'react'
import { useBrainStore } from '../stores'

export function useBrainBridge() {
  const registeredRef = useRef(false)

  useEffect(() => {
    if (registeredRef.current) return
    registeredRef.current = true

    function onBrainChanged() {
      useBrainStore.getState().syncFromEngine()
    }

    window.addEventListener('zeus:brainStateChanged', onBrainChanged)

    // Polling fallback every 5s (safety net)
    const pollTimer = setInterval(onBrainChanged, 5000)

    // Initial read after bridge loads
    setTimeout(onBrainChanged, 3000)

    return () => {
      window.removeEventListener('zeus:brainStateChanged', onBrainChanged)
      clearInterval(pollTimer)
      registeredRef.current = false
    }
  }, [])
}
