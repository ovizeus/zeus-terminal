import { useEffect, useState } from 'react'
import { api } from '../../../services/api'
import { useAdminStore } from '../../../stores/adminStore'

type Row = {
  userId: number; email: string; role: string
  netPnl: number; grossProfit: number; grossLoss: number; profitFactor: number
  trades: number; winRate: number; avgTimeInTradeMin: number
  commissions: number; commissionsEst: number; feeEstimated: boolean; netAfterFees: number
  unrealizedPnl: number; openCount: number; equity: number; maxDrawdown: number; currentStreak: number
  online: boolean; engineActive: boolean; pnlSpark: number[]
}
type Board = { ok: boolean; env: string; window: string; users: Row[]; totals: { netPnl: number; online: number; users: number } }

const ENVS = ['TESTNET', 'REAL', 'DEMO'] as const
const WINDOWS = [['today', 'Today'], ['7d', '7d'], ['30d', '30d'], ['all', 'All']] as const
const money = (x: number) => (x >= 0 ? '+' : '') + x.toFixed(2)
const col = (x: number) => (x >= 0 ? '#26ff9a' : '#ff5277')

export function LeaderboardTab() {
  const [env, setEnv] = useState<typeof ENVS[number]>('TESTNET')
  const [window, setWindow] = useState<string>('all')
  const [board, setBoard] = useState<Board | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [sortKey, setSortKey] = useState<keyof Row>('netPnl')
  const setSelectedUser = useAdminStore((s) => s.setSelectedUser)

  useEffect(() => {
    let alive = true
    const poll = async () => {
      try { const j = await api.raw<Board>('GET', `/api/admin/leaderboard?env=${env}&window=${window}`); if (alive && j) { setBoard(j); setErr(null) } }
      catch (e) { if (alive) setErr(e instanceof Error ? e.message : String(e)) }
    }
    poll(); const t = setInterval(poll, 10000)
    return () => { alive = false; clearInterval(t) }
  }, [env, window])

  const rows = board ? [...board.users].sort((a, b) => (Number(b[sortKey]) || 0) - (Number(a[sortKey]) || 0)) : []

  return (
    <div className="lb-panel">
      <div className="lb-controls">
        <div className="lb-seg">{ENVS.map((e) => <button key={e} className={env === e ? 'on' : ''} onClick={() => setEnv(e)}>{e}</button>)}</div>
        <div className="lb-seg">{WINDOWS.map(([w, lbl]) => <button key={w} className={window === w ? 'on' : ''} onClick={() => setWindow(w)}>{lbl}</button>)}</div>
        {board && <span className="lb-meta">{board.totals.online} online · {board.totals.users} users · net {money(board.totals.netPnl)}</span>}
      </div>
      {err && <div className="lb-empty">offline — {err}</div>}
      {env === 'REAL' && board && board.users.every((u) => u.trades === 0) && <div className="lb-empty">No REAL trades yet — REAL trading not enabled</div>}
      <table className="lb-table">
        <thead><tr>
          <th>#</th><th>User</th>
          {([['netPnl', 'Net'], ['grossProfit', 'Profit'], ['grossLoss', 'Loss'], ['winRate', 'WR'], ['profitFactor', 'PF'], ['trades', 'Trades'], ['avgTimeInTradeMin', 'Avg min'], ['commissionsEst', 'Fees'], ['equity', 'Equity'], ['unrealizedPnl', 'uPnL'], ['openCount', 'Open'], ['maxDrawdown', 'MaxDD'], ['currentStreak', 'Streak']] as [keyof Row, string][]).map(([k, lbl]) => (
            <th key={k} className="lb-sortable" onClick={() => setSortKey(k)}>{lbl}{sortKey === k ? ' ▾' : ''}</th>
          ))}
        </tr></thead>
        <tbody>
          {rows.map((u, i) => (
            <tr key={u.userId} className="lb-row" onClick={() => setSelectedUser(u.userId)}>
              <td>{i + 1}</td>
              <td><span className={u.online ? 'lb-dot on' : 'lb-dot'} />{u.email}{u.engineActive ? ' ⚙️' : ''}</td>
              <td style={{ color: col(u.netPnl) }}>{money(u.netPnl)}</td>
              <td style={{ color: '#26ff9a' }}>{u.grossProfit.toFixed(2)}</td>
              <td style={{ color: '#ff5277' }}>-{u.grossLoss.toFixed(2)}</td>
              <td>{Math.round(u.winRate * 100)}%</td>
              <td>{u.profitFactor === Infinity ? '∞' : u.profitFactor.toFixed(2)}</td>
              <td>{u.trades}</td>
              <td>{u.avgTimeInTradeMin.toFixed(1)}</td>
              <td>{u.feeEstimated ? '≈' : ''}{(u.commissions + u.commissionsEst).toFixed(2)}</td>
              <td>{u.equity.toFixed(2)}</td>
              <td style={{ color: col(u.unrealizedPnl) }}>{money(u.unrealizedPnl)}</td>
              <td>{u.openCount}</td>
              <td style={{ color: '#ff5277' }}>{u.maxDrawdown.toFixed(2)}</td>
              <td style={{ color: col(u.currentStreak) }}>{u.currentStreak > 0 ? `+${u.currentStreak}W` : u.currentStreak < 0 ? `${-u.currentStreak}L` : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
