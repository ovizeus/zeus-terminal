import { useEffect, useState } from 'react'
import { leaderboardApi, type LeaderboardRow } from '../../services/api'
import { initialsAvatar } from '../../profile/avatar'

// [2026-06-24] Real leaderboard (Phase 2). Podium for the top 3 VIPs + a ranked list below.
// Public data only (name / avatar / accent / net PnL / win rate). Env toggle DEMO/TESTNET/REAL.
const ENVS = ['DEMO', 'TESTNET', 'REAL']
function fmtPnl(n: number) { return (n >= 0 ? '+' : '-') + '$' + Math.abs(n).toLocaleString('en-US', { maximumFractionDigits: 0 }) }
function avatarOf(r: LeaderboardRow) { return r.avatar || initialsAvatar(r.name, r.accent || '#888') }
const empty: React.CSSProperties = { fontFamily: 'monospace', fontSize: '10px', color: 'rgba(255,255,255,0.4)', padding: '14px 0', textAlign: 'center' }

function PodiumSpot({ row }: { row: LeaderboardRow }) {
  const place = row.rank
  const medal = place === 1 ? '🥇' : place === 2 ? '🥈' : '🥉'
  const ring = place === 1 ? '#ffd700' : place === 2 ? '#c0c8d0' : '#cd7f32'
  const size = place === 1 ? 62 : 48
  const ac = row.accent || ring
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '3px', flex: 1, order: place === 2 ? 0 : place === 1 ? 1 : 2, paddingBottom: place === 1 ? '0' : '8px' }}>
      <div style={{ fontSize: place === 1 ? '20px' : '16px' }}>{medal}</div>
      <img src={avatarOf(row)} alt={row.name} style={{ width: size, height: size, borderRadius: '50%', objectFit: 'cover', border: `2px solid ${ring}`, filter: `drop-shadow(0 0 6px ${ac}) drop-shadow(0 0 13px ${ac}cc)` }} />
      <div style={{ fontFamily: 'monospace', fontSize: '10px', fontWeight: 700, color: row.isYou ? ac : '#fff', maxWidth: '82px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', textAlign: 'center' }}>{row.name}{row.isYou ? ' ★' : ''}</div>
      <div style={{ fontFamily: 'monospace', fontSize: '10px', fontWeight: 700, color: row.netPnl >= 0 ? '#00e676' : '#ff5b6e' }}>{fmtPnl(row.netPnl)}</div>
    </div>
  )
}

export function LeaderboardPanel() {
  const [env, setEnv] = useState('DEMO')
  const [rows, setRows] = useState<LeaderboardRow[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let alive = true
    setLoading(true)
    leaderboardApi.get(env, 'all').then((r) => { if (alive) { setRows(r.ok && r.leaderboard ? r.leaderboard : []); setLoading(false) } })
    return () => { alive = false }
  }, [env])

  const top3 = rows.slice(0, 3)
  const rest = rows.slice(3)

  return (
    <div>
      <div style={{ display: 'flex', gap: '5px', marginBottom: '10px' }}>
        {ENVS.map((e) => (
          <button key={e} onClick={() => setEnv(e)} style={{
            fontFamily: 'monospace', fontSize: '9px', letterSpacing: '1px', padding: '3px 9px', borderRadius: '3px', cursor: 'pointer', fontWeight: 700,
            color: e === env ? '#0a0a0a' : 'rgba(255,255,255,0.5)', background: e === env ? '#f0c040' : 'rgba(255,255,255,0.05)', border: '1px solid ' + (e === env ? '#f0c040' : 'rgba(255,255,255,0.15)'),
          }}>{e}</button>
        ))}
      </div>

      {loading ? <div style={empty}>Loading…</div>
        : rows.length === 0 ? <div style={empty}>No ranked traders yet — trade to join the board.</div>
          : (
            <>
              {/* podium top 3 */}
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: '6px', marginBottom: '10px', padding: '4px 0' }}>
                {top3.map((r) => <PodiumSpot key={r.userId} row={r} />)}
              </div>
              {/* the rest */}
              {rest.length > 0 && (
                <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: '6px' }}>
                  {rest.map((r) => (
                    <div key={r.userId} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '5px 6px', borderRadius: '4px', background: r.isYou ? `${r.accent || '#f0c040'}22` : 'transparent' }}>
                      <span style={{ fontFamily: 'monospace', fontSize: '10px', color: 'rgba(255,255,255,0.4)', width: '20px' }}>#{r.rank}</span>
                      <img src={avatarOf(r)} alt={r.name} style={{ width: '24px', height: '24px', borderRadius: '50%', objectFit: 'cover', border: `1px solid ${r.accent || '#888'}` }} />
                      <span style={{ flex: 1, fontFamily: 'monospace', fontSize: '11px', color: '#fff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.name}{r.isYou ? ' (you)' : ''}</span>
                      <span style={{ fontFamily: 'monospace', fontSize: '9px', color: 'rgba(255,255,255,0.4)' }}>{r.winRate}% WR</span>
                      <span style={{ fontFamily: 'monospace', fontSize: '11px', fontWeight: 700, color: r.netPnl >= 0 ? '#00e676' : '#ff5b6e' }}>{fmtPnl(r.netPnl)}</span>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
    </div>
  )
}
