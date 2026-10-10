/**
 * [R9] React row components for ManualTradePanel — replaces the imperative
 * renderDemoPositions / renderLivePositions / renderPendingOrders / renderTradeJournal
 * DOM writers. Components read from positionsStore reactively; the engine pushes
 * source arrays via `useStore.getState().setPendingOrders/setManualLivePending/
 * setJournal/setDemoPositions/setLivePositions` and performs SL/TP/close actions
 * via the same engine exports the old inline handlers called.
 */
import { useRef, useEffect, useState, memo } from 'react'
import type { CSSProperties } from 'react'
import { escHtml } from '../../utils/dom'
import { fP, fmt } from '../../utils/format'
import { attachConfirmClose } from '../../engine/events'
import { getSymPrice, savePosSLTP, cancelPendingOrder, modifyPendingPrice, closeLivePos, calcPosPnL } from '../../data/marketDataPositions'
import { closeDemoPos } from '../../data/marketDataClose'
import { _safePnl, resolveDisplayPnl } from '../../utils/guards'
import { useUiStore } from '../../stores'
import { toast } from '../../data/marketDataHelpers'
import { _ZI } from '../../constants/icons'
import { ZiRow, POSITION_COLUMNS_WITH_ACTION, JOURNAL_COLUMNS, type ZiTone } from '../zi'

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

// [2026-10-10 institutional redesign, Task 2 — DESIGN ONLY] Everything below the
// imports that is styling is new; every handler, store call, effect and hook in
// this file is exactly what it was. The rows stay COMPONENTS (they hold the
// close / save-SL-TP / cancel / modify money-path call sites) and use ZiRow INSIDE themselves, with the action button as the last
// cell, so the shared column template and the actions both survive.
//
// [2026-10-10] This file used to define its own MANUAL_POSITION_COLUMNS, because
// the shared ACTION_COLUMN was `auto` and an auto track sizes to each row's own
// button — a row showing '✓ CONFIRM?' would have pushed its P&L column left of
// the row above. That was a real flaw and it has been fixed at the source:
// ACTION_COLUMN is a fixed 96px track now, so the shared template is used
// directly and there is exactly ONE positions template again.

const sideTone = (side: string): ZiTone => (side === 'LONG' ? 'pos' : 'neg')
const pnlTone = (n: number): ZiTone => (n >= 0 ? 'pos' : 'neg')
const signedUsd = (n: number): string => (n >= 0 ? '+' : '-') + '$' + Math.abs(n).toFixed(2)

const DETAIL: CSSProperties = { fontSize: 11, color: 'var(--zi-mut)', paddingBottom: 3, fontVariantNumeric: 'tabular-nums' }
const CHIP: CSSProperties = { border: '1px solid var(--zi-line)', color: 'var(--zi-mut)', padding: '0 5px', borderRadius: 2, fontSize: 9, fontWeight: 600, letterSpacing: '0.08em', marginLeft: 6 }
const BTN_BASE: CSSProperties = { background: 'transparent', borderRadius: 2, cursor: 'pointer', fontWeight: 600, letterSpacing: '0.06em', width: '100%' }
const FIELD: CSSProperties = { flex: 1, background: 'var(--zi-field)', border: '1px solid var(--zi-line)', padding: '3px 5px', borderRadius: 2, fontSize: 11, width: 60, fontFamily: 'var(--zi-mono)' }
const FIELD_LBL: CSSProperties = { fontSize: 10, width: 22 }
const SAVE_BTN: CSSProperties = { padding: '3px 10px', background: 'transparent', border: '1px solid var(--zi-edge)', color: 'var(--zi-val)', borderRadius: 2, fontSize: 9, cursor: 'pointer', fontWeight: 600, minHeight: 24, letterSpacing: '0.08em' }
const closeBtnStyle = (confirm: boolean): CSSProperties => ({
  ...BTN_BASE, padding: '10px 6px', fontSize: 10, minHeight: 52,
  border: `1px solid ${confirm ? 'var(--zi-warn)' : 'var(--zi-neg)'}`,
  color: confirm ? 'var(--zi-warn)' : 'var(--zi-neg)',
})

