import { create } from 'zustand'
import { authApi } from '../services/api'
import { accessLevelFrom, setAccessLevel as applyAccessLevel, resetAccessLevel, type AccessLevel } from '../core/betaGate'

interface AuthStore {
  authenticated: boolean
  userId: string | null
  email: string | null
  role: string | null
  /** [BETA-GATE] 'viewer' pana cand serverul spune explicit 'full'. */
  accessLevel: AccessLevel
  /** Nivelul a fost confirmat de server. Pana atunci nu se pune niciun lacat:
   *  „nu stim inca" nu e „viewer", altfel un cont full ar vedea lacate la pornire. */
  accessKnown: boolean
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
  accessLevel: 'viewer',
  accessKnown: false,
  loading: true,
  error: null,

  checkAuth: async () => {
    set({ loading: true, error: null })
    try {
      const res = await authApi.me()
      // Server returns flat { ok, id, email, role } — fields at top level, not in .data
      const data = res.data ?? (res as unknown as Record<string, unknown>)
      if (res.ok && data.id) {
        const accessLevel = accessLevelFrom(data as { role?: unknown; accessLevel?: unknown })
        applyAccessLevel(accessLevel)
        set({
          accessLevel,
          accessKnown: true,
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

  setAuth: (userId, email, role) => {
    // Raspunsul de login nu poarta nivelul: pana il aflam, un user e viewer
    // (cade inchis), apoi il cerem serverului fara sa atingem `loading`.
    const first = accessLevelFrom({ role })
    applyAccessLevel(first, first === 'full')   // 'viewer' aici e doar o presupunere
    set({ authenticated: true, userId, email, role, accessLevel: first, accessKnown: first === 'full', loading: false, error: null })
    authApi.me().then((res) => {
      const data = (res as { data?: unknown }).data ?? res
      const lvl = accessLevelFrom(data as { role?: unknown; accessLevel?: unknown })
      applyAccessLevel(lvl)
      set({ accessLevel: lvl, accessKnown: true })
    }).catch(() => { /* ramane viewer */ })
  },

  clearAuth: () => {
    resetAccessLevel()
    set({ authenticated: false, userId: null, email: null, role: null, accessLevel: 'viewer', accessKnown: false, loading: false })
  },

  setError: (error) => set({ error }),
}))
