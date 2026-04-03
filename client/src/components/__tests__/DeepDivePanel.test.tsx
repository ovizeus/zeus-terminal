import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { DeepDivePanel } from '../brain/DeepDivePanel'
import { useBrainStore } from '../../stores'

describe('DeepDivePanel', () => {
  it('renders structure and adaptive sections', () => {
    render(<DeepDivePanel />)
    expect(screen.getByText('STRUCTURE')).toBeInTheDocument()
    expect(screen.getByText('POSITION SIZING')).toBeInTheDocument()
    expect(screen.getByText('ADAPTIVE')).toBeInTheDocument()
    expect(screen.getByText('SESSION')).toBeInTheDocument()
  })

  it('shows protect mode banner when active', () => {
    useBrainStore.setState({
      brain: {
        ...useBrainStore.getState().brain,
        protectMode: true,
        protectReason: 'Max daily loss',
      },
    })
    render(<DeepDivePanel />)
    expect(screen.getByText(/PROTECT MODE/)).toBeInTheDocument()
    expect(screen.getByText(/Max daily loss/)).toBeInTheDocument()
  })
})
