import { useEffect } from 'react'
import { LoginPage } from './components/auth/LoginPage'
import { FlipHeader } from './components/layout/FlipHeader'
import { useProfileStore } from './stores/profileStore'
import { PanelShell } from './components/layout/PanelShell'
import { PinLockScreen } from './components/modals/PinLockScreen'
import { ConfirmDialog } from './components/common/ConfirmDialog'
import { SecurityNudgeModal } from './components/modals/SecurityNudgeModal'
import { ErrorBoundary } from './components/ErrorBoundary'
import { useUiStore, useAuthStore } from './stores'
import { useServerSync } from './hooks/useServerSync'
import { useBrainEngine } from './hooks/useBrainEngine'
import { useForecastEngine } from './hooks/useForecastEngine'
import { useLegacyBridge } from './bridge'
import { usePositionsBridge } from './hooks/usePositionsBridge'
import { useATBridge } from './hooks/useATBridge'
import { wsService } from './services/ws'
import { startSettingsRealtime, stopSettingsRealtime } from './services/settingsRealtime'
import { startPositionsRealtime, stopPositionsRealtime } from './services/positionsRealtime'
import { startMarketRadarRealtime, stopMarketRadarRealtime } from './services/marketRadarRealtime'
import { start as startLiqFeedClient, stop as stopLiqFeedClient } from './services/liqFeedClient'
import './app.css'

export function App() {
  const theme = useUiStore((s) => s.theme)
  const authenticated = useAuthStore((s) => s.authenticated)
  const loading = useAuthStore((s) => s.loading)
  const checkAuth = useAuthStore((s) => s.checkAuth)

  // Check auth on mount
  useEffect(() => {
    checkAuth()
  }, [checkAuth])

  // [2026-06-25] Capture a referral code from ?ref=… so it survives until the user registers.
  useEffect(() => {
    try { const r = new URLSearchParams(window.location.search).get('ref'); if (r) localStorage.setItem('zeus_ref', r) } catch (_) { /* ignore */ }
  }, [])

  // Apply theme to <html>
  useEffect(() => {
    if (theme === 'native') document.documentElement.removeAttribute('data-theme')
    else document.documentElement.setAttribute('data-theme', theme)
  }, [theme])

  // Connect WS when authenticated
  useEffect(() => {
    if (authenticated) {
      // [2026-06-24] load the user's flip-header profile once authenticated
      try { useProfileStore.getState().load() } catch (_) {}
      wsService.connect()
      // [WS-PROXY B.6] Install market bridge listener on /ws/sync
      try { require('./services/wsMarketBridge').install() } catch (_) {}
      // [MIGRATION-F0] settings cross-device sync subscriber (reuses /ws/sync)
      startSettingsRealtime()
      // [MIGRATION-F5 commit 4] positions cross-device sync subscriber
      // (reuses /ws/sync). No-op until server flips MF.POSITIONS_WS at C5.
      startPositionsRealtime()
      // [Phase 11.3] Market Radar event subscriber (reuses /ws/sync).
      // Server emits market.radar frames via wsBroadcastAll. Silent no-op
      // when MARKET_RADAR_ENABLED=0 on the server (no frames arrive).
      startMarketRadarRealtime()
      // [LIQ-FEED PROXY 2026-05-14] Server-aggregated liq feed subscriber.
      // Listens to zeus:wsFrame, filters `liq.feed` type, re-dispatches
      // zeus:liq / zeus:okxLiq events for Quant Monitor consumption.
      // Active when MF.LIQ_FEED_VIA_SERVER true (default).
      startLiqFeedClient()
      return () => {
        stopLiqFeedClient()
        stopMarketRadarRealtime()
        stopPositionsRealtime()
        stopSettingsRealtime()
        wsService.disconnect()
        const w = window as any
        if (w.Intervals?.clearAll) w.Intervals.clearAll()
        if (w.Timeouts?.clearAll) w.Timeouts.clearAll()
      }
    }
  }, [authenticated])

  // Sync positions/AT state from server (only when authenticated)
  useServerSync(authenticated)

  // Brain computation engine (runs on kline updates)
  // NOTE: When bridge is active, old brain.js runs instead (more complete).
  // React brain still runs as fallback — old brain overwrites its DOM output.
  useBrainEngine(authenticated)

  // Forecast engine — QEB, probability score, scenarios (runs after brain)
  useForecastEngine(authenticated)

  // ── LEGACY BRIDGE — load old JS scripts after React mount ──
  // Old JS populates React DOM elements via getElementById().
  // Runs old brain, orderflow, trading, UI engines.
  useLegacyBridge(authenticated)

  // ── POSITIONS BRIDGE — sync engine window.TP → positionsStore ──
  usePositionsBridge()

  // ── AT BRIDGE — sync engine window.AT → atStore ──
  useATBridge()

  if (loading) {
    // [SPLASH 2026-06-10] Same big centered logo as the static boot splash in
    // index.html — the operator sees one continuous logo from first paint to app.
    return (
      <div className="zr-loading">
        <img className="zr-loading__logo" src="/assets/icon-512.png" alt="Zeus Terminal" />
      </div>
    )
  }

  if (!authenticated) {
    return <LoginPage />
  }

  return (
    <ErrorBoundary>
      <div id="zeus-app">
        <FlipHeader />
        <PanelShell />
        <PinLockScreen />
        <SecurityNudgeModal />
        <ConfirmDialog />
      </div>
    </ErrorBoundary>
  )
}
