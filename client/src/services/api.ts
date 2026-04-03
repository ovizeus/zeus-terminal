/**
 * Zeus Terminal — Typed REST API client
 * All endpoints proxy through Vite → Express :3000
 */

export interface ApiResponse<T = unknown> {
  ok: boolean
  data?: T
  message?: string
  error?: string
}

const HEADERS: Record<string, string> = {
  'Content-Type': 'application/json',
  'X-Zeus-Request': '1',
}

async function request<T>(method: string, url: string, body?: unknown): Promise<ApiResponse<T>> {
  const res = await fetch(url, {
    method,
    headers: HEADERS,
    credentials: 'same-origin',
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    try {
      return JSON.parse(text) as ApiResponse<T>
    } catch {
      return { ok: false, error: `HTTP ${res.status}: ${text}` }
    }
  }
  return res.json() as Promise<ApiResponse<T>>
}

export const api = {
  get: <T>(url: string) => request<T>('GET', url),
  post: <T>(url: string, body?: unknown) => request<T>('POST', url, body),
  put: <T>(url: string, body?: unknown) => request<T>('PUT', url, body),
}

// ── Auth ──

export interface LoginResponse {
  ok: boolean
  needsCode?: boolean
  message?: string
  email?: string
  role?: string
}

export interface MeResponse {
  id: number
  email: string
  role: string
}

export const authApi = {
  login: (email: string, password: string) =>
    api.post<LoginResponse>('/auth/login', { email, password }),

  verifyCode: (email: string, code: string) =>
    api.post<LoginResponse>('/auth/verify-code', { email, code }),

  register: (email: string, password: string) =>
    api.post<LoginResponse>('/auth/register', { email, password }),

  me: () => api.get<MeResponse>('/auth/me'),

  logout: () => api.post('/auth/logout'),
}

// ── User Context (Settings Sync) ──

export interface UserContextData {
  _v: number
  ts: number
  sections: Record<string, unknown>
}

export const settingsApi = {
  pull: () => api.get<UserContextData>('/api/sync/user-context'),
  push: (data: UserContextData) => api.post('/api/sync/user-context', data),
}

// ── State Sync ──

import type { ServerSnapshot, SyncStatePush } from '../types'

export const syncApi = {
  pullState: () => api.get<ServerSnapshot>('/api/sync/state'),
  pushState: (data: SyncStatePush) => api.post('/api/sync/state', data),
}

// ── Version ──

export interface VersionInfo {
  version: string
  build: number
  date: string
  changelog: string
}

export const versionApi = {
  get: () => api.get<VersionInfo>('/api/version'),
}
