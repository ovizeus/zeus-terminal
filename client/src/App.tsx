import { useEffect } from 'react'
import { LoginPage } from './components/auth/LoginPage'
import { Header } from './components/layout/Header'
import { PanelShell } from './components/layout/PanelShell'
import { SettingsModal } from './components/settings/SettingsModal'
import { ErrorBoundary } from './components/ErrorBoundary'
import { useUiStore, useAuthStore } from './stores'
import { useServerSync } from './hooks/useServerSync'
import { useBrainEngine } from './hooks/useBrainEngine'
import { useForecastEngine } from './hooks/useForecastEngine'
import { useLegacyBridge } from './bridge'
import { usePositionsBridge } from './hooks/usePositionsBridge'
import { useATBridge } from './hooks/useATBridge'
import { wsService } from './services/ws'
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

  // Apply theme to <html>
  useEffect(() => {
    if (theme === 'native') document.documentElement.removeAttribute('data-theme')
    else document.documentElement.setAttribute('data-theme', theme)
  }, [theme])

  // Connect WS when authenticated
  useEffect(() => {
    if (authenticated) {
      wsService.connect()
      return () => {
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
    return (
      <div className="zr-loading">
        <span className="zr-loading__text">Zeus Terminal</span>
      </div>
    )
  }

  if (!authenticated) {
    return <LoginPage />
  }

  return (
    <ErrorBoundary>
      <div id="zeus-app">
        <Header />
        <PanelShell />
        <SettingsModal />
      </div>
    </ErrorBoundary>
  )
}
