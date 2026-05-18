import { useEffect, useState } from 'react'

/**
 * [Wave 8 P] Performance "Report Card" — aggregated OMEGA dashboard.
 * Pulls multiple endpoints into a single read-only view:
 *   - DD status (Wave 8 D)
 *   - Audit chain head + recent count + verify (Wave 7b)
 *   - Inter-ring trace activity (Wave 7a)
 *   - Constitution violations summary (Wave 5)
 *   - R3B calibration sample size (Wave 4)
 *   - Voice 24h count + R5A stats summary
 *
 * Read-only. Refresh button + 30s auto-poll.
 */

interface DDStatus { drawdownPct: number; dailyPnL: number; refBalance: number; tier: string; locked: boolean; color: 'green' | 'yellow' | 'red' }
interface ChainHead { id: number; entry_hash: string; kind: string; ts: number }
interface ChainVerify { ok: boolean; entries: number; firstBroken: number | null; reason?: string }
interface RingTrace { callee_module: string; method: string; duration_ms: number; ok: number; ts: number }
interface Violation { principle_id: string; principle_name: string; severity: string; symbol: string; ts: number }

async function _safeFetch<T>(url: string): Promise<T | null> {
    try {
        const r = await fetch(url, { credentials: 'include' })
        if (!r.ok) return null
        const j = await r.json()
        return j as T
    } catch (_) { return null }
}

