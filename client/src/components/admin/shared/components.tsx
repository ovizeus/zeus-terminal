import { useState, type ReactNode } from 'react'
import type { AdminUser } from '../../../stores/adminStore'

export function KpiCard({
  label, value, sub, tone = 'default', icon,
}: {
  label: string
  value: string | number
  sub?: string
  tone?: 'default' | 'success' | 'warn' | 'danger' | 'mute'
  icon?: ReactNode
}) {
  return (
    <div className="zac-kpi" data-tone={tone}>
      <div className="zac-kpi-label">{icon}{label}</div>
      <div className="zac-kpi-value">{value}</div>
      {sub && <div className="zac-kpi-sub">{sub}</div>}
    </div>
  )
}

export function StatusBadge({ u }: { u: AdminUser }) {
  if (u.role === 'admin') return <span className="zac-b zac-b-admin">ADMIN</span>
  if (u.status === 'banned') {
    let label = 'BANNED'
    if (u.bannedUntil && u.bannedUntil !== '9999-12-31T23:59:59Z') {
      const d = new Date(u.bannedUntil)
      label += ' → ' + d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    } else if (u.bannedUntil === '9999-12-31T23:59:59Z') label += ' PERMANENT'
    return <span className="zac-b zac-b-banned">{label}</span>
  }
  if (u.status === 'suspended') return <span className="zac-b zac-b-suspended">SUSPENDED</span>
  if (u.status === 'blocked') return <span className="zac-b zac-b-blocked">BLOCKED</span>
  if (!u.approved) return <span className="zac-b zac-b-pending">PENDING</span>
  return <span className="zac-b zac-b-active">ACTIVE</span>
}

export function ApiBadge({ u }: { u: AdminUser }) {
  if (u.exchange && u.exchange.connected) {
    if (u.exchange.mode === 'live') return <span className="zac-b zac-b-live">LIVE</span>
    if (u.exchange.mode === 'testnet') return <span className="zac-b zac-b-testnet">TESTNET</span>
    return <span className="zac-b zac-b-api">API READY</span>
  }
  return <span className="zac-b zac-b-noapi">NO API</span>
}

export function EmptyState({ message, children }: { message: string; children?: ReactNode }) {
  return (
    <div className="zac-empty">
      <div style={{ fontSize: 24, marginBottom: 8, opacity: .3 }}>∅</div>
      <div>{message}</div>
      {children && <div style={{ marginTop: 12 }}>{children}</div>}
    </div>
  )
}

export function LoadingSkeleton({ rows = 5, h = 36 }: { rows?: number; h?: number }) {
  return (
    <div style={{ display: 'grid', gap: 6 }}>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="zac-skel" style={{ height: h }} />
      ))}
    </div>
  )
}

export function Placeholder({ title, note }: { title: string; note?: string }) {
  return (
    <div className="zac-placeholder">
      <div className="zac-placeholder-tag">PENDING BACKEND BINDING</div>
      <div style={{ fontSize: 13, fontWeight: 700, color: '#d8dde5', marginBottom: 6, letterSpacing: 1 }}>{title}</div>
      {note && <div style={{ fontSize: 11, maxWidth: 500, margin: '0 auto', lineHeight: 1.5 }}>{note}</div>}
    </div>
  )
}

export function ConfirmDialog({
  title, message, confirmText = 'Confirm', cancelText = 'Cancel',
  tone = 'default', requireType, onConfirm, onCancel,
}: {
  title: string
  message: string
  confirmText?: string
  cancelText?: string
  tone?: 'default' | 'danger' | 'gold'
  requireType?: string
  onConfirm: () => void
  onCancel: () => void
}) {
  const [typed, setTyped] = useState('')
  const canConfirm = !requireType || typed === requireType
  const btnClass = tone === 'danger' ? 'zac-btn zac-btn-danger' : tone === 'gold' ? 'zac-btn zac-btn-gold' : 'zac-btn zac-btn-primary'
  return (
    <div className="zac-confirm-ov" onClick={onCancel}>
      <div className="zac-confirm" onClick={e => e.stopPropagation()}>
        <h3>{title}</h3>
        <p>{message}</p>
        {requireType && (
          <input
            className="zac-input"
            style={{ width: '100%', marginBottom: 16 }}
            placeholder={`Type "${requireType}" to confirm`}
            value={typed}
            onChange={e => setTyped(e.target.value)}
            autoFocus
          />
        )}
        <div className="zac-confirm-actions">
          <button className="zac-btn zac-btn-ghost" onClick={onCancel}>{cancelText}</button>
          <button className={btnClass} disabled={!canConfirm} onClick={onConfirm}>{confirmText}</button>
        </div>
      </div>
    </div>
  )
}

export function HealthDot({ status }: { status: 'ok' | 'warn' | 'down' }) {
  return <span className={`zac-dot zac-dot-${status}`} />
}

export function fmtDate(iso?: string | null) {
  if (!iso) return '—'
  try {
    const d = new Date(iso.includes('Z') ? iso : iso + 'Z')
    return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  } catch { return iso }
}

export function fmtRelative(iso?: string | null) {
  if (!iso) return '—'
  try {
    const d = new Date(iso.includes('Z') ? iso : iso + 'Z')
    const s = Math.floor((Date.now() - d.getTime()) / 1000)
    if (s < 60) return `${s}s ago`
    if (s < 3600) return `${Math.floor(s / 60)}m ago`
    if (s < 86400) return `${Math.floor(s / 3600)}h ago`
    return `${Math.floor(s / 86400)}d ago`
  } catch { return iso }
}

export function actionColor(action?: string) {
  if (!action) return '#8791a3'
  if (action.includes('BAN')) return '#ff4d4d'
  if (action.includes('DELETE')) return '#ff6644'
  if (action.includes('BLOCK')) return '#ff9944'
  if (action.includes('SUSPEND')) return '#ff8844'
  if (action.includes('APPROVE') || action.includes('UNBAN') || action.includes('UNBLOCK')) return '#00ff88'
  if (action.includes('LOGIN')) return '#00d4ff'
  if (action.includes('PASSWORD') || action.includes('FORCE_LOGOUT')) return '#f0c040'
  if (action.includes('REGISTER') || action.includes('NOTE')) return '#b888ff'
  if (action.includes('ADMIN_')) return '#00d4ff'
  return '#8791a3'
}
