'use strict';

/**
 * OMEGA R5A Learning — conceptLibrary (canonical §114)
 *
 * §114 CONCEPT LIBRARY / SEMANTIC ABSTRACTION ENGINE.
 * Source: /root/_review/ml_brain/ml_brain_canonic.txt lines 3001-3033.
 *
 * "Bot trebuie sa poata comprima experienta in concepte reutilizabile...
 *  concept extraction din pattern-uri recurente... semantic labels...
 *  reusable abstractions de tip exhausted_breakout / fragile_squeeze /
 *  trapped_continuation / macro_opposed_trend / silent_distribution...
 *  concept confidence... concept merging / splitting cand apar date noi...
 *  concept decay si retirement... 'care sunt ideile reutilizabile pe care
 *  le-am invatat?'... conceptele NU sunt etichete decorative... fiecare
 *  trebuie suport empiric si utilitate decizionala."
 *
 * Distinct from §93 regimeGrammar (5-dim atomic DSL), §27 temporalPatterns
 * (time recurrence), §102 crossDomainAnalogy (external domains), §242
 * counterfactualEngine (portfolio replay). §114 = named compound concepts
 * with empirical support + utility tracking.
 */

const { db } = require('../../database');

const CANONICAL_LABELS = Object.freeze([
    'exhausted_breakout', 'fragile_squeeze',
    'trapped_continuation', 'macro_opposed_trend',
    'silent_distribution'
]);
const CONCEPT_STATUSES = Object.freeze([
    'ACTIVE', 'MERGED', 'SPLIT', 'RETIRED'
]);

const MIN_SUPPORT_FOR_ACTIVE = 10;
const MIN_UTILITY_TO_KEEP = 0.20;
const DEFAULT_INITIAL_CONFIDENCE = 0.50;

function _required(params, key) {
    if (!params || params[key] === undefined || params[key] === null) {
        throw new Error(`conceptLibrary: missing ${key}`);
    }
    return params[key];
}

const _stmts = {
    insertConcept: db.prepare(`
        INSERT INTO ml_concepts
        (user_id, resolved_env, concept_id, label, description,
         support_count, utility_score, confidence, status,
         parent_concept_id, ts_created, ts_last_updated)
        VALUES (?, ?, ?, ?, ?, 0, 0, ?, ?, ?, ?, ?)
    `),
    getConcept: db.prepare(`
        SELECT * FROM ml_concepts WHERE concept_id = ?
    `),
    listActiveConcepts: db.prepare(`
        SELECT * FROM ml_concepts
        WHERE user_id = ? AND resolved_env = ? AND status = 'ACTIVE'
        ORDER BY utility_score DESC, ts_created DESC LIMIT ?
    `),
    listActiveConceptsByMinUtility: db.prepare(`
        SELECT * FROM ml_concepts
        WHERE user_id = ? AND resolved_env = ?
          AND status = 'ACTIVE' AND utility_score >= ?
        ORDER BY utility_score DESC, ts_created DESC LIMIT ?
    `),
    updateConceptMetrics: db.prepare(`
        UPDATE ml_concepts
        SET support_count = ?, utility_score = ?, ts_last_updated = ?
        WHERE user_id = ? AND resolved_env = ? AND concept_id = ?
    `),
    updateConceptStatus: db.prepare(`
        UPDATE ml_concepts
        SET status = ?, ts_last_updated = ?
        WHERE user_id = ? AND resolved_env = ? AND concept_id = ?
    `),
    insertObservation: db.prepare(`
        INSERT INTO ml_concept_observations
        (user_id, resolved_env, observation_id, concept_id,
         market_state_json, outcome, decision_relevance, ts)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `),
    listObservations: db.prepare(`
        SELECT * FROM ml_concept_observations
        WHERE user_id = ? AND resolved_env = ? AND concept_id = ?
        ORDER BY ts DESC LIMIT ?
    `),
    aggregateRelevance: db.prepare(`
        SELECT COUNT(*) AS support_count,
               COALESCE(AVG(decision_relevance), 0) AS avg_relevance
        FROM ml_concept_observations
        WHERE user_id = ? AND resolved_env = ? AND concept_id = ?
    `)
};

