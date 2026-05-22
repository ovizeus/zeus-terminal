'use strict';

/**
 * binanceOps — Canonical API wrap of Binance Futures order operations.
 *
 * Wraps the Fix #1-#6 entry pattern from serverAT.js _executeLiveEntryCore:
 * - Entry order via /fapi/v1/order (MARKET or LIMIT)
 * - SL placement with 3-retry backoff (200ms / 1s / 3s)
 * - Emergency close 3-retry on SL exhaustion
 * - emergency_close_queue persist on catastrophic failure
 * - PANIC halt + Telegram critical alert
 * - Position state machine transitions throughout (positionStateMachine + positionEvents)
 *
 * Tasks 26-30 add closePosition, ensureSymbolReady, getPositions, getBalance,
 * getUserTrades, ping, cancelOrder, placeStopLoss.
 */

const { db } = require('./database');
const { sendSignedRequest } = require('./binanceSigner');
const exchangeInfo = require('./exchangeInfo');
const orderLock = require('./orderLock');
const positionStateMachine = require('./positionStateMachine');
const positionEvents = require('./positionEvents');
const canonicalErrors = require('./canonicalErrors');

const LOCK_TIMEOUT_MS = 10_000;
const SL_RETRIES = 3;
const SL_BACKOFFS_MS = [200, 1000, 3000];
const EMERGENCY_RETRIES = 3;
const EMERGENCY_BACKOFFS_MS = [100, 500, 2000];

function _sideToBinance(side) {
    return side === 'LONG' ? 'BUY' : 'SELL';
}
function _oppositeSide(side) {
    return side === 'LONG' ? 'SELL' : 'BUY';
}

async function _emergencyClose(uid, params, creds, seq) {
    const closeSide = _oppositeSide(params.side);
    for (let i = 0; i < EMERGENCY_RETRIES; i++) {
        try {
            const closeResp = await sendSignedRequest('POST', '/fapi/v1/order', {
                symbol: params.symbol,
                side: closeSide,
                type: 'MARKET',
                quantity: params.qty,
                reduceOnly: 'true',
                newClientOrderId: `emerg_${params.decisionKey}_${i}`.slice(0, 36),
                recvWindow: 5000,
            }, creds);
            if (closeResp && closeResp.status === 'FILLED') {
                positionEvents.append({
                    position_seq: seq, user_id: uid, exchange: 'binance',
                    event_type: 'EMERGENCY_CLOSE_SUCCESS',
                    payload: { attempt: i + 1, orderId: closeResp.orderId },
                });
                return { ok: true, attempt: i + 1, orderId: closeResp.orderId };
            }
        } catch (err) {
            if (i === EMERGENCY_RETRIES - 1) {
                positionEvents.append({
                    position_seq: seq, user_id: uid, exchange: 'binance',
                    event_type: 'EMERGENCY_CLOSE_FAILED',
                    payload: { attempts: i + 1, error: err.message },
                });
                return { ok: false, attempts: i + 1, error: err.message };
            }
            await new Promise(r => setTimeout(r, EMERGENCY_BACKOFFS_MS[i]));
        }
    }
    return { ok: false, attempts: EMERGENCY_RETRIES };
}

