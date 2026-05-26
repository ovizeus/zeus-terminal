'use strict';

/**
 * bybitOps — Bybit V5 unified API canonical wrap.
 *
 * Phase 1E: BYBIT_DRY_RUN_ONLY=false. Uses sendSignedRequest (real HTTP send).
 * Tests inject synthetic responses via _enqueueSynthetic / _resetSyntheticQueue;
 * _dispatchRequest drains the queue first so unit tests remain fully isolated.
 *
 * Mirrors binanceOps interface exactly. Returns canonical shapes with
 * rawExchange:'bybit'. All endpoints use category:'linear', positionIdx:0
 * (one-way per spec pillar 12), closeOnTrigger:true for SL/TP.
 */

const { db } = require('./database');
const bybitSigner = require('./bybitSigner');
const orderLock = require('./orderLock');
const positionStateMachine = require('./positionStateMachine');
const positionEvents = require('./positionEvents');
const canonicalErrors = require('./canonicalErrors');

const LOCK_TIMEOUT_MS = 10_000;
const SL_RETRIES = 3;
const SL_BACKOFFS_MS = [200, 1000, 3000];
const EMERGENCY_RETRIES = 3;
const EMERGENCY_BACKOFFS_MS = [100, 500, 2000];

// Synthetic response queue for DRY_RUN mode. Tests inject controlled responses
// via _enqueueSynthetic. Production fallback returns generic OK response if queue empty.
const _syntheticQueue = [];

function _enqueueSynthetic(resp) {
    _syntheticQueue.push(resp);
}
function _resetSyntheticQueue() {
    _syntheticQueue.length = 0;
}

async function _dispatchRequest(method, path, params, creds) {
    if (_syntheticQueue.length > 0) {
        return _syntheticQueue.shift();
    }
    const flags = require('./migrationFlags').flags;
    if (flags.BYBIT_DRY_RUN_ONLY) {
        throw new Error('BYBIT_DRY_RUN_ONLY=true — real HTTP dispatch blocked');
    }
    return bybitSigner.sendSignedRequest(method, path, params, creds);
}

function _isOk(resp) {
    return resp && resp.retCode === 0;
}

function _bybitSide(side) {
    return side === 'LONG' ? 'Buy' : 'Sell';
}
function _oppositeBybitSide(side) {
    return side === 'LONG' ? 'Sell' : 'Buy';
}

async function _emergencyClose(uid, params, creds, seq) {
    const closeSide = _oppositeBybitSide(params.side);
    for (let i = 0; i < EMERGENCY_RETRIES; i++) {
        try {
            const resp = await _dispatchRequest('POST', '/v5/order/create', {
                category: 'linear',
                symbol: params.symbol,
                side: closeSide,
                orderType: 'Market',
                qty: params.qty,
                reduceOnly: true,
                positionIdx: 0,
                orderLinkId: `emerg_${params.decisionKey}_${i}`.slice(0, 36),
            }, creds);
            if (_isOk(resp)) {
                positionEvents.append({
                    position_seq: seq, user_id: uid, exchange: 'bybit',
                    event_type: 'EMERGENCY_CLOSE_SUCCESS',
                    payload: { attempt: i + 1, orderId: resp.result.orderId },
                });
                return { ok: true, attempt: i + 1, orderId: resp.result.orderId };
            }
        } catch (_) { /* retry */ }
        if (i < EMERGENCY_RETRIES - 1) {
            await new Promise(r => setTimeout(r, EMERGENCY_BACKOFFS_MS[i]));
        }
    }
    positionEvents.append({
        position_seq: seq, user_id: uid, exchange: 'bybit',
        event_type: 'EMERGENCY_CLOSE_FAILED',
        payload: { attempts: EMERGENCY_RETRIES },
    });
    return { ok: false, attempts: EMERGENCY_RETRIES };
}

