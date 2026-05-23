'use strict';

/**
 * OMEGA _meta — epistemicTensionField (canonical §125)
 *
 * §125 EPISTEMIC TENSION FIELD / PRE-CONTRADICTION STRESS ENGINE.
 * Source: /root/_review/ml_brain/ml_brain_canonic.txt lines 3494-3552.
 *
 * "INAINTE ca o contradictie sa devina explicita, sistemul acumuleaza
 *  tensiuni fine: mici nepotriviri intre semnale/ipoteze/priors/timeline-uri/
 *  confidence/unknowns/constrangeri operationale, care luate separat par
 *  suportabile, dar impreuna prevestesc ruptura... motor care masoara
 *  stresul intern al cunoasterii inainte sa erupa... tension field map
 *  intre 8 surse... gradient: local/global/persistent/acute... thresholds
 *  pentru continue/caution/reduce_size/observer/full_freeze... NU
 *  inlocuieste veto/drift/OOD; le SUPRAPUNE intr-un stres compus."
 *
 * Distinct from §120 unknownsRegistry (explicit ignorance), §121
 * reflectiveEquilibriumEngine (post-hoc cross-layer audit), §44
 * adversarialSelfTester (post-attack), §29 circuitBreaker (active),
 * §38 intelligenceChecker (per-decision eval), §122 selfModel (capability).
 * §125 = continuous pre-contradiction stress aggregator.
 */

const { db } = require('../../database');

const TENSION_SOURCES = Object.freeze([
    'hypotheses', 'thesis_nodes', 'regime_beliefs',
    'confidence_bounds', 'unknowns', 'competence',
    'operational_health', 'utility_priorities'
]);
const GRADIENT_KINDS = Object.freeze([
    'local', 'global', 'persistent', 'acute'
]);
const RECOMMENDED_STATES = Object.freeze([
    'continue', 'caution', 'reduce_size', 'observer', 'full_freeze'
]);

const THRESHOLDS = Object.freeze({
    caution: 0.20,
    reduce: 0.40,
    observer: 0.60,
    freeze: 0.80
});

const PERSISTENT_DOMINANCE = 0.55;
const ACUTE_DOMINANCE = 0.70;

function _required(params, key) {
    if (!params || params[key] === undefined || params[key] === null) {
        throw new Error(`epistemicTensionField: missing ${key}`);
    }
    return params[key];
}

const _stmts = {
    insertAssessment: db.prepare(`
        INSERT INTO ml_tension_assessments
        (user_id, resolved_env, assessment_id, sources_json,
         tension_score, gradient_kind, recommended_state, ts)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `),
    listAssessments: db.prepare(`
        SELECT * FROM ml_tension_assessments
        WHERE user_id = ? AND resolved_env = ?
        ORDER BY ts DESC LIMIT ?
    `),
    listByGradient: db.prepare(`
        SELECT * FROM ml_tension_assessments
        WHERE user_id = ? AND resolved_env = ? AND gradient_kind = ?
        ORDER BY ts DESC LIMIT ?
    `),
    insertSource: db.prepare(`
        INSERT INTO ml_tension_sources_audit
        (user_id, resolved_env, audit_id, assessment_id,
         source_kind, contribution_score, notes, ts)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `)
};

// ── computeTensionScore (pure) ─────────────────────────────────────
function computeTensionScore(params) {
    const contribs = _required(params, 'sourceContributions');
    let sum = 0;
    let count = 0;
    for (const src of TENSION_SOURCES) {
        const v = contribs[src];
        if (v === undefined || v === null) continue;
        if (typeof v !== 'number') {
            throw new Error(
                `epistemicTensionField: ${src} contribution must be number`
            );
        }
        if (v < 0 || v > 1) {
            throw new Error(
                `epistemicTensionField: ${src} contribution must be in [0,1]`
            );
        }
        sum += v;
        count++;
    }
    if (count === 0) {
        return { tensionScore: 0, sourceCount: 0 };
    }
    // Divide by ALL canonical sources (not just provided) — missing = 0
    const tensionScore = sum / TENSION_SOURCES.length;
    return { tensionScore, sourceCount: count };
}

// ── classifyGradient (pure) ────────────────────────────────────────
function classifyGradient(params) {
    const localSignal = _required(params, 'localSignal');
    const globalSignal = _required(params, 'globalSignal');
    const persistentSignal = _required(params, 'persistentSignal');
    const acuteSignal = _required(params, 'acuteSignal');
    for (const [k, v] of [['localSignal', localSignal], ['globalSignal', globalSignal],
                           ['persistentSignal', persistentSignal],
                           ['acuteSignal', acuteSignal]]) {
        if (v < 0 || v > 1) {
            throw new Error(`epistemicTensionField: ${k} must be in [0,1]`);
        }
    }
    // acute beats persistent (single spike wins over slow build)
    if (acuteSignal >= ACUTE_DOMINANCE) {
        return { gradientKind: 'acute', acute: acuteSignal };
    }
    if (persistentSignal >= PERSISTENT_DOMINANCE) {
        return { gradientKind: 'persistent', persistent: persistentSignal };
    }
    if (globalSignal > localSignal) {
        return { gradientKind: 'global', local: localSignal, global: globalSignal };
    }
    return { gradientKind: 'local', local: localSignal, global: globalSignal };
}

