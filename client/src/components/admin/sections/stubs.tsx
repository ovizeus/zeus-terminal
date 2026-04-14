import { Placeholder } from '../shared/components'
import { useAdminStore } from '../../../stores/adminStore'

export function RolesSection() {
  return (
    <>
      <div className="zac-panel">
        <div className="zac-panel-header"><div className="zac-panel-title">Roles</div></div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 10 }}>
          <RoleCard name="Super Admin" desc="Full access, system control, emergency tools" color="#ff4d4d" />
          <RoleCard name="Admin" desc="Users, audit, operations" color="#00d4ff" />
          <RoleCard name="Support" desc="Read-only user ops, account repair" color="#b888ff" />
          <RoleCard name="Analyst" desc="View audit, monitoring, export" color="#00ff88" />
        </div>
      </div>
      <div className="zac-panel">
        <div className="zac-panel-header"><div className="zac-panel-title">Permissions Matrix</div></div>
        <Placeholder
          title="Role-based permissions matrix"
          note="Current backend uses role='admin' only. The matrix below will define granular per-resource access once the roles table is provisioned."
        />
      </div>
    </>
  )
}

function RoleCard({ name, desc, color }: { name: string; desc: string; color: string }) {
  return (
    <div style={{ padding: 14, background: 'var(--ac-bg-2)', border: '1px solid var(--ac-border)', borderRadius: 6, borderLeft: `3px solid ${color}` }}>
      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1.5, textTransform: 'uppercase', color }}>{name}</div>
      <div style={{ fontSize: 10, color: 'var(--ac-fg-dim)', marginTop: 6 }}>{desc}</div>
      <div style={{ fontSize: 9, color: 'var(--ac-fg-mute)', marginTop: 8 }}>Members: —</div>
    </div>
  )
}

export function SecuritySection() {
  const audit = useAdminStore((s) => s.audit)
  const logins = audit.filter((e) => (e.action || '').includes('LOGIN')).slice(0, 10)
  const failed = audit.filter((e) => (e.action || '').includes('FAILED')).slice(0, 10)
  const admins = audit.filter((e) => (e.action || '').startsWith('ADMIN_')).slice(0, 10)

  return (
    <>
      <div className="zac-panel">
        <div className="zac-panel-header"><div className="zac-panel-title">Recent Admin Actions</div></div>
        <EventsList events={admins} empty="No admin actions recorded" />
      </div>
      <div className="zac-panel">
        <div className="zac-panel-header"><div className="zac-panel-title">Login Activity</div></div>
        <EventsList events={logins} empty="No login events" />
      </div>
      <div className="zac-panel">
        <div className="zac-panel-header"><div className="zac-panel-title">Failed Attempts</div></div>
        <EventsList events={failed} empty="No failed attempts" />
      </div>
      <div className="zac-panel">
        <div className="zac-panel-header"><div className="zac-panel-title">Active Sessions</div></div>
        <Placeholder title="Live session list" note="In-memory session activity is tracked server-side; the admin endpoint to expose it is planned for Faza B." />
      </div>
    </>
  )
}

function EventsList({ events, empty }: { events: any[]; empty: string }) {
  if (!events.length) return <div style={{ fontSize: 11, color: 'var(--ac-fg-mute)', padding: '8px 4px' }}>{empty}</div>
  return (
    <div style={{ display: 'grid', gap: 2 }}>
      {events.map((e, i) => (
        <div key={i} className="zac-event">
          <span className="t">{e.created_at}</span>
          <span className="a">{e.action}</span>
          <span className="d">{e.user_id ? `uid:${e.user_id}` : ''} {e.details || ''}</span>
        </div>
      ))}
    </div>
  )
}

export function BillingSection() {
  return (
    <div className="zac-panel">
      <div className="zac-panel-header"><div className="zac-panel-title">Billing & Plans</div></div>
      <Placeholder
        title="Plans management"
        note="User plans, subscriptions, invoicing and renewal tracking require schema extensions (plans table) and a billing provider hookup. UI is scaffolded; bindings arrive in Faza B."
      />
    </div>
  )
}

export function SupportSection() {
  return (
    <div className="zac-panel">
      <div className="zac-panel-header"><div className="zac-panel-title">Support & Operations</div></div>
      <Placeholder
        title="Ops workspace"
        note="Recent support cases, internal notes, problem flags, account repair tools, resync / refresh actions. Structure ready; backend bindings scheduled for Faza C."
      />
    </div>
  )
}

export function MonitoringSection() {
  const health = useAdminStore((s) => s.health)
  return (
    <>
      <div className="zac-panel">
        <div className="zac-panel-header"><div className="zac-panel-title">System Health</div></div>
        {health ? (
          <div className="zac-health-strip">
            <HC label="Server" s={health.server} />
            <HC label="WebSocket" s={health.websocket} />
            <HC label="Database" s={health.database} />
            <HC label="Exchange" s={health.exchange} />
            <HC label="Sync" s={health.sync} />
            <HC label="Audit" s={health.audit} />
          </div>
        ) : <div style={{ fontSize: 11, color: 'var(--ac-fg-mute)' }}>No health data yet. Refresh the dashboard first.</div>}
      </div>
      <div className="zac-panel">
        <div className="zac-panel-header"><div className="zac-panel-title">Module Status</div></div>
        <Placeholder
          title="AT / DSL / ARES / Sync / Watchlist / Market Feed"
          note="Per-module health, queue depth, reconnect counts, error rates. The server exposes these in logs today; a structured endpoint will surface them to this panel."
        />
      </div>
    </>
  )
}

function HC({ label, s }: { label: string; s: 'ok' | 'warn' | 'down' }) {
  return (
    <div className="zac-health-cell">
      <span className="label">{label}</span>
      <span className="value"><span className={`zac-dot zac-dot-${s}`} />{s === 'ok' ? 'OK' : s === 'warn' ? 'WARN' : 'DOWN'}</span>
    </div>
  )
}

export function SettingsSection() {
  return (
    <>
      <div className="zac-panel">
        <div className="zac-panel-header"><div className="zac-panel-title">Feature Flags</div></div>
        <Placeholder
          title="Global toggles"
          note="Maintenance mode, registration on/off, invite-only, rollout gates. Toggle surface ready — storage and evaluation engine in Faza C."
        />
      </div>
      <div className="zac-panel">
        <div className="zac-panel-header"><div className="zac-panel-title">Safety Toggles</div></div>
        <Placeholder title="Emergency switches" note="Global trading lock, emergency admin broadcast, global force-logout. Destructive toggles — scoped to Faza C with strict confirm flows." />
      </div>
    </>
  )
}
