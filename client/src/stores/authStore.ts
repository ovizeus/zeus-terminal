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
      if (res.ok && res.data) {
        set({
          authenticated: true,
          userId: String(res.data.id),
          email: res.data.email,
          role: res.data.role,
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
