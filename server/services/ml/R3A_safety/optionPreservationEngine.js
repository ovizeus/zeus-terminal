'use strict';

/**
 * OMEGA R3A Safety — optionPreservationEngine (canonical §136)
 *
 * §136 IRREVERSIBILITY / OPTION-PRESERVATION ENGINE.
 * Source: /root/_review/ml_brain/ml_brain_canonic.txt lines 3997-4044.
 *
 * "Nu toate actiunile valoreaza doar prin profitul asteptat imediat. Unele
 *  actiuni consuma optionalitate viitoare: blocheaza capital, distrug
 *  flexibilitatea, expun contul la traiectorii din care iesi greu, sau
 *  inchid prematur ramuri de decizie viitoare mai bune... un trade poate
 *  fi bun local, dar prost pentru spatiul de posibilitati viitoare...
 *  optionality score per actiune + irreversibility score + future choice
 *  set estimator + mapping intre actiunea curenta si optiunile viitoare pe
 *  care le inchide / conserva + distinctie intre actiuni reversibile /
 *  partial reversibile / aproape ireversibile + penalizare pentru
 *  deciziile care consuma prea multa optionalitate fara edge exceptional...
 *  'daca fac asta acum, cate optiuni bune imi omor pentru viitorul
 *  apropiat?'... irreversibility mare cere standard epistemic mai ridicat
 *  + consumul de optionalitate trebuie logat ca si cost real, nu tratat
 *  ca efect secundar invizibil."
 *
 * Distinct from valueOfInformation (R2 — info-gathering value), horizon
 * Arbitration (R3A — timeframe selection), §111 scenarioTreePlanner
 * (R6 — tree-of-thought planning), §135 epistemicHumilityGovernor (_meta —
 * right-to-be-bold aggregator). §136 = first-class optionality cost
 * accounting per action + 3-state reversibility classification + epistemic
 * standard map (nearly_irreversible cere conviction ≥ 0.75).
 */

const { db } = require('../../database');

const REVERSIBILITY_CATEGORIES = Object.freeze([
    'reversible', 'partial_reversible', 'nearly_irreversible'
]);
const IRREVERSIBILITY_THRESHOLDS = Object.freeze({
    nearly: 0.70,
    partial: 0.30
});
const OPTIONALITY_PENALTY_WEIGHT = 0.50;
const EPISTEMIC_REQUIREMENT_MAP = Object.freeze({
    reversible: 0.30,
    partial_reversible: 0.50,
    nearly_irreversible: 0.75
});
const VALUE_PROXIMITY_THRESHOLD = 0.10;

function _required(params, key) {
    if (!params || params[key] === undefined || params[key] === null) {
        throw new Error(`optionPreservationEngine: missing ${key}`);
    }
    return params[key];
}

