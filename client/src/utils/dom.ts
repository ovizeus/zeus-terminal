/**
 * Zeus Terminal — DOM helpers (ported from public/js/utils/helpers.js)
 * Exposes: el, safeSetText, safeSetHTML, escHtml, isValidMarketPrice, safeLastKline
 */
import { getKlines } from '../services/stateAccessors'

/** getElementById shortcut — returns null in headless/SSR.
 * Return type widened to HTMLInputElement so common input props (.value, .checked,
 * .disabled, .placeholder, .readOnly, .type) are non-optional at call sites. */
export const el = typeof document !== 'undefined'
  ? (id: string): HTMLInputElement | null => document.getElementById(id) as HTMLInputElement | null
  : (_id: string): null => null

/** Safe textContent setter */
export function safeSetText(id: string, val: string): void {
  const e = el(id)
  if (e) e.textContent = val
}

/** Safe innerHTML setter */
export function safeSetHTML(id: string, val: string): void {
  const e = el(id)
  if (e) e.innerHTML = val
}

/** Escape HTML entities — prevents XSS in innerHTML */
export function escHtml(s: unknown): string {
  if (s == null) return ''
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/** Central price validity check — rejects 0, NaN, null, undefined, negative, Infinity */
export function isValidMarketPrice(p: unknown): boolean {
  return Number.isFinite(p as number) && (p as number) > 0
}

/** Safe accessor for last kline — returns null if S.klines is empty */
export function safeLastKline(): Record<string, unknown> | null {
  const klines = getKlines()
  if (!klines.length) return null
  return klines[klines.length - 1] as Record<string, unknown>
}
