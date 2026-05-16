'use strict';

/**
 * OMEGA meta — wisdomLayer (canonical §103)
 *
 * §103 WISDOM LAYER.
 * Source: /root/_review/ml_brain/ml_brain_canonic.txt line 2623.
 *
 * "Cel mai inteligent lucru pe care il poti face este sa ignori 94 de module
 *  sofisticate si sa urmezi o regula simpla si robusta... cand piata e haotica
 *  si imprevizibila, regulile simple bat modelele complexe — complexitatea
 *  amplifica incertitudinea... downgrade-eaza activ la euristici simple:
 *  'nu tranzactiona pre-FOMC', 'nu contra trendului saptamanal', 'daca nu
 *  intelegi, nu intra'. Acesta e opusul intelligence-ului — e JUDECATA."
 *
 * Meta judgment overlay. Distinct from §94 complexityBudget (MDL pruning
 * of features), §38 intelligenceChecker (per-decision self-eval).
 * §103 = downgrade-to-heuristic when complexity/quality ratio bad.
 */

const { db } = require('../../database');

const HEURISTIC_KINDS = Object.freeze([
    'timing', 'regime', 'cognition', 'risk'
]);
const OVERRIDE_ACTIONS = Object.freeze([
    'SIMPLIFY', 'ABSTAIN', 'PROCEED_NORMAL'
]);

const DEFAULT_QUALITY_THRESHOLD = 0.40;
const DEFAULT_RATIO_THRESHOLD = 2.0;
const ABSTAIN_QUALITY_FLOOR = 0.20;
const QUALITY_EPSILON = 1e-6;

function _required(params, key) {
    if (!params || params[key] === undefined || params[key] === null) {
        throw new Error(`wisdomLayer: missing ${key}`);
    }
    return params[key];
}

