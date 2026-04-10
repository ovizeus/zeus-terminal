import { useState, type ReactNode } from 'react'
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

      <main className="zr-panels">
        {/* ── Mode Bar — 1:1 from original zeus-mode-bar ── */}
        <ModeBar />

        {/* ── Watchlist Bar ── */}
        <WatchlistBar />

        {/* ── Chart section — 1:1 from original #csec .chart-section ── */}
        <section className="zr-panel zr-panel--chart" data-panel="chart">
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
