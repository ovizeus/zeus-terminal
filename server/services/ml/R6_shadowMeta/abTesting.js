'use strict';

/**
 * OMEGA R6 Shadow/Meta — abTesting (canonical §33)
 *
 * Canonical PDF §33 A/B TESTING / SHADOW COMPARE / EXPERIMENT CONTROL.
 * Source: /root/_review/ml_brain/ml_brain_canonic.txt lines 1324-1336.
 *
 * Lifecycle:
 *   CREATED → RUNNING → COMPLETED → PROMOTED / ROLLED_BACK
 *
 * Routing: deterministic hash of decision context % 100 vs allocation_pct_b
 * (caller passes context object; we hash a stable canonical form of it).
 *
 * Winner declaration: z-test on 2 proportions (hit rates). Requires
 * MIN_SAMPLES_FOR_DECISION per arm; below that → INSUFFICIENT_DATA.
 *
 * Promotion: uses §19 versionRegistry.activateVersion (atomic — retires
 * previous ACTIVE for that component). Rollback: marks experiment
 * ROLLED_BACK without touching versionRegistry (caller decides whether
 * to rollback active version separately).
 *
 * Isolation modes:
 *   STRICT          — outcomes tracked separately; PnL not aggregated globally
 *   SHARED_CAPITAL  — outcomes aggregate to real PnL (riskier; use small B%)
 */

const crypto = require('crypto');
const { db } = require('../../database');
const versionRegistry = require('../R5B_governance/versionRegistry');

const EXPERIMENT_STATES = Object.freeze([
    'CREATED', 'RUNNING', 'COMPLETED', 'PROMOTED', 'ROLLED_BACK'
]);
const ARMS = Object.freeze(['A', 'B']);
const ISOLATION_MODES = Object.freeze(['STRICT', 'SHARED_CAPITAL']);

const MIN_SAMPLES_FOR_DECISION = 50;
const P_VALUE_THRESHOLD = 0.05;

// ── Helpers ─────────────────────────────────────────────────────────
function _required(params, key) {
    if (!params || params[key] === undefined || params[key] === null) {
        throw new Error(`abTesting: missing ${key}`);
    }
    return params[key];
}

function _canonicalJSON(obj) {
    if (obj === null || typeof obj !== 'object') return JSON.stringify(obj);
    if (Array.isArray(obj)) return '[' + obj.map(_canonicalJSON).join(',') + ']';
    const keys = Object.keys(obj).sort();
    return '{' + keys.map(k => JSON.stringify(k) + ':' + _canonicalJSON(obj[k])).join(',') + '}';
}

function _hashToInt(s) {
    const h = crypto.createHash('sha256').update(s).digest('hex');
    // First 8 hex chars = 32-bit int
    return parseInt(h.slice(0, 8), 16);
}

// Two-proportion z-test (approximate p-value, two-sided)
function _twoPropZTest(winsA, totalA, winsB, totalB) {
    if (totalA === 0 || totalB === 0) return 1;
    const pA = winsA / totalA;
    const pB = winsB / totalB;
    const pPool = (winsA + winsB) / (totalA + totalB);
    const variance = pPool * (1 - pPool) * (1 / totalA + 1 / totalB);
    if (variance <= 0) return 1;
    const z = (pB - pA) / Math.sqrt(variance);
    // Two-sided p-value via Abramowitz & Stegun normal CDF
    return 2 * (1 - _normalCDF(Math.abs(z)));
}

function _normalCDF(x) {
    const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741;
    const a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911;
    const sign = x < 0 ? -1 : 1;
    const ax = Math.abs(x) / Math.sqrt(2);
    const t = 1 / (1 + p * ax);
    const y = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-ax * ax);
    return 0.5 * (1 + sign * y);
}

