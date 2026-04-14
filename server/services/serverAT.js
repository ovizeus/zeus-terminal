// Zeus Terminal — Server AutoTrade Engine (Unified, Per-User)
// Single source-of-truth for ALL positions (demo + live).
// Demo = simulated (no Binance calls). Live = real execution.
// Persisted in SQLite — survives restarts.
// Per-user isolation: each userId has independent state, positions, balance.
'use strict';

const Sentry = require('@sentry/node');
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
const _liveEntryLocks = new Set(); // 'userId:symbol' — prevents concurrent live entries
const _pendingLiveCloses = new Map(); // [LIVE-PARITY] seq → { pos, exitType, ts } — failed closes for reconciliation
const _closeCooldowns = new Map();  // [RE-ENTRY] 'userId:symbol' → closeTs — prevents immediate re-entry after close
const CLOSE_COOLDOWN_MS = 600000;   // [RE-ENTRY] 10 min cooldown after any close

const DEFAULT_DEMO_BALANCE = 10000;
function _defaultUserState() {
    return {
        log: [],
        seq: 0,
        stats: { entries: 0, exits: 0, pnl: 0, wins: 0, losses: 0 },
        demoStats: { entries: 0, exits: 0, pnl: 0, wins: 0, losses: 0 },
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
        atActive: true, // [F1] Per-user AT on/off — default ON for backward compat
        dslEnabled: true, // [DSL-OFF] Per-user DSL engine on/off — default ON
    };
}

// [DSL-OFF] Toggle per-user DSL engine. When false, new AT + manual positions skip DSL attach
// and the AT live path places native TP on the exchange.
function setDslEnabled(userId, enabled) {
    if (!userId) return { ok: false, error: 'Missing userId' };
    const us = _uState(userId);
    us.dslEnabled = !!enabled;
    logger.info('AT_ENGINE', `uid=${userId} DSL engine ${us.dslEnabled ? 'ENABLED' : 'DISABLED'}`);
    return { ok: true, dslEnabled: us.dslEnabled };
}

function getDslEnabled(userId) {
    return !!_uState(userId).dslEnabled;
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
    // Snapshot DSL progress so it survives server restart
    const dslState = serverDSL.getState(pos.seq);
    if (dslState) {
        pos.dslProgress = {
            active: dslState.active,
            progress: dslState.progress,
            activationPrice: dslState.activationPrice,
            currentSL: dslState.currentSL,
            pivotLeft: dslState.pivotLeft,
            pivotRight: dslState.pivotRight,
            impulseVal: dslState.impulseVal,
            ttpArmed: dslState.ttpArmed,
            ttpPeak: dslState.ttpPeak,
            phaseChanges: dslState.phaseChanges,
        };
    }
    try { db.atSavePosition(pos); } catch (e) {
        logger.error('AT_DB', 'Save position failed: ' + e.message);
        _alertPersistFailure(pos.userId, 'Save position [' + pos.seq + ']', e.message);
    }
}

function _persistClose(pos) {
    try { db.atArchiveClosed(pos); return true; } catch (e) {
        logger.error('AT_DB', 'Archive closed failed: ' + e.message);
        _alertPersistFailure(pos.userId, 'Archive closed [' + pos.seq + ']', e.message);
        return false;
    }
}

const _persistAlertTs = new Map(); // per-user throttle
function _alertPersistFailure(userId, op, msg) {
    if (!userId) return;
    const now = Date.now();
    if (now - (_persistAlertTs.get(userId) || 0) < 60000) return; // max 1 alert/min per user
    _persistAlertTs.set(userId, now);
    try { telegram.sendToUser(userId, '⚠️ *DB PERSIST FAILURE*\n' + op + '\n' + msg); } catch (_) { }
}

function _persistState(userId) {
    const us = _uState(userId);
    try {
        db.atSetState('engine:' + userId, {
            mode: us.engineMode,
            seq: us.seq,
            liveSeq: us.liveSeq,
            stats: us.stats,
            demoStats: us.demoStats,
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
            atActive: us.atActive, // [F1]
        }, userId);
    } catch (e) {
        logger.error('AT_DB', 'Save state failed: ' + e.message);
        _alertPersistFailure(userId, 'Save state', e.message);
    }
}

function _applyStateBlob(userId, saved) {
    const us = _uState(userId);
    us.engineMode = saved.mode || 'demo';
    us.seq = saved.seq || 0;
    us.liveSeq = saved.liveSeq || 0;
    us.stats = saved.stats || { entries: 0, exits: 0, pnl: 0, wins: 0, losses: 0 };
    // Restore demoStats; if missing (legacy), derive from stats - liveStats (one-time migration)
    if (saved.demoStats) {
        us.demoStats = saved.demoStats;
    } else {
        const ls = saved.liveStats || {};
        const st = saved.stats || {};
        us.demoStats = {
            entries: (st.entries || 0) - (ls.entries || 0),
            exits: (st.exits || 0) - (ls.exits || 0),
            pnl: +((st.pnl || 0) - (ls.pnl || 0)).toFixed(2),
            wins: (st.wins || 0) - (ls.wins || 0),
            losses: (st.losses || 0) - (ls.losses || 0),
        };
    }
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
    us.atActive = saved.atActive !== false; // [F1] Default true for existing users
    logger.info('AT_DB', `State restored uid=${userId}: mode=${us.engineMode} seq=${us.seq} balance=$${us.demoBalance.toFixed(2)} atActive=${us.atActive}`);
}

