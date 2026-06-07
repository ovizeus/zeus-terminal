import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MaxTradesProtectBadge } from '../MaxTradesProtectBadge'
import { useATStore } from '../../stores'

const post = vi.fn().mockResolvedValue({ ok: true })
vi.mock('../../services/api', () => ({ api: { post: (...a: any[]) => post(...a) } }))

const mp = (o: any) => ({ configured: true, maxDay: 10, dailyEntries: 0, active: true, disabledToday: false, atCap: false, blocking: false, ...o })

beforeEach(() => {
  post.mockClear()
  useATStore.setState({ maxDayProtect: null })
})

describe('MaxTradesProtectBadge (T-MAXTRADES)', () => {
  it('renders nothing when not configured', () => {
    useATStore.setState({ maxDayProtect: mp({ configured: false }) })
    const { container } = render(<MaxTradesProtectBadge />)
    expect(container.firstChild).toBeNull()
  })

  it('renders nothing when under cap (not blocking, not disabled)', () => {
    useATStore.setState({ maxDayProtect: mp({ dailyEntries: 4 }) })
    const { container } = render(<MaxTradesProtectBadge />)
    expect(container.firstChild).toBeNull()
  })

  it('shows PROTECT badge + Disable button when blocking (at cap, armed)', () => {
    useATStore.setState({ maxDayProtect: mp({ dailyEntries: 14, atCap: true, blocking: true }) })
    render(<MaxTradesProtectBadge />)
    expect(screen.getByText(/MAX TRADES\/DAY \(14\/10\)/)).toBeInTheDocument()
    expect(screen.getByText(/Disable for today/i)).toBeInTheDocument()
  })

  it('Disable → POST /api/at/maxday-protect {enabled:false}', () => {
    useATStore.setState({ maxDayProtect: mp({ dailyEntries: 14, atCap: true, blocking: true }) })
    render(<MaxTradesProtectBadge />)
    fireEvent.click(screen.getByText(/Disable for today/i))
    expect(post).toHaveBeenCalledWith('/api/at/maxday-protect', { enabled: false })
  })

  it('shows OFF-until-tomorrow + Re-enable when disabledToday', () => {
    useATStore.setState({ maxDayProtect: mp({ dailyEntries: 14, atCap: true, active: false, disabledToday: true, blocking: false }) })
    render(<MaxTradesProtectBadge />)
    expect(screen.getByText(/OFF until tomorrow/i)).toBeInTheDocument()
    fireEvent.click(screen.getByText(/Re-enable/i))
    expect(post).toHaveBeenCalledWith('/api/at/maxday-protect', { enabled: true })
  })
})
