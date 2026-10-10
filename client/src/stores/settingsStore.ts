import { create } from 'zustand'
import { userSettingsApi } from '../services/api'
import { useATStore } from './atStore'
import { useMarketStore } from './marketStore'
import { applyIndVisibility, renderActBar } from '../engine/indicators'
import { setTF } from '../data/marketDataFeeds'
import { _usApplyServerResponse, _usApplyPostResponse, _usGetSettingsRemoteTs, _usHadCachedSettings } from '../core/config'
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
// Exported for tests — the live-state half of the load path (state maps);
// the render half is _applyLoadedSettingsToRenderLayer.
export function _applyLoadedTogglesToLiveState(): void {
  // [2026-10-08] Overlays — same two surfaces as the indicators: the legacy
  // w.S.overlays the chart renderers read, and marketStore, which the React
  // toolbar buttons render from (so restoring it also fixes their active
  // state). Missing/empty map = leave the live state alone.
  try {
    const _st2 = useSettingsStore.getState().settings as unknown as { overlays?: Record<string, boolean> }
    const ov = _st2.overlays
    if (ov && typeof ov === 'object' && Object.keys(ov).length > 0) {
      const w2 = window as unknown as { S?: { overlays?: Record<string, boolean> } }
      if (w2.S) w2.S.overlays = { ...(w2.S.overlays || {}), ...ov }
      const mkt2 = useMarketStore.getState()
      const curOv = mkt2.market.overlays as unknown as Record<string, boolean>
      mkt2.patch({ overlays: { ...curOv, ...ov } as unknown as typeof mkt2.market.overlays })
    }
  } catch (_) { /* defensive — never break the load path */ }
  try {
    const w = window as unknown as {
      S?: { activeInds?: Record<string, boolean>; indicators?: Record<string, boolean> }
      USER_SETTINGS?: { indicators?: Record<string, boolean> }
    }
    // [2026-06-24] Prefer the server-loaded settings.indicators (the active map now
    // round-trips through the server). The legacy USER_SETTINGS.indicators path does
    // not get populated from the server response, so on a fresh load (cache cleared /
    // new device) the indicators would not apply. Fall back to USER_SETTINGS for safety.
    const _st = useSettingsStore.getState().settings as unknown as { indicators?: Record<string, boolean>; indSettings?: Record<string, boolean> }
    const _pick = (o?: Record<string, boolean> | null) => (o && typeof o === 'object' && Object.keys(o).length > 0) ? o : null
    // [2026-06-25] Prefer the new server indicators map; fall back to the legacy USER_SETTINGS map;
    // and finally to indSettings (the legacy persistent boolean active-map). Users whose data predates
    // the `indicators` key keep their active indicators in indSettings — without this fallback they
    // loaded but never rendered ("activated but not displayed"). Works the same for every user/format.
    const inds = _pick(_st.indicators) || _pick(w.USER_SETTINGS && w.USER_SETTINGS.indicators) || _pick(_st.indSettings)
    if (!inds || typeof inds !== 'object') return
    if (w.S) {
      w.S.activeInds = { ...(w.S.activeInds || {}), ...inds }
      w.S.indicators = { ...(w.S.indicators || {}), ...inds }
    }
    const mkt = useMarketStore.getState()
    const cur = mkt.market.indicators as unknown as Record<string, boolean>
    // [2026-10-07] Iterate the LOADED map, not marketStore's defaults. The
    // default map holds only 4 keys (ema/wma/st/vp), so keying the copy off it
    // silently dropped all 86 other indicators — i.e. every custom one the
    // operator actually runs — from the React surface. Union keeps any default
    // the server map does not mention.
    const next: Record<string, boolean> = { ...cur }
    for (const k of Object.keys(inds)) {
      if (typeof inds[k] === 'boolean') next[k] = inds[k]
    }
    mkt.patch({ indicators: next as unknown as typeof mkt.market.indicators })
  } catch (_) { /* defensive — never break the load path */ }
  // [PERSIST-RENDER-GAP 2026-10-07] State maps alone were never enough: the
  // chart is painted by initActBar's one-shot pass long before this runs, so
  // the loaded toggles and timeframe have to be pushed onto the render layer
  // too. Safe to call on every load — it acts at most once per page load.
  try { _applyLoadedSettingsToRenderLayer() } catch (_) { /* best-effort */ }
}

