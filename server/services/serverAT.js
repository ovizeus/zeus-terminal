// Zeus Terminal — Server AutoTrade Engine (Unified, Per-User)
// Single source-of-truth for ALL positions (demo + live).
// Demo = simulated (no Binance calls). Live = real execution.
// Persisted in SQLite — survives restarts.
// Per-user isolation: each userId has independent state, positions, balance.
'use strict';

const crypto = require('crypto');
const Sentry = require('@sentry/node');
const logger = require('./logger');
const MF = require('../migrationFlags');
const credentialStore = require('./credentialStore');
const { getExchangeCreds, getExchangeCredsFor } = credentialStore;
const { credsForPosition } = require('./credsRouting');
// [Multi-exchange switch P2a] Creds for an existing position's OWN exchange.
// New orders use getExchangeCreds (active); close/SL/TP/add-on of an open position
// route to position.exchange so old-exchange positions stay managed after a switch.
function _credsForPosition(userId, pos) { return credsForPosition(credentialStore, userId, pos); }
// [P5b] Keep a live position's exchange feed alive while it's open (managed), so
// DSL/SL keep ticking on the OLD exchange after a switch-away. Guarded to live +
// real exchange + userId; lazy-require + try/catch so a feed-hold hiccup NEVER
// breaks the entry/close path. Demo/legacy (no exchange) are skipped.
function _trackLiveOpen(pos) {
    try {
        if (pos && pos.mode === 'live' && pos.exchange && pos.userId != null) {
            require('./feedManager').markPositionOpen(pos.userId, pos.exchange);
        }
    } catch (_) { /* feed hold is best-effort */ }
}
function _trackLiveClose(pos) {
    try {
        if (pos && pos.mode === 'live' && pos.exchange && pos.userId != null) {
            require('./feedManager').markPositionClosed(pos.userId, pos.exchange);
        }
    } catch (_) { /* feed hold is best-effort */ }
}
const { sendSignedRequest } = require('./binanceSigner');
// [Task 40 — Bybit Phase 1A+1B] exchangeOps router: routes entry/close/balance
// calls to the correct exchange (Binance or Bybit) based on per-user config.
// Replaces direct sendSignedRequest calls in _executeLiveEntry + _executeLiveEntryCore.
const exchangeOps = require('./exchangeOps');
const { roundOrderParams, getFilters: _getExchangeFilters } = require('./exchangeInfo');
const { computeOrderGeometry } = require('./orderGeometry');
const { validateOrder, recordClosedPnL } = require('./riskGuard');
const telegram = require('./telegram');
const audit = require('./audit');
// [BUG-T2a + T2b 2026-05-13] Pure-function recon helpers extracted pentru
// testability. T2a: hedge-aware Binance held map. T2b: strict userTrades filter.
const { buildBinanceHeldMap, findExitTrade, buildHeldMap, groupPositionsByExchange, isUntrustedEmptyHeld } = require('./reconHelpers');
const metrics = require('./metrics');
const serverDSL = require('./serverDSL');
const mlDslPolicy = require('./mlDslPolicy');
const dslSafety = require('./dslSafety');
const mlDslShadow = require('./mlDslShadow');
const priceTrace = require('./priceTrace');
const mlDslLearner = require('./mlDslLearner');
const { rewindSafeSeq } = require('./seqGuard');
const seqAllocator = require('./seqAllocator');
const db = require('./database');
const marketFeed = require('./marketFeed');

// [ML Phase B Day 8] Ring5 outcome telemetry — recordContribution on close
// feeds bandit posteriors with real win/loss observations. Lazy-required to
// avoid circular dep risk through ring5LearningService -> database -> serverAT.
let _ring5LearningService = null;
function _getRing5() {
    if (_ring5LearningService === null) {
        try { _ring5LearningService = require('./ml/ring5LearningService'); }
        catch (_) { _ring5LearningService = false; }
    }
    return _ring5LearningService || null;
}

// [Day 28 2026-05-18] R5A attribution telemetry — recordAttribution on close
// feeds ml_attribution_events for §16 measurement triad (attribution + hit_rate
// + per-symbol+regime). Lazy require to avoid circular deps.
let _r5aAttribution = null;
function _getR5AAttribution() {
    if (_r5aAttribution === null) {
        try { _r5aAttribution = require('./ml/R5A_learning/attributionEngine'); }
        catch (_) { _r5aAttribution = false; }
    }
    return _r5aAttribution || null;
}

// [Day 17 2026-05-18] Doctor telemetry — emit alerts on safety paths.
// Lazy require + try/catch swallow: telemetry never affects AT flow.
let _doctorEventBus = null;
function _getDoctorBus() {
    if (_doctorEventBus === null) {
        try { _doctorEventBus = require('./ml/_doctor/eventBus'); }
        catch (_) { _doctorEventBus = false; }
    }
    return _doctorEventBus || null;
}
function _emitDoctor(event) {
    try {
        const bus = _getDoctorBus();
        if (bus && typeof bus.emit === 'function') bus.emit(event);
    } catch (_) { /* never block AT flow */ }
}

// ══════════════════════════════════════════════════════════════════
// Per-User Position Tracker
// ══════════════════════════════════════════════════════════════════
const MAX_LOG = 200;
const MAX_POSITIONS = 20;

const _positions = [];          // flat array — each pos carries .userId
const _userState = new Map();   // userId → per-user engine state
const _liveEntryLocks = new Set(); // 'userId:symbol' — prevents concurrent live entries
const _pendingLiveCloses = new Map(); // [LIVE-PARITY] seq → { pos, exitType, ts } — failed closes for reconciliation
// [RE-ENTRY + S5] Close-cooldown map. Value semantics changed from closeTs
// (legacy) to deadlineMs (S5+). Persisted per-user in at_state under key
// 'serverAT:closeCooldowns:{uid}' as { 'uid:symbol': deadlineMs }. Restored
// lazily on first isCloseCooldownActive() call per user (no module-load
// boot hook in this file — the cost of restoring is paid at decision time).
const _closeCooldowns = new Map();  // [RE-ENTRY] 'userId:symbol' → deadlineMs
const _lastEntryOwner = new Map();  // [SP2 Task 8] userId → last entryOwner ('CLIENT'|'SERVER') for handover flip detection
const CLOSE_COOLDOWN_MS = 180000;   // [RE-ENTRY] 3 min cooldown after any close (was 10min — reduced for faster DEMO cycling + bandit learning)
const _closeCooldownsRestoredFor = new Set();  // uids whose rows have been lazy-restored

// [Phase 2 S6-B3] Per-user decisionId dedup TTL. Sized to one full brain
// cycle (CYCLE_INTERVAL_MS in serverBrain = 30s) so a single decision
// arriving at most once per cycle interval cannot be double-accepted
// during the S6-B6+ transition window. Persisted in at_state under the
// per-user key 'serverAT:lastDecisionId:<uid>'.
const DECISION_DEDUP_TTL_MS = 30000;

const DEFAULT_DEMO_BALANCE = 10000;

// [BUG-TM-8] LOT_SIZE-aware qty alignment helper — money-path safe.
// Returns { qty, size, aligned: true } if exchangeInfo cache has stepSize for symbol AND
// roundOrderParams produces a valid stepSize-aligned positive quantity AND derived size >= MIN_TRADE_USD.
// Returns null if any condition fails — caller MUST block entry/registration (no silent fallback to toFixed(6),
// which would recreate the TM-8 bug for money-path entries).
//
// @param {string} symbol — e.g. 'BTCUSDT'
// @param {number} rawQty — pre-rounded float qty (e.g. (sizeUsd * lev) / price)
// @param {number} price — entry price
// @param {number} lev — leverage
// @param {string} _context — 'MAIN_ENTRY' | 'MANUAL_REGISTER' | 'DEMO_ADDON' (for log clarity, optional)
// @returns {{qty:number, size:number, aligned:true} | null}
function _alignQtyToLotSize(symbol, rawQty, price, lev, _context) {
    const MIN_TRADE_USD = 10;
    if (!Number.isFinite(rawQty) || rawQty <= 0) return null;
    if (!Number.isFinite(price) || price <= 0) return null;
    if (!Number.isFinite(lev) || lev <= 0) return null;
    // Hard rule: cache MUST have stepSize for this symbol — block otherwise (prove cache hit explicitly).
    let filters;
    try { filters = _getExchangeFilters(symbol); } catch (_) { filters = null; }
    if (!filters || !filters.stepSize) return null;
    let qty;
    try {
        const _r = roundOrderParams(symbol, rawQty);
        if (!_r || !Number.isFinite(_r.quantity) || _r.quantity <= 0) return null;
        qty = _r.quantity;
    } catch (_) { return null; }
    if (!Number.isFinite(qty) || qty <= 0) return null;
    const size = +(qty * price / lev).toFixed(2);
    if (!Number.isFinite(size) || size < MIN_TRADE_USD) return null;
    return { qty, size, aligned: true };
}

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
        // [Task S8-P1-4 2026-05-28] Streak counters — broadcast to client so
        // brain PREDATOR/DEFENSE gates stay correct when the SERVER executes
        // trades (client _bmPostClose no longer fires under server authority).
        // lossStreak/winStreak persist across days (reset only on opposite
        // outcome); dailyTrades resets at UTC day rollover.
        lossStreak: 0,
        winStreak: 0,
        dailyTrades: 0,
        // [T-MAXTRADES 2026-06-07] dailyEntries = AT entries OPENED today (cap
        // counter; dailyTrades counts CLOSES). maxDayProtectOffDay = UTC day on
        // which the operator disabled the cap; protection auto-re-arms when the
        // day changes. Both reset/compared against the UTC day.
        dailyEntries: 0,
        maxDayProtectOffDay: 0,
        lastResetDay: -1,
        atActive: false, // [BUG-O5] LEGACY field — kept synced cu current engineMode via toggleActive (BUG-T7 2026-05-13)
        atActiveDemo: false, // [BUG-T7 2026-05-13] Per-mode AT toggle — DEMO independent
        atActiveLive: false, // [BUG-T7 2026-05-13] Per-mode AT toggle — LIVE independent
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

// ══════════════════════════════════════════════════════════════════
// [Phase 2 S2.A] Decision Idempotency
// ══════════════════════════════════════════════════════════════════
// Stable 8-char hex token generated once per brain decision event and
// stamped on the position entry (entry.decisionId). Combined with
// entry.seq it builds the `newClientOrderId` passed to Binance, which
// gives exchange-level dedupe: a retried POST /fapi/v1/order with the
// same clientOrderId returns the original order instead of creating a
// duplicate. 32 bits of entropy × per-user seq = no realistic collision.
// decisionId survives restarts because it's persisted inside the
// at_positions.data JSON blob (no schema change).
function _newDecisionId() {
    return crypto.randomBytes(4).toString('hex');
}

// ══════════════════════════════════════════════════════════════════
// [Task G 2026-05-28] Graceful shutdown drain counter
// ══════════════════════════════════════════════════════════════════
// Tracks in-flight _executeLiveEntry calls so _gracefulShutdown can wait
// for them to settle before closing DB / exchange. Without this, PM2 restart
// mid-entry creates orphan orders (exchange holds it; DB doesn't know).
// Counter incremented/decremented inside _executeLiveEntry try/finally.
// drainPending(maxWaitMs) polls every 50ms until counter==0 or timeout.
let _pendingEntries = 0;

function _incPending() { _pendingEntries++; }
function _decPending() { _pendingEntries = Math.max(0, _pendingEntries - 1); }

// ══════════════════════════════════════════════════════════════════
// [Task L 2026-05-28] Pre-trade balance sanity check
// ══════════════════════════════════════════════════════════════════
// Before _executeLiveEntry calls exchangeOps.placeEntry, verify the user
// actually has enough free balance. Catches stale-cache scenarios where
// brain decided $X entry but a withdrawal/loss happened between balance
// fetch and decision. Fail-open on balance fetch errors — exchange will
// reject if truly insufficient, and blocking on a stale balance API
// would cause more harm than good.
//
// Headroom factor 1.1 (10%) accounts for fees, slippage on entry, and
// margin requirements above bare sizeUsd.
async function _checkBalanceForEntry(userId, sizeUsd) {
    const size = Number(sizeUsd);
    if (!Number.isFinite(size) || size <= 0) {
        return { ok: true, free: null, required: 0 };
    }
    // Round to 2dp to avoid FP artifacts (100 * 1.1 = 110.00000000000001)
    const required = Math.round(size * 110) / 100;
    try {
        const exchangeOps = require('./exchangeOps');
        const bal = await exchangeOps.getBalance(userId);
        const free = Number(
            bal ? (bal.free !== undefined ? bal.free : bal.availableBalance) : 0
        ) || 0;
        if (free < required) {
            return { ok: false, reason: 'BALANCE_INSUFFICIENT', free, required };
        }
        return { ok: true, free, required };
    } catch (err) {
        // Fail-open: exchange will reject if truly insufficient.
        return { ok: true, skipped: true, error: err && err.message ? err.message : String(err) };
    }
}

/**
 * Wait for in-flight _executeLiveEntry calls to settle, up to maxWaitMs.
 * @param {number} [maxWaitMs=5000]
 * @returns {Promise<{settled: boolean, timedOut: boolean, pending: number}>}
 */
async function drainPending(maxWaitMs) {
    const maxWait = Number(maxWaitMs) > 0 ? Number(maxWaitMs) : 5000;
    const t0 = Date.now();
    while (_pendingEntries > 0 && (Date.now() - t0) < maxWait) {
        await new Promise(r => setTimeout(r, 50));
    }
    return {
        settled: _pendingEntries === 0,
        timedOut: _pendingEntries > 0,
        pending: _pendingEntries,
    };
}

// ══════════════════════════════════════════════════════════════════
// [Phase 2 S2.B] Global PANIC Halt — cross-user entry kill switch
// ══════════════════════════════════════════════════════════════════
// Persisted in at_state under key 'global:halt' (TEXT PRIMARY KEY ⇒
// single canonical row). user_id records which admin toggled it
// (schema requires NOT NULL). Read on every brain-driven + live entry
// path; write only via admin-gated POST /api/panic. Survives restarts
// because at_state is SQLite-persisted. No schema migration needed.
function isGlobalHaltActive() {
    try {
        const val = db.atGetState('global:halt');
        return !!(val && val.active);
    } catch (e) {
        // Read-failure must not silently pass entries — treat as halted so
        // a broken DB doesn't let orders through. Matches Hard Rule #4
        // (fail fast, no silent coerce).
        logger.error('AT_ENGINE', 'isGlobalHaltActive read failed — defaulting to HALTED for safety: ' + e.message);
        return true;
    }
}

function getGlobalHaltState() {
    try {
        const val = db.atGetState('global:halt');
        if (!val) return { active: false, by: null, ts: null, reason: null };
        return {
            active: !!val.active,
            by: val.by != null ? val.by : null,
            ts: val.ts != null ? val.ts : null,
            reason: val.reason || null,
        };
    } catch (e) {
        return { active: true, by: null, ts: null, reason: null, error: e.message };
    }
}

function setGlobalHalt(active, byUserId, reason) {
    if (!byUserId) throw new Error('setGlobalHalt requires byUserId (admin)');
    const payload = {
        active: !!active,
        by: byUserId,
        ts: Date.now(),
        reason: reason || null,
    };
    db.atSetState('global:halt', payload, byUserId);
    logger.warn('AT_ENGINE', `GLOBAL_HALT ${active ? 'ARMED' : 'DISARMED'} by uid=${byUserId}` + (reason ? ' — ' + reason : ''));
    try { audit.record('GLOBAL_HALT_TOGGLE', { active: !!active, by: byUserId, reason: reason || null }, 'SERVER_AT'); } catch (_) { /* best-effort */ }
    _emitDoctor({
        eventType: 'alert', severity: active ? 'P0' : 'P3',
        moduleId: 'serverAT.globalHalt', ts: Date.now(),
        payload: { active: !!active, by: byUserId, reason: reason || null }
    });
    try {
        telegram.sendToUser(byUserId, active
            ? `🛑 *GLOBAL HALT ARMED*${reason ? '\nReason: ' + reason : ''}\nAll new entries blocked server-wide.`
            : '✅ *GLOBAL HALT DISARMED*\nEntries re-enabled.');
    } catch (_) { /* best-effort */ }
    return payload;
}

// ── Kill Switch config (per-user, persisted in _uState) ──
// KILL_PCT and KILL_BASE removed — now per-user killPct + real balance reference

// ── Fusion tier → size multiplier ──
const TIER_MULT = { LARGE: 1.75, MEDIUM: 1.35, SMALL: 1.0 };

// ── Change listeners (WebSocket push) ──
let _onChangeCallback = null;
// [WS-1] Monotonic frame sequence counter for getFullState — see usage at the
// `seq: ++_wsFrameSeq` field at the bottom of getFullState. Helps clients
// disambiguate two same-ms at_update frames during warm-start + onChange races.
let _wsFrameSeq = 0;
// [BUG-S7] Map serverDSL state → phase string for parity comparison.
// Mirrors client phase derivation (NONE/ACTIVE/IMPULSE) for like-vs-like.
function _dslPhaseString(s) {
    if (!s || !s.active) return 'NONE';
    if (s.phase === 'IMPULSE') return 'IMPULSE';
    return 'ACTIVE';
}
// [TM-4] Round-trip fee rate for Binance Futures. 0.04% per side (taker default,
// most market exits are taker because instant). Round-trip = 0.08% on notional.
// Applied at terminal PnL sites (closePnl set) to correct gross-PnL overstatement
// by ~0.08%. If maker fee promo, actual cost lower — this is conservative max.
const _ROUND_TRIP_FEE_RATE = 0.0008;
function _applyRoundTripFee(grossPnl, size, lev) {
    const notional = (size || 0) * (lev || 0);
    if (!Number.isFinite(notional) || notional <= 0) return grossPnl;
    const fee = notional * _ROUND_TRIP_FEE_RATE;
    return +(grossPnl - fee).toFixed(2);
}

// ══════════════════════════════════════════════════════════════════
// Persistence — save/restore from SQLite
// ══════════════════════════════════════════════════════════════════

// [MIGRATION-F5 commit 3] Emit `positions.changed` over /ws/sync after a
// successful DB commit on a position mutation. Gated by MF.POSITIONS_WS —
// when OFF (default), this function returns immediately and no socket
// traffic is produced. Broadcaster is attached on `global` by server.js;
// missing broadcaster or zero connected clients must not throw.
// Shape matches `WsPositionsChanged` from client/src/types/sync.ts:
//   { type, updated_at, snapshot: { updated_at, positions } }
// Top-level `updated_at` is IDENTICAL to `snapshot.updated_at` by design
// (client dedup is authoritative on the top-level field).
function _broadcastPositions(userId) {
    if (!MF.POSITIONS_WS) return;
    if (!userId) return;
    const broadcast = (typeof global !== 'undefined' && global.__zeusWsBroadcastToUser) || null;
    if (typeof broadcast !== 'function') return;
    try {
        // [MIGRATION-F5 C5-preflip] Snapshot source is DB, not in-memory `_positions`.
        // Why: `_persistClose` emits this broadcast AFTER `db.atArchiveClosed` (DELETE
        // in a transaction) but BEFORE the caller's `_positions.splice(idx, 1)`. If we
        // read from `_positions`, the snapshot would include a transient "zombie" row
        // for the position that was just closed — exactly the scenario the client
        // would then reconcile as "still open". DB is authoritative at this point:
        // the archive transaction has already removed the closed row, and every
        // open-path mutation goes through `db.atSavePosition` before broadcast, so
        // the DB is fully consistent with `_positions` at broadcast time minus the
        // zombie window. DSL runtime state is re-attached here (mirrors the
        // enrichment done by `getOpenPositions`, which is otherwise a pure
        // `_positions` read + DSL overlay).
        const now = Date.now();
        // [R1] Use the same ownership normalization helper as getOpenPositions /
        // getDemoPositions / getLivePositions — otherwise positions.changed
        // shipped raw DB rows, and legacy rows with missing autoTrade/sourceMode
        // landed in the client positionsStore without ownership hints, then
        // ManualTradePanel's `_isManualOwned = p.autoTrade !== true` matched
        // them as manual (AT positions reclassified as manual on broadcast).
        const positions = db.atLoadOpenPositions(userId).map(_normalizePositionRow);
        broadcast(userId, {
            type: 'positions.changed',
            updated_at: now,
            snapshot: {
                updated_at: now,
                positions,
            },
        });
    } catch (e) {
        // [S6-A] Replace previous silent catch with observable warn so a
        // broken broadcast does not vanish from the operator's view. Best-
        // effort guard: never let warn-itself throw inside this hot path.
        try { logger.warn('AT_WS', 'broadcastPositions failed uid=' + userId + ': ' + (e && e.message)); } catch (_) {}
    }
}

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
    try {
        db.atSavePosition(pos);
    } catch (e) {
        logger.error('AT_DB', 'Save position failed: ' + e.message);
        _alertPersistFailure(pos.userId, 'Save position [' + pos.seq + ']', e.message);
        return; // Persist failed — do not broadcast a phantom state.
    }
    // [MIGRATION-F5 commit 3] Post-commit broadcast. No-op when flag OFF.
    _broadcastPositions(pos.userId);
}

// [P1 dual-write dedup 2026-06-08] Returns the linked binanceOps ("Option B")
// at_positions row seq that should be cleaned when this position closes — iff it
// exists and is DISTINCT from the canonical seq. null otherwise. Pure → tested.
function _linkedOpsSeqToCleanup(pos) {
    const opsSeq = pos && pos.live && pos.live.opsSeq;
    if (typeof opsSeq !== 'number' || !Number.isFinite(opsSeq) || opsSeq <= 0) return null;
    if (opsSeq === pos.seq) return null;
    return opsSeq;
}

// [SILENT-ARCHIVE-GUARD 2026-06-12] Pure detector for the months-old bug where a
// still-live position is archived to at_closed with NO close logic (today: ETH
// seq ...53353, live x10, archived 15:33:10 status:OPEN/closeReason:null → exchange
// orphan → re-adopted as a lev=1 source=external row in the MANUAL journal at x1).
// A real close always sets closeReason; a boot stuck-archive carries
// live.status CLOSED/EMERGENCY_CLOSED. Anything else archived with no closeReason
// while status==='OPEN' is the anomaly. Pure → unit-tested.
function _isUnexpectedArchive(pos) {
    if (!pos || typeof pos !== 'object') return false;
    if (pos.closeReason) return false;
    if (pos.status !== 'OPEN') return false;
    const ls = pos.live && pos.live.status;
    if (ls === 'CLOSED' || ls === 'EMERGENCY_CLOSED') return false;
    return true;
}

function _persistClose(pos) {
    // [SILENT-ARCHIVE-GUARD 2026-06-12] Passive instrumentation — NEVER blocks the
    // close. Captures the exact call-site (stack trace) the next time a live
    // position is archived without a close, so the root cause can be fixed.
    try {
        if (_isUnexpectedArchive(pos)) {
            logger.warn('AT_ARCHIVE_GUARD', `[${pos && pos.seq}] SILENT ARCHIVE detected — status=${pos.status} closeReason=${pos.closeReason} live=${pos.live && pos.live.status} sym=${pos.symbol} side=${pos.side} qty=${pos.qty} lev=${pos.lev}\nSTACK:${new Error().stack}`);
            try { audit.record('SAT_SILENT_ARCHIVE_GUARD', { userId: pos.userId, seq: pos.seq, symbol: pos.symbol, side: pos.side, status: pos.status, liveStatus: pos.live && pos.live.status, lev: pos.lev, qty: pos.qty }, 'SERVER_AT'); } catch (_) {}
        }
    } catch (_) { /* instrumentation must never break the close path */ }
    try {
        db.atArchiveClosed(pos);
    } catch (e) {
        logger.error('AT_DB', 'Archive closed failed: ' + e.message);
        _alertPersistFailure(pos.userId, 'Archive closed [' + pos.seq + ']', e.message);
        return false;
    }
    // [P1 dual-write dedup 2026-06-08] Remove the linked binanceOps transitional
    // row (pos.live.opsSeq). On a NORMAL close binanceOps.closePosition already
    // DELETEd it (this is then a 0-row no-op); but close paths that skip
    // binanceOps (EXTERNAL_CLOSE / RECON_PHANTOM / RECON_EXCHANGE_CLOSED) left it
    // orphaned. SQL guard `price IS NULL` ensures we ONLY ever delete a dual-write
    // STUB (a real serverAT position always carries price) — defense-in-depth so a
    // seq mishap can never drop a live position. user_id-scoped. Best-effort:
    // never let dedup failure break the close flow.
    try {
        const _opsSeq = _linkedOpsSeqToCleanup(pos);
        if (_opsSeq != null && pos.userId) {
            const _r = db.db.prepare(
                "DELETE FROM at_positions WHERE seq = ? AND user_id = ? AND json_extract(data, '$.price') IS NULL"
            ).run(_opsSeq, pos.userId);
            if (_r && _r.changes > 0) {
                logger.info('AT_DB', `[${pos.seq}] dual-write dedup: removed linked binanceOps stub row opsSeq=${_opsSeq} (exit=${pos.closeReason || pos.status})`);
                try { audit.record('SAT_DUALWRITE_STUB_CLEANED', { userId: pos.userId, seq: pos.seq, opsSeq: _opsSeq, exit: pos.closeReason || pos.status }, 'SERVER_AT'); } catch (_) {}
            }
        }
    } catch (_e) {
        logger.warn('AT_DB', `[${pos.seq}] dual-write dedup cleanup failed (non-fatal): ${_e.message}`);
    }
    // [MIGRATION-F5 commit 3] Post-commit broadcast. No-op when flag OFF.
    _broadcastPositions(pos.userId);
    // [SERVER-ARES 2026-06-07] ARES-owned closes route their PnL to the ARES
    // virtual wallet. After the archive commit so wallet never double-applies
    // on a failed persist. Lazy require — serverAres requires serverAT.
    if (pos.owner === 'ARES') {
        try { require('./serverAres').onPositionClosed(pos); } catch (e) { logger.warn('AT_DB', `ARES close hook failed seq=${pos.seq}: ${e.message}`); }
    }
    return true;
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
            // [Task S8-P1-4 2026-05-28] Persist streak counters
            lossStreak: us.lossStreak || 0,
            winStreak: us.winStreak || 0,
            dailyTrades: us.dailyTrades || 0,
            dailyEntries: us.dailyEntries || 0,                 // [T-MAXTRADES]
            maxDayProtectOffDay: us.maxDayProtectOffDay || 0,   // [T-MAXTRADES]
            killActive: us.killActive,
            killPct: us.killPct,
            killActiveAt: us.killActiveAt || 0,
            killReason: us.killReason || null,
            killLoss: us.killLoss || 0,
            killLimit: us.killLimit || 0,
            killBalRef: us.killBalRef || 0,
            killModeAtTrigger: us.killModeAtTrigger || null,
            pnlAtReset: us.pnlAtReset,
            liveBalanceRef: us.liveBalanceRef,
            lastResetDay: us.lastResetDay,
            atActive: us.atActive, // [F1] LEGACY synced cu current mode flag
            atActiveDemo: us.atActiveDemo, // [BUG-T7 2026-05-13] per-mode persistent
            atActiveLive: us.atActiveLive, // [BUG-T7 2026-05-13] per-mode persistent
        }, userId);
    } catch (e) {
        logger.error('AT_DB', 'Save state failed: ' + e.message);
        _alertPersistFailure(userId, 'Save state', e.message);
    }
}

function _applyStateBlob(userId, saved) {
    const us = _uState(userId);
    us.engineMode = saved.mode || 'demo';
    // [SEQ-REWIND FIX 2026-06-18 / ARCHIVE-AWARE] Clamp the loaded counter so it can NEVER
    // sit below ANY seq that already exists — open restored positions AND the persisted
    // history in at_closed / at_positions. ROOT CAUSE of the recurring "Manual x1" orphan:
    // a reused seq collides with at_closed.seq (UNIQUE) when the position closes → the
    // at_closed archive move FAILS → the position vanishes from _positions while still LIVE
    // on the exchange → recon orphan-adopts it (external/lev=1) or auto-closes it. Clamping
    // above the GLOBAL max archived seq prevents reuse entirely → no UNIQUE collision → no
    // corrupted close → no orphan. No-op in the healthy case. boot-only (one indexed query).
    let _dbMaxSeq = 0;
    try {
        const _c = db.db.prepare('SELECT MAX(seq) m FROM at_closed').get();
        const _o = db.db.prepare('SELECT MAX(seq) m FROM at_positions').get();
        _dbMaxSeq = Math.max(Number(_c && _c.m) || 0, Number(_o && _o.m) || 0);
    } catch (e) { try { logger.warn('AT_DB', `seq-clamp DB max query failed: ${e.message}`); } catch (_) { } }
    const _openSeqs = _positions.filter(p => p && p.userId === userId).map(p => p.seq);
    const _clamped = rewindSafeSeq(saved.seq, [..._openSeqs, _dbMaxSeq]);
    if (_clamped > (saved.seq || 0)) { try { logger.warn('AT_DB', `[SEQ-CLAMP] uid=${userId} seq raised ${saved.seq || 0}→${_clamped} (dbMax=${_dbMaxSeq}) — preventing reuse/at_closed collision`); } catch (_) { } }
    us.seq = _clamped;
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
    // [Task S8-P1-4 2026-05-28] Restore streak counters across PM2 reload.
    us.lossStreak = saved.lossStreak || 0;
    us.winStreak = saved.winStreak || 0;
    us.dailyTrades = saved.dailyTrades || 0;
    us.dailyEntries = saved.dailyEntries || 0;                 // [T-MAXTRADES]
    us.maxDayProtectOffDay = saved.maxDayProtectOffDay || 0;   // [T-MAXTRADES]
    us.killActive = !!saved.killActive;
    us.killPct = (typeof saved.killPct === 'number' && saved.killPct > 0) ? saved.killPct : 5;
    us.killActiveAt = saved.killActiveAt || 0;
    us.killReason = saved.killReason || null;
    us.killLoss = saved.killLoss || 0;
    us.killLimit = saved.killLimit || 0;
    us.killBalRef = saved.killBalRef || 0;
    us.killModeAtTrigger = saved.killModeAtTrigger || null;
    us.pnlAtReset = saved.pnlAtReset || 0;
    us.liveBalanceRef = saved.liveBalanceRef || 0;
    us.lastResetDay = saved.lastResetDay || -1;
    us.atActive = saved.atActive !== false; // [F1] LEGACY — default true for existing users
    // [BUG-T7 2026-05-13] Backfill new per-mode fields from legacy atActive
    // pentru users care au state-uri persisted pre-T7. Atribuie ambele cu
    // valoarea atActive existentă pentru a păstra current behavior post-deploy.
    us.atActiveDemo = saved.atActiveDemo !== undefined ? !!saved.atActiveDemo : us.atActive;
    us.atActiveLive = saved.atActiveLive !== undefined ? !!saved.atActiveLive : us.atActive;
    logger.info('AT_DB', `State restored uid=${userId}: mode=${us.engineMode} seq=${us.seq} balance=$${us.demoBalance.toFixed(2)} atActive=${us.atActive} atDemo=${us.atActiveDemo} atLive=${us.atActiveLive}`);
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
                    _trackLiveOpen(pos); // [P5b] hold feed for restored live position
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

        // [GLOBAL-SEQ 2026-06-18] Initialize the global seq allocator above the historical max
        // across at_closed + at_positions + all restored open positions, so newly-issued seqs
        // are globally unique and never collide with the at_closed PK (root cause of the orphan).
        try {
            const _mc = db.db.prepare('SELECT MAX(seq) m FROM at_closed').get();
            const _mp = db.db.prepare('SELECT MAX(seq) m FROM at_positions').get();
            let _gmax = Math.max(Number(_mc && _mc.m) || 0, Number(_mp && _mp.m) || 0);
            for (const p of _positions) { if (p && Number.isFinite(p.seq) && p.seq > _gmax) _gmax = p.seq; }
            seqAllocator.init(_gmax);
            logger.info('AT_DB', `[GLOBAL-SEQ] allocator initialized at ${seqAllocator.current()} (global max across at_closed/at_positions/open)`);
        } catch (e) { try { logger.warn('AT_DB', `[GLOBAL-SEQ] init failed: ${e.message}`); } catch (_) { } }

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

    // [batch3-W] Per-position `mode` field is authoritative — demo positions
    // run under demo logic, live positions under live logic, regardless of
    // engine-mode flips. Switching engine mode is a UI-routing concern, not a
    // retagging operation, so no cross-mode position gate is needed. Existing
    // positions in the OPPOSITE mode continue independently in backend tracking.
    //
    // [BUG-T3 FIX 2026-05-14] Client-side surfaces this hide explicitly via:
    //   - Enriched confirm dialog at switch (`_buildModeSwitchMessage` injects
    //     opposite-count into the message body)
    //   - Persistent banner in ManualTradePanel when opposite-mode count > 0
    // Prior to BUG-T3 fix this comment claimed the confirm dialog warned the
    // user — it did NOT (message was static, no count). Fix lands on client.

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

    // [Wave 7b] Mode flip → audit chain (tamper-evident)
    try {
        const chain = require('./ml/_audit/chainedTrail');
        chain.append({
            kind: 'MODE_CHANGE',
            payload: { userId, oldMode: oldMode || null, newMode: mode, ts: Date.now() },
        });
    } catch (_) { /* never block mode change */ }

    // [ZT-AUD-#14 / C12] On live→demo switch, refresh demoStartBalance to the
    // current demoBalance so kill-switch drawdown calculations restart from
    // the current state instead of the original $10k. If demoBalance is below
    // 25% of DEFAULT, also auto-replenish to DEFAULT so the user isn't left
    // with a near-zero balance after a long live session. Either way, prevents
    // a stale 95% drawdown from persisting across mode flips.
    if (mode === 'demo' && oldMode === 'live') {
        const minHealthy = DEFAULT_DEMO_BALANCE * 0.25;
        if (!Number.isFinite(us.demoBalance) || us.demoBalance < minHealthy) {
            const prev = us.demoBalance;
            us.demoBalance = DEFAULT_DEMO_BALANCE;
            us.demoStartBalance = DEFAULT_DEMO_BALANCE;
            logger.info('AT_ENGINE', `Demo balance auto-replenished uid=${userId} on live→demo: $${(prev || 0).toFixed(2)} → $${DEFAULT_DEMO_BALANCE}`);
            audit.record('DEMO_BALANCE_AUTO_REPLENISH', { userId, prev, reset: DEFAULT_DEMO_BALANCE }, 'SERVER_AT');
        } else {
            us.demoStartBalance = us.demoBalance;
            logger.info('AT_ENGINE', `Demo startBalance refreshed uid=${userId} on live→demo: startBalance=$${us.demoStartBalance.toFixed(2)}`);
        }
        us.dailyPnL = 0;
        us.killActive = false;
    }

    // [BUG-T7 FOLLOWUP 2026-05-13] Sync legacy `atActive` cu new engineMode
    // flag. Without this, UI (useServerSync.ts:62 reads data.atActive) shows
    // STALE value din ultimul toggle când user switches between modes:
    //   demo toggle ON → atActiveDemo=true, atActive=true (sync demo)
    //   switch to live → engineMode=live BUT atActive stays true (stale)
    //   UI display: shows ON pe live deși atActiveLive=false (real state)
    // Fix: resync atActive cu mode-specific flag pe fiecare setMode call.
    us.atActive = !!us[us.engineMode === 'live' ? 'atActiveLive' : 'atActiveDemo'];

    _persistState(userId);

    // [LIVE-PARITY] Auto-init liveBalanceRef on live mode switch (non-blocking)
    // [Fix #10] Use exchangeOps.getBalance (exchange-aware) instead of Binance-only sendSignedRequest
    if (mode === 'live' && us.liveBalanceRef <= 0) {
        exchangeOps.getBalance(userId).then(bal => {
            const total = parseFloat(bal.walletBalance || 0);
            if (total > 0) {
                us.liveBalanceRef = total;
                _persistState(userId);
                logger.info('AT_ENGINE', `Kill switch auto-init uid=${userId}: liveBalanceRef=$${total.toFixed(2)}`);
            }
        }).catch(err => {
            logger.warn('AT_ENGINE', `Kill switch auto-init failed uid=${userId}: ${err.message} — liveBalanceRef stays at $${us.liveBalanceRef}`);
        });
    }

    logger.info('AT_ENGINE', `Mode changed uid=${userId}: ${oldMode} → ${mode}`);
    // [C4] Record mode change in audit trail for compliance
    audit.record('AT_MODE_CHANGE', { userId, oldMode, newMode: mode }, 'user');
    telegram.sendToUser(userId,
        `🔄 *AT Mode Changed*\n${oldMode.toUpperCase()} → ${mode.toUpperCase()}`
    );
    _notifyChange(userId);
    // [BUG-T7 FOLLOWUP-2 2026-05-13] Return enriched response cu per-mode flags +
    // computed atActive pentru new engineMode. Client (_executeGlobalModeSwitch) va
    // patcha atStore.enabled imediat din response, eliminând race window între
    // optimistic mode patch (immediate) și WS frame arrival (~50-200ms).
    return {
        ok: true,
        mode: us.engineMode,
        oldMode,
        atActive: !!us.atActive, // synced cu new engineMode în resync de mai sus
        atActiveDemo: us.atActiveDemo,
        atActiveLive: us.atActiveLive,
    };
}

