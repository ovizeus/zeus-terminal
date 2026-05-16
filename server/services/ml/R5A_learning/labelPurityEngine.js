'use strict';

/**
 * OMEGA R5A Learning — labelPurityEngine (canonical §78)
 *
 * §78 LABEL RELIABILITY / OUTCOME PURITY ENGINE.
 * Source: /root/_review/ml_brain/ml_brain_canonic.txt lines 2034-2080.
 *
 * "Rezultatul asta chiar reflecta calitatea deciziei sau e contaminat?"
 *
 * R5A learning. Label-side purification for ML training samples.
 * 8 contamination types per spec. 4 classifications (clean/noisy/
 * censored/excluded). Sample weighting based on purity score.
 *
 * Distinct from:
 *   - §16 attributionEngine (per-trade cause)
 *   - §22 dataHygiene (input-side leakage prevention)
 * §78 = label-side purity for training samples.
 */

const { db } = require('../../database');

const LABEL_CLASSIFICATIONS = Object.freeze([
    'clean', 'noisy', 'censored', 'excluded'
]);
const CONTAMINATION_TYPES = Object.freeze([
    'stiri_majore', 'exchange_outage', 'venue_anomaly',
    'spread_spike', 'feed_degradation', 'execution_failure',
    'forced_flatten_extern', 'dead_man_event'
]);
const SEVERITY_LEVELS = Object.freeze(['low', 'med', 'high']);

const PURITY_CLEAN_THRESHOLD = 0.85;
const PURITY_NOISY_THRESHOLD = 0.50;
const PURITY_CENSORED_THRESHOLD = 0.20;

const SEVERITY_PENALTY = Object.freeze({
    low: 0.10, med: 0.25, high: 0.50
});

const SAMPLE_WEIGHT_BY_CLASS = Object.freeze({
    clean: 1.0, noisy: 0.5, censored: 0.2, excluded: 0.0
});

// ── Helpers ─────────────────────────────────────────────────────────
function _required(params, key) {
    if (!params || params[key] === undefined || params[key] === null) {
        throw new Error(`labelPurityEngine: missing ${key}`);
    }
    return params[key];
}

// ── Prepared statements ────────────────────────────────────────────
const _stmts = {
    upsertPurity: db.prepare(`
        INSERT INTO ml_label_purity_scores
        (user_id, resolved_env, trade_id, label_classification,
         purity_score, sample_weight, outcome,
         contamination_reasons_json, last_updated, ts)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(trade_id) DO UPDATE SET
            label_classification = excluded.label_classification,
            purity_score = excluded.purity_score,
            sample_weight = excluded.sample_weight,
            contamination_reasons_json = excluded.contamination_reasons_json,
            last_updated = excluded.last_updated
    `),
    getPurity: db.prepare(`
        SELECT * FROM ml_label_purity_scores WHERE trade_id = ?
    `),
    insertContamination: db.prepare(`
        INSERT INTO ml_contamination_events
        (user_id, resolved_env, trade_id, contamination_type,
         severity, details_json, ts)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    `),
    getContaminationEvents: db.prepare(`
        SELECT * FROM ml_contamination_events
        WHERE user_id = ? AND resolved_env = ? AND trade_id = ?
        ORDER BY ts ASC
    `),
    contaminationStats: db.prepare(`
        SELECT contamination_type, severity, COUNT(*) AS count
        FROM ml_contamination_events
        WHERE user_id = ? AND resolved_env = ?
          AND ts >= ?
        GROUP BY contamination_type, severity
    `)
};

// ── computePurityScore (pure) ──────────────────────────────────────
function computePurityScore(params) {
    const events = _required(params, 'contaminationEvents');
    if (!Array.isArray(events) || events.length === 0) return 1.0;

    let totalPenalty = 0;
    for (const e of events) {
        const sev = e.severity || 'med';
        totalPenalty += SEVERITY_PENALTY[sev] || SEVERITY_PENALTY.med;
    }
    return Math.max(0, Math.min(1, 1.0 - totalPenalty));
}

// ── classifyLabel (pure) ───────────────────────────────────────────
function classifyLabel(purityScore) {
    if (typeof purityScore !== 'number' || purityScore < 0 || purityScore > 1) {
        throw new Error(`labelPurityEngine: purityScore must be in [0,1]`);
    }
    if (purityScore >= PURITY_CLEAN_THRESHOLD) return 'clean';
    if (purityScore >= PURITY_NOISY_THRESHOLD) return 'noisy';
    if (purityScore >= PURITY_CENSORED_THRESHOLD) return 'censored';
    return 'excluded';
}

