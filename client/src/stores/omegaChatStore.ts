/**
 * [Sub-A omega chat 2026-05-19] Zustand store for Omega chat history.
 * Shared state across TalkWithMe + Settings → automatic re-render sync
 * when Clear is invoked from one component, the other sees empty list.
 * Dedups concurrent loadHistory calls via _loadInFlight Promise field.
 */
import { create } from 'zustand'

export type Mood = 'CALM' | 'FOCUSED' | 'EXCITED' | 'NERVOUS' | 'ANGRY' | 'SAD' | 'BORED'

export interface ChatRow {
    role: 'you' | 'omega'
    text: string
    mood?: Mood
    ts: number
}

interface HistoryResponse {
    ok: boolean
    history?: ChatRow[]
    total?: number
    error?: string
}

interface DeleteResponse {
    ok: boolean
    deletedCount?: number
    error?: string
    remainingSec?: number
}

interface OmegaChatState {
    history: ChatRow[]
    loading: boolean
    error: string | null
    lastFetchTs: number | null
    _loadInFlight: Promise<void> | null
    loadHistory(force?: boolean): Promise<void>
    pushChatRow(row: ChatRow): void
    clearLocal(): Promise<{ deletedCount: number }>
    setError(err: string | null): void
}

const _CACHE_TTL_MS = 60_000 // dedup window for loadHistory

export const useOmegaChatStore = create<OmegaChatState>((set, get) => ({
    history: [],
    loading: false,
    error: null,
    lastFetchTs: null,
    _loadInFlight: null,

    loadHistory: async (force?: boolean) => {
        const { lastFetchTs, _loadInFlight } = get()
        if (_loadInFlight) return _loadInFlight
        if (!force && lastFetchTs != null && Date.now() - lastFetchTs < _CACHE_TTL_MS) return

        const p = (async () => {
            set({ loading: true, error: null })
            try {
                const res = await fetch('/api/omega/chat/history?limit=50', { credentials: 'include' })
                const data = (await res.json()) as HistoryResponse
                if (!res.ok || !data.ok) {
                    const errMsg = data.error || `HTTP ${res.status}`
                    set({ loading: false, error: errMsg, _loadInFlight: null })
                    return
                }
                set({
                    history: data.history || [],
                    loading: false,
                    error: null,
                    lastFetchTs: Date.now(),
                    _loadInFlight: null,
                })
            } catch (err: any) {
                set({
                    loading: false,
                    error: err && err.message ? err.message : String(err),
                    _loadInFlight: null,
                })
            }
        })()
        set({ _loadInFlight: p })
        return p
    },

    pushChatRow: (row: ChatRow) => {
        set((s) => ({ history: [...s.history, row] }))
    },

    clearLocal: async () => {
        try {
            const res = await fetch('/api/omega/chat/history', {
                method: 'DELETE',
                credentials: 'include',
            })
            const data = (await res.json()) as DeleteResponse
            if (!res.ok || !data.ok) {
                set({ error: data.error || `HTTP ${res.status}` })
                return { deletedCount: 0 }
            }
            set({
                history: [],
                lastFetchTs: Date.now(),
                error: null,
            })
            return { deletedCount: data.deletedCount || 0 }
        } catch (err: any) {
            set({ error: err && err.message ? err.message : String(err) })
            return { deletedCount: 0 }
        }
    },

    setError: (err: string | null) => set({ error: err }),
}))
