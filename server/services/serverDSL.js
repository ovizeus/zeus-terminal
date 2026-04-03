// Zeus Terminal — Server-side DSL (Dynamic Stop Loss) Engine
// Port of client dsl.js runDSLBrain() — pure computation, no UI/DOM
// 3 phases: Activation → Pivot Tracking → Impulse Validation
'use strict';

const logger = require('./logger');
const audit = require('./audit');

const DSL_MAX_LOG = 200; // [H2] cap per-position log to prevent unbounded growth

// ══════════════════════════════════════════════════════════════════
// DSL Configuration Defaults (mirrors client TC/global defaults)
// ══════════════════════════════════════════════════════════════════
const DSL_DEFAULTS = {
    openDslPct: 0.50,       // DEF preset default
    pivotLeftPct: 0.70,
    pivotRightPct: 1.00,
    impulseVPct: 1.30,
};

// Authoritative Brain DSL mode presets
const DSL_PRESETS = {
    fast: { openDslPct: 0.30, pivotLeftPct: 0.40, pivotRightPct: 0.60, impulseVPct: 0.80 },
    tp: { openDslPct: 0.35, pivotLeftPct: 0.45, pivotRightPct: 0.75, impulseVPct: 1.00 },
    def: { openDslPct: 0.50, pivotLeftPct: 0.70, pivotRightPct: 1.00, impulseVPct: 1.30 },
    atr: { openDslPct: 0.65, pivotLeftPct: 0.90, pivotRightPct: 1.30, impulseVPct: 1.70 },
    swing: { openDslPct: 1.00, pivotLeftPct: 1.30, pivotRightPct: 1.90, impulseVPct: 2.40 },
};

function getPreset(mode) {
    return Object.assign({}, DSL_PRESETS[(mode || '').toLowerCase()] || DSL_DEFAULTS);
}

const DSL_CLAMPS = {
    openDslPct: { min: 0.01, max: 100 },
    pivotLeftPct: { min: 0.01, max: 100 },
    pivotRightPct: { min: 0.01, max: 100 },
    impulseVPct: { min: 0.01, max: 100 },
};

// ── Per-position DSL state store ──
const _states = new Map();  // posId → DSL state object

// ══════════════════════════════════════════════════════════════════
// Sanitize DSL params (non-blocking, clamp to sane ranges)
// ══════════════════════════════════════════════════════════════════
function _sanitizeParams(raw) {
    const out = {};
    for (const key of ['openDslPct', 'pivotLeftPct', 'pivotRightPct', 'impulseVPct']) {
        let v = raw[key];
        const c = DSL_CLAMPS[key];
        const d = DSL_DEFAULTS[key];
        if (!Number.isFinite(v) || v === null || v === undefined) v = d;
        if (v < c.min) v = c.min;
        if (v > c.max) v = c.max;
        out[key] = v;
    }
    // impulse must exceed pivotRight
    if (out.impulseVPct <= out.pivotRightPct) {
        out.impulseVPct = Math.round((out.pivotRightPct + 0.01) * 100) / 100;
        if (out.impulseVPct > DSL_CLAMPS.impulseVPct.max) {
            out.pivotRightPct = Math.round((out.impulseVPct - 0.01) * 100) / 100;
        }
    }
    return out;
}

// ── Safety guard for prices ──
function _safePrice(val, fallback) {
    if (!Number.isFinite(val) || val <= 0 || val > 1e12) return fallback;
    return val;
}

