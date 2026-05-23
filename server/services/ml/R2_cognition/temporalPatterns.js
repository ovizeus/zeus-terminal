'use strict';

/**
 * OMEGA R2 Cognition — temporalPatterns (canonical §27)
 *
 * §27 PATTERNS TEMPORALE.
 * Source: /root/_review/ml_brain/ml_brain_canonic.txt lines 1194-1211.
 *
 * 10 temporal patterns (lines 1196-1205):
 *   seasonality_intraday, day_of_week, friday_evening, sunday_morning,
 *   wednesday_noon, end_of_month, end_of_quarter, london_open,
 *   new_york_open, asia_drift
 *
 * Effects (lines 1207-1210):
 *   - modifica scorul
 *   - modifica agresivitatea
 *   - modifica asteptarile
 *
 * INVARIANT (line 1211):
 *   "NU sunt semnale suficiente singure pentru intrare"
 *   → evaluateScoreAdjustment caps cumulative effect so patterns alone
 *     cannot push score >= 0.5 from baseline 0.
 *
 * Sessions (UTC):
 *   asia    00:00–08:00
 *   london  07:00–16:00 (overlap with asia at 07-08 + ny at 13-16)
 *   ny      13:00–21:00
 *   overlap when sessions cross
 */

const { db } = require('../../database');

const TEMPORAL_PATTERNS = Object.freeze([
    'seasonality_intraday',
    'day_of_week',
    'friday_evening',
    'sunday_morning',
    'wednesday_noon',
    'end_of_month',
    'end_of_quarter',
    'london_open',
    'new_york_open',
    'asia_drift'
]);

const SESSION_KEYS = Object.freeze(['asia', 'london', 'ny', 'overlap']);

const DAYS_OF_WEEK = Object.freeze([
    'sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'
]);

// Pattern → score adjustment weight (small per-pattern, capped cumulatively).
const PATTERN_WEIGHTS = Object.freeze({
    seasonality_intraday: 0.02,
    day_of_week:          0.02,
    friday_evening:      -0.04,  // risk-off window
    sunday_morning:      -0.03,  // illiquid
    wednesday_noon:       0.01,
    end_of_month:        -0.03,
    end_of_quarter:      -0.05,
    london_open:          0.03,  // higher quality liquidity
    new_york_open:        0.03,
    asia_drift:           0.01
});

// Aggressiveness adjustments (some patterns warrant smaller size).
const AGGRESSIVENESS_WEIGHTS = Object.freeze({
    friday_evening:      -0.15,
    sunday_morning:      -0.20,
    end_of_quarter:      -0.20,
    london_open:          0.05,
    new_york_open:        0.05
});

// Cap on cumulative pattern effect — enforces INVARIANT (line 1211).
// Even with all favorable patterns active, cannot push score by more than 0.20.
const MAX_CUMULATIVE_SCORE_ADJUSTMENT = 0.20;

// ── Helpers ─────────────────────────────────────────────────────────
function _required(params, key) {
    if (!params || params[key] === undefined || params[key] === null) {
        throw new Error(`temporalPatterns: missing ${key}`);
    }
    return params[key];
}

function _clampUnit(x) {
    return Math.max(0, Math.min(1, x));
}

// ── Session detection (pure) ───────────────────────────────────────
function _detectSession(hourUtc) {
    // Overlap windows checked first
    if (hourUtc >= 7 && hourUtc < 8) return 'overlap';   // asia/london
    if (hourUtc >= 13 && hourUtc < 16) return 'overlap'; // london/ny
    if (hourUtc >= 0 && hourUtc < 8) return 'asia';
    if (hourUtc >= 8 && hourUtc < 13) return 'london';
    if (hourUtc >= 16 && hourUtc < 21) return 'ny';
    return 'asia';  // post-NY → next asia
}

// ── getCurrentTemporalContext (pure) ───────────────────────────────
function getCurrentTemporalContext(params) {
    const timestampMs = _required(params, 'timestampMs');
    const date = new Date(timestampMs);
    const hourUtc = date.getUTCHours();
    const dayOfWeek = DAYS_OF_WEEK[date.getUTCDay()];
    const dayOfMonth = date.getUTCDate();
    const month = date.getUTCMonth() + 1;
    const session = _detectSession(hourUtc);

    const activePatterns = [];

    // Session opens (±90 minute windows)
    if (hourUtc >= 7 && hourUtc < 10) activePatterns.push('london_open');
    if (hourUtc >= 13 && hourUtc < 16) activePatterns.push('new_york_open');
    if (hourUtc >= 0 && hourUtc < 8) activePatterns.push('asia_drift');

    // Friday evening (Friday 18-23 UTC)
    if (dayOfWeek === 'friday' && hourUtc >= 18 && hourUtc < 24) {
        activePatterns.push('friday_evening');
    }
    // Sunday morning (Sunday 04-12 UTC)
    if (dayOfWeek === 'sunday' && hourUtc >= 4 && hourUtc < 12) {
        activePatterns.push('sunday_morning');
    }
    // Wednesday noon (Wednesday 11-14 UTC)
    if (dayOfWeek === 'wednesday' && hourUtc >= 11 && hourUtc < 14) {
        activePatterns.push('wednesday_noon');
    }
    // End of month (last 3 days)
    if (dayOfMonth >= 29) {
        activePatterns.push('end_of_month');
    }
    // End of quarter (last 2 days of mar/jun/sep/dec)
    const isQuarterMonth = [3, 6, 9, 12].includes(month);
    if (isQuarterMonth && dayOfMonth >= 29) {
        activePatterns.push('end_of_quarter');
    }
    // Always include intraday seasonality + day-of-week as ambient context
    activePatterns.push('seasonality_intraday');
    activePatterns.push('day_of_week');

    return {
        timestampMs,
        session,
        dayOfWeek,
        hourOfDay: hourUtc,
        dayOfMonth,
        month,
        activePatterns
    };
}

