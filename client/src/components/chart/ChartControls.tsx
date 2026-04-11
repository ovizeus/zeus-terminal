import { useState, useRef, useEffect } from 'react'
import { useMarketStore, useUiStore } from '../../stores'
import { setTF } from '../../data/marketDataFeeds'
import { togInd as togIndFn } from '../../ui/dom2'
import { togOvr as togOvrFn } from '../../data/marketDataOverlays'
import { toggleSession as toggleSessionFn, toggleVWAP as toggleVWAPFn } from '../../ui/panels'
import { toggleFS as toggleFSFn } from '../../data/marketDataFeeds'

const TIMEFRAMES = ['1m','3m','5m','15m','30m','1h','2h','4h','5h','6h','12h','1d','3d','1w','1M']

const SYMBOLS: { label: string; items: { value: string; label: string }[] }[] = [
  { label: '── TOP 10 ──', items: [
    { value: 'BTCUSDT', label: 'BTC/USDT' },{ value: 'ETHUSDT', label: 'ETH/USDT' },
    { value: 'SOLUSDT', label: 'SOL/USDT' },{ value: 'BNBUSDT', label: 'BNB/USDT' },
    { value: 'XRPUSDT', label: 'XRP/USDT' },{ value: 'DOGEUSDT', label: 'DOGE/USDT' },
    { value: 'ADAUSDT', label: 'ADA/USDT' },{ value: 'AVAXUSDT', label: 'AVAX/USDT' },
    { value: 'LINKUSDT', label: 'LINK/USDT' },{ value: 'DOTUSDT', label: 'DOT/USDT' },
  ]},
  { label: '── DeFi ──', items: [
    { value: 'UNIUSDT', label: 'UNI/USDT' },{ value: 'AAVEUSDT', label: 'AAVE/USDT' },
    { value: 'MKRUSDT', label: 'MKR/USDT' },{ value: 'CRVUSDT', label: 'CRV/USDT' },
    { value: 'LDOUSDT', label: 'LDO/USDT' },{ value: 'SNXUSDT', label: 'SNX/USDT' },
    { value: 'COMPUSDT', label: 'COMP/USDT' },{ value: 'SUSHIUSDT', label: 'SUSHI/USDT' },
    { value: '1INCHUSDT', label: '1INCH/USDT' },{ value: 'BALUSDT', label: 'BAL/USDT' },
  ]},
  { label: '── Layer 1 ──', items: [
    { value: 'MATICUSDT', label: 'MATIC/USDT' },{ value: 'NEARUSDT', label: 'NEAR/USDT' },
    { value: 'ATOMUSDT', label: 'ATOM/USDT' },{ value: 'FTMUSDT', label: 'FTM/USDT' },
    { value: 'ALGOUSDT', label: 'ALGO/USDT' },{ value: 'XLMUSDT', label: 'XLM/USDT' },
    { value: 'TRXUSDT', label: 'TRX/USDT' },{ value: 'VETUSDT', label: 'VET/USDT' },
    { value: 'ICPUSDT', label: 'ICP/USDT' },{ value: 'FILUSDT', label: 'FIL/USDT' },
    { value: 'ETCUSDT', label: 'ETC/USDT' },{ value: 'HBARUSDT', label: 'HBAR/USDT' },
    { value: 'XTZUSDT', label: 'XTZ/USDT' },{ value: 'EOSUSDT', label: 'EOS/USDT' },
    { value: 'FLOWUSDT', label: 'FLOW/USDT' },{ value: 'THETAUSDT', label: 'THETA/USDT' },
    { value: 'EGLDUSDT', label: 'EGLD/USDT' },{ value: 'MINAUSDT', label: 'MINA/USDT' },
  ]},
  { label: '── Layer 2 / ETH ──', items: [
    { value: 'ARBUSDT', label: 'ARB/USDT' },{ value: 'OPUSDT', label: 'OP/USDT' },
    { value: 'STRKUSDT', label: 'STRK/USDT' },{ value: 'IMXUSDT', label: 'IMX/USDT' },
  ]},
  { label: '── AI / Gaming ──', items: [
    { value: 'FETUSDT', label: 'FET/USDT' },{ value: 'RENDERUSDT', label: 'RENDER/USDT' },
    { value: 'WLDUSDT', label: 'WLD/USDT' },{ value: 'INJUSDT', label: 'INJ/USDT' },
    { value: 'RUNEUSDT', label: 'RUNE/USDT' },{ value: 'AXSUSDT', label: 'AXS/USDT' },
    { value: 'SANDUSDT', label: 'SAND/USDT' },{ value: 'MANAUSDT', label: 'MANA/USDT' },
    { value: 'GALAUSDT', label: 'GALA/USDT' },{ value: 'APEUSDT', label: 'APE/USDT' },
  ]},
  { label: '── Exchange / Misc ──', items: [
    { value: 'LTCUSDT', label: 'LTC/USDT' },{ value: 'BCHUSDT', label: 'BCH/USDT' },
    { value: 'XMRUSDT', label: 'XMR/USDT' },{ value: 'ZECUSDT', label: 'ZEC/USDT' },
    { value: 'DASHUSDT', label: 'DASH/USDT' },{ value: 'CELOUSDT', label: 'CELO/USDT' },
    { value: 'SONICUSDT', label: 'SONIC/USDT' },{ value: 'SUIUSDT', label: 'SUI/USDT' },
    { value: 'SEIUSDT', label: 'SEI/USDT' },{ value: 'TIAUSDT', label: 'TIA/USDT' },
    { value: 'JUPUSDT', label: 'JUP/USDT' },{ value: 'PYTHUSDT', label: 'PYTH/USDT' },
    { value: 'WIFUSDT', label: 'WIF/USDT' },{ value: 'BONKUSDT', label: 'BONK/USDT' },
    { value: 'PEPEUSDT', label: 'PEPE/USDT' },{ value: 'FLOKIUSDT', label: 'FLOKI/USDT' },
  ]},
]

