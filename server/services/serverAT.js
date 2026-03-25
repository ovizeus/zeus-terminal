// Zeus Terminal — Server AutoTrade Engine (Unified, Per-User)
// Single source-of-truth for ALL positions (demo + live).
// Demo = simulated (no Binance calls). Live = real execution.
// Persisted in SQLite — survives restarts.
// Per-user isolation: each userId has independent state, positions, balance.
'use strict';

const logger = require('./logger');
const MF = require('../migrationFlags');
const { getExchangeCreds } = require('./credentialStore');
const { sendSignedRequest } = require('./binanceSigner');
const { roundOrderParams } = require('./exchangeInfo');
const { validateOrder, recordClosedPnL } = require('./riskGuard');
const telegram = require('./telegram');
const audit = require('./audit');
const metrics = require('./metrics');
const serverDSL = require('./serverDSL');
const db = require('./database');

// ══════════════════════════════════════════════════════════════════
// Per-User Position Tracker
// ══════════════════════════════════════════════════════════════════
const MAX_LOG = 200;
const MAX_POSITIONS = 20;

const _positions = [];          // flat array — each pos carries .userId
const _userState = new Map();   // userId → per-user engine state

const DEFAULT_DEMO_BALANCE = 10000;
function _defaultUserState() {
    return {
        log: [],
        seq: 0,
        stats: { entries: 0, exits: 0, pnl: 0, wins: 0, losses: 0 },
        engineMode: 'demo',
        demoBalance: DEFAULT_DEMO_BALANCE,
        demoStartBalance: DEFAULT_DEMO_BALANCE,
        liveStats: { entries: 0, exits: 0, pnl: 0, wins: 0, losses: 0, blocked: 0, errors: 0 },
        liveSeq: 0,
        killActive: false,
        killPct: 5,
        pnlAtReset: 0,
        liveBalanceRef: 0,
        dailyPnL: 0,
        dailyPnLDemo: 0,
        dailyPnLLive: 0,
        lastResetDay: -1,
    };
}

function _uState(userId) {
    // [MULTI-USER] Hard guard — never fall back to another user
    if (!userId) throw new Error('[AT] _uState called without userId');
    if (!_userState.has(userId)) _userState.set(userId, _defaultUserState());
    return _userState.get(userId);
}

// ── Kill Switch config (per-user, persisted in _uState) ──
// KILL_PCT and KILL_BASE removed — now per-user killPct + real balance reference

// ── Fusion tier → size multiplier ──
const TIER_MULT = { LARGE: 1.75, MEDIUM: 1.35, SMALL: 1.0 };

// ── Change listeners (WebSocket push) ──
let _onChangeCallback = null;

// ══════════════════════════════════════════════════════════════════
// Persistence — save/restore from SQLite
// ══════════════════════════════════════════════════════════════════
function _persistPosition(pos) {
    try { db.atSavePosition(pos); } catch (e) { logger.error('AT_DB', 'Save position failed: ' + e.message); }
}

function _persistClose(pos) {
    try { db.atArchiveClosed(pos); } catch (e) { logger.error('AT_DB', 'Archive closed failed: ' + e.message); }
}

function _persistState(userId) {
    const us = _uState(userId);
    try {
        db.atSetState('engine:' + userId, {
            mode: us.engineMode,
            seq: us.seq,
            liveSeq: us.liveSeq,
            stats: us.stats,
            liveStats: us.liveStats,
            demoBalance: us.demoBalance,
            demoStartBalance: us.demoStartBalance,
            dailyPnL: us.dailyPnL,
            dailyPnLDemo: us.dailyPnLDemo,
            dailyPnLLive: us.dailyPnLLive,
            killActive: us.killActive,
            killPct: us.killPct,
            pnlAtReset: us.pnlAtReset,
            liveBalanceRef: us.liveBalanceRef,
            lastResetDay: us.lastResetDay,
        }, userId);
    } catch (e) { logger.error('AT_DB', 'Save state failed: ' + e.message); }
}

function _applyStateBlob(userId, saved) {
    const us = _uState(userId);
    us.engineMode = saved.mode || 'demo';
    us.seq = saved.seq || 0;
    us.liveSeq = saved.liveSeq || 0;
    us.stats = saved.stats || { entries: 0, exits: 0, pnl: 0, wins: 0, losses: 0 };
    us.liveStats = saved.liveStats || { entries: 0, exits: 0, pnl: 0, wins: 0, losses: 0, blocked: 0, errors: 0 };
    us.demoBalance = typeof saved.demoBalance === 'number' ? saved.demoBalance : DEFAULT_DEMO_BALANCE;
    us.demoStartBalance = typeof saved.demoStartBalance === 'number' ? saved.demoStartBalance : DEFAULT_DEMO_BALANCE;
    us.dailyPnL = saved.dailyPnL || 0;
    us.dailyPnLDemo = saved.dailyPnLDemo || 0;
    us.dailyPnLLive = saved.dailyPnLLive || 0;
    us.killActive = !!saved.killActive;
    us.killPct = (typeof saved.killPct === 'number' && saved.killPct > 0) ? saved.killPct : 5;
    us.pnlAtReset = saved.pnlAtReset || 0;
    us.liveBalanceRef = saved.liveBalanceRef || 0;
    us.lastResetDay = saved.lastResetDay || -1;
    logger.info('AT_DB', `State restored uid=${userId}: mode=${us.engineMode} seq=${us.seq} balance=$${us.demoBalance.toFixed(2)}`);
}

function _restoreFromDb() {
    try {
        // [A3] Per-user restore — query distinct user IDs first, then load per-user
        const knownUserIds = db.atGetOpenUserIds();
        // Always include user 1 for engine state restore (legacy + primary)
        const userIds = new Set(knownUserIds);
        userIds.add(1);

        let restoredCount = 0;
        let skippedCount = 0;
        for (const uid of userIds) {
            const openPos = db.atLoadOpenPositions(uid);
            for (const pos of openPos) {
                // Skip positions that were emergency-closed or have non-OPEN live status stuck in DB
                if (pos.live && (pos.live.status === 'EMERGENCY_CLOSED' || pos.live.status === 'CLOSED')) {
                    logger.warn('AT_DB', `[${pos.seq}] Skipping stuck position (live.status=${pos.live.status}) — archiving as closed`);
                    try { db.atArchiveClosed(pos); } catch (_) { }
                    skippedCount++;
                    continue;
                }
                // Validate essential fields
                if (!pos.symbol || !pos.side || !pos.price || pos.price <= 0) {
                    logger.warn('AT_DB', `[${pos.seq}] Skipping corrupted position (missing fields)`);
                    skippedCount++;
                    continue;
                }
                // [C5] Reject positions without userId — do NOT default to user 1 (prevents cross-user leak)
                if (!pos.userId) {
                    logger.error('AT_DB', `[${pos.seq}] Skipping position with MISSING userId — refusing to assign default (cross-user safety)`);
                    skippedCount++;
                    continue;
                }
                _positions.push(pos);
                // Re-attach DSL with saved params or defaults
                serverDSL.attach(pos, pos.dslParams || serverDSL.DSL_DEFAULTS);
                restoredCount++;
            }
        }

        // Restore per-user engine states — [6B1] user_id-based read path
        for (const uid of userIds) {
            const rows = db.atGetStateByUser(uid);
            const engineRow = rows.find(r => r.key === 'engine:' + uid);
            const saved = engineRow ? engineRow.value : null;
            if (saved) _applyStateBlob(uid, saved);
        }

        if (restoredCount > 0) {
            logger.info('AT_DB', `Restored ${restoredCount} open position(s)${skippedCount > 0 ? ` (skipped ${skippedCount} stuck/corrupt)` : ''}`);
        } else if (skippedCount > 0) {
            logger.warn('AT_DB', `No valid positions restored (${skippedCount} skipped as stuck/corrupt)`);
        }
    } catch (e) {
        logger.error('AT_DB', 'Restore failed: ' + e.message);
    }
}

// Run restore on module load
_restoreFromDb();

// ══════════════════════════════════════════════════════════════════
// Engine mode control
// ══════════════════════════════════════════════════════════════════
function setMode(userId, mode) {
    if (mode !== 'demo' && mode !== 'live') return { ok: false, error: 'Invalid mode. Use "demo" or "live".' };

    const us = _uState(userId);
    const oldMode = us.engineMode;

    // [B1] Reject cross-switch if user has open positions
    if (mode !== oldMode) {
        const openCount = _positions.filter(p => p.userId === userId && !p.closed).length;
        if (openCount > 0) {
            logger.warn('AT_ENGINE', `Mode switch rejected uid=${userId}: ${oldMode} → ${mode} — ${openCount} open position(s)`);
            return { ok: false, error: `Cannot switch mode with ${openCount} open position(s). Close them first.` };
        }
    }

    us.engineMode = mode;
    _persistState(userId);
    logger.info('AT_ENGINE', `Mode changed uid=${userId}: ${oldMode} → ${mode}`);
    // [C4] Record mode change in audit trail for compliance
    audit.record('AT_MODE_CHANGE', { userId, oldMode, newMode: mode }, 'user');
    telegram.sendToUser(userId,
        `🔄 *AT Mode Changed*\n${oldMode.toUpperCase()} → ${mode.toUpperCase()}`
    );
    _notifyChange(userId);
    return { ok: true, mode: us.engineMode };
}

function getMode(userId) { return _uState(userId).engineMode; }

// ══════════════════════════════════════════════════════════════════
// Process a brain decision (called by serverBrain)
// ══════════════════════════════════════════════════════════════════
function processBrainDecision(decision, stc, userId) {
    if (!decision || !decision.fusion || !stc) return null;
    // [MULTI-USER] Hard guard — reject decisions without userId
    if (!userId) { logger.error('AT_ENGINE', 'processBrainDecision called without userId — skipping'); return null; }

    const us = _uState(userId);
    const fusion = decision.fusion;
    const tier = fusion.decision;
    if (tier === 'NO_TRADE' || tier === 'SKIP' || tier === 'ERROR') return null;

    const mult = TIER_MULT[tier];
    if (!mult) return null;

    const side = fusion.dir;
    if (side !== 'LONG' && side !== 'SHORT') return null;

    const price = decision.price;
    if (!price || price <= 0) return null;

    // ── Kill switch check (per-user) ──
    _checkDailyReset(userId);
    if (us.killActive) {
        logger.warn('AT_ENGINE', `Entry blocked uid=${userId} — daily kill switch active (PnL: $${us.dailyPnL.toFixed(2)})`);
        return null;
    }

    // ── Duplicate guard (per-user) ──
    const existing = _positions.find(p => p.userId === userId && p.symbol === decision.symbol && p.side === side);
    if (existing) return null;

    // ── Max positions gate (per-user) ──
    const userPosCount = _positions.filter(p => p.userId === userId).length;
    if (userPosCount >= stc.maxPos) return null;

    // ── Compute order ──
    const baseSize = stc.size;
    const lev = stc.lev;
    const slPct = stc.slPct;
    const rr = stc.rr;

    const rawSize = Math.round(baseSize * mult);
    const finalSize = Math.max(Math.round(baseSize * 0.5), Math.min(Math.round(baseSize * 1.6), rawSize));

    // ── Demo balance gate (per-user) ──
    if (us.engineMode === 'demo' && us.demoBalance < finalSize) {
        logger.warn('AT_ENGINE', `Entry blocked uid=${userId} — insufficient demo balance ($${us.demoBalance.toFixed(2)} < $${finalSize})`);
        return null;
    }

    const slDist = price * slPct / 100;
    const tpDist = slDist * rr;

    let sl, tp;
    if (side === 'LONG') { sl = price - slDist; tp = price + tpDist; }
    else { sl = price + slDist; tp = price - tpDist; }

    const qty = (finalSize * lev) / price;
    const tpPnl = (tpDist / price) * finalSize * lev;
    const slPnl = -(slDist / price) * finalSize * lev;

    // ── Build position entry ──
    const entry = {
        seq: ++us.seq,
        userId: userId,
        ts: Date.now(),
        cycle: decision.cycle,
        symbol: decision.symbol,
        side: side,
        tier: tier,
        mode: us.engineMode,        // 'demo' or 'live' — set at entry time
        price: price,
        size: finalSize,
        margin: finalSize,        // margin locked
        lev: lev,
        qty: +qty.toFixed(6),
        sl: +sl.toFixed(2),
        tp: +tp.toFixed(2),
        slPct: slPct,
        rr: rr,
        fusionMult: mult,
        confidence: fusion.confidence,
        confluenceScore: fusion.score,
        regime: decision.regime ? decision.regime.regime : null,
        tpPnl: +tpPnl.toFixed(2),
        slPnl: +slPnl.toFixed(2),
        status: 'OPEN',
        closeTs: null,
        closePnl: null,
        closeReason: null,
        dslParams: serverDSL.getPreset(stc.dslMode),
        // ── Add-on tracking (Faza 2 Batch A) ──
        originalEntry: price,
        originalSize: finalSize,
        originalQty: +qty.toFixed(6),
        addOnCount: 0,
        addOnHistory: [],
    };

    // ── Demo: deduct margin ──
    if (us.engineMode === 'demo') {
        us.demoBalance = +(us.demoBalance - finalSize).toFixed(2);
    }

    // ── Add to THE positions array ──
    _positions.push(entry);
    us.stats.entries++;

    // ── Attach DSL ──
    serverDSL.attach(entry, entry.dslParams);

    // ── Persist ──
    _persistPosition(entry);
    _persistState(userId);

    // ── Log ──
    _pushLog(userId, 'ENTRY', entry);
    logger.info('AT_ENGINE',
        `[${entry.seq}] uid=${userId} ${entry.mode.toUpperCase()} ${side} ${entry.symbol} @ $${price.toFixed(2)} | ` +
        `Size=$${finalSize} Lev=${lev}x | SL=$${entry.sl} TP=$${entry.tp} | ` +
        `Tier=${tier} Conf=${fusion.confidence}%`
    );

    // ── Telegram ──
    const modeEmoji = entry.mode === 'live' ? '🔴' : '🎮';
    telegram.sendToUser(userId,
        `📥 *${entry.mode.toUpperCase()} ENTRY*\n` +
        `${modeEmoji} ${side === 'LONG' ? '🟢' : '🔴'} \`${side}\` \`${entry.symbol}\` @ \`$${price.toFixed(0)}\`\n` +
        `Size: \`$${finalSize}\` | Lev: \`${lev}x\` | Tier: \`${tier}\`\n` +
        `SL: \`$${entry.sl.toFixed(0)}\` | TP: \`$${entry.tp.toFixed(0)}\`\n` +
        `Confidence: \`${fusion.confidence}%\` | Score: \`${fusion.score}\``
    );

    // ── Live execution (only if mode is 'live') ──
    if (entry.mode === 'live') {
        _executeLiveEntry(entry, stc).catch(err => {
            logger.error('AT_LIVE', `Live entry failed [${entry.seq}]: ${err.message}`);
            entry.live = { status: 'ERROR', error: err.message };
            _pushLog(userId, 'LIVE_ERROR', { seq: entry.seq, error: err.message });
            _uState(entry.userId).liveStats.errors++;
            _persistPosition(entry);
        });
    }

    _notifyChange(userId);
    return entry;
}

