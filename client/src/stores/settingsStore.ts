import { create } from 'zustand'
import { userSettingsApi } from '../services/api'
import { useATStore } from './atStore'
import { _usApplyServerResponse, _usApplyPostResponse, _usBuildFlatPayload } from '../core/config'
import type { SettingsPayload } from '../types/settings-contracts'

// [MIGRATION-F0 commit 6] Unified settings code path.
//
// [MIGRATION-F4 commit 4] Projection inversion — settingsStore is now the
// single source of truth. USER_SETTINGS + window.TC + atStore.config are
// write-through projections of store.settings, refreshed atomically on
// every store mutation via the _projectAll(s) helper (Legacy → Window → AT,
// fixed order). The legacy tree retains keys the store does not own
// (profile, bmMode, assistArmed, manualLive, ptLev*, chartTz, dslSettings)
// because _projectToLegacy only overwrites keys it knows about — so legacy
// engines reading those extras continue to work unchanged.
//
// [MIGRATION-F4 commits 2+3] GET + POST path canonicalization.
// loadFromServer issues a direct GET via userSettingsApi.fetch() and
// applies side effects through _usApplyServerResponse. saveToServer
// issues a direct POST via userSettingsApi.save() and applies the ts
// update through _usApplyPostResponse. window._usFetchRemote +
// window._usPostRemote remain defined as thin wrappers over the same
// userSettingsApi primitives — store and wrappers converge on the
// typed API, not on each other (no store→wrapper→store loop, no double
// POST). Payload source is _usBuildFlatPayload(USER_SETTINGS) — the
// same function the legacy wrapper uses, so both paths emit byte-identical
// wire payloads. USER_SETTINGS is kept fresh via _projectAll before
// the flat build.
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

  /** Load from server (GET /api/user/settings) via userSettingsApi. */
  loadFromServer: () => Promise<void>
  /** Save to server (POST /api/user/settings) via userSettingsApi. */
  saveToServer: () => Promise<void>
  /** Update one or more settings locally (does NOT auto-save). Triggers
   *  full projection to USER_SETTINGS + window.TC + atStore. */
  patch: (partial: Partial<SettingsPayload>) => void
  /** Get a setting value with default fallback. */
  get: <K extends keyof SettingsPayload>(key: K) => SettingsPayload[K]
}

