/**
 * [Sub-A omega chat 2026-05-19] Settings section for Omega chat persistence
 * controls. Currently only "Clear chat history" button (nuclear wipe per-user
 * + audit log). Future Sub-B/C will add user profile + memory facts here.
 *
 * [Sub-C.1 omega long-term memory 2026-05-20] Extended with:
 * - Health badge (4-state: healthy/degraded/down/idle)
 * - Facts list grouped by class with metadata
 * - Per-fact forget button with confirm dialog
 * - Toast feedback on forget success/error
 */
import { useEffect, useState } from 'react'
import { useOmegaChatStore } from '../../stores/omegaChatStore'
import { useOmegaMemoryStore, type MemoryFact } from '../../stores/omegaMemoryStore'
import { toast } from '../../data/marketDataHelpers'

// ─── Health badge ──────────────────────────────────────────────────────────────

function formatTimeAgo(ts: number | null): string {
    if (ts == null) return 'never'
    const diffSec = Math.floor((Date.now() - ts) / 1000)
    if (diffSec < 60) return `${diffSec}s ago`
    const diffMin = Math.floor(diffSec / 60)
    if (diffMin < 60) return `${diffMin}min ago`
    const diffH = Math.floor(diffMin / 60)
    return `${diffH}h ago`
}

function HealthBadge({ health }: { health: import('../../stores/omegaMemoryStore').HealthStatus | null }) {
    if (!health) {
        return (
            <div className="zr-omega-health-badge zr-omega-health-idle">
                💤 Memory extraction: Unknown (loading…)
            </div>
        )
    }

    const pct = (health.failure_rate_last_hour * 100).toFixed(0)
    const lastSuccessAgo = formatTimeAgo(health.last_success_at)

    switch (health.status) {
        case 'healthy':
            return (
                <div className="zr-omega-health-badge zr-omega-health-healthy">
                    ✅ Memory extraction: Healthy (last {lastSuccessAgo})
                </div>
            )
        case 'degraded':
            return (
                <div className="zr-omega-health-badge zr-omega-health-degraded">
                    ⚠️ Memory extraction: Degraded ({health.pending_count} pending, {pct}% failure rate)
                </div>
            )
        case 'down':
            return (
                <div className="zr-omega-health-badge zr-omega-health-down">
                    ❌ Memory extraction: Down ({pct}% failure rate last hour)
                </div>
            )
        case 'idle':
            return (
                <div className="zr-omega-health-badge zr-omega-health-idle">
                    💤 Memory extraction: Idle (no recent chat)
                </div>
            )
        default:
            return null
    }
}

// ─── Confirm dialog for forgetting a fact ──────────────────────────────────────

function ForgetConfirmDialog({
    fact,
    onConfirm,
    onCancel,
}: {
    fact: MemoryFact
    onConfirm: () => void
    onCancel: () => void
}) {
    const addedDate = new Date(fact.created_at).toISOString().slice(0, 10)
    const lastSeenDate = new Date(fact.last_seen_at).toISOString().slice(0, 10)
    const importance = fact.importance.toFixed(2)

    return (
        <div className="zr-omega-forget-dialog-overlay">
            <div className="zr-omega-forget-dialog">
                <h5>Forget fact?</h5>
                <table className="zr-omega-forget-meta">
                    <tbody>
                        <tr>
                            <td>Class:</td>
                            <td>{fact.class}</td>
                        </tr>
                        <tr>
                            <td>Key:</td>
                            <td>{fact.fact_key}</td>
                        </tr>
                        <tr>
                            <td>Value:</td>
                            <td>{fact.fact_value}</td>
                        </tr>
                        <tr>
                            <td>Added:</td>
                            <td>
                                {addedDate}{'  '}Last seen: {lastSeenDate}{'  '}Importance: {importance}
                            </td>
                        </tr>
                        <tr>
                            <td>Reaffirmed:</td>
                            <td>{fact.reaffirm_count} times</td>
                        </tr>
                    </tbody>
                </table>
                <p className="zr-omega-forget-note">Recoverable for 7 days via admin.</p>
                <div className="zr-confirm-block">
                    <button className="zr-btn" onClick={onCancel}>
                        Cancel
                    </button>
                    <button className="zr-btn zr-btn-danger" onClick={onConfirm}>
                        Forget
                    </button>
                </div>
            </div>
        </div>
    )
}

// ─── Facts list grouped by class ───────────────────────────────────────────────

const CLASS_ORDER = ['identity', 'personal_context', 'trading_strategy', 'style', 'temporary'] as const

const CLASS_LABELS: Record<string, string> = {
    identity: 'Identity',
    personal_context: 'Personal Context',
    trading_strategy: 'Trading Strategy',
    style: 'Style',
    temporary: 'Temporary',
}

