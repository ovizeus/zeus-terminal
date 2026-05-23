'use strict';

/**
 * OMEGA _meta — informationTempoResonance (canonical §145)
 *
 * §145 INFORMATION TEMPO RESONANCE — fiecare semnal are un ritm natural,
 * și deciziile luate în contra ritmului sunt mai slabe.
 * Source: /root/_review/ml_brain/ml_brain_canonic.txt line 4715.
 *
 * "Spec-ul are signal decay (15), time-weighted decay (27), data freshness
 *  (13). Toate tratează prospețimea ca o proprietate a unui semnal
 *  individual. Ce lipsește e relația dintre ritmul natural al diferitelor
 *  tipuri de informație și cadența deciziilor botului... Un semnal de
 *  regime HTF are o perioadă naturală de câteva ore. Un semnal de order
 *  flow are perioadă de secunde. Un semnal de funding are perioadă de 8
 *  ore... Information tempo resonance mapează pentru fiecare tip de semnal
 *  perioada lui naturală de valabilitate și verifică că semnalele care
 *  contribuie la o decizie sunt în fază cu orizontul temporal al acelei
 *  decizii."
 *
 * Algorithm: resonance = min(decision_horizon, signal_period) /
 *                         max(decision_horizon, signal_period)
 * Perfect match → 1.0; far apart → → 0.
 *
 * Distinct from §15 signalDecay (individual signal time), §27 timeWeighted
 * Decay (individual decay), §13 dataFreshness (staleness). §145 =
 * RELAȚIONAL between decision tempo and signal tempo.
 */

const { db } = require('../../database');

const SIGNAL_CATEGORIES = Object.freeze([
    'microstructure', 'flow', 'structural', 'macro'
]);

// Default natural periods per category (ms). Per PDF examples:
//  - microstructure: ticks/orderbook → ~1s
//  - flow: OFI/CVD short → ~30s
//  - structural: intraday S/R / regime → ~1h
//  - macro: funding/ETF flows → ~8h
const DEFAULT_NATURAL_PERIODS_MS = Object.freeze({
    microstructure: 1000,
    flow: 30000,
    structural: 3600000,
    macro: 28800000
});

const DESYNC_SEVERITY_LEVELS = Object.freeze([
    'in_sync', 'mild_desync', 'severe_desync'
]);

const RESONANCE_THRESHOLDS = Object.freeze({
    in_sync: 0.70, mild: 0.30
});

const PENALTY_MAP = Object.freeze({
    in_sync: 0,
    mild_desync: 0.20,
    severe_desync: 0.50
});

function _required(params, key) {
    if (!params || params[key] === undefined || params[key] === null) {
        throw new Error(`informationTempoResonance: missing ${key}`);
    }
    return params[key];
}