// ══════════════════════════════════════════════════════════════════
// Live Execution — Binance API calls (only for live-mode positions)
// ══════════════════════════════════════════════════════════════════
async function _executeLiveEntry(entry, stc) {
    // [MULTI-USER] Hard guard — no fallback to user 1
    if (!entry.userId) { logger.error('AT_LIVE', 'executeLiveEntry without userId — aborting'); return; }
    const userId = entry.userId;
    const us = _uState(userId);
    const creds = getExchangeCreds(userId);
    if (!creds) {
        entry.live = { status: 'NO_CREDS' };
        _pushLog(userId, 'LIVE_NO_CREDS', { seq: entry.seq });
        logger.error('AT_LIVE', `No exchange credentials for user ${userId}`);
        us.liveStats.errors++;
        return;
    }

    const risk = validateOrder({
        symbol: entry.symbol, side: entry.side, type: 'MARKET',
        quantity: entry.qty, referencePrice: entry.price, leverage: entry.lev,
    }, 'SERVER_AT', userId);

    if (!risk.ok) {
        entry.live = { status: 'RISK_BLOCKED', reason: risk.reason };
        _pushLog(userId, 'LIVE_RISK_BLOCKED', { seq: entry.seq, reason: risk.reason });
        logger.warn('AT_LIVE', `[${entry.seq}] RISK BLOCKED: ${risk.reason}`);
        telegram.alertRiskBlock(risk.reason, 'SERVER_AT', userId);
        us.liveStats.blocked++;
        return;
    }

    // [FULL-LIVE] Pre-trade margin check — verify available balance before entry
    try {
        const balances = await sendSignedRequest('GET', '/fapi/v2/balance', {}, creds);
        const usdtBal = balances.find(b => b.asset === 'USDT');
        const available = usdtBal ? parseFloat(usdtBal.availableBalance || 0) : 0;
        const requiredMargin = entry.size; // position size = required margin (before leverage)
        if (available < requiredMargin) {
            entry.live = { status: 'INSUFFICIENT_MARGIN', available, required: requiredMargin };
            _pushLog(userId, 'LIVE_MARGIN_FAIL', { seq: entry.seq, available, required: requiredMargin });
            logger.warn('AT_LIVE', `[${entry.seq}] Insufficient margin: $${available.toFixed(2)} available, $${requiredMargin} required`);
            telegram.sendToUser(userId, `⚠️ *Insufficient Margin*\n${entry.side} ${entry.symbol}\nAvailable: $${available.toFixed(2)} | Required: $${requiredMargin}\nEntry skipped to prevent margin call.`);
            us.liveStats.blocked++;
            return;
        }
        logger.info('AT_LIVE', `[${entry.seq}] Margin check OK: $${available.toFixed(2)} available, $${requiredMargin} required`);
    } catch (balErr) {
        // [B2] BLOCKING: if balance check fails, do NOT proceed — too risky without confirmation
        entry.live = { status: 'MARGIN_CHECK_FAILED', error: balErr.message };
        _pushLog(userId, 'LIVE_MARGIN_CHECK_FAILED', { seq: entry.seq, error: balErr.message });
        logger.error('AT_LIVE', `[${entry.seq}] Margin pre-check failed — BLOCKING entry: ${balErr.message}`);
        telegram.sendToUser(userId, `⚠️ *Margin Check Failed — Entry Blocked*\n${entry.side} ${entry.symbol}\nCannot verify balance. Entry skipped for safety.\nError: ${balErr.message}`);
        us.liveStats.blocked++;
        return;
    }

    const liveSeq = ++us.liveSeq;
    const clientOrderId = `SAT_${liveSeq}_${Date.now()}`;

    // Set leverage
    try {
        await sendSignedRequest('POST', '/fapi/v1/leverage', {
            symbol: entry.symbol, leverage: entry.lev,
        }, creds);
    } catch (levErr) {
        logger.warn('AT_LIVE', `[${entry.seq}] Leverage set failed (non-fatal): ${levErr.message}`);
    }

    // Round params
    const rounded = roundOrderParams(entry.symbol, entry.qty, entry.sl);
    const roundedTp = roundOrderParams(entry.symbol, entry.qty, entry.tp);
    const qty = String(rounded.quantity || entry.qty);

    // MARKET entry
    let mainOrder;
    try {
        mainOrder = await sendSignedRequest('POST', '/fapi/v1/order', {
            symbol: entry.symbol,
            side: entry.side === 'LONG' ? 'BUY' : 'SELL',
            type: 'MARKET', quantity: qty,
            newClientOrderId: clientOrderId,
        }, creds);
    } catch (err) {
        entry.live = { status: 'ENTRY_FAILED', error: err.message };
        _pushLog(userId, 'LIVE_ENTRY_FAILED', { seq: entry.seq, error: err.message });
        logger.error('AT_LIVE', `[${entry.seq}] MARKET entry failed: ${err.message}`);
        telegram.alertOrderFailed(entry.symbol, entry.side, err.message, userId);
        audit.record('SAT_ENTRY_FAILED', { seq: entry.seq, symbol: entry.symbol, side: entry.side, error: err.message }, 'SERVER_AT');
        metrics.recordOrder('failed');
        us.liveStats.errors++;
        return;
    }

    // [ZT-AUD-002] Verify fill — poll if MARKET response is incomplete
    let verifiedOrder = mainOrder;
    if (!mainOrder.avgPrice || parseFloat(mainOrder.avgPrice) <= 0 || mainOrder.status !== 'FILLED') {
        logger.warn('AT_LIVE', `[${entry.seq}] MARKET response incomplete (status=${mainOrder.status}, avgPrice=${mainOrder.avgPrice}) — polling for fill...`);
        for (let pollAttempt = 0; pollAttempt < 3; pollAttempt++) {
            await new Promise(r => setTimeout(r, 1000));
            try {
                const queried = await sendSignedRequest('GET', '/fapi/v1/order', {
                    symbol: entry.symbol, orderId: mainOrder.orderId,
                }, creds);
                if (queried.status === 'FILLED' && parseFloat(queried.avgPrice) > 0) {
                    verifiedOrder = queried;
                    logger.info('AT_LIVE', `[${entry.seq}] Fill confirmed on poll #${pollAttempt + 1}: avgPrice=${queried.avgPrice}`);
                    break;
                }
            } catch (pollErr) {
                logger.warn('AT_LIVE', `[${entry.seq}] Fill poll #${pollAttempt + 1} failed: ${pollErr.message}`);
            }
        }
    }
    if (!verifiedOrder.avgPrice || parseFloat(verifiedOrder.avgPrice) <= 0) {
        logger.error('AT_LIVE', `[${entry.seq}] CRITICAL: No verified fill price after polling — using MARKET response as-is`);
        telegram.sendToUser(userId, `⚠️ *FILL UNVERIFIED*\n${entry.symbol} ${entry.side} — avgPrice not confirmed. Monitor manually.`);
    }
    const avgPrice = parseFloat(verifiedOrder.avgPrice || 0);
    const executedQty = parseFloat(verifiedOrder.executedQty || 0);
    const closeSide = entry.side === 'LONG' ? 'SELL' : 'BUY';
    if (avgPrice <= 0 || executedQty <= 0) {
        entry.live = { status: 'FILL_UNVERIFIED', error: 'No confirmed fill data', orderId: mainOrder.orderId };
        logger.error('AT_LIVE', `[${entry.seq}] Entry aborted — no confirmed fill (avgPrice=${avgPrice}, qty=${executedQty})`);
        telegram.sendToUser(userId, `🚨 *ENTRY ABORTED*\n${entry.symbol} ${entry.side} — fill data missing. Order ${mainOrder.orderId} may be open on exchange. CHECK MANUALLY.`);
        us.liveStats.errors++;
        return;
    }

    // [FIX2] Re-round using ACTUAL executedQty (not original qty) for all downstream orders
    const fillQty = String(roundOrderParams(entry.symbol, executedQty).quantity || executedQty);

    logger.info('AT_LIVE', `[${entry.seq}] ENTRY FILLED ${entry.side} ${entry.symbol} qty=${executedQty} @ $${avgPrice}`);
    audit.record('SAT_ENTRY_FILLED', {
        seq: entry.seq, symbol: entry.symbol, side: entry.side,
        qty: executedQty, avgPrice, orderId: mainOrder.orderId, tier: entry.tier,
    }, 'SERVER_AT');
    metrics.recordOrder('filled');
    telegram.alertOrderFilled(entry.symbol, entry.side, executedQty, avgPrice, mainOrder.orderId, userId);

    // SL order with auto-retry + emergency close
    let slOrder = null;
    const SL_RETRY_DELAYS = [1000, 3000]; // [ZT-AUD-007] 1s, 3s backoff (max 4s vs old 17s)
    for (let attempt = 0; attempt <= SL_RETRY_DELAYS.length; attempt++) {
        try {
            slOrder = await sendSignedRequest('POST', '/fapi/v1/order', {
                symbol: entry.symbol, side: closeSide, type: 'STOP_MARKET',
                quantity: fillQty,
                stopPrice: String(rounded.stopPrice != null ? rounded.stopPrice : entry.sl),
                reduceOnly: true, newClientOrderId: `SAT_SL_${liveSeq}_${attempt}`,
            }, creds);
            if (attempt > 0) logger.info('AT_LIVE', `[${entry.seq}] SL order succeeded on retry #${attempt}`);
            break; // success
        } catch (slErr) {
            logger.error('AT_LIVE', `[${entry.seq}] SL order attempt ${attempt + 1}/${SL_RETRY_DELAYS.length + 1} failed: ${slErr.message}`);
            if (attempt < SL_RETRY_DELAYS.length) {
                telegram.sendToUser(userId, `⚠️ SL retry ${attempt + 1}/${SL_RETRY_DELAYS.length + 1} failed for ${entry.symbol} ${entry.side} — retrying in ${SL_RETRY_DELAYS[attempt] / 1000}s...`);
                await new Promise(r => setTimeout(r, SL_RETRY_DELAYS[attempt]));
            }
        }
    }

    // [FIX1] EMERGENCY CLOSE: if all SL retries failed, market-close + properly remove from _positions
    if (!slOrder) {
        logger.error('AT_LIVE', `[${entry.seq}] ALL SL retries exhausted — executing EMERGENCY MARKET CLOSE`);
        telegram.sendToUser(userId, `🚨 *EMERGENCY CLOSE*\n${entry.side} ${entry.symbol} @ $${avgPrice.toFixed(2)}\nAll ${SL_RETRY_DELAYS.length + 1} SL attempts failed.\nEmergency market-closing position to prevent unprotected exposure.`);
        try {
            const emgResult = await sendSignedRequest('POST', '/fapi/v1/order', {
                symbol: entry.symbol, side: closeSide, type: 'MARKET',
                quantity: fillQty, reduceOnly: true,
                newClientOrderId: `SAT_EMGCLOSE_${liveSeq}`,
            }, creds);
            const emgPrice = parseFloat(emgResult.avgPrice || avgPrice);
            const emgPnl = entry.side === 'LONG'
                ? +((emgPrice - avgPrice) / avgPrice * entry.size * entry.lev).toFixed(2)
                : +((avgPrice - emgPrice) / avgPrice * entry.size * entry.lev).toFixed(2);
            entry.live = { status: 'EMERGENCY_CLOSED', liveSeq, clientOrderId, mainOrderId: mainOrder.orderId, avgPrice, executedQty, reason: 'SL placement failed after all retries' };
            logger.warn('AT_LIVE', `[${entry.seq}] Emergency close executed @ $${emgPrice.toFixed(2)} PnL=$${emgPnl.toFixed(2)}`);
            telegram.sendToUser(userId, `✅ Emergency close EXECUTED for ${entry.symbol} ${entry.side} @ $${emgPrice.toFixed(2)} — PnL: $${emgPnl.toFixed(2)}`);
            audit.record('SAT_EMERGENCY_CLOSE', { seq: entry.seq, symbol: entry.symbol, side: entry.side, emgPrice, emgPnl, reason: 'SL_ALL_RETRIES_FAILED' }, 'SERVER_AT');
            // [FIX1] Properly close position — remove from _positions, update stats, persist
            const emgIdx = _positions.findIndex(p => p.seq === entry.seq);
            if (emgIdx >= 0) {
                _closePosition(emgIdx, entry, 'EMERGENCY_CLOSED', emgPrice, emgPnl);
            }
            return; // exit early — no TP needed, position is closed
        } catch (emgErr) {
            logger.error('AT_LIVE', `[${entry.seq}] EMERGENCY CLOSE FAILED: ${emgErr.message}`);
            telegram.sendToUser(userId, `🚨🚨 *EMERGENCY CLOSE FAILED*\n${entry.side} ${entry.symbol} @ $${avgPrice.toFixed(2)}\nPosition is UNPROTECTED on Binance.\n*IMMEDIATE MANUAL INTERVENTION REQUIRED!*\nError: ${emgErr.message}`);
        }
    }

    // TP order with retry loop [B3]
    let tpOrder = null;
    const TP_RETRY_DELAYS = [1000, 3000]; // [ZT-AUD-007] 1s, 3s backoff (consistent with SL)
    for (let tpAttempt = 0; tpAttempt <= TP_RETRY_DELAYS.length; tpAttempt++) {
        try {
            tpOrder = await sendSignedRequest('POST', '/fapi/v1/order', {
                symbol: entry.symbol, side: closeSide, type: 'TAKE_PROFIT_MARKET',
                quantity: fillQty,
                stopPrice: String(roundedTp.stopPrice != null ? roundedTp.stopPrice : entry.tp),
                reduceOnly: true, newClientOrderId: `SAT_TP_${liveSeq}_${tpAttempt}`,
            }, creds);
            if (tpAttempt > 0) logger.info('AT_LIVE', `[${entry.seq}] TP order succeeded on retry #${tpAttempt}`);
            break; // success
        } catch (tpErr) {
            logger.error('AT_LIVE', `[${entry.seq}] TP order attempt ${tpAttempt + 1}/${TP_RETRY_DELAYS.length + 1} failed: ${tpErr.message}`);
            if (tpAttempt < TP_RETRY_DELAYS.length) {
                telegram.sendToUser(userId, `⚠️ TP retry ${tpAttempt + 1}/${TP_RETRY_DELAYS.length + 1} failed for ${entry.symbol} ${entry.side} — retrying in ${TP_RETRY_DELAYS[tpAttempt] / 1000}s...`);
                await new Promise(r => setTimeout(r, TP_RETRY_DELAYS[tpAttempt]));
            }
        }
    }

    // [B3] If all TP retries failed — emergency close to prevent unprotected exposure
    if (!tpOrder && slOrder) {
        logger.error('AT_LIVE', `[${entry.seq}] ALL TP retries exhausted — executing EMERGENCY MARKET CLOSE`);
        telegram.sendToUser(userId, `🚨 *TP EMERGENCY CLOSE*\n${entry.side} ${entry.symbol} @ $${avgPrice.toFixed(2)}\nAll ${TP_RETRY_DELAYS.length + 1} TP attempts failed.\nEmergency closing — position cannot stay open without TP protection.`);
        // Cancel SL order first (we're closing the position)
        if (slOrder && slOrder.orderId) _cancelOrderSafe(entry.symbol, slOrder.orderId, creds);
        try {
            const tpEmgResult = await sendSignedRequest('POST', '/fapi/v1/order', {
                symbol: entry.symbol, side: closeSide, type: 'MARKET',
                quantity: fillQty, reduceOnly: true,
                newClientOrderId: `SAT_TPEMG_${liveSeq}`,
            }, creds);
            const tpEmgPrice = parseFloat(tpEmgResult.avgPrice || avgPrice);
            const tpEmgPnl = entry.side === 'LONG'
                ? +((tpEmgPrice - avgPrice) / avgPrice * entry.size * entry.lev).toFixed(2)
                : +((avgPrice - tpEmgPrice) / avgPrice * entry.size * entry.lev).toFixed(2);
            entry.live = { status: 'EMERGENCY_CLOSED', liveSeq, clientOrderId, mainOrderId: mainOrder.orderId, avgPrice, executedQty, reason: 'TP placement failed after all retries' };
            logger.warn('AT_LIVE', `[${entry.seq}] TP emergency close executed @ $${tpEmgPrice.toFixed(2)} PnL=$${tpEmgPnl.toFixed(2)}`);
            telegram.sendToUser(userId, `✅ TP emergency close EXECUTED for ${entry.symbol} ${entry.side} @ $${tpEmgPrice.toFixed(2)} — PnL: $${tpEmgPnl.toFixed(2)}`);
            audit.record('SAT_EMERGENCY_CLOSE', { seq: entry.seq, symbol: entry.symbol, side: entry.side, emgPrice: tpEmgPrice, emgPnl: tpEmgPnl, reason: 'TP_ALL_RETRIES_FAILED' }, 'SERVER_AT');
            const tpEmgIdx = _positions.findIndex(p => p.seq === entry.seq);
            if (tpEmgIdx >= 0) _closePosition(tpEmgIdx, entry, 'EMERGENCY_CLOSED', tpEmgPrice, tpEmgPnl);
            return; // position closed — no further processing needed
        } catch (tpEmgErr) {
            logger.error('AT_LIVE', `[${entry.seq}] TP EMERGENCY CLOSE FAILED: ${tpEmgErr.message}`);
            telegram.sendToUser(userId, `🚨🚨 *TP EMERGENCY CLOSE FAILED*\n${entry.side} ${entry.symbol} @ $${avgPrice.toFixed(2)}\nPosition has SL but NO TP protection.\n*PLACE MANUAL TP IMMEDIATELY!*\nError: ${tpEmgErr.message}`);
        }
    }

    entry.live = {
        status: (!slOrder) ? 'LIVE_NO_SL' : 'LIVE', liveSeq, clientOrderId,
        mainOrderId: mainOrder.orderId, avgPrice, executedQty,
        slOrderId: slOrder ? slOrder.orderId : null,
        tpOrderId: tpOrder ? tpOrder.orderId : null,
        slPlaced: !!slOrder, tpPlaced: !!tpOrder,
    };

    // CRITICAL: If SL still failed after retries AND emergency close also failed
    if (!slOrder) {
        logger.error('AT_LIVE', `[${entry.seq}] CRITICAL: Position LIVE without SL — emergency close also failed!`);
        telegram.sendToUser(userId, `🚨 *CRITICAL: NO SL PROTECTION*\n${entry.side} ${entry.symbol} @ $${avgPrice.toFixed(2)}\nSL retries + emergency close ALL failed.\nPosition is UNPROTECTED. Place manual SL immediately!`);
    }

    _pushLog(userId, 'LIVE_ENTRY', {
        seq: entry.seq, liveSeq, symbol: entry.symbol, side: entry.side,
        avgPrice, executedQty, mainOrderId: mainOrder.orderId,
    });

    us.liveStats.entries++;
    _persistPosition(entry);
    _persistState(userId);
}