const _stmts = {
    insertHeuristic: db.prepare(`
        INSERT INTO ml_wisdom_heuristics
        (user_id, resolved_env, heuristic_id, rule_text,
         kind, priority, is_active, ts)
        VALUES (?, ?, ?, ?, ?, ?, 1, ?)
    `),
    getHeuristic: db.prepare(`
        SELECT * FROM ml_wisdom_heuristics WHERE heuristic_id = ?
    `),
    listActive: db.prepare(`
        SELECT * FROM ml_wisdom_heuristics
        WHERE user_id = ? AND resolved_env = ? AND is_active = 1
        ORDER BY priority DESC, ts DESC LIMIT ?
    `),
    listActiveByKind: db.prepare(`
        SELECT * FROM ml_wisdom_heuristics
        WHERE user_id = ? AND resolved_env = ?
          AND is_active = 1 AND kind = ?
        ORDER BY priority DESC, ts DESC LIMIT ?
    `),
    retireHeuristic: db.prepare(`
        UPDATE ml_wisdom_heuristics
        SET is_active = 0
        WHERE user_id = ? AND resolved_env = ? AND heuristic_id = ?
    `),
    insertOverride: db.prepare(`
        INSERT INTO ml_wisdom_overrides
        (user_id, resolved_env, override_id, heuristic_id,
         decision_context, complexity_score, signal_quality,
         ratio, override_action, ts)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
};

// ── computeWisdomRatio (pure) ──────────────────────────────────────
function computeWisdomRatio(params) {
    const complexityScore = _required(params, 'complexityScore');
    const signalQuality = _required(params, 'signalQuality');
    if (complexityScore < 0) {
        throw new Error('wisdomLayer: complexityScore must be >= 0');
    }
    if (signalQuality < 0 || signalQuality > 1) {
        throw new Error('wisdomLayer: signalQuality must be in [0,1]');
    }
    const denom = Math.max(signalQuality, QUALITY_EPSILON);
    return { ratio: complexityScore / denom, complexityScore, signalQuality };
}

// ── evaluateWisdomDecision (pure) ──────────────────────────────────
function evaluateWisdomDecision(params) {
    const complexityScore = _required(params, 'complexityScore');
    const signalQuality = _required(params, 'signalQuality');
    const qualityThreshold = (params && params.qualityThreshold !== undefined)
        ? params.qualityThreshold : DEFAULT_QUALITY_THRESHOLD;
    const ratioThreshold = (params && params.ratioThreshold !== undefined)
        ? params.ratioThreshold : DEFAULT_RATIO_THRESHOLD;
    const abstainFloor = (params && params.abstainFloor !== undefined)
        ? params.abstainFloor : ABSTAIN_QUALITY_FLOOR;

    const r = computeWisdomRatio({ complexityScore, signalQuality });

    if (signalQuality < abstainFloor) {
        return {
            action: 'ABSTAIN', ratio: r.ratio,
            reason: 'signal_quality_below_abstain_floor'
        };
    }
    if (r.ratio >= ratioThreshold && signalQuality < qualityThreshold) {
        return {
            action: 'SIMPLIFY', ratio: r.ratio,
            reason: 'complexity_amplifying_poor_quality'
        };
    }
    return { action: 'PROCEED_NORMAL', ratio: r.ratio, reason: 'within_bounds' };
}

// ── registerHeuristic ──────────────────────────────────────────────
function registerHeuristic(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const heuristicId = _required(params, 'heuristicId');
    const ruleText = _required(params, 'ruleText');
    const kind = _required(params, 'kind');
    if (!HEURISTIC_KINDS.includes(kind)) {
        throw new Error(`wisdomLayer: invalid kind "${kind}"`);
    }
    const priority = (params && params.priority !== undefined) ? params.priority : 0;
    const ts = (params && params.ts) ? params.ts : Date.now();

    try {
        _stmts.insertHeuristic.run(
            userId, env, heuristicId, ruleText, kind, priority, ts
        );
        return { registered: true, heuristicId };
    } catch (err) {
        if (err.code === 'SQLITE_CONSTRAINT_UNIQUE' ||
            (err.message && err.message.includes('UNIQUE'))) {
            throw new Error(`wisdomLayer: duplicate heuristicId "${heuristicId}"`);
        }
        throw err;
    }
}

// ── recordWisdomOverride ───────────────────────────────────────────
function recordWisdomOverride(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const overrideId = _required(params, 'overrideId');
    const heuristicId = (params && params.heuristicId) ? params.heuristicId : null;
    const decisionContext = _required(params, 'decisionContext');
    const complexityScore = _required(params, 'complexityScore');
    const signalQuality = _required(params, 'signalQuality');
    const overrideAction = _required(params, 'overrideAction');
    if (!OVERRIDE_ACTIONS.includes(overrideAction)) {
        throw new Error(`wisdomLayer: invalid overrideAction "${overrideAction}"`);
    }
    const ts = (params && params.ts) ? params.ts : Date.now();

    const r = computeWisdomRatio({ complexityScore, signalQuality });

    try {
        _stmts.insertOverride.run(
            userId, env, overrideId, heuristicId, decisionContext,
            complexityScore, signalQuality, r.ratio,
            overrideAction, ts
        );
        return { recorded: true, overrideId, ratio: r.ratio };
    } catch (err) {
        if (err.code === 'SQLITE_CONSTRAINT_UNIQUE' ||
            (err.message && err.message.includes('UNIQUE'))) {
            throw new Error(`wisdomLayer: duplicate overrideId "${overrideId}"`);
        }
        throw err;
    }
}

// ── getActiveHeuristics ────────────────────────────────────────────
function getActiveHeuristics(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const kind = params && params.kind;
    const limit = (params && params.limit) ? params.limit : 100;

    if (kind && !HEURISTIC_KINDS.includes(kind)) {
        throw new Error(`wisdomLayer: invalid kind "${kind}"`);
    }
    const rows = kind
        ? _stmts.listActiveByKind.all(userId, env, kind, limit)
        : _stmts.listActive.all(userId, env, limit);
    return rows.map(r => ({
        heuristicId: r.heuristic_id,
        ruleText: r.rule_text,
        kind: r.kind,
        priority: r.priority,
        isActive: !!r.is_active,
        ts: r.ts
    }));
}

// ── retireHeuristic ────────────────────────────────────────────────
function retireHeuristic(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const heuristicId = _required(params, 'heuristicId');

    const h = _stmts.getHeuristic.get(heuristicId);
    if (!h) {
        throw new Error(`wisdomLayer: heuristic "${heuristicId}" not found`);
    }
    if (h.user_id !== userId || h.resolved_env !== env) {
        throw new Error('wisdomLayer: heuristic not owned by user/env');
    }
    _stmts.retireHeuristic.run(userId, env, heuristicId);
    return { retired: true, heuristicId };
}

module.exports = {
    HEURISTIC_KINDS,
    OVERRIDE_ACTIONS,
    DEFAULT_QUALITY_THRESHOLD,
    DEFAULT_RATIO_THRESHOLD,
    ABSTAIN_QUALITY_FLOOR,
    computeWisdomRatio,
    evaluateWisdomDecision,
    registerHeuristic,
    recordWisdomOverride,
    getActiveHeuristics,
    retireHeuristic
};
