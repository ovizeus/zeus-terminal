'use strict';

/**
 * OMEGA R3B Numerical Rules — thresholdRegistry (canonical §36)
 *
 * §36 REGULI NUMERICE SI PRAGURI CONCRETE.
 * Source: /root/_review/ml_brain/ml_brain_canonic.txt lines 1390-1410.
 *
 * "Spec-ul final trebuie sa contina, separat de aceasta arhitectura"
 *
 * 17 threshold categories (lines 1391-1407):
 *   meta_score / rr / max_risk_per_trade / max_daily_loss /
 *   max_weekly_dd / max_leverage_per_regime / funding_sigma /
 *   oi_sigma / latency / api_rate / drift / confidence_bucket /
 *   auto_pause / observer_activation / adaptive_mode /
 *   min_probability_entry / capital_allocation_cap
 *
 * INVARIANT (lines 1409-1410):
 *   "Aceste valori nu trebuie lasate vagi in implementare.
 *    Trebuie definite explicit."
 *   → DEFAULT_THRESHOLDS provides concrete value for EVERY category.
 *   → validateAllSet() reports any missing.
 *
 * Resolution chain (highest-precedence first):
 *   1. regime-specific override (per user × env × regime)
 *   2. general override (per user × env, regime=NULL)
 *   3. canonical default (pre-populated)
 *
 * First OMEGA module in R3B numerical_rules/ layer.
 */

const { db } = require('../../database');

const THRESHOLD_CATEGORIES = Object.freeze([
    'meta_score',
    'rr',
    'max_risk_per_trade',
    'max_daily_loss',
    'max_weekly_dd',
    'max_leverage_per_regime',
    'funding_sigma',
    'oi_sigma',
    'latency',
    'api_rate',
    'drift',
    'confidence_bucket',
    'auto_pause',
    'observer_activation',
    'adaptive_mode',
    'min_probability_entry',
    'capital_allocation_cap'
]);

// DEFAULT_THRESHOLDS — concrete values per category (NOT VAGUE per line 1409-1410).
const DEFAULT_THRESHOLDS = Object.freeze({
    meta_score:               0.65,    // minimum meta-score to enter
    rr:                       1.5,     // minimum reward-to-risk ratio
    max_risk_per_trade:       0.02,    // 2% balance max per trade
    max_daily_loss:           0.05,    // 5% daily loss circuit
    max_weekly_dd:            0.10,    // 10% weekly drawdown limit
    max_leverage_per_regime:  5.0,     // 5× max leverage
    funding_sigma:            2.5,     // 2.5σ funding rate deviation alert
    oi_sigma:                 3.0,     // 3σ OI deviation alert
    latency:                  500,     // 500ms latency threshold (ms)
    api_rate:                 100,     // 100 req/min API budget
    drift:                    0.15,    // 15% PSI drift threshold
    confidence_bucket:        0.55,    // 55% confidence bucket cutoff
    auto_pause:               0.03,    // 3% intraday DD → auto-pause
    observer_activation:      0.40,    // confidence below 40% → observer
    adaptive_mode:            0.70,    // confidence above 70% → adaptive scaling
    min_probability_entry:    0.50,    // 50% minimum probability for entry
    capital_allocation_cap:   0.50     // 50% balance max in concurrent positions
});

// ── Helpers ─────────────────────────────────────────────────────────
function _required(params, key) {
    if (!params || params[key] === undefined || params[key] === null) {
        throw new Error(`thresholdRegistry: missing ${key}`);
    }
    return params[key];
}

// ── Prepared statements ────────────────────────────────────────────
const _stmts = {
    getCanonical: db.prepare(`
        SELECT * FROM ml_thresholds_canonical WHERE name = ?
    `),
    insertCanonical: db.prepare(`
        INSERT INTO ml_thresholds_canonical
        (name, category, default_value, description, version, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    `),
    listCanonicalAll: db.prepare(`
        SELECT * FROM ml_thresholds_canonical ORDER BY category ASC, name ASC
    `),
    listCanonicalByCategory: db.prepare(`
        SELECT * FROM ml_thresholds_canonical WHERE category = ? ORDER BY name ASC
    `),
    insertOverride: db.prepare(`
        INSERT INTO ml_threshold_overrides
        (user_id, resolved_env, threshold_name, value, regime, reason, actor, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `),
    deleteOverride: db.prepare(`
        DELETE FROM ml_threshold_overrides
        WHERE user_id = ? AND resolved_env = ? AND threshold_name = ?
          AND (regime IS NULL AND ? IS NULL OR regime = ?)
    `),
    selectOverrideRegime: db.prepare(`
        SELECT * FROM ml_threshold_overrides
        WHERE user_id = ? AND resolved_env = ?
          AND threshold_name = ? AND regime = ?
        ORDER BY created_at DESC, id DESC LIMIT 1
    `),
    selectOverrideGeneral: db.prepare(`
        SELECT * FROM ml_threshold_overrides
        WHERE user_id = ? AND resolved_env = ?
          AND threshold_name = ? AND regime IS NULL
        ORDER BY created_at DESC, id DESC LIMIT 1
    `)
};

