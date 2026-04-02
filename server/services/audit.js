// Zeus Terminal — Audit Trail
// Permanent record of all trading actions for compliance and debugging
// Append-only JSON Lines file — never modified, only appended
'use strict';

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const AUDIT_FILE = path.join(DATA_DIR, 'audit.jsonl');
const MAX_SIZE = 10 * 1024 * 1024; // 10MB then rotate

// Ensure data dir exists
try { if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true }); } catch (_) { }

let _stream = null;
function _getStream() {
    if (!_stream || _stream.destroyed) {
        try {
            _stream = fs.createWriteStream(AUDIT_FILE, { flags: 'a' });
            _stream.on('error', (err) => { console.error('[AUDIT] Stream error:', err.message); _stream = null; });
        } catch (_) { }
    }
    return _stream;
}

function _rotate() {
    try {
        if (!fs.existsSync(AUDIT_FILE)) return;
        const stat = fs.statSync(AUDIT_FILE);
        if (stat.size > MAX_SIZE) {
            if (_stream) { _stream.end(); _stream = null; }
            const rotated = AUDIT_FILE + '.' + new Date().toISOString().slice(0, 10) + '-' + Date.now();
            fs.renameSync(AUDIT_FILE, rotated);
        }
    } catch (_) { }
}
setInterval(_rotate, 60000);

/**
 * Record an audit event.
 * @param {string} action — e.g. 'ORDER_PLACED', 'ORDER_FAILED', 'SL_SET', 'KILL_SWITCH', 'LOGIN', etc.
 * @param {object} details — action-specific data (symbol, side, qty, price, reason, etc.)
 * @param {string} [actor='system'] — who triggered it: 'AT', 'ARES', 'user', 'system'
 * @param {string} [ip] — request IP if applicable
 */
function record(action, details, actor, ip) {
    const d = details || {};
    const entry = {
        ts: new Date().toISOString(),
        action: action,
        actor: actor || 'system',
        userId: d.userId || null,
        ip: ip || null,
        details: d,
    };
    // Write to JSONL file (append-only log)
    const stream = _getStream();
    if (stream) {
        stream.write(JSON.stringify(entry) + '\n');
    }
    // Also write to SQLite audit_log (unified source)
    try {
        const db = require('./database');
        db.auditLog(d.userId || null, action, d, ip || null);
    } catch (_) { /* DB not ready at early boot — JSONL still captures */ }
}

/**
 * Read the last N audit entries (most recent first).
 * Uses reverse-read from end of file to avoid loading entire file into memory.
 * @param {number} [count=50]
 * @returns {Array<object>}
 */
function readLast(count) {
    const n = count || 50;
    try {
        if (!fs.existsSync(AUDIT_FILE)) return [];
        const stat = fs.statSync(AUDIT_FILE);
        if (stat.size === 0) return [];

        const fd = fs.openSync(AUDIT_FILE, 'r');
        const CHUNK = 8192;
        let pos = stat.size;
        let tail = '';
        const result = [];

        while (pos > 0 && result.length < n) {
            const readSize = Math.min(CHUNK, pos);
            pos -= readSize;
            const buf = Buffer.alloc(readSize);
            fs.readSync(fd, buf, 0, readSize, pos);
            tail = buf.toString('utf8') + tail;

            const lines = tail.split('\n');
            // Keep first partial line for next iteration
            tail = lines.shift();

            for (let i = lines.length - 1; i >= 0 && result.length < n; i--) {
                const line = lines[i].trim();
                if (!line) continue;
                try { result.push(JSON.parse(line)); } catch (_) { }
            }
        }
        // Handle remaining tail (first line of file)
        if (result.length < n && tail.trim()) {
            try { result.push(JSON.parse(tail.trim())); } catch (_) { }
        }

        fs.closeSync(fd);
        return result;
    } catch (_) {
        return [];
    }
}

/**
 * Read the last N audit entries for a specific user (most recent first).
 * Scans from end of file, filters by userId, stops after collecting `count` matches.
 * @param {number} userId
 * @param {number} [count=50]
 * @returns {Array<object>}
 */
function readByUser(userId, count) {
    if (!userId) return [];
    const n = count || 50;
    const uidStr = String(userId);
    try {
        if (!fs.existsSync(AUDIT_FILE)) return [];
        const stat = fs.statSync(AUDIT_FILE);
        if (stat.size === 0) return [];

        const fd = fs.openSync(AUDIT_FILE, 'r');
        const CHUNK = 16384;
        let pos = stat.size;
        let tail = '';
        const result = [];

        while (pos > 0 && result.length < n) {
            const readSize = Math.min(CHUNK, pos);
            pos -= readSize;
            const buf = Buffer.alloc(readSize);
            fs.readSync(fd, buf, 0, readSize, pos);
            tail = buf.toString('utf8') + tail;

            const lines = tail.split('\n');
            tail = lines.shift();

            for (let i = lines.length - 1; i >= 0 && result.length < n; i--) {
                const line = lines[i].trim();
                if (!line) continue;
                // Quick pre-filter before JSON parse
                if (!line.includes(uidStr)) continue;
                try {
                    const entry = JSON.parse(line);
                    if (String(entry.userId) === uidStr) result.push(entry);
                } catch (_) { }
            }
        }
        if (result.length < n && tail.trim() && tail.includes(uidStr)) {
            try {
                const entry = JSON.parse(tail.trim());
                if (String(entry.userId) === uidStr) result.push(entry);
            } catch (_) { }
        }

        fs.closeSync(fd);
        return result;
    } catch (_) {
        return [];
    }
}

module.exports = { record, readLast, readByUser };