function _getCurPrice(sym: string | undefined): number {
  if (!sym) return 0
  try {
    const p = getSymPrice({ sym })
    if (p && Number.isFinite(p) && p > 0) return p
    const ap = (w.allPrices || {})[sym]
    return ap && Number.isFinite(ap) && ap > 0 ? ap : 0
  } catch { return 0 }
}

// Presentational only: the inputs keep the ids slEdit_<id> / tpEdit_<id> that
// the save routine reads from the DOM, and the caller keeps its own state + save fn.
function SlTpEditor({ id, sl, tp, setSl, setTp, onSave }: {
  id: unknown; sl: string; tp: string
  setSl: (v: string) => void; setTp: (v: string) => void; onSave: () => void
}) {
  return (
    <div style={{ display: 'flex', gap: 4, padding: '3px 0 7px', alignItems: 'center' }}>
      <label htmlFor={`slEdit_${id}`} style={{ ...FIELD_LBL, color: 'var(--zi-neg)' }}>SL:</label>
      <input id={`slEdit_${id}`} type="number" step={0.1} value={sl} onChange={e => setSl(e.target.value)} placeholder="—" style={{ ...FIELD, color: 'var(--zi-neg)' }} />
      <label htmlFor={`tpEdit_${id}`} style={{ ...FIELD_LBL, color: 'var(--zi-pos)' }}>TP:</label>
      <input id={`tpEdit_${id}`} type="number" step={0.1} value={tp} onChange={e => setTp(e.target.value)} placeholder="—" style={{ ...FIELD, color: 'var(--zi-pos)' }} />
      <button onClick={onSave} style={SAVE_BTN}>SAVE</button>
    </div>
  )
}

function ModeChip({ isLive }: { isLive: boolean }) {
  return <span style={{ ...CHIP, ...(isLive ? { color: 'var(--zi-warn)', borderColor: 'var(--zi-warn)' } : {}) }}>{isLive ? 'LIVE' : 'DEMO'}</span>
}

