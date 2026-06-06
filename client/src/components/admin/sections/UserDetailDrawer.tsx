import { useEffect, useState } from 'react'
import { useAdminStore, type AdminUser, type AuditEntry } from '../../../stores/adminStore'
import { StatusBadge, ApiBadge, fmtDate, fmtRelative, actionColor, LoadingSkeleton, Placeholder } from '../shared/components'

export function UserDetailDrawer({ userId, onClose }: { userId: number; onClose: () => void }) {
  const users = useAdminStore((s) => s.users)
  const u = users.find((x) => x.id === userId)
  const [tab, setTab] = useState<'overview' | 'activity' | 'notes'>('overview')
  const [userAudit, setUserAudit] = useState<AuditEntry[]>([])
  const [auditLoading, setAuditLoading] = useState(false)

  useEffect(() => {
    if (!u) return
    setAuditLoading(true)
    fetch(`/auth/admin/users/${u.id}/audit?limit=50`, { credentials: 'same-origin' })
      .then((r) => r.json())
      .then((d) => { if (d.ok) setUserAudit(d.entries || []); setAuditLoading(false) })
      .catch(() => setAuditLoading(false))
  }, [u?.id])

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  if (!u) return null

  return (
    <>
      <div className="zac-drawer-overlay" onClick={onClose} />
      <aside className="zac-drawer">
        <header className="zac-drawer-header">
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 9, color: 'var(--ac-fg-mute)', letterSpacing: 1 }}>USER DETAIL · #{u.id}</div>
            <div style={{ fontSize: 14, fontWeight: 700, marginTop: 2 }}>{u.email}</div>
          </div>
          <StatusBadge u={u} />
          <button className="zac-drawer-close" onClick={onClose} aria-label="Close">×</button>
        </header>

        <div style={{ display: 'flex', borderBottom: '1px solid var(--ac-border)', padding: '0 18px', gap: 4 }}>
          {(['overview', 'activity', 'notes'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              style={{
                background: 'none', border: 'none',
                padding: '10px 14px',
                fontSize: 10, letterSpacing: 1.5, textTransform: 'uppercase',
                color: tab === t ? 'var(--ac-accent)' : 'var(--ac-fg-mute)',
                cursor: 'pointer',
                borderBottom: tab === t ? '2px solid var(--ac-accent)' : '2px solid transparent',
              }}
            >{t}</button>
          ))}
        </div>

        <div className="zac-drawer-body">
          {tab === 'overview' && <OverviewTab u={u} />}
          {tab === 'activity' && <ActivityTab entries={userAudit} loading={auditLoading} />}
          {tab === 'notes' && <NotesTab userId={u.id} />}
        </div>
      </aside>
    </>
  )
}

function OverviewTab({ u }: { u: AdminUser }) {
  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <Panel title="Profile">
        <Row k="Email" v={u.email} />
        <Row k="User ID" v={`#${u.id}`} />
        <Row k="Role" v={<span className="zac-b zac-b-admin" style={{ textTransform: 'uppercase' }}>{u.role}</span>} />
        <Row k="Status" v={<StatusBadge u={u} />} />
        <Row k="Registered" v={fmtDate(u.createdAt)} />
        {u.bannedUntil && <Row k="Banned until" v={fmtDate(u.bannedUntil)} />}
      </Panel>

      <Panel title="Exchange / Trading">
        <Row k="API" v={<ApiBadge u={u} />} />
        {u.exchange?.connected && (
          <>
            <Row k="Exchange" v={u.exchange.exchange || '—'} />
            <Row k="Mode" v={u.exchange.mode?.toUpperCase() || '—'} />
            <Row k="Verified" v={fmtRelative(u.exchange.lastVerified)} />
            <Row k="Status" v={u.exchange.status || '—'} />
          </>
        )}
      </Panel>

      <LiveStatsPanel userId={u.id} />
    </div>
  )
}

// [P2 2026-06-06] Live stats binding — was a Placeholder since the panel
// shipped. Fetches GET /api/admin/user-stats/:id once when the drawer opens
// (no polling). Exchange balance is fail-soft server-side: a Binance hiccup
// shows "unavailable" instead of breaking the drawer.
interface LiveStats {
  mode: string
  openCount: number
  dailyPnLLive: number
  dailyPnLDemo: number
  killActive: boolean
  killPct: number
  demo: { balance: number; startBalance: number; pnl: number }
  exchange: { connected: boolean; exchange?: string; mode?: string; balance?: number | null; availableBalance?: number | null; balanceError?: string }
  positions: Array<{ seq: number; symbol: string; side: string; mode: string; size: number; lev: number; entryPrice: number; sl: number; tp: number; openedAt: number; liveStatus: string | null }>
}

