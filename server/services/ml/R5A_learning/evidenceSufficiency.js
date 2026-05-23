'use strict';

/**
 * OMEGA R5A Learning — evidenceSufficiency (canonical §70)
 *
 * §70 EVIDENCE SUFFICIENCY / MINIMUM SUPPORT GATE.
 * Source: /root/_review/ml_brain/ml_brain_canonic.txt lines 1881-1921.
 *
 * "Am doar 9 cazuri bune pe combinatia asta, nu am voie sa o tratez ca pe
 *  un setup matur."
 *
 * "Semnalul nu primeste autoritate maxima daca nu are suport empiric
 *  suficient. Setup-urile noi intra mai intai in: observational / shadow
 *  / probation. Evidence sufficiency modifica size + thresholds, nu
 *  doar confidence-ul textual."
 *
 * R5A. Maturity-aware authority + size scaling. Per setup×regime×asset×tf.
 *
 * Maturity ladder:
 *   < 10 obs      → observational     authority=none    size=0.0  (NO TRADE)
 *   < 30 obs      → shadow            authority=none    size=0.10 (shadow only)
 *   < 50 obs      → probation (early) authority=reduced size=0.50
 *   < 100 obs     → probation (late)  authority=reduced size=0.75
 *   >= 100 obs    → mature            authority=full    size=1.0
 */

const { db } = require('../../database');

const MATURITY_CLASSES = Object.freeze([
    'observational', 'shadow', 'probation', 'mature'
]);
const AUTHORITY_LEVELS = Object.freeze(['none', 'reduced', 'full']);
const OUTCOME_TYPES = Object.freeze(['win', 'loss', 'scratch']);

const MIN_SUPPORT_OBSERVATIONAL = 10;
const MIN_SUPPORT_SHADOW = 30;
const MIN_SUPPORT_PROBATION = 50;
const MIN_SUPPORT_MATURE = 100;

const SIZE_MULTIPLIER_BY_MATURITY = Object.freeze({
    observational: 0.0,
    shadow: 0.10,
    probation_early: 0.50,
    probation_late: 0.75,
    mature: 1.0
});

const RECENT_WINDOW_MS = 30 * 86400000;

// ── Helpers ─────────────────────────────────────────────────────────
function _required(params, key) {
    if (!params || params[key] === undefined || params[key] === null) {
        throw new Error(`evidenceSufficiency: missing ${key}`);
    }
    return params[key];
}

function _setupKey(setupType, regimeType, asset, timeframe) {
    return `${setupType}|${regimeType}|${asset}|${timeframe}`;
}

// ── Prepared statements ────────────────────────────────────────────
const _stmts = {
    getSupport: db.prepare(`
        SELECT * FROM ml_evidence_support
        WHERE user_id = ? AND resolved_env = ? AND setup_key = ?
    `),
    upsertSupport: db.prepare(`
        INSERT INTO ml_evidence_support
        (user_id, resolved_env, setup_key, setup_type, regime_type,
         asset, timeframe, total_observations, win_count,
         quality_weighted_score, recent_observations,
         oldest_ts, last_updated)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(user_id, resolved_env, setup_key) DO UPDATE SET
            total_observations = excluded.total_observations,
            win_count = excluded.win_count,
            quality_weighted_score = excluded.quality_weighted_score,
            recent_observations = excluded.recent_observations,
            last_updated = excluded.last_updated
    `),
    queryByType: db.prepare(`
        SELECT * FROM ml_evidence_support
        WHERE user_id = ? AND resolved_env = ? AND setup_type = ?
          AND (? = '' OR regime_type = ?)
          AND (? = '' OR asset = ?)
          AND (? = '' OR timeframe = ?)
    `),
    upsertMaturity: db.prepare(`
        INSERT INTO ml_setup_maturity
        (user_id, resolved_env, setup_key, maturity_class,
         authority_level, evidence_sufficient, size_multiplier,
         last_classified_ts)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(user_id, resolved_env, setup_key) DO UPDATE SET
            maturity_class = excluded.maturity_class,
            authority_level = excluded.authority_level,
            evidence_sufficient = excluded.evidence_sufficient,
            size_multiplier = excluded.size_multiplier,
            last_classified_ts = excluded.last_classified_ts
    `),
    listByLookback: db.prepare(`
        SELECT * FROM ml_evidence_support
        WHERE user_id = ? AND resolved_env = ?
          AND last_updated >= ?
    `)
};