export function ReportCard() {
    const [dd, setDd] = useState<DDStatus | null>(null)
    const [chainHead, setChainHead] = useState<ChainHead | null>(null)
    const [chainVerify, setChainVerify] = useState<ChainVerify | null>(null)
    const [chainCount, setChainCount] = useState<number>(0)
    const [traces, setTraces] = useState<RingTrace[]>([])
    const [violations, setViolations] = useState<Violation[]>([])
    const [principlesCount, setPrinciplesCount] = useState<number>(0)
    const [loading, setLoading] = useState(true)
    const [refreshTick, setRefreshTick] = useState(0)

    useEffect(() => {
        let cancelled = false
        async function load() {
            setLoading(true)
            const [ddR, headR, verifyR, recentR, traceR, violR, princR] = await Promise.all([
                _safeFetch<DDStatus & { ok: boolean }>('/api/omega/dd-status'),
                _safeFetch<{ ok: boolean; head: ChainHead | null }>('/api/omega/audit/chain/head'),
                _safeFetch<{ ok: boolean; result: ChainVerify }>('/api/omega/audit/chain/verify'),
                _safeFetch<{ ok: boolean; entries: any[] }>('/api/omega/audit/chain/recent?limit=200'),
                _safeFetch<{ ok: boolean; traces: RingTrace[] }>('/api/omega/inter-ring/recent?limit=100'),
                _safeFetch<{ ok: boolean; violations: Violation[] }>('/api/omega/constitution/violations?limit=50'),
                _safeFetch<{ ok: boolean; principles: any[] }>('/api/omega/constitution/principles'),
            ])
            if (cancelled) return
            if (ddR && (ddR as any).ok) setDd(ddR as DDStatus)
            if (headR && headR.ok) setChainHead(headR.head)
            if (verifyR && verifyR.ok) setChainVerify(verifyR.result)
            if (recentR && recentR.ok) setChainCount(recentR.entries.length)
            if (traceR && traceR.ok) setTraces(traceR.traces)
            if (violR && violR.ok) setViolations(violR.violations)
            if (princR && princR.ok) setPrinciplesCount(princR.principles.length)
            setLoading(false)
        }
        load()
        const t = setInterval(() => setRefreshTick(x => x + 1), 30000)
        return () => { cancelled = true; clearInterval(t) }
    }, [refreshTick])

    // Aggregate ring trace stats
    const tracesByCallee: Record<string, { calls: number; avgMs: number; fails: number }> = {}
    for (const t of traces) {
        const k = t.callee_module
        if (!tracesByCallee[k]) tracesByCallee[k] = { calls: 0, avgMs: 0, fails: 0 }
        const prev = tracesByCallee[k]
        prev.avgMs = (prev.avgMs * prev.calls + (t.duration_ms || 0)) / (prev.calls + 1)
        prev.calls += 1
        if (t.ok === 0) prev.fails += 1
    }

    const violSummary: Record<string, number> = {}
    for (const v of violations) violSummary[v.principle_id] = (violSummary[v.principle_id] || 0) + 1

    if (loading) {
        return <div className="omega-reportcard"><div className="omega-rc-loading">loading report card…</div></div>
    }

    return (
        <div className="omega-reportcard">
            <div className="omega-rc-grid">
                {/* DD Status */}
                <div className="omega-rc-card">
                    <div className="omega-rc-card-title">DAILY DRAWDOWN</div>
                    {dd ? (
                        <>
                            <div className={`omega-rc-big omega-rc-dd-${dd.color}`}>
                                {dd.drawdownPct.toFixed(2)}%
                            </div>
                            <div className="omega-rc-sub">
                                pnl ${dd.dailyPnL.toFixed(2)} · ref ${dd.refBalance.toFixed(0)} · tier {dd.tier}
                                {dd.locked && <span className="omega-rc-locked"> · LOCKED</span>}
                            </div>
                        </>
                    ) : <div className="omega-rc-empty">no data</div>}
                </div>

                {/* Audit chain */}
                <div className="omega-rc-card">
                    <div className="omega-rc-card-title">AUDIT CHAIN</div>
                    {chainVerify ? (
                        <>
                            <div className={`omega-rc-big ${chainVerify.ok ? 'omega-rc-ok' : 'omega-rc-bad'}`}>
                                {chainVerify.ok ? 'VERIFIED' : 'BROKEN'}
                            </div>
                            <div className="omega-rc-sub">
                                {chainCount} entries · head {chainHead ? chainHead.kind : 'n/a'}
                                {chainHead && <> · {chainHead.entry_hash.slice(0, 10)}…</>}
                                {!chainVerify.ok && <> · brokenAt id={chainVerify.firstBroken}</>}
                            </div>
                        </>
                    ) : <div className="omega-rc-empty">chain not verified</div>}
                </div>

                {/* Constitution */}
                <div className="omega-rc-card">
                    <div className="omega-rc-card-title">CONSTITUTION</div>
                    <div className="omega-rc-big">{principlesCount} principles</div>
                    <div className="omega-rc-sub">
                        {violations.length} violations recent · {Object.keys(violSummary).length} unique
                    </div>
                    {Object.entries(violSummary).slice(0, 3).map(([id, n]) => (
                        <div key={id} className="omega-rc-row">
                            <span className="omega-rc-row-label">{id}</span>
                            <span className="omega-rc-row-val">{n}</span>
                        </div>
                    ))}
                </div>

                {/* Inter-ring */}
                <div className="omega-rc-card">
                    <div className="omega-rc-card-title">INTER-RING</div>
                    <div className="omega-rc-big">{traces.length}</div>
                    <div className="omega-rc-sub">calls last 100 · {Object.values(tracesByCallee).reduce((s, x) => s + x.fails, 0)} fails</div>
                    {Object.entries(tracesByCallee).slice(0, 4).map(([callee, stats]) => (
                        <div key={callee} className="omega-rc-row">
                            <span className="omega-rc-row-label">{callee.replace('server', '')}</span>
                            <span className="omega-rc-row-val">{stats.calls} · {stats.avgMs.toFixed(1)}ms</span>
                        </div>
                    ))}
                </div>
            </div>

            <div className="omega-rc-footer">
                <button className="omega-rc-refresh" onClick={() => setRefreshTick(x => x + 1)}>
                    refresh
                </button>
                <span className="omega-rc-hint">auto-refresh 30s · Wave 8 P aggregate</span>
            </div>
        </div>
    )
}
