import { create } from 'zustand'
import { userSettingsApi } from '../services/api'
import { useATStore } from './atStore'
import { useMarketStore } from './marketStore'
import { _usApplyServerResponse, _usApplyPostResponse, _usGetSettingsRemoteTs } from '../core/config'
import type { SettingsPayload } from '../types/settings-contracts'
import { debounce } from '../utils/debounce'

// [PERSIST-ROOT-CAUSE 2026-06-12] After server settings land (or the offline
// fallback projects from the LS cache), push the indicator toggles into the two
// live-state surfaces that the boot-time _usApply does NOT refresh after the GET:
//   • window.S.activeInds — read by legacy _usSave (config.ts:1837) on the very
//     next save. If left at the boot default it re-derives defaults and clobbers
//     the server again — the permanent-reset loop that lost the user's toggles.
//   • useMarketStore.market.indicators — the React indicator panel's source of
//     truth (marketStore ships a hard default that nothing else hydrated).
// Chart colors are refreshed by TradingChart's existing post-mount poll, so they
// are intentionally left untouched here. Never throws — the load path must not
// be broken by this best-effort live-state sync.
function _applyLoadedTogglesToLiveState(): void {
  try {
    const w = window as unknown as {
      S?: { activeInds?: Record<string, boolean>; indicators?: Record<string, boolean> }
      USER_SETTINGS?: { indicators?: Record<string, boolean> }
    }
    const inds = w.USER_SETTINGS && w.USER_SETTINGS.indicators
    if (!inds || typeof inds !== 'object') return
    if (w.S) {
      w.S.activeInds = { ...(w.S.activeInds || {}), ...inds }
      w.S.indicators = { ...(w.S.indicators || {}), ...inds }
    }
    const mkt = useMarketStore.getState()
    const cur = mkt.market.indicators as unknown as Record<string, boolean>
    const next: Record<string, boolean> = { ...cur }
    for (const k of Object.keys(cur)) {
      if (typeof inds[k] === 'boolean') next[k] = inds[k]
    }
    mkt.patch({ indicators: next as unknown as typeof mkt.market.indicators })
  } catch (_) { /* defensive — never break the load path */ }
}

// [MIGRATION-F0 commit 6] Unified settings code path.
//
// [MIGRATION-F4 commit 4] Projection inversion — settingsStore is now the
// single source of truth. USER_SETTINGS + window.TC + atStore.config are
// write-through projections of store.settings, refreshed atomically on
// every store mutation via the _projectAll(s) helper (Legacy → Window → AT,
// fixed order). The legacy tree retains keys the store does not own
// All 9 legacy-only keys (profile, bmMode, assistArmed, manualLive,
// ptLevDemo, ptLevLive, ptMarginMode, chartTz, dslSettings) are now
// in SettingsPayload and projected bidirectionally by _projectFromLegacy
// and _projectToLegacy. saveToServer sends store.settings directly.
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
  tz?: number | null
}
interface LegacyBrainNamespace {
  profile?: string
  bmMode?: string
  // [BRAIN-MODE-SPLIT b78] full working-flow per-mode
  assistArmed?: boolean
  autoTrade?: Record<string, unknown>
  dslSettings?: Record<string, unknown> | null
}
interface LegacyUserSettings {
  autoTrade?: LegacyAutoTrade
  chart?: LegacyChart
  indicators?: Record<string, unknown> | null
  alerts?: Record<string, unknown> | null
  profile?: string
  bmMode?: string
  // [BRAIN-MODE-SPLIT b74] per-AT-mode brain namespace
  brain?: { live?: LegacyBrainNamespace; demo?: LegacyBrainNamespace } | null
  assistArmed?: boolean
  manualLive?: boolean
  ptLevDemo?: number
  ptLevLive?: number
  ptMarginMode?: string
  dslSettings?: Record<string, unknown> | null
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

  loadFromServer: () => Promise<void>
  loadFromLegacy: () => void
  saveToServer: () => Promise<void>
  /** Update one or more settings locally (does NOT auto-save). Triggers
   *  full projection to USER_SETTINGS + window.TC + atStore. */
  patch: (partial: Partial<SettingsPayload>) => void
  /** Get a setting value with default fallback. */
  get: <K extends keyof SettingsPayload>(key: K) => SettingsPayload[K]
}

