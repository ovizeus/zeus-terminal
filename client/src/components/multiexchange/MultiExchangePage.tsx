import { useEffect, useState } from 'react'
import { useMultiExchangeStore } from '../../stores/multiExchangeStore'
import { ExchangeCard } from './ExchangeCard'
import { ComingSoonCard } from './ComingSoonCard'
import { ExchangeDetail } from './ExchangeDetail'

const COMING_SOON = [
  { id: 'okx', label: 'OKX', phase: 'Phase 3 — Jun 2026' },
  { id: 'hyperliquid', label: 'HYPERLIQUID', phase: 'Phase 6 — Aug 2026' },
  { id: 'bitget', label: 'BITGET', phase: 'Phase 4 — Jun 2026' },
  { id: 'mexc', label: 'MEXC', phase: 'Phase 5 — Jul 2026' },
  { id: 'htx', label: 'HTX', phase: 'Phase 5 — Jul 2026' },
]

export function MultiExchangePage() {
  const accounts = useMultiExchangeStore((s) => s.accounts)
  const loadAccounts = useMultiExchangeStore((s) => s.loadAccounts)
  const error = useMultiExchangeStore((s) => s.error)

  const [view, setView] = useState<'grid' | string>('grid')

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

  const activeKeys = Object.keys(accounts).filter((k) => !!accounts[k])
  const activeExchange = activeKeys[0] || null
  const activeCount = activeKeys.length

  function getStatus(id: 'binance' | 'bybit'): 'active' | 'inactive' | 'blocked' {
    if (accounts[id]) return 'active'
    if (activeExchange && activeExchange !== id) return 'blocked'
    return 'inactive'
  }

  function getBlockedMsg(id: 'binance' | 'bybit'): string {
    const activeLabel = activeExchange === 'binance' ? 'Binance' : 'Bybit'
    const targetLabel = id === 'binance' ? 'Binance' : 'Bybit'
    return `${targetLabel} cannot be activated because ${activeLabel} is currently connected. Zeus allows one exchange per account. Disconnect ${activeLabel} first.`
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
          {COMING_SOON.length + 2} venues · {activeCount} connected
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
          blockedMessage={getStatus('binance') === 'blocked' ? getBlockedMsg('binance') : undefined}
          onClick={(id) => setView(id)}
        />
        <ExchangeCard
          id="bybit"
          label="BYBIT"
          status={getStatus('bybit')}
          account={accounts.bybit}
          blockedMessage={getStatus('bybit') === 'blocked' ? getBlockedMsg('bybit') : undefined}
          onClick={(id) => setView(id)}
        />
        {COMING_SOON.map((cs) => (
          <ComingSoonCard key={cs.id} label={cs.label} phase={cs.phase} />
        ))}
      </div>
    </div>
  )
}
