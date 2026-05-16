'use strict';

/**
 * OMEGA R5A Learning — teacherStudentDistillation (canonical §89)
 *
 * §89 TEACHER-STUDENT DISTILLATION / LIVE FALLBACK CONSISTENCY LAYER.
 * Source: /root/_review/ml_brain/ml_brain_canonic.txt lines 2335-2368.
 *
 * "Studentul NU este versiune mai slaba si atat. Studentul trebuie auditat
 *  fata de teacher. Divergenta teacher-student = semnal operational si
 *  de model risk."
 *
 * R5A learning. Teacher (heavy/research) vs Student (light/live).
 * Continuous divergence monitoring + fallback escalation.
 *
 * Distinct from §85 computeBudgetGovernor (deadline-aware mode choice).
 * §89 = governs the AUDIT relationship between two models.
 */

const { db } = require('../../database');

const PAIR_STATUSES = Object.freeze([
    'HEALTHY', 'DRIFTING', 'FALLBACK_ACTIVE'
]);
const RECOMMENDATIONS = Object.freeze([
    'CONTINUE', 'MONITOR', 'FALLBACK_TO_TEACHER'
]);

const DEFAULT_DIVERGENCE_THRESHOLD = 0.20;
const FALLBACK_TRIGGER_THRESHOLD = 0.40;
const MIN_OBSERVATIONS_FOR_EVAL = 10;

// ── Helpers ─────────────────────────────────────────────────────────
function _required(params, key) {
    if (!params || params[key] === undefined || params[key] === null) {
        throw new Error(`teacherStudentDistillation: missing ${key}`);
    }
    return params[key];
}

