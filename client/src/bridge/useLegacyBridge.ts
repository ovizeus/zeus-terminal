/**
 * React hook — activates the legacy JS bridge after mount + auth.
 *
 * When bridge is active:
 *   - Old JS scripts are loaded and startApp() is called
 *   - Old brain/orderflow/trading engines run and populate DOM
 *   - React's own brain/forecast engines are disabled (old ones are more complete)
 *   - React still handles: DOM structure, auth, theme, page navigation
 */

import { useEffect, useRef } from 'react'
import { startLegacyBridge, isBridgeActive } from './legacyLoader'

export function useLegacyBridge(authenticated: boolean): void {
  const bridgeStarted = useRef(false)

  useEffect(() => {
    if (!authenticated) return
    if (bridgeStarted.current) return
    if (isBridgeActive()) return

    bridgeStarted.current = true

    // Wait for React to finish rendering DOM before loading old JS.
    // Old JS needs getElementById() to find React-rendered elements.
    // requestAnimationFrame ensures the paint is done.
    requestAnimationFrame(() => {
      setTimeout(async () => {
        console.log('[BRIDGE] React DOM ready — starting legacy bridge')
        try {
          const result = await startLegacyBridge()
          if (result.error) {
            console.error('[BRIDGE] Bridge completed with error:', result.error)
          } else {
            console.log('[BRIDGE] Bridge active — old JS populating React DOM')
          }
        } catch (err) {
          console.error('[BRIDGE] Fatal bridge error:', err)
        }
      }, 500) // 500ms delay to ensure React paint + DOM IDs are stable
    })
  }, [authenticated])
}
