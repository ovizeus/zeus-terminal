'use strict';

// Zeus Terminal — Periodic Drift Checker (Task N)
//
// WebSocket dropouts and REST timeouts can desync serverAT._positions from
// the real exchange state. Brain might think we're FLAT while exchange has
// an active LONG, or vice-versa. Without periodic reconciliation, drift
// can persist for minutes before a trade reveals it.
//
// Every 15min (default), per active user, compare serverAT.getOpenPositions
// vs exchangeOps.getPositions. Three drift types:
//   - exchangeOnly: position on exchange not in DB
//   - dbOnly: position in DB not on exchange
//   - sizeMismatch: same symbol+side, qty diff > 5%
//
// 2 consecutive drift detections → globalHalt + Telegram P0 + audit
// (transient drift from a single WS dropout shouldn't halt; persistent
// drift is real). Clean check resets the consecutive counter. Halt
// fires ONCE per drift episode — debounce prevents spam.
//
// Defensive: getPositions failure is NOT counted as drift (no signal to
// make a decision on). Resets counter to avoid stale escalation.

const DEFAULT_INTERVAL_MS = 15 * 60 * 1000;  // 15 min
const SIZE_TOLERANCE_PCT = 0.05;             // 5%
const CONSECUTIVE_FAILS_TO_HALT = 2;

let _timer = null;
// Per-user consecutive drift detection counter.
const _consecutiveFails = new Map();
// Per-user "halt already fired" flag (debounce — don't re-halt on persistent drift)
const _haltFired = new Map();

function _normSide(s) { return String(s || '').toUpperCase(); }
function _normSym(s) { return String(s || '').toUpperCase(); }
function _key(sym, side) { return _normSym(sym) + ':' + _normSide(side); }

async function checkUser(userId) {
    const serverAT = require('./serverAT');
    const exchangeOps = require('./exchangeOps');
    const { groupPositionsByExchange } = require('./reconHelpers');

    let dbPos = [];
    try {
        dbPos = serverAT.getOpenPositions ? (serverAT.getOpenPositions(userId) || []) : [];
    } catch (_) { dbPos = []; }

    // [P2c.2] Compare PER EXCHANGE. Pre-P2c this compared ALL db positions (any
    // exchange) against only the ACTIVE exchange's held positions — so after a
    // switch a position on a non-active exchange was falsely flagged dbOnly →
    // false GLOBAL HALT. Now each exchange's db positions are checked against
    // THAT exchange (exchangeOps.getPositions exchangeOverride → its own creds).
    const dbByExchange = groupPositionsByExchange(dbPos); // Map exchange→[]
    const exchanges = new Set(dbByExchange.keys());
    // Also check the active exchange so an untracked position there is still caught
    // (exchangeOnly) even when we hold no db position on it.
    try {
        const active = require('./credentialStore').getExchangeCreds(userId);
        if (active && active.exchange) exchanges.add(active.exchange);
    } catch (_) { /* no active creds — fall back to db exchanges only */ }

    const exchangeOnly = [];
    const dbOnly = [];
    const sizeMismatch = [];
    let anySignal = false;
    let lastError = null;

    for (const exchange of exchanges) {
        let exchPos;
        try {
            exchPos = (await exchangeOps.getPositions(userId, { exchangeOverride: exchange })) || [];
        } catch (err) {
            // No signal for THIS exchange — skip it (don't flag its db positions as
            // dbOnly off a transient error). Preserves the defensive no-signal rule.
            lastError = err && err.message ? err.message : String(err);
            continue;
        }
        anySignal = true;
        // Filter zero-qty exchange positions (closed/empty)
        exchPos = exchPos.filter(p => Math.abs(Number(p.qty || 0)) > 0);
        const dbList = dbByExchange.get(exchange) || [];
        const dbMap = new Map(dbList.map(p => [_key(p.symbol, p.side), p]));
        const exchMap = new Map(exchPos.map(p => [_key(p.symbol, p.side), p]));

        for (const [k, p] of exchMap) {
            if (!dbMap.has(k)) {
                exchangeOnly.push({ exchange, symbol: p.symbol, side: _normSide(p.side), qty: Number(p.qty) });
            } else {
                const dbQty = Math.abs(Number(dbMap.get(k).qty || 0));
                const exchQty = Math.abs(Number(p.qty || 0));
                const denom = Math.max(dbQty, exchQty);
                if (denom > 0 && Math.abs(dbQty - exchQty) / denom > SIZE_TOLERANCE_PCT) {
                    sizeMismatch.push({ exchange, symbol: p.symbol, side: _normSide(p.side), dbQty, exchQty });
                }
            }
        }
        for (const [k, p] of dbMap) {
            if (!exchMap.has(k)) {
                dbOnly.push({ exchange, symbol: p.symbol, side: _normSide(p.side), qty: Number(p.qty) });
            }
        }
    }

    if (!anySignal) {
        // No exchange returned a result — no signal at all. Don't count toward
        // consecutive drift, don't halt (same as the pre-P2c single-exchange rule).
        return { driftDetected: false, error: lastError };
    }

    const driftDetected = (exchangeOnly.length + dbOnly.length + sizeMismatch.length) > 0;

    if (!driftDetected) {
        // Clean — reset counter (allows escalation on future drift to start fresh)
        _consecutiveFails.set(userId, 0);
        return { driftDetected: false, diff: { exchangeOnly, dbOnly, sizeMismatch }, consecutiveFails: 0 };
    }

    const cur = (_consecutiveFails.get(userId) || 0) + 1;
    _consecutiveFails.set(userId, cur);

    if (cur >= CONSECUTIVE_FAILS_TO_HALT && !_haltFired.get(userId)) {
        _haltFired.set(userId, true);
        _fireHaltAlert(userId, { exchangeOnly, dbOnly, sizeMismatch, consecutive: cur });
    }

    return {
        driftDetected: true,
        diff: { exchangeOnly, dbOnly, sizeMismatch },
        consecutiveFails: cur,
    };
}