const _stmts = {
    insertAssessment: db.prepare(`
        INSERT INTO ml_action_optionality_assessments
        (user_id, resolved_env, assessment_id, action_id, action_kind,
         expected_value, irreversibility_score, optionality_consumed,
         future_options_killed_count, epistemic_standard_required,
         primary_conviction, reversibility_category,
         net_value_after_penalty, approved, ts)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    latestByAction: db.prepare(`
        SELECT * FROM ml_action_optionality_assessments
        WHERE user_id = ? AND resolved_env = ? AND action_id = ?
        ORDER BY ts DESC LIMIT 1
    `),
    listAll: db.prepare(`
        SELECT * FROM ml_action_optionality_assessments
        WHERE user_id = ? AND resolved_env = ?
        ORDER BY ts DESC LIMIT ?
    `),
    listByCategory: db.prepare(`
        SELECT * FROM ml_action_optionality_assessments
        WHERE user_id = ? AND resolved_env = ?
          AND reversibility_category = ?
        ORDER BY ts DESC LIMIT ?
    `),
    approvedBurn: db.prepare(`
        SELECT COALESCE(SUM(optionality_consumed), 0) AS total,
               COUNT(*) AS cnt
        FROM ml_action_optionality_assessments
        WHERE user_id = ? AND resolved_env = ?
          AND approved = 1 AND ts >= ?
    `)
};

// ── computeOptionalityCost (pure) ──────────────────────────────────
// cost = |EV| × optionalityConsumed × OPTIONALITY_PENALTY_WEIGHT
function computeOptionalityCost(params) {
    const ev = _required(params, 'expectedValue');
    const opt = _required(params, 'optionalityConsumed');
    if (opt < 0 || opt > 1) {
        throw new Error(
            'optionPreservationEngine: optionalityConsumed must be in [0,1]'
        );
    }
    return {
        optionalityCost: Math.abs(ev) * opt * OPTIONALITY_PENALTY_WEIGHT
    };
}

// ── computeNetValue (pure) ─────────────────────────────────────────
function computeNetValue(params) {
    const ev = _required(params, 'expectedValue');
    const { optionalityCost } = computeOptionalityCost(params);
    return { netValue: ev - optionalityCost };
}

// ── classifyReversibility (pure) ───────────────────────────────────
function classifyReversibility(params) {
    const score = _required(params, 'irreversibilityScore');
    if (score < 0 || score > 1) {
        throw new Error(
            'optionPreservationEngine: irreversibilityScore must be in [0,1]'
        );
    }
    let category;
    if (score >= IRREVERSIBILITY_THRESHOLDS.nearly) {
        category = 'nearly_irreversible';
    } else if (score >= IRREVERSIBILITY_THRESHOLDS.partial) {
        category = 'partial_reversible';
    } else {
        category = 'reversible';
    }
    return { reversibilityCategory: category };
}

// ── computeEpistemicRequirement (pure) ─────────────────────────────
function computeEpistemicRequirement(params) {
    const category = _required(params, 'reversibilityCategory');
    if (!REVERSIBILITY_CATEGORIES.includes(category)) {
        throw new Error(
            `optionPreservationEngine: invalid reversibilityCategory "${category}"`
        );
    }
    return {
        epistemicStandardRequired: EPISTEMIC_REQUIREMENT_MAP[category]
    };
}

// ── shouldApproveAction (pure) ─────────────────────────────────────
// netValue > 0 AND primaryConviction >= epistemic_required[category]
function shouldApproveAction(params) {
    const netValue = _required(params, 'netValue');
    const conviction = _required(params, 'primaryConviction');
    const category = _required(params, 'reversibilityCategory');
    if (!REVERSIBILITY_CATEGORIES.includes(category)) {
        throw new Error(
            `optionPreservationEngine: invalid reversibilityCategory "${category}"`
        );
    }
    if (conviction < 0 || conviction > 1) {
        throw new Error(
            'optionPreservationEngine: primaryConviction must be in [0,1]'
        );
    }
    if (netValue <= 0) {
        return {
            approved: false,
            reason: 'net_value_not_positive'
        };
    }
    const required = EPISTEMIC_REQUIREMENT_MAP[category];
    if (conviction < required) {
        return {
            approved: false,
            reason: 'conviction_below_epistemic_required',
            requiredConviction: required
        };
    }
    return { approved: true, reason: 'meets_all_criteria' };
}

// ── preferOptionPreserving (pure) ──────────────────────────────────
// |EV_a - EV_b| / max(|EV_a|, |EV_b|, ε) ≤ proximity → near-equal → pick
// lower optionalityConsumed. Else pick higher EV.
function preferOptionPreserving(params) {
    const a = _required(params, 'candidateA');
    const b = _required(params, 'candidateB');
    const denom = Math.max(Math.abs(a.expectedValue),
                           Math.abs(b.expectedValue), 1e-9);
    const evDelta = Math.abs(a.expectedValue - b.expectedValue) / denom;
    if (evDelta <= VALUE_PROXIMITY_THRESHOLD) {
        // near-equal EV → prefer lower optionality
        if (b.optionalityConsumed < a.optionalityConsumed) {
            return {
                preferred: 'B',
                reason: 'option_preserving_near_equal_value'
            };
        }
        return {
            preferred: 'A',
            reason: a.optionalityConsumed === b.optionalityConsumed
                ? 'tie_default_A'
                : 'option_preserving_near_equal_value'
        };
    }
    // clear EV advantage
    return {
        preferred: a.expectedValue > b.expectedValue ? 'A' : 'B',
        reason: 'higher_value'
    };
}

// ── recordOptionalityAssessment (integration) ──────────────────────
function recordOptionalityAssessment(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const assessmentId = _required(params, 'assessmentId');
    const actionId = _required(params, 'actionId');
    const actionKind = _required(params, 'actionKind');
    const ev = _required(params, 'expectedValue');
    const irreversibility = _required(params, 'irreversibilityScore');
    const optionality = _required(params, 'optionalityConsumed');
    const futureCount = _required(params, 'futureOptionsKilledCount');
    const conviction = _required(params, 'primaryConviction');
    const ts = (params && params.ts) ? params.ts : Date.now();

    if (irreversibility < 0 || irreversibility > 1) {
        throw new Error(
            'optionPreservationEngine: irreversibilityScore must be in [0,1]'
        );
    }
    if (optionality < 0 || optionality > 1) {
        throw new Error(
            'optionPreservationEngine: optionalityConsumed must be in [0,1]'
        );
    }
    if (conviction < 0 || conviction > 1) {
        throw new Error(
            'optionPreservationEngine: primaryConviction must be in [0,1]'
        );
    }
    if (futureCount < 0) {
        throw new Error(
            'optionPreservationEngine: futureOptionsKilledCount must be ≥ 0'
        );
    }

    const { reversibilityCategory } = classifyReversibility({
        irreversibilityScore: irreversibility
    });
    const { epistemicStandardRequired } = computeEpistemicRequirement({
        reversibilityCategory
    });
    const { netValue } = computeNetValue({
        expectedValue: ev, optionalityConsumed: optionality
    });
    const { approved } = shouldApproveAction({
        netValue, primaryConviction: conviction, reversibilityCategory
    });

    try {
        _stmts.insertAssessment.run(
            userId, env, assessmentId, actionId, actionKind,
            ev, irreversibility, optionality, futureCount,
            epistemicStandardRequired, conviction,
            reversibilityCategory, netValue, approved ? 1 : 0, ts
        );
        return {
            recorded: true, assessmentId,
            reversibilityCategory,
            epistemicStandardRequired,
            netValue,
            approved
        };
    } catch (err) {
        if (err.code === 'SQLITE_CONSTRAINT_UNIQUE' ||
            (err.message && err.message.includes('UNIQUE'))) {
            throw new Error(
                `optionPreservationEngine: duplicate assessmentId "${assessmentId}"`
            );
        }
        throw err;
    }
}

function _rowToAssessment(r) {
    return {
        assessmentId: r.assessment_id,
        actionId: r.action_id,
        actionKind: r.action_kind,
        expectedValue: r.expected_value,
        irreversibilityScore: r.irreversibility_score,
        optionalityConsumed: r.optionality_consumed,
        futureOptionsKilledCount: r.future_options_killed_count,
        epistemicStandardRequired: r.epistemic_standard_required,
        primaryConviction: r.primary_conviction,
        reversibilityCategory: r.reversibility_category,
        netValue: r.net_value_after_penalty,
        approved: r.approved === 1,
        ts: r.ts
    };
}

// ── getAssessmentForAction ─────────────────────────────────────────
function getAssessmentForAction(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const actionId = _required(params, 'actionId');
    const r = _stmts.latestByAction.get(userId, env, actionId);
    if (!r) return null;
    return _rowToAssessment(r);
}

// ── getAssessmentHistory ───────────────────────────────────────────
function getAssessmentHistory(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const categoryFilter = params && params.categoryFilter;
    const limit = (params && params.limit) ? params.limit : 100;

    if (categoryFilter && !REVERSIBILITY_CATEGORIES.includes(categoryFilter)) {
        throw new Error(
            `optionPreservationEngine: invalid categoryFilter "${categoryFilter}"`
        );
    }
    const rows = categoryFilter
        ? _stmts.listByCategory.all(userId, env, categoryFilter, limit)
        : _stmts.listAll.all(userId, env, limit);
    return rows.map(_rowToAssessment);
}

// ── getOptionalityBurnRate ─────────────────────────────────────────
function getOptionalityBurnRate(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const sinceTs = (params && params.sinceTs !== undefined)
        ? params.sinceTs : 0;
    const r = _stmts.approvedBurn.get(userId, env, sinceTs);
    return {
        totalOptionalityConsumed: r.total,
        approvedActionsCount: r.cnt
    };
}

module.exports = {
    REVERSIBILITY_CATEGORIES,
    IRREVERSIBILITY_THRESHOLDS,
    OPTIONALITY_PENALTY_WEIGHT,
    EPISTEMIC_REQUIREMENT_MAP,
    VALUE_PROXIMITY_THRESHOLD,
    computeOptionalityCost,
    computeNetValue,
    classifyReversibility,
    computeEpistemicRequirement,
    shouldApproveAction,
    preferOptionPreserving,
    recordOptionalityAssessment,
    getAssessmentForAction,
    getAssessmentHistory,
    getOptionalityBurnRate
};
