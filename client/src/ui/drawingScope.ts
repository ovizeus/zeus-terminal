/* ───────────────────────────────────────────────────────────────
   Zeus Terminal — drawing scope | 2026-10-10
   The pure half of chart-drawing persistence.

   [R11] Drawings used to be one GLOBAL set: drawingTools._save wrote no
   symbol, the restore ran once at init, setSymbol never touched drawings, and
   drawToolClearAll was only the manual button. So a trendline drawn on BTC
   stayed drawn on ETH, at BTC's price levels.

   Found while preparing the cross-device sync (P15). Syncing the drawings as
   they were would have carried that mixture to every device instead of fixing
   it, so scoping comes first.

   Migration, as the operator chose: existing drawings have no symbol recorded
   and there is no way to recover which chart they were drawn on, so they stay
   visible everywhere and only new drawings are scoped. Nothing he already drew
   disappears. That makes one rule load-bearing — serializeLine must never
   stamp the current symbol onto a legacy drawing, or the first save on ETH
   would claim all his old lines for ETH and they would vanish from every other
   chart.

   Pure on purpose: drawingTools.ts is an IIFE that needs a live chart, so none
   of this would otherwise be testable.
   ─────────────────────────────────────────────────────────────── */

export interface StoredPoint { time: number; price: number }

/** A drawing as it lives in localStorage (`zeus_drawings_v1`). */
export interface StoredLine {
  id: number
  type: string
  color: string
  width: number
  style: number
  /** Absent on anything drawn before 2026-10-10 — see the migration note. */
  sym?: string
  /** hline only. */
  price?: number
  /** tline only. */
  p1?: StoredPoint
  p2?: StoredPoint
}

/** The live, in-memory shape carries chart objects we must not serialise. */
interface LiveLine {
  id?: number
  type?: string
  color?: string
  width?: number
  style?: number
  sym?: string
  price?: number
  p1?: StoredPoint
  p2?: StoredPoint
}

/** A drawing with no symbol is a legacy one and belongs on every chart. */
export function belongsToSymbol(line: { sym?: string }, symbol: string): boolean {
  const own = typeof line.sym === 'string' ? line.sym.trim() : ''
  if (own === '') return true
  return own === symbol
}

/** Legacy drawings plus the ones scoped to `symbol`, in their original order. */
export function forSymbol<T extends { sym?: string }>(lines: T[], symbol: string): T[] {
  if (!Array.isArray(lines)) return []
  return lines.filter((l) => belongsToSymbol(l, symbol))
}

/**
 * Serialise one drawing for storage.
 *
 * `currentSymbol` is accepted but deliberately NOT applied to a line that has
 * no symbol of its own: see the migration note at the top. It is in the
 * signature so callers cannot mistake this for a function that needs stamping
 * done elsewhere — the stamping happens once, at creation.
 */
export function serializeLine(line: LiveLine, _currentSymbol: string): StoredLine {
  const out: StoredLine = {
    id: line.id as number,
    type: line.type as string,
    color: line.color as string,
    width: line.width || 2,
    style: line.style || 0,
  }
  const own = typeof line.sym === 'string' ? line.sym.trim() : ''
  if (own !== '') out.sym = own
  if (line.type === 'hline') out.price = line.price
  if (line.type === 'tline' && line.p1 && line.p2) {
    out.p1 = { time: line.p1.time, price: line.p1.price }
    out.p2 = { time: line.p2.time, price: line.p2.price }
  }
  return out
}

/** The whole `zeus_drawings_v1` payload. */
export function serializeLines(
  lines: LiveLine[],
  currentSymbol: string,
  nextId: number,
): { lines: StoredLine[]; nextId: number } {
  return {
    lines: (Array.isArray(lines) ? lines : []).map((l) => serializeLine(l, currentSymbol)),
    nextId,
  }
}

/**
 * The whole payload to store, given what is on disk and what is on screen.
 *
 * Once drawings are scoped, the in-memory list is a VIEW of one symbol, not
 * the whole set — so serialising just that view would delete every drawing
 * belonging to every other symbol. Drawing a single line on ETH would quietly
 * destroy all the BTC work. This keeps the stored drawings that are NOT on
 * screen and replaces the ones that are.
 *
 * Legacy drawings need no special case: they are on screen for every symbol,
 * so they always arrive in `liveLines` and survive that way.
 */
export function mergeForSave(
  storedLines: StoredLine[],
  liveLines: LiveLine[],
  currentSymbol: string,
  nextId: number,
): { lines: StoredLine[]; nextId: number } {
  const offScreen = (Array.isArray(storedLines) ? storedLines : [])
    .filter((l) => !belongsToSymbol(l, currentSymbol))
  const onScreen = (Array.isArray(liveLines) ? liveLines : [])
    .map((l) => serializeLine(l, currentSymbol))
  return { lines: [...offScreen, ...onScreen], nextId }
}

/** How many drawings follow you to another device. 300 is roughly 33 KB
 *  against the 64 KB per-section ceiling, measured: a horizontal line is 77
 *  bytes and a trendline 144. The cap exists so an unbounded list can never
 *  grow into a push the server rejects, not because today's sizes are a
 *  problem. */
export const SYNC_MAX_DRAWINGS = 300

/**
 * Trim the set that goes over the wire to the newest `max` drawings.
 *
 * Deliberately does NOT touch what is stored on this device: the local set
 * stays whole and only the synced copy is capped. `trimmed` is returned so the
 * caller can say so out loud — a silent divergence between the device and the
 * server is exactly the class of bug this audit kept finding.
 *
 * Newest means highest id, since ids come from a monotonic counter.
 */
export function capForSync(
  lines: StoredLine[],
  max: number = SYNC_MAX_DRAWINGS,
): { lines: StoredLine[]; trimmed: number } {
  const all = Array.isArray(lines) ? lines : []
  if (all.length <= max) return { lines: all, trimmed: 0 }
  const keep = new Set(
    all.map((l) => Number(l.id) || 0).sort((a, b) => b - a).slice(0, max),
  )
  return { lines: all.filter((l) => keep.has(Number(l.id) || 0)), trimmed: all.length - max }
}
