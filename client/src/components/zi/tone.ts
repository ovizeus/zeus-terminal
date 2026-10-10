/* Zeus — the tone scale, 2026-10-10.
 *
 * Extracted from ZiMetric during the Task 1 code review. The map existed twice,
 * once in ZiMetric.tsx and once in ZiTable.tsx, which left ZiTable importing a
 * type from a metric component for no reason. The duplication was type-safe —
 * Record<ZiTone, string> is exhaustive, so a new tone is a compile error in both
 * — but it allowed value drift: retuning `neutral` in one map only would show
 * the same number coloured two ways inside one panel, and types cannot catch it.
 *
 * It also lives here because Tasks 2-4 need the colour at call sites that are
 * neither a ZiMetric nor a ZiRow — a header P&L, a state word, a badge. Without
 * one exported function those sites write `var(--zi-pos)` by hand and scatter
 * the mapping again.
 *
 * Colour is information, never decoration. A caller that uses `pos` or `neg`
 * must also render the sign, so meaning never rests on colour alone.
 */

export type ZiTone = 'neutral' | 'pos' | 'neg' | 'warn'

const TONE_VAR: Record<ZiTone, string> = {
  neutral: 'var(--zi-val)',
  pos: 'var(--zi-pos)',
  neg: 'var(--zi-neg)',
  warn: 'var(--zi-warn)',
}

export function toneColor(tone: ZiTone = 'neutral'): string {
  return TONE_VAR[tone] ?? TONE_VAR.neutral
}
