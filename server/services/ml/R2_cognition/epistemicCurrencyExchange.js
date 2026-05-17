'use strict';

/**
 * OMEGA Wave 3 §170 — EPISTEMIC CURRENCY EXCHANGE / CROSS-FRAME SETTLEMENT.
 *
 * Canonical PDF §170 (ml_brain_canonic.txt lines 5621-5669).
 *
 * "cum compar un argument statistic cu unul cauzal si cu unul narrativ
 *  fara sa le amestec prost?"
 *
 * 6 canonical evidence currencies (PDF lines 5639-5644):
 *   probability_evidence (POS) — statistical confidence
 *   causal_force (POS)         — strength of causal argument
 *   narrative_coherence (POS)  — story integrity
 *   information_gain (POS)     — how much novel info this delivers
 *   adversarial_pressure (NEG) — pressure from adversarial signals
 *   risk_of_being_wrong (NEG)  — explicit confidence-of-confidence
 *
 * Settlement = weighted composite (POS contributions + (1 - NEG)
 * contributions). Equal 1/6 weights as default.
 *
 * Commensurability = 1 - std/max — how aligned are the frames. If
 * spread between currencies is large, frames are incommensurable.
 *
 * Per PDF rule 5663-5665: "weak conversion → mark incommensurability,
 * not invent false equivalents." When flag=1, caller must NOT pretend
 * convergence.
 *
 * Dominant currency identification:
 *   - if any currency > DOMINANT_THRESHOLD (0.40) AND clearly higher
 *     than others (gap > 0.10) → that currency
 *   - else multi_balanced
 *
 * Plasare R2_cognition pentru integrare cu §59 utility, §70 evidence
 * sufficiency, §71 internal debate, §76 counterfactual baseline.
 *
 * Per-(user × resolved_env) isolated. Server-only.
 */

const { db } = require('../../database');

const EVIDENCE_CURRENCIES = Object.freeze([
    'probability_evidence', 'causal_force',
    'narrative_coherence', 'information_gain',
    'adversarial_pressure', 'risk_of_being_wrong'
]);
const DOMINANT_CURRENCIES = Object.freeze([
    ...EVIDENCE_CURRENCIES, 'multi_balanced'
]);
const INVERTED_CURRENCIES = Object.freeze([
    'adversarial_pressure', 'risk_of_being_wrong'
]);

const SETTLEMENT_WEIGHTS = Object.freeze({
    probability_evidence: 1 / 6,
    causal_force: 1 / 6,
    narrative_coherence: 1 / 6,
    information_gain: 1 / 6,
    adversarial_pressure: 1 / 6,
    risk_of_being_wrong: 1 / 6
});

const INCOMMENSURABILITY_THRESHOLD = 0.30;
const DOMINANT_THRESHOLD = 0.40;
const DOMINANT_GAP = 0.10;

const CAMEL_TO_SNAKE = Object.freeze({
    probabilityEvidence: 'probability_evidence',
    causalForce: 'causal_force',
    narrativeCoherence: 'narrative_coherence',
    informationGain: 'information_gain',
    adversarialPressure: 'adversarial_pressure',
    riskOfBeingWrong: 'risk_of_being_wrong'
});
const SNAKE_TO_CAMEL = Object.freeze({
    probability_evidence: 'probabilityEvidence',
    causal_force: 'causalForce',
    narrative_coherence: 'narrativeCoherence',
    information_gain: 'informationGain',
    adversarial_pressure: 'adversarialPressure',
    risk_of_being_wrong: 'riskOfBeingWrong'
});

const RESOLVED_ENVS = new Set(['DEMO', 'TESTNET', 'REAL']);

