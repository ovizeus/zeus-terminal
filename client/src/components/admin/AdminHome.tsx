import { useEffect, useState } from 'react'
import { useAdminStore } from '../../stores/adminStore'
import { useSupportStore } from '../../stores/supportStore'
import { NAV, GROUPS, actionCounts } from './adminNav'

/**
 * [2026-11-06] Admin launcher.
 *
 * The sections used to live only in a narrow strip you had to scroll before
 * you could see what was there. This puts all of them on one screen as tiles.
 * Opening a tile shows exactly the section that existed before — nothing
 * inside any of them changed.
 *
 * The tiles carry the outstanding counts, which is the part that earns the
 * page: the question someone opens Admin to answer is "where is work waiting",
 * and that was previously hidden inside a strip.
 */
export function AdminHome() {
  const setSection = useAdminStore((s) => s.setSection)
  const users = useAdminStore((s) => s.users)
  const supportUnread = useSupportStore((s) => s.adminUnread)
  const [indicatorRequests, setIndicatorRequests] = useState(0)

  useEffect(() => {
    let alive = true
    fetch('/api/byoi/admin/count', { credentials: 'same-origin' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (alive && d && d.ok) setIndicatorRequests(d.count || 0) })
      .catch(() => { /* a missing count must never keep the launcher from rendering */ })
    return () => { alive = false }
  }, [])

  const pendingApprovals = users.filter((u) => !u.approved && u.role !== 'admin').length
  const counts = actionCounts({ pendingApprovals, indicatorRequests, supportUnread: supportUnread || 0 })
  const waiting = Object.values(counts).reduce<number>((a, b) => a + (b || 0), 0)

  return (
    <div className="zac-section zac-home">
      <div className="zac-home-lead">
        {waiting > 0
          ? <>You have <b>{waiting}</b> thing{waiting === 1 ? '' : 's'} waiting.</>
          : <>Nothing is waiting on you.</>}
      </div>

      {GROUPS.map((g) => {
        const items = NAV.filter((n) => n.group === g.id)
        if (items.length === 0) return null
        return (
          <div className="zac-home-group" key={g.id}>
            <div className="zac-home-group-label">{g.label}</div>
            <div className="zac-home-grid">
              {items.map((n) => {
                const cnt = counts[n.id]
                return (
                  <button
                    key={n.id}
                    type="button"
                    className={`zac-tile${n.wip ? ' wip' : ''}${cnt ? ' has-count' : ''}`}
                    onClick={() => setSection(n.id)}
                    aria-label={cnt ? `${n.label}, ${cnt} waiting` : n.label}
                  >
                    <span className="zac-tile-ico" aria-hidden>{n.icon}</span>
                    <span className="zac-tile-label">{n.label}</span>
                    {n.blurb && <span className="zac-tile-blurb">{n.blurb}</span>}
                    {n.wip && <span className="zac-tile-wip">WIP</span>}
                    {cnt ? <span className="zac-tile-count">{cnt > 99 ? '99+' : cnt}</span> : null}
                  </button>
                )
              })}
            </div>
          </div>
        )
      })}
    </div>
  )
}