export const useSettingsStore = create<SettingsStoreState>()((set, getState) => ({
  settings: { ...DEFAULT_SETTINGS },
  loaded: false,
  saving: false,

  loadFromServer: async () => {
    // [MIGRATION-F4 commit 2] Direct GET via userSettingsApi.fetch().
    // Side-effect hydration (USER_SETTINGS + _usSettingsRemoteTs + the
    // canonical "[US] fetched remote settings" log) is delegated to
    // _usApplyServerResponse — same helper _usFetchRemote now uses, so
    // both paths produce identical legacy state. On failure we preserve
    // the exact warn format _usFetchRemote historically emitted so logs
    // do not silently disappear.
    try {
      const data = await userSettingsApi.fetch()
      if (data && data.ok) {
        _usApplyServerResponse(data)
        const projected = _projectFromLegacy()
        const merged: SettingsPayload = { ...DEFAULT_SETTINGS, ...projected }
        set({ settings: merged, loaded: true })
        _projectAll(merged)
        return
      }
      // ok === false → offline / transient; fall through to offline fallback
      console.warn('[US] fetchRemote invalid response')
    } catch (e: unknown) {
      const msg = (e as { message?: string })?.message ?? String(e)
      if (typeof msg === 'string' && msg.startsWith('HTTP ')) {
        console.warn('[US] fetchRemote ' + msg)
      } else {
        console.warn('[US] fetchRemote failed:', msg)
      }
      /* fall through to offline fallback */
    }
    // Offline / boot-race fallback: project from the legacy USER_SETTINGS
    // tree populated by bootstrapStartApp's loadUserSettings() (which reads
    // LS `zeus_user_settings` — the single canonical cache). No second LS key.
    try {
      const projected = _projectFromLegacy()
      const merged: SettingsPayload = { ...DEFAULT_SETTINGS, ...projected }
      set({ settings: merged, loaded: true })
      _projectAll(merged)
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
      // 1. Push store → legacy USER_SETTINGS + window.TC + atStore via the
      //    canonical _projectAll helper (MUST run before _usBuildFlatPayload
      //    below, which reads from USER_SETTINGS).
      _projectAll(settings)
      // 2. Build flat payload from USER_SETTINGS (covers keys whitelisted server-side
      //    that are not yet in SettingsPayload: profile, bmMode, assistArmed,
      //    manualLive, ptLev*, chartTz). Same builder the legacy wrapper uses →
      //    byte-identical wire payload.
      let payload: Record<string, unknown> = {}
      try { payload = _usBuildFlatPayload() } catch { payload = {} }
      // 3. POST direct via userSettingsApi.save. keepalive:true preserves the
      //    beforeunload-survival semantics of the legacy _usPostRemote path.
      //    On success: feed _usApplyPostResponse so _usSettingsRemoteTs (inside
      //    config.ts) advances, keeping WS-push dedup in settingsRealtime accurate.
      //    On failure: warn with the exact log format _usPostRemote historically
      //    emitted (HTTP-code vs generic failure branches).
      try {
        const j = await userSettingsApi.save(payload, { keepalive: true })
        _usApplyPostResponse(j)
      } catch (e: unknown) {
        const msg = ((e as { message?: string })?.message ?? String(e))
        if (typeof msg === 'string' && msg.startsWith('HTTP ')) {
          console.warn('[US] postRemote ' + msg)
        } else {
          console.warn('[US] postRemote failed:', msg)
        }
      }
      // 4. Write canonical LS cache — same key legacy _usSave uses. Single source.
      try {
        if (w.USER_SETTINGS) localStorage.setItem('zeus_user_settings', JSON.stringify(w.USER_SETTINGS))
      } catch (_) { /* ignore */ }
    } finally {
      set({ saving: false })
    }
  },

  patch: (partial) => set((s) => {
    const updated: SettingsPayload = { ...s.settings, ...partial }
    // [MIGRATION-F4 commit 4] Full projection on every patch — fixes the
    // pre-inversion gap where patch() updated TC + atStore but left
    // USER_SETTINGS stale, causing legacy engines reading USER_SETTINGS.*
    // to drift from React state between save events.
    _projectAll(updated)
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
 * [MIGRATION-F4 commit 4] Canonical write-through projector. Any mutation
 * to store.settings MUST flow through here so the three downstream
 * projections (USER_SETTINGS → legacy engines, window.TC → AT Proxy chain,
 * atStore.config → Phase-3 canonical AT state) stay in lockstep. Order
 * is fixed: Legacy first (so _usBuildFlatPayload sees fresh values when
 * called immediately after), Window second (TC Proxy delegates to atStore
 * so keep atStore step close), AT last (atStore is the phase-3 source of
 * truth for AT engine; hydrating it last guarantees its config reflects
 * the final merged SettingsPayload).
 */
function _projectAll(s: SettingsPayload): void {
  _projectToLegacy(s)
  _syncToWindow(s)
  _projectToAT(s)
}

/**
 * Push the flat store shape back into the legacy USER_SETTINGS tree so
 * _usBuildFlatPayload (in core/config.ts) reads up-to-date values.
 * Only overwrites keys this store owns — unrelated USER_SETTINGS keys
 * (profile, bmMode, assistArmed, manualLive, ptLev*, chartTz, dslSettings)
 * remain intact as hydrated by _usApplyFlatToUserSettings from the server.
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

/**
 * Phase 3 projector: hydrate atStore.config from the flat settings payload.
 * Runs alongside _syncToWindow so atStore reflects the same source of truth
 * as window.TC. Wire mapping lives in atStore.hydrate (sl→slPct, others 1:1;
 * adxMin/cooldownMs not in flat wire, preserved from current config).
 * Invoked by _projectAll on every store mutation.
 */
function _projectToAT(s: SettingsPayload): void {
  try { useATStore.getState().hydrate(s) } catch (_) { /* defensive */ }
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
