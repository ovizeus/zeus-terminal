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
  // Phase 0 — Head managers (MUST load first)
  [
    'js/core/managers.js',
  ],
  // Phase 1A — Utilities
  [
    'js/utils/helpers.js',
    'js/utils/formatters.js',
    'js/utils/math.js',
  ],
  // Phase 1B — Global state & config
  [
    'js/core/state.js',
    'js/core/config.js',
    'js/core/constants.js',
    'js/core/events.js',
  ],
  // Phase 1C — UI & Dev
  [
    'js/core/tabLeader.js',
    'js/utils/guards.js',
    'js/utils/dev.js',
    'js/ui/theme.js',
    'js/utils/decisionLog.js',
  ],
  // Phase 2 — Data layer
  [
    'js/data/storage.js',
    'js/data/symbols.js',
    'js/data/marketData.js',
    'js/data/klines.js',
  ],
  // Phase 3 — Brain engine
  [
    'js/brain/deepdive.js',
    'js/brain/signals.js',
    'js/brain/confluence.js',
    'js/brain/forecast.js',
    'js/brain/brain.js',
    'js/brain/regime.js',
    'js/brain/phaseFilter.js',
  ],
  // Phase 4 — Trading
  [
    'js/trading/dsl.js',
    'js/trading/risk.js',
    'js/trading/positions.js',
    'js/trading/orders.js',
    'js/trading/liveApi.js',
    'js/trading/autotrade.js',
  ],
  // Phase 5 — Analytics
  [
    'js/analytics/perfStore.js',
    'js/analytics/dailyPnl.js',
  ],
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

  // ── SHIM 1: initCharts() → no-op ──
  // React's TradingChart.tsx creates the LightweightCharts instance.
  // Old initCharts() would try to create a second one in #mc → conflict.
  // We expose a fake LightweightCharts so startApp() doesn't retry.
  if (typeof w.LightweightCharts === 'undefined') {
    w.LightweightCharts = { version: () => 'shim' }
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

  console.log('[BRIDGE] Functions patched')
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

  // Step 4: Call startApp()
  const w = window as any
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
