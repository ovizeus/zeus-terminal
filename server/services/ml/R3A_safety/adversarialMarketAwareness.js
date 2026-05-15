'use strict';

/**
 * OMEGA R3A Safety — adversarialMarketAwareness (canonical §62)
 *
 * §62 ADVERSARIAL MARKET AWARENESS — botul tau e observabil.
 * Source: /root/_review/ml_brain/ml_brain_canonic.txt lines 1733-1734.
 *
 * "HFT-urile si market makerii sofisticati detecteaza pattern-urile
 *  boturilor si le exploateaza activ. In 2-3 saptamani cineva ii stie
 *  amprenta si il front-runaza."
 *
 * Two-pronged defense:
 *   1. Deliberate randomization of timing/sizing/order-type
 *      (zero-mean, decorrelate signature)
 *   2. Self-fingerprint detection: if slippage rises systematically on
 *      our preferred setups → we are being read
 *
 * Critical: jitter must NOT bias toward favorable direction — that
 * would re-introduce a detectable pattern. Pure zero-mean random.
 */

const { db } = require('../../database');

const ORDER_TYPES = Object.freeze(['market', 'limit', 'post_only', 'ioc']);
const SEVERITY_LEVELS = Object.freeze(['warn', 'critical']);

const DEFAULT_TIMING_JITTER_MS = 500;
const DEFAULT_SIZE_JITTER_PCT = 0.05;
const COMPROMISE_SLIPPAGE_THRESHOLD_BPS = 5;
const MIN_SAMPLES_FOR_COMPROMISE = 10;

// ── Helpers ─────────────────────────────────────────────────────────
function _required(params, key) {
    if (!params || params[key] === undefined || params[key] === null) {
        throw new Error(`adversarialMarketAwareness: missing ${key}`);
    }
    return params[key];
}

function _zeroMeanRandom() {
    // Uniform in [-1, 1].
    return (Math.random() * 2) - 1;
}