function LiveStatsPanel({ userId }: { userId: number }) {
  const [stats, setStats] = useState<LiveStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = () => {
    setLoading(true); setError('')
    fetch(`/api/admin/user-stats/${userId}`, { credentials: 'same-origin' })
      .then((r) => r.json())
      .then((d) => { if (d.ok) setStats(d.stats); else setError(d.error || 'Load error'); setLoading(false) })
      .catch((e) => { setError(e.message || 'Network error'); setLoading(false) })
  }
  useEffect(() => { load() }, [userId])

  return (
    <Panel title="Account Stats — Live">
      {loading && <LoadingSkeleton rows={3} />}
      {error && <div style={{ fontSize: 11, color: 'var(--ac-danger)' }}>{error} <button className="zac-btn zac-btn-sm zac-btn-ghost" onClick={load}>↻ Retry</button></div>}
      {!loading && !error && stats && (
        <>
          <Row k="Engine mode" v={<span className={stats.mode === 'live' ? 'zac-b zac-b-live' : 'zac-b zac-b-demo'}>{stats.mode.toUpperCase()}</span>} />
          <Row k="Open positions" v={String(stats.openCount)} />
          <Row k="Demo balance" v={`$${stats.demo.balance.toFixed(2)} (PnL ${stats.demo.pnl >= 0 ? '+' : ''}$${stats.demo.pnl.toFixed(2)})`} />
          {stats.exchange.connected ? (
            <>
              <Row k="Exchange balance" v={stats.exchange.balance != null
                ? `$${stats.exchange.balance.toFixed(2)} (avail $${(stats.exchange.availableBalance ?? 0).toFixed(2)})`
                : <span style={{ color: 'var(--ac-gold)' }} title={stats.exchange.balanceError}>unavailable</span>} />
              <Row k="Daily PnL (live)" v={`${stats.dailyPnLLive >= 0 ? '+' : ''}$${(stats.dailyPnLLive ?? 0).toFixed(2)}`} />
            </>
          ) : (
            <Row k="Exchange" v="not connected" />
          )}
          <Row k="Kill switch" v={stats.killActive ? `ACTIVE (${stats.killPct}%)` : 'off'} />
          {stats.positions.length > 0 && (
            <div style={{ marginTop: 6 }}>
              <div style={{ fontSize: 9, color: 'var(--ac-fg-mute)', letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 6 }}>Open Positions</div>
              {stats.positions.map((p) => (
                <div key={p.seq} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, padding: '4px 0', borderBottom: '1px solid #0f1725' }}>
                  <span>
                    <b style={{ color: p.side === 'LONG' ? 'var(--ac-success)' : 'var(--ac-danger)' }}>{p.side}</b> {p.symbol}
                    <span style={{ color: 'var(--ac-fg-mute)', marginLeft: 6 }}>{p.mode.toUpperCase()}{p.liveStatus ? ` · ${p.liveStatus}` : ''}</span>
                  </span>
                  <span style={{ color: 'var(--ac-fg-dim)' }}>${p.size} · {p.lev}x @ ${p.entryPrice}</span>
                </div>
              ))}
            </div>
          )}
          <div style={{ textAlign: 'right', marginTop: 4 }}>
            <button className="zac-btn zac-btn-sm zac-btn-ghost" onClick={load}>↻ Refresh</button>
          </div>
        </>
      )}
    </Panel>
  )
}

function ActivityTab({ entries, loading }: { entries: AuditEntry[]; loading: boolean }) {
  if (loading) return <LoadingSkeleton rows={6} />
  if (entries.length === 0) return <div className="zac-empty">No activity recorded</div>
  return (
    <div>
      {entries.map((e, i) => (
        <div key={i} style={{ padding: '10px 0', borderBottom: '1px solid #0f1725' }}>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 4 }}>
            <span style={{ color: actionColor(e.action), fontSize: 10, fontWeight: 700, letterSpacing: 1 }}>{e.action}</span>
            <span style={{ fontSize: 9, color: 'var(--ac-fg-mute)', marginLeft: 'auto' }}>{fmtRelative(e.created_at)}</span>
          </div>
          {e.details && (
            <div style={{ fontSize: 10, color: 'var(--ac-fg-dim)', fontFamily: 'monospace', background: 'var(--ac-bg-2)', padding: 6, borderRadius: 4, wordBreak: 'break-all' }}>
              {prettyDetails(e.details)}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

function NotesTab({ userId }: { userId: number }) {
  return (
    <Placeholder
      title={`Internal notes for user #${userId}`}
      note="Admin-only notes, timestamps, authorship. Backend endpoint /auth/admin/note is ready; note thread UI arrives in next iteration."
    />
  )
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ background: 'var(--ac-bg-2)', border: '1px solid var(--ac-border)', borderRadius: 6, padding: 14 }}>
      <div style={{ fontSize: 9, color: 'var(--ac-fg-mute)', letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 10 }}>{title}</div>
      <div style={{ display: 'grid', gap: 8 }}>{children}</div>
    </div>
  )
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, gap: 12, alignItems: 'center' }}>
      <span style={{ color: 'var(--ac-fg-mute)' }}>{k}</span>
      <span style={{ color: 'var(--ac-fg)', textAlign: 'right', wordBreak: 'break-all' }}>{v}</span>
    </div>
  )
}

function prettyDetails(raw?: string): string {
  if (!raw) return ''
  try {
    const d = JSON.parse(raw)
    return JSON.stringify(d, null, 2)
  } catch { return raw }
}
