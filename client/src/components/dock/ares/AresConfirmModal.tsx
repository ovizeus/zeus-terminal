import { useEffect, useState } from 'react'
import { ModalOverlay, ModalHeader } from '../../modals/ModalOverlay'
import { useAresConfirm } from './aresConfirm'

// [2026-06-24] Host for the ARES confirm/input modal (aresConfirm). Rendered once in ARESPanel.
// Dedicated in-app box (matches the app .mover/.modal style) for ARES activate/off, REAL opt-in,
// KILL, and wallet fund/withdraw — instead of the browser confirm/prompt.
export function AresConfirmModal() {
  const req = useAresConfirm((s) => s.req)
  const settle = useAresConfirm((s) => s.settle)
  const [amt, setAmt] = useState('')

  useEffect(() => { setAmt((req && req.amount && req.amount.initial) || '') }, [req])

  const tone = (req && req.tone) || 'normal'
  const accent = tone === 'danger' ? '#ff5b6e' : tone === 'info' ? '#00d9ff' : '#00ff88'
  const needsAmount = !!(req && req.amount)
  const amtNum = Number(amt)
  const amtValid = !needsAmount || (Number.isFinite(amtNum) && amtNum > 0)

  const confirm = () => {
    if (!amtValid) return
    settle(true, needsAmount ? amtNum : undefined)
  }
  const cancel = () => settle(false)

  return (
    <ModalOverlay id="ares-confirm-mover" visible={!!req} onClose={cancel} maxWidth="400px" zIndex={9000}>
      <ModalHeader title={(req && req.title) || ''} onClose={cancel} titleStyle={{ color: accent, letterSpacing: '1px' }} />
      <div style={{
        padding: '12px 16px 6px', fontFamily: 'monospace', fontSize: '12px',
        color: 'rgba(255,255,255,0.82)', lineHeight: 1.55, whiteSpace: 'pre-line',
      }}>
        {(req && req.body) || ''}
      </div>

      {needsAmount && (
        <div style={{ padding: '4px 16px 8px' }}>
          <label style={{ display: 'block', fontFamily: 'monospace', fontSize: '10px', color: 'rgba(255,255,255,0.45)', letterSpacing: '1px', marginBottom: '3px' }}>
            {req!.amount!.label}
          </label>
          <input
            id="ares-confirm-amount"
            type="number" inputMode="decimal" autoFocus
            value={amt}
            placeholder={req!.amount!.placeholder || ''}
            onChange={(e) => setAmt(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') confirm() }}
            style={{
              width: '100%', boxSizing: 'border-box', background: 'rgba(0,0,0,0.35)',
              border: '1px solid rgba(0,217,255,0.35)', color: '#00d9ff', borderRadius: '3px',
              fontFamily: 'monospace', fontSize: '14px', padding: '7px 9px', letterSpacing: '1px',
            }}
          />
        </div>
      )}

      <div style={{ display: 'flex', gap: '8px', padding: '8px 16px 16px', justifyContent: 'flex-end' }}>
        <button onClick={cancel} style={{
          background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.2)',
          color: 'rgba(255,255,255,0.7)', fontFamily: 'monospace', fontSize: '12px',
          padding: '6px 14px', cursor: 'pointer', borderRadius: '3px', letterSpacing: '1px',
        }}>{(req && req.cancelLabel) || 'CANCEL'}</button>
        <button onClick={confirm} disabled={!amtValid} style={{
          background: amtValid ? `${accent}22` : 'rgba(255,255,255,0.04)',
          border: '1px solid ' + (amtValid ? accent : 'rgba(255,255,255,0.15)'),
          color: amtValid ? accent : 'rgba(255,255,255,0.3)',
          fontFamily: 'monospace', fontSize: '12px', fontWeight: 700,
          padding: '6px 16px', cursor: amtValid ? 'pointer' : 'not-allowed',
          borderRadius: '3px', letterSpacing: '1px',
        }}>{(req && req.confirmLabel) || 'CONFIRM'}</button>
      </div>
    </ModalOverlay>
  )
}
