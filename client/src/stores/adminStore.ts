import { create } from 'zustand'

export type AdminSection =
  | 'dashboard'
  | 'users'
  | 'audit'
  | 'roles'
  | 'security'
  | 'billing'
  | 'support'
  | 'monitoring'
  | 'settings'

export interface AdminUser {
  id: number
  email: string
  role: string
  status: string
  approved: boolean
  bannedUntil?: string | null
  createdAt?: string
  exchange?: {
    connected: boolean
    exchange?: string
    mode?: string
    status?: string
    lastVerified?: string
  }
}

export interface AuditEntry {
  id?: number
  user_id?: number | null
  action?: string
  details?: string
  ip?: string | null
  created_at?: string
}

export interface HealthStatus {
  server: 'ok' | 'warn' | 'down'
  websocket: 'ok' | 'warn' | 'down'
  database: 'ok' | 'warn' | 'down'
  exchange: 'ok' | 'warn' | 'down'
  sync: 'ok' | 'warn' | 'down'
  audit: 'ok' | 'warn' | 'down'
  uptime?: number
  memory?: { rss: number; heapUsed: number; heapTotal: number }
  checkedAt?: string
}

export interface UserFilters {
  status: 'all' | 'active' | 'blocked' | 'banned' | 'pending' | 'suspended'
  role: 'all' | 'admin' | 'user'
  api: 'all' | 'ready' | 'none'
  mode: 'all' | 'live' | 'testnet' | 'demo'
  sort: 'newest' | 'oldest' | 'email' | 'status'
}

export interface AuditFilters {
  actionType: string
  actorId: string
  targetId: string
  dateFrom: string
  dateTo: string
}

interface AdminStore {
  currentSection: AdminSection
  selectedUserId: number | null
  search: string
  userFilters: UserFilters
  auditFilters: AuditFilters

  users: AdminUser[]
  usersLoading: boolean
  usersError: string

  audit: AuditEntry[]
  auditLoading: boolean
  auditError: string

  health: HealthStatus | null
  healthLoading: boolean
  lastRefresh: number

  setSection: (s: AdminSection) => void
  setSelectedUser: (id: number | null) => void
  setSearch: (q: string) => void
  setUserFilters: (p: Partial<UserFilters>) => void
  setAuditFilters: (p: Partial<AuditFilters>) => void

  loadUsers: () => Promise<void>
  loadAudit: (limit?: number) => Promise<void>
  loadHealth: () => Promise<void>

  doAction: (action: string, body: object) => Promise<{ ok: boolean; error?: string }>
}

const DEFAULT_USER_FILTERS: UserFilters = {
  status: 'all',
  role: 'all',
  api: 'all',
  mode: 'all',
  sort: 'newest',
}

const DEFAULT_AUDIT_FILTERS: AuditFilters = {
  actionType: '',
  actorId: '',
  targetId: '',
  dateFrom: '',
  dateTo: '',
}

export const useAdminStore = create<AdminStore>()((set, get) => ({
  currentSection: 'dashboard',
  selectedUserId: null,
  search: '',
  userFilters: DEFAULT_USER_FILTERS,
  auditFilters: DEFAULT_AUDIT_FILTERS,

  users: [],
  usersLoading: false,
  usersError: '',

  audit: [],
  auditLoading: false,
  auditError: '',

  health: null,
  healthLoading: false,
  lastRefresh: 0,

  setSection: (s) => set({ currentSection: s, selectedUserId: null }),
  setSelectedUser: (id) => set({ selectedUserId: id }),
  setSearch: (q) => set({ search: q }),
  setUserFilters: (p) => set((s) => ({ userFilters: { ...s.userFilters, ...p } })),
  setAuditFilters: (p) => set((s) => ({ auditFilters: { ...s.auditFilters, ...p } })),

  loadUsers: async () => {
    set({ usersLoading: true, usersError: '' })
    try {
      const r = await fetch('/auth/admin/users', { credentials: 'same-origin' })
      const d = await r.json()
      if (!d.ok) { set({ usersError: d.error || 'Load error', usersLoading: false }); return }
      set({ users: d.users || [], usersLoading: false, lastRefresh: Date.now() })
    } catch (e: any) {
      set({ usersError: e?.message || 'Network error', usersLoading: false })
    }
  },

  loadAudit: async (limit = 100) => {
    set({ auditLoading: true, auditError: '' })
    try {
      const r = await fetch('/auth/admin/audit?limit=' + limit, { credentials: 'same-origin' })
      const d = await r.json()
      if (!d.ok) { set({ auditError: d.error || 'Load error', auditLoading: false }); return }
      set({ audit: d.entries || [], auditLoading: false })
    } catch (e: any) {
      set({ auditError: e?.message || 'Network error', auditLoading: false })
    }
  },

  loadHealth: async () => {
    set({ healthLoading: true })
    try {
      const r = await fetch('/auth/admin/health', { credentials: 'same-origin' })
      const d = await r.json()
      if (d.ok) set({ health: d.health, healthLoading: false })
      else set({ healthLoading: false })
    } catch {
      set({ healthLoading: false })
    }
  },

  doAction: async (action, body) => {
    try {
      const r = await fetch('/auth/admin/' + action, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Zeus-Request': '1' },
        body: JSON.stringify(body),
        credentials: 'same-origin',
      })
      const d = await r.json()
      if (d.ok) {
        await get().loadUsers()
        return { ok: true }
      }
      return { ok: false, error: d.error || 'Action failed' }
    } catch (e: any) {
      return { ok: false, error: e?.message || 'Network error' }
    }
  },
}))
