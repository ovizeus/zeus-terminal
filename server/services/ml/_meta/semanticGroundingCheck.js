'use strict';

/**
 * OMEGA _meta — semanticGroundingCheck (canonical §132)
 *
 * §132 SEMANTIC GROUNDING CHECK / WORD-TO-WORLD ALIGNMENT ENGINE.
 * Source: /root/_review/ml_brain/ml_brain_canonic.txt lines 3843-3880.
 *
 * "Termeni ca trend/squeeze/toxic/fragil/agresiv/confirmat pot deveni
 *  etichete frumoase, dar goale, daca nu sunt ancorate mereu in realitatea
 *  numerica actuala... semantic grounding check per concept important +
 *  mapare intre termeni si suport numeric actual + detectie de semantic
 *  drift (cand acelasi cuvant incepe sa insemne lucruri diferite in timp)
 *  + distinctie intre concept bine ancorat / partial ancorat / retoric
 *  decorativ + penalties pentru deciziile bazate pe concepte slab ancorate."
 *
 * Distinct from §114 conceptLibrary (R5A — what concepts MEAN, semantic
 * definition), §123 ontologyRevisionEngine (R5B — vocabulary evolution
 * events), §117 epistemicProvenance (_audit — lineage of belief).
 * §132 = runtime numeric anchoring check (word-to-world alignment NOW,
 * on demand).
 */

const { db } = require('../../database');

const GROUNDING_STATUSES = Object.freeze([
    'well_grounded', 'partial_grounded', 'rhetorical'
]);
const GROUNDING_THRESHOLDS = Object.freeze({
    well: 0.80,
    partial: 0.40
});
const DECISION_PENALTY = Object.freeze({
    well_grounded: 0,
    partial_grounded: 0.25,
    rhetorical: 0.75
});
const DRIFT_THRESHOLD = 0.30;

function _required(params, key) {
    if (!params || params[key] === undefined || params[key] === null) {
        throw new Error(`semanticGroundingCheck: missing ${key}`);
    }
    return params[key];
}

