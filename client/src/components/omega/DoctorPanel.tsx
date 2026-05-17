/**
 * OMEGA Doctor UI D-4 — admin-only diagnostic panel.
 *
 * Default view = top-10 most-degraded modules + last-N alerts + current
 * cognitive state badge. Polls /api/omega/doctor/state every 5s.
 *
 * Per project_omega_doctor_layer_locked.md: this is observational only.
 * Operator actions (verdict, quarantine) live in D-5 (quarantine manager
 * UI) and are added incrementally.
 */

import { useEffect, useState, useCallback } from 'react'
import {
    fetchDoctorState,
    fetchDoctorEvents,
    postDoctorVerdict,
    type DoctorStateResponse,
    type DoctorEvent,
    type CognitiveState,
    type Verdict,
} from './doctorApi'

const POLL_INTERVAL_MS = 5000
const EVENTS_LIMIT = 25
const VERDICTS: Verdict[] = ['real_incident', 'false_positive', 'inconclusive', 'partial']

function stateColorClass(state: CognitiveState): string {
    switch (state) {
        case 'HEALTHY': return 'omega-doctor-state-healthy'
        case 'DEGRADED': return 'omega-doctor-state-degraded'
        case 'COMPROMISED': return 'omega-doctor-state-compromised'
        case 'SAFE_MODE': return 'omega-doctor-state-safemode'
        case 'DEAD': return 'omega-doctor-state-dead'
    }
}

function fmtTs(ts: number): string {
    const d = new Date(ts)
    return d.toISOString().slice(11, 23)
}

export function DoctorPanel() {
    const [state, setState] = useState<DoctorStateResponse | null>(null)
    const [events, setEvents] = useState<DoctorEvent[]>([])
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [updatingVerdict, setUpdatingVerdict] = useState<string | null>(null)

    const reload = useCallback(async () => {
        setLoading(true)
        setError(null)
        try {
            const [s, e] = await Promise.all([
                fetchDoctorState(),
                fetchDoctorEvents({ limit: EVENTS_LIMIT }),
            ])
            setState(s)
            setEvents(e.events)
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err))
        } finally {
            setLoading(false)
        }
    }, [])

    useEffect(() => {
        reload()
        const t = setInterval(reload, POLL_INTERVAL_MS)
        return () => clearInterval(t)
    }, [reload])

    async function handleVerdict(eventId: string, verdict: Verdict) {
        setUpdatingVerdict(eventId)
        try {
            await postDoctorVerdict(eventId, verdict)
            await reload()
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err))
        } finally {
            setUpdatingVerdict(null)
        }
    }

    if (error) {
        return (
            <div className="omega-doctor-panel">
                <div className="omega-doctor-error">Doctor unavailable: {error}</div>
            </div>
        )
    }

    if (!state) {
        return (
            <div className="omega-doctor-panel">
                <div className="omega-doctor-loading">
                    {loading ? 'Loading Doctor data…' : 'Doctor idle'}
                </div>
            </div>
        )
    }

    return (
        <div className="omega-doctor-panel">
            <div className="omega-doctor-header">
                <span className="omega-doctor-title">OMEGA DOCTOR</span>
                <span className="omega-doctor-tag">D-4 admin-only</span>
                <span className={`omega-doctor-state-badge ${stateColorClass(state.state)}`}>
                    {state.state}
                </span>
            </div>

            <div className="omega-doctor-reason">{state.reason}</div>

            <div className="omega-doctor-stats">
                <div className="omega-doctor-stat">
                    <span className="omega-doctor-stat-label">Active P0</span>
                    <span className="omega-doctor-stat-val">{state.activeP0}</span>
                </div>
                <div className="omega-doctor-stat">
                    <span className="omega-doctor-stat-label">Active P1</span>
                    <span className="omega-doctor-stat-val">{state.activeP1}</span>
                </div>
                <div className="omega-doctor-stat">
                    <span className="omega-doctor-stat-label">HPC quarantined</span>
                    <span className="omega-doctor-stat-val">{state.hotPathCriticalQuarantined}</span>
                </div>
                <div className="omega-doctor-stat">
                    <span className="omega-doctor-stat-label">HPA quarantined</span>
                    <span className="omega-doctor-stat-val">{state.hotPathAssistQuarantined}</span>
                </div>
            </div>

            <div className="omega-doctor-quotas">
                <span className="omega-doctor-quota">
                    P0 24h: <strong>{state.quotaStatus.p0_24h}</strong>/3
                </span>
                <span className="omega-doctor-quota">
                    P1 1h: <strong>{state.quotaStatus.p1_1h}</strong>/10
                </span>
                <span className="omega-doctor-quota">
                    P2 1h: <strong>{state.quotaStatus.p2_1h}</strong>/100
                </span>
                {state.quotaStatus.p0_flood_24h > 0 && (
                    <span className="omega-doctor-quota omega-doctor-quota-flood">
                        FLOOD: {state.quotaStatus.p0_flood_24h}
                    </span>
                )}
            </div>

            {state.lowTrustModules.length > 0 && (
                <div className="omega-doctor-section">
                    <div className="omega-doctor-section-title">Low Trust Modules</div>
                    <ul className="omega-doctor-list">
                        {state.lowTrustModules.slice(0, 10).map((m) => (
                            <li key={m.moduleId}>
                                {m.moduleId}: {m.trustScore.toFixed(3)} ({m.observationCount} obs)
                            </li>
                        ))}
                    </ul>
                </div>
            )}

            {state.downweightedModules.length > 0 && (
                <div className="omega-doctor-section">
                    <div className="omega-doctor-section-title">Downweighted (FP &gt; 30%)</div>
                    <ul className="omega-doctor-list">
                        {state.downweightedModules.slice(0, 10).map((m) => (
                            <li key={m.moduleId}>
                                {m.moduleId}: FP {(m.fpRate * 100).toFixed(1)}%
                            </li>
                        ))}
                    </ul>
                </div>
            )}

            <div className="omega-doctor-section">
                <div className="omega-doctor-section-title">Recent Events ({events.length})</div>
                <div className="omega-doctor-events">
                    {events.length === 0 && <div className="omega-doctor-empty">no events</div>}
                    {events.map((e) => (
                        <div key={e.event_id} className={`omega-doctor-event omega-doctor-event-${e.severity.toLowerCase().replace('-', '')}`}>
                            <span className="omega-doctor-event-ts">{fmtTs(e.ts)}</span>
                            <span className="omega-doctor-event-sev">{e.severity}</span>
                            <span className="omega-doctor-event-mod">{e.module_id}</span>
                            <span className="omega-doctor-event-type">{e.event_type}</span>
                            {(e.severity === 'P0' || e.severity === 'P1') && (
                                <select
                                    className="omega-doctor-verdict-select"
                                    value={e.verdict ?? ''}
                                    disabled={updatingVerdict === e.event_id}
                                    onChange={(ev) => handleVerdict(e.event_id, ev.target.value as Verdict)}
                                >
                                    <option value="" disabled>verdict…</option>
                                    {VERDICTS.map((v) => (
                                        <option key={v} value={v}>{v}</option>
                                    ))}
                                </select>
                            )}
                        </div>
                    ))}
                </div>
            </div>
        </div>
    )
}
