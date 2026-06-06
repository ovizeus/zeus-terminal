import { useEffect, useState } from 'react'
import { useMultiExchangeStore } from '../../stores/multiExchangeStore'
import { usePositionsStore } from '../../stores/positionsStore'
import { ExchangeCard } from './ExchangeCard'
import { ComingSoonCard } from './ComingSoonCard'
import { ExchangeDetail } from './ExchangeDetail'
import { toast } from '../../data/marketDataHelpers'

// [2026-06-06] Operator: no launch dates on the cards — plain COMING SOON only.
const COMING_SOON = [
  { id: 'okx', label: 'OKX' },
  { id: 'hyperliquid', label: 'HYPERLIQUID' },
  { id: 'bitget', label: 'BITGET' },
  { id: 'mexc', label: 'MEXC' },
  { id: 'htx', label: 'HTX' },
]

export function MultiExchangePage() {
  const accounts = useMultiExchangeStore((s) => s.accounts)
  const loadAccounts = useMultiExchangeStore((s) => s.loadAccounts)
  const switchExchange = useMultiExchangeStore((s) => s.switchExchange)
  const error = useMultiExchangeStore((s) => s.error)
  const liveCount = usePositionsStore((s) => s.livePositions.length)

  const [view, setView] = useState<'grid' | string>('grid')
  // [P7a.2] one-click Switch confirm flow. confirmTarget = exchange awaiting confirm.
  const [confirmTarget, setConfirmTarget] = useState<string | null>(null)
  const [switching, setSwitching] = useState(false)

  useEffect(() => {
    loadAccounts().catch(() => {})
  }, [loadAccounts])

  useEffect(() => {
    function onPageBack(e: Event) {
      if (view !== 'grid') {
        e.preventDefault()
        setView('grid')
      }
    }
    window.addEventListener('zeus:page-back', onPageBack)
    return () => window.removeEventListener('zeus:page-back', onPageBack)
  }, [view])

  const connectedKeys = Object.keys(accounts).filter((k) => !!accounts[k])
  const activeExchange = connectedKeys.find((k) => accounts[k]?.active) || null
  const connectedCount = connectedKeys.length

  // [P7a.2] active → the live exchange; switchable → connected but inactive (offer
  // Switch); inactive → not connected. The old 'blocked' mutual-exclusion is gone.
  function getStatus(id: 'binance' | 'bybit'): 'active' | 'inactive' | 'switchable' {
    if (!accounts[id]) return 'inactive'
    return accounts[id].active ? 'active' : 'switchable'
  }

  // [P7a.2] If the current active exchange has open positions, confirm first (they
  // stay DSL-managed on their own exchange). Otherwise switch immediately.
  function requestSwitch(id: string) {
    if (switching) return
    if (activeExchange && liveCount > 0) setConfirmTarget(id)
    else doSwitch(id)
  }

  async function doSwitch(id: string) {
    setConfirmTarget(null)
    setSwitching(true)
    try {
      const r = await switchExchange(id)
      if (r.ok) {
        await loadAccounts(true).catch(() => {})
        const left = (r.openPositionsOnPrevious || [])
          .map((p) => `${p.count} on ${p.exchange.toUpperCase()}`)
          .join(', ')
        toast(`Switched — new orders go to ${id.toUpperCase()}${left ? ` · ${left} still managed` : ''}`, 4000)
      } else {
        toast(r.error || r.message || 'Switch failed', 4000)
      }
    } catch (e: any) {
      toast(`Switch failed: ${e?.message || e}`, 4000)
    } finally {
      setSwitching(false)
    }
  }

  if (view !== 'grid') {
    return <ExchangeDetail exchangeId={view} onBack={() => setView('grid')} />
  }

  return (
    <div className="multi-exchange-page" style={{ padding: '16px', maxWidth: '900px', margin: '0 auto' }}>
      <div className="multi-exchange-page-header" style={{ marginBottom: '20px' }}>
        <h1 style={{
          fontFamily: 'Orbitron, sans-serif',
          fontWeight: 900,
          fontSize: '24px',
          letterSpacing: '4px',
          color: '#00d4ff',
          margin: 0,
          textShadow: '0 0 20px rgba(0, 212, 255, 0.4)',
        }}>
          ₿ MULTIEXCHANGE
        </h1>
        <div style={{
          fontFamily: 'Orbitron, sans-serif',
          fontSize: '11px',
          letterSpacing: '1px',
          color: '#94a3b8',
          marginTop: '4px',
        }}>
          {COMING_SOON.length + 2} venues · {connectedCount} connected
        </div>
      </div>

      {error && (
        <div style={{ background: '#3a0d0d', border: '1px solid #ff444466', borderRadius: '4px', padding: '10px', marginBottom: '14px', color: '#ff6655', fontSize: '11px' }}>
          Error loading accounts: {error}
        </div>
      )}

      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
        gap: '12px',
      }}>
        <ExchangeCard
          id="binance"
          label="BINANCE"
          status={getStatus('binance')}
          account={accounts.binance}
          onClick={(id) => setView(id)}
          onSwitch={requestSwitch}
        />
        <ExchangeCard
          id="bybit"
          label="BYBIT"
          status={getStatus('bybit')}
          account={accounts.bybit}
          onClick={(id) => setView(id)}
          onSwitch={requestSwitch}
        />
        {COMING_SOON.map((cs) => (
          <ComingSoonCard key={cs.id} label={cs.label} />
        ))}
      </div>

      {confirmTarget && (
        <div
          data-testid="switch-confirm-dialog"
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 1000,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
          onClick={() => setConfirmTarget(null)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: '#13192a', border: '1px solid #00d4ff55', borderRadius: '8px',
              padding: '22px', maxWidth: '380px', width: '90%',
              fontFamily: 'JetBrains Mono, monospace', color: '#cbd5e1',
            }}
          >
            <div style={{ fontFamily: 'Orbitron, sans-serif', fontWeight: 700, fontSize: '14px', letterSpacing: '1px', color: '#00d4ff', marginBottom: '12px' }}>
              Switch active exchange
            </div>
            <div style={{ fontSize: '12px', lineHeight: '1.6', marginBottom: '18px' }}>
              Switch new orders to <b style={{ color: '#f0f4f8' }}>{confirmTarget.toUpperCase()}</b>?<br /><br />
              {activeExchange?.toUpperCase()} has <b style={{ color: '#f0c040' }}>{liveCount}</b> open position(s).
              They stay open and DSL keeps managing them on {activeExchange?.toUpperCase()} — only new orders, AT and brain move to {confirmTarget.toUpperCase()}.
            </div>
            <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
              <button
                data-testid="switch-cancel"
                onClick={() => setConfirmTarget(null)}
                style={{ padding: '8px 16px', background: 'transparent', border: '1px solid #6b7280', borderRadius: '4px', color: '#94a3b8', cursor: 'pointer', fontFamily: 'Orbitron, sans-serif', fontSize: '11px' }}
              >
                CANCEL
              </button>
              <button
                data-testid="switch-confirm"
                disabled={switching}
                onClick={() => doSwitch(confirmTarget)}
                style={{ padding: '8px 16px', background: '#00d4ff', border: 'none', borderRadius: '4px', color: '#04121f', cursor: 'pointer', fontFamily: 'Orbitron, sans-serif', fontWeight: 700, fontSize: '11px' }}
              >
                SWITCH
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
