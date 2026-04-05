import { useState, useRef, useEffect } from 'react'
import { useBrainStore } from '../../stores'

/** 1:1 port of the ZEUS NEURAL CORE panel from public/index.html lines 1127-1570 */
export function BrainCockpit() {
  const brain = useBrainStore((s) => s.brain)
  const [brainMode, setBrainMode] = useState<'assist' | 'auto'>('assist')
  const [profile, setProfile] = useState<'fast' | 'swing' | 'defensive'>('fast')
  const [dslMode, setDslMode] = useState<string>('')
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

      {/* MODE / PROFILE BAR */}
      <div className="znc-mbar">
        <span className="znc-lbl">MODE:</span>
        <button id="bmode-assist" className={`znc-mbtn${brainMode === 'assist' ? ' act-assist' : ''}`} onClick={() => { setBrainMode('assist'); (window as any).setBrainMode?.('assist') }}>ASSIST</button>
        <button id="bmode-auto" className={`znc-mbtn${brainMode === 'auto' ? ' act-auto' : ''}`} onClick={() => { setBrainMode('auto'); (window as any).setBrainMode?.('auto') }}>AUTO</button>
        <div className="znc-sep"></div>
        <span className="znc-lbl">PROFILE:</span>
        <button id="prof-fast" className={`znc-pbtn${profile === 'fast' ? ' act-fast' : ''}`} onClick={() => { setProfile('fast'); (window as any).setProfile?.('fast') }}>FAST</button>
        <button id="prof-swing" className={`znc-pbtn${profile === 'swing' ? ' act-swing' : ''}`} onClick={() => { setProfile('swing'); (window as any).setProfile?.('swing') }}>SWING</button>
        <button id="prof-defensive" className={`znc-pbtn${profile === 'defensive' ? ' act-defensive' : ''}`} onClick={() => { setProfile('defensive'); (window as any).setProfile?.('defensive') }}>DEF</button>
        <div className="znc-sep"></div>
        <span className="znc-lbl">DSL:</span>
        <button id="dsl-atr" className={`znc-dbtn${dslMode === 'atr' ? ' act-dsl-atr' : ''}`} onClick={() => { setDslMode('atr'); (window as any).setDslMode?.('atr') }}>ATR</button>
        <button id="dsl-fast" className={`znc-dbtn${dslMode === 'fast' ? ' act-dsl-fast' : ''}`} onClick={() => { setDslMode('fast'); (window as any).setDslMode?.('fast') }}>FAST</button>
        <button id="dsl-swing" className={`znc-dbtn${dslMode === 'swing' ? ' act-dsl-swing' : ''}`} onClick={() => { setDslMode('swing'); (window as any).setDslMode?.('swing') }}>SWING</button>
        <button id="dsl-defensive" className={`znc-dbtn${dslMode === 'defensive' ? ' act-dsl-defensive' : ''}`} onClick={() => { setDslMode('defensive'); (window as any).setDslMode?.('defensive') }}>DEF</button>
        <button id="dsl-tp" className={`znc-dbtn${dslMode === 'tp' ? ' act-dsl-tp' : ''}`} onClick={() => { setDslMode('tp'); (window as any).setDslMode?.('tp') }}>TP</button>
      </div>

      {/* PROTECT BANNER */}
      <div className="znc-protect" id="protectBanner">
        <span className="znc-protect-txt" id="protectBannerTxt">
          <svg className="z-i" viewBox="0 0 16 16" style={{ color: '#ff4466' }}>
            <path d="M8 1L2 4v4c0 4 3 7 6 8 3-1 6-4 6-8V4L8 1z" />
          </svg> PROTECT MODE ACTIV
        </span>
        <button style={{ fontSize: '8px', padding: '3px 9px', background: '#200010', border: '1px solid #ff446644', color: '#ff4466', borderRadius: '2px', cursor: 'pointer', fontFamily: 'inherit' }}>RESET</button>
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

          {/* Hidden compat elements */}
          <div style={{ display: 'none' }} id="nc-center"></div>
          <div style={{ display: 'none' }} id="nc-regime"></div>
          <div style={{ display: 'none' }} id="cbn-gates-val"></div>
          <div style={{ display: 'none' }} id="cbn-gates-sub"></div>
          <div style={{ display: 'none' }} id="nc-mode"></div>
          <div style={{ display: 'none' }} id="zncScoreNum"></div>
          <div style={{ display: 'none' }} id="nc-confidence"></div>
          <div style={{ display: 'none' }} id="nc-flow-val"></div>
          <div style={{ display: 'none' }} id="nc-vol-val"></div>
          <div style={{ display: 'none' }} id="cbn-risk-val"></div>
          <div style={{ display: 'none' }} id="cbn-regime-val"></div>
          <div style={{ display: 'none' }} id="zncValProfile"></div>
          <div style={{ display: 'none' }} id="zncValTf"></div>
          <div style={{ display: 'none' }} id="zncValCooldown"></div>
          <div style={{ display: 'none' }} id="cbn-auto-val"></div>
          <div style={{ display: 'none' }} id="zncValScan"></div>
          <div style={{ display: 'none' }} id="zncScoreLbl"></div>
          <div style={{ display: 'none' }} id="zncStatusSub"></div>
          <div style={{ display: 'none' }} id="cbn-regime-box"></div>
          <div style={{ display: 'none' }} id="cbn-regime-sub"></div>
          <div style={{ display: 'none' }} id="nc-vol-box"></div>
          <div style={{ display: 'none' }} id="nc-volat-val"></div>
          <div style={{ display: 'none' }} id="cbn-data-box"></div>
          <div style={{ display: 'none' }} id="cbn-data-val"></div>
          <div style={{ display: 'none' }} id="cbn-data-sub"></div>
          <div style={{ display: 'none' }} id="cbn-auto-box"></div>
          <div style={{ display: 'none' }} id="cbn-auto-sub"></div>
          <div style={{ display: 'none' }} id="cbn-risk-box"></div>
          <div style={{ display: 'none' }} id="cbn-risk-sub"></div>
          <div style={{ display: 'none' }} id="nc-risk-val"></div>
          <div style={{ display: 'none' }} id="nc-flow-box"></div>
          <div style={{ display: 'none' }} id="nc-struct-box"></div>
          <div style={{ display: 'none' }} id="nc-struct-val"></div>
          <div style={{ display: 'none' }} id="nc-liq-val"></div>
          <div style={{ display: 'none' }} id="cbn-score-box"></div>
          <div style={{ display: 'none' }} id="nc-canvas"></div>
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

          {/* ARM STATUS */}
          <div className="znc-arm-box">
            <div className="znc-arm-lbl">AUTO-TRADE:</div>
            <div className="znc-arm-badge scanning" id="zncArmBadge">SCANNING</div>
          </div>

          {/* REGIME */}
          <div className="znc-regime-box">
            <div className="znc-regime-lbl">REGIME</div>
            <div className="znc-regime-val unknown" id="brainRegimeBadge2">LOADING ▲</div>
            <div className="znc-regime-detail" id="zncRegimeDetail">ADX: — | VOL: — | STRUCT: —</div>
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

          {/* ARM DETAIL */}
          <div className="znc-arm-detail">
            <div className="znc-ad-title">AUTO-TRADE DETAIL</div>
            <div className="znc-ad-row">Mode: <b id="zad-mode">MANUAL</b></div>
            <div className="znc-ad-row">Profile: <b id="zad-profile">FAST</b></div>
            <div className="znc-ad-row">Score: <b id="zad-score">—</b></div>
            <div className="znc-ad-row">Trigger: <b id="zad-trigger">—</b></div>
            <div className="znc-ad-row">TF: <b id="zad-tf">—</b></div>
            <div className="znc-ad-row">Cooldown: <b id="zad-cd">READY</b></div>
            <div className="znc-gates-summary" id="zad-gates-summary">Gates: —/— OK</div>
            <div className="znc-block-reason wait" id="zad-block-reason">AUTO WAIT: Initializing...</div>
          </div>

          {/* EXECUTION RECEIPT */}
          <div className="znc-receipt" id="zncReceipt">
            <div className="znc-receipt-title">EXECUTION RECEIPT</div>
            <div className="znc-receipt-row">Mode: <b id="rec-mode">—</b></div>
            <div className="znc-receipt-row">Score: <b id="rec-score">—</b></div>
            <div className="znc-receipt-row">Trigger: <b id="rec-trigger">—</b></div>
            <div className="znc-receipt-row">TF: <b id="rec-tf">—</b></div>
            <div className="znc-receipt-bolt">
              <svg className="z-i z-i--brand" viewBox="0 0 16 16" style={{ color: '#f0c040' }}>
                <path d="M9 1L4 9h4l-1 6 5-8H8l1-6" />
              </svg>
            </div>
          </div>

          {/* OFI compact */}
          <div className="znc-ofi">
            <div style={{ fontSize: '6px', color: '#1a3020', letterSpacing: '1px', marginBottom: '2px' }}>ORDER FLOW</div>
            <div className="ofi-bar">
              <div className="ofi-buy" id="ofiBuy" style={{ width: '50%' }}></div>
              <div className="ofi-sell" id="ofiSell" style={{ width: '50%' }}></div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '6px' }}>
              <span id="ofiBuyPct" style={{ color: '#39ff1466' }}>BUY 50%</span>
              <span id="ofiSellPct" style={{ color: '#ff335566' }}>SELL 50%</span>
            </div>
          </div>
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

      {/* Q-FORECAST + WHY ENGINE row */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px', padding: '4px 6px 0' }}>

        {/* Q-FORECAST */}
        <div id="brain-forecast">
          <div className="bf-label">Q-FORECAST</div>
          <div className="bf-main neut" id="bf-main">Neutral (0)</div>
          <div className="bf-row">Range: <b id="bf-range">—</b></div>
          <div className="bf-row">State: <b id="bf-state">—</b></div>
        </div>

        {/* WHY ENGINE */}
        <div id="brain-why">
          <div className="bw-label">WHY ENGINE</div>
          <div className="bw-state wait" id="bw-state">WAIT</div>
          <div className="bw-reasons" id="bw-reasons"><span>—</span></div>
        </div>

      </div>

      {/* COMPAT: hidden IDs needed by existing JS */}
      <div className="znc-compat">
        <div id="brainRegimeBadge3"></div>
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
        <div id="brainCoreBg"></div>
        <div id="zncScoreNum2"></div>
        {/* neuron divs for setNeuron() */}
        {['rsi','macd','st','vol','fr','mag','reg','ofi'].map(n => (
          <div key={n} id={`bn-${n}`} className="neuron inactive">
            <div className="ndot"></div><span></span><span className="nval" id={`bnv-${n}`}>—</span>
          </div>
        ))}
      </div>

    </div>
  )
}
