'use strict';

/**
 * OMEGA R2 Cognition — crossDomainAnalogy (canonical §102)
 *
 * §102 CROSS-DOMAIN STRUCTURAL ANALOGY.
 * Source: /root/_review/ml_brain/ml_brain_canonic.txt line 2621.
 *
 * "Extrage principii structurale din sisteme complexe complet diferite —
 *  ecologie, epidemiologie, hidrodinamica, termodinamica — si le aplica la
 *  piata... Aceste analogii NU sunt metafore decorative — sunt modele
 *  matematice exportabile. Captureaza MECANISMUL, nu pattern-ul."
 *
 * Distinct from R5A episodic memory (same-domain temporal similarity).
 * §102 = cross-domain structural mapping with mathematical export.
 */

const { db } = require('../../database');

const SOURCE_DOMAINS = Object.freeze([
    'ecology', 'epidemiology', 'hydrodynamics',
    'thermodynamics', 'physics', 'network_theory', 'biology'
]);
const TEMPLATE_STATUSES = Object.freeze(['ACTIVE', 'RETIRED']);
const HEALTH_STATUSES = Object.freeze([
    'HEALTHY', 'UNDERPERFORMING', 'INSUFFICIENT'
]);

const MIN_MATCHES_FOR_HEALTH = 5;
const HEALTHY_ACCURACY_THRESHOLD = 0.60;
const DAY_MS = 86400000;

function _required(params, key) {
    if (!params || params[key] === undefined || params[key] === null) {
        throw new Error(`crossDomainAnalogy: missing ${key}`);
    }
    return params[key];
}

const _stmts = {
    insertTemplate: db.prepare(`
        INSERT INTO ml_analogy_templates
        (user_id, resolved_env, template_id, source_domain,
         structural_pattern_json, market_application, status, ts)
        VALUES (?, ?, ?, ?, ?, ?, 'ACTIVE', ?)
    `),
    getTemplate: db.prepare(`
        SELECT * FROM ml_analogy_templates WHERE template_id = ?
    `),
    listActiveTemplates: db.prepare(`
        SELECT * FROM ml_analogy_templates
        WHERE user_id = ? AND resolved_env = ? AND status = 'ACTIVE'
        ORDER BY ts DESC LIMIT ?
    `),
    listActiveTemplatesByDomain: db.prepare(`
        SELECT * FROM ml_analogy_templates
        WHERE user_id = ? AND resolved_env = ?
          AND status = 'ACTIVE' AND source_domain = ?
        ORDER BY ts DESC LIMIT ?
    `),
    insertMatch: db.prepare(`
        INSERT INTO ml_analogy_matches
        (user_id, resolved_env, match_id, template_id,
         market_situation_id, structural_similarity,
         predicted_outcome, actual_outcome, accuracy, ts)
        VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?)
    `),
    getMatch: db.prepare(`
        SELECT * FROM ml_analogy_matches WHERE match_id = ?
    `),
    updateMatchOutcome: db.prepare(`
        UPDATE ml_analogy_matches
        SET actual_outcome = ?, accuracy = ?
        WHERE user_id = ? AND resolved_env = ? AND match_id = ?
    `),
    aggregateMatches: db.prepare(`
        SELECT COUNT(*) AS total,
               COALESCE(AVG(accuracy), 0) AS avg_accuracy,
               COUNT(actual_outcome) AS resolved_count
        FROM ml_analogy_matches
        WHERE user_id = ? AND resolved_env = ?
          AND template_id = ?
          AND ts >= ?
    `)
};

// ── computeStructuralSimilarity (pure) — cosine similarity ─────────
function computeStructuralSimilarity(params) {
    const a = _required(params, 'patternFeaturesA');
    const b = _required(params, 'patternFeaturesB');

    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    if (keys.size === 0) return { similarity: 0, sharedFeatures: 0 };
    let dot = 0, na = 0, nb = 0, shared = 0;
    for (const k of keys) {
        const va = typeof a[k] === 'number' ? a[k] : 0;
        const vb = typeof b[k] === 'number' ? b[k] : 0;
        dot += va * vb;
        na += va * va;
        nb += vb * vb;
        if (a[k] !== undefined && b[k] !== undefined) shared++;
    }
    if (na === 0 || nb === 0) return { similarity: 0, sharedFeatures: shared };
    const similarity = dot / (Math.sqrt(na) * Math.sqrt(nb));
    return {
        similarity: Math.max(0, Math.min(1, similarity)),
        sharedFeatures: shared
    };
}

// ── registerAnalogyTemplate ────────────────────────────────────────
function registerAnalogyTemplate(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const templateId = _required(params, 'templateId');
    const sourceDomain = _required(params, 'sourceDomain');
    if (!SOURCE_DOMAINS.includes(sourceDomain)) {
        throw new Error(`crossDomainAnalogy: invalid sourceDomain "${sourceDomain}"`);
    }
    const structuralPattern = _required(params, 'structuralPattern');
    const marketApplication = _required(params, 'marketApplication');
    const ts = (params && params.ts) ? params.ts : Date.now();

    try {
        _stmts.insertTemplate.run(
            userId, env, templateId, sourceDomain,
            JSON.stringify(structuralPattern),
            marketApplication, ts
        );
        return { registered: true, templateId };
    } catch (err) {
        if (err.code === 'SQLITE_CONSTRAINT_UNIQUE' ||
            (err.message && err.message.includes('UNIQUE'))) {
            throw new Error(`crossDomainAnalogy: duplicate templateId "${templateId}"`);
        }
        throw err;
    }
}

