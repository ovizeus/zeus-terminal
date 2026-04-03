import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { TeacherPanel } from '../advanced/TeacherPanel'
import { useTeacherStore } from '../../stores'

describe('TeacherPanel', () => {
  it('renders capability hero and tabs', () => {
    render(<TeacherPanel />)
    expect(screen.getByText('TEACHER CAPABILITY')).toBeInTheDocument()
    expect(screen.getByText('REPLAY')).toBeInTheDocument()
    expect(screen.getByText('TRADES')).toBeInTheDocument()
    expect(screen.getByText('STATS')).toBeInTheDocument()
  })

  it('shows status badge', () => {
    useTeacherStore.setState({
      teacher: { ...useTeacherStore.getState().teacher, status: 'TRAINING' },
    })
    render(<TeacherPanel />)
    expect(screen.getByText('TRAINING')).toBeInTheDocument()
  })
})
