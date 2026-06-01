import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { useUiStore, usePositionsStore, useMarketStore, useATStore } from '../../stores'
import { exportJournalCSV } from '../../services/storage'
import { closeAllDemoPos } from '../../trading/autotrade'
import { onDemoLevChange, placeDemoOrder, onDemoOrdTypeChange, promptResetDemo, promptAddFunds, _countOppositeModeOpenPositions } from '../../data/marketDataTrading'
import { attachConfirmClose } from '../../engine/events'
import { DemoPositionRow, LivePositionRow, PendingOrderRow, JournalRow } from './PositionRows'
import { computeManualClosedStats } from '../../utils/manualStats'

const w = window as any

/** 1:1 port of #panelDemo from public/index.html lines 2050-2204
 *  Syncs bidirectionally with w.TP for trading functions in marketDataTrading.ts */
export function ManualTradePanel() {
  // Phase 2C: read canonical executionEnv. null = LOCKED (non-demo blocked).
  const executionEnv = useUiStore((s) => s.executionEnv)
  // [Phase 12.A — Batch D3] Canonical exchange identity for header+balance labels.
  const activeExchange = useUiStore((s) => s.activeExchange)
  const isPlacingLive = useUiStore((s) => s.isPlacingLive)
  // [batch3-W+] Engine mode (demo/live) is the authoritative toggle for what
  // the Manual panel shows. `exchangeMode` ('testnet'/'live'/null) only
  // decorates labels (TESTNET vs REAL). Previously the panel used
  // exchangeMode as engine mode, which broke everything when testnet API was
  // configured while engine was in demo mode (gMode would be 'testnet' and
  // match neither demo nor live positions).
  const engineMode = useATStore((s) => s.mode) || 'demo'
  const [side, setSideLocal] = useState<'LONG' | 'SHORT'>(() => w.TP?.demoSide || 'LONG')
  const [ordType, setOrdType] = useState('market')
  const [marginMode, setMarginMode] = useState('cross')
  const [lev, setLev] = useState('5')
  const [customLev, setCustomLev] = useState(20)
  const [entry, setEntry] = useState('')
  const [size, setSize] = useState('100')

  // Sync from server-persisted manualTestnet after settings load (async race fix)
  const _settingsApplied = useRef(false)
  useEffect(() => {
    const mt = w.USER_SETTINGS?.manualTestnet
    if (!mt || _settingsApplied.current) return
    _settingsApplied.current = true
    if (mt.size && Number.isFinite(+mt.size)) setSize(String(mt.size))
    if (mt.leverage && Number.isFinite(+mt.leverage)) {
      const v = +mt.leverage
      setLev([1,2,3,5,10,15,20,25,50,75,100,125].includes(v) ? String(v) : 'custom')
      if (![1,2,3,5,10,15,20,25,50,75,100,125].includes(v)) setCustomLev(v)
    }
    if (mt.marginMode) setMarginMode(mt.marginMode)
  })
  // Also re-sync on zeus:settingsLoaded event (fired after GET /api/user/settings)
  useEffect(() => {
    const handler = () => { _settingsApplied.current = false }
    window.addEventListener('zeus:settingsLoaded', handler)
    return () => window.removeEventListener('zeus:settingsLoaded', handler)
  }, [])
  const [tp, setTp] = useState('')
  const [sl, setSl] = useState('')
  const [isStale, setIsStale] = useState(false)

  useEffect(() => {
    if (!(w.__MF && w.__MF.WS_PROXY_ENABLED)) return
    function onFrame(e: Event) {
      const msg = (e as CustomEvent).detail
      if (!msg) return
      if (msg.type === 'market.stale') setIsStale(true)
      else if (msg.type === 'market.fresh' || msg.type === 'market.price') setIsStale(false)
    }
    window.addEventListener('zeus:wsFrame', onFrame)
    return () => window.removeEventListener('zeus:wsFrame', onFrame)
  }, [])

  const demoBalance = usePositionsStore((s) => s.demoBalance)
  const liveBalanceTotal = usePositionsStore((s) => s.liveBalance.totalBalance)
  // [STATS-FIX 2026-06-01] Total PnL / Win Rate / Trades are now computed from the
  // SAME journal entries displayed below (manual + current mode + closed), so the
  // numbers always coincide with the list. (Was: positionsStore.manualPnl/Wr/Trades,
  // computed from a different array → mismatched after server-side closes showed.)
  // [R9] Reactive arrays that replace the old `dangerouslySetInnerHTML` divs
  const demoPositions = usePositionsStore((s) => s.demoPositions)
  const livePositions = usePositionsStore((s) => s.livePositions)
  const pendingOrders = usePositionsStore((s) => s.pendingOrders)
  const manualLivePending = usePositionsStore((s) => s.manualLivePending)
  const journal = usePositionsStore((s) => s.journal)

  // [Phase 9B1] Manual panel = strict complement of AT panel.
  //   A position belongs to Manual iff autoTrade !== true.
  //   AT panel filters on autoTrade === true, so these two predicates are
  //   mutually exclusive and jointly exhaustive — every live position is
  //   rendered in exactly ONE panel. No more flicker between AT and Manual
  //   when the server ships a minimal snapshot that drops ownership fields
  //   (Phase 9A1 preserves existingPos; this guarantees the render follows).
  const _isManualOwned = (p: any) => p.autoTrade !== true
  const manualDemoPositions = demoPositions.filter((p: any) => !p.closed && _isManualOwned(p) && (p.mode || 'demo') === engineMode)
  const pendingRender = (engineMode === 'live' ? manualLivePending : pendingOrders).filter((o: any) => o.status === 'WAITING')
  const liveRender = livePositions.filter((p: any) => !p.closed && p.status !== 'closing' && _isManualOwned(p))
  const isLiveMode = engineMode === 'live'
  // [BUG-T3 FIX 2026-05-14] Count opposite-mode open positions. Surfaces hidden
  // positions to user via the banner below — prevents forgotten unprotected
  // exposure scenario where user switches mode and forgets active positions on
  // the opposite side. Pure read from positionsStore + canonical helper.
  const oppositeCount = _countOppositeModeOpenPositions(engineMode as 'demo' | 'live', demoPositions, livePositions)
  const oppositeModeLabel = isLiveMode ? 'DEMO' : 'LIVE'
  // null → LOCKED, REAL/TESTNET → as-is, DEMO label not rendered in live mode (engineMode guards)
  const envLabel: 'TESTNET' | 'REAL' | 'LOCKED' = executionEnv === 'TESTNET' ? 'TESTNET' : (executionEnv === 'REAL' ? 'REAL' : 'LOCKED')
  // [Phase 12.A — Batch D3] Exchange suffix for live-mode header + balance prefix.
  //   'binance' → '· BINANCE', 'bybit' → '· BYBIT', null → '· ACTIVE EXCHANGE' (honest fallback).
  const _exchSuffix = activeExchange === 'binance' ? ' \u00B7 BINANCE' : activeExchange === 'bybit' ? ' \u00B7 BYBIT' : ' \u00B7 ACTIVE EXCHANGE'
  // [PERF-6] useMemo so the slice+sort runs only when `journal` reference
  // changes, not on every ManualTradePanel re-render (which fires on each
  // useUiStore / useATStore / useMarketStore selector tick — many times
  // per second during live updates).
  const _manualStats = useMemo(
    () => computeManualClosedStats(journal, engineMode),
    [journal, engineMode]
  )
  const journalSorted = _manualStats.entries
  const manualPnl = _manualStats.pnl
  const manualPnlClass = _manualStats.pnlClass
  const manualWr = _manualStats.wr
  const manualTrades = _manualStats.trades
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
    setTimeout(() => onDemoOrdTypeChange(), 0)
  }, [])

  // Sync leverage to TP + call onDemoLevChange + persist to manualTestnet
  const handleLevChange = useCallback((val: string) => {
    setLev(val)
    const numLev = [1,2,3,5,10,15,20,25,50,75,100,125].includes(+val) ? +val : null
    if (numLev && w.USER_SETTINGS) {
      w.USER_SETTINGS.manualTestnet = w.USER_SETTINGS.manualTestnet || {}
      w.USER_SETTINGS.manualTestnet.leverage = numLev
      if (typeof w._usScheduleSave === 'function') w._usScheduleSave()
    }
    if (typeof onDemoLevChange === 'function') {
      setTimeout(() => onDemoLevChange(), 0)
    }
  }, [])

  const handleCustomLevChange = useCallback((val: number) => {
    setCustomLev(val)
    if (Number.isFinite(val) && val > 0 && w.USER_SETTINGS) {
      w.USER_SETTINGS.manualTestnet = w.USER_SETTINGS.manualTestnet || {}
      w.USER_SETTINGS.manualTestnet.leverage = val
      if (typeof w._usScheduleSave === 'function') w._usScheduleSave()
    }
    if (typeof w.updateDemoLiqPrice === 'function') {
      setTimeout(() => w.updateDemoLiqPrice(), 0)
    }
  }, [])

  const handleSizeChange = useCallback((val: string) => {
    setSize(val)
    const n = +val
    if (Number.isFinite(n) && n > 0 && w.USER_SETTINGS) {
      w.USER_SETTINGS.manualTestnet = w.USER_SETTINGS.manualTestnet || {}
      w.USER_SETTINGS.manualTestnet.size = n
      if (typeof w._usScheduleSave === 'function') w._usScheduleSave()
    }
  }, [])

  // Balance now from positionsStore (reactive, no polling needed)

  // Init side from TP on mount (balance comes from positionsStore reactively)
  useEffect(() => {
    if (w.TP?.demoSide) setSideLocal(w.TP.demoSide)
  }, [])

  const showCustomLev = lev === 'custom'
  const effectiveLev = showCustomLev ? customLev : +lev

  // Liquidation price estimate (local, for instant preview)
  const price = useMarketStore((s) => s.market.price) || 0
  const entryPrice = ordType === 'market' ? price : (+entry || 0)
  let liqPrice = 0
  if (entryPrice > 0 && effectiveLev > 0) {
    const mm = 0.004
    if (side === 'LONG') liqPrice = entryPrice * (1 - 1 / effectiveLev + mm)
    else liqPrice = entryPrice * (1 + 1 / effectiveLev - mm)
  }

  function setPct(pct: number) {
    const bal = isLiveMode ? liveBalanceTotal : demoBalance
    handleSizeChange((bal * pct / 100).toFixed(0))
  }

  // Attach confirm-close pattern on CLOSE ALL button
  const closeAllRef = useRef<HTMLButtonElement>(null)
  const closeAllAttached = useRef(false)
  // [UI-CMP-6] Synchronous double-click guard for PLACE ORDER button —
  // useRef immune to React state batching. Pre-existing `disabled={isPlacingLive}`
  // + `if (isPlacingLive) return` în onClick is a dual guard, but on browsers
  // where click can fire on a button as it transitions to disabled (Android
  // Chrome rapid-tap, mobile touch race), the FIRST click can pass before
  // setIsPlacingLive(true) has propagated through React's render. Same pattern
  // as UI-CMP-7 (welcome snooze).
  const placeBusyRef = useRef(false)
  useEffect(() => {
    if (closeAllRef.current && !closeAllAttached.current && typeof attachConfirmClose === 'function') {
      attachConfirmClose(closeAllRef.current, closeAllDemoPos)
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
      <div className={`tp-hdr ${isLiveMode ? (envLabel === 'LOCKED' ? 'locked-hdr' : 'live-hdr') : 'demo-hdr'}`} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '4px' }}>
        <span>{isLiveMode
          ? (envLabel === 'TESTNET' ? `\u25CF MANUAL TRADE (TESTNET${_exchSuffix})` : (envLabel === 'REAL' ? `\u25CF MANUAL TRADE (REAL${_exchSuffix})` : '\u26D4 MANUAL TRADE (LOCKED)'))
          : 'MANUAL TRADE'}</span>
        <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span id="demoBalance" className="tp-bal">{(() => {
            if (isLiveMode) {
              if (envLabel === 'LOCKED') return 'BAL: Exchange locked \u2014 not configured'
              const prefix = envLabel === 'TESTNET' ? `BAL (TESTNET${_exchSuffix}): $` : `BAL (REAL${_exchSuffix}): $`
              return prefix + liveBalanceTotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
            }
            return `BAL: $${demoBalance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
          })()}</span>
          <button id="btnAddFunds" style={{ fontSize: '7px', padding: '2px 6px', background: '#001a33', border: '1px solid #00aaff66', color: '#00d4ff', borderRadius: '3px', cursor: 'pointer', fontFamily: 'var(--ff)', letterSpacing: '1px' }} title="Add funds to demo balance" onClick={() => promptAddFunds()}>+ ADD</button>
          <button id="btnResetDemo" style={{ fontSize: '7px', padding: '2px 6px', background: '#1a0a00', border: '1px solid #ff880066', color: '#ff8800', borderRadius: '3px', cursor: 'pointer', fontFamily: 'var(--ff)', letterSpacing: '1px' }} title="Reset demo balance to $10,000" onClick={() => promptResetDemo()}>↻ RESET</button>
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
            <select id="demoMarginMode" className="tp-sel" value={marginMode} onChange={e => { setMarginMode(e.target.value); if (w.USER_SETTINGS) { w.USER_SETTINGS.manualTestnet = w.USER_SETTINGS.manualTestnet || {}; w.USER_SETTINGS.manualTestnet.marginMode = e.target.value; if (typeof w._usScheduleSave === 'function') w._usScheduleSave() } }}>
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
            <input type="number" id="demoSize" className="tp-inp" value={size} onChange={e => handleSizeChange(e.target.value)} step={10} />
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

        {/* STALE DATA BANNER */}
        {isStale && <div style={{ background: '#3a0000', border: '1px solid #ff3355', borderRadius: '4px', padding: '6px 10px', marginBottom: '6px', fontSize: '9px', color: '#ff5577', letterSpacing: '1px', textAlign: 'center', fontFamily: 'var(--ff)' }}>⚠️ STALE DATA — trading paused</div>}

        {/* PLACE ORDER */}
        <button id="demoExec" className={`tp-exec ${isLiveMode && envLabel === 'LOCKED' ? 'tp-exec-locked' : 'demo-exec'}`} disabled={isPlacingLive || isStale} onClick={() => {
          // [UI-CMP-6] Sync useRef guard FIRST (immune to React state batch
          // delay) — then keep the existing isPlacingLive belt-and-braces.
          if (placeBusyRef.current) return
          if (isPlacingLive) return
          placeBusyRef.current = true
          try {
            if (typeof placeDemoOrder === 'function') placeDemoOrder()
          } finally {
            // Release on next frame so any synchronous onClick re-fire from
            // the same touch event still sees busy=true. placeDemoOrder sets
            // isPlacingLive itself for the longer async window.
            setTimeout(() => { placeBusyRef.current = false }, 0)
          }
        }}>
          {(() => {
            if (isPlacingLive) return '\u23F3 PLACING\u2026'
            if (isLiveMode && envLabel === 'LOCKED') return '\uD83D\uDD12 PLACE ORDER (LIVE MODE LOCKED)'
            if (isLiveMode) { const tag = envLabel; return side === 'LONG' ? `\u25B2 OPEN LONG (${tag})` : `\u25BC OPEN SHORT (${tag})` }
            return side === 'LONG' ? '\u25B2 OPEN LONG' : '\u25BC OPEN SHORT'
          })()}
        </button>

        {/* PENDING ORDERS */}
        <div className="tp-pos-hdr" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span><svg className="z-i" viewBox="0 0 16 16"><path d="M4 2h8v3L9 8l3 3v3H4v-3l3-3-3-3V2" /></svg> PENDING ORDERS</span>
          <span style={{ fontSize: '9px', color: 'var(--dim)' }}>0</span>
        </div>
        {/* [R9] React-owned pending orders list — reads positionsStore.pendingOrders */}
        <div id="pendingOrdersTable">
          {pendingRender.length === 0
            ? <div style={{ fontSize: 9, color: 'var(--dim)', textAlign: 'center', padding: 4 }}>No pending orders</div>
            : pendingRender.map((ord: any) => <PendingOrderRow key={ord.id} ord={ord} />)}
        </div>

        {/* OPEN POSITIONS */}
        <div className="tp-pos-hdr" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span>OPEN POSITIONS</span>
          <button ref={closeAllRef} id="closeAllBtn" data-close-id="closeAllBtn" style={{ fontSize: '7px', padding: '3px 10px', background: '#2a0010', border: '1px solid #ff4466', color: '#ff4466', borderRadius: '3px', cursor: 'pointer', fontFamily: 'var(--ff)', letterSpacing: '1px', userSelect: 'none' }}>✕ CLOSE ALL</button>
        </div>
        {/* [BUG-T3 FIX 2026-05-14] Opposite-mode hidden positions banner.
            Visible only when there ARE positions in the opposite mode (count > 0).
            Surfaces the otherwise-silent UI hide so user knows there are active
            positions on Binance / in demo tracking that aren't shown here. */}
        {oppositeCount > 0 && (
          <div
            data-testid="bug-t3-opposite-mode-banner"
            style={{
              fontSize: 9,
              padding: '6px 8px',
              margin: '4px 0',
              background: oppositeModeLabel === 'LIVE' ? '#2a0a0a' : '#2a1a00',
              border: `1px solid ${oppositeModeLabel === 'LIVE' ? '#ff4466' : '#f0c040'}`,
              borderRadius: 3,
              color: oppositeModeLabel === 'LIVE' ? '#ff8899' : '#f0d080',
              letterSpacing: '0.5px',
              lineHeight: 1.5,
            }}
          >
            ⚠️ {oppositeCount} {oppositeModeLabel} {oppositeCount === 1 ? 'position' : 'positions'} hidden — switch to {oppositeModeLabel} mode to view
          </div>
        )}
        {/* [R9] React-owned demo/live-mode manual positions — reads positionsStore.demoPositions */}
        <div id="demoPosTable">
          {manualDemoPositions.length === 0
            ? <div style={{ fontSize: 9, color: 'var(--dim)', textAlign: 'center', padding: 8 }}>No open positions</div>
            : manualDemoPositions.map((pos: any) => <DemoPositionRow key={pos.id} pos={pos} />)}
        </div>

        {/* P&L STATS — React-owned via positionsStore (D9) */}
        <div className="tp-pnl-row">
          <div className="tp-pnl-cell"><div className="tp-lbl">TOTAL P&amp;L</div><div className={`tp-pnl-val ${manualPnlClass}`}>${manualPnl.toFixed(2)}</div></div>
          <div className="tp-pnl-cell"><div className="tp-lbl">WIN RATE</div><div className="tp-pnl-val">{manualWr}</div></div>
          <div className="tp-pnl-cell"><div className="tp-lbl">TRADES</div><div className="tp-pnl-val">{manualTrades}</div></div>
        </div>

        {/* [R9] LIVE/TESTNET OPEN POSITIONS — reactive on exchangeMode */}
        <div id="livePositionsInDemo" style={{ display: isLiveMode ? 'block' : 'none', borderTop: '1px solid var(--brd)', paddingTop: '8px', marginTop: '4px' }}>
          <div style={{ fontSize: '8px', letterSpacing: '2px', color: 'var(--dim)', marginBottom: '6px' }}>EXCHANGE POSITIONS</div>
          <div id="livePositionsDemo" style={{ fontSize: '9px', color: 'var(--dim)', textAlign: isLiveMode && liveRender.length ? 'left' : 'center' }}>
            {liveRender.length === 0
              ? <span>No exchange positions</span>
              : liveRender.map((pos: any) => <LivePositionRow key={pos.id} pos={pos} />)}
          </div>
        </div>

        {/* TRADE JOURNAL */}
        <div style={{ borderTop: '1px solid var(--brd)', paddingTop: '8px', marginTop: '4px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 2px 6px' }}>
            <span style={{ fontSize: '8px', letterSpacing: '2px', color: 'var(--dim)' }}>TRADE JOURNAL</span>
            <button className="csv-btn" onClick={() => exportJournalCSV?.()}><svg className="z-i" viewBox="0 0 16 16"><path d="M8 2v8m-3-3l3 3 3-3M3 14h10" /></svg> CSV</button>
          </div>
          <div className="jl-hdr">
            <span>TIME</span><span>SIDE</span><span>ENTRY→EXIT</span><span>PnL</span><span>REASON</span>
          </div>
          {/* [R9] React-owned journal — reads positionsStore.journal */}
          <div className="journal-wrap" id="journalBody">
            {journalSorted.length === 0
              ? <div style={{ padding: 10, textAlign: 'center', fontSize: 8, color: 'var(--dim)' }}>No trades yet</div>
              : journalSorted.map((t: any) => <JournalRow key={(t.id || t.openTs || t.time) + ':' + (t.closedAt || '')} trade={t} />)}
          </div>
        </div>
      </div>
    </div>
    </>
  )
}
