'use strict';

/**
 * OMEGA R3A Safety — venueCounterpartyRisk (canonical §87)
 *
 * §87 VENUE COUNTERPARTY / EXCHANGE CREDIT RISK LAYER.
 * Source: /root/_review/ml_brain/ml_brain_canonic.txt lines 2242-2283.
 *
 * "Exchange = contraparte operationala + financiara, NU doar loc de
 *  executie. Edge-ul de trading NU bate riscul existential de contraparte."
 *
 * R3A safety. Venue treated as risk participant. 7 evaluation factors +
 * 6 incident types. Status ladder: HEALTHY → DEGRADED → RESTRICTED →
 * MIGRATE. Capital limit per venue based on score.
 *
 * Distinct from:
 *   - §30 portfolioGovernance (correlation matrix + caps)
 *   - §63 deadMansSwitch (own process death)
 * §87 = venue-as-counterparty risk dimension.
 */

const { db } = require('../../database');

const INCIDENT_TYPES = Object.freeze([
    'withdrawal_freeze', 'insolvency', 'insurance_fund_weakness',
    'regulatory_freeze', 'api_instability', 'operational_failure'
]);
const EVALUATION_FACTORS = Object.freeze([
    'uptime', 'withdrawal_reliability', 'insurance_fund_quality',
    'liquidation_engine_behavior', 'incident_history',
    'legal_regulatory_exposure', 'custody_collateral_concentration'
]);
const VENUE_STATUSES = Object.freeze([
    'HEALTHY', 'DEGRADED', 'RESTRICTED', 'MIGRATE'
]);
const SEVERITY_LEVELS = Object.freeze(['low', 'med', 'high', 'critical']);

const MAX_CONCENTRATION_PCT = 0.50;
const STATUS_THRESHOLDS = Object.freeze({
    healthy: 0.75, degraded: 0.50, restricted: 0.25
});
const SEVERITY_PENALTY = Object.freeze({
    low: 0.02, med: 0.05, high: 0.15, critical: 0.30
});

// ── Helpers ─────────────────────────────────────────────────────────
function _required(params, key) {
    if (!params || params[key] === undefined || params[key] === null) {
        throw new Error(`venueCounterpartyRisk: missing ${key}`);
    }
    return params[key];
}

function _scoreToStatus(score) {
    if (score >= STATUS_THRESHOLDS.healthy) return 'HEALTHY';
    if (score >= STATUS_THRESHOLDS.degraded) return 'DEGRADED';
    if (score >= STATUS_THRESHOLDS.restricted) return 'RESTRICTED';
    return 'MIGRATE';
}

function _scoreToCapLimit(score) {
    if (score >= STATUS_THRESHOLDS.healthy) return MAX_CONCENTRATION_PCT;
    if (score >= STATUS_THRESHOLDS.degraded) return MAX_CONCENTRATION_PCT * 0.50;
    if (score >= STATUS_THRESHOLDS.restricted) return MAX_CONCENTRATION_PCT * 0.20;
    return 0.0;
}

// ── Prepared statements ────────────────────────────────────────────
const _stmts = {
    upsertVenue: db.prepare(`
        INSERT INTO ml_venue_risk_scores
        (user_id, resolved_env, venue_id, counterparty_risk_score,
         operational_trust_score, factor_scores_json,
         capital_limit_pct, status, last_evaluated)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(user_id, resolved_env, venue_id) DO UPDATE SET
            counterparty_risk_score = excluded.counterparty_risk_score,
            operational_trust_score = excluded.operational_trust_score,
            factor_scores_json = excluded.factor_scores_json,
            capital_limit_pct = excluded.capital_limit_pct,
            status = excluded.status,
            last_evaluated = excluded.last_evaluated
    `),
    getVenue: db.prepare(`
        SELECT * FROM ml_venue_risk_scores
        WHERE user_id = ? AND resolved_env = ? AND venue_id = ?
    `),
    insertIncident: db.prepare(`
        INSERT INTO ml_venue_incidents
        (user_id, resolved_env, venue_id, incident_type,
         severity, details_json, ts)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    `),
    incidentHistory: db.prepare(`
        SELECT * FROM ml_venue_incidents
        WHERE user_id = ? AND resolved_env = ?
          AND (? = '' OR venue_id = ?)
          AND (? = '' OR severity = ?)
          AND (? = 0 OR ts >= ?)
        ORDER BY ts DESC, id DESC
        LIMIT ?
    `)
};

// ── computeVenueRiskScore (pure) ───────────────────────────────────
function computeVenueRiskScore(params) {
    const factorScores = _required(params, 'factorScores');

    // All 7 factors weighted equally (extensible later)
    let sum = 0, count = 0;
    for (const f of EVALUATION_FACTORS) {
        if (typeof factorScores[f] === 'number') {
            sum += factorScores[f];
            count++;
        }
    }
    return count > 0 ? sum / count : 0;
}

// ── defineVenue ────────────────────────────────────────────────────
function defineVenue(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const venueId = _required(params, 'venueId');
    const factorScores = _required(params, 'factorScores');
    const ts = (params && params.ts) ? params.ts : Date.now();

    const counterpartyRisk = computeVenueRiskScore({ factorScores });
    const operationalTrust = counterpartyRisk;  // share initial score
    const status = _scoreToStatus(counterpartyRisk);
    const capLimit = _scoreToCapLimit(counterpartyRisk);

    _stmts.upsertVenue.run(
        userId, env, venueId,
        counterpartyRisk, operationalTrust,
        JSON.stringify(factorScores),
        capLimit, status, ts
    );

    return { defined: true, venueId, status, capLimit };
}

