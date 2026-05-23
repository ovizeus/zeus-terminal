// Zeus — components/modals/BiometricToggle.tsx
// [BATCH3-R] Inline toggle row for SettingsHubModal. Shows only on native
// platforms (Capacitor Android) with the plugin compiled in AND biometrics
// enrolled at OS level. Web / missing plugin / no enrolled finger → row is
// hidden entirely so it can't mislead the user.
// Enabling requires a live biometric verification: if the user can't pass
// the fingerprint prompt right now, they can't enable it at all.
import { useEffect, useState } from 'react'
import {
  isNative,
  isPluginInstalled,
  isAvailable as bioIsAvailable,
  authenticate as bioAuthenticate,
  isEnabled as bioIsEnabled,
  setEnabled as bioSetEnabled,
} from '../../services/biometric'
import { _pinIsSet } from '../../core/bootstrapMisc'

export function BiometricToggle() {
  const [ready, setReady] = useState(false)
  const [available, setAvailable] = useState(false)
  const [reason, setReason] = useState<string | undefined>(undefined)
  const [enabled, setEnabled] = useState(bioIsEnabled())
  const [pinSet, setPinSet] = useState(false)
  const [msg, setMsg] = useState('')

  useEffect(() => {
    let cancelled = false
    async function check() {
      const p = await _pinIsSet()
      if (!cancelled) setPinSet(!!p)
      if (!isNative() || !isPluginInstalled()) { if (!cancelled) { setReady(true); setAvailable(false); setReason('no_plugin') } ; return }
      const res = await bioIsAvailable()
      if (cancelled) return
      setAvailable(!!res.available)
      setReason(res.reason)
      setReady(true)
    }
    check()
    const t = setInterval(async () => { try { setPinSet(!!(await _pinIsSet())) } catch (_) {} }, 2000)
    return () => { cancelled = true; clearInterval(t) }
  }, [])

  // Web / no plugin → hide the entire row to keep UI clean.
  if (ready && !isNative()) return null
  if (ready && reason === 'no_plugin') return null

  async function onToggle() {
    setMsg('')
    if (!pinSet) { setMsg('Set a PIN first — biometric unlocks the app using the same gate.'); return }
    if (enabled) {
      bioSetEnabled(false); setEnabled(false); setMsg('Biometric unlock disabled.')
      return
    }
    if (!available) {
      setMsg(reasonText(reason)); return
    }
    const ok = await bioAuthenticate({ title: 'Enable Fingerprint', subtitle: 'Confirm your fingerprint to enable biometric unlock' })
    if (ok) { bioSetEnabled(true); setEnabled(true); setMsg('Biometric unlock enabled.') }
    else setMsg('Verification failed — biometric unlock not enabled.')
  }

  return (
    <div style={{ marginTop: 16 }}>
      <div className="msec">BIOMETRIC UNLOCK</div>
      <div style={{ fontSize: 10, color: '#556', marginBottom: 8, lineHeight: 1.6 }}>
        Use your fingerprint instead of typing the PIN when the app starts. PIN remains the fallback.
      </div>
      <div className="mrow">
        <span className="mlbl">Status</span>
        <span style={{ fontSize: 11, color: enabled ? 'var(--grn-bright)' : '#556', fontWeight: 700 }}>
          {enabled ? 'ENABLED' : 'DISABLED'}
        </span>
      </div>
      <div className="mrow" style={{ marginTop: 4 }}>
        <span className="mlbl">Device</span>
        <span style={{ fontSize: 10, color: available ? '#00d97a' : '#ff8855' }}>
          {available ? 'Fingerprint ready' : reasonText(reason)}
        </span>
      </div>
      <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
        <button
          className={'hub-sbtn' + (enabled ? '' : ' pri')}
          onClick={onToggle}
          disabled={!pinSet && !enabled}
          style={!pinSet && !enabled ? { opacity: 0.5, cursor: 'not-allowed' } : undefined}
        >
          {enabled ? 'DISABLE FINGERPRINT' : 'ENABLE FINGERPRINT'}
        </button>
      </div>
      <div style={{ marginTop: 6, fontSize: 10, minHeight: 14, color: '#8899aa' }}>{msg}</div>
    </div>
  )
}

function reasonText(reason?: string): string {
  switch (reason) {
    case 'none_enrolled': return 'No fingerprint enrolled in Android Settings'
    case 'no_hardware': return 'Device has no biometric sensor'
    case 'hw_unavailable': return 'Biometric sensor unavailable right now'
    case 'security_update': return 'Android security update required'
    case 'no_plugin': return 'Update the Zeus APK to use biometric unlock'
    default: return 'Biometric unavailable'
  }
}