async function placeEntry(uid, params, creds) {
    const lockKey = `${uid}|${params.symbol}`;
    const lockAcquired = await orderLock.acquire(lockKey, LOCK_TIMEOUT_MS);
    if (!lockAcquired) {
        return { ok: false, error: canonicalErrors.create('ErrLockTimeout', `lock held >${LOCK_TIMEOUT_MS}ms for ${lockKey}`) };
    }

    const positionData = {
        symbol: params.symbol, side: params.side, qty: params.qty,
        entryType: params.entryType, sl: params.sl && params.sl.price, tp: params.tp && params.tp.price,
        leverage: params.leverage, decisionKey: params.decisionKey, source: params.source, mode: creds.mode,
    };
    const insertResult = db.prepare(
        `INSERT INTO at_positions (data, status, user_id, exchange) VALUES (?, 'PENDING', ?, 'bybit')`
    ).run(JSON.stringify(positionData), uid);
    const seq = Number(insertResult.lastInsertRowid);
    positionEvents.append({
        position_seq: seq, user_id: uid, exchange: 'bybit',
        event_type: 'CREATED', to_state: 'PENDING',
        payload: { decisionKey: params.decisionKey, source: params.source },
    });

    try {
        const entryBody = {
            category: 'linear',
            symbol: params.symbol,
            side: _bybitSide(params.side),
            orderType: params.entryType === 'LIMIT' ? 'Limit' : 'Market',
            qty: params.qty,
            positionIdx: 0,
            orderLinkId: params.decisionKey.slice(0, 36),
        };
        if (entryBody.orderType === 'Limit') {
            entryBody.timeInForce = 'GTC';
            entryBody.price = params.entryPrice;
        }

        const entryResp = await _dispatchRequest('POST', '/v5/order/create', entryBody, creds);
        if (!_isOk(entryResp)) {
            const err = bybitSigner.parseBybitError(entryResp) || canonicalErrors.create('ErrUnknown', 'entry rejected');
            positionStateMachine.transition(seq, 'PENDING', 'CANCELLED', { reason: 'ENTRY_REJECTED', err });
            return { ok: false, error: err, seq };
        }

        positionStateMachine.transition(seq, 'PENDING', 'OPENING', {
            entryOrderId: entryResp.result.orderId,
            fillPrice: entryResp.result.avgPrice,
        });

        // SL retry 3x
        let slOrderId = null;
        if (params.sl && params.sl.price) {
            let lastErr = null;
            for (let i = 0; i < SL_RETRIES; i++) {
                try {
                    // For LONG: SL is Sell with triggerDirection=2 (falling). For SHORT: Buy + triggerDirection=1.
                    const slResp = await _dispatchRequest('POST', '/v5/order/create', {
                        category: 'linear',
                        symbol: params.symbol,
                        side: _oppositeBybitSide(params.side),
                        orderType: 'Market',
                        qty: params.qty,
                        triggerPrice: params.sl.price,
                        triggerDirection: params.side === 'LONG' ? 2 : 1,
                        triggerBy: 'LastPrice',
                        positionIdx: 0,
                        closeOnTrigger: true,
                        reduceOnly: true,
                        orderLinkId: `sl_${params.decisionKey}_${i}`.slice(0, 36),
                    }, creds);
                    if (_isOk(slResp) && slResp.result.orderId) {
                        slOrderId = slResp.result.orderId;
                        positionEvents.append({
                            position_seq: seq, user_id: uid, exchange: 'bybit',
                            event_type: 'SL_PLACED', payload: { slOrderId, attempt: i + 1 },
                        });
                        break;
                    }
                    lastErr = `retCode=${slResp.retCode} msg=${slResp.retMsg}`;
                } catch (err) { lastErr = err.message; }
                if (i < SL_RETRIES - 1) await new Promise(r => setTimeout(r, SL_BACKOFFS_MS[i]));
            }

            if (!slOrderId) {
                positionEvents.append({
                    position_seq: seq, user_id: uid, exchange: 'bybit',
                    event_type: 'SL_RETRY_EXHAUSTED', payload: { error: lastErr },
                });
                const closeResult = await _emergencyClose(uid, params, creds, seq);
                positionStateMachine.transition(seq, 'OPENING', 'EMERGENCY', { reason: 'SL_PLACEMENT_FAILED', closeResult });
                if (!closeResult.ok) {
                    try {
                        db.prepare(`INSERT INTO emergency_close_queue (user_id, symbol, exchange, qty, decision_key, created_at) VALUES (?, ?, 'bybit', ?, ?, ?)`).run(uid, params.symbol, params.qty, params.decisionKey, Date.now());
                    } catch (_) {}
                    try { require('./serverAT').setGlobalHalt(true, uid, 'EMERGENCY_CLOSE_CATASTROPHIC'); } catch (_) {}
                    try { require('./telegram').alertCritical(uid, `CATASTROPHIC Bybit ${params.symbol}: position cannot close. Manual intervention NOW.`); } catch (_) {}
                    return { ok: false, error: canonicalErrors.create('ErrSlPlacementFailed', 'SL retry exhausted, emergency close FAILED'), catastrophic: true, seq };
                }
                return { ok: false, error: canonicalErrors.create('ErrSlPlacementFailed', 'SL retry exhausted, emergency close succeeded'), seq };
            }
        }

        // Optional TP (1 attempt non-blocking)
        let tpOrderId = null;
        if (params.tp && params.tp.price) {
            try {
                const tpResp = await _dispatchRequest('POST', '/v5/order/create', {
                    category: 'linear',
                    symbol: params.symbol,
                    side: _oppositeBybitSide(params.side),
                    orderType: 'Market',
                    qty: params.qty,
                    triggerPrice: params.tp.price,
                    triggerDirection: params.side === 'LONG' ? 1 : 2,
                    triggerBy: 'LastPrice',
                    positionIdx: 0,
                    closeOnTrigger: true,
                    reduceOnly: true,
                    orderLinkId: `tp_${params.decisionKey}`.slice(0, 36),
                }, creds);
                if (_isOk(tpResp) && tpResp.result.orderId) {
                    tpOrderId = tpResp.result.orderId;
                    positionEvents.append({
                        position_seq: seq, user_id: uid, exchange: 'bybit',
                        event_type: 'TP_PLACED', payload: { tpOrderId },
                    });
                }
            } catch (_) {}
        }

        const updatedData = { ...positionData, entryOrderId: entryResp.result.orderId, slOrderId, tpOrderId, avgFillPrice: entryResp.result.avgPrice };
        db.prepare(`UPDATE at_positions SET data = ? WHERE seq = ?`).run(JSON.stringify(updatedData), seq);
        positionStateMachine.transition(seq, 'OPENING', 'OPEN', { slOrderId, tpOrderId });

        return {
            ok: true,
            orderId: entryResp.result.orderId,
            clientOrderId: params.decisionKey,
            status: entryResp.result.orderStatus || 'FILLED',
            filledQty: entryResp.result.cumExecQty || params.qty,
            avgFillPrice: entryResp.result.avgPrice,
            slOrderId, tpOrderId,
            ts: Date.now(),
            rawExchange: 'bybit',
            seq,
        };
    } finally {
        orderLock.release(lockKey);
    }
}

