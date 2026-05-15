'use strict';

/**
 * OMEGA R5B Governance — preRegistration (§247* Claude-extras)
 *
 * §247* HYPOTHESIS PRE-REGISTRATION = anti-p-hacking discipline.
 * Source: project_ml_brain_pro_244.md "247* (R6 + R5) — anti-p-hacking,
 * pre-registered analysis plan". Claude-extras approved 2026-04-29,
 * NOT in canonical PDF.
 *
 * Why: p-hacking = look at data, retroactively pick success criteria that
 * make results "look good." Real-world ML self-deception. Solution: register
 * hypothesis + predicted metrics + success criteria + eval window BEFORE
 * any data is seen. Hash the package. Once REGISTERED, content is immutable.
 *
 * State lifecycle:
 *   REGISTERED → EVALUATING (window opens) → PASS / FAIL / INVALID
 *
 * Hard invariants (enforced):
 *   - Only ONE REGISTERED per version_id at a time
 *   - Registration content (hypothesis+predicted+criteria+window) hashed
 *     at creation; field updates after registration would change the hash
 *     and be detectable
 *   - evaluate() blocks until eval_window_to <= now (no early peek-cheat)
 *   - Terminal states (PASS/FAIL/INVALID) cannot accept further changes
 *
 * Success criteria DSL (success_criteria_json):
 *   { metric: ">= 0.5" }    // pass if actual >= 0.5
 *   { metric: "<= 0.22" }   // pass if actual <= 0.22
 *   { metric: "> 0" }       // strict
 *   { metric: "< 1" }       // strict
 *   { metric: "== 0.5" }    // exact (rare)
 */

const crypto = require('crypto');
const { db } = require('../../database');

const SUCCESS_OPERATORS = Object.freeze(['>=', '<=', '>', '<', '==']);
const REGISTRATION_STATES = Object.freeze([
    'REGISTERED', 'EVALUATING', 'PASS', 'FAIL', 'INVALID'
]);
const TERMINAL_STATES = new Set(['PASS', 'FAIL', 'INVALID']);

// ── Helpers ─────────────────────────────────────────────────────────
function _required(params, key) {
    if (!params || params[key] === undefined || params[key] === null) {
        throw new Error(`preRegistration: missing ${key}`);
    }
    return params[key];
}

function _canonicalJSON(obj) {
    if (obj === null || typeof obj !== 'object') return JSON.stringify(obj);
    if (Array.isArray(obj)) return '[' + obj.map(_canonicalJSON).join(',') + ']';
    const keys = Object.keys(obj).sort();
    return '{' + keys.map(k => JSON.stringify(k) + ':' + _canonicalJSON(obj[k])).join(',') + '}';
}

function _hashRegistration({ versionId, hypothesis, predictedMetrics, successCriteria, evalWindow }) {
    const canonical = _canonicalJSON({
        versionId,
        hypothesis,
        predictedMetrics,
        successCriteria,
        evalWindow
    });
    return crypto.createHash('sha256').update(canonical).digest('hex');
}

function _parseCriterion(criterion) {
    if (typeof criterion !== 'string') return null;
    const m = criterion.match(/^\s*(>=|<=|>|<|==)\s*(-?\d+(?:\.\d+)?)\s*$/);
    if (!m) return null;
    const op = m[1];
    const value = parseFloat(m[2]);
    if (!Number.isFinite(value)) return null;
    return { op, value };
}

function _checkCriterion(actualValue, criterion) {
    const parsed = _parseCriterion(criterion);
    if (!parsed) return { pass: false, invalid: true, reason: `unsupported operator in "${criterion}"` };
    if (typeof actualValue !== 'number' || !Number.isFinite(actualValue)) {
        return { pass: false, invalid: false, reason: `actual is not a finite number` };
    }
    const { op, value } = parsed;
    let pass = false;
    switch (op) {
        case '>=': pass = actualValue >= value; break;
        case '<=': pass = actualValue <= value; break;
        case '>':  pass = actualValue > value;  break;
        case '<':  pass = actualValue < value;  break;
        case '==': pass = Math.abs(actualValue - value) < 1e-9; break;
    }
    return { pass, invalid: false, op, threshold: value, actual: actualValue };
}

