'use strict';

/**
 * OMEGA R0 Substrate — opsec (spec 244*)
 *
 * Operational security primitives shared across rings:
 * - `redactSecret(text)` — replace API keys, Bearer tokens, long hex
 *   signatures with `[REDACTED]`. Applied automatically before any log,
 *   audit trail, voice utterance, or operator notification touches text
 *   that could plausibly contain secrets.
 * - `signPayload(payload, secret)` — HMAC-SHA256 signature of canonical
 *   JSON payload. Used by operator-approval queue (spec 252*) to verify
 *   that decisions weren't tampered between proposal and apply.
 * - `validateSignature(payload, signature, secret)` — constant-time HMAC
 *   verification (timing-attack safe via crypto.timingSafeEqual).
 *
 * This is foundation: real production key management (rotation, HSM,
 * KMS) lands in Wave 5 R1 Constitution.
 */

const crypto = require('crypto');

const REDACTION_PLACEHOLDER = '[REDACTED]';

// Patterns ordered most-specific first to avoid double-matching
const SECRET_PATTERNS = [
    /Bearer\s+[A-Za-z0-9._\-]{16,}/g,
    /apiKey=[A-Za-z0-9_\-]{16,}/g,
    /api[_-]?key["':\s=]+[A-Za-z0-9_\-]{16,}/gi,
    /signature["':\s=]+[a-fA-F0-9]{32,}/gi,
    /\b[a-fA-F0-9]{40,}\b/g,
];

function redactSecret(text) {
    if (typeof text !== 'string') {
        throw new Error('redactSecret: text must be a string');
    }
    let out = text;
    for (const pattern of SECRET_PATTERNS) {
        out = out.replace(pattern, REDACTION_PLACEHOLDER);
    }
    return out;
}

function _canonicalize(payload) {
    if (payload === null || typeof payload !== 'object') {
        return JSON.stringify(payload);
    }
    const sortedKeys = Object.keys(payload).sort();
    const sorted = {};
    for (const k of sortedKeys) sorted[k] = payload[k];
    return JSON.stringify(sorted);
}

function signPayload(payload, secret) {
    if (typeof secret !== 'string' || secret.length === 0) {
        throw new Error('signPayload: secret must be a non-empty string');
    }
    const canonical = _canonicalize(payload);
    return crypto.createHmac('sha256', secret).update(canonical).digest('hex');
}

function validateSignature(payload, signature, secret) {
    if (typeof signature !== 'string' || signature.length === 0) return false;
    if (typeof secret !== 'string' || secret.length === 0) return false;
    let expected;
    try {
        expected = signPayload(payload, secret);
    } catch (_) {
        return false;
    }
    if (signature.length !== expected.length) return false;
    try {
        return crypto.timingSafeEqual(Buffer.from(signature, 'hex'), Buffer.from(expected, 'hex'));
    } catch (_) {
        return false;
    }
}

module.exports = {
    redactSecret,
    signPayload,
    validateSignature,
    REDACTION_PLACEHOLDER
};
