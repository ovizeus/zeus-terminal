import { useEffect, useMemo, useState } from 'react'
import { useAdminStore, type AuditEntry } from '../../../stores/adminStore'
import { LoadingSkeleton, EmptyState, fmtDate, actionColor } from '../shared/components'

export function AuditSection() {
  const audit = useAdminStore((s) => s.audit)
  const auditLoading = useAdminStore((s) => s.auditLoading)
  const auditError = useAdminStore((s) => s.auditError)
  const loadAudit = useAdminStore((s) => s.loadAudit)
  const filters = useAdminStore((s) => s.auditFilters)
  const setFilters = useAdminStore((s) => s.setAuditFilters)

  const [expanded, setExpanded] = useState<number | null>(null)
  const [limit, setLimit] = useState(100)

  useEffect(() => { loadAudit(limit) }, [limit])

  const actionTypes = useMemo(() => {
    const set = new Set<string>()
    audit.forEach((e) => { if (e.action) set.add(e.action) })
    return Array.from(set).sort()
  }, [audit])

  const filtered = useMemo(() => {
    let out = audit.slice()
    if (filters.actionType) out = out.filter((e) => e.action === filters.actionType)
    if (filters.actorId) out = out.filter((e) => String(e.user_id || '').includes(filters.actorId))
    if (filters.targetId) out = out.filter((e) => {
      try {
        const d = JSON.parse(e.details || '{}')
        const t = d.targetEmail || d.target || ''
        return String(t).toLowerCase().includes(filters.targetId.toLowerCase())
      } catch { return (e.details || '').toLowerCase().includes(filters.targetId.toLowerCase()) }
    })
    if (filters.dateFrom) out = out.filter((e) => (e.created_at || '') >= filters.dateFrom)
    if (filters.dateTo) out = out.filter((e) => (e.created_at || '') <= filters.dateTo + 'T23:59:59')
    return out
  }, [audit, filters])

  return (
    <>
      <div className="zac-filters">
        <select className="zac-select" value={filters.actionType} onChange={(e) => setFilters({ actionType: e.target.value })}>
          <option value="">All actions</option>
          {actionTypes.map((a) => <option key={a} value={a}>{a}</option>)}
        </select>
        <input className="zac-input" placeholder="Actor ID…" value={filters.actorId} onChange={(e) => setFilters({ actorId: e.target.value })} style={{ maxWidth: 140 }} />
        <input className="zac-input" placeholder="Target email/id…" value={filters.targetId} onChange={(e) => setFilters({ targetId: e.target.value })} style={{ maxWidth: 180 }} />
        <input className="zac-input" type="date" value={filters.dateFrom} onChange={(e) => setFilters({ dateFrom: e.target.value })} />
        <input className="zac-input" type="date" value={filters.dateTo} onChange={(e) => setFilters({ dateTo: e.target.value })} />
        <select className="zac-select" value={limit} onChange={(e) => setLimit(Number(e.target.value))}>
          <option value={50}>50</option>
          <option value={100}>100</option>
          <option value={200}>200</option>
        </select>
        <button className="zac-btn zac-btn-ghost" onClick={() => loadAudit(limit)}>↻</button>
        <button className="zac-btn zac-btn-ghost" onClick={() => setFilters({ actionType: '', actorId: '', targetId: '', dateFrom: '', dateTo: '' })}>Clear</button>
      </div>

      <div className="zac-panel" style={{ padding: 0 }}>
        <div className="zac-panel-header" style={{ padding: '14px 18px', margin: 0 }}>
          <div className="zac-panel-title">Audit Events ({filtered.length}{filtered.length !== audit.length ? ` of ${audit.length}` : ''})</div>
          <button className="zac-btn zac-btn-ghost zac-btn-sm" disabled title="Export CSV — Faza B">⤓ Export</button>
        </div>
        {auditLoading && <div style={{ padding: 18 }}><LoadingSkeleton rows={8} h={24} /></div>}
        {auditError && <div style={{ padding: 18, color: 'var(--ac-danger)' }}>{auditError}</div>}
        {!auditLoading && !auditError && filtered.length === 0 && <EmptyState message="No events match the current filters" />}
        {!auditLoading && !auditError && filtered.length > 0 && (
          <div style={{ overflowX: 'auto' }}>
            <table className="zac-table">
              <thead>
                <tr>
                  <th style={{ width: 140 }}>Timestamp</th>
                  <th style={{ width: 90 }}>Actor</th>
                  <th style={{ width: 200 }}>Action</th>
                  <th>Details</th>
                  <th style={{ width: 100 }}>IP</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((e, i) => (
                  <AuditRow key={i} e={e} expanded={expanded === i} onToggle={() => setExpanded(expanded === i ? null : i)} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  )
}

function AuditRow({ e, expanded, onToggle }: { e: AuditEntry; expanded: boolean; onToggle: () => void }) {
  const details = parseDetails(e.details)
  return (
    <>
      <tr onClick={onToggle}>
        <td style={{ fontSize: 10, color: 'var(--ac-fg-dim)', fontVariantNumeric: 'tabular-nums' }}>{fmtDate(e.created_at)}</td>
        <td style={{ fontSize: 10, color: 'var(--ac-fg-mute)' }}>{e.user_id ? `#${e.user_id}` : '—'}</td>
        <td><span style={{ color: actionColor(e.action), fontWeight: 700, fontSize: 10, letterSpacing: 1 }}>{e.action}</span></td>
        <td style={{ fontSize: 10, color: 'var(--ac-fg-dim)', maxWidth: 400, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: expanded ? 'normal' : 'nowrap' }}>{details}</td>
        <td style={{ fontSize: 10, color: 'var(--ac-fg-mute)', fontFamily: 'monospace' }}>{e.ip || '—'}</td>
      </tr>
      {expanded && e.details && (
        <tr>
          <td colSpan={5} style={{ background: 'var(--ac-bg-2)', padding: 0 }}>
            <pre style={{
              margin: 0, padding: 12,
              fontSize: 10, color: 'var(--ac-fg-dim)',
              fontFamily: 'monospace',
              whiteSpace: 'pre-wrap', wordBreak: 'break-all',
            }}>{prettyJson(e.details)}</pre>
          </td>
        </tr>
      )}
    </>
  )
}

function parseDetails(raw?: string): string {
  if (!raw) return ''
  try {
    const d = JSON.parse(raw)
    return Object.keys(d).map((k) => `${k}=${typeof d[k] === 'object' ? JSON.stringify(d[k]) : d[k]}`).join(' · ')
  } catch { return raw }
}

function prettyJson(raw?: string): string {
  if (!raw) return ''
  try { return JSON.stringify(JSON.parse(raw), null, 2) } catch { return raw }
}
