import { useState } from 'react'
import { useATStore, usePositionsStore } from '../../stores'
import { api } from '../../services/api'

export function ATPanel() {
  const enabled = useATStore((s) => s.enabled)
  const mode = useATStore((s) => s.mode)
  const killTriggered = useATStore((s) => s.killTriggered)
  const totalTrades = useATStore((s) => s.totalTrades)
  const wins = useATStore((s) => s.wins)
  const losses = useATStore((s) => s.losses)
  const totalPnL = useATStore((s) => s.totalPnL)
  const dailyPnL = useATStore((s) => s.dailyPnL)
  const realizedDailyPnL = useATStore((s) => s.realizedDailyPnL)
  const closedToday = useATStore((s) => s.closedTradesToday)
  const demoBalance = usePositionsStore((s) => s.demoBalance)
  const [loading, setLoading] = useState('')

  const winRate = totalTrades > 0 ? ((wins / totalTrades) * 100).toFixed(1) : '—'

  async function handleToggle() {
    setLoading('toggle')
    await api.post('/api/at/toggle')
    setLoading('')
  }

  async function handleModeSwitch() {
    const newMode = mode === 'demo' ? 'live' : 'demo'
    setLoading('mode')
    await api.post('/api/at/mode', { mode: newMode })
    setLoading('')
  }

  async function handleKillReset() {
    setLoading('kill')
    await api.post('/api/at/kill/reset')
    setLoading('')
  }

  return (
    <div className="zr-at-panel">
      <div className="zr-at-controls">
        <button
          className={`zr-at-btn ${enabled ? 'zr-at-btn--active' : ''}`}
          onClick={handleToggle}
          disabled={loading === 'toggle' || killTriggered}
        >
          {loading === 'toggle' ? '...' : enabled ? 'AT ON' : 'AT OFF'}
        </button>
        <button
          className="zr-at-btn zr-at-btn--mode"
          onClick={handleModeSwitch}
          disabled={loading === 'mode' || enabled}
        >
          {loading === 'mode' ? '...' : mode.toUpperCase()}
        </button>
        {killTriggered && (
          <button
            className="zr-at-btn zr-at-btn--kill"
            onClick={handleKillReset}
            disabled={loading === 'kill'}
          >
            {loading === 'kill' ? '...' : 'RESET KILL'}
          </button>
        )}
      </div>

      {killTriggered && (
        <div className="zr-at-kill-banner">KILL SWITCH ACTIVE</div>
      )}

      <div className="zr-at-stats">
        <div className="zr-kv">
          <span className="zr-kv__label">Balance ({mode})</span>
          <span className="zr-kv__value">${demoBalance.toLocaleString()}</span>
        </div>
        <div className="zr-kv">
          <span className="zr-kv__label">Total Trades</span>
          <span className="zr-kv__value">{totalTrades}</span>
        </div>
        <div className="zr-kv">
          <span className="zr-kv__label">Win Rate</span>
          <span className="zr-kv__value">{winRate}%</span>
        </div>
        <div className="zr-kv">
          <span className="zr-kv__label">W / L</span>
          <span className="zr-kv__value">
            <span className="zr-at-stat--grn">{wins}</span>
            {' / '}
            <span className="zr-at-stat--red">{losses}</span>
          </span>
        </div>
        <div className="zr-kv">
          <span className="zr-kv__label">Total PnL</span>
          <span className={`zr-kv__value ${totalPnL >= 0 ? 'zr-kv__value--grn' : 'zr-kv__value--red'}`}>
            ${totalPnL.toFixed(2)}
          </span>
        </div>
        <div className="zr-kv">
          <span className="zr-kv__label">Daily PnL</span>
          <span className={`zr-kv__value ${dailyPnL >= 0 ? 'zr-kv__value--grn' : 'zr-kv__value--red'}`}>
            ${dailyPnL.toFixed(2)}
          </span>
        </div>
        <div className="zr-kv">
          <span className="zr-kv__label">Realized Daily</span>
          <span className={`zr-kv__value ${realizedDailyPnL >= 0 ? 'zr-kv__value--grn' : 'zr-kv__value--red'}`}>
            ${realizedDailyPnL.toFixed(2)}
          </span>
        </div>
        <div className="zr-kv">
          <span className="zr-kv__label">Closed Today</span>
          <span className="zr-kv__value">{closedToday}</span>
        </div>
      </div>
    </div>
  )
}
