'use strict';

// [Wave 6] DB-backed idempotency ledger — cross-restart exactly-once
// guarantee for order placement. Companion to the in-memory cache in
// trading.js (_idempotencyCache Map). Strategy:
//
//   Hot path: check in-memory cache first (fast).
//   Cache miss (e.g. PM2 reload): check this ledger.
//   Both miss: process order, then record(key, payload, result) here.
//
// API:
//   seen(key)               → { result, payloadHash, createdAt } | null
//   record(key, payload,    → { ok, duplicate, payloadHashMismatch, result }
//          result, opts)
//   purgeExpired()          → count of removed rows
//
// TTL default 24h (86400000 ms). Payload hash uses SHA-256 over sorted-key
// JSON so identical content with diff key order matches.

const crypto = require('crypto');
const { db } = require('../../database');

const DEFAULT_TTL_MS = 24 * 3600 * 1000;

function _hashPayload(payload) {
    // Sort keys recursively for stable hash regardless of insertion order
    function _sortKeys(obj) {
        if (obj === null || typeof obj !== 'object') return obj;
        if (Array.isArray(obj)) return obj.map(_sortKeys);
        return Object.keys(obj).sort().reduce((acc, k) => {
            acc[k] = _sortKeys(obj[k]);
            return acc;
        }, {});
    }
    const stable = JSON.stringify(_sortKeys(payload || {}));
    return crypto.createHash('sha256').update(stable).digest('hex');
}

function seen(key) {
    if (!key) return null;
    const row = db.prepare(
        `SELECT payload_hash, result_json, created_at, ttl_ms
         FROM ml_idempotency_ledger WHERE idempotency_key = ?`
    ).get(key);
    if (!row) return null;
    const age = Date.now() - row.created_at;
    if (age >= row.ttl_ms) return null;  // expired
    let result;
    try { result = JSON.parse(row.result_json); }
    catch (_) { result = null; }
    return {
        result,
        payloadHash: row.payload_hash,
        createdAt: row.created_at,
    };
}

function record(key, payload, result, opts) {
    if (!key) return { ok: false, error: 'key_required' };
    const ttl = (opts && opts.ttlMs) || DEFAULT_TTL_MS;
    const newHash = _hashPayload(payload);

    // Check for existing entry (idempotency)
    const existing = db.prepare(
        `SELECT payload_hash, result_json, created_at, ttl_ms
         FROM ml_idempotency_ledger WHERE idempotency_key = ?`
    ).get(key);

    if (existing) {
        const age = Date.now() - existing.created_at;
        if (age < existing.ttl_ms) {
            // Still valid duplicate — return existing, flag mismatch if any
            let prevResult;
            try { prevResult = JSON.parse(existing.result_json); }
            catch (_) { prevResult = null; }
            return {
                ok: true,
                duplicate: true,
                payloadHashMismatch: existing.payload_hash !== newHash,
                result: prevResult,
            };
        }
        // Expired — drop + insert fresh below
        db.prepare(`DELETE FROM ml_idempotency_ledger WHERE idempotency_key = ?`).run(key);
    }

    try {
        db.prepare(
            `INSERT INTO ml_idempotency_ledger
             (idempotency_key, payload_hash, result_json, created_at, ttl_ms)
             VALUES (?, ?, ?, ?, ?)`
        ).run(key, newHash, JSON.stringify(result || {}), Date.now(), ttl);
        return { ok: true, duplicate: false, payloadHashMismatch: false, result };
    } catch (err) {
        // Race condition possible — another writer inserted same key between
        // SELECT + INSERT. Re-read and treat as duplicate.
        const racedRow = db.prepare(
            `SELECT payload_hash, result_json FROM ml_idempotency_ledger WHERE idempotency_key = ?`
        ).get(key);
        if (racedRow) {
            let prevResult;
            try { prevResult = JSON.parse(racedRow.result_json); }
            catch (_) { prevResult = null; }
            return {
                ok: true,
                duplicate: true,
                payloadHashMismatch: racedRow.payload_hash !== newHash,
                result: prevResult,
            };
        }
        return { ok: false, error: err.message };
    }
}

function purgeExpired() {
    const now = Date.now();
    const r = db.prepare(
        `DELETE FROM ml_idempotency_ledger
         WHERE (created_at + ttl_ms) <= ?`
    ).run(now);
    return r.changes || 0;
}

module.exports = { seen, record, purgeExpired };
