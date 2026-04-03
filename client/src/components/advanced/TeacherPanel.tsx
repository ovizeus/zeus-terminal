import { useState } from 'react'
import { useTeacherStore } from '../../stores'

type Tab = 'replay' | 'trades' | 'stats' | 'memory'

export function TeacherPanel() {
  const teacher = useTeacherStore((s) => s.teacher)
  const [tab, setTab] = useState<Tab>('replay')

  const scoreCls = teacher.score >= 70 ? 'zr-kv__value--grn'
    : teacher.score >= 40 ? 'zr-kv__value--ylw' : 'zr-kv__value--red'

  return (
    <div className="zr-teacher">
      {/* Capability Hero */}
      <div className="zr-teacher__hero">
        <span className={`zr-teacher__score ${scoreCls}`}>{teacher.score}</span>
        <span className="zr-teacher__label">{teacher.label}</span>
        <span className="zr-teacher__subtitle">TEACHER CAPABILITY</span>
      </div>

      {/* Quick Stats */}
      <div className="zr-teacher__quick">
        <span>Cap: ${teacher.capital.toFixed(0)}</span>
        <span>Sess: {teacher.sessions}</span>
        <span>Trades: {teacher.trades}</span>
        <span>Fails: {teacher.fails}</span>
      </div>

      {/* Status */}
      <div className={`zr-teacher__status zr-teacher__status--${teacher.status.toLowerCase()}`}>
        {teacher.status}
      </div>

      {/* Tabs */}
      <div className="zr-panel__header-tabs">
        {(['replay', 'trades', 'stats', 'memory'] as Tab[]).map((t) => (
          <button
            key={t}
            className={`zr-panel__header-tab ${tab === t ? 'zr-panel__header-tab--active' : ''}`}
            onClick={() => setTab(t)}
          >
            {t.toUpperCase()}
          </button>
        ))}
      </div>

      <div className="zr-teacher__body">
        {tab === 'replay' && <ReplayTab />}
        {tab === 'trades' && <TradesTab />}
        {tab === 'stats' && <StatsTab />}
        {tab === 'memory' && <MemoryTab />}
      </div>
    </div>
  )
}

function ReplayTab() {
  const replay = useTeacherStore((s) => s.teacher.currentReplay)
  const activity = useTeacherStore((s) => s.teacher.activity)

  return (
    <div>
      <div className="zr-kv">
        <span className="zr-kv__label">TF</span>
        <span className="zr-kv__value">{replay.tf || '—'}</span>
      </div>
      <div className="zr-kv">
        <span className="zr-kv__label">Profile</span>
        <span className="zr-kv__value">{replay.profile || '—'}</span>
      </div>
      <div className="zr-kv">
        <span className="zr-kv__label">Regime</span>
        <span className="zr-kv__value">{replay.regime || '—'}</span>
      </div>
      <div className="zr-kv">
        <span className="zr-kv__label">Bars</span>
        <span className="zr-kv__value">{replay.bars}</span>
      </div>
      {replay.lastDecision.action && (
        <div className="zr-kv">
          <span className="zr-kv__label">Decision</span>
          <span className="zr-kv__value">
            {replay.lastDecision.action} ({replay.lastDecision.confidence}%)
          </span>
        </div>
      )}
      {activity.length > 0 && (
        <div className="zr-teacher__activity">
          {activity.slice(-10).reverse().map((a, i) => (
            <div key={i} className={`zr-teacher__event zr-teacher__event--${a.type}`}>
              {a.text}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function TradesTab() {
  const history = useTeacherStore((s) => s.teacher.tradeHistory)

  if (history.length === 0) return <div className="zr-pos-empty">No trades yet</div>

  return (
    <div className="zr-teacher__trades">
      {history.slice(-20).reverse().map((t, i) => (
        <div key={i} className="zr-kv">
          <span className={`zr-kv__label ${t.side === 'LONG' ? 'zr-kv__value--grn' : 'zr-kv__value--red'}`}>
            {t.side}
          </span>
          <span className={`zr-kv__value ${t.pnl >= 0 ? 'zr-kv__value--grn' : 'zr-kv__value--red'}`}>
            ${t.pnl.toFixed(2)} ({t.pnlPct.toFixed(1)}%)
          </span>
        </div>
      ))}
    </div>
  )
}

function StatsTab() {
  const stats = useTeacherStore((s) => s.teacher.stats)

  return (
    <div>
      <div className="zr-kv"><span className="zr-kv__label">Trades</span><span className="zr-kv__value">{stats.totalTrades}</span></div>
      <div className="zr-kv"><span className="zr-kv__label">Win Rate</span><span className="zr-kv__value">{stats.winRate.toFixed(1)}%</span></div>
      <div className="zr-kv">
        <span className="zr-kv__label">PnL</span>
        <span className={`zr-kv__value ${stats.pnl >= 0 ? 'zr-kv__value--grn' : 'zr-kv__value--red'}`}>${stats.pnl.toFixed(2)}</span>
      </div>
      <div className="zr-kv"><span className="zr-kv__label">Profit Factor</span><span className="zr-kv__value">{stats.profitFactor.toFixed(2)}</span></div>
      <div className="zr-kv"><span className="zr-kv__label">Expectancy</span><span className="zr-kv__value">${stats.expectancy.toFixed(2)}</span></div>
      <div className="zr-kv"><span className="zr-kv__label">Avg Win</span><span className="zr-kv__value--grn">${stats.avgWin.toFixed(2)}</span></div>
      <div className="zr-kv"><span className="zr-kv__label">Avg Loss</span><span className="zr-kv__value--red">${stats.avgLoss.toFixed(2)}</span></div>
      <div className="zr-kv"><span className="zr-kv__label">Best</span><span className="zr-kv__value--grn">${stats.best.toFixed(2)}</span></div>
      <div className="zr-kv"><span className="zr-kv__label">Worst</span><span className="zr-kv__value--red">${stats.worst.toFixed(2)}</span></div>
    </div>
  )
}

function MemoryTab() {
  return <div className="zr-pos-empty">Memory data synced from server</div>
}
