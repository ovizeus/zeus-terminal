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

// [2026-11-27] Roluri reale: /auth/me aduce staffRole + permissions
describe('authStore — staff', () => {
  it('checkAuth pastreaza staffRole si permisiunile de la server; clearAuth le sterge', async () => {
    const { vi } = await import('vitest')
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ ok: true, id: 4, email: 's@x.ro', role: 'user', staffRole: 'support', permissions: ['users.view', 'audit.view'], accessLevel: 'viewer' }) })))
    await useAuthStore.getState().checkAuth()
    expect(useAuthStore.getState().staffRole).toBe('support')
    expect(useAuthStore.getState().permissions).toEqual(['users.view', 'audit.view'])
    useAuthStore.getState().clearAuth()
    expect(useAuthStore.getState().staffRole).toBeNull()
    expect(useAuthStore.getState().permissions).toEqual([])
    vi.unstubAllGlobals()
  })
})
