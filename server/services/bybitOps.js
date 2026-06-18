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

let _lastDispatch = null; // [test hook] last (method,path,params) for query-shape assertions
function _getLastDispatch() { return _lastDispatch; }

async function _dispatchRequest(method, path, params, creds) {
    _lastDispatch = { method, path, params };
    if (_syntheticQueue.length > 0) {
        return _syntheticQueue.shift();
    }
    const flags = require('../migrationFlags');  // [BUG#5] correct path (server/migrationFlags, not services/); [BUG#5b] flags are getters on the module object — there is no `.flags` sub-object
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

// [P2 close-desync fix] Row-independent close used when the at_positions row was already
// archived (optimistic _persistClose race) but the position may still be OPEN on the exchange.
// Cancels caller-provided protective orders (best-effort) then sends a reduce-only MARKET close.
// reduceOnly guarantees we can only close/shrink, never open exposure. Returns the same shape as
// closePosition's success/failure paths; never throws on a missing local row.
async function _closeWithoutLocalRow(uid, params, creds) {
    const cancelTasks = [];
    if (params.slOrderId) {
        cancelTasks.push(_dispatchRequest('POST', '/v5/order/cancel', { category: 'linear', symbol: params.symbol, orderId: params.slOrderId }, creds).catch(() => {}));
    }
    if (params.tpOrderId) {
        cancelTasks.push(_dispatchRequest('POST', '/v5/order/cancel', { category: 'linear', symbol: params.symbol, orderId: params.tpOrderId }, creds).catch(() => {}));
    }
    if (cancelTasks.length > 0) await Promise.all(cancelTasks);

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
        const err = bybitSigner.parseBybitError(closeResp) || canonicalErrors.create('ErrUnknown', 'close rejected (no local row)');
        try {
            positionEvents.append({
                position_seq: params.seq, user_id: uid, exchange: 'bybit',
                event_type: 'CLOSE_ROW_MISSING_REJECTED',
                payload: { source: params.source, reason: 'reduce-only rejected — position likely already closed', err: { code: err.code, message: err.message } },
            });
        } catch (_) {}
        return { ok: false, error: err, seq: params.seq, rowMissingFallback: true };
    }

    const result = closeResp.result || {};
    try {
        positionEvents.append({
            position_seq: params.seq, user_id: uid, exchange: 'bybit',
            event_type: 'CLOSED_ROW_MISSING_FALLBACK',
            payload: { source: params.source, orderId: result.orderId, reason: 'local row archived before exchange close (race) — closed via reduce-only fallback' },
        });
    } catch (_) {}
    return { ok: true, orderId: result.orderId, rawExchange: 'bybit', seq: params.seq, ts: Date.now(), rowMissingFallback: true };
}