// ── computeConceptUtility (pure) ───────────────────────────────────
function computeConceptUtility(params) {
    const observations = _required(params, 'observations');
    const confidence = _required(params, 'confidence');
    if (confidence < 0 || confidence > 1) {
        throw new Error('conceptLibrary: confidence must be in [0,1]');
    }
    if (!Array.isArray(observations) || observations.length === 0) {
        return { utility: 0, avgRelevance: 0, observationsCount: 0 };
    }
    const sum = observations.reduce((s, o) => s + (o.decisionRelevance || 0), 0);
    const avgRelevance = sum / observations.length;
    return {
        utility: Math.max(0, Math.min(1, avgRelevance * confidence)),
        avgRelevance,
        observationsCount: observations.length
    };
}

// ── registerConcept ────────────────────────────────────────────────
function registerConcept(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const conceptId = _required(params, 'conceptId');
    const label = _required(params, 'label');
    const description = _required(params, 'description');
    const initialConfidence = (params && params.initialConfidence !== undefined)
        ? params.initialConfidence : DEFAULT_INITIAL_CONFIDENCE;
    if (initialConfidence < 0 || initialConfidence > 1) {
        throw new Error('conceptLibrary: initialConfidence must be in [0,1]');
    }
    const parentConceptId = (params && params.parentConceptId) ? params.parentConceptId : null;
    const ts = (params && params.ts) ? params.ts : Date.now();

    try {
        _stmts.insertConcept.run(
            userId, env, conceptId, label, description,
            initialConfidence, 'ACTIVE',
            parentConceptId, ts, ts
        );
        return { registered: true, conceptId };
    } catch (err) {
        if (err.code === 'SQLITE_CONSTRAINT_UNIQUE' ||
            (err.message && err.message.includes('UNIQUE'))) {
            throw new Error(`conceptLibrary: duplicate conceptId "${conceptId}"`);
        }
        throw err;
    }
}

// ── recordObservation ──────────────────────────────────────────────
function recordObservation(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const observationId = _required(params, 'observationId');
    const conceptId = _required(params, 'conceptId');
    const marketState = _required(params, 'marketState');
    const outcome = _required(params, 'outcome');
    const decisionRelevance = _required(params, 'decisionRelevance');
    if (decisionRelevance < 0 || decisionRelevance > 1) {
        throw new Error('conceptLibrary: decisionRelevance must be in [0,1]');
    }
    const ts = (params && params.ts) ? params.ts : Date.now();

    const concept = _stmts.getConcept.get(conceptId);
    if (!concept) {
        throw new Error(`conceptLibrary: concept "${conceptId}" not found`);
    }
    if (concept.user_id !== userId || concept.resolved_env !== env) {
        throw new Error('conceptLibrary: concept not owned by user/env');
    }

    const txn = db.transaction(() => {
        _stmts.insertObservation.run(
            userId, env, observationId, conceptId,
            JSON.stringify(marketState), outcome, decisionRelevance, ts
        );
        const agg = _stmts.aggregateRelevance.get(userId, env, conceptId);
        const newSupport = agg ? agg.support_count : 0;
        const avgRel = agg ? agg.avg_relevance : 0;
        const newUtility = Math.max(0, Math.min(1, avgRel * concept.confidence));
        _stmts.updateConceptMetrics.run(
            newSupport, newUtility, ts,
            userId, env, conceptId
        );
    });

    try {
        txn();
        const updated = _stmts.getConcept.get(conceptId);
        return {
            recorded: true, observationId,
            newSupportCount: updated.support_count,
            newUtilityScore: updated.utility_score
        };
    } catch (err) {
        if (err.code === 'SQLITE_CONSTRAINT_UNIQUE' ||
            (err.message && err.message.includes('UNIQUE'))) {
            throw new Error(`conceptLibrary: duplicate observationId "${observationId}"`);
        }
        throw err;
    }
}

