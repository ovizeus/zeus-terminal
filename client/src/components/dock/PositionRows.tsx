/**
 * [R9] React row components for ManualTradePanel — replaces the imperative
 * renderDemoPositions / renderLivePositions / renderPendingOrders / renderTradeJournal
 * DOM writers. Components read from positionsStore reactively; the engine pushes
 * source arrays via `useStore.getState().setPendingOrders/setManualLivePending/
 * setJournal/setDemoPositions/setLivePositions` and performs SL/TP/close actions
 * via the same engine exports the old inline handlers called.
 */
import { useRef, useEffect, useState, memo } from 'react'
import { escHtml } from '../../utils/dom'
import { fP, fmt } from '../../utils/format'
import { attachConfirmClose } from '../../engine/events'
import { getSymPrice, savePosSLTP, cancelPendingOrder, modifyPendingPrice, closeLivePos, calcPosPnL } from '../../data/marketDataPositions'
import { closeDemoPos } from '../../data/marketDataClose'
import { _safePnl } from '../../utils/guards'
import { useUiStore } from '../../stores'

// [Phase 12.A — Batch D5] Resolve exchange chip label for a LIVE position.
//   Prefer the position's own exchange field (if server ever attaches one),
//   fallback to useUiStore.activeExchange. Returns null when neither is
//   known — caller omits the chip rather than invent 'Binance'.
function _resolveExchangeLabel(pos: { exchange?: unknown }, fallback: 'binance' | 'bybit' | null): string | null {
  const own = typeof pos?.exchange === 'string' ? pos.exchange.toLowerCase() : null
  const pick = own || fallback
  if (pick === 'binance') return 'BINANCE'
  if (pick === 'bybit') return 'BYBIT'
  return null
}

const w = window as any

function _getCurPrice(sym: string | undefined): number {
  if (!sym) return 0
  try {
    const p = getSymPrice({ sym })
    if (p && Number.isFinite(p) && p > 0) return p
    const ap = (w.allPrices || {})[sym]
    return ap && Number.isFinite(ap) && ap > 0 ? ap : 0
  } catch { return 0 }
}

// ── Pending order row ────────────────────────────────────────────────────────
// [PERF-8 2026-05-13] memo wrapper — row componente sunt rendered N times în
// positions/pending/journal lists. Re-render trigger pe fiecare price tick
// (frequency ~1-10Hz). React.memo short-circuit-ează re-renders când prop
// reference unchanged. Store setters replace items, deci memo invalidează
// CORECT doar pentru cards changed. Pattern mirror din PositionsList [PERF-3].
export const PendingOrderRow = memo(function PendingOrderRow({ ord }: { ord: any }) {
  const symBase = (ord.sym || '').replace('USDT', '')
  const sideColor = ord.side === 'LONG' ? 'var(--cyan)' : 'var(--blu)'
  const curPrice = _getCurPrice(ord.sym)
  const distPct = curPrice > 0 ? (((ord.limitPrice - curPrice) / curPrice) * 100).toFixed(2) : '?'
  const age = Date.now() - (ord.createdAt || Date.now())
  const ageStr = age < 60000 ? Math.floor(age / 1000) + 's' : Math.floor(age / 60000) + 'm'
  const isLive = ord.mode === 'live'
  const activeExchange = useUiStore((s) => s.activeExchange)
  const exchLabel = isLive ? _resolveExchangeLabel(ord, activeExchange) : null

  return (
    <div className="pos-row pos-pending" style={{ borderColor: sideColor }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontWeight: 700, color: sideColor }}>
          <span style={{ background: '#00d4ff22', color: '#00d4ff', padding: '1px 6px', borderRadius: 3, fontSize: 9, fontWeight: 700, marginRight: 4 }}>
            WAITING LIMIT
          </span>
          {ord.side} {symBase} {ord.lev}x
          <span style={{
            background: isLive ? '#ff444422' : '#aa44ff22',
            color: isLive ? '#ff4444' : '#aa44ff',
            padding: '1px 5px', borderRadius: 3, fontSize: 9, fontWeight: 700, marginLeft: 4,
          }}>{isLive ? 'LIVE' : 'DEMO'}</span>
          {exchLabel && (
            <span style={{
              background: '#00d4ff1a',
              color: '#00d4ff',
              padding: '1px 5px', borderRadius: 3, fontSize: 9, fontWeight: 700, marginLeft: 4, letterSpacing: 1,
            }}>{exchLabel}</span>
          )}
        </span>
        <div style={{ display: 'flex', gap: 4 }}>
          <button
            onClick={() => modifyPendingPrice(ord.id)}
            style={{ padding: '6px 10px', background: '#001a33', border: '1px solid #00aaff', color: '#00d4ff', borderRadius: 3, fontSize: 9, cursor: 'pointer', fontWeight: 700, minHeight: 36 }}
          >EDIT MODIFY</button>
          <button
            onClick={() => cancelPendingOrder(ord.id)}
            style={{ padding: '6px 10px', background: '#2a0010', border: '1px solid #ff4466', color: '#ff4466', borderRadius: 3, fontSize: 9, cursor: 'pointer', fontWeight: 700, minHeight: 36 }}
          >✕ CANCEL</button>
        </div>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginTop: 3, color: 'var(--dim)' }}>
        <span>Limit: ${fP(ord.limitPrice)} | Size: ${fmt(ord.size)}</span>
        <span>Now: {curPrice > 0 ? '$' + fP(curPrice) : '—'} ({distPct}%)</span>
      </div>
      <div style={{ fontSize: 11, color: 'var(--dim)', marginTop: 1 }}>
        {ord.sl ? `SL: $${fP(ord.sl)} ` : ''}
        {ord.tp ? `TP: $${fP(ord.tp)} ` : ''}
        | {ageStr} ago
        {ord.exchangeOrderId ? ` | OID: ${ord.exchangeOrderId}` : ''}
      </div>
    </div>
  )
})

