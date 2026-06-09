'use strict';

const { db } = require('./database');
const exchangeOps = require('./exchangeOps');

// [P1 2026-06-09] 02:00 → 04:05 UTC: 02:00 sat at the edge of the Binance
// anti-ban window (22:00-02:00) and collided with omegaMemoryCleanup.
const RECON_HOUR_UTC = 4;
const RECON_MIN_UTC = 5;

async function reconcileUser(uid) {
    // Get recent closed positions from at_closed (last 24h)
    const oneDayAgo = Date.now() - 86400000;
    const closed = db.prepare(
        `SELECT seq, data, user_id, exchange FROM at_closed WHERE user_id = ? AND closed_at > datetime(?, 'unixepoch')`
    ).all(uid, Math.floor(oneDayAgo / 1000));

    if (closed.length === 0) return { uid, checked: 0, mismatches: 0 };

    let mismatches = 0;
    for (const row of closed) {
        let data;
        try { data = JSON.parse(row.data); } catch (_) { continue; }
        if (!data.symbol) continue;

        try {
            const trades = await exchangeOps.getUserTrades(uid, {
                symbol: data.symbol,
                startTime: oneDayAgo,
                limit: 100,
            });

            // Find matching trades by orderId
            const closeOrderId = data.closeOrderId || data.exitOrderId;
            if (!closeOrderId) continue;

            // Fix #14: Trade matching by orderId (canonical field from getUserTrades)
            // plus symbol + time proximity fallback. Execution IDs (t.id) are NOT
            // order IDs — comparing them directly causes false mismatches.
            const matchingTrade = trades.find(t =>
                t.orderId === closeOrderId ||
                (t.symbol === data.symbol && data.closeTs && Math.abs(t.ts - data.closeTs) < 60000)
            );

            if (!matchingTrade && trades.length > 0) {
                mismatches++;
                try {
                    db.prepare(
                        `INSERT INTO audit_log (user_id, action, details) VALUES (?, 'PNL_RECON_MISMATCH', ?)`
                    ).run(uid, JSON.stringify({
                        seq: row.seq, symbol: data.symbol,
                        closeOrderId, dbPnl: data.pnl,
                        tradesFound: trades.length,
                    }));
                } catch (_) {}
            }
        } catch (_) { /* exchange query failure — skip this symbol */ }
    }

    return { uid, checked: closed.length, mismatches };
}

async function runDaily() {
    const users = db.prepare(
        `SELECT DISTINCT user_id FROM exchange_accounts WHERE is_active = 1`
    ).all();

    const results = [];
    for (const { user_id: uid } of users) {
        try {
            results.push(await reconcileUser(uid));
        } catch (_) {}
    }

    try {
        db.prepare(
            `INSERT INTO audit_log (user_id, action, details) VALUES (NULL, 'PNL_RECON_DAILY_COMPLETE', ?)`
        ).run(JSON.stringify({ usersChecked: results.length, results }));
    } catch (_) {}

    return results;
}

let _cronTimer = null;

function schedule() {
    if (_cronTimer) return;
    const msToNextRun = _msUntilNextHour(RECON_HOUR_UTC, RECON_MIN_UTC);
    _cronTimer = setTimeout(() => {
        runDaily().catch(() => {});
        // Re-schedule for next day
        _cronTimer = null;
        schedule();
    }, msToNextRun);
}

function stop() {
    if (_cronTimer) { clearTimeout(_cronTimer); _cronTimer = null; }
}

function _msUntilNextHour(hourUtc, minUtc = 0, now = new Date()) {
    const next = new Date(now);
    next.setUTCHours(hourUtc, minUtc, 0, 0);
    if (next <= now) next.setUTCDate(next.getUTCDate() + 1);
    return next.getTime() - now.getTime();
}

module.exports = { runDaily, reconcileUser, schedule, stop, _msUntilNextHour, RECON_HOUR_UTC, RECON_MIN_UTC };