const _stmts = {
    upsertTempo: db.prepare(`
        INSERT INTO ml_signal_tempos
        (user_id, resolved_env, tempo_id, signal_kind, signal_category,
         natural_period_ms, period_tolerance_pct, active, ts)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(user_id, resolved_env, signal_kind) DO UPDATE SET
            tempo_id = excluded.tempo_id,
            signal_category = excluded.signal_category,
            natural_period_ms = excluded.natural_period_ms,
            period_tolerance_pct = excluded.period_tolerance_pct,
            active = excluded.active,
            ts = excluded.ts
    `),
    getTempo: db.prepare(`
        SELECT * FROM ml_signal_tempos
        WHERE user_id = ? AND resolved_env = ? AND signal_kind = ?
    `),
    insertAssessment: db.prepare(`
        INSERT INTO ml_decision_tempo_assessments
        (user_id, resolved_env, assessment_id, decision_id,
         decision_horizon_ms, contributing_signals_json,
         mean_signal_period_ms, resonance_score, desync_severity,
         decision_quality_penalty, ts)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    latestAssessment: db.prepare(`
        SELECT * FROM ml_decision_tempo_assessments
        WHERE user_id = ? AND resolved_env = ? AND decision_id = ?
        ORDER BY ts DESC LIMIT 1
    `),
    listBySeverity: db.prepare(`
        SELECT * FROM ml_decision_tempo_assessments
        WHERE user_id = ? AND resolved_env = ? AND desync_severity = ?
        ORDER BY ts DESC LIMIT ?
    `)
};

// ── computeResonance (pure) ────────────────────────────────────────
// Ratio: min/max → 1.0 perfect, → 0 far apart. Symmetric.
function computeResonance(params) {
    const d = _required(params, 'decisionHorizonMs');
    const s = _required(params, 'signalPeriodMs');
    if (d <= 0 || s <= 0) {
        throw new Error('informationTempoResonance: periods must be > 0');
    }
    return { resonance: Math.min(d, s) / Math.max(d, s) };
}

// ── computeMeanSignalPeriod (pure) ─────────────────────────────────
// Weighted average of signal periods, weights from contributingSignals.
function computeMeanSignalPeriod(params) {
    const signals = _required(params, 'contributingSignals');
    const lookup = _required(params, 'periodLookup');
    if (!Array.isArray(signals) || signals.length === 0) {
        throw new Error(
            'informationTempoResonance: contributingSignals must be non-empty array'
        );
    }
    let weightedSum = 0;
    let totalWeight = 0;
    for (const s of signals) {
        const period = lookup[s.signalKind];
        if (period === undefined || period === null) {
            throw new Error(
                `informationTempoResonance: missing period for signal "${s.signalKind}" (unknown signal_kind)`
            );
        }
        weightedSum += period * s.weight;
        totalWeight += s.weight;
    }
    if (totalWeight <= 0) {
        throw new Error(
            'informationTempoResonance: total weight must be > 0'
        );
    }
    return { meanPeriodMs: weightedSum / totalWeight };
}

// ── classifyDesyncSeverity (pure) ──────────────────────────────────
function classifyDesyncSeverity(params) {
    const score = _required(params, 'resonanceScore');
    if (score < 0 || score > 1) {
        throw new Error(
            'informationTempoResonance: resonanceScore must be in [0,1]'
        );
    }
    if (score >= RESONANCE_THRESHOLDS.in_sync) return { severity: 'in_sync' };
    if (score >= RESONANCE_THRESHOLDS.mild) return { severity: 'mild_desync' };
    return { severity: 'severe_desync' };
}

// ── computeQualityPenalty (pure) ───────────────────────────────────
function computeQualityPenalty(params) {
    const sev = _required(params, 'desyncSeverity');
    if (!DESYNC_SEVERITY_LEVELS.includes(sev)) {
        throw new Error(
            `informationTempoResonance: invalid desyncSeverity "${sev}"`
        );
    }
    return { penalty: PENALTY_MAP[sev] };
}

// ── registerSignalTempo ────────────────────────────────────────────
function registerSignalTempo(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const signalKind = _required(params, 'signalKind');
    const category = _required(params, 'signalCategory');
    const naturalPeriod = _required(params, 'naturalPeriodMs');
    const tolerance = (params && params.periodTolerancePct !== undefined &&
                       params.periodTolerancePct !== null)
        ? params.periodTolerancePct : 0.20;
    const ts = (params && params.ts) ? params.ts : Date.now();

    if (!SIGNAL_CATEGORIES.includes(category)) {
        throw new Error(
            `informationTempoResonance: invalid signalCategory "${category}"`
        );
    }
    if (naturalPeriod <= 0) {
        throw new Error(
            'informationTempoResonance: naturalPeriodMs must be > 0'
        );
    }
    if (tolerance < 0 || tolerance > 1) {
        throw new Error(
            'informationTempoResonance: periodTolerancePct must be in [0,1]'
        );
    }
    const tempoId = `${signalKind}_${userId}_${env}_${ts}`;
    _stmts.upsertTempo.run(
        userId, env, tempoId, signalKind, category,
        naturalPeriod, tolerance, 1, ts
    );
    return { registered: true, signalKind };
}

// ── getSignalTempo ─────────────────────────────────────────────────
function getSignalTempo(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const signalKind = _required(params, 'signalKind');
    const r = _stmts.getTempo.get(userId, env, signalKind);
    if (!r) return null;
    return {
        signalKind: r.signal_kind,
        signalCategory: r.signal_category,
        naturalPeriodMs: r.natural_period_ms,
        periodTolerancePct: r.period_tolerance_pct,
        active: r.active === 1,
        ts: r.ts
    };
}

// ── recordDecisionTempoAssessment (integration) ────────────────────
function recordDecisionTempoAssessment(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const assId = _required(params, 'assessmentId');
    const decisionId = _required(params, 'decisionId');
    const horizon = _required(params, 'decisionHorizonMs');
    const signals = _required(params, 'contributingSignals');
    const ts = (params && params.ts) ? params.ts : Date.now();

    if (horizon <= 0) {
        throw new Error(
            'informationTempoResonance: decisionHorizonMs must be > 0'
        );
    }
    if (!Array.isArray(signals) || signals.length === 0) {
        throw new Error(
            'informationTempoResonance: contributingSignals must be non-empty'
        );
    }

    // Build period lookup from registered tempos
    const periodLookup = {};
    for (const s of signals) {
        const tempo = _stmts.getTempo.get(userId, env, s.signalKind);
        if (!tempo) {
            throw new Error(
                `informationTempoResonance: missing tempo for signal "${s.signalKind}" (unknown signal_kind)`
            );
        }
        periodLookup[s.signalKind] = tempo.natural_period_ms;
    }

    const { meanPeriodMs } = computeMeanSignalPeriod({
        contributingSignals: signals, periodLookup
    });
    const { resonance } = computeResonance({
        decisionHorizonMs: horizon, signalPeriodMs: meanPeriodMs
    });
    const { severity } = classifyDesyncSeverity({ resonanceScore: resonance });
    const { penalty } = computeQualityPenalty({ desyncSeverity: severity });

    try {
        _stmts.insertAssessment.run(
            userId, env, assId, decisionId, horizon,
            JSON.stringify(signals), meanPeriodMs, resonance,
            severity, penalty, ts
        );
        return {
            recorded: true, assessmentId: assId,
            meanSignalPeriodMs: meanPeriodMs,
            resonanceScore: resonance,
            desyncSeverity: severity,
            decisionQualityPenalty: penalty
        };
    } catch (err) {
        if (err.code === 'SQLITE_CONSTRAINT_UNIQUE' ||
            (err.message && err.message.includes('UNIQUE'))) {
            throw new Error(
                `informationTempoResonance: duplicate assessmentId "${assId}"`
            );
        }
        throw err;
    }
}

function _rowToAssessment(r) {
    return {
        assessmentId: r.assessment_id,
        decisionId: r.decision_id,
        decisionHorizonMs: r.decision_horizon_ms,
        contributingSignals: JSON.parse(r.contributing_signals_json),
        meanSignalPeriodMs: r.mean_signal_period_ms,
        resonanceScore: r.resonance_score,
        desyncSeverity: r.desync_severity,
        decisionQualityPenalty: r.decision_quality_penalty,
        ts: r.ts
    };
}

// ── getDecisionAssessment ──────────────────────────────────────────
function getDecisionAssessment(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const decisionId = _required(params, 'decisionId');
    const r = _stmts.latestAssessment.get(userId, env, decisionId);
    if (!r) return null;
    return _rowToAssessment(r);
}

// ── getDesyncedDecisions ───────────────────────────────────────────
function getDesyncedDecisions(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const severity = _required(params, 'severity');
    const limit = (params && params.limit) ? params.limit : 100;
    if (!DESYNC_SEVERITY_LEVELS.includes(severity)) {
        throw new Error(
            `informationTempoResonance: invalid severity "${severity}"`
        );
    }
    const rows = _stmts.listBySeverity.all(userId, env, severity, limit);
    return rows.map(_rowToAssessment);
}

module.exports = {
    SIGNAL_CATEGORIES,
    DEFAULT_NATURAL_PERIODS_MS,
    DESYNC_SEVERITY_LEVELS,
    RESONANCE_THRESHOLDS,
    PENALTY_MAP,
    computeResonance,
    computeMeanSignalPeriod,
    classifyDesyncSeverity,
    computeQualityPenalty,
    registerSignalTempo,
    getSignalTempo,
    recordDecisionTempoAssessment,
    getDecisionAssessment,
    getDesyncedDecisions
};
