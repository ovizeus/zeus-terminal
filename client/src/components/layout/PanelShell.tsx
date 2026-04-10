import { useState, useEffect, useRef, type ReactNode } from 'react'
import { useUiStore } from '../../stores'
import { ChartControls } from '../chart/ChartControls'
import { TradingChart } from '../chart/TradingChart'
import { BrainCockpit } from '../brain/BrainCockpit'
import { ErrorBoundary } from '../ErrorBoundary'
import WatchlistBar from './WatchlistBar'
import { ZeusDock } from './ZeusDock'
import { PageView } from './PageView'
import { ModeBar } from './ModeBar'
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
  const [dockActive, setDockActive] = useState<string | null>(null)
  const activeModal = useUiStore((s) => s.activeModal)
  const closeModal = useUiStore((s) => s.closeModal)
  const resolvedEnv = useUiStore((s) => s.resolvedEnv)

  function handleDockClick(id: string) {
    if (id === 'more') return
    setDockActive(dockActive === id ? null : id)
  }

  function closePageView() {
    setDockActive(null)
  }

  // ── Pull-to-refresh — state machine, built from zero ──
  // States: idle → tracking → pulling → armed → refreshing → idle
  // Rule: eligibility decided ONCE at touchstart. Never re-armed mid-gesture.
  const mainRef = useRef<HTMLElement>(null)

  useEffect(() => {
    const THRESHOLD = 70   // px of finger movement to arm refresh
    const MAX_VISUAL = 80  // max px the header slides down
    const DAMPING = 0.4    // resistance factor

    // State — single source of truth
    let state: 'idle' | 'tracking' | 'pulling' | 'armed' | 'refreshing' = 'idle'
    let startY = 0
    let lastScrollTime = 0

    // Track scroll activity — any scroll means momentum is happening
    function onScroll() { lastScrollTime = Date.now() }
    window.addEventListener('scroll', onScroll, { passive: true })

    function getShell(): HTMLElement | null { return document.querySelector('.zeus-fixed-top') }
    function getInd(): HTMLElement | null { return document.getElementById('ptr-indicator') }

    function slideShell(px: number, animate: boolean) {
      const shell = getShell()
      if (!shell) return
      if (animate) { shell.style.transition = 'transform .3s cubic-bezier(.2,.8,.4,1)' }
      else { shell.style.transition = 'none' }
      shell.style.transform = px > 0 ? `translateY(${px}px)` : ''
    }

    function updateIndicator(progress: number, dy: number) {
      const ind = getInd()
      if (!ind) return
      ind.style.opacity = String(Math.min(progress, 1))
      const lbl = ind.querySelector('.ptr-label') as HTMLElement
      const spinner = ind.querySelector('.ptr-spinner') as HTMLElement
      if (progress >= 1) {
        if (lbl) lbl.textContent = 'Release to refresh'
        ind.classList.add('armed')
      } else {
        if (lbl) lbl.textContent = 'Zeus Terminal'
        ind.classList.remove('armed')
      }
      if (spinner) spinner.style.transform = `rotate(${dy * 2.5}deg)`
      ind.classList.add('visible')
    }

    function resetAll(animate: boolean) {
      slideShell(0, animate)
      const ind = getInd()
      if (ind) {
        ind.classList.remove('visible', 'armed', 'refreshing')
        ind.style.opacity = ''
      }
      if (animate) setTimeout(() => { const s = getShell(); if (s) s.style.transition = '' }, 350)
      state = 'idle'
    }

    function onTouchStart(e: TouchEvent) {
      if (state === 'refreshing') return

      // ── CRITICAL: three guards that must ALL pass ──
      // 1. Page must be at absolute top
      const scrollTop = window.scrollY || document.documentElement.scrollTop || 0
      if (scrollTop > 0) { state = 'idle'; return }
      // 2. No recent scroll momentum (300ms cooldown after last scroll event)
      if (Date.now() - lastScrollTime < 300) { state = 'idle'; return }
      // 3. Touch must be a single finger
      if (e.touches.length !== 1) { state = 'idle'; return }

      // All guards passed — start tracking this gesture
      state = 'tracking'
      startY = e.touches[0].clientY
    }

    function onTouchMove(e: TouchEvent) {
      if (state !== 'tracking' && state !== 'pulling' && state !== 'armed') return
      const dy = e.touches[0].clientY - startY

      // Pulling UP or sideways → cancel
      if (dy < 5) {
        if (state !== 'tracking') resetAll(true)
        state = dy < -10 ? 'idle' : state // cancel on clear upswipe
        return
      }

      // Double check: if page somehow scrolled, abort permanently
      if ((window.scrollY || document.documentElement.scrollTop || 0) > 0) {
        resetAll(false)
        return
      }

      // We're pulling down from top — prevent native scroll
      e.preventDefault()

      const pull = Math.min(dy * DAMPING, MAX_VISUAL)
      const progress = Math.min(dy / THRESHOLD, 1)

      state = progress >= 1 ? 'armed' : 'pulling'

      // Slide header down — ONLY the header, not main content
      slideShell(pull, false)
      updateIndicator(progress, dy)
    }

    function onTouchEnd() {
      if (state === 'armed') {
        // ── REFRESH ──
        state = 'refreshing'
        const ind = getInd()
        if (ind) {
          ind.classList.remove('armed')
          ind.classList.add('refreshing')
          const lbl = ind.querySelector('.ptr-label') as HTMLElement
          if (lbl) lbl.textContent = 'Refreshing...'
          const spinner = ind.querySelector('.ptr-spinner') as HTMLElement
          if (spinner) spinner.style.transform = ''
        }
        // Hold position briefly then reload
        slideShell(MAX_VISUAL * 0.6, true)
        setTimeout(() => location.reload(), 500)
      } else if (state === 'pulling' || state === 'tracking') {
        // ── CANCEL — snap back ──
        resetAll(true)
      }
    }

    document.addEventListener('touchstart', onTouchStart, { passive: true })
    document.addEventListener('touchmove', onTouchMove, { passive: false })
    document.addEventListener('touchend', onTouchEnd, { passive: true })
    return () => {
      window.removeEventListener('scroll', onScroll)
      document.removeEventListener('touchstart', onTouchStart)
      document.removeEventListener('touchmove', onTouchMove)
      document.removeEventListener('touchend', onTouchEnd)
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
        {/* ── Mode Bar — 1:1 from original zeus-mode-bar ── */}
        <ModeBar />

        {/* ── Watchlist Bar ── */}
        <WatchlistBar />

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