async function closePosition(uid, params, creds) {
    const lockKey = `${uid}|${params.symbol}`;
    const lockAcquired = await orderLock.acquire(lockKey, LOCK_TIMEOUT_MS);
    if (!lockAcquired) {
        return { ok: false, error: canonicalErrors.create('ErrLockTimeout', `lock held >${LOCK_TIMEOUT_MS}ms`) };
    }

    try {
        const row = db.prepare('SELECT seq, data, status FROM at_positions WHERE seq=? AND user_id=?').get(params.seq, uid);
        if (!row) {
            // [P2 close-desync fix 2026-05-30] The at_positions row may have been optimistically
            // archived (DELETE) by serverAT._closePosition's synchronous _persistClose while THIS
            // fire-and-forget exchange close was still pending — a race that previously threw
            // "not found" and orphaned the still-open exchange position. Fall back to a
            // row-independent close: cancel the caller-provided SL/TP + reduce-only MARKET.
            // reduceOnly can only shrink/close, never open exposure → safe even if the position
            // is already gone (exchange rejects → ok:false, recon reconciles). NO throw.
            return await _closeWithoutLocalRow(uid, params, creds);
        }

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

        // [ROOT-FIX 2026-06-18] Same fix as binanceOps: archive (INSERT OR REPLACE, own try)
        // and the at_positions DELETE (own try) are separate so the CLOSED row is ALWAYS
        // removed even if the archive throws — otherwise it lingers as status=CLOSED cruft
        // with stale data.live.status=LIVE → recon re-adopts the leg as a duplicate orphan.
        try {
            const closedData = { ...positionData, closeOrderId: closeResp.result.orderId, closePrice: closeResp.result.avgPrice, source: params.source };
            db.prepare(`INSERT OR REPLACE INTO at_closed (seq, data, closed_at, user_id, exchange) VALUES (?, ?, datetime('now'), ?, 'bybit')`).run(params.seq, JSON.stringify(closedData), uid);
        } catch (err) {
            if (typeof logger !== 'undefined' && logger && logger.warn) {
                logger.warn('BYBIT', `[closePosition] at_closed archive failed seq=${params.seq}: ${err.message}`);
            }
        }
        try {
            db.prepare(`DELETE FROM at_positions WHERE seq=?`).run(params.seq);
        } catch (delErr) {
            if (typeof logger !== 'undefined' && logger && logger.warn) {
                logger.warn('BYBIT', `[closePosition] at_positions delete failed seq=${params.seq}: ${delErr.message}`);
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
    if (!_isOk(levResp) && levResp.retCode !== 110043 /* leverage not modified */ && levResp.retCode !== 110026 && levResp.retCode !== 10032 /* demo not supported */) {
        return { ok: false, error: bybitSigner.parseBybitError(levResp), rawExchange: 'bybit' };
    }

    // 2. Switch position mode to one-way (per spec pillar 12)
    const modeResp = await _dispatchRequest('POST', '/v5/position/switch-mode', {
        category: 'linear', symbol: params.symbol, mode: 0,
    }, creds);
    if (!_isOk(modeResp) && modeResp.retCode !== 110025 && modeResp.retCode !== 110026 && modeResp.retCode !== 10032 /* demo not supported */) {
        return { ok: false, error: bybitSigner.parseBybitError(modeResp), rawExchange: 'bybit' };
    }

    // 3. Switch margin mode
    const marginMode = params.marginMode || 'CROSSED';
    const tradeMode = marginMode === 'CROSSED' ? 0 : 1;
    const marginResp = await _dispatchRequest('POST', '/v5/position/switch-isolated', {
        category: 'linear', symbol: params.symbol, tradeMode,
        buyLeverage: String(params.leverage), sellLeverage: String(params.leverage),
    }, creds);
    if (!_isOk(marginResp) && marginResp.retCode !== 110026 && marginResp.retCode !== 10032 /* demo not supported */) {
        return { ok: false, error: bybitSigner.parseBybitError(marginResp), rawExchange: 'bybit' };
    }

    return { ok: true, leverage: params.leverage, marginMode, rawExchange: 'bybit' };
}

async function getPositions(uid, params, creds) {
    // [BUG bybit-positions 2026-05-30] Bybit v5 /v5/position/list REQUIRES either
    // `symbol` OR `settleCoin` — querying with only {category:'linear'} returns
    // retCode 10001 "Missing... symbol or settleCoin" → empty → Zeus saw 0 bybit
    // positions and orphaned/lost every real open Bybit position. Default to
    // settleCoin:'USDT' for the no-symbol case (all our linear pairs settle USDT).
    const query = { category: 'linear' };
    if (params && params.symbol) query.symbol = params.symbol;
    else query.settleCoin = 'USDT';
    const resp = await _dispatchRequest('GET', '/v5/position/list', query, creds);
    // [SYNC-5 2026-05-30] Do NOT swallow an errored/failed poll into []. Returning []
    // on a non-ok response made recon read an empty held-map and FALSE-phantom-close real
    // Bybit positions (→ orphans → AT SUSPENDED). On error/malformed THROW so callers
    // (all already try/catch — recon → continue, no phantom) defer instead of closing.
    // Only a genuine ok+empty list returns [] (real "no positions", phantom allowed).
    if (!_isOk(resp)) {
        throw canonicalErrors.create('ErrExchangeQuery', `bybit getPositions failed: retCode=${resp && resp.retCode} ${(resp && resp.retMsg) || ''}`.trim());
    }
    if (!resp.result || !Array.isArray(resp.result.list)) {
        throw canonicalErrors.create('ErrExchangeQuery', 'bybit getPositions: malformed response (no result.list)');
    }
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
    // [BUG bybit-unified] UNIFIED / cross-margin accounts return the per-coin
    // availableToWithdraw as "" — the spendable figure lives at the account level
    // (totalAvailableBalance). Without this fallback `"" || '0'` → '0', so a funded
    // account (observed live: $112k) falsely reads as zero and blocks the pre-live
    // checklist + margin checks with "Zero USDT balance". Fall back:
    //   per-coin availableToWithdraw → account.totalAvailableBalance → walletBalance.
    let available = usdt.availableToWithdraw;
    if (available === '' || available == null) {
        const acctAvail = account.totalAvailableBalance;
        available = (acctAvail !== '' && acctAvail != null) ? acctAvail : (usdt.walletBalance || '0');
    }
    return {
        asset: 'USDT',
        walletBalance: usdt.walletBalance || '0',
        availableBalance: available || '0',
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

// [Phase M] Leverage set (manual /order/place pre-step + dedicated endpoint).
// 110043 = "leverage not modified" — already at target, idempotent success.
async function setLeverage(uid, params, creds) {
    const resp = await _dispatchRequest('POST', '/v5/position/set-leverage', {
        category: 'linear', symbol: params.symbol,
        buyLeverage: String(params.leverage), sellLeverage: String(params.leverage),
    }, creds);
    // 110043 = "leverage not modified" (idempotent). 10032 = "Demo trading not
    // supported" — Bybit Demo rejects leverage/margin management; the order itself
    // still works at the account default, so treat as a soft success (skipped).
    if (_isOk(resp) || resp.retCode === 110043) return { ok: true, leverage: params.leverage, rawExchange: 'bybit' };
    if (resp.retCode === 10032) return { ok: true, leverage: params.leverage, skipped: true, rawExchange: 'bybit' };
    return { ok: false, error: bybitSigner.parseBybitError(resp), rawExchange: 'bybit' };
}

// [Phase M] Manual-trading parity. ── Generic order (open MARKET/LIMIT, reduce-only
// close). NOT placeEntry (which owns the AT entry+SL/TP+DB-row lifecycle).
async function placeOrder(uid, params, creds) {
    const body = {
        category: 'linear', symbol: params.symbol,
        side: params.side === 'BUY' ? 'Buy' : 'Sell',
        orderType: params.type === 'LIMIT' ? 'Limit' : 'Market',
        qty: String(params.quantity), positionIdx: 0,
    };
    if (body.orderType === 'Limit') { body.timeInForce = 'GTC'; body.price = String(params.price); }
    if (params.reduceOnly || params.closePosition) { body.reduceOnly = true; body.closeOnTrigger = !!params.closePosition; }
    if (params.clientOrderId) body.orderLinkId = String(params.clientOrderId).slice(0, 36);
    const resp = await _dispatchRequest('POST', '/v5/order/create', body, creds);
    if (!_isOk(resp)) return { ok: false, error: bybitSigner.parseBybitError(resp), rawExchange: 'bybit' };
    return { ok: true, orderId: String(resp.result.orderId), status: resp.result.orderStatus, ts: Date.now(), rawExchange: 'bybit' };
}

// ── Take-profit conditional (mirror of placeStopLoss but TP trigger direction:
// LONG TP fires on price RISE → triggerDirection 1; SHORT TP on FALL → 2).
async function placeTakeProfit(uid, params, creds) {
    const resp = await _dispatchRequest('POST', '/v5/order/create', {
        category: 'linear', symbol: params.symbol,
        side: params.side === 'LONG' ? 'Sell' : 'Buy',
        orderType: 'Market', qty: String(params.quantity), positionIdx: 0,
        triggerPrice: String(params.triggerPrice),
        triggerDirection: params.side === 'LONG' ? 1 : 2,
        reduceOnly: true, closeOnTrigger: true,
        orderLinkId: params.clientOrderId ? String(params.clientOrderId).slice(0, 36) : `tp_${Date.now()}`.slice(0, 36),
    }, creds);
    if (!_isOk(resp)) return { ok: false, error: bybitSigner.parseBybitError(resp), rawExchange: 'bybit' };
    return { ok: true, tpOrderId: String(resp.result.orderId), status: resp.result.orderStatus, ts: Date.now(), rawExchange: 'bybit' };
}

// ── Open orders (manual UI panel + recon parity later).
async function getOpenOrders(uid, params, creds) {
    const query = { category: 'linear', openOnly: 0 };
    if (params && params.symbol) query.symbol = params.symbol;
    const resp = await _dispatchRequest('GET', '/v5/order/realtime', query, creds);
    if (!_isOk(resp) || !resp.result || !Array.isArray(resp.result.list)) return [];
    return resp.result.list.map(o => ({
        orderId: String(o.orderId), symbol: o.symbol,
        side: o.side === 'Buy' ? 'BUY' : 'SELL', type: o.orderType,
        price: o.price, qty: o.qty, status: o.orderStatus,
        reduceOnly: !!o.reduceOnly, rawExchange: 'bybit',
    }));
}

// ── Single-order fill query (manual fill-patch).
async function getOrder(uid, params, creds) {
    const resp = await _dispatchRequest('GET', '/v5/order/realtime', { category: 'linear', symbol: params.symbol, orderId: params.orderId }, creds);
    if (!_isOk(resp) || !resp.result || !Array.isArray(resp.result.list) || !resp.result.list.length) return null;
    const o = resp.result.list[0];
    return { orderId: String(o.orderId), status: o.orderStatus, avgPrice: o.avgPrice, executedQty: o.cumExecQty, rawExchange: 'bybit' };
}

module.exports = {
    placeEntry, closePosition,
    ensureSymbolReady, getPositions, getBalance, getUserTrades,
    ping, cancelOrder, placeStopLoss,
    setLeverage, placeOrder, placeTakeProfit, getOpenOrders, getOrder,
    _emergencyClose,
    _enqueueSynthetic, _resetSyntheticQueue, _getLastDispatch,
};
