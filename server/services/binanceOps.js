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

// [BUG#3/#4 2026-05-29] Binance (Dec 2025) moved STOP_MARKET / TAKE_PROFIT_MARKET off
// /fapi/v1/order → it rejects them there ("use the Algo Order API endpoints instead").
// All conditional SL/TP placement routes through here, mirroring the proven
// serverAT._placeConditionalOrder + trading.js path (stopPrice→triggerPrice,
// newClientOrderId→clientAlgoId, algoId→orderId). Prefer quantity+reduceOnly (proven);
// fall back to closePosition when no quantity is known.
async function _placeConditionalAlgo({ symbol, side, type, triggerPrice, quantity, clientAlgoId }, creds) {
    const body = {
        algoType: 'CONDITIONAL',
        symbol,
        side,
        type,
        triggerPrice: String(triggerPrice),
        // [BUG A 2026-06-05] No workingType → CONTRACT_PRICE (last price)
        // default. Thin testnet books print wild wicks — both 2026-06-04
        // SP2-a positions were stopped out by their own SLs in <11s (BNB
        // filled 611.07 while mark ~596). MARK_PRICE is the standard
        // anti-wick trigger for protection orders, correct on REAL too.
        workingType: 'MARK_PRICE',
        clientAlgoId: String(clientAlgoId).slice(0, 36),
        recvWindow: 5000,
    };
    if (quantity != null) {
        body.quantity = String(quantity);
        body.reduceOnly = 'true';
    } else {
        body.closePosition = 'true';
    }
    const resp = await sendSignedRequest('POST', '/fapi/v1/algoOrder', body, creds);
    if (resp && resp.algoId != null && resp.orderId == null) resp.orderId = resp.algoId;
    return resp;
}

// [FILL-RESULT 2026-06-04] POST /fapi/v1/order defaults to newOrderRespType=ACK:
// Binance acks instantly with status=NEW, avgPrice="0.00", executedQty="0" WITHOUT
// waiting for the matching engine. Every SP2-a entry hit serverAT's ZT-AUD-002 gate
// (avgFillPrice 0/0) and was force-closed despite having actually filled (proof:
// the reduceOnly force-close succeeded — Binance rejects reduceOnly with no
// position, -2022). RESULT makes MARKET orders return the final FILLED response
// with real avgPrice/executedQty. Applied to ALL order POSTs: entry, close,
// row-missing fallback close, and emergency close (whose status==='FILLED' check
// was dead under ACK — a filled emergency close read as failure).
const FILL_QUERY_RETRIES = 3;
const FILL_QUERY_BACKOFFS_MS = [250, 750, 2000];

function _isConfirmedFill(r) {
    const px = parseFloat(r && r.avgPrice);
    const q = parseFloat(r && r.executedQty);
    return Number.isFinite(px) && px > 0 && Number.isFinite(q) && q > 0;
}

