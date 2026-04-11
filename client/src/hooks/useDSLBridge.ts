/**
 * useDSLBridge — syncs dslStore from engine DSL events.
 *
 * Engine (dsl.ts) emits 'zeus:dslStateChanged' after toggle, interval
 * start/stop, and at end of renderDSLWidget (every 3s tick cycle).
 * This hook reads a COMPLETE SNAPSHOT from window.DSL and applies
 * atomically to dslStore.
 *
 * [9A-3] Event-only — polling removed (DSL tick emits every 3s via renderDSLWidget).
 */
import { useEffect, useRef } from 'react'
import { useDslStore } from '../stores'

export function useDSLBridge() {
  const registeredRef = useRef(false)

  useEffect(() => {
    if (registeredRef.current) return
    registeredRef.current = true

    function onDSLChanged() {
      useDslStore.getState().syncFromEngine()
    }

    window.addEventListener('zeus:dslStateChanged', onDSLChanged)
    // Initial sync on mount (engine may have state from boot)
    setTimeout(onDSLChanged, 3000)

    return () => {
      window.removeEventListener('zeus:dslStateChanged', onDSLChanged)
      registeredRef.current = false
    }
  }, [])
}
