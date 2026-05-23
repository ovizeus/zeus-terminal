'use strict';

/**
 * OMEGA R0 Substrate — dr (Disaster Recovery, spec 243)
 *
 * Foundation snapshot primitives:
 * - `saveSnapshot(label, data)` — atomic JSON write + SHA-256 hash.
 * - `loadSnapshot(label)` — return JSON or null if missing.
 * - `listSnapshots()` — directory listing with size + mtime.
 * - `integrityCheck(label, expectedHash)` — verify content unchanged.
 * - `deleteSnapshot(label)` — clean removal.
 *
 * Snapshots live under `data/ml_snapshots/`. Labels must match
 * `[A-Za-z0-9_-]+` (path-traversal safe). Real DR plan (failover,
 * hot standby, point-in-time recovery via input_snapshot_ref) layers
 * on top of this primitive in Wave 7 R6 self-improvement.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const SNAPSHOTS_DIR = path.join(__dirname, '..', '..', '..', '..', 'data', 'ml_snapshots');

const LABEL_PATTERN = /^[A-Za-z0-9_\-]+$/;

function _ensureDir() {
    if (!fs.existsSync(SNAPSHOTS_DIR)) {
        fs.mkdirSync(SNAPSHOTS_DIR, { recursive: true });
    }
}

function _validateLabel(label) {
    if (typeof label !== 'string' || !LABEL_PATTERN.test(label)) {
        throw new Error(`dr: label must match ${LABEL_PATTERN.source} (path-safe alphanumeric/_/-)`);
    }
}

function _hash(content) {
    return crypto.createHash('sha256').update(content).digest('hex');
}

function _pathFor(label) {
    return path.join(SNAPSHOTS_DIR, `${label}.json`);
}

_ensureDir();

function saveSnapshot(label, data) {
    _validateLabel(label);
    _ensureDir();
    const content = JSON.stringify(data, null, 2);
    const hash = _hash(content);
    const target = _pathFor(label);
    const tmp = `${target}.tmp`;
    fs.writeFileSync(tmp, content);
    fs.renameSync(tmp, target);
    return { label, hash, path: target };
}

function loadSnapshot(label) {
    _validateLabel(label);
    const target = _pathFor(label);
    if (!fs.existsSync(target)) return null;
    const content = fs.readFileSync(target, 'utf8');
    return JSON.parse(content);
}

function listSnapshots() {
    _ensureDir();
    const files = fs.readdirSync(SNAPSHOTS_DIR);
    const out = [];
    for (const f of files) {
        if (!f.endsWith('.json')) continue;
        const label = f.slice(0, -5);
        try {
            const stat = fs.statSync(path.join(SNAPSHOTS_DIR, f));
            out.push({ label, size: stat.size, mtime: stat.mtimeMs });
        } catch (_) { /* defensive */ }
    }
    return out;
}

function integrityCheck(label, expectedHash) {
    _validateLabel(label);
    const target = _pathFor(label);
    if (!fs.existsSync(target)) return false;
    const content = fs.readFileSync(target, 'utf8');
    return _hash(content) === expectedHash;
}

function deleteSnapshot(label) {
    _validateLabel(label);
    const target = _pathFor(label);
    if (fs.existsSync(target)) fs.unlinkSync(target);
}

module.exports = {
    saveSnapshot,
    loadSnapshot,
    listSnapshots,
    integrityCheck,
    deleteSnapshot,
    SNAPSHOTS_DIR
};