async function closePosition(uid, params, creds) {
    const lockKey = `${uid}|${params.symbol}`;
    const lockAcquired = await orderLock.acquire(lockKey, LOCK_TIMEOUT_MS);
    if (!lockAcquired) {
        return { ok: false, error: canonicalErrors.create('ErrLockTimeout', `lock held >${LOCK_TIMEOUT_MS}ms`) };
    }

    try {
        const row = db.prepare('SELECT seq, data, status FROM at_positions WHERE seq=? AND user_id=?').get(params.seq, uid);
        if (!row) throw canonicalErrors.create('ErrNotFound', `position seq=${params.seq} not found for uid=${uid}`);

        if (row.status === 'CLOSED') {
            positionEvents.append({
                position_seq: params.seq, user_id: uid, exchange: 'bybit',
                event_type: 'CLOSE_RACE_DETECTED',
                payload: { source: params.source, reason: 'position already CLOSED (SL race)' },
            });
            return { ok: true, closedBySL: true, rawExchange: 'bybit', seq: params.seq, ts: Date.now() };
        }

        let positionData;
        try { positionData = JSON.parse(row.data); } catch (_) { positionData = {}; }

        // Fix #4: Handle CLOSING retry — if state is already CLOSING (retry after
        // exchange call failure), skip transition. Only transition from OPEN.
        const currentState = row.status;
        if (currentState === 'OPEN') {
            positionStateMachine.transition(params.seq, 'OPEN', 'CLOSING', { decisionKey: params.decisionKey, source: params.source });
        } else if (currentState !== 'CLOSING') {
            throw canonicalErrors.create('ErrNotFound', `unexpected state ${currentState} for close`);
        }

        const cancelTasks = [];
        if (positionData.slOrderId) {
            cancelTasks.push(
                _dispatchRequest('POST', '/v5/order/cancel', { category: 'linear', symbol: params.symbol, orderId: positionData.slOrderId }, creds).catch(() => {})
            );
        }
        if (positionData.tpOrderId) {
            cancelTasks.push(
                _dispatchRequest('POST', '/v5/order/cancel', { category: 'linear', symbol: params.symbol, orderId: positionData.tpOrderId }, creds).catch(() => {})
            );
        }
        if (cancelTasks.length > 0) {
            await Promise.all(cancelTasks);
            positionEvents.append({
                position_seq: params.seq, user_id: uid, exchange: 'bybit',
                event_type: 'PROTECTION_CANCELLED',
                payload: { slOrderId: positionData.slOrderId, tpOrderId: positionData.tpOrderId },
            });
        }

        const closeResp = await _dispatchRequest('POST', '/v5/order/create', {
            category: 'linear',
            symbol: params.symbol,
            side: _oppositeBybitSide(params.side),
            orderType: params.closeType === 'LIMIT' ? 'Limit' : 'Market',
            qty: params.qty,
            reduceOnly: true,
            positionIdx: 0,
            orderLinkId: `close_${params.decisionKey}`.slice(0, 36),
            ...(params.closeType === 'LIMIT' ? { timeInForce: 'GTC', price: params.closePrice } : {}),
        }, creds);

        if (!_isOk(closeResp)) {
            const err = bybitSigner.parseBybitError(closeResp) || canonicalErrors.create('ErrUnknown', 'close rejected');
            db.prepare(`UPDATE at_positions SET status='OPEN', updated_at=datetime('now') WHERE seq=?`).run(params.seq);
            positionEvents.append({
                position_seq: params.seq, user_id: uid, exchange: 'bybit',
                event_type: 'CLOSE_REJECTED_REVERT',
                from_state: 'CLOSING', to_state: 'OPEN',
                payload: { reason: 'CLOSE_REJECTED', err: { code: err.code, message: err.message } },
            });
            return { ok: false, error: err, seq: params.seq };
        }

        positionStateMachine.transition(params.seq, 'CLOSING', 'CLOSED', {
            closeOrderId: closeResp.result.orderId,
            closePrice: closeResp.result.avgPrice,
            source: params.source,
        });

        try {
            const closedData = { ...positionData, closeOrderId: closeResp.result.orderId, closePrice: closeResp.result.avgPrice, source: params.source };
            db.prepare(`INSERT INTO at_closed (seq, data, closed_at, user_id, exchange) VALUES (?, ?, datetime('now'), ?, 'bybit')`).run(params.seq, JSON.stringify(closedData), uid);
            db.prepare(`DELETE FROM at_positions WHERE seq=?`).run(params.seq);
        } catch (err) {
            if (typeof logger !== 'undefined' && logger && logger.warn) {
                logger.warn('BYBIT', `[closePosition] at_closed INSERT/DELETE failed seq=${params.seq}: ${err.message}`);
            }
        }

        positionEvents.append({
            position_seq: params.seq, user_id: uid, exchange: 'bybit',
            event_type: 'CLOSED',
            payload: { closeOrderId: closeResp.result.orderId, closePrice: closeResp.result.avgPrice, source: params.source },
        });

        return {
            ok: true,
            orderId: closeResp.result.orderId,
            clientOrderId: params.decisionKey,
            status: closeResp.result.orderStatus || 'FILLED',
            filledQty: closeResp.result.cumExecQty || params.qty,
            avgFillPrice: closeResp.result.avgPrice,
            ts: Date.now(),
            rawExchange: 'bybit',
            seq: params.seq,
        };
    } finally {
        orderLock.release(lockKey);
    }
}