// ══════════════════════════════════════════════════════════════════
// Live Exit — cancel remaining SL or TP
// ══════════════════════════════════════════════════════════════════
async function _handleLiveExit(pos, exitType, exitPrice, pnl) {
    if (!pos.live || (pos.live.status !== 'LIVE' && pos.live.status !== 'LIVE_NO_SL')) return;

    // [MULTI-USER] Hard guard — no fallback to user 1
    if (!pos.userId) { logger.error('AT_LIVE', 'handleLiveExit without pos.userId — aborting'); return; }
    const userId = pos.userId;
    const us = _uState(userId);
    const creds = getExchangeCreds(userId);
    if (!creds) return;

    // [FIX4] For EXPIRED: send market close and capture real fill price
    if (exitType === 'EXPIRED') {
        try {
            const closeSide = pos.side === 'LONG' ? 'SELL' : 'BUY';
            const rounded = roundOrderParams(pos.symbol, pos.live.executedQty);
            const expResult = await sendSignedRequest('POST', '/fapi/v1/order', {
                symbol: pos.symbol, side: closeSide, type: 'MARKET',
                quantity: String(rounded.quantity || pos.live.executedQty),
                reduceOnly: true, newClientOrderId: `SAT_EXP_${pos.live.liveSeq}`,
            }, creds);
            // [FIX4] Update exitPrice/pnl with actual fill price
            const realExitPrice = parseFloat(expResult.avgPrice || exitPrice);
            if (realExitPrice > 0) {
                const realPnl = pos.side === 'LONG'
                    ? +((realExitPrice - pos.price) / pos.price * pos.size * pos.lev).toFixed(2)
                    : +((pos.price - realExitPrice) / pos.price * pos.size * pos.lev).toFixed(2);
                pos.closePnl = realPnl;
                pos.closeTs = Date.now();
                exitPrice = realExitPrice;
                pnl = realPnl;
                logger.info('AT_LIVE', `[${pos.seq}] Expiry close filled @ $${realExitPrice.toFixed(2)} PnL=$${realPnl.toFixed(2)}`);
            }
        } catch (err) {
            logger.error('AT_LIVE', `[${pos.seq}] Expiry close failed: ${err.message}`);
            telegram.sendToUser(userId, `⚠️ Expiry close FAILED for ${pos.symbol} ${pos.side} — MANUAL CLOSE REQUIRED!`);
        }
        // Cancel both SL and TP after expiry close
        for (const oid of [pos.live.slOrderId, pos.live.tpOrderId]) {
            if (oid) _cancelOrderSafe(pos.symbol, oid, creds);
        }
    } else if (exitType === 'HIT_SL') {
        // SL triggered on exchange — cancel remaining TP
        if (pos.live.tpOrderId) _cancelOrderSafe(pos.symbol, pos.live.tpOrderId, creds);
    } else if (exitType === 'HIT_TP') {
        // TP triggered on exchange — cancel remaining SL
        if (pos.live.slOrderId) _cancelOrderSafe(pos.symbol, pos.live.slOrderId, creds);
    } else {
        // [FIX3] All other exit types (RECON_PHANTOM, DSL_PL, DSL_TTP, MANUAL_CLIENT, etc.)
        // Cancel BOTH remaining SL and TP orders to avoid orphans on Binance
        for (const oid of [pos.live.slOrderId, pos.live.tpOrderId]) {
            if (oid) _cancelOrderSafe(pos.symbol, oid, creds);
        }
    }

    if (pnl !== 0) recordClosedPnL(pnl, 'SERVER_AT', userId);

    pos.live.status = 'CLOSED';

    const holdMin = ((pos.closeTs - pos.ts) / 60000).toFixed(1);
    audit.record('SAT_EXIT', {
        seq: pos.seq, symbol: pos.symbol, side: pos.side,
        exitType, exitPrice, pnl, holdMin,
    }, 'SERVER_AT');

    _pushLog(userId, 'LIVE_EXIT', {
        seq: pos.seq, symbol: pos.symbol, side: pos.side,
        exitType, exitPrice, pnl, holdMin,
    });

    us.liveStats.exits++;
    us.liveStats.pnl = +(us.liveStats.pnl + pnl).toFixed(2);
    if (pnl > 0) us.liveStats.wins++;
    else if (pnl < 0) us.liveStats.losses++;

    const emoji = pnl > 0 ? '✅' : pnl < 0 ? '❌' : '⏳';
    // [AUDIT] A14 removed — A15 in _closePosition already sends unified exit alert
    logger.info('AT_LIVE', `[${pos.seq}] uid=${userId} LIVE EXIT ${exitType} ${pos.side} ${pos.symbol} PnL=$${pnl.toFixed(2)}`);
}

