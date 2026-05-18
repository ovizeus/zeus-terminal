'use strict';

// [Wave 7a] R7 Meta — inter-ring communication tracer. Lightweight wrapper
// that instruments any ring-to-ring function call and records:
//   caller_module, callee_module, method, input_summary, output_summary,
//   duration_ms, ok flag, ts.
//
// Pure observability — does NOT alter return semantics. Async functions
// supported via Promise detection. Errors propagate normally (still
// recorded with ok=0).
//
// Volume management: input/output summaries truncated at 200 chars to
// keep DB rows small. Ring buffer of last N=10000 rows enforced by
// periodic prune (caller-driven via prune() OR on every 100 inserts).

const { db } = require('../../database');

const SUMMARY_MAX = 200;
const KEEP_ROWS = 10000;
const PRUNE_EVERY = 100;
let _insertCount = 0;

function _summarize(value) {
    if (value === undefined) return '';
    if (value === null) return 'null';
    let str;
    try {
        if (typeof value === 'object') str = JSON.stringify(value);
        else str = String(value);
    } catch (_) { str = '[unserializable]'; }
    return str.length > SUMMARY_MAX ? str.slice(0, SUMMARY_MAX) : str;
}

function _record({ caller, callee, method, input, output, durationMs, ok }) {
    try {
        db.prepare(
            `INSERT INTO ml_inter_ring_trace
             (caller_module, callee_module, method, input_summary, output_summary, duration_ms, ok, ts)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(caller, callee, method, _summarize(input), _summarize(output), durationMs, ok ? 1 : 0, Date.now());
        _insertCount++;
        if (_insertCount >= PRUNE_EVERY) {
            _insertCount = 0;
            _pruneOld();
        }
    } catch (_) { /* never block ring call */ }
}

function _pruneOld() {
    try {
        const totalRow = db.prepare(`SELECT COUNT(*) AS n FROM ml_inter_ring_trace`).get();
        if (totalRow && totalRow.n > KEEP_ROWS) {
            const excess = totalRow.n - KEEP_ROWS;
            db.prepare(
                `DELETE FROM ml_inter_ring_trace WHERE id IN (
                    SELECT id FROM ml_inter_ring_trace ORDER BY ts ASC LIMIT ?
                )`
            ).run(excess);
        }
    } catch (_) {}
}

function wrap(caller, callee, method, fn) {
    return function _instrumented(...args) {
        const t0 = Date.now();
        let result;
        try {
            result = fn.apply(this, args);
        } catch (err) {
            _record({
                caller, callee, method,
                input: args.length === 1 ? args[0] : args,
                output: err.message || String(err),
                durationMs: Date.now() - t0,
                ok: false,
            });
            throw err;
        }
        // Async path — instrument promise resolution
        if (result && typeof result.then === 'function') {
            return result.then(
                (val) => {
                    _record({
                        caller, callee, method,
                        input: args.length === 1 ? args[0] : args,
                        output: val,
                        durationMs: Date.now() - t0,
                        ok: true,
                    });
                    return val;
                },
                (err) => {
                    _record({
                        caller, callee, method,
                        input: args.length === 1 ? args[0] : args,
                        output: err && err.message || String(err),
                        durationMs: Date.now() - t0,
                        ok: false,
                    });
                    throw err;
                }
            );
        }
        // Sync path
        _record({
            caller, callee, method,
            input: args.length === 1 ? args[0] : args,
            output: result,
            durationMs: Date.now() - t0,
            ok: true,
        });
        return result;
    };
}

function recent(limit) {
    const n = Math.max(1, Math.min(500, parseInt(limit, 10) || 50));
    return db.prepare(
        `SELECT id, caller_module, callee_module, method, input_summary,
                output_summary, duration_ms, ok, ts
         FROM ml_inter_ring_trace
         ORDER BY ts DESC LIMIT ?`
    ).all(n);
}

module.exports = { wrap, recent };
