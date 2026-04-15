import { create } from 'zustand'
import { api } from '../services/api'
import type { SettingsPayload } from '../types/settings-contracts'

// [MIGRATION-F0 commit 6] Unified settings code path.
//
// The store is a React-facing projection of the legacy USER_SETTINGS cache
// defined in core/config.ts. There is exactly ONE load primitive and ONE
// save primitive for settings:
//
//   LOAD  → window._usFetchRemote()  (GET /api/user/settings)
//   SAVE  → window._usPostRemote()   (POST /api/user/settings)
//
// Both live in core/config.ts and are the canonical phase-0 code path.
// settingsStore delegates to them so there are no parallel network paths.
//
// Persistence (post commit 7) is: LS `zeus_user_settings` (nested, canonical)
// + POST /api/user/settings + /ws/sync `settings.changed` broadcast.
// The FS dual-write (_ucMarkDirty section=settings) and the React-specific
// LS mirror (zeus_user_settings_cache) were removed in commit 7.
//
// [MIGRATION-F1 commit 2] Typed with SettingsPayload. Legacy nested window
// globals (USER_SETTINGS, TC) are narrowed via local Legacy* interfaces —
// a controlled bridge scope, NOT `declare global`. No runtime change.

interface LegacyAutoTrade {
  confMin?: number
  sigMin?: number
  size?: number
  riskPct?: number
  maxDay?: number
  maxPos?: number
  sl?: number
  rr?: number
  killPct?: number
  lossStreak?: number
  maxAddon?: number
  lev?: number
  adaptEnabled?: boolean
  adaptLive?: boolean
  smartExitEnabled?: boolean
  multiSym?: boolean
}
interface LegacyChart {
  tf?: string
  colors?: Record<string, unknown> | null
  heatmap?: Record<string, unknown> | null
}
interface LegacyUserSettings {
  autoTrade?: LegacyAutoTrade
  chart?: LegacyChart
  indicators?: Record<string, unknown> | null
  alerts?: Record<string, unknown> | null
}
interface LegacyTC {
  confMin?: number
  sigMin?: number
  size?: number
  riskPct?: number
  maxPos?: number
  slPct?: number
  rr?: number
  killPct?: number
  lossStreak?: number
  maxAddon?: number
  lev?: number
}
interface ZeusWindowExt {
  _usFetchRemote?: () => Promise<number>
  _usPostRemote?: () => void
  USER_SETTINGS?: LegacyUserSettings
  TC?: LegacyTC
}

// ── DEFAULT SETTINGS — merge template for missing keys ──
const DEFAULT_SETTINGS: SettingsPayload = {
  // AT
  confMin: 65, sigMin: 3, size: 200, riskPct: 1, maxDay: 5, maxPos: 3,
  sl: 1.5, rr: 2, killPct: 5, lossStreak: 3, maxAddon: 2, lev: 5,
  adaptEnabled: false, adaptLive: false, smartExitEnabled: false,
  // Multi-Symbol scan (persisted per-user on server)
  mscanEnabled: true, mscanSyms: null,
  // UI
  theme: 'native', uiScale: 100, soundEnabled: true,
  // Chart
  chartTf: '5m', chartType: 'candle', candleColors: null, heatmapSettings: null, timezoneOffset: null,
  // Indicators
  indSettings: null,
  // Liq / LLV / Supremus / S-R
  liqSettings: null, llvSettings: null, zsSettings: null, srSettings: null,
  // Alerts
  alertSettings: null,
}

interface SettingsStoreState {
  settings: SettingsPayload
  loaded: boolean
  saving: boolean

  /** Load from server via the unified _usFetchRemote primitive. */
  loadFromServer: () => Promise<void>
  /** Save to server via the unified _usPostRemote primitive. */
  saveToServer: () => Promise<void>
  /** Update one or more settings locally (does NOT auto-save). */
  patch: (partial: Partial<SettingsPayload>) => void
  /** Get a setting value with default fallback. */
  get: <K extends keyof SettingsPayload>(key: K) => SettingsPayload[K]
}

