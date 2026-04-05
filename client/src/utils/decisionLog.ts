/**
 * Zeus Terminal — Structured Decision Logger (ported from public/js/utils/decisionLog.js)
 * Ring buffer in memory, optional server push.
 * Categories: confluence, regime, signal, fusion, at_gate, at_entry, at_block,
 *             dsl_move, dsl_close, kill_switch, predator, sizing
 */

const w = window as Record<string, any>

const DLogImpl = (function () {
  if (w.__DLOG_V1__) return w.DLog

  w.__DLOG_V1__ = true

  const MAX_ENTRIES = 500
  const _ring: any[] = []
  let _seq = 0

  /** Record a structured decision. */
  function record(category: string, data: any): void {
    const entry = {
      seq: ++_seq,
      ts: Date.now(),
      cat: category,
      d: data,
    }
    _ring.push(entry)
    if (_ring.length > MAX_ENTRIES) _ring.shift()
  }

  /** Get last N entries (newest first). */
  function entries(n?: number): any[] {
    const count = Math.min(n || MAX_ENTRIES, _ring.length)
    return _ring.slice(-count).reverse()
  }

  /** Get entries filtered by category. */
  function byCategory(cat: string, n?: number): any[] {
    const filtered = _ring.filter((e: any) => e.cat === cat)
    const count = Math.min(n || 100, filtered.length)
    return filtered.slice(-count).reverse()
  }

  /** Export all entries as JSON string. */
  function exportJSON(): string {
    return JSON.stringify(_ring, null, 2)
  }

  /** Clear the ring buffer. */
  function clear(): void {
    _ring.length = 0
    _seq = 0
  }

  /** Summary stats. */
  function stats(): any {
    const cats: Record<string, number> = {}
    for (const e of _ring) {
      cats[e.cat] = (cats[e.cat] || 0) + 1
    }
    return { total: _ring.length, seq: _seq, categories: cats }
  }

  return { record, entries, byCategory, exportJSON, clear, stats }
})()

export const DLog = DLogImpl
w.DLog = DLogImpl
