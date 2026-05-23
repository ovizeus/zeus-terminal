import { useState } from 'react'
import { useMultiExchangeStore } from '../../stores/multiExchangeStore'

const LABEL_MAP: Record<string, string> = {
  binance: 'BINANCE FUTURES',
  bybit: 'BYBIT DERIVATIVES',
}

const ACCENT_MAP: Record<string, string> = {
  binance: '#f0c040',
  bybit: '#aa44ff',
}

interface Props {
  exchangeId: string
  onBack: () => void
}

export function ExchangeDetail({ exchangeId, onBack }: Props) {
  const account = useMultiExchangeStore((s) => s.accounts[exchangeId])
  const saveAccount = useMultiExchangeStore((s) => s.saveAccount)
  const verifyAccount = useMultiExchangeStore((s) => s.verifyAccount)
  const disconnectAccount = useMultiExchangeStore((s) => s.disconnectAccount)

  const [apiKey, setApiKey] = useState('')
  const [apiSecret, setApiSecret] = useState('')
  const [mode, setMode] = useState<'live' | 'testnet'>('testnet')
  const [loading, setLoading] = useState(false)
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null)

  const label = LABEL_MAP[exchangeId] || exchangeId.toUpperCase()
  const accent = ACCENT_MAP[exchangeId] || '#00d4ff'

  async function handleSave() {
    setLoading(true)
    setMsg(null)
    try {
      const r = await saveAccount(exchangeId, apiKey, apiSecret, mode)
      if (r.ok) {
        setMsg({ text: `✓ Connected! Balance: $${(r.balance || 0).toFixed(2)}`, ok: true })
        setApiKey('')
        setApiSecret('')
      } else {
        setMsg({ text: r.message || r.error || 'Error', ok: false })
      }
    } catch (err: any) {
      setMsg({ text: `Network error: ${err?.message || 'try again'}`, ok: false })
    } finally {
      setLoading(false)
    }
  }

  async function handleVerify() {
    try {
      const r = await verifyAccount(exchangeId)
      setMsg({ text: r.ok ? `✓ Verified! Balance: $${(r.balance || 0).toFixed(2)}` : (r.message || r.error || 'Error'), ok: !!r.ok })
    } catch (err: any) {
      setMsg({ text: `Network error: ${err?.message || 'try again'}`, ok: false })
    }
  }

  async function handleDisconnect() {
    const isReal = account?.mode === 'live'
    const exLabel = label.replace(' FUTURES', '').replace(' DERIVATIVES', '')
    const confirmMsg = isReal
      ? `Disconnect REAL ${exLabel}?\n\n` +
        `• You are disconnecting a REAL exchange with live funds.\n` +
        `• Any live positions already opened on the exchange will REMAIN on the exchange — they are not closed by Zeus.\n` +
        `• Zeus will STOP managing those positions (no SL/TP enforcement, no autoTrade, no risk guards) once the integration is removed.\n` +
        `• You must monitor and close them manually on ${exLabel}'s own interface until you re-add valid API credentials.\n\n` +
        `Continue with disconnect?`
      : `Disconnect ${exLabel} TESTNET?`
    if (!confirm(confirmMsg)) return
    try {
      const r = await disconnectAccount(exchangeId)
      if (!r.ok) setMsg({ text: r.error || 'Error', ok: false })
    } catch (err: any) {
      setMsg({ text: `Network error: ${err?.message || 'try again'}`, ok: false })
    }
  }

  return (
    <div className="multi-exchange-detail" style={{ padding: '12px 16px' }}>
      <button
        data-testid="exchange-detail-back"
        onClick={onBack}
        style={{
          background: 'transparent',
          border: 'none',
          color: '#00d4ff',
          fontFamily: 'Orbitron, sans-serif',
          fontSize: '12px',
          cursor: 'pointer',
          marginBottom: '16px',
          padding: '4px 0',
        }}
      >
        ← BACK
      </button>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
        <span style={{ fontFamily: 'Orbitron, sans-serif', fontWeight: 900, fontSize: '20px', letterSpacing: '3px', color: accent }}>
          {label}
        </span>
        <span style={{ fontFamily: 'Orbitron, sans-serif', fontSize: '10px', color: account ? '#00d97a' : '#6b7280' }}>
          {account ? `● ${account.mode.toUpperCase()} · ${account.maskedKey}` : '○ disconnected'}
        </span>
      </div>

      <div style={{ fontSize: '11px', color: '#ff8800', marginBottom: '14px', lineHeight: '1.6' }}>
        Keys are encrypted server-side · Use READ + TRADE only (no withdrawal) · Restrict by IP
      </div>

      {account ? (
        <div style={{ background: '#0a1018', border: `1px solid ${accent}33`, borderRadius: '6px', padding: '14px', marginBottom: '12px' }}>
          <div style={{ fontSize: '11px', color: '#94a3b8', fontFamily: 'JetBrains Mono, monospace', lineHeight: '1.8' }}>
            <div>Balance &nbsp;<span style={{ color: '#00d97a' }}>${(account.balance || 0).toFixed(2)}</span></div>
            {account.lastVerified && (
              <div>Last Verified &nbsp;<span style={{ color: '#94a3b8' }}>{new Date(account.lastVerified).toLocaleString()}</span></div>
            )}
          </div>
          <div style={{ display: 'flex', gap: '6px', marginTop: '12px' }}>
            <button className="hub-sbtn" style={{ flex: 1 }} onClick={handleVerify}>RE-VERIFY</button>
            <button className="hub-sbtn" style={{ flex: 1, borderColor: '#ff335533', color: '#ff6655' }} onClick={handleDisconnect}>DISCONNECT</button>
          </div>
        </div>
      ) : (
        <div style={{ background: '#0a1018', border: `1px solid ${accent}33`, borderRadius: '6px', padding: '14px', marginBottom: '12px' }}>
          <div style={{ marginBottom: '8px' }}>
            <div style={{ fontSize: '10px', color: '#6a9080', marginBottom: '4px' }}>API KEY</div>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="Paste API Key"
              style={{ width: '100%', background: '#060c14', border: '1px solid #2a3a4a', color: 'var(--txt)', padding: '6px 10px', borderRadius: '3px', fontFamily: 'var(--ff)', fontSize: '11px', boxSizing: 'border-box' }}
            />
          </div>
          <div style={{ marginBottom: '10px' }}>
            <div style={{ fontSize: '10px', color: '#6a9080', marginBottom: '4px' }}>SECRET KEY</div>
            <input
              type="password"
              value={apiSecret}
              onChange={(e) => setApiSecret(e.target.value)}
              placeholder="Paste Secret Key"
              style={{ width: '100%', background: '#060c14', border: '1px solid #2a3a4a', color: 'var(--txt)', padding: '6px 10px', borderRadius: '3px', fontFamily: 'var(--ff)', fontSize: '11px', boxSizing: 'border-box' }}
            />
          </div>
          <div style={{ display: 'flex', gap: '6px', marginBottom: '10px' }}>
            <button
              data-testid="mode-live"
              data-active={mode === 'live'}
              className="hub-sbtn"
              style={{ flex: 1, fontWeight: 700, color: '#ff6655', background: mode === 'live' ? '#ff444433' : 'transparent', border: `1px solid ${mode === 'live' ? '#ff4444' : '#ff444433'}` }}
              onClick={() => setMode('live')}
            >
              ● LIVE
            </button>
            <button
              data-testid="mode-testnet"
              data-active={mode === 'testnet'}
              className="hub-sbtn"
              style={{ flex: 1, fontWeight: 700, background: mode === 'testnet' ? `${accent}22` : 'transparent', border: `1px solid ${mode === 'testnet' ? accent : `${accent}33`}` }}
              onClick={() => setMode('testnet')}
            >
              ◎ TESTNET
            </button>
          </div>
          <button
            className="hub-sbtn pri"
            style={{ width: '100%', fontWeight: 700 }}
            onClick={handleSave}
            disabled={loading || !apiKey || !apiSecret}
          >
            {loading ? 'VERIFYING...' : 'VERIFY & SAVE'}
          </button>
        </div>
      )}

      {msg && (
        <div style={{ marginTop: '8px', fontSize: '11px', color: msg.ok ? '#00d97a' : '#ff5566', textAlign: 'center', fontFamily: 'JetBrains Mono, monospace' }}>
          {msg.text}
        </div>
      )}
    </div>
  )
}
