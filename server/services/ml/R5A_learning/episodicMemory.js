'use strict';

/**
 * OMEGA R5A Learning — episodicMemory (canonical §65)
 *
 * §65 EPISODIC MEMORY / HISTORICAL FINGERPRINTING — "mai am vazut asta".
 * Source: /root/_review/ml_brain/ml_brain_canonic.txt lines 1739-1740.
 *
 * "Conditiile actuale seamana 78% cu august 2021 si 65% cu mai 2022."
 * "Nu e predictie. E analogie structurata, folosita ca prior bayesian."
 *
 * Multi-factor fingerprint: funding levels + OI trend + BTC dominance +
 * macro index + regime + vol level. 6-dim normalized vector. Cosine
 * similarity over historical archive. Returns top-K most analogous
 * past periods with extracted lessons.
 *
 * Distinct from:
 *   - §17 regimeMetrics (current regime classification)
 *   - §16 attribution (per-trade win/loss)
 * §65 = period-level structural analogy.
 */

const { db } = require('../../database');

const FINGERPRINT_DIMENSIONS = Object.freeze([
    'funding_levels', 'oi_trend', 'btc_dominance',
    'macro_index', 'regime_type_enc', 'vol_level'
]);
const DEFAULT_TOP_K = 5;
const DEFAULT_MIN_SIMILARITY = 0.50;
const BAYESIAN_PRIOR_USAGE = 'analogy_only';

// ── Helpers ─────────────────────────────────────────────────────────
function _required(params, key) {
    if (!params || params[key] === undefined || params[key] === null) {
        throw new Error(`episodicMemory: missing ${key}`);
    }
    return params[key];
}

function _toVec(fp) {
    return FINGERPRINT_DIMENSIONS.map(d => (typeof fp[d] === 'number') ? fp[d] : 0);
}

function _cosine(v1, v2) {
    let dot = 0, n1 = 0, n2 = 0;
    for (let i = 0; i < v1.length; i++) {
        dot += v1[i] * v2[i];
        n1 += v1[i] * v1[i];
        n2 += v2[i] * v2[i];
    }
    if (n1 === 0 || n2 === 0) return 0;
    return dot / (Math.sqrt(n1) * Math.sqrt(n2));
}