// ══════════════════════════════════════════════════════════════════
// attach(position) — initialize DSL tracking for a new position
// Call immediately after shadow/live entry is created
// position must have: { seq, symbol, side, price, sl, tp }
// ══════════════════════════════════════════════════════════════════
function attach(position, params, savedProgress) {
    const id = String(position.seq);
    const p = _sanitizeParams(params || DSL_DEFAULTS);
    const isLong = position.side === 'LONG';

    // Compute activation target from entry price
    const activationPrice = isLong
        ? position.price * (1 + p.openDslPct / 100)
        : position.price * (1 - p.openDslPct / 100);

    const state = {
        id: id,
        userId: position.userId || null,
        symbol: position.symbol,
        side: position.side,
        entry: position.price,
        originalSL: position.sl,
        originalTP: position.tp,
        currentSL: position.sl,     // effective SL (DSL will modify this)
        params: p,
        // Phase tracking
        active: false,              // Phase 1 activated?
        activationPrice: activationPrice,
        progress: 0,                // 0-100% toward activation
        // Pivot structure (set on activation)
        pivotLeft: null,            // SL level (the one that moves on Impulse)
        pivotRight: null,           // tracking level (follows price)
        impulseVal: null,           // Impulse Validation level
        yellowLine: null,           // current price tracking
        impulseTriggered: false,    // inside Phase 3?
        // TTP (Trailing Take Profit)
        ttpArmed: false,
        ttpPeak: null,
        // History
        log: [],
        phaseChanges: 0,
    };

    // Restore persisted DSL progress (survives server restart)
    if (savedProgress && typeof savedProgress === 'object' && savedProgress.active) {
        state.active = true;
        state.progress = savedProgress.progress || 0;
        state.activationPrice = savedProgress.activationPrice || activationPrice;
        state.currentSL = savedProgress.currentSL || position.sl;
        state.pivotLeft = savedProgress.pivotLeft || null;
        state.pivotRight = savedProgress.pivotRight || null;
        state.impulseVal = savedProgress.impulseVal || null;
        state.ttpArmed = !!savedProgress.ttpArmed;
        state.ttpPeak = savedProgress.ttpPeak || null;
        state.phaseChanges = savedProgress.phaseChanges || 0;
        state.log.push({ ts: Date.now(), msg: `Restored from DB — phase=${_getPhase(state)} PL=$${(state.pivotLeft || 0).toFixed(2)}` });
    }

    _states.set(id, state);
    const restoredTag = (savedProgress && savedProgress.active) ? ' [RESTORED]' : '';
    var _slDisplay = state.currentSL || position.sl || 0;
    logger.info('DSL', `[S${id}] Attached ${position.side} ${position.symbol} @ $${position.price.toFixed(2)} | Activation: $${activationPrice.toFixed(2)} | SL: $${_slDisplay.toFixed(2)}${restoredTag}`);
    return state;
}

