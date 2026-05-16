'use strict';

/**
 * OMEGA _meta — temporalCommitmentLedger (canonical §139)
 *
 * §139 TEMPORAL COMMITMENT LEDGER / PROMISE-TO-SELF CONSISTENCY ENGINE.
 * Source: /root/_review/ml_brain/ml_brain_canonic.txt lines 4138-4180.
 *
 * "Un sistem matur nu trebuie sa traiasca doar din reactii locale. Trebuie
 *  sa poata face angajamente fata de sine pe un interval de timp si sa fie
 *  judecat daca le respecta sau le incalca fara motiv suficient... un bot
 *  poate adopta un mandat strategic dimineata si il poate trada dupa-amiaza
 *  pentru un setup local atractiv... 'mi-am incalcat propria promisiune
 *  strategica pentru un impuls tactic?'... commitment ledger + commitment
 *  duration + commitment strength + violation detection + justified
 *  override mechanism + cost explicit al incalcarii angajamentului +
 *  historical consistency score."
 *
 * Reguli explicite (canonical):
 * - "angajamentele nu sunt doar note; au efect real asupra dreptului de
 *    actiune"
 * - "orice override trebuie justificat si logat"
 * - "promisiunile strategice nu pot fi rupte ieftin de semnale locale
 *    seducatoare"
 * - "sistemul trebuie sa plateasca epistemic pentru inconsistenta temporala"
 *
 * 6 commitment kinds canonice (din PDF): no_altcoins_until,
 * no_trade_before_event, max_long_exposure, observer_until_regime_clarified,
 * reduced_size_until_reconciliation, custom.
 *
 * Distinct from §130 mindChangeCriteriaEngine (_meta — pre-committed BELIEF
 * reversal criteria), §247 preRegistration (R5B — hypothesis hash-lock),
 * §136 optionPreservationEngine (R3A — single-action cost), §135
 * epistemicHumilityGovernor (_meta — right-to-be-bold aggregator). §139 =
 * action-level commitment ledger with inter-temporal consistency tracking.
 */

const { db } = require('../../database');

const COMMITMENT_KINDS = Object.freeze([
    'no_altcoins_until', 'no_trade_before_event',
    'max_long_exposure', 'observer_until_regime_clarified',
    'reduced_size_until_reconciliation', 'custom'
]);
const STRENGTH_LEVELS = Object.freeze(['soft', 'medium', 'hard']);
const STATUSES = Object.freeze([
    'active', 'fulfilled', 'violated', 'expired'
]);
const VIOLATION_KINDS = Object.freeze([
    'unjustified', 'justified_override', 'partial'
]);

// 3×3 epistemic cost matrix: (violation_kind × strength_level) → cost [0,1]
const EPISTEMIC_COST_MAP = Object.freeze({
    unjustified: Object.freeze({
        soft: 0.20, medium: 0.40, hard: 0.70
    }),
    justified_override: Object.freeze({
        soft: 0.05, medium: 0.15, hard: 0.30
    }),
    partial: Object.freeze({
        soft: 0.10, medium: 0.20, hard: 0.40
    })
});

const MIN_JUSTIFICATION_LENGTH = Object.freeze({
    soft: 10, medium: 30, hard: 80
});

function _required(params, key) {
    if (!params || params[key] === undefined || params[key] === null) {
        throw new Error(`temporalCommitmentLedger: missing ${key}`);
    }
    return params[key];
}

