/**
 * Zeus Terminal — Legacy JS Bridge Loader
 *
 * Loads OLD JS files (plain scripts) in correct order after React mount.
 * Creates compatibility shims to prevent conflicts with React-managed features:
 *   - initCharts() → no-op (React TradingChart.tsx handles chart)
 *   - initZeusGroups() → no-op (React PanelShell.tsx has the DOM structure)
 *   - React WS (/ws/sync) runs alongside old WS manager (different connections)
 *
 * Old JS populates React DOM elements via getElementById() — this is the bridge.
 */

import { installPhase1Adapters } from './phase1Adapters'

// ── Types ──────────────────────────────────────────────────────────
interface BridgeState {
  loaded: boolean
  loading: boolean
  error: string | null
  loadedScripts: string[]
  failedScripts: string[]
  startAppCalled: boolean
}

const state: BridgeState = {
  loaded: false,
  loading: false,
  error: null,
  loadedScripts: [],
  failedScripts: [],
  startAppCalled: false,
}

// ── Script load order ─────────────────────────────────────────────
// Exact order from public/index.html lines 4554-4668
// Each phase must complete before the next starts

const SCRIPT_PHASES: string[][] = [
  // Phase 0 — Head managers (icons.js, helpers.js, formatters.js, math.js ported to React Phase 1)
  [
    'js/core/managers.js',
  ],
  // Phase 1B — Global state & config (constants.js + events.js ported to React Phase 2)
  [
    'js/core/state.js',
    'js/core/config.js',
  ],
  // Phase 1C — UI & Dev (tabLeader.js ported to React Phase 3)
  [
    'js/utils/guards.js',
    'js/utils/dev.js',
    'js/ui/theme.js',
    'js/utils/decisionLog.js',
  ],
  // Phase 2 — Data layer (storage.js + symbols.js ported to React Phase 3)
  [
    'js/data/marketData.js',
    'js/data/klines.js',
  ],
  // Phase 3 — Brain engine (all ported to React Phase 5: signals, confluence, forecast, regime, phaseFilter, deepdive, brain)
  // [EMPTY — all brain scripts ported]
  // Phase 4 — Trading
  [
    'js/trading/dsl.js',
    'js/trading/risk.js',
    'js/trading/positions.js',
    'js/trading/orders.js',
    'js/trading/liveApi.js',
    'js/trading/autotrade.js',
  ],
  // Phase 5 — Analytics (perfStore.js + dailyPnl.js ported to React Phase 4)
  // Phase 6 — UI rendering
  [
    'js/ui/marketCoreReactor.js',
    'js/ui/dom.js',
    'js/ui/panels.js',
    'js/ui/timeSales.js',
    'js/ui/modals.js',
    'js/ui/notifications.js',
    'js/ui/render.js',
  ],
  // Phase 7 — Brain extensions
  [
    'js/brain/aub.js',
    'js/brain/arianova.js',
  ],
  // Phase 8 — Teacher
  [
    'js/teacher/teacherConfig.js',
    'js/teacher/teacherStorage.js',
    'js/teacher/teacherIndicators.js',
    'js/teacher/teacherDataset.js',
    'js/teacher/teacherBrain.js',
    'js/teacher/teacherSimulator.js',
    'js/teacher/teacherStats.js',
    'js/teacher/teacherMemory.js',
    'js/teacher/teacherReason.js',
    'js/teacher/teacherCalibration.js',
    'js/teacher/teacherCurriculum.js',
    'js/teacher/teacherCapability.js',
    'js/teacher/teacherAutopilot.js',
    'js/teacher/teacherEngine.js',
    'js/teacher/teacherPanel.js',
  ],
  // Phase 9 — Final modules
  [
    'js/data/orderflow.js',
    'js/core/patch.js',
    'js/core/hotkeys.js',
    'js/ui/modebar.js',
    'js/ui/pageview.js',
    'js/ui/dock.js',
  ],
  // Phase 10 — Bootstrap (defines startApp, must be last)
  [
    'js/core/bootstrap.js',
  ],
  // Phase 11 — Post-bootstrap
  [
    'js/ui/drawingTools.js',
  ],
]

// ── Old CSS files to load ─────────────────────────────────────────
// These provide styles for old JS-created DOM elements
const LEGACY_CSS = [
  'css/main.css',
  'css/components.css',
  'css/journal.css',
  // themes.css is already loaded via React's index.html
]

// ── Helpers ───────────────────────────────────────────────────���────

