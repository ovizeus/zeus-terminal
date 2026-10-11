import { Component, type ReactNode, type ErrorInfo } from 'react'

interface Props {
  children: ReactNode
  fallback?: ReactNode
}

interface State {
  hasError: boolean
  error: Error | null
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[Zeus] React error boundary caught:', error, info.componentStack)
    // [2026-10-11] Report it. Until now a panel could crash in front of the
    // operator and leave the server with nothing: his "Cannot read properties
    // of null (reading 'toFixed')" logged as [CLIENT_ERR] unknown, with no
    // message, no file and no line, because this handler only wrote to a
    // console nobody was watching on a phone.
    //
    // The component stack is the part that matters: the message alone cannot
    // tell Auto Trade from Manual Trade from a THEIA card.
    try {
      fetch('/api/client-error', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Zeus-Request': '1' },
        body: JSON.stringify({
          kind: 'react-boundary',
          reason: (error && (error.message || String(error))) || 'unknown',
          stack: (error && error.stack) ? String(error.stack).slice(0, 2000) : undefined,
          componentStack: String((info && info.componentStack) || '').slice(0, 2000),
          url: (typeof location !== 'undefined') ? location.pathname + location.hash : undefined,
          ts: Date.now(),
        }),
        credentials: 'same-origin',
        keepalive: true,
      }).catch(() => { /* best-effort: a failed report must never matter */ })
    } catch (_) { /* never let reporting take the app down with it */ }
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback
      return (
        <div className="zr-error">
          <div className="zr-error__title">Panel Error</div>
          <div className="zr-error__msg">{this.state.error?.message ?? 'Unknown error'}</div>
          <button
            className="zr-at-btn"
            onClick={() => this.setState({ hasError: false, error: null })}
          >
            Retry
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
