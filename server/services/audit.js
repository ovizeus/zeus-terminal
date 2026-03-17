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
        try { _stream = fs.createWriteStream(AUDIT_FILE, { flags: 'a' }); } catch (_) { }
    }
    return _stream;
}

function _rotate() {
    try {
        if (!fs.existsSync(AUDIT_FILE)) return;
        const stat = fs.statSync(AUDIT_FILE);
        if (stat.size > MAX_SIZE) {
            if (_stream) { _stream.end(); _stream = null; }
            const rotated = AUDIT_FILE + '.' + new Date().toISOString().slice(0, 10);
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
    const entry = {
        ts: new Date().toISOString(),
        action: action,
        actor: actor || 'system',
        ip: ip || null,
        details: details || {},
    };
    const stream = _getStream();
    if (stream) {
        stream.write(JSON.stringify(entry) + '\n');
    }
}

/**
 * Read the last N audit entries (most recent first).
 * @param {number} [count=50]
 * @returns {Array<object>}
 */
function readLast(count) {
    const n = count || 50;
    try {
        if (!fs.existsSync(AUDIT_FILE)) return [];
        const raw = fs.readFileSync(AUDIT_FILE, 'utf8').trim();
        if (!raw) return [];
        const lines = raw.split('\n');
        const result = [];
        for (let i = lines.length - 1; i >= 0 && result.length < n; i--) {
            try { result.push(JSON.parse(lines[i])); } catch (_) { }
        }
        return result;
    } catch (_) {
        return [];
    }
}

module.exports = { record, readLast };