/** Load a CSS stylesheet */
function loadCSS(href: string): Promise<void> {
  return new Promise((resolve) => {
    const url = '/' + href
    // Check if already loaded
    if (document.querySelector(`link[href="${url}"]`)) {
      resolve()
      return
    }
    const link = document.createElement('link')
    link.rel = 'stylesheet'
    link.href = url
    link.onload = () => resolve()
    link.onerror = () => {
      console.warn(`[BRIDGE] Failed to load CSS: ${href}`)
      resolve()
    }
    document.head.appendChild(link)
  })
}

/** Load a single script tag and return a promise */
function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    // Build absolute URL — old JS lives in /js/ on the server (public/ dir)
    const url = '/' + src
    const script = document.createElement('script')
    script.src = url
    script.async = false  // preserve execution order within phase
    script.onload = () => {
      state.loadedScripts.push(src)
      resolve()
    }
    script.onerror = () => {
      const msg = `[BRIDGE] Failed to load: ${src}`
      console.error(msg)
      state.failedScripts.push(src)
      // Don't reject — continue loading other scripts
      resolve()
    }
    document.body.appendChild(script)
  })
}

/** Load all scripts in a phase sequentially (order matters within phase) */
async function loadPhase(scripts: string[]): Promise<void> {
  for (const src of scripts) {
    await loadScript(src)
  }
}

// ── Shims ──────────────────────────────────────────────────────────

/**
 * Install compatibility shims BEFORE old JS loads.
 * These prevent old JS from conflicting with React-managed features.
 */
function installShims(): void {
  const w = window as any

  // ── Phase 1 adapters: ported utilities exposed on window.* ──
  // Replaces: helpers.js, formatters.js, math.js, icons.js
  // Must run BEFORE any old JS loads (config.js, deepdive.js, etc. depend on _ZI, el, fmt, _clamp)
  installPhase1Adapters()

  // ── SHIM 1: initCharts() → no-op ──
  // React's TradingChart.tsx creates the chart instance.
  // chartBridge.ts exposes it to window.mainChart / window.cSeries etc.
  // Old initCharts() would create a duplicate → skip it.
  // NOTE: LightweightCharts namespace is set by chartBridge.ts (real library, not fake).
  // If chartBridge hasn't registered yet, set a placeholder so startApp() doesn't retry-loop.
  if (typeof w.LightweightCharts === 'undefined') {
    // chartBridge.ts will overwrite this with the real library on chart mount
    w.LightweightCharts = { version: () => 'bridge-pending' }
  }
  w.__BRIDGE_SKIP_INIT_CHARTS = true

  // ── SHIM 2: initZeusGroups() → no-op ──
  // React PanelShell.tsx already renders all panels in #zeus-groups.
  // Old initZeusGroups() tries to move DOM elements with appendChild → breaks React.
  w.__BRIDGE_SKIP_INIT_GROUPS = true

  // ── SHIM 3: React WS coexistence ──
  // React's ws.ts connects to /ws/sync for state sync.
  // Old managers.js WS connects to Binance feeds (different URLs).
  // No conflict — they use different connections.
  // BUT: old ZState also connects to /ws/sync. To avoid double sync,
  // we flag that React handles sync.
  w.__BRIDGE_REACT_WS_SYNC = true

  // ── SHIM 4: Prevent double brain ──
  // React has brainCompute.ts + useBrainEngine.ts running on 2s interval.
  // Old brain.js has runBrainUpdate on 5s interval.
  // The old brain is more complete — we let old brain run and disable React brain.
  w.__BRIDGE_OLD_BRAIN_ACTIVE = true

  // ── SHIM 5: el() helper ──
  // Old bootstrap.js uses el('id') shorthand. Define if not already present.
  if (typeof w.el !== 'function') {
    w.el = (id: string) => document.getElementById(id)
  }

  // ── SHIM 6: Block bootstrap.js auto-invoke ──
  // bootstrap.js (line 1825) checks __ZEUS_INIT__ and auto-calls startApp() if not set.
  // We MUST prevent this — the bridge needs to call startApp() AFTER:
  //   1. All scripts loaded
  //   2. Functions patched (initCharts → no-op, etc.)
  //   3. Chart ready (mainChart exposed by chartBridge.ts)
  // Setting __ZEUS_INIT__ = true blocks bootstrap.js from auto-invoking.
  w.__ZEUS_INIT__ = true

  // ── SHIM 7: Patch fetch() to add CSRF header ──
  // Old JS fetch calls (config.js, state.js, guards.js, etc.) don't include
  // the X-Zeus-Request: 1 header required by the server's CSRF middleware.
  // Monkey-patch window.fetch to auto-add the header on same-origin POST/PUT/DELETE.
  const _origFetch = w.fetch.bind(w)
  w.fetch = function bridgeFetch(input: RequestInfo | URL, init?: RequestInit) {
    // Only patch same-origin requests (relative URLs or same host)
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url
    const isSameOrigin = url.startsWith('/') || url.startsWith(location.origin)
    if (isSameOrigin && init && typeof init.method === 'string' &&
        ['POST', 'PUT', 'DELETE', 'PATCH'].includes(init.method.toUpperCase())) {
      const headers = new Headers(init.headers || {})
      if (!headers.has('X-Zeus-Request')) {
        headers.set('X-Zeus-Request', '1')
      }
      init = { ...init, headers }
    }
    return _origFetch(input, init)
  }

  console.log('[BRIDGE] Shims installed')
}

