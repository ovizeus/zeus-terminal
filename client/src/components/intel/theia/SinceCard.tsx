import { useEffect, useRef } from 'react'
import { useAresStore } from '../../../stores/aresStore'
import { useATStore } from '../../../stores/atStore'

// "Since you last looked" — REAL reads from the AT global + aresStore + atStore. Persists
// the last-open timestamp so the operator knows the reference window. '—' when absent.
const usd = (v: any) => (typeof v === 'number' && isFinite(v) ? `${v >= 0 ? '+' : ''}$${v.toFixed(2)}` : '—')

export function SinceCard() {
  const lastOpenRef = useRef<number | null>(null)
  useEffect(() => {
    try {
      const prev = Number(localStorage.getItem('theia_last_open')) || null
      lastOpenRef.current = prev
      localStorage.setItem('theia_last_open', String(Date.now()))
    } catch (_) { /* */ }
  }, [])
  const realizedDaily = useATStore((s: any) => s.realizedDailyPnL)
  const killTriggered = useATStore((s: any) => s.killTriggered)
  const lastDecision = useAresStore((s: any) => s.lastDecision) || {}
  const w = window as any
  const AT = w.AT || {}
  const closedToday = AT.closedTradesToday
  const realized = typeof realizedDaily === 'number' ? realizedDaily : AT.realizedDailyPnL
  const last = lastOpenRef.current
  const lastTxt = last ? new Date(last).toLocaleString() : 'first visit'
  return (
    <div className="theia-card">
      <h4>🌅 Since you last looked</h4>
      <div className="theia-rows">
        <div><span>Last opened</span><b>{lastTxt}</b></div>
        <div><span>Realized P&amp;L (today)</span><b>{usd(realized)}</b></div>
        <div><span>Trades closed (today)</span><b>{closedToday === undefined ? '—' : String(closedToday)}</b></div>
        <div><span>ARES last move</span><b>{lastDecision.action || lastDecision.state || '—'}</b></div>
        <div><span>Kill-switch</span><b style={{ color: killTriggered ? '#ff6680' : undefined }}>{killTriggered === undefined ? '—' : killTriggered ? 'TRIGGERED' : 'armed/ok'}</b></div>
      </div>
    </div>
  )
}
