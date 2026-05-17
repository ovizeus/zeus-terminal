'use strict';

/**
 * OMEGA Doctor D-3.2 — False Positive Auditor.
 *
 * Per FAILURE_ONTOLOGY:
 *   - Every P0/P1 alert receives a verdict post-hoc (set by operator)
 *   - Verdicts: real_incident / false_positive / inconclusive / partial
 *   - Per-module FP rate computed over rolling 30-day window
 *   - Modules with FP rate >= 0.30 are auto-downweighted in alert generation
 *
 * Weighting:
 *   - real_incident → 0.0 (good — alert was correct)
 *   - false_positive → 1.0 (bad — alert was wrong)
 *   - partial → 0.5 (alert was correct but overstated)
 *   - inconclusive → excluded from rate calc (no signal either way)
 *
 * FP rate = sum(weights) / count(verdicted excluding inconclusive)
 */

const { db } = require('../../database');

const FP_RATE_THRESHOLD = 0.30;
const WINDOW_DAYS = 30;
const WINDOW_MS = WINDOW_DAYS * 86400_000;
const VERDICTS = Object.freeze([
    'real_incident', 'false_positive', 'inconclusive', 'partial'
]);

function _required(p, k) {
    if (p == null || p[k] == null) {
        throw new Error(`falsePositiveAuditor: missing required field ${k}`);
    }
    return p[k];
}

const _selectEventStmt = db.prepare(`
    SELECT event_id FROM ml_diagnostic_events WHERE event_id = ?
`);
const _updateVerdictStmt = db.prepare(`
    UPDATE ml_diagnostic_events SET verdict = ? WHERE event_id = ?
`);
const _selectVerdictedStmt = db.prepare(`
    SELECT verdict, COUNT(*) AS n
    FROM ml_diagnostic_events
    WHERE module_id = ? AND ts >= ? AND verdict IS NOT NULL
    GROUP BY verdict
`);
const _totalEventsStmt = db.prepare(`
    SELECT COUNT(*) AS n
    FROM ml_diagnostic_events
    WHERE module_id = ? AND ts >= ?
`);

function setVerdict(params) {
    const eventId = _required(params, 'eventId');
    const verdict = _required(params, 'verdict');
    if (!VERDICTS.includes(verdict)) {
        throw new Error(`falsePositiveAuditor: invalid verdict '${verdict}'`);
    }
    if (!_selectEventStmt.get(eventId)) {
        throw new Error(`falsePositiveAuditor: eventId not found: ${eventId}`);
    }
    _updateVerdictStmt.run(verdict, eventId);
    return { updated: true, eventId, verdict };
}

function computeFPRate(params) {
    const moduleId = _required(params, 'moduleId');
    const nowTs = _required(params, 'nowTs');
    const sinceTs = nowTs - WINDOW_MS;

    const verdictRows = _selectVerdictedStmt.all(moduleId, sinceTs);
    const totalEvents = _totalEventsStmt.get(moduleId, sinceTs).n;

    // Build counts by verdict.
    const counts = { real_incident: 0, false_positive: 0, partial: 0, inconclusive: 0 };
    for (const r of verdictRows) counts[r.verdict] = r.n;

    const verdicted_excl_inconclusive =
        counts.real_incident + counts.false_positive + counts.partial;
    if (verdicted_excl_inconclusive === 0) {
        return { fpRate: null, totalVerdicted: 0, totalEvents };
    }

    const weighted_fp = counts.false_positive * 1.0 + counts.partial * 0.5;
    const fpRate = weighted_fp / verdicted_excl_inconclusive;
    return { fpRate, totalVerdicted: verdicted_excl_inconclusive, totalEvents };
}

function isDownweighted(params) {
    const moduleId = _required(params, 'moduleId');
    const nowTs = _required(params, 'nowTs');
    const { fpRate } = computeFPRate({ moduleId, nowTs });
    if (fpRate === null) return { downweighted: false, fpRate: null };
    return { downweighted: fpRate >= FP_RATE_THRESHOLD, fpRate };
}

const _distinctModulesStmt = db.prepare(`
    SELECT DISTINCT module_id FROM ml_diagnostic_events
    WHERE ts >= ? AND verdict IS NOT NULL
`);

function listDownweightedModules(params) {
    const nowTs = _required(params, 'nowTs');
    const since = nowTs - WINDOW_MS;
    const rows = _distinctModulesStmt.all(since);
    const result = [];
    for (const r of rows) {
        const status = isDownweighted({ moduleId: r.module_id, nowTs });
        if (status.downweighted) {
            result.push({ moduleId: r.module_id, fpRate: status.fpRate });
        }
    }
    return result;
}

function resetForTest() {
    // Stateless module — DB-driven.
}

module.exports = {
    FP_RATE_THRESHOLD, WINDOW_DAYS, VERDICTS,
    setVerdict, computeFPRate, isDownweighted, listDownweightedModules, resetForTest
};
