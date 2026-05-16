'use strict';

/**
 * OMEGA R6 ShadowMeta — falseConsensusDetector (canonical §128)
 *
 * §128 FALSE CONSENSUS DETECTOR / EPISTEMIC DEPENDENCE PENALTY.
 * Source: /root/_review/ml_brain/ml_brain_canonic.txt lines 3665-3722.
 *
 * "Acordul dintre multe module nu inseamna automat evidenta puternica...
 *  5 semnale verzi pot parea convingatoare dar daca 4 dintre ele provin
 *  din aceeasi cauza upstream, consensul este fals amplificat... distinctie
 *  intre independent agreement / partially shared agreement / highly
 *  coupled pseudo-agreement... 'am multe dovezi diferite sau doar mai
 *  multe ecouri ale aceleiasi dovezi?'... consensul puternic dar foarte
 *  dependent trebuie penalizat."
 *
 * Distinct from §117 epistemicProvenance (_audit — lineage tracking),
 * §48 ensembleVoting (R6 — raw vote counting), §124 pluralSelfChamber
 * (R6 — rival worldview dissent), §51 dataIntegrityConsensus (R3A —
 * price median anomaly). §128 = consensus inflation detector via
 * Jaccard dependence on upstream ancestor sets.
 */

const { db } = require('../../database');

const CONSENSUS_VERDICTS = Object.freeze([
    'robust_independent',
    'partially_shared',
    'highly_coupled_pseudo'
]);
const DEPENDENCE_THRESHOLDS = Object.freeze({
    robust: 0.30,
    pseudo: 0.70
});
const MIN_SIGNALS = 2;

function _required(params, key) {
    if (!params || params[key] === undefined || params[key] === null) {
        throw new Error(`falseConsensusDetector: missing ${key}`);
    }
    return params[key];
}

