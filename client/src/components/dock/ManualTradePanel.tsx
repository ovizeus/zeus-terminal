import { useState } from 'react'
import { usePositionsStore, useMarketStore } from '../../stores'

/** 1:1 port of #panelDemo from public/index.html lines 2050-2204 */
export function ManualTradePanel() {
  const demoBalance = usePositionsStore((s) => s.demoBalance)
  const price = useMarketStore((s) => s.market.price)

  const [side, setSide] = useState<'LONG' | 'SHORT'>('LONG')
  const [ordType, setOrdType] = useState('market')
  const [marginMode, setMarginMode] = useState('cross')
  const [lev, setLev] = useState('5')
  const [customLev, setCustomLev] = useState(20)
  const [entry, setEntry] = useState('')
  const [size, setSize] = useState('100')
  const [tp, setTp] = useState('')
  const [sl, setSl] = useState('')

  const showCustomLev = lev === 'custom'
  const effectiveLev = showCustomLev ? customLev : +lev

  // Liquidation price estimate
  const entryPrice = ordType === 'market' ? price : (+entry || 0)
  let liqPrice = 0
  if (entryPrice > 0 && effectiveLev > 0) {
    if (side === 'LONG') liqPrice = entryPrice * (1 - 1 / effectiveLev)
    else liqPrice = entryPrice * (1 + 1 / effectiveLev)
  }

  function setPct(pct: number) {
    setSize(((demoBalance * pct / 100)).toFixed(0))
  }

  return (
    <div className="trade-panel" id="panelDemo">
      <div className="tp-hdr demo-hdr" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '4px' }}>
        <span>MANUAL TRADE</span>
        <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span className="tp-bal">BAL: ${demoBalance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
          <button style={{ fontSize: '7px', padding: '2px 6px', background: '#001a33', border: '1px solid #00aaff66', color: '#00d4ff', borderRadius: '3px', cursor: 'pointer', fontFamily: 'var(--ff)', letterSpacing: '1px' }} title="Add funds to demo balance">+ ADD</button>
          <button style={{ fontSize: '7px', padding: '2px 6px', background: '#1a0a00', border: '1px solid #ff880066', color: '#ff8800', borderRadius: '3px', cursor: 'pointer', fontFamily: 'var(--ff)', letterSpacing: '1px' }} title="Reset demo balance to $10,000">↻ RESET</button>
        </span>
      </div>
      <div className="tp-body">
        {/* ORDER SIDE */}
        <div className="tp-sides">
          <button className={`tp-side-btn long-btn${side === 'LONG' ? ' act' : ''}`} onClick={() => setSide('LONG')}>LONG ▲</button>
          <button className={`tp-side-btn short-btn${side === 'SHORT' ? ' act' : ''}`} onClick={() => setSide('SHORT')}>SHORT ▼</button>
        </div>

        {/* SETTINGS ROW */}
        <div className="tp-row">
          <div className="tp-field">
            <div className="tp-lbl">ORDER TYPE</div>
            <select className="tp-sel" value={ordType} onChange={e => setOrdType(e.target.value)}>
              <option value="market">MARKET</option>
              <option value="limit">LIMIT</option>
            </select>
          </div>
          <div className="tp-field">
            <div className="tp-lbl">MARGIN MODE</div>
            <select className="tp-sel" value={marginMode} onChange={e => setMarginMode(e.target.value)}>
              <option value="cross">CROSS</option>
              <option value="isolated">ISOLATED</option>
            </select>
          </div>
          <div className="tp-field">
            <div className="tp-lbl">LEVERAGE</div>
            <select className="tp-sel" value={lev} onChange={e => setLev(e.target.value)}>
              <option value="1">1x</option>
              <option value="2">2x</option>
              <option value="5">5x</option>
              <option value="10">10x</option>
              <option value="20">20x</option>
              <option value="50">50x</option>
              <option value="100">100x</option>
              <option value="custom">✏ Custom</option>
            </select>
          </div>
        </div>

        {/* CUSTOM LEVERAGE ROW */}
        {showCustomLev && (
          <div className="tp-row">
            <div className="tp-field" style={{ width: '100%' }}>
              <div className="tp-lbl">LEVIER CUSTOM (1 — 150x)</div>
              <input type="number" className="tp-inp" value={customLev} onChange={e => setCustomLev(+e.target.value)} min={1} max={150} step={1} placeholder="ex: 75" style={{ width: '100%' }} />
            </div>
          </div>
        )}

        {/* ENTRY / SIZE */}
        <div className="tp-row">
          <div className="tp-field">
            <div className="tp-lbl">{ordType === 'market' ? 'ENTRY PRICE' : 'LIMIT PRICE'}</div>
            <input type="number" className="tp-inp" value={entry} onChange={e => setEntry(e.target.value)} placeholder="Market Price" step={0.1} readOnly={ordType === 'market'} />
          </div>
          <div className="tp-field">
            <div className="tp-lbl">SIZE (USDT)</div>
            <input type="number" className="tp-inp" value={size} onChange={e => setSize(e.target.value)} step={10} />
          </div>
        </div>

        {/* LIQUIDATION PRICE PREVIEW */}
        <div style={{ background: '#1a0a0a', border: '1px solid #ff335533', borderRadius: '4px', padding: '7px 10px', margin: '4px 0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: '8px', color: 'var(--dim)', letterSpacing: '1px' }}>
            <svg className="z-i" viewBox="0 0 16 16"><path d="M5 6h.01M11 6h.01M4 3a5 5 0 018 0c1 2 1 4-1 6H5c-2-2-2-4-1-6M6 12v2m4-2v2" /></svg> LIQ PRICE
          </span>
          <span style={{ fontSize: '13px', fontWeight: 700, color: '#ff5577', fontFamily: "'Cinzel',serif" }}>
            {liqPrice > 0 ? `$${liqPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—'}
          </span>
        </div>

        {/* TP / SL */}
        <div className="tp-row">
          <div className="tp-field">
            <div className="tp-lbl">TAKE PROFIT</div>
            <input type="number" className="tp-inp" value={tp} onChange={e => setTp(e.target.value)} placeholder="Optional" step={0.1} />
          </div>
          <div className="tp-field">
            <div className="tp-lbl">STOP LOSS</div>
            <input type="number" className="tp-inp" value={sl} onChange={e => setSl(e.target.value)} placeholder="Optional" step={0.1} />
          </div>
        </div>

        {/* SIZE SHORTCUTS */}
        <div className="tp-pcts">
          <button className="tp-pct" onClick={() => setPct(25)}>25%</button>
          <button className="tp-pct" onClick={() => setPct(50)}>50%</button>
          <button className="tp-pct" onClick={() => setPct(75)}>75%</button>
          <button className="tp-pct" onClick={() => setPct(100)}>100%</button>
        </div>

        {/* PLACE ORDER */}
        <button className="tp-exec demo-exec">PLACE DEMO ORDER</button>

        {/* PENDING ORDERS */}
        <div className="tp-pos-hdr" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span><svg className="z-i" viewBox="0 0 16 16"><path d="M4 2h8v3L9 8l3 3v3H4v-3l3-3-3-3V2" /></svg> PENDING ORDERS</span>
          <span style={{ fontSize: '9px', color: 'var(--dim)' }}>0</span>
        </div>
        <div style={{ fontSize: '9px', color: 'var(--dim)', textAlign: 'center', padding: '4px' }}>No pending orders</div>

        {/* OPEN POSITIONS */}
        <div className="tp-pos-hdr" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span>OPEN POSITIONS</span>
          <button style={{ fontSize: '7px', padding: '3px 10px', background: '#2a0010', border: '1px solid #ff4466', color: '#ff4466', borderRadius: '3px', cursor: 'pointer', fontFamily: 'var(--ff)', letterSpacing: '1px', userSelect: 'none' }}>✕ CLOSE ALL</button>
        </div>
        <div style={{ fontSize: '9px', color: 'var(--dim)', textAlign: 'center', padding: '8px' }}>No open positions</div>

        {/* P&L STATS */}
        <div className="tp-pnl-row">
          <div className="tp-pnl-cell"><div className="tp-lbl">TOTAL P&amp;L</div><div className="tp-pnl-val neut">$0.00</div></div>
          <div className="tp-pnl-cell"><div className="tp-lbl">WIN RATE</div><div className="tp-pnl-val">0%</div></div>
          <div className="tp-pnl-cell"><div className="tp-lbl">TRADES</div><div className="tp-pnl-val">0</div></div>
        </div>

        {/* LIVE/TESTNET OPEN POSITIONS (shown when mode=live, hidden in demo) */}
        <div id="livePositionsInDemo" style={{ display: 'none', borderTop: '1px solid var(--brd)', paddingTop: '8px', marginTop: '4px' }}>
          <div style={{ fontSize: '8px', letterSpacing: '2px', color: 'var(--dim)', marginBottom: '6px' }}>EXCHANGE POSITIONS</div>
          <div id="livePositionsDemo" style={{ fontSize: '9px', color: 'var(--dim)', textAlign: 'center' }}>&mdash;</div>
        </div>

        {/* TRADE JOURNAL */}
        <div style={{ borderTop: '1px solid var(--brd)', paddingTop: '8px', marginTop: '4px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 2px 6px' }}>
            <span style={{ fontSize: '8px', letterSpacing: '2px', color: 'var(--dim)' }}>TRADE JOURNAL</span>
            <button className="csv-btn"><svg className="z-i" viewBox="0 0 16 16"><path d="M8 2v8m-3-3l3 3 3-3M3 14h10" /></svg> CSV</button>
          </div>
          <div className="jl-hdr">
            <span>TIME</span><span>SIDE</span><span>ENTRY→EXIT</span><span>PnL</span><span>REASON</span>
          </div>
          <div className="journal-wrap">
            <div style={{ padding: '10px', textAlign: 'center', fontSize: '8px', color: 'var(--dim)' }}>No trades yet</div>
          </div>
        </div>
      </div>
    </div>
  )
}
