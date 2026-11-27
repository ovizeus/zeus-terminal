// [2026-11-27] Pasul de cod la login. `email` = codul de 6 cifre trimis pe email (ca pana acum);
// `totp` = cont cu 2FA din aplicatie: 6 cifre din aplicatie SAU un cod de rezerva XXXXX-XXXXX.
// Aceleasi reguli sunt copiate in public/login.html (pagina de start nu foloseste React).
export type CodeMethod = 'email' | 'totp'

export function sanitizeCode(method: CodeMethod, raw: string): string {
  if (method === 'email') return String(raw || '').replace(/\D/g, '').slice(0, 6)
  return String(raw || '').toUpperCase().replace(/[^0-9A-Z-]/g, '').slice(0, 11)
}

export function codeComplete(method: CodeMethod, v: string): boolean {
  if (method === 'email') return /^\d{6}$/.test(v)
  return /^\d{6}$/.test(v) || /^[0-9A-Z]{10}$/.test(v.replace(/-/g, ''))
}

export function codePrompt(method: CodeMethod): string {
  return method === 'totp'
    ? 'Enter the 6-digit code from your authenticator app, or a backup code:'
    : 'Verification code sent to your email. Enter the 6-digit code:'
}