const _stmts = {
    insertCommitment: db.prepare(`
        INSERT INTO ml_temporal_commitments
        (user_id, resolved_env, commitment_id, commitment_kind,
         title, description, parameters_json, strength_level,
         start_ts, expires_ts, status, ts)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    updateCommitmentStatus: db.prepare(`
        UPDATE ml_temporal_commitments
        SET status = ?, ts = ?
        WHERE user_id = ? AND resolved_env = ? AND commitment_id = ?
    `),
    getCommitment: db.prepare(`
        SELECT * FROM ml_temporal_commitments
        WHERE user_id = ? AND resolved_env = ? AND commitment_id = ?
    `),
    listByStatus: db.prepare(`
        SELECT * FROM ml_temporal_commitments
        WHERE user_id = ? AND resolved_env = ? AND status = ?
        ORDER BY ts DESC LIMIT ?
    `),
    countByStatus: db.prepare(`
        SELECT status, COUNT(*) AS cnt
        FROM ml_temporal_commitments
        WHERE user_id = ? AND resolved_env = ? AND ts >= ?
        GROUP BY status
    `),
    insertViolation: db.prepare(`
        INSERT INTO ml_commitment_violations
        (user_id, resolved_env, violation_id, commitment_id,
         violation_kind, override_justification, epistemic_cost, ts)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `)
};

// ── computeEpistemicCost (pure) ────────────────────────────────────
function computeEpistemicCost(params) {
    const vk = _required(params, 'violationKind');
    const sl = _required(params, 'strengthLevel');
    if (!VIOLATION_KINDS.includes(vk)) {
        throw new Error(
            `temporalCommitmentLedger: invalid violationKind "${vk}"`
        );
    }
    if (!STRENGTH_LEVELS.includes(sl)) {
        throw new Error(
            `temporalCommitmentLedger: invalid strengthLevel "${sl}"`
        );
    }
    return { epistemicCost: EPISTEMIC_COST_MAP[vk][sl] };
}

// ── assessOverrideJustification (pure) ─────────────────────────────
function assessOverrideJustification(params) {
    const text = (params && params.justificationText !== undefined &&
                  params.justificationText !== null)
        ? params.justificationText : '';
    const sl = _required(params, 'strengthLevel');
    if (!STRENGTH_LEVELS.includes(sl)) {
        throw new Error(
            `temporalCommitmentLedger: invalid strengthLevel "${sl}"`
        );
    }
    const minLen = MIN_JUSTIFICATION_LENGTH[sl];
    return {
        sufficient: text.length >= minLen,
        actualLength: text.length,
        requiredLength: minLen
    };
}

// ── isExpired (pure) ───────────────────────────────────────────────
function isExpired(params) {
    const expiresTs = params && params.expiresTs;
    const currentTs = _required(params, 'currentTs');
    if (expiresTs === null || expiresTs === undefined) {
        return { expired: false };
    }
    return { expired: expiresTs <= currentTs };
}

// ── computeConsistencyScore (pure) ─────────────────────────────────
// fulfilled / (fulfilled + violated); 0/0 → 1.0 (no inconsistency)
function computeConsistencyScore(params) {
    const fulfilled = _required(params, 'fulfilledCount');
    const violated = _required(params, 'violatedCount');
    if (fulfilled < 0 || violated < 0) {
        throw new Error(
            'temporalCommitmentLedger: counts must be non-negative'
        );
    }
    const total = fulfilled + violated;
    if (total === 0) return { consistencyScore: 1.0 };
    return { consistencyScore: fulfilled / total };
}

// ── registerCommitment ─────────────────────────────────────────────
function registerCommitment(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const commitmentId = _required(params, 'commitmentId');
    const kind = _required(params, 'commitmentKind');
    const title = _required(params, 'title');
    const description = _required(params, 'description');
    const parameters = _required(params, 'parameters');
    const strength = _required(params, 'strengthLevel');
    const startTs = _required(params, 'startTs');
    const expiresTs = (params && params.expiresTs !== undefined &&
                       params.expiresTs !== null)
        ? params.expiresTs : null;
    const ts = (params && params.ts) ? params.ts : Date.now();

    if (!COMMITMENT_KINDS.includes(kind)) {
        throw new Error(
            `temporalCommitmentLedger: invalid commitmentKind "${kind}"`
        );
    }
    if (!STRENGTH_LEVELS.includes(strength)) {
        throw new Error(
            `temporalCommitmentLedger: invalid strengthLevel "${strength}"`
        );
    }
    try {
        _stmts.insertCommitment.run(
            userId, env, commitmentId, kind, title, description,
            JSON.stringify(parameters), strength,
            startTs, expiresTs, 'active', ts
        );
        return {
            registered: true, commitmentId,
            status: 'active'
        };
    } catch (err) {
        if (err.code === 'SQLITE_CONSTRAINT_UNIQUE' ||
            (err.message && err.message.includes('UNIQUE'))) {
            throw new Error(
                `temporalCommitmentLedger: duplicate commitmentId "${commitmentId}"`
            );
        }
        throw err;
    }
}

// ── recordViolation ────────────────────────────────────────────────
function recordViolation(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const violationId = _required(params, 'violationId');
    const commitmentId = _required(params, 'commitmentId');
    const violationKind = _required(params, 'violationKind');
    const justification = (params && params.overrideJustification !== undefined &&
                            params.overrideJustification !== null)
        ? params.overrideJustification : '';
    const ts = (params && params.ts) ? params.ts : Date.now();

    if (!VIOLATION_KINDS.includes(violationKind)) {
        throw new Error(
            `temporalCommitmentLedger: invalid violationKind "${violationKind}"`
        );
    }

    const commitment = _stmts.getCommitment.get(userId, env, commitmentId);
    if (!commitment) {
        throw new Error(
            `temporalCommitmentLedger: commitment not found "${commitmentId}"`
        );
    }

    // For justified_override, require sufficient justification per strength
    if (violationKind === 'justified_override') {
        const check = assessOverrideJustification({
            justificationText: justification,
            strengthLevel: commitment.strength_level
        });
        if (!check.sufficient) {
            throw new Error(
                `temporalCommitmentLedger: insufficient justification ` +
                `(${check.actualLength} < ${check.requiredLength} chars for ${commitment.strength_level} strength)`
            );
        }
    }

    const { epistemicCost } = computeEpistemicCost({
        violationKind, strengthLevel: commitment.strength_level
    });

    try {
        _stmts.insertViolation.run(
            userId, env, violationId, commitmentId,
            violationKind, justification, epistemicCost, ts
        );
    } catch (err) {
        if (err.code === 'SQLITE_CONSTRAINT_UNIQUE' ||
            (err.message && err.message.includes('UNIQUE'))) {
            throw new Error(
                `temporalCommitmentLedger: duplicate violationId "${violationId}"`
            );
        }
        throw err;
    }

    // Update commitment status to 'violated'
    _stmts.updateCommitmentStatus.run(
        'violated', ts, userId, env, commitmentId
    );

    return {
        recorded: true, violationId,
        violationKind,
        epistemicCost
    };
}

// ── fulfillCommitment ──────────────────────────────────────────────
function fulfillCommitment(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const commitmentId = _required(params, 'commitmentId');
    const ts = (params && params.ts) ? params.ts : Date.now();

    const commitment = _stmts.getCommitment.get(userId, env, commitmentId);
    if (!commitment) {
        throw new Error(
            `temporalCommitmentLedger: commitment not found "${commitmentId}"`
        );
    }
    if (commitment.status !== 'active') {
        throw new Error(
            `temporalCommitmentLedger: commitment "${commitmentId}" is not active (status: ${commitment.status}; already terminal)`
        );
    }

    _stmts.updateCommitmentStatus.run(
        'fulfilled', ts, userId, env, commitmentId
    );
    return { fulfilled: true, commitmentId };
}

// ── expireCommitment ───────────────────────────────────────────────
function expireCommitment(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const commitmentId = _required(params, 'commitmentId');
    const ts = (params && params.ts) ? params.ts : Date.now();

    const commitment = _stmts.getCommitment.get(userId, env, commitmentId);
    if (!commitment) {
        throw new Error(
            `temporalCommitmentLedger: commitment not found "${commitmentId}"`
        );
    }
    if (commitment.expires_ts === null || commitment.expires_ts === undefined) {
        throw new Error(
            `temporalCommitmentLedger: commitment "${commitmentId}" has no expires_ts (permanent)`
        );
    }
    if (commitment.expires_ts > ts) {
        throw new Error(
            `temporalCommitmentLedger: commitment "${commitmentId}" not yet expired (expires_ts=${commitment.expires_ts} > currentTs=${ts})`
        );
    }
    if (commitment.status !== 'active') {
        throw new Error(
            `temporalCommitmentLedger: commitment "${commitmentId}" is not active (status: ${commitment.status})`
        );
    }

    _stmts.updateCommitmentStatus.run(
        'expired', ts, userId, env, commitmentId
    );
    return { expired: true, commitmentId };
}

function _rowToCommitment(r) {
    return {
        commitmentId: r.commitment_id,
        commitmentKind: r.commitment_kind,
        title: r.title,
        description: r.description,
        parameters: JSON.parse(r.parameters_json),
        strengthLevel: r.strength_level,
        startTs: r.start_ts,
        expiresTs: r.expires_ts,
        status: r.status,
        ts: r.ts
    };
}

// ── getActiveCommitments ───────────────────────────────────────────
function getActiveCommitments(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const limit = (params && params.limit) ? params.limit : 100;
    const rows = _stmts.listByStatus.all(userId, env, 'active', limit);
    return rows.map(_rowToCommitment);
}

// ── getCommitmentById ──────────────────────────────────────────────
function getCommitmentById(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const commitmentId = _required(params, 'commitmentId');
    const r = _stmts.getCommitment.get(userId, env, commitmentId);
    if (!r) return null;
    return _rowToCommitment(r);
}

// ── getConsistencyScore ────────────────────────────────────────────
function getConsistencyScore(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const sinceTs = (params && params.sinceTs !== undefined)
        ? params.sinceTs : 0;
    const rows = _stmts.countByStatus.all(userId, env, sinceTs);
    let fulfilledCount = 0, violatedCount = 0;
    for (const r of rows) {
        if (r.status === 'fulfilled') fulfilledCount = r.cnt;
        else if (r.status === 'violated') violatedCount = r.cnt;
    }
    const { consistencyScore } = computeConsistencyScore({
        fulfilledCount, violatedCount
    });
    return { consistencyScore, fulfilledCount, violatedCount };
}

module.exports = {
    COMMITMENT_KINDS,
    STRENGTH_LEVELS,
    STATUSES,
    VIOLATION_KINDS,
    EPISTEMIC_COST_MAP,
    MIN_JUSTIFICATION_LENGTH,
    computeEpistemicCost,
    assessOverrideJustification,
    isExpired,
    computeConsistencyScore,
    registerCommitment,
    recordViolation,
    fulfillCommitment,
    expireCommitment,
    getActiveCommitments,
    getCommitmentById,
    getConsistencyScore
};
