'use strict';

/**
 * OMEGA R2 Cognition — regimeGrammar (canonical §93)
 *
 * §93 GRAMATICA FORMALA DE REGIMURI.
 * Source: /root/_review/ml_brain/ml_brain_canonic.txt line 2376.
 *
 * "Fiecare regim e descris ca o combinatie de primitive ortogonale —
 *  volatility x trend x liquidity x derivatives x macro — astfel ca orice
 *  regim poate fi exprimat ca o propozitie in acest limbaj... rezolva
 *  regimurile hibride si de tranzitie... permite transferul de cunostinte
 *  via primitive overlap."
 *
 * Distinct from §24 detectorRegistry (detector orchestration) and §38
 * intelligenceChecker (meta self-eval). §93 = compositional regime language.
 */

const { db } = require('../../database');

const VOCABULARY = Object.freeze({
    volatility:  ['LOW', 'NORMAL', 'HIGH', 'EXPANSION', 'CONTRACTION'],
    trend:       ['STRONG_BULL', 'BULL', 'NEUTRAL', 'BEAR', 'STRONG_BEAR'],
    liquidity:   ['DRY', 'NORMAL', 'DEEP'],
    derivatives: ['NEUTRAL', 'FUNDING_POS', 'FUNDING_NEG', 'OI_RISING', 'OI_COLLAPSING'],
    macro:       ['SUPPORTIVE', 'NEUTRAL', 'OPPOSED']
});

const PRIMITIVE_DIMS = Object.freeze([
    'volatility', 'trend', 'liquidity', 'derivatives', 'macro'
]);

const DEFAULT_OVERLAP_THRESHOLD = 0.60;

function _required(params, key) {
    if (!params || params[key] === undefined || params[key] === null) {
        throw new Error(`regimeGrammar: missing ${key}`);
    }
    return params[key];
}

const _stmts = {
    insertSentence: db.prepare(`
        INSERT INTO ml_regime_sentences
        (user_id, resolved_env, sentence_id, regime_label,
         primitives_json, source_context, ts)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    `),
    getSentence: db.prepare(`
        SELECT * FROM ml_regime_sentences WHERE sentence_id = ?
    `),
    listSentences: db.prepare(`
        SELECT * FROM ml_regime_sentences
        WHERE user_id = ? AND resolved_env = ?
        ORDER BY ts DESC LIMIT ?
    `),
    insertOverlap: db.prepare(`
        INSERT INTO ml_regime_overlaps
        (user_id, resolved_env, overlap_id, sentence_a_id,
         sentence_b_id, overlap_count, overlap_ratio, ts)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `)
};

// ── buildSentence (pure) ───────────────────────────────────────────
function buildSentence(params) {
    const primitives = {};
    for (const dim of PRIMITIVE_DIMS) {
        const val = params && params[dim];
        if (val === undefined || val === null) {
            throw new Error(`regimeGrammar: missing primitive "${dim}"`);
        }
        if (!VOCABULARY[dim].includes(val)) {
            throw new Error(
                `regimeGrammar: invalid value "${val}" for "${dim}" — ` +
                `must be one of [${VOCABULARY[dim].join(',')}]`
            );
        }
        primitives[dim] = val;
    }
    const shortKey = { volatility: 'vol', trend: 'trend', liquidity: 'liq',
                       derivatives: 'deriv', macro: 'macro' };
    const parts = PRIMITIVE_DIMS.map(d => `${shortKey[d]}=${primitives[d]}`);
    return { regimeLabel: parts.join('|'), primitives };
}

