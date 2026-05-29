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
            throw canonicalErrors.create('ErrNotFound', `position seq=${params.seq} not found for uid=${uid}`);
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

    // Set margin mode
    const marginMode = params.marginMode || 'CROSSED';
    const marginResp = await sendSignedRequest('POST', '/fapi/v1/marginType', {
        symbol: params.symbol, marginType: marginMode, recvWindow: 5000,
    }, creds);
    // -4046 is idempotent success ("No need to change margin type")
    if (marginResp && marginResp.code && marginResp.code < 0 && marginResp.code !== -4046) {
        return { ok: false, error: canonicalErrors.translateBinance(marginResp), rawExchange: 'binance' };
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
        if (algoResp && !algoResp.code) {
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
    try {
        const respAlgo = await sendSignedRequest('GET', '/fapi/v1/algoOrders', query, creds);
        if (Array.isArray(respAlgo)) {
            for (const o of respAlgo) {
                out.push({
                    orderId: String(o.algoId || o.orderId),
                    clientOrderId: o.clientOrderId || o.algoClientOrderId || '',
                    symbol: o.symbol,
                    side: o.side,
                    type: o.algoType || o.type,
                    price: Number(o.stopPrice || o.price),
                    origQty: Number(o.origQty || 0),
                    status: o.status,
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

module.exports = {
    placeEntry,
    closePosition,
    ensureSymbolReady,
    getPositions,
    getBalance,
    getUserTrades,
    ping,
    cancelOrder,
    placeStopLoss,
    getOpenOrders,
    _emergencyClose,
};