// ── mergeConcepts ──────────────────────────────────────────────────
function mergeConcepts(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const sourceConceptIds = _required(params, 'sourceConceptIds');
    if (!Array.isArray(sourceConceptIds) || sourceConceptIds.length === 0) {
        throw new Error('conceptLibrary: sourceConceptIds must be non-empty array');
    }
    const mergedConceptId = _required(params, 'mergedConceptId');
    const mergedLabel = _required(params, 'mergedLabel');
    const mergedDescription = _required(params, 'mergedDescription');
    const ts = (params && params.ts) ? params.ts : Date.now();

    // Validate all sources exist + ownership
    for (const sid of sourceConceptIds) {
        const s = _stmts.getConcept.get(sid);
        if (!s) {
            throw new Error(`conceptLibrary: source concept "${sid}" not found`);
        }
        if (s.user_id !== userId || s.resolved_env !== env) {
            throw new Error(`conceptLibrary: concept "${sid}" not owned by user/env`);
        }
    }

    const txn = db.transaction(() => {
        _stmts.insertConcept.run(
            userId, env, mergedConceptId, mergedLabel, mergedDescription,
            DEFAULT_INITIAL_CONFIDENCE, 'ACTIVE',
            null, ts, ts
        );
        for (const sid of sourceConceptIds) {
            _stmts.updateConceptStatus.run(
                'MERGED', ts, userId, env, sid
            );
        }
    });

    try {
        txn();
        return {
            merged: true, mergedConceptId,
            sourcesCount: sourceConceptIds.length
        };
    } catch (err) {
        if (err.code === 'SQLITE_CONSTRAINT_UNIQUE' ||
            (err.message && err.message.includes('UNIQUE'))) {
            throw new Error(
                `conceptLibrary: duplicate mergedConceptId "${mergedConceptId}"`
            );
        }
        throw err;
    }
}

// ── retireConcept ──────────────────────────────────────────────────
function retireConcept(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const conceptId = _required(params, 'conceptId');
    const reason = _required(params, 'reason');
    const ts = (params && params.ts) ? params.ts : Date.now();

    const c = _stmts.getConcept.get(conceptId);
    if (!c) {
        throw new Error(`conceptLibrary: concept "${conceptId}" not found`);
    }
    if (c.user_id !== userId || c.resolved_env !== env) {
        throw new Error('conceptLibrary: concept not owned by user/env');
    }
    // Only retire if weak (low support OR low utility)
    if (c.support_count >= MIN_SUPPORT_FOR_ACTIVE &&
        c.utility_score >= MIN_UTILITY_TO_KEEP) {
        throw new Error(
            `conceptLibrary: cannot retire strong concept "${conceptId}" ` +
            `(support=${c.support_count} utility=${c.utility_score}) — ` +
            'canonical line 3029 "conceptele slabe sau redundante se retrag"'
        );
    }
    _stmts.updateConceptStatus.run('RETIRED', ts, userId, env, conceptId);
    return {
        retired: true, conceptId, reason,
        finalSupport: c.support_count,
        finalUtility: c.utility_score
    };
}

// ── getActiveConcepts ──────────────────────────────────────────────
function getActiveConcepts(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const minUtility = params && params.minUtility;
    const limit = (params && params.limit) ? params.limit : 100;

    const rows = (minUtility !== undefined && minUtility !== null)
        ? _stmts.listActiveConceptsByMinUtility.all(userId, env, minUtility, limit)
        : _stmts.listActiveConcepts.all(userId, env, limit);
    return rows.map(r => ({
        conceptId: r.concept_id,
        label: r.label,
        description: r.description,
        supportCount: r.support_count,
        utilityScore: r.utility_score,
        confidence: r.confidence,
        status: r.status,
        parentConceptId: r.parent_concept_id,
        tsCreated: r.ts_created,
        tsLastUpdated: r.ts_last_updated
    }));
}

module.exports = {
    CANONICAL_LABELS,
    CONCEPT_STATUSES,
    MIN_SUPPORT_FOR_ACTIVE,
    MIN_UTILITY_TO_KEEP,
    DEFAULT_INITIAL_CONFIDENCE,
    computeConceptUtility,
    registerConcept,
    recordObservation,
    mergeConcepts,
    retireConcept,
    getActiveConcepts
};
