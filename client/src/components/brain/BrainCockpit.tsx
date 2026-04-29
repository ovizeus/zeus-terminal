import { useRef, useEffect, memo, useState } from 'react'
import { resetProtectMode } from '../../engine/brain'
import { BlockReasonText } from './BlockReasonText'
import { useBrainStatsStore, BRAIN_NEURON_IDS } from '../../stores/brainStatsStore'
import { _ZI } from '../../constants/icons'

// [L1+L2] Radar lens controls — strictly visualization. Selecting any
// lens turns the 12-axis renderer ON via window.BRAIN_RADAR_12X_UI_ONLY.
// Per Zeus rules: in-memory only (no localStorage as final truth, no
// server writes); proper per-user persistence is deferred to L4 after
// T+7d soak. To rollback to legacy 6-axis: DevTools console
// `window.BRAIN_RADAR_12X_UI_ONLY = false`.
type RadarLens = 'hybrid' | 'realtime' | 'timeframe' | 'slow'
type RadarLensTf = '5m' | '15m' | '1h' | '4h'
const _RADAR_LENS_LABELS: Record<RadarLens, string> = {
  hybrid: 'HYBRID', realtime: 'REAL-TIME', timeframe: 'TIMEFRAME', slow: 'SLOW',
}
function RadarLensBar() {
  const [lens, setLensState] = useState<RadarLens>('hybrid')
  const [tf, setTfState] = useState<RadarLensTf>('5m')
  // Apply lens on mount + every change. Defensive: if MCR not yet
  // booted, skip silently — the canvas IIFE wires up shortly after.
  useEffect(() => {
    const mcr = (window as any).MarketCoreReactor
    if (mcr && typeof mcr.setLens === 'function') {
      try { mcr.setLens(lens, tf) } catch (_) { /* */ }
    }
  }, [lens, tf])
  const _btnStyle = (active: boolean, accent: string) => ({
    padding: '3px 8px', fontSize: '9px', letterSpacing: '1px',
    border: '1px solid ' + (active ? accent : '#1e2a3a'),
    background: active ? accent + '22' : 'transparent',
    color: active ? accent : '#8aa8c4',
    borderRadius: '3px', cursor: 'pointer',
    fontFamily: 'var(--ff)', fontWeight: 700,
    whiteSpace: 'nowrap' as const,
  })
  return (
    <div className="rdr-lens-bar" style={{
      display: 'flex', flexWrap: 'wrap', alignItems: 'center',
      gap: '4px', padding: '4px 8px', margin: '4px 0',
      background: 'rgba(8,16,28,0.55)',
      border: '1px solid #1a2a3a', borderRadius: '4px',
      fontFamily: 'var(--ff)', fontSize: '9px', letterSpacing: '1px',
    }}>
      <span style={{ color: '#7a9ab8', fontSize: '9px', letterSpacing: '1.5px' }}>RADAR LENS:</span>
      {(['hybrid', 'realtime', 'timeframe', 'slow'] as RadarLens[]).map(l => (
        <button key={l} onClick={() => setLensState(l)} style={_btnStyle(lens === l, '#00d4ff')}>
          {_RADAR_LENS_LABELS[l]}
        </button>
      ))}
      {lens === 'timeframe' && (
        <>
          <span style={{ color: '#1e2a3a', margin: '0 2px' }}>|</span>
          {(['5m', '15m', '1h', '4h'] as RadarLensTf[]).map(t => (
            <button key={t} onClick={() => setTfState(t)} style={_btnStyle(tf === t, '#f0c040')}>
              {t}
            </button>
          ))}
          <span style={{
            color: '#7a6a3a', fontSize: '8px', marginLeft: '4px',
            letterSpacing: '0.5px', fontWeight: 700,
          }}>
            TF BETA — LIMITED DATA
          </span>
        </>
      )}
    </div>
  )
}

/** [ZT5-C] Store-driven consumers for right-column arm/regime/receipt */
function ArmBadge() {
  const s = useBrainStatsStore((st) => st.snapshot.armBadge)
  return <div className={s.cls} id="zncArmBadge">{s.text}</div>
}