// Defense-in-depth: if the entry response is still ACK-shaped (avgPrice 0 —
// e.g. proxy strips the param, or rare engine lag), query the order before
// giving up. Returns the confirmed order object, or the original response
// unchanged so serverAT's FILL_UNVERIFIED gate fires (fail-closed preserved).
async function _confirmEntryFill(entryResp, symbol, creds) {
    if (_isConfirmedFill(entryResp)) return entryResp;
    for (let i = 0; i < FILL_QUERY_RETRIES; i++) {
        await new Promise(r => setTimeout(r, FILL_QUERY_BACKOFFS_MS[i]));
        try {
            const q = await sendSignedRequest('GET', '/fapi/v1/order', {
                symbol, orderId: entryResp.orderId, recvWindow: 5000,
            }, creds);
            if (_isConfirmedFill(q)) return q;
        } catch (_) { /* transient — keep polling */ }
    }
    return entryResp; // unverified — serverAT FILL_UNVERIFIED handles it
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
                newOrderRespType: 'RESULT',
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

// [PHANTOM-SHORT FIX 2026-06-08 — part a] Pure builder for the transitional
// dual-write PENDING row. mode = the ENGINE mode passed by the caller
// (params.mode, e.g. 'live') — NOT creds.mode ('testnet'/'real'), which would
// mistag a live-engine position and exclude it from recon / confuse the
// directional guard. creds.mode remains a backward-compat fallback.
function _buildPendingPositionData(params, creds) {
    return {
        symbol: params.symbol, side: params.side, qty: params.qty,
        entryType: params.entryType, sl: params.sl && params.sl.price,
        tp: params.tp && params.tp.price, leverage: params.leverage,
        decisionKey: params.decisionKey, source: params.source,
        mode: params.mode || (creds && creds.mode),
    };
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
    const positionData = _buildPendingPositionData(params, creds);
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
            // [FILL-RESULT] final fill data, not ACK. NOTE: callers pass MARKET only
            // (serverAT hard-codes it). For plain GTC LIMIT, RESULT returns NEW
            // immediately (no fill data) — the _confirmEntryFill fallback would poll
            // ~3s then serverAT's FILL_UNVERIFIED gate would force-close the resting
            // order. If LIMIT entries are ever added, rework fill confirmation first.
            newOrderRespType: 'RESULT',
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
                    const slResp = await _placeConditionalAlgo({
                        symbol: params.symbol,
                        side: _oppositeSide(params.side),
                        type: 'STOP_MARKET',
                        triggerPrice: params.sl.price,
                        quantity: params.qty,
                        clientAlgoId: `sl_${params.decisionKey}_${i}`,
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
                    try { require('./serverAT').setGlobalHalt(true, uid, 'EMERGENCY_CLOSE_CATASTROPHIC'); } catch (_) {}
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
                const tpResp = await _placeConditionalAlgo({
                    symbol: params.symbol,
                    side: _oppositeSide(params.side),
                    type: 'TAKE_PROFIT_MARKET',
                    triggerPrice: params.tp.price,
                    quantity: params.qty,
                    clientAlgoId: `tp_${params.decisionKey}`,
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

        // [FILL-RESULT] Confirm fill data. RESULT carries it directly for MARKET;
        // if the response is still ACK-shaped (avgPrice 0), poll GET /fapi/v1/order.
        // Runs AFTER SL/TP placement so protection lands first (and grants the
        // matching engine settle time for free).
        const fillResp = await _confirmEntryFill(entryResp, params.symbol, creds);

        // Update position data with order IDs
        const updatedData = {
            ...positionData,
            entryOrderId: entryResp.orderId,
            slOrderId,
            tpOrderId,
            avgFillPrice: fillResp.avgPrice,
        };
        db.prepare(`UPDATE at_positions SET data = ? WHERE seq = ?`).run(JSON.stringify(updatedData), seq);
        positionStateMachine.transition(seq, 'OPENING', 'OPEN', { slOrderId, tpOrderId });

        return {
            ok: true,
            orderId: entryResp.orderId,
            clientOrderId: params.decisionKey,
            status: fillResp.status || 'FILLED',
            filledQty: fillResp.executedQty || rounded.quantity,
            avgFillPrice: fillResp.avgPrice,
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

/**
 * closePosition — Cancel SL/TP protection orders then send reduce-only close.
 *
 * Flow:
 * 1. orderLock acquire (10s) — ErrLockTimeout on hold
 * 2. Read at_positions row by seq → throw ErrNotFound if missing
 * 3. Race check: if status='CLOSED' already → return ok+closedBySL (no double close)
 * 4. State OPEN→CLOSING atomic
 * 5. Cancel SL orderId + TP orderId in parallel (warn-only on fail)
 * 6. POST reduce-only close order (MARKET or LIMIT GTC)
 * 7. Close rejected → direct DB revert CLOSING→OPEN + positionEvents + return ok:false
 * 8. Close FILLED → state CLOSING→CLOSED + move at_positions→at_closed + positionEvents
 * 9. Return canonical CloseResult
 */
// [P2 close-desync fix] Row-independent close used when the at_positions row was already
// archived (optimistic _persistClose race) but the position may still be OPEN on the exchange.
// Cancels caller-provided protective orders (best-effort) then sends a reduce-only MARKET close.
// reduceOnly guarantees we can only close/shrink, never open exposure. Never throws on missing row.
async function _closeWithoutLocalRow(uid, params, creds) {
    const cancelTasks = [];
    if (params.slOrderId) {
        cancelTasks.push(cancelOrder(uid, { symbol: params.symbol, orderId: params.slOrderId }, creds).catch(() => {}));
    }
    if (params.tpOrderId) {
        cancelTasks.push(cancelOrder(uid, { symbol: params.symbol, orderId: params.tpOrderId }, creds).catch(() => {}));
    }
    if (cancelTasks.length > 0) await Promise.all(cancelTasks);

    const closeBody = {
        symbol: params.symbol,
        side: _oppositeSide(params.side),
        type: params.closeType || 'MARKET',
        quantity: params.qty,
        reduceOnly: 'true',
        newOrderRespType: 'RESULT', // [FILL-RESULT] real close fill price, not ACK zeros
        newClientOrderId: `close_${params.decisionKey}`.slice(0, 36),
        recvWindow: 5000,
    };
    if ((params.closeType || 'MARKET') === 'LIMIT') {
        closeBody.timeInForce = 'GTC';
        closeBody.price = params.closePrice;
    }
    const closeResp = await sendSignedRequest('POST', '/fapi/v1/order', closeBody, creds);
    if (!closeResp || closeResp.code) {
        const err = canonicalErrors.translateBinance(closeResp) || canonicalErrors.create('ErrUnknown', 'close rejected (no local row)');
        try {
            positionEvents.append({
                position_seq: params.seq, user_id: uid, exchange: 'binance',
                event_type: 'CLOSE_ROW_MISSING_REJECTED',
                payload: { source: params.source, reason: 'reduce-only rejected — position likely already closed', err: { code: err.code, message: err.message } },
            });
        } catch (_) {}
        return { ok: false, error: err, seq: params.seq, rowMissingFallback: true };
    }
    try {
        positionEvents.append({
            position_seq: params.seq, user_id: uid, exchange: 'binance',
            event_type: 'CLOSED_ROW_MISSING_FALLBACK',
            payload: { source: params.source, orderId: closeResp.orderId, reason: 'local row archived before exchange close (race) — closed via reduce-only fallback' },
        });
    } catch (_) {}
    return { ok: true, orderId: closeResp.orderId, rawExchange: 'binance', seq: params.seq, ts: Date.now(), rowMissingFallback: true };
}

async function closePosition(uid, params, creds) {
    const lockKey = `${uid}|${params.symbol}`;
    const lockAcquired = await orderLock.acquire(lockKey, LOCK_TIMEOUT_MS);
    if (!lockAcquired) {
        return {
            ok: false,
            error: canonicalErrors.create('ErrLockTimeout', `lock held >${LOCK_TIMEOUT_MS}ms for ${lockKey}`),
        };
    }

    try {
        // Read position row
        const row = db.prepare('SELECT seq, data, status, user_id, exchange FROM at_positions WHERE seq=? AND user_id=?').get(params.seq, uid);
        if (!row) {
            // [P2 close-desync fix 2026-05-30] Row optimistically archived by serverAT
            // _closePosition's synchronous _persistClose while this fire-and-forget exchange
            // close was still pending (race). Fall back to a row-independent reduce-only close
            // so the still-open exchange position is never orphaned. NO throw.
            return await _closeWithoutLocalRow(uid, params, creds);
        }

        // Race check: SL may have already closed it
        if (row.status === 'CLOSED') {
            positionEvents.append({
                position_seq: params.seq, user_id: uid, exchange: 'binance',
                event_type: 'CLOSE_RACE_DETECTED',
                payload: { source: params.source, reason: 'position already CLOSED (SL race)' },
            });
            return {
                ok: true,
                closedBySL: true,
                rawExchange: 'binance',
                seq: params.seq,
                ts: Date.now(),
            };
        }

        // Parse position data
        let positionData;
        try { positionData = JSON.parse(row.data); } catch (_) { positionData = {}; }

        // State OPEN→CLOSING (Fix #4: handle CLOSING retry — if state is already
        // CLOSING from a prior failed attempt, skip transition and proceed with close)
        const currentState = row.status;
        if (currentState === 'OPEN') {
            positionStateMachine.transition(params.seq, 'OPEN', 'CLOSING', {
                decisionKey: params.decisionKey,
                source: params.source,
            });
        } else if (currentState !== 'CLOSING') {
            throw canonicalErrors.create('ErrNotFound', `unexpected state ${currentState} for close`);
        }

        // Cancel SL + TP (parallel, non-blocking on failure)
        // [ORPHAN-FIX] Route through cancelOrder which handles algo+regular endpoints
        const cancelTasks = [];
        if (positionData.slOrderId) {
            cancelTasks.push(
                cancelOrder(uid, { symbol: params.symbol, orderId: positionData.slOrderId }, creds).catch(err => {
                    try { require('./logger').warn('BINANCE_OPS', `SL cancel failed seq=${params.seq}: ${err.message}`); } catch (_) {}
                })
            );
        }
        if (positionData.tpOrderId) {
            cancelTasks.push(
                cancelOrder(uid, { symbol: params.symbol, orderId: positionData.tpOrderId }, creds).catch(err => {
                    try { require('./logger').warn('BINANCE_OPS', `TP cancel failed seq=${params.seq}: ${err.message}`); } catch (_) {}
                })
            );
        }
        if (cancelTasks.length > 0) {
            await Promise.all(cancelTasks);
            positionEvents.append({
                position_seq: params.seq, user_id: uid, exchange: 'binance',
                event_type: 'PROTECTION_CANCELLED',
                payload: { slOrderId: positionData.slOrderId, tpOrderId: positionData.tpOrderId },
            });
        }

        // Place reduce-only close order
        const closeBody = {
            symbol: params.symbol,
            side: _oppositeSide(params.side),
            type: params.closeType || 'MARKET',
            quantity: params.qty,
            reduceOnly: 'true',
            newOrderRespType: 'RESULT', // [FILL-RESULT] real close fill price, not ACK zeros
            newClientOrderId: `close_${params.decisionKey}`.slice(0, 36),
            recvWindow: 5000,
        };
        if ((params.closeType || 'MARKET') === 'LIMIT') {
            closeBody.timeInForce = 'GTC';
            closeBody.price = params.closePrice;
        }

        const closeResp = await sendSignedRequest('POST', '/fapi/v1/order', closeBody, creds);
        if (!closeResp || closeResp.code) {
            const err = canonicalErrors.translateBinance(closeResp) || canonicalErrors.create('ErrUnknown', 'close rejected');
            // REVERT state CLOSING → OPEN (not a valid state machine edge, use direct DB update)
            db.prepare(`UPDATE at_positions SET status='OPEN', updated_at=datetime('now') WHERE seq=?`).run(params.seq);
            positionEvents.append({
                position_seq: params.seq, user_id: uid, exchange: 'binance',
                event_type: 'CLOSE_REJECTED_REVERT',
                from_state: 'CLOSING', to_state: 'OPEN',
                payload: { reason: 'CLOSE_REJECTED', err: { code: err.code, message: err.message } },
            });
            return { ok: false, error: err, seq: params.seq };
        }

        // CLOSING → CLOSED (valid state machine edge)
        positionStateMachine.transition(params.seq, 'CLOSING', 'CLOSED', {
            closeOrderId: closeResp.orderId,
            closePrice: closeResp.avgPrice,
            source: params.source,
        });

        // Move from at_positions → at_closed (preserves seq)
        try {
            const closedData = { ...positionData, closeOrderId: closeResp.orderId, closePrice: closeResp.avgPrice, source: params.source };
            db.prepare(
                `INSERT INTO at_closed (seq, data, closed_at, user_id, exchange) VALUES (?, ?, datetime('now'), ?, 'binance')`
            ).run(params.seq, JSON.stringify(closedData), uid);
            db.prepare(`DELETE FROM at_positions WHERE seq=?`).run(params.seq);
        } catch (moveErr) {
            // at_closed move non-fatal — position state already CLOSED
            try { require('./logger').warn('BINANCE_OPS', `at_closed move failed seq=${params.seq}: ${moveErr.message}`); } catch (_) {}
        }

        positionEvents.append({
            position_seq: params.seq, user_id: uid, exchange: 'binance',
            event_type: 'CLOSED',
            payload: { closeOrderId: closeResp.orderId, closePrice: closeResp.avgPrice, source: params.source },
        });

        return {
            ok: true,
            orderId: closeResp.orderId,
            clientOrderId: params.decisionKey,
            status: closeResp.status || 'FILLED',
            filledQty: closeResp.executedQty || params.qty,
            avgFillPrice: closeResp.avgPrice,
            ts: Date.now(),
            rawExchange: 'binance',
            seq: params.seq,
        };

    } finally {
        orderLock.release(lockKey);
    }
}

async function ensureSymbolReady(uid, params, creds) {
    // Set leverage
    const levResp = await sendSignedRequest('POST', '/fapi/v1/leverage', {
        symbol: params.symbol, leverage: params.leverage, recvWindow: 5000,
    }, creds);
    if (levResp && levResp.code && levResp.code < 0) {
        return { ok: false, error: canonicalErrors.translateBinance(levResp), rawExchange: 'binance' };
    }

    // Set margin mode. -4046 ("No need to change margin type") is an idempotent
    // success: the symbol is ALREADY on the requested margin type. Note
    // sendSignedRequest THROWS on Binance error codes (binanceSigner.js:294,
    // err.code preserved), so the redundant returned-`.code` check below is dead
    // on the throw path — we must tolerate -4046 in the catch. Any other error
    // still blocks the entry (wrong margin type = wrong risk math).
    const marginMode = params.marginMode || 'CROSSED';
    try {
        const marginResp = await sendSignedRequest('POST', '/fapi/v1/marginType', {
            symbol: params.symbol, marginType: marginMode, recvWindow: 5000,
        }, creds);
        if (marginResp && marginResp.code && marginResp.code < 0 && marginResp.code !== -4046) {
            return { ok: false, error: canonicalErrors.translateBinance(marginResp), rawExchange: 'binance' };
        }
    } catch (marginErr) {
        if (!marginErr || marginErr.code !== -4046) {
            return {
                ok: false,
                error: canonicalErrors.translateBinance({ code: marginErr && marginErr.code, msg: marginErr && marginErr.message }),
                rawExchange: 'binance',
            };
        }
        // -4046 → already on the requested margin type → idempotent no-op, proceed.
    }

    return {
        ok: true,
        leverage: params.leverage,
        marginMode,
        rawExchange: 'binance',
    };
}

async function getPositions(uid, params, creds) {
    const resp = await sendSignedRequest('GET', '/fapi/v2/positionRisk', { recvWindow: 5000 }, creds);
    if (!Array.isArray(resp)) return [];

    return resp
        .filter(p => Math.abs(Number(p.positionAmt)) > 0)
        .filter(p => !params || !params.symbol || p.symbol === params.symbol)
        .map(p => {
            const amt = Number(p.positionAmt);
            return {
                symbol: p.symbol,
                side: amt > 0 ? 'LONG' : 'SHORT',
                qty: String(Math.abs(amt)),
                entryPrice: p.entryPrice,
                markPrice: p.markPrice,
                unrealizedPnl: p.unRealizedProfit,
                leverage: p.leverage,
                marginMode: (p.marginType || '').toUpperCase(),
                rawExchange: 'binance',
            };
        });
}

async function getBalance(uid, creds) {
    const resp = await sendSignedRequest('GET', '/fapi/v2/balance', { recvWindow: 5000 }, creds);
    if (!Array.isArray(resp)) {
        return { asset: 'USDT', walletBalance: '0', availableBalance: '0', totalUnrealizedPnL: '0', rawExchange: 'binance' };
    }
    const usdt = resp.find(r => r.asset === 'USDT');
    if (!usdt) {
        return { asset: 'USDT', walletBalance: '0', availableBalance: '0', totalUnrealizedPnL: '0', rawExchange: 'binance' };
    }
    return {
        asset: 'USDT',
        walletBalance: usdt.balance || '0',
        availableBalance: usdt.availableBalance || '0',
        totalUnrealizedPnL: usdt.crossUnPnl || '0',
        rawExchange: 'binance',
    };
}

async function getUserTrades(uid, params, creds) {
    const query = { symbol: params.symbol, limit: params.limit || 100, recvWindow: 5000 };
    if (params.startTime) query.startTime = params.startTime;
    if (params.endTime) query.endTime = params.endTime;
    const resp = await sendSignedRequest('GET', '/fapi/v1/userTrades', query, creds);
    if (!Array.isArray(resp)) return [];
    return resp.map(t => ({
        id: String(t.id),
        orderId: String(t.orderId || ''),  // Fix #14: include orderId for pnlReconCron matching
        symbol: t.symbol,
        side: t.buyer ? 'BUY' : 'SELL',
        price: t.price,
        qty: t.qty,
        fee: t.commission,
        feeAsset: t.commissionAsset,
        ts: t.time,
        realizedPnl: t.realizedPnl,
        rawExchange: 'binance',
    }));
}

async function ping(uid, creds) {
    const t0 = Date.now();
    try {
        await sendSignedRequest('GET', '/fapi/v1/ping', {}, creds);
        return { ok: true, latencyMs: Date.now() - t0, rawExchange: 'binance' };
    } catch (err) {
        return { ok: false, latencyMs: Date.now() - t0, error: err.message, rawExchange: 'binance' };
    }
}

async function cancelOrder(uid, params, creds) {
    const symbol = params.symbol;
    const orderId = params.orderId || params.origClientOrderId;

    // [ORPHAN-FIX] Try algo order cancel first (SL/TP moved to /algoOrder since Dec 2025),
    // then fall back to regular order cancel. Without this, algo SL/TP orders are left
    // on Binance after position close — consuming margin and blocking leverage changes.
    try {
        const algoResp = await sendSignedRequest('DELETE', '/fapi/v1/algoOrder', {
            symbol, algoId: orderId, recvWindow: 5000,
        }, creds);
        // [2026-06-07 B4] Real testnet success shape is {code:"200",msg:"success"}
        // — code "200" is truthy, so the old `!algoResp.code` check misread a
        // SUCCESSFUL cancel as failure and fell through to DELETE /fapi/v1/order
        // → -2013 → reported ok:false for a cancel that actually worked.
        if (algoResp && (!algoResp.code || String(algoResp.code) === '200')) {
            return { ok: true, orderId, status: 'CANCELLED', ts: Date.now(), rawExchange: 'binance' };
        }
    } catch (_) {}

    const query = { symbol, recvWindow: 5000 };
    if (params.orderId) query.orderId = params.orderId;
    else if (params.origClientOrderId) query.origClientOrderId = params.origClientOrderId;

    const resp = await sendSignedRequest('DELETE', '/fapi/v1/order', query, creds);
    if (!resp || resp.code) {
        return { ok: false, error: canonicalErrors.translateBinance(resp), rawExchange: 'binance' };
    }
    return {
        ok: true,
        orderId: resp.orderId || orderId,
        status: resp.status || 'CANCELLED',
        ts: Date.now(),
        rawExchange: 'binance',
    };
}

// [Task M 2026-05-28] List open orders for orphan sweep (boot recovery).
// Queries both regular orders + algo orders (SL/TP moved to /algoOrder
// since Binance Dec 2025) and merges results. Optional symbol filter.
//
// [Task M.1 2026-05-28] Per-path catch now audits with err.message so
// soak operators see WHY a path is silent (testnet 404 vs transient 500
// vs auth failure). Silent swallow during 7d soak would be invisible.
async function getOpenOrders(uid, params, creds) {
    const symbol = params && params.symbol;
    const query = symbol ? { symbol, recvWindow: 5000 } : { recvWindow: 5000 };

    const out = [];

    // 1. Regular orders (entries, manual limits)
    try {
        const resp = await sendSignedRequest('GET', '/fapi/v1/openOrders', query, creds);
        if (Array.isArray(resp)) {
            for (const o of resp) {
                out.push({
                    orderId: String(o.orderId),
                    clientOrderId: o.clientOrderId || '',
                    symbol: o.symbol,
                    side: o.side,
                    type: o.type,
                    price: Number(o.price),
                    origQty: Number(o.origQty),
                    status: o.status,
                    source: 'regular',
                });
            }
        }
    } catch (err) {
        // [Task M.1] Surface regular path failure to audit so operator sees it
        // on soak. err.message preserved so 404 (endpoint absent) is distinct
        // from 5xx (transient outage) at triage time.
        try {
            const audit = require('./audit');
            audit.record('ORDER_SWEEPER_REGULAR_FAILED', {
                userId: uid,
                error: err && err.message ? err.message : String(err),
            }, 'ORDER_SWEEPER');
        } catch (_) {}
    }

    // 2. Algo orders (SL/TP since Dec 2025)
    // [2026-06-07 B3] The listing path is /fapi/v1/openAlgoOrders —
    // /fapi/v1/algoOrders rejects GET with -5000 ("Method GET is invalid"),
    // audited live as ORDER_SWEEPER_ALGO_UNAVAILABLE every sweep since F2
    // shipped. Field names per the REAL captured response: clientAlgoId /
    // orderType / triggerPrice / quantity / algoStatus. The old mapping left
    // clientOrderId:'' so orderSweeper's ZEUS_PREFIX_REGEX never matched and
    // stale resl_ orphans were invisible AND preserved — one blocked every
    // BNB entry with -4047 for 9+ hours (and would have opened an unmanaged
    // $5.2K LONG at trigger). Tests: tests/unit/algo-open-orders.test.js
    try {
        const respAlgo = await sendSignedRequest('GET', '/fapi/v1/openAlgoOrders', query, creds);
        if (Array.isArray(respAlgo)) {
            for (const o of respAlgo) {
                out.push({
                    orderId: String(o.algoId || o.orderId),
                    clientOrderId: o.clientAlgoId || o.clientOrderId || o.algoClientOrderId || '',
                    symbol: o.symbol,
                    side: o.side,
                    type: o.orderType || o.algoType || o.type,
                    price: Number(o.triggerPrice || o.stopPrice || o.price),
                    origQty: Number(o.quantity || o.origQty || 0),
                    status: o.algoStatus || o.status,
                    source: 'algo',
                });
            }
        }
    } catch (err) {
        // [Task M.1] Algo endpoint may legitimately not exist on testnet,
        // OR may be a real outage. Audit either way — operator interprets.
        try {
            const audit = require('./audit');
            audit.record('ORDER_SWEEPER_ALGO_UNAVAILABLE', {
                userId: uid,
                error: err && err.message ? err.message : String(err),
            }, 'ORDER_SWEEPER');
        } catch (_) {}
    }

    return out;
}

async function placeStopLoss(uid, params, creds) {
    // [BUG#3 2026-05-29] Binance (Dec 2025) moved STOP_MARKET off /fapi/v1/order →
    // it now rejects it with "use the Algo Order API endpoints instead". Route SL
    // through /fapi/v1/algoOrder (CONDITIONAL), mirroring the proven entry-SL helper
    // serverAT._placeConditionalOrder + trading.js (stopPrice→triggerPrice,
    // newClientOrderId→clientAlgoId, algoId→orderId). Prefer the proven
    // quantity+reduceOnly form; fall back to closePosition when no quantity is given.
    const resp = await _placeConditionalAlgo({
        symbol: params.symbol,
        side: _oppositeSide(params.side),
        type: 'STOP_MARKET',
        triggerPrice: params.stopPrice,
        quantity: params.quantity,   // proven quantity+reduceOnly; closePosition fallback in helper
        clientAlgoId: `resl_${params.decisionKey}`,
    }, creds);
    if (!resp || resp.code) {
        return { ok: false, error: canonicalErrors.translateBinance(resp), rawExchange: 'binance' };
    }
    return {
        ok: true,
        slOrderId: resp.algoId != null ? resp.algoId : resp.orderId,
        status: resp.status || resp.algoStatus,
        ts: Date.now(),
        rawExchange: 'binance',
    };
}

// [Phase M] Leverage set (manual /order/place pre-step + dedicated endpoint).
async function setLeverage(uid, params, creds) {
    try {
        const resp = await sendSignedRequest('POST', '/fapi/v1/leverage', { symbol: params.symbol, leverage: params.leverage, recvWindow: 5000 }, creds);
        return { ok: true, leverage: resp && resp.leverage != null ? Number(resp.leverage) : params.leverage, rawExchange: 'binance' };
    } catch (err) {
        return { ok: false, error: err.message, rawExchange: 'binance' };
    }
}

// [Phase M] Manual-trading parity. ── Generic order (open MARKET/LIMIT, reduce-only
// close). NOT placeEntry (which owns the AT entry+SL/TP+DB-row lifecycle).
async function placeOrder(uid, params, creds) {
    const body = { symbol: params.symbol, side: params.side, type: params.type, quantity: String(params.quantity), recvWindow: 5000 };
    if (params.type === 'LIMIT') { body.price = String(params.price); body.timeInForce = 'GTC'; }
    if (params.reduceOnly) body.reduceOnly = 'true';
    if (params.closePosition) body.closePosition = 'true';
    if (params.clientOrderId) body.newClientOrderId = String(params.clientOrderId);
    try {
        const resp = await sendSignedRequest('POST', '/fapi/v1/order', body, creds);
        return { ok: true, orderId: String(resp.orderId), status: resp.status, ts: Date.now(), rawExchange: 'binance' };
    } catch (err) {
        return { ok: false, error: err.message, rawExchange: 'binance' };
    }
}

// ── Take-profit conditional via the algo endpoint (TAKE_PROFIT_MARKET).
// LONG TP closes with a SELL, SHORT TP with a BUY.
async function placeTakeProfit(uid, params, creds) {
    try {
        const resp = await _placeConditionalAlgo({
            symbol: params.symbol,
            side: params.side === 'LONG' ? 'SELL' : 'BUY',
            type: 'TAKE_PROFIT_MARKET',
            triggerPrice: params.triggerPrice,
            quantity: params.quantity,
            clientAlgoId: params.clientOrderId || `tp_${Date.now()}`,
        }, creds);
        return { ok: true, tpOrderId: String(resp.algoId != null ? resp.algoId : resp.orderId), status: resp.algoStatus || resp.status, ts: Date.now(), rawExchange: 'binance' };
    } catch (err) {
        return { ok: false, error: err.message, rawExchange: 'binance' };
    }
}

// ── Single-order fill query (manual fill-patch).
async function getOrder(uid, params, creds) {
    try {
        const resp = await sendSignedRequest('GET', '/fapi/v1/order', { symbol: params.symbol, orderId: params.orderId, recvWindow: 5000 }, creds);
        return { orderId: String(resp.orderId), status: resp.status, avgPrice: resp.avgPrice, executedQty: resp.executedQty, rawExchange: 'binance' };
    } catch (_) {
        return null;
    }
}

module.exports = {
    placeEntry,
    _buildPendingPositionData, // [PHANTOM-SHORT FIX a] pure PENDING-row builder (mode-tag = engine mode)
    closePosition,
    ensureSymbolReady,
    getPositions,
    getBalance,
    getUserTrades,
    ping,
    cancelOrder,
    placeStopLoss,
    setLeverage,
    placeOrder,
    placeTakeProfit,
    getOrder,
    getOpenOrders,
    _emergencyClose,
};