async function _cancelOrderSafe(symbol, orderId, creds) {
    try {
        await sendSignedRequest('DELETE', '/fapi/v1/order', { symbol, orderId }, creds);
    } catch (err) {
        logger.warn('AT_LIVE', `Cancel order ${orderId} failed: ${err.message}`);
    }
}

// ══════════════════════════════════════════════════════════════════
// _closePosition — unified close handler (SL/TP/DSL/TTP/Expire)
// ══════════════════════════════════════════════════════════════════
function _closePosition(idx, pos, exitType, price, pnl) {
    // [MULTI-USER] Hard guard — no fallback to user 1
    if (!pos.userId) { logger.error('AT_ENGINE', '_closePosition without pos.userId seq=' + pos.seq + ' — aborting'); return; }
    const userId = pos.userId;
    const us = _uState(userId);

    pos.status = exitType;
    pos.closeTs = Date.now();
    pos.closePnl = pnl;
    pos.closeReason = exitType;
    us.stats.exits++;
    us.stats.pnl = +(us.stats.pnl + pnl).toFixed(2);
    if (pnl > 0) us.stats.wins++;
    else us.stats.losses++;

    // ── Demo: refund margin + apply PnL ──
    if (pos.mode === 'demo') {
        us.demoBalance = +(us.demoBalance + pos.margin + pnl).toFixed(2);
    }

    const dslState = serverDSL.getState(pos.seq);
    _pushLog(userId, 'EXIT', {
        seq: pos.seq, symbol: pos.symbol, side: pos.side, mode: pos.mode,
        status: exitType, price, entryPrice: pos.price, pnl,
        holdMs: pos.closeTs - pos.ts,
        dslPhase: dslState ? dslState.phase : 'N/A',
    });

    const holdMin = ((pos.closeTs - pos.ts) / 60000).toFixed(0);
    logger.info('AT_ENGINE',
        `[${pos.seq}] uid=${userId} ${pos.mode.toUpperCase()} ${exitType} ${pos.side} ${pos.symbol} | ` +
        `Entry=$${pos.price.toFixed(2)} Exit=$${price.toFixed(2)} | ` +
        `PnL=$${pnl.toFixed(2)} | Hold=${holdMin}min`
    );

    const emoji = pnl > 0 ? '✅' : pnl < 0 ? '❌' : '⏳';
    const modeTag = pos.mode === 'live' ? '🔴 LIVE' : '🎮 DEMO';
    const phaseLabel = dslState ? ` | DSL: ${dslState.phase}` : '';
    telegram.sendToUser(userId,
        `${emoji} *${modeTag} EXIT — ${exitType}*\n` +
        `${pos.side === 'LONG' ? '🟢' : '🔴'} \`${pos.side}\` \`${pos.symbol}\`\n` +
        `Entry: \`$${pos.price.toFixed(0)}\` → Exit: \`$${price.toFixed(0)}\`\n` +
        `PnL: \`$${pnl.toFixed(2)}\`${phaseLabel} | Hold: \`${holdMin}min\`\n` +
        `Total: \`$${us.stats.pnl.toFixed(2)}\` | W/L: \`${us.stats.wins}/${us.stats.losses}\``
    );

    // ── Live: handle exchange exit ──
    if (pos.live && (pos.live.status === 'LIVE' || pos.live.status === 'LIVE_NO_SL')) {
        _handleLiveExit(pos, exitType, price, pnl).catch(err => {
            logger.error('AT_LIVE', `Live exit handler failed [${pos.seq}]: ${err.message}`);
        });
    }

    serverDSL.detach(pos.seq);
    us.dailyPnL = +(us.dailyPnL + pnl).toFixed(2);
    if (pos.mode === 'live') { us.dailyPnLLive = +(us.dailyPnLLive + pnl).toFixed(2); }
    else { us.dailyPnLDemo = +(us.dailyPnLDemo + pnl).toFixed(2); }
    _checkKillSwitch(userId);

    // ── Persist close + remove from active ──
    _persistClose(pos);
    _positions.splice(idx, 1);
    _persistState(userId);
    _notifyChange(userId);
}

// ══════════════════════════════════════════════════════════════════
// _updateLiveSL — move SL order on Binance when DSL tightens SL
// ══════════════════════════════════════════════════════════════════
async function _updateLiveSL(pos, newSL) {
    if (!pos.live || (pos.live.status !== 'LIVE' && pos.live.status !== 'LIVE_NO_SL') || !pos.live.slOrderId) return;
    // [MULTI-USER] Hard guard — no fallback to user 1
    if (!pos.userId) { logger.error('AT_LIVE', '_updateLiveSL without pos.userId — aborting'); return; }
    const userId = pos.userId;
    const creds = getExchangeCreds(userId);
    if (!creds) return;

    // Cancel old SL first
    let cancelOk = false;
    try {
        await _cancelOrderSafe(pos.symbol, pos.live.slOrderId, creds);
        cancelOk = true;
    } catch (_) { cancelOk = true; /* cancel failures are non-fatal — order may already be filled/expired */ }

    // Place new SL with retry logic
    const closeSide = pos.side === 'LONG' ? 'SELL' : 'BUY';
    const rounded = roundOrderParams(pos.symbol, pos.live.executedQty, newSL);
    const DSL_SL_RETRIES = [1000, 3000, 8000]; // 3 retries with backoff
    let newSlOrder = null;

    for (let attempt = 0; attempt <= DSL_SL_RETRIES.length; attempt++) {
        try {
            newSlOrder = await sendSignedRequest('POST', '/fapi/v1/order', {
                symbol: pos.symbol, side: closeSide, type: 'STOP_MARKET',
                quantity: String(rounded.quantity || pos.live.executedQty),
                stopPrice: String(rounded.stopPrice != null ? rounded.stopPrice : newSL),
                reduceOnly: true, newClientOrderId: `SAT_DSL_${pos.live.liveSeq}_${Date.now()}`,
            }, creds);
            pos.live.slOrderId = newSlOrder.orderId;
            pos.live.status = 'LIVE'; // restore from LIVE_NO_SL if was degraded
            if (attempt > 0) logger.info('AT_LIVE', `[${pos.seq}] DSL SL updated on retry #${attempt} → $${newSL.toFixed(2)}`);
            else logger.info('AT_LIVE', `[${pos.seq}] DSL SL updated → $${newSL.toFixed(2)}`);
            _persistPosition(pos);
            break;
        } catch (err) {
            logger.error('AT_LIVE', `[${pos.seq}] DSL SL update attempt ${attempt + 1} failed: ${err.message}`);
            if (attempt < DSL_SL_RETRIES.length) {
                await new Promise(r => setTimeout(r, DSL_SL_RETRIES[attempt]));
            }
        }
    }

    // If all retries failed: position is now unprotected (old SL cancelled, new SL not placed)
    if (!newSlOrder) {
        pos.live.status = 'LIVE_NO_SL';
        pos.live.slOrderId = null;
        _persistPosition(pos);
        logger.error('AT_LIVE', `[${pos.seq}] CRITICAL: DSL SL update ALL retries failed — position UNPROTECTED`);
        telegram.sendToUser(userId, `🚨 *DSL SL UPDATE FAILED*\n${pos.side} ${pos.symbol}\nOld SL cancelled, new SL ($${newSL.toFixed(2)}) could not be placed after ${DSL_SL_RETRIES.length + 1} attempts.\nPosition is *UNPROTECTED*. Place manual SL immediately!`);
    }
}

// ══════════════════════════════════════════════════════════════════
// Kill Switch
// ══════════════════════════════════════════════════════════════════
function _checkDailyReset(userId) {
    const us = _uState(userId);
    const utcDay = Math.floor(Date.now() / 86400000);
    if (utcDay !== us.lastResetDay) {
        if (us.killActive) {
            logger.info('AT_ENGINE', `Kill switch reset uid=${userId} — new UTC day`);
            telegram.sendToUser(userId, '🟢 *Kill Switch Reset*\nNew UTC day — entries re-enabled');
        }
        us.dailyPnL = 0;
        us.dailyPnLDemo = 0;
        us.dailyPnLLive = 0;
        us.pnlAtReset = 0;
        us.killActive = false;
        us.lastResetDay = utcDay;
        _persistState(userId);
    }
}

function _checkKillSwitch(userId) {
    const us = _uState(userId);
    if (us.killActive) return;
    const pct = us.killPct || 5;
    const balRef = us.engineMode === 'live'
        ? (us.liveBalanceRef > 0 ? us.liveBalanceRef : (us.demoBalance || 10000))
        : (us.demoBalance > 0 ? us.demoBalance : 10000);
    const lossLimit = +(balRef * pct / 100).toFixed(2);
    const lossSinceReset = us.dailyPnL - (us.pnlAtReset || 0);
    if (lossSinceReset <= -lossLimit && lossLimit > 0) {
        us.killActive = true;
        logger.warn('AT_ENGINE', `KILL SWITCH uid=${userId} — loss $${lossSinceReset.toFixed(2)} <= -$${lossLimit.toFixed(2)} (${pct}% of $${balRef.toFixed(0)})`);
        telegram.sendToUser(userId,
            '🛑 *KILL SWITCH ACTIVATED*\n' +
            `Daily loss: \`$${lossSinceReset.toFixed(2)}\`\n` +
            `Threshold: \`-$${lossLimit.toFixed(2)}\` (${pct}% of $${balRef.toFixed(0)})\n` +
            `Mode: ${us.engineMode.toUpperCase()}\n` +
            'All new entries *BLOCKED* until manual reset or UTC day change'
        );
        _persistState(userId);
    }
}

function activateKillSwitch(userId) {
    const us = _uState(userId);
    us.killActive = true;
    _persistState(userId);
    logger.warn('AT_ENGINE', `Kill switch manually activated uid=${userId}`);
    telegram.sendToUser(userId, '🛑 *Kill Switch MANUALLY Activated*\nAll new entries BLOCKED until manual reset or UTC day change');
    _notifyChange(userId);
    return { ok: true, killActive: true };
}

function resetKill(userId) {
    const us = _uState(userId);
    us.killActive = false;
    us.pnlAtReset = us.dailyPnL;
    _persistState(userId);
    const balRef = us.engineMode === 'live'
        ? (us.liveBalanceRef > 0 ? us.liveBalanceRef : (us.demoBalance || 10000))
        : (us.demoBalance > 0 ? us.demoBalance : 10000);
    const limit = +(balRef * (us.killPct || 5) / 100).toFixed(2);
    logger.info('AT_ENGINE', `Kill switch reset uid=${userId} — re-armed at ${us.killPct}% ($${limit} of $${balRef.toFixed(0)})`);
    telegram.sendToUser(userId, `🟢 *Kill Switch Reset*\nManually reset — re-armed at ${us.killPct}% threshold (-$${limit})`);
    _notifyChange(userId);
    return { ok: true, killActive: false, killPct: us.killPct || 5, pnlAtReset: us.pnlAtReset, dailyPnL: us.dailyPnL, dailyPnLDemo: us.dailyPnLDemo, dailyPnLLive: us.dailyPnLLive };
}

function setKillPct(userId, pct) {
    const us = _uState(userId);
    us.killPct = Math.max(1, Math.min(50, parseFloat(pct) || 5));
    _persistState(userId);
    logger.info('AT_ENGINE', `Kill threshold updated uid=${userId}: ${us.killPct}%`);
    _notifyChange(userId);
    return { ok: true, killPct: us.killPct };
}

function setLiveBalanceRef(userId, balance) {
    const us = _uState(userId);
    const bal = parseFloat(balance);
    if (Number.isFinite(bal) && bal > 0) {
        us.liveBalanceRef = bal;
        _persistState(userId);
    }
    return { ok: true, liveBalanceRef: us.liveBalanceRef };
}