// ── Prepared statements ────────────────────────────────────────────
const _stmts = {
    insert: db.prepare(`
        INSERT INTO ml_hypothesis_pre_registrations
        (version_id, hypothesis, predicted_metrics_json, success_criteria_json,
         eval_window_from, eval_window_to, registration_hash, state,
         actor, registered_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'REGISTERED', ?, ?)
    `),
    getById: db.prepare(`SELECT * FROM ml_hypothesis_pre_registrations WHERE id = ?`),
    findActiveForVersion: db.prepare(`
        SELECT * FROM ml_hypothesis_pre_registrations
        WHERE version_id = ? AND state IN ('REGISTERED', 'EVALUATING')
        LIMIT 1
    `),
    listForVersion: db.prepare(`
        SELECT * FROM ml_hypothesis_pre_registrations
        WHERE version_id = ?
        ORDER BY registered_at DESC, id DESC
    `),
    setActuals: db.prepare(`
        UPDATE ml_hypothesis_pre_registrations
        SET actual_metrics_json = ?
        WHERE id = ?
    `),
    setEvaluation: db.prepare(`
        UPDATE ml_hypothesis_pre_registrations
        SET state = ?, pass_fail_details_json = ?, evaluated_at = ?
        WHERE id = ?
    `)
};

// ── registerHypothesis ─────────────────────────────────────────────
function registerHypothesis(params) {
    const versionId = _required(params, 'versionId');
    const hypothesis = _required(params, 'hypothesis');
    const predictedMetrics = _required(params, 'predictedMetrics');
    const successCriteria = _required(params, 'successCriteria');
    const evalWindow = _required(params, 'evalWindow');
    const actor = _required(params, 'actor');

    if (!evalWindow.fromMs || !evalWindow.toMs) {
        throw new Error('registerHypothesis: evalWindow must have fromMs and toMs');
    }
    if (evalWindow.toMs <= evalWindow.fromMs) {
        throw new Error(`registerHypothesis: eval_window invalid (to=${evalWindow.toMs} <= from=${evalWindow.fromMs})`);
    }

    // Enforce one active registration per version
    const existing = _stmts.findActiveForVersion.get(versionId);
    if (existing) {
        throw new Error(`registerHypothesis: version ${versionId} already has registered hypothesis #${existing.id} (state=${existing.state})`);
    }

    const hash = _hashRegistration({
        versionId, hypothesis, predictedMetrics, successCriteria, evalWindow
    });

    const result = _stmts.insert.run(
        versionId,
        hypothesis,
        JSON.stringify(predictedMetrics),
        JSON.stringify(successCriteria),
        evalWindow.fromMs,
        evalWindow.toMs,
        hash,
        actor,
        Date.now()
    );
    return { id: result.lastInsertRowid, registration_hash: hash };
}

// ── recordActuals ──────────────────────────────────────────────────
function recordActuals(params) {
    const id = _required(params, 'id');
    const actualMetrics = _required(params, 'actualMetrics');

    const row = getRegistration(id);
    if (!row) throw new Error(`recordActuals: registration ${id} not found`);
    if (TERMINAL_STATES.has(row.state)) {
        throw new Error(`recordActuals: registration ${id} in terminal state ${row.state}, cannot modify`);
    }
    _stmts.setActuals.run(JSON.stringify(actualMetrics), id);
    return getRegistration(id);
}

// ── evaluate ───────────────────────────────────────────────────────
function evaluate(params) {
    const id = _required(params, 'id');
    const row = getRegistration(id);
    if (!row) throw new Error(`evaluate: registration ${id} not found`);
    if (TERMINAL_STATES.has(row.state)) {
        // Already evaluated; return current state
        return { id, state: row.state };
    }

    // Time gate: no early peek
    const now = Date.now();
    if (now < row.eval_window_to) {
        throw new Error(`evaluate: eval_window not yet reached (to=${row.eval_window_to}, now=${now}, remaining=${row.eval_window_to - now}ms)`);
    }

    if (!row.actual_metrics_json) {
        throw new Error(`evaluate: no actual_metrics recorded for registration ${id}`);
    }

    const criteria = JSON.parse(row.success_criteria_json);
    const actuals = JSON.parse(row.actual_metrics_json);

    const details = {};
    let anyInvalid = false;
    let allPass = true;

    for (const metric of Object.keys(criteria)) {
        const criterion = criteria[metric];
        const actual = actuals[metric];
        const result = _checkCriterion(actual, criterion);
        details[metric] = result;
        if (result.invalid) anyInvalid = true;
        if (!result.pass) allPass = false;
    }

    const newState = anyInvalid ? 'INVALID' : (allPass ? 'PASS' : 'FAIL');
    _stmts.setEvaluation.run(newState, JSON.stringify(details), Date.now(), id);
    return { id, state: newState, details };
}

// ── getRegistration / getRegistrationsForVersion ───────────────────
function getRegistration(id) {
    if (!Number.isInteger(id) || id <= 0) return null;
    return _stmts.getById.get(id) || null;
}

function getRegistrationsForVersion(versionId) {
    if (!Number.isInteger(versionId) || versionId <= 0) return [];
    return _stmts.listForVersion.all(versionId);
}

module.exports = {
    registerHypothesis,
    recordActuals,
    evaluate,
    getRegistration,
    getRegistrationsForVersion,
    SUCCESS_OPERATORS,
    REGISTRATION_STATES
};
