import { create } from 'zustand'

interface AuthStore {
  /** Whether user is authenticated */
  authenticated: boolean
  /** User ID from JWT */
  userId: string | null
  /** User role */
  role: string | null

  /** Set auth state after login */
  setAuth: (userId: string, role: string) => void
  /** Clear auth state on logout */
  clearAuth: () => void
}

export const useAuthStore = create<AuthStore>()((set) => ({
  authenticated: false,
  userId: null,
  role: null,

  setAuth: (userId, role) => set({ authenticated: true, userId, role }),
  clearAuth: () => set({ authenticated: false, userId: null, role: null }),
}))
