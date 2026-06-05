'use strict';

/**
 * emergencyCloseProcessor — periodic drain of emergency_close_queue.
 *
 * [ORPHAN ROOT FIX 2026-06-05] The queue existed ("manual resolve" semantics)
 * but NOTHING drained it automatically: the 06:31 incident left 2 unprotected
 * orphans sitting 3.5h, and the 15:01 ETH close-failure ("queued for
 * reconciliation" — a log lie, nothing was queued) bled 6h. serverAT now
 * REALLY enqueues failed closes here (_enqueueEmergencyClose), and this
 * processor retries a reduceOnly MARKET close every tick (60s) until the
 * exchange accepts — or reports -2022 (ReduceOnly rejected = position already
 * gone), which also resolves the row.
 *
 * Every attempt goes through binanceSigner (telemetry/scheduler/CB aware), so
 * during a CB-open window the attempt fails fast locally and the row simply
 * waits for the next tick — backoff is the tick cadence itself, which by
 * construction exceeds any breaker window (the flaw in the old in-line
 * retries: 100/500/2000ms backoffs all fell INSIDE the ~250s breaker window).
 */

const logger = require('./logger');

const TICK_MS = 60_000;
const MAX_ROWS_PER_TICK = 10;
let _timer = null;
let _running = false;

async function _tick() {
    if (_running) return; // re-entrancy guard (slow exchange + 60s tick)
    _running = true;
    try {
        const { db } = require('./database');
        const rows = db.prepare(
            `SELECT id, user_id, symbol, exchange, qty, decision_key FROM emergency_close_queue
             WHERE resolved_at IS NULL ORDER BY id LIMIT ${MAX_ROWS_PER_TICK}`
        ).all();
        if (!rows || rows.length === 0) return;

        const { getExchangeCredsFor, getExchangeCreds } = require('./credentialStore');
        const { sendSignedRequest } = require('./binanceSigner');

        for (const row of rows) {
            try {
                const creds = (row.exchange && getExchangeCredsFor)
                    ? (getExchangeCredsFor(row.user_id, row.exchange) || getExchangeCreds(row.user_id))
                    : getExchangeCreds(row.user_id);
                if (!creds || !creds.apiKey) {
                    logger.warn('EMERG_QUEUE', `row ${row.id} uid=${row.user_id} ${row.symbol}: no creds — skipping`);
                    continue;
                }

                // Determine actual held side/qty (exchange truth) — the position may
                // have changed (or vanished) since enqueue.
                const prs = await sendSignedRequest('GET', '/fapi/v2/positionRisk', { symbol: row.symbol, recvWindow: 5000 }, creds);
                const pr = (Array.isArray(prs) ? prs : []).find(p => p.symbol === row.symbol && Math.abs(parseFloat(p.positionAmt)) > 0);
                if (!pr) {
                    // Nothing held — already closed (manually / SL / elsewhere). Resolve.
                    db.prepare(`UPDATE emergency_close_queue SET resolved_at=?, resolved_by=? WHERE id=?`)
                        .run(Date.now(), 'processor:already_flat', row.id);
                    logger.info('EMERG_QUEUE', `row ${row.id} ${row.symbol} uid=${row.user_id}: already flat on exchange — resolved`);
                    continue;
                }

                const amt = parseFloat(pr.positionAmt);
                const closeSide = amt > 0 ? 'SELL' : 'BUY';
                // [review M1] Close the FULL held amount — exchange truth is
                // authoritative. min(held, row.qty) under-closed when the position
                // grew between enqueue and tick, resolving the row with residual
                // exposure left open and no further retry.
                const closeQty = Math.abs(amt);
                const resp = await sendSignedRequest('POST', '/fapi/v1/order', {
                    symbol: row.symbol,
                    side: closeSide,
                    type: 'MARKET',
                    quantity: String(closeQty),
                    reduceOnly: 'true',
                    newOrderRespType: 'RESULT',
                    newClientOrderId: `emergq_${row.id}_${row.decision_key}`.slice(0, 36),
                    recvWindow: 5000,
                }, creds);
                db.prepare(`UPDATE emergency_close_queue SET resolved_at=?, resolved_by=? WHERE id=?`)
                    .run(Date.now(), `processor:closed@${resp && resp.avgPrice}`, row.id);
                logger.warn('EMERG_QUEUE', `row ${row.id} ${row.symbol} uid=${row.user_id}: CLOSED ${closeSide} ${closeQty} @ ${resp && resp.avgPrice} — resolved`);
                try {
                    require('./positionEvents').append({
                        position_seq: 0, user_id: row.user_id, exchange: row.exchange || 'binance',
                        event_type: 'EMERGENCY_QUEUE_CLOSED',
                        payload: { rowId: row.id, symbol: row.symbol, side: closeSide, qty: closeQty, avgPrice: resp && resp.avgPrice },
                    });
                } catch (_) {}
                try { require('./telegram').sendToUser(row.user_id, `✅ *Emergency queue: position closed*\n${row.symbol} ${closeSide} ${closeQty}\nQueued close finally executed.`); } catch (_) {}
            } catch (err) {
                if (err && err.code === -2022) {
                    // ReduceOnly rejected — no position behind it. Resolved.
                    const { db } = require('./database');
                    db.prepare(`UPDATE emergency_close_queue SET resolved_at=?, resolved_by=? WHERE id=?`)
                        .run(Date.now(), 'processor:reduceonly_rejected_flat', row.id);
                    logger.info('EMERG_QUEUE', `row ${row.id} ${row.symbol}: -2022 (already flat) — resolved`);
                } else {
                    // Transient (CB open, rate-limit, timeout) — keep for next tick.
                    logger.warn('EMERG_QUEUE', `row ${row.id} ${row.symbol}: attempt failed (${err && err.message}) — retrying next tick`);
                }
            }
        }
    } catch (e) {
        try { logger.error('EMERG_QUEUE', `tick failed: ${e.message}`); } catch (_) {}
    } finally {
        _running = false;
    }
}

function start() {
    if (_timer) return;
    _timer = setInterval(_tick, TICK_MS);
    logger.info('EMERG_QUEUE', `Emergency close processor started — drains emergency_close_queue every ${TICK_MS / 1000}s`);
}

function stop() {
    if (_timer) { clearInterval(_timer); _timer = null; }
}

module.exports = { start, stop, _tick };
