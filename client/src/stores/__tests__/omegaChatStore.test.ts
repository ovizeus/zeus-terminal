import { describe, test, expect, beforeEach, vi } from 'vitest'
import { useOmegaChatStore } from '../omegaChatStore'

// Mock fetch globally
const _fetchMock = vi.fn()
;(globalThis as any).fetch = _fetchMock

beforeEach(() => {
    useOmegaChatStore.setState({
        history: [], loading: false, error: null, lastFetchTs: null, _loadInFlight: null,
    })
    _fetchMock.mockReset()
})

describe('omegaChatStore — initial state', () => {
    test('history is empty array, loading false, no error, no fetch ts', () => {
        const s = useOmegaChatStore.getState()
        expect(s.history).toEqual([])
        expect(s.loading).toBe(false)
        expect(s.error).toBe(null)
        expect(s.lastFetchTs).toBe(null)
    })
})

describe('omegaChatStore — loadHistory', () => {
    test('populates history on 200 response', async () => {
        _fetchMock.mockResolvedValueOnce({
            ok: true, status: 200,
            json: async () => ({ ok: true, history: [
                { role: 'you', text: 'salut', ts: 1000 },
                { role: 'omega', text: 'salut boss', mood: 'CALM', ts: 1001 },
            ], total: 1 }),
        })
        await useOmegaChatStore.getState().loadHistory()
        const s = useOmegaChatStore.getState()
        expect(s.history.length).toBe(2)
        expect(s.history[0].text).toBe('salut')
        expect(s.loading).toBe(false)
        expect(s.error).toBe(null)
        expect(s.lastFetchTs).toBeGreaterThan(0)
    })

    test('skips fetch if lastFetchTs is recent (< 60s)', async () => {
        useOmegaChatStore.setState({ lastFetchTs: Date.now() - 10_000 })
        await useOmegaChatStore.getState().loadHistory()
        expect(_fetchMock).not.toHaveBeenCalled()
    })

    test('forces fetch if force=true even with recent lastFetchTs', async () => {
        useOmegaChatStore.setState({ lastFetchTs: Date.now() - 1000 })
        _fetchMock.mockResolvedValueOnce({
            ok: true, status: 200, json: async () => ({ ok: true, history: [], total: 0 }),
        })
        await useOmegaChatStore.getState().loadHistory(true)
        expect(_fetchMock).toHaveBeenCalledOnce()
    })

    test('concurrent loadHistory dedup via _loadInFlight Promise', async () => {
        let resolve: any
        _fetchMock.mockReturnValueOnce(new Promise((r) => { resolve = () => r({
            ok: true, status: 200, json: async () => ({ ok: true, history: [], total: 0 }),
        }) }))
        const p1 = useOmegaChatStore.getState().loadHistory()
        const p2 = useOmegaChatStore.getState().loadHistory()
        const p3 = useOmegaChatStore.getState().loadHistory()
        expect(_fetchMock).toHaveBeenCalledOnce()
        resolve!()
        await Promise.all([p1, p2, p3])
        expect(_fetchMock).toHaveBeenCalledOnce()
    })

    test('on error: stores error, loading=false, preserves existing history', async () => {
        useOmegaChatStore.setState({ history: [{ role: 'you', text: 'old', ts: 1 }] as any })
        _fetchMock.mockRejectedValueOnce(new Error('network down'))
        await useOmegaChatStore.getState().loadHistory(true)
        const s = useOmegaChatStore.getState()
        expect(s.error).toMatch(/network down/i)
        expect(s.loading).toBe(false)
        expect(s.history.length).toBe(1)
    })

    test('on non-OK 500 response: stores error, preserves history', async () => {
        _fetchMock.mockResolvedValueOnce({
            ok: false, status: 500, json: async () => ({ ok: false, error: 'db down' }),
        })
        await useOmegaChatStore.getState().loadHistory(true)
        const s = useOmegaChatStore.getState()
        expect(s.error).toMatch(/db down/)
    })
})

describe('omegaChatStore — pushChatRow', () => {
    test('appends a new ChatRow to history', () => {
        useOmegaChatStore.getState().pushChatRow({ role: 'you', text: 'hi', ts: 1 })
        const s = useOmegaChatStore.getState()
        expect(s.history).toEqual([{ role: 'you', text: 'hi', ts: 1 }])
    })

    test('does not mutate state in place (immutable update)', () => {
        const initial = useOmegaChatStore.getState().history
        useOmegaChatStore.getState().pushChatRow({ role: 'you', text: 'x', ts: 1 })
        expect(useOmegaChatStore.getState().history).not.toBe(initial)
    })
})

describe('omegaChatStore — clearLocal (DELETE flow)', () => {
    test('on 200: history empty, lastFetchTs updated, returns deletedCount', async () => {
        useOmegaChatStore.setState({ history: [{ role: 'you', text: 'x', ts: 1 }] as any })
        _fetchMock.mockResolvedValueOnce({
            ok: true, status: 200, json: async () => ({ ok: true, deletedCount: 5 }),
        })
        const result = await useOmegaChatStore.getState().clearLocal()
        expect(result.deletedCount).toBe(5)
        expect(useOmegaChatStore.getState().history).toEqual([])
    })

    test('on 429: history retained, error stored, deletedCount=0', async () => {
        useOmegaChatStore.setState({ history: [{ role: 'you', text: 'x', ts: 1 }] as any })
        _fetchMock.mockResolvedValueOnce({
            ok: false, status: 429, json: async () => ({ ok: false, error: 'Rate limit: wait 12s', remainingSec: 12 }),
        })
        const result = await useOmegaChatStore.getState().clearLocal()
        expect(result.deletedCount).toBe(0)
        expect(useOmegaChatStore.getState().history.length).toBe(1)
        expect(useOmegaChatStore.getState().error).toMatch(/rate limit/i)
    })

    test('on network error: history retained, error stored', async () => {
        useOmegaChatStore.setState({ history: [{ role: 'you', text: 'x', ts: 1 }] as any })
        _fetchMock.mockRejectedValueOnce(new Error('econnreset'))
        const result = await useOmegaChatStore.getState().clearLocal()
        expect(result.deletedCount).toBe(0)
        expect(useOmegaChatStore.getState().history.length).toBe(1)
        expect(useOmegaChatStore.getState().error).toMatch(/econnreset/i)
    })
})

describe('omegaChatStore — setError', () => {
    test('sets and clears error', () => {
        useOmegaChatStore.getState().setError('boom')
        expect(useOmegaChatStore.getState().error).toBe('boom')
        useOmegaChatStore.getState().setError(null)
        expect(useOmegaChatStore.getState().error).toBe(null)
    })
})
