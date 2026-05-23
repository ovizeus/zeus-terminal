'use strict';

/**
 * OMEGA R5A Learning Core — attributionEngine (canonical §16)
 *
 * Post-trade causal attribution per ML Brain Pro Master Final Spec §16:
 *   "Scopul nu este doar win/loss. Scopul este invatarea cauzala."
 *
 * For each closed trade (or abstained decision), record:
 *   1. outcome_class — binary outcome (7 classes: WIN/LOSS/BE/TIMEOUT/MANUAL/ABSTAIN_CORRECT/ABSTAIN_WRONG)
 *   2. causal_class — process-quality classification (11 classes per spec)
 *   3. assessment — 6 boolean answers to §16 closing questions
 *
 * Proactive additions (Rule 22 — operator approved general principle of
 * "if more needs adding, add"):
 *   - setOperatorFeedback() — A-Z raid item F (operator thumb up/down feeds R5A learning)
 *   - getRecentAttributions() — query helper for OmegaPage UI + analysis
 *   - getAttributionStats() — aggregate hit-rate / avg-pnl / outcome breakdown
 *
 * Pure functions stateless except recordAttribution / setOperatorFeedback
 * which write to ml_attribution_events. All reads use prepared statements.
 *
 * Wave 2 scope: foundation skeleton. Wave 3 (R5B governance) will consume
 * these attributions for tiered promotion / quarantine decisions.
 */

const { db } = require('../../database');

// ── Enums (matched in DB CHECK constraints where possible) ──────────
const OUTCOME_CLASSES = Object.freeze([
    'WIN', 'LOSS', 'BREAKEVEN', 'TIMEOUT', 'MANUAL_CLOSE',
    'ABSTAIN_CORRECT', 'ABSTAIN_WRONG'
]);

const CAUSAL_CLASSES = Object.freeze([
    'WIN_GOOD',              // process correct + outcome positive
    'WIN_LUCKY',             // process weak + outcome positive (got lucky)
    'LOSS_GOOD',             // process correct + outcome negative (market wrong)
    'LOSS_BAD',              // process weak + outcome negative (forced/wrong)
    'GOOD_READ_BAD_TIMING',  // mfe ≫ realized pnl
    'GOOD_TIMING_BAD_MGMT',  // good entry but bad exit management
    'BAD_EXECUTION',         // slippage / fill quality ruined a valid setup
    'WRONG_CONTEXT',         // regime / macro misidentified
    'OVERSIZED',             // risk too large
    'FORCED_ENTRY',          // score too low to justify entry
    'NOT_APPLICABLE'         // ABSTAIN — no trade to attribute
]);

const ASSESSMENT_QUESTIONS = Object.freeze([
    'model_correct',
    'execution_ruined',
    'sizing_wrong',
    'regime_misidentified',
    'signal_decay_ignored',
    'macro_underestimated'
]);

// ── Thresholds (canonical-spec aligned, tuneable later) ─────────────
const SCORE_HIGH = 0.6;
const SCORE_FORCED = 0.4;
const BREAKEVEN_PCT = 0.05;
const SLIPPAGE_HEAVY = 0.3;
const RISK_HIGH = 2.0;
const GOOD_READ_RATIO = 2.5;  // mfe ≥ 2.5× |loss| → market saw operator right, timing was off

// ── Helpers ─────────────────────────────────────────────────────────
function _required(obj, key, label) {
    if (!obj || obj[key] === undefined || obj[key] === null) {
        throw new Error(`attributionEngine: missing ${label || key}`);
    }
    return obj[key];
}

// ── classifyOutcome — 7 binary outcomes ─────────────────────────────
function classifyOutcome(trade) {
    if (!trade || typeof trade !== 'object') {
        throw new Error('classifyOutcome: trade must be object');
    }

    if (trade.abstain === true) {
        // ABSTAIN — judged by counterfactual would_have_pnl
        const wp = Number(trade.would_have_pnl);
        if (!Number.isFinite(wp)) {
            throw new Error('classifyOutcome: abstain trade requires would_have_pnl');
        }
        return wp >= 0 ? 'ABSTAIN_WRONG' : 'ABSTAIN_CORRECT';
    }

    if (trade.closed_by === 'manual') return 'MANUAL_CLOSE';
    if (trade.closed_by === 'timeout') return 'TIMEOUT';

    const pnl = Number(trade.pnl_pct);
    if (!Number.isFinite(pnl)) {
        throw new Error('classifyOutcome: pnl_pct required for non-abstain trade');
    }
    if (Math.abs(pnl) < BREAKEVEN_PCT) return 'BREAKEVEN';
    return pnl > 0 ? 'WIN' : 'LOSS';
}

