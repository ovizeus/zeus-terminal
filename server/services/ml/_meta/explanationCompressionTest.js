'use strict';

/**
 * OMEGA _meta — explanationCompressionTest (canonical §137)
 *
 * §137 EXPLANATION COMPRESSION TEST / UNDERSTANDING DENSITY ENGINE.
 * Source: /root/_review/ml_brain/ml_brain_canonic.txt lines 4045-4090.
 *
 * "Un sistem care intelege cu adevarat o situatie ar trebui sa poata
 *  genera o explicatie suficient de scurta, precisa si densa. Cand
 *  explicatia devine excesiv de lunga, stufoasa sau decorativa, acesta
 *  poate fi semn ca sistemul nu intelege, ci doar compune... explanation
 *  compression score + minimum sufficient explanation test + ratio intre
 *  lungimea explicatiei / puterea explicativa reala / numarul de premise
 *  necesare + detectie de explicatie redundanta / circulara / decorativa
 *  / prea comprimata si opaca + explanation density metric... 'pot explica
 *  asta clar, scurt si cu miez, sau doar vorbesc mult?'... penalizeaza
 *  deciziile care cer povesti prea lungi pentru a parea sensibile."
 *
 * Reguli explicite din canonical:
 * - "explicatia nu trebuie sa fie nici inflata, nici prea comprimata
 *    pana devine mistica"
 * - "daca o teza cere prea multa retorica pentru prea putina claritate,
 *    increderea ei scade"
 * - "densitatea explicativa trebuie masurata separat de simpla fluenta
 *    verbala"
 *
 * Distinct from §43 noTradeExplainability (cross-cutting — no-trade
 * specific), §132 semanticGroundingCheck (_meta — numeric anchoring per
 * concept), §117 epistemicProvenance (_audit — lineage), §134
 * representationDebtTracker (_meta — predict vs actual drift). §137 =
 * understanding density as compression proxy (independent of grounding,
 * lineage, or accuracy).
 */

const { db } = require('../../database');

const ISSUE_KINDS = Object.freeze([
    'healthy', 'redundant', 'circular',
    'decorative', 'over_compressed'
]);
const COMPRESSION_THRESHOLDS = Object.freeze({
    healthy_min: 0.30,
    over_compressed_min: 0.90
});
const DENSITY_THRESHOLDS = Object.freeze({
    decorative_max: 0.02,
    healthy_min: 0.05
});
const REDUNDANT_PREMISE_RATIO = 0.30;
const TRUST_PENALTY_MAP = Object.freeze({
    healthy: 0,
    redundant: 0.20,
    circular: 0.50,
    decorative: 0.30,
    over_compressed: 0.25
});

function _required(params, key) {
    if (!params || params[key] === undefined || params[key] === null) {
        throw new Error(`explanationCompressionTest: missing ${key}`);
    }
    return params[key];
}

