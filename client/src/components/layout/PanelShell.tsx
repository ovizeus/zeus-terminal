import { useState, useEffect, useRef } from 'react'
import { useUiStore } from '../../stores'
import { ChartControls } from '../chart/ChartControls'
import { TradingChart } from '../chart/TradingChart'
import { BrainCockpit } from '../brain/BrainCockpit'
import { ErrorBoundary } from '../ErrorBoundary'
import { KillSwitchOverlay } from '../KillSwitchOverlay'
import { StatusBar } from './StatusBar'
import WatchlistBar from './WatchlistBar'
import { ZeusDock } from './ZeusDock'
import { PageView } from './PageView'
import { _zComingSoon } from '../../ui/dock'
import { ModeBar } from './ModeBar'
import { MarketRadar } from '../radar/MarketRadar'
// ── Legacy panel init functions (1:1 from old openPageView in pageview.ts) ──
import { _aresRender } from '../../engine/aresUI'
import { PM_render } from '../../engine/postMortem'
import { renderPnlLab } from '../../ui/panels'
import { aubRefreshAll } from '../../engine/aub'
import { _actfeedRender, _renderDlog } from '../../core/bootstrapError'
import { _cmdSetOpen, _cmdRender, _fetchExposure } from '../../core/bootstrapPanels'
import { _srRenderStats } from '../../core/config'
// ── Dock page panels (1:1 from old Zeus strips → page views) ──
import { AnalysisSections } from '../analysis/AnalysisSections'
import { AutoTradePanel } from '../dock/AutoTradePanel'
import { ManualTradePanel } from '../dock/ManualTradePanel'
import { DSLZonePanel } from '../dock/DSLZonePanel'
import { OmegaPage } from '../omega/OmegaPage'
import { MultiExchangePage } from '../multiexchange/MultiExchangePage'
import { ARESPanel } from '../dock/ARESPanel'
import { PostMortemPanel } from '../dock/PostMortemPanel'
import { PnlLabPanel } from '../dock/PnlLabPanel'
import { ARIAPanel } from '../dock/ARIAPanel'
import { NovaPanel } from '../dock/NovaPanel'
import { AdaptivePanel } from '../dock/AdaptivePanel'
import { FlowPanel } from '../dock/FlowPanel'
import { QuantMonitorPanel } from '../dock/QuantMonitorPanel'
import { MTFPanel } from '../dock/MTFPanel'
import { TeacherDockPanel } from '../dock/TeacherDockPanel'
import { SignalRegistryPanel } from '../dock/SignalRegistryPanel'
import { LiquidationsPanel } from '../dock/LiquidationsPanel'
import { ActivityFeedPanel } from '../dock/ActivityFeedPanel'
import { AUBPanel } from '../dock/AUBPanel'
// ── Modals & Overlays (1:1 from old Zeus .mover modals) ──
import { NotificationsModal } from '../modals/NotificationsModal'
import { CloudSyncModal } from '../modals/CloudSyncModal'
import { AlertsModal } from '../modals/AlertsModal'
import { ChartSettingsModal } from '../modals/ChartSettingsModal'
import { LiqSettingsModal } from '../modals/LiqSettingsModal'
import { LLVSettingsModal } from '../modals/LLVSettingsModal'
import { SupremusModal } from '../modals/SupremusModal'
import { SRSettingsModal } from '../modals/SRSettingsModal'
import { SettingsHubModal } from '../modals/SettingsHubModal'
import { OVIPanel } from '../modals/OVIPanel'
import { WelcomeModal } from '../modals/WelcomeModal'
import { AdminModal } from '../modals/AdminModal'
import { AdminPage } from '../admin/AdminPage'
// ── Dialog Overlays ──
import { CommandPalette } from '../modals/CommandPalette'
import { ExposurePanel } from '../modals/ExposurePanel'
import { DecisionLogPanel } from '../modals/DecisionLogPanel'
import { MissedTradesPanel } from '../modals/MissedTradesPanel'
import { SessionReviewPanel } from '../modals/SessionReviewPanel'
import { RegimeHistoryPanel } from '../modals/RegimeHistoryPanel'
import { PerformancePanel } from '../modals/PerformancePanel'
import { ComparePanel } from '../modals/ComparePanel'
import { Footer } from './Footer'

