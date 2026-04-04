import { useState, useRef, useEffect } from 'react'
import { useMarketStore } from '../../stores'

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

export function ChartControls() {
  const symbol = useMarketStore((s) => s.market.symbol)
  const chartTf = useMarketStore((s) => s.market.chartTf)
  const indicators = useMarketStore((s) => s.market.indicators)
  const overlays = useMarketStore((s) => s.market.overlays)
  const patch = useMarketStore((s) => s.patch)

  const [tfOpen, setTfOpen] = useState(false)
  const tfRef = useRef<HTMLDivElement>(null)

  // Close dropdown on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (tfRef.current && !tfRef.current.contains(e.target as Node)) setTfOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  function pickTf(tf: string) {
    patch({ chartTf: tf })
    setTfOpen(false)
  }

  function togInd(key: keyof typeof indicators) {
    patch({ indicators: { ...indicators, [key]: !indicators[key] } })
  }

  function togOvr(key: keyof typeof overlays) {
    patch({ overlays: { ...overlays, [key]: !overlays[key] } })
  }

  function setSymbol(val: string) {
    patch({ symbol: val })
  }

  return (
    <>
      {/* ── Section label ── */}
      <div className="slbl" style={{ justifyContent: 'space-between' }}>
        <span>&#128200; <span>{symbol}</span> &#8212; LIVE CHART</span>
        <span style={{ color: '#44aaff', fontSize: '7px' }}><span style={{ fontWeight: 700 }}>RO</span></span>
      </div>

      {/* ── Controls container ── */}
      <div className="ctrls">
        {/* Row 1: Timeframe + Settings + Symbol */}
        <div className="crow">
          <div className={`ztf-wrap${tfOpen ? ' open' : ''}`} ref={tfRef}>
            <button className="ztf-trigger" onClick={() => setTfOpen(!tfOpen)}>
              <span>{chartTf}</span> <span className="ztf-arrow">&#9662;</span>
            </button>
            <div className="ztf-dropdown">
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
          <button className="tfb ztf-sibling" title="Fullscreen">&#10021;</button>
          <button className="tfb ztf-sibling" title="Chart Settings">&#9881;</button>
          <button className="tfb ztf-sibling" title="Add Indicator">&#9776;</button>
          <span style={{ width: '8px' }}></span>
          <select
            id="symSel"
            className="tfb"
            value={symbol}
            onChange={(e) => setSymbol(e.target.value)}
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
          <button className="tfb ztf-sibling expo-toggle-btn" title="Exposure Dashboard">EXP</button>
        </div>

        {/* Exposure inline panel (hidden by default) */}
        <div className="expo-inline" style={{ display: 'none' }}>
          <div style={{ padding: '8px 10px', fontSize: '10px', color: '#888', lineHeight: 1.7 }}></div>
        </div>

        {/* Row 2: Sessions + VWAP + OVI */}
        <div className="crow">
          <button className="sess-btn asia" title="Asia Session"><span style={{ padding: 0, border: 0, background: 'none', fontSize: 'inherit', letterSpacing: 'inherit' }}>ASI</span> ASIA</button>
          <button className="sess-btn london" title="London Session"><span style={{ fontSize: '8px', fontWeight: 700, color: '#4488ff' }}>UK</span> LON</button>
          <button className="sess-btn ny" title="New York Session"><span style={{ fontSize: '8px', fontWeight: 700, color: '#00d97a' }}>US</span> NY</button>
          <button className="vwap-btn" title="VWAP + Bands">VWAP</button>
          <button className="vwap-btn" title="OVI LIQUID" style={{ color: '#f0c040', borderColor: '#f0c04044' }}>OVI</button>
        </div>

        {/* Row 3: Indicators + Overlays + Drawing Tools */}
        <div className="crow">
          <button className={`indb${indicators.ema ? ' act' : ''}`} onClick={() => togInd('ema')}>EMA</button>
          <button className={`indb${indicators.wma ? ' act' : ''}`} onClick={() => togInd('wma')}>WMA</button>
          <button className={`indb${indicators.st ? ' act' : ''}`} onClick={() => togInd('st')}>ST</button>
          <button className={`indb${indicators.vp ? ' act' : ''}`} onClick={() => togInd('vp')}>VOLP</button>
          <span style={{ width: '5px' }}></span>
          <button className={`ovrb${overlays.liq ? ' act' : ''}`} onClick={() => togOvr('liq')}>&#128165; LIQ</button><span className="gear">&#9881;&#65039;</span>
          <button className={`ovrb${overlays.zs ? ' act' : ''}`} onClick={() => togOvr('zs')}>&#128081; SUPREMUS</button><span className="gear">&#9881;&#65039;</span>
          <button className={`ovrb${overlays.sr ? ' act' : ''}`} onClick={() => togOvr('sr')}>&#128208; S/R</button><span className="gear" style={{ cursor: 'pointer', padding: '2px 5px', borderRadius: '4px', border: '1px solid #f0c04033', fontSize: '10px' }} title="S/R Settings">&#9881;&#65039;</span>
          <button className={`ovrb${overlays.llv ? ' act' : ''}`} onClick={() => togOvr('llv')}>&#128165; LLV</button><span className="gear" style={{ cursor: 'pointer', padding: '2px 5px', borderRadius: '4px', border: '1px solid #f0c04033', fontSize: '10px' }} title="LLV Settings">&#9881;&#65039;</span>
          <span style={{ width: '5px' }}></span>
          <button className="ovrb" title="Time &amp; Sales tape (T)">&#128200; T&amp;S</button>
          <span style={{ width: '8px' }}></span>
          <span className="dt-sep">|</span>
          <button className="dt-btn" title="Horizontal Line (H)">&#9473;</button>
          <button className="dt-btn" title="Trendline (click 2 points)">&#9585;</button>
          <button className="dt-btn" title="Eraser (click near line)">&#9003;</button>
          <button className="dt-btn" title="Toggle drawings visibility">&#128065;</button>
          <button className="dt-btn" title="Clear all drawings" style={{ color: 'var(--red)' }}>&#128465;</button>
        </div>
      </div>
    </>
  )
}