function _fireHaltAlert(userId, payload) {
    const summary = JSON.stringify({
        exchangeOnly: payload.exchangeOnly.length,
        dbOnly: payload.dbOnly.length,
        sizeMismatch: payload.sizeMismatch.length,
    });
    try {
        const serverAT = require('./serverAT');
        serverAT.setGlobalHalt(true, userId, 'DRIFT_DETECTED:' + summary);
    } catch (e) {
        console.error('[DRIFT-CHECKER] setGlobalHalt failed:', e.message);
    }

    try {
        const telegram = require('./telegram');
        telegram.sendToUser(userId,
            '🚨 *POSITION DRIFT DETECTED* uid=' + userId + '\n'
            + 'exchange-only: ' + payload.exchangeOnly.length + '\n'
            + 'db-only: ' + payload.dbOnly.length + '\n'
            + 'size-mismatch: ' + payload.sizeMismatch.length + '\n'
            + '_Global halt ARMED. Manual investigation required._');
    } catch (_) { /* best-effort */ }

    try {
        // [P2c.2 2026-06-08] auditLog is a MODULE-level export of database.js —
        // the old `const { db } = require('./database'); db.auditLog(...)` called
        // it on the RAW better-sqlite3 handle (which has no auditLog) → the halt
        // audit was silently lost to the catch.
        const database = require('./database');
        database.auditLog(userId, 'DRIFT_DETECTED_HALT', {
            exchangeOnly: payload.exchangeOnly,
            dbOnly: payload.dbOnly,
            sizeMismatch: payload.sizeMismatch,
            consecutive: payload.consecutive,
        }, null);
    } catch (_) { /* best-effort */ }
}

async function checkAllUsers() {
    try {
        // [P2c.2 2026-06-08] Enumerate active-exchange users directly from the
        // exchange_accounts table (canonical pattern — see pnlReconCron.js,
        // serverAT recon). The old `db.listActiveExchangeUsers` existed NOWHERE
        // (neither on the raw handle nor as a module export) → users always [] →
        // checkAllUsers was INERT and the whole drift checker never ran.
        const { db } = require('./database');
        let users = [];
        try {
            users = db.prepare(
                'SELECT DISTINCT user_id FROM exchange_accounts WHERE is_active = 1'
            ).all() || [];
        } catch (qe) {
            console.error('[DRIFT-CHECKER] active-user query failed:', qe.message);
            return;
        }
        for (const u of users) {
            const uid = u && (u.user_id != null ? u.user_id : u.id);
            if (!uid) continue;
            try { await checkUser(uid); } catch (_) { /* per-user resilience */ }
        }
    } catch (e) {
        console.error('[DRIFT-CHECKER] checkAllUsers error:', e.message);
    }
}

function start(opts) {
    if (_timer) return;
    const intervalMs = (opts && Number(opts.intervalMs) > 0)
        ? Number(opts.intervalMs)
        : DEFAULT_INTERVAL_MS;
    _timer = setInterval(() => { checkAllUsers().catch(() => {}); }, intervalMs);
    console.log('[DRIFT-CHECKER] started interval=' + intervalMs + 'ms tolerance=' + (SIZE_TOLERANCE_PCT * 100) + '%');
}

function stop() {
    if (_timer) {
        clearInterval(_timer);
        _timer = null;
    }
}

function _reset() {
    _consecutiveFails.clear();
    _haltFired.clear();
    if (_timer) { clearInterval(_timer); _timer = null; }
}

module.exports = {
    start, stop, checkUser, checkAllUsers, _reset,
    DEFAULT_INTERVAL_MS, SIZE_TOLERANCE_PCT,
};
