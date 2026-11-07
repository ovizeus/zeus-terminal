/**
 * [2026-11-07] How long ago an exchange key was last proven to work.
 *
 * Found on the live box: an account showed "verified" with a last-verified
 * date four months old, while the daily health check had been failing on that
 * key the whole time. The failure path writes a log line, an audit row and a
 * Telegram message, but never touches the account row — so the screen kept
 * saying the key was fine.
 *
 * The stored `status` is deliberately NOT changed by this: it gates which
 * accounts the server will trade with (exchange.js selects on
 * status = 'verified'), so flipping it is a money-path decision, not a display
 * one. This only makes the screen stop implying a four-month-old check is
 * current.
 */

/** The health check runs daily, so two days allows one missed run. */
export const STALE_AFTER_DAYS = 2

export interface VerificationAge {
  /** Whole days since the last successful verification; null when unknown. */
  days: number | null
  /** True when the last success is old enough to mean checks are failing. */
  stale: boolean
  /** Ready to render: "today", "3 days ago", "never". */
  label: string
}

export function verificationAge(
  lastVerified: string | number | null | undefined,
  now: number = Date.now(),
  staleAfterDays: number = STALE_AFTER_DAYS,
): VerificationAge {
  if (lastVerified === null || lastVerified === undefined || lastVerified === '') {
    // Never verified is not the same as verified long ago, and it is not a
    // reason to cry stale either — a freshly added key has no date yet.
    return { days: null, stale: false, label: 'never' }
  }
  const t = typeof lastVerified === 'number' ? lastVerified : Date.parse(String(lastVerified))
  if (!Number.isFinite(t)) return { days: null, stale: false, label: 'unknown' }

  const ms = now - t
  if (ms < 0) {
    // A date in the future is a clock problem, not a stale key. Saying
    // "verified in -3 days" would be worse than saying nothing.
    return { days: 0, stale: false, label: 'just now' }
  }
  const days = Math.floor(ms / 86400000)
  const label = days === 0 ? 'today' : days === 1 ? 'yesterday' : `${days} days ago`
  return { days, stale: days >= staleAfterDays, label }
}

/** What to say when it is stale. Short enough for a card. */
export function staleNotice(age: VerificationAge): string | null {
  if (!age.stale) return null
  return `Key check last succeeded ${age.label} — it may have expired`
}