const _stmts = {
    insertAssessment: db.prepare(`
        INSERT INTO ml_explanation_assessments
        (user_id, resolved_env, assessment_id, decision_id,
         explanation_text, word_count, claim_count, premise_count,
         explanatory_power, compression_score, density_metric,
         is_circular, issue_kind, trust_penalty, ts)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    latestByDecision: db.prepare(`
        SELECT * FROM ml_explanation_assessments
        WHERE user_id = ? AND resolved_env = ? AND decision_id = ?
        ORDER BY ts DESC LIMIT 1
    `),
    listAll: db.prepare(`
        SELECT * FROM ml_explanation_assessments
        WHERE user_id = ? AND resolved_env = ?
        ORDER BY ts DESC LIMIT ?
    `),
    listByIssue: db.prepare(`
        SELECT * FROM ml_explanation_assessments
        WHERE user_id = ? AND resolved_env = ?
          AND issue_kind = ?
        ORDER BY ts DESC LIMIT ?
    `),
    distribution: db.prepare(`
        SELECT issue_kind, COUNT(*) AS cnt
        FROM ml_explanation_assessments
        WHERE user_id = ? AND resolved_env = ? AND ts >= ?
        GROUP BY issue_kind
    `)
};

// ── computeCompressionScore (pure) ─────────────────────────────────
// compressionScore = explanatoryPower / log10(max(wordCount, 10))
// — short clear explanations have high compression; long with low power = low
function computeCompressionScore(params) {
    const power = _required(params, 'explanatoryPower');
    const wordCount = _required(params, 'wordCount');
    if (power < 0 || power > 1) {
        throw new Error(
            'explanationCompressionTest: explanatoryPower must be in [0,1]'
        );
    }
    if (wordCount < 1) {
        throw new Error(
            'explanationCompressionTest: wordCount must be ≥ 1'
        );
    }
    const denominator = Math.log10(Math.max(wordCount, 10));
    const raw = power / denominator;
    return { compressionScore: Math.max(0, Math.min(1, raw)) };
}

// ── computeDensityMetric (pure) ────────────────────────────────────
function computeDensityMetric(params) {
    const claims = _required(params, 'claimCount');
    const words = _required(params, 'wordCount');
    if (claims < 0 || words < 1) {
        throw new Error(
            'explanationCompressionTest: invalid claims/words count'
        );
    }
    const raw = claims / words;
    return { densityMetric: Math.max(0, Math.min(1, raw)) };
}

// ── assessMinimumSufficiency (pure) ────────────────────────────────
function assessMinimumSufficiency(params) {
    const claims = _required(params, 'claimCount');
    const premises = _required(params, 'premiseCount');
    if (claims < 0 || premises < 0) {
        throw new Error(
            'explanationCompressionTest: counts must be non-negative'
        );
    }
    return { sufficient: premises >= claims };
}

// ── detectExplanationIssue (pure) ──────────────────────────────────
// Priority ladder: circular > over_compressed > decorative > redundant > healthy
function detectExplanationIssue(params) {
    const compression = _required(params, 'compressionScore');
    const density = _required(params, 'densityMetric');
    const claims = _required(params, 'claimCount');
    const premises = _required(params, 'premiseCount');
    const isCircular = params && params.isCircular === true;

    if (isCircular) {
        return { issueKind: 'circular' };
    }
    if (compression >= COMPRESSION_THRESHOLDS.over_compressed_min) {
        return { issueKind: 'over_compressed' };
    }
    if (density < DENSITY_THRESHOLDS.decorative_max) {
        return { issueKind: 'decorative' };
    }
    if (claims > 0 && premises > 0 &&
        (claims / premises) < REDUNDANT_PREMISE_RATIO) {
        return { issueKind: 'redundant' };
    }
    return { issueKind: 'healthy' };
}

// ── computeTrustPenalty (pure) ─────────────────────────────────────
function computeTrustPenalty(params) {
    const kind = _required(params, 'issueKind');
    if (!ISSUE_KINDS.includes(kind)) {
        throw new Error(
            `explanationCompressionTest: invalid issueKind "${kind}"`
        );
    }
    return { trustPenalty: TRUST_PENALTY_MAP[kind], issueKind: kind };
}

// ── recordExplanationAssessment (integration) ──────────────────────
function recordExplanationAssessment(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const assessmentId = _required(params, 'assessmentId');
    const decisionId = _required(params, 'decisionId');
    const text = _required(params, 'explanationText');
    const claimCount = _required(params, 'claimCount');
    const premiseCount = _required(params, 'premiseCount');
    const power = _required(params, 'explanatoryPower');
    const isCircular = params && params.isCircular === true;
    const ts = (params && params.ts) ? params.ts : Date.now();

    if (typeof text !== 'string' || text.length === 0) {
        throw new Error(
            'explanationCompressionTest: explanationText must be non-empty string'
        );
    }
    if (power < 0 || power > 1) {
        throw new Error(
            'explanationCompressionTest: explanatoryPower must be in [0,1]'
        );
    }
    if (claimCount < 0 || premiseCount < 0) {
        throw new Error(
            'explanationCompressionTest: counts must be non-negative'
        );
    }

    // word_count = whitespace-separated tokens, ≥ 1
    const wordCount = Math.max(1,
        text.split(/\s+/).filter(s => s.length > 0).length);

    const { compressionScore } = computeCompressionScore({
        explanatoryPower: power, wordCount
    });
    const { densityMetric } = computeDensityMetric({
        claimCount, wordCount
    });
    const { issueKind } = detectExplanationIssue({
        compressionScore, densityMetric,
        claimCount, premiseCount, isCircular
    });
    const { trustPenalty } = computeTrustPenalty({ issueKind });

    try {
        _stmts.insertAssessment.run(
            userId, env, assessmentId, decisionId,
            text, wordCount, claimCount, premiseCount,
            power, compressionScore, densityMetric,
            isCircular ? 1 : 0, issueKind, trustPenalty, ts
        );
        return {
            recorded: true, assessmentId,
            wordCount, compressionScore, densityMetric,
            issueKind, trustPenalty
        };
    } catch (err) {
        if (err.code === 'SQLITE_CONSTRAINT_UNIQUE' ||
            (err.message && err.message.includes('UNIQUE'))) {
            throw new Error(
                `explanationCompressionTest: duplicate assessmentId "${assessmentId}"`
            );
        }
        throw err;
    }
}

function _rowToAssessment(r) {
    return {
        assessmentId: r.assessment_id,
        decisionId: r.decision_id,
        explanationText: r.explanation_text,
        wordCount: r.word_count,
        claimCount: r.claim_count,
        premiseCount: r.premise_count,
        explanatoryPower: r.explanatory_power,
        compressionScore: r.compression_score,
        densityMetric: r.density_metric,
        isCircular: r.is_circular === 1,
        issueKind: r.issue_kind,
        trustPenalty: r.trust_penalty,
        ts: r.ts
    };
}

// ── getAssessmentForDecision ───────────────────────────────────────
function getAssessmentForDecision(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const decisionId = _required(params, 'decisionId');
    const r = _stmts.latestByDecision.get(userId, env, decisionId);
    if (!r) return null;
    return _rowToAssessment(r);
}

// ── getAssessmentHistory ───────────────────────────────────────────
function getAssessmentHistory(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const issueFilter = params && params.issueFilter;
    const limit = (params && params.limit) ? params.limit : 100;

    if (issueFilter && !ISSUE_KINDS.includes(issueFilter)) {
        throw new Error(
            `explanationCompressionTest: invalid issueFilter "${issueFilter}"`
        );
    }
    const rows = issueFilter
        ? _stmts.listByIssue.all(userId, env, issueFilter, limit)
        : _stmts.listAll.all(userId, env, limit);
    return rows.map(_rowToAssessment);
}

// ── getQualityDistribution ─────────────────────────────────────────
function getQualityDistribution(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const sinceTs = (params && params.sinceTs !== undefined)
        ? params.sinceTs : 0;
    const rows = _stmts.distribution.all(userId, env, sinceTs);
    const dist = {};
    for (const r of rows) {
        dist[r.issue_kind] = r.cnt;
    }
    return dist;
}

module.exports = {
    ISSUE_KINDS,
    COMPRESSION_THRESHOLDS,
    DENSITY_THRESHOLDS,
    REDUNDANT_PREMISE_RATIO,
    TRUST_PENALTY_MAP,
    computeCompressionScore,
    computeDensityMetric,
    assessMinimumSufficiency,
    detectExplanationIssue,
    computeTrustPenalty,
    recordExplanationAssessment,
    getAssessmentForDecision,
    getAssessmentHistory,
    getQualityDistribution
};
