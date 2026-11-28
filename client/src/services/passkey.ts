// [2026-11-28] Passkey (WebAuthn) — intrare cu amprenta / fata / PIN-ul dispozitivului.
// Doar pe web: in aplicatia Android (WebView) WebAuthn nu e disponibil, deci acolo nu se arata nimic.
import { startRegistration, startAuthentication, browserSupportsWebAuthn } from '@simplewebauthn/browser'
import { api } from './api'
import { isNative } from './biometric'

export interface PasskeyInfo { id: number; name: string; createdAt: number; lastUsedAt: number | null; synced: boolean }
export type Result = { ok: true } | { ok: false; error: string; code?: string }

export function passkeySupported(): boolean {
  if (isNative()) return false
  try { return browserSupportsWebAuthn() } catch { return false }
}

/** erorile browserului spuse pe intelesul omului */
export function friendlyError(e: unknown): string {
  const name = e && typeof e === 'object' && 'name' in e ? String((e as { name: unknown }).name) : ''
  if (name === 'NotAllowedError' || name === 'AbortError') return 'Cancelled or timed out — try again.'
  if (name === 'InvalidStateError') return 'This device already has a passkey for your account.'
  if (name === 'SecurityError') return 'Passkeys work only on zeus-terminal.com.'
  return 'Your browser could not use a passkey — try again.'
}

/** nume implicit pentru passkey: „Chrome on Windows" */
export function deviceName(ua: string = typeof navigator !== 'undefined' ? navigator.userAgent : ''): string {
  const b = /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Browser'
  const o = /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iPhone' : /Windows/.test(ua) ? 'Windows' : /Mac OS X/.test(ua) ? 'Mac' : /Linux/.test(ua) ? 'Linux' : ''
  return o ? `${b} on ${o}` : b
}

const errOf = (r: any, fallback: string): string => (r && (r.error as string)) || fallback

export async function passkeyLoginEnabled(): Promise<boolean> {
  if (!passkeySupported()) return false
  try {
    const res = await fetch('/auth/passkey/config', { credentials: 'same-origin' })
    if (!res.ok) return false
    const j = await res.json()
    return !!(j && j.enabled)
  } catch { return false }
}

export async function signInWithPasskey(): Promise<Result> {
  const o: any = await api.post('/auth/passkey/options').catch(() => null)
  if (!o || !o.ok || !o.options) return { ok: false, error: errOf(o, 'Passkey sign-in is not available right now.') }
  let response
  try { response = await startAuthentication({ optionsJSON: o.options }) } catch (e) { return { ok: false, error: friendlyError(e) } }
  const v: any = await api.post('/auth/passkey/verify', { challengeId: o.challengeId, response }).catch(() => null)
  if (!v || !v.ok) return { ok: false, error: errOf(v, 'Passkey sign-in failed — try again.') }
  return { ok: true }
}

export async function addPasskey(password: string, code: string, name: string): Promise<Result> {
  const o: any = await api.post('/api/passkeys/register/options', { password, code: code.trim() || undefined }).catch(() => null)
  if (!o || !o.ok || !o.options) return { ok: false, error: errOf(o, 'Not started — try again.'), code: o && o.code }
  let response
  try { response = await startRegistration({ optionsJSON: o.options }) } catch (e) { return { ok: false, error: friendlyError(e) } }
  const v: any = await api.post('/api/passkeys/register/verify', { response, name }).catch(() => null)
  if (!v || !v.ok) return { ok: false, error: errOf(v, 'The passkey could not be saved — try again.') }
  return { ok: true }
}
