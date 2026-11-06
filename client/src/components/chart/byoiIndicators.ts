/**
 * [2026-11-06] Grouping and labelling for indicators built to order.
 *
 * Pulled out of ChartControls so the behaviour can be tested as behaviour. A
 * test that greps the component's source for a string proves the string is
 * there, not that the picker works.
 */

export interface CustomInd {
  id: string
  name: string
  desc: string
  author: string | null
  visibility: string
}

/** Search matches name or description, case-insensitively. An empty query
 *  matches everything, so the caller can pass the picker's box straight in. */
export function filterCustom(list: CustomInd[] | null | undefined, query: string): CustomInd[] {
  const q = (query || '').trim().toLowerCase()
  const src = Array.isArray(list) ? list : []
  if (!q) return src
  return src.filter((c) =>
    (c.name || '').toLowerCase().includes(q) || (c.desc || '').toLowerCase().includes(q))
}

/**
 * The small label on the right of a row.
 *
 * A community indicator carries its author, because "by someone" is the whole
 * reason a buyer wanted it public. One of the buyer's own reads private/public
 * instead — they already know who made it.
 */
export function customTag(c: CustomInd, group: 'mine' | 'community'): string {
  if (group === 'community') return c.author ? `by ${c.author}` : 'public'
  return c.visibility === 'public' ? 'public' : 'private'
}

/**
 * Group headers are navigation, and navigation that moves is worse than none.
 * While a search is running the list is a result set, not a catalogue, so the
 * headers and the empty-state invitation stand down.
 */
export function showChrome(query: string): boolean {
  return (query || '').trim().length === 0
}

/** The invitation shows only when the buyer owns nothing AND is not searching. */
export function showInvite(mine: CustomInd[], query: string): boolean {
  return showChrome(query) && filterCustom(mine, query).length === 0
}

/** Community is hidden entirely until somebody has published something. */
export function showCommunity(community: CustomInd[], query: string): boolean {
  return filterCustom(community, query).length > 0
}