function RegimeBadge2() {
  const s = useBrainStatsStore((st) => st.snapshot.regimeBadge2)
  return <div className={s.cls} id="brainRegimeBadge2" dangerouslySetInnerHTML={{ __html: s.innerHtml }} />
}

function RegimeDetail() {
  const s = useBrainStatsStore((st) => st.snapshot.regimeDetail)
  return <div className="znc-regime-detail" id="zncRegimeDetail">{s}</div>
}

const ARM_FG_ON = '#39ff14'
const ARM_FG_OFF = '#2a4030'

function ArmDetail() {
  const s = useBrainStatsStore((st) => st.snapshot.arm)
  return (
    <div className="znc-arm-detail">
      <div className="znc-ad-title">AUTO-TRADE DETAIL</div>
      <div className="znc-ad-row">Mode: <b id="zad-mode" style={{ color: s.modeArmed ? ARM_FG_ON : ARM_FG_OFF }}>{s.mode}</b></div>
      <div className="znc-ad-row">Profile: <b id="zad-profile">{s.profile}</b></div>
      <div className="znc-ad-row">Score: <b id="zad-score" style={{ color: s.scoreArmed ? ARM_FG_ON : ARM_FG_OFF }}>{s.score}</b></div>
      <div className="znc-ad-row">Trigger: <b id="zad-trigger" style={{ color: s.triggerActive ? ARM_FG_ON : ARM_FG_OFF }}>{s.trigger}</b></div>
      <div className="znc-ad-row">TF: <b id="zad-tf">{s.tf}</b></div>
      <div className="znc-ad-row">Cooldown: <b id="zad-cd" style={{ color: s.cooldownReady ? ARM_FG_ON : ARM_FG_OFF }}>{s.cooldown}</b></div>
      <div className="znc-gates-summary" id="zad-gates-summary">{s.gatesSummary}</div>
      <BlockReasonText />{/* [R30] store-driven subscriber — memo'd parent preserved */}
    </div>
  )
}

function QForecastBlock() {
  const s = useBrainStatsStore((st) => st.snapshot.forecast)
  return (
    <div id="brain-forecast">
      <div className="bf-label">Q-FORECAST</div>
      <div className={s.mainCls} id="bf-main">{s.mainText}</div>
      <div className="bf-row">Range: <b id="bf-range">{s.rangeText}</b></div>
      <div className="bf-row">State: <b id="bf-state">{s.stateText}</b></div>
    </div>
  )
}

function WhyEngineBlock() {
  const s = useBrainStatsStore((st) => st.snapshot.why)
  const empty = s.whyList.length === 0 && s.riskList.length === 0
  return (
    <div id="brain-why">
      <div className="bw-label">WHY ENGINE</div>
      <div className={s.stateCls} id="bw-state">{s.stateText}</div>
      <div className="bw-reasons" id="bw-reasons">
        {empty ? (
          <span>Scanning market...</span>
        ) : (
          <>
            {s.whyList.length > 0 && <div className="bw-section-label why-label">WHY:</div>}
            {s.whyList.map((r, i) => (
              <span key={'w' + i} className="bw-why" dangerouslySetInnerHTML={{ __html: _ZI.ok + ' ' + r.replace(/</g, '&lt;') }} />
            ))}
            {s.riskList.length > 0 && <div className="bw-section-label risk-label">RISK:</div>}
            {s.riskList.map((r, i) => (
              <span key={'r' + i} className="bw-risk" dangerouslySetInnerHTML={{ __html: _ZI.w + ' ' + r.replace(/</g, '&lt;') }} />
            ))}
          </>
        )}
      </div>
    </div>
  )
}