// ── Prepared statements ────────────────────────────────────────────
const _stmts = {
    insertObs: db.prepare(`
        INSERT INTO ml_fingerprint_observations
        (user_id, resolved_env, setup_type, entry_delay_ms,
         size_jitter_pct, order_type_used, actual_slippage_bps,
         expected_slippage_bps, slippage_excess_bps, ts)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    insertAlert: db.prepare(`
        INSERT INTO ml_fingerprint_alerts
        (user_id, resolved_env, setup_type, slippage_trend_bps,
         samples_in_window, severity, ts)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    `),
    statsForSetup: db.prepare(`
        SELECT COUNT(*) AS samples,
               AVG(slippage_excess_bps) AS avg_excess,
               AVG(actual_slippage_bps) AS avg_slippage
        FROM ml_fingerprint_observations
        WHERE user_id = ? AND resolved_env = ?
          AND setup_type = ? AND ts >= ?
    `),
    allSetups: db.prepare(`
        SELECT DISTINCT setup_type FROM ml_fingerprint_observations
        WHERE user_id = ? AND resolved_env = ?
    `)
};

// ── applyEntryJitter ───────────────────────────────────────────────
function applyEntryJitter(params) {
    const baseDelayMs = _required(params, 'baseDelayMs');
    const jitterRangeMs = (params && typeof params.jitterRangeMs === 'number')
        ? params.jitterRangeMs : DEFAULT_TIMING_JITTER_MS;

    const jitter = Math.round(_zeroMeanRandom() * jitterRangeMs);
    return {
        delayMs: Math.max(0, baseDelayMs + jitter),
        jitterApplied: jitter
    };
}

// ── applySizeJitter ────────────────────────────────────────────────
function applySizeJitter(params) {
    const baseSize = _required(params, 'baseSize');
    const jitterPct = (params && typeof params.jitterPct === 'number')
        ? params.jitterPct : DEFAULT_SIZE_JITTER_PCT;

    const multiplier = 1 + (_zeroMeanRandom() * jitterPct);
    const adjustedSize = baseSize * multiplier;
    return {
        size: adjustedSize,
        jitterPctApplied: multiplier - 1
    };
}

// ── selectOrderTypeRandom ──────────────────────────────────────────
function selectOrderTypeRandom(params) {
    const setupType = _required(params, 'setupType');
    const allowedTypes = (params && Array.isArray(params.allowedTypes))
        ? params.allowedTypes
        : ORDER_TYPES;

    // Validate
    for (const t of allowedTypes) {
        if (!ORDER_TYPES.includes(t)) {
            throw new Error(`adversarialMarketAwareness: invalid orderType "${t}"`);
        }
    }

    const idx = Math.floor(Math.random() * allowedTypes.length);
    return {
        setupType,
        orderType: allowedTypes[idx]
    };
}

// ── recordExecution ────────────────────────────────────────────────
function recordExecution(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const setupType = _required(params, 'setupType');
    const entryDelayMs = _required(params, 'entryDelayMs');
    const sizeJitter = _required(params, 'sizeJitter');
    const orderType = _required(params, 'orderType');
    const actualSlippage = _required(params, 'actualSlippage');
    const expectedSlippage = _required(params, 'expectedSlippage');
    const ts = (params && params.ts) ? params.ts : Date.now();

    if (!ORDER_TYPES.includes(orderType)) {
        throw new Error(`adversarialMarketAwareness: invalid orderType "${orderType}"`);
    }

    const excess = actualSlippage - expectedSlippage;

    _stmts.insertObs.run(
        userId, env, setupType,
        entryDelayMs, sizeJitter, orderType,
        actualSlippage, expectedSlippage, excess, ts
    );

    return { recorded: true, excessBps: excess };
}

// ── detectFingerprintCompromise ───────────────────────────────────
function detectFingerprintCompromise(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const setupType = _required(params, 'setupType');
    const lookbackHours = (params && params.lookbackHours) ? params.lookbackHours : 168;  // 7d
    const threshold = (params && typeof params.threshold === 'number')
        ? params.threshold : COMPROMISE_SLIPPAGE_THRESHOLD_BPS;
    const minSamples = (params && params.minSamples)
        ? params.minSamples : MIN_SAMPLES_FOR_COMPROMISE;

    const since = Date.now() - lookbackHours * 3600000;
    const stats = _stmts.statsForSetup.get(userId, env, setupType, since);

    if (!stats || stats.samples < minSamples) {
        return {
            compromised: false,
            reason: 'insufficient_samples',
            samples: stats ? stats.samples : 0
        };
    }

    const trendBps = stats.avg_excess || 0;
    const compromised = trendBps >= threshold;
    const severity = trendBps >= threshold * 2 ? 'critical' : 'warn';

    if (compromised) {
        _stmts.insertAlert.run(
            userId, env, setupType, trendBps,
            stats.samples, severity, Date.now()
        );
    }

    return {
        compromised,
        slippageTrendBps: trendBps,
        samples: stats.samples,
        severity: compromised ? severity : null
    };
}

// ── getFingerprintRisk ─────────────────────────────────────────────
function getFingerprintRisk(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const lookbackDays = (params && params.lookbackDays) ? params.lookbackDays : 30;

    const since = Date.now() - lookbackDays * 86400000;
    const setupTypes = _stmts.allSetups.all(userId, env).map(r => r.setup_type);

    const perSetup = [];
    for (const setupType of setupTypes) {
        const stats = _stmts.statsForSetup.get(userId, env, setupType, since);
        if (stats && stats.samples > 0) {
            perSetup.push({
                setupType,
                samples: stats.samples,
                avgSlippageBps: stats.avg_slippage,
                avgExcessBps: stats.avg_excess,
                atRisk: stats.avg_excess >= COMPROMISE_SLIPPAGE_THRESHOLD_BPS
            });
        }
    }

    return { perSetup };
}

module.exports = {
    ORDER_TYPES,
    SEVERITY_LEVELS,
    DEFAULT_TIMING_JITTER_MS,
    DEFAULT_SIZE_JITTER_PCT,
    COMPROMISE_SLIPPAGE_THRESHOLD_BPS,
    MIN_SAMPLES_FOR_COMPROMISE,
    applyEntryJitter,
    applySizeJitter,
    selectOrderTypeRandom,
    recordExecution,
    detectFingerprintCompromise,
    getFingerprintRisk
};