// ── getSampleWeight (pure) ─────────────────────────────────────────
function getSampleWeight(params) {
    const classification = _required(params, 'classification');
    if (!LABEL_CLASSIFICATIONS.includes(classification)) {
        throw new Error(`labelPurityEngine: invalid classification "${classification}"`);
    }
    return SAMPLE_WEIGHT_BY_CLASS[classification];
}

// ── recordTradeOutcome ─────────────────────────────────────────────
function recordTradeOutcome(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const tradeId = _required(params, 'tradeId');
    const outcome = _required(params, 'outcome');
    const ts = (params && params.ts) ? params.ts : Date.now();

    // Default: clean label, purity=1.0, weight=1.0
    _stmts.upsertPurity.run(
        userId, env, tradeId,
        'clean', 1.0, 1.0,
        outcome,
        JSON.stringify([]),
        ts, ts
    );

    return { recorded: true, tradeId, classification: 'clean' };
}

// ── flagContamination ──────────────────────────────────────────────
function flagContamination(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const tradeId = _required(params, 'tradeId');
    const contaminationType = _required(params, 'contaminationType');
    const severity = _required(params, 'severity');
    const details = (params && params.details) ? params.details : null;
    const ts = (params && params.ts) ? params.ts : Date.now();

    if (!CONTAMINATION_TYPES.includes(contaminationType)) {
        throw new Error(`labelPurityEngine: invalid contaminationType "${contaminationType}"`);
    }
    if (!SEVERITY_LEVELS.includes(severity)) {
        throw new Error(`labelPurityEngine: invalid severity "${severity}"`);
    }

    // Append contamination event
    _stmts.insertContamination.run(
        userId, env, tradeId, contaminationType, severity,
        details ? JSON.stringify(details) : null, ts
    );

    // Recompute purity from all events
    const events = _stmts.getContaminationEvents.all(userId, env, tradeId);
    const purity = computePurityScore({ contaminationEvents: events });
    const classification = classifyLabel(purity);
    const weight = SAMPLE_WEIGHT_BY_CLASS[classification];

    // Update trade purity row
    const currentRow = _stmts.getPurity.get(tradeId);
    const outcome = currentRow ? currentRow.outcome : 'unknown';
    const reasons = events.map(e => ({
        type: e.contamination_type,
        severity: e.severity
    }));

    _stmts.upsertPurity.run(
        userId, env, tradeId,
        classification, purity, weight,
        outcome,
        JSON.stringify(reasons),
        ts, currentRow ? currentRow.ts : ts
    );

    return {
        flagged: true,
        newClassification: classification,
        purityScore: purity,
        sampleWeight: weight
    };
}

// ── getLabelPurity ─────────────────────────────────────────────────
function getLabelPurity(params) {
    const tradeId = _required(params, 'tradeId');
    const row = _stmts.getPurity.get(tradeId);
    if (!row) return null;
    return {
        tradeId: row.trade_id,
        classification: row.label_classification,
        purityScore: row.purity_score,
        sampleWeight: row.sample_weight,
        outcome: row.outcome,
        contaminationReasons: row.contamination_reasons_json
            ? JSON.parse(row.contamination_reasons_json) : [],
        ts: row.ts
    };
}

// ── getContaminationStats ──────────────────────────────────────────
function getContaminationStats(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const lookbackDays = (params && params.lookbackDays) ? params.lookbackDays : 30;

    const since = Date.now() - lookbackDays * 86400000;
    const rows = _stmts.contaminationStats.all(userId, env, since);

    return {
        byTypeAndSeverity: rows.map(r => ({
            contaminationType: r.contamination_type,
            severity: r.severity,
            count: r.count
        })),
        total: rows.reduce((s, r) => s + r.count, 0)
    };
}

module.exports = {
    LABEL_CLASSIFICATIONS,
    CONTAMINATION_TYPES,
    SEVERITY_LEVELS,
    PURITY_CLEAN_THRESHOLD,
    PURITY_NOISY_THRESHOLD,
    PURITY_CENSORED_THRESHOLD,
    SEVERITY_PENALTY,
    SAMPLE_WEIGHT_BY_CLASS,
    computePurityScore,
    classifyLabel,
    getSampleWeight,
    recordTradeOutcome,
    flagContamination,
    getLabelPurity,
    getContaminationStats
};