/*
 * HOME PAGE LAYOUT — 1:1 with old Zeus (bootstrap.js initZeusGroups + CSS)
 *
 * Visible on home:
 *   ModeBar → WatchlistBar → Chart → Dock → Brain → AnalysisSections
 *
 * ALL strips are hidden on home (display:none !important in old CSS).
 * Every strip is accessed ONLY via dock icon → PageView overlay.
 *
 * BRIDGE: All panels always mounted in #zeus-groups so old JS can find
 * them via getElementById at any time. Active panel shown via PageView.
 */

/** Map dock id → page view title (1:1 from old dock.js + pageview.js) */
const DOCK_TITLES: Record<string, string> = {
  'autotrade': 'AutoTrade',
  'manual-trade': 'Manual Trade',
  'dsl': 'DSL',
  'omega': 'OMEGA',
  'multi-exchange': 'MultiExchange',
  'ares': 'ARES',
  'postmortem': 'Post-Mortem',
  'pnllab': 'PnL Lab',
  'aria': 'ARIA',
  'nova': 'Nova',
  'adaptive': 'Adaptive',
  'flow': 'Flow',
  'quantmonitor': 'Quantitative Monitor',
  'mtf': 'MTF',
  'teacher': 'Teacher',
  'sigreg': 'Signals',
  'liquidations': 'Liquidations',
  'activity': 'Activity',
  'aub': 'Alien',
}

