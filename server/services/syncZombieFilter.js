'use strict';
//
// [SYNC ZOMBIE 2026-11-01] Pure predicate: a synced position whose id is a seq
// the server has ALREADY archived into `at_closed` is closed, full stop.
//
// Why this module exists. `POST /api/sync/state` keeps a per-user JSON snapshot
// of open positions so the phone and the PC agree. Its only resurrection guard
// is the `closedIds` list the CLIENT sends. serverAT closes demo positions
// server-side (DSL_PL / DSL_ML_CUT) and archives them to `at_closed` — and never
// touches that JSON. The id therefore never reaches `closedIds`, the snapshot
// still lists the row as open, and the merge in sync.js re-adds it on every
// single sync. Measured on the live box 2026-11-01: the operator's snapshot
// carried 13 demo positions while serverAT held 4. The 9 extras were all closed
// in `at_closed` — the oldest since 2026-10-30 — and they were SHORTs, so the
// phone showed a mixed LONG+SHORT demo book that the engine never had.
//
// `at_closed` is the authority here: a row lands there inside the same
// transaction that deletes it from `at_positions`, so its presence is proof the
// position is finished. Scoped per user by the caller — a seq is only ever
// matched against the archive of the user who owns the snapshot.
//
// Keys are compared as STRINGS. Client ids arrive as both numbers and strings
// for the same position, and `Number(null) === 0` passes `Number.isFinite`, so
// coercing to a number would quietly turn a null id into seq 0.

/** Normalize a position id to a comparison key, or null when there is none. */
function idKey(id) {
    if (typeof id === 'number') return Number.isFinite(id) ? String(id) : null;
    if (typeof id === 'string') return id.length > 0 ? id : null;
    return null; // null / undefined / object / boolean — no usable id
}

/**
 * Split positions into the ones that survive and the ones the server has
 * already archived.
 * @param {Array} positions
 * @param {Set<string>|Array} archivedSeqs — seqs from at_closed for THIS user
 * @returns {{ kept: Array, dropped: Array }}
 */
function partitionArchived(positions, archivedSeqs) {
    const arch = archivedSeqs instanceof Set
        ? archivedSeqs
        : new Set((Array.isArray(archivedSeqs) ? archivedSeqs : []).map(String));
    const kept = [];
    const dropped = [];
    for (const p of (Array.isArray(positions) ? positions : [])) {
        if (!p || typeof p !== 'object') continue; // malformed entries never survive
        const k = idKey(p.id);
        if (k !== null && arch.has(k)) dropped.push(p);
        else kept.push(p);
    }
    return { kept, dropped };
}

module.exports = { idKey, partitionArchived };
