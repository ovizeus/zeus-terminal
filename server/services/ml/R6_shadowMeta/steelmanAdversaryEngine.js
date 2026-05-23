'use strict';

/**
 * OMEGA R6 ShadowMeta — steelmanAdversaryEngine (canonical §133)
 *
 * §133 STEELMAN ADVERSARY ENGINE / STRONGEST OPPOSING WORLDVIEW BUILDER.
 * Source: /root/_review/ml_brain/ml_brain_canonic.txt lines 3881-3912.
 *
 * "Nu este suficient sa ai ipoteze rivale. Trebuie sa construiesti
 *  deliberat cea mai puternica versiune a tezei opuse, nu o caricatura
 *  slaba... fara steelman, opozitia interna devine teatru... requirement
 *  de a folosi cele mai bune argumente ale opozitiei + steelman quality
 *  score + decizie finala conditionata de forta steelman-ului, nu doar de
 *  slabiciunea opozitiei... 'daca cel mai inteligent adversar al meu ar
 *  incerca sa ma contrazica, ce ar spune?'... previne victoria facila a
 *  tezei dominante + ridica standardul intern de aprobare."
 *
 * Distinct from §124 pluralSelfChamber (R6 — passive worldview registry +
 * dissent measurement), §113 socraticSelfDoubt (_meta — adversarial
 * counterfactual generation, questions), §112 competingHypothesesEngine
 * (R2 — thesis market multiple), §128 falseConsensusDetector (R6 — fake
 * consensus detection). §133 = active synthesis engine: pulls best
 * counter-arguments from registered library, composes strongest opposing
 * case, decision approval conditional on steelman quality + approval gap.
 */

const { db } = require('../../database');

const QUALITY_VERDICTS = Object.freeze(['weak', 'moderate', 'strong']);
const QUALITY_THRESHOLDS = Object.freeze({
    strong: 0.70,
    moderate: 0.40
});
const MIN_ARGUMENTS_FOR_STEELMAN = 2;
const APPROVAL_GAP = Object.freeze({
    weak: 0.10,
    moderate: 0.30,
    strong: 0.50
});

const _SEPARATOR = ' | ';

function _required(params, key) {
    if (!params || params[key] === undefined || params[key] === null) {
        throw new Error(`steelmanAdversaryEngine: missing ${key}`);
    }
    return params[key];
}

