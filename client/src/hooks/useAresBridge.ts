/**
 * useAresBridge — syncs aresStore from engine ARES events.
 * Engine emits 'zeus:aresStateChanged' after wallet/position changes.
 * Reads complete snapshot from engine → aresStore atomic.
 * Safety: cleanup, useRef guard, polling 10s fallback.
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
    const pollTimer = setInterval(onAresChanged, 10000) // ARES is slow cadence
    setTimeout(onAresChanged, 4000)

    return () => {
      window.removeEventListener('zeus:aresStateChanged', onAresChanged)
      clearInterval(pollTimer)
      registeredRef.current = false
    }
  }, [])
}
