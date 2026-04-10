import { useState, useEffect, useCallback, useRef } from 'react'
import { useUiStore } from '../../stores'

const w = window as any

/** 1:1 port of #panelDemo from public/index.html lines 2050-2204
 *  Syncs bidirectionally with w.TP for trading functions in marketDataTrading.ts */
export function ManualTradePanel() {
  const resolvedEnv = useUiStore((s) => s.resolvedEnv)
  const apiConfigured = useUiStore((s) => s.apiConfigured)
  const exchangeMode = useUiStore((s) => s.exchangeMode)
  const [side, setSideLocal] = useState<'LONG' | 'SHORT'>(() => w.TP?.demoSide || 'LONG')
  const [ordType, setOrdType] = useState('market')
  const [marginMode, setMarginMode] = useState('cross')
  const [lev, setLev] = useState('5')
  const [customLev, setCustomLev] = useState(20)
  const [entry, setEntry] = useState('')
  const [size, setSize] = useState('100')
  const [tp, setTp] = useState('')
  const [sl, setSl] = useState('')
  const [balance, setBalance] = useState(() => w.TP?.demoBalance ?? 10000)
  // Sync side to w.TP.demoSide — do NOT call w.setDemoSide() because it does
  // innerHTML on #demoExec which conflicts with React's DOM ownership → removeChild crash
  const setSide = useCallback((s: 'LONG' | 'SHORT') => {
    setSideLocal(s)
    if (w.TP) w.TP.demoSide = s
    if (typeof w.updateDemoLiqPrice === 'function') w.updateDemoLiqPrice()
  }, [])

  // Sync ordType to DOM + call onDemoOrdTypeChange
  const handleOrdTypeChange = useCallback((val: string) => {
    setOrdType(val)
    // onDemoOrdTypeChange reads from DOM, React controlled inputs handle that
    if (typeof w.onDemoOrdTypeChange === 'function') {
      setTimeout(() => w.onDemoOrdTypeChange(), 0)
    }
  }, [])

  // Sync leverage to TP + call onDemoLevChange
  const handleLevChange = useCallback((val: string) => {
    setLev(val)
    if (typeof w.onDemoLevChange === 'function') {
      setTimeout(() => w.onDemoLevChange(), 0)
    }
  }, [])

  const handleCustomLevChange = useCallback((val: number) => {
    setCustomLev(val)
    if (typeof w.updateDemoLiqPrice === 'function') {
      setTimeout(() => w.updateDemoLiqPrice(), 0)
    }
  }, [])

  // Poll w.TP.demoBalance periodically to keep React in sync
  useEffect(() => {
    const iv = setInterval(() => {
      if (w.TP && w.TP.demoBalance !== balance) {
        setBalance(w.TP.demoBalance)
      }
    }, 500)
    return () => clearInterval(iv)
  }, [balance])

  // Init side from TP on mount
  useEffect(() => {
    if (w.TP?.demoSide) setSideLocal(w.TP.demoSide)
    if (w.TP) setBalance(w.TP.demoBalance)
  }, [])

  const showCustomLev = lev === 'custom'
  const effectiveLev = showCustomLev ? customLev : +lev

  // Liquidation price estimate (local, for instant preview)
  const price = w.S?.price || 0
  const entryPrice = ordType === 'market' ? price : (+entry || 0)
  let liqPrice = 0
  if (entryPrice > 0 && effectiveLev > 0) {
    const mm = 0.004
    if (side === 'LONG') liqPrice = entryPrice * (1 - 1 / effectiveLev + mm)
    else liqPrice = entryPrice * (1 + 1 / effectiveLev - mm)
  }

  function setPct(pct: number) {
    const bal = w.TP?.demoBalance ?? balance
    setSize((bal * pct / 100).toFixed(0))
  }

  // Attach confirm-close pattern on CLOSE ALL button
  const closeAllRef = useRef<HTMLButtonElement>(null)
  const closeAllAttached = useRef(false)
  useEffect(() => {
    if (closeAllRef.current && !closeAllAttached.current && typeof w.attachConfirmClose === 'function') {
      w.attachConfirmClose(closeAllRef.current, w.closeAllDemoPos)
      closeAllAttached.current = true
    }
  })

  return (
    <>
    {/* Mode toggle separator — hidden, old JS switchGlobalMode() finds btnDemo/btnLive */}
    <div className="trade-sep" style={{ display: 'none' }}>
      <div className="trade-line" />
      <div className="trade-btns">
        <button className="tbtn demo active" id="btnDemo">
          <span className="tbtn-dot demo-dot" />DEMO MODE
        </button>
        <button className="tbtn live" id="btnLive">
          <span className="tbtn-dot live-dot" />LIVE MODE
        </button>
      </div>
      <div className="trade-line" />
    </div>
    <div className="trade-panel" id="panelDemo">
      <div className="tp-hdr demo-hdr" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '4px' }}>
        <span>MANUAL TRADE</span>
        <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span id="demoBalance" className="tp-bal">{`BAL: $${balance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}</span>
          <button id="btnAddFunds" style={{ fontSize: '7px', padding: '2px 6px', background: '#001a33', border: '1px solid #00aaff66', color: '#00d4ff', borderRadius: '3px', cursor: 'pointer', fontFamily: 'var(--ff)', letterSpacing: '1px' }} title="Add funds to demo balance" onClick={() => w.promptAddFunds?.()}>+ ADD</button>
          <button id="btnResetDemo" style={{ fontSize: '7px', padding: '2px 6px', background: '#1a0a00', border: '1px solid #ff880066', color: '#ff8800', borderRadius: '3px', cursor: 'pointer', fontFamily: 'var(--ff)', letterSpacing: '1px' }} title="Reset demo balance to $10,000" onClick={() => w.promptResetDemo?.()}>↻ RESET</button>
        </span>
      </div>
      <div className="tp-body">
        {/* ORDER SIDE */}
        <div className="tp-sides">
          <button id="demoLongBtn" className={`tp-side-btn long-btn${side === 'LONG' ? ' act' : ''}`} onClick={() => setSide('LONG')}>LONG ▲</button>
          <button id="demoShortBtn" className={`tp-side-btn short-btn${side === 'SHORT' ? ' act' : ''}`} onClick={() => setSide('SHORT')}>SHORT ▼</button>
        </div>

        {/* SETTINGS ROW */}
        <div className="tp-row">
          <div className="tp-field">
            <div className="tp-lbl">ORDER TYPE</div>
            <select id="demoOrdType" className="tp-sel" value={ordType} onChange={e => handleOrdTypeChange(e.target.value)}>
              <option value="market">MARKET</option>
              <option value="limit">LIMIT</option>
            </select>
          </div>
          <div className="tp-field">
            <div className="tp-lbl">MARGIN MODE</div>
            <select id="demoMarginMode" className="tp-sel" value={marginMode} onChange={e => setMarginMode(e.target.value)}>
              <option value="cross">CROSS</option>
              <option value="isolated">ISOLATED</option>
            </select>
          </div>
          <div className="tp-field">
            <div className="tp-lbl">LEVERAGE</div>
            <select id="demoLev" className="tp-sel" value={lev} onChange={e => handleLevChange(e.target.value)}>
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
          <div className="tp-row" id="demoCustomLevRow">
            <div className="tp-field" style={{ width: '100%' }}>
              <div className="tp-lbl">LEVIER CUSTOM (1 — 150x)</div>
              <input type="number" id="demoCustomLev" className="tp-inp" value={customLev} onChange={e => handleCustomLevChange(+e.target.value)} min={1} max={150} step={1} placeholder="ex: 75" style={{ width: '100%' }} />
            </div>
          </div>
        )}

        {/* ENTRY / SIZE */}
        <div className="tp-row">
          <div className="tp-field">
            <div id="demoEntryLabel" className="tp-lbl">{ordType === 'market' ? 'ENTRY PRICE' : 'LIMIT PRICE'}</div>
            <input type="number" id="demoEntry" className="tp-inp" value={entry} onChange={e => setEntry(e.target.value)} placeholder="Market Price" step={0.1} readOnly={ordType === 'market'} />
          </div>
          <div className="tp-field">
            <div className="tp-lbl">SIZE (USDT)</div>
            <input type="number" id="demoSize" className="tp-inp" value={size} onChange={e => setSize(e.target.value)} step={10} />
          </div>
        </div>

        {/* LIQUIDATION PRICE PREVIEW */}
        <div style={{ background: '#1a0a0a', border: '1px solid #ff335533', borderRadius: '4px', padding: '7px 10px', margin: '4px 0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: '8px', color: 'var(--dim)', letterSpacing: '1px' }}>
            <svg className="z-i" viewBox="0 0 16 16"><path d="M5 6h.01M11 6h.01M4 3a5 5 0 018 0c1 2 1 4-1 6H5c-2-2-2-4-1-6M6 12v2m4-2v2" /></svg> LIQ PRICE
          </span>
          <span id="demoLiqPrice" style={{ fontSize: '13px', fontWeight: 700, color: '#ff5577', fontFamily: "'Cinzel',serif" }}>
            {liqPrice > 0 ? `$${liqPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—'}
          </span>
        </div>

        {/* TP / SL */}
        <div className="tp-row">
          <div className="tp-field">
            <div className="tp-lbl">TAKE PROFIT</div>
            <input type="number" id="demoTP" className="tp-inp" value={tp} onChange={e => setTp(e.target.value)} placeholder="Optional" step={0.1} />
          </div>
          <div className="tp-field">
            <div className="tp-lbl">STOP LOSS</div>
            <input type="number" id="demoSL" className="tp-inp" value={sl} onChange={e => setSl(e.target.value)} placeholder="Optional" step={0.1} />
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
        <button id="demoExec" className="tp-exec demo-exec" onClick={() => { if (typeof w.placeDemoOrder === 'function') w.placeDemoOrder() }}>
          {(() => {
            const mode = exchangeMode || 'demo'
            const env = resolvedEnv || 'DEMO'
            if (mode === 'live' && !apiConfigured) return '\uD83D\uDD12 PLACE ORDER (EXEC LOCKED)'
            if (mode === 'live') { const tag = env === 'TESTNET' ? 'TESTNET' : 'LIVE'; return side === 'LONG' ? `\u25B2 OPEN LONG (${tag})` : `\u25BC OPEN SHORT (${tag})` }
            return side === 'LONG' ? '\u25B2 OPEN LONG' : '\u25BC OPEN SHORT'
          })()}
        </button>

        {/* PENDING ORDERS */}
        <div className="tp-pos-hdr" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span><svg className="z-i" viewBox="0 0 16 16"><path d="M4 2h8v3L9 8l3 3v3H4v-3l3-3-3-3V2" /></svg> PENDING ORDERS</span>
          <span style={{ fontSize: '9px', color: 'var(--dim)' }}>0</span>
        </div>
        {/* TS renderPendingOrders() owns this div via innerHTML — no React children allowed */}
        <div id="pendingOrdersTable" dangerouslySetInnerHTML={{ __html: '<div style="font-size:9px;color:var(--dim);text-align:center;padding:4px">No pending orders</div>' }} />

        {/* OPEN POSITIONS */}
        <div className="tp-pos-hdr" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span>OPEN POSITIONS</span>
          <button ref={closeAllRef} id="closeAllBtn" data-close-id="closeAllBtn" style={{ fontSize: '7px', padding: '3px 10px', background: '#2a0010', border: '1px solid #ff4466', color: '#ff4466', borderRadius: '3px', cursor: 'pointer', fontFamily: 'var(--ff)', letterSpacing: '1px', userSelect: 'none' }}>✕ CLOSE ALL</button>
        </div>
        {/* TS renderDemoPositions() owns this div via innerHTML — no React children allowed */}
        <div id="demoPosTable" dangerouslySetInnerHTML={{ __html: '<div style="font-size:9px;color:var(--dim);text-align:center;padding:8px">No open positions</div>' }} />

        {/* P&L STATS */}
        <div className="tp-pnl-row">
          <div className="tp-pnl-cell"><div className="tp-lbl">TOTAL P&amp;L</div><div id="demoPnL" className="tp-pnl-val neut">$0.00</div></div>
          <div className="tp-pnl-cell"><div className="tp-lbl">WIN RATE</div><div id="demoWR" className="tp-pnl-val">0%</div></div>
          <div className="tp-pnl-cell"><div className="tp-lbl">TRADES</div><div id="demoTrades" className="tp-pnl-val">0</div></div>
        </div>

        {/* LIVE/TESTNET OPEN POSITIONS (shown when mode=live, hidden in demo) */}
        <div id="livePositionsInDemo" style={{ display: 'none', borderTop: '1px solid var(--brd)', paddingTop: '8px', marginTop: '4px' }}>
          <div style={{ fontSize: '8px', letterSpacing: '2px', color: 'var(--dim)', marginBottom: '6px' }}>EXCHANGE POSITIONS</div>
          <div id="livePositionsDemo" style={{ fontSize: '9px', color: 'var(--dim)', textAlign: 'center' }} dangerouslySetInnerHTML={{ __html: '&mdash;' }} />
        </div>

        {/* TRADE JOURNAL */}
        <div style={{ borderTop: '1px solid var(--brd)', paddingTop: '8px', marginTop: '4px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 2px 6px' }}>
            <span style={{ fontSize: '8px', letterSpacing: '2px', color: 'var(--dim)' }}>TRADE JOURNAL</span>
            <button className="csv-btn" onClick={() => w.exportJournalCSV?.()}><svg className="z-i" viewBox="0 0 16 16"><path d="M8 2v8m-3-3l3 3 3-3M3 14h10" /></svg> CSV</button>
          </div>
          <div className="jl-hdr">
            <span>TIME</span><span>SIDE</span><span>ENTRY→EXIT</span><span>PnL</span><span>REASON</span>
          </div>
          {/* TS renderTradeJournal() owns this div via innerHTML — no React children allowed */}
          <div className="journal-wrap" id="journalBody" dangerouslySetInnerHTML={{ __html: '<div style="padding:10px;text-align:center;font-size:8px;color:var(--dim)">No trades yet</div>' }} />
        </div>
      </div>
    </div>
    {/* LIVE TRADING PANEL — old JS populates via positions.js + liveApi.js */}
    <div className="trade-panel" id="panelLive" style={{ display: 'none' }}>
      <div className="tp-hdr live-hdr">
        <span><span className="z-dot z-dot--red" /> LIVE TRADING — REAL FUNDS</span>
        <span style={{ fontSize: '8px', color: '#ff8800' }}>
          <svg className="z-i" viewBox="0 0 16 16"><path d="M8 2L1 14h14L8 2zM8 6v4m0 2h.01" /></svg> USE WITH CAUTION
        </span>
      </div>
      <div className="tp-body">
        <div className="api-section" id="apiSection">
          <div id="apiStatus" style={{ padding: '12px', textAlign: 'center', fontSize: '10px', color: 'var(--dim)', lineHeight: 1.8 }}>
            Checking exchange connection...
          </div>
          <button className="tp-exec live-exec" id="btnConnectExchange">CHECK CONNECTION</button>
        </div>
        <div id="liveOrderForm" style={{ display: 'none' }}>
          <div className="tp-sides">
            <button className="tp-side-btn long-btn act" id="liveLongBtn" onClick={() => w.setLiveSide?.('LONG')}>LONG ▲</button>
            <button className="tp-side-btn short-btn" id="liveShortBtn" onClick={() => w.setLiveSide?.('SHORT')}>SHORT ▼</button>
          </div>
          <div className="tp-row">
            <div className="tp-field">
              <div className="tp-lbl">TYPE</div>
              <select id="liveOrdType" className="tp-sel" defaultValue="market">
                <option value="market">MARKET</option>
                <option value="limit">LIMIT</option>
              </select>
            </div>
            <div className="tp-field">
              <div className="tp-lbl">LEVERAGE</div>
              <select id="liveLev" className="tp-sel" defaultValue="20" onChange={() => w.onLiveLevChange?.()}>
                <option value="1">1x</option><option value="2">2x</option><option value="5">5x</option>
                <option value="10">10x</option><option value="20">20x</option><option value="50">50x</option>
                <option value="100">100x</option><option value="custom">✏ Custom</option>
              </select>
            </div>
          </div>
          <div className="tp-row" id="liveCustomLevRow" style={{ display: 'none' }}>
            <div className="tp-field" style={{ width: '100%' }}>
              <div className="tp-lbl">LEVIER CUSTOM (1 — 150x)</div>
              <input type="number" id="liveCustomLev" className="tp-inp" defaultValue={20} min={1} max={150} step={1} style={{ width: '100%' }} />
            </div>
          </div>
          <div className="tp-row">
            <div className="tp-field">
              <div className="tp-lbl">SIZE (USDT)</div>
              <input type="number" id="liveSize" className="tp-inp" defaultValue={50} step={10} />
            </div>
            <div className="tp-field">
              <div className="tp-lbl">ENTRY</div>
              <input type="number" id="liveEntry" className="tp-inp" placeholder="Market" step={0.1} />
            </div>
          </div>
          <div style={{ background: '#1a0a0a', border: '1px solid #ff335533', borderRadius: '4px', padding: '7px 10px', margin: '4px 0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '8px', color: 'var(--dim)', letterSpacing: '1px' }}>
              <svg className="z-i" viewBox="0 0 16 16"><path d="M5 6h.01M11 6h.01M4 3a5 5 0 018 0c1 2 1 4-1 6H5c-2-2-2-4-1-6M6 12v2m4-2v2" /></svg> LIQ PRICE
            </span>
            <span id="liveLiqPrice" style={{ fontSize: '13px', fontWeight: 700, color: '#ff5577', fontFamily: "'Cinzel',serif" }}>—</span>
          </div>
          <div className="tp-row">
            <div className="tp-field"><div className="tp-lbl">TP</div><input type="number" id="liveTP" className="tp-inp" placeholder="—" step={0.1} /></div>
            <div className="tp-field"><div className="tp-lbl">SL</div><input type="number" id="liveSL" className="tp-inp" placeholder="—" step={0.1} /></div>
          </div>
          <div className="tp-pcts">
            <button className="tp-pct" onClick={() => w.setLivePct?.(25)}>25%</button>
            <button className="tp-pct" onClick={() => w.setLivePct?.(50)}>50%</button>
            <button className="tp-pct" onClick={() => w.setLivePct?.(75)}>75%</button>
            <button className="tp-pct" onClick={() => w.setLivePct?.(100)}>100%</button>
          </div>
          <button className="tp-exec live-exec" onClick={() => w.placeDemoOrder?.()}><span className="z-dot z-dot--red" /> PLACE LIVE ORDER</button>
          <div id="livePositions" style={{ fontSize: '9px', color: 'var(--dim)', marginTop: '8px', textAlign: 'center' }} dangerouslySetInnerHTML={{ __html: '&mdash;' }} />
        </div>
      </div>
    </div>
    </>
  )
}