// [PERSIST-RENDER-GAP 2026-10-07] Apply the LOADED settings to the RENDER
// layer, not just to the state maps.
//
// Operator symptom: "indicatorii activi ... ei cand ma uit sunt on si daca le
// dau off on se activeaza iar", and the chart timeframe reset on every refresh.
// The settings were never the problem — uid=1's row held chartTf='15m' and
// exactly the 7 active indicators. Two gaps kept them from reaching the chart:
//
//  1. initActBar() (ui/dom2) applies indicator visibility exactly ONCE, early
//     in boot, from whatever S.activeInds holds at that moment, and its
//     _actBarBuilt guard blocks a second pass. The server GET resolves later,
//     so whenever the device-local LS cache was gone (APK reinstall, cleared
//     data, new device) the boot defaults were painted, while the panel — which
//     reads S.activeInds, correctly hydrated here — showed ON. Toggling off→on
//     calls applyIndVisibility directly, which is exactly why that "fixed" it.
//  2. The timeframe was restored ONLY from the device-local `zeus_chart_tf` key
//     (ChartControls), so the persisted settings.chartTf never reached the
//     chart — even though setTF's own comment calls the USER_SETTINGS path "the
//     cross-device source of truth".
//
// Applied once per load and only on SUCCESS: the server value seeds the
// session, after which the user owns the chart. Without the one-shot, a later
// `settings.changed` refresh would yank the timeframe out from under them.
// Waits for the chart on a bounded poll — applyIndVisibility(id, true) calls
// initXSeries()/updateX(), which need mainChart to exist.
// [2026-10-09] A restore must never overrule a choice already made by hand.
// The boot apply waits on a poll (chart ready + settings arrived, 10s budget)
// and then calls setTF with the stored timeframe. If the operator picks a
// timeframe inside that window — exactly what you do on landing — the apply
// lands afterwards and snaps the chart back, dragging the re-render and
// TERMINATOR's candle tint with it. setTF reports a manual pick here.
let _userPickedTf = false
export function noteUserTfChoice(): void {
  _userPickedTf = true
  try { (window as unknown as { __zUserPickedTf?: boolean }).__zUserPickedTf = true } catch (_) { /* */ }
}
export function _resetUserTfChoiceForTest(): void {
  _userPickedTf = false
  try { (window as unknown as { __zUserPickedTf?: boolean }).__zUserPickedTf = false } catch (_) { /* */ }
}
// setTF lives in marketDataFeeds, which this module already imports from, so it
// cannot import back. It raises the window flag instead and we read both.
function _tfWasPickedByUser(): boolean {
  if (_userPickedTf) return true
  try { return !!(window as unknown as { __zUserPickedTf?: boolean }).__zUserPickedTf } catch (_) { return false }
}

const _RENDER_APPLY_POLL_MS = 250
const _RENDER_APPLY_MAX_ATTEMPTS = 40 // 10s budget, mirrors ChartControls
let _renderApplyDone = false
let _renderApplyTimer: ReturnType<typeof setInterval> | null = null

function _chartIsReady(): boolean {
  const w = window as unknown as { mainChart?: unknown; cSeries?: { priceToCoordinate?: unknown } }
  return !!(w.mainChart && w.cSeries && typeof w.cSeries.priceToCoordinate === 'function')
}

function _doRenderApply(): boolean {
  const st = useSettingsStore.getState().settings as unknown as {
    indicators?: Record<string, boolean>
    indSettings?: Record<string, boolean>
    chartTf?: string
  }
  const w = window as unknown as { renderChart?: () => void }

  // ── indicators: paint every id the stored map names, not just the four
  // marketStore ships defaults for.
  const inds = (st.indicators && Object.keys(st.indicators).length > 0)
    ? st.indicators
    : (st.indSettings && Object.keys(st.indSettings).length > 0 ? st.indSettings : null)
  if (!inds) {
    // [2026-10-09] Nothing to apply yet. Returning false keeps the one-shot
    // UNSPENT: the settings simply had not arrived. Marking it done here is
    // what left the operator's switched-off indicators switched back on — the
    // boot defaults stayed painted and the real map never reached the chart.
    return false
  }
  {
    let anyOn = false
    for (const id of Object.keys(inds)) {
      const on = !!inds[id]
      if (on) anyOn = true
      try { applyIndVisibility(id, on) } catch (_) { /* one bad series must not stop the rest */ }
    }
    try { renderActBar() } catch (_) { /* best-effort */ }
    if (anyOn && typeof w.renderChart === 'function') {
      try { w.renderChart() } catch (_) { /* best-effort */ }
    }
  }

  // ── overlays: restored into w.S by the load, but nothing ever drew them.
  try {
    const wo = window as unknown as { applyOverlays?: () => void }
    if (typeof wo.applyOverlays === 'function') wo.applyOverlays()
  } catch (_) { /* best-effort */ }

  // ── candle type: _usApply has a boot apply for it, but that only runs on the
  // LS-cache path; nothing re-applied it once the server response landed.
  // applyCandleType validates the id itself, so a legacy value cannot blank the
  // chart here.
  const usAny = (window as unknown as { USER_SETTINGS?: { chart?: { candleType?: string } }; applyCandleType?: (t: string, o?: { persist?: boolean }) => void })
  const ct = usAny.USER_SETTINGS && usAny.USER_SETTINGS.chart && usAny.USER_SETTINGS.chart.candleType
  if (ct && ct !== 'candles' && typeof usAny.applyCandleType === 'function') {
    try { usAny.applyCandleType(ct, { persist: false }) } catch (_) { /* best-effort */ }
  }

  // ── timeframe: the persisted value is the cross-device truth. Skip when the
  // chart already shows it, so we never re-fetch candles for nothing.
  const tf = typeof st.chartTf === 'string' ? st.chartTf.trim() : ''
  if (tf && !_tfWasPickedByUser()) {
    const mkt = useMarketStore.getState()
    if (mkt.market.chartTf !== tf) {
      try { setTF(tf, null) } catch (_) { /* best-effort */ }
      try { mkt.patch({ chartTf: tf }) } catch (_) { /* best-effort */ }
    }
  }
  return true
}

