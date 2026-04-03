// Zeus Terminal — Brain Decision Logger (ML Data Layer)
// Pure observer: captures decision snapshots for ML training data.
// NEVER feeds values back into the decision pipeline.
// Every call is wrapped in try/catch — logging failure must never crash Brain.
'use strict';

const crypto = require('crypto');
const logger = require('./logger');
const db = require('./database');

// ── No-trade dedup state (per symbol) ──
const _lastNoTrade = new Map(); // symbol → { ts, confScore, regime, gateKey, ddTier }
const HEARTBEAT_INTERVAL = 10; // store heartbeat every N cycles

// ══════════════════════════════════════════════════════════════════
// Snapshot ID
// ══════════════════════════════════════════════════════════════════
function _genSnapId() {
    return crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex');
}

// ══════════════════════════════════════════════════════════════════
// No-trade sampling — should we store this no-trade?
// ══════════════════════════════════════════════════════════════════
function _shouldStoreNoTrade(symbol, fields, cycle) {
    // Always store near-misses
    if (fields.finalConfidence >= 50) return true;
    // Always store high-signal confluence
    if (fields.confScore >= 60) return true;

    const prev = _lastNoTrade.get(symbol);

    // Heartbeat: every 10 cycles
    if (!prev || (cycle - (prev.cycle || 0)) >= HEARTBEAT_INTERVAL) return true;

    // Regime change
    if (prev.regime !== fields.regime) return true;

    // Gate state flip
    const gateKey = fields.gateAllOk ? '1' : '0';
    if (prev.gateKey !== gateKey) return true;

    // Drawdown tier change
    if (prev.ddTier && fields.ddTier && prev.ddTier !== fields.ddTier) return true;

    return false;
}

function _updateNoTradeState(symbol, fields, cycle) {
    _lastNoTrade.set(symbol, {
        ts: fields.ts,
        confScore: fields.confScore,
        regime: fields.regime,
        gateKey: fields.gateAllOk ? '1' : '0',
        ddTier: fields.ddTier || null,
        cycle,
    });
}

// ══════════════════════════════════════════════════════════════════
// Log a brain decision snapshot
// ══════════════════════════════════════════════════════════════════

/**
 * @param {object} fields - All snapshot fields (see schema in roadmap)
 * @returns {string|null} snapId if stored, null if skipped
 */
function logDecision(fields) {
    try {
        if (!fields || !fields.userId || !fields.symbol) return null;

        const sourcePath = fields.sourcePath || 'unknown';
        const finalTier = fields.finalTier || 'NO_TRADE';
        const finalAction = fields.finalAction || 'unknown';
        const cycle = fields.cycle || 0;

        // No-trade sampling
        if (finalTier === 'NO_TRADE' || finalAction.startsWith('blocked_')) {
            if (!_shouldStoreNoTrade(fields.symbol, fields, cycle)) return null;
            _updateNoTradeState(fields.symbol, fields, cycle);
        }

        const snapId = _genSnapId();

        db.bdInsert(
            snapId,
            fields.userId,
            fields.symbol,
            fields.ts || Date.now(),
            cycle,
            sourcePath,
            finalTier,
            fields.finalConfidence || 0,
            fields.finalDir || 'neutral',
            finalAction,
            fields.linkedSeq || null,
            fields  // full snapshot as JSON blob
        );

        return snapId;
    } catch (err) {
        // Logger failure must NEVER crash Brain
        try { logger.error('BRAIN_LOG', 'logDecision failed: ' + err.message); } catch (_) {}
        return null;
    }
}

// ══════════════════════════════════════════════════════════════════
// Link a decision to a trade outcome
// ══════════════════════════════════════════════════════════════════

/**
 * Link a snapId to a position seq (called when AT creates an entry).
 */
function linkSeq(snapId, seq) {
    try {
        if (!snapId || !seq) return;
        db.bdLinkSeq(snapId, seq);
    } catch (err) {
        try { logger.error('BRAIN_LOG', 'linkSeq failed: ' + err.message); } catch (_) {}
    }
}

/**
 * Attach trade outcome to a decision snapshot (called on trade close).
 */
function linkOutcome(snapId, outcome) {
    try {
        if (!snapId) return;
        const row = db.bdGetBySnap(snapId);
        if (!row) return;
        const data = row.data || {};
        data.outcomePnl = outcome.pnl;
        data.outcomeMae = outcome.mae;
        data.outcomeMfe = outcome.mfe;
        data.outcomeHoldMin = outcome.holdMin;
        data.outcomeCapturedPct = outcome.capturedPct;
        data.outcomeCloseReason = outcome.closeReason;
        data.outcomeLabel = outcome.pnl > 0 ? 'win' : 'loss';
        db.bdUpdateData(snapId, data);
    } catch (err) {
        try { logger.error('BRAIN_LOG', 'linkOutcome failed: ' + err.message); } catch (_) {}
    }
}

/**
 * Link outcome by seq (when snapId is not available but seq is known).
 */
function linkOutcomeBySeq(seq, outcome) {
    try {
        if (!seq) return;
        const rows = db.bdGetBySeq(seq);
        if (!rows || rows.length === 0) return;
        for (const row of rows) {
            linkOutcome(row.snap_id, outcome);
        }
    } catch (err) {
        try { logger.error('BRAIN_LOG', 'linkOutcomeBySeq failed: ' + err.message); } catch (_) {}
    }
}

/**
 * Update action (e.g., pending_expire).
 */
function updateAction(snapId, action) {
    try {
        if (!snapId || !action) return;
        db.bdUpdateAction(snapId, action);
    } catch (err) {
        try { logger.error('BRAIN_LOG', 'updateAction failed: ' + err.message); } catch (_) {}
    }
}

/**
 * Run retention cleanup (call daily).
 */
function prune() {
    try {
        db.bdPrune();
    } catch (err) {
        try { logger.error('BRAIN_LOG', 'prune failed: ' + err.message); } catch (_) {}
    }
}

/**
 * Get snapshot counts by action (for monitoring).
 */
function getCounts() {
    try {
        return db.bdCount();
    } catch (_) {
        return [];
    }
}

module.exports = {
    logDecision,
    linkSeq,
    linkOutcome,
    linkOutcomeBySeq,
    updateAction,
    prune,
    getCounts,
};
