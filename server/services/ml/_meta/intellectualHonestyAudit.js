'use strict';

/**
 * OMEGA _meta — intellectualHonestyAudit (canonical §147)
 *
 * §147 INTELLECTUAL HONESTY AUDIT / ANTI-RATIONALIZATION ENGINE.
 * Source: /root/_review/ml_brain/ml_brain_canonic.txt lines 4776-4820.
 *
 * "Spun adevarul despre de ce am facut asta sau imi scriu o poveste mai
 *  frumoasa dupa?"
 *
 * Detects when explanations are POST-HOC RATIONALIZATIONS of decisions
 * already made. Three-stage commitment system:
 *   pre_decision   → reasons LOCKED before execution (hash for tamper
 *                    detection)
 *   post_decision  → reasons stated immediately after execution
 *   post_outcome   → reasons stated after outcome known (must be marked
 *                    is_reinterpretation if drift detected)
 *
 * 4 canonical rationalization patterns + 'none':
 *   - post_hoc_beautification (mild post-decision polish)
 *   - explanatory_inflation (more words, same content)
 *   - retrofitting_causal (new "because X" after unfavorable outcome)
 *   - self_excusing_narrative (after favorable outcome, claims foresight
 *     not present in pre_decision)
 *
 * Penalty ladder: 0 / 0.20 / 0.30 / 0.40 / 0.50
 *
 * RULES (canonical, explicit):
 * - "explicatiile critice trebuie locked la momentul deciziei"
 * - "actualizarile ulterioare trebuie marcate explicit ca reinterpretari"
 * - "orice mismatch mare intre motivul initial si motivul ulterior
 *    trebuie investigat"
 *
 * Distinct from §117 epistemicProvenance (lineage), §137 explanation
 * CompressionTest (density), §134 representationDebtTracker (map drift),
 * §43 noTradeExplainability (no-trade specific). §147 = TEMPORAL
 * CONSISTENCY across decision stages.
 */

const { db } = require('../../database');
const crypto = require('crypto');

const STAGES = Object.freeze([
    'pre_decision', 'post_decision', 'post_outcome'
]);

const RATIONALIZATION_PATTERNS = Object.freeze([
    'none', 'post_hoc_beautification',
    'explanatory_inflation', 'retrofitting_causal',
    'self_excusing_narrative'
]);

const DRIFT_THRESHOLDS = Object.freeze({
    investigation: 0.50,
    penalty: 0.20
});

const PENALTY_MAP = Object.freeze({
    none: 0,
    post_hoc_beautification: 0.20,
    explanatory_inflation: 0.30,
    retrofitting_causal: 0.40,
    self_excusing_narrative: 0.50
});

// Heuristic thresholds for pattern classification
const _EXPANSION_RATIO_INFLATION = 3.0;  // 3× word expansion → inflation
const _DRIFT_BEAUTIFICATION = 0.20;       // mild post-decision drift

function _required(params, key) {
    if (!params || params[key] === undefined || params[key] === null) {
        throw new Error(`intellectualHonestyAudit: missing ${key}`);
    }
    return params[key];
}