const _stmts = {
    insertArgument: db.prepare(`
        INSERT INTO ml_steelman_arguments
        (user_id, resolved_env, argument_id, against_thesis_type,
         argument_text, argument_strength,
         evidence_requirements_json, active, ts)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    listActiveByType: db.prepare(`
        SELECT * FROM ml_steelman_arguments
        WHERE user_id = ? AND resolved_env = ?
          AND against_thesis_type = ? AND active = 1
        ORDER BY ts ASC
    `),
    insertConstruction: db.prepare(`
        INSERT INTO ml_steelman_constructions
        (user_id, resolved_env, construction_id, decision_id,
         primary_thesis, opposing_thesis_type,
         selected_arguments_json, composed_steelman,
         quality_score, quality_verdict, primary_conviction,
         decision_approved, ts)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    listByDecision: db.prepare(`
        SELECT * FROM ml_steelman_constructions
        WHERE user_id = ? AND resolved_env = ? AND decision_id = ?
        ORDER BY ts ASC LIMIT ?
    `),
    listAll: db.prepare(`
        SELECT * FROM ml_steelman_constructions
        WHERE user_id = ? AND resolved_env = ?
        ORDER BY ts DESC LIMIT ?
    `)
};

// ── evidenceMatches (pure) ─────────────────────────────────────────
// Every required key must be present in available AND value match.
function evidenceMatches(params) {
    const requirements = _required(params, 'requirements');
    const available = _required(params, 'available');
    const keys = Object.keys(requirements);
    if (keys.length === 0) {
        return { matches: true, matchFraction: 1.0 };
    }
    let matched = 0;
    for (const k of keys) {
        if (available[k] === requirements[k]) matched++;
    }
    const fraction = matched / keys.length;
    return {
        matches: matched === keys.length,
        matchFraction: fraction
    };
}

// ── computeArgumentApplicability (pure) ────────────────────────────
// strength × evidenceMatchFraction
function computeArgumentApplicability(params) {
    const strength = _required(params, 'argumentStrength');
    const matchFraction = _required(params, 'evidenceMatchFraction');
    if (strength < 0 || strength > 1) {
        throw new Error(
            'steelmanAdversaryEngine: argumentStrength must be in [0,1]'
        );
    }
    if (matchFraction < 0 || matchFraction > 1) {
        throw new Error(
            'steelmanAdversaryEngine: evidenceMatchFraction must be in [0,1]'
        );
    }
    return { applicabilityScore: strength * matchFraction };
}

// ── computeSteelmanQualityScore (pure) ─────────────────────────────
// Average of applicable scores, but requires ≥ MIN_ARGUMENTS_FOR_STEELMAN
// non-zero entries; otherwise insufficient (returns 0 + insufficient flag).
function computeSteelmanQualityScore(params) {
    const scores = _required(params, 'applicableScores');
    if (!Array.isArray(scores)) {
        throw new Error(
            'steelmanAdversaryEngine: applicableScores must be array'
        );
    }
    const nonZero = scores.filter(s => s > 0);
    if (nonZero.length < MIN_ARGUMENTS_FOR_STEELMAN) {
        return { qualityScore: 0, insufficient: true };
    }
    const avg = nonZero.reduce((a, b) => a + b, 0) / nonZero.length;
    return {
        qualityScore: Math.max(0, Math.min(1, avg)),
        insufficient: false
    };
}

// ── classifyQuality (pure) ─────────────────────────────────────────
function classifyQuality(params) {
    const score = _required(params, 'qualityScore');
    if (score < 0 || score > 1) {
        throw new Error(
            'steelmanAdversaryEngine: qualityScore must be in [0,1]'
        );
    }
    let verdict;
    if (score >= QUALITY_THRESHOLDS.strong) verdict = 'strong';
    else if (score >= QUALITY_THRESHOLDS.moderate) verdict = 'moderate';
    else verdict = 'weak';
    return { qualityVerdict: verdict, qualityScore: score };
}

// ── shouldApproveDecision (pure) ───────────────────────────────────
// primaryConviction - qualityScore ≥ APPROVAL_GAP[verdict] → approve
function shouldApproveDecision(params) {
    const primary = _required(params, 'primaryConviction');
    const quality = _required(params, 'qualityScore');
    const verdict = _required(params, 'qualityVerdict');
    if (!QUALITY_VERDICTS.includes(verdict)) {
        throw new Error(
            `steelmanAdversaryEngine: invalid qualityVerdict "${verdict}"`
        );
    }
    if (primary < 0 || primary > 1 || quality < 0 || quality > 1) {
        throw new Error(
            'steelmanAdversaryEngine: conviction/score must be in [0,1]'
        );
    }
    const gap = APPROVAL_GAP[verdict];
    const delta = primary - quality;
    return {
        approved: delta >= gap,
        delta, requiredGap: gap
    };
}

// ── composeSteelman (pure) ─────────────────────────────────────────
function composeSteelman(params) {
    const texts = _required(params, 'argumentTexts');
    if (!Array.isArray(texts)) {
        throw new Error(
            'steelmanAdversaryEngine: argumentTexts must be array'
        );
    }
    return { composed: texts.join(_SEPARATOR) };
}

// ── registerArgument ───────────────────────────────────────────────
function registerArgument(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const argumentId = _required(params, 'argumentId');
    const againstType = _required(params, 'againstThesisType');
    const text = _required(params, 'argumentText');
    const strength = _required(params, 'argumentStrength');
    const requirements = _required(params, 'evidenceRequirements');
    const active = (params && params.active !== undefined)
        ? (params.active ? 1 : 0) : 1;
    const ts = (params && params.ts) ? params.ts : Date.now();

    if (strength < 0 || strength > 1) {
        throw new Error(
            'steelmanAdversaryEngine: argumentStrength must be in [0,1]'
        );
    }
    try {
        _stmts.insertArgument.run(
            userId, env, argumentId, againstType, text,
            strength, JSON.stringify(requirements), active, ts
        );
        return { registered: true, argumentId };
    } catch (err) {
        if (err.code === 'SQLITE_CONSTRAINT_UNIQUE' ||
            (err.message && err.message.includes('UNIQUE'))) {
            throw new Error(
                `steelmanAdversaryEngine: duplicate argumentId "${argumentId}"`
            );
        }
        throw err;
    }
}

// ── constructSteelman (integration) ────────────────────────────────
function constructSteelman(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const constructionId = _required(params, 'constructionId');
    const decisionId = _required(params, 'decisionId');
    const primaryThesis = _required(params, 'primaryThesis');
    const opposingType = _required(params, 'opposingThesisType');
    const availableEvidence = _required(params, 'availableEvidence');
    const primaryConviction = _required(params, 'primaryConviction');
    const ts = (params && params.ts) ? params.ts : Date.now();

    if (primaryConviction < 0 || primaryConviction > 1) {
        throw new Error(
            'steelmanAdversaryEngine: primaryConviction must be in [0,1]'
        );
    }

    const argumentsForType = _stmts.listActiveByType
        .all(userId, env, opposingType);

    const selectedArguments = [];
    const argumentTexts = [];
    const applicableScores = [];
    for (const arg of argumentsForType) {
        const requirements = JSON.parse(arg.evidence_requirements_json);
        const { matchFraction } = evidenceMatches({
            requirements, available: availableEvidence
        });
        const { applicabilityScore } = computeArgumentApplicability({
            argumentStrength: arg.argument_strength,
            evidenceMatchFraction: matchFraction
        });
        if (applicabilityScore > 0) {
            selectedArguments.push(arg.argument_id);
            argumentTexts.push(arg.argument_text);
            applicableScores.push(applicabilityScore);
        }
    }

    const { qualityScore } = computeSteelmanQualityScore({
        applicableScores
    });
    const { qualityVerdict } = classifyQuality({ qualityScore });
    const { composed } = composeSteelman({ argumentTexts });
    const { approved } = shouldApproveDecision({
        primaryConviction, qualityScore, qualityVerdict
    });

    try {
        _stmts.insertConstruction.run(
            userId, env, constructionId, decisionId,
            primaryThesis, opposingType,
            JSON.stringify(selectedArguments),
            composed, qualityScore, qualityVerdict,
            primaryConviction, approved ? 1 : 0, ts
        );
        return {
            constructed: true, constructionId,
            qualityScore, qualityVerdict,
            primaryConviction, decisionApproved: approved,
            selectedArguments, composedSteelman: composed
        };
    } catch (err) {
        if (err.code === 'SQLITE_CONSTRAINT_UNIQUE' ||
            (err.message && err.message.includes('UNIQUE'))) {
            throw new Error(
                `steelmanAdversaryEngine: duplicate constructionId "${constructionId}"`
            );
        }
        throw err;
    }
}

// ── getConstructionHistory ─────────────────────────────────────────
function getConstructionHistory(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const decisionId = params && params.decisionId;
    const limit = (params && params.limit) ? params.limit : 100;

    const rows = decisionId
        ? _stmts.listByDecision.all(userId, env, decisionId, limit)
        : _stmts.listAll.all(userId, env, limit);
    return rows.map(r => ({
        constructionId: r.construction_id,
        decisionId: r.decision_id,
        primaryThesis: r.primary_thesis,
        opposingThesisType: r.opposing_thesis_type,
        selectedArguments: JSON.parse(r.selected_arguments_json),
        composedSteelman: r.composed_steelman,
        qualityScore: r.quality_score,
        qualityVerdict: r.quality_verdict,
        primaryConviction: r.primary_conviction,
        decisionApproved: r.decision_approved === 1,
        ts: r.ts
    }));
}

module.exports = {
    QUALITY_VERDICTS,
    QUALITY_THRESHOLDS,
    MIN_ARGUMENTS_FOR_STEELMAN,
    APPROVAL_GAP,
    evidenceMatches,
    computeArgumentApplicability,
    computeSteelmanQualityScore,
    classifyQuality,
    shouldApproveDecision,
    composeSteelman,
    registerArgument,
    constructSteelman,
    getConstructionHistory
};
