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

/**
 * Per-request options shared by wrapped/raw helpers.
 * `keepalive` — set by sendBeacon-style POSTs issued during page unload.
 * `signal`   — AbortSignal for cancellable fetches (e.g. klines aborts).
 */
export interface ApiRequestOpts {
  keepalive?: boolean
  signal?: AbortSignal
}

async function request<T>(method: string, url: string, body?: unknown, opts?: ApiRequestOpts): Promise<ApiResponse<T>> {
  const res = await fetch(url, {
    method,
    headers: HEADERS,
    credentials: 'same-origin',
    body: body !== undefined ? JSON.stringify(body) : undefined,
    keepalive: opts?.keepalive,
    signal: opts?.signal,
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

/**
 * Raw request — returns the parsed JSON body as `T` directly, without the
 * `ApiResponse<T>` wrapper. Use for endpoints whose response shape does not
 * follow `{ ok, data, error }` (e.g. `/api/at/state` returns an object
 * directly, `/api/user/settings` returns `{ ok, settings, updated_at }`).
 * Throws on non-2xx to preserve the pre-existing call-site pattern that
 * checks `res.ok` before parsing.
 */
async function rawRequest<T>(method: string, url: string, body?: unknown, opts?: ApiRequestOpts): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: HEADERS,
    credentials: 'same-origin',
    body: body !== undefined ? JSON.stringify(body) : undefined,
    keepalive: opts?.keepalive,
    signal: opts?.signal,
  })
  if (!res.ok) {
    throw new Error('HTTP ' + res.status)
  }
  return res.json() as Promise<T>
}

export const api = {
  get: <T>(url: string, opts?: ApiRequestOpts) => request<T>('GET', url, undefined, opts),
  post: <T>(url: string, body?: unknown, opts?: ApiRequestOpts) => request<T>('POST', url, body, opts),
  put: <T>(url: string, body?: unknown, opts?: ApiRequestOpts) => request<T>('PUT', url, body, opts),
  del: <T>(url: string, opts?: ApiRequestOpts) => request<T>('DELETE', url, undefined, opts),
  /** Low-level: returns raw JSON body (no ApiResponse wrapper). Throws on HTTP error. */
  raw: <T>(method: string, url: string, body?: unknown, opts?: ApiRequestOpts) => rawRequest<T>(method, url, body, opts),
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

export interface AdminUser {
  email: string
  role: string
  approved: boolean
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

  forgotPasswordRequest: (email: string) =>
    api.post('/auth/forgot-password/request', { email }),

  forgotPasswordConfirm: (email: string, code: string, newPassword: string) =>
    api.post('/auth/forgot-password/confirm', { email, code, newPassword }),

  adminUsers: () => api.get<{ users: AdminUser[] }>('/auth/admin/users'),

  adminApprove: (email: string) =>
    api.post('/auth/admin/approve', { email }),

  adminDelete: (email: string) =>
    api.post('/auth/admin/delete', { email }),
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

// ── User Settings (Phase 4 canonical) ──
//
// Typed client for the authoritative per-user settings endpoint backed by
// SQLite (server/routes/trading.js → /api/user/settings). Shape:
//   GET  → { ok, settings: <flat whitelisted>, updated_at }
//   POST { settings: <flat whitelisted> } → { ok, updated_at }
//
// [R4] Server whitelist SETTINGS_WHITELIST (40 keys) is now mirrored exactly
// by SettingsPayload. The previous `Record<string, unknown>` escape hatch
// (for the 9 legacy-only keys profile, bmMode, assistArmed, manualLive,
// ptLevDemo, ptLevLive, ptMarginMode, dslSettings, chartTz) is no longer
// needed — all 9 are represented in SettingsPayload. Dropping the Record
// arm tightens the wire contract to strict Partial<SettingsPayload>.

import type { SettingsPayload } from '../types/settings-contracts'

/** Response shape of GET /api/user/settings. */
export interface UserSettingsResponse {
  ok: boolean
  settings: Partial<SettingsPayload>
  updated_at: number
  error?: string
}

/** Response shape of POST /api/user/settings. */
export interface UserSettingsSaveResponse {
  ok: boolean
  updated_at?: number
  error?: string
}

/** Payload accepted by POST /api/user/settings (flat whitelisted keys). */
export type UserSettingsPayload = Partial<SettingsPayload>

export const userSettingsApi = {
  /** GET /api/user/settings — authoritative per-user settings from SQLite. */
  fetch: (opts?: ApiRequestOpts) =>
    api.raw<UserSettingsResponse>('GET', '/api/user/settings', undefined, opts),
  /**
   * POST /api/user/settings — persist flat whitelisted settings.
   * Pass `{ keepalive: true }` for saves issued during `beforeunload`
   * (matches the legacy `_usPostRemote` fire-and-forget pattern).
   */
  save: (settings: UserSettingsPayload, opts?: ApiRequestOpts) =>
    api.raw<UserSettingsSaveResponse>('POST', '/api/user/settings', { settings }, opts),
}

// ── Telegram ──
//
// Typed wrapper for the per-user Telegram bot credentials endpoint.
// Server routes live in server/routes/trading.js:
//   GET  /api/user/telegram        → { configured, chatId }
//   POST /api/user/telegram        → { ok } | 400/500 { error }
//   POST /api/user/telegram/test   → { ok }
// The raw variant is used for GET (direct shape, no wrapper) and the
// wrapped `api.post` is used for the two POSTs so the 400/500 body (which
// carries `{ error: '…' }`) is surfaced to the caller via ApiResponse.

export interface TelegramConfig {
  configured: boolean
  chatId: string
}

export const telegramApi = {
  /** GET /api/user/telegram — whether the user has Telegram credentials configured. */
  fetchConfig: () => api.raw<TelegramConfig>('GET', '/api/user/telegram'),
  /** POST /api/user/telegram — persist bot token (encrypted server-side) and chat id. */
  save: (botToken: string, chatId: string) =>
    api.post('/api/user/telegram', { botToken, chatId }),
  /** POST /api/user/telegram/test — send a test message via the stored credentials. */
  test: () => api.post('/api/user/telegram/test'),
}
