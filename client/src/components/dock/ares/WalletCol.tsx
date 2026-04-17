import { memo, useCallback } from 'react'
import { useAresStore } from '../../../stores/aresStore'
import { _aresRender } from '../../../engine/aresUI'

/** Wallet column: balance, avail/locked, add/withdraw buttons. */
export const WalletCol = memo(function WalletCol() {
  const wallet = useAresStore((s) => s.ui.wallet)

  const addFunds = useCallback(() => {
    const w = window as any
    const amt = prompt('Add funds ($):')
    if (amt && !isNaN(Number(amt)) && typeof w.ARES !== 'undefined' && w.ARES.wallet) {
      w.ARES.wallet.fund(Number(amt))
      setTimeout(() => { _aresRender(); useAresStore.getState().saveToServer() }, 200)
    }
  }, [])

  const withdrawFunds = useCallback(() => {
    const w = window as any
    const amt = prompt('Withdraw funds ($):')
    if (amt && !isNaN(Number(amt)) && typeof w.ARES !== 'undefined' && w.ARES.wallet) {
      w.ARES.wallet.withdraw(Number(amt))
      setTimeout(() => { _aresRender(); useAresStore.getState().saveToServer() }, 200)
    }
  }, [])

  const fmt = (v: number) =>
    '$' + (v || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  const fmt0 = (v: number) =>
    '$' + (v || 0).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })

  const wdDisabled = !wallet.withdrawEnabled

  return (
    <div id="ares-wallet-col" style={{
      flex: '0 0 auto', minWidth: '110px', textAlign: 'center',
      borderLeft: '1px solid rgba(0,150,255,0.12)',
      borderRight: '1px solid rgba(0,150,255,0.12)',
      padding: '0 8px',
    }}>
      <div className="ares-meta-title" style={{ textAlign: 'center' }}>WALLET</div>
      <div
        id="ares-wallet-balance"
        style={{
          fontFamily: 'monospace', fontSize: '11px', fontWeight: 700,
          color: wallet.balance > 0 ? '#00ff88' : 'rgba(255,255,255,0.25)',
          letterSpacing: '1px',
        }}
      >
        {fmt(wallet.balance)}
      </div>
      <div id="ares-wallet-avail" style={{ fontFamily: 'monospace', fontSize: '11px', color: '#6a9a7a', marginTop: '1px' }}>
        Avail: <span id="ares-wallet-avail-val">{fmt0(wallet.available)}</span>
        {' · Rest To Trade: '}
        <span id="ares-wallet-lock-val">{fmt0(wallet.locked)}</span>
      </div>
      <div style={{ marginTop: '4px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px', flexWrap: 'wrap' }}>
        <button id="ares-wallet-add-btn" onClick={addFunds} style={{
          background: 'rgba(0,255,136,0.1)', border: '1px solid rgba(0,255,136,0.35)',
          color: '#00ff88', fontFamily: 'monospace', fontSize: '11px', padding: '2px 8px',
          cursor: 'pointer', borderRadius: '2px', letterSpacing: '1px',
        }}>[+] ADD</button>
        <button
          id="ares-wallet-withdraw-btn"
          onClick={withdrawFunds}
          disabled={wdDisabled}
          style={{
            background: 'rgba(255,80,80,0.08)',
            border: '1px solid ' + (wdDisabled ? 'rgba(255,80,80,0.15)' : 'rgba(255,80,80,0.3)'),
            color: 'rgba(255,110,110,0.8)',
            fontFamily: 'monospace', fontSize: '11px', padding: '2px 8px',
            cursor: wdDisabled ? 'not-allowed' : 'pointer',
            opacity: wdDisabled ? 0.38 : 1,
            borderRadius: '2px', letterSpacing: '1px',
          }}
        >[-] WITHDRAW</button>
      </div>
      <div
        id="ares-wallet-withdraw-tip"
        style={{
          display: wdDisabled ? 'block' : 'none',
          fontFamily: 'monospace', fontSize: '10px', color: '#ff555566', marginTop: '2px',
        }}
      >withdraw disabled while positions active</div>
      <span
        id="ares-wallet-fail"
        style={{
          display: wallet.failBannerVisible ? 'block' : 'none',
          background: 'rgba(255,40,40,0.18)', border: '1px solid rgba(255,50,50,0.45)',
          color: '#ff5555', fontFamily: 'monospace', fontSize: '11px', padding: '1px 5px',
          borderRadius: '2px', letterSpacing: '1px', marginTop: '3px',
        }}
      >NO FUNDS</span>
    </div>
  )
})
