'use strict';

// Zeus Terminal — Boot orphan order sweeper (Task M)
//
// After PM2 restart, scan exchange open orders for each active user. SL/TP
// orders placed by Zeus carry clientOrderId prefixes sl_/tp_/resl_ (see
// binanceOps.js line 148/219/564). If such an order exists on the exchange
// but is NOT recorded in our at_positions DB, it's an ORPHAN — the exchange
// place succeeded but the DB INSERT was interrupted by crash. Cancel orphans
// to free margin and avoid surprise fills.
//
// Non-Zeus clientOrderIds (user manual orders) are PRESERVED — sweeper must
// never touch what the user placed manually via the dock or app.
//
// Entry/close/emergency MARKET orders don't sit as "open" so they're not in
// scope. Only SL/TP-style limit orders linger as orphans.

// Zeus-attributable clientOrderId prefixes for OPEN orders (SL/TP/re-SL).
// Tied to actual binanceOps.js wiring lines 148 (sl_), 219 (tp_), 564 (resl_).
const ZEUS_PREFIX_REGEX = /^(sl_|tp_|resl_)/;

function isZeusOrder(order) {
    return ZEUS_PREFIX_REGEX.test(String(order && order.clientOrderId || ''));
}

async function sweep(userId) {
    const result = {
        userId,
        cancelled: [],
        preserved: [],
        errors: [],
    };

    const exchangeOps = require('./exchangeOps');
    const { db } = require('./database');

    let openOrders;
    try {
        openOrders = await exchangeOps.getOpenOrders(userId);
    } catch (err) {
        result.errors.push({ stage: 'getOpenOrders', error: err.message });
        return result;
    }

    if (!Array.isArray(openOrders) || openOrders.length === 0) {
        return result;
    }

    // Build Set of orderIds the DB knows about (slOrderId/tpOrderId in at_positions data JSON)
    let dbOrderIds;
    try {
        dbOrderIds = (typeof db.getZeusOrderIds === 'function')
            ? db.getZeusOrderIds(userId)
            : new Set();
    } catch (e) {
        // Failure to read DB → assume NOTHING is known. Safer to PRESERVE all
        // (no cancel) than risk cancelling a real Zeus order. Errors recorded.
        result.errors.push({ stage: 'getZeusOrderIds', error: e.message });
        dbOrderIds = null;
    }

    for (const order of openOrders) {
        const isZeus = isZeusOrder(order);
        if (!isZeus) {
            result.preserved.push(order);
            continue;
        }
        // Zeus-prefixed order. Cross-check DB.
        if (dbOrderIds === null) {
            // DB read failed — preserve all Zeus-prefixed too (no false-positive cancel)
            result.preserved.push(order);
            continue;
        }
        if (dbOrderIds.has(String(order.orderId))) {
            result.preserved.push(order);
            continue;
        }
        // Orphan: Zeus-prefixed but no DB record. Cancel.
        try {
            await exchangeOps.cancelOrder(userId, {
                symbol: order.symbol,
                orderId: order.orderId,
            });
            result.cancelled.push(order);
            try {
                db.auditLog(userId, 'ORDER_SWEEPER_CANCELLED', {
                    orderId: order.orderId,
                    symbol: order.symbol,
                    clientOrderId: order.clientOrderId,
                }, null);
            } catch (_) {}
        } catch (err) {
            result.errors.push({ orderId: order.orderId, error: err.message });
            try {
                db.auditLog(userId, 'ORDER_SWEEPER_CANCEL_FAILED', {
                    orderId: order.orderId,
                    symbol: order.symbol,
                    clientOrderId: order.clientOrderId,
                    error: err.message,
                }, null);
            } catch (_) {}
        }
    }

    // Telegram summary only if we actually cancelled something
    if (result.cancelled.length > 0) {
        try {
            const telegram = require('./telegram');
            await telegram.sendToUser(userId,
                '🧹 *Order Sweeper* — ' + result.cancelled.length
                + ' orphan order(s) cancelled at boot.\n'
                + '_Zeus-prefixed SL/TP found on exchange but missing from DB._');
        } catch (_) { /* best-effort */ }
    }

    return result;
}

module.exports = { sweep, isZeusOrder, ZEUS_PREFIX_REGEX };
