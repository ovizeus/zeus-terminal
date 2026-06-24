import { memo, useCallback } from 'react'
import { useAresStore } from '../../../stores/aresStore'

/**
 * [2026-06-23] Safety column for ARES REAL-money autonomous trading:
 *  - REAL opt-in toggle (off by default; enabling requires an explicit confirm).
 *  - Persistent kill-switch (emergency stop, survives restart).
 * These set server-authoritative flags via /api/ares/{real-optin,kill}. They do NOT enable real
 * execution by themselves — the protected server master switch still gates everything; this only
 * records THIS user's consent / hard-stop.
 */
export const SafetyCol = memo(function SafetyCol() {
  const realOptIn = useAresStore((s) => s.realOptIn)
  const killSwitch = useAresStore((s) => s.killSwitch)
  const setRealOptIn = useAresStore((s) => s.setRealOptIn)
  const setKillSwitch = useAresStore((s) => s.setKillSwitch)

  const toggleOptIn = useCallback(() => {
    if (realOptIn) {
      setRealOptIn(false, false)
      return
    }
    const ok = window.confirm(
      'Enable REAL autonomous trading for ARES?\n\n' +
      'ARES will open and close trades on your REAL exchange account WITHOUT asking each time, ' +
      'using its safety caps (max 2% of balance per trade, max 5x leverage, 6% daily-loss stop).\n\n' +
      'You can stop it any time with the KILL button. Continue?'
    )
    if (ok) setRealOptIn(true, true)
  }, [realOptIn, setRealOptIn])

  const toggleKill = useCallback(() => {
    setKillSwitch(!killSwitch)
  }, [killSwitch, setKillSwitch])

  return (
    <div id="ares-safety-col" style={{
      flex: '0 0 auto', minWidth: '116px', textAlign: 'center',
      borderRight: '1px solid rgba(0,150,255,0.12)', padding: '0 8px',
    }}>
      <div className="ares-meta-title" style={{ textAlign: 'center' }}>REAL SAFETY</div>

      {/* REAL opt-in toggle */}
      <button
        id="ares-real-optin-btn"
        onClick={toggleOptIn}
        title={realOptIn
          ? 'ARES is authorized to trade your REAL money. Click to revoke.'
          : 'Authorize ARES to trade your REAL money (capped 2% / 5x). Click to enable.'}
        style={{
          marginTop: '2px', width: '100%',
          background: realOptIn ? 'rgba(0,255,136,0.12)' : 'rgba(255,255,255,0.04)',
          border: '1px solid ' + (realOptIn ? 'rgba(0,255,136,0.45)' : 'rgba(255,255,255,0.18)'),
          color: realOptIn ? '#00ff88' : 'rgba(255,255,255,0.5)',
          fontFamily: 'monospace', fontSize: '11px', padding: '3px 6px',
          cursor: 'pointer', borderRadius: '2px', letterSpacing: '1px',
        }}
      >{realOptIn ? '● REAL: ON' : '○ REAL: OFF'}</button>

      {/* Kill switch */}
      <button
        id="ares-kill-btn"
        onClick={toggleKill}
        title={killSwitch ? 'ARES is hard-stopped. Click to re-enable.' : 'Emergency stop — halt all ARES trading.'}
        style={{
          marginTop: '5px', width: '100%',
          background: killSwitch ? 'rgba(255,40,40,0.22)' : 'rgba(255,80,80,0.08)',
          border: '1px solid ' + (killSwitch ? 'rgba(255,60,60,0.7)' : 'rgba(255,80,80,0.3)'),
          color: killSwitch ? '#ff5555' : 'rgba(255,110,110,0.8)',
          fontFamily: 'monospace', fontSize: '11px', fontWeight: killSwitch ? 700 : 400,
          padding: '3px 6px', cursor: 'pointer', borderRadius: '2px', letterSpacing: '1px',
        }}
      >{killSwitch ? '■ STOPPED' : '⛔ KILL'}</button>

      <div style={{ fontFamily: 'monospace', fontSize: '9px', color: 'rgba(255,255,255,0.3)', marginTop: '4px', lineHeight: 1.3 }}>
        {killSwitch
          ? 'ARES halted'
          : realOptIn ? 'real • 2% • 5x • 6%/day' : 'testnet only'}
      </div>
    </div>
  )
})
