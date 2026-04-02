// Zeus Terminal — Structured Logger
// JSON-structured logging with levels, timestamps, and context
// Zero dependencies — wraps console with structured output
// Logs to stdout (JSON) + optional file rotation
'use strict';

const fs = require('fs');
const path = require('path');

const LOG_DIR = path.join(__dirname, '..', '..', 'data', 'logs');
const LOG_FILE = path.join(LOG_DIR, 'zeus.log');
const MAX_LOG_SIZE = 5 * 1024 * 1024; // 5MB per file, then rotate

// Ensure log directory exists
try { if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true }); } catch (_) { }

let _logStream = null;
function _getStream() {
    if (!_logStream || _logStream.destroyed) {
        try {
            _logStream = fs.createWriteStream(LOG_FILE, { flags: 'a' });
            _logStream.on('error', (err) => { console.error('[LOGGER] Stream error:', err.message); _logStream = null; });
        } catch (_) { }
    }
    return _logStream;
}

function _rotate() {
    try {
        if (!fs.existsSync(LOG_FILE)) return;
        const stat = fs.statSync(LOG_FILE);
        if (stat.size > MAX_LOG_SIZE) {
            const rotated = LOG_FILE + '.' + Date.now();
            if (_logStream) { _logStream.destroy(); _logStream = null; }
            fs.renameSync(LOG_FILE, rotated);
            // Keep only last 3 rotated files
            try {
                const files = fs.readdirSync(LOG_DIR)
                    .filter(f => f.startsWith('zeus.log.'))
                    .sort()
                    .reverse();
                for (let i = 3; i < files.length; i++) {
                    fs.unlinkSync(path.join(LOG_DIR, files[i]));
                }
            } catch (_) { }
        }
    } catch (_) { }
}

// Rotate check every 60s
setInterval(_rotate, 60000);

/**
 * Write a structured log entry.
 * @param {string} level — 'INFO' | 'WARN' | 'ERROR' | 'DEBUG'
 * @param {string} component — e.g. 'ORDER', 'RISK', 'AUTH', 'SERVER'
 * @param {string} message
 * @param {object} [data] — optional extra fields
 */
function log(level, component, message, data) {
    const entry = {
        ts: new Date().toISOString(),
        level: level,
        component: component,
        msg: message,
    };
    if (data && typeof data === 'object') {
        entry.data = data;
        if (data.userId) entry.userId = data.userId;
    }
    // Extract userId from message pattern uid=N if not already set
    if (!entry.userId && typeof message === 'string') {
        const m = /uid=(\d+)/.exec(message);
        if (m) entry.userId = parseInt(m[1], 10);
    }

    const line = JSON.stringify(entry);

    // Console output (human-readable prefix + JSON)
    const prefix = entry.ts.slice(11, 23) + ' [' + level + '] [' + component + '] ';
    if (level === 'ERROR') console.error(prefix + message);
    else if (level === 'WARN') console.warn(prefix + message);
    else console.log(prefix + message);

    // File output (pure JSON, one per line)
    const stream = _getStream();
    if (stream) { stream.write(line + '\n'); }
}

// ── Convenience methods ──
function info(component, message, data) { log('INFO', component, message, data); }
function warn(component, message, data) { log('WARN', component, message, data); }
function error(component, message, data) { log('ERROR', component, message, data); }
function debug(component, message, data) { log('DEBUG', component, message, data); }

module.exports = { log, info, warn, error, debug, LOG_DIR, LOG_FILE };
