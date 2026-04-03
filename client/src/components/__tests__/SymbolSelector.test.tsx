import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { SymbolSelector } from '../trading/SymbolSelector'

// Mock api to prevent fetch errors in test environment
vi.mock('../../services/api', () => ({
  api: { post: vi.fn().mockResolvedValue({ ok: true, data: [] }) },
}))

describe('SymbolSelector', () => {
  it('renders with default symbols', () => {
    render(<SymbolSelector />)
    expect(screen.getByRole('combobox')).toBeInTheDocument()
    expect(screen.getByText('BTCUSDT')).toBeInTheDocument()
    expect(screen.getByText('ETHUSDT')).toBeInTheDocument()
  })
})