// ── Demo position row (editable SL/TP + Close) ──────────────────────────────
// [PERF-8 2026-05-13] memo wrapper — see PendingOrderRow comment.
export const DemoPositionRow = memo(function DemoPositionRow({ pos }: { pos: any }) {
  const curPrice = _getCurPrice(pos.sym)
  const btnRef = useRef<HTMLButtonElement>(null)
  const [sl, setSl] = useState<string>(pos.sl ? String(pos.sl) : '')
  const [tp, setTp] = useState<string>(pos.tp ? String(pos.tp) : '')
  const activeExchange = useUiStore((s) => s.activeExchange)

  // Re-sync inputs when server-side updates the position (but not during active edit)
  useEffect(() => {
    const el = document.activeElement as any
    if (el && el.id && (el.id.startsWith('slEdit_') || el.id.startsWith('tpEdit_'))) return
    setSl(pos.sl ? String(pos.sl) : '')
    setTp(pos.tp ? String(pos.tp) : '')
  }, [pos.sl, pos.tp])

  // Attach confirm-close to the Close button
  useEffect(() => {
    if (!btnRef.current) return
    if (typeof attachConfirmClose === 'function') {
      attachConfirmClose(btnRef.current, () => closeDemoPos(pos.id))
    }
  }, [pos.id])

  if (!curPrice || !Number.isFinite(curPrice) || curPrice <= 0) {
    pos.pnl = 0
    const symBase = (pos.sym || 'BTC').replace('USDT', '')
    return (
      <div className="pos-row">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontWeight: 700 }}>{pos.side} {symBase} {pos.lev}x</span>
          <button ref={btnRef} style={{ padding: '10px 14px', background: '#2a0010', border: '2px solid #ff4466', color: '#ff4466', borderRadius: 4, fontSize: 10, cursor: 'pointer', minHeight: 52, fontWeight: 700 }}>✕ CLOSE</button>
        </div>
        <div style={{ fontSize: 13, marginTop: 3, color: '#ff8800' }}>Price unavailable</div>
      </div>
    )
  }

  const diff = curPrice - pos.entry
  pos.pnl = _safePnl(pos.side, diff, pos.entry, pos.size, pos.lev, true)
  const pnlPct = pos.size > 0 ? (pos.pnl / (pos.size || 1) * 100).toFixed(2) : '0.00'
  const margin = Number(pos.size) || 0
  const lev = Number(pos.lev) || 1
  const notional = margin * lev
  const feeRate = (w.S?.feeRate ?? 0.0004) as number
  const estFees = notional * feeRate * 2
  const roe = margin > 0 ? (pos.pnl / margin * 100).toFixed(2) : '0.00'
  const symBase = (pos.sym || 'BTC').replace('USDT', '')
  const isLive = (pos.mode || 'demo') === 'live'
  const exchLabel = isLive ? _resolveExchangeLabel(pos, activeExchange) : null
  const dsl = (w.DSL && w.DSL.positions) ? w.DSL.positions[String(pos.id)] : null
  const dslActive = dsl && dsl.active
  const slVal = dslActive && dsl.currentSL > 0 ? dsl.currentSL : pos.sl
  const slLabel = dslActive ? 'DSL' : 'SL'
  const slColor = dslActive ? '#39ff14' : '#ff6644'

  const saveSLTP = () => {
    // savePosSLTP reads the input values by id (slEdit_<id>, tpEdit_<id>) which
    // our React inputs render with the same ids — the legacy contract holds.
    savePosSLTP(pos.id, 'demo')
  }

  return (
    <div className={`pos-row ${pos.side === 'LONG' ? 'pos-long' : 'pos-short'}`}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontWeight: 700 }}>
          {pos.side} {symBase} {pos.lev}x
          <span style={{ background: isLive ? '#ff444422' : '#aa44ff22', color: isLive ? '#ff4444' : '#aa44ff', padding: '1px 5px', borderRadius: 3, fontSize: 10, fontWeight: 700, marginLeft: 6 }}>
            {isLive ? 'LIVE' : 'DEMO'}
          </span>
          {exchLabel && (
            <span style={{ background: '#00d4ff1a', color: '#00d4ff', padding: '1px 5px', borderRadius: 3, fontSize: 10, fontWeight: 700, marginLeft: 4, letterSpacing: 1 }}>
              {exchLabel}
            </span>
          )}
        </span>
        <button ref={btnRef} data-id={pos.id} style={{ padding: '10px 14px', background: '#2a0010', border: '2px solid #ff4466', color: '#ff4466', borderRadius: 4, fontSize: 10, cursor: 'pointer', minHeight: 52, fontWeight: 700 }}>✕ CLOSE</button>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginTop: 3 }}>
        <span style={{ color: 'var(--dim)' }}>Entry: ${fP(pos.entry)} | Now: ${fP(curPrice)}</span>
        <span style={{ color: pos.pnl >= 0 ? 'var(--grn)' : 'var(--red)' }}>
          {pos.pnl >= 0 ? '+' : ''}${pos.pnl.toFixed(2)} ({pnlPct}%)
        </span>
      </div>
      <div style={{ fontSize: 12, color: 'var(--dim)', marginTop: 1 }}>
        Margin: ${fmt(margin)} | Notional: ${fmt(notional)} | Fees≈${fmt(estFees)} | ROE: {roe}%
      </div>
      {dslActive && (
        <div style={{ fontSize: 12, color: slColor, marginTop: 1 }}>
          {slLabel}: ${fP(slVal)}{pos.tp ? ` | TP: $${fP(pos.tp)}` : ''}
        </div>
      )}
      <div style={{ display: 'flex', gap: 4, marginTop: 3, alignItems: 'center' }}>
        <span style={{ fontSize: 10, color: '#ff6644', width: 22 }}>SL:</span>
        <input id={`slEdit_${pos.id}`} type="number" step={0.1} value={sl} onChange={e => setSl(e.target.value)} placeholder="—" style={{ flex: 1, background: '#0a0a14', border: '1px solid #333', color: '#ff6644', padding: '3px 5px', borderRadius: 3, fontSize: 11, fontFamily: 'var(--ff)', width: 60 }} />
        <span style={{ fontSize: 10, color: '#00ff88', width: 22 }}>TP:</span>
        <input id={`tpEdit_${pos.id}`} type="number" step={0.1} value={tp} onChange={e => setTp(e.target.value)} placeholder="—" style={{ flex: 1, background: '#0a0a14', border: '1px solid #333', color: '#00ff88', padding: '3px 5px', borderRadius: 3, fontSize: 11, fontFamily: 'var(--ff)', width: 60 }} />
        <button onClick={saveSLTP} style={{ padding: '3px 8px', background: '#001a22', border: '1px solid #00aaff', color: '#00d4ff', borderRadius: 3, fontSize: 9, cursor: 'pointer', fontWeight: 700, minHeight: 24 }}>SAVE</button>
      </div>
      {pos.liqPrice ? (
        <div style={{ fontSize: 12, color: pos.side === 'LONG' ? '#ff3355' : '#00d97a', marginTop: 1 }}>
          LIQ: ${fP(pos.liqPrice)}
        </div>
      ) : null}
    </div>
  )
})

