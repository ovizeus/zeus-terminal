/**
 * BYOI form rules — pure, so they can be tested without a browser.
 *
 * [2026-11-07] Two jobs, both of which used to be missing:
 *
 *   showIf — keeps nonsense out of an order. A pane scale when nothing draws
 *   in a pane, a credit line on a private build. The SERVER drops hidden
 *   fields from the stored spec; this is the same rule on the screen, read
 *   from the same field definitions so the two cannot disagree.
 *
 *   tier — some options cost more than the cheapest tier. The server refuses
 *   an under-tiered order outright; the screen's job is to say so BEFORE the
 *   buyer pays, and to offer the upgrade rather than silently blocking him. A
 *   lost sale is worse than an upsell.
 */

export interface RuleField {
  key: string
  type: string
  def?: string
  options?: Array<{ v: string; l: string }>
  showIf?: { key: string; in?: string[]; has?: string }
}

export type SpecValue = unknown
export type Spec = Record<string, SpecValue>

/** Cheapest first. Mirrors the server's own ranking. */
const TIER_RANK: Record<string, number> = { signature: 0, custom: 1, bespoke: 2 }

export function tierRank(tier: string | undefined | null): number {
  return tier && Object.prototype.hasOwnProperty.call(TIER_RANK, tier) ? TIER_RANK[tier] : 0
}

/** Is this field on screen, given what has been answered so far? */
export function isVisible(f: RuleField, spec: Spec, byKey: Record<string, RuleField>): boolean {
  const cond = f?.showIf
  if (!cond) return true
  const v = spec ? spec[cond.key] : undefined
  if (typeof cond.has === 'string') return Array.isArray(v) && v.indexOf(cond.has) !== -1
  if (Array.isArray(cond.in)) {
    const current = typeof v === 'string' && v ? v : (byKey[cond.key]?.def ?? '')
    return cond.in.indexOf(current) !== -1
  }
  return true
}

export function visibleFields(fields: RuleField[], spec: Spec): RuleField[] {
  const byKey: Record<string, RuleField> = {}
  for (const f of fields || []) byKey[f.key] = f
  return (fields || []).filter((f) => isVisible(f, spec, byKey))
}

/**
 * The lowest tier that can carry what has been ticked. Reads a claim only in
 * the shape the field declares - an array for a multi-choice field, a string
 * for a single-choice one - because reading both shapes from either field is
 * how a malformed value turns into a charge the buyer never asked for.
 */
export function requiredTier(
  optionTier: Record<string, string>,
  fields: RuleField[],
  spec: Spec,
): string {
  const byKey: Record<string, RuleField> = {}
  for (const f of fields || []) byKey[f.key] = f
  let needed = 'signature'
  for (const [key, val] of Object.entries(spec || {})) {
    const f = byKey[key]
    if (!f) continue
    // A hidden field is not part of the order, so it cannot raise the price.
    if (!isVisible(f, spec, byKey)) continue
    const claims: string[] = []
    if (f.type === 'multi' && Array.isArray(val)) {
      for (const v of val) if (typeof v === 'string') claims.push(`${key}:${v}`)
    } else if (f.type === 'select' && typeof val === 'string' && val) {
      claims.push(`${key}:${val}`)
    }
    for (const c of claims) {
      const t = optionTier?.[c]
      if (t && tierRank(t) > tierRank(needed)) needed = t
    }
  }
  return needed
}

/** Which single option forced the upgrade, so the screen can name it. */
export function gatingOptions(
  optionTier: Record<string, string>,
  fields: RuleField[],
  spec: Spec,
  tier: string,
): string[] {
  const byKey: Record<string, RuleField> = {}
  for (const f of fields || []) byKey[f.key] = f
  const out: string[] = []
  for (const [key, val] of Object.entries(spec || {})) {
    const f = byKey[key]
    if (!f || !isVisible(f, spec, byKey)) continue
    const vals = f.type === 'multi' && Array.isArray(val)
      ? val.filter((v): v is string => typeof v === 'string')
      : (f.type === 'select' && typeof val === 'string' && val ? [val] : [])
    for (const v of vals) {
      const need = optionTier?.[`${key}:${v}`]
      if (need && tierRank(need) > tierRank(tier)) {
        out.push(f.options?.find((o) => o.v === v)?.l ?? v)
      }
    }
  }
  return out
}

/** True when the chosen tier cannot carry the order. */
export function tierTooLow(
  optionTier: Record<string, string>,
  fields: RuleField[],
  spec: Spec,
  tier: string,
): boolean {
  return tierRank(tier) < tierRank(requiredTier(optionTier, fields, spec))
}
