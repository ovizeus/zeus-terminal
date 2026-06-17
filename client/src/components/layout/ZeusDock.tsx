import type { ReactNode } from 'react'
import { useEffect, useState } from 'react'
// [Phase 3C] Engine mode single source — useATStore.mode. AT.mode is a read mirror.
import { useATStore } from '../../stores'

// [R24.1] SVG contents converted from hardcoded HTML strings (which were fed
// into dangerouslySetInnerHTML) to structured JSX fragments. No user data
// flows through these; the conversion purges the last dangerouslySetInnerHTML
// surface in the codebase and brings dock icons into normal React rendering.
interface DockItem {
  id: string
  label: string
  group: string
  icon: ReactNode
}

const DOCK_ITEMS: DockItem[] = [
  { id: 'autotrade', label: 'AutoTrade', group: 'trading',
    icon: (
      <>
        <circle cx="12" cy="12" r="10" fill="currentColor" opacity=".08" />
        <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" strokeWidth="1.5" />
        <path d="M13 3L6 13h5l-1 8 7-10h-5l1-8z" fill="currentColor" opacity=".25" />
        <path d="M13 3L6 13h5l-1 8 7-10h-5l1-8z" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      </>
    ) },
  { id: 'manual-trade', label: 'Manual Trade', group: 'trading',
    icon: (
      <>
        <path d="M10 13V5.5a1.5 1.5 0 013 0V11" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        <path d="M13 11v-1a1.3 1.3 0 012.6 0v3" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        <path d="M15.6 11.5v-.5a1.3 1.3 0 012.6 0v4.5c0 3-2 5.5-5 5.5H11c-1.5 0-2.4-.6-3.1-1.7L5 15.5c-.4-.7-.1-1.6.7-1.9.6-.2 1.3 0 1.7.5L10 17" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M11 10c0-2 0-4 0-6" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" opacity=".35" />
      </>
    ) },
  { id: 'dsl', label: 'DSL', group: 'trading',
    icon: (
      <>
        <path d="M3 17l4-4 4 4 4-8 6 6" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx="21" cy="15" r="2" fill="currentColor" opacity=".5" />
        <circle cx="3" cy="17" r="1.5" fill="currentColor" opacity=".35" />
        <path d="M3 20h18" stroke="currentColor" strokeWidth="1" opacity=".2" strokeLinecap="round" />
      </>
    ) },
  { id: 'dsl-drive', label: 'DSL Drive', group: 'trading', icon: (
    <>
      <circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <path d="M12 2v4M12 18v4M2 12h4M18 12h4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </>
  ) },
  // [OMEGA Wave 1 UI 2026-05-15] Ω rune — position 4 (after DSL, before ARES).
  // Geometric capital omega: arching crown + vertical legs + halo dot.
  { id: 'omega', label: 'OMEGA', group: 'trading',
    icon: (
      <>
        <circle cx="12" cy="12" r="10" fill="currentColor" opacity=".05" />
        <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" strokeWidth="0.8" opacity=".4" />
        <path d="M7 19 L9 19 L9 15 C9 12 10 9 12 9 C14 9 15 12 15 15 L15 19 L17 19" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx="12" cy="6.5" r="1.2" fill="currentColor" opacity=".7" />
        <circle cx="12" cy="12" r="2" fill="currentColor" opacity=".15" />
      </>
    ) },
  // [MultiExchange 2026-05-21] ₿ glyph — position 5 (after Omega, before ARES).
  // Bitcoin symbol on hexagonal hub backdrop. Click → MultiExchangePage.
  // NOTE: This list is the React-rendered dock (ZeusDock.tsx). Mirror entry
  // also exists in client/src/ui/dock.ts (legacy initZeusDock path). BOTH
  // must be updated when adding/removing dock items.
  { id: 'multi-exchange', label: 'MultiExchange', group: 'trading',
    icon: (
      <>
        <polygon points="12,2 21,7 21,17 12,22 3,17 3,7" fill="currentColor" opacity=".08" />
        <polygon points="12,2 21,7 21,17 12,22 3,17 3,7" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
        <path d="M10 8h3.5c1.4 0 2.3.8 2.3 1.9 0 .9-.5 1.6-1.3 1.8.9.2 1.5 1 1.5 2 0 1.3-1 2.1-2.6 2.1H10V8zm1.3 3.3h1.9c.7 0 1.1-.4 1.1-1s-.4-1-1.1-1h-1.9v2zm0 3.4h2.1c.8 0 1.2-.4 1.2-1.1 0-.6-.4-1-1.2-1h-2.1v2.1z" fill="currentColor" stroke="none" />
        <line x1="12" y1="6.5" x2="12" y2="8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
        <line x1="12" y1="16" x2="12" y2="17.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      </>
    ) },
  { id: 'ares', label: 'ARES', group: 'trading',
    icon: (
      <>
        <path d="M12 1.5L4.5 6.5v5.5c0 4.8 3.1 9.8 7.5 11 4.4-1.2 7.5-6.2 7.5-11V6.5L12 1.5z" fill="currentColor" opacity=".1" />
        <path d="M12 1.5L4.5 6.5v5.5c0 4.8 3.1 9.8 7.5 11 4.4-1.2 7.5-6.2 7.5-11V6.5L12 1.5z" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
        <path d="M9 11.5l2 2 4-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </>
    ) },
  { id: 'postmortem', label: 'Post-Mortem', group: 'review',
    icon: (
      <>
        <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" fill="currentColor" opacity=".1" />
        <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
        <path d="M14 2v6h6" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
        <path d="M9 13h6M9 17h4" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      </>
    ) },
  { id: 'pnllab', label: 'PnL Lab', group: 'review',
    icon: (
      <>
        <rect x="4" y="3" width="3" height="17" rx="1.5" fill="currentColor" opacity=".12" />
        <rect x="10.5" y="3" width="3" height="17" rx="1.5" fill="currentColor" opacity=".08" />
        <rect x="17" y="3" width="3" height="17" rx="1.5" fill="currentColor" opacity=".05" />
        <path d="M5.5 20V10M12 20V4M18.5 20v-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      </>
    ) },
  { id: 'aria', label: 'ARIA', group: 'intel',
    icon: (
      <>
        <ellipse cx="12" cy="12" rx="10" ry="6" fill="currentColor" opacity=".08" />
        <ellipse cx="12" cy="12" rx="10" ry="6" fill="none" stroke="currentColor" strokeWidth="1.5" />
        <circle cx="12" cy="12" r="3" fill="currentColor" opacity=".2" />
        <circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" strokeWidth="1.5" />
        <line x1="12" y1="6" x2="12" y2="2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        <line x1="12" y1="22" x2="12" y2="18" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </>
    ) },
  { id: 'nova', label: 'Nova', group: 'intel',
    icon: (
      <>
        <polygon points="12,2 15,9 22,9 16.5,14 18.5,21 12,17 5.5,21 7.5,14 2,9 9,9" fill="currentColor" opacity=".1" />
        <polygon points="12,2 15,9 22,9 16.5,14 18.5,21 12,17 5.5,21 7.5,14 2,9 9,9" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
        <circle cx="12" cy="12" r="2" fill="currentColor" opacity=".35" />
      </>
    ) },
  { id: 'adaptive', label: 'Adaptive', group: 'intel',
    icon: (
      <>
        <circle cx="12" cy="12" r="10" fill="currentColor" opacity=".07" />
        <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" strokeWidth="1.5" />
        <path d="M8 12s1.5-4 4-4 4 4 4 4-1.5 4-4 4-4-4-4-4" fill="none" stroke="currentColor" strokeWidth="1.5" />
        <circle cx="12" cy="12" r="1.5" fill="currentColor" opacity=".4" />
      </>
    ) },
  { id: 'flow', label: 'Flow', group: 'intel',
    icon: (
      <>
        <path d="M5 12h14" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        <path d="M14 5l7 7-7 7" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx="5" cy="12" r="2.5" fill="currentColor" opacity=".15" />
        <circle cx="5" cy="12" r="2.5" fill="none" stroke="currentColor" strokeWidth="1.2" />
      </>
    ) },
  { id: 'quantmonitor', label: 'Quant', group: 'intel',
    icon: (
      <>
        <rect x="3" y="3" width="18" height="14" rx="2" fill="currentColor" opacity=".08" />
        <rect x="3" y="3" width="18" height="14" rx="2" fill="none" stroke="currentColor" strokeWidth="1.5" />
        <path d="M7 13l3-3 3 3 4-5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx="17" cy="8" r="1.5" fill="currentColor" opacity=".4" />
        <line x1="8" y1="21" x2="16" y2="21" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        <line x1="12" y1="17" x2="12" y2="21" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </>
    ) },
  { id: 'mtf', label: 'MTF', group: 'intel',
    icon: (
      <>
        <path d="M3 3v18h18" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M7 16l4-5 4 3 5-7" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx="7" cy="16" r="1.5" fill="currentColor" opacity=".35" />
        <circle cx="20" cy="7" r="1.5" fill="currentColor" opacity=".35" />
      </>
    ) },
  { id: 'teacher', label: 'Teacher', group: 'intel',
    icon: (
      <>
        <path d="M2 3h6a4 4 0 014 4v14a3 3 0 00-3-3H2z" fill="currentColor" opacity=".08" />
        <path d="M22 3h-6a4 4 0 00-4 4v14a3 3 0 013-3h7z" fill="currentColor" opacity=".08" />
        <path d="M2 3h6a4 4 0 014 4v14a3 3 0 00-3-3H2zM22 3h-6a4 4 0 00-4 4v14a3 3 0 013-3h7z" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </>
    ) },
  { id: 'sigreg', label: 'Signals', group: 'intel',
    icon: (
      <>
        <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" fill="currentColor" opacity=".1" />
        <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" fill="none" stroke="currentColor" strokeWidth="1.5" />
        <line x1="4" y1="22" x2="4" y2="15" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </>
    ) },
  // [UI-COMPACT 2026-06-07] Dedicated Liquidations page (Monitor + Overview +
  // Live Feed). MIRROR entry also added in ui/dock.ts DOCK_ITEMS — both lists
  // must stay in sync (documented 2026-05-21 gotcha).
  { id: 'liquidations', label: 'Liquidations', group: 'intel',
    icon: (
      <>
        <path d="M12 2.5s6.5 7.5 6.5 12.5a6.5 6.5 0 0 1-13 0C5.5 10 12 2.5 12 2.5z" fill="currentColor" opacity=".1" />
        <path d="M12 2.5s6.5 7.5 6.5 12.5a6.5 6.5 0 0 1-13 0C5.5 10 12 2.5 12 2.5z" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
        <path d="M9 15a3 3 0 0 0 3 3" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      </>
    ) },
  // [UI-COMPACT 2026-06-13] Market Metrics page (BTC Market Metrics + Order Book +
  // S/R Levels). MIRROR entry also added in ui/dock.ts DOCK_ITEMS — both lists
  // must stay in sync (documented 2026-05-21 gotcha).
  { id: 'market-metrics', label: 'Metrics', group: 'intel',
    icon: (
      <>
        <path d="M3 21h18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        <rect x="4" y="14" width="4" height="7" rx="1" fill="currentColor" opacity=".25" />
        <rect x="4" y="14" width="4" height="7" rx="1" fill="none" stroke="currentColor" strokeWidth="1.3" />
        <rect x="10" y="9" width="4" height="12" rx="1" fill="currentColor" opacity=".25" />
        <rect x="10" y="9" width="4" height="12" rx="1" fill="none" stroke="currentColor" strokeWidth="1.3" />
        <rect x="16" y="5" width="4" height="16" rx="1" fill="currentColor" opacity=".25" />
        <rect x="16" y="5" width="4" height="16" rx="1" fill="none" stroke="currentColor" strokeWidth="1.3" />
      </>
    ) },
  { id: 'activity', label: 'Activity', group: 'review',
    icon: (
      <>
        <polyline points="22,12 18,12 15,21 9,3 6,12 2,12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx="12" cy="12" r="1.5" fill="currentColor" opacity=".3" />
      </>
    ) },
  { id: 'aub', label: 'Alien', group: 'review',
    icon: (
      <>
        <path d="M12 2C8 2 4.5 5.5 4.5 10c0 2.5 1 4.5 2.5 6l-1 4 3.5-1.5c.8.3 1.6.5 2.5.5s1.7-.2 2.5-.5L18 20l-1-4c1.5-1.5 2.5-3.5 2.5-6C19.5 5.5 16 2 12 2z" fill="currentColor" opacity=".1" />
        <path d="M12 2C8 2 4.5 5.5 4.5 10c0 2.5 1 4.5 2.5 6l-1 4 3.5-1.5c.8.3 1.6.5 2.5.5s1.7-.2 2.5-.5L18 20l-1-4c1.5-1.5 2.5-3.5 2.5-6C19.5 5.5 16 2 12 2z" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
        <circle cx="9" cy="9" r="1.5" fill="currentColor" opacity=".5" />
        <circle cx="15" cy="9" r="1.5" fill="currentColor" opacity=".5" />
        <path d="M9 13c1.5 1.5 4.5 1.5 6 0" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      </>
    ) },
  { id: 'more', label: 'More', group: 'expand',
    icon: (
      <>
        <circle cx="12" cy="5" r="2" fill="currentColor" opacity=".2" />
        <circle cx="12" cy="5" r="2" fill="none" stroke="currentColor" strokeWidth="1.3" />
        <circle cx="12" cy="12" r="2" fill="currentColor" opacity=".2" />
        <circle cx="12" cy="12" r="2" fill="none" stroke="currentColor" strokeWidth="1.3" />
        <circle cx="12" cy="19" r="2" fill="currentColor" opacity=".2" />
        <circle cx="12" cy="19" r="2" fill="none" stroke="currentColor" strokeWidth="1.3" />
      </>
    ) },
]

