import { memo, useCallback } from 'react'
import { useAresStore } from '../../../stores/aresStore'
import type { AresPositionCard } from '../../../types/ares'

function _pnlColor(pnl: number): string {
  if (pnl > 0) return 'rgba(0,255,140,0.95)'
  if (pnl < 0) return 'rgba(255,60,60,0.95)'
  return 'rgba(70,200,255,0.95)'
}

function fmt1(n: number, fallback = '—'): string {
  return Number.isFinite(n) && n !== 0 ? n.toFixed(1) : fallback
}

function PositionCard({ pos }: { pos: AresPositionCard }) {
  const closeArePosition = useAresStore((s) => s.closeArePosition)
  const pnlColor = _pnlColor(pos.pnl)
  const pnlSign = pos.pnl >= 0 ? '+' : ''
  const sideColor = pos.side === 'LONG' ? 'rgba(0,255,140,0.9)' : 'rgba(255,80,80,0.9)'
  const mark = fmt1(pos.markPrice)
  const liq = fmt1(pos.liqPrice)
  const sl = pos.slPrice ? '$' + pos.slPrice.toFixed(1) : '—'
  const tp = pos.tpPrice ? '$' + pos.tpPrice.toFixed(1) : '—'
  const reason = pos.reason ? pos.reason.substring(0, 80) : ''
  const bePill = pos.beMoved

  const onClose = useCallback(() => closeArePosition(pos.id, pos.live, pos.entry), [closeArePosition, pos.id, pos.live, pos.entry])

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
          <span style={{ color: 'rgba(255,200,60,0.85)' }}> x{pos.leverage || 1}</span>
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
  const closeAllArePositions = useAresStore((s) => s.closeAllArePositions)
  return (
    <div id="ares-positions-wrap" style={{ margin: '4px 12px 0', padding: '4px 0 2px', borderTop: '1px solid rgba(0,150,255,0.12)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
        <div className="ares-meta-title" style={{ margin: 0 }}>POSITIONS</div>
        <button
          id="ares-close-all-btn"
          onClick={closeAllArePositions}
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
