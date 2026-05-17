'use strict';

/**
 * OMEGA Doctor D-5.4 — Override Journal.
 *
 * Per Phone Claude proposal #6: when operator forces an action different from
 * Doctor's recommendation, log the disagreement + reason + outcome. This is
 * the supervised-learning signal for Doctor calibration:
 *
 *   - If operator was consistently RIGHT (doctor_was_wrong) → reduce Doctor's
 *     confidence in that pattern; refine quarantine rules.
 *   - If operator was consistently WRONG (doctor_was_right) → operator should
 *     trust Doctor more; this is feedback for the operator, not the system.
 *
 * Operator accuracy is computed per-operator over rolling 90d window.
 *
 * No automatic blocking — operator always wins the decision. Journal exists
 * for post-hoc analysis only.
 */

const { db } = require('../../database');

const OUTCOME_VERDICTS = Object.freeze([
    'doctor_was_right', 'operator_was_right', 'inconclusive', 'partial'
]);
const WINDOW_DAYS = 90;
const WINDOW_MS = WINDOW_DAYS * 86400_000;

function _required(p, k) {
    if (p == null || p[k] == null) {
        throw new Error(`overrideJournal: missing required field ${k}`);
    }
    return p[k];
}

const _stmts = {
    insert: db.prepare(`
        INSERT INTO ml_doctor_override_journal
        (module_id, doctor_recommended_action, operator_forced_action,
         operator_reason, operator_id, decided_at, ts)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    `),
    selectById: db.prepare(`SELECT * FROM ml_doctor_override_journal WHERE id = ?`),
    updateVerdict: db.prepare(`
        UPDATE ml_doctor_override_journal SET outcome_verdict = ? WHERE id = ?
    `),
    selectVerdictsForOperator: db.prepare(`
        SELECT outcome_verdict, COUNT(*) AS n
        FROM ml_doctor_override_journal
        WHERE operator_id = ? AND ts >= ? AND outcome_verdict IS NOT NULL
        GROUP BY outcome_verdict
    `),
    selectRecent: db.prepare(`
        SELECT id, module_id, doctor_recommended_action, operator_forced_action,
               operator_reason, operator_id, outcome_verdict, decided_at, ts
        FROM ml_doctor_override_journal
        ORDER BY ts DESC LIMIT ?
    `)
};

function recordOverride(params) {
    const moduleId = _required(params, 'moduleId');
    const doctorRecommendedAction = _required(params, 'doctorRecommendedAction');
    const operatorForcedAction = _required(params, 'operatorForcedAction');
    const operatorReason = _required(params, 'operatorReason');
    const operatorId = _required(params, 'operatorId');
    const ts = _required(params, 'ts');

    const result = _stmts.insert.run(
        moduleId, doctorRecommendedAction, operatorForcedAction,
        operatorReason, operatorId, ts, ts
    );
    return { recorded: true, id: result.lastInsertRowid };
}

function setOutcomeVerdict(params) {
    const id = _required(params, 'id');
    const outcomeVerdict = _required(params, 'outcomeVerdict');

    if (!OUTCOME_VERDICTS.includes(outcomeVerdict)) {
        throw new Error(`overrideJournal: invalid outcomeVerdict '${outcomeVerdict}'`);
    }
    if (!_stmts.selectById.get(id)) {
        throw new Error(`overrideJournal: id ${id} not found`);
    }

    _stmts.updateVerdict.run(outcomeVerdict, id);
    return { updated: true, id, outcomeVerdict };
}

function computeOverrideAccuracy(params) {
    const operatorId = _required(params, 'operatorId');
    const nowTs = _required(params, 'nowTs');
    const sinceTs = nowTs - WINDOW_MS;

    const rows = _stmts.selectVerdictsForOperator.all(operatorId, sinceTs);

    const counts = {
        doctor_was_right: 0,
        operator_was_right: 0,
        inconclusive: 0,
        partial: 0
    };
    for (const r of rows) counts[r.outcome_verdict] = r.n;

    const verdicted_excl_inconclusive =
        counts.doctor_was_right + counts.operator_was_right + counts.partial;
    if (verdicted_excl_inconclusive === 0) {
        return { operatorAccuracy: null, totalVerdicted: 0 };
    }

    // operator accuracy = (operator_was_right + 0.5*partial) / total
    const weighted = counts.operator_was_right * 1.0 + counts.partial * 0.5;
    const accuracy = weighted / verdicted_excl_inconclusive;
    return { operatorAccuracy: accuracy, totalVerdicted: verdicted_excl_inconclusive };
}

function listRecentOverrides(params) {
    const limit = _required(params, 'limit');
    const rows = _stmts.selectRecent.all(limit);
    return rows.map(r => ({
        id: r.id,
        moduleId: r.module_id,
        doctorRecommendedAction: r.doctor_recommended_action,
        operatorForcedAction: r.operator_forced_action,
        operatorReason: r.operator_reason,
        operatorId: r.operator_id,
        outcomeVerdict: r.outcome_verdict,
        decidedAt: r.decided_at,
        ts: r.ts
    }));
}

function resetForTest() {
    // Stateless module — DB-driven.
}

module.exports = {
    OUTCOME_VERDICTS, WINDOW_DAYS,
    recordOverride, setOutcomeVerdict,
    computeOverrideAccuracy, listRecentOverrides,
    resetForTest
};
