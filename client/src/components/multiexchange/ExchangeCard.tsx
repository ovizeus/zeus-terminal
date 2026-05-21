import type { ExchangeAccount } from '../../stores/multiExchangeStore'

export type CardStatus = 'active' | 'inactive' | 'blocked'

interface Props {
  id: string
  label: string
  status: CardStatus
  account?: ExchangeAccount
  blockedMessage?: string
  onClick: (id: string) => void
}

const ACCENT: Record<string, string> = {
  binance: '#f0c040',
  bybit: '#aa44ff',
}

export function ExchangeCard({ id, label, status, account, blockedMessage, onClick }: Props) {
  const accent = ACCENT[id] || '#00d4ff'
  const isClickable = status === 'active' || status === 'inactive'

  const borderColor =
    status === 'active' ? accent :
    status === 'blocked' ? '#ff8844' :
    '#1f2937'

  const statusLabel =
    status === 'active' ? 'ACTIVE' :
    status === 'blocked' ? 'BLOCKED' :
    'INACTIVE'

  const statusColor =
    status === 'active' ? '#00d97a' :
    status === 'blocked' ? '#ff8844' :
    '#6b7280'

  return (
    <div
      data-testid={`exchange-card-${id}`}
      className={`multi-exchange-card multi-exchange-card-${status}`}
      style={{
        background: '#13192a',
        border: `1px solid ${borderColor}${status === 'active' ? '' : '33'}`,
        borderRadius: '6px',
        padding: '14px',
        cursor: isClickable ? 'pointer' : 'not-allowed',
        opacity: status === 'blocked' ? 0.75 : 1,
        boxShadow: status === 'active' ? `0 0 20px ${accent}26` : 'none',
        transition: 'transform 0.15s ease, border-color 0.15s ease, box-shadow 0.15s ease',
      }}
      onClick={() => { if (isClickable) onClick(id) }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
        <span style={{ fontFamily: 'Orbitron, sans-serif', fontWeight: 700, fontSize: '14px', letterSpacing: '2px', color: accent }}>
          {label}
        </span>
        <span style={{ fontFamily: 'Orbitron, sans-serif', fontWeight: 600, fontSize: '10px', letterSpacing: '1px', color: statusColor }}>
          {status === 'active' ? '● ' : status === 'blocked' ? '🔒 ' : '○ '}
          {statusLabel}
        </span>
      </div>

      {status === 'active' && account && (
        <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '11px', color: '#94a3b8', lineHeight: '1.7' }}>
          <div>Mode &nbsp;&nbsp; <span style={{ color: '#f0f4f8' }}>{account.mode.toUpperCase()}</span></div>
          <div>Key &nbsp;&nbsp;&nbsp; <span style={{ color: '#f0f4f8' }}>{account.maskedKey}</span></div>
          <div>Balance &nbsp;<span style={{ color: '#00d97a' }}>${(account.balance || 0).toFixed(2)}</span></div>
        </div>
      )}

      {status === 'inactive' && (
        <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '11px', color: '#6b7280', lineHeight: '1.6' }}>
          No API credentials configured. Click to add.
        </div>
      )}

      {status === 'blocked' && (
        <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '11px', color: '#ff8844', lineHeight: '1.6' }}>
          {blockedMessage || 'Blocked by mutual exclusion policy.'}
        </div>
      )}
    </div>
  )
}
