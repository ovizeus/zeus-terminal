import { useEffect } from 'react'
import { Header } from './components/layout/Header'
import { PanelShell } from './components/layout/PanelShell'
import { useUiStore } from './stores'
import './app.css'

export function App() {
  const theme = useUiStore((s) => s.theme)

  useEffect(() => {
    if (theme === 'native') document.documentElement.removeAttribute('data-theme')
    else document.documentElement.setAttribute('data-theme', theme)
  }, [theme])

  return (
    <div id="zeus-app">
      <Header />
      <PanelShell />
    </div>
  )
}
