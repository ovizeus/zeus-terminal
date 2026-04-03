import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { OrderFlowPanel } from '../advanced/OrderFlowPanel'
import { useOrderFlowStore } from '../../stores'

describe('OrderFlowPanel', () => {
  it('renders health badge and core metrics', () => {
    render(<OrderFlowPanel />)
    expect(screen.getByText('FLOW:DEAD')).toBeInTheDocument()
    expect(screen.getByText('Delta')).toBeInTheDocument()
    expect(screen.getByText('Velocity')).toBeInTheDocument()
    expect(screen.getByText('Z-Score')).toBeInTheDocument()
  })

  it('renders flow flags', () => {
    render(<OrderFlowPanel />)
    expect(screen.getByText('ABS')).toBeInTheDocument()
    expect(screen.getByText('TRAP')).toBeInTheDocument()
    expect(screen.getByText('ICE')).toBeInTheDocument()
  })

  it('shows INST badge when institutional activity detected', () => {
    useOrderFlowStore.setState({
      flow: { ...useOrderFlowStore.getState().flow, flags: { instAct: true } },
    })
    render(<OrderFlowPanel />)
    expect(screen.getByText('INST')).toBeInTheDocument()
  })
})
