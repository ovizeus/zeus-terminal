'use strict';

/**
 * ML Plan v3 Phase B Day 13 — R5A-driven mlBrainProInputs builder.
 *
 * Build the contributions array fed to influenceProposer. Maps Phase 2 fusion
 * modifiers (per-module multiplicative deltas applied during _computeFusion)
 * to signed contributions for the proposer:
 *
 *   modifier > 1.0  → module wants to BOOST confidence → contribution = +(mod-1.0)
 *   modifier < 1.0  → module wants to CUT confidence    → contribution = (mod-1.0)
 *   modifier == 1.0 → module neutral                     → contribution = 0
 *
 * Modifiers tracked in fusion._intermediates.modifiers (per serverBrain.js):
 *   structure, liquidity, liqAnticipation, journal, knn,
 *   session, volatility, tilt, trapRisk, regimeDanger
 *
 * Secondary signal — score components (0..1 raw signals from each fusion
 * source) are ALSO included for additional context when modifiers are mostly
 * neutral. Mapping: contribution = clamp((score - 0.5) * 2, -1, +1).
 *
 * Contract:
 *   build(fusion) → { contributions: [{moduleId, contribution}] } | null
 *     - null when fusion missing _intermediates entirely OR neither modifiers
 *       nor score components are usable
 */

const MODIFIER_KEYS = Object.freeze([
    'structure', 'liquidity', 'liqAnticipation',
    'journal', 'knn', 'session', 'volatility',
    'tilt', 'trapRisk', 'regimeDanger'
]);

const SCORE_KEYS = Object.freeze([
    ['fus_regime', 'fusRegimeScore'],
    ['fus_alignment', 'fusAlignScore'],
    ['fus_indicator', 'fusIndScore'],
    ['fus_mtf', 'fusMtfScore'],
    ['fus_structure', 'fusStructScore'],
    ['fus_flow', 'fusFlowScore'],
    ['fus_sentiment', 'fusSentScore']
]);

function _clamp(x, lo, hi) {
    return Math.max(lo, Math.min(hi, x));
}

function build(fusion) {
    if (!fusion || typeof fusion !== 'object' || !fusion._intermediates) return null;
    const i = fusion._intermediates;
    const contributions = [];

    // Primary: R5A modifiers (signed deltas applied to fusion confidence).
    const mods = i.modifiers && typeof i.modifiers === 'object' ? i.modifiers : null;
    if (mods) {
        for (const key of MODIFIER_KEYS) {
            const val = mods[key];
            if (typeof val !== 'number' || !isFinite(val)) continue;
            const signed = _clamp(val - 1.0, -1, 1);
            contributions.push({ moduleId: 'mod_' + key, contribution: signed });
        }
    }

    // Secondary: raw fusion score components (0..1 → -1..+1).
    for (const [moduleId, scoreKey] of SCORE_KEYS) {
        const val = i[scoreKey];
        if (typeof val !== 'number' || !isFinite(val)) continue;
        const signed = _clamp((val - 0.5) * 2, -1, 1);
        contributions.push({ moduleId, contribution: signed });
    }

    return contributions.length > 0 ? { contributions } : null;
}

module.exports = { build, MODIFIER_KEYS, SCORE_KEYS };
