import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { BrainCockpit } from '../brain/BrainCockpit'
import { useBrainStore } from '../../stores'

describe('BrainCockpit', () => {
  it('renders confluence score and core stats', () => {
    render(<BrainCockpit />)
    expect(screen.getByText('CONFLUENCE')).toBeInTheDocument()
    expect(screen.getByText('REGIME')).toBeInTheDocument()
    expect(screen.getByText('PHASE FILTER')).toBeInTheDocument()
    expect(screen.getByText('ATMOSPHERE')).toBeInTheDocument()
  })

  it('shows danger color coding', () => {
    useBrainStore.setState({
      brain: { ...useBrainStore.getState().brain, danger: 75 },
    })
    render(<BrainCockpit />)
    const dangerEl = screen.getByText('75')
    expect(dangerEl.className).toContain('red')
  })

  it('renders neural grid neurons', () => {
    render(<BrainCockpit />)
    expect(screen.getByText('RSI')).toBeInTheDocument()
    expect(screen.getByText('MACD')).toBeInTheDocument()
    expect(screen.getByText('OFI')).toBeInTheDocument()
  })
})
