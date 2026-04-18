/**
 * Zeus Terminal — Boot Loader (formerly Legacy JS Bridge Loader)
 *
 * [9E-1] Slimmed: all old JS scripts fully ported to TS — zero <script> tags loaded.
 * Remaining responsibilities:
 *   1. Install phase1Adapters (window.* mappings for remaining consumers)
 *   2. Load legacy CSS (styles for engine-rendered DOM elements)
 *   3. Install compatibility shims (fetch CSRF, LightweightCharts placeholder)
 *   4. Wait for chart ready, call startApp()
 *   5. Expose _zeusWS proxy for status bar
 *   6. Reattach onclick handlers for buttons rendered by React shells
 */

import { installPhase1Adapters } from './phase1Adapters'
import { startApp } from '../core/bootstrapStartApp'
import { _toggleExposurePanel } from '../core/bootstrapPanels'
import { promptAddFunds, promptResetDemo, switchGlobalMode } from '../data/marketDataTrading'
import { closeM } from '../data/marketDataWS'
import { connectLiveAPI } from '../engine/indicators'
import { toggleAssistArm } from '../trading/dsl'
import { setBrainMode, setProfile, setDslMode } from '../engine/brain'
import { _initAudio } from '../ui/dom2'
import { aubToggleSFX, aubToggle } from '../engine/aub'
import { toggleAdaptive } from '../trading/risk'
import { srStripToggle } from '../core/config'

// ── Types ──────────────────────────────────────────────────────────
interface BridgeState {
  loaded: boolean
  loading: boolean
  error: string | null
  startAppCalled: boolean
}

const state: BridgeState = {
  loaded: false,
  loading: false,
  error: null,
  startAppCalled: false,
}

// ── Old CSS files to load ─────────────────────────────────────────
const LEGACY_CSS = [
  'css/main.css',
  'css/components.css',
  'css/journal.css',
]

// ── Helpers ────────────────────────────────────────────────────────

function loadCSS(href: string): Promise<void> {
  return new Promise((resolve) => {
    const url = '/' + href
    if (document.querySelector(`link[href="${url}"]`)) { resolve(); return }
    const link = document.createElement('link')
    link.rel = 'stylesheet'
    link.href = url
    link.onload = () => resolve()
    link.onerror = () => { console.warn(`[BOOT] Failed to load CSS: ${href}`); resolve() }
    document.head.appendChild(link)
  })
}

// ── Shims ──────────────────────────────────────────────────────────

function installShims(): void {
  const w = window as any

  // Phase 1 adapters: ported utilities exposed on window.*
  installPhase1Adapters()

  // LightweightCharts placeholder — chartBridge.ts will overwrite with real library
  if (typeof w.LightweightCharts === 'undefined') {
    w.LightweightCharts = { version: () => 'bridge-pending' }
  }

  // Fetch CSRF patch — adds X-Zeus-Request header to same-origin POST/PUT/DELETE/PATCH
  const _origFetch = w.fetch.bind(w)
  w.fetch = function bridgeFetch(input: RequestInfo | URL, init?: RequestInit) {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url
    const isSameOrigin = url.startsWith('/') || url.startsWith(location.origin)
    if (isSameOrigin && init && typeof init.method === 'string' &&
        ['POST', 'PUT', 'DELETE', 'PATCH'].includes(init.method.toUpperCase())) {
      const headers = new Headers(init.headers || {})
      if (!headers.has('X-Zeus-Request')) { headers.set('X-Zeus-Request', '1') }
      init = { ...init, headers }
    }
    return _origFetch(input, init)
  }

  console.log('[BOOT] Shims installed')
}

// ── Onclick re-attacher ──────────────────────────────────────────────

