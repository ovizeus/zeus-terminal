import { describe, it, expect, beforeEach } from 'vitest'
import { useAuthStore } from '../authStore'

describe('authStore', () => {
  beforeEach(() => {
    useAuthStore.setState(useAuthStore.getInitialState())
  })

  it('has correct defaults', () => {
    const s = useAuthStore.getState()
    expect(s.authenticated).toBe(false)
    expect(s.userId).toBeNull()
    expect(s.email).toBeNull()
    expect(s.role).toBeNull()
    expect(s.loading).toBe(true)
  })

  it('setAuth sets authenticated state', () => {
    useAuthStore.getState().setAuth('1', 'test@test.com', 'admin')
    const s = useAuthStore.getState()
    expect(s.authenticated).toBe(true)
    expect(s.userId).toBe('1')
    expect(s.email).toBe('test@test.com')
    expect(s.role).toBe('admin')
    expect(s.loading).toBe(false)
  })

  it('clearAuth resets state', () => {
    useAuthStore.getState().setAuth('1', 'test@test.com', 'admin')
    useAuthStore.getState().clearAuth()
    const s = useAuthStore.getState()
    expect(s.authenticated).toBe(false)
    expect(s.userId).toBeNull()
  })

  it('setError updates error message', () => {
    useAuthStore.getState().setError('Something went wrong')
    expect(useAuthStore.getState().error).toBe('Something went wrong')
    useAuthStore.getState().setError(null)
    expect(useAuthStore.getState().error).toBeNull()
  })
})
