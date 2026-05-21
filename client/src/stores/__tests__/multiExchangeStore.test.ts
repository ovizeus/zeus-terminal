import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { useMultiExchangeStore } from '../multiExchangeStore'

describe('useMultiExchangeStore', () => {
  beforeEach(() => {
    useMultiExchangeStore.setState({
      accounts: {},
      loading: false,
      error: null,
      lastFetchTs: null,
      _loadInFlight: null,
    })
    vi.restoreAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('loadAccounts populates accounts map from server response', async () => {
    const mockFetch = vi.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        ok: true,
        accounts: [
          { exchange: 'binance', mode: 'testnet', maskedKey: '****abcd', lastVerified: '2026-05-20T20:00:00Z' },
        ],
      }),
    } as any)

    await useMultiExchangeStore.getState().loadAccounts()
    expect(mockFetch).toHaveBeenCalledWith('/api/exchange/status', expect.any(Object))
    const state = useMultiExchangeStore.getState()
    expect(state.accounts.binance).toBeDefined()
    expect(state.accounts.binance.mode).toBe('testnet')
    expect(state.accounts.binance.maskedKey).toBe('****abcd')
    expect(state.lastFetchTs).toBeGreaterThan(0)
  })

  it('loadAccounts dedups concurrent calls via _loadInFlight', async () => {
    const mockFetch = vi.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ok: true, accounts: [] }),
    } as any)

    const p1 = useMultiExchangeStore.getState().loadAccounts()
    const p2 = useMultiExchangeStore.getState().loadAccounts()
    await Promise.all([p1, p2])
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })

  it('loadAccounts respects 60s cache TTL — second call within TTL skips fetch', async () => {
    const mockFetch = vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, accounts: [] }),
    } as any)
    await useMultiExchangeStore.getState().loadAccounts()
    await useMultiExchangeStore.getState().loadAccounts()
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })

  it('loadAccounts force=true bypasses TTL', async () => {
    const mockFetch = vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, accounts: [] }),
    } as any)
    await useMultiExchangeStore.getState().loadAccounts()
    await useMultiExchangeStore.getState().loadAccounts(true)
    expect(mockFetch).toHaveBeenCalledTimes(2)
  })

  it('saveAccount POSTs to /api/exchange/save with exchange+apiKey+apiSecret+mode', async () => {
    const mockFetch = vi.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ok: true, mode: 'testnet', maskedKey: '****wxyz', balance: 100, lastVerified: '2026-05-20T20:00:00Z' }),
    } as any)

    const result = await useMultiExchangeStore.getState().saveAccount('binance', 'KEY123', 'SECRET456', 'testnet')
    expect(mockFetch).toHaveBeenCalledWith('/api/exchange/save', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ exchange: 'binance', apiKey: 'KEY123', apiSecret: 'SECRET456', mode: 'testnet' }),
    }))
    expect(result.ok).toBe(true)
    const state = useMultiExchangeStore.getState()
    expect(state.accounts.binance).toBeDefined()
    expect(state.accounts.binance.balance).toBe(100)
  })

  it('saveAccount surfaces server message on failure (e.g. 409 EXCHANGE_CONFLICT)', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: false,
      json: async () => ({ ok: false, message: 'Bybit is blocked because Binance is active', error: 'EXCHANGE_CONFLICT' }),
    } as any)

    const result = await useMultiExchangeStore.getState().saveAccount('bybit', 'K', 'S', 'testnet')
    expect(result.ok).toBe(false)
    expect(result.message).toBe('Bybit is blocked because Binance is active')
  })

  it('verifyAccount POSTs to /api/exchange/verify and updates balance + lastVerified', async () => {
    useMultiExchangeStore.setState({
      accounts: { binance: { connected: true, mode: 'testnet', maskedKey: '****x', balance: 0, lastVerified: '' } },
    })
    vi.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ok: true, balance: 250.55, lastVerified: '2026-05-20T21:00:00Z' }),
    } as any)

    await useMultiExchangeStore.getState().verifyAccount('binance')
    const state = useMultiExchangeStore.getState()
    expect(state.accounts.binance).toBeDefined()
    expect(state.accounts.binance.balance).toBe(250.55)
    expect(state.accounts.binance.lastVerified).toBe('2026-05-20T21:00:00Z')
  })

  it('disconnectAccount POSTs to /api/exchange/disconnect and removes account from state', async () => {
    useMultiExchangeStore.setState({
      accounts: { binance: { connected: true, mode: 'testnet', maskedKey: '****x', balance: 0, lastVerified: '' } },
    })
    vi.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ok: true }),
    } as any)

    await useMultiExchangeStore.getState().disconnectAccount('binance')
    const state = useMultiExchangeStore.getState()
    expect(state.accounts.binance).toBeUndefined()
  })
})