function getMode(userId) { return _uState(userId).engineMode; }
// [BUG-T7 2026-05-13] Per-mode AT-active check helper. mode='live'|'demo'.
// Defensive: returns false on missing us or invalid mode (default demo).
function _isATActiveForMode(us, mode) {
    if (!us) return false;
    return mode === 'live' ? !!us.atActiveLive : !!us.atActiveDemo;
}

// [BUG-T7 2026-05-13] isATActive accept optional mode param. Without mode,
// defaults la current us.engineMode pentru backward-compat callers (e.g.
// serverBrain.js:545 main loop). Pass explicit mode pentru cross-mode checks.
function isATActive(userId, mode) {
    const us = _uState(userId);
    if (mode === 'live' || mode === 'demo') {
        return _isATActiveForMode(us, mode);
    }
    return _isATActiveForMode(us, us.engineMode || 'demo');
}

/**
 * Pre-live checklist — validates readiness before switching to live mode.
 * Returns { ok: true, checks: [...] } or { ok: false, checks: [...], failedChecks: [...] }
 */
async function preLiveChecklist(userId) {
    const checks = [];
    let allOk = true;

    // [Phase 2B] Canonical execution env gates non-demo. Stable `code` field
    // surfaces the reason without changing existing name/ok/detail contract.
    const execEnv = _resolveExecutionEnv(userId);

    // 1. Exchange credentials exist
    const creds = getExchangeCreds(userId);
    if (!creds) {
        checks.push({ name: 'API_KEYS', ok: false, detail: 'No exchange credentials configured', code: execEnv.blockedReason });
        allOk = false;
    } else {
        checks.push({ name: 'API_KEYS', ok: true, detail: 'Credentials found' });

        // 2. Connectivity + balance on the ACTIVE exchange (multi-exchange aware).
        //    [BUG multi-exchange] This block was hardcoded to the Binance signer
        //    (sendSignedRequest GET /fapi/v2/balance) but fed the ACTIVE exchange's
        //    creds. Once the active exchange was Bybit it sent a Binance-format
        //    request to the Bybit host (api-demo.bybit.com) → HTTP 200 non-JSON →
        //    CONNECTIVITY/BALANCE falsely failed → "Cannot switch to LIVE" blocked
        //    every live switch while Bybit was active. Route through
        //    exchangeOps.getBalance (mirrors Fix #10 @ setMode + Task 40.1 @ margin
        //    pre-check) so each exchange uses its own ops + normalized balance shape.
        const _exLabel = (creds.exchange || 'exchange').charAt(0).toUpperCase() + (creds.exchange || 'exchange').slice(1);
        try {
            const bal = await exchangeOps.getBalance(userId);
            const available = bal ? parseFloat(bal.availableBalance || 0) : 0;
            checks.push({ name: 'CONNECTIVITY', ok: true, detail: `${_exLabel} API reachable` });
            if (available > 0) {
                checks.push({ name: 'BALANCE', ok: true, detail: `$${available.toFixed(2)} USDT available` });
            } else {
                checks.push({ name: 'BALANCE', ok: false, detail: `Zero USDT balance on ${_exLabel}` });
                allOk = false;
            }
        } catch (err) {
            checks.push({ name: 'CONNECTIVITY', ok: false, detail: `${_exLabel} API unreachable: ` + err.message });
            checks.push({ name: 'BALANCE', ok: false, detail: 'Cannot verify (API unreachable)' });
            allOk = false;
        }
    }

    // [Hotfix mode-switch] Removed legacy NO_LIVE_POSITIONS gate. Per the
    // batch3-W per-position routing design (see setMode comments), engine-mode
    // flips are a UI-routing concern, not a retag operation: existing live
    // positions continue under live logic regardless of engine mode. Blocking
    // re-entry to live when live positions exist is logically inverted — it
    // locks the user out of managing their own open positions when they
    // temporarily flip to demo and back. Env-compatibility gating, when
    // needed, belongs at the credential-active layer, not here.

    // 4. Kill switch not active
    const us = _uState(userId);
    checks.push({ name: 'KILL_SWITCH', ok: !us.killActive, detail: us.killActive ? 'Kill switch is active — reset first' : 'Kill switch OK' });
    if (us.killActive) allOk = false;

    const failedChecks = checks.filter(c => !c.ok).map(c => c.name);
    logger.info('AT_ENGINE', `Pre-live checklist uid=${userId}: ${allOk ? 'PASSED' : 'FAILED'} [${failedChecks.join(', ') || 'all ok'}]`);

    return { ok: allOk, checks, failedChecks };
}