const _stmts = {
    insertEdge: db.prepare(`
        INSERT INTO ml_consensus_dependence_edges
        (user_id, resolved_env, edge_id, signal_id,
         upstream_source_id, ts)
        VALUES (?, ?, ?, ?, ?, ?)
    `),
    insertAssessment: db.prepare(`
        INSERT INTO ml_consensus_assessments
        (user_id, resolved_env, assessment_id, signals_json,
         raw_count, effective_count, mean_pairwise_dependence,
         inflation_factor, verdict, ts)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    listAssessments: db.prepare(`
        SELECT * FROM ml_consensus_assessments
        WHERE user_id = ? AND resolved_env = ?
        ORDER BY ts DESC LIMIT ?
    `),
    listByVerdict: db.prepare(`
        SELECT * FROM ml_consensus_assessments
        WHERE user_id = ? AND resolved_env = ? AND verdict = ?
        ORDER BY ts DESC LIMIT ?
    `)
};

// ── computePairwiseDependence (pure) ───────────────────────────────
// Jaccard similarity on ancestor sets: |A∩B| / |A∪B|
function computePairwiseDependence(params) {
    const ancestorsA = _required(params, 'ancestorsA');
    const ancestorsB = _required(params, 'ancestorsB');
    const setA = ancestorsA instanceof Set ? ancestorsA : new Set(ancestorsA);
    const setB = ancestorsB instanceof Set ? ancestorsB : new Set(ancestorsB);

    if (setA.size === 0 && setB.size === 0) {
        return { dependence: 0 };
    }
    let intersect = 0;
    for (const x of setA) if (setB.has(x)) intersect++;
    const union = setA.size + setB.size - intersect;
    if (union === 0) return { dependence: 0 };
    return { dependence: intersect / union };
}

// ── computeEffectiveCount (pure) ───────────────────────────────────
// effective = raw × (1 − meanDep), floor 1 (if raw>=1)
function computeEffectiveCount(params) {
    const rawCount = _required(params, 'rawCount');
    const meanDep = _required(params, 'meanPairwiseDependence');
    if (rawCount < 0) {
        throw new Error('falseConsensusDetector: rawCount must be >=0');
    }
    if (meanDep < 0 || meanDep > 1) {
        throw new Error('falseConsensusDetector: meanPairwiseDependence must be in [0,1]');
    }
    if (rawCount === 0) return { effectiveCount: 0 };
    const eff = rawCount * (1 - meanDep);
    return { effectiveCount: Math.max(1, eff) };
}

// ── classifyConsensus (pure) ───────────────────────────────────────
function classifyConsensus(params) {
    const meanDep = _required(params, 'meanPairwiseDependence');
    if (meanDep < 0 || meanDep > 1) {
        throw new Error('falseConsensusDetector: meanPairwiseDependence must be in [0,1]');
    }
    let verdict;
    if (meanDep < DEPENDENCE_THRESHOLDS.robust) {
        verdict = 'robust_independent';
    } else if (meanDep <= DEPENDENCE_THRESHOLDS.pseudo) {
        verdict = 'partially_shared';
    } else {
        verdict = 'highly_coupled_pseudo';
    }
    return { verdict, meanPairwiseDependence: meanDep };
}

// ── computeInflationPenalty (pure) ─────────────────────────────────
// inflationFactor = (raw - effective) / raw, clamped [0,1]
function computeInflationPenalty(params) {
    const rawCount = _required(params, 'rawCount');
    const effectiveCount = _required(params, 'effectiveCount');
    if (rawCount <= 0) return { inflationFactor: 0 };
    const raw = (rawCount - effectiveCount) / rawCount;
    return { inflationFactor: Math.max(0, Math.min(1, raw)) };
}

// ── recordDependenceEdge ───────────────────────────────────────────
function recordDependenceEdge(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const edgeId = _required(params, 'edgeId');
    const signalId = _required(params, 'signalId');
    const upstreamSourceId = _required(params, 'upstreamSourceId');
    const ts = (params && params.ts) ? params.ts : Date.now();

    try {
        _stmts.insertEdge.run(
            userId, env, edgeId, signalId, upstreamSourceId, ts
        );
        return { recorded: true, edgeId };
    } catch (err) {
        if (err.code === 'SQLITE_CONSTRAINT_UNIQUE' ||
            (err.message && err.message.includes('UNIQUE'))) {
            throw new Error(`falseConsensusDetector: duplicate edgeId "${edgeId}"`);
        }
        throw err;
    }
}

// ── assessConsensus ────────────────────────────────────────────────
function assessConsensus(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const assessmentId = _required(params, 'assessmentId');
    const signalAncestorsMap = _required(params, 'signalAncestorsMap');
    const ts = (params && params.ts) ? params.ts : Date.now();

    const signalIds = Object.keys(signalAncestorsMap);
    const rawCount = signalIds.length;
    if (rawCount < MIN_SIGNALS) {
        throw new Error(
            `falseConsensusDetector: at least ${MIN_SIGNALS} signals required (MIN_SIGNALS)`
        );
    }

    // Pairwise dependence matrix
    let pairSum = 0;
    let pairCount = 0;
    for (let i = 0; i < signalIds.length; i++) {
        for (let j = i + 1; j < signalIds.length; j++) {
            const { dependence } = computePairwiseDependence({
                ancestorsA: new Set(signalAncestorsMap[signalIds[i]] || []),
                ancestorsB: new Set(signalAncestorsMap[signalIds[j]] || [])
            });
            pairSum += dependence;
            pairCount++;
        }
    }
    const meanPairwiseDependence = pairCount > 0
        ? pairSum / pairCount : 0;

    const { effectiveCount } = computeEffectiveCount({
        rawCount, meanPairwiseDependence
    });
    const { verdict } = classifyConsensus({ meanPairwiseDependence });
    const { inflationFactor } = computeInflationPenalty({
        rawCount, effectiveCount
    });

    try {
        _stmts.insertAssessment.run(
            userId, env, assessmentId,
            JSON.stringify(signalIds),
            rawCount, effectiveCount,
            meanPairwiseDependence, inflationFactor,
            verdict, ts
        );
        return {
            assessed: true, assessmentId,
            rawCount, effectiveCount,
            meanPairwiseDependence, inflationFactor,
            verdict
        };
    } catch (err) {
        if (err.code === 'SQLITE_CONSTRAINT_UNIQUE' ||
            (err.message && err.message.includes('UNIQUE'))) {
            throw new Error(
                `falseConsensusDetector: duplicate assessmentId "${assessmentId}"`
            );
        }
        throw err;
    }
}

// ── getAssessmentHistory ───────────────────────────────────────────
function getAssessmentHistory(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const verdictFilter = params && params.verdictFilter;
    const limit = (params && params.limit) ? params.limit : 100;

    if (verdictFilter && !CONSENSUS_VERDICTS.includes(verdictFilter)) {
        throw new Error(
            `falseConsensusDetector: invalid verdictFilter "${verdictFilter}"`
        );
    }
    const rows = verdictFilter
        ? _stmts.listByVerdict.all(userId, env, verdictFilter, limit)
        : _stmts.listAssessments.all(userId, env, limit);
    return rows.map(r => ({
        assessmentId: r.assessment_id,
        signals: JSON.parse(r.signals_json),
        rawCount: r.raw_count,
        effectiveCount: r.effective_count,
        meanPairwiseDependence: r.mean_pairwise_dependence,
        inflationFactor: r.inflation_factor,
        verdict: r.verdict,
        ts: r.ts
    }));
}

module.exports = {
    CONSENSUS_VERDICTS,
    DEPENDENCE_THRESHOLDS,
    MIN_SIGNALS,
    computePairwiseDependence,
    computeEffectiveCount,
    classifyConsensus,
    computeInflationPenalty,
    recordDependenceEdge,
    assessConsensus,
    getAssessmentHistory
};
