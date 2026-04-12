/**
 * useAresBridge — syncs aresStore from engine ARES events.
 * Engine emits 'zeus:aresStateChanged' after wallet/position changes.
 * Reads complete snapshot from engine → aresStore atomic.
 * [9A-1] Event-only — polling removed (ARES has full event coverage).
 */
import { useEffect } from 'react'
import { useAresStore } from '../stores'

export function useAresBridge() {
  useEffect(() => {
    function onAresChanged() {
      useAresStore.getState().syncFromEngine()
    }

    window.addEventListener('zeus:aresStateChanged', onAresChanged)
    const initTimer = setTimeout(onAresChanged, 4000)

    return () => {
      window.removeEventListener('zeus:aresStateChanged', onAresChanged)
      clearTimeout(initTimer)
    }
  }, [])
}