// ── recordSetupObservation ─────────────────────────────────────────
function recordSetupObservation(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const setupType = _required(params, 'setupType');
    const regimeType = _required(params, 'regimeType');
    const asset = _required(params, 'asset');
    const timeframe = _required(params, 'timeframe');
    const outcome = _required(params, 'outcome');
    const qualityWeight = (params && typeof params.qualityWeight === 'number')
        ? params.qualityWeight : 1.0;
    const ts = (params && params.ts) ? params.ts : Date.now();

    if (!OUTCOME_TYPES.includes(outcome)) {
        throw new Error(`evidenceSufficiency: invalid outcome "${outcome}"`);
    }

    const setupKey = _setupKey(setupType, regimeType, asset, timeframe);
    const current = _stmts.getSupport.get(userId, env, setupKey);

    const totalObs = (current ? current.total_observations : 0) + 1;
    const winCount = (current ? current.win_count : 0) + (outcome === 'win' ? 1 : 0);
    const qualScore = (current ? current.quality_weighted_score : 0) +
                      (outcome === 'win' ? qualityWeight : 0);

    // Recent count: re-compute roughly (approximation: count is last 30d)
    const since = ts - RECENT_WINDOW_MS;
    const oldestTs = current ? current.oldest_ts : ts;
    const recentObs = (current && current.oldest_ts && current.oldest_ts < since)
        ? (current.recent_observations + 1)
        : totalObs;  // if all are recent, simple

    _stmts.upsertSupport.run(
        userId, env, setupKey, setupType, regimeType, asset, timeframe,
        totalObs, winCount, qualScore, recentObs,
        oldestTs, ts
    );

    return { recorded: true, setupKey, totalObservations: totalObs };
}

// ── getSupportCount ────────────────────────────────────────────────
function getSupportCount(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const setupType = _required(params, 'setupType');
    const regimeType = (params && params.regimeType) ? params.regimeType : '';
    const asset = (params && params.asset) ? params.asset : '';
    const timeframe = (params && params.timeframe) ? params.timeframe : '';

    const rows = _stmts.queryByType.all(
        userId, env, setupType,
        regimeType, regimeType,
        asset, asset,
        timeframe, timeframe
    );

    const total = rows.reduce((s, r) => s + r.total_observations, 0);
    const wins = rows.reduce((s, r) => s + r.win_count, 0);
    const quality = rows.reduce((s, r) => s + r.quality_weighted_score, 0);
    const recent = rows.reduce((s, r) => s + r.recent_observations, 0);

    return {
        totalSupport: total,
        winCount: wins,
        qualityWeightedScore: quality,
        recentSupport: recent,
        winRate: total > 0 ? wins / total : 0,
        setupVariants: rows.length
    };
}

// ── classifySetupMaturity ──────────────────────────────────────────
function classifySetupMaturity(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const setupKey = _required(params, 'setupKey');

    const row = _stmts.getSupport.get(userId, env, setupKey);
    const total = row ? row.total_observations : 0;

    if (total < MIN_SUPPORT_OBSERVATIONAL) return 'observational';
    if (total < MIN_SUPPORT_SHADOW) return 'shadow';
    if (total < MIN_SUPPORT_PROBATION) return 'probation';      // early-probation
    if (total < MIN_SUPPORT_MATURE) return 'probation';         // late-probation
    return 'mature';
}