// ── classifyCausal — 11 spec classes ────────────────────────────────
function classifyCausal(trade, snapshot) {
    if (!trade) throw new Error('classifyCausal: trade required');
    if (trade.abstain === true) return 'NOT_APPLICABLE';

    const outcome = classifyOutcome(trade);
    if (outcome === 'MANUAL_CLOSE' || outcome === 'TIMEOUT' || outcome === 'BREAKEVEN') {
        // These outcomes are ambiguous for causal; use simple heuristic via score
        const sc = Number(trade.score_at_entry);
        if (Number.isFinite(sc) && sc < SCORE_FORCED) return 'FORCED_ENTRY';
        return 'NOT_APPLICABLE';
    }

    const score = Number(trade.score_at_entry);
    const slip = Number(trade.slippage_pct);
    const risk = Number(trade.risk_pct);
    const snap = snapshot || {};
    const mfe = Number(snap.mfe);
    const mae = Number(snap.mae);
    const pnl = Number(trade.pnl_pct);

    // High slippage trumps other classifications
    if (Number.isFinite(slip) && slip > SLIPPAGE_HEAVY) return 'BAD_EXECUTION';
    // Forced entry trumps outcome
    if (Number.isFinite(score) && score < SCORE_FORCED) return 'FORCED_ENTRY';
    // Oversized risk
    if (Number.isFinite(risk) && risk > RISK_HIGH) return 'OVERSIZED';

    if (outcome === 'WIN') {
        if (Number.isFinite(score) && score >= SCORE_HIGH) return 'WIN_GOOD';
        return 'WIN_LUCKY';
    }
    // outcome === 'LOSS'
    // Check for "good read, bad timing" — mfe much larger than realized loss
    if (Number.isFinite(mfe) && Number.isFinite(pnl) && mfe >= Math.abs(pnl) * GOOD_READ_RATIO) {
        return 'GOOD_READ_BAD_TIMING';
    }
    if (Number.isFinite(score) && score >= SCORE_HIGH) return 'LOSS_GOOD';
    return 'LOSS_BAD';
}

// ── assessQuestions — 6 booleans per §16 closing block ──────────────
function assessQuestions(trade, snapshot) {
    if (!trade) throw new Error('assessQuestions: trade required');
    const snap = snapshot || {};
    const outcome = trade.abstain ? null : classifyOutcome(trade);
    const score = Number(trade.score_at_entry);
    const slip = Number(trade.slippage_pct);
    const risk = Number(trade.risk_pct);
    const mfe = Number(snap.mfe);
    const pnl = Number(trade.pnl_pct);

    return {
        // Was the model correct? (score high AND outcome positive — or correct abstain)
        model_correct:
            (outcome === 'WIN' || outcome === 'ABSTAIN_CORRECT') &&
            (!Number.isFinite(score) || score >= SCORE_HIGH),
        // Did execution ruin the trade? (heavy slippage)
        execution_ruined: Number.isFinite(slip) && slip > SLIPPAGE_HEAVY,
        // Was sizing wrong? (risk above threshold)
        sizing_wrong: Number.isFinite(risk) && risk > RISK_HIGH,
        // Was regime misidentified? (loss after high-score entry where mfe never paid)
        regime_misidentified:
            outcome === 'LOSS' && Number.isFinite(mfe) && Number.isFinite(pnl) &&
            mfe < Math.abs(pnl) * 0.5,
        // Was signal decay ignored? (high MFE then full reversal to SL)
        signal_decay_ignored:
            outcome === 'LOSS' && Number.isFinite(mfe) && Number.isFinite(pnl) &&
            mfe >= Math.abs(pnl) * GOOD_READ_RATIO,
        // Was macro underestimated? (low macro_score in snapshot AND adverse outcome)
        macro_underestimated:
            outcome === 'LOSS' && Number.isFinite(Number(snap.macro_score)) &&
            Number(snap.macro_score) < 0.4
    };
}

