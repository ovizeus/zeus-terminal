'use strict';

/**
 * OMEGA R5A Learning — syntheticMarketGenerator (canonical §96)
 *
 * §96 SYNTHETIC MARKET WORLD MODEL / PLAUSIBLE SCENARIO GENERATOR.
 * Source: /root/_review/ml_brain/ml_brain_canonic.txt lines 2427-2469.
 *
 * "Istoricul real este finit... unele regimuri rare apar prea putin pentru
 *  antrenare robusta... Monte Carlo clasic perturba parametri dar nu
 *  genereaza lumi de piata coerente... generare tranzitii rare
 *  (trend→panic, range→squeeze, macro→shock, venue fragmentation)...
 *  datele sintetice NU au voie sa inlocuiasca real ca sursa primara...
 *  scenariile sintetice trebuie marcate clar."
 *
 * Pragmatic scope (NO neural world model — fara training):
 * - Scenarios = regime sequences via transition matrix from real-data fingerprint
 * - Hard CHECK is_synthetic=1 prevents confusion with real data
 * - KL divergence on marginals as plausibility validator
 * Distinct from §242 counterfactualPortfolio (replays history).
 */

const { db } = require('../../database');

const SCENARIO_TYPES = Object.freeze([
    'trend_to_panic', 'range_to_squeeze', 'macro_shock',
    'venue_fragmentation', 'custom'
]);
const MIN_SCENARIO_LENGTH = 3;
const MAX_SCENARIO_LENGTH = 100;
const DEFAULT_KL_THRESHOLD = 0.5;

function _required(params, key) {
    if (!params || params[key] === undefined || params[key] === null) {
        throw new Error(`syntheticMarketGenerator: missing ${key}`);
    }
    return params[key];
}

const _stmts = {
    insertFingerprint: db.prepare(`
        INSERT INTO ml_data_fingerprints
        (user_id, resolved_env, fingerprint_id,
         marginal_distributions_json, transition_matrix_json,
         sample_count, ts)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    `),
    getFingerprint: db.prepare(`
        SELECT * FROM ml_data_fingerprints WHERE fingerprint_id = ?
    `),
    insertScenario: db.prepare(`
        INSERT INTO ml_synthetic_scenarios
        (user_id, resolved_env, scenario_id, regime_sequence_json,
         scenario_type, source_fingerprint_id, plausibility_score,
         is_synthetic, flagged_for_review, flag_reason, ts)
        VALUES (?, ?, ?, ?, ?, ?, ?, 1, 0, NULL, ?)
    `),
    getScenario: db.prepare(`
        SELECT * FROM ml_synthetic_scenarios WHERE scenario_id = ?
    `),
    listScenarios: db.prepare(`
        SELECT * FROM ml_synthetic_scenarios
        WHERE user_id = ? AND resolved_env = ?
        ORDER BY ts DESC LIMIT ?
    `),
    flagScenario: db.prepare(`
        UPDATE ml_synthetic_scenarios
        SET flagged_for_review = 1, flag_reason = ?
        WHERE user_id = ? AND resolved_env = ? AND scenario_id = ?
    `)
};

// ── registerRealDataFingerprint ────────────────────────────────────
function registerRealDataFingerprint(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const fingerprintId = _required(params, 'fingerprintId');
    const marginalDistributions = _required(params, 'marginalDistributions');
    const transitionMatrix = _required(params, 'transitionMatrix');
    const sampleCount = _required(params, 'sampleCount');
    if (sampleCount < 0) {
        throw new Error('syntheticMarketGenerator: sampleCount must be >= 0');
    }
    const ts = (params && params.ts) ? params.ts : Date.now();

    try {
        _stmts.insertFingerprint.run(
            userId, env, fingerprintId,
            JSON.stringify(marginalDistributions),
            JSON.stringify(transitionMatrix),
            sampleCount, ts
        );
        return { registered: true, fingerprintId };
    } catch (err) {
        if (err.code === 'SQLITE_CONSTRAINT_UNIQUE' ||
            (err.message && err.message.includes('UNIQUE'))) {
            throw new Error(`syntheticMarketGenerator: duplicate fingerprintId "${fingerprintId}"`);
        }
        throw err;
    }
}

// ── generateScenario ───────────────────────────────────────────────
// Random walk via transition matrix. transitionMatrix shape:
// { "STATE_A": { "STATE_B": 0.6, "STATE_C": 0.4 }, ... }
function generateScenario(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const scenarioId = _required(params, 'scenarioId');
    const startState = _required(params, 'startState');
    const length = _required(params, 'length');
    const fingerprintId = _required(params, 'fingerprintId');
    const scenarioType = _required(params, 'scenarioType');
    if (!SCENARIO_TYPES.includes(scenarioType)) {
        throw new Error(`syntheticMarketGenerator: invalid scenarioType "${scenarioType}"`);
    }
    if (length < MIN_SCENARIO_LENGTH || length > MAX_SCENARIO_LENGTH) {
        throw new Error(
            `syntheticMarketGenerator: length must be in [${MIN_SCENARIO_LENGTH},${MAX_SCENARIO_LENGTH}]`
        );
    }
    const rng = (params && params.rng) ? params.rng : Math.random;

    const fp = _stmts.getFingerprint.get(fingerprintId);
    if (!fp) {
        throw new Error(`syntheticMarketGenerator: fingerprint "${fingerprintId}" not found`);
    }
    if (fp.user_id !== userId || fp.resolved_env !== env) {
        throw new Error('syntheticMarketGenerator: fingerprint not owned by user/env');
    }
    const tm = JSON.parse(fp.transition_matrix_json);
    if (!tm[startState]) {
        throw new Error(`syntheticMarketGenerator: startState "${startState}" not in transition matrix`);
    }

    function pickNext(state) {
        const row = tm[state];
        if (!row) return state;
        const total = Object.values(row).reduce((s, v) => s + v, 0);
        let r = rng() * total;
        for (const [next, p] of Object.entries(row)) {
            r -= p;
            if (r <= 0) return next;
        }
        const keys = Object.keys(row);
        return keys[keys.length - 1];
    }

    const sequence = [startState];
    let cur = startState;
    for (let i = 1; i < length; i++) {
        cur = pickNext(cur);
        sequence.push(cur);
    }

    return { generated: true, scenarioId, regimeSequence: sequence, length };
}

