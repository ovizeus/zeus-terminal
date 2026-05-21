import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ExchangeCard } from '../ExchangeCard'

describe('ExchangeCard', () => {
  it('renders ACTIVE state with connected info (mode, maskedKey, balance)', () => {
    const onClick = vi.fn()
    render(
      <ExchangeCard
        id="binance"
        label="BINANCE"
        status="active"
        account={{ connected: true, mode: 'testnet', maskedKey: '****abcd', balance: 1234.56, lastVerified: '2026-05-20T20:00:00Z' }}
        onClick={onClick}
      />
    )
    expect(screen.getByText(/BINANCE/i)).toBeDefined()
    expect(screen.getByText(/ACTIVE/i)).toBeDefined()
    expect(screen.getByText(/\*\*\*\*abcd/)).toBeDefined()
    expect(screen.getByText(/TESTNET/i)).toBeDefined()
  })

  it('renders INACTIVE state (account undefined) with placeholder', () => {
    const onClick = vi.fn()
    render(
      <ExchangeCard id="bybit" label="BYBIT" status="inactive" account={undefined} onClick={onClick} />
    )
    expect(screen.getByText(/BYBIT/i)).toBeDefined()
    expect(screen.getByText(/INACTIVE/i)).toBeDefined()
  })

  it('renders BLOCKED state (mutual exclusion) with explicit message', () => {
    const onClick = vi.fn()
    render(
      <ExchangeCard id="bybit" label="BYBIT" status="blocked" blockedMessage="Binance is currently active" onClick={onClick} />
    )
    expect(screen.getByText(/BLOCKED/i)).toBeDefined()
    expect(screen.getByText(/Binance is currently active/)).toBeDefined()
  })

  it('fires onClick when active card is clicked', () => {
    const onClick = vi.fn()
    render(
      <ExchangeCard
        id="binance"
        label="BINANCE"
        status="active"
        account={{ connected: true, mode: 'testnet', maskedKey: '****x', balance: 0, lastVerified: '' }}
        onClick={onClick}
      />
    )
    fireEvent.click(screen.getByTestId('exchange-card-binance'))
    expect(onClick).toHaveBeenCalledWith('binance')
  })

  it('does NOT fire onClick when blocked card is clicked', () => {
    const onClick = vi.fn()
    render(
      <ExchangeCard id="bybit" label="BYBIT" status="blocked" blockedMessage="x" onClick={onClick} />
    )
    fireEvent.click(screen.getByTestId('exchange-card-bybit'))
    expect(onClick).not.toHaveBeenCalled()
  })
})