// ── recordAttribution — orchestrator ────────────────────────────────
const _stmts = {
    // [§17 extended 2026-05-15] adds regime/session/score/mfe/mae/slippage/time/side
    insert: db.prepare(`
        INSERT INTO ml_attribution_events
        (decision_digest, user_id, resolved_env, symbol, pos_id,
         outcome_class, r_multiple, pnl_pct, operator_feedback,
         causal_class, assessment_json,
         regime, session, score_at_entry, mfe_pct, mae_pct,
         slippage_pct, time_in_trade_min, side,
         attributed_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    setFeedback: db.prepare(`
        UPDATE ml_attribution_events SET operator_feedback = ? WHERE id = ?
    `),
    getById: db.prepare(`SELECT * FROM ml_attribution_events WHERE id = ?`),
    getRecent: db.prepare(`
        SELECT * FROM ml_attribution_events
        WHERE user_id = ? AND resolved_env = ?
        ORDER BY attributed_at DESC
        LIMIT ?
    `),
    statsCount: db.prepare(`
        SELECT COUNT(*) AS n FROM ml_attribution_events
        WHERE user_id = ? AND resolved_env = ? AND attributed_at >= ?
    `),
    statsAggregate: db.prepare(`
        SELECT
            COUNT(*) AS total_count,
            AVG(pnl_pct) AS avg_pnl_pct,
            SUM(CASE WHEN outcome_class = 'WIN' THEN 1 ELSE 0 END) AS wins,
            SUM(CASE WHEN outcome_class IN ('WIN', 'LOSS') THEN 1 ELSE 0 END) AS decisive
        FROM ml_attribution_events
        WHERE user_id = ? AND resolved_env = ? AND attributed_at >= ?
    `),
    statsBreakdown: db.prepare(`
        SELECT outcome_class, COUNT(*) AS n FROM ml_attribution_events
        WHERE user_id = ? AND resolved_env = ? AND attributed_at >= ?
        GROUP BY outcome_class
    `)
};

function recordAttribution(params) {
    const userId = _required(params, 'userId');
    const resolvedEnv = _required(params, 'resolvedEnv');
    const trade = _required(params, 'trade');
    const snapshot = params.snapshot || {};

    const outcome = classifyOutcome(trade);
    const causal = classifyCausal(trade, snapshot);
    const assessment = assessQuestions(trade, snapshot);

    if (!OUTCOME_CLASSES.includes(outcome)) {
        throw new Error(`recordAttribution: invalid outcome ${outcome}`);
    }
    if (!CAUSAL_CLASSES.includes(causal)) {
        throw new Error(`recordAttribution: invalid causal ${causal}`);
    }

    // [§17 extended] extract regime metrics fields from trade + snapshot
    const numOrNull = v => (v === undefined || v === null || !Number.isFinite(Number(v))) ? null : Number(v);
    const regime = snapshot.regime || trade.regime || null;
    const session = snapshot.session || trade.session || null;
    const score_at_entry = numOrNull(trade.score_at_entry);
    const mfe_pct = numOrNull(snapshot.mfe !== undefined ? snapshot.mfe : trade.mfe_pct);
    const mae_pct = numOrNull(snapshot.mae !== undefined ? snapshot.mae : trade.mae_pct);
    const slippage_pct = numOrNull(trade.slippage_pct);
    const time_in_trade_min = numOrNull(trade.time_in_trade_min);
    const side = trade.side || null;

    const result = _stmts.insert.run(
        snapshot.decision_digest || trade.decision_digest || `omega_attr_${Date.now()}`,
        userId,
        resolvedEnv,
        trade.symbol || 'UNKNOWN',
        trade.pos_id || null,
        outcome,
        trade.r_multiple !== undefined ? trade.r_multiple : null,
        trade.pnl_pct !== undefined ? trade.pnl_pct : (trade.would_have_pnl !== undefined ? trade.would_have_pnl : null),
        null,  // operator_feedback set later via setOperatorFeedback
        causal,
        JSON.stringify(assessment),
        regime, session, score_at_entry, mfe_pct, mae_pct,
        slippage_pct, time_in_trade_min, side,
        Date.now()
    );
    return { id: result.lastInsertRowid, outcome_class: outcome, causal_class: causal };
}

// ── setOperatorFeedback — A-Z raid item F ───────────────────────────
function setOperatorFeedback(params) {
    const id = _required(params, 'id');
    const feedback = params.feedback;
    if (feedback !== null && ![1, -1, 0].includes(feedback)) {
        throw new Error('setOperatorFeedback: feedback must be 1 / -1 / 0 / null');
    }
    _stmts.setFeedback.run(feedback, id);
}

// ── getRecentAttributions — query helper ────────────────────────────
function getRecentAttributions(params) {
    const userId = _required(params, 'userId');
    const resolvedEnv = _required(params, 'resolvedEnv');
    const limit = Math.max(1, Math.min(500, params.limit || 50));
    return _stmts.getRecent.all(userId, resolvedEnv, limit);
}

// ── getAttributionStats — aggregate ─────────────────────────────────
function getAttributionStats(params) {
    const userId = _required(params, 'userId');
    const resolvedEnv = _required(params, 'resolvedEnv');
    const sinceMs = params.sinceMs || 0;
    const agg = _stmts.statsAggregate.get(userId, resolvedEnv, sinceMs);
    const total = agg.total_count || 0;
    const decisive = agg.decisive || 0;
    const breakdownRows = _stmts.statsBreakdown.all(userId, resolvedEnv, sinceMs);
    const outcome_breakdown = {};
    for (const r of breakdownRows) outcome_breakdown[r.outcome_class] = r.n;
    return {
        total_count: total,
        hit_rate: decisive > 0 ? (agg.wins || 0) / decisive : 0,
        avg_pnl_pct: agg.avg_pnl_pct || 0,
        outcome_breakdown
    };
}

module.exports = {
    classifyOutcome,
    classifyCausal,
    assessQuestions,
    recordAttribution,
    setOperatorFeedback,
    getRecentAttributions,
    getAttributionStats,
    OUTCOME_CLASSES,
    CAUSAL_CLASSES,
    ASSESSMENT_QUESTIONS
};
