'use strict';

/**
 * dbIntegrityMonitor — periodic SQLite integrity verdict, OFF the main thread.
 *
 * [FREEZE ROOT FIX 2026-10-07] Why this module exists:
 *   `PRAGMA integrity_check` used to run INLINE inside the doctor analyzer tick
 *   (analyzer.js, throttled to once per 5 min). The pragma is a FULL DB SCAN and
 *   better-sqlite3 is synchronous, so the whole Node event loop blocked for the
 *   duration. At ~2 GB that was ~45 s (bad but survivable). Once unbounded ML
 *   telemetry grew the DB to 7.9 GB it became 3-7 min per scan — longer than the
 *   60 s brainWatchdog staleness threshold. Result: serverBrain's heartbeat went
 *   stale every 5 min → the dead-man switch armed GLOBAL_HALT ~200×/day → every
 *   entry was blocked and the system did not open a single position for 2 months
 *   (last entry 2026-08-05). Measured: _doctor_analyzer avg latency 22.8 s,
 *   max 424 s.
 *
 * Design: the scan runs in a worker thread (dbIntegrityWorker.js) on a slow
 * cadence; the analyzer reads only the cached verdict, which costs nothing.
 * Boot starts with "no verdict yet" = NOT a failure, mirroring brainWatchdog's
 * no_signal_yet rule — absence of evidence must never arm anything.
 */

const path = require('path');

// A full scan is for catching silent disk corruption, which does not appear
// between two 5-minute windows. 6h keeps the signal with ~0 cost.
const DEFAULT_INTERVAL_MS = 6 * 60 * 60 * 1000;
// Never scan during boot I/O contention.
const DEFAULT_INITIAL_DELAY_MS = 10 * 60 * 1000;
const WORKER_TIMEOUT_MS = 30 * 60 * 1000;

let _fail = false;
let _lastCheckTs = 0;
let _everChecked = false;
let _lastDurationMs = null;
let _inFlight = null;
let _timer = null;
let _initialTimer = null;
let _runner = null; // injectable for tests

function _dbPath() {
    return process.env.ZEUS_DB_PATH
        ? path.resolve(process.env.ZEUS_DB_PATH)
        : path.join(__dirname, '..', '..', '..', '..', 'data', 'zeus.db');
}

/**
 * Default runner — spawns the worker and resolves with its rows.
 * Rejects on worker error, non-zero exit or timeout.
 */
function _workerRunner() {
    return new Promise((resolve, reject) => {
        let settled = false;
        let worker;
        const done = (fn, arg) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            try { if (worker) worker.terminate(); } catch (_) { /* best-effort */ }
            fn(arg);
        };
        const timer = setTimeout(
            () => done(reject, new Error('integrity worker timeout')),
            WORKER_TIMEOUT_MS
        );
        try {
            const { Worker } = require('worker_threads');
            worker = new Worker(path.join(__dirname, 'dbIntegrityWorker.js'), {
                workerData: { dbPath: _dbPath() },
            });
            worker.on('message', (msg) => {
                if (msg && msg.ok) done(resolve, { rows: msg.rows, durationMs: msg.durationMs });
                else done(reject, new Error((msg && msg.error) || 'integrity worker failed'));
            });
            worker.on('error', (err) => done(reject, err));
            worker.on('exit', (code) => {
                if (code !== 0) done(reject, new Error('integrity worker exit ' + code));
            });
        } catch (err) {
            done(reject, err);
        }
    });
}

/**
 * Healthy iff exactly one row saying 'ok'. Anything else — including an empty
 * result — counts as a failure: a scan that returned nothing proved nothing.
 */
function _verdictFromRows(rows) {
    return !(Array.isArray(rows) && rows.length === 1 && rows[0]
        && (rows[0].quick_check === 'ok' || rows[0].integrity_check === 'ok'));
}

/**
 * Run one check now and cache the verdict. Never throws and never rejects —
 * the caller is a timer. Concurrent calls share one scan.
 */
function runCheckNow(nowTs) {
    if (_inFlight) return _inFlight;
    const runner = _runner || _workerRunner;
    _inFlight = Promise.resolve()
        .then(() => runner())
        .then((res) => {
            _fail = _verdictFromRows(res && res.rows);
            _lastDurationMs = res && res.durationMs;
        })
        .catch(() => {
            // Unreadable DB / worker died — treat as failure, same as the old
            // inline catch did.
            _fail = true;
        })
        .then(() => {
            _lastCheckTs = Number.isFinite(nowTs) ? nowTs : Date.now();
            _everChecked = true;
            _inFlight = null;
        });
    return _inFlight;
}

function getLastResult() {
    return {
        fail: _fail,
        lastCheckTs: _lastCheckTs,
        everChecked: _everChecked,
        durationMs: _lastDurationMs,
    };
}

function start(opts) {
    if (_timer) return;
    const intervalMs = (opts && Number(opts.intervalMs) > 0) ? Number(opts.intervalMs) : DEFAULT_INTERVAL_MS;
    const initialDelayMs = (opts && Number(opts.initialDelayMs) >= 0)
        ? Number(opts.initialDelayMs) : DEFAULT_INITIAL_DELAY_MS;
    _initialTimer = setTimeout(() => { runCheckNow(Date.now()); }, initialDelayMs);
    if (_initialTimer.unref) _initialTimer.unref();
    _timer = setInterval(() => { runCheckNow(Date.now()); }, intervalMs);
    if (_timer.unref) _timer.unref();
}

function stop() {
    if (_timer) { clearInterval(_timer); _timer = null; }
    if (_initialTimer) { clearTimeout(_initialTimer); _initialTimer = null; }
}

function _setRunnerForTest(fn) { _runner = fn; }

function resetForTest() {
    stop();
    _fail = false;
    _lastCheckTs = 0;
    _everChecked = false;
    _lastDurationMs = null;
    _inFlight = null;
    _runner = null;
}

module.exports = {
    DEFAULT_INTERVAL_MS,
    runCheckNow, getLastResult, start, stop,
    _verdictFromRows, _setRunnerForTest, resetForTest,
};
