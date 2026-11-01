// [SYNC ZOMBIE 2026-11-01] Which demo positions belong in the /api/sync/state
// snapshot.
//
// The snapshot exists so the phone and the PC agree on positions the CLIENT
// owns. Server-owned AT positions travel on a different wire — /api/at/state —
// and state.ts says so in as many words: "Server-managed AT positions (with
// _serverSeq) live in /api/at/state, NOT in /api/sync/state. The sync file omits
// them by design".
//
// It did not omit them. The old predicate was
//     if (w._serverATEnabled && p.autoTrade) return false
// and `_serverATEnabled` is false for a demo user by construction: it is
// `serverActive` from getFullState, which needs MF.SERVER_AT && MF.SERVER_BRAIN
// or full SP2 ownership, and full ownership returns false unless
// engineMode === 'live'. On demo the server owns AT through SERVER_AT_DEMO
// instead — a different flag the predicate never read. So every server-owned
// demo AT position was written into the snapshot too, giving one position two
// owners that then fought: _applyServerATState dropped the ones the server no
// longer held, and the next pullAndMerge put them straight back from the
// snapshot. Measured on the live box 2026-11-01: 13 positions on the phone, 4
// in the engine, the 9 extras closed server-side since 2026-10-30 — and SHORTs,
// so the phone showed a mixed LONG+SHORT demo book.
//
// The durable rule is about OWNERSHIP, not about a flag: a position carrying
// `_serverSeq` is registered on the server, therefore the server ships it,
// therefore the snapshot must not. A genuine client-AT position has no
// `_serverSeq` and is unaffected.

/** True when this demo position belongs in the sync snapshot. */
export function shouldSerializeDemoPosition(p: any, serverATEnabled?: boolean): boolean {
    if (!p || typeof p !== 'object') return false
    if (p.closed) return false
    // Server-registered → the server is its single owner. Strict null-ish check:
    // `_serverSeq` is written as `p._serverSeq || null`, so absent reads as null,
    // and a 0 seq is not a real seq either.
    if (p._serverSeq !== null && p._serverSeq !== undefined && p._serverSeq !== 0 && p._serverSeq !== '') return false
    // Legacy guard kept: under full server authority no AT row is ours to sync.
    if (serverATEnabled === true && p.autoTrade) return false
    return true
}
