/**
 * useDSLBridge — syncs dslStore from engine DSL events.
 *
 * Engine (dsl.ts) emits 'zeus:dslStateChanged' after toggle, interval
 * start/stop, and at end of renderDSLWidget. This hook reads a COMPLETE
 * SNAPSHOT from window.DSL and applies atomically to dslStore.
 *
 * Safety: cleanup on unmount, useRef guard, polling 5s fallback.
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
    const pollTimer = setInterval(onDSLChanged, 5000)
    setTimeout(onDSLChanged, 3000)

    return () => {
      window.removeEventListener('zeus:dslStateChanged', onDSLChanged)
      clearInterval(pollTimer)
      registeredRef.current = false
    }
  }, [])
}
