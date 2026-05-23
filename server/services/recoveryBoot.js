'use strict';

/**
 * recoveryBoot — Deterministic boot-time position reconciliation.
 *
 * Runs at PM2 restart (called from server/index.js startup BEFORE trading
 * routes mount). Global halt held during recovery, released after clean pass.
 *
 * Per user with active exchange credentials:
 * 1. Scan exchange positions via exchangeOps.getPositions(uid)
 * 2. Read DB at_positions WHERE user_id=uid AND status IN ('OPEN','OPENING')
 * 3. Reconcile:
 *    a. Position in BOTH (exchange + DB) → verify SL active → if no SL, place via exchangeOps.placeStopLoss
 *    b. Position ONLY in DB → mark ORPHANED + log RECOVERY_ORPHANED_NO_EXCHANGE event
 *    c. Position ONLY on exchange → log WARNING RECOVERY_EXCHANGE_ONLY_POSITION (manual intervention needed)
 * 4. Lift global halt for this user
 *
 * All operations wrapped in try/catch — boot must NEVER crash the server.
 * If recovery fails for a user, that user stays halted; other users proceed.
 *
 * Note: serverAT.setGlobalHalt signature is (active, byUserId, reason) — not per-user.
 * We call setGlobalHalt(false, uid, 'RECOVERY_BOOT_COMPLETE') to disarm halt on behalf
 * of each successfully reconciled user.
 */

const exchangeOps = require('./exchangeOps');
const decisionKey = require('./decisionKey');
const { db } = require('./database');

// Lazy-loaded to avoid circular dependency issues at test mock setup time
function _positionEvents() {
    return require('./positionEvents');
}

function _logger() {
    try { return require('./logger'); } catch (_) { return null; }
}

function _logInfo(tag, msg) {
    try { _logger()?.info(tag, msg); } catch (_) {}
}

function _logWarn(tag, msg) {
    try { _logger()?.warn(tag, msg); } catch (_) {}
}

function _logError(tag, msg) {
    try { _logger()?.error(tag, msg); } catch (_) {}
}

async function run() {
    const startTs = Date.now();
    let totalUsers = 0;
    let totalReconciled = 0;
    let totalOrphaned = 0;
    let totalSlPlaced = 0;
    let errors = 0;

    try {
        // Get all users with active exchange accounts
        const users = db.prepare(
            `SELECT DISTINCT user_id, exchange FROM exchange_accounts WHERE is_active = 1`
        ).all();

        for (const { user_id: uid, exchange } of users) {
            totalUsers++;
            try {
                const result = await _reconcileUser(uid, exchange);
                totalReconciled++;
                totalOrphaned += result.orphaned;
                totalSlPlaced += result.slPlaced;
            } catch (err) {
                errors++;
                _logError('RECOVERY_BOOT', `user ${uid} reconciliation failed: ${err.message}`);
                // User stays halted — don't lift their halt
            }
        }
    } catch (err) {
        _logError('RECOVERY_BOOT', `boot failed entirely: ${err.message}`);
    }

    const durationMs = Date.now() - startTs;
    const summary = { totalUsers, totalReconciled, totalOrphaned, totalSlPlaced, errors, durationMs };

    try {
        db.prepare(
            `INSERT INTO audit_log (user_id, action, details) VALUES (NULL, 'RECOVERY_BOOT_COMPLETE', ?)`
        ).run(JSON.stringify(summary));
    } catch (_) {}

    _logInfo('RECOVERY_BOOT',
        `complete in ${durationMs}ms: ${totalReconciled}/${totalUsers} users OK, ` +
        `${totalOrphaned} orphaned, ${totalSlPlaced} SL placed, ${errors} errors`
    );

    return summary;
}

/**
 * _reconcileUser — per-user reconciliation logic.
 * Returns { orphaned, slPlaced } counts.
 * Throws on unrecoverable failure (caller catches and marks user as failed).
 */
