// Zeus — services/biometric.ts
// [BATCH3-R] Thin wrapper around the custom ZeusBiometric Capacitor plugin.
// Pure no-op on web (plugin absent) — all public calls resolve safely.
// Enrollment state (whether the user has opted-in to biometric unlock) is
// stored per-device in localStorage: having a fingerprint enrolled at the OS
// level is not the same as wanting Zeus to use it.
const w = window as any

const LS_ENABLED_KEY = 'zeus_biometric_enabled'

export interface BiometricAvailability {
  available: boolean
  reason?: string
}

function getPlugin(): any {
  const cap = w.Capacitor
  if (!cap || typeof cap.isNativePlatform !== 'function' || !cap.isNativePlatform()) return null
  return cap.Plugins && cap.Plugins.ZeusBiometric ? cap.Plugins.ZeusBiometric : null
}

export function isNative(): boolean {
  const cap = w.Capacitor
  return !!(cap && typeof cap.isNativePlatform === 'function' && cap.isNativePlatform())
}

export function isPluginInstalled(): boolean {
  return !!getPlugin()
}

export async function isAvailable(): Promise<BiometricAvailability> {
  const plugin = getPlugin()
  if (!plugin) return { available: false, reason: 'no_plugin' }
  try {
    const res = await plugin.isAvailable()
    return { available: !!res?.available, reason: res?.reason }
  } catch (e: any) {
    return { available: false, reason: 'error' }
  }
}

export async function authenticate(opts: { title?: string; subtitle?: string; cancelLabel?: string } = {}): Promise<boolean> {
  const plugin = getPlugin()
  if (!plugin) return false
  try {
    const res = await plugin.authenticate({
      title: opts.title || 'Unlock Zeus',
      subtitle: opts.subtitle || 'Confirm your identity',
      cancelLabel: opts.cancelLabel || 'Use PIN',
    })
    return !!res?.success
  } catch (_) {
    return false
  }
}

export function isEnabled(): boolean {
  try { return localStorage.getItem(LS_ENABLED_KEY) === '1' } catch (_) { return false }
}

export function setEnabled(on: boolean): void {
  try {
    if (on) localStorage.setItem(LS_ENABLED_KEY, '1')
    else localStorage.removeItem(LS_ENABLED_KEY)
  } catch (_) {}
}
