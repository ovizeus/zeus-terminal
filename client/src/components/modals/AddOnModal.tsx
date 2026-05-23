import { useState, useCallback } from 'react'

interface AddOnModalProps {
  posId: number | string
  side: string
  sym: string
  origSize: number
  curSize: number
  addOnCount: number
  maxAddon: number
  curPrice: number
  pnl: number
  onConfirm: (posId: number | string, addOnSize: number) => void
  onCancel: () => void
}

export default function AddOnModal({ posId, side, sym, origSize, curSize, addOnCount, maxAddon, curPrice, pnl, onConfirm, onCancel }: AddOnModalProps) {
  const defaultAmt = Math.max(1, Math.round(origSize * 0.5))
  const [amount, setAmount] = useState<number>(defaultAmt)
  const symBase = sym.replace('USDT', '')

  const handlePreset = useCallback((pct: number) => {
    setAmount(Math.max(1, Math.round(origSize * (pct / 100))))
  }, [origSize])

  const handleConfirm = useCallback(() => {
    const v = Number(amount)
    if (!Number.isFinite(v) || v <= 0) return
    onConfirm(posId, Math.round(v))
  }, [posId, amount, onConfirm])

  const sideColor = side === 'LONG' ? '#00ff88' : '#ff4466'

  return (
    <div
      onClick={(e) => { if (e.target === e.currentTarget) onCancel() }}
      style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,.85)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
    >
      <div style={{ background: '#06080e', border: '1px solid #00ff8855', borderRadius: 6, padding: 20, width: 300, fontFamily: 'var(--ff)' }}>
        <div style={{ fontSize: 13, letterSpacing: 2, color: '#00ff88', marginBottom: 12 }}>
          + ADD-ON — <span style={{ color: sideColor }}>{side}</span> {symBase}
        </div>
        <div style={{ fontSize: 12, color: 'var(--dim)', marginBottom: 4 }}>
          Original: <span style={{ color: 'var(--whi)' }}>${origSize.toFixed(0)}</span>
          {' | '}Current: <span style={{ color: 'var(--whi)' }}>${curSize.toFixed(0)}</span>
        </div>
        <div style={{ fontSize: 12, color: 'var(--dim)', marginBottom: 4 }}>
          Add-ons used: <span style={{ color: 'var(--whi)' }}>{addOnCount}/{maxAddon}</span>
        </div>
        <div style={{ fontSize: 12, color: 'var(--dim)', marginBottom: 12 }}>
          Price: <span style={{ color: 'var(--whi)' }}>${curPrice.toFixed(curPrice >= 100 ? 2 : 4)}</span>
          {' | '}PnL: <span style={{ color: pnl >= 0 ? '#00ff88' : '#ff4466' }}>{pnl >= 0 ? '+' : ''}${pnl.toFixed(2)}</span>
        </div>
        <div style={{ fontSize: 12, color: 'var(--dim)', marginBottom: 6 }}>Quick % of original:</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6, marginBottom: 10 }}>
          {[25, 50, 100].map(p => (
            <button key={p} onClick={() => handlePreset(p)} style={{ padding: 6, background: '#0d2018', border: '1px solid #00ff8833', color: '#00ff88', borderRadius: 3, fontSize: 13, cursor: 'pointer', fontFamily: 'var(--ff)' }}>
              {p}%
            </button>
          ))}
        </div>
        <div style={{ fontSize: 12, color: 'var(--dim)', marginBottom: 6 }}>Amount to add (USDT margin):</div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 12 }}>
          <span style={{ color: 'var(--dim)', fontSize: 13 }}>$</span>
          <input
            type="number"
            value={amount}
            onChange={e => setAmount(parseInt(e.target.value) || 0)}
            min={1}
            step={1}
            style={{ flex: 1, background: '#05180e', border: '1px solid #00ff8833', color: '#88ffcc', padding: '6px 8px', fontSize: 14, borderRadius: 3, fontFamily: 'var(--ff)' }}
          />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
          <button onClick={onCancel} style={{ padding: 8, background: '#1a0008', border: '1px solid #ff335555', color: '#ff4466', borderRadius: 3, fontSize: 12, cursor: 'pointer', fontFamily: 'var(--ff)', fontWeight: 700 }}>
            CANCEL
          </button>
          <button onClick={handleConfirm} style={{ padding: 8, background: '#001a10', border: '1px solid #00ff88', color: '#00ff88', borderRadius: 3, fontSize: 12, cursor: 'pointer', fontFamily: 'var(--ff)', fontWeight: 700 }}>
            CONFIRM ADD-ON
          </button>
        </div>
      </div>
    </div>
  )
}
