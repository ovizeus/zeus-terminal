'use strict';

/**
 * OMEGA §211 — MORAL LUCK NORMALIZER / DO-NOT-SANCTIFY-THE-FORTUNATE.
 * Canonical PDF lines 6715-6764.
 */

const { db } = require('../../database');

const LUCK_CLASSIFICATIONS = Object.freeze([
    'skilled_and_lucky',
    'skilled_but_unlucky',
    'lucky_salvation',
    'deserved_loss',
    'character_outcome_aligned'
]);

const ALIGNMENT_THRESHOLD = 0.20;
const HIGH_QUALITY = 0.60;

const RESOLVED_ENVS = new Set(['DEMO', 'TESTNET', 'REAL']);

function _required(p, k) {
    if (p == null || p[k] == null) throw new Error(`§211 missing param: ${k}`);
    return p[k];
}
function _requireEnv(env) {
    if (!RESOLVED_ENVS.has(env)) throw new Error(`§211 invalid env: ${env}`);
    return env;
}
function _requireRange01(name, v) {
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 1) {
        throw new Error(`§211 ${name} must be in [0,1]`);
    }
}

function classifyLuck(params) {
    const character = _required(params, 'characterQualityScore');
    const outcome = _required(params, 'outcomeQualityScore');
    _requireRange01('characterQualityScore', character);
    _requireRange01('outcomeQualityScore', outcome);
    const gap = Math.abs(character - outcome);
    if (gap <= ALIGNMENT_THRESHOLD) {
        return { classification: 'character_outcome_aligned' };
    }
    if (character >= HIGH_QUALITY && outcome >= HIGH_QUALITY) {
        return { classification: 'skilled_and_lucky' };
    }
    if (character >= HIGH_QUALITY && outcome < HIGH_QUALITY) {
        return { classification: 'skilled_but_unlucky' };
    }
    if (character < HIGH_QUALITY && outcome >= HIGH_QUALITY) {
        return { classification: 'lucky_salvation' };
    }
    return { classification: 'deserved_loss' };
}

function computePrestigeCorrection(params) {
    const classification = _required(params, 'classification');
    if (!LUCK_CLASSIFICATIONS.includes(classification)) {
        throw new Error(`§211 invalid classification: ${classification}`);
    }
    // Negative correction when lucky_salvation (subtract unearned prestige);
    // positive when skilled_but_unlucky (preserve dignity); neutral otherwise.
    const map = {
        skilled_and_lucky: -0.10,            // slight de-emphasize luck
        skilled_but_unlucky: 0.30,           // preserve reputation
        lucky_salvation: -0.50,              // strongest correction down
        deserved_loss: 0,
        character_outcome_aligned: 0
    };
    return { prestigeCorrection: map[classification] };
}

const _stmts = {
    insert: db.prepare(`
        INSERT INTO ml_moral_luck_adjustments (
            user_id, resolved_env, adjustment_id, decision_id,
            character_quality_score, outcome_quality_score,
            luck_classification, prestige_correction,
            reasoning, ts
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    selectById: db.prepare(`SELECT * FROM ml_moral_luck_adjustments WHERE adjustment_id = ?`),
    selectAll: db.prepare(`
        SELECT id, adjustment_id AS adjustmentId, decision_id AS decisionId,
               character_quality_score AS characterQualityScore,
               outcome_quality_score AS outcomeQualityScore,
               luck_classification AS luckClassification,
               prestige_correction AS prestigeCorrection,
               reasoning, ts
        FROM ml_moral_luck_adjustments
        WHERE user_id = ? AND resolved_env = ?
        ORDER BY ts DESC
    `)
};

function recordMoralLuckAdjustment(params) {
    const userId = _required(params, 'userId');
    const resolvedEnv = _requireEnv(_required(params, 'resolvedEnv'));
    const adjustmentId = _required(params, 'adjustmentId');
    const decisionId = _required(params, 'decisionId');
    const characterQualityScore = _required(params, 'characterQualityScore');
    const outcomeQualityScore = _required(params, 'outcomeQualityScore');
    const ts = _required(params, 'ts');
    const reasoning = params.reasoning ?? null;

    if (_stmts.selectById.get(adjustmentId)) {
        throw new Error(`§211 duplicate adjustmentId: ${adjustmentId}`);
    }

    const { classification: luckClassification } = classifyLuck({
        characterQualityScore, outcomeQualityScore
    });
    const { prestigeCorrection } = computePrestigeCorrection({ classification: luckClassification });

    _stmts.insert.run(
        userId, resolvedEnv, adjustmentId, decisionId,
        characterQualityScore, outcomeQualityScore,
        luckClassification, prestigeCorrection, reasoning, ts
    );

    return {
        recorded: true, adjustmentId, decisionId,
        luckClassification, prestigeCorrection
    };
}

function getRecentAdjustments(params) {
    const userId = _required(params, 'userId');
    const resolvedEnv = _requireEnv(_required(params, 'resolvedEnv'));
    return _stmts.selectAll.all(userId, resolvedEnv);
}

module.exports = {
    LUCK_CLASSIFICATIONS, ALIGNMENT_THRESHOLD, HIGH_QUALITY,
    classifyLuck, computePrestigeCorrection,
    recordMoralLuckAdjustment, getRecentAdjustments
};
