import { useState, useCallback } from 'react'

interface PartialCloseModalProps {
  posId: number | string
  side: string
  sym: string
  size: number
  pnl: number
  onClose: (posId: number | string, pct: number) => void
  onCancel: () => void
}

export default function PartialCloseModal({ posId, side, sym, size, pnl, onClose, onCancel }: PartialCloseModalProps) {
  const [customPct, setCustomPct] = useState(50)
  const symBase = sym.replace('USDT', '')

  const handlePreset = useCallback((pct: number) => {
    onClose(posId, pct)
  }, [posId, onClose])

  const handleCustom = useCallback(() => {
    onClose(posId, customPct)
  }, [posId, customPct, onClose])

  return (
    <div
      onClick={(e) => { if (e.target === e.currentTarget) onCancel() }}
      style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,.85)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
    >
      <div style={{ background: '#06080e', border: '1px solid #aa44ff55', borderRadius: 6, padding: 20, width: 280, fontFamily: 'var(--ff)' }}>
        <div style={{ fontSize: 13, letterSpacing: 2, color: '#aa44ff', marginBottom: 12 }}>
          ◑ INCHIDE PARTIAL — {side} {symBase}
        </div>
        <div style={{ fontSize: 12, color: 'var(--dim)', marginBottom: 4 }}>
          Size total: <span style={{ color: 'var(--whi)' }}>${size.toFixed(0)} USDT</span>
        </div>
        <div style={{ fontSize: 12, color: 'var(--dim)', marginBottom: 12 }}>
          PnL curent: <span style={{ color: pnl >= 0 ? '#00ff88' : '#ff4466' }}>{pnl >= 0 ? '+' : ''}${pnl.toFixed(2)}</span>
        </div>
        <div style={{ fontSize: 12, color: 'var(--dim)', marginBottom: 6 }}>Procent de inchis:</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6, marginBottom: 10 }}>
          {[25, 50, 75].map(p => (
            <button key={p} onClick={() => handlePreset(p)} style={{ padding: 6, background: '#0d1520', border: '1px solid #aa44ff33', color: '#aa44ff', borderRadius: 3, fontSize: 13, cursor: 'pointer', fontFamily: 'var(--ff)' }}>
              {p}%
            </button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 10 }}>
          <input
            type="number"
            value={customPct}
            onChange={e => setCustomPct(parseInt(e.target.value) || 50)}
            min={1}
            max={99}
            style={{ flex: 1, background: '#0a0518', border: '1px solid #aa44ff33', color: '#cc88ff', padding: '5px 8px', fontSize: 13, borderRadius: 3, fontFamily: 'var(--ff)' }}
          />
          <span style={{ color: 'var(--dim)', fontSize: 12 }}>%</span>
          <button onClick={handleCustom} style={{ padding: '5px 10px', background: '#aa44ff22', border: '1px solid #aa44ff44', color: '#aa44ff', borderRadius: 3, fontSize: 12, cursor: 'pointer', fontFamily: 'var(--ff)' }}>
            OK
          </button>
        </div>
        <button onClick={onCancel} style={{ width: '100%', padding: 5, background: '#1a0008', border: '1px solid #ff335533', color: '#ff4466', borderRadius: 3, fontSize: 12, cursor: 'pointer', fontFamily: 'var(--ff)' }}>
          ANULEAZA
        </button>
      </div>
    </div>
  )
}