function _required(params, key) {
    if (params == null || params[key] == null) {
        throw new Error(`§170 missing required param: ${key}`);
    }
    return params[key];
}
function _requireEnv(env) {
    if (!RESOLVED_ENVS.has(env)) {
        throw new Error(`§170 invalid resolvedEnv: ${env}`);
    }
    return env;
}
function _validateCurrencies(currencies) {
    for (const camelKey of Object.keys(CAMEL_TO_SNAKE)) {
        if (currencies[camelKey] === undefined || currencies[camelKey] === null) {
            throw new Error(`§170 missing currency: ${camelKey}`);
        }
        const v = currencies[camelKey];
        if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 1) {
            throw new Error(`§170 ${camelKey} must be in [0,1], got ${v}`);
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PURE FUNCTIONS
// ──────────────────────────────────────────────────────────────────────────

function computeSettlementScore(params) {
    const currencies = _required(params, 'currencies');
    _validateCurrencies(currencies);
    let composite = 0;
    for (const camelKey of Object.keys(CAMEL_TO_SNAKE)) {
        const snakeKey = CAMEL_TO_SNAKE[camelKey];
        const contribution = INVERTED_CURRENCIES.includes(snakeKey)
            ? (1 - currencies[camelKey])
            : currencies[camelKey];
        composite += contribution * SETTLEMENT_WEIGHTS[snakeKey];
    }
    const clamped = Math.max(0, Math.min(1, composite));
    return { settlementScore: clamped };
}

function computeCommensurabilityScore(params) {
    const currencies = _required(params, 'currencies');
    _validateCurrencies(currencies);
    // Normalize inverted currencies before measuring spread so all
    // currencies are in the same "positive" direction.
    const values = [];
    for (const camelKey of Object.keys(CAMEL_TO_SNAKE)) {
        const snakeKey = CAMEL_TO_SNAKE[camelKey];
        const adjusted = INVERTED_CURRENCIES.includes(snakeKey)
            ? (1 - currencies[camelKey])
            : currencies[camelKey];
        values.push(adjusted);
    }
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length;
    const stdDev = Math.sqrt(variance);
    // commensurability = 1 - 2*stdDev (max stdDev for a [0,1] uniform pair
    // is 0.5 — so 2*stdDev clamps reasonably to [0,1]).
    const commens = Math.max(0, Math.min(1, 1 - (2 * stdDev)));
    return { commensurabilityScore: commens };
}

function detectIncommensurability(params) {
    const { commensurabilityScore } = computeCommensurabilityScore(params);
    return {
        flagged: commensurabilityScore < (1 - INCOMMENSURABILITY_THRESHOLD) ? 1 : 0,
        commensurabilityScore
    };
}

function identifyDominantCurrency(params) {
    const currencies = _required(params, 'currencies');
    _validateCurrencies(currencies);
    // Dominance = "which signal is loudest in its own direction" — RAW value
    // per currency. High probability = loud positive. High adversarial = loud
    // negative. Both count as "dominant" in different directions. Inversion
    // applies to settlement_score (which seeks alignment), NOT to dominance
    // (which seeks the strongest driver regardless of sign).
    const raw = {};
    for (const camelKey of Object.keys(CAMEL_TO_SNAKE)) {
        const snakeKey = CAMEL_TO_SNAKE[camelKey];
        raw[snakeKey] = currencies[camelKey];
    }
    const entries = Object.entries(raw).sort((a, b) => b[1] - a[1]);
    const [topKey, topVal] = entries[0];
    const [, secondVal] = entries[1];
    if (topVal >= DOMINANT_THRESHOLD && (topVal - secondVal) >= DOMINANT_GAP) {
        return { dominantCurrency: topKey };
    }
    return { dominantCurrency: 'multi_balanced' };
}

// ──────────────────────────────────────────────────────────────────────────
// DB-BOUND FUNCTIONS
// ──────────────────────────────────────────────────────────────────────────

const _stmts = {
    insertSettlement: db.prepare(`
        INSERT INTO ml_epistemic_settlements (
            user_id, resolved_env, settlement_id, decision_id,
            probability_evidence_score, causal_force_score,
            narrative_coherence_score, information_gain_score,
            adversarial_pressure_score, risk_of_being_wrong_score,
            settlement_score, commensurability_score,
            incommensurability_flagged, dominant_currency, reasoning, ts
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    selectSettlement: db.prepare(`
        SELECT id, settlement_id AS settlementId, decision_id AS decisionId,
               probability_evidence_score AS probabilityEvidenceScore,
               causal_force_score AS causalForceScore,
               narrative_coherence_score AS narrativeCoherenceScore,
               information_gain_score AS informationGainScore,
               adversarial_pressure_score AS adversarialPressureScore,
               risk_of_being_wrong_score AS riskOfBeingWrongScore,
               settlement_score AS settlementScore,
               commensurability_score AS commensurabilityScore,
               incommensurability_flagged AS incommensurabilityFlagged,
               dominant_currency AS dominantCurrency,
               reasoning, ts
        FROM ml_epistemic_settlements
        WHERE settlement_id = ?
    `),
    selectAllRecent: db.prepare(`
        SELECT id, settlement_id AS settlementId, decision_id AS decisionId,
               settlement_score AS settlementScore,
               commensurability_score AS commensurabilityScore,
               incommensurability_flagged AS incommensurabilityFlagged,
               dominant_currency AS dominantCurrency, ts
        FROM ml_epistemic_settlements
        WHERE user_id = ? AND resolved_env = ?
        ORDER BY ts DESC
    `),
    selectByIncomm: db.prepare(`
        SELECT id, settlement_id AS settlementId, decision_id AS decisionId,
               settlement_score AS settlementScore,
               commensurability_score AS commensurabilityScore,
               incommensurability_flagged AS incommensurabilityFlagged,
               dominant_currency AS dominantCurrency, ts
        FROM ml_epistemic_settlements
        WHERE user_id = ? AND resolved_env = ? AND incommensurability_flagged = ?
        ORDER BY ts DESC
    `),
    countByDominant: db.prepare(`
        SELECT dominant_currency AS dominantCurrency, COUNT(*) AS count
        FROM ml_epistemic_settlements
        WHERE user_id = ? AND resolved_env = ? AND ts >= ?
        GROUP BY dominant_currency
    `)
};

function recordSettlement(params) {
    const userId = _required(params, 'userId');
    const resolvedEnv = _requireEnv(_required(params, 'resolvedEnv'));
    const settlementId = _required(params, 'settlementId');
    const decisionId = _required(params, 'decisionId');
    const currencies = _required(params, 'currencies');
    const ts = _required(params, 'ts');
    const reasoning = params.reasoning ?? null;

    _validateCurrencies(currencies);
    if (_stmts.selectSettlement.get(settlementId)) {
        throw new Error(`§170 duplicate settlementId: ${settlementId}`);
    }

    const { settlementScore } = computeSettlementScore({ currencies });
    const { commensurabilityScore, flagged: incommensurabilityFlagged } =
        detectIncommensurability({ currencies });
    const { dominantCurrency } = identifyDominantCurrency({ currencies });

    _stmts.insertSettlement.run(
        userId, resolvedEnv, settlementId, decisionId,
        currencies.probabilityEvidence, currencies.causalForce,
        currencies.narrativeCoherence, currencies.informationGain,
        currencies.adversarialPressure, currencies.riskOfBeingWrong,
        settlementScore, commensurabilityScore,
        incommensurabilityFlagged, dominantCurrency, reasoning, ts
    );

    return {
        recorded: true,
        settlementId, decisionId,
        settlementScore, commensurabilityScore,
        incommensurabilityFlagged, dominantCurrency
    };
}

function getRecentSettlements(params) {
    const userId = _required(params, 'userId');
    const resolvedEnv = _requireEnv(_required(params, 'resolvedEnv'));
    const incomm = params.incommensurabilityFlagged;
    if (incomm !== undefined && incomm !== 0 && incomm !== 1) {
        throw new Error(`§170 invalid incommensurabilityFlagged filter: ${incomm}`);
    }
    return incomm !== undefined
        ? _stmts.selectByIncomm.all(userId, resolvedEnv, incomm)
        : _stmts.selectAllRecent.all(userId, resolvedEnv);
}

function getStatsByDominantCurrency(params) {
    const userId = _required(params, 'userId');
    const resolvedEnv = _requireEnv(_required(params, 'resolvedEnv'));
    const sinceTs = _required(params, 'sinceTs');
    const rows = _stmts.countByDominant.all(userId, resolvedEnv, sinceTs);
    const stats = {
        probability_evidence: 0, causal_force: 0,
        narrative_coherence: 0, information_gain: 0,
        adversarial_pressure: 0, risk_of_being_wrong: 0,
        multi_balanced: 0, totalCount: 0
    };
    for (const r of rows) {
        stats[r.dominantCurrency] = r.count;
        stats.totalCount += r.count;
    }
    return stats;
}

module.exports = {
    // constants
    EVIDENCE_CURRENCIES,
    DOMINANT_CURRENCIES,
    INVERTED_CURRENCIES,
    SETTLEMENT_WEIGHTS,
    INCOMMENSURABILITY_THRESHOLD,
    DOMINANT_THRESHOLD,
    DOMINANT_GAP,
    // pure
    computeSettlementScore,
    computeCommensurabilityScore,
    detectIncommensurability,
    identifyDominantCurrency,
    // DB
    recordSettlement,
    getRecentSettlements,
    getStatsByDominantCurrency
};

// FILE END §170 epistemicCurrencyExchange.js
