import { create } from 'zustand'

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

// ── DEFAULT SETTINGS — merge template for missing keys ──
const DEFAULT_SETTINGS: Record<string, any> = {
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
  settings: Record<string, any>
  loaded: boolean
  saving: boolean

  /** Load from server via the unified _usFetchRemote primitive. */
  loadFromServer: () => Promise<void>
  /** Save to server via the unified _usPostRemote primitive. */
  saveToServer: () => Promise<void>
  /** Update one or more settings locally (does NOT auto-save). */
  patch: (partial: Record<string, any>) => void
  /** Get a setting value with default fallback. */
  get: (key: string) => any
}

export const useSettingsStore = create<SettingsStoreState>()((set, getState) => ({
  settings: { ...DEFAULT_SETTINGS },
  loaded: false,
  saving: false,

  loadFromServer: async () => {
    const w = window as any
    // Single GET path — delegate to legacy primitive (mutates USER_SETTINGS in-place).
    if (typeof w._usFetchRemote === 'function') {
      try {
        const ts = await (w._usFetchRemote() as Promise<number>)
        if (ts > 0) {
          const projected = _projectFromLegacy()
          const merged = { ...DEFAULT_SETTINGS, ...projected }
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
      const merged = { ...DEFAULT_SETTINGS, ...projected }
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
      const w = window as any
      // 1. Push store → legacy USER_SETTINGS + window.TC so engines + _usBuildFlatPayload see fresh values.
      _projectToLegacy(settings)
      _syncToWindow(settings)
      // 2. Single POST path — delegate to _usPostRemote (flattens USER_SETTINGS via _usBuildFlatPayload,
      //    POSTs /api/user/settings with keepalive, and triggers server-side settings.changed broadcast).
      if (typeof w._usPostRemote === 'function') {
        w._usPostRemote()
      } else {
        // Pre-bridge fallback (e.g. tests before config.ts module loaded).
        await fetch('/api/user/settings', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ settings }),
        }).then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status) })
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
    const updated = { ...s.settings, ...partial }
    _syncToWindow(updated)
    return { settings: updated }
  }),

  get: (key: string) => {
    return getState().settings[key] ?? DEFAULT_SETTINGS[key]
  },
}))

/**
 * Project the legacy USER_SETTINGS (nested) + window.TC mirror into the
 * flat shape this store exposes to React consumers.
 */
function _projectFromLegacy(): Record<string, any> {
  const w = window as any
  const us = w.USER_SETTINGS || {}
  const tc = w.TC || {}
  const at = us.autoTrade || {}
  const ch = us.chart || {}
  const out: Record<string, any> = {
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
  for (const k of Object.keys(out)) if (out[k] === undefined) delete out[k]
  try {
    const raw = localStorage.getItem('zeus_mscan_syms')
    if (raw) out.mscanSyms = JSON.parse(raw)
  } catch (_) { /* ignore */ }
  return out
}

/**
 * Push the flat store shape back into the legacy USER_SETTINGS tree so
 * _usBuildFlatPayload (inside _usPostRemote) reads up-to-date values.
 */
function _projectToLegacy(settings: Record<string, any>): void {
  const w = window as any
  const us = w.USER_SETTINGS = w.USER_SETTINGS || {}
  us.autoTrade = us.autoTrade || {}
  us.chart = us.chart || {}

  const atKeys = [
    'confMin', 'sigMin', 'size', 'riskPct', 'maxDay', 'maxPos',
    'sl', 'rr', 'killPct', 'lossStreak', 'maxAddon', 'lev',
    'adaptEnabled', 'adaptLive', 'smartExitEnabled',
  ]
  for (const k of atKeys) if (settings[k] !== undefined) us.autoTrade[k] = settings[k]
  if (settings.mscanEnabled !== undefined) us.autoTrade.multiSym = settings.mscanEnabled

  if (settings.chartTf !== undefined) us.chart.tf = settings.chartTf
  if (settings.candleColors !== undefined) us.chart.colors = settings.candleColors
  if (settings.heatmapSettings !== undefined) us.chart.heatmap = settings.heatmapSettings
  if (settings.indSettings !== undefined) us.indicators = settings.indSettings
  if (settings.alertSettings !== undefined) us.alerts = settings.alertSettings
}

/** Bridge invers: sync settings into window.TC for legacy engines. */
function _syncToWindow(s: Record<string, any>) {
  const w = window as any
  if (typeof w.TC !== 'undefined') {
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
