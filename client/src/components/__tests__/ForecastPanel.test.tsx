import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ForecastPanel } from '../brain/ForecastPanel'
import { useBrainStore } from '../../stores'

describe('ForecastPanel', () => {
  it('renders Q-Exit and Macro sections', () => {
    render(<ForecastPanel />)
    expect(screen.getByText('Q-EXIT')).toBeInTheDocument()
    expect(screen.getByText('PROBABILITY')).toBeInTheDocument()
    expect(screen.getByText('MACRO CYCLE')).toBeInTheDocument()
    expect(screen.getByText('LIQUIDITY CYCLE')).toBeInTheDocument()
  })

  it('shows risk action from qexit', () => {
    useBrainStore.setState({
      brain: {
        ...useBrainStore.getState().brain,
        qexit: {
          ...useBrainStore.getState().brain.qexit,
          risk: 80,
          action: 'REDUCE',
        },
      },
    })
    render(<ForecastPanel />)
    expect(screen.getByText('REDUCE')).toBeInTheDocument()
  })
})
