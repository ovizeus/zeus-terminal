import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { useUiStore, usePositionsStore, useMarketStore, useATStore } from '../../stores'
import { exportJournalCSV } from '../../services/storage'
import { closeAllDemoPos } from '../../trading/autotrade'
import { onDemoLevChange, placeDemoOrder, onDemoOrdTypeChange, promptResetDemo, promptAddFunds, _countOppositeModeOpenPositions } from '../../data/marketDataTrading'
import { attachConfirmClose } from '../../engine/events'
import { DemoPositionRow, LivePositionRow, PendingOrderRow, JournalRow, MANUAL_POSITION_COLUMNS, MANUAL_JOURNAL_COLUMNS } from './PositionRows'
import { computeManualClosedStats } from '../../utils/manualStats'
import type { CSSProperties } from 'react'
import { ZiPanel, ZiSection, ZiMetric, ZiTable } from '../zi'
import type { ZiTone } from '../zi'

const w = window as any

// [2026-10-10 institutional redesign, Task 2 — DESIGN ONLY] Styling constants
// for the order ticket. Colours come from the --zi-* tokens, never hard-coded.
const FIELD_STYLE: CSSProperties = {
  width: '100%', boxSizing: 'border-box', background: 'var(--zi-field)', border: '1px solid var(--zi-line)',
  color: 'var(--zi-val)', padding: '8px 10px', borderRadius: 2, fontSize: 13, minHeight: 36,
}
const GHOST_BTN: CSSProperties = {
  background: 'transparent', border: '1px solid var(--zi-edge)', color: 'var(--zi-val)', borderRadius: 2,
  cursor: 'pointer', fontSize: 9, fontWeight: 600, letterSpacing: '0.1em', padding: '4px 10px', minHeight: 28,
}
const FIELD_WRAP: CSSProperties = { flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }
const ROW_STYLE: CSSProperties = { display: 'flex', gap: 10, flexWrap: 'wrap' }
const BANNER: CSSProperties = { fontSize: 11, padding: '8px 10px', borderRadius: 2, lineHeight: 1.5 }

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

  const _pnlTone: ZiTone = manualPnlClass === 'pos' ? 'pos' : manualPnlClass === 'neg' ? 'neg' : 'neutral'
  const _locked = isLiveMode && envLabel === 'LOCKED'
  const _panelTitle = isLiveMode
    ? (envLabel === 'TESTNET' ? `● MANUAL TRADE (TESTNET${_exchSuffix})` : (envLabel === 'REAL' ? `● MANUAL TRADE (REAL${_exchSuffix})` : '⛔ MANUAL TRADE (LOCKED)'))
    : 'MANUAL TRADE'
  const _sideBtn = (active: boolean, tone: 'pos' | 'neg'): CSSProperties => ({
    flex: 1, minHeight: 40, background: active ? 'var(--zi-raise)' : 'transparent', cursor: 'pointer',
    border: `1px solid ${active ? `var(--zi-${tone})` : 'var(--zi-line)'}`, borderRadius: 2,
    color: active ? `var(--zi-${tone})` : 'var(--zi-mut)', fontSize: 12, fontWeight: 600, letterSpacing: '0.12em',
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
    {/* #panelDemo stays the outermost node: bootstrapInit/pageview move it by id and
        toggle its display. `.trade-panel` is kept for the .zpv-active-panel rule. The
        .zi gate lives on the ZiPanel INSIDE it, so it travels with the node. */}
    <div className="trade-panel" id="panelDemo" style={{ border: 'none', background: 'transparent' }}>
    <ZiPanel title={_panelTitle} rail={_locked ? 'neg' : isLiveMode ? 'pos' : 'neutral'}>
      {/* BALANCE STRIP */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 6, padding: '10px 16px' }}>
        <span id="demoBalance" className="zi-num" style={{ fontSize: 12, color: 'var(--zi-val)' }}>{(() => {
          if (isLiveMode) {
            if (envLabel === 'LOCKED') return 'BAL: Exchange locked — not configured'
            const prefix = envLabel === 'TESTNET' ? `BAL (TESTNET${_exchSuffix}): $` : `BAL (REAL${_exchSuffix}): $`
            return prefix + liveBalanceTotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
          }
          return `BAL: $${demoBalance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
        })()}</span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <button id="btnAddFunds" style={GHOST_BTN} title="Add funds to demo balance" onClick={() => promptAddFunds()}>+ ADD</button>
          <button id="btnResetDemo" style={GHOST_BTN} title="Reset demo balance to $10,000" onClick={() => promptResetDemo()}>↻ RESET</button>
        </span>
      </div>

      <div className="zi-rule" />
      {/* ORDER TICKET — every control keeps its id, value and onChange */}
      <div className="tp-body" style={{ padding: '14px 16px 16px', display: 'flex', flexDirection: 'column', gap: 12 }}>
        {/* ORDER SIDE */}
        <div style={{ display: 'flex', gap: 8 }}>
          <button id="demoLongBtn" aria-pressed={side === 'LONG'} style={_sideBtn(side === 'LONG', 'pos')} onClick={() => setSide('LONG')}>LONG ▲</button>
          <button id="demoShortBtn" aria-pressed={side === 'SHORT'} style={_sideBtn(side === 'SHORT', 'neg')} onClick={() => setSide('SHORT')}>SHORT ▼</button>
        </div>

        {/* SETTINGS ROW */}
        <div style={ROW_STYLE}>
          <div style={FIELD_WRAP}>
            <label htmlFor="demoOrdType" className="zi-lbl">ORDER TYPE</label>
            <select id="demoOrdType" style={FIELD_STYLE} value={ordType} onChange={e => handleOrdTypeChange(e.target.value)}>
              <option value="market">MARKET</option>
              <option value="limit">LIMIT</option>
            </select>
          </div>
          <div style={FIELD_WRAP}>
            <label htmlFor="demoMarginMode" className="zi-lbl">MARGIN MODE</label>
            <select id="demoMarginMode" style={FIELD_STYLE} value={marginMode} onChange={e => { setMarginMode(e.target.value); if (w.USER_SETTINGS) { w.USER_SETTINGS.manualTestnet = w.USER_SETTINGS.manualTestnet || {}; w.USER_SETTINGS.manualTestnet.marginMode = e.target.value; if (typeof w._usScheduleSave === 'function') w._usScheduleSave() } }}>
              <option value="cross">CROSS</option>
              <option value="isolated">ISOLATED</option>
            </select>
          </div>
          <div style={FIELD_WRAP}>
            <label htmlFor="demoLev" className="zi-lbl">LEVERAGE</label>
            <select id="demoLev" style={FIELD_STYLE} value={lev} onChange={e => handleLevChange(e.target.value)}>
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
          <div style={ROW_STYLE} id="demoCustomLevRow">
            <div style={{ ...FIELD_WRAP, width: '100%' }}>
              <label htmlFor="demoCustomLev" className="zi-lbl">LEVIER CUSTOM (1 — 150x)</label>
              <input type="number" id="demoCustomLev" className="zi-num" style={FIELD_STYLE} value={customLev} onChange={e => handleCustomLevChange(+e.target.value)} min={1} max={150} step={1} placeholder="ex: 75" />
            </div>
          </div>
        )}

        {/* ENTRY / SIZE */}
        <div style={ROW_STYLE}>
          <div style={FIELD_WRAP}>
            <label id="demoEntryLabel" htmlFor="demoEntry" className="zi-lbl">{ordType === 'market' ? 'ENTRY PRICE' : 'LIMIT PRICE'}</label>
            <input type="number" id="demoEntry" className="zi-num" style={FIELD_STYLE} value={entry} onChange={e => setEntry(e.target.value)} placeholder="Market Price" step={0.1} readOnly={ordType === 'market'} />
          </div>
          <div style={FIELD_WRAP}>
            <label htmlFor="demoSize" className="zi-lbl">SIZE (USDT)</label>
            <input type="number" id="demoSize" className="zi-num" style={FIELD_STYLE} value={size} onChange={e => handleSizeChange(e.target.value)} step={10} />
          </div>
        </div>

        {/* SIZE SHORTCUTS */}
        <div style={{ display: 'flex', gap: 6 }}>
          <button style={{ ...GHOST_BTN, flex: 1, fontSize: 11 }} onClick={() => setPct(25)}>25%</button>
          <button style={{ ...GHOST_BTN, flex: 1, fontSize: 11 }} onClick={() => setPct(50)}>50%</button>
          <button style={{ ...GHOST_BTN, flex: 1, fontSize: 11 }} onClick={() => setPct(75)}>75%</button>
          <button style={{ ...GHOST_BTN, flex: 1, fontSize: 11 }} onClick={() => setPct(100)}>100%</button>
        </div>

        {/* TP / SL */}
        <div style={ROW_STYLE}>
          <div style={FIELD_WRAP}>
            <label htmlFor="demoTP" className="zi-lbl">TAKE PROFIT</label>
            <input type="number" id="demoTP" className="zi-num" style={FIELD_STYLE} value={tp} onChange={e => setTp(e.target.value)} placeholder="Optional" step={0.1} />
          </div>
          <div style={FIELD_WRAP}>
            <label htmlFor="demoSL" className="zi-lbl">STOP LOSS</label>
            <input type="number" id="demoSL" className="zi-num" style={FIELD_STYLE} value={sl} onChange={e => setSl(e.target.value)} placeholder="Optional" step={0.1} />
          </div>
        </div>

        {/* LIQUIDATION PRICE PREVIEW */}
        <div style={{ borderTop: '1px solid var(--zi-hair)', paddingTop: 10, display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <span className="zi-lbl">
            <svg className="z-i" viewBox="0 0 16 16"><path d="M5 6h.01M11 6h.01M4 3a5 5 0 018 0c1 2 1 4-1 6H5c-2-2-2-4-1-6M6 12v2m4-2v2" /></svg> LIQ PRICE
          </span>
          <span id="demoLiqPrice" className="zi-num" style={{ fontSize: 14, color: liqPrice > 0 ? 'var(--zi-neg)' : 'var(--zi-mut)' }}>
            {liqPrice > 0 ? `$${liqPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—'}
          </span>
        </div>

        {/* STALE DATA BANNER */}
        {isStale && <div style={{ ...BANNER, border: '1px solid var(--zi-neg)', color: 'var(--zi-neg)', letterSpacing: '0.1em', textAlign: 'center' }}>⚠️ STALE DATA — trading paused</div>}

        {/* PLACE ORDER */}
        <button id="demoExec" disabled={isPlacingLive || isStale}
          style={{
            width: '100%', minHeight: 44, borderRadius: 2, cursor: (isPlacingLive || isStale || _locked) ? 'not-allowed' : 'pointer',
            background: 'var(--zi-raise)', fontSize: 13, fontWeight: 600, letterSpacing: '0.12em',
            border: `1px solid ${_locked ? 'var(--zi-warn)' : side === 'LONG' ? 'var(--zi-pos)' : 'var(--zi-neg)'}`,
            color: _locked ? 'var(--zi-warn)' : side === 'LONG' ? 'var(--zi-pos)' : 'var(--zi-neg)',
            opacity: (isPlacingLive || isStale) ? 0.5 : 1,
          }}
          onClick={() => {
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
            if (isPlacingLive) return '⏳ PLACING…'
            if (isLiveMode && envLabel === 'LOCKED') return '🔒 PLACE ORDER (LIVE MODE LOCKED)'
            if (isLiveMode) { const tag = envLabel; return side === 'LONG' ? `▲ OPEN LONG (${tag})` : `▼ OPEN SHORT (${tag})` }
            return side === 'LONG' ? '▲ OPEN LONG' : '▼ OPEN SHORT'
          })()}
        </button>
      </div>

      {/* PENDING ORDERS */}
      <ZiSection title="Pending orders" aside={String(pendingRender.length)}>
        {/* [R9] React-owned pending orders list — reads positionsStore.pendingOrders */}
        <div id="pendingOrdersTable">
          {pendingRender.length === 0
            ? <div style={{ fontSize: 11, color: 'var(--zi-mut)', padding: '2px 0' }}>No pending orders</div>
            : <ZiTable columns={MANUAL_POSITION_COLUMNS}>{pendingRender.map((ord: any) => <PendingOrderRow key={ord.id} ord={ord} />)}</ZiTable>}
        </div>
      </ZiSection>

      {/* OPEN POSITIONS */}
      <ZiSection title="Open positions" aside={String(manualDemoPositions.length)}>
        <div style={{ display: 'flex', justifyContent: 'flex-end', paddingBottom: 8 }}>
          <button ref={closeAllRef} id="closeAllBtn" data-close-id="closeAllBtn" style={{ ...GHOST_BTN, borderColor: 'var(--zi-neg)', color: 'var(--zi-neg)', userSelect: 'none' }}>✕ CLOSE ALL</button>
        </div>
        {/* [BUG-T3 FIX 2026-05-14] Opposite-mode hidden positions banner.
            Visible only when there ARE positions in the opposite mode (count > 0).
            Surfaces the otherwise-silent UI hide so user knows there are active
            positions on Binance / in demo tracking that aren't shown here. */}
        {oppositeCount > 0 && (
          <div
            data-testid="bug-t3-opposite-mode-banner"
            style={{
              ...BANNER,
              margin: '0 0 8px',
              border: `1px solid ${oppositeModeLabel === 'LIVE' ? 'var(--zi-neg)' : 'var(--zi-warn)'}`,
              color: oppositeModeLabel === 'LIVE' ? 'var(--zi-neg)' : 'var(--zi-warn)',
            }}
          >
            ⚠️ {oppositeCount} {oppositeModeLabel} {oppositeCount === 1 ? 'position' : 'positions'} hidden — switch to {oppositeModeLabel} mode to view
          </div>
        )}
        {/* [R9] React-owned demo/live-mode manual positions — reads positionsStore.demoPositions */}
        <div id="demoPosTable">
          {manualDemoPositions.length === 0
            ? <div style={{ fontSize: 11, color: 'var(--zi-mut)', padding: '2px 0' }}>No open positions</div>
            : <ZiTable columns={MANUAL_POSITION_COLUMNS}>{manualDemoPositions.map((pos: any) => <DemoPositionRow key={pos.id} pos={pos} />)}</ZiTable>}
        </div>
      </ZiSection>

      {/* P&L STATS — React-owned via positionsStore (D9) */}
      <ZiSection title="Closed trades">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
          <ZiMetric label="Total P&L" value={`${manualPnl >= 0 ? '+' : '-'}$${Math.abs(manualPnl).toFixed(2)}`} tone={_pnlTone} />
          <ZiMetric label="Win rate" value={manualWr} />
          <ZiMetric label="Trades" value={manualTrades} />
        </div>
      </ZiSection>

      {/* [R9] LIVE/TESTNET OPEN POSITIONS — reactive on exchangeMode */}
      <div id="livePositionsInDemo" style={{ display: isLiveMode ? 'block' : 'none' }}>
        <ZiSection title="Exchange positions" aside={String(liveRender.length)}>
          <div id="livePositionsDemo" style={{ fontSize: 11, color: 'var(--zi-mut)' }}>
            {liveRender.length === 0
              ? <span>No exchange positions</span>
              : <ZiTable columns={MANUAL_POSITION_COLUMNS}>{liveRender.map((pos: any) => <LivePositionRow key={pos.id} pos={pos} />)}</ZiTable>}
          </div>
        </ZiSection>
      </div>

      {/* TRADE JOURNAL */}
      <ZiSection
        title="Trade journal"
        aside={<button className="csv-btn" style={{ ...GHOST_BTN, textTransform: 'none' }} onClick={() => exportJournalCSV?.()}><svg className="z-i" viewBox="0 0 16 16"><path d="M8 2v8m-3-3l3 3 3-3M3 14h10" /></svg> CSV</button>}
      >
        {/* [R9] React-owned journal — reads positionsStore.journal */}
        <div className="journal-wrap" id="journalBody">
          {journalSorted.length === 0
            ? <div style={{ padding: '2px 0', fontSize: 11, color: 'var(--zi-mut)' }}>No trades yet</div>
            : <ZiTable columns={MANUAL_JOURNAL_COLUMNS}>{journalSorted.map((t: any) => <JournalRow key={(t.id || t.openTs || t.time) + ':' + (t.closedAt || '')} trade={t} />)}</ZiTable>}
        </div>
      </ZiSection>
    </ZiPanel>
    </div>
    </>
  )
}