export function PanelShell() {
  const [dockActive, setDockActive] = useState<string | null>(() => {
    try { return sessionStorage.getItem('zeusDock') || null } catch { return null }
  })
  const activeModal = useUiStore((s) => s.activeModal)
  const closeModal = useUiStore((s) => s.closeModal)
  // Phase 2C: canonical executionEnv. null → LOCKED label in dock title.
  const executionEnv = useUiStore((s) => s.executionEnv)

  const openModal = useUiStore((s) => s.openModal)

  // Lock body scroll when a dock panel is open — prevents background scroll
  // behind the fixed overlay (.zpv). Without this, touch events on the panel
  // can propagate to body, displacing main page scroll position. On close,
  // the page appears "half black" because it scrolled past content.
  useEffect(() => {
    if (dockActive) {
      const prev = document.body.style.overflow
      document.body.style.overflow = 'hidden'
      return () => { document.body.style.overflow = prev }
    }
  }, [dockActive])

  // ── Listen for legacy JS requesting modal open/close ──
  useEffect(() => {
    const handleClose = () => closeModal()
    const handleOpen = (e: Event) => { const id = (e as CustomEvent).detail; if (id) openModal(id) }
    document.addEventListener('zeus:closeModal', handleClose)
    document.addEventListener('zeus:openModal', handleOpen)
    return () => {
      document.removeEventListener('zeus:closeModal', handleClose)
      document.removeEventListener('zeus:openModal', handleOpen)
    }
  }, [closeModal, openModal])

  function handleDockClick(id: string) {
    // [UI-POLISH-1 REACT-FIX 2026-05-14] More icon → Z-glyph Coming Soon
    // overlay. Pre-fix: silent `return` skipped both dock activation AND
    // overlay. Now triggers shared `_zComingSoon` from dock.ts (same
    // implementation as legacy initZeusDock branch).
    if (id === 'more') {
      _zComingSoon()
      return
    }
    const next = dockActive === id ? null : id
    setDockActive(next)
    try { if (next) sessionStorage.setItem('zeusDock', next); else sessionStorage.removeItem('zeusDock') } catch {}
  }

  function closePageView() {
    // [Ring5/Doctor sub-view 2026-05-17] allow active panel to intercept
    // the back action and handle internal navigation (e.g. OmegaPage
    // returning from a dedicated sub-view to its main view) by listening
    // for this cancelable event and calling preventDefault.
    const ev = new CustomEvent('zeus:page-back', { cancelable: true })
    window.dispatchEvent(ev)
    if (ev.defaultPrevented) return

    setDockActive(null)
    try { sessionStorage.removeItem('zeusDock') } catch {}
    window.scrollTo(0, 0)
  }

  // [MultiExchange 2026-05-20] Allow external triggers (e.g. SettingsHubModal
  // redirect button) to programmatically open a dock panel by id.
  useEffect(() => {
    function onDockActivate(e: Event) {
      const ce = e as CustomEvent<{ id: string }>
      const id = ce.detail?.id
      if (!id) return
      setDockActive(id)
      try { sessionStorage.setItem('zeusDock', id) } catch {}
    }
    window.addEventListener('zeus:dock-activate', onDockActivate)
    return () => window.removeEventListener('zeus:dock-activate', onDockActivate)
  }, [])

  // ── Call legacy panel init functions when a dock panel opens ──
  // 1:1 from openPageView() in pageview.ts — each panel has specific
  // render/refresh functions that must run to populate content.
  useEffect(() => {
    if (!dockActive) return
    const w = window as any
    const timer = setTimeout(() => {
      try {
        switch (dockActive) {
          case 'ares': _aresRender(); break
          case 'postmortem': PM_render(); break
          case 'pnllab': renderPnlLab(); break
          case 'aub': aubRefreshAll(); break
          case 'activity': _actfeedRender(); break
          case 'sigreg':
            if (typeof w._srRenderList === 'function') w._srRenderList()
            _srRenderStats()
            break
          case 'teacher':
            if (typeof w.initTeacher === 'function') w.initTeacher()
            break
          case 'mtf':
            if (typeof w.renderMTFPanel === 'function') w.renderMTFPanel()
            break
        }
      } catch (e) { console.warn('[ZEUS] Panel init error:', dockActive, e) }
    }, 50) // short delay so CSS class toggle applies first
    return () => clearTimeout(timer)
  }, [dockActive])

  // ── Call legacy render functions when modals open ──
  useEffect(() => {
    if (activeModal === 'decisionlog') {
      setTimeout(() => { try { _renderDlog() } catch (e) { console.warn('[ZEUS] Dlog render error:', e) } }, 50)
    }
    if (activeModal === 'exposure') {
      setTimeout(() => { try { _fetchExposure() } catch (e) { console.warn('[ZEUS] Exposure render error:', e) } }, 50)
    }
    if (activeModal === 'cmdpalette') {
      _cmdSetOpen(true)
      setTimeout(() => {
        const input = document.getElementById('cmdInput') as HTMLInputElement | null
        if (input) { input.value = ''; input.focus() }
        _cmdRender('')
      }, 50)
    } else {
      _cmdSetOpen(false)
    }
  }, [activeModal])

  // ── Pull-to-refresh — content slides down, header stays fixed ──
  // Transform ONLY on <main> (content). Header NEVER moves.
  // PTR slot sits between fixed header and content, revealed by content sliding.
  const mainRef = useRef<HTMLElement>(null)

  useEffect(() => {
    // ── CONFIG (1:1 from old app PTR in legacy/index.html lines 64-80) ──
    const THRESHOLD = 80        // px pull to arm
    const START_ZONE = 120      // touch must start within top 120px of viewport
    const DEAD_ZONE = 12        // ignore micro-moves
    const MIN_DURATION = 220    // ms — gesture must last this long (blocks flicks)
    const MAX_SPEED = 3.8       // px/ms — reject if average speed exceeds this
    const HOR_RATIO = 0.9       // diagonal detection: |dx| > |dy|*ratio → cancel
    const MAX_PULL = 80
    const DAMPING = 0.4
    const SCROLL_COOLDOWN = 500 // ms after last scroll event before PTR eligible

    // Scrollable children — don't hijack touch inside these
    const BLOCK_SEL = 'input,textarea,select,button,[contenteditable],.chart-section,#mc,.modal,.mover,.at-log,.journal-wrap,.ob-live,.znc-log'

    let state: 'idle' | 'tracking' | 'pulling' | 'armed' | 'refreshing' = 'idle'
    let startY = 0, startX = 0, startTime = 0
    let lastScrollTime = 0

    // [Phase 10.3 PTR-in-panel] When a dock panel is open, the PageView overlay
    // (.zpv, z-index 900, position: fixed) covers <main>, and .zpv-content owns
    // the scroll + the viewport. The legacy PTR flow (window scrollY + transform
    // <main>) was silently blocked by G5 isInsideScrollable() seeing .zpv-content
    // as "a scrollable child" and by the overlay hiding the animation target.
    // Fix: detect the active scroller at each touch; treat .zpv-content exactly
    // like window (scroll source + slide target) and stop isInsideScrollable
    // walk at that boundary so only TRULY inner scrollables still block.
    function getActiveScroller(): HTMLElement | null {
      const zpv = document.querySelector('.zpv')
      if (zpv) return zpv.querySelector('.zpv-content') as HTMLElement | null
      return null
    }

    let currentScroller: HTMLElement | null = null

    function onScroll() { lastScrollTime = Date.now() }
    window.addEventListener('scroll', onScroll, { passive: true })
    // [Phase 10.3] Also capture scrolls inside panel overlay so momentum guard works.
    document.addEventListener('scroll', onScroll, { passive: true, capture: true })

    function getScrollTop(scroller: HTMLElement | null): number {
      if (scroller) return scroller.scrollTop || 0
      return Math.max(window.scrollY || 0, document.documentElement.scrollTop || 0, document.body.scrollTop || 0)
    }

    function isInsideScrollable(target: EventTarget | null, stopAt: HTMLElement | null): boolean {
      let el = target as HTMLElement | null
      while (el && el !== document.body) {
        // [Phase 10.3] The active scroller itself is the viewport for PTR —
        // not a "scrollable child". Stop the walk here, don't treat as block.
        if (stopAt && el === stopAt) return false
        if (el.matches?.(BLOCK_SEL)) return true
        if (el.scrollHeight > el.clientHeight + 2) {
          const ov = getComputedStyle(el).overflowY
          if (ov === 'auto' || ov === 'scroll') return true
        }
        el = el.parentElement
      }
      return false
    }

    function slideContent(px: number, animate: boolean, scroller: HTMLElement | null) {
      // [Phase 10.3] When panel overlay is active, translate the overlay's scroll
      // container (it IS the visible viewport). Otherwise translate <main>.
      const el = scroller || mainRef.current
      if (!el) return
      el.style.transition = animate ? 'transform .3s cubic-bezier(.2,.8,.4,1)' : 'none'
      el.style.transform = px > 0 ? `translateY(${px}px)` : ''
    }

    function updateInd(progress: number, _dy: number) {
      const ind = document.getElementById('ptr-indicator')
      if (!ind) return
      ind.classList.add('visible')
      ind.classList.toggle('armed', progress >= 1)
      ind.classList.remove('refreshing')
      // [Phase 10.5] Label text is static stacked markup in JSX ("ZEUS" over
      // "REFRESHING") — no textContent mutation here, which would flatten the
      // two-line structure back into one line.
    }

    function resetAll(animate: boolean, scroller: HTMLElement | null) {
      slideContent(0, animate, scroller)
      const ind = document.getElementById('ptr-indicator')
      if (ind) ind.classList.remove('visible', 'armed', 'refreshing')
      if (animate) {
        const el = scroller || mainRef.current
        if (el) setTimeout(() => { el.style.transition = '' }, 350)
      }
      state = 'idle'
    }

    // ── TOUCH START: 5 guards, all must pass ──
    function onTouchStart(e: TouchEvent) {
      if (state === 'refreshing') return
      state = 'idle'
      // [Phase 10.3] Re-detect scroller per-gesture; panel open/close can change it.
      currentScroller = getActiveScroller()
      if (e.touches.length !== 1) return                              // G1: single finger
      if (e.touches[0].clientY > START_ZONE) return                   // G2: top zone only
      if (getScrollTop(currentScroller) > 0) return                   // G3: scroller at top
      if (Date.now() - lastScrollTime < SCROLL_COOLDOWN) return       // G4: no momentum
      if (isInsideScrollable(e.target, currentScroller)) return       // G5: not in inner scrollable
      state = 'tracking'
      startY = e.touches[0].clientY
      startX = e.touches[0].clientX
      startTime = Date.now()
    }

    // ── TOUCH MOVE: validate direction, update visual ──
    function onTouchMove(e: TouchEvent) {
      if (state !== 'tracking' && state !== 'pulling' && state !== 'armed') return
      const dy = e.touches[0].clientY - startY
      const dx = e.touches[0].clientX - startX
      if (Math.abs(dy) < DEAD_ZONE && state === 'tracking') return    // dead zone
      if (Math.abs(dx) > Math.abs(dy) * HOR_RATIO) { resetAll(false, currentScroller); state = 'idle'; return } // diagonal
      if (dy < 0) { if (state !== 'tracking') resetAll(true, currentScroller); state = 'idle'; return }          // pulling up
      if (getScrollTop(currentScroller) > 0) { resetAll(false, currentScroller); state = 'idle'; return }        // scrolled away
      e.preventDefault()
      const pull = Math.min(dy * DAMPING, MAX_PULL)
      const progress = Math.min(dy / THRESHOLD, 1)
      state = progress >= 1 ? 'armed' : 'pulling'
      slideContent(pull, false, currentScroller)
      updateInd(progress, dy)
    }

    // ── TOUCH END: validate speed/duration, fire or cancel ──
    function onTouchEnd() {
      if (state === 'armed') {
        const elapsed = Date.now() - startTime
        const speed = THRESHOLD / Math.max(elapsed, 1)
        if (elapsed < MIN_DURATION || speed > MAX_SPEED) { resetAll(true, currentScroller); return } // flick guard
        state = 'refreshing'
        const ind = document.getElementById('ptr-indicator')
        if (ind) {
          ind.classList.remove('armed'); ind.classList.add('refreshing')
          // [Phase 10.5] Label is static stacked markup; pulse comes from CSS
          // keyframe on .refreshing. No textContent mutation here.
        }
        slideContent(MAX_PULL * 0.6, true, currentScroller)
        setTimeout(() => location.reload(), 400)
      } else if (state === 'pulling' || state === 'tracking') {
        resetAll(true, currentScroller)
      }
    }

    function onTouchCancel() { if (state !== 'idle' && state !== 'refreshing') resetAll(true, currentScroller) }

    document.addEventListener('touchstart', onTouchStart, { passive: true })
    document.addEventListener('touchmove', onTouchMove, { passive: false })
    document.addEventListener('touchend', onTouchEnd, { passive: true })
    document.addEventListener('touchcancel', onTouchCancel, { passive: true })
    return () => {
      window.removeEventListener('scroll', onScroll)
      document.removeEventListener('scroll', onScroll, true)
      document.removeEventListener('touchstart', onTouchStart)
      document.removeEventListener('touchmove', onTouchMove)
      document.removeEventListener('touchend', onTouchEnd)
      document.removeEventListener('touchcancel', onTouchCancel)
    }
  }, [])

  // 1:1 with old pageview.js — manual-trade title includes environment
  const activeTitle = dockActive
    ? (dockActive === 'manual-trade'
      ? `Manual Trade (${executionEnv === null ? 'LOCKED' : (executionEnv || 'DEMO')})`
      : DOCK_TITLES[dockActive])
    : null

  return (
    <>
      {/* ── Full-screen page view overlay header ── */}
      {dockActive && activeTitle && (
        <PageView title={activeTitle} onClose={closePageView}>
          {/* Content rendered via #zeus-groups below, made visible via CSS */}
        </PageView>
      )}

      {/* ── Modal Overlays (global, outside main flow) ── */}
      <KillSwitchOverlay />
      <NotificationsModal visible={activeModal === 'notifications'} onClose={closeModal} />
      <CloudSyncModal visible={activeModal === 'cloud'} onClose={closeModal} />
      <AlertsModal visible={activeModal === 'alerts'} onClose={closeModal} />
      <ChartSettingsModal visible={activeModal === 'charts'} onClose={closeModal} />
      <LiqSettingsModal visible={activeModal === 'liq'} onClose={closeModal} />
      <LLVSettingsModal visible={activeModal === 'llv'} onClose={closeModal} />
      <SupremusModal visible={activeModal === 'supremus'} onClose={closeModal} />
      <SRSettingsModal visible={activeModal === 'sr'} onClose={closeModal} />
      <SettingsHubModal visible={activeModal === 'settings'} onClose={closeModal} />
      <OVIPanel visible={activeModal === 'ovi'} onClose={closeModal} />
      <WelcomeModal visible={activeModal === 'welcome'} onClose={closeModal} />
      <AdminModal visible={activeModal === 'admin'} onClose={closeModal} />
      <AdminPage visible={activeModal === 'adminPage'} onClose={closeModal} />
      <CommandPalette visible={activeModal === 'cmdpalette'} onClose={closeModal} />
      <ExposurePanel visible={activeModal === 'exposure'} onClose={closeModal} />
      <DecisionLogPanel visible={activeModal === 'decisionlog'} onClose={closeModal} />
      <MissedTradesPanel visible={activeModal === 'missed'} onClose={closeModal} />
      <SessionReviewPanel visible={activeModal === 'session'} onClose={closeModal} />
      <RegimeHistoryPanel visible={activeModal === 'regime'} onClose={closeModal} />
      <PerformancePanel visible={activeModal === 'performance'} onClose={closeModal} />
      <ComparePanel visible={activeModal === 'compare'} onClose={closeModal} />

      {/* Pull-to-refresh indicator — two stacked lines, both centered.
          "ZEUS" above, "REFRESHING" below, same X-axis center, green. */}
      <div id="ptr-indicator">
        <div className="ptr-label">
          <span className="ptr-line ptr-line-top">ZEUS</span>
          <span className="ptr-line ptr-line-bot">REFRESHING</span>
        </div>
      </div>

      <main className="zr-panels" ref={mainRef}>
        {/* ── Status Bar — first element in content area (1:1 from old app .page) ── */}
        <StatusBar />

        {/* ── Watchlist Bar ── */}
        <WatchlistBar />

        {/* ── Market Radar (Phase 11.5) — dual marquee, fed by useMarketRadarStore. ── */}
        <ErrorBoundary><MarketRadar /></ErrorBoundary>

        {/* ── Chart section — 1:1 from original #csec .chart-section ── */}
        <section className="zr-panel zr-panel--chart chart-section" id="csec" data-panel="chart">
          <ErrorBoundary><ChartControls /></ErrorBoundary>
          <div id="mc" className="zr-panel__body zr-panel__body--chart">
            <ErrorBoundary><TradingChart /></ErrorBoundary>
          </div>
          <div className="cleg">
            <span className="li"><span className="ld" style={{ background: '#f0c040' }}></span>EMA P1</span>
            <span className="li"><span className="ld" style={{ background: '#00b8d4' }}></span>EMA P2</span>
            <span className="li"><span className="ld" style={{ background: '#00ff88' }}></span>EMA P3</span>
            <span className="li"><span className="ld" style={{ background: '#ff66cc' }}></span>EMA P4</span>
            <span className="li"><span className="ld" style={{ background: '#aa44ff' }}></span>WMA20</span>
            <span className="li"><span className="ld" style={{ background: '#ff8800' }}></span>ST</span>
            <span className="li" id="liqleg" style={{ display: 'none' }}><span className="ld" style={{ background: '#ff335599' }}></span>LIQ</span>
            <span className="li" id="zsleg" style={{ display: 'none' }}><span className="ld" style={{ background: '#f0c040' }}></span>VWAP</span>
            <span className="li" id="srleg" style={{ display: 'none' }}><span className="ld" style={{ background: '#00d97a' }}></span>S/R</span>
          </div>
          {/* ── Sub-indicator charts (hidden by default, shown when toggled) ── */}
          <div id="cc" style={{ display: 'none', width: '100%', height: '60px', background: '#0a0f16', borderTop: '1px solid var(--brd)' }}></div>
          <div id="macdChart" style={{ display: 'none', width: '100%', height: '60px', background: '#0a0f16', borderTop: '1px solid var(--brd)' }}></div>
          <div id="rsiChart" style={{ display: 'none', width: '100%', height: '60px', background: '#0a0f16', borderTop: '1px solid var(--brd)' }}></div>
          <div id="stochChart" style={{ display: 'none', width: '100%', height: '60px', background: '#0a0f16', borderTop: '1px solid var(--brd)' }}></div>
          <div id="atrChart" style={{ display: 'none', width: '100%', height: '60px', background: '#0a0f16', borderTop: '1px solid var(--brd)' }}></div>
          <div id="obvChart" style={{ display: 'none', width: '100%', height: '60px', background: '#0a0f16', borderTop: '1px solid var(--brd)' }}></div>
          <div id="mfiChart" style={{ display: 'none', width: '100%', height: '60px', background: '#0a0f16', borderTop: '1px solid var(--brd)' }}></div>
          <div id="cciChart" style={{ display: 'none', width: '100%', height: '60px', background: '#0a0f16', borderTop: '1px solid var(--brd)' }}></div>
          {/* ── Time & Sales tape ── */}
          <div id="ts-wrap" style={{ display: 'none' }}></div>
        </section>

        {/* ── Mode Bar — relocated below chart legend (Phase 11.1). Same component, same logic, same style. ── */}
        <ModeBar />

        {/* ── Icon Dock — 1:1 from original zeus-dock ── */}
        <ZeusDock active={dockActive} onDockClick={handleDockClick} />

        {/*
         * ══ BRIDGE: #zeus-groups — ALL panels always in DOM ══
         * Old JS uses getElementById() to find and populate these elements.
         * They must exist at all times, not just when PageView is open.
         * Each panel wrapper is hidden by default; the active dock panel
         * is shown via zpv-active-panel CSS class inside the PageView overlay.
         */}
        <div id="zeus-groups" className={dockActive ? 'zpv-open' : ''}>
          <div id="at-strip-panel" data-panel-id="autotrade" className={dockActive === 'autotrade' ? 'zpv-active-panel' : 'zpv-hidden-panel'}>
            <AutoTradePanel />
          </div>
          <div id="pt-strip-panel" data-panel-id="manual-trade" className={dockActive === 'manual-trade' ? 'zpv-active-panel' : 'zpv-hidden-panel'}>
            <ManualTradePanel />
          </div>
          <div id="dsl-strip-panel" data-panel-id="dsl" className={dockActive === 'dsl' ? 'zpv-active-panel' : 'zpv-hidden-panel'}>
            <DSLZonePanel />
          </div>
          <div data-panel-id="omega" className={dockActive === 'omega' ? 'zpv-active-panel' : 'zpv-hidden-panel'}>
            <OmegaPage />
          </div>
          <div data-panel-id="multi-exchange" className={dockActive === 'multi-exchange' ? 'zpv-active-panel' : 'zpv-hidden-panel'}>
            <MultiExchangePage />
          </div>
          <div data-panel-id="ares" className={dockActive === 'ares' ? 'zpv-active-panel' : 'zpv-hidden-panel'}>
            <ARESPanel />
          </div>
          <div data-panel-id="postmortem" className={dockActive === 'postmortem' ? 'zpv-active-panel' : 'zpv-hidden-panel'}>
            <PostMortemPanel />
          </div>
          <div data-panel-id="pnllab" className={dockActive === 'pnllab' ? 'zpv-active-panel' : 'zpv-hidden-panel'}>
            <PnlLabPanel />
          </div>
          <div data-panel-id="aria" className={dockActive === 'aria' ? 'zpv-active-panel' : 'zpv-hidden-panel'}>
            <ARIAPanel />
          </div>
          <div data-panel-id="nova" className={dockActive === 'nova' ? 'zpv-active-panel' : 'zpv-hidden-panel'}>
            <NovaPanel />
          </div>
          <div data-panel-id="adaptive" className={dockActive === 'adaptive' ? 'zpv-active-panel' : 'zpv-hidden-panel'}>
            <AdaptivePanel />
          </div>
          <div data-panel-id="flow" className={dockActive === 'flow' ? 'zpv-active-panel' : 'zpv-hidden-panel'}>
            <FlowPanel />
          </div>
          <div data-panel-id="quantmonitor" className={dockActive === 'quantmonitor' ? 'zpv-active-panel' : 'zpv-hidden-panel'}>
            <QuantMonitorPanel />
          </div>
          <div data-panel-id="mtf" className={dockActive === 'mtf' ? 'zpv-active-panel' : 'zpv-hidden-panel'}>
            <MTFPanel />
          </div>
          <div data-panel-id="teacher" className={dockActive === 'teacher' ? 'zpv-active-panel' : 'zpv-hidden-panel'}>
            <TeacherDockPanel />
          </div>
          <div data-panel-id="sigreg" className={dockActive === 'sigreg' ? 'zpv-active-panel' : 'zpv-hidden-panel'}>
            <SignalRegistryPanel />
          </div>
          <div data-panel-id="liquidations" className={dockActive === 'liquidations' ? 'zpv-active-panel' : 'zpv-hidden-panel'}>
            <LiquidationsPanel />
          </div>
          <div data-panel-id="activity" className={dockActive === 'activity' ? 'zpv-active-panel' : 'zpv-hidden-panel'}>
            <ActivityFeedPanel />
          </div>
          <div data-panel-id="aub" className={dockActive === 'aub' ? 'zpv-active-panel' : 'zpv-hidden-panel'}>
            <AUBPanel />
          </div>
        </div>

        {/* ── Brain — direct on home, no strip wrapper (1:1 with original) ── */}
        <ErrorBoundary><BrainCockpit /></ErrorBoundary>

        {/* ── Future: Brain Extension (#brainExt) goes here ── */}

        {/* ── Analysis sections — scroll zone below Brain (1:1 from old Zeus) ── */}
        <ErrorBoundary><AnalysisSections /></ErrorBoundary>

        {/* ── Footer — bottom nav bar (1:1 from original .bot) ── */}
        <Footer />
      </main>
    </>
  )
}