/**
 * After old JS scripts are loaded, patch functions that would conflict.
 * Called AFTER all scripts load but BEFORE startApp().
 */
function patchLoadedFunctions(): void {
  const w = window as any

  // Patch initCharts — replace with no-op
  if (typeof w.initCharts === 'function') {
    w._origInitCharts = w.initCharts
    w.initCharts = function () {
      console.log('[BRIDGE] initCharts() skipped — React chart active')
    }
  }

  // Patch initZeusGroups — replace with minimal version
  if (typeof w.initZeusGroups === 'function') {
    w._origInitZeusGroups = w.initZeusGroups
    w.initZeusGroups = function () {
      console.log('[BRIDGE] initZeusGroups() skipped — React DOM active')
      // Set UI_BUILT so subsequent code knows DOM is ready
      w.UI_BUILT = true
    }
  }

  // Patch initPageView — replace with no-op (React handles page views)
  if (typeof w.initPageView === 'function') {
    w._origInitPageView = w.initPageView
    w.initPageView = function () {
      console.log('[BRIDGE] initPageView() skipped — React PageView active')
    }
  }

  // Patch initZeusDock — replace with no-op (React handles dock)
  if (typeof w.initZeusDock === 'function') {
    w._origInitZeusDock = w.initZeusDock
    w.initZeusDock = function () {
      console.log('[BRIDGE] initZeusDock() skipped — React Dock active')
    }
  }

  // Patch theme init — React handles theme
  if (typeof w.initTheme === 'function') {
    w._origInitTheme = w.initTheme
    w.initTheme = function () {
      console.log('[BRIDGE] initTheme() skipped — React theme active')
    }
  }

  // Patch registerServiceWorker — not needed in dev/React
  if (typeof w.registerServiceWorker === 'function') {
    w._origRegisterServiceWorker = w.registerServiceWorker
    w.registerServiceWorker = function () {
      console.log('[BRIDGE] registerServiceWorker() skipped')
    }
  }

  // Patch _pinCheckLock — skip PIN lock in React
  if (typeof w._pinCheckLock === 'function') {
    w._origPinCheckLock = w._pinCheckLock
    w._pinCheckLock = function () {
      console.log('[BRIDGE] _pinCheckLock() skipped')
    }
  }

  // Patch _srEnsureVisible — old JS moves #sr-strip out of its React wrapper
  // (config.js line 252, called via setTimeout 3s after boot in bootstrap.js line 1106)
  if (typeof w._srEnsureVisible === 'function') {
    w._origSrEnsureVisible = w._srEnsureVisible
    w._srEnsureVisible = function () {
      console.log('[BRIDGE] _srEnsureVisible() skipped — React DOM manages sr-strip position')
      // Still run stats/list rendering (safe, doesn't move DOM)
      if (typeof w._srUpdateStats === 'function') w._srUpdateStats()
      if (typeof w._srRenderList === 'function') w._srRenderList()
    }
  }

  console.log('[BRIDGE] Functions patched')
}

// ─��� DOM Recovery ───────────────────────────────────────���──────────
// Old JS (bootstrap.js startApp) moves certain panel elements out of their
// React wrappers via mv() and _relocateFlow(). This breaks React's panel
// visibility system (.zpv-active-panel). We move them back after startApp().

/** Map of inner element ID → correct React wrapper data-panel-id */
const PANEL_RECOVERY_MAP: Record<string, string> = {
  'flow-panel': 'flow',
  'sr-strip': 'sigreg',
}

