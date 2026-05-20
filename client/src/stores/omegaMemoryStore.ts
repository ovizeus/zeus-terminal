/**
 * [Sub-C.1 omega long-term memory 2026-05-20] Zustand store for Omega memory facts.
 * Mirrors omegaChatStore.ts pattern: _loadInFlight Promise dedup, 60s cache TTL.
 * Exposes loadFacts(), loadHealth(), forgetFact(id), clearLocal().
 */
import { create } from 'zustand'

export interface MemoryFact {
    id: number
    class: 'identity' | 'personal_context' | 'trading_strategy' | 'temporary' | 'style'
    fact_key: string
    fact_value: string
    importance: number
    reaffirm_count: number
    created_at: number
    last_seen_at: number
    created_source_chat_id: number | null
    last_source_chat_id: number | null
    env: string | null
}

export interface HealthStatus {
    status: 'healthy' | 'degraded' | 'down' | 'idle'
    last_success_at: number | null
    last_attempt_at: number | null
    failure_rate_last_hour: number
    pending_count: number
    failed_transient_count_last_hour: number
    failed_permanent_count_last_24h: number
    total_attempts_last_hour: number
}

interface OmegaMemoryState {
    facts: MemoryFact[]
    groupedByClass: Record<string, MemoryFact[]>
    health: HealthStatus | null
    isLoading: boolean
    error: string | null
    lastFetchTs: number | null
    _loadInFlight: Promise<void> | null
    loadFacts(force?: boolean): Promise<void>
    loadHealth(): Promise<void>
    forgetFact(factId: number): Promise<void>
    clearLocal(): void
    setError(err: string | null): void
}

const _CACHE_TTL_MS = 60_000

export const useOmegaMemoryStore = create<OmegaMemoryState>((set, get) => ({
    facts: [],
    groupedByClass: {},
    health: null,
    isLoading: false,
    error: null,
    lastFetchTs: null,
    _loadInFlight: null,

    loadFacts: async (force?: boolean) => {
        const { lastFetchTs, _loadInFlight } = get()
        if (_loadInFlight) return _loadInFlight
        if (!force && lastFetchTs != null && Date.now() - lastFetchTs < _CACHE_TTL_MS) return

        const p = (async () => {
            set({ isLoading: true, error: null })
            try {
                const res = await fetch('/api/omega/memory', { credentials: 'include' })
                if (!res.ok) {
                    const errMsg = `HTTP ${res.status}`
                    set({ isLoading: false, error: errMsg, _loadInFlight: null })
                    return
                }
                const data = await res.json()
                set({
                    facts: data.facts || [],
                    groupedByClass: data.groupedByClass || {},
                    isLoading: false,
                    error: null,
                    lastFetchTs: Date.now(),
                    _loadInFlight: null,
                })
            } catch (err: any) {
                set({
                    isLoading: false,
                    error: err && err.message ? err.message : String(err),
                    _loadInFlight: null,
                })
            }
        })()
        set({ _loadInFlight: p })
        return p
    },

    loadHealth: async () => {
        try {
            const res = await fetch('/api/omega/memory/health', { credentials: 'include' })
            if (!res.ok) {
                set({ health: null })
                return
            }
            const data = await res.json()
            set({ health: data })
        } catch {
            set({ health: null })
        }
    },

    forgetFact: async (factId: number) => {
        try {
            const res = await fetch(`/api/omega/memory/${factId}`, {
                method: 'DELETE',
                credentials: 'include',
            })
            if (!res.ok) throw new Error(`HTTP ${res.status}`)
            // Optimistic remove from local state
            set((s) => ({
                facts: s.facts.filter((f) => f.id !== factId),
                groupedByClass: Object.fromEntries(
                    Object.entries(s.groupedByClass).map(([k, v]) => [
                        k,
                        v.filter((f) => f.id !== factId),
                    ])
                ),
                lastFetchTs: null, // force reload on next loadFacts
            }))
        } catch (err: any) {
            set({ error: err && err.message ? err.message : String(err) })
            throw err // re-throw so caller can show toast error
        }
    },

    clearLocal: () => {
        set({ facts: [], groupedByClass: {}, health: null, lastFetchTs: null, error: null })
    },

    setError: (err: string | null) => set({ error: err }),
}))