// ── Live position row (editable SL/TP + Close) ──────────────────────────────
// [PERF-8 2026-05-13] memo wrapper — see PendingOrderRow comment.
export const LivePositionRow = memo(function LivePositionRow({ pos }: { pos: any }) {
  const [sl, setSl] = useState<string>(pos.sl ? String(pos.sl) : '')
  const [tp, setTp] = useState<string>(pos.tp ? String(pos.tp) : '')
  // [BUG-CLOSE FIX 2026-05-14] React-native 2-click confirm pattern, replaces
  // attachConfirmClose direct DOM mutation. Previous pattern set
  // `btn.innerHTML = '✓ CONFIRM?'` which React reconciliation wiped on the
  // very next price-tick re-render — operator never saw the visible state
  // change and clicked again, thinking the button was broken. State-driven
  // button text survives React render cycles.
  const [pendingConfirm, setPendingConfirm] = useState(false)
  const _confirmTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const activeExchange = useUiStore((s) => s.activeExchange)
  const exchLabel = _resolveExchangeLabel(pos, activeExchange)

  useEffect(() => {
    const el = document.activeElement as any
    if (el && el.id && (el.id.startsWith('slEdit_') || el.id.startsWith('tpEdit_'))) return
    setSl(pos.sl ? String(pos.sl) : '')
    setTp(pos.tp ? String(pos.tp) : '')
  }, [pos.sl, pos.tp])

  // [BUG-CLOSE FIX 2026-05-14] Cleanup timer on unmount to prevent setState
  // on unmounted component during fast position close→reopen cycles.
  useEffect(() => {
    return () => {
      if (_confirmTimerRef.current) {
        clearTimeout(_confirmTimerRef.current)
        _confirmTimerRef.current = null
      }
    }
  }, [])

  // [BUG-CLOSE FIX 2026-05-14] React-native click handler. First click sets
  // pendingConfirm state (visible via render). Second click within 2.5s fires
  // closeLivePos. Timer auto-resets pending state if user doesn't confirm.
  const _onCloseClick = () => {
    if (pendingConfirm) {
      if (_confirmTimerRef.current) {
        clearTimeout(_confirmTimerRef.current)
        _confirmTimerRef.current = null
      }
      setPendingConfirm(false)
      closeLivePos(pos.id)
      return
    }
    setPendingConfirm(true)
    if (_confirmTimerRef.current) clearTimeout(_confirmTimerRef.current)
    _confirmTimerRef.current = setTimeout(() => {
      setPendingConfirm(false)
      _confirmTimerRef.current = null
    }, 2500)
  }

  const _closeBtnText = pendingConfirm ? '✓ CONFIRM?' : '✕ CLOSE'
  const _closeBtnBg = pendingConfirm ? '#1a1200' : '#2a0010'
  const _closeBtnBorder = pendingConfirm ? 'var(--gold)' : '#ff4466'
  const _closeBtnColor = pendingConfirm ? 'var(--gold)' : '#ff4466'

  const cur = _getCurPrice(pos.sym)
  const symBase = (pos.sym || '').replace('USDT', '')
  const dotRed = '●'

  if (!cur || !Number.isFinite(cur) || cur <= 0) {
    pos.pnl = 0
    return (
      <div className={`pos-row ${pos.side === 'LONG' ? 'pos-long' : 'pos-short'}`}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontWeight: 700 }}>
            {dotRed} {pos.side} {symBase} {pos.lev}x
            {exchLabel && (
              <span style={{ background: '#00d4ff1a', color: '#00d4ff', padding: '1px 5px', borderRadius: 3, fontSize: 10, fontWeight: 700, marginLeft: 6, letterSpacing: 1 }}>{exchLabel}</span>
            )}
          </span>
          <button data-live-id={pos.id} onClick={_onCloseClick} style={{ padding: '10px 14px', background: _closeBtnBg, border: `2px solid ${_closeBtnBorder}`, color: _closeBtnColor, borderRadius: 4, fontSize: 10, cursor: 'pointer', minHeight: 52, fontWeight: 700 }}>{_closeBtnText}</button>
        </div>
        <div style={{ fontSize: 13, marginTop: 3, color: '#ff8800' }}>Price unavailable</div>
      </div>
    )
  }

  const pnl = (pos.fromExchange && Number.isFinite(pos.pnl)) ? pos.pnl : calcPosPnL(pos, cur)
  if (!pos.fromExchange) pos.pnl = pnl
  const pnlPct = pos.size > 0 ? (pnl / (pos.size || 1) * 100).toFixed(2) : '0.00'

  const saveSLTP = () => {
    savePosSLTP(pos.id, 'live')
  }

  return (
    <div className={`pos-row ${pos.side === 'LONG' ? 'pos-long' : 'pos-short'}`}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontWeight: 700 }}>
          {dotRed} {pos.side} {symBase} {pos.lev}x
          {exchLabel && (
            <span style={{ background: '#00d4ff1a', color: '#00d4ff', padding: '1px 5px', borderRadius: 3, fontSize: 10, fontWeight: 700, marginLeft: 6, letterSpacing: 1 }}>{exchLabel}</span>
          )}
        </span>
        <button data-live-id={pos.id} onClick={_onCloseClick} style={{ padding: '10px 14px', background: _closeBtnBg, border: `2px solid ${_closeBtnBorder}`, color: _closeBtnColor, borderRadius: 4, fontSize: 10, cursor: 'pointer', minHeight: 52, fontWeight: 700 }}>{_closeBtnText}</button>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginTop: 3 }}>
        <span style={{ color: 'var(--dim)' }}>Entry: ${fP(pos.entry)} | Now: ${fP(cur)}</span>
        <span style={{ color: pnl >= 0 ? 'var(--grn)' : 'var(--red)' }}>
          {pnl >= 0 ? '+' : ''}${pnl.toFixed(2)} ({pnlPct}%)
        </span>
      </div>
      {pos.liqPrice ? (
        <div style={{ fontSize: 12, color: '#ff3355', marginTop: 1 }}>LIQ: ${fP(pos.liqPrice)}</div>
      ) : null}
      <div style={{ display: 'flex', gap: 4, marginTop: 3, alignItems: 'center' }}>
        <span style={{ fontSize: 10, color: '#ff6644', width: 22 }}>SL:</span>
        <input id={`slEdit_${pos.id}`} type="number" step={0.1} value={sl} onChange={e => setSl(e.target.value)} placeholder="—" style={{ flex: 1, background: '#0a0a14', border: '1px solid #333', color: '#ff6644', padding: '3px 5px', borderRadius: 3, fontSize: 11, fontFamily: 'var(--ff)', width: 60 }} />
        <span style={{ fontSize: 10, color: '#00ff88', width: 22 }}>TP:</span>
        <input id={`tpEdit_${pos.id}`} type="number" step={0.1} value={tp} onChange={e => setTp(e.target.value)} placeholder="—" style={{ flex: 1, background: '#0a0a14', border: '1px solid #333', color: '#00ff88', padding: '3px 5px', borderRadius: 3, fontSize: 11, fontFamily: 'var(--ff)', width: 60 }} />
        <button onClick={saveSLTP} style={{ padding: '3px 8px', background: '#001a22', border: '1px solid #00aaff', color: '#00d4ff', borderRadius: 3, fontSize: 9, cursor: 'pointer', fontWeight: 700, minHeight: 24 }}>SAVE</button>
      </div>
    </div>
  )
})

// ── Journal row (read-only) ─────────────────────────────────────────────────
// [PERF-8 2026-05-13] memo wrapper — see PendingOrderRow comment.
export const JournalRow = memo(function JournalRow({ trade }: { trade: any }) {
  const pnl = Number(trade.pnl) || 0
  const win = pnl >= 0
  const pnlStr = (win ? '+' : '') + '$' + pnl.toFixed(2)
  const ep = '$' + fP(trade.entry || 0) + '→$' + fP(trade.exit || 0)
  return (
    <div className={`journal-row ${win ? 'win' : 'loss'}`}>
      <span style={{ color: 'var(--dim)' }}>{escHtml(trade.time || '')}</span>
      <span style={{ color: trade.side === 'LONG' ? 'var(--grn)' : 'var(--red)' }}>{escHtml(trade.side || '')}</span>
      <span style={{ color: 'var(--dim)', fontSize: 11 }}>{ep}</span>
      <span style={{ color: win ? 'var(--grn)' : 'var(--red)', fontWeight: 700 }}>{pnlStr}</span>
      <span style={{ color: 'var(--dim)', fontSize: 11 }}>{escHtml(trade.reason || '—')}</span>
    </div>
  )
})
