/**
 * On-screen messages — the look.
 *
 * [2026-11-08] Every message in the app went through one hardcoded style:
 * amber text on a slate box, 10px, whatever the message meant. A routine
 * "saved" and a failed order looked identical, and the amber made all of it
 * read like a warning that nobody needed to act on — which is the fastest way
 * to teach someone to ignore the one that matters.
 *
 * The rule here: the TEXT stays neutral and readable, and the severity is
 * carried by a thin accent and a dot. Colouring whole sentences is what made
 * it look amateurish; a quiet panel with one coloured edge is what trading
 * desks actually use. Amber is now reserved for an actual warning.
 */

export type ToastLevel = 'info' | 'ok' | 'warn' | 'error'

export interface ToastTheme {
  /** The accent: left edge, dot, and the icon tint. */
  accent: string
  /** Panel background. */
  bg: string
  /** Panel border. */
  border: string
  /** Message text — deliberately neutral at every level. */
  text: string
  /** Glow under the panel, strong only where it should be. */
  shadow: string
}

const NEUTRAL_TEXT = '#d8eaf8'
const PANEL_BG = 'rgba(12, 17, 25, 0.93)'

const THEMES: Readonly<Record<ToastLevel, ToastTheme>> = Object.freeze({
  info: Object.freeze({
    accent: '#00afff', bg: PANEL_BG, border: '#1b2a3a', text: NEUTRAL_TEXT,
    shadow: '0 6px 20px rgba(0,0,0,0.45)',
  }),
  ok: Object.freeze({
    accent: '#00d97a', bg: PANEL_BG, border: '#17322a', text: NEUTRAL_TEXT,
    shadow: '0 6px 20px rgba(0,0,0,0.45)',
  }),
  warn: Object.freeze({
    accent: '#f0c040', bg: PANEL_BG, border: '#3a3320', text: NEUTRAL_TEXT,
    shadow: '0 6px 20px rgba(0,0,0,0.45)',
  }),
  error: Object.freeze({
    accent: '#ff3355', bg: PANEL_BG, border: '#3a1d24', text: NEUTRAL_TEXT,
    // The only one that gets a tinted glow: it is the only one worth
    // interrupting someone for.
    shadow: '0 6px 22px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,51,85,0.12)',
  }),
})

export function toastTheme(level?: string | null): ToastTheme {
  const key = (typeof level === 'string' ? level : '') as ToastLevel
  return THEMES[key] || THEMES.info
}

export const TOAST_LEVELS: readonly ToastLevel[] = Object.freeze(['info', 'ok', 'warn', 'error'])

/** How many messages may be on screen at once. */
export const TOAST_MAX_STACK = 3

/**
 * Picks a level from the message when the caller did not say.
 *
 * Deliberately NARROW. 189 call sites pass no level, and guessing wrongly in
 * the loud direction is how everything becomes a warning again — the very
 * thing being fixed. Only words that can only mean one thing count; anything
 * else stays `info`.
 */
export function inferLevel(msg: unknown): ToastLevel {
  const s = typeof msg === 'string' ? msg.toLowerCase() : ''
  if (!s) return 'info'
  if (/\b(failed|error|cannot|could not|unavailable|rejected|invalid|denied)\b/.test(s)) return 'error'
  if (/\b(warning|halt|kill switch|quota|throttl|degraded|stale|expired)\b/.test(s)) return 'warn'
  if (/\b(saved|applied|restored|cleared|copied|updated|connected|enabled|filled)\b/.test(s)) return 'ok'
  return 'info'
}

/**
 * The uppercase tag shown beside a message.
 *
 * Empty for the ordinary ones on purpose: tagging every routine line "INFO"
 * is noise pretending to be rigour, and it would put a label on the alerts
 * that already say what they are ("BID WALL", "RSI OVERBOUGHT").
 */
export function toastLabel(level?: string | null): string {
  switch (level) {
    case 'error': return 'Error'
    case 'warn': return 'Warning'
    default: return ''
  }
}