interface ZeusDockProps {
  active: string | null
  onDockClick: (id: string) => void
}

// [BATCH3-N] Visual link between AT/Manual and DSL icons when respective
// positions are open. Reads TP positions on `zeus:positionsChanged`. No logic
// changes — pure presentation. Pulsing dots start on the same CSS animation
// so the viewer reads AT↔DSL (or Manual↔DSL) as a bonded pair.
function useDockLinkState(): { atHasPos: boolean; manualHasPos: boolean } {
  const [state, setState] = useState({ atHasPos: false, manualHasPos: false })
  useEffect(() => {
    function recompute() {
      try {
        const w = window as any
        const TP = w.TP || {}
        // [Phase 3C] Read engine mode from store (canonical), not AT.mode mirror.
        const isLive = useATStore.getState().mode === 'live'
        const positions = isLive ? (TP.livePositions || []) : (TP.demoPositions || [])
        let at = false
        let man = false
        if (Array.isArray(positions)) {
          for (const p of positions) {
            if (!p || p.closed) continue
            if (p.autoTrade) { at = true } else { man = true }
            if (at && man) break
          }
        }
        setState(prev => (prev.atHasPos === at && prev.manualHasPos === man ? prev : { atHasPos: at, manualHasPos: man }))
      } catch (_) {}
    }
    recompute()
    window.addEventListener('zeus:positionsChanged', recompute)
    window.addEventListener('zeus:atStateChanged', recompute)
    // [BATCH3-P] Boot catch-up: positions arrive ~1.5-3s after mount via the
    // Phase 3 server sync. Without this, the initial recompute() runs with an
    // empty TP and the dots stay dark until the first zeus:positionsChanged
    // event fires. Short poll for 12s covers the boot window; auto-stops once
    // positions are detected (or on unmount / next re-run via event).
    let ticks = 0
    const bootPoll = setInterval(() => {
      ticks++
      recompute()
      const w = window as any
      const TP = w.TP || {}
      // [Phase 3C] Same store-truth rule as the primary path.
      const arr = (useATStore.getState().mode === 'live') ? (TP.livePositions || []) : (TP.demoPositions || [])
      if (ticks >= 48 || (Array.isArray(arr) && arr.length > 0)) clearInterval(bootPoll)
    }, 250)
    return () => {
      clearInterval(bootPoll)
      window.removeEventListener('zeus:positionsChanged', recompute)
      window.removeEventListener('zeus:atStateChanged', recompute)
    }
  }, [])
  return state
}

