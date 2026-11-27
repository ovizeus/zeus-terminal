// [2026-11-27] Admin › Users: raportul de securitate pe ultimele 24 h (Sentinel, etapa 3). Doar citire.
// Cifrele vin din audit_log pe server; alertele pe telefon le trimite Sentinel la rafale si la IP nou.
import { useEffect, useState } from 'react'

type Report = { hours: number; failedSignIns: number; resetRequests: number; signUps: number; blockedSignUps: number; signIns: number; topFailIps: { ip: string; n: number }[] }

export function SecurityReport() {
  const [rep, setRep] = useState<Report | null>(null)
  const [alerts, setAlerts] = useState<number | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let alive = true
    fetch('/auth/admin/security-report', { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (!alive) return
        if (j && j.ok && j.report) { setRep(j.report); setAlerts(j.sentinel ? Number(j.sentinel.alertsSent) || 0 : null) } else setFailed(true)
      })
      .catch(() => { if (alive) setFailed(true) })
    return () => { alive = false }
  }, [])

  if (failed) return <div style={{ fontSize: 12, color: 'var(--dim, #8aa)', margin: '6px 0' }}>Security report unavailable.</div>
  if (!rep) return null
  const cell = (label: string, n: number, sub?: string) => (
    <div style={{ minWidth: 96 }}>
      <div style={{ fontSize: 18, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{n}</div>
      <div style={{ fontSize: 11, color: 'var(--dim, #8aa)' }}>{label}{sub ? ` · ${sub}` : ''}</div>
    </div>
  )
  return (
    <div style={{ border: '1px solid #1e2a38', borderRadius: 6, padding: '8px 10px', margin: '8px 0' }}>
      <div style={{ fontWeight: 700, marginBottom: 6 }}>Last {rep.hours} hours</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
        {cell('failed sign-ins', rep.failedSignIns)}
        {cell('password resets', rep.resetRequests)}
        {cell('sign-ups', rep.signUps, `${rep.blockedSignUps} blocked as bots`)}
        {cell('sign-ins', rep.signIns)}
      </div>
      {rep.topFailIps.length > 0 && (
        <div style={{ fontSize: 11, color: 'var(--dim, #8aa)', marginTop: 6 }}>
          Most active IPs on failures and resets: {rep.topFailIps.map((x) => `${x.ip} (${x.n})`).join(', ')}
        </div>
      )}
      {alerts !== null && <div style={{ fontSize: 11, color: 'var(--dim, #8aa)', marginTop: 4 }}>{alerts} alerts sent today to admin phones.</div>}
    </div>
  )
}
