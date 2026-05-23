import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { MultiExchangePage } from '../MultiExchangePage'
import { useMultiExchangeStore } from '../../../stores/multiExchangeStore'

describe('MultiExchangePage', () => {
  beforeEach(() => {
    useMultiExchangeStore.setState({ accounts: {}, loading: false, error: null, lastFetchTs: null, _loadInFlight: null })
    vi.restoreAllMocks()
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, accounts: [] }),
    } as any)
  })

  it('renders header with MULTIEXCHANGE title', () => {
    render(<MultiExchangePage />)
    expect(screen.getByText(/MULTIEXCHANGE/i)).toBeDefined()
  })

  it('renders all 7 exchange pillars (2 active-able + 5 coming-soon)', async () => {
    render(<MultiExchangePage />)
    await waitFor(() => {
      expect(screen.getByText(/BINANCE/i)).toBeDefined()
      expect(screen.getByText(/BYBIT/i)).toBeDefined()
      expect(screen.getByText(/OKX/i)).toBeDefined()
      expect(screen.getByText(/HYPERLIQUID/i)).toBeDefined()
      expect(screen.getByText(/BITGET/i)).toBeDefined()
      expect(screen.getByText(/MEXC/i)).toBeDefined()
      expect(screen.getByText(/HTX/i)).toBeDefined()
    })
  })

  it('calls loadAccounts on mount', async () => {
    const loadAccounts = vi.fn().mockResolvedValue(undefined)
    useMultiExchangeStore.setState({ loadAccounts } as any)
    render(<MultiExchangePage />)
    await waitFor(() => expect(loadAccounts).toHaveBeenCalled())
  })

  it('renders ACTIVE state for binance when accounts.binance exists', async () => {
    useMultiExchangeStore.setState({
      accounts: { binance: { connected: true, mode: 'live', maskedKey: '****x', balance: 500, lastVerified: '2026-05-20T20:00:00Z' } },
      lastFetchTs: Date.now(),
    })
    render(<MultiExchangePage />)
    await waitFor(() => {
      expect(screen.getByText(/ACTIVE/i)).toBeDefined()
    })
  })

  it('renders BLOCKED state for bybit when binance is active (mutual exclusion)', async () => {
    useMultiExchangeStore.setState({
      accounts: { binance: { connected: true, mode: 'testnet', maskedKey: '****x', balance: 0, lastVerified: '' } },
      lastFetchTs: Date.now(),
    })
    render(<MultiExchangePage />)
    await waitFor(() => {
      expect(screen.getByText(/BLOCKED/i)).toBeDefined()
    })
  })

  it('clicking an inactive card opens ExchangeDetail sub-view', async () => {
    render(<MultiExchangePage />)
    await waitFor(() => screen.getByTestId('exchange-card-binance'))
    await act(async () => { fireEvent.click(screen.getByTestId('exchange-card-binance')) })
    expect(screen.getByTestId('exchange-detail-back')).toBeDefined()
  })

  it('clicking BACK in sub-view returns to grid', async () => {
    render(<MultiExchangePage />)
    await waitFor(() => screen.getByTestId('exchange-card-binance'))
    await act(async () => { fireEvent.click(screen.getByTestId('exchange-card-binance')) })
    await act(async () => { fireEvent.click(screen.getByTestId('exchange-detail-back')) })
    expect(screen.getByText(/MULTIEXCHANGE/i)).toBeDefined()
  })

  it('zeus:page-back custom event when in sub-view: preventDefault to stay on page', async () => {
    render(<MultiExchangePage />)
    await waitFor(() => screen.getByTestId('exchange-card-binance'))
    await act(async () => { fireEvent.click(screen.getByTestId('exchange-card-binance')) })
    const ev = new CustomEvent('zeus:page-back', { cancelable: true })
    await act(async () => { window.dispatchEvent(ev) })
    expect(ev.defaultPrevented).toBe(true)
    expect(screen.getByText(/MULTIEXCHANGE/i)).toBeDefined()
  })
})