function LinkDots({ forItem, atHasPos, manualHasPos }: { forItem: string; atHasPos: boolean; manualHasPos: boolean }) {
  const dots: ReactNode[] = []
  if (forItem === 'autotrade' && atHasPos) dots.push(<span key="at" className="zd-link-dot zd-link-dot--at" aria-hidden />)
  if (forItem === 'manual-trade' && manualHasPos) dots.push(<span key="man" className="zd-link-dot zd-link-dot--manual" aria-hidden />)
  if (forItem === 'dsl') {
    if (atHasPos) dots.push(<span key="at" className="zd-link-dot zd-link-dot--at zd-link-dot--dsl-at" aria-hidden />)
    if (manualHasPos) dots.push(<span key="man" className="zd-link-dot zd-link-dot--manual zd-link-dot--dsl-manual" aria-hidden />)
  }
  return <>{dots}</>
}

export function ZeusDock({ active, onDockClick }: ZeusDockProps) {
  const { atHasPos, manualHasPos } = useDockLinkState()
  let lastGroup = ''

  return (
    <div id="zeus-dock">
      {DOCK_ITEMS.map((item) => {
        const showSep = lastGroup !== '' && item.group !== lastGroup
        lastGroup = item.group
        return (
          <span key={item.id}>
            {showSep && <div className="zd-sep" />}
            <div
              className={`zd-item${active === item.id ? ' active' : ''}`}
              data-dock={item.id}
              onClick={() => onDockClick(item.id)}
            >
              <div className="zd-icon">
                <svg viewBox="0 0 24 24" width="24" height="24">{item.icon}</svg>
                <LinkDots forItem={item.id} atHasPos={atHasPos} manualHasPos={manualHasPos} />
              </div>
              <span className="zd-label">{item.label}</span>
            </div>
          </span>
        )
      })}
    </div>
  )
}
