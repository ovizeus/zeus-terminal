// Zeus Terminal — Position dedup invariant (2026-06-18)
//
// ROOT of the recurring "Manual x1" orphan churn: on a Binance ONE-WAY account there is
// exactly ONE net position per (user, symbol, side, mode), but at_positions accumulates
// MULTIPLE records per key:
//   - serverAT CANONICAL row (live.status LIVE/LIVE_NO_SL/EXTERNAL) — the real one.
//   - dual-write STUBS (binanceOps leaves a row in OPENING status; no live.status) — meant
//     to be deduped on close, but they linger.
//   - STALE cruft from old sessions (no live, no source, leverage undefined).
//   - re-adopted EXTERNAL orphans (duplicate of the canonical).
// Recon then can't cleanly match N engine records to the 1 exchange position → adopts the
// exchange leg as yet another orphan. This pure function collapses each (user,symbol,side,
// mode) group to a SINGLE canonical record and returns the rest to retire — applied at boot
// and before recon's orphan detection so recon sees one record per net exchange position.
//
// PURE: no side effects, no DB, no logger. Caller decides how to retire (archive/splice).

'use strict';

const _RECONCILABLE = new Set(['LIVE', 'LIVE_NO_SL', 'EXTERNAL']);

function _liveStatus(p) {
    return p && p.live && typeof p.live.status === 'string' ? p.live.status : null;
}

// A record that carries a reconcilable live leg — a real, exchange-backed position.
function _isCanonicalCandidate(p) {
    const st = _liveStatus(p);
    return !!st && _RECONCILABLE.has(st);
}

// Pure cruft: no live leg AND no source AND no leverage — a leftover row from an old
// session / failed write. Safe to retire even when alone in its group.
function _isStaleCruft(p) {
    return !p.live && (p.source == null) && (p.leverage == null) && (p.mode != null);
}

// Score a canonical candidate so the BEST survives: prefer serverAT source, then a placed
// protective SL, then the newest (highest seq). Higher = better.
function _canonScore(p) {
    let s = 0;
    if (p.source === 'serverAT') s += 1000;
    else if (p.source === 'external') s += 500;
    if (p.live && (p.live.slOrderId || p.live.stopOrderId)) s += 100;
    const st = _liveStatus(p);
    if (st === 'LIVE') s += 50; else if (st === 'LIVE_NO_SL') s += 30; else if (st === 'EXTERNAL') s += 20;
    s += Math.min(40, (Number(p.seq) % 1e6) / 25000); // newest tie-breaker, bounded
    return s;
}

function _key(p) {
    return `${p.userId}|${p.symbol}|${p.side}|${p.mode || 'live'}`;
}

/**
 * Collapse positions to one canonical record per (user, symbol, side, mode).
 * @param {Array} positions — engine positions (each: {seq,userId,symbol,side,mode,source,leverage,live})
 * @returns {{ keep: Array, retire: Array<{seq, reason}> }}
 *   keep   — the canonical survivors + any genuinely-distinct records.
 *   retire — duplicates / stubs / stale cruft to archive (never the canonical).
 */
function dedupePositions(positions) {
    const keep = [];
    const retire = [];
    if (!Array.isArray(positions)) return { keep, retire };

    const groups = new Map();
    for (const p of positions) {
        if (!p || !p.symbol || !p.side) { keep.push(p); continue; } // untouchable / malformed → leave
        const k = _key(p);
        if (!groups.has(k)) groups.set(k, []);
        groups.get(k).push(p);
    }

    for (const group of groups.values()) {
        if (group.length === 1) {
            // Lone record: retire only if it is pure stale cruft, else keep.
            const p = group[0];
            if (_isStaleCruft(p)) retire.push({ seq: p.seq, reason: 'stale-cruft-lone' });
            else keep.push(p);
            continue;
        }
        // Multiple records for the same one-way key → keep ONE canonical, retire the rest.
        const canon = group.filter(_isCanonicalCandidate);
        if (canon.length) {
            canon.sort((a, b) => _canonScore(b) - _canonScore(a));
            const winner = canon[0];
            keep.push(winner);
            for (const p of group) {
                if (p === winner) continue;
                retire.push({ seq: p.seq, reason: _isCanonicalCandidate(p) ? 'dup-canonical' : (_liveStatus(p) ? 'dup-other' : 'dup-stub-or-stale') });
            }
        } else {
            // No reconcilable canonical in the group (all stubs/stale). Keep the newest
            // non-stale (so a real-but-not-yet-LIVE record survives), retire the rest.
            const nonStale = group.filter(p => !_isStaleCruft(p));
            const survivors = nonStale.length ? nonStale : group;
            survivors.sort((a, b) => (Number(b.seq) || 0) - (Number(a.seq) || 0));
            keep.push(survivors[0]);
            for (const p of group) {
                if (p === survivors[0]) continue;
                retire.push({ seq: p.seq, reason: _isStaleCruft(p) ? 'stale-cruft' : 'dup-stub' });
            }
        }
    }
    return { keep, retire };
}

module.exports = { dedupePositions, _isCanonicalCandidate, _isStaleCruft, _RECONCILABLE };