function reattachOnclickHandlers(): void {
  const w = window as any // kept for w.teacherStart, w.teacherStop, w.novaCopyLog (IIFE-registered, not exported)

  const ONCLICK_MAP: Record<string, () => void> = {
    'btnAddFunds': () => promptAddFunds(),
    'btnResetDemo': () => promptResetDemo(),
    'btnDemo': () => switchGlobalMode('demo'),
    'btnLive': () => switchGlobalMode('live'),
    'btnConnectExchange': () => connectLiveAPI(),
    'dslAssistArmBtn': () => toggleAssistArm(),
    'bmode-assist': () => setBrainMode('assist'),
    'bmode-auto': () => setBrainMode('auto'),
    'prof-fast': () => setProfile('fast'),
    'prof-swing': () => setProfile('swing'),
    'prof-defensive': () => setProfile('defensive'),
    'dsl-atr': () => setDslMode('atr'),
    'dsl-fast': () => setDslMode('fast'),
    'dsl-swing': () => setDslMode('swing'),
    'dsl-defensive': () => setDslMode('defensive'),
    'dsl-tp': () => setDslMode('tp'),
    'soundBadge': () => _initAudio(),
    'aub-sfx-btn': () => { event?.stopPropagation(); aubToggleSFX() },
    'aub-toggle-btn': () => { event?.stopPropagation(); aubToggle() },
    'teacher-v2-teach-btn': () => w.teacherStart?.(),  // IIFE-registered in teacherAutopilot
    'teacher-v2-stop-btn': () => w.teacherStop?.(),    // IIFE-registered in teacherAutopilot
    'nova-copy-btn': () => w.novaCopyLog?.(),          // IIFE-registered in arianova
    'adaptiveToggleBtn': () => toggleAdaptive(),
    'sr-strip-bar': () => srStripToggle(),
    'wlcEnterBtn': () => closeM('mwelcome'),
    'zsbPos': () => _toggleExposurePanel(),
  }

  let attached = 0
  for (const [id, handler] of Object.entries(ONCLICK_MAP)) {
    const el = document.getElementById(id)
    if (!el) continue
    el.addEventListener('click', () => {
      try { handler() } catch (err) { console.warn(`[BOOT] onclick ${id} error:`, err) }
    })
    attached++
  }
  console.log(`[BOOT] Onclick handlers attached: ${attached}`)
}

// ── Main API ───────────────────────────────────────────────────────

export async function startLegacyBridge(): Promise<BridgeState> {
  if (state.loaded || state.loading) {
    console.warn('[BOOT] Already loaded or loading')
    return state
  }

  state.loading = true
  console.log('[BOOT] Starting app boot sequence...')

  // Step 1: Install shims + phase1Adapters
  installShims()

  // Step 2: Load legacy CSS
  await Promise.all(LEGACY_CSS.map(loadCSS))
  console.log('[BOOT] Legacy CSS loaded')

  // Step 3: Wait for chart ready (startApp depends on mainChart)
  const w = window as any
  if (!w.mainChart) {
    console.log('[BOOT] Waiting for zeus:chartReady...')
    await new Promise<void>((resolve) => {
      const onReady = () => { window.removeEventListener('zeus:chartReady', onReady); resolve() }
      window.addEventListener('zeus:chartReady', onReady)
      setTimeout(() => {
        window.removeEventListener('zeus:chartReady', onReady)
        if (!w.mainChart) console.warn('[BOOT] Chart not ready after 10s — proceeding anyway')
        resolve()
      }, 10_000)
    })
    console.log('[BOOT] Chart ready — mainChart:', !!w.mainChart)
  } else {
    console.log('[BOOT] Chart already ready')
  }

  // Step 4: Call startApp() — direct import from core/bootstrapStartApp
  console.log('[BOOT] Calling startApp()...')
  try {
    await startApp()
    state.startAppCalled = true
    console.log('[BOOT] startApp() completed')
  } catch (err) {
    console.error('[BOOT] startApp() error:', err)
    state.error = String(err)
  }

  // Step 5: _zeusWS proxy for status bar
  try {
    const { wsService } = await import('../services/ws')
    Object.defineProperty(w, '_zeusWS', {
      configurable: true,
      get() { return wsService.isConnected() ? { readyState: 1 } : null }
    })
  } catch { /* wsService not available */ }

  // Step 6: Reattach onclick handlers
  reattachOnclickHandlers()

  state.loaded = true
  state.loading = false

  console.log(`[BOOT] Boot complete — startApp: ${state.startAppCalled}, error: ${state.error || 'none'}`)
  return state
}

export function getBridgeState(): BridgeState { return { ...state } }
export function isBridgeActive(): boolean { return state.loaded && state.startAppCalled }