// ── Prepared statements ────────────────────────────────────────────
const _stmts = {
    insertArchive: db.prepare(`
        INSERT INTO ml_episodic_archive
        (user_id, resolved_env, archive_id, label,
         start_ts, end_ts, fingerprint_vector_json,
         outcome_summary, lessons_json, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    listArchive: db.prepare(`
        SELECT * FROM ml_episodic_archive
        WHERE user_id = ? AND resolved_env = ?
    `),
    insertMatch: db.prepare(`
        INSERT INTO ml_fingerprint_matches
        (user_id, resolved_env, query_fingerprint_json,
         archive_id, similarity_score, ranked_position, ts)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    `),
    matchHistory: db.prepare(`
        SELECT * FROM ml_fingerprint_matches
        WHERE user_id = ? AND resolved_env = ?
          AND (? = 0 OR ts >= ?)
        ORDER BY ts DESC, id DESC
        LIMIT ?
    `)
};

// ── computeFingerprint ─────────────────────────────────────────────
// Inputs are domain-typed; normalize to roughly [-1, 1] range.
function computeFingerprint(params) {
    const fundingLevels = (params && typeof params.fundingLevels === 'number')
        ? params.fundingLevels : 0;
    const oiTrend = (params && typeof params.oiTrend === 'number')
        ? params.oiTrend : 0;
    const btcDominance = (params && typeof params.btcDominance === 'number')
        ? params.btcDominance : 50;
    const macroIndex = (params && typeof params.macroIndex === 'number')
        ? params.macroIndex : 0;
    const regimeType = (params && params.regimeType) ? params.regimeType : 'range';
    const vol = (params && typeof params.vol === 'number') ? params.vol : 0;

    // Normalize:
    // - fundingLevels expected ±0.01 per 8h → divide /0.02 to roughly [-0.5, 0.5]
    // - oiTrend pct change → already comparable
    // - btcDominance 0..100 → centered at 50 / scale by 50 → [-1,+1]
    // - macroIndex DXY change pct
    // - regime → enum to 0..1 numeric
    // - vol annualized
    const regimeEnum = {
        'trend_up': 0.8, 'trend_down': -0.8,
        'range': 0.0, 'chop': 0.1, 'volatile_expansion': 0.5
    };

    return {
        funding_levels: fundingLevels / 0.02,
        oi_trend: oiTrend,
        btc_dominance: (btcDominance - 50) / 50,
        macro_index: macroIndex,
        regime_type_enc: regimeEnum[regimeType] !== undefined ? regimeEnum[regimeType] : 0,
        vol_level: vol
    };
}

// ── archiveHistoricalPeriod ────────────────────────────────────────
function archiveHistoricalPeriod(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const archiveId = _required(params, 'archiveId');
    const label = _required(params, 'label');
    const startTs = _required(params, 'startTs');
    const endTs = _required(params, 'endTs');
    const fingerprintVector = _required(params, 'fingerprintVector');
    const outcomeSummary = (params && params.outcomeSummary) ? params.outcomeSummary : null;
    const lessons = (params && params.lessons) ? params.lessons : null;
    const createdAt = (params && params.createdAt) ? params.createdAt : Date.now();

    try {
        _stmts.insertArchive.run(
            userId, env, archiveId, label,
            startTs, endTs,
            JSON.stringify(fingerprintVector),
            outcomeSummary,
            lessons ? JSON.stringify(lessons) : null,
            createdAt
        );
        return { archived: true, archiveId };
    } catch (err) {
        if (err.code === 'SQLITE_CONSTRAINT_UNIQUE' ||
            (err.message && err.message.includes('UNIQUE'))) {
            throw new Error(`episodicMemory: duplicate archiveId "${archiveId}"`);
        }
        throw err;
    }
}

// ── findSimilarPeriods ─────────────────────────────────────────────
function findSimilarPeriods(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const currentFingerprint = _required(params, 'currentFingerprint');
    const topK = (params && params.topK) ? params.topK : DEFAULT_TOP_K;
    const minSimilarity = (params && typeof params.minSimilarity === 'number')
        ? params.minSimilarity : DEFAULT_MIN_SIMILARITY;

    const queryVec = _toVec(currentFingerprint);
    const archive = _stmts.listArchive.all(userId, env);

    const scored = archive.map(row => {
        const archVec = _toVec(JSON.parse(row.fingerprint_vector_json));
        return {
            archiveId: row.archive_id,
            label: row.label,
            startTs: row.start_ts,
            endTs: row.end_ts,
            similarity: _cosine(queryVec, archVec),
            outcomeSummary: row.outcome_summary,
            lessons: row.lessons_json ? JSON.parse(row.lessons_json) : null
        };
    });

    scored.sort((a, b) => b.similarity - a.similarity);
    const filtered = scored.filter(s => s.similarity >= minSimilarity);
    return filtered.slice(0, topK);
}

// ── extractLessons ─────────────────────────────────────────────────
function extractLessons(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const archiveIds = _required(params, 'archiveIds');

    if (!Array.isArray(archiveIds) || archiveIds.length === 0) {
        return { lessons: [], periodsCount: 0 };
    }

    const archive = _stmts.listArchive.all(userId, env);
    const archiveMap = {};
    for (const a of archive) archiveMap[a.archive_id] = a;

    const aggregated = [];
    for (const id of archiveIds) {
        const row = archiveMap[id];
        if (row && row.lessons_json) {
            try {
                const ls = JSON.parse(row.lessons_json);
                if (Array.isArray(ls)) {
                    for (const l of ls) aggregated.push({ archiveId: id, lesson: l });
                }
            } catch (_) {}
        }
    }

    return { lessons: aggregated, periodsCount: archiveIds.length };
}

// ── recordMatchEvent ───────────────────────────────────────────────
function recordMatchEvent(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const queryFingerprint = _required(params, 'queryFingerprint');
    const matches = _required(params, 'matches');
    const ts = (params && params.ts) ? params.ts : Date.now();

    if (!Array.isArray(matches)) return { recorded: 0 };

    const queryJson = JSON.stringify(queryFingerprint);
    let count = 0;
    matches.forEach((m, idx) => {
        _stmts.insertMatch.run(
            userId, env, queryJson,
            m.archiveId, m.similarity, idx + 1, ts
        );
        count++;
    });

    return { recorded: count };
}

// ── getArchiveSummary ──────────────────────────────────────────────
function getArchiveSummary(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const rows = _stmts.listArchive.all(userId, env);
    return {
        count: rows.length,
        archive: rows.map(r => ({
            archiveId: r.archive_id,
            label: r.label,
            startTs: r.start_ts,
            endTs: r.end_ts
        }))
    };
}

// ── getMatchHistory ────────────────────────────────────────────────
function getMatchHistory(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const since = (params && params.since) ? params.since : 0;
    const limit = (params && params.limit) ? params.limit : 100;
    return _stmts.matchHistory.all(
        userId, env,
        since > 0 ? 1 : 0, since, limit
    );
}

module.exports = {
    FINGERPRINT_DIMENSIONS,
    DEFAULT_TOP_K,
    DEFAULT_MIN_SIMILARITY,
    BAYESIAN_PRIOR_USAGE,
    computeFingerprint,
    archiveHistoricalPeriod,
    findSimilarPeriods,
    extractLessons,
    recordMatchEvent,
    getArchiveSummary,
    getMatchHistory
};