// ── selectRecommendedState (pure) ──────────────────────────────────
function selectRecommendedState(params) {
    const tensionScore = _required(params, 'tensionScore');
    if (tensionScore < 0 || tensionScore > 1) {
        throw new Error('epistemicTensionField: tensionScore must be in [0,1]');
    }
    const isPersistent = !!(params && params.isPersistent);

    let state;
    let reason;
    if (tensionScore >= THRESHOLDS.freeze) {
        state = 'full_freeze';
        reason = 'extreme_tension';
    } else if (tensionScore >= THRESHOLDS.observer) {
        state = 'observer';
        reason = 'high_tension';
    } else if (tensionScore >= THRESHOLDS.reduce) {
        state = 'reduce_size';
        reason = 'mid_tension';
    } else if (tensionScore >= THRESHOLDS.caution) {
        state = 'caution';
        reason = 'mid_low_tension';
    } else {
        state = 'continue';
        reason = 'low_tension';
    }

    // Persistent escalation: bump one rung up (canonical line 3547)
    if (isPersistent) {
        const idx = RECOMMENDED_STATES.indexOf(state);
        if (idx < RECOMMENDED_STATES.length - 1) {
            state = RECOMMENDED_STATES[idx + 1];
            reason += '_persistent_escalation';
        }
    }
    return { state, tensionScore, reason };
}

// ── runTensionAssessment ───────────────────────────────────────────
function runTensionAssessment(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const assessmentId = _required(params, 'assessmentId');
    const sourceContributions = _required(params, 'sourceContributions');
    const isPersistent = !!(params && params.isPersistent);
    const ts = (params && params.ts) ? params.ts : Date.now();

    const { tensionScore } = computeTensionScore({ sourceContributions });

    let gradientKind = 'local';
    if (params && params.gradientHints) {
        const r = classifyGradient(params.gradientHints);
        gradientKind = r.gradientKind;
    }

    const { state } = selectRecommendedState({ tensionScore, isPersistent });

    try {
        _stmts.insertAssessment.run(
            userId, env, assessmentId,
            JSON.stringify(sourceContributions),
            tensionScore, gradientKind, state, ts
        );
        return {
            assessed: true, assessmentId,
            tensionScore, gradientKind,
            recommendedState: state
        };
    } catch (err) {
        if (err.code === 'SQLITE_CONSTRAINT_UNIQUE' ||
            (err.message && err.message.includes('UNIQUE'))) {
            throw new Error(
                `epistemicTensionField: duplicate assessmentId "${assessmentId}"`
            );
        }
        throw err;
    }
}

// ── recordTensionSource ────────────────────────────────────────────
function recordTensionSource(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const auditId = _required(params, 'auditId');
    const assessmentId = _required(params, 'assessmentId');
    const sourceKind = _required(params, 'sourceKind');
    if (!TENSION_SOURCES.includes(sourceKind)) {
        throw new Error(`epistemicTensionField: invalid sourceKind "${sourceKind}"`);
    }
    const contributionScore = _required(params, 'contributionScore');
    if (contributionScore < 0 || contributionScore > 1) {
        throw new Error(
            'epistemicTensionField: contributionScore must be in [0,1]'
        );
    }
    const notes = (params && params.notes) ? params.notes : null;
    const ts = (params && params.ts) ? params.ts : Date.now();

    try {
        _stmts.insertSource.run(
            userId, env, auditId, assessmentId,
            sourceKind, contributionScore, notes, ts
        );
        return { recorded: true, auditId };
    } catch (err) {
        if (err.code === 'SQLITE_CONSTRAINT_UNIQUE' ||
            (err.message && err.message.includes('UNIQUE'))) {
            throw new Error(`epistemicTensionField: duplicate auditId "${auditId}"`);
        }
        throw err;
    }
}

// ── getTensionHistory ──────────────────────────────────────────────
function getTensionHistory(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const gradientFilter = params && params.gradientFilter;
    const limit = (params && params.limit) ? params.limit : 100;

    if (gradientFilter && !GRADIENT_KINDS.includes(gradientFilter)) {
        throw new Error(
            `epistemicTensionField: invalid gradientFilter "${gradientFilter}"`
        );
    }
    const rows = gradientFilter
        ? _stmts.listByGradient.all(userId, env, gradientFilter, limit)
        : _stmts.listAssessments.all(userId, env, limit);
    return rows.map(r => ({
        assessmentId: r.assessment_id,
        sources: JSON.parse(r.sources_json),
        tensionScore: r.tension_score,
        gradientKind: r.gradient_kind,
        recommendedState: r.recommended_state,
        ts: r.ts
    }));
}

module.exports = {
    TENSION_SOURCES,
    GRADIENT_KINDS,
    RECOMMENDED_STATES,
    THRESHOLDS,
    computeTensionScore,
    classifyGradient,
    selectRecommendedState,
    runTensionAssessment,
    recordTensionSource,
    getTensionHistory
};
