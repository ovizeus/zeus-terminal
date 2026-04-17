import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'

// [R33] Silence console.{log,debug,info} in production. 147 call sites emit
// diagnostic chatter that clutters real-user consoles and slows Chrome's
// DevTools buffer. warn/error stay live — those are the only levels anyone
// reading a prod console cares about. Flip `zeus_dev_enabled=true` in
// localStorage to restore verbose logging without a rebuild.
if (!import.meta.env.DEV) {
  try {
    const devOn = localStorage.getItem('zeus_dev_enabled') === 'true'
    if (!devOn) {
      const noop = () => {}
      console.log = noop
      console.debug = noop
      console.info = noop
    }
  } catch (_) { /* localStorage blocked — leave console untouched */ }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