const _stmts = {
    insertCommitment: db.prepare(`
        INSERT INTO ml_reason_commitments
        (user_id, resolved_env, commitment_id, decision_id, stage,
         reasons_text, reasons_hash, locked_at_ts,
         is_reinterpretation, ts)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    getCommitmentByStage: db.prepare(`
        SELECT * FROM ml_reason_commitments
        WHERE user_id = ? AND resolved_env = ?
          AND decision_id = ? AND stage = ?
    `),
    listCommitmentsForDecision: db.prepare(`
        SELECT * FROM ml_reason_commitments
        WHERE user_id = ? AND resolved_env = ? AND decision_id = ?
        ORDER BY locked_at_ts ASC
    `),
    insertAudit: db.prepare(`
        INSERT INTO ml_honesty_audit_assessments
        (user_id, resolved_env, assessment_id, decision_id,
         pre_decision_commitment_id, post_decision_commitment_id,
         post_outcome_commitment_id,
         pre_to_post_decision_drift, pre_to_post_outcome_drift,
         post_decision_to_post_outcome_drift, max_drift_score,
         rationalization_pattern, honesty_penalty,
         investigation_required, ts)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    latestAudit: db.prepare(`
        SELECT * FROM ml_honesty_audit_assessments
        WHERE user_id = ? AND resolved_env = ? AND decision_id = ?
        ORDER BY ts DESC LIMIT 1
    `)
};

// ── computeReasonHash (pure) ───────────────────────────────────────
function computeReasonHash(params) {
    const text = _required(params, 'text');
    const hash = crypto.createHash('sha256')
        .update(text, 'utf8')
        .digest('hex')
        .slice(0, 32);  // truncated for storage efficiency
    return { hash };
}

// ── computeReasonDrift (pure) ──────────────────────────────────────
// Jaccard-based: 1 - |intersection| / |union| on lowercase token sets.
function computeReasonDrift(params) {
    const baseline = _required(params, 'baselineText');
    const current = _required(params, 'currentText');
    const tokensA = new Set(
        baseline.toLowerCase().split(/\s+/).filter(t => t.length > 0)
    );
    const tokensB = new Set(
        current.toLowerCase().split(/\s+/).filter(t => t.length > 0)
    );
    if (tokensA.size === 0 && tokensB.size === 0) {
        return { drift: 0 };
    }
    let intersect = 0;
    for (const t of tokensA) if (tokensB.has(t)) intersect++;
    const union = tokensA.size + tokensB.size - intersect;
    if (union === 0) return { drift: 0 };
    return { drift: 1 - intersect / union };
}

// ── classifyRationalizationPattern (pure) ──────────────────────────
function classifyRationalizationPattern(params) {
    const preToPostDecision = _required(params, 'preToPostDecisionDrift');
    const preToPostOutcome = _required(params, 'preToPostOutcomeDrift');
    const postDecToOutcome = _required(params, 'postDecisionToPostOutcomeDrift');
    const outcomeFavorable = _required(params, 'outcomeFavorable');
    const outcomeAvailable = _required(params, 'outcomeAvailable');
    const baselineWords = _required(params, 'baselineWordCount');
    const postOutcomeWords = _required(params, 'postOutcomeWordCount');

    // Priority 1: self_excusing or retrofitting (post-outcome high drift)
    if (outcomeAvailable && preToPostOutcome >= DRIFT_THRESHOLDS.investigation) {
        return {
            pattern: outcomeFavorable
                ? 'self_excusing_narrative'
                : 'retrofitting_causal'
        };
    }

    // Priority 2: explanatory_inflation (word expansion ≥ 3× with mild drift)
    if (outcomeAvailable && baselineWords > 0 &&
        postOutcomeWords / baselineWords >= _EXPANSION_RATIO_INFLATION) {
        return { pattern: 'explanatory_inflation' };
    }

    // Priority 3: post_hoc_beautification (mild post-decision drift)
    if (preToPostDecision >= _DRIFT_BEAUTIFICATION) {
        return { pattern: 'post_hoc_beautification' };
    }

    return { pattern: 'none' };
}

// ── computeHonestyPenalty (pure) ───────────────────────────────────
function computeHonestyPenalty(params) {
    const pattern = _required(params, 'pattern');
    if (!RATIONALIZATION_PATTERNS.includes(pattern)) {
        throw new Error(
            `intellectualHonestyAudit: invalid pattern "${pattern}"`
        );
    }
    return { penalty: PENALTY_MAP[pattern] };
}

// ── isInvestigationRequired (pure) ─────────────────────────────────
function isInvestigationRequired(params) {
    const max = _required(params, 'maxDriftScore');
    if (max < 0 || max > 1) {
        throw new Error(
            'intellectualHonestyAudit: maxDriftScore must be in [0,1]'
        );
    }
    return { required: max >= DRIFT_THRESHOLDS.investigation };
}

// ── commitReason ───────────────────────────────────────────────────
function commitReason(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const commitmentId = _required(params, 'commitmentId');
    const decisionId = _required(params, 'decisionId');
    const stage = _required(params, 'stage');
    const reasonsText = _required(params, 'reasonsText');
    const isReinterpretation = _required(params, 'isReinterpretation');
    const lockedAt = (params && params.lockedAtTs)
        ? params.lockedAtTs : Date.now();
    const ts = (params && params.ts) ? params.ts : lockedAt;

    if (!STAGES.includes(stage)) {
        throw new Error(
            `intellectualHonestyAudit: invalid stage "${stage}"`
        );
    }
    if (typeof reasonsText !== 'string' || reasonsText.length === 0) {
        throw new Error(
            'intellectualHonestyAudit: empty reasonsText not allowed'
        );
    }

    const { hash } = computeReasonHash({ text: reasonsText });

    try {
        _stmts.insertCommitment.run(
            userId, env, commitmentId, decisionId, stage,
            reasonsText, hash, lockedAt,
            isReinterpretation ? 1 : 0, ts
        );
        return { committed: true, commitmentId, reasonsHash: hash };
    } catch (err) {
        if (err.code === 'SQLITE_CONSTRAINT_UNIQUE' ||
            (err.message && err.message.includes('UNIQUE'))) {
            throw new Error(
                `intellectualHonestyAudit: duplicate commitment for decision_id="${decisionId}" stage="${stage}" or commitmentId="${commitmentId}"`
            );
        }
        throw err;
    }
}

// ── recordHonestyAudit (integration) ───────────────────────────────
function recordHonestyAudit(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const assId = _required(params, 'assessmentId');
    const decisionId = _required(params, 'decisionId');
    const outcomeFavorable = _required(params, 'outcomeFavorable');
    const outcomeAvailable = _required(params, 'outcomeAvailable');
    const ts = (params && params.ts) ? params.ts : Date.now();

    // Fetch all three stages
    const preCommitment = _stmts.getCommitmentByStage.get(
        userId, env, decisionId, 'pre_decision'
    );
    if (!preCommitment) {
        throw new Error(
            `intellectualHonestyAudit: pre_decision commitment not found for decisionId="${decisionId}"`
        );
    }
    const postDecCommitment = _stmts.getCommitmentByStage.get(
        userId, env, decisionId, 'post_decision'
    );
    const postOutcomeCommitment = _stmts.getCommitmentByStage.get(
        userId, env, decisionId, 'post_outcome'
    );

    // Drift calculations
    const preText = preCommitment.reasons_text;
    const postDecText = postDecCommitment
        ? postDecCommitment.reasons_text : preText;
    const postOutcomeText = postOutcomeCommitment
        ? postOutcomeCommitment.reasons_text : preText;

    const preToPostDecision = postDecCommitment
        ? computeReasonDrift({
            baselineText: preText, currentText: postDecText
        }).drift
        : 0;
    const preToPostOutcome = postOutcomeCommitment
        ? computeReasonDrift({
            baselineText: preText, currentText: postOutcomeText
        }).drift
        : 0;
    const postDecToPostOutcome = (postDecCommitment && postOutcomeCommitment)
        ? computeReasonDrift({
            baselineText: postDecText, currentText: postOutcomeText
        }).drift
        : 0;

    const maxDrift = Math.max(
        preToPostDecision, preToPostOutcome, postDecToPostOutcome
    );

    const baselineWords = preText.split(/\s+/).filter(t => t.length > 0).length;
    const postOutcomeWords = postOutcomeText
        .split(/\s+/).filter(t => t.length > 0).length;

    const { pattern } = classifyRationalizationPattern({
        preToPostDecisionDrift: preToPostDecision,
        preToPostOutcomeDrift: preToPostOutcome,
        postDecisionToPostOutcomeDrift: postDecToPostOutcome,
        outcomeFavorable, outcomeAvailable,
        baselineWordCount: baselineWords,
        postOutcomeWordCount: postOutcomeWords
    });
    const { penalty } = computeHonestyPenalty({ pattern });
    const { required: investigationRequired } = isInvestigationRequired({
        maxDriftScore: maxDrift
    });

    try {
        _stmts.insertAudit.run(
            userId, env, assId, decisionId,
            preCommitment.commitment_id,
            postDecCommitment ? postDecCommitment.commitment_id : null,
            postOutcomeCommitment ? postOutcomeCommitment.commitment_id : null,
            preToPostDecision, preToPostOutcome, postDecToPostOutcome,
            maxDrift, pattern, penalty,
            investigationRequired ? 1 : 0, ts
        );
        return {
            recorded: true, assessmentId: assId,
            preToPostDecisionDrift: preToPostDecision,
            preToPostOutcomeDrift: preToPostOutcome,
            postDecisionToPostOutcomeDrift: postDecToPostOutcome,
            maxDriftScore: maxDrift,
            rationalizationPattern: pattern,
            honestyPenalty: penalty,
            investigationRequired
        };
    } catch (err) {
        if (err.code === 'SQLITE_CONSTRAINT_UNIQUE' ||
            (err.message && err.message.includes('UNIQUE'))) {
            throw new Error(
                `intellectualHonestyAudit: duplicate assessmentId "${assId}"`
            );
        }
        throw err;
    }
}

function _rowToCommitment(r) {
    return {
        commitmentId: r.commitment_id,
        decisionId: r.decision_id,
        stage: r.stage,
        reasonsText: r.reasons_text,
        reasonsHash: r.reasons_hash,
        lockedAtTs: r.locked_at_ts,
        isReinterpretation: r.is_reinterpretation === 1,
        ts: r.ts
    };
}

function _rowToAudit(r) {
    return {
        assessmentId: r.assessment_id,
        decisionId: r.decision_id,
        preDecisionCommitmentId: r.pre_decision_commitment_id,
        postDecisionCommitmentId: r.post_decision_commitment_id,
        postOutcomeCommitmentId: r.post_outcome_commitment_id,
        preToPostDecisionDrift: r.pre_to_post_decision_drift,
        preToPostOutcomeDrift: r.pre_to_post_outcome_drift,
        postDecisionToPostOutcomeDrift: r.post_decision_to_post_outcome_drift,
        maxDriftScore: r.max_drift_score,
        rationalizationPattern: r.rationalization_pattern,
        honestyPenalty: r.honesty_penalty,
        investigationRequired: r.investigation_required === 1,
        ts: r.ts
    };
}

// ── getCommitmentsForDecision ──────────────────────────────────────
function getCommitmentsForDecision(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const decisionId = _required(params, 'decisionId');
    const rows = _stmts.listCommitmentsForDecision.all(
        userId, env, decisionId
    );
    return rows.map(_rowToCommitment);
}

// ── getHonestyAudit ────────────────────────────────────────────────
function getHonestyAudit(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const decisionId = _required(params, 'decisionId');
    const r = _stmts.latestAudit.get(userId, env, decisionId);
    if (!r) return null;
    return _rowToAudit(r);
}

module.exports = {
    STAGES,
    RATIONALIZATION_PATTERNS,
    DRIFT_THRESHOLDS,
    PENALTY_MAP,
    computeReasonHash,
    computeReasonDrift,
    classifyRationalizationPattern,
    computeHonestyPenalty,
    isInvestigationRequired,
    commitReason,
    recordHonestyAudit,
    getCommitmentsForDecision,
    getHonestyAudit
};