// ══════════════════════════════════════════════════════════════════
// tick(posId, price) — run one DSL brain cycle for a position
// Returns { currentSL, plExit, ttpExit, phase, changed }
//   plExit = true → Pivot Left hit, close position
//   ttpExit = true → Trailing TP triggered, close position
//   changed = true → SL moved (for live order update)
// ══════════════════════════════════════════════════════════════════
function tick(posId, price) {
    const id = String(posId);
    const s = _states.get(id);
    if (!s) return { currentSL: 0, plExit: false, ttpExit: false, phase: 'NONE', changed: false };

    if (!Number.isFinite(price) || price <= 0) {
        return { currentSL: s.currentSL, plExit: false, ttpExit: false, phase: _getPhase(s), changed: false };
    }

    // [ZT-AUD-008] Stamp every valid tick for freshness detection
    s.lastTickTs = Date.now();

    // [H2] Cap log length — trim oldest entries
    if (s.log.length > DSL_MAX_LOG) s.log.splice(0, s.log.length - DSL_MAX_LOG);

    const isLong = s.side === 'LONG';
    const p = s.params;
    let changed = false;
    let plExit = false;
    let ttpExit = false;

    // ── Progress toward activation ──
    const entryToTarget = isLong ? (s.activationPrice - s.entry) : (s.entry - s.activationPrice);
    const entryToCur = isLong ? (price - s.entry) : (s.entry - price);
    s.progress = entryToTarget > 0 ? Math.max(0, Math.min(100, (entryToCur / entryToTarget) * 100)) : 0;

    // ═══════════════════════════════════════════════════════
    // PHASE 1: ACTIVATION — price reaches activation target
    // ═══════════════════════════════════════════════════════
    const activationHit = isLong ? (price >= s.activationPrice) : (price <= s.activationPrice);
    if (!s.active && activationHit) {
        s.active = true;
        s.yellowLine = price;

        // Pivot Left = new SL, behind DSL anchor
        s.pivotLeft = isLong
            ? price * (1 - p.pivotLeftPct / 100)
            : price * (1 + p.pivotLeftPct / 100);

        // Pivot Right = ahead of DSL anchor
        s.pivotRight = isLong
            ? price * (1 + p.pivotRightPct / 100)
            : price * (1 - p.pivotRightPct / 100);

        // Impulse Validation = further ahead from current price
        s.impulseVal = isLong
            ? price * (1 + p.impulseVPct / 100)
            : price * (1 - p.impulseVPct / 100);

        // Safety guards
        s.pivotLeft = _safePrice(s.pivotLeft, s.originalSL);
        s.pivotRight = _safePrice(s.pivotRight, price);
        s.impulseVal = _safePrice(s.impulseVal, price);

        // Pivot Left becomes the new effective SL
        s.currentSL = s.pivotLeft;
        changed = true;

        const msg = `DSL activated @$${price.toFixed(2)} | PL=$${s.pivotLeft.toFixed(2)} PR=$${s.pivotRight.toFixed(2)} IV=$${s.impulseVal.toFixed(2)}`;
        s.log.push({ ts: Date.now(), msg });
        s.phaseChanges++;
        logger.info('DSL', `[S${s.id}] 🎯 ${msg}`);
        audit.record('DSL_ACTIVATION', { userId: s.userId, posId: s.id, symbol: s.symbol, side: s.side, price, pivotLeft: s.pivotLeft, pivotRight: s.pivotRight, impulseVal: s.impulseVal }, 'SERVER_AT');
    }

    // ═══════════════════════════════════════════════════════
    // PHASE 2: ACTIVE — track price, check PL exit
    // ═══════════════════════════════════════════════════════
    if (s.active) {
        // Yellow line tracks current price
        s.yellowLine = price;

        // Pivot Right syncs with current price
        s.pivotRight = isLong
            ? price * (1 + p.pivotRightPct / 100)
            : price * (1 - p.pivotRightPct / 100);

        // ── PIVOT LEFT EXIT CHECK ──
        // If price hits Pivot Left → close position (protection triggered)
        if (s.pivotLeft > 0) {
            const plHit = isLong ? (price <= s.pivotLeft) : (price >= s.pivotLeft);
            if (plHit) {
                plExit = true;
                const msg = `PL Exit @$${price.toFixed(2)} (PL=$${s.pivotLeft.toFixed(2)})`;
                s.log.push({ ts: Date.now(), msg });
                logger.info('DSL', `[S${s.id}] 🎯 ${msg}`);
                // Don't detach here — let caller handle exit flow
                return { currentSL: s.currentSL, plExit: true, ttpExit: false, phase: _getPhase(s), changed };
            }
        }

        // ═══════════════════════════════════════════════════════
        // PHASE 3: IMPULSE VALIDATION — PR reaches IV level
        // ═══════════════════════════════════════════════════════
        if (!Number.isFinite(s.pivotRight) || !Number.isFinite(s.impulseVal)) {
            return { currentSL: s.currentSL, plExit: false, ttpExit: false, phase: _getPhase(s), changed };
        }
        const prDistPct = Math.abs(price - s.pivotRight) / price * 100;
        const ivConditionMet = prDistPct >= 0.05 && (isLong
            ? (s.pivotRight >= s.impulseVal)
            : (s.pivotRight <= s.impulseVal));

        if (ivConditionMet) {
            if (!s.impulseTriggered) {
                s.impulseTriggered = true;

                const oldPL = s.pivotLeft;
                const oldIV = s.impulseVal;

                // Impulse Val recalculated from current price anchor
                s.impulseVal = isLong
                    ? price * (1 + p.impulseVPct / 100)
                    : price * (1 - p.impulseVPct / 100);

                // Pivot Left moves toward current price (SL tightens)
                s.pivotLeft = isLong
                    ? price * (1 - p.pivotLeftPct / 100)
                    : price * (1 + p.pivotLeftPct / 100);

                // Safety guards
                s.impulseVal = _safePrice(s.impulseVal, oldIV);
                s.pivotLeft = _safePrice(s.pivotLeft, oldPL);

                // Monotonic guard: PL can only tighten, never weaken
                if (isLong) {
                    s.pivotLeft = Math.max(oldPL, s.pivotLeft);
                } else {
                    s.pivotLeft = Math.min(oldPL, s.pivotLeft);
                }

                // Update effective SL
                if (s.currentSL !== s.pivotLeft) {
                    s.currentSL = s.pivotLeft;
                    changed = true;
                }

                s.phaseChanges++;
                const msg = `IMPULSE: PL $${oldPL.toFixed(2)}→$${s.pivotLeft.toFixed(2)} | IV $${oldIV.toFixed(2)}→$${s.impulseVal.toFixed(2)}`;
                s.log.push({ ts: Date.now(), msg });
                logger.info('DSL', `[S${s.id}] ⚡ ${msg}`);
                audit.record('DSL_IMPULSE', { userId: s.userId, posId: s.id, symbol: s.symbol, side: s.side, price, oldPL, newPL: s.pivotLeft, oldIV, newIV: s.impulseVal, phaseChanges: s.phaseChanges }, 'SERVER_AT');
            }
        } else {
            // Price left IV zone → reset for next impulse
            if (s.impulseTriggered) s.impulseTriggered = false;
        }

        // ═══════════════════════════════════════════════════════
        // TTP (Trailing Take Profit) — arms at +0.8%, trails 0.3%
        // ═══════════════════════════════════════════════════════
        const profitPct = isLong
            ? (price - s.entry) / s.entry * 100
            : (s.entry - price) / s.entry * 100;

        if (!s.ttpArmed && profitPct >= 0.8) {
            s.ttpArmed = true;
            s.ttpPeak = price;
            s.log.push({ ts: Date.now(), msg: `TTP armed @$${price.toFixed(2)} (profit ${profitPct.toFixed(2)}%)` });
            logger.info('DSL', `[S${s.id}] 📈 TTP armed @ $${price.toFixed(2)}`);
        }

        if (s.ttpArmed) {
            // Update peak
            if (isLong && price > s.ttpPeak) s.ttpPeak = price;
            if (!isLong && price < s.ttpPeak) s.ttpPeak = price;

            // Check retrace from peak
            const retracePct = isLong
                ? (s.ttpPeak - price) / s.ttpPeak * 100
                : (price - s.ttpPeak) / s.ttpPeak * 100;

            if (retracePct >= 0.3) {
                ttpExit = true;
                const msg = `TTP Exit @$${price.toFixed(2)} (peak $${s.ttpPeak.toFixed(2)}, retrace ${retracePct.toFixed(2)}%)`;
                s.log.push({ ts: Date.now(), msg });
                logger.info('DSL', `[S${s.id}] 📈 ${msg}`);
                return { currentSL: s.currentSL, plExit: false, ttpExit: true, phase: _getPhase(s), changed };
            }
        }
    }

    return { currentSL: s.currentSL, plExit, ttpExit, phase: _getPhase(s), changed };
}