/**
 * Push the loaded settings onto the chart. Safe to call repeatedly — it does
 * the work at most once per page load, after the chart exists.
 */
export function _applyLoadedSettingsToRenderLayer(): void {
  if (_renderApplyDone || _renderApplyTimer) return
  const run = (): boolean => {
    if (!_chartIsReady()) return false
    // Only spend the one shot if there was actually something to apply. An
    // early call with an empty store used to mark it done and the real
    // settings, arriving moments later, were then skipped at the guard above.
    let did = false
    try { did = _doRenderApply() } catch (_) { /* never break the load path */ }
    if (!did) return false
    _renderApplyDone = true
    return true
  }
  if (run()) return
  let attempts = 0
  _renderApplyTimer = setInterval(() => {
    attempts++
    if (run() || attempts >= _RENDER_APPLY_MAX_ATTEMPTS) {
      if (_renderApplyTimer) { clearInterval(_renderApplyTimer); _renderApplyTimer = null }
    }
  }, _RENDER_APPLY_POLL_MS)
}

export function _resetRenderApplyForTest(): void {
  _renderApplyDone = false
  if (_renderApplyTimer) { clearInterval(_renderApplyTimer); _renderApplyTimer = null }
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
  // Chart
  // [2026-10-07] was 'candle' — not a CANDLE_TYPES id, so it could never be applied
  chartTf: '5m', chartType: 'candles', candleColors: null, heatmapSettings: null,
  // Indicators
  indSettings: null,
  // [2026-10-08] overlay toggles — previously never persisted at all
  overlays: null,
  // Alerts
  alertSettings: null,
  // [2026-10-10] Eight keys used to be seeded here that nothing filled and
  // nothing read — theme, uiScale, soundEnabled, timezoneOffset, liqSettings,
  // srSettings, llvSettings, zsSettings. Because the payload is a spread of
  // this store and the server merges per key (where a null DOES overwrite),
  // every save destroyed the stored value with a hardcoded default. The live
  // database showed it plainly: all nine users held byte-identical values,
  // which is the signature of a key only the code ever writes.
  //
  // They are gone rather than filled, because each already has a real owner
  // and this store is not it: theme and soundEnabled live in localStorage
  // ('zeus_theme' / 'zt:sound_muted'), llvSettings and zsSettings belong to
  // the user-context channel (verified live — 9 of 9 rows for llvSettings,
  // chartExtras on disk for zsSettings), uiScale is a feature removed on
  // 2026-06-13, and timezoneOffset is a dead duplicate of chartTz. A key
  // absent from the payload leaves the stored value untouched, which is
  // exactly what we want. See noDefaultClobber.test.ts.
  //
  // Making theme and sound follow the user across devices is deliberately NOT
  // done here: that needs an apply-on-load too, and wiring only the save half
  // is the mistake that made the candle type look fixed for three days.
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
        // [BRAIN-NAMESPACE CLOBBER FIX 2026-10-08] Only re-apply the per-mode
        // brain namespace when THIS response actually carried it.
        // applyBrainCfgForMode does `Object.assign(USER_SETTINGS.autoTrade,
        // cfg.autoTrade)` and then loadFromLegacy(), i.e. it pushes the
        // namespace over the flat values we just received. When the response
        // did not include `brain`, that namespace is whatever was already in
        // memory — stale — so re-applying it REVERTED the fresh values.
        // Traced on the 409 refresh path: confMin went 70 → 99 (the refresh
        // landing correctly) → 70 (this clobber). It fires on every load, not
        // just after a conflict, which is the "settings go back to the old
        // ones" shape the operator reported. When the server does send `brain`
        // the namespace is part of the same response and re-applying it is
        // correct, so that path is unchanged.
        if (data.settings && (data.settings as Record<string, unknown>).brain) {
          _reapplyBrainCfgForCurrentMode()
        }
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
      // [DEFAULTS-CLOBBER GUARD 2026-10-08] Only declare the store LOADED when
      // the legacy tree actually held something. With no cache (fresh install,
      // new device, the APK reinstall that wiped the operator's localStorage)
      // AND a failed fetch, `projected` is all defaults; marking it loaded would
      // let the next save POST those defaults, and since the server merges
      // per-key, the real indicator map and chart colours would be overwritten
      // permanently — exactly the failure saveToServer's own comment describes.
      // Staying unloaded keeps saves blocked until a real load succeeds.
      // The signal is whether boot actually FOUND a cached blob, not whether the
      // projection looks non-empty — window.TC contributes defaults, so an empty
      // tree still projects real-looking values.
      let _hadCache = false
      try { _hadCache = _usHadCachedSettings() } catch { _hadCache = false }
      set(_hadCache ? { settings: merged, loaded: true } : { settings: merged })
      _projectAll(merged)
      _applyLoadedTogglesToLiveState()
      // [2026-10-08] KNOWN, logged in the Book: on this branch the per-mode
      // namespace still overwrites the flat values just projected from cache —
      // a cached confMin of 77 comes back as the namespace default 65. It is the
      // same family as the b247 clobber, which gated only the server path. Not
      // gated here because the namespace legitimately holds content (seeded from
      // defaults), so "has a namespace" is not a usable signal; deciding which
      // side wins is a product call, not a mechanical fix.
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
      // [2026-06-24] Persist the ACTIVE-indicator map server-side. Which indicators
      // are toggled ON lives canonically in legacy w.S.activeInds (togInd), and was
      // never copied into settings.indicators — so it was localStorage-only and got
      // lost on a cache-clear / new device (operator + Mirela saw "indicators don't
      // persist/display"). Mirror the legacy `USER_SETTINGS.indicators = S.activeInds`
      // here. Guard: never POST an empty map (boot-window) over a saved set.
      try {
        const _legacyS = (window as unknown as { S?: { activeInds?: Record<string, boolean> } }).S
        const ai = _legacyS && _legacyS.activeInds
        if (ai && typeof ai === 'object' && Object.keys(ai).length > 0) {
          payload.indicators = { ...ai }
          // [2026-06-25] Keep the legacy indSettings active-map in sync with the live set. The legacy
          // _usApply reads indSettings (via the USER_SETTINGS projection) and re-applies it on every
          // boot; if it stayed stale here, it would OVERWRITE the user's toggles on reload ("change
          // indicators -> they reset to the old set"). Writing both keeps every reader consistent.
          ;(payload as unknown as { indSettings?: Record<string, boolean> }).indSettings = { ...ai }
        }
      } catch (_) { /* defensive — never block the save */ }
      // [2026-10-08] Persist the chart OVERLAY toggles (liq / zs / sr / llv /
      // oflow / ovi). They lived only in legacy w.S.overlays and neither togOvr
      // ever saved, so they reset on every refresh — a forgotten save rather
      // than a missing feature (togInd does save, and the React wrapper's own
      // comment refers to "the legacy start value was already-true
      // (persisted)"). Same guard as the indicator map: never POST an empty
      // object over a saved one during the boot window.
      try {
        const _ov = (window as unknown as { S?: { overlays?: Record<string, boolean> } }).S?.overlays
        if (_ov && typeof _ov === 'object' && Object.keys(_ov).length > 0) {
          payload.overlays = { ..._ov }
        }
      } catch (_) { /* defensive — never block the save */ }
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
    // [2026-10-10] ch.candleType was missing here, so the candle type could
    // not persist: the switcher wrote it into the legacy tree, this projection
    // ignored it, the store kept DEFAULT_SETTINGS.chartType, and the save then
    // posted that default over the real choice. The read half was fixed on
    // 2026-10-07 (_usApplyFlatToUserSettings), which closed the loop on the
    // wrong value and made the bug look repaired. See candleTypePersist.test.ts.
    chartType: ch.candleType,
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
  // [2026-06-25] Feed the legacy USER_SETTINGS.indicators (which _usApply re-applies on boot) from the
  // CANONICAL active map `settings.indicators`, falling back to the legacy `settings.indSettings`. Using
  // the stale indSettings here made _usApply overwrite the user's toggles on reload (indicators reset).
  const _settingsInd = (settings as unknown as { indicators?: Record<string, boolean> }).indicators
  if (_settingsInd !== undefined) us.indicators = _settingsInd
  else if (settings.indSettings !== undefined) us.indicators = settings.indSettings
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