// ── parseSentence (pure) ───────────────────────────────────────────
function parseSentence(sentenceStr) {
    if (typeof sentenceStr !== 'string' || sentenceStr.length === 0) {
        throw new Error('regimeGrammar: empty sentence');
    }
    const shortToDim = { vol: 'volatility', trend: 'trend', liq: 'liquidity',
                         deriv: 'derivatives', macro: 'macro' };
    const primitives = {};
    const parts = sentenceStr.split('|');
    for (const part of parts) {
        const [shortKey, val] = part.split('=');
        const dim = shortToDim[shortKey];
        if (!dim) {
            throw new Error(`regimeGrammar: unknown primitive key "${shortKey}"`);
        }
        if (!VOCABULARY[dim].includes(val)) {
            throw new Error(`regimeGrammar: invalid value "${val}" for "${dim}"`);
        }
        primitives[dim] = val;
    }
    for (const dim of PRIMITIVE_DIMS) {
        if (!primitives[dim]) {
            throw new Error(`regimeGrammar: missing primitive "${dim}" in sentence`);
        }
    }
    return primitives;
}

// ── computeOverlap (pure) ──────────────────────────────────────────
function computeOverlap(params) {
    const a = _required(params, 'primitivesA');
    const b = _required(params, 'primitivesB');
    let count = 0;
    for (const dim of PRIMITIVE_DIMS) {
        if (a[dim] !== undefined && b[dim] !== undefined && a[dim] === b[dim]) {
            count++;
        }
    }
    return { overlapCount: count, overlapRatio: count / PRIMITIVE_DIMS.length };
}

// ── recordSentence ─────────────────────────────────────────────────
function recordSentence(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const sentenceId = _required(params, 'sentenceId');
    const primitives = _required(params, 'primitives');
    const sourceContext = (params && params.sourceContext) ? params.sourceContext : null;
    const ts = (params && params.ts) ? params.ts : Date.now();

    const { regimeLabel } = buildSentence(primitives);

    try {
        _stmts.insertSentence.run(
            userId, env, sentenceId, regimeLabel,
            JSON.stringify(primitives), sourceContext, ts
        );
        return { recorded: true, sentenceId, regimeLabel };
    } catch (err) {
        if (err.code === 'SQLITE_CONSTRAINT_UNIQUE' ||
            (err.message && err.message.includes('UNIQUE'))) {
            throw new Error(`regimeGrammar: duplicate sentenceId "${sentenceId}"`);
        }
        throw err;
    }
}

// ── findSimilarRegimes ─────────────────────────────────────────────
function findSimilarRegimes(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const currentPrimitives = _required(params, 'currentPrimitives');
    const minOverlap = (params && params.minOverlap !== undefined)
        ? params.minOverlap : DEFAULT_OVERLAP_THRESHOLD;
    const limit = (params && params.limit) ? params.limit : 100;

    const rows = _stmts.listSentences.all(userId, env, limit);
    const results = [];
    for (const r of rows) {
        const primA = JSON.parse(r.primitives_json);
        const ov = computeOverlap({
            primitivesA: primA, primitivesB: currentPrimitives
        });
        if (ov.overlapRatio >= minOverlap) {
            results.push({
                sentenceId: r.sentence_id,
                regimeLabel: r.regime_label,
                primitives: primA,
                overlapCount: ov.overlapCount,
                overlapRatio: ov.overlapRatio,
                ts: r.ts
            });
        }
    }
    results.sort((a, b) => b.overlapRatio - a.overlapRatio);
    return results;
}

// ── getRegimeHistory ───────────────────────────────────────────────
function getRegimeHistory(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const limit = (params && params.limit) ? params.limit : 100;

    const rows = _stmts.listSentences.all(userId, env, limit);
    return rows.map(r => ({
        sentenceId: r.sentence_id,
        regimeLabel: r.regime_label,
        primitives: JSON.parse(r.primitives_json),
        sourceContext: r.source_context,
        ts: r.ts
    }));
}

module.exports = {
    VOCABULARY,
    PRIMITIVE_DIMS,
    DEFAULT_OVERLAP_THRESHOLD,
    buildSentence,
    parseSentence,
    computeOverlap,
    recordSentence,
    findSimilarRegimes,
    getRegimeHistory
};