// ── Prepared statements ────────────────────────────────────────────
const _stmts = {
    insertPair: db.prepare(`
        INSERT INTO ml_model_distillation_pairs
        (user_id, resolved_env, pair_id, teacher_model_id, student_model_id,
         regime_scope, divergence_threshold, status, last_validated)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'HEALTHY', ?)
    `),
    getPair: db.prepare(`
        SELECT * FROM ml_model_distillation_pairs WHERE pair_id = ?
    `),
    updatePairStatus: db.prepare(`
        UPDATE ml_model_distillation_pairs
        SET status = ?, last_validated = ?
        WHERE user_id = ? AND resolved_env = ? AND pair_id = ?
    `),
    insertObs: db.prepare(`
        INSERT INTO ml_distillation_observations
        (user_id, resolved_env, observation_id, pair_id, decision_context,
         teacher_output_json, student_output_json, divergence,
         fallback_triggered, ts)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    avgDivergence: db.prepare(`
        SELECT COUNT(*) AS samples,
               AVG(divergence) AS avg_divergence,
               MAX(divergence) AS max_divergence,
               SUM(fallback_triggered) AS fallback_count
        FROM ml_distillation_observations
        WHERE user_id = ? AND resolved_env = ?
          AND pair_id = ?
          AND ts >= ?
    `)
};

// ── computeDivergence (pure) ───────────────────────────────────────
function computeDivergence(params) {
    const teacherOutput = _required(params, 'teacherOutput');
    const studentOutput = _required(params, 'studentOutput');

    const keys = new Set([...Object.keys(teacherOutput), ...Object.keys(studentOutput)]);
    if (keys.size === 0) return 0;

    let totalDiff = 0;
    let count = 0;

    for (const k of keys) {
        const t = teacherOutput[k];
        const s = studentOutput[k];

        if (typeof t === 'number' && typeof s === 'number') {
            const denom = Math.max(Math.abs(t), 1);
            totalDiff += Math.abs(t - s) / denom;
        } else if (t !== s) {
            totalDiff += 1;
        }
        count++;
    }

    return count > 0 ? totalDiff / count : 0;
}

// ── registerModelPair ──────────────────────────────────────────────
function registerModelPair(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const pairId = _required(params, 'pairId');
    const teacherId = _required(params, 'teacherId');
    const studentId = _required(params, 'studentId');
    const regimeScope = (params && params.regimeScope) ? params.regimeScope : 'global';
    const divergenceThreshold = (params && typeof params.divergenceThreshold === 'number')
        ? params.divergenceThreshold : DEFAULT_DIVERGENCE_THRESHOLD;
    const ts = (params && params.ts) ? params.ts : Date.now();

    try {
        _stmts.insertPair.run(
            userId, env, pairId, teacherId, studentId,
            regimeScope, divergenceThreshold, ts
        );
        return { registered: true, pairId };
    } catch (err) {
        if (err.code === 'SQLITE_CONSTRAINT_UNIQUE' ||
            (err.message && err.message.includes('UNIQUE'))) {
            throw new Error(`teacherStudentDistillation: duplicate pairId "${pairId}"`);
        }
        throw err;
    }
}

// ── recordDistillationObservation ──────────────────────────────────
function recordDistillationObservation(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const observationId = _required(params, 'observationId');
    const pairId = _required(params, 'pairId');
    const decisionContext = (params && params.decisionContext) ? params.decisionContext : null;
    const teacherOutput = _required(params, 'teacherOutput');
    const studentOutput = _required(params, 'studentOutput');
    const ts = (params && params.ts) ? params.ts : Date.now();

    const divergence = computeDivergence({ teacherOutput, studentOutput });
    const fallbackTriggered = divergence >= FALLBACK_TRIGGER_THRESHOLD;

    try {
        _stmts.insertObs.run(
            userId, env, observationId, pairId,
            decisionContext,
            JSON.stringify(teacherOutput),
            JSON.stringify(studentOutput),
            divergence,
            fallbackTriggered ? 1 : 0,
            ts
        );
        return { recorded: true, divergence, fallbackTriggered };
    } catch (err) {
        if (err.code === 'SQLITE_CONSTRAINT_UNIQUE' ||
            (err.message && err.message.includes('UNIQUE'))) {
            throw new Error(`teacherStudentDistillation: duplicate observationId "${observationId}"`);
        }
        throw err;
    }
}

// ── evaluateConsistency ────────────────────────────────────────────
function evaluateConsistency(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const pairId = _required(params, 'pairId');
    const lookbackDays = (params && params.lookbackDays) ? params.lookbackDays : 30;
    const ts = (params && params.ts) ? params.ts : Date.now();

    const pair = _stmts.getPair.get(pairId);
    if (!pair) {
        return { sufficient: false, recommendation: 'CONTINUE', reason: 'pair_not_found' };
    }

    const since = Date.now() - lookbackDays * 86400000;
    const row = _stmts.avgDivergence.get(userId, env, pairId, since);

    if (!row || row.samples < MIN_OBSERVATIONS_FOR_EVAL) {
        return {
            sufficient: false,
            recommendation: 'CONTINUE',
            reason: 'insufficient_samples',
            samples: row ? row.samples : 0
        };
    }

    const avgDiv = row.avg_divergence;
    let recommendation;
    let newStatus;

    if (avgDiv >= FALLBACK_TRIGGER_THRESHOLD || row.fallback_count > row.samples * 0.20) {
        recommendation = 'FALLBACK_TO_TEACHER';
        newStatus = 'FALLBACK_ACTIVE';
    } else if (avgDiv >= pair.divergence_threshold) {
        recommendation = 'MONITOR';
        newStatus = 'DRIFTING';
    } else {
        recommendation = 'CONTINUE';
        newStatus = 'HEALTHY';
    }

    if (newStatus !== pair.status) {
        _stmts.updatePairStatus.run(newStatus, ts, userId, env, pairId);
    }

    return {
        sufficient: true,
        recommendation,
        status: newStatus,
        avgDivergence: avgDiv,
        maxDivergence: row.max_divergence,
        samples: row.samples,
        fallbackCount: row.fallback_count
    };
}

// ── triggerFallback ────────────────────────────────────────────────
function triggerFallback(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const pairId = _required(params, 'pairId');
    const ts = (params && params.ts) ? params.ts : Date.now();

    const pair = _stmts.getPair.get(pairId);
    if (!pair) {
        throw new Error(`teacherStudentDistillation: pair "${pairId}" not found`);
    }

    _stmts.updatePairStatus.run('FALLBACK_ACTIVE', ts, userId, env, pairId);
    return { triggered: true, previousStatus: pair.status };
}

// ── getPairStatus ──────────────────────────────────────────────────
function getPairStatus(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const pairId = _required(params, 'pairId');
    const row = _stmts.getPair.get(pairId);
    if (!row) return { exists: false };
    if (row.user_id !== userId || row.resolved_env !== env) {
        return { exists: false };
    }
    return {
        exists: true,
        pairId: row.pair_id,
        teacherModelId: row.teacher_model_id,
        studentModelId: row.student_model_id,
        regimeScope: row.regime_scope,
        divergenceThreshold: row.divergence_threshold,
        status: row.status,
        lastValidated: row.last_validated
    };
}

module.exports = {
    PAIR_STATUSES,
    RECOMMENDATIONS,
    DEFAULT_DIVERGENCE_THRESHOLD,
    FALLBACK_TRIGGER_THRESHOLD,
    MIN_OBSERVATIONS_FOR_EVAL,
    computeDivergence,
    registerModelPair,
    recordDistillationObservation,
    evaluateConsistency,
    triggerFallback,
    getPairStatus
};
