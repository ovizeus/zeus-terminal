/**
 * Ring5 UI panel (Day 6) — admin-only observability for ML Plan v3 Phase B
 * influence pipeline. Three sections: audit trail (polled), live eligibility
 * check (form), live posteriors viewer (form).
 */

import { useCallback, useEffect, useState } from 'react'
import {
    fetchRing5Audit,
    fetchRing5Eligibility,
    fetchRing5Posteriors,
    fetchRing5InfluenceStatus,
    postRing5InfluenceSeed,
    fetchRing5Aggregate,
    fetchRing5Cells,
    type Ring5AuditRow,
    type Ring5EligibilityResult,
    type Ring5PosteriorsResponse,
    type Ring5InfluenceStatusResponse,
    type Ring5AggregateBucket,
    type Ring5Cell,
} from './ring5Api'

const POLL_INTERVAL_MS = 5000
const AUDIT_LIMIT = 50

function fmtTs(ts: number): string {
    const d = new Date(ts)
    return d.toISOString().slice(11, 23)
}

function statusClass(status: string): string {
    switch (status) {
        case 'accepted': return 'omega-ring5-status-accepted'
        case 'rejected': return 'omega-ring5-status-rejected'
        case 'skipped': return 'omega-ring5-status-skipped'
        default: return ''
    }
}

interface QueryForm {
    userId: string
    env: string
    symbol: string
    regime: string
}

const DEFAULT_FORM: QueryForm = {
    userId: '1', env: 'DEMO', symbol: 'BTCUSDT', regime: 'trending'
}

interface Ring5PanelProps {
    forceExpanded?: boolean
}

