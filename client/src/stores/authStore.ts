import { create } from 'zustand'
import { authApi } from '../services/api'

interface AuthStore {
  authenticated: boolean
  userId: string | null
  email: string | null
  role: string | null
  loading: boolean
  error: string | null

  /** Check auth status via /auth/me */
  checkAuth: () => Promise<void>
  /** Set auth after successful login */
  setAuth: (userId: string, email: string, role: string) => void
  /** Clear auth on logout */
  clearAuth: () => void
  /** Set error message */
  setError: (error: string | null) => void
}

export const useAuthStore = create<AuthStore>()((set) => ({
  authenticated: false,
  userId: null,
  email: null,
  role: null,
  loading: true,
  error: null,

  checkAuth: async () => {
    set({ loading: true, error: null })
    try {
      const res = await authApi.me()
      // Server returns flat { ok, id, email, role } — fields at top level, not in .data
      const data = res.data ?? (res as unknown as Record<string, unknown>)
      if (res.ok && data.id) {
        set({
          authenticated: true,
          userId: String(data.id),
          email: String(data.email ?? ''),
          role: String(data.role ?? 'user'),
          loading: false,
        })
      } else {
        set({ authenticated: false, loading: false })
      }
    } catch {
      set({ authenticated: false, loading: false })
    }
  },

  setAuth: (userId, email, role) =>
    set({ authenticated: true, userId, email, role, loading: false, error: null }),

  clearAuth: () =>
    set({ authenticated: false, userId: null, email: null, role: null, loading: false }),

  setError: (error) => set({ error }),
}))
