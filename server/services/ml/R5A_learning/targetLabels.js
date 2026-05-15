'use strict';

/**
 * OMEGA R5A Learning Core — targetLabels (canonical §11)
 *
 * "Brain-ul trebuie sa aiba definit explicit ce prezice."
 *
 * Defines the canonical vocabulary the brain works against:
 *   §11.A — TARGET principal (3 alternative formulations)
 *   §11.B — FORECAST horizon (4 levels)
 *   §11.C — LABELS corecte (7 classes)
 *   §11.D — OUTPUT obligatoriu (5 actions)
 *
 * Pure logic: enums + classifier + validator. No DB writes, no migrations.
 * Other rings consume these via `require` to ensure label/output vocab
 * is identical everywhere.
 *
 * classifyLabel derives label from existing trade fields. Future evolution:
 * when Wave 3 ships per-decision feature snapshots and setup_type is reliably
 * captured at entry, fake_breakout / reclaim_valid become first-class. For
 * Wave 2 skeleton we use setup_type if provided, fall back to heuristics.
 */

// ── §11.A TARGET principal ──────────────────────────────────────────
const TARGET_FORMULATIONS = Object.freeze([
    'p_tp_before_sl',                       // P(setup atinge TP înainte de SL)
    'p_x_atr_in_y_window',                  // P(mișcare favorabilă de X ATR în Y minute/ore)
    'p_directional_confirm_after_costs'     // P(direcție anticipată se confirmă după costuri reale)
]);

// ── §11.B FORECAST horizon ──────────────────────────────────────────
const FORECAST_HORIZONS = Object.freeze([
    'ultra-short',   // seconds-minutes
    'short',          // minutes
    'intraday',       // hours
    'swing-short'     // multi-hour to days
]);

// ── §11.C LABELS corecte ────────────────────────────────────────────
const LABELS = Object.freeze([
    'win_structural',
    'loss_structural',
    'invalidated_quick',
    'stagnation_no_follow',
    'fake_breakout',
    'reclaim_valid',
    'no_edge_no_trade'
]);

// ── §11.D OUTPUT obligatoriu ────────────────────────────────────────
const OUTPUT_ACTIONS = Object.freeze([
    'LONG',
    'SHORT',
    'NO_TRADE',
    'WAIT',
    'EXIT'
]);

// ── Thresholds (spec-aligned, shared with §16 attribution) ──────────
const SCORE_HIGH = 0.6;
const QUICK_INVALIDATE_MIN = 5;        // <= 5 min stop = invalidated_quick
const STAGNATION_MAX_MFE = 0.2;        // MFE under 0.2% w/ no follow-through
const FAKE_BREAKOUT_MAX_TIME = 15;     // breakout reversing in < 15 min
const FAKE_BREAKOUT_MAX_MFE = 0.15;

// ── classifyLabel ───────────────────────────────────────────────────
function classifyLabel(trade, snapshot) {
    if (!trade || typeof trade !== 'object') {
        throw new Error('classifyLabel: trade required');
    }
    if (trade.abstain === true) return 'no_edge_no_trade';

    const snap = snapshot || {};
    const pnl = Number(trade.pnl_pct);
    const score = Number(trade.score_at_entry);
    const timeIn = Number(trade.time_in_trade_min);
    const mfe = Number(snap.mfe !== undefined ? snap.mfe : trade.mfe_pct);
    const setupType = (trade.setup_type || snap.setup_type || '').toLowerCase();

    const isWin = Number.isFinite(pnl) && pnl > 0.05;
    const isLoss = Number.isFinite(pnl) && pnl < -0.05;
    const isBE = Number.isFinite(pnl) && Math.abs(pnl) <= 0.05;
    const isQuick = Number.isFinite(timeIn) && timeIn <= QUICK_INVALIDATE_MIN;
    const lowMFE = Number.isFinite(mfe) && mfe <= STAGNATION_MAX_MFE;
    const highScore = Number.isFinite(score) && score >= SCORE_HIGH;

    // Setup-specific labels take priority when setup_type is explicit
    if (setupType === 'breakout' && isLoss &&
        Number.isFinite(timeIn) && timeIn <= FAKE_BREAKOUT_MAX_TIME &&
        Number.isFinite(mfe) && mfe <= FAKE_BREAKOUT_MAX_MFE) {
        return 'fake_breakout';
    }
    if (setupType === 'reclaim' && isWin) {
        return 'reclaim_valid';
    }

    // Quick invalidation
    if (isLoss && isQuick) return 'invalidated_quick';

    // Stagnation: BREAKEVEN-only — no clear directional move either way.
    // Pure losses (even with low MFE) belong to loss_structural, not stagnation.
    if (isBE && lowMFE && Number.isFinite(timeIn) && timeIn >= 30) {
        return 'stagnation_no_follow';
    }

    // Default structural win/loss buckets
    if (isWin) return 'win_structural';
    if (isLoss) return 'loss_structural';

    // Fallback for BE / unclear outcomes
    return 'stagnation_no_follow';
}

// ── Output validators ───────────────────────────────────────────────
function isValidAction(action) {
    return typeof action === 'string' && OUTPUT_ACTIONS.includes(action);
}

function validateOutput(action) {
    if (!isValidAction(action)) {
        throw new Error(`validateOutput: "${action}" not in OUTPUT_ACTIONS (${OUTPUT_ACTIONS.join('|')})`);
    }
    return true;
}

module.exports = {
    TARGET_FORMULATIONS,
    FORECAST_HORIZONS,
    LABELS,
    OUTPUT_ACTIONS,
    classifyLabel,
    validateOutput,
    isValidAction
};