// ── evaluateEvidenceSufficiency ────────────────────────────────────
function evaluateEvidenceSufficiency(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const setupKey = _required(params, 'setupKey');

    const row = _stmts.getSupport.get(userId, env, setupKey);
    const total = row ? row.total_observations : 0;
    const maturity = classifySetupMaturity({ userId, resolvedEnv: env, setupKey });

    let authority, sizeMultiplier, sufficient;
    if (maturity === 'observational') {
        authority = 'none';
        sizeMultiplier = SIZE_MULTIPLIER_BY_MATURITY.observational;
        sufficient = false;
    } else if (maturity === 'shadow') {
        authority = 'none';
        sizeMultiplier = SIZE_MULTIPLIER_BY_MATURITY.shadow;
        sufficient = false;
    } else if (maturity === 'probation' && total < MIN_SUPPORT_PROBATION) {
        // 30 <= total < 50 — early probation
        authority = 'reduced';
        sizeMultiplier = SIZE_MULTIPLIER_BY_MATURITY.probation_early;
        sufficient = false;
    } else if (maturity === 'probation') {
        // 50 <= total < 100 — late probation
        authority = 'reduced';
        sizeMultiplier = SIZE_MULTIPLIER_BY_MATURITY.probation_late;
        sufficient = false;
    } else {
        authority = 'full';
        sizeMultiplier = SIZE_MULTIPLIER_BY_MATURITY.mature;
        sufficient = true;
    }

    return {
        sufficient,
        authorityLevel: authority,
        sizeMultiplier,
        supportCount: total,
        maturityClass: maturity
    };
}

// ── recordMaturityClassification ───────────────────────────────────
function recordMaturityClassification(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const setupKey = _required(params, 'setupKey');
    const maturityClass = _required(params, 'maturityClass');
    const authorityLevel = _required(params, 'authorityLevel');
    const evidenceSufficient = !!params.evidenceSufficient;
    const sizeMultiplier = _required(params, 'sizeMultiplier');
    const ts = (params && params.ts) ? params.ts : Date.now();

    if (!MATURITY_CLASSES.includes(maturityClass)) {
        throw new Error(`evidenceSufficiency: invalid maturityClass "${maturityClass}"`);
    }
    if (!AUTHORITY_LEVELS.includes(authorityLevel)) {
        throw new Error(`evidenceSufficiency: invalid authorityLevel "${authorityLevel}"`);
    }

    _stmts.upsertMaturity.run(
        userId, env, setupKey, maturityClass,
        authorityLevel, evidenceSufficient ? 1 : 0,
        sizeMultiplier, ts
    );

    return { recorded: true };
}

// ── recentVsOldRatio ───────────────────────────────────────────────
function recentVsOldRatio(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const setupKey = _required(params, 'setupKey');

    const row = _stmts.getSupport.get(userId, env, setupKey);
    if (!row || row.total_observations === 0) {
        return { ratio: 0, total: 0, recent: 0, stale: false };
    }

    const ratio = row.recent_observations / row.total_observations;
    return {
        ratio,
        total: row.total_observations,
        recent: row.recent_observations,
        stale: ratio < 0.20   // less than 20% recent → stale
    };
}

// ── getEvidenceStatsBySetup ────────────────────────────────────────
function getEvidenceStatsBySetup(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const lookbackDays = (params && params.lookbackDays) ? params.lookbackDays : 90;

    const since = Date.now() - lookbackDays * 86400000;
    const rows = _stmts.listByLookback.all(userId, env, since);
    return rows.map(r => ({
        setupKey: r.setup_key,
        setupType: r.setup_type,
        regimeType: r.regime_type,
        asset: r.asset,
        timeframe: r.timeframe,
        totalObservations: r.total_observations,
        winCount: r.win_count
    }));
}

module.exports = {
    MATURITY_CLASSES,
    AUTHORITY_LEVELS,
    OUTCOME_TYPES,
    MIN_SUPPORT_OBSERVATIONAL,
    MIN_SUPPORT_SHADOW,
    MIN_SUPPORT_PROBATION,
    MIN_SUPPORT_MATURE,
    SIZE_MULTIPLIER_BY_MATURITY,
    recordSetupObservation,
    getSupportCount,
    classifySetupMaturity,
    evaluateEvidenceSufficiency,
    recordMaturityClassification,
    recentVsOldRatio,
    getEvidenceStatsBySetup
};