async function ensureSymbolReady(uid, params, creds) {
    // 1. Set leverage
    const levResp = await _dispatchRequest('POST', '/v5/position/set-leverage', {
        category: 'linear', symbol: params.symbol,
        buyLeverage: String(params.leverage), sellLeverage: String(params.leverage),
    }, creds);
    if (!_isOk(levResp) && levResp.retCode !== 110043 /* leverage not modified */ && levResp.retCode !== 110026) {
        return { ok: false, error: bybitSigner.parseBybitError(levResp), rawExchange: 'bybit' };
    }

    // 2. Switch position mode to one-way (per spec pillar 12)
    const modeResp = await _dispatchRequest('POST', '/v5/position/switch-mode', {
        category: 'linear', symbol: params.symbol, mode: 0,
    }, creds);
    if (!_isOk(modeResp) && modeResp.retCode !== 110025 && modeResp.retCode !== 110026) {
        return { ok: false, error: bybitSigner.parseBybitError(modeResp), rawExchange: 'bybit' };
    }

    // 3. Switch margin mode
    const marginMode = params.marginMode || 'CROSSED';
    const tradeMode = marginMode === 'CROSSED' ? 0 : 1;
    const marginResp = await _dispatchRequest('POST', '/v5/position/switch-isolated', {
        category: 'linear', symbol: params.symbol, tradeMode,
        buyLeverage: String(params.leverage), sellLeverage: String(params.leverage),
    }, creds);
    if (!_isOk(marginResp) && marginResp.retCode !== 110026) {
        return { ok: false, error: bybitSigner.parseBybitError(marginResp), rawExchange: 'bybit' };
    }

    return { ok: true, leverage: params.leverage, marginMode, rawExchange: 'bybit' };
}