/** Indicator definitions — 1:1 from INDICATORS in config.js lines 70-88 */
const IND_LIST: { id: string; ico: string; name: string; desc: string }[] = [
  { id: 'ema', ico: '📈', name: 'EMA 50/200', desc: 'Exponential Moving Average' },
  { id: 'wma', ico: '〰', name: 'WMA 20/50', desc: 'Weighted Moving Average' },
  { id: 'st',  ico: '◆', name: 'Supertrend', desc: 'Trend + Stop Loss dinamic' },
  { id: 'vp',  ico: '📊', name: 'Volume Profile', desc: 'Volum pe niveluri de pret' },
  { id: 'cvd', ico: '📊', name: 'CVD', desc: 'Cumulative Volume Delta' },
  { id: 'macd', ico: '⚡', name: 'MACD', desc: 'Moving Avg Convergence Div' },
  { id: 'bb',  ico: '◎', name: 'Bollinger Bands', desc: 'Volatilitate si trend' },
  { id: 'stoch', ico: '〰', name: 'Stochastic RSI', desc: 'RSI imbunatatit cu Stoch' },
  { id: 'obv', ico: '📊', name: 'OBV', desc: 'On-Balance Volume' },
  { id: 'atr', ico: '📏', name: 'ATR', desc: 'Average True Range - volat' },
  { id: 'vwap', ico: '📊', name: 'VWAP', desc: 'Volume Weighted Avg Price' },
  { id: 'ichimoku', ico: '☁', name: 'Ichimoku Cloud', desc: 'Sistem complet japonez' },
  { id: 'fib', ico: '⬡', name: 'Fibonacci', desc: 'Retracement auto pe swing' },
  { id: 'pivot', ico: '◎', name: 'Pivot Points', desc: 'Suport/Rezistenta zilnice' },
  { id: 'rsi14', ico: '⚡', name: 'RSI 14', desc: 'Relative Strength Index' },
  { id: 'mfi', ico: '💰', name: 'Money Flow Index', desc: 'RSI bazat pe volum' },
  { id: 'cci', ico: '📏', name: 'CCI', desc: 'Commodity Channel Index' },
]

