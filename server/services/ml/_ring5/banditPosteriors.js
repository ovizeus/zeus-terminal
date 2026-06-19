'use strict';

/**
 * ML Plan v3 Phase 3 — Bandit Posteriors (per-(level × cell_key) Beta α/β state).
 *
 * Per SPEC-8 4-level cell hierarchy:
 *   L0 = global default
 *   L1 = env
 *   L2 = env × symbol
 *   L3 = env × symbol × regime
 *   L4 = user × env × symbol × regime
 *
 * Bayesian update: positive→α++, negative→β++, neutral→count only.
 * Promotion gate: cell owned when observation_count >= 30.
 * walkHierarchy returns first owned posterior L4→L0 (or L0 default).
 */

const { db } = require('../../database');

const LEVELS = Object.freeze([0, 1, 2, 3, 4]);
const PROMOTION_THRESHOLD = 30;
const VALID_OUTCOMES = new Set(['positive', 'negative', 'neutral']);

function _required(p, k) {
    if (p == null || p[k] == null) throw new Error(`banditPosteriors: missing ${k}`);
    return p[k];
}

function _validateLevel(level) {
    if (!LEVELS.includes(level)) throw new Error(`banditPosteriors: invalid level ${level}`);
    return level;
}

// [AUDIT-20260619 P3] The cell PK is a ':'-join; `regime` is free-form, so a label
// containing ':' would collide two distinct cells (or shift level boundaries) into
// one Beta posterior. Sanitize each dynamic segment (':' → '_'). No-op for every
// current value (env/symbol/userId are controlled, no regime has ':'), so existing
// persisted keys are byte-identical — this only forecloses a future collision.
const _seg = (v) => String(v).replace(/:/g, '_');
function buildCellKey(params) {
    const level = _required(params, 'level');
    _validateLevel(level);
    if (level === 0) return 'global';
    if (level === 1) return `${_seg(_required(params, 'env'))}`;
    if (level === 2) return `${_seg(_required(params, 'env'))}:${_seg(_required(params, 'symbol'))}`;
    if (level === 3) return `${_seg(_required(params, 'env'))}:${_seg(_required(params, 'symbol'))}:${_seg(_required(params, 'regime'))}`;
    return `${_seg(_required(params, 'userId'))}:${_seg(_required(params, 'env'))}:${_seg(_required(params, 'symbol'))}:${_seg(_required(params, 'regime'))}`;
}

const _stmts = {
    select: db.prepare(`
        SELECT id, level, cell_key, alpha, beta, observation_count, updated_at
        FROM ml_bandit_posteriors WHERE level = ? AND cell_key = ?
    `),
    upsertPositive: db.prepare(`
        INSERT INTO ml_bandit_posteriors (level, cell_key, alpha, beta, observation_count, updated_at)
        VALUES (?, ?, 2, 1, 1, ?)
        ON CONFLICT(level, cell_key) DO UPDATE SET
            alpha = alpha + 1, observation_count = observation_count + 1, updated_at = excluded.updated_at
    `),
    upsertNegative: db.prepare(`
        INSERT INTO ml_bandit_posteriors (level, cell_key, alpha, beta, observation_count, updated_at)
        VALUES (?, ?, 1, 2, 1, ?)
        ON CONFLICT(level, cell_key) DO UPDATE SET
            beta = beta + 1, observation_count = observation_count + 1, updated_at = excluded.updated_at
    `),
    upsertNeutral: db.prepare(`
        INSERT INTO ml_bandit_posteriors (level, cell_key, alpha, beta, observation_count, updated_at)
        VALUES (?, ?, 1, 1, 1, ?)
        ON CONFLICT(level, cell_key) DO UPDATE SET
            observation_count = observation_count + 1, updated_at = excluded.updated_at
    `)
};

function _hydrate(row) {
    if (!row) return null;
    return {
        id: row.id, level: row.level, cellKey: row.cell_key,
        alpha: row.alpha, beta: row.beta,
        observationCount: row.observation_count,
        updatedAt: row.updated_at
    };
}

function getPosterior(params) {
    const level = _validateLevel(_required(params, 'level'));
    const cellKey = _required(params, 'cellKey');
    return _hydrate(_stmts.select.get(level, cellKey));
}

function updatePosterior(params) {
    const level = _validateLevel(_required(params, 'level'));
    const cellKey = _required(params, 'cellKey');
    const outcomeClass = _required(params, 'outcomeClass');
    const ts = _required(params, 'ts');
    if (!VALID_OUTCOMES.has(outcomeClass)) {
        throw new Error(`banditPosteriors: invalid outcomeClass '${outcomeClass}'`);
    }
    const stmt = outcomeClass === 'positive' ? _stmts.upsertPositive
              : outcomeClass === 'negative' ? _stmts.upsertNegative
              : _stmts.upsertNeutral;
    stmt.run(level, cellKey, ts);
    return { updated: true };
}

function isCellOwned(params) {
    const r = getPosterior(params);
    if (!r) return false;
    return r.observationCount >= PROMOTION_THRESHOLD;
}

function walkHierarchy(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'env');
    const symbol = _required(params, 'symbol');
    const regime = _required(params, 'regime');

    const candidates = [
        { level: 4, cellKey: buildCellKey({ level: 4, userId, env, symbol, regime }) },
        { level: 3, cellKey: buildCellKey({ level: 3, env, symbol, regime }) },
        { level: 2, cellKey: buildCellKey({ level: 2, env, symbol }) },
        { level: 1, cellKey: buildCellKey({ level: 1, env }) },
        { level: 0, cellKey: 'global' }
    ];
    for (const c of candidates) {
        const r = getPosterior({ level: c.level, cellKey: c.cellKey });
        if (r && r.observationCount >= PROMOTION_THRESHOLD) return r;
    }
    return { level: 0, cellKey: 'global', alpha: 1, beta: 1, observationCount: 0, updatedAt: null };
}

module.exports = {
    LEVELS, PROMOTION_THRESHOLD,
    buildCellKey, getPosterior, updatePosterior, isCellOwned, walkHierarchy
};
