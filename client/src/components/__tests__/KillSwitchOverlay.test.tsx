import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { KillSwitchOverlay } from '../KillSwitchOverlay'
import { useATStore } from '../../stores'

const post = vi.fn().mockResolvedValue({ ok: true })
vi.mock('../../services/api', () => ({ api: { post: (...a: any[]) => post(...a) } }))

beforeEach(() => {
  post.mockClear()
  useATStore.setState({ killTriggered: false, killReason: null, killLoss: 0, killLimit: 0 })
})

describe('KillSwitchOverlay', () => {
  it('renders nothing when kill switch is inactive', () => {
    const { container } = render(<KillSwitchOverlay />)
    expect(container.firstChild).toBeNull()
  })

  it('shows big KILL SWITCH + reason when active', () => {
    useATStore.setState({ killTriggered: true, killReason: 'daily_loss', killLoss: -512.5, killLimit: 500 })
    render(<KillSwitchOverlay />)
    expect(screen.getByText('KILL SWITCH')).toBeInTheDocument()
    expect(screen.getByText(/daily loss/i)).toBeInTheDocument()
  })

  it('minimizes to a badge and expands again', () => {
    useATStore.setState({ killTriggered: true, killReason: 'daily_loss', killLoss: -512.5, killLimit: 500 })
    render(<KillSwitchOverlay />)
    fireEvent.click(screen.getByLabelText('Minimize'))
    const badge = screen.getByRole('button', { name: /KILL SWITCH/ })
    expect(badge).toBeInTheDocument()
    fireEvent.click(badge)
    expect(screen.getByText(/all automated trading is stopped/i)).toBeInTheDocument()
  })

  it('deactivate -> confirm -> calls /api/at/kill/reset', () => {
    useATStore.setState({ killTriggered: true, killReason: 'daily_loss', killLoss: -512.5, killLimit: 500 })
    render(<KillSwitchOverlay />)
    fireEvent.click(screen.getByText('Deactivate'))
    fireEvent.click(screen.getByText(/Confirm deactivate/i))
    expect(post).toHaveBeenCalledWith('/api/at/kill/reset')
  })
})