// ══════════════════════════════════════════════════════════════════
// Price Update — check SL/TP/DSL exits
// ══════════════════════════════════════════════════════════════════
function onPriceUpdate(symbol, price) {
    if (!price || price <= 0) return;

    const dslChangedUsers = new Set();
    for (let i = _positions.length - 1; i >= 0; i--) {
        const pos = _positions[i];
        if (pos.symbol !== symbol) continue;
        pos._lastPrice = price; // track for client-initiated close PnL

        // [BUG3 FIX] Skip server-side automated exits when user has manual control
        if (pos.controlMode === 'user') continue;

        // ── DSL tick ──
        const dsl = serverDSL.tick(pos.seq, price);
        const effectiveSL = dsl.currentSL > 0 ? dsl.currentSL : pos.sl;

        // DSL Pivot Left exit
        if (dsl.plExit) {
            const plPnl = pos.side === 'LONG'
                ? (price - pos.price) / pos.price * pos.size * pos.lev
                : (pos.price - price) / pos.price * pos.size * pos.lev;
            _closePosition(i, pos, 'DSL_PL', price, +plPnl.toFixed(2));
            continue;
        }

        // DSL TTP exit
        if (dsl.ttpExit) {
            const ttpPnl = pos.side === 'LONG'
                ? (price - pos.price) / pos.price * pos.size * pos.lev
                : (pos.price - price) / pos.price * pos.size * pos.lev;
            _closePosition(i, pos, 'DSL_TTP', price, +ttpPnl.toFixed(2));
            continue;
        }

        // DSL moved SL → update live order on Binance
        if (dsl.changed) {
            if (pos.live && pos.live.status === 'LIVE') {
                _updateLiveSL(pos, effectiveSL).catch(err => {
                    logger.error('AT_LIVE', `[${pos.seq}] SL update failed: ${err.message}`);
                });
            }
            _persistPosition(pos);
            if (pos.userId) dslChangedUsers.add(pos.userId);
        }

        // ── Classic SL/TP check ──
        let closed = false;
        let pnl = 0;

        if (pos.side === 'LONG') {
            if (price <= effectiveSL) {
                pnl = dsl.phase !== 'WAITING'
                    ? +((price - pos.price) / pos.price * pos.size * pos.lev).toFixed(2)
                    : pos.slPnl;
                _closePosition(i, pos, 'HIT_SL', price, pnl);
                closed = true;
            } else if (price >= pos.tp) {
                _closePosition(i, pos, 'HIT_TP', price, pos.tpPnl);
                closed = true;
            }
        } else {
            if (price >= effectiveSL) {
                pnl = dsl.phase !== 'WAITING'
                    ? +((pos.price - price) / pos.price * pos.size * pos.lev).toFixed(2)
                    : pos.slPnl;
                _closePosition(i, pos, 'HIT_SL', price, pnl);
                closed = true;
            } else if (price <= pos.tp) {
                _closePosition(i, pos, 'HIT_TP', price, pos.tpPnl);
                closed = true;
            }
        }

        if (closed && pos.userId) dslChangedUsers.add(pos.userId);
    }

    // Only push DSL-SL-moved updates (not every tick)
    for (const uid of dslChangedUsers) _notifyChange(uid);
}

// ══════════════════════════════════════════════════════════════════
// Expire stale positions (>4h)
// ══════════════════════════════════════════════════════════════════
const EXPIRE_MS = 4 * 60 * 60 * 1000;
function expireStale() {
    const now = Date.now();
    for (let i = _positions.length - 1; i >= 0; i--) {
        const pos = _positions[i];
        if (now - pos.ts > EXPIRE_MS) {
            // [FIX4] Use last known market price for PnL calc, not entry price
            const exitPrice = pos._lastPrice || pos.price;
            const pnl = pos.side === 'LONG'
                ? +((exitPrice - pos.price) / pos.price * pos.size * pos.lev).toFixed(2)
                : +((pos.price - exitPrice) / pos.price * pos.size * pos.lev).toFixed(2);
            _closePosition(i, pos, 'EXPIRED', exitPrice, pnl);
        }
    }
}

// ══════════════════════════════════════════════════════════════════
// Log ring buffer (per-user)
// ══════════════════════════════════════════════════════════════════
function _pushLog(userId, type, data) {
    const us = _uState(userId);
    us.log.push({ ts: Date.now(), type, data });
    if (us.log.length > MAX_LOG) us.log.splice(0, us.log.length - MAX_LOG);
}

// ══════════════════════════════════════════════════════════════════
// Change notification (for WebSocket push — per-user)
// ══════════════════════════════════════════════════════════════════
function onChange(cb) { _onChangeCallback = cb; }

function _notifyChange(userId) {
    if (typeof _onChangeCallback === 'function') {
        try { _onChangeCallback(userId, getFullState(userId)); } catch (_) { }
    }
}

// ══════════════════════════════════════════════════════════════════
// Getters — single source of truth (per-user)
// ══════════════════════════════════════════════════════════════════
function getOpenPositions(userId) {
    return _positions.filter(p => p.userId === userId).map(p => {
        const copy = Object.assign({}, p);
        copy.dsl = serverDSL.getState(p.seq) || null;
        return copy;
    });
}

function getOpenCount(userId) { return _positions.filter(p => p.userId === userId).length; }

function getLog(userId, limit) {
    const us = _uState(userId);
    limit = Math.min(limit || 50, MAX_LOG);
    return us.log.slice(-limit);
}

function getStats(userId) {
    const us = _uState(userId);
    const wr = us.stats.exits > 0 ? +(us.stats.wins / us.stats.exits * 100).toFixed(1) : 0;
    return {
        entries: us.stats.entries,
        exits: us.stats.exits,
        openCount: _positions.filter(p => p.userId === userId).length,
        pnl: us.stats.pnl,
        wins: us.stats.wins,
        losses: us.stats.losses,
        winRate: wr,
        dailyPnL: us.dailyPnL,
        dailyPnLDemo: us.dailyPnLDemo,
        dailyPnLLive: us.dailyPnLLive,
        killActive: us.killActive,
        killPct: us.killPct || 5,
        dslStates: serverDSL.getAllStates(),
    };
}

function getLiveStats(userId) {
    const us = _uState(userId);
    const wr = us.liveStats.exits > 0 ? +(us.liveStats.wins / us.liveStats.exits * 100).toFixed(1) : 0;
    return {
        enabled: us.engineMode === 'live',
        tradingUserId: userId,
        entries: us.liveStats.entries, exits: us.liveStats.exits,
        pnl: us.liveStats.pnl, wins: us.liveStats.wins, losses: us.liveStats.losses,
        winRate: wr, blocked: us.liveStats.blocked, errors: us.liveStats.errors,
        dailyPnL: us.dailyPnLLive,
    };
}

function getLivePositions(userId) {
    // [DSL-FIX2] Include LIVE_NO_SL positions (so user can see them) + attach DSL state
    return _positions
        .filter(p => p.userId === userId && p.mode === 'live' && p.live && (p.live.status === 'LIVE' || p.live.status === 'LIVE_NO_SL'))
        .map(p => { const c = Object.assign({}, p); c.dsl = serverDSL.getState(p.seq) || null; return c; });
}

function getDemoBalance(userId) {
    const us = _uState(userId);
    return { balance: us.demoBalance, startBalance: us.demoStartBalance, pnl: +(us.demoBalance - us.demoStartBalance).toFixed(2) };
}

function getDemoStats(userId) {
    const us = _uState(userId);
    const dEntries = us.stats.entries - (us.liveStats.entries || 0);
    const dExits = us.stats.exits - (us.liveStats.exits || 0);
    const dPnl = +(us.stats.pnl - (us.liveStats.pnl || 0)).toFixed(2);
    const dWins = us.stats.wins - (us.liveStats.wins || 0);
    const dLosses = us.stats.losses - (us.liveStats.losses || 0);
    const wr = dExits > 0 ? +(dWins / dExits * 100).toFixed(1) : 0;
    return {
        entries: dEntries, exits: dExits, pnl: dPnl,
        wins: dWins, losses: dLosses, winRate: wr,
        dailyPnL: us.dailyPnLDemo,
    };
}

function getDemoPositions(userId) {
    return _positions
        .filter(p => p.userId === userId && p.mode !== 'live')
        .map(p => { const c = Object.assign({}, p); c.dsl = serverDSL.getState(p.seq) || null; return c; });
}

/** Full state snapshot for API/WebSocket consumers (per-user) */
function getFullState(userId) {
    const us = _uState(userId);
    const creds = getExchangeCreds(userId);
    return {
        mode: us.engineMode,
        enabled: true,
        apiConfigured: !!creds,
        positions: getOpenPositions(userId),
        demoPositions: getDemoPositions(userId),
        livePositions: getLivePositions(userId),
        stats: getStats(userId),
        demoStats: getDemoStats(userId),
        liveStats: getLiveStats(userId),
        demoBalance: getDemoBalance(userId),
        killActive: us.killActive,
        killPct: us.killPct || 5,
        dailyPnL: us.dailyPnL || 0,
        dailyPnLDemo: us.dailyPnLDemo || 0,
        dailyPnLLive: us.dailyPnLLive || 0,
        pnlAtReset: us.pnlAtReset || 0,
        ts: Date.now(),
    };
}

function addDemoFunds(userId, amount) {
    const us = _uState(userId);
    const amt = parseFloat(amount);
    if (!Number.isFinite(amt) || amt <= 0 || amt > 1000000) return { ok: false, error: 'Invalid amount. Must be between 1 and 1,000,000.' };
    us.demoBalance = +(us.demoBalance + amt).toFixed(2);
    _persistState(userId);
    logger.info('AT_ENGINE', `Demo funds added uid=${userId}: +$${amt} → balance $${us.demoBalance}`);
    _notifyChange(userId);
    return { ok: true, balance: us.demoBalance, added: amt };
}

function resetDemoBalance(userId) {
    const us = _uState(userId);
    us.demoBalance = DEFAULT_DEMO_BALANCE;
    us.demoStartBalance = DEFAULT_DEMO_BALANCE;
    // Reset stats but keep positions running
    us.stats = { entries: 0, exits: 0, pnl: 0, wins: 0, losses: 0 };
    us.dailyPnL = 0;
    us.dailyPnLDemo = 0;
    us.dailyPnLLive = 0;
    _persistState(userId);
    logger.info('AT_ENGINE', `Demo balance reset uid=${userId} to $${DEFAULT_DEMO_BALANCE}`);
    _notifyChange(userId);
    return { ok: true, balance: us.demoBalance, startBalance: us.demoStartBalance };
}

function reset(userId) {
    // Close all open positions for this user at current price (PnL = 0)
    for (let i = _positions.length - 1; i >= 0; i--) {
        if (_positions[i].userId === userId) {
            const pos = _positions[i];
            _closePosition(i, pos, 'RESET', pos.price, 0);
        }
    }
    const us = _uState(userId);
    us.log.length = 0;
    us.seq = 0;
    us.stats = { entries: 0, exits: 0, pnl: 0, wins: 0, losses: 0 };
    us.liveStats = { entries: 0, exits: 0, pnl: 0, wins: 0, losses: 0, blocked: 0, errors: 0 };
    us.liveSeq = 0;
    us.dailyPnL = 0;
    us.dailyPnLDemo = 0;
    us.dailyPnLLive = 0;
    us.killActive = false;
    us.demoBalance = DEFAULT_DEMO_BALANCE;
    us.demoStartBalance = DEFAULT_DEMO_BALANCE;
    _persistState(userId);
    logger.info('AT_ENGINE', `Engine fully reset uid=${userId}`);
    _notifyChange(userId);
}

// ══════════════════════════════════════════════════════════════════
// Client-initiated close — called from POST /api/at/close
// Race guard: prevents concurrent/duplicate close on same seq
// ══════════════════════════════════════════════════════════════════
const _closingGuard = new Map();
// Safety cleanup: remove stale guards older than 30s (prevents permanent lock)
setInterval(() => {
    const cutoff = Date.now() - 30000;
    for (const [key, ts] of _closingGuard) {
        if (ts < cutoff) _closingGuard.delete(key);
    }
}, 60000);

function closeBySeq(userId, seq) {
    const gk = `${userId}:${seq}`;
    if (_closingGuard.has(gk)) {
        logger.warn('AT_ENGINE', `closeBySeq race guard blocked duplicate: uid=${userId} seq=${seq}`);
        return { ok: false, error: 'Position close already in progress (seq=' + seq + ')' };
    }
    _closingGuard.set(gk, Date.now());
    let success = false;
    try {
        const idx = _positions.findIndex(p => p.seq === seq && p.userId === userId);
        if (idx < 0) return { ok: false, error: 'Position not found or already closed' };
        const pos = _positions[idx];
        // Use last known price for PnL calculation (best effort)
        const exitPrice = pos._lastPrice || pos.price;
        const pnl = pos.side === 'LONG'
            ? +((exitPrice - pos.price) / pos.price * pos.size * pos.lev).toFixed(2)
            : +((pos.price - exitPrice) / pos.price * pos.size * pos.lev).toFixed(2);
        _closePosition(idx, pos, 'MANUAL_CLIENT', exitPrice, pnl);
        success = true;
        return { ok: true, seq, pnl };
    } finally {
        if (success) {
            // Keep guard 5s for async _handleLiveExit to complete, then release
            setTimeout(() => _closingGuard.delete(gk), 5000);
        } else {
            // Failed — release immediately so user can retry
            _closingGuard.delete(gk);
        }
    }
}