// ── recordVenueIncident ────────────────────────────────────────────
function recordVenueIncident(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const venueId = _required(params, 'venueId');
    const incidentType = _required(params, 'incidentType');
    const severity = _required(params, 'severity');
    const details = (params && params.details) ? params.details : null;
    const ts = (params && params.ts) ? params.ts : Date.now();

    if (!INCIDENT_TYPES.includes(incidentType)) {
        throw new Error(`venueCounterpartyRisk: invalid incidentType "${incidentType}"`);
    }
    if (!SEVERITY_LEVELS.includes(severity)) {
        throw new Error(`venueCounterpartyRisk: invalid severity "${severity}"`);
    }

    // Log incident
    _stmts.insertIncident.run(
        userId, env, venueId, incidentType, severity,
        details ? JSON.stringify(details) : null, ts
    );

    // Degrade score
    const current = _stmts.getVenue.get(userId, env, venueId);
    if (current) {
        const penalty = SEVERITY_PENALTY[severity];
        const factorScores = JSON.parse(current.factor_scores_json);
        // Apply heavily to incident_history + global degrade across all factors
        factorScores.incident_history = Math.max(
            0, (factorScores.incident_history || 0.5) - penalty
        );
        // Critical incidents apply systemic degrade (proportional to penalty)
        const globalDegrade = penalty * 0.5;
        for (const f of EVALUATION_FACTORS) {
            if (f === 'incident_history') continue;
            factorScores[f] = Math.max(0, (factorScores[f] || 0.5) - globalDegrade);
        }

        const newScore = computeVenueRiskScore({ factorScores });
        const newStatus = _scoreToStatus(newScore);
        const newCap = _scoreToCapLimit(newScore);

        _stmts.upsertVenue.run(
            userId, env, venueId,
            newScore, newScore,
            JSON.stringify(factorScores),
            newCap, newStatus, ts
        );

        return {
            recorded: true,
            newScore,
            newStatus,
            degraded: newScore < current.counterparty_risk_score
        };
    }

    return { recorded: true, newScore: null, newStatus: null };
}

// ── evaluateVenueExposure ──────────────────────────────────────────
function evaluateVenueExposure(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const venueId = _required(params, 'venueId');
    const currentExposurePct = _required(params, 'currentExposurePct');

    const v = _stmts.getVenue.get(userId, env, venueId);
    if (!v) {
        return {
            allowed: false,
            recommendation: 'venue_not_registered',
            hasVenue: false
        };
    }

    let recommendation;
    let allowed;
    if (v.status === 'MIGRATE') {
        allowed = false;
        recommendation = 'MIGRATE_AWAY';
    } else if (v.status === 'RESTRICTED') {
        allowed = currentExposurePct <= v.capital_limit_pct;
        recommendation = allowed ? 'RESTRICTED_OK' : 'REDUCE_EXPOSURE';
    } else if (v.status === 'DEGRADED') {
        allowed = currentExposurePct <= v.capital_limit_pct;
        recommendation = allowed ? 'DEGRADED_WARN' : 'REDUCE_EXPOSURE';
    } else {
        allowed = currentExposurePct <= MAX_CONCENTRATION_PCT;
        recommendation = allowed ? 'APPROVED' : 'CONCENTRATION_LIMIT';
    }

    return {
        allowed,
        recommendation,
        hasVenue: true,
        status: v.status,
        capLimitPct: v.capital_limit_pct,
        currentExposurePct,
        counterpartyRiskScore: v.counterparty_risk_score
    };
}

// ── getVenueStatus ─────────────────────────────────────────────────
function getVenueStatus(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const venueId = _required(params, 'venueId');
    const row = _stmts.getVenue.get(userId, env, venueId);
    if (!row) return { exists: false };
    return {
        exists: true,
        venueId: row.venue_id,
        counterpartyRiskScore: row.counterparty_risk_score,
        operationalTrustScore: row.operational_trust_score,
        factorScores: JSON.parse(row.factor_scores_json),
        capitalLimitPct: row.capital_limit_pct,
        status: row.status,
        lastEvaluated: row.last_evaluated
    };
}

// ── getIncidentHistory ─────────────────────────────────────────────
function getIncidentHistory(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const venueId = (params && params.venueId) ? params.venueId : '';
    const severity = (params && params.severity) ? params.severity : '';
    const since = (params && params.since) ? params.since : 0;
    const limit = (params && params.limit) ? params.limit : 100;
    return _stmts.incidentHistory.all(
        userId, env,
        venueId, venueId,
        severity, severity,
        since > 0 ? 1 : 0, since,
        limit
    );
}

// ── recommendDiversification ───────────────────────────────────────
function recommendDiversification(params) {
    const exposureByVenue = _required(params, 'exposureByVenue');

    if (typeof exposureByVenue !== 'object') {
        throw new Error('venueCounterpartyRisk: exposureByVenue must be object');
    }

    const flags = [];
    for (const [venueId, pct] of Object.entries(exposureByVenue)) {
        if (pct > MAX_CONCENTRATION_PCT) {
            flags.push({
                venueId,
                currentPct: pct,
                maxPct: MAX_CONCENTRATION_PCT,
                recommendation: 'REDUCE_OR_DIVERSIFY'
            });
        }
    }

    return {
        diversified: flags.length === 0,
        violations: flags,
        maxConcentrationPct: MAX_CONCENTRATION_PCT
    };
}

module.exports = {
    INCIDENT_TYPES,
    EVALUATION_FACTORS,
    VENUE_STATUSES,
    SEVERITY_LEVELS,
    MAX_CONCENTRATION_PCT,
    STATUS_THRESHOLDS,
    computeVenueRiskScore,
    defineVenue,
    recordVenueIncident,
    evaluateVenueExposure,
    getVenueStatus,
    getIncidentHistory,
    recommendDiversification
};
