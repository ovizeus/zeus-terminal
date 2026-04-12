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
import { useEffect } from 'react'
import { useDslStore } from '../stores'

export function useDSLBridge() {
  useEffect(() => {
    function onDSLChanged() {
      useDslStore.getState().syncFromEngine()
    }

    window.addEventListener('zeus:dslStateChanged', onDSLChanged)
    const initTimer = setTimeout(onDSLChanged, 3000)

    return () => {
      window.removeEventListener('zeus:dslStateChanged', onDSLChanged)
      clearTimeout(initTimer)
    }
  }, [])
}