// ══════════════════════════════════════════════════════════════════
// Add-On Position — server-side (Faza 2 Batch A)
// ══════════════════════════════════════════════════════════════════
const _addonGuard = new Map();
setInterval(() => {
    const cutoff = Date.now() - 30000;
    for (const [k, ts] of _addonGuard) {
        if (ts < cutoff) _addonGuard.delete(k);
    }
}, 60000);

const DEFAULT_MAX_ADDON = 3;
const ADDON_SL_RETRIES = [1000, 3000];
const ADDON_TP_RETRIES = [1000, 3000];

async function addOnPosition(userId, seq, options = {}) {
    if (!userId) return { ok: false, error: 'Missing userId' };
    if (!seq) return { ok: false, error: 'Missing seq' };

    // ── Lock: prevent double trigger on same position ──
    const gk = `${userId}:${seq}`;
    if (_addonGuard.has(gk)) {
        logger.warn('AT_ADDON', `Addon race guard blocked: uid=${userId} seq=${seq}`);
        return { ok: false, error: 'Add-on already in progress for this position' };
    }
    _addonGuard.set(gk, Date.now());

    try {
        // ── Find position ──
        const pos = _positions.find(p => p.seq === seq && p.userId === userId);
        if (!pos) return { ok: false, error: 'Position not found' };
        if (pos.status !== 'OPEN') return { ok: false, error: 'Position is not OPEN' };

        // ── Live pre-check: must have active live status ──
        if (pos.mode === 'live') {
            if (!pos.live || (pos.live.status !== 'LIVE' && pos.live.status !== 'LIVE_NO_SL')) {
                return { ok: false, error: 'Position is not in LIVE status — add-on denied' };
            }
        }

        // ── maxAddon check ──
        const maxAddon = (options.maxAddon && Number.isFinite(options.maxAddon)) ? options.maxAddon : DEFAULT_MAX_ADDON;
        if ((pos.addOnCount || 0) >= maxAddon) {
            return { ok: false, error: `Max add-ons reached (${maxAddon})` };
        }

        // ── In-profit check (needs a recent price) ──
        const curPrice = pos._lastPrice || options.currentPrice;
        if (!curPrice || curPrice <= 0) {
            return { ok: false, error: 'No current price available for profit check' };
        }
        const inProfit = pos.side === 'LONG'
            ? (curPrice > pos.price)
            : (curPrice < pos.price);
        if (!inProfit) {
            return { ok: false, error: 'Position is not in profit — add-on denied' };
        }

        // ── Addon size = 50% of original margin ──
        const origSize = pos.originalSize || pos.size;
        const addOnSize = Math.round(origSize * 0.5);
        if (addOnSize <= 0) return { ok: false, error: 'Add-on size too small' };

        // ── Demo balance check ──
        if (pos.mode === 'demo') {
            const us = _uState(userId);
            if (us.demoBalance < addOnSize) {
                return { ok: false, error: `Insufficient demo balance ($${us.demoBalance} < $${addOnSize})` };
            }
        }

        // ── Execute add-on: weighted avg ──
        const us = _uState(userId);
        const oldEntry = pos.price;
        const oldSize = pos.size;
        const newTotalSize = oldSize + addOnSize;
        const newEntry = (oldEntry * oldSize + curPrice * addOnSize) / newTotalSize;

        // Save history BEFORE mutating
        const historyEntry = {
            ts: Date.now(),
            price: curPrice,
            size: addOnSize,
            prevEntry: oldEntry,
            newEntry: +newEntry.toFixed(6),
            prevSize: oldSize,
            newSize: newTotalSize,
            count: (pos.addOnCount || 0) + 1,
        };

        // ════════════════════════════════════════════════════════════
        // LIVE ADD-ON BRANCH — Binance MARKET order + SL/TP replace
        // ════════════════════════════════════════════════════════════
        if (pos.mode === 'live') {
            const creds = getExchangeCreds(userId);
            if (!creds) return { ok: false, error: 'No exchange credentials' };

            // ── Snapshot pre-addon state for rollback ──
            const snapshot = {
                price: pos.price, size: pos.size, margin: pos.margin, qty: pos.qty,
                addOnCount: pos.addOnCount, sl: pos.sl, tp: pos.tp,
                tpPnl: pos.tpPnl, slPnl: pos.slPnl,
                addOnHistory: pos.addOnHistory ? [...pos.addOnHistory] : [],
                live: { ...pos.live },
            };

            // ── Risk validation ──
            const addonQty = +((addOnSize * pos.lev) / curPrice).toFixed(6);
            const risk = validateOrder({
                symbol: pos.symbol, side: pos.side, type: 'MARKET',
                quantity: addonQty, referencePrice: curPrice, leverage: pos.lev,
            }, 'SERVER_AT_ADDON', userId);
            if (!risk.ok) {
                return { ok: false, error: `Risk blocked: ${risk.reason}` };
            }

            // ── Margin pre-check ──
            try {
                const balances = await sendSignedRequest('GET', '/fapi/v2/balance', {}, creds);
                const usdtBal = balances.find(b => b.asset === 'USDT');
                const available = usdtBal ? parseFloat(usdtBal.availableBalance || 0) : 0;
                if (available < addOnSize) {
                    return { ok: false, error: `Insufficient margin ($${available.toFixed(2)} < $${addOnSize})` };
                }
            } catch (balErr) {
                return { ok: false, error: `Margin check failed: ${balErr.message}` };
            }

            // ── Place MARKET addon order (same side as entry — adds to position) ──
            const rounded = roundOrderParams(pos.symbol, addonQty, null);
            const addonQtyStr = String(rounded.quantity || addonQty);
            const liveSeq = pos.live.liveSeq || 0;
            const addonClientId = `SAT_ADDON_${liveSeq}_${pos.addOnCount + 1}_${Date.now()}`;

            let addonOrder;
            try {
                addonOrder = await sendSignedRequest('POST', '/fapi/v1/order', {
                    symbol: pos.symbol,
                    side: pos.side === 'LONG' ? 'BUY' : 'SELL',
                    type: 'MARKET',
                    quantity: addonQtyStr,
                    newClientOrderId: addonClientId,
                }, creds);
            } catch (err) {
                logger.error('AT_ADDON', `[${seq}] LIVE addon MARKET order failed: ${err.message}`);
                audit.record('SAT_ADDON_FAILED', { seq, symbol: pos.symbol, error: err.message }, 'SERVER_AT');
                return { ok: false, error: 'ADDON_FAILED', detail: err.message };
            }

            // ── Verify fill (poll if incomplete) ──
            let verifiedOrder = addonOrder;
            if (!addonOrder.avgPrice || parseFloat(addonOrder.avgPrice) <= 0 || addonOrder.status !== 'FILLED') {
                for (let poll = 0; poll < 3; poll++) {
                    await new Promise(r => setTimeout(r, 1000));
                    try {
                        const queried = await sendSignedRequest('GET', '/fapi/v1/order', {
                            symbol: pos.symbol, orderId: addonOrder.orderId,
                        }, creds);
                        if (queried.status === 'FILLED' && parseFloat(queried.avgPrice) > 0) {
                            verifiedOrder = queried;
                            break;
                        }
                    } catch (_) { /* continue polling */ }
                }
            }
            const fillPrice = parseFloat(verifiedOrder.avgPrice || 0);
            const fillQty = parseFloat(verifiedOrder.executedQty || 0);
            if (fillPrice <= 0 || fillQty <= 0) {
                logger.error('AT_ADDON', `[${seq}] LIVE addon fill unverified — ADDON_FAILED`);
                audit.record('SAT_ADDON_FILL_UNVERIFIED', { seq, symbol: pos.symbol, orderId: addonOrder.orderId }, 'SERVER_AT');
                return { ok: false, error: 'ADDON_FAILED', detail: 'Fill not verified' };
            }

            // ── Mutate position with actual fill data ──
            const actualAddOnSize = +(fillPrice * fillQty / pos.lev).toFixed(2);
            const actualNewTotalSize = oldSize + actualAddOnSize;
            const actualNewEntry = (oldEntry * oldSize + fillPrice * actualAddOnSize) / actualNewTotalSize;
            historyEntry.price = fillPrice;
            historyEntry.size = actualAddOnSize;
            historyEntry.newEntry = +actualNewEntry.toFixed(6);
            historyEntry.newSize = actualNewTotalSize;
            historyEntry.fillQty = fillQty;
            historyEntry.orderId = addonOrder.orderId;

            pos.price = +actualNewEntry.toFixed(6);
            pos.size = actualNewTotalSize;
            pos.margin = actualNewTotalSize;
            const totalQty = +(pos.live.executedQty + fillQty);
            pos.qty = +totalQty.toFixed(6);
            pos.addOnCount = (pos.addOnCount || 0) + 1;
            if (!pos.addOnHistory) pos.addOnHistory = [];
            pos.addOnHistory.push(historyEntry);

            // ── Recalc SL/TP from new weighted entry ──
            const slDist = pos.price * pos.slPct / 100;
            const tpDist = slDist * (pos.rr || 2);
            if (pos.side === 'LONG') {
                pos.sl = +(pos.price - slDist).toFixed(2);
                pos.tp = +(pos.price + tpDist).toFixed(2);
            } else {
                pos.sl = +(pos.price + slDist).toFixed(2);
                pos.tp = +(pos.price - tpDist).toFixed(2);
            }
            pos.tpPnl = +((tpDist / pos.price) * pos.size * pos.lev).toFixed(2);
            pos.slPnl = +-((slDist / pos.price) * pos.size * pos.lev).toFixed(2);

            // ── Cancel old SL/TP orders ──
            if (pos.live.slOrderId) await _cancelOrderSafe(pos.symbol, pos.live.slOrderId, creds);
            if (pos.live.tpOrderId) await _cancelOrderSafe(pos.symbol, pos.live.tpOrderId, creds);

            // ── Place new SL with total qty ──
            const closeSide = pos.side === 'LONG' ? 'SELL' : 'BUY';
            const totalRounded = roundOrderParams(pos.symbol, totalQty, pos.sl);
            const totalRoundedTp = roundOrderParams(pos.symbol, totalQty, pos.tp);
            const totalQtyStr = String(totalRounded.quantity || totalQty);
            let newSlOrder = null;
            for (let attempt = 0; attempt <= ADDON_SL_RETRIES.length; attempt++) {
                try {
                    newSlOrder = await sendSignedRequest('POST', '/fapi/v1/order', {
                        symbol: pos.symbol, side: closeSide, type: 'STOP_MARKET',
                        quantity: totalQtyStr,
                        stopPrice: String(totalRounded.stopPrice != null ? totalRounded.stopPrice : pos.sl),
                        reduceOnly: true, newClientOrderId: `SAT_ADONSL_${liveSeq}_${pos.addOnCount}_${attempt}`,
                    }, creds);
                    break;
                } catch (slErr) {
                    logger.error('AT_ADDON', `[${seq}] Addon SL attempt ${attempt + 1} failed: ${slErr.message}`);
                    if (attempt < ADDON_SL_RETRIES.length) {
                        await new Promise(r => setTimeout(r, ADDON_SL_RETRIES[attempt]));
                    }
                }
            }

            // ── Place new TP with total qty ──
            let newTpOrder = null;
            for (let attempt = 0; attempt <= ADDON_TP_RETRIES.length; attempt++) {
                try {
                    newTpOrder = await sendSignedRequest('POST', '/fapi/v1/order', {
                        symbol: pos.symbol, side: closeSide, type: 'TAKE_PROFIT_MARKET',
                        quantity: totalQtyStr,
                        stopPrice: String(totalRoundedTp.stopPrice != null ? totalRoundedTp.stopPrice : pos.tp),
                        reduceOnly: true, newClientOrderId: `SAT_ADONTP_${liveSeq}_${pos.addOnCount}_${attempt}`,
                    }, creds);
                    break;
                } catch (tpErr) {
                    logger.error('AT_ADDON', `[${seq}] Addon TP attempt ${attempt + 1} failed: ${tpErr.message}`);
                    if (attempt < ADDON_TP_RETRIES.length) {
                        await new Promise(r => setTimeout(r, ADDON_TP_RETRIES[attempt]));
                    }
                }
            }

            // ── If SL/TP both failed: rollback position state, but MARKET order is filled ──
            // Position is live with increased size — warn user for manual SL/TP
            if (!newSlOrder && !newTpOrder) {
                logger.error('AT_ADDON', `[${seq}] CRITICAL: Addon SL+TP both failed — position unprotected at new size`);
                pos.live.status = 'LIVE_NO_SL';
                pos.live.slOrderId = null;
                pos.live.tpOrderId = null;
                pos.live.executedQty = totalQty;
                _persistPosition(pos);
                telegram.sendToUser(userId,
                    `🚨 *ADDON SL+TP FAILED*\n${pos.side} ${pos.symbol}\n` +
                    `Addon MARKET filled but SL+TP placement failed.\n` +
                    `Position size: $${pos.size} | Qty: ${totalQty}\n` +
                    `*PLACE MANUAL SL/TP IMMEDIATELY!*`
                );
                audit.record('SAT_ADDON_SLTP_FAILED', { seq, symbol: pos.symbol, totalQty }, 'SERVER_AT');
            } else {
                // ── Update live state with new order IDs ──
                pos.live.slOrderId = newSlOrder ? newSlOrder.orderId : null;
                pos.live.tpOrderId = newTpOrder ? newTpOrder.orderId : null;
                pos.live.executedQty = totalQty;
                pos.live.status = newSlOrder ? 'LIVE' : 'LIVE_NO_SL';
                pos.live.slPlaced = !!newSlOrder;
                pos.live.tpPlaced = !!newTpOrder;
            }

            // ── Reconcile qty with Binance positionAmt ──
            try {
                const posRisk = await sendSignedRequest('GET', '/fapi/v2/positionRisk', { symbol: pos.symbol }, creds);
                const bPos = posRisk.find(p => parseFloat(p.positionAmt) !== 0);
                if (bPos) {
                    const exchangeQty = Math.abs(parseFloat(bPos.positionAmt));
                    if (Math.abs(exchangeQty - totalQty) > 0.001) {
                        logger.warn('AT_ADDON', `[${seq}] Qty mismatch after addon: internal=${totalQty} exchange=${exchangeQty}`);
                        pos.qty = exchangeQty;
                        pos.live.executedQty = exchangeQty;
                        audit.record('SAT_ADDON_QTY_RESYNCED', { seq, symbol: pos.symbol, internal: totalQty, exchange: exchangeQty }, 'SERVER_AT');
                    }
                }
            } catch (reconErr) {
                logger.warn('AT_ADDON', `[${seq}] Post-addon reconciliation failed: ${reconErr.message}`);
            }

            // ── Re-attach DSL with new SL ──
            serverDSL.attach(pos, pos.dslParams);

            // ── Persist + broadcast ──
            _persistPosition(pos);
            _persistState(userId);
            _pushLog(userId, 'ADDON', { seq, addOnCount: pos.addOnCount, price: fillPrice, size: actualAddOnSize, newEntry: pos.price, newSize: pos.size, mode: 'live', orderId: addonOrder.orderId });
            _notifyChange(userId);

            logger.info('AT_ADDON',
                `[${seq}] uid=${userId} LIVE ADD-ON #${pos.addOnCount} @ $${fillPrice.toFixed(2)} | ` +
                `Size +$${actualAddOnSize} → $${pos.size} | Entry $${oldEntry.toFixed(2)} → $${pos.price} | ` +
                `SL=$${pos.sl} TP=$${pos.tp} | Qty=${totalQty}`
            );

            telegram.sendToUser(userId,
                `➕ *LIVE ADD-ON #${pos.addOnCount}*\n` +
                `${pos.side === 'LONG' ? '🟢' : '🔴'} \`${pos.side}\` \`${pos.symbol}\` @ \`$${fillPrice.toFixed(2)}\`\n` +
                `Margin: \`+$${actualAddOnSize}\` → \`$${pos.size}\`\n` +
                `Entry: \`$${oldEntry.toFixed(2)}\` → \`$${pos.price}\`\n` +
                `SL: \`$${pos.sl}\` | TP: \`$${pos.tp}\`\n` +
                `Qty: \`${totalQty}\` | OrderID: \`${addonOrder.orderId}\``
            );

            metrics.recordOrder('addon_filled');
            audit.record('SAT_ADDON_FILLED', {
                seq, symbol: pos.symbol, side: pos.side,
                addonQty: fillQty, fillPrice, totalQty,
                addonCount: pos.addOnCount, orderId: addonOrder.orderId,
            }, 'SERVER_AT');

            return {
                ok: true, seq, addOnCount: pos.addOnCount,
                price: fillPrice, addOnSize: actualAddOnSize,
                newEntry: pos.price, newSize: pos.size,
                newQty: pos.qty, newSl: pos.sl, newTp: pos.tp,
                mode: 'live', orderId: addonOrder.orderId,
            };
        }

        // ════════════════════════════════════════════════════════════
        // DEMO ADD-ON BRANCH (original logic)
        // ════════════════════════════════════════════════════════════

        // ── Mutate position ──
        pos.price = +newEntry.toFixed(6);
        pos.size = newTotalSize;
        pos.margin = newTotalSize;
        pos.qty = +((newTotalSize * pos.lev) / pos.price).toFixed(6);
        pos.addOnCount = (pos.addOnCount || 0) + 1;
        if (!pos.addOnHistory) pos.addOnHistory = [];
        pos.addOnHistory.push(historyEntry);

        // ── Recalc SL/TP from new entry ──
        const slDist = pos.price * pos.slPct / 100;
        const tpDist = slDist * (pos.rr || 2);
        if (pos.side === 'LONG') {
            pos.sl = +(pos.price - slDist).toFixed(2);
            pos.tp = +(pos.price + tpDist).toFixed(2);
        } else {
            pos.sl = +(pos.price + slDist).toFixed(2);
            pos.tp = +(pos.price - tpDist).toFixed(2);
        }

        // ── Recalc expected PnL at SL/TP ──
        pos.tpPnl = +((tpDist / pos.price) * pos.size * pos.lev).toFixed(2);
        pos.slPnl = +-((slDist / pos.price) * pos.size * pos.lev).toFixed(2);

        // ── Deduct demo balance ──
        if (pos.mode === 'demo') {
            us.demoBalance = +(us.demoBalance - addOnSize).toFixed(2);
        }

        // ── Re-attach DSL with new SL ──
        serverDSL.attach(pos, pos.dslParams);

        // ── Persist + broadcast ──
        _persistPosition(pos);
        _persistState(userId);
        _pushLog(userId, 'ADDON', { seq, addOnCount: pos.addOnCount, price: curPrice, size: addOnSize, newEntry: pos.price, newSize: pos.size });
        _notifyChange(userId);

        logger.info('AT_ADDON',
            `[${seq}] uid=${userId} ADD-ON #${pos.addOnCount} @ $${curPrice.toFixed(2)} | ` +
            `Size +$${addOnSize} → $${pos.size} | Entry $${oldEntry.toFixed(2)} → $${pos.price} | ` +
            `SL=$${pos.sl} TP=$${pos.tp}`
        );

        telegram.sendToUser(userId,
            `➕ *ADD-ON #${pos.addOnCount}*\n` +
            `${pos.side === 'LONG' ? '🟢' : '🔴'} \`${pos.side}\` \`${pos.symbol}\` @ \`$${curPrice.toFixed(0)}\`\n` +
            `Margin: \`+$${addOnSize}\` → \`$${pos.size}\`\n` +
            `Entry: \`$${oldEntry.toFixed(0)}\` → \`$${pos.price}\`\n` +
            `SL: \`$${pos.sl}\` | TP: \`$${pos.tp}\``
        );

        return {
            ok: true,
            seq,
            addOnCount: pos.addOnCount,
            price: curPrice,
            addOnSize,
            newEntry: pos.price,
            newSize: pos.size,
            newQty: pos.qty,
            newSl: pos.sl,
            newTp: pos.tp,
        };
    } finally {
        // Release guard after 3s (allow re-attempt)
        setTimeout(() => _addonGuard.delete(gk), 3000);
    }
}