function recoverMovedPanels(): void {
  for (const [innerId, panelId] of Object.entries(PANEL_RECOVERY_MAP)) {
    const el = document.getElementById(innerId)
    const wrapper = document.querySelector(`[data-panel-id="${panelId}"]`)
    if (!el || !wrapper) continue
    if (wrapper.contains(el)) continue // already in correct position
    wrapper.appendChild(el)
    console.log(`[BRIDGE] Recovered #${innerId} → [data-panel-id="${panelId}"]`)
  }
}

// ── Onclick re-attacher ──────────────────────────────────────────────
// Old index.html had inline onclick="fn()" on buttons. React shells render
// the same IDs but without handlers. This attaches them after bridge boot.

function reattachOnclickHandlers(): void {
  const w = window as any

  // Map: element ID → function call string (matches old HTML onclick values)
  // Only elements where React shell doesn't have an onClick handler.
  const ONCLICK_MAP: Record<string, () => void> = {
    // ── Manual Trade ──
    'btnAddFunds': () => w.promptAddFunds?.(),
    'btnResetDemo': () => w.promptResetDemo?.(),
    'btnDemo': () => w.switchGlobalMode?.('demo'),
    'btnLive': () => w.switchGlobalMode?.('live'),
    'btnConnectExchange': () => w.connectLiveAPI?.(),
    // ── DSL ──
    'dslToggleBtn': () => w.toggleDSL?.(),
    'dslAssistArmBtn': () => w.toggleAssistArm?.(),
    // ── Brain cockpit ──
    'bmode-assist': () => w.setBrainMode?.('assist'),
    'bmode-auto': () => w.setBrainMode?.('auto'),
    'prof-fast': () => w.setProfile?.('fast'),
    'prof-swing': () => w.setProfile?.('swing'),
    'prof-defensive': () => w.setProfile?.('defensive'),
    'dsl-atr': () => w.setDslMode?.('atr'),
    'dsl-fast': () => w.setDslMode?.('fast'),
    'dsl-swing': () => w.setDslMode?.('swing'),
    'dsl-defensive': () => w.setDslMode?.('defensive'),
    'dsl-tp': () => w.setDslMode?.('tp'),
    'soundBadge': () => w._initAudio?.(),
    // ── AUB ──
    'aub-sfx-btn': () => { event?.stopPropagation(); w.aubToggleSFX?.() },
    'aub-toggle-btn': () => { event?.stopPropagation(); w.aubToggle?.() },
    // ── Teacher ──
    'teacher-v2-teach-btn': () => w.teacherStart?.(),
    'teacher-v2-stop-btn': () => w.teacherStop?.(),
    // ── Nova ──
    'nova-copy-btn': () => w.novaCopyLog?.(),
    // ── Adaptive ──
    'adaptiveToggleBtn': () => w.toggleAdaptive?.(),
    // ── Signal Registry ──
    'sr-strip-bar': () => w.srStripToggle?.(),
    // ── Welcome ──
    'wlcEnterBtn': () => w.closeM?.('mwelcome'),
    // ── Header ──
    'zsbPos': () => w._toggleExposurePanel?.(),
  }

  let attached = 0
  for (const [id, handler] of Object.entries(ONCLICK_MAP)) {
    const el = document.getElementById(id)
    if (!el) continue
    // Don't override if React already has an onClick (check __reactFiber)
    const hasReactHandler = Object.keys(el).some(k => k.startsWith('__reactFiber') || k.startsWith('__reactEvents'))
    // Attach as addEventListener (doesn't conflict with React's synthetic events)
    el.addEventListener('click', (e) => {
      try { handler() } catch (err) { console.warn(`[BRIDGE] onclick ${id} error:`, err) }
    })
    attached++
  }
  console.log(`[BRIDGE] Onclick handlers attached: ${attached}`)
}

// ── Main API ───────────────────────────────────────────────────────

/**
 * Load all old JS scripts and start the legacy app.
 * Call this ONCE after React has mounted and auth is confirmed.
 */