async function getPositions(uid, params, creds) {
    const query = { category: 'linear' };
    if (params && params.symbol) query.symbol = params.symbol;
    const resp = await _dispatchRequest('GET', '/v5/position/list', query, creds);
    if (!_isOk(resp) || !resp.result || !Array.isArray(resp.result.list)) return [];
    return resp.result.list
        .filter(p => Math.abs(Number(p.size || 0)) > 0)
        .map(p => ({
            symbol: p.symbol,
            side: p.side === 'Buy' ? 'LONG' : 'SHORT',
            qty: String(Math.abs(Number(p.size))),
            entryPrice: p.avgPrice,
            markPrice: p.markPrice,
            unrealizedPnl: p.unrealisedPnl,
            leverage: p.leverage,
            marginMode: Number(p.tradeMode) === 0 ? 'CROSSED' : 'ISOLATED',
            rawExchange: 'bybit',
        }));
}

async function getBalance(uid, creds) {
    const resp = await _dispatchRequest('GET', '/v5/account/wallet-balance', { accountType: 'UNIFIED' }, creds);
    const empty = { asset: 'USDT', walletBalance: '0', availableBalance: '0', totalUnrealizedPnL: '0', rawExchange: 'bybit' };
    if (!_isOk(resp) || !resp.result || !Array.isArray(resp.result.list) || resp.result.list.length === 0) return empty;
    const account = resp.result.list[0];
    if (!Array.isArray(account.coin)) return empty;
    const usdt = account.coin.find(c => c.coin === 'USDT');
    if (!usdt) return empty;
    return {
        asset: 'USDT',
        walletBalance: usdt.walletBalance || '0',
        availableBalance: usdt.availableToWithdraw || '0',
        totalUnrealizedPnL: usdt.unrealisedPnl || '0',
        rawExchange: 'bybit',
    };
}