// [BUG-T7 2026-05-13] Per-user AT on/off toggle — PER-MODE split.
// Optional mode param ('demo'|'live') — if omitted, defaults la current
// us.engineMode. Operator-flagged grav 2026-05-10: toggle anterior era
// GLOBAL per-user (atActive single field) — turning off în demo blocked
// live too (silent mental model break + safety risc combinat cu BUG-T3).
// Fix: atActive split → atActiveDemo + atActiveLive independente.
// Legacy atActive kept synced cu current engineMode flag pentru backward
// compat telemetry (getFullState response, WebSocket frames).
function toggleActive(userId, active, mode) {
    if (typeof active !== 'boolean') return { ok: false, error: 'active must be boolean' };
    if (!userId) return { ok: false, error: 'Missing userId' };
    const us = _uState(userId);
    const targetMode = (mode === 'live' || mode === 'demo') ? mode : (us.engineMode || 'demo');
    const fieldName = targetMode === 'live' ? 'atActiveLive' : 'atActiveDemo';
    const was = !!us[fieldName];
    us[fieldName] = active;
    // Sync legacy atActive cu current engineMode flag (NOT cu targetMode —
    // operator may toggle off-mode while viewing the other mode; legacy must
    // reflect what's true for *current* engineMode pentru UI consistency).
    us.atActive = !!us[us.engineMode === 'live' ? 'atActiveLive' : 'atActiveDemo'];
    _persistState(userId);
    logger.info('AT_ENGINE', `AT toggled uid=${userId} mode=${targetMode}: ${was} → ${active}`);
    audit.record('AT_TOGGLE', { userId, mode: targetMode, was, now: active }, 'user');
    telegram.sendToUser(userId, active
        ? `🟢 *AT Activated (${targetMode.toUpperCase()})* — brain entries enabled`
        : `🔴 *AT Deactivated (${targetMode.toUpperCase()})* — brain entries blocked`);
    _notifyChange(userId);
    return {
        ok: true,
        atActive: us.atActive,
        atActiveDemo: us.atActiveDemo,
        atActiveLive: us.atActiveLive,
        mode: targetMode,
        was,
    };
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
// ══════════════════════════════════════════════════════════════════
// [G1/G2 2026-06-06] LIVE entry affordability gate + failure cooldown
// ══════════════════════════════════════════════════════════════════
// DEMO has a balance gate at DECISION time (below, ~demo balance gate) — LIVE
// had none: the entry record was created, Telegram ENTRY fired, and only then
// the margin pre-check failed → zombie cleanup journaled ENTRY_FAILED_* rows
// (25× INSUFFICIENT_MARGIN + 7× LEVERAGE_FAILED on 06-06) and the brain
// retried every cycle (API pressure → contributed to the 14:46 IP ban).
//
// G1: cheap sync gate at decision time on us.liveAvailableRef (cached from
//     recon's balance refresh + the margin pre-check). Unknown ref (0/null)
//     passes — the authoritative BLOCKING margin check in _executeLiveEntry
//     still runs (defense in depth), and its result feeds the cache+cooldown
//     so the SECOND attempt is gated. No record, no journal row, no Telegram.
// G2: after a real failure, suppress repeat attempts:
//     INSUFFICIENT_MARGIN → account-wide 5 min (margin frees on closes; recon
//       refreshes the ref every 60s anyway), LEVERAGE_FAILED /
//       MARGIN_TYPE_FAILED → per-symbol 10 min (persistent symbol condition,
//       e.g. resting orders blocking margin-type change),
//       MARGIN_CHECK_FAILED → account-wide 2 min (balance API flaky).
function _liveEntryAffordable(availableRef, finalSize) {
    if (availableRef == null || !(availableRef > 0)) return true; // no data → defer to async check
    return availableRef >= finalSize;
}
const _ENTRY_COOLDOWN_MS = {
    INSUFFICIENT_MARGIN: 5 * 60 * 1000,
    MARGIN_CHECK_FAILED: 2 * 60 * 1000,
    LEVERAGE_FAILED: 10 * 60 * 1000,
    MARGIN_TYPE_FAILED: 10 * 60 * 1000,
};
const _ACCOUNT_WIDE_FAILS = new Set(['INSUFFICIENT_MARGIN', 'MARGIN_CHECK_FAILED']);
const _entryFailCooldown = {
    _map: new Map(), // key 'uid' (account-wide) or 'uid|symbol' → { until, kind }
    record(userId, symbol, kind, now) {
        const ms = _ENTRY_COOLDOWN_MS[kind];
        if (!ms) return;
        const t = now != null ? now : Date.now();
        const key = _ACCOUNT_WIDE_FAILS.has(kind) ? String(userId) : userId + '|' + symbol;
        this._map.set(key, { until: t + ms, kind });
    },
    check(userId, symbol, now) {
        const t = now != null ? now : Date.now();
        for (const key of [String(userId), userId + '|' + symbol]) {
            const e = this._map.get(key);
            if (!e) continue;
            if (t <= e.until) return e.kind;
            this._map.delete(key); // expired — clean as we go
        }
        return null;
    },
    _clear() { this._map.clear(); },
};

// [PHANTOM-SHORT FIX 2026-06-08] Pure directional-conflict predicate, shared by
// the brain-entry guard (processBrainDecision) AND the userDataStream fast-path
// external-adoption gate. Returns the first position belonging to `userId` whose
// side is OPPOSITE `side` within the SAME mode (demo & live are independent
// sandboxes per Wave 8). Mode defaults to 'demo' on BOTH sides for legacy rows.
// ANY symbol counts (no mixed LONG+SHORT book within a mode — operator-mandated
// 2026-05-19). Keeping this pure makes both guards unit-testable in isolation.
function _findSameModeOpposite(positions, { userId, side, mode } = {}) {
    if (!Array.isArray(positions)) return null;
    const oppositeSide = side === 'LONG' ? 'SHORT' : 'LONG';
    const m = mode || 'demo';
    return positions.find(p =>
        p && p.userId === userId && p.side === oppositeSide && (p.mode || 'demo') === m
    ) || null;
}

// [DUAL-WRITE DUP FIX 2026-06-15] Pure same-side open-duplicate predicate. On a
// ONE-WAY account there can be only ONE position per (symbol, side). If recon /
// userDataStream proposes adopting an "external" position for a (user, symbol,
// side) that serverAT already holds OPEN in the same (non-demo) book, that is the
// SAME physical position — adopting it again creates a duplicate row that (a)
// shows in the Manual panel (source=external, autoTrade undefined) and (b)
// double-counts PnL when both rows close against the one exchange close.
// Demo & live are independent books, so a demo row never blocks a live adoption.
// Pure → unit-testable in isolation. Returns the existing dup or null.
function _findSameSideOpenDup(positions, { userId, symbol, side, mode } = {}) {
    if (!Array.isArray(positions)) return null;
    const m = mode || 'live';
    return positions.find(p =>
        p && p.userId === userId && p.symbol === symbol && p.side === side &&
        p.status === 'OPEN' && (p.mode || 'demo') !== 'demo' && (p.mode || 'live') === m
    ) || null;
}

// [PHANTOM-SHORT FIX 2026-06-08 — part b] A position must be reconciled against
// the exchange iff it is a REAL (non-demo) position WITH a live exchange leg.
// Pre-fix the recon filter required mode==='live', which EXCLUDED real rows
// mistagged mode='testnet' (binanceOps dual-write "Option B" stamps creds.mode)
// — those drifted forever (never deduped, never phantom-closed). Demo (paper)
// must NEVER hit the exchange-truth path. Pure → unit-tested.
const _RECONCILABLE_LEG_STATUSES = new Set(['LIVE', 'LIVE_NO_SL', 'EXTERNAL']);
function _isReconcilablePosition(p) {
    return !!(p && p.mode !== 'demo' && p.live && _RECONCILABLE_LEG_STATUSES.has(p.live.status));
}

// [ORPHAN-ADOPT FIX 2026-06-08] Resolution policy for a CONFIRMED recon orphan
// (a position the exchange holds but the server doesn't track). isZeusCreated =
// the position still has open SAT_ orders (a live Zeus position that lost its
// in-memory tracking) → CLOSE it. Otherwise → ADOPT it (track + protective SL)
// rather than the old alert-only DEAD-END that left it a perpetual orphan,
// re-flagged every cycle until orphan-protection suspended AT in a loop. Default
// ADOPT on missing ctx (fail toward tracked+protected, never a perpetual orphan).
function _classifyOrphanResolution(ctx) {
    return (ctx && ctx.isZeusCreated === true) ? 'CLOSE' : 'ADOPT';
}

function processBrainDecision(decision, stc, userId, userIntent) {
    if (!decision || !decision.fusion || !stc) return null;
    // [MULTI-USER] Hard guard — reject decisions without userId
    if (!userId) { logger.error('AT_ENGINE', 'processBrainDecision called without userId — skipping'); return null; }

    // [Phase 2 S2.B] Global panic halt — hard block before any per-user gate.
    // Must come before _uState() to stay cheap when halted.
    if (isGlobalHaltActive()) {
        logger.warn('AT_ENGINE', `Entry blocked uid=${userId} — GLOBAL_HALT active`);
        _recordMissedTrade(userId, decision, 'GLOBAL_HALT');
        return null;
    }

    const us = _uState(userId);

    // [Phase 2 S6-B2] LIVE-MODE AUTHORIZATION GATE — refuse to dispatch when
    // the user is in any non-demo mode (today: 'live'; future: 'testnet'/'real')
    // unless the FULL SERVER_AT flag is on. SERVER_AT_DEMO alone is a
    // demo-only carve-out (per S6-B1) and is NOT sufficient. Unknown /
    // missing engineMode is treated as live for fail-safety. The demo
    // branch (engineMode === 'demo') passes through to the existing
    // demo paper-fill path below, untouched.
    // [SP2] testnet-aware gate. demo passes through (unchanged). For non-demo:
    // allow when full SERVER_AT, OR when SP2 testnet-exec is on for a cutover user on
    // a testnet exchange. REAL never reaches here (resolved-env gating upstream).
    if (us.engineMode !== 'demo') {
        const _creds = getExchangeCreds(userId);
        const _isTestnet = !!_creds && (_creds.mode === 'testnet');
        const _sp2Allowed = MF.SERVER_AT_TESTNET_EXEC === true && _isTestnet
            && require('./sp2Cutover').isCutoverUser(userId);
        if (MF.SERVER_AT !== true && !_sp2Allowed) {
            logger.warn('AT_ENGINE', `Entry blocked uid=${userId} — SERVER_AT_REQUIRED_FOR_LIVE (mode=${us.engineMode || 'unknown'})`);
            _recordMissedTrade(userId, decision, 'SERVER_AT_REQUIRED_FOR_LIVE');
            return null;
        }
    }

    // [SP2] entry exclusivity + idempotency — ONLY on the SP2 testnet-exec path.
    // Gated on MF.SERVER_AT !== true so legacy full-SERVER_AT behavior is byte-for-byte
    // unchanged. Demo (engineMode === 'demo') is also untouched. With the flag OFF the
    // gate above already returned null for non-demo, so this block is unreachable then.
    if (us.engineMode !== 'demo' && MF.SERVER_AT !== true) {
        const _heartbeat = require('./heartbeatTracker');
        const { resolveOwnership } = require('./ownership');
        const _creds2 = getExchangeCreds(userId);
        // [SP2-b 2026-06-07] Full ownership: server opens even with the client
        // present (operator directive — single engine, client never commands).
        const _fullOwn = serverFullyOwnsEntries(userId);
        const _own = resolveOwnership({
            clientPresent: _heartbeat.isClientPresent(userId, Date.now()),
            atActive: _isATActiveForMode(us, us.engineMode),
            credsValid: !!_creds2,
            cutoverActive: require('./sp2Cutover').isCutoverUser(userId) && (MF.SERVER_AT_TESTNET_EXEC === true || MF._SRV_POS_REAL_ENABLED === true), // [T1-3] env-aware (testnet OR real-enabled)
            underTakeControl: false,
            fullServerOwnership: _fullOwn,
        });
        const _prevOwner = _lastEntryOwner.get(userId) || 'CLIENT';
        if (_own.entryOwner !== _prevOwner) {
            _lastEntryOwner.set(userId, _own.entryOwner);
            try { require('./database').logHandover(userId, _prevOwner, _own.entryOwner, _own.entryOwner === 'SERVER' ? (_fullOwn ? 'full_ownership' : 'client_absent') : 'client_present'); } catch (_) {}
        }
        if (_own.entryOwner !== 'SERVER') {
            _recordMissedTrade(userId, decision, 'ENTRY_OWNED_BY_CLIENT');
            return null;
        }
        const _dedup = require('./entryDedup');
        if (_dedup.shouldBlockOpen(userId, decision.symbol, Date.now(), 8000)) {
            _recordMissedTrade(userId, decision, 'ENTRY_DEDUP');
            return null;
        }
        _dedup.markOpened(userId, decision.symbol, Date.now());
    }

    // [BUG-T7 2026-05-13] Per-mode AT-active gate. Pre-T7 used global atActive
    // which blocked BOTH modes when toggled off în either. Now checks mode-specific
    // flag based pe us.engineMode (decision context).
    if (!_isATActiveForMode(us, us.engineMode)) {
        logger.info('AT_ENGINE', `Entry blocked uid=${userId} mode=${us.engineMode} — AT disabled for this mode`);
        _recordMissedTrade(userId, decision, 'AT_DISABLED');
        return null;
    }

    // [Phase 2 S6-B3] Per-user decisionId dedup. Prevents client+server
    // double-open during the S6-B6+ transition window. Uses existing
    // at_state schema (no DB migration). The dedup key is per-user only;
    // cross-user same dedup id is allowed by construction.
    //
    // Dedup id derivation (no caller-side change required):
    //   - ALWAYS include symbol so two parallel decisions for different
    //     symbols (same user, same brain cycle) do NOT collide
    //   - When decision.cycle is provided (server brain stamps this),
    //     use it as the per-cycle disambiguator; otherwise fall back to
    //     dir:priceTs which is stable per identical intent within ms
    //
    // Two parallel calls describing the SAME intent (same user, same
    // symbol, same cycle/dir/priceTs) collapse to the same id and the
    // second is rejected. Different symbols → different ids → both
    // allowed (probe-s2 T2 "Collision safety" non-regression).
    //
    // Source defaults to 'server' (the only documented dispatcher today is
    // serverBrain._runCycle); a future REST-driven path can override via
    // decision._source. With current production flags, processBrainDecision
    // is unreachable (S6-B1 dispatch gate keeps the main cycle dormant)
    // so this dedup is INERT until S6-B6 flips the demo flags.
    const _dedupSymbol = decision.symbol || '?';
    const _dedupTail = (typeof decision.cycle === 'string' && decision.cycle)
        ? decision.cycle
        : (((decision.fusion && decision.fusion.dir) || '?') + ':' +
           (Number.isFinite(decision.priceTs) ? decision.priceTs : 0));
    const _dedupId = _dedupSymbol + ':' + _dedupTail;
    const _dedupSource = (typeof decision._source === 'string' && decision._source)
        ? decision._source
        : 'server';
    const _dedupResult = _checkAndStoreDecisionId(userId, _dedupId, _dedupSource, Date.now());
    if (_dedupResult.ok === false && _dedupResult.reason === 'DUPLICATE_DECISION_ID') {
        logger.warn('AT_ENGINE', `Entry blocked uid=${userId} — DUPLICATE_DECISION_ID id=${_dedupId} (prev source=${_dedupResult.previous && _dedupResult.previous.source || 'unknown'})`);
        _recordMissedTrade(userId, decision, 'DUPLICATE_DECISION_ID');
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

    // [2026-05-19 same-mode directional bias guard] Operator-mandated: within
    // a single mode, all positions must share direction (no mixed LONG+SHORT
    // book). Extended 2026-05-19 from same-symbol-only to ANY symbol same
    // mode — "lapte acru murat" if brain opens LONG ETH + SHORT BTC pe live.
    // Cross-mode opposite ALLOWED per Wave 8 reversal (demo & live = independent
    // sandboxes). Voice thought emitted in both block + cross-mode-info cases.
    const oppositeSide = side === 'LONG' ? 'SHORT' : 'LONG';
    const decMode = us.engineMode || 'demo';
    const sameModeOpposite = _findSameModeOpposite(_positions, { userId, side, mode: decMode });
    if (sameModeOpposite) {
        const sameSymbol = sameModeOpposite.symbol === decision.symbol;
        const reasonTag = sameSymbol ? 'OPPOSITE_SIDE_SAME_MODE' : 'MIXED_DIRECTION_SAME_MODE';
        const thoughtText = sameSymbol
            ? `skipping ${side} ${decision.symbol} — already ${oppositeSide} same mode (${decMode}).`
            : `skipping ${side} ${decision.symbol} on ${decMode} — book already has ${oppositeSide} ${sameModeOpposite.symbol}. no mixed bias.`;
        logger.warn('AT_ENGINE',
            `Entry blocked uid=${userId} ${decision.symbol} ${side} ${decMode} — ${reasonTag} (existing ${sameModeOpposite.symbol}/${oppositeSide}/seq=${sameModeOpposite.seq})`);
        _recordMissedTrade(userId, decision, reasonTag);
        try {
            const vl = require('./ml/_voice/voiceLogger');
            vl.logUtterance({
                userId, utteranceType: 'THOUGHT', mood: 'FOCUSED',
                text: thoughtText,
                templateId: sameSymbol ? 'opposite_side_skip' : 'mixed_bias_skip',
                contextJson: JSON.stringify({
                    symbol: decision.symbol, attemptedSide: side,
                    existingSymbol: sameModeOpposite.symbol,
                    existingSide: oppositeSide, mode: decMode,
                }),
            });
        } catch (_) {}
        return null;
    }
    // Cross-mode opposite — informational only, allow per Wave 8 sandbox model
    const crossModeOpposite = _positions.find(p =>
        p.userId === userId && p.symbol === decision.symbol && p.side === oppositeSide &&
        (p.mode || 'demo') !== decMode
    );
    if (crossModeOpposite) {
        logger.info('AT_ENGINE',
            `Cross-mode opposite OK uid=${userId} ${decision.symbol} ${side}/${decMode}: ${crossModeOpposite.mode}/${oppositeSide} exists`);
        try {
            const vl = require('./ml/_voice/voiceLogger');
            vl.logUtterance({
                userId, utteranceType: 'THOUGHT', mood: 'CALM',
                text: `${side} ${decision.symbol} on ${decMode} — ${crossModeOpposite.mode} side has ${oppositeSide}. independent sandbox.`,
                templateId: 'cross_mode_opposite_aware',
                contextJson: JSON.stringify({
                    symbol: decision.symbol, side, mode: decMode,
                    crossSide: oppositeSide, crossMode: crossModeOpposite.mode,
                }),
            });
        } catch (_) {}
        // NO return — entry proceeds
    }

    // ── Max positions gate (per-user) ──
    const userPosCount = _positions.filter(p => p.userId === userId).length;
    if (userPosCount >= stc.maxPos) { _recordMissedTrade(userId, decision, 'MAX_POSITIONS'); return null; }

    // ── [T-MAXTRADES] Max trades/day gate (per-user, operator-toggleable) ──
    if (module.exports.shouldBlockMaxTradesDay({
        maxDay: stc.maxDay, dailyEntries: us.dailyEntries,
        maxDayProtectOffDay: us.maxDayProtectOffDay, currentUtcDay: _utcDay(),
    })) {
        _recordMissedTrade(userId, decision, 'MAX_TRADES_DAY');
        return null;
    }

    // [Task K 2026-05-28] Per-user trade rate limit — hard cap on entries/h
    // (default 10/h). Last-line defense against runaway brain bugs that
    // bypass confidence/dedup checks. Defensive: never blocks if module
    // load fails (fail-open since this is a defense layer, not gate).
    try {
        const _trl = require('./tradeRateLimiter');
        if (!_trl.canEnter(userId)) {
            const st = _trl.getState(userId);
            logger.warn('AT_ENGINE', `Entry blocked uid=${userId} sym=${decision.symbol} — RATE_LIMIT (${st.recentEntries.length}/${st.limit} in 1h)`);
            _recordMissedTrade(userId, decision, 'RATE_LIMIT');
            try {
                audit.record('AT_ENTRY_RATE_LIMITED', {
                    userId, symbol: decision.symbol, side: decision.side,
                    count: st.recentEntries.length, limit: st.limit,
                }, 'SERVER_AT');
            } catch (_) {}
            return null;
        }
    } catch (_) { /* fail-open on module load failure */ }

    // ── Compute order ──
    const baseSize = stc.size;
    const lev = stc.lev;
    const slPct = stc.slPct;
    const rr = stc.rr;

    // [BUG-O7 S2] TC.size is max margin cap per trade (per autotrade.ts:921,928,933 canonical semantic).
    // Adaptive sizing (vol + Kelly + DD + tier) may reduce; final size must NEVER exceed userIntent.
    // Below MIN_TRADE_USD blocks entry (does NOT force above cap).
    const MIN_TRADE_USD = 10;
    const rawSize = Math.round(baseSize * mult);
    const cap = Number(userIntent);
    const safeCap = (Number.isFinite(cap) && cap > 0) ? Math.round(cap) : Math.round(baseSize);
    const cappedSize = Math.min(safeCap, rawSize);
    if (!Number.isFinite(cappedSize) || cappedSize < MIN_TRADE_USD) {
        logger.warn('AT_ENGINE', `Entry blocked uid=${userId} ${decision.symbol} — size below floor raw=${rawSize} cap=${safeCap}`);
        _recordMissedTrade(userId, decision, 'SIZE_TOO_SMALL');
        return null;
    }
    const finalSize = Math.round(cappedSize);

    // ── Demo balance gate (per-user) ──
    if (us.engineMode === 'demo' && us.demoBalance < finalSize) {
        logger.warn('AT_ENGINE', `Entry blocked uid=${userId} — insufficient demo balance ($${us.demoBalance.toFixed(2)} < $${finalSize})`);
        _recordMissedTrade(userId, decision, 'INSUFFICIENT_BALANCE');
        return null;
    }

    // ── [G1/G2 2026-06-06] LIVE affordability gate + failure cooldown (mirror
    // of the demo gate above) — blocks BEFORE the entry record exists, so no
    // ENTRY_FAILED_* journal rows, no false ENTRY Telegram, no API roundtrip.
    if (us.engineMode === 'live') {
        const _cdKind = _entryFailCooldown.check(userId, decision.symbol);
        if (_cdKind) {
            logger.warn('AT_ENGINE', `Entry blocked uid=${userId} ${decision.symbol} — ENTRY_FAILURE_COOLDOWN (${_cdKind})`);
            _recordMissedTrade(userId, decision, 'ENTRY_FAILURE_COOLDOWN_' + _cdKind);
            return null;
        }
        if (!_liveEntryAffordable(us.liveAvailableRef, finalSize)) {
            logger.warn('AT_ENGINE', `Entry blocked uid=${userId} ${decision.symbol} — insufficient live balance (avail ~$${(+us.liveAvailableRef).toFixed(2)} < $${finalSize})`);
            _recordMissedTrade(userId, decision, 'INSUFFICIENT_BALANCE');
            return null;
        }
    }

    // [SP2-1 gate 2] Shared pure order geometry — identical transform on client & server.
    // slDist/tpDist destructured because they are reused below for _grossTpPnl/_grossSlPnl.
    const { qty, sl, tp, slDist, tpDist } = computeOrderGeometry({ side, price, margin: finalSize, lev, slPct, rr });
    // [BUG-TM-8] Align qty + size to LOT_SIZE BEFORE entry creation — never store unsafe toFixed(6).
    const _tm8 = _alignQtyToLotSize(decision.symbol, qty, price, lev, 'MAIN_ENTRY');
    if (!_tm8) {
        logger.warn('AT_ENGINE', `Entry blocked uid=${userId} ${decision.symbol} — LOT_SIZE align rejected (qty=${qty}, price=${price}, lev=${lev})`);
        _recordMissedTrade(userId, decision, 'LOT_SIZE_ALIGN_REJECTED');
        return null;
    }
    const _alignedQty = _tm8.qty;
    const _alignedSize = _tm8.size;
    // [TM-7] Align tp/sl la PRICE_FILTER tick size of the symbol (was raw
    // toFixed(2) which silently floors precision below tick or above tick.
    // BTC tick=0.10 USD; toFixed(2) "1.23" isn't valid tick. SOL/ETH have
    // smaller tick. roundOrderParams handles tick alignment via
    // PRICE_FILTER cached at boot — falls back gracefully if symbol filters
    // unavailable (returns input). Cu fallback, defense `+sl.toFixed(2)`
    // remains semantically equivalent at boundary.
    const _slRounded = roundOrderParams(decision.symbol, _alignedQty, sl);
    const _tpRounded = roundOrderParams(decision.symbol, _alignedQty, tp);
    const _slAligned = (_slRounded && Number.isFinite(_slRounded.stopPrice) && _slRounded.stopPrice > 0)
        ? _slRounded.stopPrice
        : +sl.toFixed(2);
    const _tpAligned = (_tpRounded && Number.isFinite(_tpRounded.stopPrice) && _tpRounded.stopPrice > 0)
        ? _tpRounded.stopPrice
        : +tp.toFixed(2);
    // [TM-9] Apply expected round-trip cost (fees 0.08% + slippage estimate
    // 0.06%) la display tpPnl/slPnl. Pre-fix: user saw expected $1000 dar
    // real fill ~$997 (eroded încredere). Post-fix: displayed values match
    // post-cost reality. _applyRoundTripFee already covers 0.08% fees;
    // slippage adds ~0.03% × 2 sides = 0.06% on notional. Combined cost
    // = ~0.14% on (size × lev) = notional. tpPnl reduces, slPnl becomes
    // larger negative (loss + slippage cost stack).
    const _expectedSlippageCost = (_alignedSize * lev) * 0.0006;
    const _grossTpPnl = (tpDist / price) * _alignedSize * lev;
    const _grossSlPnl = -(slDist / price) * _alignedSize * lev;
    const tpPnl = _applyRoundTripFee(_grossTpPnl, _alignedSize, lev) - _expectedSlippageCost;
    const slPnl = _applyRoundTripFee(_grossSlPnl, _alignedSize, lev) - _expectedSlippageCost;

    // ── Build position entry ──
    // [Phase 12.A — Batch G] Stamp exchange + env at open so history snapshots
    // reflect truth-at-entry (immutable through close, survives creds changes).
    // Demo: exchange=null, env='DEMO'. Live: exchange from creds, env=TESTNET|REAL.
    const _entryExecEnv = _resolveExecutionEnv(userId);
    const _entryCreds = _entryExecEnv.env === 'DEMO' ? null : getExchangeCreds(userId);
    const entry = {
        seq: (us.seq = seqAllocator.next()),
        userId: userId,
        ts: Date.now(),
        // [Phase 2 S2.A] Stable decision id — feeds newClientOrderId on exchange
        // so retries/restarts yield the same order identity (Binance dedups).
        decisionId: _newDecisionId(),
        cycle: decision.cycle,
        symbol: decision.symbol,
        side: side,
        tier: tier,
        mode: us.engineMode,        // 'demo' or 'live' — set at entry time
        exchange: _entryCreds ? (_entryCreds.exchange || null) : null,
        env: _entryExecEnv.env,     // 'DEMO' | 'TESTNET' | 'REAL' | null
        price: price,
        size: _alignedSize,        // [BUG-TM-8] margin = qty * price / lev (matches actual exchange exposure)
        margin: _alignedSize,      // margin locked, LOT_SIZE-aligned
        lev: lev,
        qty: _alignedQty,          // [BUG-TM-8] LOT_SIZE-aligned (no toFixed(6))
        sl: _slAligned,           // [TM-7] tick-aligned via roundOrderParams
        tp: _tpAligned,           // [TM-7] tick-aligned via roundOrderParams
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
        dslModeAtOpen: us.dslEnabled === false ? null : (stc.dslMode || null),
        // ── Add-on tracking (Faza 2 Batch A) ──
        originalEntry: price,
        originalSL: _slAligned,        // [SP2 fix #1] disaster backstop reference (immutable entry SL)
        originalSize: _alignedSize,    // [BUG-TM-8] LOT_SIZE-adjusted
        originalQty: _alignedQty,      // [BUG-TM-8] LOT_SIZE-aligned
        addOnCount: 0,
        addOnHistory: [],
        controlMode: 'auto', // [TL-03] Initialize controlMode so user-override check works
        autoTrade: true,     // [AT-PANEL] Mark as AT position for client panel filtering
        sourceMode: 'auto',  // [AT-PANEL] Source mode for display labeling
        // [SERVER-ARES 2026-06-07] Engine attribution — 'ARES' positions route
        // their close PnL to the ARES virtual wallet via the _persistClose hook.
        owner: decision.owner === 'ARES' ? 'ARES' : 'AT',
        _livePending: false, // [TL-04] True while _executeLiveEntry is in-flight
    };

    // [REFLECTION] Save entry snapshot from brain for post-trade analysis
    if (decision._entrySnapshot) {
        entry.entrySnapshot = decision._entrySnapshot;
    }

    // ── Demo: deduct margin ──
    if (us.engineMode === 'demo') {
        us.demoBalance = +(us.demoBalance - _alignedSize).toFixed(2); // [BUG-TM-8] match LOT_SIZE-adjusted exposure
    }

    // ── Add to THE positions array ──
    _positions.push(entry);
    _trackLiveOpen(entry); // [P5b] hold feed for this exchange while position is open
    us.dailyEntries = (us.dailyEntries || 0) + 1; // [T-MAXTRADES] count entry toward daily cap
    us.stats.entries++;
    if (entry.mode !== 'live') us.demoStats.entries++;

    // [P5A SERVER LIVE OWNERSHIP] Push tracepoint — captures ownership + live state at insert moment.
    // Used to confirm race hypothesis #1/#2: position is in _positions but not yet in getLivePositions
    // result until _livePending=true (set sync in _executeLiveEntry) or entry.live.status hits LIVE/LIVE_NO_SL.
    if (entry.mode === 'live') {
        logger.info('P5A', `[P5A SERVER LIVE OWNERSHIP] PUSH seq=${entry.seq} uid=${entry.userId} sym=${entry.symbol} side=${entry.side} autoTrade=${entry.autoTrade} sourceMode=${entry.sourceMode} _livePending=${entry._livePending} live=${entry.live ? entry.live.status : 'undefined'} ts=${Date.now()}`);
    }

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

    // [Wave 3] R2 confidence decay — track thesis from entry.
    try {
        const _cd = require('./ml/R2_cognition/confidenceDecay');
        _cd.initializeThesis({
            userId, resolvedEnv: (us.engineMode || 'demo').toUpperCase(),
            posId: String(entry.seq), symbol: entry.symbol,
            entryConfidence: (fusion && fusion.confidence || 70) / 100,
        });
    } catch (_) {}

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
    // [Task K 2026-05-28] Record entry in rate limiter — counts toward 10/h cap.
    try { require('./tradeRateLimiter').recordEntry(userId); } catch (_) {}
    return entry;
}

// ══════════════════════════════════════════════════════════════════
// Algo Order Helper — Binance Dec 2025 migration
// STOP_MARKET / TAKE_PROFIT_MARKET moved from /fapi/v1/order to /fapi/v1/algoOrder
// Maps: stopPrice→triggerPrice, newClientOrderId→clientAlgoId
// Response: algoId mapped to orderId for backward compat
// ══════════════════════════════════════════════════════════════════
async function _placeConditionalOrder(params, creds) {
    // [Phase M] Exchange-aware conditional SL/TP. This is the shared chokepoint for
    // ALL protection placement (manual Path-B + AT trailing/protection/addon/health),
    // so routing it once makes every one of those work on Bybit. Bybit has no Binance
    // algo endpoint — route to bybitOps. params.side is the ORDER (closing) side:
    // SELL closes a LONG, BUY closes a SHORT → positionSide is its inverse. Return
    // shape preserves `.orderId` (+ `.status`) that all callers read.
    if (creds && creds.exchange === 'bybit') {
        const bybitOps = require('./bybitOps');
        const positionSide = params.side === 'SELL' ? 'LONG' : 'SHORT';
        const uid = params.userId || 0;
        if (params.type === 'TAKE_PROFIT_MARKET') {
            const r = await bybitOps.placeTakeProfit(uid, {
                symbol: params.symbol, side: positionSide,
                triggerPrice: params.stopPrice, quantity: params.quantity,
                clientOrderId: params.newClientOrderId,
            }, creds);
            if (!r || !r.ok) throw new Error((r && r.error && (r.error.message || r.error)) || 'bybit TP placement failed');
            return { orderId: r.tpOrderId, status: r.status, rawExchange: 'bybit' };
        }
        const r = await bybitOps.placeStopLoss(uid, {
            symbol: params.symbol, side: positionSide,
            stopPrice: params.stopPrice,
            decisionKey: params.newClientOrderId || `cond_${params.symbol}`,
        }, creds);
        if (!r || !r.ok) throw new Error((r && r.error && (r.error.message || r.error)) || 'bybit SL placement failed');
        return { orderId: r.slOrderId, status: r.status, rawExchange: 'bybit' };
    }

    const mapped = {
        algoType: 'CONDITIONAL',
        symbol: params.symbol,
        side: params.side,
        type: params.type,
        // [BUG A 2026-06-05] Anti-wick: protection orders trigger on MARK
        // price, not last price (see binanceOps._placeConditionalAlgo).
        // This chokepoint covers recon SL re-placement + legacy core SL/TP.
        workingType: 'MARK_PRICE',
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
// [SP2-a exec gate 2026-06-04] Pure predicate: may _executeLiveEntry place a
// live order under the current flags for this entry? Full SERVER_AT enables all
// live exec (legacy). Otherwise the SP2 testnet-exec carve-out applies — cutover
// user, TESTNET env AND testnet creds — mirroring the DISPATCH gate (~958) which
// already routes these entries to the server. Fail-closed: missing/odd env or
// creds → false. REAL is impossible here (env+creds gates) and Layer 2
// (_realBlocked) independently blocks REAL again (defense in depth).
function _liveExecAllowed({ serverAt, testnetExec, env, isCutover, credsMode }) {
    if (serverAt === true) return true;
    return testnetExec === true
        && String(env).toUpperCase() === 'TESTNET'
        && isCutover === true
        && credsMode === 'testnet';
}

async function _executeLiveEntry(entry, stc) {
    // [Phase 2 S6-B2 / SP2-a] PARANOID LIVE EXECUTION GATE — fires as the FIRST
    // executable statement, before any state mutation (no _livePending
    // flag set), before any in-flight lock acquisition, before any
    // _persistPosition / _persistClose write, and before any signed
    // exchange request. Must NEVER fire unless either the FULL SERVER_AT flag is
    // on, OR the SP2 testnet-exec carve-out holds (cutover user, TESTNET env +
    // testnet creds) — see _liveExecAllowed. SERVER_AT_DEMO is a demo-only
    // carve-out (per S6-B1) and must not reach a real exchange. This guard is
    // independent of engineMode (defense in depth); REAL can never execute here.
    const _execAllowed = _liveExecAllowed({
        serverAt: MF.SERVER_AT === true,
        testnetExec: MF.SERVER_AT_TESTNET_EXEC === true,
        env: entry && entry.env,
        isCutover: !!(entry && entry.userId != null && require('./sp2Cutover').isCutoverUser(entry.userId)),
        credsMode: (() => { try { const c = getExchangeCreds(entry && entry.userId); return c && c.mode; } catch (_) { return null; } })(),
    });
    if (!_execAllowed) {
        try { logger.error('AT_LIVE', `[${entry && entry.seq}] LIVE_ENTRY_REQUIRES_FULL_SERVER_AT — refusing live entry uid=${entry && entry.userId} sym=${entry && entry.symbol}`); } catch (_) {}
        const err = new Error('LIVE_ENTRY_REQUIRES_FULL_SERVER_AT');
        err.code = 'LIVE_ENTRY_REQUIRES_FULL_SERVER_AT';
        throw err;
    }
    // [S8.1 hard real-block — LAYER 2] Independent defense-in-depth gate. Even if
    // a REAL-stamped entry reaches here (stamped before flag flip, or any bypass
    // of layer 1), refuse it unless _SRV_POS_REAL_ENABLED is strictly true.
    // Fires before _incPending / any state mutation / any signed exchange request.
    if (_realBlocked(entry && entry.env, MF._SRV_POS_REAL_ENABLED)) {
        try { logger.error('AT_LIVE', `[${entry && entry.seq}] REAL_EXECUTION_DISABLED — refusing REAL entry uid=${entry && entry.userId} sym=${entry && entry.symbol} (_SRV_POS_REAL_ENABLED not true)`); } catch (_) {}
        try { audit.record('REAL_EXECUTION_BLOCKED', { userId: entry && entry.userId, seq: entry && entry.seq, symbol: entry && entry.symbol, side: entry && entry.side, env: entry && entry.env }, 'SERVER_AT'); } catch (_) {}
        const err = new Error('REAL_EXECUTION_DISABLED');
        err.code = 'REAL_EXECUTION_DISABLED';
        throw err;
    }
    // [Task G 2026-05-28] Track this call for graceful shutdown drain.
    // Increment AFTER the gate check so refused entries don't count.
    _incPending();
    try {
    entry._livePending = true; // [TL-04] Lock position from onPriceUpdate exits
    // [P5A SERVER LIVE OWNERSHIP] _livePending true transition — this is what getLivePositions() relies on
    // to keep the position visible BEFORE entry.live.status is set at line ~1146.
    logger.info('P5A', `[P5A SERVER LIVE OWNERSHIP] _livePending=true seq=${entry.seq} uid=${entry.userId} sym=${entry.symbol} live=${entry.live ? entry.live.status : 'undefined'} ts=${Date.now()}`);
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

    // [BUG-T7 2026-05-13] RE-ENTRY: per-mode AT-active re-check (user may have
    // disabled AT for current mode between decision and execution).
    if (!_isATActiveForMode(us, us.engineMode)) {
        logger.info('AT_LIVE', `[${entry.seq}] Live entry ABORTED uid=${userId} mode=${us.engineMode} — AT disabled for this mode after decision`);
        const abortIdx = _positions.indexOf(entry);
        if (abortIdx >= 0) {
            entry.closeReason = 'AT_DISABLED_INFLIGHT';
            entry.closePnl = 0;
            entry.closeTs = Date.now();
            if (_persistClose(entry)) { _positions.splice(abortIdx, 1); _persistState(userId); }
        }
        return;
    }

    // [Phase 2 S2.B] Global panic halt — re-check before touching the exchange.
    // Admin may have armed halt between processBrainDecision and the live task
    // picking up from the event loop. No exchange call must go out while halted.
    if (isGlobalHaltActive()) {
        logger.warn('AT_LIVE', `[${entry.seq}] Live entry ABORTED uid=${userId} — GLOBAL_HALT active`);
        entry.live = { status: 'GLOBAL_HALT' };
        _pushLog(userId, 'LIVE_GLOBAL_HALT', { seq: entry.seq });
        const abortIdx = _positions.indexOf(entry);
        if (abortIdx >= 0) {
            entry.closeReason = 'GLOBAL_HALT_INFLIGHT';
            entry.closePnl = 0;
            entry.closeTs = Date.now();
            if (_persistClose(entry)) { _positions.splice(abortIdx, 1); _persistState(userId); }
        }
        us.liveStats.blocked++;
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
    // [Task 40.1] Replaced sendSignedRequest('GET', '/fapi/v2/balance') with
    // exchangeOps.getBalance(userId) — routes to correct exchange (Binance/Bybit).
    try {
        const balResult = await exchangeOps.getBalance(userId);
        const available = balResult ? parseFloat(balResult.availableBalance || 0) : 0;
        us.liveAvailableRef = available; // [G1] freshest data feeds the decision-time gate
        const requiredMargin = entry.size; // position size = required margin (before leverage)
        if (available < requiredMargin) {
            entry.live = { status: 'INSUFFICIENT_MARGIN', available, required: requiredMargin };
            _entryFailCooldown.record(userId, entry.symbol, 'INSUFFICIENT_MARGIN'); // [G2]
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
        _entryFailCooldown.record(userId, entry.symbol, 'MARGIN_CHECK_FAILED'); // [G2]
        _pushLog(userId, 'LIVE_MARGIN_CHECK_FAILED', { seq: entry.seq, error: balErr.message });
        logger.error('AT_LIVE', `[${entry.seq}] Margin pre-check failed — BLOCKING entry: ${balErr.message}`);
        telegram.sendToUser(userId, `⚠️ *Margin Check Failed — Entry Blocked*\n${entry.side} ${entry.symbol}\nCannot verify balance. Entry skipped for safety.\nError: ${balErr.message}`);
        us.liveStats.blocked++;
        return;
    }

    const liveSeq = ++us.liveSeq;
    // [Phase 2 S2.A] Stable newClientOrderId derived from entry.seq + decisionId
    // instead of Date.now(). Retries (in-process or cross-restart) produce the
    // SAME token, so Binance dedups at the exchange (returns the original order
    // on resend rather than creating a duplicate). Format: SAT_<seq>_<8hex>
    // — always ≤ 36 chars (Binance limit). Falls back to Date.now() only if a
    // legacy position somehow lacks decisionId (pre-S2 positions rehydrated
    // after deploy; such positions never retry this path).
    const _decTok = (entry.decisionId && /^[0-9a-f]{8}$/.test(entry.decisionId))
        ? entry.decisionId
        : crypto.randomBytes(4).toString('hex');
    const clientOrderId = `SAT_${entry.seq}_${_decTok}`;

    // [Task 40.2] Replaced manual marginType + leverage retry loops with
    // exchangeOps.ensureSymbolReady — routes to correct exchange (Binance/Bybit),
    // 5min cache per (uid, symbol), idempotent. Replaces marginTypeHelper.ensureCrossed
    // + sendSignedRequest('POST', '/fapi/v1/leverage') both requiring creds.
    // [SAFE-2] Force CROSSED margin type + correct leverage — BLOCKING:
    // wrong margin type = wrong risk math; wrong leverage = wrong risk.
    {
        let readyResult;
        try {
            readyResult = await exchangeOps.ensureSymbolReady(userId, {
                symbol: entry.symbol,
                leverage: entry.lev,
                marginMode: 'CROSSED',
            });
        } catch (readyErr) {
            readyResult = { ok: false, error: { message: readyErr.message, code: readyErr.code || 'ErrEnsureSymbolReady' } };
        }
        if (!readyResult || !readyResult.ok) {
            const readyErrMsg = (readyResult && readyResult.error && readyResult.error.message) || 'ensureSymbolReady failed';
            const readyErrCode = (readyResult && readyResult.error && readyResult.error.code) || 'UNKNOWN';
            // Distinguish margin vs leverage failure by code if available; default to LEVERAGE_FAILED
            if (readyErrCode && String(readyErrCode).includes('MARGIN')) {
                entry.live = { status: 'MARGIN_TYPE_FAILED', error: readyErrMsg, intendedMarginType: 'CROSSED' };
                _entryFailCooldown.record(userId, entry.symbol, 'MARGIN_TYPE_FAILED'); // [G2]
                _pushLog(userId, 'LIVE_MARGIN_TYPE_FAILED', { seq: entry.seq, marginType: 'CROSSED', error: readyErrMsg });
                logger.error('AT_LIVE', `[${entry.seq}] Margin type set failed — BLOCKING entry: ${readyErrMsg}`);
                telegram.sendToUser(userId, `⚠️ *Margin Type Set Failed — Entry Blocked*\n${entry.side} ${entry.symbol}\nIntended: CROSSED\nEntry skipped — deterministic margin required for risk math.\nError: ${readyErrMsg}`);
            } else {
                entry.live = { status: 'LEVERAGE_FAILED', error: readyErrMsg, intendedLev: entry.lev };
                _entryFailCooldown.record(userId, entry.symbol, 'LEVERAGE_FAILED'); // [G2]
                _pushLog(userId, 'LIVE_LEVERAGE_FAILED', { seq: entry.seq, leverage: entry.lev, error: readyErrMsg });
                logger.error('AT_LIVE', `[${entry.seq}] Leverage/symbol-ready set failed — BLOCKING entry: ${readyErrMsg}`);
                telegram.sendToUser(userId, `⚠️ *Leverage Set Failed — Entry Blocked*\n${entry.side} ${entry.symbol}\nIntended: ${entry.lev}x\nEntry skipped — wrong leverage = wrong risk.\nError: ${readyErrMsg}`);
            }
            us.liveStats.blocked++;
            return;
        }
        logger.info('AT_LIVE', `[${entry.seq}] Symbol ready: CROSSED margin + ${entry.lev}x leverage verified/set${readyResult.cached ? ' (cached)' : ''}`);
    }

    // Round params
    const rounded = roundOrderParams(entry.symbol, entry.qty, entry.sl);
    const roundedTp = roundOrderParams(entry.symbol, entry.qty, entry.tp);
    const qty = String(rounded.quantity || entry.qty);

    // [Phase 2 S2.A] Idempotency short-circuit — if this entry was persisted
    // with mainOrderId already set (server died between MAIN success and SL
    // and we rehydrated from DB, or _executeLiveEntry was somehow re-invoked
    // for the same entry), skip the POST. The exchange already has the order
    // under our stable clientOrderId; re-POSTing would either be deduped by
    // Binance or, worst case, risk a duplicate. Persisted state wins.
    if (entry.live && entry.live.mainOrderId) {
        logger.warn('AT_LIVE', `[${entry.seq}] MAIN order already recorded (${entry.live.mainOrderId}) — idempotency skip`);
        audit.record('SAT_ENTRY_DEDUP_SKIP', { userId, seq: entry.seq, symbol: entry.symbol, existingOrderId: entry.live.mainOrderId, clientOrderId }, 'SERVER_AT');
        return;
    }

    // [Task L 2026-05-28] Pre-trade balance sanity check. Catches stale-cache
    // scenarios where free balance dropped (withdrawal, loss) between brain
    // decision and exchange dispatch. Fail-open on fetch errors — exchange
    // will reject if truly insufficient. Skip → audit + Telegram, no order.
    const _balCheck = await _checkBalanceForEntry(userId, entry.sizeUsd);
    if (!_balCheck.ok) {
        logger.warn('AT_LIVE', `[${entry.seq}] Entry skipped uid=${userId} sym=${entry.symbol} — ${_balCheck.reason} free=${_balCheck.free} need=${_balCheck.required}`);
        try {
            audit.record('BALANCE_INSUFFICIENT_SKIP', {
                userId, seq: entry.seq, symbol: entry.symbol,
                sizeUsd: entry.sizeUsd, free: _balCheck.free, required: _balCheck.required,
            }, 'SERVER_AT');
        } catch (_) {}
        try {
            const _telegram = require('./telegram');
            await _telegram.sendToUser(userId,
                '⚠️ *Entry skipped — insufficient balance*\n'
                + '`' + entry.symbol + '` ' + entry.side + ' $' + Number(entry.sizeUsd || 0).toFixed(2) + '\n'
                + 'Free: $' + Number(_balCheck.free || 0).toFixed(2)
                + ' / Need: $' + Number(_balCheck.required || 0).toFixed(2));
        } catch (_) {}
        entry.live = { status: 'BALANCE_INSUFFICIENT' };
        entry._livePending = false;
        return;
    }

    // [Task 40.3] Replace direct sendSignedRequest entry/SL/TP/emergency-close
    // calls with single exchangeOps.placeEntry router call. Routes to Binance
    // or Bybit per per-user config (_getUserExchange). binanceOps.placeEntry
    // handles: MARKET entry → safety SL (15% OTM) → real SL 3x retry →
    // emergency close on SL exhaustion → TP (no retry, soft fail) → positionStateMachine.
    //
    // [OPTION B — dual DB write transitional]: binanceOps.placeEntry inserts
    // PENDING row into at_positions. serverAT _persistPosition continues to write
    // its own at_positions record (legacy format). Two rows per entry during
    // transition; entry.live.opsSeq links them. Full dedup: T40-deferred-db-unification.
    // [TODO: deprecate _persistPosition INSERT post-Bybit Phase 2]
    let placeResult;
    try {
        placeResult = await exchangeOps.placeEntry(userId, {
            symbol: entry.symbol,
            side: entry.side,           // LONG/SHORT — exchangeOps accepts this
            qty: qty,
            entryType: 'MARKET',
            sl: (entry.sl && entry.sl > 0) ? { price: String(rounded.stopPrice != null ? rounded.stopPrice : entry.sl) } : null,
            tp: (!entry.dslParams && entry.tp && entry.tp > 0) ? { price: String(roundedTp.stopPrice != null ? roundedTp.stopPrice : entry.tp) } : null,
            leverage: entry.lev,
            decisionKey: clientOrderId,  // SAT_<seq>_<8hex> — compatible with exchangeOps regex
            source: 'serverAT',
            mode: entry.mode,            // [PHANTOM-SHORT FIX a] ENGINE mode ('live') for the dual-write row — NOT creds.mode ('testnet')
        });
    } catch (placeErr) {
        // Unexpected throw (not ok:false) — treat as ENTRY_FAILED
        placeResult = { ok: false, error: { message: placeErr.message, code: placeErr.code || 'ErrUnknown' } };
    }

    if (!placeResult || !placeResult.ok) {
        const errMsg = (placeResult && placeResult.error && placeResult.error.message) || 'placeEntry failed';
        const errCode = (placeResult && placeResult.error && placeResult.error.code) || 'ErrUnknown';
        const isCatastrophic = !!(placeResult && placeResult.catastrophic);

        if (isCatastrophic) {
            // binanceOps set PANIC halt and persisted to emergency_close_queue
            logger.error('AT_LIVE', `[${entry.seq}] CATASTROPHIC ENTRY FAILURE — halt armed, emergency_close_queue: ${errMsg}`);
            audit.record('SAT_EMERGENCY_CLOSE', {
                userId, seq: entry.seq, symbol: entry.symbol, side: entry.side,
                reason: 'CATASTROPHIC_ENTRY_FAILED', error: errMsg,
            }, 'SERVER_AT');
            telegram.sendToUser(userId, `🚨🚨 *CATASTROPHIC ENTRY FAILURE*\n${entry.side} ${entry.symbol}\nPosition halted + queued for recovery.\nError: ${errMsg}`);
        } else {
            entry.live = { status: 'ENTRY_FAILED', error: errMsg };
            _pushLog(userId, 'LIVE_ENTRY_FAILED', { seq: entry.seq, error: errMsg, code: errCode });
            logger.error('AT_LIVE', `[${entry.seq}] placeEntry failed [${errCode}]: ${errMsg}`);
            const syntheticErr = new Error(errMsg);
            syntheticErr.code = errCode;
            Sentry.captureException(syntheticErr, { tags: { module: 'AT', action: 'live_entry', symbol: entry.symbol, side: entry.side }, user: { id: String(userId) } });
            telegram.alertOrderFailed(entry.symbol, entry.side, errMsg, userId);
            // [Task D 2026-05-28] Autonomous-specific alert with seq + sizeUsd
            // for operator triage. Distinguishes brain-driven failures from
            // manual order failures (telegram.alertOrderFailed above is generic).
            try {
                const _tb = require('./telegramBot');
                _tb.notifyEntryFailed(userId, {
                    symbol: entry.symbol, side: entry.side, sizeUsd: entry.sizeUsd,
                    error: errMsg + ' [' + errCode + ']', seq: entry.seq,
                });
            } catch (_) { /* best-effort */ }
            audit.record('SAT_ENTRY_FAILED', { userId, seq: entry.seq, symbol: entry.symbol, side: entry.side, error: errMsg }, 'SERVER_AT');
        }
        metrics.recordOrder('failed');
        us.liveStats.errors++;
        return;
    }

    // [Task 40.4] Fill verification adapter — translate exchangeOps result to
    // serverAT's expected entry.live.* fields. exchangeOps returns avgFillPrice
    // directly from exchange response (no polling needed — it uses FILLED response).
    // If avgFillPrice missing/zero: FILL_UNVERIFIED path (ZT-AUD-002 preserved).
    const avgPrice = parseFloat(placeResult.avgFillPrice || 0);
    const executedQty = parseFloat(placeResult.filledQty || 0);
    const closeSide = entry.side === 'LONG' ? 'SELL' : 'BUY';
    const mainOrderId = placeResult.orderId;

    if (!Number.isFinite(avgPrice) || avgPrice <= 0 || !Number.isFinite(executedQty) || executedQty <= 0) {
        // [ZT-AUD-002] No verified fill price from exchangeOps result
        logger.error('AT_LIVE', `[${entry.seq}] FILL_UNVERIFIED — avgFillPrice=${placeResult.avgFillPrice} filledQty=${placeResult.filledQty}`);
        Sentry.captureMessage(`Fill unverified: ${entry.symbol} ${entry.side}`, { level: 'error', tags: { module: 'AT', action: 'fill_unverified', symbol: entry.symbol }, user: { id: String(userId) } });

        // [ZT-AUD-C5] Force-close FILL_UNVERIFIED with confirmed exchange position
        const fcDecisionKey = `SAT_FCUNVER_${liveSeq}`.slice(0, 36);
        const fcResult = await exchangeOps.closePosition(userId, {
            seq: placeResult.seq,
            symbol: entry.symbol,
            side: entry.side,
            qty: qty,
            closeType: 'MARKET',
            decisionKey: fcDecisionKey,
            source: 'FILL_UNVERIFIED_FORCE_CLOSE',
        }).catch(() => null);

        if (fcResult && fcResult.ok) {
            entry.live = { status: 'FILL_UNVERIFIED_FORCE_CLOSED', error: 'No confirmed fill data; exchange position force-closed', orderId: mainOrderId, opsSeq: placeResult.seq };
            audit.record('SAT_FILL_UNVERIFIED_FORCE_CLOSED', { userId, seq: entry.seq, symbol: entry.symbol, side: entry.side }, 'SERVER_AT');
            telegram.sendToUser(userId, `🚨 *FILL UNVERIFIED — FORCE CLOSED*\n${entry.symbol} ${entry.side}\nFill data missing; closed exchange position to prevent unprotected exposure.`);
        } else {
            entry.live = { status: 'FILL_UNVERIFIED', error: 'No confirmed fill data; force-close also failed or not attempted', orderId: mainOrderId, opsSeq: placeResult.seq };
            audit.record('SAT_FILL_UNVERIFIED_FORCE_CLOSE_FAILED', { userId, seq: entry.seq, symbol: entry.symbol, side: entry.side, error: 'closePosition returned !ok' }, 'SERVER_AT');
            telegram.sendToUser(userId, `🚨🚨 *FILL UNVERIFIED — FORCE CLOSE FAILED*\n${entry.symbol} ${entry.side}\n*MANUAL INTERVENTION REQUIRED*`);
        }
        us.liveStats.errors++;
        return;
    }

    // [FIX2] Re-round using ACTUAL executedQty for downstream references
    const fillQty = String(roundOrderParams(entry.symbol, executedQty).quantity || executedQty);

    // Slippage tracking — compare fill price vs expected price
    const entrySlippage = avgPrice - entry.price;
    const entrySlippagePct = entry.price > 0 ? +((entrySlippage / entry.price) * 100).toFixed(4) : 0;

    logger.info('AT_LIVE', `[${entry.seq}] ENTRY FILLED ${entry.side} ${entry.symbol} qty=${executedQty} @ $${avgPrice} (expected $${entry.price.toFixed(2)}, slippage ${entrySlippagePct >= 0 ? '+' : ''}${entrySlippagePct}%)`);
    audit.record('SAT_ENTRY_FILLED', {
        userId, seq: entry.seq, symbol: entry.symbol, side: entry.side,
        qty: executedQty, avgPrice, orderId: mainOrderId, tier: entry.tier,
        slippage: entrySlippagePct,
    }, 'SERVER_AT');
    metrics.recordOrder('filled');
    telegram.alertOrderFilled(entry.symbol, entry.side, executedQty, avgPrice, mainOrderId, userId);

    // Log SL/TP retry warnings if applicable (for transparency; SL/TP handled inside binanceOps)
    if (placeResult.slOrderId) {
        logger.info('AT_LIVE', `[${entry.seq}] SL order placed: ${placeResult.slOrderId}`);
    }
    if (placeResult.tpOrderId) {
        logger.info('AT_LIVE', `[${entry.seq}] TP order placed: ${placeResult.tpOrderId}`);
    }

    // [Task 40.3 result adapter] Map exchangeOps result → entry.live.*
    // entry.live.opsSeq: links to binanceOps-created at_positions row (dual-write bridge)
    const slPlaced = !!placeResult.slOrderId;
    entry.live = {
        status: slPlaced ? 'LIVE' : 'LIVE_NO_SL', liveSeq, clientOrderId,
        // [Phase 2 S2.A] Carry decisionId forward — visible in persisted live state
        decisionId: entry.decisionId || null,
        mainOrderId,
        avgPrice, executedQty, fillPrice: avgPrice,
        entrySlippage, entrySlippagePct, expectedPrice: entry.price,
        slOrderId: placeResult.slOrderId || null,
        tpOrderId: placeResult.tpOrderId || null,
        slPlaced, tpPlaced: !!placeResult.tpOrderId,
        // [Task 40 dual-write bridge] opsSeq links to binanceOps at_positions row
        opsSeq: placeResult.seq || null,
    };
    // [P5A SERVER LIVE OWNERSHIP] live.status set — confirms fill path and ownership stays AT.
    logger.info('P5A', `[P5A SERVER LIVE OWNERSHIP] live.status=${entry.live.status} seq=${entry.seq} uid=${entry.userId} sym=${entry.symbol} autoTrade=${entry.autoTrade} sourceMode=${entry.sourceMode} ts=${Date.now()}`);

    // CRITICAL: If SL failed (LIVE_NO_SL) — alert immediately
    if (!slPlaced) {
        logger.error('AT_LIVE', `[${entry.seq}] CRITICAL: Position LIVE without SL — binanceOps SL placement exhausted`);
        telegram.sendToUser(userId, `🚨 *CRITICAL: NO SL PROTECTION*\n${entry.side} ${entry.symbol} @ $${avgPrice.toFixed(2)}\nSL retries exhausted inside exchange router.\nPosition is UNPROTECTED. Place manual SL immediately!`);
    }

    _pushLog(userId, 'LIVE_ENTRY', {
        seq: entry.seq, liveSeq, symbol: entry.symbol, side: entry.side,
        avgPrice, executedQty, mainOrderId, opsSeq: placeResult.seq,
    });

    us.liveStats.entries++;
    _persistPosition(entry); // [OPTION B: legacy at_positions write preserved — see T40-deferred-db-unification]
    _persistState(userId);
    } finally {
        entry._livePending = false; // [TL-04] Unlock — all paths covered
        // [P5A SERVER LIVE OWNERSHIP] _livePending false transition — final state after exchange roundtrip.
        logger.info('P5A', `[P5A SERVER LIVE OWNERSHIP] _livePending=false seq=${entry.seq} uid=${entry.userId} sym=${entry.symbol} live=${entry.live ? entry.live.status : 'undefined'} autoTrade=${entry.autoTrade} sourceMode=${entry.sourceMode} ts=${Date.now()}`);
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
    } finally {
        // [Task G 2026-05-28] Decrement drain counter regardless of exit path
        // (success, throw, early return). Pairs with _incPending after the gate.
        _decPending();
    }
}

// ══════════════════════════════════════════════════════════════════
// Live Exit — cancel remaining SL or TP
// ══════════════════════════════════════════════════════════════════
async function _handleLiveExit(pos, exitType, exitPrice, pnl) {
    // [SP2-7b] EXTERNAL (adopted) positions are now allowed through. The server net's
    // protective SL is the ONLY protection for an adopted position — its trigger MUST
    // reach the exchange (reduce-only MARKET close), else the position stays open +
    // unprotected (phantom).
    if (!pos.live || (pos.live.status !== 'LIVE' && pos.live.status !== 'LIVE_NO_SL' && pos.live.status !== 'EXTERNAL')) return;

    // [MULTI-USER] Hard guard — no fallback to user 1
    if (!pos.userId) { logger.error('AT_LIVE', 'handleLiveExit without pos.userId — aborting'); return; }
    const userId = pos.userId;
    const us = _uState(userId);
    const creds = _credsForPosition(userId, pos);
    if (!creds) return;

    // [SP2-7b] EXTERNAL positions have NO resting SL/TP order on the exchange — the
    // HIT_SL/HIT_TP "the exchange already closed us" assumption is FALSE for adopted
    // positions. Route every EXTERNAL exit through the reduce-only MARKET close path
    // (the `else` branch below) so the close actually executes. _isExternal forces the
    // market-close branch regardless of exitType.
    const _isExternal = pos.live.status === 'EXTERNAL';

    // [FIX-EXPIRY] EXPIRED handling removed — no code path produces EXPIRED anymore
    if (!_isExternal && exitType === 'HIT_SL') {
        // SL triggered on exchange — cancel remaining TP
        // [Fix #5] Use exchangeOps.cancelOrder for exchange-aware cancel (Bybit + Binance)
        if (pos.live.tpOrderId) {
            try { await exchangeOps.cancelOrder(userId, { symbol: pos.symbol, orderId: pos.live.tpOrderId, exchangeOverride: pos.exchange }); } catch (_) { /* warn only — cancel fail is non-fatal */ }
        }
        // Query real fill price from SL order (best-effort — corrects slippage)
        // [Fix #6] Guard by exchange: Binance-only algoOrder/order query. Bybit deferred to Phase 2.
        if (pos.live.slOrderId) {
            const userExchange = creds && creds.exchange;
            if (userExchange === 'binance' || !userExchange) {
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
                    // [TM-5] Defensive `pos.price > 0` guard added — prevents
                    // div-by-zero NaN propagation in PnL formula below if pos.price
                    // ever fell to 0/NaN through corrupt state. realFill guard
                    // already in place; pos.price guard is defensive belt-and-braces.
                    if (Number.isFinite(realFill) && realFill > 0 && pos.price > 0 && (slStatus === 'FILLED' || slStatus === 'FINISHED')) {
                        // Exit slippage tracking
                        const expectedExitPrice = pos.sl;
                        const exitSlippage = realFill - expectedExitPrice;
                        const exitSlippagePct = expectedExitPrice > 0 ? +((exitSlippage / expectedExitPrice) * 100).toFixed(4) : 0;
                        pos.live.exitSlippage = exitSlippage;
                        pos.live.exitSlippagePct = exitSlippagePct;
                        pos.live.exitFillPrice = realFill;
                        pos.live.exitExpectedPrice = expectedExitPrice;

                        // [TM-4] Apply round-trip fee deduction to terminal PnL.
                        // Gross PnL overstated by ~0.08% (entry+exit fees on notional).
                        const _grossPnl = pos.side === 'LONG'
                            ? +((realFill - pos.price) / pos.price * pos.size * pos.lev).toFixed(2)
                            : +((pos.price - realFill) / pos.price * pos.size * pos.lev).toFixed(2);
                        const realPnl = _applyRoundTripFee(_grossPnl, pos.size, pos.lev);
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
            } else {
                // Bybit slippage correction deferred to Phase 2
                logger.info('AT_LIVE_EXIT', `SL fill price query skipped for ${userExchange} user=${userId} — deferred to Phase 2`);
            }
        }
    } else if (!_isExternal && exitType === 'HIT_TP') {
        // TP triggered on exchange — cancel remaining SL
        // [Fix #5] Use exchangeOps.cancelOrder for exchange-aware cancel (Bybit + Binance)
        if (pos.live.slOrderId) {
            try { await exchangeOps.cancelOrder(userId, { symbol: pos.symbol, orderId: pos.live.slOrderId, exchangeOverride: pos.exchange }); } catch (_) { /* warn only — cancel fail is non-fatal */ }
        }
    } else {
        // All other exit types: DSL_PL, DSL_TTP, MANUAL_CLIENT, RESET, RECON_PHANTOM, etc.

        // [V5.1] Server-side exits need a MARKET close (position is still open on exchange)
        // Exception: RECON_PHANTOM / RECON_EXCHANGE_CLOSED — exchange already doesn't have the position
        // [Task 41] Direct sendSignedRequest replaced with exchangeOps.closePosition router.
        // binanceOps.closePosition has NO internal retry — serverAT retry wrapper PRESERVED.
        // binanceOps.closePosition cancels SL+TP internally — manual cancel loop REMOVED.
        if (exitType !== 'RECON_PHANTOM' && exitType !== 'RECON_EXCHANGE_CLOSED' && exitType !== 'EXTERNAL_CLOSE' && pos.live.executedQty) {
            const rounded = roundOrderParams(pos.symbol, pos.live.executedQty);
            // [LIVE-PARITY] Retry loop for market close — PRESERVED (exchangeOps has no retry)
            const CLOSE_RETRIES = [1000, 3000, 5000];
            let closeResult = null;
            // [Task 41] opsSeq links to binanceOps at_positions row (Task 40 dual-write bridge)
            const closeSeq = (pos.live && pos.live.opsSeq) ? pos.live.opsSeq : pos.seq;
            for (let attempt = 0; attempt <= CLOSE_RETRIES.length; attempt++) {
                try {
                    // [Task 41] Route through exchangeOps router (Binance or Bybit per user setting)
                    // exchangeOps.closePosition: cancels SL+TP + sends reduce-only MARKET + DB transition
                    const closeDecisionKey = require('./decisionKey').generate();
                    closeResult = await exchangeOps.closePosition(userId, {
                        seq: closeSeq,
                        symbol: pos.symbol,
                        side: pos.side,          // LONG/SHORT — exchangeOps converts to BUY/SELL internally
                        qty: String(rounded.quantity || pos.live.executedQty),
                        closeType: 'MARKET',
                        decisionKey: closeDecisionKey,
                        source: exitType,         // audit trail: DSL_PL, MANUAL_CLIENT, RESET, etc.
                        exchangeOverride: pos.exchange,  // [P2b] close on the position's OWN exchange
                        // [P2 close-desync fix 2026-05-30] Pass the known protective order ids from
                        // the in-memory pos so the ops layer can cancel SL/TP + reduce-only close even
                        // when the at_positions row was already optimistically archived (the
                        // _persistClose race below removes it before this fire-and-forget close runs).
                        slOrderId: pos.live && pos.live.slOrderId,
                        tpOrderId: pos.live && pos.live.tpOrderId,
                    });
                    if (closeResult && closeResult.ok) break; // success
                    // ok:false (e.g. lock timeout, close rejected) — treat as retriable error
                    const errMsg = (closeResult && closeResult.error) ? (closeResult.error.message || closeResult.error.code || 'unknown') : 'ok:false';
                    logger.error('AT_LIVE', `[${pos.seq}] ${exitType} market close attempt ${attempt + 1}/${CLOSE_RETRIES.length + 1} returned !ok: ${errMsg}`);
                    closeResult = null; // clear so failure path triggers below
                } catch (closeErr) {
                    logger.error('AT_LIVE', `[${pos.seq}] ${exitType} market close attempt ${attempt + 1}/${CLOSE_RETRIES.length + 1} failed: ${closeErr.message}`);
                }
                if (attempt < CLOSE_RETRIES.length) {
                    await new Promise(r => setTimeout(r, CLOSE_RETRIES[attempt]));
                } else {
                    // All retries exhausted — queue for reconciliation
                    _pendingLiveCloses.set(pos.seq, { pos, exitType, exitPrice, pnl, ts: Date.now() });
                    // [ORPHAN ROOT FIX 2026-06-05] The old log said "queued for
                    // reconciliation" but queued NOTHING (recon's orphan sweep also
                    // early-returned with no internal live positions — the exact
                    // state an orphan creates). ETH orphan bled 6h with a fictive
                    // +$17.32 in the journal (real -$42.72). Now: REALLY enqueue
                    // into emergency_close_queue; emergencyCloseProcessor drains it
                    // every 60s (the queue used to be processed at boot only).
                    const _queued = module.exports._enqueueEmergencyClose(userId, pos, exitType);
                    logger.error('AT_LIVE', `[${pos.seq}] ALL close retries failed — ${_queued ? 'ENQUEUED for emergency-close processor (60s)' : 'ENQUEUE FAILED — manual intervention required'}`);
                    telegram.sendToUser(userId, `🚨 *MARKET CLOSE FAILED*\n${exitType} exit for ${pos.side} ${pos.symbol}\nAll ${CLOSE_RETRIES.length + 1} attempts failed.\n*Position may still be open on exchange — ${_queued ? 'emergency processor retries every 60s' : 'AUTO-RETRY UNAVAILABLE, close manually'}.*`);
                }
            }
            if (closeResult && closeResult.ok) {
                // [Task 41] Adapter: exchangeOps returns avgFillPrice (not avgPrice)
                const _clRaw = parseFloat(closeResult.avgFillPrice);
                const realFill = (Number.isFinite(_clRaw) && _clRaw > 0) ? _clRaw : exitPrice;
                if (realFill > 0 && pos.price > 0) {
                    // [TM-4] Apply round-trip fee deduction (market close path).
                    const _grossPnl = pos.side === 'LONG'
                        ? +((realFill - pos.price) / pos.price * pos.size * pos.lev).toFixed(2)
                        : +((pos.price - realFill) / pos.price * pos.size * pos.lev).toFixed(2);
                    const realPnl = _applyRoundTripFee(_grossPnl, pos.size, pos.lev);
                    pos.live.exitFillPrice = realFill;
                    pos.live.exitExpectedPrice = exitPrice;
                    pos.closePnl = realPnl;
                    pnl = realPnl;
                }
                // [Task 41] Carry orderId for downstream legacy callers (e.g. audit)
                pos.live.exitOrderId = closeResult.orderId || null;
                logger.info('AT_LIVE', `[${pos.seq}] ${exitType} market close filled @ $${(closeResult.avgFillPrice || exitPrice)} PnL=$${pnl.toFixed(2)}`);
            }
            // Note: SL+TP cancel already handled inside exchangeOps.closePosition — no manual loop needed
        } else if (exitType === 'RECON_PHANTOM' || exitType === 'RECON_EXCHANGE_CLOSED') {
            // Recon exits: position already gone on exchange — cancel orphan SL+TP protection orders only
            // [Fix #5] Use exchangeOps.cancelOrder for exchange-aware cancel (Bybit + Binance)
            for (const oid of [pos.live.slOrderId, pos.live.tpOrderId]) {
                if (oid) {
                    try { await exchangeOps.cancelOrder(userId, { symbol: pos.symbol, orderId: oid, exchangeOverride: pos.exchange }); } catch (_) { /* warn only */ }
                }
            }
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
    // [Phase M] Bybit has no Binance algo/order DELETE endpoints — route through
    // bybitOps.cancelOrder. Treat already-gone orders as success (idempotent cleanup).
    if (creds && creds.exchange === 'bybit') {
        try {
            const bybitOps = require('./bybitOps');
            const r = await bybitOps.cancelOrder(userId || 0, { symbol, orderId }, creds);
            if (r && r.ok) return true;
            const em = (r && r.error && (r.error.message || r.error)) || '';
            return /not found|unknown|too late|not exist|110001|order does not exist/i.test(String(em));
        } catch (e) {
            const m = (e && e.message) || '';
            if (/not found|unknown|too late|not exist|110001/i.test(m)) return true;
            logger.warn('AT_LIVE', `Bybit cancel ${orderId} failed: ${m}`);
            return false;
        }
    }
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
// [ORPHAN ROOT FIX 2026-06-05] Persist a failed market close into
// emergency_close_queue so emergencyCloseProcessor (60s) retries until the
// exchange accepts. INSERT OR IGNORE — decision_key is UNIQUE, so re-entry
// for the same position is idempotent. Returns true when the row is in.
function _enqueueEmergencyClose(userId, pos, exitType) {
    try {
        const qty = (pos.live && pos.live.executedQty) || pos.qty;
        // [2026-06-07 B1] db = database MODULE; raw sqlite handle is db.db.
        // Bare db.prepare threw "not a function" — fired live 09:23:40 seq
        // 1776859653259 (4/4 close retries failed AND enqueue failed; recon
        // saved it). Regression net: tests/unit/serverat-db-handle.test.js
        db.db.prepare(
            `INSERT OR IGNORE INTO emergency_close_queue (user_id, symbol, exchange, qty, decision_key, created_at) VALUES (?, ?, ?, ?, ?, ?)`
        ).run(userId, pos.symbol, pos.exchange || 'binance', String(qty), `closefail_${pos.seq}_${exitType}`.slice(0, 64), Date.now());
        return true;
    } catch (e) {
        try { logger.error('AT_LIVE', `[${pos.seq}] emergency-close enqueue FAILED: ${e.message}`); } catch (_) {}
        return false;
    }
}

function _closePosition(idx, pos, exitType, price, pnl) {
    // [MULTI-USER] Hard guard — no fallback to user 1
    if (!pos.userId) { logger.error('AT_ENGINE', '_closePosition without pos.userId seq=' + pos.seq + ' — aborting'); return; }
    const userId = pos.userId;
    const us = _uState(userId);
    try { mlDslShadow.remove(pos.seq); delete pos._mlDslPrevPrice; delete pos._mlDslLastEmit; } catch (_) { } // [ML-DSL] drop shadow proposal + scratch on close
    // [ML-DSL v2] On close: counterfactual baseline + train the learner (telemetry-safe).
    if (MF.ML_DSL_LEARN_ENABLED) {
        try {
            const _trace = priceTrace.get(pos.seq);
            if (_trace.length > 1) {
                const _baseParams = serverDSL.getPreset(pos.dslModeAtOpen || 'def');
                const _meta = { side: pos.side, entry: pos.price, originalSL: pos.originalSL || pos.sl };
                const _baseSim = serverDSL.simulate(_baseParams, _meta, _trace.map(s => s.p));
                const _mlPnlPct = pos.price > 0 ? ((pos.side === 'LONG' ? (price - pos.price) : (pos.price - price)) / pos.price) * 100 : 0;
                mlDslLearner.learn({
                    posId: pos.seq, userId: pos.userId, env: (pos.env || 'TESTNET'),
                    symbol: pos.symbol, regime: pos.regime || pos.closeRegime || 'unknown',
                    arm: pos.dslArm || pos.dslModeAtOpen || 'def', cohort: pos.dslCohort || 'shadow',
                    outcome: { pnlPct: _mlPnlPct }, baseline: { pnlPct: _baseSim.pnlPct }, ts: Date.now(),
                });
            }
        } catch (_) { /* telemetry-safe */ }
        try { priceTrace.clear(pos.seq); } catch (_) {}
    }

    // [PHANTOM ROOT FIX 2026-06-05] Mark this uid|symbol as recently closed so
    // the userdata fast-path doesn't adopt our own mid-close fill snapshots as
    // phantom "external" positions (see _closeRaceGuard).
    try { _closeRaceGuard.record(userId, pos.symbol); } catch (_) {}

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

    // [ML Phase B Day 8] Ring5 loop closure — outcome feeds bandit posteriors.
    // Binary mapping: win (pnl > 0) → +0.5, loss (pnl < 0) → -0.5, flat → 0.
    // recordContribution internally writes ml_bandit_evidence + updates L4
    // posterior + invalidates LRU cache. Telemetry-only mode: errors swallowed
    // so close flow never affected. RESET exit excluded (admin reset, not real trade).
    // [BUG-AUDIT] Regime fallback: if pos.regime null (non-brain entry), pull from serverState.
    if (exitType !== 'RESET') {
        try {
            const ring5 = _getRing5();
            let _posRegime = pos.regime;
            if (!_posRegime && pos.symbol) {
                try {
                    const _ss = require('./serverState');
                    const _snap = _ss.getSnapshotForSymbol(pos.symbol);
                    _posRegime = _snap && _snap.indicators ? _snap.indicators.regime : null;
                } catch (_) {}
            }
            if (ring5 && pos.env && pos.symbol && _posRegime) {
                const contribution = pnl > 0 ? 0.5 : pnl < 0 ? -0.5 : 0;
                ring5.recordContribution({
                    userId,
                    resolvedEnv: pos.env,
                    symbol: pos.symbol,
                    moduleId: 'ring5_outcome',
                    contribution,
                    confidence: Math.max(0, Math.min(1, (pos.confidence || 0) / 100)),
                    ts: Date.now(),
                    regime: _posRegime
                });
            }
        } catch (_ring5Err) { /* never block close flow */ }
    }

    // [Day 28] R5A attribution recording — feeds §16 measurement triad
    // (ml_attribution_events). Normal closes only — exclude RESET (admin) +
    // EMERGENCY_CLOSED (anomaly) + RECON_PHANTOM (external sync). Skip env
    // missing or pos.size invalid (can't compute pnl%).
    const _attribSkipExits = new Set(['RESET', 'EMERGENCY_CLOSED', 'RECON_PHANTOM', 'RECON_EXCHANGE_CLOSED', 'RECON_PHANTOM_MERGED_DUP']);
    if (!_attribSkipExits.has(exitType) && pos.env && pos.size > 0) {
        try {
            const attrib = _getR5AAttribution();
            if (attrib && attrib.recordAttribution) {
                const pnlPct = (pnl / pos.size) * 100;
                let _attrDigest = null;
                try {
                    const snapRow = db.db.prepare(
                        'SELECT decision_digest FROM ml_decision_snapshots WHERE user_id = ? AND symbol = ? ORDER BY created_at DESC LIMIT 1'
                    ).get(userId, pos.symbol);
                    if (snapRow && snapRow.decision_digest) _attrDigest = snapRow.decision_digest;
                } catch (_) {}
                attrib.recordAttribution({
                    userId,
                    resolvedEnv: pos.env,
                    trade: {
                        symbol: pos.symbol,
                        pos_id: String(pos.seq || ''),
                        side: pos.side,
                        decision_digest: _attrDigest,
                        closed_by: exitType === 'MANUAL_CLIENT' ? 'manual'
                                  : exitType === 'HIT_TP' ? 'tp'
                                  : exitType === 'HIT_SL' ? 'sl'
                                  : exitType.toLowerCase(),
                        pnl_pct: pnlPct,
                        r_multiple: pos.rr && pnl !== 0 ? (pnl > 0 ? Math.abs(pnlPct / pos.slPct || 1) : -1) : null,
                        regime: pos.regime,
                        score_at_entry: pos.confluenceScore || null
                    },
                    snapshot: {
                        regime: pos.regime,
                        mfe: pos.quality ? pos.quality.mfe : null,
                        mae: pos.quality ? pos.quality.mae : null
                    }
                });
            }
        } catch (_attErr) { /* never block close flow */ }
    }

    // [Day 31] Write REACTION utterance to TheVoice feed on every normal close.
    // Mood + tone scaled by pnl magnitude. Skip RESET/EMERGENCY/RECON (anomaly).
    if (!_attribSkipExits.has(exitType)) {
        try {
            const vl = require('./ml/_voice/voiceLogger');
            const pnlPct = pos.size > 0 ? (pnl / pos.size) * 100 : 0;
            const absPct = Math.abs(pnlPct);
            let mood, suffix;
            if (pnl > 0 && absPct >= 1.5) { mood = 'EXCITED'; suffix = 'felt right.'; }
            else if (pnl > 0)             { mood = 'FOCUSED'; suffix = 'small win, taking it.'; }
            else if (pnl < 0 && absPct >= 1.5) { mood = 'SAD';     suffix = 'taking the L.'; }
            else if (pnl < 0)             { mood = 'CALM';    suffix = 'minor bleed.'; }
            else                           { mood = 'BORED';   suffix = 'washed out, flat.'; }
            const exitWord = exitType === 'HIT_TP' ? 'TP hit'
                          : exitType === 'HIT_SL' ? 'SL hit'
                          : exitType === 'MANUAL_CLIENT' ? 'manual close'
                          : exitType === 'DSL_PL' ? 'DSL profit lock'
                          : exitType === 'DSL_TTP' ? 'DSL trailing TP'
                          : exitType.toLowerCase();
            const sign = pnl >= 0 ? '+' : '';
            const text = `${pos.side} ${pos.symbol} closed (${exitWord}) ${sign}$${pnl.toFixed(2)} — ${suffix}`;
            vl.logUtterance({
                userId, utteranceType: 'REACTION', mood, text,
                templateId: 'trade_close',
                contextJson: JSON.stringify({
                    seq: pos.seq, symbol: pos.symbol, side: pos.side,
                    exitType, pnl: +pnl.toFixed(2), pnlPct: +pnlPct.toFixed(2)
                })
            });
        } catch (_) { /* never block close flow */ }
    }

    // [A-Z R] OMEGA reaction on manual trade
    if (exitType === 'MANUAL_CLIENT') {
        try {
            const tr = require('./ml/_voice/tradeReaction');
            const _rMood = (() => { try { return require('./ml/_crosscutting/moodEmaTracker').getCurrentMood(); } catch(_) { return 'CALM'; } })();
            tr.reactToTrade({ userId, symbol: pos.symbol, side: pos.side, action: pnl > 0 ? 'win' : 'loss', pnl, mood: _rMood });
        } catch (_) {}
    }

    // [Wave 7b] Tamper-evident audit — every position close appended to
    // chained hash trail. Operator can verify entire chain via
    // /api/omega/audit/chain/verify; any tampering breaks subsequent links.
    try {
        const chain = require('./ml/_audit/chainedTrail');
        chain.append({
            kind: 'POSITION_CLOSE',
            payload: {
                userId, seq: pos.seq, symbol: pos.symbol, side: pos.side,
                entry: pos.price, exit: price, pnl: +pnl.toFixed(2),
                exitType, mode: pos.mode || 'demo', lev: pos.lev,
                openTs: pos.openTs, closeTs: Date.now(),
            },
        });
    } catch (_) { /* never block close flow */ }

    // [Wave 5] R4 funding-aware exit advisory — log funding context at exit.
    try {
        const _fae = require('./ml/R4_execution/fundingAwareExit');
        if (typeof _fae.recordFundingEvaluation === 'function') {
            _fae.recordFundingEvaluation({
                userId,
                resolvedEnv: (us.engineMode || 'demo').toUpperCase(),
                posId: String(pos.seq || ''),
                evaluation: {
                    recommendation: 'HOLD',
                    shouldExit: false,
                    reason: 'exit_telemetry_' + (exitType || 'unknown'),
                    currentFundingRate: 0,
                    timeToFundingMs: 0,
                    estimatedCostUsd: 0,
                },
            });
        }
    } catch (_) { /* never block close flow */ }

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
    // [TM-1] Zero-PnL break-even trade was previously counted as loss via
    // catch-all `else`. Compare line 1684-1685 (liveStats) which already used
    // `else if (pnl < 0)` correctly. Now `stats` and `demoStats` mirror that
    // semantic — break-even (pnl===0) is NEITHER win NOR loss. Existing
    // exits counter still increments so total trade count is preserved.
    if (pnl > 0) us.stats.wins++;
    else if (pnl < 0) us.stats.losses++;
    if (pos.mode !== 'live') {
        us.demoStats.exits++;
        us.demoStats.pnl = +(us.demoStats.pnl + pnl).toFixed(2);
        if (pnl > 0) us.demoStats.wins++;
        else if (pnl < 0) us.demoStats.losses++;
    }

    // [Wave 8 E] Easter eggs — detect milestone moments + emit special TheVoice
    // utterance. Best-effort isolation; never blocks close flow.
    try {
        const _totalExits = us.stats.exits || (us.stats.wins + us.stats.losses);
        const _totalWins = us.stats.wins;
        const _milestoneText = (() => {
            // Win milestones
            if (pnl > 0) {
                if (_totalWins === 100) return '🎉 boss, 100 wins. that\'s the click of a habit becoming a craft.';
                if (_totalWins === 500) return '🎉 500 wins logged. you\'re not gambling anymore, you\'re running an edge.';
                if (_totalWins === 1000) return '🎉 1000 wins. four-digit territory. taking screenshots in the matrix.';
            }
            // Trade count milestones
            if (_totalExits === 50) return '⚡ 50 trades closed. starting to look like a track record.';
            if (_totalExits === 250) return '⚡ 250 trades closed. discipline is showing through the noise.';
            if (_totalExits === 1000) return '⚡ 1000 trades closed. you\'ve out-traded most retail accounts on this planet.';
            // First profit day detection (today wins exceed losses, first time)
            // Coarse: check if dailyPnL just crossed positive after being negative
            const _firstProfitDayKey = '_firstProfitDayShown';
            if (pnl > 0 && (us.dailyPnL || 0) > 0 && !us[_firstProfitDayKey]) {
                // Check that today's gross dailyPnL minus this trade was <= 0 (just flipped green)
                if ((us.dailyPnL - pnl) <= 0) {
                    us[_firstProfitDayKey] = new Date().toISOString().slice(0, 10);
                    return '☀️ first green day this session. flipping the script.';
                }
            }
            return null;
        })();
        if (_milestoneText) {
            const vl = require('./ml/_voice/voiceLogger');
            vl.logUtterance({
                userId, utteranceType: 'MILESTONE', mood: 'EXCITED',
                text: _milestoneText,
                templateId: 'omega_easter_egg',
                contextJson: JSON.stringify({
                    totalExits: _totalExits, totalWins: _totalWins, pnl: +pnl.toFixed(2),
                }),
            });
        }
    } catch (_) { /* never block close flow */ }

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
    const _exitCreds = _credsForPosition(userId, pos);
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
    // [SP2-7b] EXTERNAL (adopted) positions included — the server net's protective-SL
    // trigger MUST reach the exchange (reduce-only MARKET close); else the adopted
    // position is marked closed in Zeus but stays open + unprotected on the exchange.
    if (pos.live && (pos.live.status === 'LIVE' || pos.live.status === 'LIVE_NO_SL' || pos.live.status === 'EXTERNAL')) {
        _handleLiveExit(pos, exitType, price, pnl).catch(err => {
            logger.error('AT_LIVE', `Live exit handler failed [${pos.seq}]: ${err.message}`);
        });
    }

    serverDSL.detach(pos.seq);
    _trackLiveClose(pos); // [P5b] release feed hold (grace-stop if last position on that exchange)
    us.dailyPnL = +(us.dailyPnL + pnl).toFixed(2);
    if (pos.mode === 'live') { us.dailyPnLLive = +(us.dailyPnLLive + pnl).toFixed(2); }
    else { us.dailyPnLDemo = +(us.dailyPnLDemo + pnl).toFixed(2); }
    // [Task S8-P1-4 2026-05-28] Update streak counters for brain-gate parity.
    _updateStreakCounters(us, pnl);
    _checkKillSwitch(userId);

    // [RE-ENTRY + S5] Set close cooldown DEADLINE (now + CLOSE_COOLDOWN_MS) and
    // persist it per-user so PM2 reload does not weaken the [RE-ENTRY] gate.
    _setCloseCooldownDeadline(userId, pos.symbol);

    // ── Persist close + remove from active ──
    // [B2-FIX] Always splice from _positions to prevent zombie memory leak.
    // If DB archive fails, position data is already in pos object (logged below).
    // Recon cycle will detect the orphan and reconcile.
    const _archiveOk = _persistClose(pos);
    _positions.splice(idx, 1);
    if (!_archiveOk) {
        logger.error('AT_DB', `[${pos.seq}] Archive failed — position spliced from memory, recon will reconcile. data=${JSON.stringify({ seq: pos.seq, symbol: pos.symbol, pnl: pos.closePnl })}`);
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

    // [Phase B 2026-05-19] Release marketFeed ref so pollers can be torn down
    // when last position on this symbol closes. Sticky boot symbols are
    // unaffected (their boot|system ref persists). Safe-guard: only release
    // for live positions — demo positions never subscribed via ref-count.
    if (pos.mode === 'live' && pos.userId && pos.env && pos.seq) {
        try {
            const refKey = `${pos.userId}|${pos.env}|${pos.seq}`;
            const released = marketFeed.releaseRef(refKey);
            if (released.length > 0) {
                logger.info('AT_ENGINE', `[Phase B] released marketFeed refs: ${released.join(',')} (refKey=${refKey})`);
            }
        } catch (e) {
            logger.warn('AT_ENGINE', `[Phase B] releaseRef failed seq=${pos.seq}: ${e.message}`);
        }
    }
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
    const creds = _credsForPosition(userId, pos);
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
        const wasKillActive = us.killActive;
        if (wasKillActive) {
            logger.info('AT_ENGINE', `Kill switch reset uid=${userId} — new UTC day`);
            telegram.sendToUser(userId, '🟢 *Kill Switch Reset*\nNew UTC day — entries re-enabled');
        }
        us.dailyPnL = 0;
        us.dailyPnLDemo = 0;
        us.dailyPnLLive = 0;
        us.pnlAtReset = 0;
        us.killActive = false;
        // [Task S8-P1-4 2026-05-28] dailyTrades is a per-day counter — reset at
        // UTC rollover. lossStreak/winStreak are NOT daily (they're streaks that
        // only break on the opposite outcome), so they survive the rollover.
        us.dailyTrades = 0;
        us.dailyEntries = 0; // [T-MAXTRADES] daily entry cap counter resets too
        us.lastResetDay = utcDay;
        _persistState(userId);
        // [M2] Push state change to clients via WS so UI unlocks immediately after midnight
        if (wasKillActive) _notifyChange(userId);
    }
}

// [Task S8-P1-4 2026-05-28] Pure streak-counter update. Called on every close.
// win (pnl>0) → winStreak++, lossStreak=0. loss (pnl<0) → lossStreak++,
// winStreak=0. flat/non-numeric → no streak change. dailyTrades always ++.
function _updateStreakCounters(us, pnl) {
    us.dailyTrades = (us.dailyTrades || 0) + 1;
    const p = Number(pnl);
    if (!Number.isFinite(p)) return;
    if (p > 0) { us.winStreak = (us.winStreak || 0) + 1; us.lossStreak = 0; }
    else if (p < 0) { us.lossStreak = (us.lossStreak || 0) + 1; us.winStreak = 0; }
}

// [T1-2 2026-06-07] Kill-switch liveBalanceRef resync.
// _checkKillSwitch is inert on live when liveBalanceRef<=0, and the ref was
// only ever auto-init on a mode switch (serverAT.js:765). A live user whose
// ref was never set (new REAL account, direct-live boot) had the daily-loss
// kill switch SILENTLY DISABLED. These heal it: a throttled resync kicked
// from _checkKillSwitch's inert branch.
const LIVE_BALREF_RESYNC_THROTTLE_MS = 30000;

function _shouldResyncLiveBalanceRef(us, now) {
    if (!us || us.engineMode !== 'live') return false;       // demo uses demoStartBalance
    if ((us.liveBalanceRef || 0) > 0) return false;          // already have a reference
    if ((now - (us._liveBalRefResyncTs || 0)) < LIVE_BALREF_RESYNC_THROTTLE_MS) return false; // throttle
    return true;
}

function _resyncLiveBalanceRef(userId) {
    const us = _uState(userId);
    if (!_shouldResyncLiveBalanceRef(us, Date.now())) return;
    us._liveBalRefResyncTs = Date.now(); // stamp BEFORE the async fetch (throttle)
    let creds = null;
    try { creds = getExchangeCreds(userId); } catch (_) {}
    if (!creds) {
        logger.warn('AT_ENGINE', `liveBalanceRef resync skipped uid=${userId} — no creds (kill switch stays inert until balance known)`);
        return;
    }
    exchangeOps.getBalance(userId).then(bal => {
        const total = parseFloat(bal.walletBalance || 0);
        if (total > 0 && (us.liveBalanceRef || 0) <= 0) {
            us.liveBalanceRef = total;
            _persistState(userId);
            logger.info('AT_ENGINE', `Kill switch liveBalanceRef RESYNCED uid=${userId}: $${total.toFixed(2)} (was <=0 — daily-loss protection was inert)`);
        }
    }).catch(err => {
        logger.warn('AT_ENGINE', `liveBalanceRef resync failed uid=${userId}: ${err.message}`);
    });
}

// [T-MAXTRADES 2026-06-07] Server-side MAX TRADES/DAY protection.
// The "PROTECT: MAX TRADES/DAY" badge was CLIENT display-only (brain.ts:1146)
// — the client is locked under server ownership and the server had NO daily
// entry cap (only maxPos concurrent), so users blew past it (14/10). These make
// it a real server gate with an operator disable toggle that persists until the
// next UTC day (auto-re-arms at rollover, mirroring dailyTrades).
function _utcDay(now) { return Math.floor((now || Date.now()) / 86400000); }

// Pure: block a NEW entry when at/over the daily cap AND protection not disabled
// for the current UTC day.
function shouldBlockMaxTradesDay(ctx) {
    const maxDay = +(ctx && ctx.maxDay) || 0;
    if (!(maxDay > 0)) return false;                          // no cap configured
    const entries = +(ctx && ctx.dailyEntries) || 0;
    if (entries < maxDay) return false;                       // under cap
    if (ctx.maxDayProtectOffDay && ctx.maxDayProtectOffDay === ctx.currentUtcDay) return false; // disabled today
    return true;                                              // at/over cap + armed → block
}

// Pure: display/state for getFullState + the UI badge/button.
function computeMaxDayProtectState(ctx) {
    const maxDay = +(ctx && ctx.maxDay) || 0;
    const entries = +(ctx && ctx.dailyEntries) || 0;
    const disabledToday = !!(ctx && ctx.maxDayProtectOffDay && ctx.maxDayProtectOffDay === ctx.currentUtcDay);
    const configured = maxDay > 0;
    const atCap = configured && entries >= maxDay;
    return { configured, maxDay, dailyEntries: entries, active: configured && !disabledToday, disabledToday, atCap, blocking: atCap && !disabledToday };
}

// Operator toggle. enabled=false → disable for today (stamp offDay=today);
// enabled=true → re-arm (clear offDay). Persists + notifies clients.
function setMaxDayProtect(userId, enabled) {
    const us = _uState(userId);
    us.maxDayProtectOffDay = enabled ? 0 : _utcDay();
    // [MTP-RESET 2026-06-08] Operator: disabling resets the daily entry counter
    // "de la 0" so the on-screen badge clears completely (it shows only while
    // blocking). Protection stays off until the next UTC day via offDay; it never
    // closes/touches OPEN positions (those keep running under DSL) — this only
    // affects the NEW-entry cap counter.
    if (!enabled) us.dailyEntries = 0;
    _persistState(userId);
    audit.record('MAX_TRADES_PROTECT_TOGGLE', { userId, enabled: !!enabled, offDay: us.maxDayProtectOffDay }, 'user');
    logger.info('AT_ENGINE', `MAX TRADES/DAY protection ${enabled ? 'RE-ARMED' : 'DISABLED until next UTC day'} uid=${userId}`);
    try { _notifyChange(userId); } catch (_) {}
    return { ok: true, active: !!enabled };
}

function _checkKillSwitch(userId) {
    const us = _uState(userId);
    if (us.killActive) return;
    const pct = us.killPct || 5;
    let balRef;
    if (us.engineMode === 'live') {
        if (us.liveBalanceRef > 0) { balRef = us.liveBalanceRef; }
        else {
            // [T1-2] No live balance ref → daily-loss kill would be silently
            // inert. Kick a throttled resync so it self-heals, and skip THIS
            // evaluation (can't compute a daily-loss % without a reference).
            try { module.exports._resyncLiveBalanceRef(userId); } catch (_) {}
            return;
        }
    } else {
        balRef = us.demoStartBalance > 0 ? us.demoStartBalance : 10000; // [S3] use start-of-day balance, not floating balance
    }
    const lossLimit = +(balRef * pct / 100).toFixed(2);
    const lossSinceReset = us.dailyPnL - (us.pnlAtReset || 0);
    if (lossSinceReset <= -lossLimit && lossLimit > 0) {
        us.killActive = true;
        us.killActiveAt = Date.now();
        us.killReason = 'daily_loss';
        us.killLoss = +lossSinceReset.toFixed(2);
        us.killLimit = +lossLimit.toFixed(2);
        us.killBalRef = +balRef.toFixed(2);
        us.killModeAtTrigger = us.engineMode;
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
    // [Day 20] Doctor P0 alert pe kill switch activation (operator panic = critical event).
    _emitDoctor({
        eventType: 'alert', severity: 'P0',
        moduleId: 'serverAT.killSwitch', ts: Date.now(),
        payload: { userId, action: 'activate' }
    });
    telegram.sendToUser(userId, '🛑 *Kill Switch MANUALLY Activated*\nAll new entries BLOCKED until manual reset or UTC day change');
    _notifyChange(userId);
    return { ok: true, killActive: true };
}

// [KILL-REARM 2026-06-07] The 5-min reset cooldown REMOVED per operator rule:
// deactivation is always allowed; protection against rapid re-loss comes from
// the pnlAtReset baseline (re-fires only after ANOTHER full killPct loss),
// not from blocking the deactivate button ("wait 162s" operator-reported as
// wrong behavior). Reset is idempotent — repeated calls re-baseline to the
// same dailyPnL, so there is nothing to rate-limit.
function resetKill(userId) {
    const us = _uState(userId);
    us.killActive = false;
    us.pnlAtReset = us.dailyPnL;
    // [2026-06-15] Fully clear the kill metadata on manual deactivate. Previously
    // killActiveAt/killReason/killLoss/killLimit were left stale, so (a) the client
    // mirrored them → a residual "kill switch" message lingered in the panel, and
    // (b) state.ts only wipes its local realizedDailyPnL counter when
    // `!killActive && killActiveAt === 0` — with killActiveAt stale that wipe never
    // fired, letting a journal recompute re-trigger the kill before the next loss.
    // Clearing them makes deactivate total: no residual, no re-arm until another
    // full killPct loss (pnlAtReset baseline still enforces that).
    us.killActiveAt = 0;
    us.killReason = null;
    us.killLoss = 0;
    us.killLimit = 0;
    us.killBalRef = 0;
    us.killModeAtTrigger = null;
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
    // [SRV-1] Surface invalid balance instead of silent ok:true on no-op.
    // Previously rejected balances (NaN, <=0) returned `{ ok: true,
    // liveBalanceRef: <unchanged> }` — caller couldn't tell if the value
    // was applied or rejected. Now: failure path logs warn + returns
    // `{ ok: false, error, input, parsed }` cu the unchanged ref so caller
    // has actionable diagnostic. Successful path unchanged.
    if (!Number.isFinite(bal) || bal <= 0) {
        logger.warn('AT_BALANCE', `setLiveBalanceRef rejected uid=${userId}: invalid balance "${balance}" (parsed=${bal})`);
        return { ok: false, error: 'INVALID_BALANCE', input: balance, parsed: bal, liveBalanceRef: us.liveBalanceRef };
    }
    us.liveBalanceRef = bal;
    _persistState(userId);
    return { ok: true, liveBalanceRef: us.liveBalanceRef };
}

// ══════════════════════════════════════════════════════════════════
// Price Update — check SL/TP/DSL exits
// ══════════════════════════════════════════════════════════════════
// [DSL-FIX 2026-06-01] Should the server skip its managed exits/DSL for this
// position? ONLY when the user EXPLICITLY took control — take-control sets
// _controlModeTs (serverAT setControlMode, ~line 4523). Born-manual positions
// have controlMode='user' but NO _controlModeTs; they MUST be server-managed
// (they enabled DSL and otherwise never get a trailing SL placed → zero
// protection, the bug found 2026-06-01). `now` is passed for testability.
function _isExplicitUserControl(pos, now) {
    if (!pos || pos.controlMode !== 'user' || !pos._controlModeTs) return false;
    return (now - pos._controlModeTs) <= 1800000; // within the 30-min window
}

// [DSL-FIX2 2026-06-01] Is the stop-loss breached? Guards against null/0/NaN
// effectiveSL — otherwise `price >= null` coerces to `price >= 0` (always true
// for a SHORT) and falsely closes a position that simply has no SL set yet
// (e.g. DSL not yet activated). A position without a valid SL is never "breached".
function _isSLBreached(side, price, effectiveSL) {
    if (!(Number(effectiveSL) > 0)) return false;
    return side === 'LONG' ? price <= effectiveSL : price >= effectiveSL;
}

// [SP2 fix #1] Disaster backstop — the original SL set at entry, or a derived
// fallback from slPct. NEVER null/0 (today's null-SL → instant-HIT_SL bug).
function _disasterStopPrice(pos) {
    if (Number(pos.originalSL) > 0) return Number(pos.originalSL);
    const slPct = Number(pos.slPct) > 0 ? Number(pos.slPct) : 0;
    if (slPct <= 0) return 0; // unknown → guard below refuses to close
    const dist = pos.price * slPct / 100;
    if (!(dist > 0)) return 0; // guard: tiny/corrupt slPct or price → no false stop-at-entry
    return pos.side === 'LONG' ? pos.price - dist : pos.price + dist;
}
function _shouldDisasterClose(pos, price) {
    const stop = _disasterStopPrice(pos);
    if (!(stop > 0)) return false; // never close on null/0 (no false HIT_SL)
    return pos.side === 'LONG' ? price <= stop : price >= stop;
}

// [SYNC-2 2026-06-01] Resolve the exchange a live position belongs to, so recon/close
// route to its OWN exchange. The order/place manual-live path builds the entry without
// an exchange (_buildEntryFromOrderPlace), so without this a Bybit live position would
// be persisted with the at_positions schema default 'binance' and reconcile/close on the
// WRONG exchange. Keep an already-set exchange; else take the creds' exchange; else null.
function _resolveEntryExchange(pos, creds) {
    if (pos && pos.exchange) return pos.exchange;
    return (creds && creds.exchange) || null;
}

function onPriceUpdate(symbol, price) {
    if (!price || price <= 0) return;

    const dslChangedUsers = new Set();
    // Snapshot length to avoid issues if array mutates during iteration
    for (let i = _positions.length - 1; i >= 0; i--) {
        if (i >= _positions.length) continue; // guard: array shrunk during iteration
        const pos = _positions[i];
        if (!pos || pos.symbol !== symbol) continue;
        if (pos.status && pos.status !== 'OPEN') continue; // already closing
        // [BUG B 2026-06-05] Exchange reported amt=0 and we're deferring ~2.5s
        // for the SL/TP fill event — don't let the server-side SL net close it
        // meanwhile with an ESTIMATED PnL (it would consume the position and
        // orphan the real exchange PnL held by _exitFillTracker).
        if (pos._pendingExchangeClose) continue;
        pos._lastPrice = price; // track for client-initiated close PnL
        // MAE/MFE tracking — min/max price during position lifetime
        if (!pos._minPrice || price < pos._minPrice) pos._minPrice = price;
        if (!pos._maxPrice || price > pos._maxPrice) pos._maxPrice = price;

        // [F3] Safety timeout — an EXPLICIT take-control reverts to 'auto' after
        // 30min so the server resumes management. (Only take-control sets
        // _controlModeTs; born-manual positions never enter this branch.)
        if (pos.controlMode === 'user' && pos._controlModeTs && (Date.now() - pos._controlModeTs) > 1800000) {
            pos.controlMode = 'auto';
            delete pos._controlModeTs;
            logger.warn('AT_ENGINE', `[${pos.seq}] controlMode reverted to auto — 30min timeout (uid=${pos.userId})`);
            telegram.sendToUser(pos.userId, `⚠️ *Take Control Expired*\nPosition #${pos.seq} — reverted to AUTO after 30min safety timeout`);
            _persistPosition(pos);
        }
        // [DSL-FIX 2026-06-01] Skip ONLY active explicit take-control. Born-manual
        // positions (controlMode='user' without _controlModeTs) fall through and
        // get full server DSL/SL/TP management — previously they were skipped here
        // forever, so their DSL never activated and no trailing SL was ever placed.
        // [SP2 fix #1] Under explicit take-control, suppress ACTIVE management (DSL
        // trailing / TP-tighten) but ALWAYS enforce the disaster backstop — never orphan.
        if (_isExplicitUserControl(pos, Date.now())) {
            if (_shouldDisasterClose(pos, price)) {
                const dPnl = pos.side === 'LONG'
                    ? +((price - pos.price) / pos.price * pos.size * pos.lev).toFixed(2)
                    : +((pos.price - price) / pos.price * pos.size * pos.lev).toFixed(2);
                _closePosition(i, pos, 'DISASTER_SL', price, dPnl);
                if (pos.userId) dslChangedUsers.add(pos.userId);
            }
            continue; // still skip active management (trailing/TP) for this position
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

        // [BUG-S7] Shadow parity log — gated by DSL_PARITY_SHADOW_ENABLED.
        // 1s per-pos throttle (mirrors client 5s, 5x denser pentru pair window
        // 2s la match sparse client emits). Pre-throttle every-tick rate
        // ~6376 rows/min observed la 5-50Hz price feed × multi-pos. Throttle
        // brings sustainable rate ~480 rows/min total.
        if (MF.DSL_PARITY_SHADOW_ENABLED) {
            const _nowParity = Date.now();
            const _lastEmitServer = pos._dslParityLastEmitServer || 0;
            if (_nowParity - _lastEmitServer >= 1000) {
                pos._dslParityLastEmitServer = _nowParity;
                const dslState = serverDSL.getState(pos.seq);
                if (dslState) {
                    db.logDslParityRow(pos.userId, pos.seq, pos.symbol, 'server', {
                        phase: _dslPhaseString(dslState),
                        currentSL: dslState.currentSL,
                        pivotLeft: dslState.pivotLeft,
                        pivotRight: dslState.pivotRight,
                        impulseVal: dslState.impulseVal,
                        entry: pos.price,
                        price: price,
                    });
                }
            }
        }

        // ── ML-DSL SHADOW (v1): propose, log, expose — DO NOT apply to the real stop ──
        // Mirrors the parity-shadow pattern above: flag-gated (default OFF) + 1s throttle.
        // Builds a favourable-momentum proxy from throttled price deltas, runs the
        // deterministic policy through the fail-closed safety net, and records the
        // proposal for the read-only DSL Drive endpoint. NEVER touches pos.sl — only
        // private pos._mlDsl* scratch fields.
        // [ML-DSL v2] record price path for counterfactual replay (independent of shadow)
        if (MF.ML_DSL_LEARN_ENABLED) { try { priceTrace.record(pos.seq, price, Date.now()); } catch (_) {} }
        if (MF.ML_DSL_SHADOW_ENABLED) {
            try {
                const _nowMl = Date.now();
                const _lastMl = pos._mlDslLastEmit || 0;
                if (_nowMl - _lastMl >= 1000) {
                    // Real momentum from live indicators (RSI + MACD dir + Supertrend dir),
                    // favourable-signed (+ve = market moving in this position's favour).
                    // ATR% taken from the indicator snapshot. Neutral (HOLD) when indicators
                    // aren't ready. Read-only — never mutates serverState.
                    let _mom = 0;
                    let _atrPct = Number.isFinite(pos.slPct) && pos.slPct > 0 ? pos.slPct : 1.0;
                    try {
                        const _snap = require('./serverState').getSnapshotForSymbol(pos.symbol);
                        const _ind = _snap && _snap.indicators;
                        if (_ind) {
                            if (Number.isFinite(+_ind.atr) && +_ind.atr > 0 && price > 0) _atrPct = (+_ind.atr / price) * 100;
                            if (Number.isFinite(+_ind.rsi)) {
                                const _rsiN = Math.max(-1, Math.min(1, (+_ind.rsi - 50) / 50));
                                const _macdS = _ind.macdDir === 'bull' ? 1 : _ind.macdDir === 'bear' ? -1 : 0;
                                const _stS = _ind.stDir === 'bull' ? 1 : _ind.stDir === 'bear' ? -1 : 0;
                                const _bull = Math.max(-1, Math.min(1, 0.5 * _rsiN + 0.3 * _macdS + 0.2 * _stS));
                                _mom = pos.side === 'SHORT' ? -_bull : _bull;
                            }
                        }
                    } catch (_) { /* indicators not ready → neutral momentum */ }
                    pos._mlDslLastEmit = _nowMl;

                    const _dslState = serverDSL.getState(pos.seq) || {};
                    const _feat = mlDslShadow.buildFeatures(pos, price, {
                        momentum: _mom, atrPct: _atrPct, regime: pos.regime,
                        progress: _dslState.progress,
                    });
                    const _raw = mlDslPolicy.decide(_feat);
                    const _safe = dslSafety.clamp(_raw, {
                        side: pos.side, entry: pos.price, price,
                        originalSL: pos.originalSL || pos.sl, maxLossPct: 1.5,
                    });
                    mlDslShadow.record(pos.seq, {
                        seq: pos.seq, symbol: pos.symbol, side: pos.side,
                        exchange: pos.exchange || null, mode: pos.mode || null,
                        entry: pos.price, price,
                        realPL: _dslState.pivotLeft || pos.sl,
                        realPR: _dslState.pivotRight || null,
                        realIV: _dslState.impulseVal || null,
                        realPhase: _dslState.phase || null,
                        mlAction: _safe.action, mlReason: _safe.reason,
                        mlPlPct: _safe.plPct, mlPrPct: _safe.prPct, mlIvPct: _safe.ivPct,
                        forcedExit: _safe.forcedExit, momentum: _mom,
                        mfePct: _feat.mfePct, maePct: _feat.maePct, ts: _nowMl,
                    });
                }
            } catch (_) { /* SHADOW must never affect the live loop */ }
        }
        // ── END ML-DSL SHADOW ──

        // ── Classic SL/TP check ──
        let closed = false;
        let pnl = 0;

        // [B7-FIX] Always compute actual PnL from real exit price, not preset slPnl.
        // Old code used pos.slPnl (estimated at entry) during DSL WAITING phase —
        // inaccurate when price gaps past SL level.
        // [DSL-FIX2 2026-06-01] Guard the SL check with _isSLBreached so a null/0
        // effectiveSL never triggers a false HIT_SL. Without it, a SHORT with no SL
        // set (DSL not yet activated) hit `price >= null` → `price >= 0` → true →
        // instant bogus close (found via live probe: seq ...109 closed HIT_SL @open).
        if (pos.side === 'LONG') {
            if (_isSLBreached('LONG', price, effectiveSL)) {
                pnl = +((price - pos.price) / pos.price * pos.size * pos.lev).toFixed(2);
                _closePosition(i, pos, 'HIT_SL', price, pnl);
                closed = true;
            } else if (pos.tp && price >= pos.tp) {
                const tpPnlReal = +((price - pos.price) / pos.price * pos.size * pos.lev).toFixed(2);
                _closePosition(i, pos, 'HIT_TP', price, tpPnlReal);
                closed = true;
            }
        } else {
            if (_isSLBreached('SHORT', price, effectiveSL)) {
                pnl = +((pos.price - price) / pos.price * pos.size * pos.lev).toFixed(2);
                _closePosition(i, pos, 'HIT_SL', price, pnl);
                closed = true;
            } else if (pos.tp && price <= pos.tp) {
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

// [Phase 2 S2.C-follow-up R1] Single normalization helper — guarantees every
// snapshot row ships sourceMode / autoTrade / controlMode / lev consistently,
// whether it comes from in-memory `_positions` (live state) or from
// `db.atLoadOpenPositions` (broadcast snapshot after DB commit). Legacy rows
// persisted before Phase 3A ownership stamping may have undefined ownership
// fields; without this, client's _mapServerPos would default autoTrade=false
// and AT-owned positions would misclassify as MANUAL in panels that read
// from split-array getters or the positions.changed WS stream.
function _normalizePositionRow(p) {
    const copy = Object.assign({}, p);
    copy.dsl = serverDSL.getState(p.seq) || null;
    if (typeof copy.lev !== 'number' || !(copy.lev > 0)) copy.lev = 1;
    if (typeof copy.autoTrade !== 'boolean') {
        copy.autoTrade = (copy.sourceMode === 'auto');
    }
    if (!copy.sourceMode) {
        copy.sourceMode = copy.autoTrade === true ? 'auto' : 'manual';
    }
    if (!copy.controlMode) {
        copy.controlMode = copy.autoTrade === true ? 'auto' : 'user';
    }
    return copy;
}

function getOpenPositions(userId) {
    return _positions.filter(p => p.userId === userId).map(_normalizePositionRow);
}

function getOpenCount(userId) { return _positions.filter(p => p.userId === userId).length; }

// [S5] Persist this user's close-cooldown rows. Shape: { 'uid:symbol': deadlineMs }.
// Called after every set so the live PM2 process and any restart are coherent.
function _persistCloseCooldownsForUser(userId) {
    try {
        const obj = {};
        const prefix = userId + ':';
        for (const [k, v] of _closeCooldowns) {
            if (k.indexOf(prefix) === 0) obj[k] = v;
        }
        db.atSetState('serverAT:closeCooldowns:' + userId, obj, userId);
    } catch (e) {
        try { logger.warn('AT_RE-ENTRY', '_persistCloseCooldownsForUser failed: ' + (e && e.message)); } catch (_) {}
    }
}

// [S5] Lazy restore: pulled in on the first close-cooldown read per user. The
// brain calls isCloseCooldownActive on every gate evaluation, so restoration
// happens at decision time without needing a module-load boot hook (this file
// has no dedicated start() function). Backward compatible with legacy bare
// closeTs values: legacy → effective deadline = closeTs + CLOSE_COOLDOWN_MS.
function _restoreCloseCooldownsForUser(userId) {
    if (_closeCooldownsRestoredFor.has(userId)) return;
    _closeCooldownsRestoredFor.add(userId);
    try {
        const saved = db.atGetState('serverAT:closeCooldowns:' + userId);
        if (!saved || typeof saved !== 'object') return;
        const now = Date.now();
        const prefix = userId + ':';
        let restored = 0;
        for (const [k, v] of Object.entries(saved)) {
            if (k.indexOf(prefix) !== 0) continue;
            if (typeof v !== 'number' || !Number.isFinite(v)) continue;
            const deadline = v <= now ? v + CLOSE_COOLDOWN_MS : v;
            if (deadline > now && !_closeCooldowns.has(k)) {
                _closeCooldowns.set(k, deadline);
                restored++;
            }
        }
        if (restored > 0) {
            try { logger.info('AT_RE-ENTRY', `[S5] uid=${userId} restored ${restored} close-cooldown(s)`); } catch (_) {}
        }
    } catch (e) {
        try { logger.warn('AT_RE-ENTRY', '_restoreCloseCooldownsForUser failed: ' + (e && e.message)); } catch (_) {}
    }
}

// [S5] Set + persist close-cooldown deadline for (userId, symbol).
function _setCloseCooldownDeadline(userId, symbol) {
    const deadline = Date.now() + CLOSE_COOLDOWN_MS;
    _closeCooldowns.set(userId + ':' + symbol, deadline);
    _persistCloseCooldownsForUser(userId);
}

// [RE-ENTRY + S5] Check if symbol was recently closed (prevents immediate
// re-entry). Uses absolute-deadline semantics — gate is active when a deadline
// exists AND the deadline is in the future. Lazily restores any persisted
// rows for this user on first call.
function isCloseCooldownActive(userId, symbol) {
    _restoreCloseCooldownsForUser(userId);
    const key = userId + ':' + symbol;
    const deadline = _closeCooldowns.get(key);
    if (!deadline) return false;
    if (Date.now() >= deadline) {
        _closeCooldowns.delete(key); // expired, clean up
        return false;
    }
    return true;
}

// [Phase 2 S6-B3] ── Per-user decisionId dedup ──────────────────────────────
// Stable per-user key in at_state. Cross-user same decisionId is ALWAYS
// allowed because the key includes uid.
function _decisionDedupKey(userId) {
    return 'serverAT:lastDecisionId:' + userId;
}

// _checkAndStoreDecisionId(userId, decisionId, source, nowMs)
//   Returns { ok: true } when accepted (stored).
//   Returns { ok: false, reason: 'DUPLICATE_DECISION_ID', previous } when
//     the same decisionId for the same user appeared within DECISION_DEDUP_TTL_MS.
//   Returns { ok: false, reason: 'NO_USER_ID' } when userId is missing —
//     fail-safe: the caller must always pass a real uid.
//   Returns { ok: true, reason: 'NO_DECISION_ID' } when no decisionId is
//     supplied — backward compatible with paths that have not yet adopted
//     the dedup key. Documented in S6-B3 report.
//
// Persistence is best-effort: a malformed at_state row, a missing row, or
// a write failure must NEVER throw or block the runtime path. The dedup
// is an additive safety layer, not a critical gate.
function _checkAndStoreDecisionId(userId, decisionId, source, nowMs) {
    if (userId === undefined || userId === null || userId === '') {
        return { ok: false, reason: 'NO_USER_ID' };
    }
    if (decisionId === undefined || decisionId === null || decisionId === '') {
        return { ok: true, reason: 'NO_DECISION_ID' };
    }
    const _id = String(decisionId);
    const _now = Number.isFinite(nowMs) ? nowMs : Date.now();
    const _src = (typeof source === 'string' && source.length > 0) ? source : 'unknown';
    let prev = null;
    try { prev = db.atGetState(_decisionDedupKey(userId)); } catch (_) {}
    // Defensive: malformed prev → treat as no record.
    const _prevValid = prev && typeof prev === 'object' &&
        typeof prev.id === 'string' && Number.isFinite(prev.ts);
    if (_prevValid && prev.id === _id && (_now - prev.ts) < DECISION_DEDUP_TTL_MS) {
        return { ok: false, reason: 'DUPLICATE_DECISION_ID', previous: prev };
    }
    // Store new record (best-effort; never throw).
    try {
        db.atSetState(_decisionDedupKey(userId),
            { id: _id, ts: _now, source: _src }, userId);
    } catch (_) {}
    return { ok: true };
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

// Terminal states — position is done, exchange side cleaned up. Safe to hide from client panels
// (still persisted in _positions briefly until zombie-cleanup runs). Matches the implicit demo-parity
// rule: demo closed positions are spliced from _positions immediately, so getDemoPositions never
// sees them; for live we can't always splice immediately (reconciliation windows, FILL_UNVERIFIED),
// so we filter by status instead.
const _LIVE_TERMINAL_STATUSES = new Set([
    'CLOSED', 'EMERGENCY_CLOSED', 'ERROR', 'LOCK_BLOCKED',
]);

function getLivePositions(userId) {
    // [Phase 5B] Demo-parity filter — include every live position for the user EXCEPT terminal-state
    // zombies. Previous filter (LIVE/LIVE_NO_SL/_livePending) hid AT positions in the exchange-roundtrip
    // window, so client _lastServerPositions cache didn't see them and liveApi classified them as
    // MANUAL (default sourceMode='paper'). Demo had no such window because demo is synchronous.
    //
    // Including FILL_UNVERIFIED and undefined-status positions keeps the client cache hydrated with
    // ownership truth even before exchange confirmation. Re-pulls eventually correct stale cases.
    const allLiveForUser = _positions.filter(p => p.userId === userId && p.mode === 'live');
    const visible = allLiveForUser.filter(p => !(p.live && _LIVE_TERMINAL_STATUSES.has(p.live.status)));
    // [P5A SERVER LIVE OWNERSHIP] Post-fix tracepoint — logs only when the demo-parity filter still
    // hides something (terminal zombies). If this fires with autoTrade=true for a non-terminal state,
    // the fix missed a case and the filter needs widening.
    if (allLiveForUser.length !== visible.length) {
        const hidden = allLiveForUser.filter(p => (p.live && _LIVE_TERMINAL_STATUSES.has(p.live.status)))
            .map(p => `seq=${p.seq}/${p.symbol}/${p.side}/autoTrade=${p.autoTrade}/live=${p.live.status}`);
        logger.info('P5A', `[P5A SERVER LIVE OWNERSHIP] getLivePositions uid=${userId} visible=${visible.length}/${allLiveForUser.length} hidden-terminal=[${hidden.join(' | ')}] ts=${Date.now()}`);
    }
    // [R1] Same ownership normalization as getOpenPositions — split-array
    // readers (client's state.ts _applyServerATState split path) otherwise
    // saw raw rows with undefined autoTrade/sourceMode/controlMode.
    return visible.map(_normalizePositionRow);
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
    // [R1] Same ownership normalization as getOpenPositions — split-array
    // readers (client's state.ts _applyServerATState split path) otherwise
    // saw raw rows with undefined autoTrade/sourceMode/controlMode.
    return _positions
        .filter(p => p.userId === userId && p.mode !== 'live')
        .map(_normalizePositionRow);
}

// [Phase 2B] Canonical server-side execution env resolver.
// Single source of truth — never assumes REAL when truth is uncertain.
//   demo               → { env: 'DEMO',    blockedReason: null }
//   non-demo + valid creds (testnet)  → { env: 'TESTNET', blockedReason: null }
//   non-demo + valid creds (live)     → { env: 'REAL',    blockedReason: null }
//   non-demo + no row                 → { env: null, blockedReason: 'NO_ACTIVE_API_CREDENTIALS' }
//   non-demo + row exists but invalid → { env: null, blockedReason: 'INVALID_ACTIVE_API_CONFIGURATION' }
// [S8.1 hard real-block 2026-05-28] Defense-in-depth predicate: is a REAL-money
// execution forbidden under the current _SRV_POS_REAL_ENABLED flag? FAIL-CLOSED —
// real is permitted ONLY when the flag is STRICTLY true; any other value (false,
// undefined, null, truthy-but-not-true) BLOCKS. Non-REAL envs are never blocked here.
// Pure function — same predicate used by layer 1 (_resolveExecutionEnv) and
// layer 2 (_executeLiveEntry) so a single bypass cannot reach a real exchange.
function _realBlocked(env, realEnabledFlag) {
    return env === 'REAL' && realEnabledFlag !== true;
}

function _resolveExecutionEnv(userId) {
    const us = _uState(userId);
    if (us.engineMode === 'demo') {
        return { env: 'DEMO', blockedReason: null };
    }
    const creds = getExchangeCreds(userId);
    if (creds) {
        // creds.mode is strictly 'testnet' or 'live' (enforced by credentialStore hotfix).
        const _resolved = creds.mode === 'testnet' ? 'TESTNET' : 'REAL';
        // [S8.1 hard real-block — LAYER 1] Refuse REAL unless _SRV_POS_REAL_ENABLED
        // is strictly true. env=null + stable reason blocks the entry upstream
        // (build path stamps null; brain facade sees null → no dispatch).
        if (_realBlocked(_resolved, MF._SRV_POS_REAL_ENABLED)) {
            return { env: null, blockedReason: 'REAL_EXECUTION_DISABLED' };
        }
        return { env: _resolved, blockedReason: null };
    }
    // No valid creds. Distinguish "no row" vs "row present but invalid".
    let reason = 'NO_ACTIVE_API_CREDENTIALS';
    try {
        const account = db.getExchangeAccount(userId);
        if (account) reason = 'INVALID_ACTIVE_API_CONFIGURATION';
    } catch (_) { /* db read failure → keep NO_ACTIVE_API_CREDENTIALS (safe default) */ }
    return { env: null, blockedReason: reason };
}

/** [SP2-9] Pure ownership resolver for sync payload (observability J). */
function _computeUserOwnership(ctx) {
    return require('./ownership').resolveOwnership(Object.assign({ underTakeControl: false }, ctx));
}

// [SP2-b 2026-06-07] TRUE when the server FULLY owns entries for this user —
// opens even with the client present, the client AT engine is told to lock
// (serverActive), and /api/order/place rejects client auto-opens. Pure matrix
// in ownership.computeFullOwnership (tested); this is the I/O glue. Testnet
// ONLY — creds.mode must be exactly 'testnet'; REAL stays blocked.
function serverFullyOwnsEntries(userId) {
    try {
        const us = _uState(userId);
        const creds = getExchangeCreds(userId);
        return require('./ownership').computeFullOwnership({
            flagFull: MF.SERVER_AT_FULL_OWNERSHIP === true,
            flagExec: MF.SERVER_AT_TESTNET_EXEC === true,
            // [T1-3 2026-06-08] REAL ownership gated on the master REAL flag —
            // when REAL is deliberately enabled, the server fully owns entries on
            // REAL too (single engine, no hybrid two-engine race). Inert today
            // (_SRV_POS_REAL_ENABLED=false, no real creds).
            flagRealEnabled: MF._SRV_POS_REAL_ENABLED === true,
            isCutover: require('./sp2Cutover').isCutoverUser(userId),
            engineMode: us.engineMode,
            credsMode: creds ? creds.mode : null,
        });
    } catch (_) {
        return false; // fail-closed: uncertain → hybrid behavior (no client lockout)
    }
}

/** Full state snapshot for API/WebSocket consumers (per-user) */
function getFullState(userId) {
    // [M2] Lazy UTC day rollover — ensures kill switch reset propagates to clients
    // even when no entry is attempted after midnight. Client polls every 30s.
    _checkDailyReset(userId);
    const us = _uState(userId);
    const creds = getExchangeCreds(userId);
    const exchangeMode = creds ? (creds.mode || 'live') : null;
    // [Phase 2A] Canonical active exchange — additive field. null when no creds.
    const activeExchange = creds ? (creds.exchange || null) : null;
    // [Phase 2B] Canonical execution env (server truth) + stable blocked reason.
    const execEnv = _resolveExecutionEnv(userId);
    // [Phase 3D] resolvedEnv now aligns to canonical execEnv.env (null when blocked).
    // Legacy false-positive REAL derivation removed — no more fake truth on missing creds.
    const resolvedEnv = execEnv.env;
    // [LOCKOUT-FIX] Report whether server actually drives AT decisions (brain+AT flags).
    // Client uses this to decide if it should lock out its own AT engine.
    // [SP2-b 2026-06-07] ALSO true under full SP2 ownership: the SP2-a cutover
    // ran on the NEW flags (SERVER_AT_TESTNET_EXEC + cutover list) but this
    // line still read only the legacy pair — the client was told
    // serverActive:false and kept its own engine UNLOCKED, so TWO engines
    // commanded one account (root cause of the duplicate-entry/adoption races).
    const _sp2FullOwn = serverFullyOwnsEntries(userId);
    const serverDrivesAT = !!(MF && MF.SERVER_AT && MF.SERVER_BRAIN) || _sp2FullOwn;
    // [Phase 2 S6-B4] Demo-authority flags — true ONLY if the corresponding
    // demo carve-out flag is on AND this user is in demo mode. Live/testnet/
    // real users always receive false even when the demo flags are true.
    // Unknown / missing engineMode → false (fail-safe). Client mirrors these
    // as window read-model flags only; the actual AT-engine gate (S6-B5+)
    // will live behind these signals. With current production flags both
    // remain false for every user.
    const _isDemoUser = us.engineMode === 'demo';
    const serverATDemoEnabled = !!(MF && MF.SERVER_AT_DEMO) && _isDemoUser;
    const serverBrainDemoEnabled = !!(MF && MF.SERVER_BRAIN_DEMO) && _isDemoUser;
    return {
        mode: us.engineMode,
        // [BUG-T7 FOLLOWUP 2026-05-13] enabled + atActive computed DYNAMIC pe baza
        // engineMode + atActive[Demo|Live] flags. Defensive — chiar dacă in-memory
        // us.atActive ar fi stale, getFullState garantează UI primește valoarea
        // corectă pentru current engineMode (no stale flash on mode switch).
        enabled: _isATActiveForMode(us, us.engineMode), // [F1] LEGACY — computed dynamic
        atActive: _isATActiveForMode(us, us.engineMode), // [F1] LEGACY — computed dynamic
        atActiveDemo: us.atActiveDemo, // [BUG-T7 2026-05-13] per-mode flag pentru frontend
        atActiveLive: us.atActiveLive, // [BUG-T7 2026-05-13] per-mode flag pentru frontend
        serverActive: serverDrivesAT, // [LOCKOUT-FIX] True only when server runs brain+AT
        // [SP2-9] Ownership state for client "SERVER/YOU DRIVING / SAFETY NET ON" indicator (data-only).
        ownership: _computeUserOwnership({
            clientPresent: require('./heartbeatTracker').isClientPresent(userId, Date.now()),
            atActive: _isATActiveForMode(us, us.engineMode),
            credsValid: !!creds,
            cutoverActive: require('./sp2Cutover').isCutoverUser(userId) && (MF.SERVER_AT_TESTNET_EXEC === true || MF._SRV_POS_REAL_ENABLED === true), // [T1-3] env-aware (testnet OR real-enabled)
            fullServerOwnership: _sp2FullOwn, // [SP2-b] UI shows SERVER DRIVING with client present
        }),
        // [SERVER-ARES 2026-06-07] Server-side ARES public state for the client
        // panel (wallet/trajectory/decision). Only attached when the engine is
        // on — keeps legacy payloads byte-identical with the flag off.
        ...(MF.SERVER_ARES === true ? (() => {
            try { return { ares: require('./serverAres').getPublicState(userId) }; } catch (_) { return {}; }
        })() : {}),
        // [Phase 2 S6-B4] Demo-only authority signals — see derivation above.
        serverATDemoEnabled,
        serverBrainDemoEnabled,
        apiConfigured: !!creds,
        exchangeMode: exchangeMode,       // 'testnet' | 'live' | null
        resolvedEnv: resolvedEnv,          // [Phase 3D] 'DEMO' | 'TESTNET' | 'REAL' | null — aligned with executionEnv (canonical truth)
        activeExchange: activeExchange,    // [Phase 2A] 'binance' | 'bybit' | null
        executionEnv: execEnv.env,         // [Phase 2B] 'DEMO' | 'TESTNET' | 'REAL' | null  (canonical server truth)
        executionBlockedReason: execEnv.blockedReason, // [Phase 2B] 'NO_ACTIVE_API_CREDENTIALS' | 'INVALID_ACTIVE_API_CONFIGURATION' | null
        positions: getOpenPositions(userId),
        demoPositions: getDemoPositions(userId),
        livePositions: getLivePositions(userId),
        stats: getStats(userId),
        demoStats: getDemoStats(userId),
        liveStats: getLiveStats(userId),
        demoBalance: getDemoBalance(userId),
        killActive: us.killActive,
        killPct: us.killPct || 5,
        killActiveAt: us.killActiveAt || 0,
        killReason: us.killReason || null,
        killLoss: us.killLoss || 0,
        killLimit: us.killLimit || 0,
        killBalRef: us.killBalRef || 0,
        killModeAtTrigger: us.killModeAtTrigger || null,
        dailyPnL: us.dailyPnL || 0,
        dailyPnLDemo: us.dailyPnLDemo || 0,
        dailyPnLLive: us.dailyPnLLive || 0,
        pnlAtReset: us.pnlAtReset || 0,
        // [Task S8-P1-4 2026-05-28] Streak counters for client brain-gate parity.
        // Client mirrors these into w.BM.lossStreak when server owns AT so
        // PREDATOR/DEFENSE gates compute correctly without local _bmPostClose.
        lossStreak: us.lossStreak || 0,
        winStreak: us.winStreak || 0,
        dailyTrades: us.dailyTrades || 0,
        dailyEntries: us.dailyEntries || 0, // [T-MAXTRADES] entries opened today
        // [T-MAXTRADES] Real protection state for the client badge + DISABLE button.
        maxDayProtect: computeMaxDayProtectState({
            maxDay: (() => { try { return +require('./serverBrain').getSTC(userId).maxDay || 0; } catch (_) { return 0; } })(),
            dailyEntries: us.dailyEntries, maxDayProtectOffDay: us.maxDayProtectOffDay, currentUtcDay: _utcDay(),
        }),
        srvPosFlags: {
            master: !!(MF && MF.SERVER_AUTHORITATIVE_POSITIONS),
            testnet: !!(MF && MF._SRV_POS_TESTNET_ENABLED),
            real: !!(MF && MF._SRV_POS_REAL_ENABLED),
        },
        ts: Date.now(),
        exchange: us.exchange || 'binance',
        // [WS-1] Monotonic per-server-process frame sequence number. `ts` alone
        // can collide when two getFullState calls happen în same ms (warm-start
        // + onChange near-concurrent path) — clients have no way to order them.
        // `seq` increments on every getFullState invocation regardless of ts;
        // client-side ordering can use `seq` cu strict-greater-than fallback
        // when ts ties. Resets on PM2 reload (single-process bigint counter
        // would also work but plain Number is sufficient — at 1k frames/sec
        // sustained it takes 285+ years to hit Number.MAX_SAFE_INTEGER).
        seq: ++_wsFrameSeq,
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
// [M1.2 Cat A 2026-05-14] _buildEntryFromOrderPlace
// Pure transform: /api/order/place reqBody → canonical entry object.
//
// Consumed by `_executeLiveEntryCore` (Cat B, extracted din _executeLiveEntry)
// + post-M1.2 refactored `registerManualPosition` (delegates to core).
//
// Hard safety assertion (ADR-001 §3.2): mode='live' + sl=null → throws
// SafetyAssertionError pre-fill, before any state mutation. Demo allows null
// (no exchange safety burden per ADR-001 §3.1).
//
// Pure function — no I/O, no side effects. Easy to test (Cat A 10 tests).
//
// Refs: ADR-001 §3.2 + §3.3; TEST_SCAFFOLDING_M1 §3.
// ══════════════════════════════════════════════════════════════════
function _buildEntryFromOrderPlace(reqBody, userId) {
    if (!reqBody || typeof reqBody !== 'object') {
        throw new Error('_buildEntryFromOrderPlace: missing required fields (reqBody must be object)');
    }
    if (!reqBody.symbol || !reqBody.side || reqBody.quantity == null || reqBody.entryPrice == null) {
        throw new Error('_buildEntryFromOrderPlace: missing required fields (symbol, side, quantity, entryPrice required)');
    }
    const qty = parseFloat(reqBody.quantity);
    if (!Number.isFinite(qty) || qty <= 0) {
        throw new Error('_buildEntryFromOrderPlace: invalid quantity (must be positive number, got ' + reqBody.quantity + ')');
    }
    const mode = reqBody.mode || 'demo';
    const sl = (reqBody.sl != null) ? parseFloat(reqBody.sl) : null;

    // [ADR-001 §3.2] Hard safety assertion — live entry MUST have SL pre-fill.
    // Demo allowed null (no exchange safety burden). This gate fires BEFORE
    // any state mutation, before _placeConditionalOrder is even imaginable.
    if (mode === 'live' && (sl == null || sl === 0)) {
        const err = new Error('SafetyAssertionError: Live entry requires sl (mode=live, sl=null rejected per ADR-001 §3.2)');
        err.name = 'SafetyAssertionError';
        err.code = 'LIVE_ENTRY_SL_REQUIRED';
        throw err;
    }

    const side = reqBody.side === 'BUY' ? 'LONG' : (reqBody.side === 'SELL' ? 'SHORT' : reqBody.side);
    const lev = (reqBody.leverage !== undefined && reqBody.leverage !== null)
        ? (parseInt(reqBody.leverage, 10) || 1)
        : 1;
    const tp = (reqBody.tp != null) ? parseFloat(reqBody.tp) : null;
    const source = reqBody.source || 'manual';
    const autoTrade = source === 'auto';
    const entryPrice = parseFloat(reqBody.entryPrice);
    const size = (lev > 0) ? (qty * entryPrice / lev) : (qty * entryPrice);

    return {
        userId: userId,
        symbol: reqBody.symbol,
        side: side,
        mode: mode,
        entryPrice: entryPrice,
        qty: qty,
        lev: lev,
        sl: sl,
        tp: tp,
        size: size,
        autoTrade: autoTrade,
        // dslParams: undefined → defaults null (DSL OFF); explicit null preserved; object preserved
        dslParams: (reqBody.dslParams !== undefined) ? reqBody.dslParams : null,
        // clientReqId pentru idempotency (replays din client transient network fail)
        clientReqId: reqBody.clientReqId || null,
        // [GLOBAL-SEQ 2026-06-18] Pure function (_buildEntryFromOrderPlace) — no `us` in scope,
        // so issue directly from the global allocator (still globally-unique, never-reused).
        seq: seqAllocator.next(),
        ts: Date.now(),
    };
}

// ══════════════════════════════════════════════════════════════════
// [M1.2 Cat B 2026-05-14] _executeLiveEntryCore
// Core safety machinery — atomic entry + SL/TP placement + emergency close.
// Extracted din _executeLiveEntry pattern per ADR-001 §3.3 migration architecture.
//
// Designed pentru BOTH paths post-M1:
//   - Brain dispatch (processBrainDecision → _executeLiveEntry → core)
//   - Client-side AT (registerManualPosition post-M1 refactor → core)
//
// Signature: `_executeLiveEntryCore(entry, stc, creds) → entry (cu .live populated)`
//
// Safety contract (ADR-001 §3.2):
//   1. Pre-fill hard assertion: mode=live + sl=null → throw SafetyAssertionError
//   2. Demo bypass: mode=demo returns early fără exchange calls
//   3. Global halt check: aborts dacă isGlobalHaltActive() true
//   4. Lock guard: rejects concurrent on same userId:symbol cu LOCK_BLOCKED
//   5. Atomic SL placement: safety SL @ 15% OTM → real SL retry 3x → emergency close fallback
//   6. TP placement (only if !entry.dslParams): retry 3x → emergency close on exhaustion
//   7. Status invariants: LIVE | EMERGENCY_CLOSED | LIVE_NO_SL | DEMO | GLOBAL_HALT | LOCK_BLOCKED
//
// Refs: ADR-001 §3.2 + §3.3; TEST_SCAFFOLDING_M1 §4.
// ══════════════════════════════════════════════════════════════════

// [Bug A fix 2026-05-29] Normalize exchange-side ('BUY'/'SELL') → position side
// ('LONG'/'SHORT'). _executeLiveEntryCore's closeSide + 15%-OTM safety-SL branch
// key off `=== 'LONG'`; a stray 'BUY' made a LONG take the SHORT branch → safety SL
// ABOVE entry → "Order would immediately trigger" → SL fails → naked position.
function _normalizePositionSide(side) {
    const s = String(side || '').toUpperCase();
    if (s === 'BUY') return 'LONG';
    if (s === 'SELL') return 'SHORT';
    return s; // 'LONG'/'SHORT' pass through; anything else surfaces to caller validation
}

// [Fix #2 safety net 2026-05-29] Correct-side protective stop from markPrice. LONG → below,
// SHORT → above. Returns null on invalid mark. Used by recon to guarantee NO live position
// is ever naked (mirrors recoveryBoot Task-E auto-SL). DSL takes over this native SL on activation.
function _computeProtectiveStop(side, markPrice, adversePct) {
    const m = Number(markPrice);
    if (!Number.isFinite(m) || m <= 0) return null;
    const pct = Number.isFinite(adversePct) ? adversePct : 0.02;
    return _normalizePositionSide(side) === 'LONG' ? m * (1 - pct) : m * (1 + pct);
}

// [SP2 policy L] Protective stop for an adopted/external position. Current-price-
// relative (markPrice ∓2%), entryPrice fallback. Reuses _computeProtectiveStop.
// Returns 0 when no usable price (caller's _isSLBreached/disaster guards refuse to
// close on 0 → no false close). Makes the server net protect adopted positions even
// if the best-effort EXCHANGE stop placement fails (flaky on testnet).
function _adoptedProtectiveStop(side, markPrice, entryPrice) {
    const ref = Number(markPrice) > 0 ? Number(markPrice) : Number(entryPrice);
    if (!(ref > 0)) return 0;
    const stop = _computeProtectiveStop(side, ref, 0.02);
    return Number(stop) > 0 ? Number(stop) : 0; // _computeProtectiveStop can't be null/0 given ref>0; guard kept for safety
}

async function _executeLiveEntryCore(entryInput, stc, creds) {
    if (!entryInput || typeof entryInput !== 'object') {
        const err = new Error('_executeLiveEntryCore: entry object required');
        err.name = 'SafetyAssertionError';
        throw err;
    }
    if (!entryInput.symbol) {
        throw new Error('_executeLiveEntryCore: entry.symbol missing');
    }

    // [ADR-001 §3.2] Hard safety assertion — live entry MUST have SL pre-fill.
    if (entryInput.mode === 'live' && (entryInput.sl == null || entryInput.sl === 0)) {
        const err = new Error('SafetyAssertionError: Live entry requires sl (mode=live, sl=null rejected per ADR-001 §3.2)');
        err.name = 'SafetyAssertionError';
        err.code = 'LIVE_ENTRY_SL_REQUIRED';
        throw err;
    }

    // [REAL-GATE 2026-06-06] Fail-closed REAL block at the CORE level. The
    // manual/unified route (order/place → registerManualPosition → here)
    // bypasses both _liveExecAllowed (by design — manual path) and the
    // _executeLiveEntry Layer-1/Layer-2 gates, so with REAL creds a manual
    // live order would have reached the REAL exchange while
    // _SRV_POS_REAL_ENABLED=false — contradicting the standing directive
    // (REAL impossible until the formal flip). creds.mode is strictly
    // 'testnet'|'live' (credentialStore); anything not explicitly testnet is
    // treated as REAL and requires the flag strictly true.
    // Demo entries are exchange-free inside core (no signed calls) — gate
    // applies only to mode=live, where creds actually reach an exchange.
    // Testnet is signalled by creds.mode==='testnet' (credentialStore strict)
    // or the legacy creds.isTestnet===true shape; anything else = REAL.
    const _coreIsTestnet = !!creds && (creds.mode === 'testnet' || creds.isTestnet === true);
    if (entryInput.mode === 'live' && !_coreIsTestnet && MF._SRV_POS_REAL_ENABLED !== true) {
        const err = new Error('SafetyAssertionError: REAL_EXECUTION_DISABLED — core refuses non-testnet creds while _SRV_POS_REAL_ENABLED is not true');
        err.name = 'SafetyAssertionError';
        err.code = 'REAL_EXECUTION_DISABLED';
        throw err;
    }

    // [M1.2 Cat B] Operate on shallow clone — prevents shared-reference last-write-wins
    // bug când caller passes same entry pe concurrent invocations (idempotency LOCK_BLOCKED
    // test scenario). entryInput preserved as read-only contract; result is fresh.
    const entry = { ...entryInput };

    // Demo bypass — no exchange interaction (per ADR-001 §3.1)
    if (entry.mode === 'demo') {
        entry.live = { status: 'DEMO', slOrderId: null, tpOrderId: null, slPlaced: false, tpPlaced: false };
        return entry;
    }

    // Global halt pre-execution gate (Phase 2 S2.B parity)
    if (isGlobalHaltActive()) {
        entry.live = { status: 'GLOBAL_HALT', slOrderId: null, tpOrderId: null };
        return entry;
    }

    // Lock guard pentru concurrent same-userId+symbol prevenire
    const _lockKey = entry.userId + ':' + entry.symbol;
    if (_liveEntryLocks.has(_lockKey)) {
        entry.live = { status: 'LOCK_BLOCKED', slOrderId: null, tpOrderId: null };
        return entry;
    }
    _liveEntryLocks.add(_lockKey);

    try {
        // [Task 40.5] Replaced direct sendSignedRequest calls (marginType, leverage,
        // MARKET entry, safety SL, SL retry 3x, emergency close, TP retry, TP emergency
        // close) with single exchangeOps.placeEntry router call. Routes to Binance or
        // Bybit per per-user config. binanceOps.placeEntry handles all of the above
        // atomically including positionStateMachine transitions + positionEvents.
        //
        // [OPTION B — dual DB write transitional]: exchangeOps.placeEntry inserts
        // PENDING row into at_positions; caller (registerManualPosition) continues to
        // push entry into _positions in-memory + call _persistState separately.
        // entry.live.opsSeq links binanceOps at_positions row to in-memory tracking.
        // [TODO: deprecate in-memory + _persistState INSERT in Bybit Phase 2]

        const coreQty = String(entry.qty);
        const coreSlPrice = (entry.sl && entry.sl > 0) ? String(entry.sl) : null;
        const coreTpPrice = (!entry.dslParams && entry.tp && entry.tp > 0) ? String(entry.tp) : null;
        // Core uses entry.decisionId if present; fall back to userId+symbol+seq uniquifier
        const _coreTok = (entry.decisionId && /^[0-9a-f]{8}$/.test(entry.decisionId))
            ? entry.decisionId
            : require('crypto').randomBytes(4).toString('hex');
        const coreDecisionKey = `SAT_${entry.seq || 0}_${_coreTok}`.slice(0, 36);

        let coreResult;
        try {
            coreResult = await exchangeOps.placeEntry(entry.userId, {
                symbol: entry.symbol,
                side: entry.side,           // LONG/SHORT — exchangeOps accepts this
                qty: coreQty,
                entryType: 'MARKET',
                sl: coreSlPrice ? { price: coreSlPrice } : null,
                tp: coreTpPrice ? { price: coreTpPrice } : null,
                leverage: entry.lev || 1,
                decisionKey: coreDecisionKey,
                source: 'serverAT-core',
            });
        } catch (coreErr) {
            coreResult = { ok: false, error: { message: coreErr.message, code: coreErr.code || 'ErrUnknown' } };
        }

        if (!coreResult || !coreResult.ok) {
            const coreErrMsg = (coreResult && coreResult.error && coreResult.error.message) || 'placeEntry failed';
            if (coreResult && coreResult.catastrophic) {
                // CATASTROPHIC — binanceOps armed halt + persisted emergency_close_queue
                try {
                    telegram.sendToUser(entry.userId, `🚨🚨 *EMERGENCY CLOSE FAILED*\n${entry.side} ${entry.symbol}\nPosition CATASTROPHIC — halt armed.\n*IMMEDIATE MANUAL INTERVENTION REQUIRED!*`);
                } catch (_) {}
                entry.live = { status: 'LIVE_NO_SL', slOrderId: null, tpOrderId: null, slPlaced: false, tpPlaced: false };
            } else {
                entry.live = { status: 'ENTRY_FAILED', slOrderId: null, tpOrderId: null, error: coreErrMsg };
            }
            return entry;
        }

        // [Task 40.5 result adapter] Map exchangeOps result → entry.live.*
        const fillPrice = parseFloat(coreResult.avgFillPrice || entry.entryPrice || 0);
        const slPlaced = !!coreResult.slOrderId;
        const tpPlaced = !!coreResult.tpOrderId;

        // 8. Success — populate entry.live cu final state
        entry.live = {
            status: slPlaced ? 'LIVE' : 'LIVE_NO_SL',
            slOrderId: coreResult.slOrderId || null,
            tpOrderId: coreResult.tpOrderId || null,
            slPlaced,
            tpPlaced,
            avgPrice: fillPrice,
            mainOrderId: coreResult.orderId,
            // [Task 40 dual-write bridge] opsSeq links to binanceOps at_positions row
            opsSeq: coreResult.seq || null,
        };

        if (!slPlaced) {
            // binanceOps exhausted SL retries — alert operator
            try {
                telegram.sendToUser(entry.userId, `🚨🚨 *EMERGENCY CLOSE FAILED*\n${entry.side} ${entry.symbol} @ $${fillPrice.toFixed(2)}\nPosition is UNPROTECTED by optimal SL.\nSafety mechanisms exhausted inside exchange router.\n*IMMEDIATE MANUAL INTERVENTION REQUIRED!*`);
            } catch (_) {}
        }

        return entry;
    } finally {
        _liveEntryLocks.delete(_lockKey);
    }
}

// ══════════════════════════════════════════════════════════════════
// [BUG-T2c FIX 2026-05-14] _placeProtectionForExistingEntry
//
// Path B safety net for /api/order/place (trading.js manual + client AT entries).
// Trading.js places main MARKET order on Binance, then calls THIS helper with
// the filled order data; helper places SL (HARD) + TP (conditional on !dslParams)
// per DSL rule. Returns {slOrderId, tpOrderId, status} for caller to pass into
// registerManualPosition so live.slOrderId / live.tpOrderId reflect real
// exchange orderIds (not null).
//
// DSL rule (serverAT.js:1537-1541):
//   DSL ON  → no native TP (DSL trail SL handles exit via PL hit).
//   DSL OFF → place native TP from RISK MANAGEMENT.
//
// Failure semantics — mirrors _executeLiveEntry / _executeLiveEntryCore:
//   • Safety SL 15% OTM placed first (covers retry window)
//   • Real SL retries 3x (1s, 3s backoff)
//   • All SL retries fail → EMERGENCY MARKET close (return status='EMERGENCY_CLOSED')
//   • TP (DSL OFF only) retries 3x; all-fail → EMERGENCY MARKET close
//   • TP emergency close failed → status='LIVE_NO_TP' (rare; alerted via Telegram)
//   • Returns { slOrderId, tpOrderId, status, emergencyClosed?, emergencyPrice?, emergencyPnl? }
//
// status values: 'LIVE' | 'LIVE_NO_SL' | 'EMERGENCY_CLOSED' | 'LIVE_NO_TP'
//
// Refs: BUG-T2c, OPEN_BUGS_PRIORITY_RANKING, M1 closure handbook.
// ══════════════════════════════════════════════════════════════════
async function _placeProtectionForExistingEntry(entry, creds) {
    if (!entry || typeof entry !== 'object') throw new Error('Missing entry');
    if (!creds) throw new Error('Missing exchange creds');
    if (!entry.symbol || !entry.side) throw new Error('Missing entry.symbol/side');
    if (!entry.sl || !(entry.sl > 0)) throw new Error('Missing entry.sl (live entry requires SL)');
    if (!(entry.avgPrice > 0)) throw new Error('Missing entry.avgPrice');
    if (!(entry.executedQty > 0)) throw new Error('Missing entry.executedQty');

    // [Bug A fix 2026-05-29] Normalize once so EVERY downstream `=== 'LONG'` check
    // (closeSide, safety SL side, real SL, TP) computes the correct direction even
    // if a caller passed exchange-side convention ('BUY'/'SELL'). Native SL placed on
    // the correct side is what DSL later takes over on activation.
    entry.side = _normalizePositionSide(entry.side);

    const userId = entry.userId;
    const liveSeq = entry.seq || Date.now();
    const closeSide = entry.side === 'LONG' ? 'SELL' : 'BUY';
    const avgPrice = entry.avgPrice;
    const executedQty = entry.executedQty;
    const fillQty = String(roundOrderParams(entry.symbol, executedQty).quantity || executedQty);
    const rounded = roundOrderParams(entry.symbol, executedQty, entry.sl);
    const roundedTp = entry.tp ? roundOrderParams(entry.symbol, executedQty, entry.tp) : null;

    // Safety SL — far-OTM 15% backstop covering retry window
    let safetySlOrder = null;
    try {
        const safetyRaw = entry.side === 'LONG' ? avgPrice * 0.85 : avgPrice * 1.15;
        const safetyRounded = roundOrderParams(entry.symbol, executedQty, safetyRaw);
        const safetyStopPrice = String(safetyRounded.stopPrice != null ? safetyRounded.stopPrice : safetyRaw.toFixed(2));
        safetySlOrder = await _placeConditionalOrder({
            symbol: entry.symbol, side: closeSide, type: 'STOP_MARKET',
            quantity: fillQty, stopPrice: safetyStopPrice,
            reduceOnly: true, newClientOrderId: `PB_SLSAFE_${liveSeq}`,
        }, creds);
        logger.info('AT_LIVE_PB', `[${liveSeq}] Safety SL placed @ $${safetyStopPrice} (15% OTM)`);
    } catch (safeErr) {
        logger.warn('AT_LIVE_PB', `[${liveSeq}] Safety SL placement failed: ${safeErr.message}`);
        try { Sentry.captureException(safeErr, { level: 'warning', tags: { module: 'AT', action: 'pb_safety_sl_failed', symbol: entry.symbol } }); } catch (_) {}
    }

    // Real SL with retry 3x
    let slOrder = null;
    const SL_RETRY_DELAYS = [1000, 3000];
    for (let attempt = 0; attempt <= SL_RETRY_DELAYS.length; attempt++) {
        try {
            slOrder = await _placeConditionalOrder({
                symbol: entry.symbol, side: closeSide, type: 'STOP_MARKET',
                quantity: fillQty,
                stopPrice: String(rounded.stopPrice != null ? rounded.stopPrice : entry.sl),
                reduceOnly: true, newClientOrderId: `PB_SL_${liveSeq}_${attempt}`,
            }, creds);
            if (attempt > 0) logger.info('AT_LIVE_PB', `[${liveSeq}] SL succeeded on retry #${attempt}`);
            break;
        } catch (slErr) {
            logger.error('AT_LIVE_PB', `[${liveSeq}] SL attempt ${attempt + 1}/${SL_RETRY_DELAYS.length + 1} failed: ${slErr.message}`);
            if (attempt < SL_RETRY_DELAYS.length) {
                try { telegram.sendToUser(userId, `⚠️ SL retry ${attempt + 1}/${SL_RETRY_DELAYS.length + 1} failed for ${entry.symbol} ${entry.side} — retrying in ${SL_RETRY_DELAYS[attempt] / 1000}s...`); } catch (_) {}
                await new Promise(r => setTimeout(r, SL_RETRY_DELAYS[attempt]));
            }
        }
    }

    // Cancel safety SL if real SL placed
    if (slOrder && safetySlOrder && safetySlOrder.orderId) {
        await _cancelOrderSafe(entry.symbol, safetySlOrder.orderId, creds, userId);
        safetySlOrder = null;
    }

    // SL retries exhausted → EMERGENCY MARKET CLOSE
    if (!slOrder) {
        logger.error('AT_LIVE_PB', `[${liveSeq}] ALL SL retries exhausted — EMERGENCY MARKET CLOSE`);
        try { Sentry.captureMessage(`PB EMERGENCY CLOSE: SL failed ${entry.symbol} ${entry.side}`, { level: 'fatal', tags: { module: 'AT', action: 'pb_emergency_close_sl', symbol: entry.symbol } }); } catch (_) {}
        try { telegram.sendToUser(userId, `🚨 *EMERGENCY CLOSE (Path B)*\n${entry.side} ${entry.symbol} @ $${avgPrice.toFixed(2)}\nAll ${SL_RETRY_DELAYS.length + 1} SL attempts failed.\nEmergency market-closing.`); } catch (_) {}
        try {
            const emgResult = await sendSignedRequest('POST', '/fapi/v1/order', {
                symbol: entry.symbol, side: closeSide, type: 'MARKET',
                quantity: fillQty, reduceOnly: true,
                newClientOrderId: `PB_EMGCLOSE_${liveSeq}`,
            }, creds);
            const _emgRaw = parseFloat(emgResult.avgPrice);
            const emgPrice = (Number.isFinite(_emgRaw) && _emgRaw > 0) ? _emgRaw : avgPrice;
            const lev = entry.leverage || 1;
            const size = entry.size || (avgPrice * executedQty / lev);
            const emgPnl = avgPrice > 0 ? (entry.side === 'LONG'
                ? +((emgPrice - avgPrice) / avgPrice * size * lev).toFixed(2)
                : +((avgPrice - emgPrice) / avgPrice * size * lev).toFixed(2)) : 0;
            try { telegram.sendToUser(userId, `✅ Emergency close EXECUTED for ${entry.symbol} ${entry.side} @ $${emgPrice.toFixed(2)} — PnL: $${emgPnl.toFixed(2)}`); } catch (_) {}
            try { audit.record('PB_EMERGENCY_CLOSE', { userId, seq: liveSeq, symbol: entry.symbol, side: entry.side, emgPrice, emgPnl, reason: 'SL_ALL_RETRIES_FAILED' }, 'PATH_B'); } catch (_) {}
            if (safetySlOrder && safetySlOrder.orderId) {
                await _cancelOrderSafe(entry.symbol, safetySlOrder.orderId, creds, userId);
            }
            return { slOrderId: null, tpOrderId: null, status: 'EMERGENCY_CLOSED', emergencyClosed: true, emergencyPrice: emgPrice, emergencyPnl: emgPnl, reason: 'SL_ALL_RETRIES_FAILED' };
        } catch (emgErr) {
            logger.error('AT_LIVE_PB', `[${liveSeq}] EMERGENCY CLOSE FAILED: ${emgErr.message}`);
            try { Sentry.captureException(emgErr, { level: 'fatal', tags: { module: 'AT', action: 'pb_emergency_close_failed', symbol: entry.symbol } }); } catch (_) {}
            const safetyMsg = safetySlOrder ? `\nSafety SL (15% OTM) still active.` : '';
            try { telegram.sendToUser(userId, `🚨🚨 *EMERGENCY CLOSE FAILED (Path B)*\n${entry.side} ${entry.symbol} @ $${avgPrice.toFixed(2)}\nUNPROTECTED on Binance.${safetyMsg}\n*MANUAL INTERVENTION REQUIRED!*\nError: ${emgErr.message}`); } catch (_) {}
            return { slOrderId: safetySlOrder ? safetySlOrder.orderId : null, tpOrderId: null, status: 'LIVE_NO_SL', reason: 'SL_RETRIES_AND_EMERGENCY_FAILED' };
        }
    }

    // TP placement — DOAR dacă DSL OFF (regulă: DSL ON = trail SL handles exit)
    let tpOrder = null;
    const TP_RETRY_DELAYS = [1000, 3000];
    if (!entry.dslParams && entry.tp && entry.tp > 0 && roundedTp) {
        for (let tpAttempt = 0; tpAttempt <= TP_RETRY_DELAYS.length; tpAttempt++) {
            try {
                tpOrder = await _placeConditionalOrder({
                    symbol: entry.symbol, side: closeSide, type: 'TAKE_PROFIT_MARKET',
                    quantity: fillQty,
                    stopPrice: String(roundedTp.stopPrice != null ? roundedTp.stopPrice : entry.tp),
                    reduceOnly: true, newClientOrderId: `PB_TP_${liveSeq}_${tpAttempt}`,
                }, creds);
                if (tpAttempt > 0) logger.info('AT_LIVE_PB', `[${liveSeq}] TP succeeded on retry #${tpAttempt}`);
                break;
            } catch (tpErr) {
                logger.error('AT_LIVE_PB', `[${liveSeq}] TP attempt ${tpAttempt + 1}/${TP_RETRY_DELAYS.length + 1} failed: ${tpErr.message}`);
                if (tpAttempt < TP_RETRY_DELAYS.length) {
                    try { telegram.sendToUser(userId, `⚠️ TP retry ${tpAttempt + 1}/${TP_RETRY_DELAYS.length + 1} failed for ${entry.symbol} ${entry.side} — retrying in ${TP_RETRY_DELAYS[tpAttempt] / 1000}s...`); } catch (_) {}
                    await new Promise(r => setTimeout(r, TP_RETRY_DELAYS[tpAttempt]));
                }
            }
        }

        // TP retries exhausted (DSL OFF only) → EMERGENCY MARKET CLOSE
        if (!tpOrder) {
            logger.error('AT_LIVE_PB', `[${liveSeq}] ALL TP retries exhausted (DSL OFF) — EMERGENCY MARKET CLOSE`);
            try { Sentry.captureMessage(`PB EMERGENCY CLOSE: TP failed ${entry.symbol} ${entry.side}`, { level: 'fatal', tags: { module: 'AT', action: 'pb_emergency_close_tp', symbol: entry.symbol } }); } catch (_) {}
            try { telegram.sendToUser(userId, `🚨 *TP EMERGENCY CLOSE (Path B)*\n${entry.side} ${entry.symbol} @ $${avgPrice.toFixed(2)}\nAll TP attempts failed (DSL OFF requires TP).\nEmergency closing.`); } catch (_) {}
            // [Fix #2 2026-05-20] Anti-race: emergency close FIRST, SL cancel
            // ONLY on success. Pre-fix: SL was cancelled before emergency
            // attempt, so if emergency failed, position was unprotected (no SL,
            // no TP, no close). Now if emergency throws, SL stays active as
            // last line of defense — much safer than removing protection
            // before confirming replacement.
            try {
                const tpEmgResult = await sendSignedRequest('POST', '/fapi/v1/order', {
                    symbol: entry.symbol, side: closeSide, type: 'MARKET',
                    quantity: fillQty, reduceOnly: true,
                    newClientOrderId: `PB_TPEMG_${liveSeq}`,
                }, creds);
                // Emergency close SUCCEEDED → position is closed → cancel SL
                // as hygiene (orphan order on Binance otherwise).
                if (slOrder && slOrder.orderId) await _cancelOrderSafe(entry.symbol, slOrder.orderId, creds, userId);
                const _tpEmgRaw = parseFloat(tpEmgResult.avgPrice);
                const tpEmgPrice = (Number.isFinite(_tpEmgRaw) && _tpEmgRaw > 0) ? _tpEmgRaw : avgPrice;
                const lev = entry.leverage || 1;
                const size = entry.size || (avgPrice * executedQty / lev);
                const tpEmgPnl = avgPrice > 0 ? (entry.side === 'LONG'
                    ? +((tpEmgPrice - avgPrice) / avgPrice * size * lev).toFixed(2)
                    : +((avgPrice - tpEmgPrice) / avgPrice * size * lev).toFixed(2)) : 0;
                try { telegram.sendToUser(userId, `✅ TP emergency close EXECUTED for ${entry.symbol} ${entry.side} @ $${tpEmgPrice.toFixed(2)} — PnL: $${tpEmgPnl.toFixed(2)}`); } catch (_) {}
                try { audit.record('PB_EMERGENCY_CLOSE', { userId, seq: liveSeq, symbol: entry.symbol, side: entry.side, emgPrice: tpEmgPrice, emgPnl: tpEmgPnl, reason: 'TP_ALL_RETRIES_FAILED' }, 'PATH_B'); } catch (_) {}
                return { slOrderId: null, tpOrderId: null, status: 'EMERGENCY_CLOSED', emergencyClosed: true, emergencyPrice: tpEmgPrice, emergencyPnl: tpEmgPnl, reason: 'TP_ALL_RETRIES_FAILED' };
            } catch (tpEmgErr) {
                logger.error('AT_LIVE_PB', `[${liveSeq}] TP EMERGENCY CLOSE FAILED: ${tpEmgErr.message}`);
                try { Sentry.captureException(tpEmgErr, { level: 'fatal', tags: { module: 'AT', action: 'pb_tp_emergency_failed', symbol: entry.symbol } }); } catch (_) {}
                // Emergency close failed — SL still active (not cancelled).
                // Telegram message accurate: SL is the last line of defense.
                try { telegram.sendToUser(userId, `🚨🚨 *TP EMERGENCY CLOSE FAILED (Path B)*\n${entry.side} ${entry.symbol}\nSL still active as last defense. NO TP.\n*PLACE MANUAL TP IMMEDIATELY!*\nError: ${tpEmgErr.message}`); } catch (_) {}
                return { slOrderId: slOrder.orderId, tpOrderId: null, status: 'LIVE_NO_TP', reason: 'TP_RETRIES_AND_EMERGENCY_FAILED' };
            }
        }
    }

    // Success — SL placed (+ TP if DSL OFF)
    try { audit.record('PB_SL_PLACED', { userId, seq: liveSeq, symbol: entry.symbol, side: entry.side, slOrderId: slOrder.orderId, tpOrderId: tpOrder ? tpOrder.orderId : null, dslOn: !!entry.dslParams }, 'PATH_B'); } catch (_) {}
    return {
        slOrderId: slOrder.orderId,
        tpOrderId: tpOrder ? tpOrder.orderId : null,
        status: 'LIVE',
    };
}

// ══════════════════════════════════════════════════════════════════
// [M1.2 Cat C 2026-05-14] registerManualPosition — async unified wrapper
//
// Per ADR-001 Decision 3.1: thin wrapper that flag-gated routes între:
//   - MF.LIVE_ENTRY_UNIFIED=true (default): unified path — validate via
//     _buildEntryFromOrderPlace (catches sl=null+live cu SafetyAssertionError),
//     delegate la _executeLiveEntryCore pentru atomic SL/TP placement,
//     merge live state into legacy return shape (ok, seq, live, position).
//   - MF.LIVE_ENTRY_UNIFIED=false: legacy Path B (silent sl=null accept,
//     no exchange SL — for emergency rollback only).
//
// Calls module.exports.X (not local X) pentru jest.spyOn interceptability —
// test scaffolding relies pe spy verification of _buildEntryFromOrderPlace
// and _executeLiveEntryCore invocations.
//
// Returns Promise<result> (async API). Callers must await.
// trading.js:330 caller updated cu await.
//
// Refs: ADR-001 §3.1 + §3.3; TEST_SCAFFOLDING_M1 §5; MILESTONES_M1-M8 §M1.2/M1.6.
// ══════════════════════════════════════════════════════════════════
async function registerManualPosition(userId, data) {
    if (!userId) return { ok: false, error: 'Missing userId' };
    if (!data || typeof data !== 'object') return { ok: false, error: 'Missing data object' };

    // Flag-gated routing: unified safe path (default) vs legacy rollback
    if (MF.LIVE_ENTRY_UNIFIED) {
        // Pre-fill validation via _buildEntryFromOrderPlace (calls cu module.exports.X
        // pentru jest.spyOn interceptability). Catches:
        // - Missing required fields (symbol, side, quantity, entryPrice)
        // - Invalid quantity (zero/negative)
        // - mode='live' + sl=null → SafetyAssertionError per ADR-001 §3.2
        const reqBody = {
            symbol: data.symbol,
            side: data.side, // Accepts both 'BUY'/'SELL' și 'LONG'/'SHORT'
            quantity: data.qty,
            leverage: data.leverage,
            sl: data.sl,
            tp: data.tp,
            mode: data.mode || 'demo',
            source: data.source,
            dslParams: data.dslParams,
            entryPrice: data.entryPrice,
            clientReqId: data.clientReqId,
        };
        // Translate LONG/SHORT to BUY/SELL pentru _buildEntryFromOrderPlace
        // (which expects exchange-side convention)
        if (reqBody.side === 'LONG') reqBody.side = 'BUY';
        else if (reqBody.side === 'SHORT') reqBody.side = 'SELL';

        let validated;
        try {
            validated = module.exports._buildEntryFromOrderPlace(reqBody, userId);
        } catch (e) {
            return { ok: false, error: e.message };
        }

        // For live mode, delegate la _executeLiveEntryCore pentru atomic SL/TP placement.
        // SKIP legacy _registerManualPositionLegacy entirely — unified path doesn't
        // need legacy _alignQtyToLotSize (core handles aligned qty); allocate seq
        // + push la _positions inline pentru clean unified flow.
        if (validated.mode === 'live') {
            try {
                // [Fix #3 2026-05-20] Resolve exchange credentials per-user
                // before invoking core. Pre-fix passed `null` → sendSignedRequest
                // calls inside core would fail with no auth → silent orphan
                // risk if any caller passes mode:'live'. M1.9 audit finding.
                let _creds = null;
                try {
                    _creds = getExchangeCreds(userId);
                } catch (credErr) {
                    return { ok: false, error: `Cannot resolve exchange creds for user ${userId}: ${credErr.message}` };
                }
                if (!_creds || !_creds.apiKey) {
                    return { ok: false, error: `No exchange credentials configured for user ${userId} (live entry blocked)` };
                }
                const coreResult = await module.exports._executeLiveEntryCore(validated, null, _creds);
                // Allocate seq + push to _positions (local state tracking)
                const us = _uState(userId);
                const seq = (us.seq = seqAllocator.next());
                coreResult.seq = seq;
                // [SYNC-2 2026-06-01] Thread the position's OWN exchange from the creds used,
                // so recon/close route correctly (else schema default 'binance' mislabels Bybit).
                coreResult.exchange = _resolveEntryExchange(coreResult, _creds);
                _positions.push(coreResult);
                _trackLiveOpen(coreResult); // [P5b]
                try { _persistState(userId); } catch (_) { /* defensive */ }
                return {
                    ok: true,
                    seq,
                    live: coreResult.live,
                    position: coreResult,
                };
            } catch (e) {
                return { ok: false, error: e.message };
            }
        }

        // Demo mode — _buildEntryFromOrderPlace called for validation
        // (test 4 verifies spy called for demo too); then route through legacy
        // pentru existing demo behavior (no exchange interaction).
        return _registerManualPositionLegacy(userId, data);
    }

    // Flag OFF (MF.LIVE_ENTRY_UNIFIED=false) — legacy Path B unchanged
    return _registerManualPositionLegacy(userId, data);
}

// ══════════════════════════════════════════════════════════════════
// Register manual LIVE/TESTNET position as server-tracked Zeus object
// Called after successful exchange fill for PT/manual orders
//
// [M1.2 Cat C 2026-05-14] Renamed la `_registerManualPositionLegacy` —
// preserved pentru flag-OFF rollback path + delegated-to under new async wrapper.
// ══════════════════════════════════════════════════════════════════
function _registerManualPositionLegacy(userId, data) {
    if (!userId) return { ok: false, error: 'Missing userId' };
    if (!data || !data.symbol || !data.side || !data.entryPrice || !data.qty) {
        return { ok: false, error: 'Missing required fields (symbol, side, entryPrice, qty)' };
    }
    const us = _uState(userId);
    const price = parseFloat(data.entryPrice);
    const qty = parseFloat(data.qty);
    const lev = parseInt(data.leverage, 10) || 1;
    const size = (lev > 0) ? (qty * price / lev) : (qty * price);
    const side = data.side === 'BUY' ? 'LONG' : (data.side === 'SELL' ? 'SHORT' : data.side);

    // [BUG-TM-8] Align qty + size to LOT_SIZE before storage. Defense-in-depth: caller (live) typically pre-rounds via trading.js, but enforce server-side.
    const _tm8reg = _alignQtyToLotSize(data.symbol, qty, price, lev, 'MANUAL_REGISTER');
    if (!_tm8reg) {
        return { ok: false, error: 'LOT_SIZE_ALIGN_REJECTED', detail: `qty=${qty} price=${price} lev=${lev} symbol=${data.symbol}` };
    }
    const _regAlignedQty = _tm8reg.qty;
    const _regAlignedSize = _tm8reg.size;

    // [Phase 9D1] Idempotency: if the client retries registration with the
    // same clientReqId (e.g. transient network fail), fold onto the existing
    // position instead of double-registering. Scoped per-user.
    if (data.clientReqId) {
        const prior = _positions.find(p => p.userId === userId && p._clientReqId === data.clientReqId);
        if (prior) {
            logger.info('AT_ENGINE', `[${prior.seq}] idempotent register hit clientReqId=${data.clientReqId} — returning existing seq`);
            return { ok: true, seq: prior.seq, alreadyTracked: true };
        }
    }

    // Duplicate guard: only for LIVE (exchange merges same-side positions into one).
    // DEMO allows multiple independent manual positions on same (symbol, side) —
    // each gets its own seq, DSL state, and lifecycle. Dedup would collapse them
    // on the client via _mapServerPos and cause positions to disappear.
    const mode = data.mode || us.engineMode;
    // [S2.C C2] Global PANIC halt — block NEW live exposure via manual registration.
    // DEMO path intentionally unaffected (no real risk).
    if (mode === 'live' && isGlobalHaltActive()) {
        logger.warn('AT_ENGINE', `registerManualPosition blocked uid=${userId} sym=${data.symbol} side=${side} — GLOBAL_HALT active`);
        return { ok: false, error: 'GLOBAL_HALT active — new live exposure blocked' };
    }
    if (mode === 'live') {
        const existing = _positions.find(p => p.userId === userId && p.symbol === data.symbol && p.side === side && p.mode === 'live');
        if (existing) {
            // [AT-ATTR 2026-06-07] The USERDATA stream's external-position
            // adoption can WIN the race with this registration (live proof:
            // seq 1776859653267, adopted source='external' at 13:04:22.088,
            // this branch hit at .095). The position then stayed unattributed
            // forever — client-AT entries filed under MANUAL in every panel
            // ("months-old" operator complaint). Merge the registration's
            // attribution onto the adopted row instead of dropping it.
            if (existing.source === 'external' || existing.autoTrade == null) {
                const _src = data.source || 'manual';
                existing.autoTrade = _src === 'auto';
                existing.sourceMode = _src === 'auto' ? 'auto' : 'manual';
                existing.controlMode = _src === 'auto' ? 'auto' : 'user';
                existing.source = _src;
                if (Number.isFinite(+data.leverage) && +data.leverage > 0) existing.lev = +data.leverage;
                try { _persistPosition(existing); } catch (_) { /* best-effort */ }
                try { _broadcastPositions(userId); } catch (_) { /* best-effort */ }
                logger.info('AT_ENGINE', `[${existing.seq}] LIVE position already tracked (adoption race) — attribution merged: source=${_src} autoTrade=${existing.autoTrade}`);
                audit.record('AT_ATTRIBUTION_MERGED', { userId, seq: existing.seq, symbol: data.symbol, source: _src }, 'SERVER_AT');
            } else {
                logger.info('AT_ENGINE', `[${existing.seq}] LIVE manual position already tracked — skipping`);
            }
            return { ok: true, seq: existing.seq, alreadyTracked: true };
        }
    }

    const seq = (us.seq = seqAllocator.next());

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
    // [Phase 10 classification] Honor explicit source marker from /order/place.
    // Without this, ANY MARKET fill was stamped manual even when client AT
    // fired it, so AT positions leaked into the Manual panel on the client.
    const _srcAuto = (data.source === 'auto');
    // [Phase 12.A — Batch G] Stamp exchange + env at open (same rationale as the
    // AT-engine entry path). Honest null when demo or when creds missing.
    const _manualExecEnv = _resolveExecutionEnv(userId);
    const _manualCreds = _manualExecEnv.env === 'DEMO' ? null : getExchangeCreds(userId);
    const entry = {
        seq,
        userId,
        ts: Date.now(),
        symbol: data.symbol,
        side,
        mode: data.mode || us.engineMode,
        exchange: _manualCreds ? (_manualCreds.exchange || null) : null,
        env: _manualExecEnv.env,     // 'DEMO' | 'TESTNET' | 'REAL' | null
        price,
        size: _regAlignedSize,        // [BUG-TM-8] LOT_SIZE-adjusted
        margin: _regAlignedSize,      // [BUG-TM-8] LOT_SIZE-adjusted
        lev,
        qty: _regAlignedQty,          // [BUG-TM-8] LOT_SIZE-aligned
        sl, tp, slPct, rr, tpPnl, slPnl,
        status: 'OPEN',
        closeTs: null, closePnl: null, closeReason: null,
        // Ownership metadata — derived from explicit source marker.
        autoTrade: _srcAuto,
        sourceMode: _srcAuto ? 'auto' : 'manual',
        controlMode: _srcAuto ? 'auto' : 'user',
        // [Phase 9D1] Stamp idempotency token so a retry with the same token
        // folds onto this entry instead of creating a duplicate.
        _clientReqId: data.clientReqId || null,
        // DSL params: null = engine OFF (no DSL), object = user-provided, undefined = use defaults
        dslParams: _dslOff ? null : ((data.dslParams && typeof data.dslParams === 'object') ? data.dslParams : serverDSL.DSL_DEFAULTS),
        originalEntry: price,
        originalSize: _regAlignedSize,   // [BUG-TM-8]
        originalQty: _regAlignedQty,     // [BUG-TM-8]
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
    _trackLiveOpen(entry); // [P5b]
    if (!_dslOff) {
        serverDSL.attach(entry, entry.dslParams);
    } else {
        logger.info('AT_ENGINE', `[${seq}] uid=${userId} ${_srcAuto ? 'AUTO' : 'MANUAL'} registered with DSL OFF — no DSL attach`);
    }
    _persistState(userId);
    _persistPosition(entry);
    _notifyChange(userId);

    logger.info('AT_ENGINE', `[${seq}] uid=${userId} ${_srcAuto ? 'AUTO' : 'MANUAL'} ${side} ${data.symbol} @ $${price.toFixed(2)} | Size=$${size.toFixed(0)} Lev=${lev}x | Registered as server-tracked`);

    return { ok: true, seq, position: entry };
}

// ══════════════════════════════════════════════════════════════════
// [M1.2 Cat C 2026-05-14] _syncExternalPosition
// Register externally-discovered Binance position (recon found poziție pe care
// Zeus NU a deschis-o — e.g., operator a deschis manual pe Binance UI direct).
//
// Distinct from registerManualPosition:
//   - source='external' marker pentru audit trail
//   - NO SL placement (position is PRE-EXISTING pe exchange — Zeus didn't open it,
//     so Zeus shouldn't presume SL responsibility)
//   - Returns warning string în result pentru caller logging visibility
//   - Logs WARN level audit trail despre external position lacking exchange SL
//
// Critical pentru BUG-T2c — distinguish "external sync needed" de "orphan
// detected". Pre-M1: recon flagged ALL un-tracked positions ca PHANTOM, including
// fresh externals (false-positive root cause).
//
// Refs: ADR-001 §3.1 + §3.3; TEST_SCAFFOLDING_M1 §5; BUG-T2c root cause.
// ══════════════════════════════════════════════════════════════════
// [SP2-7b] Pure builder for the EXTERNAL (adopted) position entry object. Extracted
// from _syncExternalPosition so the entry shape is unit-testable in isolation.
//
// CRITICAL money-path invariants the entry MUST satisfy so the server net can both
// protect AND actually close this adopted position on the exchange:
//   - `price` alias of `entry` — the PnL math reads pos.price, not pos.entry.
//   - `lev:1` + `size = qty*entry` (notional) — makes size*lev = qty*entry, so the
//     PnL formula (exit-entry)/entry * size * lev = (exit-entry)*qty (correct, finite).
//     External positions have unknown margin/lev split, but PnL depends only on
//     qty×priceMove, so this is exact, not an approximation.
//   - `live.executedQty` set — _handleLiveExit's reduce-only MARKET close is sized off
//     executedQty; without it the close is skipped and the position stays phantom.
function _buildExternalEntry(data, seq, adoptedSL) {
    const _entryPrice = parseFloat(data.entryPrice);
    const _qty = parseFloat(data.qty);
    return {
        seq,
        userId: data.userId,
        symbol: data.symbol,
        side: data.side,
        entry: _entryPrice,
        // [SP2-7b] price alias — the PnL math (and many guards) read pos.price.
        price: _entryPrice,
        qty: _qty,
        // [SP2-7b] notional size + lev=1 so size*lev = qty*entry → PnL = (exit-entry)*qty (finite).
        size: _qty * _entryPrice,
        lev: 1,
        sl: adoptedSL,
        originalSL: adoptedSL,
        slPct: 2, // 2 = 2% (matches _disasterStopPrice slPct/100 convention)
        mode: 'live',
        source: 'external',
        // [ENG-3 2026-06-01] Thread the exchange the external position was found on (recon
        // knows it via per-exchange grouping) so recon/close route correctly — else the
        // at_positions schema default 'binance' would mislabel a Bybit external position.
        exchange: data.exchange || null,
        // [SP2-7b] EXTERNAL status + executedQty so the server net's reduce-only MARKET
        // close (_handleLiveExit) actually reaches the exchange. No resting SL/TP orders
        // exist for an adopted position (slOrderId/tpOrderId null) — the close path treats
        // null order ids as safe no-ops.
        live: { status: 'EXTERNAL', executedQty: _qty, slOrderId: null, tpOrderId: null, slPlaced: false, tpPlaced: false },
        // [PHANTOM ROOT FIX 2026-06-05] Adopted positions had NO status field →
        // the amt=0 close path (requires status==='OPEN') could never close
        // them and existing-lookups never saw them → stuck phantoms (187/189
        // sat OPEN 7+ hours). OPEN puts them in the normal lifecycle.
        status: 'OPEN',
        ts: Date.now(),
        externalSync: true,
    };
}

function _syncExternalPosition(data) {
    if (!data || typeof data !== 'object') {
        return { ok: false, error: 'Missing data object' };
    }
    if (!data.userId || !data.symbol || !data.side || !data.entryPrice || !data.qty) {
        return { ok: false, error: 'Missing required fields (userId, symbol, side, entryPrice, qty)' };
    }
    const userId = data.userId;
    // [DUAL-WRITE DUP FIX 2026-06-15] Refuse to adopt a same-side duplicate. If
    // serverAT already holds an OPEN non-demo position for this (user, symbol,
    // side), the exchange position recon "found" IS that same physical position
    // (one-way account). Adopting it again spawned the orphan the operator saw in
    // the Manual panel (source=external, lev=1) and double-counted the PnL when
    // both rows closed against one exchange close (e.g. BNBUSDT SHORT: -100.76 +
    // -100.10 for one trade). Skip BEFORE allocating a seq / pushing / persisting.
    const _dup = _findSameSideOpenDup(_positions, { userId, symbol: data.symbol, side: data.side, mode: 'live' });
    if (_dup) {
        logger.warn('AT_RECON', `External adopt SKIPPED uid=${userId} sym=${data.symbol} side=${data.side} qty=${data.qty} — already tracking OPEN seq=${_dup.seq} same side (one-way account: would duplicate + double-count PnL + show in Manual)`);
        try { audit.record('SAT_EXTERNAL_ADOPT_SKIPPED_DUP', { userId, symbol: data.symbol, side: data.side, qty: data.qty, existingSeq: _dup.seq, existingSource: _dup.source || null }, 'SERVER_AT'); } catch (_) {}
        return { ok: false, skipped: true, reason: 'duplicate_same_side_open', existingSeq: _dup.seq };
    }
    const us = _uState(userId);
    const seq = (us.seq = seqAllocator.next());
    // [SP2 policy L] Attach a SERVER-side protective SL (markPrice ∓2%, entryPrice
    // fallback) so the server net (onPriceUpdate) + disaster backstop (reads
    // originalSL) protect this adopted position even if the recon caller's best-effort
    // EXCHANGE stop placement fails (flaky on testnet). 0 → caller guards refuse to
    // close (no false close). No exchange order is placed here.
    const _adoptedSL = _adoptedProtectiveStop(data.side, data.markPrice, data.entryPrice);
    const entry = _buildExternalEntry(data, seq, _adoptedSL);
    _positions.push(entry);
    _trackLiveOpen(entry); // [P5b]
    try { _persistState(userId); } catch (_) {}
    // [ADOPT-PERSIST FIX 2026-06-08] Persist the adopted orphan to at_positions
    // so it survives a restart (mirrors registerManualPosition / brain entry).
    // Without this the adopted row was in-memory only → lost on reload → the
    // position re-orphaned (recon re-adopted ~2min later, churning every restart).
    try { _persistPosition(entry); } catch (e) { logger.warn('AT_RECON', `External adopt persist failed seq=${seq}: ${e.message}`); }
    logger.warn('AT_RECON', `External position synced uid=${userId} sym=${data.symbol} side=${data.side} qty=${data.qty} — no exchange SL placed here (pre-existing pe exchange, source=external); protective server SL @ ${_adoptedSL}`);
    return {
        ok: true,
        seq,
        warning: `External position registered without exchange SL placement (pre-existing position, source=external); protective server SL @ ${_adoptedSL}`,
    };
}

// [batch3-W] Patch a registered position's entry price + qty after an async
// Binance fill materializes (registerManualPosition is called on status=NEW
// with a fallback reference price — this updates the real fill data).
function patchPositionFill(userId, seq, patch) {
    if (!userId || !seq || !patch) return { ok: false, error: 'Missing args' };
    const pos = _positions.find(p => p.userId === userId && p.seq === seq && p.status === 'OPEN');
    if (!pos) return { ok: false, error: 'Position not found' };
    const newPrice = parseFloat(patch.entryPrice);
    const newQty = parseFloat(patch.qty);
    if (!(newPrice > 0) || !(newQty > 0)) return { ok: false, error: 'Invalid patch values' };
    const newSize = (pos.lev > 0) ? (newQty * newPrice / pos.lev) : (newQty * newPrice);
    pos.price = newPrice;
    pos.qty = +newQty.toFixed(6);
    pos.size = newSize;
    pos.margin = newSize;
    pos.originalEntry = newPrice;
    pos.originalSize = newSize;
    pos.originalQty = +newQty.toFixed(6);
    if (pos.sl) {
        const slDist = Math.abs(newPrice - pos.sl);
        pos.slPct = newPrice > 0 && slDist > 0 ? +(slDist / newPrice * 100).toFixed(2) : 0;
        pos.slPnl = +(-slDist / newPrice * newSize * pos.lev).toFixed(2);
    }
    if (pos.tp) {
        const tpDist = Math.abs(newPrice - pos.tp);
        pos.tpPnl = +(tpDist / newPrice * newSize * pos.lev).toFixed(2);
        if (pos.sl) {
            const slDist = Math.abs(newPrice - pos.sl);
            pos.rr = slDist > 0 ? +(tpDist / slDist).toFixed(2) : 0;
        }
    }
    if (pos.live) {
        pos.live.avgPrice = newPrice;
        pos.live.executedQty = newQty;
    }
    _persistPosition(pos);
    _notifyChange(userId);
    return { ok: true, seq, position: pos };
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
        // [TM-4] Apply round-trip fee deduction (manual client close).
        const _grossPnl = pos.side === 'LONG'
            ? +((exitPrice - pos.price) / pos.price * pos.size * pos.lev).toFixed(2)
            : +((pos.price - exitPrice) / pos.price * pos.size * pos.lev).toFixed(2);
        const pnl = _applyRoundTripFee(_grossPnl, pos.size, pos.lev);
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
    // [BUG-T7 2026-05-13] Block add-ons when AT is OFF for current mode —
    // no exposure growth while disabled. Per-mode aware (M1 add-on path).
    const us = _uState(userId);
    if (!_isATActiveForMode(us, us.engineMode)) return { ok: false, error: `Cannot add on: AT is OFF for mode=${us.engineMode}` };

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

        // ── Addon size: prefer client-provided amount (modal input), else default to 50% of original ──
        // [Phase 10.7] Client AddOnModal sends user-chosen amount via options.addOnSize.
        // Fallback to legacy 50%-of-original when omitted (keeps backward compat with
        // any non-modal callers).
        const origSize = pos.originalSize || pos.size;
        let addOnSize;
        if (Number.isFinite(Number(options.addOnSize)) && Number(options.addOnSize) > 0) {
            addOnSize = Math.round(Number(options.addOnSize));
        } else {
            addOnSize = Math.round(origSize * 0.5);
        }
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
            const creds = _credsForPosition(userId, pos);
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
            // [2026-06-07 B7] 36-char clientOrderId limit: raw ms made this 39
            // chars → every add-on entry would be rejected. base36 ms = 34.
            const addonClientId = `SAT_ADDON_${liveSeq}_${pos.addOnCount + 1}_${Date.now().toString(36)}`;

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
        // [BUG-TM-8] DEMO addon: align computed qty to LOT_SIZE for parity with live + future SERVER_AT.
        // If alignment fails (cache miss), block addon (consistent with main entry policy — no silent fallback).
        const _tm8addon = _alignQtyToLotSize(pos.symbol, (newTotalSize * pos.lev) / pos.price, pos.price, pos.lev, 'DEMO_ADDON');
        if (!_tm8addon) {
            logger.warn('AT_ADDON', `[${seq}] DEMO addon LOT_SIZE align rejected — symbol=${pos.symbol} newTotalSize=${newTotalSize}`);
            return { ok: false, error: 'LOT_SIZE_ALIGN_REJECTED', detail: 'DEMO addon qty cannot be aligned to LOT_SIZE' };
        }
        pos.qty = _tm8addon.qty;
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
const RECON_INTERVAL_MS = 60000; // 60s (reduced to 300s when userDataStream active)
let _reconIdleCycles = 0; // [ORPHAN ROOT FIX] counts cycles with no internal live positions (idle sweep every 2nd)
// [F2 2026-06-06] Orphan-protection sweep cadence — TIME-based and independent
// of the idle/busy recon state. The previous gate (`_idleSweepUserExchanges &&
// _reconIdleCycles % 10 === 0`) required ZERO open positions, so with any
// position open the sweep NEVER ran (proven 06-06: BNB open since 12:38 → the
// 15:31 BTC orphan SL sat unmanaged for 2h blocking all BTC entries).
// skipSymbols (held-position guard) makes the sweep safe in busy mode too.
const ORPHAN_SWEEP_INTERVAL_MS = 10 * 60 * 1000;
let _lastOrphanSweepTs = 0;
function _shouldRunOrphanSweep(now) {
    if (now - _lastOrphanSweepTs < ORPHAN_SWEEP_INTERVAL_MS) return false;
    _lastOrphanSweepTs = now;
    return true;
}
const RECON_INTERVAL_STREAM_MS = 300000; // 5 min safety net when WS provides real-time
let _reconTimer = null;
let _reconRunning = false;
let _phantomCandidates = null;
// [AUDIT] Per-user recon alert deduplication — prevents Telegram spam for recurring issues
// [batch2-M1] Maps with 24h TTL, not Sets — previously alerts for the same key were
// suppressed forever, so a repeating SL failure on an unprotected position went silent
// after the first alert. TTL lets genuinely persistent failures re-page after 24h.
const _RECON_ALERT_TTL_MS = 24 * 60 * 60 * 1000;
const _reconAlerted = {
    orphans: new Map(),    // "userId:symbol:side" → last alert ts
    slFails: new Map(),    // "userId:seq" → last alert ts
    tpFails: new Map(),    // "userId:seq" → last alert ts
};
function _reconAlertedShouldFire(cat, key) {
    const map = _reconAlerted[cat];
    if (!map) return true;
    const now = Date.now();
    const last = map.get(key) || 0;
    if (now - last < _RECON_ALERT_TTL_MS) return false;
    map.set(key, now);
    if (map.size > 500) {
        for (const [k, ts] of map) if (now - ts >= _RECON_ALERT_TTL_MS) map.delete(k);
    }
    return true;
}
// [V5.4] Orphan pending map — tracks first detection for 2-cycle confirmation
const _orphanPending = new Map(); // "userId:symbol:side" → { firstSeen, bpos, userId, symbol }
// [ROOT FIX 2026-06-18] Consecutive empty-held-poll streak per "userId:exchange". An
// empty positionRisk snapshot while tracking live positions is skipped (stale/failed
// poll guard); this counts consecutive skips so a PERSISTENT empty condition (e.g.
// revoked creds, long endpoint outage) escalates to a visible P1 alert instead of
// silently skipping reconciliation forever.
const _emptyHeldStreak = new Map();
const _EMPTY_HELD_ALERT_AFTER = 5; // ~5 recon cycles (~5 min) of sustained empty before alert

async function _runReconciliation(isStartup) {
    if (_reconRunning) return;
    _reconRunning = true;
    const label = isStartup ? 'STARTUP_RECON' : 'RECON';
    try {
        // [batch2-L1] Evict stale _orphanPending entries: if first-detection is
        // older than 3 recon cycles without a confirming re-detection, the orphan
        // disappeared (user closed it manually on Binance), so drop the entry.
        const _pendingStale = Date.now() - 3 * RECON_INTERVAL_MS;
        for (const [k, v] of _orphanPending) {
            if (v.firstSeen < _pendingStale) _orphanPending.delete(k);
        }
        // [ORPHAN ROOT FIX review C1] EXTERNAL included: an adopted position is
        // the ONLY internal record of its exchange leg — excluding it (a) let the
        // idle sweep flag its own backing as orphan every 120s (alert spam) and
        // (b) denied it the phantom-check (exchange gone → close local record).
        const livePositions = _positions.filter(_isReconcilablePosition);
        // [ORPHAN ROOT FIX 2026-06-05] The old `if (livePositions.length === 0)
        // return;` meant the ORPHAN sweep (exchange has a position, server
        // doesn't) NEVER ran in exactly the state an orphan creates — internal
        // record closed, exchange leg alive (ETH orphan bled 6h today: detected
        // at 17:29 while another position kept recon alive, then recon went
        // dormant the moment the last internal position closed). With no
        // internal live positions, still run an exchange-truth sweep every 2nd
        // cycle (120s — under the 180s _orphanPending staleness eviction, so
        // the 2-cycle orphan confirmation still completes) for every user with
        // active exchange credentials. Cost: one positionRisk (w5) per
        // user-exchange per 120s — negligible.
        let _idleSweepUserExchanges = null;
        if (livePositions.length === 0) {
            _reconIdleCycles++;
            if (_reconIdleCycles % 2 !== 0) return; // every 2nd idle cycle
            try {
                // [2026-06-07 B2] db.db — see B1 note at _enqueueEmergencyClose.
                // Bare db.prepare crashed EVERY idle sweep cycle all night.
                const accounts = db.db.prepare(
                    `SELECT DISTINCT user_id, exchange FROM exchange_accounts WHERE is_active = 1`
                ).all();
                if (!accounts || accounts.length === 0) return;
                _idleSweepUserExchanges = accounts.map(a => ({ userId: a.user_id, exchange: a.exchange || 'binance', positions: [] }));
            } catch (e) {
                logger.warn(label, `idle orphan sweep account query failed: ${e.message}`);
                return;
            }
        } else {
            _reconIdleCycles = 0;
        }

        // [P2c.1b] Group live positions by (userId, exchange) so each exchange's
        // positions reconcile against THEIR OWN exchange (creds + held + trades via
        // exchangeOps exchangeOverride → getExchangeCredsFor). Pre-P2c this grouped by
        // user and queried only the ACTIVE exchange (Binance-hardcoded positionRisk),
        // which after a switch would skip a non-active position — or, worse,
        // false-phantom-close a live one absent from the active exchange's held map.
        const byUser = new Map();
        for (const p of livePositions) {
            // [MULTI-USER] Skip positions without userId instead of defaulting to 1
            if (!p.userId) { logger.warn(label, `Skipping live position seq=${p.seq} without userId`); continue; }
            if (!byUser.has(p.userId)) byUser.set(p.userId, []);
            byUser.get(p.userId).push(p);
        }
        const byUserExchange = [];
        for (const [uid, ulp] of byUser) {
            for (const [exchange, exPositions] of groupPositionsByExchange(ulp)) {
                byUserExchange.push({ userId: uid, exchange, positions: exPositions });
            }
        }
        // [ORPHAN ROOT FIX] Idle sweep — no internal live positions, but scan
        // exchange truth anyway so orphans are detected and auto-closed.
        if (_idleSweepUserExchanges) byUserExchange.push(..._idleSweepUserExchanges);

        // [F2 2026-06-06] Decide ONCE per recon pass whether the periodic
        // orphan-protection sweep fires this cycle (the helper consumes the
        // interval); applied to every user-exchange group below, idle OR busy.
        const _doOrphanSweep = _shouldRunOrphanSweep(Date.now());

        for (const { userId, exchange, positions: userLivePositions } of byUserExchange) {
            const creds = getExchangeCredsFor(userId, exchange);
            if (!creds) continue;

            // [RECON-SUBSCRIBE 2026-05-14] Auto-subscribe market feed for symbols
            // cu poziții deschise dar fără feed activ. Pre-fix: AT could open
            // positions on symbols outside boot subscription set (BTC/ETH/SOL/BNB)
            // — ZECUSDT exemplu real 2026-05-14 — feed nu trăgea preț live → DSL
            // trailing SL miscalculated + close button silent fail (partial mitigation
            // în BUG-CLOSE-AT via fallback chain; THIS hook restores live price flow).
            try {
                const activeSyms = marketFeed.getActiveSymbols();
                const seenInThisCycle = new Set();
                for (const _p of userLivePositions) {
                    if (!_p.symbol || seenInThisCycle.has(_p.symbol)) continue;
                    seenInThisCycle.add(_p.symbol);
                    if (!activeSyms.has(_p.symbol)) {
                        // [Phase B 2026-05-19] ref-counted subscribe — released
                        // when position closes (see _closePosition in Task 5).
                        // Sticky boot symbols (BTC/ETH/SOL/BNB) keep their own
                        // boot|system ref regardless of position lifecycle.
                        const refKey = `${userId}|${_p.env || 'TESTNET'}|${_p.seq}`;
                        marketFeed.subscribeForRef(_p.symbol, refKey).then(added => {
                            if (added && !activeSyms.has(_p.symbol)) {
                                logger.info(label, `Auto-subscribed ${_p.symbol} uid=${userId} seq=${_p.seq} refKey=${refKey}`);
                            }
                        }).catch(subErr => {
                            logger.warn(label, `Auto-subscribe failed for ${_p.symbol}: ${subErr.message}`);
                        });
                    }
                }
            } catch (subErr) {
                logger.warn(label, `Auto-subscribe block failed: ${subErr.message}`);
            }

            // 1. [P2c.1b] Query held positions for THIS exchange via exchangeOps
            // (normalized output, routed to the exchange's own creds). On failure,
            // skip ONLY this exchange — other exchanges' positions still reconcile.
            let held;
            try {
                held = await exchangeOps.getPositions(userId, { exchangeOverride: exchange });
            } catch (err) {
                logger.warn(label, `positionRisk query failed uid=${userId} exchange=${exchange}: ${err.message}`);
                continue;
            }

            // [BUG-T2a 2026-05-13] Hedge-aware Binance held map — keyed by
            // `symbol_side` tuple pentru a păstra LONG + SHORT same symbol
            // independente în HEDGE mode. Pre-T2a: keyed by symbol only,
            // collapsed both → recon detection lookup mismatch on side.
            // [P2c.1b] Generic held-map from normalized getPositions (binance+bybit).
            // Var name kept `binanceHeld` to minimize churn in the body below.
            const binanceHeld = buildHeldMap(held);

            // [ROOT FIX 2026-06-18] Guard against a stale/empty positionRisk snapshot.
            // /fapi/v2/positionRisk can return a 200-OK EMPTY array even while positions
            // are genuinely open (Binance eventual-consistency / stale read, worse under
            // degraded datacenter connectivity). Trusting an empty held-map here falsely
            // phantom-closes every live position → which then re-adopt as external/lev1
            // "Manual x1" orphans (the recurring bug). An empty snapshot WHILE we track
            // live positions is almost always a bad poll, not a real mass-close (real
            // closes arrive via userDataStream). Skip ALL destructive recon for this
            // user-exchange this cycle; the next good poll reconciles correctly.
            const _ehKey = `${userId}:${exchange}`;
            if (isUntrustedEmptyHeld(binanceHeld.size, userLivePositions.length)) {
                const _ehStreak = (_emptyHeldStreak.get(_ehKey) || 0) + 1;
                _emptyHeldStreak.set(_ehKey, _ehStreak);
                logger.warn(label, `[RECON] SKIP uid=${userId}/${exchange} — positionRisk returned EMPTY while tracking ${userLivePositions.length} live position(s); treating as stale/failed poll (not mass-close) [streak ${_ehStreak}]`);
                try { audit.record('SAT_RECON_EMPTY_HELD_SKIP', { userId, exchange, tracked: userLivePositions.length, streak: _ehStreak }, 'SERVER_AT'); } catch (_) {}
                // Escalate ONCE when the empty condition persists abnormally — surfaces a
                // long-term degraded poll (revoked creds / endpoint outage) instead of
                // silently skipping recon. Does NOT change the skip (positions stay
                // protected by the price-feed disaster-SL net regardless).
                if (_ehStreak === _EMPTY_HELD_ALERT_AFTER) {
                    try {
                        _emitDoctor({ eventType: 'alert', severity: 'P1', moduleId: 'serverAT.recon.emptyHeld', ts: Date.now(),
                            payload: { userId, exchange, tracked: userLivePositions.length, consecutiveSkips: _ehStreak } });
                    } catch (_) {}
                    try { telegram.sendToUser(userId, `⚠️ *RECON: exchange poll empty ${_ehStreak}× in a row*\n${exchange} positionRisk keeps returning EMPTY while ${userLivePositions.length} position(s) tracked.\nReconciliation paused (positions still protected by server SL). Check API keys / Binance connectivity.`); } catch (_) {}
                }
                continue;
            }
            _emptyHeldStreak.delete(_ehKey); // good (non-empty) poll → reset streak

            // [D 2026-06-06 / F2] Periodic orphan-protection sweep (~10 min,
            // time-based — runs in idle AND busy recon): client-AT/manual closes
            // can leave AT_/resl_ SL/TP algo orders resting on flat symbols
            // (orderSweeper previously ran at BOOT only). Held symbols are
            // skipped — never strip a live position's protection.
            if (_doOrphanSweep) {
                try {
                    const _heldSyms = new Set([...binanceHeld.values()].map(b => b.symbol));
                    const _swept = await require('./orderSweeper').sweep(userId, exchange, { skipSymbols: _heldSyms });
                    if (_swept.cancelled.length > 0) {
                        logger.warn(label, `idle order sweep uid=${userId}/${exchange}: cancelled ${_swept.cancelled.length} orphan protection order(s)`);
                        audit.record('SAT_IDLE_ORDER_SWEEP', { userId, exchange, cancelled: _swept.cancelled.length }, 'SERVER_AT');
                    }
                } catch (sweepErr) {
                    logger.warn(label, `idle order sweep failed uid=${userId}: ${sweepErr.message}`);
                }
            }

            // [Bug#3 STEP 3] Multi-seq collision reconciliation — if multiple OPEN
            // server seqs claim the same (symbol, side), Binance (ONE-WAY mode) holds
            // only ONE merged position. Without this pass, the per-seq check below
            // sees bpos matching for all seqs, leaves them all OPEN; the extra seqs
            // become phantoms that re-appear in Manual after the primary seq closes
            // (exact symptom of Bug#3). Consolidate: keep earliest seq, close the
            // rest with reason='RECON_PHANTOM_MERGED_DUP' at entry price, pnl=0.
            const _bySymSide = new Map();
            for (const _p of userLivePositions) {
                const _k = _p.symbol + '_' + _p.side;
                if (!_bySymSide.has(_k)) _bySymSide.set(_k, []);
                _bySymSide.get(_k).push(_p);
            }
            const _keepSeqs = new Set();
            // [Phase 8C3] Minimum age before a position can be closed as a
            // PHANTOM-MERGED-DUP. Registration races can briefly produce two
            // server seqs for the same (symbol, side) within ms; closing one
            // before the other has settled risks killing the wrong record.
            // Skip dup-close this cycle if ANY position in the group is
            // younger than this threshold — wait for the next recon tick.
            const _DUP_MIN_AGE_MS = 10000;
            for (const [, group] of _bySymSide) {
                if (group.length === 1) { _keepSeqs.add(group[0].seq); continue; }
                group.sort((a, b) => a.seq - b.seq);
                const _now = Date.now();
                const _tooFresh = group.some((pp) => {
                    const _ts = Number(pp.openTs || pp.ts || 0);
                    return _ts > 0 && (_now - _ts) < _DUP_MIN_AGE_MS;
                });
                if (_tooFresh) {
                    // Defer: keep ALL seqs in the group this cycle. They re-enter the
                    // per-seq phantom check below, which handles legitimate phantoms
                    // on its own timeline. Without this guard a just-registered seq
                    // could be clobbered before the exchange fill confirms.
                    for (const pp of group) _keepSeqs.add(pp.seq);
                    logger.info(label, `[RECON] PHANTOM-MERGED-DUP deferred uid=${userId} ${group[0].symbol}/${group[0].side} (${group.length} seqs, youngest < ${_DUP_MIN_AGE_MS}ms)`);
                    continue;
                }
                _keepSeqs.add(group[0].seq);
                for (let j = 1; j < group.length; j++) {
                    const dup = group[j];
                    const dupIdx = _positions.findIndex(pp => pp.seq === dup.seq && pp.userId === userId);
                    if (dupIdx < 0) continue;
                    const _gk = `${userId}:${dup.seq}`;
                    if (_closingGuard.has(_gk)) continue;
                    _closingGuard.set(_gk, Date.now());
                    try {
                        logger.warn(label, `[${dup.seq}] PHANTOM-MERGED-DUP uid=${userId}: ${dup.side} ${dup.symbol} (keeping seq=${group[0].seq})`);
                        _closePosition(dupIdx, dup, 'RECON_PHANTOM_MERGED_DUP', dup.price, 0);
                        telegram.sendToUser(userId, `🔧 *RECON: Phantom Duplicate Closed*\n${dup.side} ${dup.symbol} seq=${dup.seq}\nDuplicate server record for a single exchange position — kept seq=${group[0].seq}.`);
                        audit.record('SAT_RECON_PHANTOM_MERGED_DUP', { seq: dup.seq, keepSeq: group[0].seq, symbol: dup.symbol, side: dup.side, userId }, 'SERVER_AT');
                    } finally {
                        setTimeout(() => _closingGuard.delete(_gk), 5000);
                    }
                }
            }
            // Drop consolidated duplicates from the per-seq list so the phantom check
            // below does not revisit positions we already closed in this cycle.
            for (let i = userLivePositions.length - 1; i >= 0; i--) {
                if (!_keepSeqs.has(userLivePositions[i].seq)) userLivePositions.splice(i, 1);
            }
            if (_bySymSide.size !== userLivePositions.length) _notifyChange(userId);

            // 2. Check each server live position against Binance
            for (let i = userLivePositions.length - 1; i >= 0; i--) {
                const pos = userLivePositions[i];
                // [BUG-T2a 2026-05-13] Lookup hedge-aware: symbol_side tuple key.
                // Pre-T2a: `binanceHeld.get(pos.symbol)` returned same entry pentru
                // ambele LONG + SHORT positions în HEDGE mode (last-write-wins
                // collapse). Acum cheia include side → fiecare position găsește
                // corespondentul corect (sau lipsa).
                const bpos = binanceHeld.get(pos.symbol + '_' + pos.side);

                // PHANTOM: server says position exists, Binance says no
                // Note: side check redundant post-T2a (key includes side) dar
                // kept as belt-and-suspenders pentru defensive coding.
                if (!bpos || bpos.side !== pos.side) {
                    // [FLICKER-FIX] 2-tick confirmation — don't close phantom on first detection.
                    // Testnet API latency/timeouts can cause false phantom for 1 tick.
                    if (!_phantomCandidates) _phantomCandidates = new Map();
                    const _pk = `${pos.seq}_${pos.symbol}`;
                    const _prevCount = _phantomCandidates.get(_pk) || 0;
                    if (_prevCount < 1) {
                        _phantomCandidates.set(_pk, _prevCount + 1);
                        logger.info(label, `[${pos.seq}] phantom candidate ${pos.side} ${pos.symbol} — ${_prevCount + 1}/2 confirmations (deferring close)`);
                        continue;
                    }
                    _phantomCandidates.delete(_pk);
                    // [PHANTOM-DIAG 2026-05-31] Capture WHY the held-map missed this position
                    // so the next phantom reveals the trigger: empty held-map (heldCount=0 → poll
                    // returned nothing) vs key-mismatch (position present under a different key) vs
                    // genuinely-closed (heldCount>0, key absent). exchange = the exchange actually
                    // polled for this group (NOT necessarily Binance, despite legacy var/log names).
                    try {
                        const _heldKeys = Array.from(binanceHeld.keys());
                        logger.warn(label, `[${pos.seq}] PHANTOM-DIAG uid=${userId} ${pos.side} ${pos.symbol} polledExchange=${exchange} lookupKey=${pos.symbol}_${pos.side} heldCount=${_heldKeys.length} heldKeys=[${_heldKeys.join(',') || '<empty>'}]`);
                    } catch (_) { /* diag must never break recon */ }
                    logger.warn(label, `[${pos.seq}] PHANTOM DETECTED uid=${userId}: ${pos.side} ${pos.symbol} not found on ${exchange} — closing locally`);

                    // Query userTrades for real fill price (best-effort)
                    let realExitPrice = null;
                    let realPnl = null;
                    try {
                        const trades = await exchangeOps.getUserTrades(userId, { symbol: pos.symbol, limit: 10, exchangeOverride: exchange });
                        // [BUG-T2b 2026-05-13] Strict exit trade filter via reconHelpers.
                        // Pre-T2b: `realizedPnl !== 0` matched ANY trade — could
                        // fortuitously pick UNRELATED old trade pentru same symbol.
                        // Post-T2b: must be AFTER pos.openTs, side opposite la pos.side
                        // (LONG exits SELL, SHORT exits BUY), qty ≥95% pos qty.
                        const exitTrade = findExitTrade(trades, pos);
                        if (exitTrade) {
                            realExitPrice = parseFloat(exitTrade.price);
                            realPnl = parseFloat(exitTrade.realizedPnl);
                            logger.info(label, `[${pos.seq}] PHANTOM real fill: price=$${realExitPrice} pnl=$${realPnl} (from userTrades, strict-filtered)`);
                        }
                    } catch (tradeErr) {
                        logger.warn(label, `[${pos.seq}] userTrades query failed: ${tradeErr.message} — using markPrice fallback`);
                    }

                    telegram.sendToUser(userId,
                        `🔍 *RECON: Phantom Position Removed*\n${pos.side} ${pos.symbol} seq=${pos.seq}\nPosition not found on ${exchange} — likely closed externally (SL/TP hit, liquidation, or manual close).\nRemoving from server tracker.`
                    );
                    const idx = _positions.findIndex(p => p.seq === pos.seq && p.userId === userId);
                    let estimatedClose = false;
                    if (idx >= 0) {
                        // [M5] Skip if user-initiated close already in flight — avoids double-close race.
                        const _gk = `${userId}:${pos.seq}`;
                        if (_closingGuard.has(_gk)) {
                            logger.info(label, `[${pos.seq}] PHANTOM close skipped — user close in progress (closingGuard set)`);
                            continue;
                        }
                        _closingGuard.set(_gk, Date.now());
                        try {
                            // Pick exit price in priority order:
                            //   1. realExitPrice from userTrades (authoritative)
                            //   2. bpos.markPrice if Binance still shows the symbol (side-flip case)
                            //   3. pos.price as last resort — PnL forced to 0, flag manual reconcile
                            // Never use pos._lastPrice: it fabricates a PnL from a stale tick.
                            let exitPrice;
                            if (realExitPrice != null && realExitPrice > 0) {
                                exitPrice = realExitPrice;
                            } else if (bpos && bpos.markPrice > 0) {
                                exitPrice = bpos.markPrice;
                            } else {
                                exitPrice = pos.price;
                                estimatedClose = true;
                            }
                            // [TM-4] When realPnl from userTrades API is available, it's already
                            // post-fees (exchange-authoritative). Fallback local calc needs fee
                            // deduction. estimatedClose path is forced to 0 (intentional —
                            // operator manually reconciles).
                            const pnl = realPnl != null
                                ? realPnl
                                : (estimatedClose ? 0 : _applyRoundTripFee(
                                    pos.side === 'LONG'
                                        ? +((exitPrice - pos.price) / pos.price * pos.size * pos.lev).toFixed(2)
                                        : +((pos.price - exitPrice) / pos.price * pos.size * pos.lev).toFixed(2),
                                    pos.size, pos.lev
                                ));
                            if (estimatedClose) {
                                logger.warn(label, `[${pos.seq}] PHANTOM closed at entry price (PnL=0) — userTrades unavailable; manual reconciliation required`);
                                telegram.sendToUser(userId,
                                    `⚠️ *RECON: Manual Reconciliation Needed*\n${pos.side} ${pos.symbol} seq=${pos.seq}\nReal exit fill could not be retrieved from Binance userTrades API.\nClosed locally with PnL=$0. Please verify actual fill on Binance and adjust balance manually if needed.`
                                );
                            }
                            _closePosition(idx, pos, 'RECON_PHANTOM', exitPrice, pnl);
                        } finally {
                            setTimeout(() => _closingGuard.delete(_gk), 5000);
                        }
                    }
                    audit.record('SAT_RECON_PHANTOM', { seq: pos.seq, symbol: pos.symbol, side: pos.side, userId, realExitPrice, realPnl, estimatedClose }, 'SERVER_AT');
                    // [Day 19] Doctor P1 alert — phantom position detected (Zeus tracked, Binance gone).
                    _emitDoctor({
                        eventType: 'alert', severity: 'P1',
                        moduleId: 'serverAT.recon.phantom', ts: Date.now(),
                        payload: { seq: pos.seq, symbol: pos.symbol, side: pos.side, userId,
                                   realExitPrice, realPnl, estimatedClose }
                    });
                    continue;
                }

                // Position exists on Binance — now check order health
                await _checkOrderHealth(pos, creds, label);
            }

            // 3. Check for ORPHAN positions (Binance has, server doesn't track)
            // [V5.4] 2-cycle confirmation + SAT_ prefix check before auto-close
            // [BUG-RECON-SYMBOL FIX 2026-05-14] Iterate cu destructure `[heldKey,
            // bpos]` — map key is composite SYMBOL_SIDE (BUG-T2a hedge-aware).
            // Use bpos.symbol (pure) pentru downstream Binance API calls; pre-fix
            // sent composite key as `symbol` param → "Invalid symbol" errors +
            // orphan auto-close + cancel calls silently broken.
            for (const [heldKey, bpos] of binanceHeld) {
                const symbol = bpos.symbol;
                const tracked = userLivePositions.find(p => p.symbol === symbol && p.side === bpos.side);
                if (!tracked) {
                    // [ORPHAN-ROOT-DIAG 2026-06-18] Dump every GLOBAL _positions record for this
                    // user+symbol+side BEFORE flagging an orphan, so the next false orphan reveals
                    // EXACTLY why the engine's own position is missing from userLivePositions
                    // (excluded by _isReconcilablePosition? wrong exchange group? genuinely gone?).
                    try {
                        const _gm = _positions.filter(pp => pp.userId === userId && pp.symbol === symbol && pp.side === bpos.side);
                        logger.warn(label, `ORPHAN-ROOT-DIAG uid=${userId} ${bpos.side} ${symbol}: groupExch=${exchange} ulpCount=${userLivePositions.length} globalMatches=${_gm.length} :: ${_gm.map(pp => `seq=${pp.seq} live=${pp.live && pp.live.status} mode=${pp.mode} exch=${pp.exchange} status=${pp.status} pending=${pp._livePending} recon=${_isReconcilablePosition(pp)}`).join(' || ') || '<NONE in _positions>'}`);
                    } catch (_) { }
                    const _orphanKey = `${userId}:${heldKey}`;

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
                            // [FIX 2026-05-27] Removed false positive: zero open orders does NOT
                            // imply Zeus-created. External positions (manual Binance UI trades)
                            // also have zero SAT_ orders. Old logic auto-closed these → orphan
                            // loop → rate-limit ban cascade on testnet.
                        } catch (oErr) {
                            logger.warn(label, `Open orders check failed for ${symbol}: ${oErr.message}`);
                        }

                        const _orphanAction = _classifyOrphanResolution({ isZeusCreated });
                        if (_orphanAction === 'CLOSE') {
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
                            // [ORPHAN-ADOPT FIX 2026-06-08] No open SAT_ orders → was
                            // alert-only, leaving an untracked orphan re-flagged every
                            // cycle until orphan-protection (srvPos.js) suspended AT in a
                            // loop (operator: "reset kill reapare"; 3 zombie-left orphans).
                            // ADOPT it: track + attach a protective server SL so it stops
                            // being an orphan. Safer than auto-close (preserves the
                            // position); covers BOTH a Zeus orphan whose SL/TP orders are
                            // gone AND a genuine external position (now protected, not
                            // perpetually flagged). Still alert for operator visibility.
                            try {
                                const _adopt = _syncExternalPosition({
                                    userId, symbol, side: bpos.side,
                                    entryPrice: bpos.entryPrice, qty: Math.abs(bpos.amt),
                                    markPrice: bpos.markPrice, exchange,
                                });
                                if (_adopt && _adopt.ok) {
                                    logger.warn(label, `ORPHAN adopted uid=${userId}: ${bpos.side} ${symbol} amt=${bpos.amt} — now server-tracked + protected (was perpetual orphan)`);
                                    try { _broadcastPositions(userId); } catch (_) {}
                                    audit.record('SAT_RECON_ORPHAN_ADOPTED', { symbol, side: bpos.side, amt: bpos.amt, userId, seq: _adopt.seq }, 'SERVER_AT');
                                    if (_reconAlertedShouldFire('orphans', _orphanKey)) {
                                        telegram.sendToUser(userId,
                                            `🔧 *RECON: Orphan Adopted*\n${bpos.side} ${symbol} | Qty: ${bpos.amt}\nWas untracked (no SAT_ orders) — now server-tracked with a protective SL.`
                                        );
                                    }
                                } else {
                                    logger.warn(label, `ORPHAN adopt FAILED uid=${userId}: ${bpos.side} ${symbol} — ${_adopt && _adopt.error}`);
                                }
                            } catch (adoptErr) {
                                logger.error(label, `ORPHAN adopt ERROR uid=${userId}: ${bpos.side} ${symbol} — ${adoptErr.message}`);
                            }
                        }
                        _orphanPending.delete(_orphanKey);
                    }
                } else {
                    // Position is tracked — clean up any stale pending entry
                    // [BUG-RECON-SYMBOL FIX 2026-05-14] _orphanKey must match the
                    // format set at orphan-detection branch above ({userId}:{heldKey}).
                    const _orphanKey = `${userId}:${heldKey}`;
                    if (_orphanPending.has(_orphanKey)) {
                        _orphanPending.delete(_orphanKey);
                        logger.info(label, `Orphan false alarm cleared: ${bpos.side} ${symbol} uid=${userId}`);
                    }
                }
            }

            // [LIVE-PARITY] Check pending live closes — resolve or escalate
            for (const [seq, pending] of _pendingLiveCloses) {
                // [P2c.1b] Scope to this (user, exchange) — a pending close on another
                // exchange must NOT be resolved against this exchange's held map.
                if (pending.pos.userId !== userId) continue;
                if ((pending.pos.exchange || 'binance') !== exchange) continue;
                // [BUG-RECON-SYMBOL FIX 2026-05-14] Lookup using composite key
                // (BUG-T2a map keys SYMBOL_SIDE); previous pure-symbol lookup
                // never matched → stillOnExchange always false → valid live
                // positions silently dropped from pending close queue.
                const key = `${pending.pos.symbol}_${pending.pos.side}`;
                const stillOnExchange = binanceHeld.has(key);
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
                        // [G1 2026-06-06] availableBalance feeds the decision-time
                        // affordability gate — refreshed every recon cycle (60s).
                        const _avail = parseFloat(usdtBal.availableBalance || 0);
                        if (Number.isFinite(_avail)) us.liveAvailableRef = _avail;
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
    // [F1 2026-06-06] A failed algo query is NOT non-critical: SL/TP ARE algo
    // orders, so a verdict built without them is built on partial data. During
    // the 14:46 IP ban this swallowed catch made a live SL look MISSING → a
    // duplicate SL was placed → the old one leaked as an orphan that blocked
    // all BTC entries for 2h ("Margin type cannot be changed..."). Fail-closed:
    // algo query fails → skip ALL order-health verdicts this cycle.
    let openAlgoOrders = [];
    try {
        openAlgoOrders = await sendSignedRequest('GET', '/fapi/v1/openAlgoOrders', { symbol: pos.symbol }, creds);
        if (openAlgoOrders && openAlgoOrders.orders) openAlgoOrders = openAlgoOrders.orders;
    } catch (algoErr) {
        logger.warn(label, `[${pos.seq}] openAlgoOrders query failed — skipping order-health verdicts (partial data): ${algoErr.message}`);
        return;
    }

    const orderIds = new Set([
        ...openOrders.map(o => o.orderId),
        ...(Array.isArray(openAlgoOrders) ? openAlgoOrders.map(o => o.algoId) : []),
    ]);

    // Check SL order
    if (pos.live.slOrderId && !orderIds.has(pos.live.slOrderId)) {
        logger.warn(label, `[${pos.seq}] SL order ${pos.live.slOrderId} MISSING from Binance — attempting re-placement`);
        // [F3 2026-06-06] Remember the id we believe is gone — if the MISSING
        // verdict was wrong (race), the old order would otherwise leak as an
        // orphan after the overwrite below. Cancelled AFTER successful
        // re-placement (never reduce protection first); on failure retained as
        // staleSlOrderId so the watchdog cleans it post-repair.
        const _oldSlOrderId = pos.live.slOrderId;
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
                // [2026-06-07 B6] Algo clientAlgoId limit is 36 chars.
                // `SAT_RESLOT_<13-digit seq>_<13-digit ms>` = 38 → EVERY
                // startup-recon SL re-placement failed ("Client order id
                // length should be less than 36 chars", live 12:10:09).
                // base36 ms (8 chars) keeps it ≤ 30.
                reduceOnly: true, newClientOrderId: `SAT_RSL_${pos.live.liveSeq}_${Date.now().toString(36)}`,
            }, creds);
            pos.live.slOrderId = newSl.orderId;
            pos.live.status = 'LIVE';
            delete pos.live.staleSlOrderId;
            replaced = true;
            // [F3] New SL is live — now best-effort cancel the old id (idempotent:
            // "Unknown order" → success when it was genuinely gone).
            try { await _cancelOrderSafe(pos.symbol, _oldSlOrderId, creds, userId); } catch (_) { /* best-effort */ }
            logger.info(label, `[${pos.seq}] SL re-placed successfully → algoId=${newSl.orderId}`);
            telegram.sendToUser(userId, `✅ *SL Re-placed*\n${pos.side} ${pos.symbol}\nSL order was missing on Binance — automatically re-placed at $${currentSL.toFixed(2)}`);
        } catch (err) {
            pos.live.status = 'LIVE_NO_SL';
            pos.live.slOrderId = null;
            // [F3] Don't lose the old id — if the MISSING verdict was a race the
            // order still rests on the exchange; the watchdog cancels it after repair.
            pos.live.staleSlOrderId = _oldSlOrderId;
            logger.error(label, `[${pos.seq}] SL re-placement FAILED: ${err.message}`);
            // [AUDIT] Per-user dedupe — alert once per position, not every recon cycle
            const _slFailKey = `${userId}:${pos.seq}`;
            if (_reconAlertedShouldFire('slFails', _slFailKey)) {
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

// [BUG B 2026-06-05] Exit-fill correlation tracker. When OUR exchange-side
// SL/TP algo fires, the child order's ORDER_TRADE_UPDATE carries
// clientOrderId 'sl_<decisionKey>_<i>' / 'tp_...' with the REAL exit price
// (avgPrice) and REAL realized PnL (rp). The ACCOUNT_UPDATE position-closed
// event carries NEITHER (unrealizedPnL=0 at amt=0) and previously journaled
// EXTERNAL_CLOSE PnL=$0.00 (observed: BNB really -$292). Event order varies
// (observed: POSITION_CLOSED first, fill ~40ms later), so the handler matches
// immediately AND via a short defer. Fail-closed: no matching protection fill
// within the window → EXTERNAL_CLOSE fallback exactly as before.
const _EXIT_FILL_MAX_AGE_MS = 5000;
const _exitFills = new Map(); // 'userId|symbol' → { kind, avgPrice, realizedPnL, clientOrderId, ts }

// [T-EXTCLOSE 2026-06-08] Classify a fill that may close a position.
//  - sl_<…> → HIT_SL, tp_<…> → HIT_TP (our protection orders, unchanged)
//  - any OTHER reduceOnly fill → EXTERNAL (manual/testnet/liquidation close — it
//    carries the REAL avgPrice + realizedPnL; previously discarded → the close
//    was journaled EXTERNAL_CLOSE PnL=$0.00 with exit=entry).
//  - non-reduceOnly (entry) fill → null (never an exit).
function classifyExitFill(clientOrderId, reduceOnly) {
    const cid = typeof clientOrderId === 'string' ? clientOrderId : '';
    if (cid.startsWith('sl_')) return 'HIT_SL';
    if (cid.startsWith('tp_')) return 'HIT_TP';
    if (reduceOnly === true) return 'EXTERNAL';
    return null;
}

// [T-EXTCLOSE] Map an exit-fill kind to the journal close type.
function exitKindToCloseType(kind) {
    return kind === 'EXTERNAL' ? 'EXTERNAL_CLOSE' : kind;
}

const _exitFillTracker = {
    record(userId, symbol, fill, now) {
        if (!fill) return;
        const kind = classifyExitFill(fill.clientOrderId, fill.reduceOnly);
        if (!kind) return; // entry / non-reduceOnly fill — never an exit
        _exitFills.set(userId + '|' + symbol, {
            kind, avgPrice: +fill.avgPrice || 0, realizedPnL: +fill.realizedPnL || 0,
            clientOrderId: (typeof fill.clientOrderId === 'string' ? fill.clientOrderId : null),
            ts: now != null ? now : Date.now(),
        });
    },
    match(userId, symbol, now) {
        const key = userId + '|' + symbol;
        const f = _exitFills.get(key);
        if (!f) return null;
        const t = now != null ? now : Date.now();
        if (t - f.ts > _EXIT_FILL_MAX_AGE_MS) { _exitFills.delete(key); return null; }
        _exitFills.delete(key); // consume — never double-journal
        return f;
    },
    _clear() { _exitFills.clear(); },
};

// [PHANTOM ROOT FIX 2026-06-05] Close-race guard. _closePosition runs
// internally BEFORE the exchange's mid-close partial ACCOUNT_UPDATE snapshots
// arrive; a snapshot with amt≠0 then finds no OPEN internal position and was
// adopted as an "external" (manual-looking) phantom — 3 today, each at the
// exact second of a DSL close, two stuck OPEN for hours. Userdata-stream
// adoption is only a fast-path; the 60s recon (positionRisk = exchange truth,
// race-free) adopts genuinely-external positions anyway — so suppressing the
// fast-path for 30s around our own closes loses nothing.
const _CLOSE_RACE_WINDOW_MS = 30_000;
const _recentInternalCloses = new Map(); // 'userId|symbol' → ts
const _closeRaceGuard = {
    record(userId, symbol, now) {
        _recentInternalCloses.set(userId + '|' + symbol, now != null ? now : Date.now());
        // opportunistic prune
        if (_recentInternalCloses.size > 64) {
            const cutoff = (now != null ? now : Date.now()) - _CLOSE_RACE_WINDOW_MS;
            for (const [k, ts] of _recentInternalCloses) { if (ts < cutoff) _recentInternalCloses.delete(k); }
        }
    },
    isRecent(userId, symbol, now) {
        const ts = _recentInternalCloses.get(userId + '|' + symbol);
        if (ts == null) return false;
        return ((now != null ? now : Date.now()) - ts) <= _CLOSE_RACE_WINDOW_MS;
    },
    _clear() { _recentInternalCloses.clear(); },
};

function onUserDataEvent(userId, event) {
    if (!event || !event.e) return;
    try {
        const uds = require('./userDataStream');
        if (event.e === 'ACCOUNT_UPDATE') {
            const parsed = uds.parseAccountUpdate(event);
            if (!parsed) return;

            for (const p of parsed.positions) {
                const side = p.positionAmt > 0 ? 'LONG' : p.positionAmt < 0 ? 'SHORT' : null;
                // Find ANY open position for this symbol (live OR recent registration)
                const existingIdx = _positions.findIndex(pos =>
                    pos.userId === userId && pos.symbol === p.symbol &&
                    pos.status === 'OPEN'
                );
                const existing = existingIdx >= 0 ? _positions[existingIdx] : null;

                if (Math.abs(p.positionAmt) < 1e-10) {
                    // Position CLOSED (amt → 0)
                    if (existing) {
                        // [BUG B 2026-06-05] First try to attribute the close to
                        // one of OUR protection orders (SL/TP algo child fill,
                        // correlated via _exitFillTracker) → HIT_SL/HIT_TP with
                        // REAL exit price + realized PnL. Event order varies, so
                        // if no fill matched yet, defer ~2.5s and retry before
                        // falling back to EXTERNAL_CLOSE (previous behaviour,
                        // which journaled PnL=$0.00 / exit=entry on SL hits).
                        const fallbackPnl = +(p.unrealizedPnL || 0).toFixed(2);
                        const fallbackPrice = p.entryPrice || existing.entry || existing.price || 0;
                        const immediate = _exitFillTracker.match(userId, p.symbol);
                        if (immediate) {
                            logger.info('USERDATA', `[POSITION_CLOSED] uid=${userId} ${p.symbol} ${existing.side} — ${immediate.kind} fill matched, exit=${immediate.avgPrice} PnL=${immediate.realizedPnL}`);
                            // [T-EXTCLOSE] EXTERNAL kind → EXTERNAL_CLOSE journal type but with the
                            // REAL exit price + realizedPnL from the closing fill (not entry/$0.00).
                            _closePosition(existingIdx, existing, exitKindToCloseType(immediate.kind), immediate.avgPrice || fallbackPrice, +(+immediate.realizedPnL).toFixed(2));
                        } else {
                            const seq = existing.seq;
                            // Suppress the server-side SL net for this position during
                            // the defer — the exchange is already flat (review fix).
                            existing._pendingExchangeClose = true;
                            logger.info('USERDATA', `[POSITION_CLOSED] uid=${userId} ${p.symbol} ${existing.side} — no protection fill yet, deferring classification 2.5s`);
                            setTimeout(() => {
                                try {
                                    // Re-find by seq — the array may have shifted; if the
                                    // position is no longer OPEN someone else closed it.
                                    const idx2 = _positions.findIndex(q => q.seq === seq && q.userId === userId && q.status === 'OPEN');
                                    if (idx2 < 0) return;
                                    const pos2 = _positions[idx2];
                                    pos2._pendingExchangeClose = false; // lift suppression regardless of outcome
                                    const late = _exitFillTracker.match(userId, p.symbol);
                                    if (late) {
                                        logger.info('USERDATA', `[POSITION_CLOSED] uid=${userId} ${p.symbol} — late ${late.kind} fill matched, exit=${late.avgPrice} PnL=${late.realizedPnL}`);
                                        // [T-EXTCLOSE] EXTERNAL kind → EXTERNAL_CLOSE with real exit + PnL.
                                        _closePosition(idx2, pos2, exitKindToCloseType(late.kind), late.avgPrice || fallbackPrice, +(+late.realizedPnL).toFixed(2));
                                    } else {
                                        logger.info('USERDATA', `[POSITION_CLOSED] uid=${userId} ${p.symbol} ${pos2.side} — closed externally, PnL=${fallbackPnl}`);
                                        _closePosition(idx2, pos2, 'EXTERNAL_CLOSE', fallbackPrice, fallbackPnl);
                                    }
                                } catch (e) {
                                    logger.error('USERDATA', `deferred close classification failed uid=${userId} ${p.symbol}: ${e.message}`);
                                }
                            }, 2500);
                        }
                    }
                } else if (!existing) {
                    // Position OPENED externally — but skip if Zeus JUST registered one
                    // (race: ACCOUNT_UPDATE arrives before registerManualPosition completes)
                    const _recentReg = _positions.find(pos =>
                        pos.userId === userId && pos.symbol === p.symbol &&
                        pos.ts && (Date.now() - pos.ts) < 15000
                    );
                    if (_recentReg) {
                        logger.info('USERDATA', `[POSITION_OPENED] uid=${userId} ${p.symbol} — skipped (recent registration ${_recentReg.seq})`);
                    } else if (_closeRaceGuard.isRecent(userId, p.symbol)) {
                        // [PHANTOM ROOT FIX 2026-06-05] We just closed a position on
                        // this symbol — these amt≠0 snapshots are the exchange's
                        // mid-close partials, NOT a new external position. The 60s
                        // recon (exchange-truth path) adopts anything genuinely new.
                        logger.info('USERDATA', `[POSITION_OPENED] uid=${userId} ${p.symbol} — skipped (close-race window, internal close <30s ago)`);
                    } else if (_findSameModeOpposite(_positions, { userId, side, mode: _uState(userId).engineMode })) {
                        // [PHANTOM-SHORT FIX 2026-06-08] The detected "external" side is
                        // OPPOSITE to a position serverAT already holds in this mode. On a
                        // ONE-WAY account (the only kind serverAT trades) the exchange CANNOT
                        // hold both sides of the book — so this ACCOUNT_UPDATE is a misread of
                        // a BUY/SELL *reduce*-fill (amt still ≠0 after a partial net), NOT a
                        // genuine new position. Adopting it here injected a phantom opposite
                        // row that lived ~80min in the book (operator-observed "short + long").
                        // Do NOT fast-adopt: defer to the 60s exchange-truth recon, which only
                        // adopts positions GENUINELY present on the exchange (a real opposite on
                        // a hedge account is picked up there within a minute, with its own SL).
                        const _opp = _findSameModeOpposite(_positions, { userId, side, mode: _uState(userId).engineMode });
                        logger.warn('USERDATA', `[POSITION_OPENED] uid=${userId} ${p.symbol} ${side} amt=${p.positionAmt} — DEFERRED (would create same-mode opposite book vs ${_opp.side} ${_opp.symbol}/seq=${_opp.seq}; one-way misread → exchange-truth recon will adopt only if genuinely held)`);
                        try { audit.record('SAT_EXTERNAL_ADOPT_DEFERRED', { userId, symbol: p.symbol, side, amt: p.positionAmt, conflictSide: _opp.side, conflictSymbol: _opp.symbol, conflictSeq: _opp.seq }, 'SERVER_AT'); } catch (_) {}
                    } else {
                        logger.info('USERDATA', `[POSITION_OPENED] uid=${userId} ${p.symbol} ${side} amt=${p.positionAmt} — opened externally`);
                        // [SP2] POSITION_OPENED fires at open time → entryPrice ≈ current
                        // price, so the entryPrice-relative protective SL is correct here
                        // (ACCOUNT_UPDATE carries no markPrice). Gate follow-up on a
                        // successful sync — never place an exchange SL for an unregistered position.
                        const _syncRes = _syncExternalPosition({
                            userId, symbol: p.symbol, side,
                            entryPrice: p.entryPrice,
                            qty: Math.abs(p.positionAmt),
                        });
                        if (_syncRes && _syncRes.ok) {
                            _broadcastPositions(userId);
                            // [Fix #2 safety net 2026-05-29] Never leave a recon-discovered live
                            // position naked. _syncExternalPosition now sets a server-side protective SL
                            // (markPrice ∓2%, entryPrice fallback); ALSO place a correct-side EXCHANGE stop
                            // (belt-and-suspenders) so the position is protected even if the server process is down.
                            // Fire-and-forget (don't block recon); DSL takes over this native SL on activation.
                            (async () => {
                                const _mark = Number(p.markPrice) || Number(p.entryPrice) || 0;
                                let _stop = _computeProtectiveStop(side, _mark, 0.02);
                                if (!_stop) return;
                                // [2026-06-07] Round to tick size — the raw float
                                // (63007.950000000004 live, seq 1776859653267) made
                                // Binance reject ALL 3 attempts with "Precision is
                                // over the maximum", leaving the adopted position
                                // with the server-net backstop ONLY.
                                try {
                                    const _rp = roundOrderParams(p.symbol, Math.abs(p.positionAmt), _stop);
                                    if (_rp && _rp.stopPrice != null && Number.isFinite(+_rp.stopPrice)) _stop = +_rp.stopPrice;
                                    else if (_rp && _rp.price != null && Number.isFinite(+_rp.price)) _stop = +_rp.price;
                                } catch (_) { /* fall back to raw — retry loop still applies */ }
                                // [SP2-7b] The EXCHANGE-side stop is the PRIMARY protection for an
                                // adopted position (survives server-process death); the server-net
                                // SL is the backstop. Make placement robust: retry up to 3 attempts,
                                // and on persistent failure ALERT the operator (telegram + audit) so
                                // they know the position is relying on the server-net backstop ONLY.
                                // Fire-and-forget (don't block recon).
                                const SAFETY_SL_ATTEMPTS = 3;
                                let _placed = false;
                                let _lastErr = null;
                                for (let _att = 1; _att <= SAFETY_SL_ATTEMPTS; _att++) {
                                    try {
                                        const r = await require('./exchangeOps').placeStopLoss(userId, {
                                            symbol: p.symbol, side, stopPrice: _stop,
                                            decisionKey: require('./decisionKey').generate(),
                                        });
                                        if (r && r.ok) {
                                            logger.info('AT_RECON', `[SAFETY-SL] uid=${userId} ${p.symbol} ${side} protective SL @ $${_stop.toFixed(2)} (slOrderId=${r.slOrderId}, attempt ${_att}/${SAFETY_SL_ATTEMPTS})`);
                                            try { audit.record('RECON_SAFETY_SL_PLACED', { userId, symbol: p.symbol, side, stopPrice: _stop, slOrderId: r.slOrderId, attempt: _att }, 'AT_RECON'); } catch (_) {}
                                            _placed = true;
                                            break;
                                        }
                                        _lastErr = (r && r.error) || 'not ok';
                                        logger.warn('AT_RECON', `[SAFETY-SL] uid=${userId} ${p.symbol} placeStopLoss not ok (attempt ${_att}/${SAFETY_SL_ATTEMPTS}): ${_lastErr}`);
                                    } catch (_e) {
                                        _lastErr = (_e && _e.message) || String(_e);
                                        logger.warn('AT_RECON', `[SAFETY-SL] uid=${userId} ${p.symbol} failed (attempt ${_att}/${SAFETY_SL_ATTEMPTS}): ${_lastErr}`);
                                    }
                                    if (_att < SAFETY_SL_ATTEMPTS) {
                                        await new Promise(r => setTimeout(r, 1500 * _att));
                                    }
                                }
                                if (!_placed) {
                                    // [SP2-7b] Persistent failure — the exchange-side primary protection
                                    // is NOT in place. Alert operator: position is on the server-net
                                    // backstop only (server-process death = unprotected).
                                    logger.error('AT_RECON', `[SAFETY-SL] uid=${userId} ${p.symbol} ${side} EXCHANGE stop FAILED after ${SAFETY_SL_ATTEMPTS} attempts — relying on server-net backstop ONLY. lastErr=${_lastErr}`);
                                    try {
                                        telegram.sendToUser(userId, `🚨 *RECON SAFETY-SL FAILED*\n${side} ${p.symbol} @ ~$${_mark.toFixed(2)}\nExchange protective stop could NOT be placed after ${SAFETY_SL_ATTEMPTS} attempts.\n*Position is protected by the server-net SL ONLY (no exchange-side stop). Place a manual stop on the exchange.*\nlastErr: ${_lastErr}`);
                                    } catch (_) {}
                                    try { audit.record('RECON_SAFETY_SL_FAILED', { userId, symbol: p.symbol, side, stopPrice: _stop, attempts: SAFETY_SL_ATTEMPTS, lastErr: String(_lastErr) }, 'AT_RECON'); } catch (_) {}
                                }
                            })();
                        } else {
                            logger.warn('USERDATA', `[POSITION_OPENED] uid=${userId} ${p.symbol} sync failed: ${_syncRes && _syncRes.error} — no exchange SL placed`);
                        }
                    }
                } else {
                    // Position MODIFIED (partial fill, scale in/out)
                    const newQty = Math.abs(p.positionAmt);
                    if (existing.live) existing.live.executedQty = newQty;
                    existing.qty = newQty;
                    existing.entry = p.entryPrice || existing.entry;
                    existing.price = p.entryPrice || existing.price;
                    existing.unrealizedPnL = p.unrealizedPnL;
                    logger.info('USERDATA', `[POSITION_MODIFIED] uid=${userId} ${p.symbol} amt=${p.positionAmt} entry=${p.entryPrice}`);
                    try { _persistState(userId); } catch (_) {}
                    _broadcastPositions(userId);
                }
            }

            for (const b of parsed.balances) {
                if (b.asset === 'USDT') {
                    const us = _uState(userId);
                    if (us) {
                        us.balance = b.walletBalance;
                        us.crossWalletBalance = b.crossWalletBalance;
                    }
                }
            }
        } else if (event.e === 'ORDER_TRADE_UPDATE') {
            const parsed = uds.parseOrderUpdate(event);
            if (!parsed) return;
            if (parsed.executionType === 'TRADE' && parsed.orderStatus === 'FILLED') {
                logger.info('USERDATA', `[ORDER_FILL] uid=${userId} ${parsed.side} ${parsed.symbol} qty=${parsed.filledQty} avgPx=${parsed.avgPrice} orderId=${parsed.orderId}`);
                // [BUG B 2026-06-05] Our SL/TP algo child fills carry the
                // clientAlgoId — record so POSITION_CLOSED (before OR after
                // this event) classifies HIT_SL/HIT_TP with real numbers.
                _exitFillTracker.record(userId, parsed.symbol, parsed);
            } else if (parsed.orderStatus === 'CANCELED' || parsed.orderStatus === 'EXPIRED') {
                logger.info('USERDATA', `[ORDER_${parsed.orderStatus}] uid=${userId} ${parsed.symbol} orderId=${parsed.orderId}`);
            }
        } else if (event.e === 'MARGIN_CALL') {
            logger.warn('USERDATA', `[MARGIN_CALL] uid=${userId} — Telegram alert sent`);
            try {
                const tg = require('./telegram');
                tg.sendToUser(userId, '🚨 *MARGIN CALL* — Check positions immediately!');
            } catch (_) {}
        }
    } catch (err) {
        logger.error('USERDATA', `onUserDataEvent failed uid=${userId}: ${err.message}`);
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
const WATCHDOG_ALERT_TTL_MS = 24 * 3600 * 1000; // 24h — purge old alerts
const WATCHDOG_ALERT_MAX_SIZE = 500; // cap entries before forced sweep
let _watchdogRunning = false;
// [BUG-2 FIX 2026-05-28] Convert Set → Map<key, lastAlertTs> with TTL sweep
// to prevent unbounded growth (positions that stay LIVE_NO_SL leak entries).
const _watchdogAlerted = new Map(); // "userId:seq" → lastAlertTs

function _sweepWatchdogAlerts() {
    const cutoff = Date.now() - WATCHDOG_ALERT_TTL_MS;
    for (const [key, ts] of _watchdogAlerted) {
        if (ts < cutoff) _watchdogAlerted.delete(key);
    }
    // Hard cap fallback: if still over MAX_SIZE, drop oldest half
    if (_watchdogAlerted.size > WATCHDOG_ALERT_MAX_SIZE) {
        const sorted = Array.from(_watchdogAlerted.entries()).sort((a, b) => a[1] - b[1]);
        const dropCount = Math.floor(sorted.length / 2);
        for (let i = 0; i < dropCount; i++) _watchdogAlerted.delete(sorted[i][0]);
    }
}

async function _watchdogLiveNoSL() {
    if (_watchdogRunning) return;
    _watchdogRunning = true;
    try {
        _sweepWatchdogAlerts();
        const targets = _positions.filter(p =>
            p.status === 'OPEN' && p.live &&
            p.live.status === 'LIVE_NO_SL' && !p.live.slOrderId
        );
        if (targets.length === 0) return;
        logger.warn('WATCHDOG', `Found ${targets.length} LIVE_NO_SL position(s) — attempting SL repair`);

        for (const pos of targets) {
            if (!pos.userId) continue;
            const userId = pos.userId;
            const creds = _credsForPosition(userId, pos);
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
                // [F3 2026-06-06] A failed recon re-placement retains the old SL id
                // (staleSlOrderId) — if its MISSING verdict was a race, that order
                // still rests on the exchange and would leak as an orphan. New SL is
                // live, so cancel the stale one best-effort (idempotent when gone).
                if (pos.live.staleSlOrderId) {
                    try { await _cancelOrderSafe(pos.symbol, pos.live.staleSlOrderId, creds, userId); } catch (_) { /* best-effort */ }
                    delete pos.live.staleSlOrderId;
                }
                _persistPosition(pos);
                _watchdogAlerted.delete(`${userId}:${pos.seq}`);
                logger.info('WATCHDOG', `[${pos.seq}] SL repaired → algoId=${newSl.orderId} @ $${currentSL}`);
                telegram.sendToUser(userId, `✅ *Watchdog SL Repair*\n${pos.side} ${pos.symbol}\nSL successfully placed at $${currentSL}\nPosition is now protected.`);
            } catch (err) {
                logger.error('WATCHDOG', `[${pos.seq}] SL repair failed: ${err.message}`);
                const alertKey = `${userId}:${pos.seq}`;
                if (!_watchdogAlerted.has(alertKey)) {
                    _watchdogAlerted.set(alertKey, Date.now());
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
    _disasterStopPrice,
    _shouldDisasterClose,
    // [SILENT-ARCHIVE-GUARD 2026-06-12] pure detector, unit-tested
    __guards: { isUnexpectedArchive: _isUnexpectedArchive },
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
    _computeUserOwnership, // [SP2-9] pure ownership resolver for sync payload
    serverFullyOwnsEntries, // [SP2-b] full-ownership glue — used by trading.js order/place reject
    isKillActive: (userId) => { try { return _uState(userId).killActive === true; } catch (_) { return false; } }, // [SERVER-ARES] light kill probe for ares rules
    // Mode control
    setMode,
    getMode,
    isATActive,
    preLiveChecklist,
    _placeConditionalOrder, // [Phase M] exported for exchange-routing tests
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
    // [Phase 2 S2.B] Global panic halt
    isGlobalHaltActive,
    getGlobalHaltState,
    setGlobalHalt,
    // Client actions
    registerManualPosition,
    // [M1.2 Cat A] Pure transform helper: /api/order/place reqBody → canonical entry.
    // Used by _executeLiveEntryCore + post-M1 refactored registerManualPosition.
    _buildEntryFromOrderPlace,
    // [M1.2 Cat B] Core safety machinery: atomic entry + SL/TP placement + emergency close.
    // Extracted din _executeLiveEntry pattern; reusable pentru BOTH Path A (Brain dispatch)
    // AND Path B (registerManualPosition post-M1 unification) per ADR-001 Decision 3.1.
    _executeLiveEntryCore,
    _liveExecAllowed, // [SP2-a] pure live-exec gate predicate (unit-tested)
    _exitFillTracker, // [BUG B] SL/TP fill ↔ POSITION_CLOSED correlation (unit-tested)
    _closeRaceGuard, // [PHANTOM ROOT FIX] suppress phantom adoption near our own closes (unit-tested)
    _buildExternalEntry, // [PHANTOM ROOT FIX] exported to pin status:'OPEN' (unit-tested)
    _findSameSideOpenDup, // [DUAL-WRITE DUP FIX 2026-06-15] same-side open-dup predicate (unit-tested)
    _enqueueEmergencyClose, // [ORPHAN ROOT FIX] failed closes REALLY enqueue now (unit-tested)
    // [M1.2 Cat C] Sync external Binance position (recon-discovered, NU PHANTOM).
    // source='external' marker, NO SL placement responsibility, warning log.
    _syncExternalPosition,
    // [SP2-7b] Pure builder for the EXTERNAL entry object (finite-PnL + closable shape).
    _buildExternalEntry,
    // [SP2-7b] Exported for integration test — proves an EXTERNAL SL-triggered close
    // reaches exchangeOps.closePosition (reduce-only MARKET).
    _handleLiveExit,
    // [BUG-T2c FIX 2026-05-14] Path B SL placement helper (trading.js).
    // Called from /api/order/place after main MARKET order success. Places SL HARD
    // + TP conditional on !dslParams (DSL ON skip per regulă). Returns
    // { slOrderId, tpOrderId, status } for caller to pass to registerManualPosition.
    _placeProtectionForExistingEntry,
    // [ML Phase B Day 7] Canonical execution-env resolver exposed for Ring5
    // facade wiring in serverBrain. Returns { env: 'DEMO'|'TESTNET'|'REAL'|null, blockedReason }.
    _resolveExecutionEnv,
    patchPositionFill,
    closeBySeq,
    addOnPosition,
    updateControlMode,
    updateDslParams,
    setDslEnabled,
    getDslEnabled,
    // Reconciliation (for manual trigger / testing)
    _runReconciliation,
    onUserDataEvent,
    // [P2c.1b] Test-only recon hooks — seed/reset module-internal _positions +
    // recon state so the cross-exchange recon path can be exercised in isolation.
    // Never called by any runtime path.
    _reconTestHooks: Object.freeze({
        seedPositions: (arr) => { _positions.length = 0; (arr || []).forEach((p) => _positions.push(p)); },
        getPositions: () => _positions.slice(),
        reset: () => {
            _positions.length = 0;
            _phantomCandidates = null;
            _pendingLiveCloses.clear();
            _orphanPending.clear();
        },
    }),
    // Watchdog (for manual trigger / testing)
    _watchdogLiveNoSL,
    _checkOrderHealth, // [F1/F3 2026-06-06] test hook — order-health verdicts on partial data
    _shouldRunOrphanSweep, // [F2 2026-06-06] time-based sweep cadence (test hook)
    // [G1/G2 2026-06-06] decision-time affordability gate + failure cooldown (test hooks)
    _entryGateTestHooks: Object.freeze({ affordable: _liveEntryAffordable, cooldown: _entryFailCooldown, enqueueEmergencyClose: _enqueueEmergencyClose }),

    // [S5] Test-only hooks. Exposed via require but never called by any
    // runtime path. Used by tests/probe-s5.js to exercise close-cooldown
    // persistence + lazy restore + deadline cleanup.
    _s5TestHooks: Object.freeze({
        closeCooldowns: _closeCooldowns,
        closeCooldownsRestoredFor: _closeCooldownsRestoredFor,
        setCloseCooldownDeadline: _setCloseCooldownDeadline,
        persistCloseCooldownsForUser: _persistCloseCooldownsForUser,
        restoreCloseCooldownsForUser: _restoreCloseCooldownsForUser,
        CLOSE_COOLDOWN_MS,
    }),
    // [S6-A] Test-only hooks for the positions.changed contract probe.
    // Exposed via require but never called by any runtime path. Used by
    // tests/probe-s6.js to drive _broadcastPositions against a stubbed
    // global.__zeusWsBroadcastToUser, inspect the snapshot frame, and
    // verify per-user isolation + DB-authoritative shape.
    _s6TestHooks: Object.freeze({
        broadcastPositions: _broadcastPositions,
        normalizePositionRow: _normalizePositionRow,
        positions: _positions,
    }),
    // [Task S8-P1-4 2026-05-28] Pure streak-counter logic for unit testing.
    _s8p1TestHooks: Object.freeze({
        updateStreakCounters: _updateStreakCounters,
    }),
    // [S8.1 hard real-block 2026-05-28] Pure fail-closed real-money predicate.
    _s8realBlockTestHooks: Object.freeze({
        realBlocked: _realBlocked,
    }),
    // [Phase 2 S6-B2] Test-only hooks for the paranoid live execution gate
    // probe. Two pure flag readers + the actual _executeLiveEntry function
    // exposed so tests/probe-s6b2.js can verify that calling it with
    // MF.SERVER_AT=false throws LIVE_ENTRY_REQUIRES_FULL_SERVER_AT before
    // any state mutation. Runtime never references these exports.
    _s6b2TestHooks: Object.freeze({
        executeLiveEntry: _executeLiveEntry,
        canExecuteLiveEntryUnderCurrentFlags: () => MF.SERVER_AT === true,
        isLiveModeAuthorizedUnderCurrentFlags: (engineMode) =>
            engineMode === 'demo' ? true : (MF.SERVER_AT === true),
    }),
    // [Phase 2 S6-B3] Test-only hooks for the per-user decisionId dedup
    // probe. Pure helper exposed via require but never called by any
    // runtime path — processBrainDecision references the local symbol
    // _checkAndStoreDecisionId, not this export.
    _s6b3TestHooks: Object.freeze({
        DECISION_DEDUP_TTL_MS,
        decisionDedupKey: _decisionDedupKey,
        checkAndStoreDecisionId: _checkAndStoreDecisionId,
    }),
    // [Task G 2026-05-28] Graceful shutdown drain
    drainPending,
    _testIncPending: _incPending,
    _testDecPending: _decPending,
    // [Task L 2026-05-28] Pre-trade balance check (exported for testing)
    _checkBalanceForEntry,
    // [Bug A fix 2026-05-29] Position-side normalizer (exported for testing)
    _normalizePositionSide,
    // [Fix #2 safety net 2026-05-29] Protective-stop computation (exported for testing)
    _computeProtectiveStop,
    // [SP2 policy L] Adopted-position protective stop (exported for testing)
    _adoptedProtectiveStop,
    // [DSL-FIX 2026-06-01] Skip-decision + SL-breach predicates (exported for testing)
    __dslfix: { isExplicitUserControl: _isExplicitUserControl, isSLBreached: _isSLBreached },
    // [KS-UI 2026-06-01] Test-only hooks for the kill re-arm characterization test.
    _uStateForTest: _uState,
    _checkKillSwitchForTest: _checkKillSwitch,
    _checkDailyResetForTest: _checkDailyReset, // [T-MAXTRADES] test hook for rollover
    _shouldResyncLiveBalanceRef, // [T1-2] pure resync predicate
    _resyncLiveBalanceRef,       // [T1-2] liveBalanceRef self-heal
    _findSameModeOpposite,       // [PHANTOM-SHORT FIX] pure directional-conflict predicate (shared guard)
    _isReconcilablePosition,     // [PHANTOM-SHORT FIX b] pure recon-eligibility predicate (mode-tag robust)
    _classifyOrphanResolution,   // [ORPHAN-ADOPT FIX] pure recon orphan resolution policy (CLOSE|ADOPT)
    _linkedOpsSeqToCleanup,      // [P1 dual-write dedup] pure linked-ops-row decision
    shouldBlockMaxTradesDay,     // [T-MAXTRADES] pure daily-cap gate
    computeMaxDayProtectState,   // [T-MAXTRADES] pure display state
    setMaxDayProtect,            // [T-MAXTRADES] operator toggle
    classifyExitFill,            // [T-EXTCLOSE] pure exit-fill classifier
    exitKindToCloseType,         // [T-EXTCLOSE] kind → journal close type
    _exitFillTrackerForTest: _exitFillTracker, // [T-EXTCLOSE] tracker behavior tests
    _clearKillCooldownForTest: (_uid) => { /* [KILL-REARM 2026-06-07] cooldown removed — kept as no-op for test back-compat */ },
    // [SYNC-2 2026-06-01] Exchange-threading resolver (exported for testing)
    __sync2: { resolveEntryExchange: _resolveEntryExchange },
};