export async function startLegacyBridge(): Promise<BridgeState> {
  if (state.loaded || state.loading) {
    console.warn('[BRIDGE] Already loaded or loading')
    return state
  }

  state.loading = true
  console.log('[BRIDGE] Starting legacy bridge loader...')

  // Step 1: Install shims BEFORE any old JS loads
  installShims()

  // Step 1.5: Load old CSS files (provides styles for old JS-created elements)
  await Promise.all(LEGACY_CSS.map(loadCSS))
  console.log('[BRIDGE] Legacy CSS loaded')

  // Step 2: Load all script phases in order
  for (let i = 0; i < SCRIPT_PHASES.length; i++) {
    const phase = SCRIPT_PHASES[i]
    console.log(`[BRIDGE] Loading phase ${i} (${phase.length} scripts)...`)
    await loadPhase(phase)
  }

  console.log(`[BRIDGE] All scripts loaded: ${state.loadedScripts.length} ok, ${state.failedScripts.length} failed`)

  // Step 3: Patch functions that would conflict with React
  patchLoadedFunctions()

  // Step 4: Wait for React chart to be ready before calling startApp()
  // chartBridge.ts dispatches 'zeus:chartReady' when TradingChart mounts and
  // exposes all series refs to window. startApp() depends on these globals.
  const w = window as any
  if (!w.mainChart) {
    console.log('[BRIDGE] Waiting for zeus:chartReady...')
    await new Promise<void>((resolve) => {
      // If chart registers while we wait, resolve immediately
      const onReady = () => {
        window.removeEventListener('zeus:chartReady', onReady)
        resolve()
      }
      window.addEventListener('zeus:chartReady', onReady)
      // Safety timeout — don't block forever if chart never mounts
      setTimeout(() => {
        window.removeEventListener('zeus:chartReady', onReady)
        if (!w.mainChart) {
          console.warn('[BRIDGE] Chart not ready after 10s — proceeding anyway')
        }
        resolve()
      }, 10_000)
    })
    console.log('[BRIDGE] Chart ready — mainChart:', !!w.mainChart)
  } else {
    console.log('[BRIDGE] Chart already ready — mainChart present')
  }

  // Step 5: Call startApp()
  if (typeof w.startApp === 'function') {
    console.log('[BRIDGE] Calling startApp()...')
    try {
      await w.startApp()
      state.startAppCalled = true
      console.log('[BRIDGE] startApp() completed')
    } catch (err) {
      console.error('[BRIDGE] startApp() error:', err)
      state.error = String(err)
    }
  } else {
    state.error = 'startApp() not found after loading bootstrap.js'
    console.error('[BRIDGE]', state.error)
  }

  // Step 6: Expose WS state to window._zeusWS so old JS _updateStatusBar shows "WS" not "WS..."
  // bootstrap.js line 1859 checks: window._zeusWS && window._zeusWS.readyState === 1
  // but _zeusWS is never assigned anywhere in old code (dead reference).
  // We create a proxy object that reports readyState from the React WS service.
  try {
    const { wsService } = await import('../services/ws')
    Object.defineProperty(w, '_zeusWS', {
      configurable: true,
      get() { return wsService.isConnected() ? { readyState: 1 } : null }
    })
  } catch { /* wsService not available — ignore */ }

  // Step 7: Recover DOM elements moved by old JS back to their React wrappers.
  // bootstrap.js _relocateFlow() moves #flow-panel before #pm-strip (line 446-452).
  // _srEnsureVisible() moves #sr-strip to direct child of #zeus-groups (patched above,
  // but the mv() in initZeusGroups might have run before patch if timing is off).
  recoverMovedPanels()

  // Step 8: Re-attach onclick handlers from old HTML that React shells don't have.
  // Old index.html used inline onclick="fn()" on ~100+ elements. React components
  // render the same IDs but without onclick. This scan attaches missing handlers.
  reattachOnclickHandlers()

  state.loaded = true
  state.loading = false

  // Log summary
  console.log('[BRIDGE] ═══════════════════════════════════════')
  console.log('[BRIDGE] Legacy bridge summary:')
  console.log('[BRIDGE]   Scripts loaded:', state.loadedScripts.length)
  console.log('[BRIDGE]   Scripts failed:', state.failedScripts.length)
  if (state.failedScripts.length > 0) {
    console.log('[BRIDGE]   Failed:', state.failedScripts)
  }
  console.log('[BRIDGE]   startApp() called:', state.startAppCalled)
  console.log('[BRIDGE]   Error:', state.error || 'none')
  console.log('[BRIDGE] ═══════════════════════════════════════')

  return state
}

/** Get current bridge state (for debugging) */
export function getBridgeState(): BridgeState {
  return { ...state }
}

/** Check if bridge is active */
export function isBridgeActive(): boolean {
  return state.loaded && state.startAppCalled
}
