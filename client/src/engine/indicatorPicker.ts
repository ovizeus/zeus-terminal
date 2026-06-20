// Pure helpers for the indicator picker (search filter + usage badge). No DOM/IO — unit-tested.

// Case-insensitive substring match against name + description + category. Empty query = match all.
export function _indMatchesQuery(ind: { name?: string; desc?: string; cat?: string }, query: string): boolean {
  const q = (query || '').trim().toLowerCase()
  if (!q) return true
  const hay = `${ind.name || ''} ${ind.desc || ''} ${ind.cat || ''}`.toLowerCase()
  return hay.includes(q)
}

// Badge text for a usage count. Hidden (null) when count <= 0 or not a finite number.
export function _usageBadge(count: number): string | null {
  const n = Number(count)
  if (!Number.isFinite(n) || n <= 0) return null
  return String(Math.floor(n))
}