function _restoreFromDb() {
    try {
        // [B2] Startup ghost cleanup: remove stale open positions that have a NEWER closed record
        // (seq collision from seq reuse: new open entry with same seq as old closed = keep open)
        try {
            const candidates = db.getGhostCandidates();
            let cleaned = 0;
            for (const c of candidates) {
                // [H1 FIX] Normalize both to Unix ms before comparing
                // openTs: always number (from JSON $.ts)
                // closedTs: can be string (SQLite CURRENT_TIMESTAMP) or number (JSON $.closeTs) or 0
                const openMs = Number(c.openTs) || 0;
                const closedMs = typeof c.closedTs === 'string'
                    ? new Date(c.closedTs + 'Z').getTime()  // SQLite datetime is UTC, append Z for correct parse
                    : (Number(c.closedTs) || 0);
                // Only delete if closed entry is NEWER than open entry (= open is the stale ghost)
                if (closedMs > 0 && openMs > 0 && closedMs >= openMs) {
                    db.deleteGhostPosition(Number(c.seq), c.user_id);
                    cleaned++;
                }
            }
            if (cleaned > 0) logger.warn('AT_DB', `Startup cleanup: removed ${cleaned} ghost position(s) from at_positions`);
        } catch (e) { logger.error('AT_DB', 'Startup ghost cleanup failed: ' + e.message); }

        // [A3] Per-user restore — query distinct user IDs first, then load per-user
        const knownUserIds = db.atGetOpenUserIds();
        // Always include user 1 for engine state restore (legacy + primary)
        const userIds = new Set(knownUserIds);
        userIds.add(1);

        let restoredCount = 0;
        let skippedCount = 0;
        for (const uid of userIds) {
            let openPos;
            try { openPos = db.atLoadOpenPositions(uid); } catch (e) {
                logger.error('AT_DB', `Failed to load positions for uid=${uid}: ${e.message} — skipping user`);
                continue; // skip this user, continue with others
            }
            for (const pos of openPos) {
                try {
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
                    // Re-attach DSL with saved params + restored progress (survives restart).
                    // [DSL-OFF] Skip attach if position was opened with DSL OFF (dslParams === null).
                    if (pos.dslParams) {
                        serverDSL.attach(pos, pos.dslParams, pos.dslProgress || null);
                    }
                    restoredCount++;
                } catch (e) {
                    logger.error('AT_DB', `[${pos.seq || '?'}] Failed to restore position: ${e.message} — skipping`);
                    skippedCount++;
                }
            }
        }

        // Restore per-user engine states — [6B1] user_id-based read path
        for (const uid of userIds) {
            try {
                const rows = db.atGetStateByUser(uid);
                const engineRow = rows.find(r => r.key === 'engine:' + uid);
                const saved = engineRow ? engineRow.value : null;
                if (saved) _applyStateBlob(uid, saved);
            } catch (e) {
                logger.error('AT_DB', `Failed to restore state for uid=${uid}: ${e.message} — skipping`);
            }
        }

        if (restoredCount > 0) {
            logger.info('AT_DB', `Restored ${restoredCount} open position(s)${skippedCount > 0 ? ` (skipped ${skippedCount} stuck/corrupt)` : ''}`);
        } else if (skippedCount > 0) {
            logger.warn('AT_DB', `No valid positions restored (${skippedCount} skipped as stuck/corrupt)`);
        }
    } catch (e) {
        logger.error('AT_DB', 'Restore failed critically: ' + e.message);
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
        const openCount = _positions.filter(p => p.userId === userId).length;
        if (openCount > 0) {
            logger.warn('AT_ENGINE', `Mode switch rejected uid=${userId}: ${oldMode} → ${mode} — ${openCount} open position(s)`);
            return { ok: false, error: `Cannot switch mode with ${openCount} open position(s). Close them first.` };
        }
    }

    // [V3.1] Guard: live mode requires valid exchange credentials
    if (mode === 'live') {
        const creds = getExchangeCreds(userId);
        if (!creds) {
            logger.warn('AT_ENGINE', `Mode switch rejected uid=${userId}: no exchange credentials configured`);
            return { ok: false, error: 'Cannot switch to live — no exchange credentials configured. Go to Settings → Exchange API.' };
        }
        if (us.killActive) {
            return { ok: false, error: 'Cannot switch to live — kill switch is active. Reset it first.' };
        }
    }

    us.engineMode = mode;
    _persistState(userId);

    // [LIVE-PARITY] Auto-init liveBalanceRef from Binance on live mode switch (non-blocking)
    if (mode === 'live' && us.liveBalanceRef <= 0) {
        const creds = getExchangeCreds(userId);
        if (creds) {
            sendSignedRequest('GET', '/fapi/v2/balance', {}, creds).then(balances => {
                const usdtBal = balances.find(b => b.asset === 'USDT');
                const total = usdtBal ? parseFloat(usdtBal.balance || 0) : 0;
                if (total > 0) {
                    us.liveBalanceRef = total;
                    _persistState(userId);
                    logger.info('AT_ENGINE', `Kill switch auto-init uid=${userId}: liveBalanceRef=$${total.toFixed(2)}`);
                }
            }).catch(err => {
                logger.warn('AT_ENGINE', `Kill switch auto-init failed uid=${userId}: ${err.message} — liveBalanceRef stays at $${us.liveBalanceRef}`);
            });
        }
    }

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
function isATActive(userId) { return _uState(userId).atActive; }

/**
 * Pre-live checklist — validates readiness before switching to live mode.
 * Returns { ok: true, checks: [...] } or { ok: false, checks: [...], failedChecks: [...] }
 */
async function preLiveChecklist(userId) {
    const checks = [];
    let allOk = true;

    // 1. Exchange credentials exist
    const creds = getExchangeCreds(userId);
    if (!creds) {
        checks.push({ name: 'API_KEYS', ok: false, detail: 'No exchange credentials configured' });
        allOk = false;
    } else {
        checks.push({ name: 'API_KEYS', ok: true, detail: 'Credentials found' });

        // 2. Binance connectivity + balance
        try {
            const balances = await sendSignedRequest('GET', '/fapi/v2/balance', {}, creds);
            const usdtBal = balances.find(b => b.asset === 'USDT');
            const available = usdtBal ? parseFloat(usdtBal.availableBalance || 0) : 0;
            if (available > 0) {
                checks.push({ name: 'BALANCE', ok: true, detail: `$${available.toFixed(2)} USDT available` });
            } else {
                checks.push({ name: 'BALANCE', ok: false, detail: 'Zero USDT balance on Binance' });
                allOk = false;
            }
            checks.push({ name: 'CONNECTIVITY', ok: true, detail: 'Binance API reachable' });
        } catch (err) {
            checks.push({ name: 'CONNECTIVITY', ok: false, detail: 'Binance API unreachable: ' + err.message });
            checks.push({ name: 'BALANCE', ok: false, detail: 'Cannot verify (API unreachable)' });
            allOk = false;
        }
    }

    // 3. No open positions (already checked by setMode, but include for completeness)
    const openCount = _positions.filter(p => p.userId === userId).length;
    checks.push({ name: 'NO_OPEN_POSITIONS', ok: openCount === 0, detail: openCount === 0 ? 'No open positions' : `${openCount} position(s) still open` });
    if (openCount > 0) allOk = false;

    // 4. Kill switch not active
    const us = _uState(userId);
    checks.push({ name: 'KILL_SWITCH', ok: !us.killActive, detail: us.killActive ? 'Kill switch is active — reset first' : 'Kill switch OK' });
    if (us.killActive) allOk = false;

    const failedChecks = checks.filter(c => !c.ok).map(c => c.name);
    logger.info('AT_ENGINE', `Pre-live checklist uid=${userId}: ${allOk ? 'PASSED' : 'FAILED'} [${failedChecks.join(', ') || 'all ok'}]`);

    return { ok: allOk, checks, failedChecks };
}

// [F1] Per-user AT on/off toggle — independent of mode (demo/live)
function toggleActive(userId, active) {
    if (typeof active !== 'boolean') return { ok: false, error: 'active must be boolean' };
    if (!userId) return { ok: false, error: 'Missing userId' };
    const us = _uState(userId);
    const was = us.atActive;
    us.atActive = active;
    _persistState(userId);
    logger.info('AT_ENGINE', `AT toggled uid=${userId}: ${was} → ${active}`);
    audit.record('AT_TOGGLE', { userId, was, now: active }, 'user');
    telegram.sendToUser(userId, active
        ? '🟢 *AT Activated* — brain entries enabled'
        : '🔴 *AT Deactivated* — brain entries blocked');
    _notifyChange(userId);
    return { ok: true, atActive: active, was };
}

// ── Missed trade recorder ──
function _recordMissedTrade(userId, decision, reason) {
    try {
        const f = decision.fusion || {};
        db.saveMissedTrade(userId, decision.symbol, f.dir || '?', reason,
            decision.price || 0, f.confidence || 0, f.decision || '?',
            (decision.regime && decision.regime.regime) || '?',
            { score: f.score, confluence: decision.confluence ? decision.confluence.score : null, priceTs: decision.priceTs });
    } catch (e) { logger.warn('AT_ENGINE', 'Failed to record missed trade: ' + e.message); }
}

// ══════════════════════════════════════════════════════════════════
// Process a brain decision (called by serverBrain)
// ══════════════════════════════════════════════════════════════════
function processBrainDecision(decision, stc, userId) {
    if (!decision || !decision.fusion || !stc) return null;
    // [MULTI-USER] Hard guard — reject decisions without userId
    if (!userId) { logger.error('AT_ENGINE', 'processBrainDecision called without userId — skipping'); return null; }

    const us = _uState(userId);

    // [F1] Per-user AT on/off gate — if user disabled AT, block ALL entries
    if (!us.atActive) {
        logger.info('AT_ENGINE', `Entry blocked uid=${userId} — AT disabled by user`);
        _recordMissedTrade(userId, decision, 'AT_DISABLED');
        return null;
    }

    const fusion = decision.fusion;
    const tier = fusion.decision;
    if (tier === 'NO_TRADE' || tier === 'SKIP' || tier === 'ERROR') return null;

    const mult = TIER_MULT[tier];
    if (!mult) return null;

    const side = fusion.dir;
    if (side !== 'LONG' && side !== 'SHORT') return null;

    const price = decision.price;
    if (!price || price <= 0) return null;

    // [F2] Stale price gate — reject if price is > 10s old at entry time
    if (decision.priceTs && (Date.now() - decision.priceTs) > 10000) {
        logger.warn('AT_ENGINE', `Entry blocked uid=${userId} — stale price (${Math.round((Date.now() - decision.priceTs) / 1000)}s old)`);
        _recordMissedTrade(userId, decision, 'STALE_PRICE');
        return null;
    }

    // ── Kill switch check (per-user) ──
    _checkDailyReset(userId);
    if (us.killActive) {
        logger.warn('AT_ENGINE', `Entry blocked uid=${userId} — daily kill switch active (PnL: $${us.dailyPnL.toFixed(2)})`);
        _recordMissedTrade(userId, decision, 'KILL_SWITCH');
        return null;
    }

    // ── Duplicate guard (per-user) ──
    const existing = _positions.find(p => p.userId === userId && p.symbol === decision.symbol && p.side === side);
    if (existing) return null;

    // ── Max positions gate (per-user) ──
    const userPosCount = _positions.filter(p => p.userId === userId).length;
    if (userPosCount >= stc.maxPos) { _recordMissedTrade(userId, decision, 'MAX_POSITIONS'); return null; }

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
        _recordMissedTrade(userId, decision, 'INSUFFICIENT_BALANCE');
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
        // [DSL-OFF] Per-user DSL engine flag: when OFF, skip DSL params so attach + native TP suppression
        // are bypassed and the position runs purely on exchange TP/SL.
        dslParams: us.dslEnabled === false ? null : serverDSL.getPreset(stc.dslMode),
        // ── Add-on tracking (Faza 2 Batch A) ──
        originalEntry: price,
        originalSize: finalSize,
        originalQty: +qty.toFixed(6),
        addOnCount: 0,
        addOnHistory: [],
        controlMode: 'auto', // [TL-03] Initialize controlMode so user-override check works
        autoTrade: true,     // [AT-PANEL] Mark as AT position for client panel filtering
        sourceMode: 'auto',  // [AT-PANEL] Source mode for display labeling
        _livePending: false, // [TL-04] True while _executeLiveEntry is in-flight
    };

    // [REFLECTION] Save entry snapshot from brain for post-trade analysis
    if (decision._entrySnapshot) {
        entry.entrySnapshot = decision._entrySnapshot;
    }

    // ── Demo: deduct margin ──
    if (us.engineMode === 'demo') {
        us.demoBalance = +(us.demoBalance - finalSize).toFixed(2);
    }

    // ── Add to THE positions array ──
    _positions.push(entry);
    us.stats.entries++;
    if (entry.mode !== 'live') us.demoStats.entries++;

    // ── Attach DSL (skipped when DSL engine is OFF for this user) ──
    if (entry.dslParams) {
        serverDSL.attach(entry, entry.dslParams);
    } else {
        logger.info('AT_ENGINE', `[${entry.seq}] AT entry registered with DSL OFF — no DSL attach`);
    }

    // ── Persist — [M5] state FIRST (seq counter), then position
    // If crash between: seq counter is saved (no reuse), position is lost (no ghost)
    _persistState(userId);
    _persistPosition(entry);

    // ── Log ──
    _pushLog(userId, 'ENTRY', entry);
    logger.info('AT_ENGINE',
        `[${entry.seq}] uid=${userId} ${entry.mode.toUpperCase()} ${side} ${entry.symbol} @ $${price.toFixed(2)} | ` +
        `Size=$${finalSize} Lev=${lev}x | SL=$${entry.sl} TP=$${entry.tp} | ` +
        `Tier=${tier} Conf=${fusion.confidence}%`
    );

    // ── Telegram — [MODE-P5] resolved environment label ──
    const _tgCreds = getExchangeCreds(userId);
    const _tgEnv = entry.mode === 'demo' ? 'DEMO' : ((_tgCreds && _tgCreds.mode === 'testnet') ? 'TESTNET' : 'LIVE');
    const modeEmoji = _tgEnv === 'TESTNET' ? '🟡' : (entry.mode === 'live' ? '🔴' : '🎮');
    telegram.sendToUser(userId,
        `📥 *${_tgEnv} ENTRY*\n` +
        `${modeEmoji} ${side === 'LONG' ? '🟢' : '🔴'} \`${side}\` \`${entry.symbol}\` @ \`$${price.toFixed(0)}\`\n` +
        `Size: \`$${finalSize}\` | Lev: \`${lev}x\` | Tier: \`${tier}\`\n` +
        `SL: \`$${entry.sl.toFixed(0)}\` | TP: \`$${entry.tp.toFixed(0)}\`\n` +
        `Confidence: \`${fusion.confidence}%\` | Score: \`${fusion.score}\``
    );

    // ── Live execution (only if mode is 'live') ──
    if (entry.mode === 'live') {
        _executeLiveEntry(entry, stc).catch(err => {
            logger.error('AT_LIVE', `Live entry failed [${entry.seq}]: ${err.message}`);
            Sentry.captureException(err, { tags: { module: 'AT', action: 'live_entry_unhandled', symbol: entry.symbol }, user: { id: String(entry.userId) } });
            entry.live = entry.live || { status: 'ERROR', error: err.message };
            _pushLog(userId, 'LIVE_ERROR', { seq: entry.seq, error: err.message });
            _uState(entry.userId).liveStats.errors++;
            // [V5.2] Cleanup zombie — no exchange exposure
            const zIdx = _positions.indexOf(entry);
            if (zIdx >= 0) {
                entry.closeReason = 'ENTRY_FAILED_ERROR';
                entry.closePnl = 0;
                entry.closeTs = Date.now();
                if (_persistClose(entry)) {
                    _positions.splice(zIdx, 1);
                    _persistState(entry.userId);
                    logger.warn('AT_LIVE', `[${entry.seq}] Zombie cleanup — removed errored entry`);
                }
            }
        });
    }

    _notifyChange(userId);
    return entry;
}

// ══════════════════════════════════════════════════════════════════
// Algo Order Helper — Binance Dec 2025 migration
// STOP_MARKET / TAKE_PROFIT_MARKET moved from /fapi/v1/order to /fapi/v1/algoOrder
// Maps: stopPrice→triggerPrice, newClientOrderId→clientAlgoId
// Response: algoId mapped to orderId for backward compat
// ══════════════════════════════════════════════════════════════════
async function _placeConditionalOrder(params, creds) {
    const mapped = {
        algoType: 'CONDITIONAL',
        symbol: params.symbol,
        side: params.side,
        type: params.type,
    };
    if (params.stopPrice != null) mapped.triggerPrice = String(params.stopPrice);
    if (params.quantity != null) mapped.quantity = String(params.quantity);
    if (params.reduceOnly != null) mapped.reduceOnly = String(params.reduceOnly);
    if (params.newClientOrderId) mapped.clientAlgoId = params.newClientOrderId;

    const data = await sendSignedRequest('POST', '/fapi/v1/algoOrder', mapped, creds);
    // Normalize algoId → orderId so existing code that reads .orderId keeps working
    if (data.algoId != null && data.orderId == null) data.orderId = data.algoId;
    return data;
}

