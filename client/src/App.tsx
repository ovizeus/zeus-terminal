import { useEffect } from 'react'
import { LoginPage } from './components/auth/LoginPage'
import { Header } from './components/layout/Header'
import { PanelShell } from './components/layout/PanelShell'
import { SettingsModal } from './components/settings/SettingsModal'
import { ErrorBoundary } from './components/ErrorBoundary'
import { useUiStore, useAuthStore } from './stores'
import { useServerSync } from './hooks/useServerSync'
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
      return () => wsService.disconnect()
    }
  }, [authenticated])

  // Sync positions/AT state from server
  useServerSync()

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
