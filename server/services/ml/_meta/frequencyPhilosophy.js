'use strict';

/**
 * OMEGA Meta — frequencyPhilosophy (canonical §37)
 *
 * §37 FILOZOFIA CORECTA DE FRECVENTA.
 * Source: /root/_review/ml_brain/ml_brain_canonic.txt lines 1416-1445.
 *
 * Principle (line 1419): "regimul pietei decide frecventa"
 *
 * 4 modes per spec:
 *   SNIPER   — intrari rare / RR mare / runner + piramidare permise
 *   SCALP    — intrari dese controlate / TP rapid / fara runner
 *   OBSERVER — zero intrari / "stai pe maini"
 *   ADAPTIVE — size redus / confirmare mai dura / iesiri rapide
 *
 * Regime → mode recommendation:
 *   trend     → SNIPER  (clear directionality, big RR available)
 *   range     → SCALP   (mean-reversion, small repeatable edge)
 *   chop      → ADAPTIVE (noisy, harder confirmation)
 *   squeeze   → ADAPTIVE (wait for break, then adapt)
 *   news      → OBSERVER (avoid chaos)
 *   high_vol  → OBSERVER (dangerous)
 *   low_vol   → SCALP    (extract small consistent edge)
 *
 * First OMEGA module in _meta/ directory.
 * Cross-cutting: consumed by §14 veto, §15 confidence, §23 TCA, §30 portfolio.
 */

const { db } = require('../../database');

const FREQUENCY_MODES = Object.freeze(['SNIPER', 'SCALP', 'OBSERVER', 'ADAPTIVE']);

const MODE_CONFIGS = Object.freeze({
    SNIPER: {
        rrMin: 2.5,                  // high RR
        runnerAllowed: true,         // line 1425
        pyramidingAllowed: true,     // line 1426
        tpStyle: 'extended',         // RR target plus runner
        sizingMultiplier: 1.0,       // full size on confirmation
        confirmationStrictness: 0.85,
        entriesAllowed: true,
        description: 'Rare entries, hard confirmation, big profits'
    },
    SCALP: {
        rrMin: 1.2,
        runnerAllowed: false,        // line 1432
        pyramidingAllowed: false,
        tpStyle: 'fast',             // line 1431
        sizingMultiplier: 0.5,       // smaller per-trade size, more trades
        confirmationStrictness: 0.55,
        entriesAllowed: true,
        description: 'Frequent controlled entries, fast TP, no runner'
    },
    OBSERVER: {
        rrMin: 999,                  // effectively no entries
        runnerAllowed: false,
        pyramidingAllowed: false,
        tpStyle: 'none',
        sizingMultiplier: 0,         // line 1437 zero entries
        confirmationStrictness: 1.0,
        entriesAllowed: false,
        description: 'Zero entries — "cea mai mare forma de inteligenta este sa stai pe maini"'
    },
    ADAPTIVE: {
        rrMin: 1.8,
        runnerAllowed: false,
        pyramidingAllowed: false,
        tpStyle: 'tight',            // line 1444
        sizingMultiplier: 0.4,       // line 1441 size redus
        confirmationStrictness: 0.75, // line 1443 confirmare mai dura
        entriesAllowed: true,
        description: 'Reduced size, harder confirmation, faster exits'
    }
});

const REGIME_TO_MODE_MAP = Object.freeze({
    trend:    'SNIPER',
    range:    'SCALP',
    chop:     'ADAPTIVE',
    squeeze:  'ADAPTIVE',
    news:     'OBSERVER',
    high_vol: 'OBSERVER',
    low_vol:  'SCALP'
});

const REGIME_REASONS = Object.freeze({
    trend:    'Clear directionality + large RR available — SNIPER mode',
    range:    'Mean-reversion edge available — SCALP mode',
    chop:     'Noisy regime requires harder confirmation — ADAPTIVE',
    squeeze:  'Pre-breakout regime — wait for clarity, ADAPTIVE',
    news:     'Event-driven chaos — OBSERVER, hands off',
    high_vol: 'Dangerous volatility — OBSERVER safest',
    low_vol:  'Small repeatable edge — SCALP extracts edge'
});