function FactsList({
    groupedByClass,
    onForget,
}: {
    groupedByClass: Record<string, MemoryFact[]>
    onForget: (fact: MemoryFact) => void
}) {
    const allClasses = CLASS_ORDER.filter((c) => (groupedByClass[c] || []).length > 0)
    // Also include any classes not in CLASS_ORDER (future-proofing)
    const extraClasses = Object.keys(groupedByClass).filter(
        (c) => !(CLASS_ORDER as readonly string[]).includes(c) && groupedByClass[c].length > 0
    )
    const classes = [...allClasses, ...extraClasses]

    if (classes.length === 0) {
        return (
            <p className="zr-settings-meta">
                No memory facts yet. Omega will learn from your conversations automatically.
            </p>
        )
    }

    return (
        <div className="zr-omega-facts-list">
            {classes.map((cls) => {
                const facts = groupedByClass[cls] || []
                if (facts.length === 0) return null
                return (
                    <div key={cls} className="zr-omega-facts-class">
                        <h5 className="zr-omega-facts-class-header">
                            {CLASS_LABELS[cls] || cls} ({facts.length})
                        </h5>
                        <ul className="zr-omega-facts-items">
                            {facts.map((fact) => (
                                <li key={fact.id} className="zr-omega-fact-row">
                                    <span className="zr-omega-fact-key">{fact.fact_key}:</span>
                                    <span className="zr-omega-fact-value">{fact.fact_value}</span>
                                    <span className="zr-omega-fact-meta">
                                        imp:{fact.importance.toFixed(2)} ×{fact.reaffirm_count}
                                    </span>
                                    <button
                                        className="zr-btn zr-btn-icon zr-omega-forget-btn"
                                        title={`Forget: ${fact.fact_key}`}
                                        onClick={() => onForget(fact)}
                                    >
                                        🗑
                                    </button>
                                </li>
                            ))}
                        </ul>
                    </div>
                )
            })}
        </div>
    )
}

// ─── Main section ─────────────────────────────────────────────────────────────

export function OmegaMemorySection() {
    // Sub-A clear-chat state
    const [confirming, setConfirming] = useState(false)
    const [clearing, setClearing] = useState(false)
    const clearLocal = useOmegaChatStore((s) => s.clearLocal)
    const error = useOmegaChatStore((s) => s.error)
    const historyCount = useOmegaChatStore((s) => s.history.length)

    // Sub-C.1 memory state
    const [forgettingFact, setForgettingFact] = useState<MemoryFact | null>(null)
    const { groupedByClass, health, isLoading, loadFacts, loadHealth, forgetFact } =
        useOmegaMemoryStore()

    // Load on mount
    useEffect(() => {
        loadFacts()
        loadHealth()
    }, []) // eslint-disable-line react-hooks/exhaustive-deps

    // Sub-A clear handler
    const handleClear = async () => {
        setClearing(true)
        try {
            const { deletedCount } = await clearLocal()
            if (deletedCount > 0) {
                toast(`Cleared ${deletedCount} chat messages`, 3000)
            } else if (error) {
                toast(`Could not clear: ${error}`, 4000)
            } else {
                toast('Nothing to clear', 2000)
            }
        } finally {
            setClearing(false)
            setConfirming(false)
        }
    }

    // Sub-C.1 forget handler
    const handleForgetConfirm = async () => {
        if (!forgettingFact) return
        const factSnapshot = forgettingFact
        setForgettingFact(null)
        try {
            await forgetFact(factSnapshot.id)
            toast(`Forgot: ${factSnapshot.fact_key}`, 3000)
        } catch (err: any) {
            toast(`Could not forget: ${err?.message || 'unknown error'}`, 4000)
        }
    }

    return (
        <div className="zr-settings-subsection">
            {/* ── Sub-C.1: Memory facts + health ── */}
            <h4>Omega long-term memory</h4>
            <p className="zr-settings-desc">
                Omega extracts facts from your conversations and remembers them across sessions.
                Use the trash icon to permanently forget a fact (recoverable within 7 days via admin).
            </p>

            <HealthBadge health={health} />

            {isLoading ? (
                <p className="zr-settings-meta">Loading memory facts…</p>
            ) : (
                <FactsList groupedByClass={groupedByClass} onForget={setForgettingFact} />
            )}

            {forgettingFact && (
                <ForgetConfirmDialog
                    fact={forgettingFact}
                    onConfirm={handleForgetConfirm}
                    onCancel={() => setForgettingFact(null)}
                />
            )}

            <hr className="zr-omega-section-divider" />

            {/* ── Sub-A: Clear chat history (unchanged) ── */}
            <h4>Omega chat memory</h4>
            <p className="zr-settings-desc">
                Omega keeps a per-user conversation history persisted in the database.
                History survives browser refresh and server restart. The button below
                permanently deletes your conversation history (your messages and Omega's
                replies). Brain narration thoughts and critical alerts are preserved.
            </p>
            <p className="zr-settings-meta">
                Currently loaded in this session: <strong>{historyCount}</strong> messages
            </p>
            {!confirming ? (
                <button className="zr-btn zr-btn-danger" onClick={() => setConfirming(true)}>
                    Clear chat history
                </button>
            ) : (
                <div className="zr-confirm-block">
                    <p>Are you sure? This cannot be undone.</p>
                    <button className="zr-btn zr-btn-danger" onClick={handleClear} disabled={clearing}>
                        {clearing ? 'Clearing…' : 'Yes, clear it'}
                    </button>
                    <button className="zr-btn" onClick={() => setConfirming(false)} disabled={clearing}>
                        Cancel
                    </button>
                </div>
            )}
        </div>
    )
}
