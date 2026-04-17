import { useState, useEffect, useMemo } from 'react'
import { useATStore, useSettingsStore } from '../../stores'
import { api } from '../../services/api'
import { MSCAN_SYMS } from '../../core/config'
import { resetKillSwitch } from '../../trading/autotrade'

/** Parse a string input to number for save; empty/invalid → fallback. */
function toNum(s: string, fallback: number): number {
  if (s == null || s === '') return fallback
  const n = Number(s)
  return Number.isFinite(n) ? n : fallback
}

/** 1:1 port of .at-sep + #atPanel from public/index.html lines 1684-2033 */
export function AutoTradePanel() {
  const enabled = useATStore((s) => s.enabled)
  const mode = useATStore((s) => s.mode)
  const killTriggered = useATStore((s) => s.killTriggered)
  const ui = useATStore((s) => s.ui)
  const [bextOpen, setBextOpen] = useState(false)

  // Numeric fields are held as STRINGS so the user can fully clear the input
  // (value === "") without React forcing a leading "0" back in. We parse to
  // number only on save / when the engines need it via _syncToWindow.
  const [confMin, setConfMin] = useState('65')
  const [sigMin, setSigMin] = useState('3')
  const [atSize, setAtSize] = useState('200')
  const [atRiskPct, setAtRiskPct] = useState('1')
  const [atMaxDay, setAtMaxDay] = useState('5')
  const [atMaxPos, setAtMaxPos] = useState('3')
  const [atSL, setAtSL] = useState('1.5')
  const [atRR, setAtRR] = useState('2')
  const [atKillPct, setAtKillPct] = useState('5')
  const [atLossStreak, setAtLossStreak] = useState('3')
  const [atMaxAddon, setAtMaxAddon] = useState('2')
  const [atLev, setAtLev] = useState('5')
  const [adaptEnabled, setAdaptEnabled] = useState(false)
  const [adaptLive, setAdaptLive] = useState(false)
  const [smartExit, setSmartExit] = useState(false)
  const [brainVisionOpen, setBrainVisionOpen] = useState(true)
  const [brainDashOpen, setBrainDashOpen] = useState(true)
  const [symPickerOpen, setSymPickerOpen] = useState(false)

  // Multi-symbol scan state — reactive label + picker
  const [mscanEnabled, setMscanEnabled] = useState(true)
  const [mscanSyms, setMscanSyms] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem('zeus_mscan_syms')
      if (saved) {
        const arr = JSON.parse(saved)
        if (Array.isArray(arr) && arr.length > 0) return arr
      }
    } catch (_) { /* */ }
    return MSCAN_SYMS.slice()
  })

  // Re-hydrate whenever the server settings load/change. The store is
  // populated asynchronously by useServerSync — without this subscription
  // the fields stay at their defaults after F5.
  const storeSettings = useSettingsStore((s) => s.settings)
  const storeLoaded = useSettingsStore((s) => s.loaded)
  useEffect(() => {
    if (!storeLoaded) return
    const s = storeSettings
    if (s.confMin != null)      setConfMin(String(s.confMin))
    if (s.sigMin != null)       setSigMin(String(s.sigMin))
    if (s.size != null)         setAtSize(String(s.size))
    if (s.riskPct != null)      setAtRiskPct(String(s.riskPct))
    if (s.maxDay != null)       setAtMaxDay(String(s.maxDay))
    if (s.maxPos != null)       setAtMaxPos(String(s.maxPos))
    if (s.sl != null)           setAtSL(String(s.sl))
    if (s.rr != null)           setAtRR(String(s.rr))
    if (s.killPct != null)      setAtKillPct(String(s.killPct))
    if (s.lossStreak != null)   setAtLossStreak(String(s.lossStreak))
    if (s.maxAddon != null)     setAtMaxAddon(String(s.maxAddon))
    if (s.lev != null)          setAtLev(String(s.lev))
    if (s.adaptEnabled != null) setAdaptEnabled(!!s.adaptEnabled)
    if (s.adaptLive != null)    setAdaptLive(!!s.adaptLive)
    if (s.smartExitEnabled != null) setSmartExit(!!s.smartExitEnabled)
    if (s.mscanEnabled != null) setMscanEnabled(!!s.mscanEnabled)
    if (Array.isArray(s.mscanSyms) && s.mscanSyms.length > 0) setMscanSyms(s.mscanSyms)
  }, [storeLoaded, storeSettings])

  // Persist mscan selection to localStorage whenever it changes so legacy
  // engines (data/klines.ts::_mscanGetActive) read the same source of truth.
  useEffect(() => {
    try { localStorage.setItem('zeus_mscan_syms', JSON.stringify(mscanSyms)) } catch (_) {}
  }, [mscanSyms])

  // Phase 3 C4: push the 6 AT config fields (lev/size/slPct/rr/maxPos/sigMin)
  // into atStore.config on every edit, so atStore (and by extension the
  // TC Proxy installed in core/state.ts) reflects the panel value without
  // waiting for Save. NaN (from empty/invalid input) is guarded-out by
  // patchConfig, leaving the previous store value intact. adxMin + cooldownMs
  // are not panel inputs and stay on their hydrated/default values.
  useEffect(() => {
    const _n = (s: string) => {
      if (s == null || s === '') return NaN
      const v = Number(s)
      return Number.isFinite(v) ? v : NaN
    }
    useATStore.getState().patchConfig({
      lev: _n(atLev),
      size: _n(atSize),
      slPct: _n(atSL),
      rr: _n(atRR),
      maxPos: _n(atMaxPos),
      sigMin: _n(sigMin),
    })
  }, [atLev, atSize, atSL, atRR, atMaxPos, sigMin])

  // Close the sym picker on outside click (React owns state now — legacy
  // document-level listener in klines.ts only mutates DOM style and would
  // desync with React state).
  useEffect(() => {
    if (!symPickerOpen) return
    function onDocClick(e: MouseEvent) {
      const target = e.target as HTMLElement | null
      if (!target) return
      if (target.closest('#atSymPickerDrop')) return
      if (target.closest('#atSymPickerCard')) return
      setSymPickerOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [symPickerOpen])

  const mscanLabel = useMemo(() => {
    if (!mscanEnabled) return 'DEZACTIVAT'
    return 'ACTIV — ' + mscanSyms.length + ' simboluri'
  }, [mscanEnabled, mscanSyms])

  function toggleSym(sym: string) {
    setMscanSyms((prev) => prev.includes(sym) ? prev.filter((s) => s !== sym) : [...prev, sym])
  }
  function pickAll(all: boolean) {
    setMscanSyms(all ? MSCAN_SYMS.slice() : [])
  }

  async function handleSaveAT() {
    const w = window as any
    try {
      const store = useSettingsStore.getState()
      store.patch({
        sl: toNum(atSL, 1.5), rr: toNum(atRR, 2),
        size: toNum(atSize, 200), riskPct: toNum(atRiskPct, 1),
        maxDay: toNum(atMaxDay, 5), maxPos: toNum(atMaxPos, 3),
        killPct: toNum(atKillPct, 5), lossStreak: toNum(atLossStreak, 3),
        maxAddon: toNum(atMaxAddon, 2), lev: toNum(atLev, 5),
        confMin: toNum(confMin, 65), sigMin: toNum(sigMin, 3),
        adaptEnabled, adaptLive, smartExitEnabled: smartExit,
        mscanEnabled, mscanSyms,
      })
      await store.saveToServer()
      if (typeof w.saveUserSettings === 'function') w.saveUserSettings()
      if (typeof w.toast === 'function') w.toast('AT settings saved ✓')
    } catch (err: any) {
      console.error('[AT] Save failed:', err)
      if (typeof w.toast === 'function') w.toast('Save failed: ' + (err?.message || 'unknown'))
    }
  }

  async function handleKill() {
    await api.post('/api/at/kill', { reason: 'manual' })
  }

  const [toggling, setToggling] = useState(false)
  function handleToggle() {
    if (toggling) return // guard against rapid double-click
    setToggling(true)
    const w = window as any
    if (typeof w.toggleAutoTrade === 'function') w.toggleAutoTrade()
    setTimeout(() => setToggling(false), 1000) // unlock after 1s
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
        <button className={ui.btnClass} onClick={handleToggle} disabled={toggling}>
          <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: ui.dotBg, boxShadow: ui.dotShadow }}></span>
          <span>{ui.btnText}</span>
        </button>
        <div className="at-status">
          <span dangerouslySetInnerHTML={{ __html: ui.statusHtml }} />
          {ui.statusAction === 'resetKill' && (
            <button data-action="resetKillSwitch" onClick={() => resetKillSwitch()}
              style={{ color: '#00ff88', background: 'none', border: '1px solid #00ff8866', borderRadius: '2px', padding: '1px 5px', fontSize: '11px', cursor: 'pointer', fontFamily: 'inherit', marginLeft: '4px' }}>
              RESET KILL SWITCH
            </button>
          )}
        </div>
        <div id="at-why-blocked"></div>
        {ui.sentinelVisible && (
          <div style={{ fontSize: '7px', fontFamily: 'monospace', letterSpacing: '1px', padding: '2px 6px', borderRadius: '3px', marginTop: '3px', textAlign: 'center', background: ui.sentinelBg, color: ui.sentinelColor, border: ui.sentinelBorder }}
            dangerouslySetInnerHTML={{ __html: ui.sentinelHtml }} />
        )}
      </div>
      <div className="at-line"></div>
    </div>

    {/* ═══ AT PANEL ═══ */}
    <div className="at-panel" id="atPanel">
      <div className="at-hdr">
        <span>ZEUS AI AUTO TRADE ENGINE</span>
        <span style={{ fontSize: '8px', color: ui.modeLabelColor, letterSpacing: '1px' }} dangerouslySetInnerHTML={{ __html: ui.modeLabelHtml }} />
      </div>
      <div className="at-body">
        <div style={{ textAlign: 'center', padding: '8px 0 4px' }}>
          <a href="/journal.html" style={{ fontSize: '11px', color: 'var(--bg)', background: 'var(--gold)', textDecoration: 'none', letterSpacing: '1px', padding: '6px 18px', borderRadius: '4px', fontWeight: 700, display: 'inline-block' }}>FULL JOURNAL</a>
        </div>

        {/* MODE */}
        <div className="at-row">
          <div className="at-field">
            <div className="at-lbl">GLOBAL MODE</div>
            <div className="at-sel" style={{ background: '#0a0a1a', border: `1px solid ${ui.modeDisplayBorder}`, padding: '6px 8px', borderRadius: '4px', fontSize: '10px', color: ui.modeDisplayColor, letterSpacing: '1px', textAlign: 'center', cursor: 'default' }}
              dangerouslySetInnerHTML={{ __html: ui.modeDisplayHtml }} />
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
            <span>≥ <input type="number" id="atConfMin" value={confMin} onChange={e => setConfMin(e.target.value)} min={50} max={95} className="at-inp" style={{ width: '52px', display: 'inline', padding: '2px 4px', fontSize: '9px' }} /> <span className={ui.condConfClass}>{ui.condConf}</span></span>
          </div>
          <div className="at-cond-row">
            <span className="at-cond-name">Semnale aliniate</span>
            <span>≥ <input type="number" id="atSigMin" value={sigMin} onChange={e => setSigMin(e.target.value)} min={2} max={6} className="at-inp" style={{ width: '40px', display: 'inline', padding: '2px 4px', fontSize: '9px' }} /> <span className={ui.condSigClass}>{ui.condSig}</span></span>
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
          <div className="at-cond-row"><span className="at-cond-name">Size per Trade</span><span><input type="number" id="atSize" value={atSize} onChange={e => setAtSize(e.target.value)} min={10} step={10} className="at-inp" style={{ width: '65px', display: 'inline', padding: '2px 4px', fontSize: '9px' }} /> USDT</span></div>
          <div className="at-cond-row"><span className="at-cond-name">Risk % / Trade</span><span><input type="number" id="atRiskPct" value={atRiskPct} onChange={e => setAtRiskPct(e.target.value)} min={0.1} max={5} step={0.1} className="at-inp" style={{ width: '50px', display: 'inline', padding: '2px 4px', fontSize: '9px' }} /> %</span></div>
          <div className="at-cond-row"><span className="at-cond-name">Max Trades / Day</span><span><input type="number" id="atMaxDay" value={atMaxDay} onChange={e => setAtMaxDay(e.target.value)} min={1} max={20} className="at-inp" style={{ width: '40px', display: 'inline', padding: '2px 4px', fontSize: '9px' }} /> /day</span></div>
          <div className="at-cond-row"><span className="at-cond-name">Max Open Positions</span><span><input type="number" id="atMaxPos" value={atMaxPos} onChange={e => setAtMaxPos(e.target.value)} min={1} max={10} className="at-inp" style={{ width: '40px', display: 'inline', padding: '2px 4px', fontSize: '9px' }} /> pos</span></div>
          <div className="at-cond-row"><span className="at-cond-name">Stop Loss</span><span><input type="number" id="atSL" value={atSL} onChange={e => setAtSL(e.target.value)} min={0.3} max={10} step={0.1} className="at-inp" style={{ width: '55px', display: 'inline', padding: '2px 4px', fontSize: '9px' }} /> %</span></div>
          <div className="at-cond-row"><span className="at-cond-name">Take Profit (R:R)</span><span><input type="number" id="atRR" value={atRR} onChange={e => setAtRR(e.target.value)} min={1} max={5} step={0.5} className="at-inp" style={{ width: '40px', display: 'inline', padding: '2px 4px', fontSize: '9px' }} /> :1</span></div>
          <div className="at-cond-row"><span className="at-cond-name">Drawdown % / Day</span><span><input type="number" id="atKillPct" value={atKillPct} onChange={e => setAtKillPct(e.target.value)} min={1} max={20} step={0.5} className="at-inp" style={{ width: '45px', display: 'inline', padding: '2px 4px', fontSize: '9px' }} /> %</span></div>
          <div className="at-cond-row"><span className="at-cond-name">Loss Streak Limit</span><span><input type="number" id="atLossStreak" value={atLossStreak} onChange={e => setAtLossStreak(e.target.value)} min={1} max={10} className="at-inp" style={{ width: '40px', display: 'inline', padding: '2px 4px', fontSize: '9px' }} /> losses</span></div>
          <div className="at-cond-row"><span className="at-cond-name">Max Add-ons</span><span><input type="number" id="atMaxAddon" value={atMaxAddon} onChange={e => setAtMaxAddon(e.target.value)} min={0} max={5} className="at-inp" style={{ width: '40px', display: 'inline', padding: '2px 4px', fontSize: '9px' }} /> add-ons</span></div>
          {/* Multi-Symbol Scan row */}
          <div className="at-cond-row" id="atMscanRow" style={{ flexWrap: 'wrap', position: 'relative' }}>
            <span className="at-cond-name">Multi-Symbol Scan</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <input
                type="checkbox"
                id="atMultiSym"
                checked={mscanEnabled}
                onChange={(e) => setMscanEnabled(e.target.checked)}
              />
              <div id="atSymPickerCard" onClick={() => setSymPickerOpen(!symPickerOpen)}
                style={{ cursor: 'pointer', background: 'linear-gradient(135deg,#1a1030,#0d0a1a)', border: '1px solid #aa44ff33', borderRadius: '4px', padding: '3px 8px', display: 'flex', alignItems: 'center', gap: '5px', transition: 'border-color .2s' }}>
                <span style={{ color: '#aa44ff', fontSize: '8px', fontWeight: 700 }} id="atMultiSymLbl">{mscanLabel}</span>
                <span style={{ color: '#aa44ff', fontSize: '7px' }}>▼</span>
              </div>
            </div>
            {symPickerOpen && (
              <div id="atSymPickerDrop"
                style={{ position: 'absolute', right: 0, top: '100%', zIndex: 999, background: '#0d0a1a', border: '1px solid #aa44ff44', borderRadius: '6px', padding: '8px', minWidth: '180px', boxShadow: '0 8px 24px rgba(0,0,0,.6)', marginTop: '4px' }}
                onClick={(e) => e.stopPropagation()}>
                <div style={{ fontSize: '7px', color: '#aa44ff', fontWeight: 700, marginBottom: '6px', letterSpacing: '1px' }}>
                  SELECTEAZA SIMBOLURI ({mscanSyms.length}/{MSCAN_SYMS.length})
                </div>
                <div id="atSymPickerList" style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                  {MSCAN_SYMS.map((sym) => {
                    const short = sym.replace('USDT', '')
                    const checked = mscanSyms.includes(sym)
                    return (
                      <label key={sym}
                        style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', padding: '3px 4px', borderRadius: '3px', fontSize: '8px', color: '#ccd' }}>
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleSym(sym)}
                          style={{ accentColor: '#aa44ff' }}
                        />
                        <span style={{ fontWeight: 700, color: '#fff', minWidth: '38px' }}>{short}</span>
                        <span style={{ color: '#556', fontSize: '6px' }}>{sym}</span>
                      </label>
                    )
                  })}
                </div>
                <div style={{ display: 'flex', gap: '4px', marginTop: '8px', borderTop: '1px solid #1a1030', paddingTop: '6px' }}>
                  <button
                    onClick={() => pickAll(true)}
                    style={{ flex: 1, background: '#aa44ff22', border: '1px solid #aa44ff44', color: '#aa44ff', fontSize: '7px', padding: '2px 0', borderRadius: '3px', cursor: 'pointer', fontFamily: 'var(--ff)' }}>
                    ✓ TOATE
                  </button>
                  <button
                    onClick={() => pickAll(false)}
                    style={{ flex: 1, background: '#ff335511', border: '1px solid #ff335533', color: '#ff6655', fontSize: '7px', padding: '2px 0', borderRadius: '3px', cursor: 'pointer', fontFamily: 'var(--ff)' }}>
                    ✕ NICIUNA
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* LIVE WARNING */}
        {ui.liveWarnVisible && (
          <div className="live-at-warn">
            <svg className="z-i" viewBox="0 0 16 16" style={{ color: '#ff8800' }}>
              <path d="M8 2L1 14h14L8 2zM8 6v4m0 2h.01" />
            </svg> <strong>LIVE MODE ACTIVE:</strong> Auto trades will execute with REAL funds on Binance.
          </div>
        )}

        {/* STATS */}
        <div className="at-stats">
          <div className="at-stat"><div className="at-stat-l">BALANCE</div><div className="at-stat-v" style={{ color: ui.balanceColor }}>{ui.balanceText}</div></div>
          <div className="at-stat"><div className="at-stat-l">AUTO TRADES</div><div className="at-stat-v" style={{ color: 'var(--whi)' }}>{ui.totalTradesText}</div></div>
          <div className="at-stat"><div className="at-stat-l">WIN RATE</div><div className="at-stat-v" style={{ color: ui.winRateColor }}>{ui.winRateText}</div></div>
          <div className="at-stat"><div className="at-stat-l">AUTO PnL</div><div className="at-stat-v" style={{ color: ui.totalPnLColor }}>{ui.totalPnLText}</div></div>
          <div className="at-stat"><div className="at-stat-l">{ui.dailyLabel}</div><div className="at-stat-v" style={{ color: ui.dailyLossColor }}>{ui.dailyLossText}</div></div>
        </div>

        {/* LOG */}
        <div style={{ fontSize: '7px', letterSpacing: '2px', color: 'var(--dim)', marginBottom: '3px' }}>ACTIVITY LOG</div>
        <div className="at-log" dangerouslySetInnerHTML={{ __html: ui.logHtml }} />

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

        {/* SAVE SETTINGS */}
        <button className="sbtn2 pri" style={{ width: '100%', marginBottom: 6 }} onClick={handleSaveAT}>
          <svg className="z-i" viewBox="0 0 16 16"><path d="M4 2h5l3 3v9H4V2zm5 0v3h3M6 9h4m-4 2h3" /></svg> SAVE SETTINGS
        </button>

        {/* KILL SWITCH */}
        <button className={`at-kill${killTriggered || ui.killBtnTriggered ? ' triggered' : ''}`} onClick={handleKill}>
          <svg className="z-i" viewBox="0 0 16 16" style={{ color: '#ff3355' }}>
            <path d="M8 1v2m5 2l-1.4 1.4M3 5l1.4 1.4M2 10h2m8 0h2M5 13h6M6 10a2 2 0 014 0" />
          </svg> EMERGENCY STOP — CLOSE ALL POSITIONS
        </button>

        {/* ACTIVE AUTO POSITIONS */}
        <div style={{ borderTop: '1px solid #1a1030', paddingTop: '8px', marginTop: '2px' }}>
          <div style={{ fontSize: '7px', letterSpacing: '2px', color: '#aa44ff', marginBottom: '5px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>ACTIVE AUTO TRADE POSITIONS</span>
            <span style={{ color: 'var(--dim)' }}>{ui.posCountText}</span>
          </div>
          <div id="atActivePosPanel" style={{ minHeight: '32px' }}>
            <div style={{ textAlign: 'center', fontSize: '8px', color: 'var(--dim)', padding: '8px' }}>No active auto positions</div>
          </div>
        </div>

      </div>
    </div>
    </>
  )
}