// ══════════════════════════════════════════════════════════════════
// detach(posId) — clean up DSL state for a closed position
// ══════════════════════════════════════════════════════════════════
function detach(posId) {
    const id = String(posId);
    const s = _states.get(id);
    if (s) {
        logger.info('DSL', `[S${id}] Detached ${s.side} ${s.symbol} | Phase changes: ${s.phaseChanges}`);
    }
    _states.delete(id);
}

// ══════════════════════════════════════════════════════════════════
// getState(posId) — get DSL state for display / telegram
// ══════════════════════════════════════════════════════════════════
function getState(posId) {
    const id = String(posId);
    const s = _states.get(id);
    if (!s) return null;
    return {
        phase: _getPhase(s),
        active: s.active,
        progress: +s.progress.toFixed(1),
        currentSL: s.currentSL,
        originalSL: s.originalSL,
        activationPrice: s.activationPrice,
        pivotLeft: s.pivotLeft,
        pivotRight: s.pivotRight,
        impulseVal: s.impulseVal,
        ttpArmed: s.ttpArmed,
        ttpPeak: s.ttpPeak,
        phaseChanges: s.phaseChanges,
        logCount: s.log.length,
        lastLog: s.log.length > 0 ? s.log[s.log.length - 1].msg : null,
        lastTickTs: s.lastTickTs || 0, // [ZT-AUD-008] freshness timestamp
    };
}

// ══════════════════════════════════════════════════════════════════
// getAllStates() — get summary of all active DSL states
// ══════════════════════════════════════════════════════════════════
function getAllStates() {
    const out = {};
    for (const [id, s] of _states) {
        out[id] = {
            phase: _getPhase(s),
            progress: +s.progress.toFixed(1),
            currentSL: s.currentSL,
            active: s.active,
            ttpArmed: s.ttpArmed,
        };
    }
    return out;
}

// ══════════════════════════════════════════════════════════════════
// Helper
// ══════════════════════════════════════════════════════════════════
function _getPhase(s) {
    if (!s.active) return 'WAITING';
    if (s.impulseTriggered) return 'IMPULSE';
    return 'PIVOT';
}

// [RT-04] Hourly cleanup of orphan DSL states (no tick in 2 hours)
setInterval(() => {
    const cutoff = Date.now() - 7200000;
    for (const [id, s] of _states) {
        if (s.lastTickTs && s.lastTickTs < cutoff) {
            logger.info('DSL', `[S${id}] Orphan cleanup — no tick for 2h`);
            _states.delete(id);
        }
    }
}, 3600000);

module.exports = {
    attach,
    tick,
    detach,
    getState,
    getAllStates,
    DSL_DEFAULTS,
    DSL_PRESETS,
    getPreset,
};