async function placeEntry(uid, params, creds) {
    const lockKey = `${uid}|${params.symbol}`;
    const lockAcquired = await orderLock.acquire(lockKey, LOCK_TIMEOUT_MS);
    if (!lockAcquired) {
        return {
            ok: false,
            error: canonicalErrors.create('ErrLockTimeout', `lock held >${LOCK_TIMEOUT_MS}ms for ${lockKey}`),
        };
    }

    // Create PENDING row
    const positionData = {
        symbol: params.symbol, side: params.side, qty: params.qty,
        entryType: params.entryType, sl: params.sl && params.sl.price,
        tp: params.tp && params.tp.price, leverage: params.leverage,
        decisionKey: params.decisionKey, source: params.source, mode: creds.mode,
    };
    const insertResult = db.prepare(
        `INSERT INTO at_positions (data, status, user_id, exchange, created_at, updated_at) VALUES (?, 'PENDING', ?, 'binance', datetime('now'), datetime('now'))`
    ).run(JSON.stringify(positionData), uid);
    const seq = Number(insertResult.lastInsertRowid);
    positionEvents.append({
        position_seq: seq, user_id: uid, exchange: 'binance',
        event_type: 'CREATED', to_state: 'PENDING',
        payload: { decisionKey: params.decisionKey, source: params.source },
    });

    try {
        // Round qty per exchangeInfo filters
        const rounded = exchangeInfo.roundOrderParams(params.symbol, params.qty, params.entryPrice);
        if (!rounded || !rounded.quantity) {
            positionStateMachine.transition(seq, 'PENDING', 'CANCELLED', { reason: 'LOT_SIZE_ALIGN_REJECTED' });
            return { ok: false, error: canonicalErrors.create('ErrLotSize', 'qty cannot align to lot size'), seq };
        }

        // Entry order
        const entryBody = {
            symbol: params.symbol,
            side: _sideToBinance(params.side),
            type: params.entryType,
            quantity: rounded.quantity,
            newClientOrderId: params.decisionKey,
            recvWindow: 5000,
        };
        if (params.entryType === 'LIMIT') {
            entryBody.timeInForce = 'GTC';
            entryBody.price = rounded.price || params.entryPrice;
        }

        const entryResp = await sendSignedRequest('POST', '/fapi/v1/order', entryBody, creds);
        if (!entryResp || entryResp.code) {
            const err = canonicalErrors.translateBinance(entryResp) || canonicalErrors.create('ErrUnknown', 'entry rejected');
            positionStateMachine.transition(seq, 'PENDING', 'CANCELLED', { reason: 'ENTRY_REJECTED', err });
            return { ok: false, error: err, seq };
        }

        positionStateMachine.transition(seq, 'PENDING', 'OPENING', {
            entryOrderId: entryResp.orderId,
            fillPrice: entryResp.avgPrice,
        });

        // SL placement with retry
        let slOrderId = null;
        if (params.sl && params.sl.price) {
            let lastErr = null;
            for (let i = 0; i < SL_RETRIES; i++) {
                try {
                    const slResp = await sendSignedRequest('POST', '/fapi/v1/order', {
                        symbol: params.symbol,
                        side: _oppositeSide(params.side),
                        type: 'STOP_MARKET',
                        stopPrice: params.sl.price,
                        closePosition: 'true',
                        newClientOrderId: `sl_${params.decisionKey}_${i}`.slice(0, 36),
                        recvWindow: 5000,
                    }, creds);
                    if (slResp && slResp.orderId) {
                        slOrderId = slResp.orderId;
                        positionEvents.append({
                            position_seq: seq, user_id: uid, exchange: 'binance',
                            event_type: 'SL_PLACED',
                            payload: { slOrderId, attempt: i + 1 },
                        });
                        break;
                    }
                    lastErr = `unexpected response: ${JSON.stringify(slResp)}`;
                } catch (err) {
                    lastErr = err.message;
                }
                if (i < SL_RETRIES - 1) {
                    await new Promise(r => setTimeout(r, SL_BACKOFFS_MS[i]));
                }
            }

            if (!slOrderId) {
                positionEvents.append({
                    position_seq: seq, user_id: uid, exchange: 'binance',
                    event_type: 'SL_RETRY_EXHAUSTED',
                    payload: { error: lastErr },
                });

                // Emergency close
                const closeResult = await _emergencyClose(uid, params, creds, seq);
                positionStateMachine.transition(seq, 'OPENING', 'EMERGENCY', {
                    reason: 'SL_PLACEMENT_FAILED',
                    closeResult,
                });

                if (!closeResult.ok) {
                    // CATASTROPHIC — persist to queue + PANIC halt + Telegram
                    try {
                        db.prepare(
                            `INSERT INTO emergency_close_queue (user_id, symbol, exchange, qty, decision_key, created_at) VALUES (?, ?, 'binance', ?, ?, ?)`
                        ).run(uid, params.symbol, params.qty, params.decisionKey, Date.now());
                    } catch (_) {}
                    try { require('./serverAT').setGlobalHalt(uid, true, 'EMERGENCY_CLOSE_CATASTROPHIC'); } catch (_) {}
                    try { require('./telegram').alertCritical(uid, `CATASTROPHIC: ${params.symbol} position cannot close on Binance. Manual intervention NOW.`); } catch (_) {}

                    return {
                        ok: false,
                        error: canonicalErrors.create('ErrSlPlacementFailed', 'SL retry exhausted, emergency close FAILED — manual intervention required'),
                        catastrophic: true,
                        seq,
                    };
                }

                return {
                    ok: false,
                    error: canonicalErrors.create('ErrSlPlacementFailed', 'SL retry exhausted, emergency close succeeded'),
                    seq,
                };
            }
        }

        // TP placement (optional, NO retry)
        let tpOrderId = null;
        if (params.tp && params.tp.price) {
            try {
                const tpResp = await sendSignedRequest('POST', '/fapi/v1/order', {
                    symbol: params.symbol,
                    side: _oppositeSide(params.side),
                    type: 'TAKE_PROFIT_MARKET',
                    stopPrice: params.tp.price,
                    closePosition: 'true',
                    newClientOrderId: `tp_${params.decisionKey}`.slice(0, 36),
                    recvWindow: 5000,
                }, creds);
                if (tpResp && tpResp.orderId) {
                    tpOrderId = tpResp.orderId;
                    positionEvents.append({
                        position_seq: seq, user_id: uid, exchange: 'binance',
                        event_type: 'TP_PLACED',
                        payload: { tpOrderId },
                    });
                }
            } catch (_) {
                // TP failure is warning, not blocking
            }
        }

        // Update position data with order IDs
        const updatedData = {
            ...positionData,
            entryOrderId: entryResp.orderId,
            slOrderId,
            tpOrderId,
            avgFillPrice: entryResp.avgPrice,
        };
        db.prepare(`UPDATE at_positions SET data = ? WHERE seq = ?`).run(JSON.stringify(updatedData), seq);
        positionStateMachine.transition(seq, 'OPENING', 'OPEN', { slOrderId, tpOrderId });

        return {
            ok: true,
            orderId: entryResp.orderId,
            clientOrderId: params.decisionKey,
            status: entryResp.status || 'FILLED',
            filledQty: entryResp.executedQty || rounded.quantity,
            avgFillPrice: entryResp.avgPrice,
            slOrderId,
            tpOrderId,
            ts: Date.now(),
            rawExchange: 'binance',
            seq,
        };

    } finally {
        orderLock.release(lockKey);
    }
}

function _notImpl(name) {
    return async () => { throw new Error(`binanceOps.${name} not yet implemented`); };
}

module.exports = {
    placeEntry,
    _emergencyClose,
    closePosition:     _notImpl('closePosition'),
    ensureSymbolReady: _notImpl('ensureSymbolReady'),
    getPositions:      _notImpl('getPositions'),
    getBalance:        _notImpl('getBalance'),
    getUserTrades:     _notImpl('getUserTrades'),
    ping:              _notImpl('ping'),
    cancelOrder:       _notImpl('cancelOrder'),
    placeStopLoss:     _notImpl('placeStopLoss'),
};
