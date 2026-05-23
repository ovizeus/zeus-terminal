'use strict';

// [Wave 7b] Chained-hash audit trail. Each entry's hash includes the
// previous entry's hash, making tampering forward-propagating. Use for
// the most critical events: position open, position close, mode flip,
// kill switch, R1 violations (later wire-up).
//
// Hash: sha256( prev_hash || JSON.stringify(payload) || ts )
// Genesis: prev_hash = 'GENESIS' for first entry.
// Verify: walks chain in order, recomputes hash, compares; first mismatch
// returns ok=false with the broken id.

const crypto = require('crypto');
const { db } = require('../../database');

function _computeHash(prev_hash, payloadJson, ts) {
    return crypto.createHash('sha256')
        .update(prev_hash + '|' + payloadJson + '|' + ts)
        .digest('hex');
}

function append({ kind, payload }) {
    const head = db.prepare(
        `SELECT entry_hash FROM ml_audit_chain ORDER BY id DESC LIMIT 1`
    ).get();
    const prev_hash = head ? head.entry_hash : 'GENESIS';
    const ts = Date.now();
    const payloadJson = JSON.stringify(payload || {});
    const entry_hash = _computeHash(prev_hash, payloadJson, ts);
    try {
        db.prepare(
            `INSERT INTO ml_audit_chain (prev_hash, entry_hash, kind, payload_json, ts)
             VALUES (?, ?, ?, ?, ?)`
        ).run(prev_hash, entry_hash, String(kind || 'UNKNOWN'), payloadJson, ts);
    } catch (err) {
        return { ok: false, error: err.message, prev_hash, entry_hash, ts };
    }
    return { ok: true, prev_hash, entry_hash, ts, kind };
}

function verify(opts) {
    const o = opts || {};
    let query = `SELECT id, prev_hash, entry_hash, payload_json, ts FROM ml_audit_chain`;
    const conds = [];
    const params = [];
    if (o.fromTs != null) { conds.push('ts >= ?'); params.push(o.fromTs); }
    if (o.toTs != null) { conds.push('ts <= ?'); params.push(o.toTs); }
    if (conds.length > 0) query += ' WHERE ' + conds.join(' AND ');
    query += ' ORDER BY id ASC';
    const rows = db.prepare(query).all(...params);

    // Establish expected prev_hash for the first row in window:
    let expectedPrev;
    if (rows.length === 0) {
        return { ok: true, entries: 0, firstBroken: null };
    }
    if (o.fromTs == null) {
        expectedPrev = 'GENESIS';
    } else {
        // Get the entry immediately before window start
        const prevRow = db.prepare(
            `SELECT entry_hash FROM ml_audit_chain WHERE ts < ? ORDER BY id DESC LIMIT 1`
        ).get(o.fromTs);
        expectedPrev = prevRow ? prevRow.entry_hash : 'GENESIS';
    }

    for (const row of rows) {
        if (row.prev_hash !== expectedPrev) {
            return { ok: false, entries: rows.length, firstBroken: row.id, reason: 'prev_hash_mismatch' };
        }
        const recomputed = _computeHash(row.prev_hash, row.payload_json, row.ts);
        if (recomputed !== row.entry_hash) {
            return { ok: false, entries: rows.length, firstBroken: row.id, reason: 'entry_hash_mismatch' };
        }
        expectedPrev = row.entry_hash;
    }

    return { ok: true, entries: rows.length, firstBroken: null };
}

function recent(limit) {
    const n = Math.max(1, Math.min(500, parseInt(limit, 10) || 50));
    return db.prepare(
        `SELECT id, prev_hash, entry_hash, kind, payload_json, ts
         FROM ml_audit_chain
         ORDER BY ts DESC LIMIT ?`
    ).all(n);
}

function head() {
    const row = db.prepare(
        `SELECT id, entry_hash, kind, ts FROM ml_audit_chain ORDER BY id DESC LIMIT 1`
    ).get();
    return row || null;
}

module.exports = { append, verify, recent, head };
