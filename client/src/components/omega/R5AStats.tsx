import { useEffect, useState } from 'react'
import type { R5aStats } from './omegaApi'
import { fetchR5aStats } from './omegaApi'
import { useATStore, useUiStore } from '../../stores'

/**
 * R5A Stats — Wave 2 measurement triad surfacing
 *
 * Compact strip showing attribution + calibration + drift signals from
 * the §16/§17/§20/§21 R5A measurement layer. Empty-state friendly: when
 * no attributions yet (Wave 1 dormant), displays "no signal yet" hints.
 *
 * Polled every 30s (slow cadence — these are aggregate stats, not per-tick).
 */
export function R5AStats() {
    const [stats, setStats] = useState<R5aStats | null>(null)
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    // [Day 28] Read live env instead of hardcoded 'DEMO' default. Stats are
    // per-env filtered server-side — passing wrong env hid real data when in
    // TESTNET/REAL.
    const engineMode = useATStore((s) => s.mode) || 'demo'
    const executionEnv = useUiStore((s) => s.executionEnv)
    const effectiveEnv = (engineMode === 'demo' || executionEnv === 'DEMO') ? 'DEMO'
        : executionEnv === 'TESTNET' ? 'TESTNET'
        : executionEnv === 'REAL' ? 'REAL'
        : 'DEMO'  // fallback

    useEffect(() => {
        let alive = true
        async function poll() {
            try {
                const s = await fetchR5aStats(effectiveEnv)
                if (alive) { setStats(s); setError(null) }
            } catch (err: any) {
                if (alive) setError(String(err && err.message || err))
            } finally {
                if (alive) setLoading(false)
            }
        }
        poll()
        const id = setInterval(poll, 30_000)
        return () => { alive = false; clearInterval(id) }
    }, [effectiveEnv])

    if (loading) {
        return <section className="omega-r5a"><div className="omega-r5a-loading">loading R5A signals...</div></section>
    }
    if (error) {
        return <section className="omega-r5a"><div className="omega-r5a-error">⚠ {error}</div></section>
    }
    if (!stats) return null

    const a = stats.attribution
    const c = stats.calibration
    const d = stats.drift
    const driftClass = d.drift_level === 'UNSTABLE' ? 'unstable' :
                       d.drift_level === 'MODERATE' ? 'moderate' : 'stable'

    return (
        <section className="omega-r5a">
            <div className="omega-r5a-header">
                <span className="omega-r5a-title">⚙ R5A SIGNALS</span>
                <span className="omega-r5a-env">{stats.env}</span>
            </div>
            <div className="omega-r5a-grid">

                <div className="omega-r5a-card">
                    <div className="omega-r5a-card-label">ATTRIBUTIONS</div>
                    <div className="omega-r5a-card-value">{a.total_count}</div>
                    <div className="omega-r5a-card-sub">
                        {a.total_count > 0
                            ? `hit ${(a.hit_rate * 100).toFixed(1)}%`
                            : 'no signal yet'}
                    </div>
                </div>

                <div className="omega-r5a-card">
                    <div className="omega-r5a-card-label">AVG PnL</div>
                    <div className={`omega-r5a-card-value ${a.avg_pnl_pct >= 0 ? 'pos' : 'neg'}`}>
                        {a.total_count > 0 ? `${a.avg_pnl_pct >= 0 ? '+' : ''}${a.avg_pnl_pct.toFixed(2)}%` : '—'}
                    </div>
                    <div className="omega-r5a-card-sub">per trade</div>
                </div>

                <div className="omega-r5a-card">
                    <div className="omega-r5a-card-label">CALIBRATION</div>
                    <div className="omega-r5a-card-value">
                        {c.sample_count > 0 ? `${(c.calibration_quality * 100).toFixed(0)}%` : '—'}
                    </div>
                    <div className="omega-r5a-card-sub">
                        {c.sample_count > 0 ? `brier ${c.brier_score.toFixed(3)}` : 'awaiting trades'}
                    </div>
                </div>

                <div className={`omega-r5a-card omega-r5a-drift-${driftClass}`}>
                    <div className="omega-r5a-card-label">DRIFT</div>
                    <div className="omega-r5a-card-value">{d.drift_level}</div>
                    <div className="omega-r5a-card-sub">
                        {d.sample_count.reference + d.sample_count.current > 0
                            ? `score ${d.drift_score.toFixed(2)}`
                            : 'no windows yet'}
                    </div>
                </div>

            </div>
        </section>
    )
}
