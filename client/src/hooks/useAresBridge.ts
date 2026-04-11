/**
 * useAresBridge — syncs aresStore from engine ARES events.
 * Engine emits 'zeus:aresStateChanged' after wallet/position changes.
 * Reads complete snapshot from engine → aresStore atomic.
 * [9A-1] Event-only — polling removed (ARES has full event coverage).
 */
import { useEffect, useRef } from 'react'
import { useAresStore } from '../stores'

export function useAresBridge() {
  const registeredRef = useRef(false)

  useEffect(() => {
    if (registeredRef.current) return
    registeredRef.current = true

    function onAresChanged() {
      useAresStore.getState().syncFromEngine()
    }

    window.addEventListener('zeus:aresStateChanged', onAresChanged)
    // Initial sync on mount (engine may have state from boot)
    setTimeout(onAresChanged, 4000)

    return () => {
      window.removeEventListener('zeus:aresStateChanged', onAresChanged)
      registeredRef.current = false
    }
  }, [])
}
