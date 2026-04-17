import { memo, useCallback } from 'react'
import { useAresStore } from '../../../stores/aresStore'
import { ARES_MONITOR } from '../../../engine/aresMonitor'
import { _aresRender } from '../../../engine/aresUI'
import type { AresPositionCard } from '../../../types/ares'

function _pnlColor(pnl: number): string {
  if (pnl > 0) return 'rgba(0,255,140,0.95)'
  if (pnl < 0) return 'rgba(255,60,60,0.95)'
  return 'rgba(70,200,255,0.95)'
}

function fmt1(n: number, fallback = '—'): string {
  return Number.isFinite(n) ? n.toFixed(1) : fallback
}

/** Close a single position, dispatching live vs demo path. */
function _closePosition(pos: AresPositionCard) {
  const w = window as any
  try {
    if (pos.live) {
      const live = w.ARES?.positions?.getOpen?.()?.find((p: any) => String(p.id) === pos.id)
      if (live) {
        // markPrice is on the engine object; fall back to entry if missing
        const mark = Number(live.markPrice) || Number(pos.entry) || 0
        ARES_MONITOR.closeLivePosition(live, mark, 'manual')
        setTimeout(() => _aresRender(), 500)
      }
    } else if (w.ARES?.positions) {
      w.ARES.positions.closePosition(pos.id)
      _aresRender()
    }
  } catch (_) { /* swallow — UI-side close */ }
}

function _closeAll() {
  const w = window as any
  if (typeof w.ARES !== 'undefined' && w.ARES.positions) {
    w.ARES.positions.closeAll()
    setTimeout(() => _aresRender(), 100)
  }
}

function PositionCard({ pos }: { pos: AresPositionCard }) {
  const pnlColor = _pnlColor(pos.pnl)
  const pnlSign = pos.pnl >= 0 ? '+' : ''
  const sideColor = pos.side === 'LONG' ? 'rgba(0,255,140,0.9)' : 'rgba(255,80,80,0.9)'
  // markPrice / liqPrice / slPrice / tpPrice live on engine objects, not in
  // the store slice. We could mirror them, but for R28.2-E we read from
  // the engine for the non-store-owned fields (same pattern as aresUI.ts).
  const w = window as any
  const engineEntry = w.ARES?.positions?.getOpen?.()?.find((p: any) => String(p.id) === pos.id)
  const mark = fmt1(Number(engineEntry?.markPrice))
  const liq = fmt1(Number(engineEntry?.liqPrice))
  const sl = engineEntry?.slPrice ? '$' + Number(engineEntry.slPrice).toFixed(1) : '—'
  const tp = engineEntry?.tpPrice ? '$' + Number(engineEntry.tpPrice).toFixed(1) : '—'
  const reason = engineEntry?.reason ? String(engineEntry.reason).substring(0, 80) : ''
  const bePill = engineEntry?._slMovedBE

  const onClose = useCallback(() => _closePosition(pos), [pos])

  return (
    <div style={{
      borderLeft: `2px solid ${pnlColor}`,
      padding: '4px 6px',
      marginBottom: 5,
      background: 'rgba(0,0,0,0.25)',
      borderRadius: '0 3px 3px 0',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 1 }}>
        <span style={{ fontFamily: 'monospace', fontSize: 13, color: 'rgba(255,255,255,0.85)', letterSpacing: '0.5px' }}>
          <span style={{ color: 'rgba(70,200,255,0.9)' }}>[{pos.symbol}]</span>
          <span style={{ color: sideColor, fontWeight: 700 }}> {pos.side}</span>
          <span style={{ color: 'rgba(255,200,60,0.85)' }}> x{Number(engineEntry?.leverage) || 1}</span>
          <span style={{ color: 'rgba(255,255,255,0.45)' }}> ISO  Size: {pos.size.toFixed(1)} USDT</span>
          {pos.live ? <span style={{ color: '#00ff88', fontSize: 10, letterSpacing: 1 }}> LIVE</span> : null}
          {bePill ? <span style={{ color: '#00d9ff', fontSize: 10 }}> BE</span> : null}
        </span>
        <button
          onClick={onClose}
          style={{
            background: 'rgba(255,50,50,0.18)',
            border: '1px solid rgba(255,50,50,0.5)',
            color: 'rgba(255,100,100,0.9)',
            fontFamily: 'monospace', fontSize: 11,
            padding: '2px 6px', cursor: 'pointer',
            borderRadius: 2, letterSpacing: 1,
          }}
        >CLOSE</button>
      </div>
      <div style={{ fontFamily: 'monospace', fontSize: 11, color: 'rgba(255,255,255,0.45)', marginBottom: 1 }}>
        Entry {pos.entry.toFixed(1)}  Mark {mark}  Liq{' '}
        <span style={{ color: 'rgba(255,120,50,0.75)' }}>{liq}</span>{'  '}
        SL <span style={{ color: 'rgba(255,60,60,0.7)' }}>{sl}</span>{'  '}
        TP <span style={{ color: 'rgba(0,255,140,0.7)' }}>{tp}</span>
      </div>
      <div style={{ fontFamily: 'monospace', fontSize: 12, color: pnlColor, fontWeight: 700, textShadow: `0 0 8px ${pnlColor}55` }}>
        uPnL {pnlSign}{pos.pnlPct.toFixed(2)}%   {pnlSign}{pos.pnl.toFixed(2)} USDT
      </div>
      {reason ? (
        <div style={{
          fontFamily: 'monospace', fontSize: 11, color: 'rgba(255,255,255,0.3)',
          marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>{reason}</div>
      ) : null}
    </div>
  )
}

/** Positions list + close-all button. */
export const PositionsList = memo(function PositionsList() {
  const positions = useAresStore((s) => s.ui.positions)
  const closeAllVisible = useAresStore((s) => s.ui.closeAllVisible)
  return (
    <div id="ares-positions-wrap" style={{ margin: '4px 12px 0', padding: '4px 0 2px', borderTop: '1px solid rgba(0,150,255,0.12)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
        <div className="ares-meta-title" style={{ margin: 0 }}>POSITIONS</div>
        <button
          id="ares-close-all-btn"
          onClick={_closeAll}
          style={{
            display: closeAllVisible ? 'inline-block' : 'none',
            background: 'rgba(255,50,50,0.15)',
            border: '1px solid rgba(255,50,50,0.4)',
            color: 'rgba(255,100,100,0.85)',
            fontFamily: 'monospace', fontSize: 11, padding: '2px 7px',
            cursor: 'pointer', borderRadius: 2, letterSpacing: 1,
          }}
        >CLOSE ALL</button>
      </div>
      <div id="ares-positions-list" style={{ maxHeight: 220, overflowY: 'auto' }}>
        {positions.length === 0 ? (
          <div style={{ color: 'rgba(255,255,255,0.25)', fontSize: 12, fontFamily: 'monospace', padding: '2px 0' }}>— none —</div>
        ) : positions.map((p) => <PositionCard key={p.id} pos={p} />)}
      </div>
    </div>
  )
})
