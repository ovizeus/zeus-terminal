'use strict';

/**
 * OMEGA Wave 3 §151 — FUTURE-SELF TREATY / POSSIBLE-SELVES NEGOTIATION.
 *
 * Canonical PDF §151 (ml_brain_canonic.txt lines 4984-5031).
 *
 * Distinct de:
 *   - §127 identityContinuity         — cumulative tracking same-self over time
 *   - §146 identityUnderTransformation — verdict same/evolved/new pe o
 *                                         transformare data (post-hoc)
 *   - §149 purposeDriftDetector       — scope substitution
 *
 * §151 = INTER-TEMPORAL NEGOTIATION pre-decision. "daca versiunea mea
 *        mai inteleapta de peste 6 luni ar privi decizia asta, ar multumi
 *        sau ar protesta?"
 *
 * 5 canonical possible-self archetypes (PDF lines 5003-5007):
 *   conservative | aggressive | research_heavy | survival_first | integrity_max
 *
 * 2 horizons (PDF lines 5015-5016):
 *   near_term (~days/weeks) | long_horizon (~months/year)
 *
 * Per change × archetype × horizon: records approval + regret estimates,
 * computes treaty_score, emits verdict (approve/quarantine/governance_review/
 * reject). Cross-archetype score range > CONFLICT_SCORE_RANGE = treaty
 * conflict (selves disagree about same change).
 *
 * Per-(user × resolved_env) isolated. Server-only.
 */

const { db } = require('../../database');

const ARCHETYPE_NAMES = Object.freeze([
    'conservative', 'aggressive', 'research_heavy',
    'survival_first', 'integrity_max', 'custom'
]);
const HORIZONS = Object.freeze(['near_term', 'long_horizon']);
const TREATY_VERDICTS = Object.freeze([
    'approve', 'quarantine', 'governance_review', 'reject'
]);

const APPROVE_MIN_TREATY_SCORE = 0.65;
const APPROVE_MAX_REGRET = 0.30;
const REJECT_MAX_TREATY_SCORE = 0.35;
const REJECT_MIN_REGRET = 0.65;
const CONFLICT_SCORE_RANGE = 0.40;

const RESOLVED_ENVS = new Set(['DEMO', 'TESTNET', 'REAL']);

