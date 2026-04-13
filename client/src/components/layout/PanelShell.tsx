import { useState, useEffect, useRef, type ReactNode } from 'react'
import { useUiStore } from '../../stores'
import { ChartControls } from '../chart/ChartControls'
import { TradingChart } from '../chart/TradingChart'
import { BrainCockpit } from '../brain/BrainCockpit'
import { ErrorBoundary } from '../ErrorBoundary'
import { StatusBar } from './StatusBar'
import WatchlistBar from './WatchlistBar'
import { ZeusDock } from './ZeusDock'
import { PageView } from './PageView'
import { ModeBar } from './ModeBar'
// ── Legacy panel init functions (1:1 from old openPageView in pageview.ts) ──
import { _aresRender } from '../../engine/aresUI'
import { PM_render } from '../../engine/postMortem'
import { renderPnlLab } from '../../ui/panels'
import { aubRefreshAll } from '../../engine/aub'
import { _actfeedRender, _renderDlog } from '../../core/bootstrapError'
import { _srRenderStats } from '../../core/config'
// ── Dock page panels (1:1 from old Zeus strips → page views) ──
import { AnalysisSections } from '../analysis/AnalysisSections'
import { AutoTradePanel } from '../dock/AutoTradePanel'
import { ManualTradePanel } from '../dock/ManualTradePanel'
import { DSLZonePanel } from '../dock/DSLZonePanel'
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
// ── Dialog Overlays ──
import { CommandPalette } from '../modals/CommandPalette'
import { ExposurePanel } from '../modals/ExposurePanel'
import { DecisionLogPanel } from '../modals/DecisionLogPanel'
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
  'activity': 'Activity',
  'aub': 'Alien',
}

