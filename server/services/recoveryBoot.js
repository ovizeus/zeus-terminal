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
        // [P2c.3] Iterate ALL connected (verified) exchanges per user, not just the
        // ACTIVE one. Pre-P2c used is_active=1 → after a switch, positions on a
        // non-active connected exchange were never scanned there; they'd be compared
        // against the active exchange's held set and falsely marked ORPHANED at boot.
        const users = db.prepare(
            `SELECT DISTINCT user_id, exchange FROM exchange_accounts WHERE status = 'verified'`
        ).all();

        // [HALT-FIX] Halt lift is per-USER and decided AFTER all the user's exchanges
        // are reconciled: a user is disarmed only if reconciled cleanly on EVERY
        // exchange AND no exchange-only position was left unprotected (haltArmed). A
        // user with an errored exchange is never added → stays halted.
        const reconciledUsers = new Set();
        const haltArmedUsers = new Set();
        const erroredUsers = new Set();
        for (const { user_id: uid, exchange } of users) {
            totalUsers++;
            try {
                const result = await _reconcileUser(uid, exchange);
                totalReconciled++;
                totalOrphaned += result.orphaned;
                totalSlPlaced += result.slPlaced;
                reconciledUsers.add(uid);
                if (result.haltArmed) haltArmedUsers.add(uid);
            } catch (err) {
                errors++;
                erroredUsers.add(uid);
                _logError('RECOVERY_BOOT', `user ${uid} reconciliation failed: ${err.message}`);
                // User stays halted — don't lift their halt
            }
        }

        // Lift the halt only for users fully clean across all their exchanges.
        const serverAT = require('./serverAT');
        for (const uid of reconciledUsers) {
            if (haltArmedUsers.has(uid) || erroredUsers.has(uid)) {
                _logWarn('RECOVERY_BOOT', `uid=${uid}: global halt KEPT ARMED — unprotected position or failed exchange; manual intervention required`);
                continue;
            }
            try {
                if (typeof serverAT.setGlobalHalt === 'function') {
                    serverAT.setGlobalHalt(false, uid, 'RECOVERY_BOOT_COMPLETE');
                }
            } catch (_) {}
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
    let haltArmed = false; // [HALT-FIX] set if an unprotected exchange-only position armed globalHalt

    // 1. [P2c.3] Scan positions for THIS exchange (routed to its own creds).
    let exchangePositions;
    try {
        exchangePositions = await exchangeOps.getPositions(uid, { exchangeOverride: exchange });
    } catch (err) {
        throw new Error(`getPositions failed: ${err.message}`);
    }

    // 2. Read DB positions (OPEN + OPENING) — exclude DEMO (never on exchange) and
    // scope to THIS exchange (data.exchange, default 'binance' for legacy rows) so a
    // position on another connected exchange is reconciled in its own pass, not here.
    const dbPositionsRaw = db.prepare(
        `SELECT seq, data, status FROM at_positions WHERE user_id = ? AND status IN ('OPEN', 'OPENING')`
    ).all(uid);
    const dbPositions = dbPositionsRaw.filter(dp => {
        try {
            const d = JSON.parse(dp.data);
            if (d.mode === 'demo') return false;
            return (d.exchange || 'binance') === exchange;
        } catch (_) { return exchange === 'binance'; }
    });

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
                // Fix #12: Round stopPrice to 2dp to satisfy exchange tick size filter
                const rawStop = exchPos.side === 'SHORT'
                    ? Number(exchPos.entryPrice) * 1.05
                    : Number(exchPos.entryPrice) * 0.95;
                const stopPrice = String(Math.round(rawStop * 100) / 100);

                // [FIX 2026-05-27] Skip SL if it would immediately trigger at current mark price.
                // "Order would immediately trigger" = LONG SL above markPrice or SHORT SL below markPrice.
                const mark = Number(exchPos.markPrice);
                const stop = Number(stopPrice);
                const wouldTrigger = (exchPos.side === 'LONG' && stop >= mark) || (exchPos.side === 'SHORT' && stop <= mark);
                if (wouldTrigger) {
                    _logWarn('RECOVERY_BOOT',
                        `uid=${uid} ${symbol} ${exchPos.side}: SL $${stopPrice} would immediately trigger (mark=$${mark.toFixed(2)}) — skipping SL placement`);
                    _positionEvents().append({
                        position_seq: dbPos.seq, user_id: uid, exchange,
                        event_type: 'RECOVERY_SL_SKIP_WOULD_TRIGGER',
                        payload: { stopPrice, markPrice: mark, side: exchPos.side },
                    });
                    continue;
                }

                try {
                    const slResult = await exchangeOps.placeStopLoss(uid, {
                        symbol,
                        side: dbPos.parsedData.side || exchPos.side,
                        stopPrice,
                        quantity: exchPos.qty,       // [BUG#3] proven quantity+reduceOnly algo SL
                        decisionKey: decisionKey.generate(),
                        exchangeOverride: exchange,  // [P2c.5] place SL on THIS position's exchange
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

    // 3c. Position ONLY on exchange (not in DB) — Task E 2026-05-28 enhancement:
    // Auto-place conservative 2% adverse SL + Telegram alert. On SL failure,
    // arm globalHalt + critical Telegram (position UNPROTECTED). Preserves the
    // existing RECOVERY_EXCHANGE_ONLY_POSITION detection audit for forensics.
    // exchangeBySymbol still contains unmatched exchange positions after step 3a deletions.
    for (const [symbol, exchPos] of exchangeBySymbol.entries()) {
        // 3c.1 Forensic detection audit (preserved from pre-Task E behavior)
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
            `user ${uid}: position ${symbol} on ${exchange} but not in DB — placing conservative auto-SL`
        );

        // 3c.2 Auto-SL placement. Returns { haltArmed, slOrderId, invalid? }.
        // haltArmed → auto-SL failed → globalHalt armed; propagate so the caller keeps the halt.
        const _slRes = await _handleExchangeOnlyPosition(uid, exchange, symbol, exchPos);
        if (_slRes.haltArmed) { haltArmed = true; continue; } // UNPROTECTED + halted → do NOT adopt
        if (_slRes.invalid) continue;                          // garbage data (no SL placed) → skip adoption

        // 3c.3 [P-A Task 4] Adopt the now-protected position into serverAT tracking so it
        // PERSISTS + DISPLAYS (getLivePositions reads _positions; an exchange-only position
        // with no row flashes on refresh then vanishes — the operator-reported bug). Boot
        // semantics: protect-each-first (above), then adopt — NO mass circuit-breaker here
        // (legit post-crash multi-position recovery must not halt; each position is already
        // individually protected). The periodic _runReconciliation path uses the full
        // 8-layer _reconcileAndAdopt (double-read + circuit-breaker) for the API-glitch case.
        try {
            const serverAT = require('./serverAT');
            let env = 'TESTNET';
            try {
                const c = require('./credentialStore').getExchangeCredsFor(uid, exchange);
                env = (c && c.mode === 'testnet') ? 'TESTNET' : 'REAL';
            } catch (_) { /* default TESTNET — fail-safe (never auto-mark a position REAL on lookup error) */ }
            serverAT._adoptExternalPosition(uid, exchange, env, {
                symbol,
                side: exchPos.side,
                qty: Math.abs(Number(exchPos.qty) || 0),
                entryPrice: Number(exchPos.entryPrice) || Number(exchPos.markPrice) || 0,
                slOrderId: _slRes.slOrderId,
            });
        } catch (e) {
            // Adoption is non-fatal: the position is already protected by the auto-SL above.
            _logWarn('RECOVERY_BOOT', `uid=${uid} ${symbol}: adoption failed (position still protected by auto-SL): ${e.message}`);
        }
    }

    // [Task M 2026-05-28] Sweep orphan Zeus SL/TP orders. Runs BEFORE global
    // halt lift so any orphan-cancel failures still surface in audit. Defensive
    // — failures don't block recovery completion.
    try {
        const orderSweeper = require('./orderSweeper');
        const sweepResult = await orderSweeper.sweep(uid, exchange); // [P2c.4] sweep THIS exchange
        _logInfo('RECOVERY_BOOT',
            `uid=${uid}: order sweep — cancelled=${sweepResult.cancelled.length} preserved=${sweepResult.preserved.length} errors=${sweepResult.errors.length}`);
    } catch (e) {
        _logWarn('RECOVERY_BOOT', `uid=${uid}: order sweep failed: ${e.message}`);
    }

    // [HALT-FIX] Halt lift is decided by run() AFTER all of this user's exchanges are
    // reconciled — NOT here. Previously this disarmed the halt unconditionally, which
    // defeated a halt armed by an unprotected exchange-only position (auto-SL failed).
    return { orphaned, slPlaced, haltArmed };
}

/**
 * _handleExchangeOnlyPosition — Task E 2026-05-28
 *
 * Exchange has a position Zeus DB doesn't know about (PM2 crash mid-fill or
 * external action). Place conservative 2% adverse SL relative to CURRENT
 * markPrice (not historical entryPrice — orphan positions may be stale).
 *
 * On "would immediately trigger" rejection (race: mark moved further adversely
 * between read+write), refetch markPrice + retry ONCE with fresh value. All
 * other rejections (exchange down, signature, permission) → globalHalt + CRITICAL
 * alert immediately (no retry).
 *
 * Three audit events:
 *  - RECOVERY_EXCHANGE_ONLY_INVALID_DATA  — no markPrice + no entryPrice
 *  - RECOVERY_EXCHANGE_ONLY_AUTOSL_PLACED — success (records retried flag)
 *  - RECOVERY_EXCHANGE_ONLY_AUTOSL_FAILED — UNPROTECTED, halt armed
 */
const _SL_PCT = 0.02;

function _computeStop(side, mark) {
    const raw = side === 'LONG' ? mark * (1 - _SL_PCT) : mark * (1 + _SL_PCT);
    return String(Math.round(raw * 100) / 100);
}

function _isWouldTriggerError(err) {
    if (!err) return false;
    const s = String(err);
    // Binance -2021, Bybit 30038 / 110041, plus generic substring fallbacks.
    return /-?2021\b|\b30038\b|\b110041\b|would.{0,20}(immediately|trigger)|stop.{0,10}passed/i.test(s);
}

async function _tryPlaceStopLoss(uid, symbol, side, mark, exchange, qty) {
    const stopPrice = _computeStop(side, mark);
    try {
        const r = await exchangeOps.placeStopLoss(uid, {
            symbol, side, stopPrice, decisionKey: decisionKey.generate(),
            quantity: qty,               // [BUG#3] proven quantity+reduceOnly algo SL
            exchangeOverride: exchange,  // [P2c.5] orphan auto-SL on its own exchange
        });
        if (r && r.ok) return { ok: true, stopPrice, slOrderId: r.slOrderId || null };
        return { ok: false, stopPrice, error: (r && r.error) || 'placeStopLoss returned ok:false' };
    } catch (err) {
        return { ok: false, stopPrice, error: err && err.message ? err.message : String(err) };
    }
}

async function _handleExchangeOnlyPosition(uid, exchange, symbol, exchPos) {
    const side = exchPos.side;
    const qty = Math.abs(Number(exchPos.qty) || 0);
    // markPrice = current truth for orphan positions; entryPrice only as fallback.
    let mark = Number(exchPos.markPrice) || Number(exchPos.entryPrice) || 0;

    if (!mark || !qty) {
        _logWarn('RECOVERY_BOOT',
            `uid=${uid} ${symbol}: invalid markPrice/qty — cannot auto-SL, manual review needed`);
        try {
            db.prepare(
                `INSERT INTO audit_log (user_id, action, details) VALUES (?, 'RECOVERY_EXCHANGE_ONLY_INVALID_DATA', ?)`
            ).run(uid, JSON.stringify({
                symbol, side, qty: exchPos.qty, markPrice: exchPos.markPrice, entryPrice: exchPos.entryPrice, exchange,
            }));
        } catch (_) {}
        return { haltArmed: false, slOrderId: null, invalid: true }; // [HALT-FIX] invalid data → no halt armed (Task E behavior preserved); [P-A] no SL id
    }

    // Attempt 1: place SL at current mark ± 2%
    let result = await _tryPlaceStopLoss(uid, symbol, side, mark, exchange, qty);
    let retried = false;

    // Retry ONCE only on "would immediately trigger" — race where mark moved
    // further adverse between getPositions and placeStopLoss. Refetch fresh mark.
    if (!result.ok && _isWouldTriggerError(result.error)) {
        _logWarn('RECOVERY_BOOT',
            `uid=${uid} ${symbol}: SL would trigger at mark=${mark} (${result.error}) — refetching for retry`);
        retried = true;
        try {
            const fresh = await exchangeOps.getPositions(uid, { symbol, exchangeOverride: exchange });
            const refreshed = Array.isArray(fresh)
                ? fresh.find(p => p && p.symbol === symbol)
                : null;
            const freshMark = refreshed ? Number(refreshed.markPrice) : 0;
            if (freshMark > 0) mark = freshMark;
        } catch (_) { /* keep stale mark if refetch fails */ }
        result = await _tryPlaceStopLoss(uid, symbol, side, mark, exchange, qty);
    }

    if (result.ok) {
        _logInfo('RECOVERY_BOOT',
            `uid=${uid} ${symbol} ${side}: auto-SL placed @ $${result.stopPrice} (slOrderId=${result.slOrderId}${retried ? ' [RETRIED]' : ''})`);
        try {
            db.prepare(
                `INSERT INTO audit_log (user_id, action, details) VALUES (?, 'RECOVERY_EXCHANGE_ONLY_AUTOSL_PLACED', ?)`
            ).run(uid, JSON.stringify({
                symbol, side, qty, markPrice: mark, stopPrice: result.stopPrice,
                slOrderId: result.slOrderId, exchange, retried,
            }));
        } catch (_) {}
        try {
            const telegram = require('./telegram');
            await telegram.sendToUser(uid,
                '🔴 *EXCHANGE-ONLY POSITION DETECTED*\n'
                + '`' + symbol + '` ' + side + ' qty=' + qty + ' @ mark=' + mark.toFixed(2) + '\n'
                + 'Auto-SL placed at ' + result.stopPrice + ' (2% adverse from current mark).\n'
                + (retried ? '_Initial SL would have triggered immediately — retried after markPrice refetch._\n' : '')
                + '_Position opened on exchange but missing from Zeus DB — manual review recommended._');
        } catch (_) {}
        return { haltArmed: false, slOrderId: result.slOrderId }; // [HALT-FIX] SL placed → protected, no halt; [P-A] return SL id for adoption row
    }

    // FAIL path — UNPROTECTED. Halt + critical alert.
    _logError('RECOVERY_BOOT',
        `uid=${uid} ${symbol} ${side}: auto-SL FAILED (${result.error}) — UNPROTECTED, arming globalHalt`);
    try {
        db.prepare(
            `INSERT INTO audit_log (user_id, action, details) VALUES (?, 'RECOVERY_EXCHANGE_ONLY_AUTOSL_FAILED', ?)`
        ).run(uid, JSON.stringify({
            symbol, side, qty, markPrice: mark, stopPrice: result.stopPrice,
            error: result.error, retried, exchange,
        }));
    } catch (_) {}
    try {
        const serverAT = require('./serverAT');
        if (typeof serverAT.setGlobalHalt === 'function') {
            serverAT.setGlobalHalt(true, uid, 'RECOVERY_AUTOSL_FAILED:' + symbol);
        }
    } catch (_) {}
    try {
        const telegram = require('./telegram');
        await telegram.sendToUser(uid,
            '🚨 *CRITICAL — AUTO-SL FAILED*\n'
            + '`' + symbol + '` ' + side + ' qty=' + qty + ' is UNPROTECTED.\n'
            + 'Global halt ARMED. MANUAL INTERVENTION REQUIRED.\n'
            + 'Error: ' + result.error
            + (retried ? '\n_Retried after markPrice refetch but rejection persisted._' : ''));
    } catch (_) {}
    return { haltArmed: true, slOrderId: null }; // [HALT-FIX] auto-SL failed → halt ARMED; caller must NOT disarm this user; [P-A] no SL id (unprotected)
}

module.exports = { run, _reconcileUser, _handleExchangeOnlyPosition };