// Module-scope debouncer — single shared instance across all callers.
// 300ms trailing window coalesces config-save storms (operator rapid
// edits, settings.changed WS bursts, reconnect cascades).
let _debouncedSettingsLoad: (() => void) | null = null
// Direct (non-debounced) ref used by saveToServer's stale-refresh path,
// which needs to await the fetch synchronously within the same call frame.
let _settingsLoadImpl: (() => Promise<void>) | null = null

export const useSettingsStore = create<SettingsStoreState>()((set, getState) => {
  const loadImpl = async (): Promise<void> => {
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
        _applyLoadedTogglesToLiveState()
        _reapplyBrainCfgForCurrentMode()
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
      _applyLoadedTogglesToLiveState()
      _reapplyBrainCfgForCurrentMode()
    } catch {
      set({ settings: { ...DEFAULT_SETTINGS }, loaded: true })
    }
  }

  if (!_debouncedSettingsLoad) {
    _debouncedSettingsLoad = debounce(() => { void loadImpl() }, 300)
  }
  _settingsLoadImpl = loadImpl

  return {
  settings: { ...DEFAULT_SETTINGS },
  loaded: false,
  saving: false,

  loadFromServer: async () => { _debouncedSettingsLoad!() },

  loadFromLegacy: () => {
    const projected = _projectFromLegacy()
    const merged: SettingsPayload = { ...getState().settings, ...projected }
    set({ settings: merged })
  },

  saveToServer: async () => {
    const { settings, saving, loaded } = getState()
    if (saving) return
    // [PERSIST-ROOT-CAUSE 2026-06-12] Boot-window clobber guard. Until the
    // initial load resolves, `settings` still holds DEFAULT_SETTINGS
    // (candleColors=null, default indicators). A direct caller firing in that
    // window (e.g. AutoTradePanel) would POST those defaults; the server merges
    // per-key, so candleColors/indSettings get overwritten with defaults and the
    // user's chart colors + indicators reset PERMANENTLY (next boot's GET then
    // restores defaults). `loaded` flips true in every loadImpl exit path
    // (server success AND offline fallback, ~300ms after boot), so this never
    // permanently blocks saves — it only closes the boot race. Mirrors the
    // `_usApplyDone` + `loaded` guards already in legacy _usSave.
    if (!loaded) { console.warn('[US] saveToServer skipped — settings not loaded yet (boot window)'); return }
    set({ saving: true })
    try {
      const w = window as unknown as ZeusWindowExt
      _projectAll(settings)
      const payload: Record<string, unknown> = { ...settings }
      // 3. POST direct via userSettingsApi.save. keepalive:true preserves the
      //    beforeunload-survival semantics of the legacy _usPostRemote path.
      //    On success: feed _usApplyPostResponse so _usSettingsRemoteTs (inside
      //    config.ts) advances, keeping WS-push dedup in settingsRealtime accurate.
      //    On failure: warn with the exact log format _usPostRemote historically
      //    emitted (HTTP-code vs generic failure branches).
      // [Phase 8D2] Pass if_updated_at so the server rejects a save that
      // would overwrite a newer version from another tab. On a stale
      // rejection we abandon this save and refresh from server — the user
      // can re-apply their change against the fresher baseline.
      const ifUpdatedAt = _usGetSettingsRemoteTs()
      try {
        const j = await userSettingsApi.save(payload, {
          keepalive: true,
          ifUpdatedAt: ifUpdatedAt > 0 ? ifUpdatedAt : undefined,
        })
        if (j && j.stale) {
          const currentTs = Number(j.current_updated_at || 0)
          console.warn('[US] postRemote stale — server version ' + currentTs + ' > local ' + ifUpdatedAt + '; refreshing')
          // Refresh from server so legacy projections + store reflect the
          // fresher baseline. Do not silently merge the in-flight payload —
          // user must re-issue the save with eyes on the updated values.
          // Use _settingsLoadImpl directly (bypass debounce) so the refresh
          // is awaited synchronously within this save call frame.
          if (_settingsLoadImpl) await _settingsLoadImpl()
        } else {
          _usApplyPostResponse(j)
        }
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
}})
;(window as any).__zeusSettingsStore = useSettingsStore

/**
 * [R4] After loadFromServer hydrates USER_SETTINGS (including the per-mode
 * `brain.live` / `brain.demo` namespaces), re-apply the current AT-mode's
 * brain/DSL config to the UI. Without this, a `settings.changed` WS push
 * updated the nested tree but left window.S, useBrainStore, useDslStore and
 * the DOM radios untouched — cross-tab updates were invisible until the
 * user toggled AT mode manually. Idempotent: applyBrainCfgForMode simply
 * re-writes the same values when nothing has changed.
 *
 * Gated on `w.applyBrainCfgForMode` because config.ts exposes it on window
 * after module init; during early boot (settingsStore created before
 * config.ts runs) the gate is a silent no-op and the _usApply path later
 * applies the config when brain/UI are ready.
 */
function _reapplyBrainCfgForCurrentMode(): void {
  try {
    const w = window as any
    if (typeof w.applyBrainCfgForMode !== 'function') return
    const m = useATStore.getState().mode
    const modeKey: 'live' | 'demo' = m === 'live' ? 'live' : 'demo'
    w.applyBrainCfgForMode(modeKey)
  } catch {
    /* defensive — settings hydration must not throw into WS handler */
  }
}

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
    profile: us.profile,
    bmMode: us.bmMode,
    // [BRAIN-MODE-SPLIT b74] pass per-mode brain namespace through the wire
    brain: us.brain as SettingsPayload['brain'],
    assistArmed: us.assistArmed,
    manualLive: us.manualLive as Record<string, unknown> | null | undefined,
    manualTestnet: (us as any).manualTestnet,
    ptLevDemo: us.ptLevDemo,
    ptLevLive: us.ptLevLive,
    ptMarginMode: us.ptMarginMode,
    chartTz: ch.tz,
    dslSettings: us.dslSettings as Record<string, unknown> | null | undefined,
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
 * is fixed: Legacy first (so USER_SETTINGS sees fresh values when
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
  if (settings.chartTz !== undefined) ch.tz = (settings.chartTz == null ? null : Number(settings.chartTz))
  if (settings.candleColors !== undefined) ch.colors = settings.candleColors
  if (settings.heatmapSettings !== undefined) ch.heatmap = settings.heatmapSettings
  if (settings.indSettings !== undefined) us.indicators = settings.indSettings
  if (settings.alertSettings !== undefined) us.alerts = settings.alertSettings
  if (settings.profile !== undefined) us.profile = settings.profile
  if (settings.bmMode !== undefined) us.bmMode = settings.bmMode
  // [BRAIN-MODE-SPLIT b78] project per-mode brain namespace back into legacy.
  // Full working-flow shape: profile, bmMode, assistArmed, autoTrade, dslSettings.
  // Merge is shallow at the namespace level (profile/bmMode/assistArmed replace,
  // autoTrade/dslSettings replace as whole blobs — _usSave writes them complete),
  // and preserves the non-active slot so a demo write never touches live.
  if (settings.brain !== undefined && settings.brain && typeof settings.brain === 'object') {
    us.brain = us.brain || { live: {}, demo: {} }
    if (settings.brain.live && typeof settings.brain.live === 'object') {
      us.brain.live = { ...(us.brain.live || {}), ...settings.brain.live }
    }
    if (settings.brain.demo && typeof settings.brain.demo === 'object') {
      us.brain.demo = { ...(us.brain.demo || {}), ...settings.brain.demo }
    }
  }
  if (settings.assistArmed !== undefined) us.assistArmed = settings.assistArmed
  if (settings.manualLive !== undefined) (us as any).manualLive = settings.manualLive
  if ((settings as any).manualTestnet !== undefined) (us as any).manualTestnet = (settings as any).manualTestnet
  if (settings.ptLevDemo !== undefined) (us as any).ptLevDemo = settings.ptLevDemo
  if (settings.ptLevLive !== undefined) (us as any).ptLevLive = settings.ptLevLive
  if (settings.ptMarginMode !== undefined) (us as any).ptMarginMode = settings.ptMarginMode
  if (settings.dslSettings !== undefined) (us as any).dslSettings = settings.dslSettings
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