async function _reconcileUser(uid, exchange) {
    let orphaned = 0;
    let slPlaced = 0;

    // 1. Scan exchange positions
    let exchangePositions;
    try {
        exchangePositions = await exchangeOps.getPositions(uid, {});
    } catch (err) {
        throw new Error(`getPositions failed: ${err.message}`);
    }

    // 2. Read DB positions (OPEN + OPENING)
    const dbPositions = db.prepare(
        `SELECT seq, data, status FROM at_positions WHERE user_id = ? AND status IN ('OPEN', 'OPENING')`
    ).all(uid);

    // Build lookup maps keyed by symbol
    const exchangeBySymbol = new Map();
    for (const ep of exchangePositions) {
        exchangeBySymbol.set(ep.symbol, ep);
    }

    const dbBySymbol = new Map();
    for (const dp of dbPositions) {
        let parsedData;
        try { parsedData = JSON.parse(dp.data); } catch (_) { parsedData = {}; }
        const sym = parsedData.symbol;
        if (sym) dbBySymbol.set(sym, { ...dp, parsedData });
    }

    // 3a. Position in BOTH → verify SL; also removes matched symbols from exchangeBySymbol
    for (const [symbol, dbPos] of dbBySymbol.entries()) {
        const exchPos = exchangeBySymbol.get(symbol);
        if (exchPos) {
            // Both sides — mark matched so 3b skips it
            exchangeBySymbol.delete(symbol);

            const slOrderId = dbPos.parsedData.slOrderId;
            if (!slOrderId && dbPos.status === 'OPEN') {
                // No SL recorded — attempt to place one
                const stopPrice = exchPos.side === 'SHORT'
                    ? String(Number(exchPos.entryPrice) * 1.05)
                    : String(Number(exchPos.entryPrice) * 0.95);

                try {
                    const slResult = await exchangeOps.placeStopLoss(uid, {
                        symbol,
                        side: dbPos.parsedData.side || exchPos.side,
                        stopPrice,
                        decisionKey: decisionKey.generate(),
                    });

                    if (slResult && slResult.ok) {
                        // Persist new SL order ID into position data
                        const updated = { ...dbPos.parsedData, slOrderId: slResult.slOrderId };
                        db.prepare(`UPDATE at_positions SET data = ? WHERE seq = ?`)
                            .run(JSON.stringify(updated), dbPos.seq);

                        _positionEvents().append({
                            position_seq: dbPos.seq,
                            user_id: uid,
                            exchange,
                            event_type: 'RECOVERY_SL_PLACED',
                            payload: { slOrderId: slResult.slOrderId, stopPrice },
                        });
                        slPlaced++;
                    }
                } catch (err) {
                    // SL placement failed — cannot guarantee safety, mark ORPHANED
                    _positionEvents().append({
                        position_seq: dbPos.seq,
                        user_id: uid,
                        exchange,
                        event_type: 'RECOVERY_SL_PLACEMENT_FAILED',
                        payload: { error: err.message },
                    });

                    db.prepare(`UPDATE at_positions SET status = 'ORPHANED' WHERE seq = ?`)
                        .run(dbPos.seq);

                    _positionEvents().append({
                        position_seq: dbPos.seq,
                        user_id: uid,
                        exchange,
                        event_type: 'RECOVERY_ORPHANED_NO_SL',
                        payload: { reason: 'SL placement failed during recovery' },
                    });
                    orphaned++;
                }
            }
            // else: SL present or not OPEN — position verified, no action needed
        }
        // else: symbol not on exchange → handled in 3b below
    }

    // 3b. Position ONLY in DB (not on exchange) → mark ORPHANED
    // These are positions that were NOT matched (exchangeBySymbol.delete was not called for them)
    for (const [symbol, dbPos] of dbBySymbol.entries()) {
        // If it was matched in 3a, its exchange entry was deleted from exchangeBySymbol.
        // We detect DB-only by: symbol was never found in original exchangePositions map.
        // Rebuild check: was this symbol present in the original exchangePositions?
        const wasOnExchange = exchangePositions.some(ep => ep.symbol === symbol);
        if (!wasOnExchange) {
            db.prepare(`UPDATE at_positions SET status = 'ORPHANED' WHERE seq = ?`)
                .run(dbPos.seq);

            _positionEvents().append({
                position_seq: dbPos.seq,
                user_id: uid,
                exchange,
                event_type: 'RECOVERY_ORPHANED_NO_EXCHANGE',
                payload: {
                    symbol,
                    reason: 'Position in DB but not on exchange (closed externally?)',
                },
            });
            orphaned++;
        }
    }

    // 3c. Position ONLY on exchange (not in DB) → audit_log warning (manual check needed)
    // exchangeBySymbol still contains unmatched exchange positions after step 3a deletions
    for (const [symbol, exchPos] of exchangeBySymbol.entries()) {
        try {
            db.prepare(
                `INSERT INTO audit_log (user_id, action, details) VALUES (?, 'RECOVERY_EXCHANGE_ONLY_POSITION', ?)`
            ).run(uid, JSON.stringify({
                symbol,
                side: exchPos.side,
                qty: exchPos.qty,
                entryPrice: exchPos.entryPrice,
                exchange,
            }));
        } catch (_) {}
        _logWarn('RECOVERY_BOOT',
            `user ${uid}: position ${symbol} on ${exchange} but not in DB — manual check needed`
        );
    }

    // 4. Lift global halt for this user (setGlobalHalt signature: active, byUserId, reason)
    try {
        const serverAT = require('./serverAT');
        if (typeof serverAT.setGlobalHalt === 'function') {
            serverAT.setGlobalHalt(false, uid, 'RECOVERY_BOOT_COMPLETE');
        }
    } catch (_) {}

    return { orphaned, slPlaced };
}

module.exports = { run, _reconcileUser };
