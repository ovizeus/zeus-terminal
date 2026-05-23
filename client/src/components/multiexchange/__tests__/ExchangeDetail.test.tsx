import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { ExchangeDetail } from '../ExchangeDetail'
import { useMultiExchangeStore } from '../../../stores/multiExchangeStore'

describe('ExchangeDetail', () => {
  beforeEach(() => {
    useMultiExchangeStore.setState({ accounts: {}, loading: false, error: null, lastFetchTs: null, _loadInFlight: null })
    vi.restoreAllMocks()
  })

  it('renders API key + secret input fields when not connected', () => {
    const onBack = vi.fn()
    render(<ExchangeDetail exchangeId="binance" onBack={onBack} />)
    expect(screen.getByPlaceholderText(/Paste API Key/i)).toBeDefined()
    expect(screen.getByPlaceholderText(/Paste Secret Key/i)).toBeDefined()
    expect(screen.getByText(/VERIFY & SAVE/i)).toBeDefined()
  })

  it('renders connected info + RE-VERIFY + DISCONNECT when account exists', () => {
    useMultiExchangeStore.setState({
      accounts: {
        binance: { connected: true, mode: 'testnet', maskedKey: '****abcd', balance: 100.5, lastVerified: '2026-05-20T20:00:00Z' },
      },
    })
    const onBack = vi.fn()
    render(<ExchangeDetail exchangeId="binance" onBack={onBack} />)
    expect(screen.getByText(/\*\*\*\*abcd/)).toBeDefined()
    expect(screen.getByText(/\$100\.50/)).toBeDefined()
    expect(screen.getByText(/RE-VERIFY/i)).toBeDefined()
    expect(screen.getByText(/DISCONNECT/i)).toBeDefined()
  })

  it('calls saveAccount on VERIFY & SAVE click with form values', async () => {
    const onBack = vi.fn()
    const saveAccount = vi.fn().mockResolvedValue({ ok: true, mode: 'testnet', maskedKey: '****x', balance: 0, lastVerified: '' })
    useMultiExchangeStore.setState({ saveAccount } as any)
    render(<ExchangeDetail exchangeId="binance" onBack={onBack} />)

    const keyInput = screen.getByPlaceholderText(/Paste API Key/i) as HTMLInputElement
    const secretInput = screen.getByPlaceholderText(/Paste Secret Key/i) as HTMLInputElement
    fireEvent.change(keyInput, { target: { value: 'KEY123' } })
    fireEvent.change(secretInput, { target: { value: 'SECRET456' } })

    await act(async () => { fireEvent.click(screen.getByText(/VERIFY & SAVE/i)) })

    expect(saveAccount).toHaveBeenCalledWith('binance', 'KEY123', 'SECRET456', 'testnet')
  })

  it('calls onBack when back button clicked', () => {
    const onBack = vi.fn()
    render(<ExchangeDetail exchangeId="binance" onBack={onBack} />)
    fireEvent.click(screen.getByTestId('exchange-detail-back'))
    expect(onBack).toHaveBeenCalled()
  })

  it('mode toggle defaults to testnet and can switch to live', () => {
    const onBack = vi.fn()
    render(<ExchangeDetail exchangeId="binance" onBack={onBack} />)
    const liveBtn = screen.getByTestId('mode-live')
    const testnetBtn = screen.getByTestId('mode-testnet')
    expect(testnetBtn.getAttribute('data-active')).toBe('true')
    fireEvent.click(liveBtn)
    expect(liveBtn.getAttribute('data-active')).toBe('true')
    expect(testnetBtn.getAttribute('data-active')).toBe('false')
  })
})