// ── Pending order row ────────────────────────────────────────────────────────
// [PERF-8 2026-05-13] memo wrapper — row componente sunt rendered N times în
// positions/pending/journal lists. Re-render trigger pe fiecare price tick
// (frequency ~1-10Hz). React.memo short-circuit-ează re-renders când prop
// reference unchanged. Store setters replace items, deci memo invalidează
// CORECT doar pentru cards changed. Pattern mirror din PositionsList [PERF-3].
export const PendingOrderRow = memo(function PendingOrderRow({ ord }: { ord: any }) {
  const symBase = (ord.sym || '').replace('USDT', '')
  const curPrice = _getCurPrice(ord.sym)
  const distPct = curPrice > 0 ? (((ord.limitPrice - curPrice) / curPrice) * 100).toFixed(2) : '?'
  const age = Date.now() - (ord.createdAt || Date.now())
  const ageStr = age < 60000 ? Math.floor(age / 1000) + 's' : Math.floor(age / 60000) + 'm'
  const isLive = ord.mode === 'live'
  const activeExchange = useUiStore((s) => s.activeExchange)
  const exchLabel = isLive ? _resolveExchangeLabel(ord, activeExchange) : null

  return (
    <div data-zi-position-row="pending">
      <ZiRow
        columns={POSITION_COLUMNS_WITH_ACTION}
        cells={[
          <span key="s">
            {symBase} {ord.lev}x
            <span style={{ ...CHIP, color: 'var(--zi-warn)', borderColor: 'var(--zi-warn)' }}>WAITING LIMIT</span>
            <ModeChip isLive={isLive} />
            {exchLabel && <span style={CHIP}>{exchLabel}</span>}
          </span>,
          { value: ord.side, tone: sideTone(ord.side) },
          `$${fmt(ord.size)}`,
          '—',
          <div key="a" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <button
              onClick={() => modifyPendingPrice(ord.id)}
              style={{ ...BTN_BASE, padding: '6px 6px', border: '1px solid var(--zi-edge)', color: 'var(--zi-val)', fontSize: 9, minHeight: 36 }}
            >EDIT MODIFY</button>
            <button
              onClick={() => cancelPendingOrder(ord.id)}
              style={{ ...BTN_BASE, padding: '6px 6px', border: '1px solid var(--zi-neg)', color: 'var(--zi-neg)', fontSize: 9, minHeight: 36 }}
            >✕ CANCEL</button>
          </div>,
        ]}
      />
      <div style={DETAIL}>
        Limit: ${fP(ord.limitPrice)} | Size: ${fmt(ord.size)} | Now: {curPrice > 0 ? '$' + fP(curPrice) : '—'} ({distPct}%)
      </div>
      <div style={{ ...DETAIL, color: 'var(--zi-faint)' }}>
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
      <div data-zi-position-row="demo">
        <ZiRow
          columns={POSITION_COLUMNS_WITH_ACTION}
          cells={[
            `${symBase} ${pos.lev}x`,
            { value: pos.side, tone: sideTone(pos.side) },
            `$${fmt(pos.size)}`,
            '—',
            <button key="c" ref={btnRef} style={closeBtnStyle(false)}>✕ CLOSE</button>,
          ]}
        />
        <div style={{ ...DETAIL, color: 'var(--zi-warn)' }}>Price unavailable</div>
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

  const saveSLTP = () => {
    // savePosSLTP reads the input values by id (slEdit_<id>, tpEdit_<id>) which
    // our React inputs render with the same ids — the legacy contract holds.
    savePosSLTP(pos.id, 'demo')
  }

  return (
    <div data-zi-position-row="demo">
      <ZiRow
        columns={POSITION_COLUMNS_WITH_ACTION}
        cells={[
          <span key="s">
            {symBase} {pos.lev}x
            <ModeChip isLive={isLive} />
            {exchLabel && <span style={CHIP}>{exchLabel}</span>}
          </span>,
          { value: pos.side, tone: sideTone(pos.side) },
          `$${fmt(margin)}`,
          { value: signedUsd(pos.pnl), tone: pnlTone(pos.pnl) },
          <button key="c" ref={btnRef} data-id={pos.id} style={closeBtnStyle(false)}>✕ CLOSE</button>,
        ]}
      />
      <div style={DETAIL}>
        Entry: ${fP(pos.entry)} | Now: ${fP(curPrice)} | {pos.pnl >= 0 ? '+' : ''}{pnlPct}%
      </div>
      <div style={DETAIL}>
        Margin: ${fmt(margin)} | Notional: ${fmt(notional)} | Fees≈${fmt(estFees)} | ROE: {roe}%
      </div>
      {dslActive && (
        <div style={{ ...DETAIL, color: dslActive ? 'var(--zi-pos)' : 'var(--zi-neg)' }}>
          {slLabel}: ${fP(slVal)}{pos.tp ? ` | TP: $${fP(pos.tp)}` : ''}
        </div>
      )}
      <SlTpEditor id={pos.id} sl={sl} tp={tp} setSl={setSl} setTp={setTp} onSave={saveSLTP} />
      {pos.liqPrice ? (
        <div style={{ ...DETAIL, color: 'var(--zi-neg)' }}>
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
  //
  // [BUG-CLOSE-3 FIX 2026-05-14] Hint toast on first click — operator UX
  // discovery: users may not realize 2-click confirm pattern is required.
  // Short cyan hint "Click again to confirm" la primul click; nu se mai
  // arată pe al doilea click (close fires direct).
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
    toast('Click again to confirm close', 1500, _ZI.w)
    if (_confirmTimerRef.current) clearTimeout(_confirmTimerRef.current)
    _confirmTimerRef.current = setTimeout(() => {
      setPendingConfirm(false)
      _confirmTimerRef.current = null
    }, 2500)
  }

  const _closeBtnText = pendingConfirm ? '✓ CONFIRM?' : '✕ CLOSE'

  const cur = _getCurPrice(pos.sym)
  const symBase = (pos.sym || '').replace('USDT', '')
  const dotRed = '●'

  if (!cur || !Number.isFinite(cur) || cur <= 0) {
    pos.pnl = 0
    return (
      <div data-zi-position-row="live">
        <ZiRow
          columns={POSITION_COLUMNS_WITH_ACTION}
          cells={[
            <span key="s">
              {dotRed} {symBase} {pos.lev}x
              {exchLabel && <span style={CHIP}>{exchLabel}</span>}
            </span>,
            { value: pos.side, tone: sideTone(pos.side) },
            `$${fmt(pos.size)}`,
            '—',
            <button key="c" data-live-id={pos.id} onClick={_onCloseClick} style={closeBtnStyle(pendingConfirm)}>{_closeBtnText}</button>,
          ]}
        />
        <div style={{ ...DETAIL, color: 'var(--zi-warn)' }}>Price unavailable</div>
      </div>
    )
  }

  // [2026-05-18 PnL parity fix] For LIVE positions, prefer Binance-fetched
  // unrealizedPnL (pos.pnl, mark-price-based). Local last-price calc differs
  // from Binance UI on volatile assets. Server-authoritative positions don't
  // have fromExchange flag but DO have pos.pnl populated from periodic sync.
  // [2026-06-14] resolveDisplayPnl: an uncomputed/stale exchange pnl of exactly 0
  // must not mask the real price-based PnL (a live position with entry != cur
  // cannot be exactly 0). Trust pos.pnl only when it's a real non-zero value.
  const pnl = resolveDisplayPnl(pos.fromExchange || pos.mode === 'live', pos.pnl, calcPosPnL(pos, cur))
  if (!pos.fromExchange) pos.pnl = pnl
  const pnlPct = pos.size > 0 ? (pnl / (pos.size || 1) * 100).toFixed(2) : '0.00'

  const saveSLTP = () => {
    savePosSLTP(pos.id, 'live')
  }

  return (
    <div data-zi-position-row="live">
      <ZiRow
        columns={POSITION_COLUMNS_WITH_ACTION}
        cells={[
          <span key="s">
            {dotRed} {symBase} {pos.lev}x
            {exchLabel && <span style={CHIP}>{exchLabel}</span>}
          </span>,
          { value: pos.side, tone: sideTone(pos.side) },
          `$${fmt(Number(pos.size) || 0)}`,
          { value: signedUsd(pnl), tone: pnlTone(pnl) },
          <button key="c" data-live-id={pos.id} onClick={_onCloseClick} style={closeBtnStyle(pendingConfirm)}>{_closeBtnText}</button>,
        ]}
      />
      <div style={DETAIL}>
        Entry: ${fP(pos.entry)} | Now: ${fP(cur)} | {pnl >= 0 ? '+' : ''}{pnlPct}%
      </div>
      {pos.liqPrice ? (
        <div style={{ ...DETAIL, color: 'var(--zi-neg)' }}>LIQ: ${fP(pos.liqPrice)}</div>
      ) : null}
      <SlTpEditor id={pos.id} sl={sl} tp={tp} setSl={setSl} setTp={setTp} onSave={saveSLTP} />
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
  const symBase = String(trade.sym || '').replace('USDT', '')
  return (
    <div data-zi-journal-row={win ? 'win' : 'loss'}>
      <ZiRow
        columns={JOURNAL_COLUMNS}
        cells={[
          escHtml(trade.time || ''),
          <span key="s">
            {symBase || '—'}{' '}
            <span style={{ color: trade.side === 'LONG' ? 'var(--zi-pos)' : 'var(--zi-neg)' }}>{escHtml(trade.side || '')}</span>
          </span>,
          { value: pnlStr, tone: win ? 'pos' : 'neg' },
        ]}
      />
      <div style={{ ...DETAIL, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {ep} | {escHtml(trade.reason || '—')}
      </div>
    </div>
  )
})
