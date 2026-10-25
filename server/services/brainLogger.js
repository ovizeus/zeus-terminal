// Zeus Terminal — Brain Decision Logger (ML Data Layer)
// Pure observer: captures decision snapshots for ML training data.
// NEVER feeds values back into the decision pipeline.
// Every call is wrapped in try/catch — logging failure must never crash Brain.
'use strict';

const crypto = require('crypto');
const logger = require('./logger');
const db = require('./database');
const MF = require('../migrationFlags');
// [G-6 2026-10-25] What each final_action name MEANS, in one place.
// The ML event label below asks this instead of reading the name's shape.
const _BRAIN_ACTIONS = require('./brainActions');

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

        // No-trade sampling.
        //
        // [G-6 2026-10-25] This prefix test is DELIBERATELY left alone, even
        // though the label site twenty lines below stopped using it.
        // entry_blocked does not match it, so every autotrade rejection is
        // stored unsampled — and that is the behaviour worth keeping:
        //
        //   _shouldStoreNoTrade keeps everything at confidence >= 50, and
        //   52,893 of 54,268 entry_blocked rows (97.5%) are at >= 50. So
        //   routing them through the sampler would change at most 2.5% of
        //   them, and those 2.5% are rejections on the money path — the rows
        //   most worth having.
        //
        // Do not "make this consistent" with the label. Consistency here costs
        // money-path detail and buys nothing measurable.
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
            fields,  // full snapshot as JSON blob
            fields.resolvedEnv || 'DEMO'
        );

        let _decisionDigest = null;

        // ── ML Ingest: write to ml_decision_snapshots + ml_decision_light ──
        // Gated by ML_INGEST_ENABLED flag. Never crashes brain — fully isolated try/catch.
        if (MF.ML_INGEST_ENABLED) {
            try {
                const ts = fields.ts || Date.now();
                const userId = fields.userId;
                const symbol = fields.symbol;

                // decision_digest: MD5 of userId:symbol:cycle:ts
                const digest = crypto
                    .createHash('md5')
                    .update(`${userId}:${symbol}:${cycle}:${ts}`)
                    .digest('hex');
                _decisionDigest = digest;

                // Resolve env: prefer fields.resolvedEnv, fall back to 'DEMO'
                const resolvedEnv = (fields.resolvedEnv === 'TESTNET' || fields.resolvedEnv === 'REAL')
                    ? fields.resolvedEnv
                    : 'DEMO';

                // [G-6 2026-10-25] The label answers one question — did this
                // decision become a trade? — and it asks the classification,
                // not the shape of the name.
                //
                // It used to be `finalAction.startsWith('blocked_')`, which
                // entry_blocked does not match even though autotrade had just
                // refused the entry. So entry_blocked, pending_created and
                // pending_expire all fell through to TRADE. Applying that rule
                // over brain_decisions: 181,135 rows labelled TRADE, of which
                // 1,683 are trades. 0.93%.
                //
                // isHistory() is the right question because those are exactly
                // the three actions that can carry a linked_seq, i.e. that can
                // point at a real position. Anything else did not trade.
                // An unclassified name falls on ABSTAIN_CRITIC — fails safe,
                // and the classification test fails loudly in CI.
                //
                // NOTE this changes no behaviour: snapshot_event_type has no
                // reader anywhere in server/ or client/ — it is written,
                // indexed and CHECK-constrained, and never queried. See G-6.
                let eventType;
                if (finalTier === 'NO_TRADE' || !_BRAIN_ACTIONS.isHistory(finalAction)) {
                    eventType = 'ABSTAIN_CRITIC';
                } else if (fields.finalConfidence >= 50 && fields.finalConfidence < 60) {
                    eventType = 'NEAR_THRESHOLD';
                } else {
                    eventType = 'TRADE';
                }

                // ml_decision_snapshots
                db.db.prepare(
                    'INSERT OR IGNORE INTO ml_decision_snapshots ' +
                    '(user_id, resolved_env, symbol, snapshot_event_type, decision_digest, ' +
                    'snapshot_json, registry_digest, created_at) ' +
                    'VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
                ).run(
                    userId,
                    resolvedEnv,
                    symbol,
                    eventType,
                    digest,
                    JSON.stringify(fields),
                    snapId,   // use snapId as registry_digest placeholder
                    ts
                );

                // ml_decision_light
                db.db.prepare(
                    'INSERT OR IGNORE INTO ml_decision_light ' +
                    '(user_id, resolved_env, symbol, decision_digest, score, reason_code, created_at) ' +
                    'VALUES (?, ?, ?, ?, ?, ?, ?)'
                ).run(
                    userId,
                    resolvedEnv,
                    symbol,
                    digest,
                    fields.finalConfidence || 0,
                    finalAction,
                    ts
                );

                // [Wave 1] R0 point-in-time store — full decision snapshot for deterministic replay.
                try {
                    const pit = require('./ml/R0_substrate/pointInTimeStore');
                    pit.recordSnapshot({
                        userId: fields.userId,
                        resolvedEnv: fields.resolvedEnv || 'DEMO',
                        snapshotType: 'decision',
                        ts: fields.ts || Date.now(),
                        marketState: { symbol: fields.symbol, price: fields.price, regime: fields.regime },
                        featureState: fields.indicators ? { indicators: fields.indicators } : null,
                        modelOutput: { score: fields.score, dir: fields.dir, tier: fields.finalTier, action: fields.finalAction },
                        scores: fields.scores || null,
                        orderIntent: fields.orderIntent || null,
                    });
                } catch (_) { /* never block brain logger on PIT store */ }
            } catch (mlErr) {
                // ML write failure must NEVER crash Brain — silently swallow
                try { logger.error('BRAIN_LOG', 'ML_INGEST write failed: ' + mlErr.message); } catch (_) {}
            }
        }

        return { snapId, digest: _decisionDigest };
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
    // [G-5 2026-10-25] bdPrune is async now — batched + yielding, so a single
    // DELETE can no longer hold the event loop for seconds. Fire-and-forget
    // with a .catch, same shape as the parity prune in serverBrain.js; the
    // caller is a maintenance timer with nothing to wait for.
    try {
        db.bdPrune().then((r) => {
            // [G-7] pending_terminal is in the guard as well as the message:
            // once the older tiers reach steady state, a run that removed only
            // pending rows would otherwise have done it in silence.
            if (r && (r.no_trade || r.blocked || r.trade || r.pending_terminal)) {
                try {
                    logger.info('BRAIN_LOG',
                        `[G-5] brain_decisions prune: no_trade=${r.no_trade} blocked=${r.blocked}`
                        + ` trade=${r.trade} pending_terminal=${r.pending_terminal}`);
                } catch (_) {}
            }
        }).catch((err) => {
            try { logger.error('BRAIN_LOG', 'prune failed: ' + err.message); } catch (_) {}
        });
    } catch (err) {
        try { logger.error('BRAIN_LOG', 'prune failed (sync): ' + err.message); } catch (_) {}
    }
    // [AUDIT-F1/F2 2026-06-11] Retention for the two previously-unbounded ML
    // tables — separate try/catch so a failure in one never skips the others.
    try { db.mlAuditPrune(); } catch (e) { try { logger.error('BRAIN_LOG', 'mlAuditPrune failed: ' + e.message); } catch (_) {} }
    try { db.parityPrune(); } catch (e) { try { logger.error('BRAIN_LOG', 'parityPrune failed: ' + e.message); } catch (_) {} }
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