// ── Helpers ─────────────────────────────────────────────────────────
function _required(params, key) {
    if (!params || params[key] === undefined || params[key] === null) {
        throw new Error(`frequencyPhilosophy: missing ${key}`);
    }
    return params[key];
}

function _validateMode(mode) {
    if (!FREQUENCY_MODES.includes(mode)) {
        throw new Error(`frequencyPhilosophy: invalid mode "${mode}"`);
    }
}

// ── Prepared statements ────────────────────────────────────────────
const _stmts = {
    getState: db.prepare(`
        SELECT * FROM ml_frequency_mode_state
        WHERE user_id = ? AND resolved_env = ?
    `),
    upsertState: db.prepare(`
        INSERT INTO ml_frequency_mode_state
        (user_id, resolved_env, mode, since, reason, actor, regime, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(user_id, resolved_env) DO UPDATE SET
            mode = excluded.mode,
            since = CASE
                WHEN ml_frequency_mode_state.mode != excluded.mode THEN excluded.since
                ELSE ml_frequency_mode_state.since
            END,
            reason = excluded.reason,
            actor = excluded.actor,
            regime = excluded.regime,
            updated_at = excluded.updated_at
    `),
    insertTransition: db.prepare(`
        INSERT INTO ml_frequency_mode_transitions
        (user_id, resolved_env, from_mode, to_mode, reason, actor, regime, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `),
    listTransitions: db.prepare(`
        SELECT * FROM ml_frequency_mode_transitions
        WHERE user_id = ? AND resolved_env = ?
        ORDER BY created_at ASC, id ASC
        LIMIT ?
    `)
};

// ── getCurrentMode ─────────────────────────────────────────────────
function getCurrentMode(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const row = _stmts.getState.get(userId, env);
    if (!row) {
        return {
            mode: 'OBSERVER',  // safe default
            exists: false,
            since: null,
            reason: null
        };
    }
    return {
        mode: row.mode,
        exists: true,
        since: row.since,
        reason: row.reason,
        actor: row.actor,
        regime: row.regime
    };
}

// ── setMode ────────────────────────────────────────────────────────
function setMode(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const mode = _required(params, 'mode');
    const reason = _required(params, 'reason');
    const actor = _required(params, 'actor');
    const regime = (params && params.regime) ? params.regime : null;

    _validateMode(mode);

    const now = Date.now();
    const prior = _stmts.getState.get(userId, env);
    const fromMode = prior ? prior.mode : null;

    _stmts.upsertState.run(userId, env, mode, now, reason, actor, regime, now, now);
    _stmts.insertTransition.run(userId, env, fromMode, mode, reason, actor, regime, now);

    return { mode, fromMode };
}

// ── getRegimeRecommendation (pure) ─────────────────────────────────
function getRegimeRecommendation(params) {
    const regime = (params && params.regime) ? params.regime : 'unknown';
    const recommendedMode = REGIME_TO_MODE_MAP[regime] || 'ADAPTIVE';
    const reason = REGIME_REASONS[regime] || `Unknown regime "${regime}" — conservative ADAPTIVE default`;

    return {
        regime,
        recommendedMode,
        reason,
        config: MODE_CONFIGS[recommendedMode]
    };
}

// ── getModeConfig (pure) ───────────────────────────────────────────
function getModeConfig(params) {
    const mode = _required(params, 'mode');
    _validateMode(mode);
    return { ...MODE_CONFIGS[mode] };
}

// ── getModeHistory ─────────────────────────────────────────────────
function getModeHistory(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const limit = (params && params.limit) ? params.limit : 100;
    const rows = _stmts.listTransitions.all(userId, env, limit);
    return rows.map(r => ({
        id: r.id,
        fromMode: r.from_mode,
        toMode: r.to_mode,
        reason: r.reason,
        actor: r.actor,
        regime: r.regime,
        createdAt: r.created_at
    }));
}

module.exports = {
    FREQUENCY_MODES,
    MODE_CONFIGS,
    REGIME_TO_MODE_MAP,
    REGIME_REASONS,
    getCurrentMode,
    setMode,
    getRegimeRecommendation,
    getModeConfig,
    getModeHistory
};