// ── registerThreshold ──────────────────────────────────────────────
function registerThreshold(params) {
    const name = _required(params, 'name');
    const category = _required(params, 'category');
    const defaultValue = _required(params, 'defaultValue');
    const description = (params && params.description) ? params.description : '';
    const version = (params && params.version) ? params.version : 'v1.0';

    if (!THRESHOLD_CATEGORIES.includes(category)) {
        throw new Error(`thresholdRegistry: invalid category "${category}"`);
    }
    if (typeof defaultValue !== 'number' || !Number.isFinite(defaultValue)) {
        throw new Error(`thresholdRegistry: defaultValue must be a finite number`);
    }

    const now = Date.now();
    _stmts.insertCanonical.run(name, category, defaultValue, description, version, now, now);

    return { registered: true, name, defaultValue };
}

// ── Bootstrap defaults on module load ──────────────────────────────
function _bootstrapDefaults() {
    for (const cat of THRESHOLD_CATEGORIES) {
        const existing = _stmts.getCanonical.get(cat);
        if (!existing) {
            const now = Date.now();
            _stmts.insertCanonical.run(
                cat, cat, DEFAULT_THRESHOLDS[cat],
                `OMEGA canonical default for ${cat} (line ${1391 + THRESHOLD_CATEGORIES.indexOf(cat)})`,
                'v1.0', now, now
            );
        }
    }
}

// Run bootstrap (idempotent)
_bootstrapDefaults();

// ── getThreshold ───────────────────────────────────────────────────
function getThreshold(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const name = _required(params, 'name');
    const regime = (params && params.regime) ? params.regime : null;

    // 1. Regime-specific override
    if (regime) {
        const regimeOverride = _stmts.selectOverrideRegime.get(userId, env, name, regime);
        if (regimeOverride) {
            return {
                value: regimeOverride.value,
                source: 'override-regime',
                regime,
                lastUpdated: regimeOverride.created_at
            };
        }
    }

    // 2. General override
    const generalOverride = _stmts.selectOverrideGeneral.get(userId, env, name);
    if (generalOverride) {
        return {
            value: generalOverride.value,
            source: 'override',
            regime: null,
            lastUpdated: generalOverride.created_at
        };
    }

    // 3. Canonical default
    const canonical = _stmts.getCanonical.get(name);
    if (!canonical) {
        return { value: null, source: 'not_found' };
    }
    return {
        value: canonical.default_value,
        source: 'canonical',
        category: canonical.category,
        description: canonical.description,
        version: canonical.version
    };
}

// ── setOverride ────────────────────────────────────────────────────
function setOverride(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const name = _required(params, 'name');
    const value = _required(params, 'value');
    const reason = _required(params, 'reason');
    const actor = _required(params, 'actor');
    const regime = (params && params.regime) ? params.regime : null;

    // Verify threshold exists
    const canonical = _stmts.getCanonical.get(name);
    if (!canonical) {
        throw new Error(`thresholdRegistry: threshold "${name}" not registered`);
    }

    // Replace prior override (same user × env × name × regime)
    _stmts.deleteOverride.run(userId, env, name, regime, regime);
    _stmts.insertOverride.run(
        userId, env, name, value, regime,
        reason, actor, Date.now()
    );

    return { setOverride: true, name, value, regime };
}

// ── clearOverride ──────────────────────────────────────────────────
function clearOverride(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const name = _required(params, 'name');
    const reason = (params && params.reason) ? params.reason : 'cleared';
    const actor = (params && params.actor) ? params.actor : 'operator';
    const regime = (params && params.regime) ? params.regime : null;

    const result = _stmts.deleteOverride.run(userId, env, name, regime, regime);
    void reason;
    void actor;

    return { cleared: result.changes > 0, name, regime };
}

// ── listThresholds ─────────────────────────────────────────────────
function listThresholds(params) {
    const filter = params || {};
    let rows;
    if (filter.category) {
        rows = _stmts.listCanonicalByCategory.all(filter.category);
    } else {
        rows = _stmts.listCanonicalAll.all();
    }
    return rows.map(r => ({
        name: r.name,
        category: r.category,
        defaultValue: r.default_value,
        description: r.description,
        version: r.version
    }));
}

// ── validateAllSet — INVARIANT line 1409-1410 ──────────────────────
function validateAllSet() {
    const missing = [];
    for (const cat of THRESHOLD_CATEGORIES) {
        const row = _stmts.getCanonical.get(cat);
        if (!row || row.default_value === null || row.default_value === undefined
            || !Number.isFinite(row.default_value)) {
            missing.push(cat);
        }
    }
    return {
        allSet: missing.length === 0,
        missing,
        totalCategories: THRESHOLD_CATEGORIES.length,
        definedCategories: THRESHOLD_CATEGORIES.length - missing.length
    };
}

module.exports = {
    THRESHOLD_CATEGORIES,
    DEFAULT_THRESHOLDS,
    registerThreshold,
    getThreshold,
    setOverride,
    clearOverride,
    listThresholds,
    validateAllSet
};