function _required(params, key) {
    if (params == null || params[key] == null) {
        throw new Error(`§151 missing required param: ${key}`);
    }
    return params[key];
}
function _requireEnv(env) {
    if (!RESOLVED_ENVS.has(env)) {
        throw new Error(`§151 invalid resolvedEnv: ${env}`);
    }
    return env;
}
function _requireRange01(name, v) {
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 1) {
        throw new Error(`§151 ${name} must be number in [0,1], got ${v}`);
    }
}
function _requirePlainObject(name, v) {
    if (v === null || typeof v !== 'object' || Array.isArray(v)) {
        throw new Error(`§151 ${name} must be plain object`);
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PURE FUNCTIONS
// ──────────────────────────────────────────────────────────────────────────

function computeTreatyScore(params) {
    const approvalScore = _required(params, 'approvalScore');
    const regretScore = _required(params, 'regretScore');
    _requireRange01('approvalScore', approvalScore);
    _requireRange01('regretScore', regretScore);
    // treaty = (approval - regret + 1) / 2  →  affine remap of approval
    // minus regret into [0,1]. Symmetrical: +1 cap if approval=1,regret=0;
    // 0 floor if approval=0,regret=1.
    const raw = (approvalScore - regretScore + 1) / 2;
    const clamped = Math.max(0, Math.min(1, raw));
    return { treatyScore: clamped };
}

function classifyTreatyVerdict(params) {
    const treatyScore = _required(params, 'treatyScore');
    const approvalScore = _required(params, 'approvalScore');
    const regretScore = _required(params, 'regretScore');
    _requireRange01('treatyScore', treatyScore);
    _requireRange01('approvalScore', approvalScore);
    _requireRange01('regretScore', regretScore);
    // Reject takes priority — high regret OR very low treaty.
    if (regretScore >= REJECT_MIN_REGRET || treatyScore < REJECT_MAX_TREATY_SCORE) {
        return { verdict: 'reject', treatyScore };
    }
    // Approve requires BOTH strong treaty AND low regret.
    if (treatyScore >= APPROVE_MIN_TREATY_SCORE && regretScore < APPROVE_MAX_REGRET) {
        return { verdict: 'approve', treatyScore };
    }
    // Governance review: high treaty but moderate regret — operator
    // judgment needed (currently delegated to quarantine path until
    // explicit governance integration in §157+; treat middle bands as
    // quarantine).
    return { verdict: 'quarantine', treatyScore };
}

function detectTreatyConflict(params) {
    const treaties = _required(params, 'treaties');
    if (!Array.isArray(treaties)) {
        throw new Error('§151 treaties must be array');
    }
    if (treaties.length < 2) {
        return { conflictDetected: false, scoreRange: 0, treatyCount: treaties.length };
    }
    let min = Infinity, max = -Infinity;
    for (const t of treaties) {
        if (typeof t.treatyScore !== 'number') {
            throw new Error('§151 treaty entries must have numeric treatyScore');
        }
        if (t.treatyScore < min) min = t.treatyScore;
        if (t.treatyScore > max) max = t.treatyScore;
    }
    const scoreRange = max - min;
    return {
        conflictDetected: scoreRange > CONFLICT_SCORE_RANGE,
        scoreRange,
        treatyCount: treaties.length
    };
}

// ──────────────────────────────────────────────────────────────────────────
// DB-BOUND FUNCTIONS
// ──────────────────────────────────────────────────────────────────────────

const _stmts = {
    insertArchetype: db.prepare(`
        INSERT INTO ml_possible_self_archetypes (
            user_id, resolved_env, archetype_id, archetype_name,
            traits_json, priority_weights_json, description, registered_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `),
    selectArchetype: db.prepare(`
        SELECT id, archetype_id AS archetypeId,
               archetype_name AS archetypeName,
               traits_json AS traitsJson,
               priority_weights_json AS priorityWeightsJson,
               description, registered_at AS registeredAt
        FROM ml_possible_self_archetypes
        WHERE archetype_id = ?
    `),
    selectAllArchetypes: db.prepare(`
        SELECT id, archetype_id AS archetypeId,
               archetype_name AS archetypeName,
               traits_json AS traitsJson,
               priority_weights_json AS priorityWeightsJson,
               description, registered_at AS registeredAt
        FROM ml_possible_self_archetypes
        WHERE user_id = ? AND resolved_env = ?
        ORDER BY registered_at ASC
    `),
    insertTreaty: db.prepare(`
        INSERT INTO ml_future_self_treaties (
            user_id, resolved_env, treaty_id, change_label, archetype_id,
            horizon, approval_score, regret_score, treaty_score, verdict,
            reasoning_text, ts
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    selectTreaty: db.prepare(`
        SELECT id, treaty_id AS treatyId, change_label AS changeLabel,
               archetype_id AS archetypeId, horizon,
               approval_score AS approvalScore,
               regret_score AS regretScore,
               treaty_score AS treatyScore,
               verdict, reasoning_text AS reasoningText, ts
        FROM ml_future_self_treaties
        WHERE treaty_id = ?
    `),
    selectTreatiesForChange: db.prepare(`
        SELECT id, treaty_id AS treatyId, change_label AS changeLabel,
               archetype_id AS archetypeId, horizon,
               approval_score AS approvalScore,
               regret_score AS regretScore,
               treaty_score AS treatyScore,
               verdict, reasoning_text AS reasoningText, ts
        FROM ml_future_self_treaties
        WHERE user_id = ? AND resolved_env = ? AND change_label = ?
        ORDER BY ts ASC
    `)
};

function registerArchetype(params) {
    const userId = _required(params, 'userId');
    const resolvedEnv = _requireEnv(_required(params, 'resolvedEnv'));
    const archetypeId = _required(params, 'archetypeId');
    const archetypeName = _required(params, 'archetypeName');
    const traits = _required(params, 'traits');
    const priorityWeights = _required(params, 'priorityWeights');
    const description = _required(params, 'description');
    const ts = _required(params, 'ts');

    if (!ARCHETYPE_NAMES.includes(archetypeName)) {
        throw new Error(`§151 invalid archetypeName: ${archetypeName}`);
    }
    _requirePlainObject('traits', traits);
    _requirePlainObject('priorityWeights', priorityWeights);
    if (_stmts.selectArchetype.get(archetypeId)) {
        throw new Error(`§151 duplicate archetypeId: ${archetypeId}`);
    }
    _stmts.insertArchetype.run(
        userId, resolvedEnv, archetypeId, archetypeName,
        JSON.stringify(traits), JSON.stringify(priorityWeights),
        description, ts
    );
    return { registered: true, archetypeId };
}

function recordTreaty(params) {
    const userId = _required(params, 'userId');
    const resolvedEnv = _requireEnv(_required(params, 'resolvedEnv'));
    const treatyId = _required(params, 'treatyId');
    const changeLabel = _required(params, 'changeLabel');
    const archetypeId = _required(params, 'archetypeId');
    const horizon = _required(params, 'horizon');
    const approvalScore = _required(params, 'approvalScore');
    const regretScore = _required(params, 'regretScore');
    const ts = _required(params, 'ts');
    const reasoning = params.reasoning ?? null;

    if (!HORIZONS.includes(horizon)) {
        throw new Error(`§151 invalid horizon: ${horizon}`);
    }
    _requireRange01('approvalScore', approvalScore);
    _requireRange01('regretScore', regretScore);
    if (_stmts.selectTreaty.get(treatyId)) {
        throw new Error(`§151 duplicate treatyId: ${treatyId}`);
    }

    const { treatyScore } = computeTreatyScore({ approvalScore, regretScore });
    const { verdict } = classifyTreatyVerdict({
        treatyScore, approvalScore, regretScore
    });

    _stmts.insertTreaty.run(
        userId, resolvedEnv, treatyId, changeLabel, archetypeId,
        horizon, approvalScore, regretScore, treatyScore, verdict,
        reasoning, ts
    );

    return {
        recorded: true,
        treatyId, changeLabel, archetypeId, horizon,
        treatyScore, verdict
    };
}

function getArchetypes(params) {
    const userId = _required(params, 'userId');
    const resolvedEnv = _requireEnv(_required(params, 'resolvedEnv'));
    return _stmts.selectAllArchetypes.all(userId, resolvedEnv);
}

function getTreatiesForChange(params) {
    const userId = _required(params, 'userId');
    const resolvedEnv = _requireEnv(_required(params, 'resolvedEnv'));
    const changeLabel = _required(params, 'changeLabel');
    return _stmts.selectTreatiesForChange.all(userId, resolvedEnv, changeLabel);
}

function detectChangeConflict(params) {
    const userId = _required(params, 'userId');
    const resolvedEnv = _requireEnv(_required(params, 'resolvedEnv'));
    const changeLabel = _required(params, 'changeLabel');
    const treaties = _stmts.selectTreatiesForChange.all(userId, resolvedEnv, changeLabel);
    return detectTreatyConflict({ treaties });
}

module.exports = {
    // constants
    ARCHETYPE_NAMES,
    HORIZONS,
    TREATY_VERDICTS,
    APPROVE_MIN_TREATY_SCORE,
    APPROVE_MAX_REGRET,
    REJECT_MAX_TREATY_SCORE,
    REJECT_MIN_REGRET,
    CONFLICT_SCORE_RANGE,
    // pure
    computeTreatyScore,
    classifyTreatyVerdict,
    detectTreatyConflict,
    // DB
    registerArchetype,
    recordTreaty,
    getArchetypes,
    getTreatiesForChange,
    detectChangeConflict
};

// FILE END §151 futureSelfTreaty.js