// ── Prepared statements ────────────────────────────────────────────
const _stmts = {
    insertExp: db.prepare(`
        INSERT INTO ml_experiments
        (name, version_a_id, version_b_id, allocation_pct_b, isolation_mode,
         state, actor, created_at)
        VALUES (?, ?, ?, ?, ?, 'CREATED', ?, ?)
    `),
    getExpById: db.prepare(`SELECT * FROM ml_experiments WHERE id = ?`),
    startExp: db.prepare(`
        UPDATE ml_experiments SET state = 'RUNNING', started_at = ? WHERE id = ?
    `),
    completeExp: db.prepare(`
        UPDATE ml_experiments
        SET state = 'COMPLETED', completed_at = ?, decision_reason = ?
        WHERE id = ?
    `),
    promoteExp: db.prepare(`
        UPDATE ml_experiments
        SET state = 'PROMOTED', decided_at = ?, decided_by = ?,
            decision_reason = ?
        WHERE id = ?
    `),
    insertOutcome: db.prepare(`
        INSERT INTO ml_experiment_outcomes
        (experiment_id, arm, decision_digest, outcome, pnl_pct, recorded_at)
        VALUES (?, ?, ?, ?, ?, ?)
    `),
    aggregateArm: db.prepare(`
        SELECT
            COUNT(*) AS n,
            SUM(CASE WHEN outcome = 'WIN' THEN 1 ELSE 0 END) AS wins,
            AVG(pnl_pct) AS avg_pnl_pct,
            SUM(pnl_pct) AS total_pnl_pct
        FROM ml_experiment_outcomes
        WHERE experiment_id = ? AND arm = ?
    `)
};

// ── createExperiment ───────────────────────────────────────────────
function createExperiment(params) {
    const name = _required(params, 'name');
    const versionAId = _required(params, 'versionAId');
    const versionBId = _required(params, 'versionBId');
    const allocationPctB = _required(params, 'allocationPctB');
    const isolationMode = _required(params, 'isolationMode');
    const actor = _required(params, 'actor');

    if (versionAId === versionBId) {
        throw new Error('createExperiment: versionA and versionB must be different (same/identical)');
    }
    if (allocationPctB < 0 || allocationPctB > 100) {
        throw new Error('createExperiment: allocationPctB must be in 0..100');
    }
    if (!ISOLATION_MODES.includes(isolationMode)) {
        throw new Error(`createExperiment: invalid isolationMode (must be ${ISOLATION_MODES.join('|')})`);
    }

    const result = _stmts.insertExp.run(
        name, versionAId, versionBId, allocationPctB, isolationMode,
        actor, Date.now()
    );
    return { experimentId: result.lastInsertRowid };
}

// ── startExperiment ────────────────────────────────────────────────
function startExperiment(params) {
    const experimentId = _required(params, 'experimentId');
    const actor = _required(params, 'actor');
    const row = _stmts.getExpById.get(experimentId);
    if (!row) throw new Error(`startExperiment: experiment ${experimentId} not found`);
    if (row.state !== 'CREATED') {
        throw new Error(`startExperiment: experiment ${experimentId} state is ${row.state}, must be CREATED`);
    }
    _stmts.startExp.run(Date.now(), experimentId);
    return _stmts.getExpById.get(experimentId);
}

// ── routeDecision ──────────────────────────────────────────────────
function routeDecision(params) {
    const experimentId = _required(params, 'experimentId');
    const decisionContext = _required(params, 'decisionContext');
    const row = _stmts.getExpById.get(experimentId);
    if (!row) throw new Error(`routeDecision: experiment ${experimentId} not found`);
    if (row.state !== 'RUNNING') {
        throw new Error(`routeDecision: experiment ${experimentId} state is ${row.state}, must be RUNNING`);
    }
    const bucket = _hashToInt(_canonicalJSON(decisionContext)) % 100;
    return bucket < row.allocation_pct_b ? 'B' : 'A';
}

// ── recordOutcome ──────────────────────────────────────────────────
function recordOutcome(params) {
    const experimentId = _required(params, 'experimentId');
    const arm = _required(params, 'arm');
    const decisionDigest = _required(params, 'decisionDigest');
    const outcome = _required(params, 'outcome');
    const pnlPct = params.pnlPct !== undefined ? params.pnlPct : null;

    if (!ARMS.includes(arm)) {
        throw new Error(`recordOutcome: invalid arm "${arm}" (must be A or B)`);
    }
    const result = _stmts.insertOutcome.run(
        experimentId, arm, decisionDigest, outcome, pnlPct, Date.now()
    );
    return { outcomeId: result.lastInsertRowid };
}