// ══════════════════════════════════════════════════════════════════
// Client-initiated controlMode update — called from POST /api/at/control
// ══════════════════════════════════════════════════════════════════
function updateControlMode(userId, seq, controlMode, dslParams) {
    const pos = _positions.find(p => p.seq === seq && p.userId === userId);
    if (!pos) return { ok: false, error: 'Position not found' };
    const allowed = ['auto', 'assist', 'user'];
    if (!allowed.includes(controlMode)) return { ok: false, error: 'Invalid controlMode' };
    pos.controlMode = controlMode;
    // When releasing from user control, apply user-edited dslParams so AI resumes from them
    if (dslParams && typeof dslParams === 'object') {
        _applyUserDslParams(pos, dslParams);
    }
    _persistPosition(pos);
    _notifyChange(userId);
    return { ok: true, seq, controlMode };
}

// Apply user-edited DSL params to a position + re-attach server DSL engine
function _applyUserDslParams(pos, dslParams) {
    const ALLOWED = ['openDslPct', 'pivotLeftPct', 'pivotRightPct', 'impulseVPct', 'dslTargetPrice'];
    if (!pos.dslParams) pos.dslParams = {};
    for (const k of ALLOWED) {
        if (k in dslParams) {
            const v = parseFloat(dslParams[k]);
            if (Number.isFinite(v) && v > 0) pos.dslParams[k] = v;
        }
    }
    // Re-attach DSL engine with updated params so tick() uses them
    serverDSL.attach(pos, pos.dslParams);
    logger.info('AT_DSL', `[S${pos.seq}] User dslParams applied: ${JSON.stringify(pos.dslParams)}`);
}

// Client pushes dslParams during Take Control (controlMode === 'user')
function updateDslParams(userId, seq, dslParams) {
    const pos = _positions.find(p => p.seq === seq && p.userId === userId);
    if (!pos) return { ok: false, error: 'Position not found' };
    if (pos.controlMode !== 'user') return { ok: false, error: 'Not in user control' };
    _applyUserDslParams(pos, dslParams);
    _persistPosition(pos);
    return { ok: true, seq };
}

// ══════════════════════════════════════════════════════════════════
// [FULL-LIVE] Position Reconciliation + Order Health Monitor
// Periodic check: Binance real state vs server tracked state
// ══════════════════════════════════════════════════════════════════
const RECON_INTERVAL_MS = 60000; // 60s
let _reconTimer = null;
let _reconRunning = false;
// [AUDIT] Per-user recon alert deduplication — prevents Telegram spam for recurring issues
const _reconAlerted = {
    orphans: new Set(),    // "userId:symbol:side" — alerted once per orphan
    slFails: new Set(),    // "userId:seq" — alerted once per SL re-fail
    tpFails: new Set(),    // "userId:seq" — alerted once per TP re-fail
};

