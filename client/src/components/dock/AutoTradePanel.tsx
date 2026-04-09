import { useState, useEffect } from 'react'
import { useATStore, usePositionsStore } from '../../stores'
import { api } from '../../services/api'

/** 1:1 port of .at-sep + #atPanel from public/index.html lines 1684-2033 */
export function AutoTradePanel() {
  const enabled = useATStore((s) => s.enabled)
  const mode = useATStore((s) => s.mode)
  const killTriggered = useATStore((s) => s.killTriggered)
  const totalTrades = useATStore((s) => s.totalTrades)
  const wins = useATStore((s) => s.wins)
  const totalPnL = useATStore((s) => s.totalPnL)
  const dailyPnL = useATStore((s) => s.dailyPnL)
  const demoBalance = usePositionsStore((s) => s.demoBalance)
  const [bextOpen, setBextOpen] = useState(false)

  const winRate = totalTrades > 0 ? ((wins / totalTrades) * 100).toFixed(1) : '—'

  const [confMin, setConfMin] = useState(65)
  const [sigMin, setSigMin] = useState(3)
  const [atSize, setAtSize] = useState(200)
  const [atRiskPct, setAtRiskPct] = useState(1)
  const [atMaxDay, setAtMaxDay] = useState(5)
  const [atMaxPos, setAtMaxPos] = useState(3)
  const [atSL, setAtSL] = useState(1.5)
  const [atRR, setAtRR] = useState(2)
  const [atKillPct, setAtKillPct] = useState(5)
  const [atLossStreak, setAtLossStreak] = useState(3)
  const [atMaxAddon, setAtMaxAddon] = useState(2)
  const [atLev, setAtLev] = useState('5')
  const [adaptEnabled, setAdaptEnabled] = useState(false)
  const [adaptLive, setAdaptLive] = useState(false)
  const [smartExit, setSmartExit] = useState(false)
  const [brainVisionOpen, setBrainVisionOpen] = useState(true)
  const [brainDashOpen, setBrainDashOpen] = useState(true)
  const [symPickerOpen, setSymPickerOpen] = useState(false)

  // Init AT settings from saved user settings (localStorage) so values survive refresh.
  // Old JS (_usApply in config.ts) also sets DOM input values, but React controlled
  // inputs reset them on re-render. Reading from localStorage at mount fixes this.
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('zeus_user_settings') || '{}')
      const at = saved.autoTrade
      if (!at) return
      if (at.confMin != null)      setConfMin(Number(at.confMin))
      if (at.sigMin != null)       setSigMin(Number(at.sigMin))
      if (at.size != null)         setAtSize(Number(at.size))
      if (at.riskPct != null)      setAtRiskPct(Number(at.riskPct))
      if (at.maxDay != null)       setAtMaxDay(Number(at.maxDay))
      if (at.maxPos != null)       setAtMaxPos(Number(at.maxPos))
      if (at.sl != null)           setAtSL(Number(at.sl))
      if (at.rr != null)           setAtRR(Number(at.rr))
      if (at.killPct != null)      setAtKillPct(Number(at.killPct))
      if (at.lossStreak != null)   setAtLossStreak(Number(at.lossStreak))
      if (at.maxAddon != null)     setAtMaxAddon(Number(at.maxAddon))
      if (at.lev != null)          setAtLev(String(at.lev))
      if (at.adaptEnabled != null) setAdaptEnabled(!!at.adaptEnabled)
      if (at.adaptLive != null)    setAdaptLive(!!at.adaptLive)
      if (at.smartExitEnabled != null) setSmartExit(!!at.smartExitEnabled)
    } catch { /* ignore malformed storage */ }
  }, [])

  async function handleKill() {
    await api.post('/api/at/kill', { reason: 'manual' })
  }

  function handleToggle() {
    const w = window as any
    if (typeof w.toggleAutoTrade === 'function') w.toggleAutoTrade()
  }

  return (
    <>
    {/* ═══ AT SEPARATOR — neon lines + toggle + status (1:1 from .at-sep) ═══ */}
    <div className="at-sep" style={{ display: 'flex' }}>
      {/* Neural Data Stream toggle */}
      <button className="bext-toggle-btn" onClick={() => setBextOpen(!bextOpen)}>
        {bextOpen ? '▲' : '▼'} NEURAL DATA STREAM (tap to expand)
      </button>

        <div className="bext show" id="brainExt" style={bextOpen ? undefined : { display: 'none' }}>
          <div className="bext-bg"></div>
          <div className="bext-top">
            <div className="bext-title">⬡ NEURAL DATA STREAM ⬡ QUANTUM ANALYTICS</div>
            {/* Quantum Clock SVG */}
            <div className="qclock">
              <svg className="qclock-svg" viewBox="0 0 56 56" id="qclockSvg">
                <circle cx="28" cy="28" r="26" fill="none" stroke="#1a0a30" strokeWidth="1.5" />
                <circle cx="28" cy="28" r="22" fill="none" stroke="#2a0a4a" strokeWidth="1" strokeDasharray="4 4" />
                {/* Second arc - fills up each minute */}
                <circle cx="28" cy="28" r="19" fill="none" stroke="#aa44ff" strokeWidth="3" strokeDasharray="0 120"
                  strokeLinecap="round" id="qSecArc" transform="rotate(-90 28 28)"
                  style={{ transition: 'stroke-dasharray 1s linear' }} />
                {/* Hour markers */}
                <line x1="28" y1="4" x2="28" y2="8" stroke="#3a1060" strokeWidth="1.5" />
                <line x1="52" y1="28" x2="48" y2="28" stroke="#3a1060" strokeWidth="1.5" />
                <line x1="28" y1="52" x2="28" y2="48" stroke="#3a1060" strokeWidth="1.5" />
                <line x1="4" y1="28" x2="8" y2="28" stroke="#3a1060" strokeWidth="1.5" />
                {/* Center dot */}
                <circle cx="28" cy="28" r="2" fill="#aa44ff" id="qClockCenter" />
                {/* Hour hand */}
                <line id="qHourHand" x1="28" y1="28" x2="28" y2="14" stroke="#aa44ff" strokeWidth="2"
                  strokeLinecap="round" style={{ transformOrigin: '28px 28px' }} />
                {/* Min hand */}
                <line id="qMinHand" x1="28" y1="28" x2="28" y2="10" stroke="#cc88ff" strokeWidth="1.5"
                  strokeLinecap="round" style={{ transformOrigin: '28px 28px' }} />
                {/* Sec hand */}
                <line id="qSecHand" x1="28" y1="32" x2="28" y2="6" stroke="#00ff88" strokeWidth="1"
                  strokeLinecap="round" style={{ transformOrigin: '28px 28px' }} />
                {/* UTC label */}
                <text x="28" y="38" textAnchor="middle" fill="#3a1060" fontSize="4" fontFamily="monospace">RO</text>
                <text x="28" y="44" textAnchor="middle" fill="#aa44ff" fontSize="5" fontFamily="monospace"
                  id="qClockTime">00:00</text>
              </svg>
            </div>
            <div className="market-phase dead" id="brainMarketPhase">LOADING</div>
          </div>
          {/* Session Backtest Box */}
          <div className="sess-bt" id="sessBacktestBox" style={{ padding: '2px 8px 4px' }}></div>

          {/* Price Action */}
          <div style={{ fontSize: '6px', letterSpacing: '2px', color: '#1a0830', padding: '4px 10px 2px' }}>PRICE ACTION — 7 SIMBOLURI LIVE</div>
          <div id="symPulseRows"></div>

          {/* Momentum Heatmap */}
          <div style={{ fontSize: '6px', letterSpacing: '2px', color: '#1a0830', padding: '4px 10px 0' }}>MOMENTUM HEATMAP</div>
          <div className="nheat" id="brainHeatmap"></div>

          {/* Risk Gauges */}
          <div style={{ fontSize: '6px', letterSpacing: '2px', color: '#1a0830', padding: '4px 10px 0' }}>RISK MATRIX</div>
          {[
            { label: 'VOLATILITATE', id: 'vol' },
            { label: 'RISC POZITII', id: 'pos' },
            { label: 'SENTIMENT', id: 'sent' },
            { label: 'CONFLUENTA', id: 'conf' },
          ].map((g, i) => (
            <div className="risk-gauge" key={g.id} style={i === 3 ? { borderTop: 'none', paddingBottom: '6px' } : undefined}>
              <div className="risk-label">{g.label}</div>
              <div className="risk-gauge-track"><div className="risk-gauge-fill" id={`rg-${g.id}`} style={{ width: '0%' }}></div></div>
              <div className="risk-val" id={`rgv-${g.id}`} style={{ color: '#555' }}>—</div>
            </div>
          ))}

          {/* Data stream ticker */}
          <div className="dstream"><div className="dstream-inner" id="dstreamInner"></div></div>
        </div>

      <div className="at-line"></div>
      <div className="at-center">
        <div className="at-label">
          <svg className="z-i z-i--brand" viewBox="0 0 16 16" style={{ color: '#f0c040' }}><path d="M9 1L4 9h4l-1 6 5-8H8l1-6" /></svg>
          {' '}ZEUS AUTO TRADE{' '}
          <svg className="z-i z-i--brand" viewBox="0 0 16 16" style={{ color: '#f0c040' }}><path d="M9 1L4 9h4l-1 6 5-8H8l1-6" /></svg>
        </div>
        <button className={`at-main-btn ${enabled ? 'on' : 'off'}`} id="atMainBtn" onClick={handleToggle}>
          <span id="atBtnDot" style={{ width: '8px', height: '8px', borderRadius: '50%', background: enabled ? '#00ff88' : '#aa44ff', boxShadow: enabled ? '0 0 6px #00ff88' : '0 0 6px #aa44ff' }}></span>
          <span id="atBtnTxt">{enabled ? 'AUTO TRADE ON' : 'AUTO TRADE OFF'}</span>
        </button>
        <div className="at-status" id="atStatus">{enabled ? 'SERVER AT ACTIVE — brain controls execution' : 'Configureaza mai jos'}</div>
        <div id="at-why-blocked"></div>
        {/* Sentinel Health Indicator */}
        <div id="zt-sentinel-bar"
          style={{ display: 'none', fontSize: '7px', fontFamily: 'monospace', letterSpacing: '1px', padding: '2px 6px', borderRadius: '3px', marginTop: '3px', textAlign: 'center' }}>
        </div>
      </div>
      <div className="at-line"></div>
    </div>

    {/* ═══ AT PANEL ═══ */}
    <div className="at-panel" id="atPanel">
      <div className="at-hdr">
        <span>ZEUS AI AUTO TRADE ENGINE</span>
        <span id="atModeLabel" style={{ fontSize: '8px', color: '#aa44ff', letterSpacing: '1px' }}>{mode.toUpperCase()}</span>
      </div>
      <div className="at-body">
        <div style={{ textAlign: 'center', padding: '8px 0 4px' }}>
          <a href="/journal.html" style={{ fontSize: '11px', color: 'var(--bg)', background: 'var(--gold)', textDecoration: 'none', letterSpacing: '1px', padding: '6px 18px', borderRadius: '4px', fontWeight: 700, display: 'inline-block' }}>FULL JOURNAL</a>
        </div>

        {/* MODE */}
        <div className="at-row">
          <div className="at-field">
            <div className="at-lbl">GLOBAL MODE</div>
            <div id="atModeDisplay" className="at-sel" style={{ background: '#0a0a1a', border: '1px solid #aa44ff44', padding: '6px 8px', borderRadius: '4px', fontSize: '10px', color: '#aa44ff', letterSpacing: '1px', textAlign: 'center', cursor: 'default' }}>
              {mode.toUpperCase()} MODE
            </div>
          </div>
          <div className="at-field">
            <div className="at-lbl">LEVERAGE AUTO</div>
            <select className="at-sel" id="atLev" value={atLev} onChange={e => setAtLev(e.target.value)}>
              <option value="2">2x</option>
              <option value="5">5x</option>
              <option value="10">10x</option>
              <option value="20">20x</option>
            </select>
          </div>
        </div>

        {/* TRADING SYMBOLS (multi-symbol) */}
        <div className="at-condition" id="atSymbolSection" style={{ display: 'none' }}>
          <div className="at-cond-title">TRADING SYMBOLS</div>
          <div id="atSymbolGrid" style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', padding: '4px 0' }}></div>
          <div style={{ fontSize: '7px', color: '#556', marginTop: '4px' }}>Select which symbols the AT engine trades for you</div>
        </div>

        {/* ENTRY CONDITIONS */}
        <div className="at-condition">
          <div className="at-cond-title">CONDITII INTRARE (toate trebuie OK)</div>
          <div className="at-cond-row">
            <span className="at-cond-name">Confluence Score</span>
            <span>≥ <input type="number" id="atConfMin" value={confMin} onChange={e => setConfMin(+e.target.value)} min={50} max={95} className="at-inp" style={{ width: '52px', display: 'inline', padding: '2px 4px', fontSize: '9px' }} /> <span className="at-cond-val wait" id="atCondConf">—</span></span>
          </div>
          <div className="at-cond-row">
            <span className="at-cond-name">Semnale aliniate</span>
            <span>≥ <input type="number" id="atSigMin" value={sigMin} onChange={e => setSigMin(+e.target.value)} min={2} max={6} className="at-inp" style={{ width: '40px', display: 'inline', padding: '2px 4px', fontSize: '9px' }} /> <span className="at-cond-val wait" id="atCondSig">—</span></span>
          </div>
        </div>

        {/* ADVANCED CONTROLS */}
        <div className="at-condition">
          <div className="at-cond-title">ADVANCED CONTROLS</div>
          <label className="mchk" style={{ padding: '4px 0' }}>
            <input type="checkbox" id="atAdaptEnabled" checked={adaptEnabled} onChange={e => setAdaptEnabled(e.target.checked)} />
            Enable Adaptive Mode (master)
          </label>
          <label className="mchk" style={{ padding: '4px 0' }}>
            <input type="checkbox" id="atAdaptLive" checked={adaptLive} onChange={e => setAdaptLive(e.target.checked)} />
            Allow live position adjustment
          </label>
          <div className="hub-disabled-notice" style={{ margin: '2px 0 6px 18px', fontSize: '8px', color: '#556' }}>When OFF: all macro multipliers = ×1.00, no entry/sizing changes.</div>
          <label className="mchk" style={{ padding: '4px 0' }}>
            <input type="checkbox" id="atSmartExit" checked={smartExit} onChange={e => setSmartExit(e.target.checked)} />
            Enable Smart Exit (auto-exec)
          </label>
          <div className="hub-disabled-notice" style={{ margin: '2px 0 6px 18px', fontSize: '8px', color: '#556' }}>When OFF: advisory only. When ON: emergency exits may execute if signals double-confirmed + cooldown.</div>
        </div>

        {/* RISK MANAGEMENT */}
        <div className="at-condition">
          <div className="at-cond-title">RISK MANAGEMENT</div>
          <div className="at-cond-row"><span className="at-cond-name">Size per Trade</span><span><input type="number" id="atSize" value={atSize} onChange={e => setAtSize(+e.target.value)} min={10} step={10} className="at-inp" style={{ width: '65px', display: 'inline', padding: '2px 4px', fontSize: '9px' }} /> USDT</span></div>
          <div className="at-cond-row"><span className="at-cond-name">Risk % / Trade</span><span><input type="number" id="atRiskPct" value={atRiskPct} onChange={e => setAtRiskPct(+e.target.value)} min={0.1} max={5} step={0.1} className="at-inp" style={{ width: '50px', display: 'inline', padding: '2px 4px', fontSize: '9px' }} /> %</span></div>
          <div className="at-cond-row"><span className="at-cond-name">Max Trades / Day</span><span><input type="number" id="atMaxDay" value={atMaxDay} onChange={e => setAtMaxDay(+e.target.value)} min={1} max={20} className="at-inp" style={{ width: '40px', display: 'inline', padding: '2px 4px', fontSize: '9px' }} /> /day</span></div>
          <div className="at-cond-row"><span className="at-cond-name">Max Open Positions</span><span><input type="number" id="atMaxPos" value={atMaxPos} onChange={e => setAtMaxPos(+e.target.value)} min={1} max={10} className="at-inp" style={{ width: '40px', display: 'inline', padding: '2px 4px', fontSize: '9px' }} /> pos</span></div>
          <div className="at-cond-row"><span className="at-cond-name">Stop Loss</span><span><input type="number" id="atSL" value={atSL} onChange={e => setAtSL(+e.target.value)} min={0.3} max={10} step={0.1} className="at-inp" style={{ width: '55px', display: 'inline', padding: '2px 4px', fontSize: '9px' }} /> %</span></div>
          <div className="at-cond-row"><span className="at-cond-name">Take Profit (R:R)</span><span><input type="number" id="atRR" value={atRR} onChange={e => setAtRR(+e.target.value)} min={1} max={5} step={0.5} className="at-inp" style={{ width: '40px', display: 'inline', padding: '2px 4px', fontSize: '9px' }} /> :1</span></div>
          <div className="at-cond-row"><span className="at-cond-name">Drawdown % / Day</span><span><input type="number" id="atKillPct" value={atKillPct} onChange={e => setAtKillPct(+e.target.value)} min={1} max={20} step={0.5} className="at-inp" style={{ width: '45px', display: 'inline', padding: '2px 4px', fontSize: '9px' }} /> %</span></div>
          <div className="at-cond-row"><span className="at-cond-name">Loss Streak Limit</span><span><input type="number" id="atLossStreak" value={atLossStreak} onChange={e => setAtLossStreak(+e.target.value)} min={1} max={10} className="at-inp" style={{ width: '40px', display: 'inline', padding: '2px 4px', fontSize: '9px' }} /> losses</span></div>
          <div className="at-cond-row"><span className="at-cond-name">Max Add-ons</span><span><input type="number" id="atMaxAddon" value={atMaxAddon} onChange={e => setAtMaxAddon(+e.target.value)} min={0} max={5} className="at-inp" style={{ width: '40px', display: 'inline', padding: '2px 4px', fontSize: '9px' }} /> add-ons</span></div>
          {/* Multi-Symbol Scan row */}
          <div className="at-cond-row" id="atMscanRow" style={{ flexWrap: 'wrap', position: 'relative' }}>
            <span className="at-cond-name">Multi-Symbol Scan</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <input type="checkbox" id="atMultiSym" defaultChecked onChange={() => (window as any).toggleMultiSymMode?.()} />
              <div id="atSymPickerCard" onClick={() => setSymPickerOpen(!symPickerOpen)}
                style={{ cursor: 'pointer', background: 'linear-gradient(135deg,#1a1030,#0d0a1a)', border: '1px solid #aa44ff33', borderRadius: '4px', padding: '3px 8px', display: 'flex', alignItems: 'center', gap: '5px', transition: 'border-color .2s' }}>
                <span style={{ color: '#aa44ff', fontSize: '8px', fontWeight: 700 }} id="atMultiSymLbl">ACTIV — 8 simboluri</span>
                <span style={{ color: '#aa44ff', fontSize: '7px' }}>▼</span>
              </div>
            </div>
            {symPickerOpen && (
              <div id="atSymPickerDrop"
                style={{ position: 'absolute', right: 0, top: '100%', zIndex: 999, background: '#0d0a1a', border: '1px solid #aa44ff44', borderRadius: '6px', padding: '8px', minWidth: '180px', boxShadow: '0 8px 24px rgba(0,0,0,.6)', marginTop: '4px' }}>
                <div style={{ fontSize: '7px', color: '#aa44ff', fontWeight: 700, marginBottom: '6px', letterSpacing: '1px' }}>SELECTEAZA SIMBOLURI</div>
                <div id="atSymPickerList" style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}></div>
                <div style={{ display: 'flex', gap: '4px', marginTop: '8px', borderTop: '1px solid #1a1030', paddingTop: '6px' }}>
                  <button style={{ flex: 1, background: '#aa44ff22', border: '1px solid #aa44ff44', color: '#aa44ff', fontSize: '7px', padding: '2px 0', borderRadius: '3px', cursor: 'pointer', fontFamily: 'var(--ff)' }}>✓ TOATE</button>
                  <button style={{ flex: 1, background: '#ff335511', border: '1px solid #ff335533', color: '#ff6655', fontSize: '7px', padding: '2px 0', borderRadius: '3px', cursor: 'pointer', fontFamily: 'var(--ff)' }}>✕ NICIUNA</button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* LIVE WARNING */}
        {mode === 'live' && (
          <div className="live-at-warn" id="atLiveWarn">
            <svg className="z-i" viewBox="0 0 16 16" style={{ color: '#ff8800' }}>
              <path d="M8 2L1 14h14L8 2zM8 6v4m0 2h.01" />
            </svg> <strong>LIVE MODE ACTIVE:</strong> Auto trades will execute with REAL funds on Binance.
          </div>
        )}

        {/* STATS */}
        <div className="at-stats">
          <div className="at-stat"><div className="at-stat-l">BALANCE</div><div className="at-stat-v" id="atBalance" style={{ color: 'var(--whi)' }}>${demoBalance.toLocaleString()}</div></div>
          <div className="at-stat"><div className="at-stat-l">AUTO TRADES</div><div className="at-stat-v" id="atTotalTrades" style={{ color: 'var(--whi)' }}>{totalTrades}</div></div>
          <div className="at-stat"><div className="at-stat-l">WIN RATE</div><div className="at-stat-v" id="atWinRate" style={{ color: 'var(--dim)' }}>{winRate}%</div></div>
          <div className="at-stat"><div className="at-stat-l">AUTO PnL</div><div className="at-stat-v" id="atTotalPnL" style={{ color: totalPnL >= 0 ? 'var(--grn)' : 'var(--red)' }}>${totalPnL.toFixed(2)}</div></div>
          <div className="at-stat"><div className="at-stat-l" id="atDailyLabel">DAILY P&amp;L</div><div className="at-stat-v" id="atDailyLoss" style={{ color: dailyPnL >= 0 ? 'var(--grn)' : 'var(--red)' }}>${dailyPnL.toFixed(2)}</div></div>
        </div>

        {/* LOG */}
        <div style={{ fontSize: '7px', letterSpacing: '2px', color: 'var(--dim)', marginBottom: '3px' }}>ACTIVITY LOG</div>
        <div className="at-log" id="atLog">
          <div className="at-log-row"><span className="at-log-time">--:--</span><span className="at-log-msg info">Auto Trade Engine pornit. Astept semnal...</span></div>
        </div>

        {/* BRAIN VISION */}
        <div id="brainVisionWrap" style={{ margin: '8px 0 6px', border: '1px solid rgba(120,80,220,0.25)', borderRadius: '6px', background: 'rgba(10,6,20,0.6)', overflow: 'hidden' }}>
          <div id="brainVisionHdr" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 10px', cursor: 'pointer', userSelect: 'none' }} onClick={() => setBrainVisionOpen(!brainVisionOpen)}>
            <span style={{ fontSize: '11px', letterSpacing: '2px', color: '#aa44ff', fontWeight: 600 }}>BRAIN VISION</span>
            <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span id="brainVisionCycle" style={{ fontSize: '11px', color: 'var(--dim)' }}>C0</span>
              <span id="brainVisionChev" style={{ fontSize: '12px', color: '#aa44ff' }}>{brainVisionOpen ? '▼' : '▶'}</span>
            </span>
          </div>
          {brainVisionOpen && <div id="brainVisionBody" style={{ padding: '2px 12px 10px', fontFamily: 'monospace', fontSize: '12px', lineHeight: 1.8 }}></div>}
        </div>

        {/* BRAIN DASHBOARD */}
        <div id="brainDashWrap" style={{ margin: '8px 0 6px', border: '1px solid rgba(60,180,220,0.25)', borderRadius: '6px', background: 'rgba(6,12,20,0.7)', overflow: 'hidden' }}>
          <div id="brainDashHdr" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 10px', cursor: 'pointer', userSelect: 'none' }} onClick={() => setBrainDashOpen(!brainDashOpen)}>
            <span style={{ fontSize: '11px', letterSpacing: '2px', color: '#3ab4dc', fontWeight: 600 }}>BRAIN DASHBOARD</span>
            <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span id="brainDashScore" style={{ fontSize: '11px', color: 'var(--dim)' }}></span>
              <span id="brainDashChev" style={{ fontSize: '12px', color: '#3ab4dc' }}>{brainDashOpen ? '▼' : '▶'}</span>
            </span>
          </div>
          {brainDashOpen && <div id="brainDashBody" style={{ padding: '2px 12px 10px', fontFamily: 'monospace', fontSize: '12px', lineHeight: 1.8 }}></div>}
        </div>

        {/* KILL SWITCH */}
        <button className={`at-kill${killTriggered ? ' triggered' : ''}`} id="atKillBtn" onClick={handleKill}>
          <svg className="z-i" viewBox="0 0 16 16" style={{ color: '#ff3355' }}>
            <path d="M8 1v2m5 2l-1.4 1.4M3 5l1.4 1.4M2 10h2m8 0h2M5 13h6M6 10a2 2 0 014 0" />
          </svg> EMERGENCY STOP — INCHIDE TOATE POZITIILE
        </button>

        {/* ACTIVE AUTO POSITIONS */}
        <div style={{ borderTop: '1px solid #1a1030', paddingTop: '8px', marginTop: '2px' }}>
          <div style={{ fontSize: '7px', letterSpacing: '2px', color: '#aa44ff', marginBottom: '5px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>POZITII ACTIVE AUTO TRADE</span>
            <span id="atPosCount" style={{ color: 'var(--dim)' }}>0 pozitii</span>
          </div>
          <div id="atActivePosPanel" style={{ minHeight: '32px' }}>
            <div style={{ textAlign: 'center', fontSize: '8px', color: 'var(--dim)', padding: '8px' }}>Nicio pozitie auto deschisa</div>
          </div>
        </div>

      </div>
    </div>
    </>
  )
}