// ══════════════════════════════════════════════════════════════════
// Live Execution — Binance API calls (only for live-mode positions)
// ══════════════════════════════════════════════════════════════════
async function _executeLiveEntry(entry, stc) {
    entry._livePending = true; // [TL-04] Lock position from onPriceUpdate exits
    const _lockKey = entry.userId + ':' + entry.symbol;
    if (_liveEntryLocks.has(_lockKey)) {
        logger.warn('AT_LIVE', `[${entry.seq}] Live entry SKIPPED uid=${entry.userId} ${entry.symbol} — another entry in-flight`);
        entry.live = { status: 'LOCK_BLOCKED' };
        entry._livePending = false;
        // [V5.2] Cleanup zombie — no exchange exposure
        const zIdx = _positions.indexOf(entry);
        if (zIdx >= 0) {
            entry.closeReason = 'ENTRY_FAILED_LOCK_BLOCKED';
            entry.closePnl = 0;
            entry.closeTs = Date.now();
            if (_persistClose(entry)) {
                _positions.splice(zIdx, 1);
                _persistState(entry.userId);
            }
            logger.warn('AT_LIVE', `[${entry.seq}] Zombie cleanup — removed lock-blocked entry`);
        }
        return;
    }
    _liveEntryLocks.add(_lockKey);
    try {
    // [MULTI-USER] Hard guard — no fallback to user 1
    if (!entry.userId) { logger.error('AT_LIVE', 'executeLiveEntry without userId — aborting'); return; }
    const userId = entry.userId;
    const us = _uState(userId);

    // [RE-ENTRY] Re-check atActive — user may have disabled AT between decision and execution
    if (!us.atActive) {
        logger.info('AT_LIVE', `[${entry.seq}] Live entry ABORTED uid=${userId} — AT disabled after decision`);
        const abortIdx = _positions.indexOf(entry);
        if (abortIdx >= 0) {
            entry.closeReason = 'AT_DISABLED_INFLIGHT';
            entry.closePnl = 0;
            entry.closeTs = Date.now();
            if (_persistClose(entry)) { _positions.splice(abortIdx, 1); _persistState(userId); }
        }
        return;
    }

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

    // Set leverage — BLOCKING: wrong leverage = wrong risk
    for (let levAttempt = 0; levAttempt < 2; levAttempt++) {
        try {
            await sendSignedRequest('POST', '/fapi/v1/leverage', {
                symbol: entry.symbol, leverage: entry.lev,
            }, creds);
            break; // success
        } catch (levErr) {
            if (levAttempt === 0) {
                logger.warn('AT_LIVE', `[${entry.seq}] Leverage set failed, retrying: ${levErr.message}`);
                await new Promise(r => setTimeout(r, 1000));
            } else {
                entry.live = { status: 'LEVERAGE_FAILED', error: levErr.message, intendedLev: entry.lev };
                _pushLog(userId, 'LIVE_LEVERAGE_FAILED', { seq: entry.seq, leverage: entry.lev, error: levErr.message });
                logger.error('AT_LIVE', `[${entry.seq}] Leverage set failed — BLOCKING entry: ${levErr.message}`);
                telegram.sendToUser(userId, `⚠️ *Leverage Set Failed — Entry Blocked*\n${entry.side} ${entry.symbol}\nIntended: ${entry.lev}x\nEntry skipped — wrong leverage = wrong risk.\nError: ${levErr.message}`);
                us.liveStats.blocked++;
                return;
            }
        }
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
        Sentry.captureException(err, { tags: { module: 'AT', action: 'live_entry', symbol: entry.symbol, side: entry.side }, user: { id: String(userId) } });
        telegram.alertOrderFailed(entry.symbol, entry.side, err.message, userId);
        audit.record('SAT_ENTRY_FAILED', { userId, seq: entry.seq, symbol: entry.symbol, side: entry.side, error: err.message }, 'SERVER_AT');
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
        Sentry.captureMessage(`Fill unverified: ${entry.symbol} ${entry.side}`, { level: 'error', tags: { module: 'AT', action: 'fill_unverified', symbol: entry.symbol }, user: { id: String(userId) } });
        telegram.sendToUser(userId, `⚠️ *FILL UNVERIFIED*\n${entry.symbol} ${entry.side} — avgPrice not confirmed. Monitor manually.`);
    }
    const avgPrice = parseFloat(verifiedOrder.avgPrice || 0);
    const executedQty = parseFloat(verifiedOrder.executedQty || 0);
    const closeSide = entry.side === 'LONG' ? 'SELL' : 'BUY';
    if (!Number.isFinite(avgPrice) || avgPrice <= 0 || !Number.isFinite(executedQty) || executedQty <= 0) {
        entry.live = { status: 'FILL_UNVERIFIED', error: 'No confirmed fill data', orderId: mainOrder.orderId };
        logger.error('AT_LIVE', `[${entry.seq}] Entry aborted — no confirmed fill (avgPrice=${avgPrice}, qty=${executedQty})`);
        telegram.sendToUser(userId, `🚨 *FILL UNVERIFIED*\n${entry.symbol} ${entry.side} — fill data missing. Order ${mainOrder.orderId} may be open on exchange.\nPosition kept tracked — reconciliation will verify.`);
        us.liveStats.errors++;
        return;
    }

    // [FIX2] Re-round using ACTUAL executedQty (not original qty) for all downstream orders
    const fillQty = String(roundOrderParams(entry.symbol, executedQty).quantity || executedQty);

    // Slippage tracking — compare fill price vs expected price
    const entrySlippage = avgPrice - entry.price;
    const entrySlippagePct = entry.price > 0 ? +((entrySlippage / entry.price) * 100).toFixed(4) : 0;
    entry.live = entry.live || {};
    entry.live.entrySlippage = entrySlippage;
    entry.live.entrySlippagePct = entrySlippagePct;
    entry.live.expectedPrice = entry.price;
    entry.live.fillPrice = avgPrice;

    logger.info('AT_LIVE', `[${entry.seq}] ENTRY FILLED ${entry.side} ${entry.symbol} qty=${executedQty} @ $${avgPrice} (expected $${entry.price.toFixed(2)}, slippage ${entrySlippagePct >= 0 ? '+' : ''}${entrySlippagePct}%)`);
    audit.record('SAT_ENTRY_FILLED', {
        userId, seq: entry.seq, symbol: entry.symbol, side: entry.side,
        qty: executedQty, avgPrice, orderId: mainOrder.orderId, tier: entry.tier,
        slippage: entrySlippagePct,
    }, 'SERVER_AT');
    metrics.recordOrder('filled');
    telegram.alertOrderFilled(entry.symbol, entry.side, executedQty, avgPrice, mainOrder.orderId, userId);

    // SL order with auto-retry + emergency close
    let slOrder = null;
    const SL_RETRY_DELAYS = [1000, 3000]; // [ZT-AUD-007] 1s, 3s backoff (max 4s vs old 17s)
    for (let attempt = 0; attempt <= SL_RETRY_DELAYS.length; attempt++) {
        try {
            slOrder = await _placeConditionalOrder({
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
        Sentry.captureMessage(`EMERGENCY CLOSE: SL failed ${entry.symbol} ${entry.side}`, { level: 'fatal', tags: { module: 'AT', action: 'emergency_close_sl', symbol: entry.symbol }, user: { id: String(userId) } });
        telegram.sendToUser(userId, `🚨 *EMERGENCY CLOSE*\n${entry.side} ${entry.symbol} @ $${avgPrice.toFixed(2)}\nAll ${SL_RETRY_DELAYS.length + 1} SL attempts failed.\nEmergency market-closing position to prevent unprotected exposure.`);
        try {
            const emgResult = await sendSignedRequest('POST', '/fapi/v1/order', {
                symbol: entry.symbol, side: closeSide, type: 'MARKET',
                quantity: fillQty, reduceOnly: true,
                newClientOrderId: `SAT_EMGCLOSE_${liveSeq}`,
            }, creds);
            const _emgRaw = parseFloat(emgResult.avgPrice);
            const emgPrice = (Number.isFinite(_emgRaw) && _emgRaw > 0) ? _emgRaw : avgPrice;
            const emgPnl = avgPrice > 0 ? (entry.side === 'LONG'
                ? +((emgPrice - avgPrice) / avgPrice * entry.size * entry.lev).toFixed(2)
                : +((avgPrice - emgPrice) / avgPrice * entry.size * entry.lev).toFixed(2)) : 0;
            entry.live = { status: 'EMERGENCY_CLOSED', liveSeq, clientOrderId, mainOrderId: mainOrder.orderId, avgPrice, executedQty, reason: 'SL placement failed after all retries' };
            logger.warn('AT_LIVE', `[${entry.seq}] Emergency close executed @ $${emgPrice.toFixed(2)} PnL=$${emgPnl.toFixed(2)}`);
            telegram.sendToUser(userId, `✅ Emergency close EXECUTED for ${entry.symbol} ${entry.side} @ $${emgPrice.toFixed(2)} — PnL: $${emgPnl.toFixed(2)}`);
            audit.record('SAT_EMERGENCY_CLOSE', { userId, seq: entry.seq, symbol: entry.symbol, side: entry.side, emgPrice, emgPnl, reason: 'SL_ALL_RETRIES_FAILED' }, 'SERVER_AT');
            // [FIX1] Properly close position — remove from _positions, update stats, persist
            const emgIdx = _positions.findIndex(p => p.seq === entry.seq);
            if (emgIdx >= 0) {
                _closePosition(emgIdx, entry, 'EMERGENCY_CLOSED', emgPrice, emgPnl);
            }
            return; // exit early — no TP needed, position is closed
        } catch (emgErr) {
            logger.error('AT_LIVE', `[${entry.seq}] EMERGENCY CLOSE FAILED: ${emgErr.message}`);
            Sentry.captureException(emgErr, { level: 'fatal', tags: { module: 'AT', action: 'emergency_close_failed', symbol: entry.symbol }, user: { id: String(userId) } });
            telegram.sendToUser(userId, `🚨🚨 *EMERGENCY CLOSE FAILED*\n${entry.side} ${entry.symbol} @ $${avgPrice.toFixed(2)}\nPosition is UNPROTECTED on Binance.\n*IMMEDIATE MANUAL INTERVENTION REQUIRED!*\nError: ${emgErr.message}`);
        }
        return; // [TL-02] Don't place TP if emergency close failed — position already alerted as UNPROTECTED
    }

    // [DSL-SEMANTIC-FIX + DSL-OFF]
    //   DSL ON  → no native TP (DSL pivots trail the price; PL is the only take-profit path).
    //   DSL OFF → place native TP from RISK MANAGEMENT so the position has full exchange-side protection.
    let tpOrder = null;
    const TP_RETRY_DELAYS = [1000, 3000];
    if (!entry.dslParams) {
        for (let tpAttempt = 0; tpAttempt <= TP_RETRY_DELAYS.length; tpAttempt++) {
            try {
                tpOrder = await _placeConditionalOrder({
                    symbol: entry.symbol, side: closeSide, type: 'TAKE_PROFIT_MARKET',
                    quantity: fillQty,
                    stopPrice: String(roundedTp.stopPrice != null ? roundedTp.stopPrice : entry.tp),
                    reduceOnly: true, newClientOrderId: `SAT_TP_${liveSeq}_${tpAttempt}`,
                }, creds);
                if (tpAttempt > 0) logger.info('AT_LIVE', `[${entry.seq}] TP order succeeded on retry #${tpAttempt}`);
                break;
            } catch (tpErr) {
                logger.error('AT_LIVE', `[${entry.seq}] TP order attempt ${tpAttempt + 1}/${TP_RETRY_DELAYS.length + 1} failed: ${tpErr.message}`);
                if (tpAttempt < TP_RETRY_DELAYS.length) {
                    telegram.sendToUser(userId, `⚠️ TP retry ${tpAttempt + 1}/${TP_RETRY_DELAYS.length + 1} failed for ${entry.symbol} ${entry.side} — retrying in ${TP_RETRY_DELAYS[tpAttempt] / 1000}s...`);
                    await new Promise(r => setTimeout(r, TP_RETRY_DELAYS[tpAttempt]));
                }
            }
        }
    }

    if (!entry.dslParams && !tpOrder && slOrder) {
        logger.error('AT_LIVE', `[${entry.seq}] ALL TP retries exhausted — executing EMERGENCY MARKET CLOSE`);
        Sentry.captureMessage(`EMERGENCY CLOSE: TP failed ${entry.symbol} ${entry.side}`, { level: 'fatal', tags: { module: 'AT', action: 'emergency_close_tp', symbol: entry.symbol }, user: { id: String(userId) } });
        telegram.sendToUser(userId, `🚨 *TP EMERGENCY CLOSE*\n${entry.side} ${entry.symbol} @ $${avgPrice.toFixed(2)}\nAll ${TP_RETRY_DELAYS.length + 1} TP attempts failed.\nEmergency closing — position cannot stay open without TP protection.`);
        // Cancel SL order first (we're closing the position) — await to prevent SL fill racing with emergency close
        if (slOrder && slOrder.orderId) await _cancelOrderSafe(entry.symbol, slOrder.orderId, creds, userId);
        try {
            const tpEmgResult = await sendSignedRequest('POST', '/fapi/v1/order', {
                symbol: entry.symbol, side: closeSide, type: 'MARKET',
                quantity: fillQty, reduceOnly: true,
                newClientOrderId: `SAT_TPEMG_${liveSeq}`,
            }, creds);
            const _tpEmgRaw = parseFloat(tpEmgResult.avgPrice);
            const tpEmgPrice = (Number.isFinite(_tpEmgRaw) && _tpEmgRaw > 0) ? _tpEmgRaw : avgPrice;
            const tpEmgPnl = avgPrice > 0 ? (entry.side === 'LONG'
                ? +((tpEmgPrice - avgPrice) / avgPrice * entry.size * entry.lev).toFixed(2)
                : +((avgPrice - tpEmgPrice) / avgPrice * entry.size * entry.lev).toFixed(2)) : 0;
            entry.live = { status: 'EMERGENCY_CLOSED', liveSeq, clientOrderId, mainOrderId: mainOrder.orderId, avgPrice, executedQty, reason: 'TP placement failed after all retries' };
            logger.warn('AT_LIVE', `[${entry.seq}] TP emergency close executed @ $${tpEmgPrice.toFixed(2)} PnL=$${tpEmgPnl.toFixed(2)}`);
            telegram.sendToUser(userId, `✅ TP emergency close EXECUTED for ${entry.symbol} ${entry.side} @ $${tpEmgPrice.toFixed(2)} — PnL: $${tpEmgPnl.toFixed(2)}`);
            audit.record('SAT_EMERGENCY_CLOSE', { userId, seq: entry.seq, symbol: entry.symbol, side: entry.side, emgPrice: tpEmgPrice, emgPnl: tpEmgPnl, reason: 'TP_ALL_RETRIES_FAILED' }, 'SERVER_AT');
            const tpEmgIdx = _positions.findIndex(p => p.seq === entry.seq);
            if (tpEmgIdx >= 0) _closePosition(tpEmgIdx, entry, 'EMERGENCY_CLOSED', tpEmgPrice, tpEmgPnl);
            return; // position closed — no further processing needed
        } catch (tpEmgErr) {
            logger.error('AT_LIVE', `[${entry.seq}] TP EMERGENCY CLOSE FAILED: ${tpEmgErr.message}`);
            Sentry.captureException(tpEmgErr, { level: 'fatal', tags: { module: 'AT', action: 'tp_emergency_failed', symbol: entry.symbol }, user: { id: String(userId) } });
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
    } finally {
        entry._livePending = false; // [TL-04] Unlock — all paths covered
        _liveEntryLocks.delete(_lockKey); // Release per-symbol lock

        // [B18] FILL_UNVERIFIED: keep tracked — order may be filled on Binance
        // Do NOT delete. Reconciliation will verify exchange state on next cycle (60s).
        if (entry.live && entry.live.status === 'FILL_UNVERIFIED') {
            logger.warn('AT_LIVE', `[${entry.seq}] FILL_UNVERIFIED — keeping position tracked for reconciliation`);
            telegram.sendToUser(entry.userId,
                `⚠️ *FILL UNVERIFIED — POSITION TRACKED*\n` +
                `${entry.side} ${entry.symbol}\n` +
                `Market order sent but fill NOT confirmed.\n` +
                `Position kept tracked for reconciliation.\n` +
                `Order ID: \`${entry.live.orderId || '?'}\`\n` +
                `Check Binance manually if alert persists.`
            );
            _persistPosition(entry);
        }

        // [V5.2] Cleanup zombie positions — failed live entries with no exchange exposure
        // (FILL_UNVERIFIED excluded — may have real exchange exposure)
        const _failedStatuses = new Set([
            'NO_CREDS', 'RISK_BLOCKED', 'INSUFFICIENT_MARGIN', 'MARGIN_CHECK_FAILED',
            'LEVERAGE_FAILED', 'ENTRY_FAILED', 'LOCK_BLOCKED', 'ERROR',
        ]);
        if (entry.live && _failedStatuses.has(entry.live.status)) {
            const zIdx = _positions.indexOf(entry);
            if (zIdx >= 0) {
                entry.closeReason = 'ENTRY_FAILED_' + entry.live.status;
                entry.closePnl = 0;
                entry.closeTs = Date.now();
                if (_persistClose(entry)) {
                    _positions.splice(zIdx, 1);
                    _persistState(entry.userId);
                    logger.warn('AT_LIVE', `[${entry.seq}] Zombie cleanup — removed failed live entry (${entry.live.status})`);
                }
            }
        } else {
            _persistPosition(entry);
        }
    }
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

    // [FIX-EXPIRY] EXPIRED handling removed — no code path produces EXPIRED anymore
    if (exitType === 'HIT_SL') {
        // SL triggered on exchange — cancel remaining TP
        if (pos.live.tpOrderId) await _cancelOrderSafe(pos.symbol, pos.live.tpOrderId, creds, userId);
        // Query real fill price from SL order (best-effort — corrects slippage)
        if (pos.live.slOrderId) {
            try {
                // [ALGO-FIX] Try algo order query first (SL is now algo), fallback to regular
                let slOrder;
                try {
                    slOrder = await sendSignedRequest('GET', '/fapi/v1/algoOrder', { algoId: pos.live.slOrderId }, creds);
                } catch (_) {
                    slOrder = await sendSignedRequest('GET', '/fapi/v1/order', { symbol: pos.symbol, orderId: pos.live.slOrderId }, creds);
                }
                const realFill = parseFloat(slOrder.avgPrice || slOrder.executedPrice || 0);
                const slStatus = slOrder.status || slOrder.algoStatus || '';
                if (Number.isFinite(realFill) && realFill > 0 && (slStatus === 'FILLED' || slStatus === 'FINISHED')) {
                    // Exit slippage tracking
                    const expectedExitPrice = pos.sl;
                    const exitSlippage = realFill - expectedExitPrice;
                    const exitSlippagePct = expectedExitPrice > 0 ? +((exitSlippage / expectedExitPrice) * 100).toFixed(4) : 0;
                    pos.live.exitSlippage = exitSlippage;
                    pos.live.exitSlippagePct = exitSlippagePct;
                    pos.live.exitFillPrice = realFill;
                    pos.live.exitExpectedPrice = expectedExitPrice;

                    const realPnl = pos.side === 'LONG'
                        ? +((realFill - pos.price) / pos.price * pos.size * pos.lev).toFixed(2)
                        : +((pos.price - realFill) / pos.price * pos.size * pos.lev).toFixed(2);
                    if (realPnl !== pos.closePnl) {
                        const pnlDelta = +(realPnl - pos.closePnl).toFixed(2);
                        logger.info('AT_LIVE', `[${pos.seq}] SL fill price correction: $${exitPrice.toFixed(2)} → $${realFill.toFixed(2)} | PnL: $${pos.closePnl} → $${realPnl} | slippage: ${exitSlippagePct >= 0 ? '+' : ''}${exitSlippagePct}%`);
                        pos.closePnl = realPnl;
                        pnl = realPnl;
                        // Correct stats with delta from slippage
                        const _us = _uState(userId);
                        _us.stats.pnl = +(_us.stats.pnl + pnlDelta).toFixed(2);
                        _us.liveStats.pnl = +(_us.liveStats.pnl + pnlDelta).toFixed(2);
                        _us.dailyPnL = +(_us.dailyPnL + pnlDelta).toFixed(2);
                        _us.dailyPnLLive = +(_us.dailyPnLLive + pnlDelta).toFixed(2);
                        _persistState(userId);
                        _persistClose(pos);
                    }
                }
            } catch (slErr) {
                logger.warn('AT_LIVE', `[${pos.seq}] SL fill query failed: ${slErr.message}`);
            }
        }
    } else if (exitType === 'HIT_TP') {
        // TP triggered on exchange — cancel remaining SL
        if (pos.live.slOrderId) await _cancelOrderSafe(pos.symbol, pos.live.slOrderId, creds, userId);
    } else {
        // All other exit types: DSL_PL, DSL_TTP, MANUAL_CLIENT, RESET, RECON_PHANTOM, etc.

        // [V5.1] Server-side exits need a MARKET close on Binance (position is still open on exchange)
        // Exception: RECON_PHANTOM / RECON_EXCHANGE_CLOSED — Binance already doesn't have the position
        if (exitType !== 'RECON_PHANTOM' && exitType !== 'RECON_EXCHANGE_CLOSED' && pos.live.executedQty) {
            const closeSide = pos.side === 'LONG' ? 'SELL' : 'BUY';
            const rounded = roundOrderParams(pos.symbol, pos.live.executedQty);
            // [LIVE-PARITY] Retry loop for market close (was single attempt)
            const CLOSE_RETRIES = [1000, 3000, 5000];
            let closeResult = null;
            for (let attempt = 0; attempt <= CLOSE_RETRIES.length; attempt++) {
                try {
                    closeResult = await sendSignedRequest('POST', '/fapi/v1/order', {
                        symbol: pos.symbol,
                        side: closeSide,
                        type: 'MARKET',
                        quantity: String(rounded.quantity || pos.live.executedQty),
                        reduceOnly: true,
                        newClientOrderId: `SAT_EXIT_${pos.live.liveSeq}_${Date.now()}`,
                    }, creds);
                    break; // success
                } catch (closeErr) {
                    logger.error('AT_LIVE', `[${pos.seq}] ${exitType} market close attempt ${attempt + 1}/${CLOSE_RETRIES.length + 1} failed: ${closeErr.message}`);
                    if (attempt < CLOSE_RETRIES.length) {
                        await new Promise(r => setTimeout(r, CLOSE_RETRIES[attempt]));
                    } else {
                        // All retries exhausted — queue for reconciliation
                        _pendingLiveCloses.set(pos.seq, { pos, exitType, exitPrice, pnl, ts: Date.now() });
                        logger.error('AT_LIVE', `[${pos.seq}] ALL close retries failed — queued for reconciliation`);
                        telegram.sendToUser(userId, `🚨 *MARKET CLOSE FAILED*\n${exitType} exit for ${pos.side} ${pos.symbol}\nAll ${CLOSE_RETRIES.length + 1} attempts failed.\n*Position may still be open on Binance — reconciliation will retry.*`);
                    }
                }
            }
            if (closeResult) {
                const _clRaw = parseFloat(closeResult.avgPrice);
                const realFill = (Number.isFinite(_clRaw) && _clRaw > 0) ? _clRaw : exitPrice;
                if (realFill > 0 && pos.price > 0) {
                    const realPnl = pos.side === 'LONG'
                        ? +((realFill - pos.price) / pos.price * pos.size * pos.lev).toFixed(2)
                        : +((pos.price - realFill) / pos.price * pos.size * pos.lev).toFixed(2);
                    pos.live.exitFillPrice = realFill;
                    pos.live.exitExpectedPrice = exitPrice;
                    pos.closePnl = realPnl;
                    pnl = realPnl;
                }
                logger.info('AT_LIVE', `[${pos.seq}] ${exitType} market close filled @ $${(closeResult.avgPrice || exitPrice)} PnL=$${pnl.toFixed(2)}`);
            }
        }

        // Cancel BOTH remaining SL and TP orders to avoid orphans on Binance
        for (const oid of [pos.live.slOrderId, pos.live.tpOrderId]) {
            if (oid) await _cancelOrderSafe(pos.symbol, oid, creds, userId);
        }
    }

    if (pnl !== 0) recordClosedPnL(pnl, 'SERVER_AT', userId);

    pos.live.status = 'CLOSED';

    const holdMin = ((pos.closeTs - pos.ts) / 60000).toFixed(1);
    audit.record('SAT_EXIT', {
        userId, seq: pos.seq, symbol: pos.symbol, side: pos.side,
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

async function _cancelOrderSafe(symbol, orderId, creds, userId) {
    // [ALGO-FIX] SL/TP are now algo orders — try algo cancel first, then regular
    for (let attempt = 0; attempt < 2; attempt++) {
        // Try algo order cancel (SL/TP since Dec 2025)
        try {
            await sendSignedRequest('DELETE', '/fapi/v1/algoOrder', { symbol, algoId: orderId }, creds);
            return true;
        } catch (algoErr) {
            const am = algoErr.message || '';
            // Not found on algo endpoint — try regular endpoint below
            if (!am.includes('not found') && !am.includes('Unknown') && !am.includes('not active') && !am.includes('2011')) {
                // Real error on algo endpoint — still try regular as fallback
            }
        }
        // Try regular order cancel (MARKET/LIMIT orders, or legacy SL/TP)
        try {
            await sendSignedRequest('DELETE', '/fapi/v1/order', { symbol, orderId }, creds);
            return true;
        } catch (err) {
            const msg = err.message || '';
            if (msg.includes('Unknown order') || msg.includes('2011')) {
                return true; // already cancelled/filled/expired
            }
            if (attempt === 0) {
                logger.warn('AT_LIVE', `Cancel order ${orderId} failed, retrying: ${msg}`);
                await new Promise(r => setTimeout(r, 2000));
            } else {
                logger.error('AT_LIVE', `Cancel order ${orderId} FAILED after retry: ${msg}`);
                if (userId) {
                    try { telegram.sendToUser(userId, `⚠️ *Orphan Order Alert*\nFailed to cancel order \`${orderId}\` on ${symbol}\nCheck Binance manually!`); } catch (_) { }
                }
                return false;
            }
        }
    }
}

// ══════════════════════════════════════════════════════════════════
// _closePosition — unified close handler (SL/TP/DSL/TTP/MANUAL/RECON/EMERGENCY/RESET)
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
    // Save current regime at exit time (lazy require to avoid circular dep)
    try {
        const snap = require('./serverState').getSnapshotForSymbol(pos.symbol);
        if (snap && snap.indicators) {
            pos.closeRegime = snap.indicators.regime || null;
            pos.closeRegimeConf = snap.indicators.regimeConf || null;
        }
    } catch (_) { /* serverState not ready */ }
    // Entry/Exit quality scoring (MAE/MFE)
    if (pos.price > 0 && price > 0) {
        const minP = pos._minPrice || pos.price;
        const maxP = pos._maxPrice || pos.price;
        const entry = pos.price;
        if (pos.side === 'LONG') {
            pos.quality = {
                mae: +((minP - entry) / entry * 100).toFixed(2),       // worst drawdown % (negative = adverse)
                mfe: +((maxP - entry) / entry * 100).toFixed(2),       // best run-up %
                exitPct: +((price - entry) / entry * 100).toFixed(2),  // actual exit %
                capturedPct: (maxP > entry) ? +(((price - entry) / (maxP - entry)) * 100).toFixed(1) : 0,  // % of max move captured
                minPrice: minP,
                maxPrice: maxP,
            };
        } else {
            pos.quality = {
                mae: +((entry - maxP) / entry * 100).toFixed(2),       // worst (price went up = adverse for SHORT)
                mfe: +((entry - minP) / entry * 100).toFixed(2),       // best (price went down = favorable for SHORT)
                exitPct: +((entry - price) / entry * 100).toFixed(2),
                capturedPct: (minP < entry) ? +(((entry - price) / (entry - minP)) * 100).toFixed(1) : 0,
                minPrice: minP,
                maxPrice: maxP,
            };
        }
    }
    us.stats.exits++;
    us.stats.pnl = +(us.stats.pnl + pnl).toFixed(2);
    if (pnl > 0) us.stats.wins++;
    else us.stats.losses++;
    if (pos.mode !== 'live') {
        us.demoStats.exits++;
        us.demoStats.pnl = +(us.demoStats.pnl + pnl).toFixed(2);
        if (pnl > 0) us.demoStats.wins++;
        else us.demoStats.losses++;
    }

    // ── Demo: refund margin + apply PnL ──
    if (pos.mode === 'demo') {
        us.demoBalance = +(us.demoBalance + pos.margin + pnl).toFixed(2);
    }

    // ── Live: adjust liveBalanceRef with PnL for kill switch accuracy ──
    if (pos.mode === 'live' && us.liveBalanceRef > 0) {
        us.liveBalanceRef = +(us.liveBalanceRef + pnl).toFixed(2);
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
    // [MODE-P5] Resolved environment for Telegram exit label
    const _exitCreds = getExchangeCreds(userId);
    const _exitEnv = pos.mode === 'demo' ? 'DEMO' : ((_exitCreds && _exitCreds.mode === 'testnet') ? 'TESTNET' : 'LIVE');
    const modeTag = _exitEnv === 'TESTNET' ? '🟡 TESTNET' : (pos.mode === 'live' ? '🔴 LIVE' : '🎮 DEMO');
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

    // [RE-ENTRY] Set close cooldown so brain won't re-enter this symbol immediately
    _closeCooldowns.set(userId + ':' + pos.symbol, Date.now());

    // ── Persist close + remove from active ──
    // [B4] Splice only if persist succeeds — prevents ghost positions on DB failure
    if (_persistClose(pos)) {
        _positions.splice(idx, 1);
    } else {
        // DB failed — keep in memory to retry on next close attempt, don't lose the position
        logger.error('AT_DB', `[${pos.seq}] Position kept in memory — archive failed, will retry`);
    }
    _persistState(userId);

    // [ML] Link trade outcome to brain decision snapshot
    try {
        const brainLogger = require('./brainLogger');
        const holdMin = pos.closeTs && pos.ts ? +((pos.closeTs - pos.ts) / 60000).toFixed(1) : 0;
        brainLogger.linkOutcomeBySeq(pos.seq, {
            pnl: pnl,
            mae: pos.quality ? pos.quality.mae : null,
            mfe: pos.quality ? pos.quality.mfe : null,
            holdMin: holdMin,
            capturedPct: pos.quality ? pos.quality.capturedPct : null,
            closeReason: exitType,
        });
    } catch (_) { /* ML logging failure must never affect trading */ }

    // [REFLECTION] Post-trade reflection — brain analyzes what happened
    try {
        const serverReflection = require('./serverReflection');
        const tradeForReflection = Object.assign({}, pos, {
            mae: pos.quality ? pos.quality.mae : null,
            mfe: pos.quality ? pos.quality.mfe : null,
            entrySnapshot: pos.entrySnapshot || pos._entrySnapshot || {},
        });
        serverReflection.reflectOnTrade(tradeForReflection, null, userId);
        // Calibration update
        serverReflection.updateCalibration(
            (pos.entrySnapshot && pos.entrySnapshot.confidence) || 0,
            pnl > 0,
            userId
        );
    } catch (reflErr) {
        logger.warn('AT_ENGINE', `Reflection hook failed: ${reflErr.message}`);
    }
    _notifyChange(userId);
}

// ══════════════════════════════════════════════════════════════════
// _updateLiveSL — move SL order on Binance when DSL tightens SL
// ══════════════════════════════════════════════════════════════════
async function _updateLiveSL(pos, newSL) {
    if (!pos.live || (pos.live.status !== 'LIVE' && pos.live.status !== 'LIVE_NO_SL') || !pos.live.slOrderId) return;
    // [MULTI-USER] Hard guard — no fallback to user 1
    if (!pos.userId) { logger.error('AT_LIVE', '_updateLiveSL without pos.userId — aborting'); return; }
    // [TL-05] Per-position lock — prevent concurrent SL updates
    pos._slUpdateInFlight = true;
    pos._slQueuedSL = null;
    try {
    const userId = pos.userId;
    const creds = getExchangeCreds(userId);
    if (!creds) return;

    const oldSlOrderId = pos.live.slOrderId;
    const closeSide = pos.side === 'LONG' ? 'SELL' : 'BUY';
    const rounded = roundOrderParams(pos.symbol, pos.live.executedQty, newSL);
    const DSL_SL_RETRIES = [1000, 3000, 8000]; // 3 retries with backoff
    let newSlOrder = null;

    // [LIVE-PARITY] STEP 1: Place new SL FIRST — position stays protected by old SL during placement
    for (let attempt = 0; attempt <= DSL_SL_RETRIES.length; attempt++) {
        try {
            newSlOrder = await _placeConditionalOrder({
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

    // [LIVE-PARITY] STEP 2: Cancel old SL only AFTER new one is confirmed
    if (newSlOrder && oldSlOrderId) {
        await _cancelOrderSafe(pos.symbol, oldSlOrderId, creds, userId);
    }

    // If new SL failed: old SL is still active — position remains protected at previous level
    if (!newSlOrder) {
        // DON'T set LIVE_NO_SL — old SL is still there
        logger.warn('AT_LIVE', `[${pos.seq}] DSL SL update failed — old SL still active at previous level`);
        telegram.sendToUser(userId, `⚠️ *DSL SL Update Failed*\n${pos.side} ${pos.symbol}\nOld SL still active. New SL ($${newSL.toFixed(2)}) could not be placed.\nPosition remains protected at previous SL level.`);
    }
    } finally { // [TL-05] Release lock and drain queued SL if any
        pos._slUpdateInFlight = false;
        const queued = pos._slQueuedSL;
        pos._slQueuedSL = null;
        if (queued != null && queued !== newSL) {
            _updateLiveSL(pos, queued).catch(err => {
                logger.error('AT_LIVE', `[${pos.seq}] Queued SL update failed: ${err.message}`);
            });
        }
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
    let balRef;
    if (us.engineMode === 'live') {
        if (us.liveBalanceRef > 0) { balRef = us.liveBalanceRef; }
        else { return; } // no live balance ref — skip to avoid false trigger
    } else {
        balRef = us.demoStartBalance > 0 ? us.demoStartBalance : 10000; // [S3] use start-of-day balance, not floating balance
    }
    const lossLimit = +(balRef * pct / 100).toFixed(2);
    const lossSinceReset = us.dailyPnL - (us.pnlAtReset || 0);
    if (lossSinceReset <= -lossLimit && lossLimit > 0) {
        us.killActive = true;
        audit.record('KILL_SWITCH_TRIGGERED', { userId, loss: lossSinceReset, limit: lossLimit, pct, balRef, mode: us.engineMode }, 'SERVER_AT');
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
    // [2G] Cancel pending entries on kill switch
    try { require('./serverPendingEntry').cancelAllForUser(userId); } catch (_) {}
    audit.record('KILL_SWITCH_MANUAL', { userId, action: 'activate' }, 'user');
    logger.warn('AT_ENGINE', `Kill switch manually activated uid=${userId}`);
    telegram.sendToUser(userId, '🛑 *Kill Switch MANUALLY Activated*\nAll new entries BLOCKED until manual reset or UTC day change');
    _notifyChange(userId);
    return { ok: true, killActive: true };
}

const _killResetCooldown = new Map(); // userId → last reset timestamp
const KILL_RESET_COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes between resets

function resetKill(userId) {
    const lastReset = _killResetCooldown.get(userId) || 0;
    if (Date.now() - lastReset < KILL_RESET_COOLDOWN_MS) {
        const waitSec = Math.ceil((KILL_RESET_COOLDOWN_MS - (Date.now() - lastReset)) / 1000);
        return { ok: false, error: `Kill switch reset cooldown — wait ${waitSec}s` };
    }
    _killResetCooldown.set(userId, Date.now());
    const us = _uState(userId);
    us.killActive = false;
    us.pnlAtReset = us.dailyPnL;
    _persistState(userId);
    audit.record('KILL_SWITCH_RESET', { userId, dailyPnL: us.dailyPnL, mode: us.engineMode }, 'user');
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
    // Snapshot length to avoid issues if array mutates during iteration
    for (let i = _positions.length - 1; i >= 0; i--) {
        if (i >= _positions.length) continue; // guard: array shrunk during iteration
        const pos = _positions[i];
        if (!pos || pos.symbol !== symbol) continue;
        if (pos.status && pos.status !== 'OPEN') continue; // already closing
        pos._lastPrice = price; // track for client-initiated close PnL
        // MAE/MFE tracking — min/max price during position lifetime
        if (!pos._minPrice || price < pos._minPrice) pos._minPrice = price;
        if (!pos._maxPrice || price > pos._maxPrice) pos._maxPrice = price;

        // [BUG3 FIX] Skip server-side automated exits when user has manual control
        // [F3] Safety timeout — revert to 'auto' after 30min of user control
        if (pos.controlMode === 'user') {
            if (pos._controlModeTs && (Date.now() - pos._controlModeTs) > 1800000) {
                pos.controlMode = 'auto';
                delete pos._controlModeTs;
                logger.warn('AT_ENGINE', `[${pos.seq}] controlMode reverted to auto — 30min timeout (uid=${pos.userId})`);
                telegram.sendToUser(pos.userId, `⚠️ *Take Control Expired*\nPosition #${pos.seq} — reverted to AUTO after 30min safety timeout`);
                _persistPosition(pos);
                // Don't continue — let exit logic run on this tick
            } else {
                continue;
            }
        }

        // [TL-04] Skip positions where live entry is still in-flight on Binance
        if (pos._livePending) continue;

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

        // [DSL-SEMANTIC-FIX] TTP removed — only PL closes DSL positions.
        // Rationale: DSL pivots must capture the full move; an extra
        // TTP retrace check would close prematurely against user intent.

        // DSL moved SL → update internal state + live order on Binance
        if (dsl.changed) {
            pos.sl = effectiveSL; // [TL-09] Sync internal SL with DSL tightened value
            if (pos.live && pos.live.status === 'LIVE') {
                if (pos._slUpdateInFlight) { // [TL-05] Already updating — queue latest SL
                    pos._slQueuedSL = effectiveSL;
                } else {
                    _updateLiveSL(pos, effectiveSL).catch(err => {
                        logger.error('AT_LIVE', `[${pos.seq}] SL update failed: ${err.message}`);
                    });
                }
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
                const tpPnlReal = +((price - pos.price) / pos.price * pos.size * pos.lev).toFixed(2);
                _closePosition(i, pos, 'HIT_TP', price, tpPnlReal);
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
                const tpPnlRealS = +((pos.price - price) / pos.price * pos.size * pos.lev).toFixed(2);
                _closePosition(i, pos, 'HIT_TP', price, tpPnlRealS);
                closed = true;
            }
        }

        if (closed && pos.userId) dslChangedUsers.add(pos.userId);
    }

    // Only push DSL-SL-moved updates (not every tick)
    for (const uid of dslChangedUsers) _notifyChange(uid);
}

// [FIX-EXPIRY] expireStale removed — time-based expiry fully eliminated
// Positions close only via: SL, TP, DSL_PL, DSL_TTP, MANUAL_CLIENT, EMERGENCY_CLOSED, RECON_PHANTOM, RESET, kill switch

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

// [RE-ENTRY] Check if symbol was recently closed (prevents immediate re-entry)
function isCloseCooldownActive(userId, symbol) {
    const key = userId + ':' + symbol;
    const ts = _closeCooldowns.get(key);
    if (!ts) return false;
    if ((Date.now() - ts) > CLOSE_COOLDOWN_MS) {
        _closeCooldowns.delete(key); // expired, clean up
        return false;
    }
    return true;
}

function getLog(userId, limit) {
    const us = _uState(userId);
    limit = Math.min(limit || 50, MAX_LOG);
    return us.log.slice(-limit);
}

function _filterDslByUser(userId) {
    const userSeqs = new Set(_positions.filter(p => p.userId === userId).map(p => String(p.seq)));
    const all = serverDSL.getAllStates();
    const filtered = {};
    for (const [seq, state] of Object.entries(all)) {
        if (userSeqs.has(seq)) filtered[seq] = state;
    }
    return filtered;
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
        dslStates: _filterDslByUser(userId),
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
    // [AT-PANEL] Also include _livePending positions so client sees them before exchange fill
    return _positions
        .filter(p => p.userId === userId && p.mode === 'live' && (
            (p.live && (p.live.status === 'LIVE' || p.live.status === 'LIVE_NO_SL')) ||
            p._livePending === true
        ))
        .map(p => { const c = Object.assign({}, p); c.dsl = serverDSL.getState(p.seq) || null; return c; });
}

function getDemoBalance(userId) {
    const us = _uState(userId);
    return { balance: us.demoBalance, startBalance: us.demoStartBalance, pnl: +(us.demoBalance - us.demoStartBalance).toFixed(2) };
}

function getDemoStats(userId) {
    const us = _uState(userId);
    const ds = us.demoStats;
    const wr = ds.exits > 0 ? +(ds.wins / ds.exits * 100).toFixed(1) : 0;
    return {
        entries: ds.entries, exits: ds.exits, pnl: ds.pnl,
        wins: ds.wins, losses: ds.losses, winRate: wr,
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
    const exchangeMode = creds ? (creds.mode || 'live') : null;
    const resolvedEnv = us.engineMode === 'demo' ? 'DEMO'
        : (exchangeMode === 'testnet' ? 'TESTNET' : 'REAL');
    return {
        mode: us.engineMode,
        enabled: us.atActive, // [F1] Reflect actual per-user AT state
        atActive: us.atActive, // [F1] Explicit field for frontend
        apiConfigured: !!creds,
        exchangeMode: exchangeMode,       // 'testnet' | 'live' | null
        resolvedEnv: resolvedEnv,          // 'DEMO' | 'TESTNET' | 'REAL'
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
    // Reset only demo stats — live stats and live daily PnL stay intact
    us.demoStats = { entries: 0, exits: 0, pnl: 0, wins: 0, losses: 0 };
    us.dailyPnLDemo = 0;
    // Recalculate combined stats from live (demo portion zeroed)
    const ls = us.liveStats;
    us.stats = { entries: ls.entries, exits: ls.exits, pnl: ls.pnl, wins: ls.wins, losses: ls.losses };
    us.dailyPnL = us.dailyPnLLive;
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
    us.seq = db.getMaxSeq(userId); // [S2] preserve seq continuity — never reuse archived seq numbers
    us.stats = { entries: 0, exits: 0, pnl: 0, wins: 0, losses: 0 };
    us.liveStats = { entries: 0, exits: 0, pnl: 0, wins: 0, losses: 0, blocked: 0, errors: 0 };
    us.liveSeq = us.seq; // [S2] keep liveSeq aligned
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

// ══════════════════════════════════════════════════════════════════
// Register manual LIVE/TESTNET position as server-tracked Zeus object
// Called after successful exchange fill for PT/manual orders
// ══════════════════════════════════════════════════════════════════
function registerManualPosition(userId, data) {
    if (!userId) return { ok: false, error: 'Missing userId' };
    if (!data || !data.symbol || !data.side || !data.entryPrice || !data.qty) {
        return { ok: false, error: 'Missing required fields (symbol, side, entryPrice, qty)' };
    }
    const us = _uState(userId);
    const seq = ++us.seq;
    const price = parseFloat(data.entryPrice);
    const qty = parseFloat(data.qty);
    const lev = parseInt(data.leverage, 10) || 1;
    const size = (lev > 0) ? (qty * price / lev) : (qty * price);
    const side = data.side === 'BUY' ? 'LONG' : (data.side === 'SELL' ? 'SHORT' : data.side);

    // Duplicate guard: only for LIVE (exchange merges same-side positions into one).
    // DEMO allows multiple independent manual positions on same (symbol, side) —
    // each gets its own seq, DSL state, and lifecycle. Dedup would collapse them
    // on the client via _mapServerPos and cause positions to disappear.
    const mode = data.mode || us.engineMode;
    if (mode === 'live') {
        const existing = _positions.find(p => p.userId === userId && p.symbol === data.symbol && p.side === side && p.mode === 'live');
        if (existing) {
            logger.info('AT_ENGINE', `[${seq}] LIVE manual position already tracked as seq=${existing.seq} — skipping`);
            return { ok: true, seq: existing.seq, alreadyTracked: true };
        }
    }

    const sl = data.sl ? parseFloat(data.sl) : null;
    const tp = data.tp ? parseFloat(data.tp) : null;
    const slDist = sl ? Math.abs(price - sl) : 0;
    const tpDist = tp ? Math.abs(price - tp) : 0;
    const slPct = price > 0 && slDist > 0 ? +(slDist / price * 100).toFixed(2) : 0;
    const rr = slDist > 0 && tpDist > 0 ? +(tpDist / slDist).toFixed(2) : 0;
    const tpPnl = tp ? +(tpDist / price * size * lev).toFixed(2) : 0;
    const slPnl = sl ? +(-slDist / price * size * lev).toFixed(2) : 0;

    // [DSL-OFF] Client sends dslParams === null when DSL engine is disabled.
    // In that case skip DSL attach entirely — position runs purely on exchange TP/SL (or demo tick-exits).
    const _dslOff = (data.dslParams === null);
    const entry = {
        seq,
        userId,
        ts: Date.now(),
        symbol: data.symbol,
        side,
        mode: data.mode || us.engineMode,
        price,
        size,
        margin: size,
        lev,
        qty: +qty.toFixed(6),
        sl, tp, slPct, rr, tpPnl, slPnl,
        status: 'OPEN',
        closeTs: null, closePnl: null, closeReason: null,
        // Manual-specific metadata
        autoTrade: false,
        sourceMode: 'manual',
        controlMode: 'user',
        // DSL params: null = engine OFF (no DSL), object = user-provided, undefined = use defaults
        dslParams: _dslOff ? null : ((data.dslParams && typeof data.dslParams === 'object') ? data.dslParams : serverDSL.DSL_DEFAULTS),
        originalEntry: price,
        originalSize: size,
        originalQty: +qty.toFixed(6),
        addOnCount: 0,
        addOnHistory: [],
        // Live exchange metadata
        live: data.orderId ? {
            status: 'LIVE',
            liveSeq: ++us.liveSeq,
            mainOrderId: data.orderId,
            avgPrice: price,
            executedQty: qty,
            slOrderId: data.slOrderId || null,
            tpOrderId: data.tpOrderId || null,
        } : null,
    };

    _positions.push(entry);
    if (!_dslOff) {
        serverDSL.attach(entry, entry.dslParams);
    } else {
        logger.info('AT_ENGINE', `[${seq}] uid=${userId} MANUAL registered with DSL OFF — no DSL attach`);
    }
    _persistState(userId);
    _persistPosition(entry);
    _notifyChange(userId);

    logger.info('AT_ENGINE', `[${seq}] uid=${userId} MANUAL ${side} ${data.symbol} @ $${price.toFixed(2)} | Size=$${size.toFixed(0)} Lev=${lev}x | Registered as server-tracked`);

    return { ok: true, seq, position: entry };
}

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
    // [M1] Block add-ons when AT is OFF — no exposure growth while disabled
    const us = _uState(userId);
    if (!us.atActive) return { ok: false, error: 'Cannot add on: AT is OFF' };

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
                audit.record('SAT_ADDON_FAILED', { userId, seq, symbol: pos.symbol, error: err.message }, 'SERVER_AT');
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
            if (!Number.isFinite(fillPrice) || fillPrice <= 0 || !Number.isFinite(fillQty) || fillQty <= 0) {
                logger.error('AT_ADDON', `[${seq}] LIVE addon fill unverified — ADDON_FAILED`);
                audit.record('SAT_ADDON_FILL_UNVERIFIED', { userId, seq, symbol: pos.symbol, orderId: addonOrder.orderId }, 'SERVER_AT');
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
            pos.slPnl = -Math.abs(+((slDist / pos.price) * pos.size * pos.lev).toFixed(2));

            // ── Cancel old SL/TP orders ──
            if (pos.live.slOrderId) await _cancelOrderSafe(pos.symbol, pos.live.slOrderId, creds, userId); // [S5]
            if (pos.live.tpOrderId) await _cancelOrderSafe(pos.symbol, pos.live.tpOrderId, creds, userId); // [S5]

            // ── Place new SL with total qty ──
            const closeSide = pos.side === 'LONG' ? 'SELL' : 'BUY';
            const totalRounded = roundOrderParams(pos.symbol, totalQty, pos.sl);
            const totalRoundedTp = roundOrderParams(pos.symbol, totalQty, pos.tp);
            const totalQtyStr = String(totalRounded.quantity || totalQty);
            let newSlOrder = null;
            for (let attempt = 0; attempt <= ADDON_SL_RETRIES.length; attempt++) {
                try {
                    newSlOrder = await _placeConditionalOrder({
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

            // [DSL-SEMANTIC-FIX] No native TP on addons either — DSL handles exit.
            let newTpOrder = null;
            /* TP placement intentionally skipped for DSL-controlled positions. */

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
                audit.record('SAT_ADDON_SLTP_FAILED', { userId, seq, symbol: pos.symbol, totalQty }, 'SERVER_AT');
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
                        audit.record('SAT_ADDON_QTY_RESYNCED', { userId, seq, symbol: pos.symbol, internal: totalQty, exchange: exchangeQty }, 'SERVER_AT');
                    }
                }
            } catch (reconErr) {
                logger.warn('AT_ADDON', `[${seq}] Post-addon reconciliation failed: ${reconErr.message}`);
            }

            // ── Re-attach DSL with new SL (skip if DSL OFF for this position) ──
            if (pos.dslParams) serverDSL.attach(pos, pos.dslParams);

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
                userId, seq, symbol: pos.symbol, side: pos.side,
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
        pos.slPnl = -Math.abs(+((slDist / pos.price) * pos.size * pos.lev).toFixed(2));

        // ── Deduct demo balance ──
        if (pos.mode === 'demo') {
            us.demoBalance = +(us.demoBalance - addOnSize).toFixed(2);
        }

        // ── Re-attach DSL with new SL (skip if DSL OFF for this position) ──
        if (pos.dslParams) serverDSL.attach(pos, pos.dslParams);

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
    // [F3] Track when user takes control — for timeout safety
    if (controlMode === 'user') pos._controlModeTs = Date.now();
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

// Client pushes dslParams for positions under user/manual/paper control
function updateDslParams(userId, seq, dslParams) {
    const pos = _positions.find(p => p.seq === seq && p.userId === userId);
    if (!pos) return { ok: false, error: 'Position not found' };
    // Allow param updates for user-controlled, manual, and paper positions
    const cm = (pos.controlMode || '').toLowerCase();
    if (cm !== 'user' && cm !== 'paper' && cm !== 'manual' && pos.autoTrade) {
        return { ok: false, error: 'Not in user control' };
    }
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
// [V5.4] Orphan pending map — tracks first detection for 2-cycle confirmation
const _orphanPending = new Map(); // "userId:symbol:side" → { firstSeen, bpos, userId, symbol }

async function _runReconciliation(isStartup) {
    if (_reconRunning) return;
    _reconRunning = true;
    const label = isStartup ? 'STARTUP_RECON' : 'RECON';
    try {
        const livePositions = _positions.filter(p => p.mode === 'live' && p.live && (p.live.status === 'LIVE' || p.live.status === 'LIVE_NO_SL'));
        if (livePositions.length === 0) return; // [B6] finally will reset _reconRunning

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

                    // Query userTrades for real fill price (best-effort)
                    let realExitPrice = null;
                    let realPnl = null;
                    try {
                        const trades = await sendSignedRequest('GET', '/fapi/v1/userTrades', {
                            symbol: pos.symbol, limit: 10,
                        }, creds);
                        if (Array.isArray(trades) && trades.length > 0) {
                            // Find the most recent trade matching our side (reduce-only = exit)
                            const exitTrade = trades.reverse().find(t =>
                                t.symbol === pos.symbol && t.realizedPnl && parseFloat(t.realizedPnl) !== 0
                            );
                            if (exitTrade) {
                                realExitPrice = parseFloat(exitTrade.price);
                                realPnl = parseFloat(exitTrade.realizedPnl);
                                logger.info(label, `[${pos.seq}] PHANTOM real fill: price=$${realExitPrice} pnl=$${realPnl} (from userTrades)`);
                            }
                        }
                    } catch (tradeErr) {
                        logger.warn(label, `[${pos.seq}] userTrades query failed: ${tradeErr.message} — using markPrice fallback`);
                    }

                    telegram.sendToUser(userId,
                        `🔍 *RECON: Phantom Position Removed*\n${pos.side} ${pos.symbol} seq=${pos.seq}\nPosition not found on Binance — likely closed externally (SL/TP hit, liquidation, or manual close).\nRemoving from server tracker.`
                    );
                    const idx = _positions.findIndex(p => p.seq === pos.seq && p.userId === userId);
                    if (idx >= 0) {
                        const exitPrice = realExitPrice || (bpos ? bpos.markPrice : (pos._lastPrice || pos.price));
                        const pnl = realPnl != null ? realPnl : (pos.side === 'LONG'
                            ? +((exitPrice - pos.price) / pos.price * pos.size * pos.lev).toFixed(2)
                            : +((pos.price - exitPrice) / pos.price * pos.size * pos.lev).toFixed(2));
                        _closePosition(idx, pos, 'RECON_PHANTOM', exitPrice, pnl);
                    }
                    audit.record('SAT_RECON_PHANTOM', { seq: pos.seq, symbol: pos.symbol, side: pos.side, userId, realExitPrice, realPnl }, 'SERVER_AT');
                    continue;
                }

                // Position exists on Binance — now check order health
                await _checkOrderHealth(pos, creds, label);
            }

            // 3. Check for ORPHAN positions (Binance has, server doesn't track)
            // [V5.4] 2-cycle confirmation + SAT_ prefix check before auto-close
            for (const [symbol, bpos] of binanceHeld) {
                const tracked = userLivePositions.find(p => p.symbol === symbol && p.side === bpos.side);
                if (!tracked) {
                    const _orphanKey = `${userId}:${symbol}:${bpos.side}`;

                    if (!_orphanPending.has(_orphanKey)) {
                        // First detection — mark pending, alert, wait for next cycle
                        _orphanPending.set(_orphanKey, { firstSeen: Date.now(), bpos, userId, symbol });
                        logger.warn(label, `ORPHAN detected uid=${userId}: ${bpos.side} ${symbol} amt=${bpos.amt} — pending confirmation (next cycle)`);
                        telegram.sendToUser(userId,
                            `⚠️ *RECON: Orphan Detected*\n${bpos.side} ${symbol} | Qty: ${bpos.amt}\nEntry: $${bpos.entryPrice.toFixed(2)} | uPnL: $${bpos.unrealizedProfit.toFixed(2)}\nVerifying in next recon cycle (60s)...`
                        );
                        audit.record('SAT_RECON_ORPHAN_PENDING', { symbol, side: bpos.side, amt: bpos.amt, userId }, 'SERVER_AT');
                    } else {
                        // Second detection — confirmed orphan, check if Zeus-created via open orders
                        logger.warn(label, `ORPHAN confirmed uid=${userId}: ${bpos.side} ${symbol} — checking SAT_ orders`);
                        let isZeusCreated = false;
                        try {
                            const openOrders = await sendSignedRequest('GET', '/fapi/v1/openOrders', { symbol }, creds);
                            isZeusCreated = Array.isArray(openOrders) && openOrders.some(o =>
                                o.clientOrderId && o.clientOrderId.startsWith('SAT_')
                            );
                            // [ALGO-FIX] Also check algo orders (SL/TP are conditional algo orders)
                            if (!isZeusCreated) {
                                try {
                                    let algoOrders = await sendSignedRequest('GET', '/fapi/v1/openAlgoOrders', { symbol }, creds);
                                    if (algoOrders && algoOrders.orders) algoOrders = algoOrders.orders;
                                    if (Array.isArray(algoOrders)) {
                                        isZeusCreated = algoOrders.some(o =>
                                            o.clientAlgoId && o.clientAlgoId.startsWith('SAT_')
                                        );
                                    }
                                } catch (_) {}
                            }
                            // If no open orders but orphan confirmed, also treat as Zeus-created
                            // (SL/TP may have been cancelled already by V5.3)
                            if (!isZeusCreated && openOrders.length === 0) isZeusCreated = true;
                        } catch (oErr) {
                            logger.warn(label, `Open orders check failed for ${symbol}: ${oErr.message}`);
                        }

                        if (isZeusCreated) {
                            // Auto-close: MARKET close with reduceOnly
                            try {
                                const closeSide = bpos.side === 'LONG' ? 'SELL' : 'BUY';
                                const absAmt = Math.abs(bpos.amt);
                                const rounded = roundOrderParams(symbol, absAmt);
                                const closeResult = await sendSignedRequest('POST', '/fapi/v1/order', {
                                    symbol,
                                    side: closeSide,
                                    type: 'MARKET',
                                    quantity: String(rounded.quantity || absAmt),
                                    reduceOnly: true,
                                    newClientOrderId: `SAT_RECON_CLOSE_${Date.now()}`,
                                }, creds);
                                const _orphRaw = parseFloat(closeResult.avgPrice);
                                const fillPrice = (Number.isFinite(_orphRaw) && _orphRaw > 0) ? _orphRaw : bpos.markPrice;
                                logger.info(label, `ORPHAN auto-closed uid=${userId}: ${bpos.side} ${symbol} @ $${fillPrice.toFixed(2)}`);
                                telegram.sendToUser(userId,
                                    `✅ *RECON: Orphan Auto-Closed*\n${bpos.side} ${symbol} | Qty: ${bpos.amt}\nFill: $${fillPrice.toFixed(2)} | uPnL was: $${bpos.unrealizedProfit.toFixed(2)}\nPosition was not tracked by server — closed for safety.`
                                );
                                audit.record('SAT_RECON_ORPHAN_CLOSED', { symbol, side: bpos.side, amt: bpos.amt, fillPrice, userId }, 'SERVER_AT');
                                // Cancel any remaining SAT_ orders on this symbol (regular + algo)
                                try {
                                    const remaining = await sendSignedRequest('GET', '/fapi/v1/openOrders', { symbol }, creds);
                                    for (const o of remaining) {
                                        if (o.clientOrderId && o.clientOrderId.startsWith('SAT_')) {
                                            await _cancelOrderSafe(symbol, o.orderId, creds, userId);
                                        }
                                    }
                                    // [ALGO-FIX] Also cancel algo orders (SL/TP)
                                    let algoRemaining = await sendSignedRequest('GET', '/fapi/v1/openAlgoOrders', { symbol }, creds);
                                    if (algoRemaining && algoRemaining.orders) algoRemaining = algoRemaining.orders;
                                    if (Array.isArray(algoRemaining)) {
                                        for (const o of algoRemaining) {
                                            if (o.clientAlgoId && o.clientAlgoId.startsWith('SAT_')) {
                                                await _cancelOrderSafe(symbol, o.algoId, creds, userId);
                                            }
                                        }
                                    }
                                } catch (_) { }
                            } catch (closeErr) {
                                logger.error(label, `ORPHAN auto-close FAILED uid=${userId}: ${bpos.side} ${symbol} — ${closeErr.message}`);
                                telegram.sendToUser(userId,
                                    `🚨 *RECON: Orphan Close FAILED*\n${bpos.side} ${symbol} | Qty: ${bpos.amt}\nError: ${closeErr.message}\n*Close this position manually on Binance!*`
                                );
                            }
                        } else {
                            // Not Zeus-created — alert only
                            if (!_reconAlerted.orphans.has(_orphanKey)) {
                                _reconAlerted.orphans.add(_orphanKey);
                                telegram.sendToUser(userId,
                                    `⚠️ *RECON: External Orphan*\n${bpos.side} ${symbol} | Qty: ${bpos.amt}\nThis position was NOT created by Zeus (no SAT_ orders).\nManual review required.`
                                );
                            }
                        }
                        _orphanPending.delete(_orphanKey);
                    }
                } else {
                    // Position is tracked — clean up any stale pending entry
                    const _orphanKey = `${userId}:${symbol}:${bpos.side}`;
                    if (_orphanPending.has(_orphanKey)) {
                        _orphanPending.delete(_orphanKey);
                        logger.info(label, `Orphan false alarm cleared: ${bpos.side} ${symbol} uid=${userId}`);
                    }
                }
            }

            // [LIVE-PARITY] Check pending live closes — resolve or escalate
            for (const [seq, pending] of _pendingLiveCloses) {
                if (pending.pos.userId !== userId) continue;
                const key = `${pending.pos.symbol}_${pending.pos.side}`;
                const stillOnExchange = binanceHeld.has(pending.pos.symbol) &&
                    binanceHeld.get(pending.pos.symbol).side === pending.pos.side;
                if (!stillOnExchange) {
                    // Position closed on exchange (by SL/TP/liquidation) — remove from queue
                    _pendingLiveCloses.delete(seq);
                    logger.info(label, `[${seq}] Pending close resolved — position no longer on exchange`);
                } else if (Date.now() - pending.ts > 300000) {
                    // 5min timeout — alert for manual intervention
                    _pendingLiveCloses.delete(seq);
                    telegram.sendToUser(userId, `🚨 *RECON: Position still open after 5min*\n${pending.pos.side} ${pending.pos.symbol}\nAll auto-close attempts failed. Manual close required on exchange!`);
                    audit.record('SAT_RECON_PENDING_TIMEOUT', { seq, symbol: pending.pos.symbol, side: pending.pos.side, userId }, 'SERVER_AT');
                }
            }

            // [LIVE-PARITY] Update liveBalanceRef periodically for kill switch accuracy
            if (!isStartup) {
                const us = _uState(userId);
                try {
                    const balances = await sendSignedRequest('GET', '/fapi/v2/balance', {}, creds);
                    const usdtBal = balances.find(b => b.asset === 'USDT');
                    if (usdtBal) {
                        const realBalance = parseFloat(usdtBal.balance || 0);
                        if (realBalance > 0) us.liveBalanceRef = realBalance;
                    }
                } catch (_) { /* balance refresh non-critical */ }
            }

            if (isStartup && userLivePositions.length > 0) {
                logger.info(label, `Startup recon uid=${userId} complete — ${userLivePositions.length} live positions checked, ${binanceHeld.size} Binance positions found`);
            }
        }
    } catch (err) {
        logger.error('RECON', `Reconciliation error: ${err.message}`);
    } finally {
        _reconRunning = false;
    }
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
    // [ALGO-FIX] Also fetch algo orders (SL/TP are conditional algo orders since Dec 2025)
    let openAlgoOrders = [];
    try {
        openAlgoOrders = await sendSignedRequest('GET', '/fapi/v1/openAlgoOrders', { symbol: pos.symbol }, creds);
        if (openAlgoOrders && openAlgoOrders.orders) openAlgoOrders = openAlgoOrders.orders;
    } catch (_) { /* non-critical — regular orders still checked */ }

    const orderIds = new Set([
        ...openOrders.map(o => o.orderId),
        ...(Array.isArray(openAlgoOrders) ? openAlgoOrders.map(o => o.algoId) : []),
    ]);

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
            const newSl = await _placeConditionalOrder({
                symbol: pos.symbol, side: closeSide, type: 'STOP_MARKET',
                quantity: String(rounded.quantity || pos.live.executedQty),
                stopPrice: String(rounded.stopPrice != null ? rounded.stopPrice : currentSL),
                reduceOnly: true, newClientOrderId: `SAT_RESLOT_${pos.live.liveSeq}_${Date.now()}`,
            }, creds);
            pos.live.slOrderId = newSl.orderId;
            pos.live.status = 'LIVE';
            replaced = true;
            logger.info(label, `[${pos.seq}] SL re-placed successfully → algoId=${newSl.orderId}`);
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

    // [DSL-SEMANTIC-FIX] TP reconciliation disabled — DSL-controlled positions
    // have no native TP on exchange. If an old pos still has tpOrderId from
    // before the fix, just clear it silently.
    if (pos.live.tpOrderId && !orderIds.has(pos.live.tpOrderId)) {
        pos.live.tpOrderId = null;
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
                const newSl = await _placeConditionalOrder({
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
                logger.info('WATCHDOG', `[${pos.seq}] SL repaired → algoId=${newSl.orderId} @ $${currentSL}`);
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
    // Getters
    getOpenPositions,
    getOpenCount,
    isCloseCooldownActive, // [RE-ENTRY] Check post-close cooldown
    getLog,
    getStats,
    getLiveStats,
    getLivePositions,
    getDemoBalance,
    getFullState,
    // Mode control
    setMode,
    getMode,
    isATActive,
    preLiveChecklist,
    toggleActive, // [F1] Per-user AT on/off
    activateKillSwitch,
    resetKill,
    setKillPct,
    setLiveBalanceRef,
    // Change listener
    onChange,
    // [V3] State access for brain modules
    getUserState: function(userId) { try { return _uState(userId); } catch(_) { return null; } },
    // Admin
    reset,
    addDemoFunds,
    resetDemoBalance,
    // Client actions
    registerManualPosition,
    closeBySeq,
    addOnPosition,
    updateControlMode,
    updateDslParams,
    setDslEnabled,
    getDslEnabled,
    // Reconciliation (for manual trigger / testing)
    _runReconciliation,
    // Watchdog (for manual trigger / testing)
    _watchdogLiveNoSL,
};