// ── evaluateScoreAdjustment (pure, INVARIANT enforced) ─────────────
function evaluateScoreAdjustment(params) {
    const patterns = (params && Array.isArray(params.patterns)) ? params.patterns : [];
    const score = (params && typeof params.score === 'number') ? params.score : 0;
    const aggressiveness = (params && typeof params.aggressiveness === 'number')
        ? params.aggressiveness : 0.5;

    let scoreDelta = 0;
    let aggrDelta = 0;
    for (const p of patterns) {
        const sw = PATTERN_WEIGHTS[p];
        if (typeof sw === 'number') scoreDelta += sw;
        const aw = AGGRESSIVENESS_WEIGHTS[p];
        if (typeof aw === 'number') aggrDelta += aw;
    }

    // INVARIANT: cap cumulative adjustment so patterns alone cannot
    // push score from 0 to decision threshold (line 1211).
    scoreDelta = Math.max(-MAX_CUMULATIVE_SCORE_ADJUSTMENT,
                          Math.min(MAX_CUMULATIVE_SCORE_ADJUSTMENT, scoreDelta));

    const adjustedScore = _clampUnit(score + scoreDelta);
    const adjustedAggressiveness = _clampUnit(aggressiveness + aggrDelta);

    return {
        adjustedScore,
        adjustedAggressiveness,
        scoreDelta,
        aggressivenessDelta: aggrDelta,
        patternsApplied: patterns.filter(p => PATTERN_WEIGHTS[p] !== undefined)
    };
}

// ── Prepared statements ────────────────────────────────────────────
const _stmts = {
    getObservation: db.prepare(`
        SELECT * FROM ml_temporal_observations
        WHERE user_id = ? AND resolved_env = ? AND pattern = ?
          AND (regime IS NULL AND ? IS NULL OR regime = ?)
    `),
    insertObservation: db.prepare(`
        INSERT INTO ml_temporal_observations
        (user_id, resolved_env, pattern, sample_count, mean_outcome,
         regime, last_seen_at, created_at, updated_at)
        VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?)
    `),
    updateObservation: db.prepare(`
        UPDATE ml_temporal_observations
        SET sample_count = sample_count + 1,
            mean_outcome = ((mean_outcome * sample_count) + ?) / (sample_count + 1),
            last_seen_at = ?,
            updated_at = ?
        WHERE id = ?
    `)
};

// ── recordTemporalObservation ──────────────────────────────────────
function recordTemporalObservation(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const pattern = _required(params, 'pattern');
    const outcome = _required(params, 'outcome');
    const regime = (params && params.regime) ? params.regime : null;

    if (!TEMPORAL_PATTERNS.includes(pattern)) {
        throw new Error(`temporalPatterns: invalid pattern "${pattern}"`);
    }

    const now = Date.now();
    const existing = _stmts.getObservation.get(userId, env, pattern, regime, regime);

    if (!existing) {
        _stmts.insertObservation.run(userId, env, pattern, outcome, regime, now, now, now);
    } else {
        _stmts.updateObservation.run(outcome, now, now, existing.id);
    }

    return { tracked: true, pattern, regime };
}

// ── getPatternStrength ─────────────────────────────────────────────
function getPatternStrength(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const pattern = _required(params, 'pattern');
    const regime = (params && params.regime) ? params.regime : null;
    const minSamples = (params && params.minSamples) ? params.minSamples : 1;

    const row = _stmts.getObservation.get(userId, env, pattern, regime, regime);
    if (!row || row.sample_count < minSamples) return null;

    return {
        pattern: row.pattern,
        regime: row.regime,
        mean: row.mean_outcome,
        count: row.sample_count,
        lastSeen: row.last_seen_at
    };
}

module.exports = {
    TEMPORAL_PATTERNS,
    SESSION_KEYS,
    DAYS_OF_WEEK,
    PATTERN_WEIGHTS,
    AGGRESSIVENESS_WEIGHTS,
    MAX_CUMULATIVE_SCORE_ADJUSTMENT,
    getCurrentTemporalContext,
    evaluateScoreAdjustment,
    recordTemporalObservation,
    getPatternStrength
};