export const useSettingsStore = create<SettingsStoreState>()((set, getState) => ({
  settings: { ...DEFAULT_SETTINGS },
  loaded: false,
  saving: false,

  loadFromServer: async () => {
    const w = window as unknown as ZeusWindowExt
    // Single GET path — delegate to legacy primitive (mutates USER_SETTINGS in-place).
    if (typeof w._usFetchRemote === 'function') {
      try {
        const ts = await w._usFetchRemote()
        if (ts > 0) {
          const projected = _projectFromLegacy()
          const merged: SettingsPayload = { ...DEFAULT_SETTINGS, ...projected }
          set({ settings: merged, loaded: true })
          _syncToWindow(merged)
          return
        }
        // ts === 0 → offline / transient; fall through to offline fallback
      } catch (_) { /* fall through to offline fallback */ }
    }
    // Offline / boot-race fallback: project from the legacy USER_SETTINGS
    // tree populated by bootstrapStartApp's loadUserSettings() (which reads
    // LS `zeus_user_settings` — the single canonical cache). No second LS key.
    try {
      const projected = _projectFromLegacy()
      const merged: SettingsPayload = { ...DEFAULT_SETTINGS, ...projected }
      set({ settings: merged, loaded: true })
      _syncToWindow(merged)
    } catch {
      set({ settings: { ...DEFAULT_SETTINGS }, loaded: true })
    }
  },

  saveToServer: async () => {
    const { settings, saving } = getState()
    if (saving) return
    set({ saving: true })
    try {
      const w = window as unknown as ZeusWindowExt
      // 1. Push store → legacy USER_SETTINGS + window.TC so engines + _usBuildFlatPayload see fresh values.
      _projectToLegacy(settings)
      _syncToWindow(settings)
      // 2. Single POST path — delegate to _usPostRemote (flattens USER_SETTINGS via _usBuildFlatPayload,
      //    POSTs /api/user/settings with keepalive, and triggers server-side settings.changed broadcast).
      if (typeof w._usPostRemote === 'function') {
        w._usPostRemote()
      } else {
        // Pre-bridge fallback (e.g. tests before config.ts module loaded).
        await api.raw('POST', '/api/user/settings', { settings })
      }
      // 3. Write canonical LS cache — same key legacy _usSave uses. Single source.
      try {
        if (w.USER_SETTINGS) localStorage.setItem('zeus_user_settings', JSON.stringify(w.USER_SETTINGS))
      } catch (_) { /* ignore */ }
    } finally {
      set({ saving: false })
    }
  },

  patch: (partial) => set((s) => {
    const updated: SettingsPayload = { ...s.settings, ...partial }
    _syncToWindow(updated)
    return { settings: updated }
  }),

  get: <K extends keyof SettingsPayload>(key: K): SettingsPayload[K] => {
    const s = getState().settings
    return (s[key] ?? DEFAULT_SETTINGS[key]) as SettingsPayload[K]
  },
}))

/**
 * Project the legacy USER_SETTINGS (nested) + window.TC mirror into the
 * flat shape this store exposes to React consumers.
 */