function OfiBar() {
  const s = useBrainStatsStore((st) => st.snapshot.ofi)
  const b = s.buyPct.toFixed(0)
  const se = s.sellPct.toFixed(0)
  return (
    <div className="znc-ofi">
      <div style={{ fontSize: '6px', color: '#1a3020', letterSpacing: '1px', marginBottom: '2px' }}>ORDER FLOW</div>
      <div className="ofi-bar">
        <div className="ofi-buy" id="ofiBuy" style={{ width: b + '%' }}></div>
        <div className="ofi-sell" id="ofiSell" style={{ width: se + '%' }}></div>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '6px' }}>
        <span id="ofiBuyPct" style={{ color: '#39ff1466' }}>BUY {b}%</span>
        <span id="ofiSellPct" style={{ color: '#ff335566' }}>SELL {se}%</span>
      </div>
    </div>
  )
}

function NeuronsRow() {
  const s = useBrainStatsStore((st) => st.snapshot.neurons)
  return (
    <>
      {BRAIN_NEURON_IDS.map((n) => {
        const cell = s[n]
        return (
          <div key={n} id={`bn-${n}`} className={`neuron ${cell.state}`}>
            <div className="ndot"></div><span></span><span className="nval" id={`bnv-${n}`}>{cell.val}</span>
          </div>
        )
      })}
    </>
  )
}

function ReceiptBlock() {
  const s = useBrainStatsStore((st) => st.snapshot.receipt)
  return (
    <div className="znc-receipt" id="zncReceipt">
      <div className="znc-receipt-title">EXECUTION RECEIPT</div>
      <div className="znc-receipt-row">Mode: <b id="rec-mode">{s.mode}</b></div>
      <div className="znc-receipt-row">Score: <b id="rec-score">{s.score}</b></div>
      <div className="znc-receipt-row">Trigger: <b id="rec-trigger">{s.trigger}</b></div>
      <div className="znc-receipt-row">TF: <b id="rec-tf">{s.tf}</b></div>
      <div className="znc-receipt-bolt">
        <svg className="z-i z-i--brand" viewBox="0 0 16 16" style={{ color: '#f0c040' }}>
          <path d="M9 1L4 9h4l-1 6 5-8H8l1-6" />
        </svg>
      </div>
    </div>
  )
}

/**
 * 1:1 port of the ZEUS NEURAL CORE panel from public/index.html lines 1127-1570
 *
 * IMPORTANT: This is a STATIC DOM SHELL. All visual updates (safety gates, threat
 * circles, gauges, regime badges, etc.) are done by legacy brain.ts via getElementById.
 * Do NOT subscribe to React stores here — any re-render wipes out those DOM writes.
 */