// ── getExperimentMetrics ───────────────────────────────────────────
function getExperimentMetrics(params) {
    const experimentId = _required(params, 'experimentId');

    const aggA = _stmts.aggregateArm.get(experimentId, 'A');
    const aggB = _stmts.aggregateArm.get(experimentId, 'B');

    const armA = {
        n: aggA.n || 0,
        wins: aggA.wins || 0,
        hit_rate: aggA.n > 0 ? (aggA.wins || 0) / aggA.n : 0,
        avg_pnl_pct: aggA.avg_pnl_pct === null ? 0 : Number(aggA.avg_pnl_pct) || 0,
        total_pnl_pct: aggA.total_pnl_pct === null ? 0 : Number(aggA.total_pnl_pct) || 0
    };
    const armB = {
        n: aggB.n || 0,
        wins: aggB.wins || 0,
        hit_rate: aggB.n > 0 ? (aggB.wins || 0) / aggB.n : 0,
        avg_pnl_pct: aggB.avg_pnl_pct === null ? 0 : Number(aggB.avg_pnl_pct) || 0,
        total_pnl_pct: aggB.total_pnl_pct === null ? 0 : Number(aggB.total_pnl_pct) || 0
    };

    const balanced = Math.abs(armA.n - armB.n) <= Math.max(armA.n, armB.n) * 0.3;
    let winner = 'TIE';
    let pValue = 1;

    if (armA.n < MIN_SAMPLES_FOR_DECISION || armB.n < MIN_SAMPLES_FOR_DECISION) {
        winner = 'INSUFFICIENT_DATA';
    } else {
        pValue = _twoPropZTest(armA.wins, armA.n, armB.wins, armB.n);
        if (pValue < P_VALUE_THRESHOLD) {
            winner = armB.hit_rate > armA.hit_rate ? 'B' : 'A';
        } else {
            winner = 'TIE';
        }
    }

    return {
        arm_a: armA,
        arm_b: armB,
        comparison: {
            n_total: armA.n + armB.n,
            balanced,
            winner,
            hit_rate_lift: armB.hit_rate - armA.hit_rate,
            pnl_lift: armB.avg_pnl_pct - armA.avg_pnl_pct,
            p_value: pValue
        }
    };
}

// ── completeExperiment ─────────────────────────────────────────────
function completeExperiment(params) {
    const experimentId = _required(params, 'experimentId');
    const actor = _required(params, 'actor');
    const reason = params.reason || 'experiment complete';
    const row = _stmts.getExpById.get(experimentId);
    if (!row) throw new Error(`completeExperiment: experiment ${experimentId} not found`);
    if (row.state !== 'RUNNING') {
        throw new Error(`completeExperiment: experiment ${experimentId} state is ${row.state}, must be RUNNING`);
    }
    _stmts.completeExp.run(Date.now(), reason, experimentId);
    return _stmts.getExpById.get(experimentId);
}

// ── promoteWinner ──────────────────────────────────────────────────
function promoteWinner(params) {
    const experimentId = _required(params, 'experimentId');
    const winner = _required(params, 'winner');
    const actor = _required(params, 'actor');

    if (!ARMS.includes(winner)) {
        throw new Error(`promoteWinner: invalid winner "${winner}" (must be A or B)`);
    }
    const row = _stmts.getExpById.get(experimentId);
    if (!row) throw new Error(`promoteWinner: experiment ${experimentId} not found`);
    if (row.state !== 'COMPLETED') {
        throw new Error(`promoteWinner: experiment ${experimentId} state is ${row.state}, must be COMPLETED`);
    }

    const winnerVersionId = winner === 'A' ? row.version_a_id : row.version_b_id;
    versionRegistry.activateVersion({
        id: winnerVersionId,
        motivation: `experiment #${experimentId} winner = ${winner}`,
        actor
    });
    _stmts.promoteExp.run(
        Date.now(), actor,
        `promoted arm ${winner} (version #${winnerVersionId})`,
        experimentId
    );
    return _stmts.getExpById.get(experimentId);
}

module.exports = {
    EXPERIMENT_STATES,
    ARMS,
    ISOLATION_MODES,
    MIN_SAMPLES_FOR_DECISION,
    P_VALUE_THRESHOLD,
    createExperiment,
    startExperiment,
    routeDecision,
    recordOutcome,
    getExperimentMetrics,
    completeExperiment,
    promoteWinner
};