function _projectFromLegacy(): Partial<SettingsPayload> {
  const w = window as unknown as ZeusWindowExt
  const us: LegacyUserSettings = w.USER_SETTINGS || {}
  const tc: LegacyTC = w.TC || {}
  const at: LegacyAutoTrade = us.autoTrade || {}
  const ch: LegacyChart = us.chart || {}
  const out: Partial<SettingsPayload> = {
    confMin: at.confMin ?? tc.confMin,
    sigMin: at.sigMin ?? tc.sigMin,
    size: at.size ?? tc.size,
    riskPct: at.riskPct ?? tc.riskPct,
    maxDay: at.maxDay,
    maxPos: at.maxPos ?? tc.maxPos,
    sl: at.sl ?? tc.slPct,
    rr: at.rr ?? tc.rr,
    killPct: at.killPct ?? tc.killPct,
    lossStreak: at.lossStreak ?? tc.lossStreak,
    maxAddon: at.maxAddon ?? tc.maxAddon,
    lev: at.lev ?? tc.lev,
    adaptEnabled: at.adaptEnabled,
    adaptLive: at.adaptLive,
    smartExitEnabled: at.smartExitEnabled,
    mscanEnabled: at.multiSym,
    chartTf: ch.tf,
    candleColors: ch.colors,
    heatmapSettings: ch.heatmap,
    indSettings: us.indicators,
    alertSettings: us.alerts,
  }
  for (const k of Object.keys(out) as Array<keyof SettingsPayload>) {
    if (out[k] === undefined) delete out[k]
  }
  try {
    const raw = localStorage.getItem('zeus_mscan_syms')
    if (raw) out.mscanSyms = JSON.parse(raw) as string[]
  } catch (_) { /* ignore */ }
  return out
}

/**
 * Push the flat store shape back into the legacy USER_SETTINGS tree so
 * _usBuildFlatPayload (inside _usPostRemote) reads up-to-date values.
 */
function _projectToLegacy(settings: SettingsPayload): void {
  const w = window as unknown as ZeusWindowExt
  const us: LegacyUserSettings = w.USER_SETTINGS || (w.USER_SETTINGS = {})
  const at: LegacyAutoTrade = us.autoTrade || (us.autoTrade = {})
  const ch: LegacyChart = us.chart || (us.chart = {})

  const atKeys = [
    'confMin', 'sigMin', 'size', 'riskPct', 'maxDay', 'maxPos',
    'sl', 'rr', 'killPct', 'lossStreak', 'maxAddon', 'lev',
    'adaptEnabled', 'adaptLive', 'smartExitEnabled',
  ] as const
  const atBag = at as unknown as Record<string, unknown>
  for (const k of atKeys) {
    const v = settings[k]
    if (v !== undefined) atBag[k] = v
  }
  if (settings.mscanEnabled !== undefined) at.multiSym = settings.mscanEnabled

  if (settings.chartTf !== undefined) ch.tf = settings.chartTf
  if (settings.candleColors !== undefined) ch.colors = settings.candleColors
  if (settings.heatmapSettings !== undefined) ch.heatmap = settings.heatmapSettings
  if (settings.indSettings !== undefined) us.indicators = settings.indSettings
  if (settings.alertSettings !== undefined) us.alerts = settings.alertSettings
}

/** Bridge invers: sync settings into window.TC for legacy engines. */
function _syncToWindow(s: SettingsPayload): void {
  const w = window as unknown as ZeusWindowExt
  if (w.TC) {
    if (s.confMin != null) w.TC.confMin = Number(s.confMin)
    if (s.sigMin != null) w.TC.sigMin = Number(s.sigMin)
    if (s.size != null) w.TC.size = Number(s.size)
    if (s.riskPct != null) w.TC.riskPct = Number(s.riskPct)
    if (s.maxPos != null) w.TC.maxPos = Number(s.maxPos)
    if (s.sl != null) w.TC.slPct = Number(s.sl)
    if (s.rr != null) w.TC.rr = Number(s.rr)
    if (s.killPct != null) w.TC.killPct = Number(s.killPct)
    if (s.lossStreak != null) w.TC.lossStreak = Number(s.lossStreak)
    if (s.maxAddon != null) w.TC.maxAddon = Number(s.maxAddon)
    if (s.lev != null) w.TC.lev = Number(s.lev)
  }
  // Mirror mscan symbol selection to localStorage so legacy engines
  // (data/klines.ts::_mscanGetActive) pick it up without a refactor.
  try {
    if (Array.isArray(s.mscanSyms) && s.mscanSyms.length > 0) {
      localStorage.setItem('zeus_mscan_syms', JSON.stringify(s.mscanSyms))
    }
  } catch (_) { /* ignore */ }
}
