// Zeus Terminal — Structured Decision Logger
// Captures every brain/AT/DSL decision as structured JSON for comparison
// during server migration. Ring buffer in memory, optional server push.
//
// Usage:
//   DLog.record('confluence', { score: 72, regime: 'trend', phase: 'markup' });
//   DLog.record('at_gate', { sym: 'BTC', allOk: false, reasons: ['adx_low'] });
//   DLog.entries()    → last N entries
//   DLog.exportJSON() → downloadable JSON
//
// Categories: confluence, regime, signal, fusion, at_gate, at_entry, at_block,
//             dsl_move, dsl_close, kill_switch, predator, sizing
'use strict';

(function () {
    if (window.__DLOG_V1__) return;
    window.__DLOG_V1__ = true;

    const MAX_ENTRIES = 500;
    const _ring = [];
    let _seq = 0;

    /**
     * Record a structured decision.
     * @param {string} category - Decision type (confluence, regime, at_gate, etc.)
     * @param {object} data - Structured key-value payload
     */
    function record(category, data) {
        const entry = {
            seq: ++_seq,
            ts: Date.now(),
            cat: category,
            d: data,
        };
        _ring.push(entry);
        if (_ring.length > MAX_ENTRIES) _ring.shift();
    }

    /** Get last N entries (newest first). */
    function entries(n) {
        const count = Math.min(n || MAX_ENTRIES, _ring.length);
        return _ring.slice(-count).reverse();
    }

    /** Get entries filtered by category. */
    function byCategory(cat, n) {
        const filtered = _ring.filter(e => e.cat === cat);
        const count = Math.min(n || 100, filtered.length);
        return filtered.slice(-count).reverse();
    }

    /** Export all entries as JSON string. */
    function exportJSON() {
        return JSON.stringify(_ring, null, 2);
    }

    /** Clear the ring buffer. */
    function clear() {
        _ring.length = 0;
        _seq = 0;
    }

    /** Summary stats. */
    function stats() {
        const cats = {};
        for (const e of _ring) {
            cats[e.cat] = (cats[e.cat] || 0) + 1;
        }
        return { total: _ring.length, seq: _seq, categories: cats };
    }

    window.DLog = { record, entries, byCategory, exportJSON, clear, stats };
})();