export function Ring5Panel({ forceExpanded = false }: Ring5PanelProps = {}) {
    const [expandedState, setExpanded] = useState(false)
    const expanded = forceExpanded || expandedState
    const [audit, setAudit] = useState<Ring5AuditRow[]>([])
    const [auditLoading, setAuditLoading] = useState(false)
    const [auditError, setAuditError] = useState<string | null>(null)

    const [eligForm, setEligForm] = useState<QueryForm>(DEFAULT_FORM)
    const [eligResult, setEligResult] = useState<Ring5EligibilityResult | null>(null)
    const [eligError, setEligError] = useState<string | null>(null)

    const [postForm, setPostForm] = useState<QueryForm>(DEFAULT_FORM)
    const [postResult, setPostResult] = useState<Ring5PosteriorsResponse | null>(null)
    const [postError, setPostError] = useState<string | null>(null)

    const [influenceStatus, setInfluenceStatus] = useState<Ring5InfluenceStatusResponse | null>(null)
    const [influenceError, setInfluenceError] = useState<string | null>(null)
    const [seedBusy, setSeedBusy] = useState(false)

    const [aggBuckets, setAggBuckets] = useState<Ring5AggregateBucket[]>([])
    const [aggTotal, setAggTotal] = useState(0)
    const [aggError, setAggError] = useState<string | null>(null)
    const [cells, setCells] = useState<Ring5Cell[]>([])
    const [cellsError, setCellsError] = useState<string | null>(null)

    const reloadAggregate = useCallback(async () => {
        try {
            const r = await fetchRing5Aggregate()
            setAggBuckets(r.buckets)
            setAggTotal(r.totalRows)
            setAggError(null)
        } catch (err) {
            setAggError(err instanceof Error ? err.message : String(err))
        }
    }, [])

    const reloadCells = useCallback(async () => {
        try {
            const r = await fetchRing5Cells({ limit: 50 })
            setCells(r.cells)
            setCellsError(null)
        } catch (err) {
            setCellsError(err instanceof Error ? err.message : String(err))
        }
    }, [])

    useEffect(() => {
        if (!expanded) return
        reloadAggregate()
        reloadCells()
        const t = setInterval(() => {
            reloadAggregate()
            reloadCells()
        }, POLL_INTERVAL_MS * 2)  // poll at half audit cadence
        return () => clearInterval(t)
    }, [reloadAggregate, reloadCells, expanded])

    const reloadInfluenceStatus = useCallback(async () => {
        try {
            const s = await fetchRing5InfluenceStatus()
            setInfluenceStatus(s)
        } catch (err) {
            setInfluenceError(err instanceof Error ? err.message : String(err))
        }
    }, [])

    useEffect(() => {
        if (!expanded) return
        reloadInfluenceStatus()
    }, [reloadInfluenceStatus, expanded])

    async function handleSeed() {
        setSeedBusy(true)
        setInfluenceError(null)
        try {
            await postRing5InfluenceSeed()
            await reloadInfluenceStatus()
        } catch (err) {
            setInfluenceError(err instanceof Error ? err.message : String(err))
        } finally {
            setSeedBusy(false)
        }
    }

    const reloadAudit = useCallback(async () => {
        setAuditLoading(true)
        setAuditError(null)
        try {
            const res = await fetchRing5Audit({ limit: AUDIT_LIMIT })
            setAudit(res.rows)
        } catch (err) {
            setAuditError(err instanceof Error ? err.message : String(err))
        } finally {
            setAuditLoading(false)
        }
    }, [])

    useEffect(() => {
        if (!expanded) return
        reloadAudit()
        const t = setInterval(reloadAudit, POLL_INTERVAL_MS)
        return () => clearInterval(t)
    }, [reloadAudit, expanded])

    async function handleCheckEligibility(e: React.FormEvent) {
        e.preventDefault()
        setEligError(null)
        try {
            const res = await fetchRing5Eligibility({
                userId: parseInt(eligForm.userId, 10),
                env: eligForm.env,
                symbol: eligForm.symbol,
                regime: eligForm.regime,
            })
            setEligResult(res.eligibility)
        } catch (err) {
            setEligError(err instanceof Error ? err.message : String(err))
            setEligResult(null)
        }
    }

    async function handleQueryPosteriors(e: React.FormEvent) {
        e.preventDefault()
        setPostError(null)
        try {
            const res = await fetchRing5Posteriors({
                userId: parseInt(postForm.userId, 10),
                env: postForm.env,
                symbol: postForm.symbol,
                regime: postForm.regime,
            })
            setPostResult(res)
        } catch (err) {
            setPostError(err instanceof Error ? err.message : String(err))
            setPostResult(null)
        }
    }

    return (
        <div className="omega-ring5-panel">
            {!forceExpanded && (
                <button
                    type="button"
                    className={`omega-ring5-header omega-ring5-header-button${expanded ? ' expanded' : ''}`}
                    onClick={() => setExpanded(e => !e)}
                    aria-expanded={expanded}
                >
                    <span className="omega-ring5-chevron">{expanded ? '▼' : '▶'}</span>
                    <span className="omega-ring5-title">RING5 INFLUENCE PIPELINE</span>
                    <span className="omega-ring5-tag">Day 5 admin-only</span>
                </button>
            )}

            {expanded && <>

            <section className="omega-ring5-section">
                <h3 className="omega-ring5-section-title">Influence activation</h3>
                {influenceError && <div className="omega-ring5-error">{influenceError}</div>}
                {influenceStatus && (
                    <div className="omega-ring5-result">
                        <div>
                            Status:{' '}
                            <strong className={influenceStatus.active ? 'omega-ring5-status-accepted' : 'omega-ring5-status-skipped'}>
                                {influenceStatus.active ? 'ACTIVE' : 'INACTIVE'}
                            </strong>
                        </div>
                        <div>Version ID: <code>{influenceStatus.versionId ?? '—'}</code></div>
                        <div>PreReg ID: <code>{influenceStatus.preRegId ?? '—'}</code></div>
                        <div>PreReg State: <code>{influenceStatus.preRegState ?? '—'}</code></div>
                    </div>
                )}
                <div className="omega-ring5-form">
                    <button type="button" onClick={handleSeed} disabled={seedBusy}>
                        {seedBusy ? 'Seeding…' : (influenceStatus?.active ? 'Re-check status' : 'Seed influence (activate)')}
                    </button>
                </div>
                {!influenceStatus?.active && (
                    <div className="omega-ring5-loading">
                        Seeding creates version + 30-day preReg. Eligibility still requires ≥30 obs per cell before wrap mutates fusion.
                    </div>
                )}
            </section>

            <section className="omega-ring5-section">
                <h3 className="omega-ring5-section-title">
                    Audit aggregate (last 24h, {aggTotal} rows total)
                </h3>
                {aggError && <div className="omega-ring5-error">{aggError}</div>}
                {aggBuckets.length === 0 && !aggError && (
                    <div className="omega-ring5-empty">No audit data in last 24h.</div>
                )}
                {aggBuckets.length > 0 && (
                    <table className="omega-ring5-audit-table">
                        <thead>
                            <tr>
                                <th>Symbol</th>
                                <th>Regime</th>
                                <th>Status</th>
                                <th>Count</th>
                                <th>Avg P2 conf</th>
                                <th>Avg proposed</th>
                            </tr>
                        </thead>
                        <tbody>
                            {aggBuckets.map((b, i) => (
                                <tr key={`${b.symbol}-${b.regime}-${b.gate_status}-${i}`}>
                                    <td>{b.symbol}</td>
                                    <td>{b.regime}</td>
                                    <td className={statusClass(b.gate_status)}>{b.gate_status}</td>
                                    <td>{b.n}</td>
                                    <td>{b.avg_p2_conf ? b.avg_p2_conf.toFixed(1) : '—'}</td>
                                    <td>{b.avg_proposed_conf ? b.avg_proposed_conf.toFixed(1) : '—'}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}
            </section>

            <section className="omega-ring5-section">
                <h3 className="omega-ring5-section-title">
                    Bandit cells (L4 user-owned, top {cells.length})
                </h3>
                {cellsError && <div className="omega-ring5-error">{cellsError}</div>}
                {cells.length === 0 && !cellsError && (
                    <div className="omega-ring5-empty">No bandit observations yet — waiting for trade closes.</div>
                )}
                {cells.length > 0 && (
                    <table className="omega-ring5-post-table">
                        <thead>
                            <tr>
                                <th>Cell key (user:env:symbol:regime)</th>
                                <th>α</th>
                                <th>β</th>
                                <th>Observations</th>
                                <th>Win rate</th>
                            </tr>
                        </thead>
                        <tbody>
                            {cells.map(c => {
                                const winRate = c.observationCount > 0
                                    ? ((c.alpha - 1) / c.observationCount * 100).toFixed(1)
                                    : '—'
                                return (
                                    <tr key={c.cellKey}>
                                        <td>{c.cellKey}</td>
                                        <td>{c.alpha}</td>
                                        <td>{c.beta}</td>
                                        <td>{c.observationCount}</td>
                                        <td>{winRate === '—' ? '—' : winRate + '%'}</td>
                                    </tr>
                                )
                            })}
                        </tbody>
                    </table>
                )}
            </section>

            <section className="omega-ring5-section">
                <h3 className="omega-ring5-section-title">
                    Audit trail (last {AUDIT_LIMIT}, polled {POLL_INTERVAL_MS / 1000}s)
                </h3>
                {auditError && <div className="omega-ring5-error">{auditError}</div>}
                {auditLoading && audit.length === 0 && (
                    <div className="omega-ring5-loading">Loading…</div>
                )}
                {audit.length === 0 && !auditLoading && !auditError && (
                    <div className="omega-ring5-empty">No audit rows yet.</div>
                )}
                {audit.length > 0 && (
                    <table className="omega-ring5-audit-table">
                        <thead>
                            <tr>
                                <th>TS</th>
                                <th>User</th>
                                <th>Env</th>
                                <th>Symbol</th>
                                <th>Regime</th>
                                <th>P2 dir/conf</th>
                                <th>Proposed conf</th>
                                <th>Status</th>
                                <th>Reason</th>
                            </tr>
                        </thead>
                        <tbody>
                            {audit.map(r => (
                                <tr key={r.id}>
                                    <td>{fmtTs(r.created_at)}</td>
                                    <td>{r.user_id}</td>
                                    <td>{r.env}</td>
                                    <td>{r.symbol}</td>
                                    <td>{r.regime}</td>
                                    <td>{r.phase2_dir} / {r.phase2_confidence}</td>
                                    <td>{r.proposed_confidence}</td>
                                    <td className={statusClass(r.gate_status)}>{r.gate_status}</td>
                                    <td>{r.gate_reason}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}
            </section>

            <section className="omega-ring5-section">
                <h3 className="omega-ring5-section-title">Eligibility check (live)</h3>
                <form className="omega-ring5-form" onSubmit={handleCheckEligibility}>
                    <input
                        placeholder="userId"
                        value={eligForm.userId}
                        onChange={e => setEligForm({ ...eligForm, userId: e.target.value })}
                    />
                    <input
                        placeholder="env"
                        value={eligForm.env}
                        onChange={e => setEligForm({ ...eligForm, env: e.target.value })}
                    />
                    <input
                        placeholder="symbol"
                        value={eligForm.symbol}
                        onChange={e => setEligForm({ ...eligForm, symbol: e.target.value })}
                    />
                    <input
                        placeholder="regime"
                        value={eligForm.regime}
                        onChange={e => setEligForm({ ...eligForm, regime: e.target.value })}
                    />
                    <button type="submit">Check</button>
                </form>
                {eligError && <div className="omega-ring5-error">{eligError}</div>}
                {eligResult && (
                    <div className="omega-ring5-result">
                        <div>
                            Eligible: <strong>{eligResult.eligible ? 'YES' : 'NO'}</strong>
                        </div>
                        <div>Reason: <code>{eligResult.reason}</code></div>
                        <div>Observations: <strong>{eligResult.observationCount}</strong></div>
                        <div>PreReg status: <code>{eligResult.preRegStatus ?? '—'}</code></div>
                        <div>Version ID: <code>{eligResult.versionId ?? '—'}</code></div>
                    </div>
                )}
            </section>

            <section className="omega-ring5-section">
                <h3 className="omega-ring5-section-title">Posteriors viewer (live)</h3>
                <form className="omega-ring5-form" onSubmit={handleQueryPosteriors}>
                    <input
                        placeholder="userId"
                        value={postForm.userId}
                        onChange={e => setPostForm({ ...postForm, userId: e.target.value })}
                    />
                    <input
                        placeholder="env"
                        value={postForm.env}
                        onChange={e => setPostForm({ ...postForm, env: e.target.value })}
                    />
                    <input
                        placeholder="symbol"
                        value={postForm.symbol}
                        onChange={e => setPostForm({ ...postForm, symbol: e.target.value })}
                    />
                    <input
                        placeholder="regime"
                        value={postForm.regime}
                        onChange={e => setPostForm({ ...postForm, regime: e.target.value })}
                    />
                    <button type="submit">Query</button>
                </form>
                {postError && <div className="omega-ring5-error">{postError}</div>}
                {postResult && (
                    <table className="omega-ring5-post-table">
                        <thead>
                            <tr>
                                <th>Level</th>
                                <th>Cell key</th>
                                <th>α</th>
                                <th>β</th>
                                <th>Observations</th>
                            </tr>
                        </thead>
                        <tbody>
                            {(['L0', 'L1', 'L2', 'L3', 'L4'] as const).map(k => {
                                const p = postResult.posteriors[k]
                                return (
                                    <tr key={k}>
                                        <td>{k}</td>
                                        <td>{p ? p.cellKey : '—'}</td>
                                        <td>{p ? p.alpha : '—'}</td>
                                        <td>{p ? p.beta : '—'}</td>
                                        <td>{p ? p.observationCount : '—'}</td>
                                    </tr>
                                )
                            })}
                            <tr className="omega-ring5-post-effective">
                                <td>effective</td>
                                <td>{postResult.effective.cellKey}</td>
                                <td>{postResult.effective.alpha}</td>
                                <td>{postResult.effective.beta}</td>
                                <td>{postResult.effective.observationCount}</td>
                            </tr>
                        </tbody>
                    </table>
                )}
            </section>

            </>}
        </div>
    )
}