export const BrainCockpit = memo(function BrainCockpit() {
  const particlesRef = useRef<HTMLDivElement>(null)

  // Spawn particles on mount
  useEffect(() => {
    const el = particlesRef.current
    if (!el) return
    for (let i = 0; i < 12; i++) {
      const p = document.createElement('div')
      p.className = 'znc-particle'
      p.style.left = Math.random() * 100 + '%'
      p.style.top = Math.random() * 100 + '%'
      p.style.setProperty('--dur', (3 + Math.random() * 4) + 's')
      p.style.setProperty('--dx', (Math.random() * 60 - 30) + 'px')
      p.style.setProperty('--dy', (Math.random() * -80 - 20) + 'px')
      p.style.animationDelay = (Math.random() * 4) + 's'
      el.appendChild(p)
    }
    return () => { el.innerHTML = '' }
  }, [])

  return (
    <div className="znc" id="zeusBrain">
      <div className="znc-scanlines"></div>
      <div className="znc-noise"></div>
      <div className="znc-particles" ref={particlesRef}></div>

      {/* HEADER */}
      <div className="znc-header">
        <span className="znc-title">ZEUS — QUANTUM BRAIN — AI ENGINE</span>
        <div className="znc-badges">
          <span className="znc-src user" id="znc-src">USER</span>
          <span className="znc-state scanning" id="brainStateBadge">SCANNING</span>
          <span className="sound-badge" id="soundBadge" title="Click to enable sound">
            <svg className="z-i" viewBox="0 0 16 16">
              <path d="M2 6h2l3-3v10l-3-3H2zM11 6l4 4M11 10l4-4" />
            </svg> SOUND
          </span>
        </div>
      </div>

      {/* MODE / PROFILE BAR — static shell, legacy JS manages active states via getElementById */}
      <div className="znc-mbar">
        <span className="znc-lbl">MODE:</span>
        <button id="bmode-assist" className="znc-mbtn act-assist" onClick={() => (window as any).setBrainMode?.('assist')}>ASSIST</button>
        <button id="bmode-auto" className="znc-mbtn" onClick={() => (window as any).setBrainMode?.('auto')}>AUTO</button>
        <div className="znc-sep"></div>
        <span className="znc-lbl">PROFILE:</span>
        <button id="prof-fast" className="znc-pbtn act-fast" onClick={() => (window as any).setProfile?.('fast')}>FAST</button>
        <button id="prof-swing" className="znc-pbtn" onClick={() => (window as any).setProfile?.('swing')}>SWING</button>
        <button id="prof-defensive" className="znc-pbtn" onClick={() => (window as any).setProfile?.('defensive')}>DEF</button>
        <div className="znc-sep"></div>
        <span className="znc-lbl">DSL:</span>
        <button id="dsl-swing" className="znc-dbtn" onClick={() => (window as any).setDslMode?.('swing')}>SWING</button>
        <button id="dsl-atr" className="znc-dbtn" onClick={() => (window as any).setDslMode?.('atr')}>ATR</button>
        <button id="dsl-defensive" className="znc-dbtn" onClick={() => (window as any).setDslMode?.('defensive')}>DEF</button>
        <button id="dsl-tp" className="znc-dbtn" onClick={() => (window as any).setDslMode?.('tp')}>TP</button>
        <button id="dsl-fast" className="znc-dbtn" onClick={() => (window as any).setDslMode?.('fast')}>FAST</button>
      </div>

      {/* PROTECT BANNER */}
      <div className="znc-protect" id="protectBanner">
        <span className="znc-protect-txt" id="protectBannerTxt">
          <svg className="z-i" viewBox="0 0 16 16" style={{ color: '#ff4466' }}>
            <path d="M8 1L2 4v4c0 4 3 7 6 8 3-1 6-4 6-8V4L8 1z" />
          </svg> PROTECT MODE ACTIV
        </span>
        <button style={{ fontSize: '8px', padding: '3px 9px', background: '#200010', border: '1px solid #ff446644', color: '#ff4466', borderRadius: '2px', cursor: 'pointer', fontFamily: 'inherit' }} onClick={() => resetProtectMode?.()}>RESET</button>
      </div>

      {/* BODY */}
      <div className="znc-body">

        {/* ═══ LEFT COLUMN ═══ */}
        <div className="znc-left">

          {/* SAFETY GATES */}
          <div className="znc-gates">
            <div className="znc-gates-title" style={{ color: '#39ff14' }}>SAFETY GATES</div>
            <div id="znc-safety-gates">
              <div className="znc-gate-row"><div className="znc-led wait" id="led-risk"></div><span className="znc-gate-lbl wait" id="lbl-risk">Risk Limit OK</span></div>
              <div className="znc-gate-row"><div className="znc-led wait" id="led-spread"></div><span className="znc-gate-lbl wait" id="lbl-spread">Spread/Slip OK</span></div>
              <div className="znc-gate-row"><div className="znc-led wait" id="led-cooldown"></div><span className="znc-gate-lbl wait" id="lbl-cooldown">Cooldown OFF</span></div>
              <div className="znc-gate-row"><div className="znc-led wait" id="led-news"></div><span className="znc-gate-lbl wait" id="lbl-news">News OK</span></div>
              <div className="znc-gate-row"><div className="znc-led wait" id="led-session"></div><span className="znc-gate-lbl wait" id="lbl-session">Session OK</span></div>
              <div className="znc-gate-row"><div className="znc-led wait" id="led-noopposite"></div><span className="znc-gate-lbl wait" id="lbl-noopposite">No Opposite</span></div>
              <div className="znc-gate-row"><div className="znc-led wait" id="led-regime"></div><span className="znc-gate-lbl wait" id="lbl-regime">Regime Stable</span></div>
            </div>
          </div>

          {/* [L1+L2] Radar Lens controls — between Safety Gates and the
              radar canvas. In-memory state only (no localStorage as final
              truth, no server writes). Selecting any lens auto-enables the
              12-axis renderer via window.BRAIN_RADAR_12X_UI_ONLY. */}
          <RadarLensBar />

          {/* MARKET CORE REACTOR + SIGNAL RADAR — Canvas System */}
          <div id="brainViz" className="mcr-wrap">
            <div className="mcr-reactor-box">
              <canvas id="mcrReactorCanvas"></canvas>
            </div>
            <div className="mcr-radar-box">
              <canvas id="mcrRadarCanvas"></canvas>
            </div>
          </div>

          {/* Hidden compat SVG */}
          <svg id="brainSvg" style={{ display: 'none', position: 'absolute', pointerEvents: 'none' }} viewBox="0 0 1 1">
            <circle cx="0" cy="0" r="0" id="zncScoreArc" strokeDasharray="0 302" opacity="0" />
            <circle cx="0" cy="0" r="0" id="zncCore" opacity="0" />
            <circle cx="0" cy="0" r="0" id="zncShock" opacity="0" />
            {[0,1,2,3,4,5,6,7,8].map(i => <circle key={i} cx="0" cy="0" r="0" id={`zled${i}`} opacity="0" />)}
            {['gates','score','regime','risk','auto','data'].map(n => <circle key={n} cx="0" cy="0" r="0" id={`cb-node-${n}`} opacity="0" />)}
          </svg>

          {/* Hidden compat elements — [ZT5-F] dead ids removed; only ids with live engine writers kept */}
          <div style={{ display: 'none' }} id="nc-confidence"></div>
          <div style={{ display: 'none' }} id="cbn-data-box"></div>
          <div style={{ display: 'none' }} id="cbn-data-val"></div>
          <div style={{ display: 'none' }} id="cbn-data-sub"></div>
          <div style={{ display: 'none' }} id="cbn-score-box"></div>
          <div style={{ display: 'none' }} id="zncScoreLbl"></div>
          <div style={{ display: 'none' }} id="predator-hud">
            <span id="pred-sleep"></span><span id="pred-hunt"></span><span id="pred-kill"></span>
          </div>
          <div style={{ display: 'none' }} id="orbSessionBar">
            <div id="osess-asia">ASIA</div>
            <div id="osess-london">LON</div>
            <div id="osess-ny">NY</div>
          </div>
          <div style={{ display: 'none' }} id="orbNeuroCoin"></div>
          <div id="zncOrbWrap" style={{ display: 'none', position: 'absolute', pointerEvents: 'none' }}>
            <svg id="zncOrbSVG" viewBox="0 0 220 220" style={{ display: 'none' }} />
          </div>

          {/* MTF */}
          <div className="znc-mtf">
            <span style={{ fontSize: '6px', color: '#1a3020', letterSpacing: '1px' }}>MTF:</span>
            <span className="znc-tf-badge neut" id="mtf15m">15m —</span>
            <span className="znc-tf-badge neut" id="mtf1h">1h —</span>
            <span className="znc-tf-badge neut" id="mtf4h">4h —</span>
            <span className="znc-tf-badge neut" id="mtfTrig" style={{ marginLeft: '4px' }}>TRIG:5m —</span>
            <div style={{ flex: 1 }}></div>
            <span className="znc-regime-val unknown" id="brainRegimeBadge" style={{ fontSize: '8px', padding: '1px 5px' }}>—</span>
          </div>

          {/* THOUGHT LOG + TICKER */}
          <div className="znc-log">
            <div id="brainThoughtLog" style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
              <div className="thought-line info"><span style={{ color: '#1a2a18' }}>00:00</span><span>Waiting for data...</span></div>
            </div>
          </div>
          <div className="znc-ticker-wrap">
            <div className="znc-ticker-inner" id="brainTickerText">INITIALIZING ZEUS NEURAL CORE...</div>
          </div>
        </div>{/* end left */}

        {/* ═══ RIGHT COLUMN ═══ */}
        <div className="znc-right">

          {/* GAUGES: NEWS + LIQ */}
          <div className="znc-gauges">
            <div className="znc-g-wrap">
              <div className="znc-g-lbl">NEWS</div>
              <svg width="56" height="32" viewBox="0 0 56 32">
                <path d="M4,28 A24,24,0,0,1,52,28" fill="none" stroke="#0a1a0a" strokeWidth="5" />
                <path d="M4,28 A24,24,0,0,1,52,28" fill="none" stroke="#39ff14" strokeWidth="5" strokeDasharray="0 75"
                  id="newsGaugeArc" strokeLinecap="round" style={{ transition: 'all .5s' }} />
              </svg>
              <div style={{ marginTop: '-8px', textAlign: 'center' }}>
                <div className="znc-g-val" id="newsGaugeVal" style={{ color: '#39ff14' }}>0</div>
              </div>
            </div>
            <div className="znc-g-wrap">
              <div className="znc-g-lbl">LIQ</div>
              <svg width="56" height="32" viewBox="0 0 56 32">
                <path d="M4,28 A24,24,0,0,1,52,28" fill="none" stroke="#0a1a0a" strokeWidth="5" />
                <path d="M4,28 A24,24,0,0,1,52,28" fill="none" stroke="#f0c040" strokeWidth="5" strokeDasharray="0 75"
                  id="liqGaugeArc" strokeLinecap="round" style={{ transition: 'all .5s' }} />
              </svg>
              <div style={{ marginTop: '-8px', textAlign: 'center' }}>
                <div className="znc-g-val" id="liqGaugeVal" style={{ color: '#f0c040' }}>0</div>
              </div>
            </div>
          </div>

          {/* ARM STATUS — store-driven */}
          <div className="znc-arm-box">
            <div className="znc-arm-lbl">AUTO-TRADE:</div>
            <ArmBadge />
          </div>

          {/* REGIME — store-driven */}
          <div className="znc-regime-box">
            <div className="znc-regime-lbl">REGIME</div>
            <RegimeBadge2 />
            <RegimeDetail />
          </div>

          {/* THREAT RADAR */}
          <div className="znc-threat">
            <div className="znc-threat-lbl">THREAT RADAR</div>
            <div className="znc-circles">
              <div className="znc-circ low" id="threat-news">
                <div className="znc-circ-lbl">NEWS</div>
                <div className="znc-circ-val" id="threatNewsVal" style={{ color: '#39ff14' }}>0</div>
              </div>
              <div className="znc-circ low" id="threat-liq">
                <div className="znc-circ-lbl">LIQ</div>
                <div className="znc-circ-val" id="threatLiqVal" style={{ color: '#39ff14' }}>0</div>
              </div>
              <div className="znc-circ low" id="threat-vol">
                <div className="znc-circ-lbl">VOL</div>
                <div className="znc-circ-val" id="threatVolVal" style={{ color: '#39ff14' }}>0</div>
              </div>
            </div>
          </div>

          {/* Sessions compat stubs */}
          <div style={{ display: 'none' }}>
            <div id="zsess-asia"></div>
            <div id="zsess-london"></div>
            <div id="zsess-ny"></div>
            <div id="zncNeuroCoin"></div>
            <div id="zncSessionBar"></div>
          </div>

          {/* ARM DETAIL + EXECUTION RECEIPT — store-driven */}
          <ArmDetail />
          <ReceiptBlock />

          {/* OFI compact — store-driven */}
          <OfiBar />
        </div>{/* end right */}
      </div>{/* end body */}

      {/* ═══ COCKPIT PANEL — 3-column stable grid ═══ */}
      <div className="znc-cockpit">

        {/* CELL 1: CONTEXT GATES */}
        <div className="znc-cockpit-cell">
          <div className="znc-cockpit-cell-title" style={{ color: '#f0c040' }}>CONTEXT GATES</div>
          <div id="znc-context-gates">
            <div className="znc-gate-row"><div className="znc-led wait" id="led-mtf"></div><span className="znc-gate-lbl wait" id="lbl-mtf">MTF Align —/3</span></div>
            <div className="znc-gate-row"><div className="znc-led wait" id="led-flow"></div><span className="znc-gate-lbl wait" id="lbl-flow">Flow CONFIRM</span></div>
            <div className="znc-gate-row"><div className="znc-led wait" id="led-trigger"></div><span className="znc-gate-lbl wait" id="lbl-trigger">Trigger —</span></div>
            <div className="znc-gate-row"><div className="znc-led wait" id="led-antifake"></div><span className="znc-gate-lbl wait" id="lbl-antifake">Anti-Fakeout OK</span></div>
          </div>
        </div>

        {/* CELL 2: INSIGHT CARDS */}
        <div className="znc-cockpit-cell">
          <div className="znc-cockpit-cell-title" style={{ color: '#aa44ff' }}>FLOW INSIGHT</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '3px' }}>
            <div className="znc-card ok" id="card-flow">
              <div className="znc-card-title" id="card-flow-t">Flow —</div>
              <div className="znc-card-sub" id="card-flow-s">Delta —</div>
            </div>
            <div className="znc-card warn" id="card-sweep">
              <div className="znc-card-title" id="card-sweep-t">Sweep —</div>
              <div className="znc-card-sub" id="card-sweep-s">—</div>
            </div>
            <div className="znc-card warn" id="card-mtf">
              <div className="znc-card-title" id="card-mtf-t">MTF —</div>
              <div className="znc-card-sub" id="card-mtf-s">—</div>
            </div>
            <div className="znc-card ok" id="card-chaos">
              <div className="znc-card-title" id="card-chaos-t">Chaos —</div>
              <div className="znc-card-sub" id="card-chaos-s">ATR —</div>
            </div>
            <div className="znc-card neut" id="card-atmos" style={{ gridColumn: 'span 2' }}>
              <div className="znc-card-title" id="card-atmos-t">ATMOSPHERE</div>
              <div className="znc-card-sub" id="card-atmos-s">NEUTRAL · ALLOW</div>
            </div>
          </div>
        </div>

        {/* CELL 3: DSL STATUS */}
        <div className="znc-cockpit-cell">
          <div className="znc-cockpit-cell-title" style={{ color: '#00ffcc' }}>DSL STATUS</div>
          <div className="znc-dsl-body" id="zncDslContract" style={{ fontSize: '8px', color: '#2a5040', lineHeight: 1.7 }}>DSL ENGINE: <b>READY</b> · Init...</div>
        </div>

      </div>{/* end cockpit panel */}

      {/* [Pack C / L5] Q-FORECAST removed from render — `w.S.quantumForecast`
          was read by renderQForecast (brain.ts:2022) but never written
          anywhere in the codebase, so the panel always showed
          "Neutral (0) / Range: — / State: —". WHY ENGINE remains; the
          grid collapses to a single column. QForecastBlock function +
          brainStatsStore.forecast field kept as dormant dead code for a
          future Phase 12 cleanup batch (no behavior impact). */}
      <div style={{ padding: '4px 6px 0' }}>
        <WhyEngineBlock />
      </div>

      {/* COMPAT: hidden IDs with live engine writers — [ZT5-F] brainRegimeBadge3/brainCoreBg/zncScoreNum2 dropped (0 external writers) */}
      <div className="znc-compat">
        <div id="entryScoreNum"></div>
        <div id="entryScoreFill"></div>
        <div id="entryScoreLabel"></div>
        <div id="entryScoreReasons"></div>
        <div id="chaosBarFill"></div>
        <div id="chaosVal"></div>
        <div id="newsRiskBadge"></div>
        <div id="newsHeadline"></div>
        <div id="macroCd"></div>
        <div id="gatesGrid"></div>
        <div id="gatesOkCount"></div>
        <div id="flowCVD"></div>
        <div id="flowDelta"></div>
        <div id="flowOFI"></div>
        <div id="flowSweep"></div>
        <div id="flowReclaim"></div>
        <div id="flowDisplacement"></div>
        <div id="dslTelemetry"></div>
        <div id="brainScoreNum"></div>
        <div id="brainScoreArc"></div>
        {/* [ZT5-F] neurons store-driven */}
        <NeuronsRow />
      </div>

    </div>
  )
})