export function ChartControls() {
  const symbol = useMarketStore((s) => s.market.symbol)
  const chartTf = useMarketStore((s) => s.market.chartTf)
  const indicators = useMarketStore((s) => s.market.indicators)
  const overlays = useMarketStore((s) => s.market.overlays)
  const patch = useMarketStore((s) => s.patch)
  const openModal = useUiStore((s) => s.openModal)

  const [tfOpen, setTfOpen] = useState(false)
  const [indPanelOpen, setIndPanelOpen] = useState(false)
  const [fsMode, setFsMode] = useState(false)
  const [sessions, setSessions] = useState({ asia: false, london: false, ny: false })
  const [vwapOn, setVwapOn] = useState(false)
  const [tsOn, setTsOn] = useState(false)
  const [drawTool, setDrawTool] = useState<string | null>(null)
  const [drawingsVisible, setDrawingsVisible] = useState(true)
  const [activeInds, setActiveInds] = useState<Record<string, boolean>>({})
  const tfRef = useRef<HTMLDivElement>(null)

  // Sync activeInds from old JS S.activeInds on mount + after bridge loads
  useEffect(() => {
    function sync() {
      const w = window as any
      if (w.S?.activeInds) setActiveInds({ ...w.S.activeInds })
    }
    sync()
    const id = setInterval(sync, 2000)
    return () => clearInterval(id)
  }, [])

  // Close dropdown on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (tfRef.current && !tfRef.current.contains(e.target as Node)) setTfOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  function pickTf(tf: string) {
    if (typeof setTF === 'function') setTF(tf, null)
    patch({ chartTf: tf })
    setTfOpen(false)
  }

  function togInd(key: string) {
    const w = window as any
    if (typeof togIndFn === 'function') {
      togIndFn(key, null)
    }
    // Sync React state from old JS after toggle
    if (w.S?.activeInds) setActiveInds({ ...w.S.activeInds })
    // Also update React store for the 4 React-managed indicators
    if (key in indicators) {
      patch({ indicators: { ...indicators, [key]: !indicators[key] } })
    }
  }

  function togOvr(key: keyof typeof overlays) {
    if (typeof togOvrFn === 'function') {
      const btn = document.getElementById('b' + key)
      try { togOvrFn(key, btn) } catch (e) { console.warn('[togOvr]', key, 'error:', (e as Error).message) }
    }
    patch({ overlays: { ...overlays, [key]: !overlays[key] } })
  }

  function handleSymbolChange(val: string) {
    const w = window as any
    if (typeof w.setSymbol === 'function') w.setSymbol(val)
    patch({ symbol: val })
  }

  // Fullscreen — delegate to old JS toggleFS (handles chart canvas resize too)
  function toggleFS() {
    toggleFSFn()
    const sec = document.getElementById('csec')
    setFsMode(sec ? sec.classList.contains('fsm') : false)
  }

  // Session toggles — delegate to old JS toggleSession(sess, btn)
  function handleSession(key: 'asia' | 'london' | 'ny', btn: HTMLButtonElement) {
    if (typeof toggleSessionFn === 'function') {
      toggleSessionFn(key, btn)
    } else {
      btn.classList.toggle('act')
    }
    setSessions(s => ({ ...s, [key]: !s[key] }))
  }

  // VWAP toggle — delegate to old JS toggleVWAP(btn)
  function handleVWAP(btn: HTMLButtonElement) {
    if (typeof toggleVWAPFn === 'function') {
      toggleVWAPFn(btn)
    } else {
      btn.classList.toggle('act')
    }
    setVwapOn(v => !v)
  }

  // T&S toggle — delegate to old JS (starts trade stream + renders tape)
  function toggleTimeSales() {
    const w = window as any
    if (typeof w.toggleTimeSales === 'function') {
      w.toggleTimeSales()
    } else {
      const wrap = document.getElementById('ts-wrap')
      if (wrap) wrap.style.display = tsOn ? 'none' : 'block'
    }
    setTsOn(t => !t)
  }

  // Drawing tools — delegate to old JS drawingTools.js
  function handleDrawTool(tool: string) {
    const w = window as any
    if (typeof w.drawToolActivate === 'function') {
      w.drawToolActivate(drawTool === tool ? null : tool)
    }
    setDrawTool(drawTool === tool ? null : tool)
  }
  function handleDrawToggleVis() {
    const w = window as any
    if (typeof w.drawToolToggleVis === 'function') w.drawToolToggleVis()
    setDrawingsVisible(v => !v)
  }
  function handleDrawClearAll() {
    const w = window as any
    if (typeof w.drawToolClearAll === 'function') w.drawToolClearAll()
    setDrawTool(null)
  }

  return (
    <>
      {/* ── Section label ── */}
      <div className="slbl" style={{ justifyContent: 'space-between' }}>
        <span>&#128200; <span id="chartTitleLbl">{symbol}</span> &#8212; LIVE CHART</span>
        <span id="chartTZLbl" style={{ color: '#44aaff', fontSize: '7px' }}><span style={{ fontWeight: 700 }}>RO</span></span>
      </div>

      {/* ── Controls container ── */}
      <div className="ctrls">
        {/* Row 1: Timeframe + Settings + Symbol */}
        <div className="crow">
          <div className={`ztf-wrap${tfOpen ? ' open' : ''}`} id="ztfWrap" ref={tfRef}>
            <button className="ztf-trigger" id="ztfTrigger" onClick={() => setTfOpen(!tfOpen)}>
              <span id="ztfLabel">{chartTf}</span> <span className="ztf-arrow">&#9662;</span>
            </button>
            <div className="ztf-dropdown" id="ztfDropdown">
              {TIMEFRAMES.map((tf) => (
                <button
                  key={tf}
                  className={`ztf-item${chartTf === tf ? ' act' : ''}`}
                  onClick={() => pickTf(tf)}
                >{tf}</button>
              ))}
            </div>
          </div>
          <span style={{ width: '4px' }}></span>
          <button className="tfb ztf-sibling" id="fsbtn" title="Fullscreen" onClick={toggleFS}>{fsMode ? '\u2291' : '\u272D'}</button>
          <button className="tfb ztf-sibling" title="Chart Settings" onClick={() => openModal('charts')}>&#9881;</button>
          <button className="tfb ztf-sibling" title="Add Indicator" onClick={() => setIndPanelOpen(true)}>&#9776;</button>
          <span style={{ width: '8px' }}></span>
          <select
            id="symSel"
            className="tfb"
            value={symbol}
            onChange={(e) => handleSymbolChange(e.target.value)}
            style={{ height: '24px', padding: '2px 6px' }}
          >
            {SYMBOLS.map((g) => (
              <optgroup key={g.label} label={g.label} style={{ color: '#888' }}>
                {g.items.map((s) => (
                  <option key={s.value} value={s.value}>{s.label}</option>
                ))}
              </optgroup>
            ))}
          </select>
          <button className="tfb ztf-sibling expo-toggle-btn" id="expoToggleBtn" title="Exposure Dashboard" onClick={() => { openModal('exposure'); (window as any)._fetchExposure?.() }}>EXP</button>
        </div>

        {/* Exposure inline panel (hidden by default) */}
        <div id="expoInlinePanel" className="expo-inline" style={{ display: 'none' }}>
          <div id="expoInlineContent" style={{ padding: '8px 10px', fontSize: '10px', color: '#888', lineHeight: 1.7 }}></div>
        </div>

        {/* Row 2: Sessions + VWAP + OVI */}
        <div className="crow">
          <button className="sess-btn asia" id="sessAsia" title="Asia Session" onClick={(e) => handleSession('asia', e.currentTarget)}><span className="z-badge z-badge--cyan" style={{ padding: 0, border: 0, background: 'none', fontSize: 'inherit', letterSpacing: 'inherit' }}>ASI</span> ASIA</button>
          <button className="sess-btn london" id="sessLondon" title="London Session" onClick={(e) => handleSession('london', e.currentTarget)}><span style={{ fontSize: '8px', fontWeight: 700, color: '#4488ff' }}>UK</span> LON</button>
          <button className="sess-btn ny" id="sessNY" title="New York Session" onClick={(e) => handleSession('ny', e.currentTarget)}><span style={{ fontSize: '8px', fontWeight: 700, color: '#00d97a' }}>US</span> NY</button>
          <button className="vwap-btn" id="vwapBtn" title="VWAP + Bands" onClick={(e) => handleVWAP(e.currentTarget)}>VWAP</button>
          <button className="vwap-btn" id="oviBtn" title="OVI LIQUID &#8212; Liquidation Pockets" style={{ color: '#f0c040', borderColor: '#f0c04044' }} onClick={() => openModal('ovi')}>OVI</button>
        </div>

        {/* Row 3: Indicators + Overlays + Drawing Tools */}
        <div className="crow">
          <button className={`indb${activeInds.ema ?? indicators.ema ? ' act' : ''}`} id="bema" onClick={() => togInd('ema')}>EMA</button>
          <button className={`indb${activeInds.wma ?? indicators.wma ? ' act' : ''}`} id="bwma" onClick={() => togInd('wma')}>WMA</button>
          <button className={`indb${activeInds.st ?? indicators.st ? ' act' : ''}`} id="bst" onClick={() => togInd('st')}>ST</button>
          <button className={`indb${activeInds.vp ?? indicators.vp ? ' act' : ''}`} id="bvp" onClick={() => togInd('vp')}>VOLP</button>
          <span style={{ width: '5px' }}></span>
          <button className={`ovrb${overlays.liq ? ' act' : ''}`} id="bliq" onClick={() => togOvr('liq')}>&#128165; LIQ</button><span className="gear" onClick={() => openModal('liq')}>&#9881;&#65039;</span>
          <button className={`ovrb${overlays.zs ? ' act' : ''}`} id="bzs" onClick={() => togOvr('zs')}>&#128081; SUPREMUS</button><span className="gear" onClick={() => openModal('supremus')}>&#9881;&#65039;</span>
          <button className={`ovrb${overlays.sr ? ' act' : ''}`} id="bsr" onClick={() => togOvr('sr')}>&#128208; S/R</button><span className="gear" style={{ cursor: 'pointer', padding: '2px 5px', borderRadius: '4px', border: '1px solid #f0c04033', fontSize: '10px' }} title="S/R Settings" onClick={() => openModal('sr')}>&#9881;&#65039;</span>
          <button className={`ovrb${overlays.llv ? ' act' : ''}`} id="bllv" onClick={() => togOvr('llv')}>&#128165; LLV</button><span className="gear" style={{ cursor: 'pointer', padding: '2px 5px', borderRadius: '4px', border: '1px solid #f0c04033', fontSize: '10px' }} title="LLV Settings" onClick={() => openModal('llv')}>&#9881;&#65039;</span>
          <span style={{ width: '5px' }}></span>
          <button className={`ovrb${tsOn ? ' act' : ''}`} id="ts-toggle-btn" title="Time &amp; Sales tape (T)" onClick={toggleTimeSales}>&#128200; T&amp;S</button>
          <span style={{ width: '8px' }}></span>
          <span className="dt-sep">|</span>
          <button className={`dt-btn${drawTool === 'hline' ? ' act' : ''}`} id="dt-hline" title="Horizontal Line (H)" onClick={() => handleDrawTool('hline')}>&#9473;</button>
          <button className={`dt-btn${drawTool === 'tline' ? ' act' : ''}`} id="dt-tline" title="Trendline (click 2 points)" onClick={() => handleDrawTool('tline')}>&#9585;</button>
          <button className={`dt-btn${drawTool === 'eraser' ? ' act' : ''}`} id="dt-eraser" title="Eraser (click near line)" onClick={() => handleDrawTool('eraser')}>&#9003;</button>
          <button className={`dt-btn${!drawingsVisible ? ' act' : ''}`} id="dt-eye" title="Toggle drawings visibility" onClick={handleDrawToggleVis}>&#128065;</button>
          <button className="dt-btn" title="Clear all drawings" style={{ color: 'var(--red, #ff3355)' }} onClick={handleDrawClearAll}>&#128465;</button>
        </div>
      </div>

      {/* ── Indicator Panel (bottom sheet) — 1:1 from indOverlay + indPanel in index.html ── */}
      <div className={`ind-panel-overlay${indPanelOpen ? ' open' : ''}`} id="indOverlay" onClick={() => setIndPanelOpen(false)}></div>
      <div className={`ind-panel${indPanelOpen ? ' open' : ''}`} id="indPanel">
        <div className="ind-panel-hdr">
          <span className="ind-panel-title">SELECTEAZA INDICATOR</span>
          <span style={{ cursor: 'pointer', color: 'var(--dim)', fontSize: '14px' }} onClick={() => setIndPanelOpen(false)}>✕</span>
        </div>
        <div className="ind-panel-body" id="indPanelBody">
          {IND_LIST.map((ind) => {
            const isOn = activeInds[ind.id] ?? (indicators as Record<string, boolean>)[ind.id] ?? false
            return (
              <div key={ind.id} className="ind-row">
                <div className="ind-row-l">
                  <span className="ind-row-ico">{ind.ico}</span>
                  <div>
                    <div className="ind-row-name">{ind.name}</div>
                    <div className="ind-row-desc">{ind.desc}</div>
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <div
                    className={`ind-toggle${isOn ? ' on' : ''}`}
                    onClick={() => togInd(ind.id)}
                  >
                    <div className="ind-toggle-dot"></div>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </>
  )
}