export function PanelShell() {
  const [dockActive, setDockActive] = useState<string | null>(() => {
    try { return sessionStorage.getItem('zeusDock') || null } catch { return null }
  })
  const activeModal = useUiStore((s) => s.activeModal)
  const closeModal = useUiStore((s) => s.closeModal)
  const resolvedEnv = useUiStore((s) => s.resolvedEnv)

  function handleDockClick(id: string) {
    if (id === 'more') return
    const next = dockActive === id ? null : id
    setDockActive(next)
    try { if (next) sessionStorage.setItem('zeusDock', next); else sessionStorage.removeItem('zeusDock') } catch {}
  }

  function closePageView() {
    setDockActive(null)
    try { sessionStorage.removeItem('zeusDock') } catch {}
  }

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

    function onScroll() { lastScrollTime = Date.now() }
    window.addEventListener('scroll', onScroll, { passive: true })

    function getScrollTop(): number {
      return Math.max(window.scrollY || 0, document.documentElement.scrollTop || 0, document.body.scrollTop || 0)
    }

    function isInsideScrollable(target: EventTarget | null): boolean {
      let el = target as HTMLElement | null
      while (el && el !== document.body) {
        if (el.matches?.(BLOCK_SEL)) return true
        if (el.scrollHeight > el.clientHeight + 2) {
          const ov = getComputedStyle(el).overflowY
          if (ov === 'auto' || ov === 'scroll') return true
        }
        el = el.parentElement
      }
      return false
    }

    function slideContent(px: number, animate: boolean) {
      const el = mainRef.current
      if (!el) return
      el.style.transition = animate ? 'transform .3s cubic-bezier(.2,.8,.4,1)' : 'none'
      el.style.transform = px > 0 ? `translateY(${px}px)` : ''
    }

    function updateInd(progress: number, dy: number) {
      const ind = document.getElementById('ptr-indicator')
      if (!ind) return
      ind.classList.add('visible')
      ind.classList.toggle('armed', progress >= 1)
      ind.classList.remove('refreshing')
      const lbl = ind.querySelector('.ptr-label') as HTMLElement
      if (lbl) lbl.textContent = progress >= 1 ? 'Release to refresh' : 'Zeus Terminal'
      const sp = ind.querySelector('.ptr-spinner') as HTMLElement
      if (sp) sp.style.transform = `rotate(${dy * 2.5}deg)`
    }

    function resetAll(animate: boolean) {
      slideContent(0, animate)
      const ind = document.getElementById('ptr-indicator')
      if (ind) ind.classList.remove('visible', 'armed', 'refreshing')
      if (animate) setTimeout(() => { if (mainRef.current) mainRef.current.style.transition = '' }, 350)
      state = 'idle'
    }

    // ── TOUCH START: 5 guards, all must pass ──
    function onTouchStart(e: TouchEvent) {
      if (state === 'refreshing') return
      state = 'idle'
      if (e.touches.length !== 1) return                              // G1: single finger
      if (e.touches[0].clientY > START_ZONE) return                   // G2: top zone only
      if (getScrollTop() > 0) return                                  // G3: page at top
      if (Date.now() - lastScrollTime < SCROLL_COOLDOWN) return       // G4: no momentum
      if (isInsideScrollable(e.target)) return                        // G5: not in scrollable child
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
      if (Math.abs(dx) > Math.abs(dy) * HOR_RATIO) { resetAll(false); state = 'idle'; return } // diagonal
      if (dy < 0) { if (state !== 'tracking') resetAll(true); state = 'idle'; return }          // pulling up
      if (getScrollTop() > 0) { resetAll(false); state = 'idle'; return }                       // scrolled away
      e.preventDefault()
      const pull = Math.min(dy * DAMPING, MAX_PULL)
      const progress = Math.min(dy / THRESHOLD, 1)
      state = progress >= 1 ? 'armed' : 'pulling'
      slideContent(pull, false)
      updateInd(progress, dy)
    }

    // ── TOUCH END: validate speed/duration, fire or cancel ──
    function onTouchEnd() {
      if (state === 'armed') {
        const elapsed = Date.now() - startTime
        const speed = THRESHOLD / Math.max(elapsed, 1)
        if (elapsed < MIN_DURATION || speed > MAX_SPEED) { resetAll(true); return } // flick guard
        state = 'refreshing'
        const ind = document.getElementById('ptr-indicator')
        if (ind) {
          ind.classList.remove('armed'); ind.classList.add('refreshing')
          const lbl = ind.querySelector('.ptr-label') as HTMLElement
          if (lbl) lbl.textContent = 'Refreshing...'
          const sp = ind.querySelector('.ptr-spinner') as HTMLElement
          if (sp) sp.style.transform = ''
        }
        slideContent(MAX_PULL * 0.6, true)
        setTimeout(() => location.reload(), 400)
      } else if (state === 'pulling' || state === 'tracking') {
        resetAll(true)
      }
    }

    function onTouchCancel() { if (state !== 'idle' && state !== 'refreshing') resetAll(true) }

    document.addEventListener('touchstart', onTouchStart, { passive: true })
    document.addEventListener('touchmove', onTouchMove, { passive: false })
    document.addEventListener('touchend', onTouchEnd, { passive: true })
    document.addEventListener('touchcancel', onTouchCancel, { passive: true })
    return () => {
      window.removeEventListener('scroll', onScroll)
      document.removeEventListener('touchstart', onTouchStart)
      document.removeEventListener('touchmove', onTouchMove)
      document.removeEventListener('touchend', onTouchEnd)
      document.removeEventListener('touchcancel', onTouchCancel)
    }
  }, [])

  // 1:1 with old pageview.js — manual-trade title includes environment
  const activeTitle = dockActive
    ? (dockActive === 'manual-trade'
      ? `Manual Trade (${resolvedEnv || 'DEMO'})`
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
      <CommandPalette visible={activeModal === 'cmdpalette'} onClose={closeModal} />
      <ExposurePanel visible={activeModal === 'exposure'} onClose={closeModal} />
      <DecisionLogPanel visible={activeModal === 'decisionlog'} onClose={closeModal} />

      {/* Pull-to-refresh indicator (Bybit-style branded) */}
      <div id="ptr-indicator">
        <div className="ptr-spinner" />
        <span className="ptr-label">Pull to refresh</span>
      </div>

      <main className="zr-panels" ref={mainRef}>
        {/* ── Status Bar — first element in content area (1:1 from old app .page) ── */}
        <StatusBar />

        {/* ── Watchlist Bar (above ModeBar — 1:1 order from old app) ── */}
        <WatchlistBar />

        {/* ── Mode Bar — 1:1 from original zeus-mode-bar ── */}
        <ModeBar />

        {/* ── Chart section — 1:1 from original #csec .chart-section ── */}
        <section className="zr-panel zr-panel--chart chart-section" id="csec" data-panel="chart">
          <ErrorBoundary><ChartControls /></ErrorBoundary>
          <div id="mc" className="zr-panel__body zr-panel__body--chart">
            <ErrorBoundary><TradingChart /></ErrorBoundary>
          </div>
          <div className="cleg">
            <span className="li"><span className="ld" style={{ background: '#f0c040' }}></span>EMA50</span>
            <span className="li"><span className="ld" style={{ background: '#00b8d4' }}></span>EMA200</span>
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