async function getUserTrades(uid, params, creds) {
    const query = { category: 'linear', symbol: params.symbol, limit: params.limit || 100 };
    if (params.startTime) query.startTime = params.startTime;
    if (params.endTime) query.endTime = params.endTime;
    const resp = await _dispatchRequest('GET', '/v5/execution/list', query, creds);
    if (!_isOk(resp) || !resp.result || !Array.isArray(resp.result.list)) return [];
    return resp.result.list.map(t => ({
        id: String(t.execId),
        orderId: String(t.orderId || ''),  // Fix #14: include orderId for pnlReconCron matching
        symbol: t.symbol,
        side: t.side === 'Buy' ? 'BUY' : 'SELL',
        price: t.execPrice,
        qty: t.execQty,
        fee: t.execFee,
        feeAsset: 'USDT',
        ts: Number(t.execTime),
        realizedPnl: t.closedPnl,
        rawExchange: 'bybit',
    }));
}

async function ping(uid, creds) {
    const t0 = Date.now();
    try {
        await _dispatchRequest('GET', '/v5/market/time', {}, creds);
        return { ok: true, latencyMs: Date.now() - t0, rawExchange: 'bybit' };
    } catch (err) {
        return { ok: false, latencyMs: Date.now() - t0, error: err.message, rawExchange: 'bybit' };
    }
}

async function cancelOrder(uid, params, creds) {
    const query = { category: 'linear', symbol: params.symbol };
    if (params.orderId) query.orderId = params.orderId;
    else if (params.orderLinkId) query.orderLinkId = params.orderLinkId;
    const resp = await _dispatchRequest('POST', '/v5/order/cancel', query, creds);
    if (!_isOk(resp)) {
        return { ok: false, error: bybitSigner.parseBybitError(resp), rawExchange: 'bybit' };
    }
    return { ok: true, orderId: resp.result.orderId, status: resp.result.orderStatus, ts: Date.now(), rawExchange: 'bybit' };
}

async function placeStopLoss(uid, params, creds) {
    const resp = await _dispatchRequest('POST', '/v5/order/create', {
        category: 'linear',
        symbol: params.symbol,
        side: _oppositeBybitSide(params.side),
        orderType: 'Market',
        qty: '0',
        triggerPrice: params.stopPrice,
        triggerDirection: params.side === 'LONG' ? 2 : 1,
        triggerBy: 'LastPrice',
        positionIdx: 0,
        closeOnTrigger: true,
        reduceOnly: true,
        orderLinkId: `resl_${params.decisionKey}`.slice(0, 36),
    }, creds);
    if (!_isOk(resp)) {
        return { ok: false, error: bybitSigner.parseBybitError(resp), rawExchange: 'bybit' };
    }
    return { ok: true, slOrderId: resp.result.orderId, status: resp.result.orderStatus, ts: Date.now(), rawExchange: 'bybit' };
}

module.exports = {
    placeEntry, closePosition,
    ensureSymbolReady, getPositions, getBalance, getUserTrades,
    ping, cancelOrder, placeStopLoss,
    _emergencyClose,
    _enqueueSynthetic, _resetSyntheticQueue,
};