const _stmts = {
    insertAnchor: db.prepare(`
        INSERT INTO ml_grounding_anchors
        (user_id, resolved_env, anchor_id, concept_name,
         metric_name, threshold_min, threshold_max, active, ts)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    listActiveAnchors: db.prepare(`
        SELECT * FROM ml_grounding_anchors
        WHERE user_id = ? AND resolved_env = ?
          AND concept_name = ? AND active = 1
    `),
    insertCheck: db.prepare(`
        INSERT INTO ml_grounding_checks
        (user_id, resolved_env, check_id, concept_name,
         actual_metrics_json, matched_anchors_count,
         total_anchors_count, grounding_score,
         grounding_status, ts)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    listChecks: db.prepare(`
        SELECT * FROM ml_grounding_checks
        WHERE user_id = ? AND resolved_env = ?
          AND concept_name = ?
        ORDER BY ts ASC LIMIT ?
    `)
};

// ── evaluateAnchor (pure) ──────────────────────────────────────────
function evaluateAnchor(params) {
    const min = (params && params.thresholdMin !== undefined)
        ? params.thresholdMin : null;
    const max = (params && params.thresholdMax !== undefined)
        ? params.thresholdMax : null;
    const value = _required(params, 'actualValue');

    if ((min === null || min === undefined) &&
        (max === null || max === undefined)) {
        throw new Error(
            'semanticGroundingCheck: at least one threshold required'
        );
    }
    if (min !== null && min !== undefined && value < min) {
        return { matched: false };
    }
    if (max !== null && max !== undefined && value > max) {
        return { matched: false };
    }
    return { matched: true };
}

// ── computeGroundingScore (pure) ───────────────────────────────────
function computeGroundingScore(params) {
    const matched = _required(params, 'matchedCount');
    const total = _required(params, 'totalCount');
    if (total === 0) return { groundingScore: 0 };
    return { groundingScore: matched / total };
}

// ── classifyGrounding (pure) ───────────────────────────────────────
function classifyGrounding(params) {
    const score = _required(params, 'groundingScore');
    if (score < 0 || score > 1) {
        throw new Error(
            'semanticGroundingCheck: groundingScore must be in [0,1]'
        );
    }
    let status;
    if (score >= GROUNDING_THRESHOLDS.well) status = 'well_grounded';
    else if (score >= GROUNDING_THRESHOLDS.partial) status = 'partial_grounded';
    else status = 'rhetorical';
    return { groundingStatus: status, groundingScore: score };
}

// ── computeDecisionPenalty (pure) ──────────────────────────────────
function computeDecisionPenalty(params) {
    const status = _required(params, 'groundingStatus');
    if (!GROUNDING_STATUSES.includes(status)) {
        throw new Error(
            `semanticGroundingCheck: invalid groundingStatus "${status}"`
        );
    }
    return { penalty: DECISION_PENALTY[status], groundingStatus: status };
}

// ── detectSemanticDrift (pure) ─────────────────────────────────────
function detectSemanticDrift(params) {
    const recent = _required(params, 'recentScores');
    const baseline = _required(params, 'baselineScores');
    if (!Array.isArray(recent) || !Array.isArray(baseline)) {
        throw new Error(
            'semanticGroundingCheck: recentScores and baselineScores must be arrays'
        );
    }
    if (recent.length === 0 || baseline.length === 0) {
        return { driftDetected: false, driftMagnitude: 0 };
    }
    const meanRecent = recent.reduce((a, b) => a + b, 0) / recent.length;
    const meanBase = baseline.reduce((a, b) => a + b, 0) / baseline.length;
    const magnitude = Math.abs(meanRecent - meanBase);
    return {
        driftDetected: magnitude >= DRIFT_THRESHOLD,
        driftMagnitude: magnitude,
        meanRecent, meanBaseline: meanBase
    };
}

// ── registerAnchor ─────────────────────────────────────────────────
function registerAnchor(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const anchorId = _required(params, 'anchorId');
    const conceptName = _required(params, 'conceptName');
    const metricName = _required(params, 'metricName');
    const min = (params && params.thresholdMin !== undefined)
        ? params.thresholdMin : null;
    const max = (params && params.thresholdMax !== undefined)
        ? params.thresholdMax : null;
    const active = (params && params.active !== undefined)
        ? (params.active ? 1 : 0) : 1;
    const ts = (params && params.ts) ? params.ts : Date.now();

    if ((min === null || min === undefined) &&
        (max === null || max === undefined)) {
        throw new Error(
            'semanticGroundingCheck: at least one threshold required (min or max)'
        );
    }
    try {
        _stmts.insertAnchor.run(
            userId, env, anchorId, conceptName, metricName,
            min, max, active, ts
        );
        return { registered: true, anchorId };
    } catch (err) {
        if (err.code === 'SQLITE_CONSTRAINT_UNIQUE' ||
            (err.message && err.message.includes('UNIQUE'))) {
            throw new Error(
                `semanticGroundingCheck: duplicate anchorId "${anchorId}"`
            );
        }
        throw err;
    }
}

// ── recordGroundingCheck ───────────────────────────────────────────
function recordGroundingCheck(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const checkId = _required(params, 'checkId');
    const conceptName = _required(params, 'conceptName');
    const actualMetrics = _required(params, 'actualMetrics');
    const ts = (params && params.ts) ? params.ts : Date.now();

    const anchors = _stmts.listActiveAnchors.all(userId, env, conceptName);
    let matchedCount = 0;
    for (const anchor of anchors) {
        const value = actualMetrics[anchor.metric_name];
        if (value === undefined || value === null) continue;
        const { matched } = evaluateAnchor({
            thresholdMin: anchor.threshold_min,
            thresholdMax: anchor.threshold_max,
            actualValue: value
        });
        if (matched) matchedCount++;
    }
    const totalCount = anchors.length;
    const { groundingScore } = computeGroundingScore({
        matchedCount, totalCount
    });
    const { groundingStatus } = classifyGrounding({ groundingScore });

    try {
        _stmts.insertCheck.run(
            userId, env, checkId, conceptName,
            JSON.stringify(actualMetrics),
            matchedCount, totalCount,
            groundingScore, groundingStatus, ts
        );
        return {
            recorded: true, checkId, conceptName,
            matchedCount, totalCount,
            groundingScore, groundingStatus
        };
    } catch (err) {
        if (err.code === 'SQLITE_CONSTRAINT_UNIQUE' ||
            (err.message && err.message.includes('UNIQUE'))) {
            throw new Error(
                `semanticGroundingCheck: duplicate checkId "${checkId}"`
            );
        }
        throw err;
    }
}

// ── getConceptHistory ──────────────────────────────────────────────
function getConceptHistory(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const conceptName = _required(params, 'conceptName');
    const limit = (params && params.limit) ? params.limit : 100;
    const rows = _stmts.listChecks.all(userId, env, conceptName, limit);
    return rows.map(r => ({
        checkId: r.check_id,
        conceptName: r.concept_name,
        actualMetrics: JSON.parse(r.actual_metrics_json),
        matchedCount: r.matched_anchors_count,
        totalCount: r.total_anchors_count,
        groundingScore: r.grounding_score,
        groundingStatus: r.grounding_status,
        ts: r.ts
    }));
}

// ── detectConceptDrift (integration) ───────────────────────────────
function detectConceptDrift(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const conceptName = _required(params, 'conceptName');
    const windowSize = (params && params.windowSize) ? params.windowSize : 5;

    const all = getConceptHistory({
        userId, resolvedEnv: env, conceptName,
        limit: windowSize * 2 + 10
    });
    if (all.length < windowSize * 2) {
        return {
            driftDetected: false,
            reason: 'insufficient data',
            available: all.length, needed: windowSize * 2
        };
    }
    // all is sorted ASC, so baseline = first windowSize, recent = last windowSize
    const baselineScores = all.slice(0, windowSize)
        .map(c => c.groundingScore);
    const recentScores = all.slice(-windowSize)
        .map(c => c.groundingScore);
    return detectSemanticDrift({ recentScores, baselineScores });
}

module.exports = {
    GROUNDING_STATUSES,
    GROUNDING_THRESHOLDS,
    DECISION_PENALTY,
    DRIFT_THRESHOLD,
    evaluateAnchor,
    computeGroundingScore,
    classifyGrounding,
    computeDecisionPenalty,
    detectSemanticDrift,
    registerAnchor,
    recordGroundingCheck,
    getConceptHistory,
    detectConceptDrift
};