async function _runReconciliation(isStartup) {
    if (_reconRunning) return;
    _reconRunning = true;
    const label = isStartup ? 'STARTUP_RECON' : 'RECON';
    try {
        const livePositions = _positions.filter(p => p.mode === 'live' && p.live && (p.live.status === 'LIVE' || p.live.status === 'LIVE_NO_SL'));
        if (livePositions.length === 0) { _reconRunning = false; return; }

        // Group live positions by userId for per-user reconciliation
        const byUser = new Map();
        for (const p of livePositions) {
            // [MULTI-USER] Skip positions without userId instead of defaulting to 1
            if (!p.userId) { logger.warn(label, `Skipping live position seq=${p.seq} without userId`); continue; }
            const uid = p.userId;
            if (!byUser.has(uid)) byUser.set(uid, []);
            byUser.get(uid).push(p);
        }

        for (const [userId, userLivePositions] of byUser) {
            const creds = getExchangeCreds(userId);
            if (!creds) continue;

            // 1. Query Binance position risk
            let binancePositions;
            try {
                binancePositions = await sendSignedRequest('GET', '/fapi/v2/positionRisk', {}, creds);
            } catch (err) {
                logger.warn(label, `Binance positionRisk query failed uid=${userId}: ${err.message}`);
                continue;
            }

            // Build set of actively-held Binance symbols (non-zero positionAmt)
            const binanceHeld = new Map();
            for (const bp of binancePositions) {
                const amt = parseFloat(bp.positionAmt || 0);
                if (amt !== 0) {
                    binanceHeld.set(bp.symbol, {
                        amt, side: amt > 0 ? 'LONG' : 'SHORT',
                        entryPrice: parseFloat(bp.entryPrice || 0),
                        markPrice: parseFloat(bp.markPrice || 0),
                        unrealizedProfit: parseFloat(bp.unRealizedProfit || 0),
                    });
                }
            }

            // 2. Check each server live position against Binance
            for (let i = userLivePositions.length - 1; i >= 0; i--) {
                const pos = userLivePositions[i];
                const bpos = binanceHeld.get(pos.symbol);

                // PHANTOM: server says position exists, Binance says no
                if (!bpos || bpos.side !== pos.side) {
                    logger.warn(label, `[${pos.seq}] PHANTOM DETECTED uid=${userId}: ${pos.side} ${pos.symbol} not found on Binance — closing locally`);
                    telegram.sendToUser(userId,
                        `🔍 *RECON: Phantom Position Removed*\n${pos.side} ${pos.symbol} seq=${pos.seq}\nPosition not found on Binance — likely closed externally (SL/TP hit, liquidation, or manual close).\nRemoving from server tracker.`
                    );
                    const idx = _positions.findIndex(p => p.seq === pos.seq);
                    if (idx >= 0) {
                        const exitPrice = bpos ? bpos.markPrice : (pos._lastPrice || pos.price);
                        const pnl = pos.side === 'LONG'
                            ? +((exitPrice - pos.price) / pos.price * pos.size * pos.lev).toFixed(2)
                            : +((pos.price - exitPrice) / pos.price * pos.size * pos.lev).toFixed(2);
                        _closePosition(idx, pos, 'RECON_PHANTOM', exitPrice, pnl);
                    }
                    audit.record('SAT_RECON_PHANTOM', { seq: pos.seq, symbol: pos.symbol, side: pos.side, userId }, 'SERVER_AT');
                    continue;
                }

                // Position exists on Binance — now check order health
                await _checkOrderHealth(pos, creds, label);
            }

            // 3. Check for ORPHAN positions (Binance has, server doesn't track)
            for (const [symbol, bpos] of binanceHeld) {
                const tracked = userLivePositions.find(p => p.symbol === symbol && p.side === bpos.side);
                if (!tracked) {
                    logger.warn(label, `ORPHAN on Binance uid=${userId}: ${bpos.side} ${symbol} amt=${bpos.amt} — not tracked by server`);
                    // [AUDIT] Per-user dedupe — alert once per orphan, not every recon cycle
                    const _orphanKey = `${userId}:${symbol}:${bpos.side}`;
                    if (!_reconAlerted.orphans.has(_orphanKey)) {
                        _reconAlerted.orphans.add(_orphanKey);
                        telegram.sendToUser(userId,
                            `⚠️ *RECON: Orphan Position on Binance*\n${bpos.side} ${symbol} | Qty: ${bpos.amt}\nEntry: $${bpos.entryPrice.toFixed(2)} | Mark: $${bpos.markPrice.toFixed(2)} | uPnL: $${bpos.unrealizedProfit.toFixed(2)}\nThis position is NOT tracked by the server.\nManual review required.`
                        );
                    }
                    audit.record('SAT_RECON_ORPHAN', { symbol, side: bpos.side, amt: bpos.amt, userId }, 'SERVER_AT');
                }
            }

            if (isStartup && userLivePositions.length > 0) {
                logger.info(label, `Startup recon uid=${userId} complete — ${userLivePositions.length} live positions checked, ${binanceHeld.size} Binance positions found`);
            }
        }
    } catch (err) {
        logger.error('RECON', `Reconciliation error: ${err.message}`);
    }
    _reconRunning = false;
}

// ══════════════════════════════════════════════════════════════════
// [FULL-LIVE] Order Health Monitor — verify SL/TP orders still active
// ══════════════════════════════════════════════════════════════════
async function _checkOrderHealth(pos, creds, label) {
    if (!pos.live) return;
    // [MULTI-USER] Hard guard — no fallback to user 1
    if (!pos.userId) { logger.error(label, '_checkOrderHealth without pos.userId seq=' + pos.seq); return; }
    const userId = pos.userId;
    let openOrders;
    try {
        openOrders = await sendSignedRequest('GET', '/fapi/v1/openOrders', { symbol: pos.symbol }, creds);
    } catch (err) {
        logger.warn(label, `[${pos.seq}] openOrders query failed: ${err.message}`);
        return;
    }

    const orderIds = new Set(openOrders.map(o => o.orderId));

    // Check SL order
    if (pos.live.slOrderId && !orderIds.has(pos.live.slOrderId)) {
        logger.warn(label, `[${pos.seq}] SL order ${pos.live.slOrderId} MISSING from Binance — attempting re-placement`);
        const closeSide = pos.side === 'LONG' ? 'SELL' : 'BUY';
        // [DSL-FIX1] Use DSL-tightened SL if active (restore to the level the SL was already at), else original
        const dslSnap = serverDSL.getState(pos.seq);
        const currentSL = (dslSnap && dslSnap.active && dslSnap.currentSL > 0) ? dslSnap.currentSL : pos.sl;
        const rounded = roundOrderParams(pos.symbol, pos.live.executedQty, currentSL);
        let replaced = false;
        try {
            const newSl = await sendSignedRequest('POST', '/fapi/v1/order', {
                symbol: pos.symbol, side: closeSide, type: 'STOP_MARKET',
                quantity: String(rounded.quantity || pos.live.executedQty),
                stopPrice: String(rounded.stopPrice != null ? rounded.stopPrice : currentSL),
                reduceOnly: true, newClientOrderId: `SAT_RESLOT_${pos.live.liveSeq}_${Date.now()}`,
            }, creds);
            pos.live.slOrderId = newSl.orderId;
            pos.live.status = 'LIVE';
            replaced = true;
            logger.info(label, `[${pos.seq}] SL re-placed successfully → orderId=${newSl.orderId}`);
            telegram.sendToUser(userId, `✅ *SL Re-placed*\n${pos.side} ${pos.symbol}\nSL order was missing on Binance — automatically re-placed at $${currentSL.toFixed(2)}`);
        } catch (err) {
            pos.live.status = 'LIVE_NO_SL';
            pos.live.slOrderId = null;
            logger.error(label, `[${pos.seq}] SL re-placement FAILED: ${err.message}`);
            // [AUDIT] Per-user dedupe — alert once per position, not every recon cycle
            const _slFailKey = `${userId}:${pos.seq}`;
            if (!_reconAlerted.slFails.has(_slFailKey)) {
                _reconAlerted.slFails.add(_slFailKey);
                telegram.sendToUser(userId, `🚨 *SL Re-placement FAILED*\n${pos.side} ${pos.symbol}\nSL was missing and could not be re-placed.\nPosition is *UNPROTECTED*. Manual SL required!\nError: ${err.message}`);
            }
        }
        _persistPosition(pos);
    }

    // Check TP order
    if (pos.live.tpOrderId && !orderIds.has(pos.live.tpOrderId)) {
        logger.warn(label, `[${pos.seq}] TP order ${pos.live.tpOrderId} MISSING from Binance — attempting re-placement`);
        const closeSide = pos.side === 'LONG' ? 'SELL' : 'BUY';
        const roundedTp = roundOrderParams(pos.symbol, pos.live.executedQty, pos.tp);
        try {
            const newTp = await sendSignedRequest('POST', '/fapi/v1/order', {
                symbol: pos.symbol, side: closeSide, type: 'TAKE_PROFIT_MARKET',
                quantity: String(roundedTp.quantity || pos.live.executedQty),
                stopPrice: String(roundedTp.stopPrice != null ? roundedTp.stopPrice : pos.tp),
                reduceOnly: true, newClientOrderId: `SAT_RETPOT_${pos.live.liveSeq}_${Date.now()}`,
            }, creds);
            pos.live.tpOrderId = newTp.orderId;
            logger.info(label, `[${pos.seq}] TP re-placed successfully → orderId=${newTp.orderId}`);
        } catch (err) {
            pos.live.tpOrderId = null;
            logger.warn(label, `[${pos.seq}] TP re-placement failed: ${err.message}`);
            // [AUDIT] Per-user dedupe — alert once per position, not every recon cycle
            const _tpFailKey = `${userId}:${pos.seq}`;
            if (!_reconAlerted.tpFails.has(_tpFailKey)) {
                _reconAlerted.tpFails.add(_tpFailKey);
                telegram.sendToUser(userId, `⚠️ TP re-placement failed for ${pos.side} ${pos.symbol}\nManual TP may be required.`);
            }
        }
        _persistPosition(pos);
    }
}

// Start periodic reconciliation (called once after module init)
function _startReconciliation() {
    if (_reconTimer) return;
    // Run startup reconciliation immediately (delayed 5s for boot settling)
    setTimeout(() => _runReconciliation(true), 5000);
    // Then run every 60s
    _reconTimer = setInterval(() => _runReconciliation(false), RECON_INTERVAL_MS);
    logger.info('RECON', `Reconciliation service started — interval ${RECON_INTERVAL_MS / 1000}s`);
}

// Auto-start reconciliation on module load
_startReconciliation();

// ══════════════════════════════════════════════════════════════════
// LIVE_NO_SL Watchdog — periodically retry SL for unprotected positions
// Covers the gap where entry SL failed, emergency close also failed,
// and recon only checks existing slOrderId (skips null).
// ══════════════════════════════════════════════════════════════════
const WATCHDOG_INTERVAL_MS = 30000; // 30s
let _watchdogRunning = false;
const _watchdogAlerted = new Set(); // "userId:seq" — throttle Telegram alerts

async function _watchdogLiveNoSL() {
    if (_watchdogRunning) return;
    _watchdogRunning = true;
    try {
        const targets = _positions.filter(p =>
            p.status === 'OPEN' && p.live &&
            p.live.status === 'LIVE_NO_SL' && !p.live.slOrderId
        );
        if (targets.length === 0) return;
        logger.warn('WATCHDOG', `Found ${targets.length} LIVE_NO_SL position(s) — attempting SL repair`);

        for (const pos of targets) {
            if (!pos.userId) continue;
            const userId = pos.userId;
            const creds = getExchangeCreds(userId);
            if (!creds) continue;

            const closeSide = pos.side === 'LONG' ? 'SELL' : 'BUY';
            const dslSnap = serverDSL.getState(pos.seq);
            const currentSL = (dslSnap && dslSnap.active && dslSnap.currentSL > 0) ? dslSnap.currentSL : pos.sl;
            const rounded = roundOrderParams(pos.symbol, pos.live.executedQty, currentSL);

            try {
                const newSl = await sendSignedRequest('POST', '/fapi/v1/order', {
                    symbol: pos.symbol, side: closeSide, type: 'STOP_MARKET',
                    quantity: String(rounded.quantity || pos.live.executedQty),
                    stopPrice: String(rounded.stopPrice != null ? rounded.stopPrice : currentSL),
                    reduceOnly: true,
                    newClientOrderId: `SAT_WD_${pos.live.liveSeq}_${Date.now()}`,
                }, creds);
                pos.live.slOrderId = newSl.orderId;
                pos.live.status = 'LIVE';
                pos.live.slPlaced = true;
                _persistPosition(pos);
                _watchdogAlerted.delete(`${userId}:${pos.seq}`);
                logger.info('WATCHDOG', `[${pos.seq}] SL repaired → orderId=${newSl.orderId} @ $${currentSL}`);
                telegram.sendToUser(userId, `✅ *Watchdog SL Repair*\n${pos.side} ${pos.symbol}\nSL successfully placed at $${currentSL}\nPosition is now protected.`);
            } catch (err) {
                logger.error('WATCHDOG', `[${pos.seq}] SL repair failed: ${err.message}`);
                const alertKey = `${userId}:${pos.seq}`;
                if (!_watchdogAlerted.has(alertKey)) {
                    _watchdogAlerted.add(alertKey);
                    telegram.sendToUser(userId, `🚨 *Watchdog: SL Repair Failed*\n${pos.side} ${pos.symbol}\nPosition remains *UNPROTECTED*.\nWatchdog will keep retrying every ${WATCHDOG_INTERVAL_MS / 1000}s.\nError: ${err.message}`);
                }
            }
        }
    } catch (err) {
        logger.error('WATCHDOG', `Watchdog cycle error: ${err.message}`);
    } finally {
        _watchdogRunning = false;
    }
}

// Start watchdog on module load (delayed 15s for boot settling)
let _watchdogTimer = null;
setTimeout(() => {
    _watchdogTimer = setInterval(_watchdogLiveNoSL, WATCHDOG_INTERVAL_MS);
    logger.info('WATCHDOG', `LIVE_NO_SL watchdog started — interval ${WATCHDOG_INTERVAL_MS / 1000}s`);
}, 15000);

module.exports = {
    processBrainDecision,
    onPriceUpdate,
    expireStale,
    // Getters
    getOpenPositions,
    getOpenCount,
    getLog,
    getStats,
    getLiveStats,
    getLivePositions,
    getDemoBalance,
    getFullState,
    // Mode control
    setMode,
    getMode,
    activateKillSwitch,
    resetKill,
    setKillPct,
    setLiveBalanceRef,
    // Change listener
    onChange,
    // Admin
    reset,
    addDemoFunds,
    resetDemoBalance,
    // Client actions
    closeBySeq,
    addOnPosition,
    updateControlMode,
    updateDslParams,
    // Reconciliation (for manual trigger / testing)
    _runReconciliation,
    // Watchdog (for manual trigger / testing)
    _watchdogLiveNoSL,
};