// ── recordAnalogyMatch ─────────────────────────────────────────────
function recordAnalogyMatch(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const matchId = _required(params, 'matchId');
    const templateId = _required(params, 'templateId');
    const marketSituationId = _required(params, 'marketSituationId');
    const structuralSimilarity = _required(params, 'structuralSimilarity');
    if (structuralSimilarity < 0 || structuralSimilarity > 1) {
        throw new Error('crossDomainAnalogy: structuralSimilarity must be in [0,1]');
    }
    const predictedOutcome = _required(params, 'predictedOutcome');
    const ts = (params && params.ts) ? params.ts : Date.now();

    const template = _stmts.getTemplate.get(templateId);
    if (!template) {
        throw new Error(`crossDomainAnalogy: template "${templateId}" not found`);
    }
    if (template.user_id !== userId || template.resolved_env !== env) {
        throw new Error('crossDomainAnalogy: template not owned by user/env');
    }

    try {
        _stmts.insertMatch.run(
            userId, env, matchId, templateId, marketSituationId,
            structuralSimilarity, predictedOutcome, ts
        );
        return { recorded: true, matchId };
    } catch (err) {
        if (err.code === 'SQLITE_CONSTRAINT_UNIQUE' ||
            (err.message && err.message.includes('UNIQUE'))) {
            throw new Error(`crossDomainAnalogy: duplicate matchId "${matchId}"`);
        }
        throw err;
    }
}

// ── recordAnalogyOutcome ───────────────────────────────────────────
function recordAnalogyOutcome(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const matchId = _required(params, 'matchId');
    const actualOutcome = _required(params, 'actualOutcome');
    const accuracy = _required(params, 'accuracy');
    if (accuracy < 0 || accuracy > 1) {
        throw new Error('crossDomainAnalogy: accuracy must be in [0,1]');
    }

    const match = _stmts.getMatch.get(matchId);
    if (!match) {
        throw new Error(`crossDomainAnalogy: match "${matchId}" not found`);
    }
    if (match.user_id !== userId || match.resolved_env !== env) {
        throw new Error('crossDomainAnalogy: match not owned by user/env');
    }

    _stmts.updateMatchOutcome.run(
        actualOutcome, accuracy, userId, env, matchId
    );
    return { updated: true, matchId, accuracy };
}

// ── evaluateAnalogyHealth ──────────────────────────────────────────
function evaluateAnalogyHealth(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const templateId = _required(params, 'templateId');
    const lookbackDays = (params && params.lookbackDays !== undefined)
        ? params.lookbackDays : 30;
    const now = (params && params.now) ? params.now : Date.now();

    const since = now - lookbackDays * DAY_MS;
    const agg = _stmts.aggregateMatches.get(userId, env, templateId, since);
    if (!agg || agg.resolved_count < MIN_MATCHES_FOR_HEALTH) {
        return {
            status: 'INSUFFICIENT',
            avgAccuracy: agg ? agg.avg_accuracy : 0,
            resolvedCount: agg ? agg.resolved_count : 0,
            totalCount: agg ? agg.total : 0
        };
    }
    const status = agg.avg_accuracy >= HEALTHY_ACCURACY_THRESHOLD
        ? 'HEALTHY'
        : 'UNDERPERFORMING';
    return {
        status,
        avgAccuracy: agg.avg_accuracy,
        resolvedCount: agg.resolved_count,
        totalCount: agg.total
    };
}

// ── getActiveTemplates ─────────────────────────────────────────────
function getActiveTemplates(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const sourceDomain = params && params.sourceDomain;
    const limit = (params && params.limit) ? params.limit : 100;

    if (sourceDomain && !SOURCE_DOMAINS.includes(sourceDomain)) {
        throw new Error(`crossDomainAnalogy: invalid sourceDomain "${sourceDomain}"`);
    }
    const rows = sourceDomain
        ? _stmts.listActiveTemplatesByDomain.all(userId, env, sourceDomain, limit)
        : _stmts.listActiveTemplates.all(userId, env, limit);
    return rows.map(r => ({
        templateId: r.template_id,
        sourceDomain: r.source_domain,
        structuralPattern: JSON.parse(r.structural_pattern_json),
        marketApplication: r.market_application,
        status: r.status,
        ts: r.ts
    }));
}

module.exports = {
    SOURCE_DOMAINS,
    TEMPLATE_STATUSES,
    HEALTH_STATUSES,
    MIN_MATCHES_FOR_HEALTH,
    HEALTHY_ACCURACY_THRESHOLD,
    computeStructuralSimilarity,
    registerAnalogyTemplate,
    recordAnalogyMatch,
    recordAnalogyOutcome,
    evaluateAnalogyHealth,
    getActiveTemplates
};