// ── validateScenarioPlausibility (pure) ────────────────────────────
// KL divergence approx on state frequency vs reference marginal.
function validateScenarioPlausibility(params) {
    const sequence = _required(params, 'scenarioSequence');
    const referenceMarginal = _required(params, 'referenceMarginal');
    const klThreshold = (params && params.klThreshold !== undefined)
        ? params.klThreshold : DEFAULT_KL_THRESHOLD;

    if (!Array.isArray(sequence) || sequence.length === 0) {
        return { plausible: false, kl: Infinity, reason: 'empty_sequence' };
    }
    // count frequencies in synthetic sequence
    const counts = {};
    for (const s of sequence) counts[s] = (counts[s] || 0) + 1;
    const n = sequence.length;

    const states = new Set([
        ...Object.keys(counts), ...Object.keys(referenceMarginal)
    ]);
    let kl = 0;
    for (const s of states) {
        const p = (counts[s] || 0) / n;
        const q = referenceMarginal[s];
        if (p === 0) continue;
        if (q === undefined || q <= 0) {
            kl += p * Math.log(p / 1e-9);   // missing reference state penalty
        } else {
            kl += p * Math.log(p / q);
        }
    }
    return {
        plausible: kl <= klThreshold, kl,
        threshold: klThreshold,
        sequenceLength: n
    };
}

// ── recordScenario ─────────────────────────────────────────────────
function recordScenario(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const scenarioId = _required(params, 'scenarioId');
    const regimeSequence = _required(params, 'regimeSequence');
    const scenarioType = _required(params, 'scenarioType');
    if (!SCENARIO_TYPES.includes(scenarioType)) {
        throw new Error(`syntheticMarketGenerator: invalid scenarioType "${scenarioType}"`);
    }
    const sourceFingerprintId = (params && params.sourceFingerprintId) ? params.sourceFingerprintId : null;
    const plausibilityScore = (params && params.plausibilityScore !== undefined)
        ? params.plausibilityScore : null;
    const ts = (params && params.ts) ? params.ts : Date.now();

    try {
        _stmts.insertScenario.run(
            userId, env, scenarioId,
            JSON.stringify(regimeSequence),
            scenarioType, sourceFingerprintId, plausibilityScore, ts
        );
        return { recorded: true, scenarioId, isSynthetic: true };
    } catch (err) {
        if (err.code === 'SQLITE_CONSTRAINT_UNIQUE' ||
            (err.message && err.message.includes('UNIQUE'))) {
            throw new Error(`syntheticMarketGenerator: duplicate scenarioId "${scenarioId}"`);
        }
        throw err;
    }
}

// ── flagScenarioForReview ──────────────────────────────────────────
function flagScenarioForReview(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const scenarioId = _required(params, 'scenarioId');
    const reason = _required(params, 'reason');

    const sc = _stmts.getScenario.get(scenarioId);
    if (!sc) {
        throw new Error(`syntheticMarketGenerator: scenario "${scenarioId}" not found`);
    }
    if (sc.user_id !== userId || sc.resolved_env !== env) {
        throw new Error('syntheticMarketGenerator: scenario not owned by user/env');
    }
    _stmts.flagScenario.run(reason, userId, env, scenarioId);
    return { flagged: true, scenarioId, reason };
}

// ── getScenarioHistory ─────────────────────────────────────────────
function getScenarioHistory(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const limit = (params && params.limit) ? params.limit : 100;

    const rows = _stmts.listScenarios.all(userId, env, limit);
    return rows.map(r => ({
        scenarioId: r.scenario_id,
        regimeSequence: JSON.parse(r.regime_sequence_json),
        scenarioType: r.scenario_type,
        sourceFingerprintId: r.source_fingerprint_id,
        plausibilityScore: r.plausibility_score,
        isSynthetic: !!r.is_synthetic,
        flaggedForReview: !!r.flagged_for_review,
        flagReason: r.flag_reason,
        ts: r.ts
    }));
}

module.exports = {
    SCENARIO_TYPES,
    MIN_SCENARIO_LENGTH,
    MAX_SCENARIO_LENGTH,
    DEFAULT_KL_THRESHOLD,
    registerRealDataFingerprint,
    generateScenario,
    validateScenarioPlausibility,
    recordScenario,
    flagScenarioForReview,
    getScenarioHistory
};
