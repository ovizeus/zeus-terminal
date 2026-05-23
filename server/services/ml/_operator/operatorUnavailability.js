'use strict';

/**
 * OMEGA Operator Interaction — operatorUnavailability (§253* Claude-extras)
 *
 * §253* OPERATOR UNAVAILABILITY LADDER. Anti-paralysis protocol when
 * operator goes silent on pending MAJOR/CRITICAL approval requests.
 * Source: project_ml_brain_pro_244.md "253* (R1 + R0) — escalation ladder
 * 24h/72h/7d, anti-paralysis, multi-operator handover, fallback SAFE =
 * status quo, never auto-approve during silence."
 *
 * Claude-extras approved 2026-04-29, NOT in canonical PDF.
 *
 * Escalation ladder per spec:
 *   T+24h silent  → WARN     (reminder operator)
 *   T+72h silent  → HANDOVER (notify backup operators)
 *   T+7d  silent  → FALLBACK (EXPIRE approval, preserve status quo)
 *
 * Hard invariant: NEVER auto-approve during silence. FALLBACK transitions
 * the approval to 'EXPIRED' state — never to 'APPROVED'. Status quo
 * (=no change) is preserved.
 *
 * Composition (additive table only):
 *   - Migration 048 (ml_operator_escalations) — escalation audit log
 *   - ml_operator_approval (Migration 041, Wave 1D) — pending approvals
 */

const { db } = require('../../database');
const approvalQueue = require('./approvalQueue');

const THRESHOLDS = Object.freeze({
    warn_hours: 24,
    handover_hours: 72,
    fallback_hours: 168    // 7 days
});

const ESCALATION_LEVELS = Object.freeze(['NONE', 'WARN', 'HANDOVER', 'FALLBACK']);
const PERSISTED_LEVELS = new Set(['WARN', 'HANDOVER', 'FALLBACK']);

// ── Helpers ─────────────────────────────────────────────────────────
function _required(params, key) {
    if (!params || params[key] === undefined || params[key] === null) {
        throw new Error(`operatorUnavailability: missing ${key}`);
    }
    return params[key];
}

function _levelForHours(hours) {
    if (hours < THRESHOLDS.warn_hours) return 'NONE';
    if (hours < THRESHOLDS.handover_hours) return 'WARN';
    if (hours < THRESHOLDS.fallback_hours) return 'HANDOVER';
    return 'FALLBACK';
}

function _nextEscalationHours(currentLevel, currentHours) {
    if (currentLevel === 'NONE') return THRESHOLDS.warn_hours - currentHours;
    if (currentLevel === 'WARN') return THRESHOLDS.handover_hours - currentHours;
    if (currentLevel === 'HANDOVER') return THRESHOLDS.fallback_hours - currentHours;
    return 0;
}

function _actionForLevel(level) {
    switch (level) {
        case 'WARN': return 'send reminder to primary operator';
        case 'HANDOVER': return 'notify backup operators (handover)';
        case 'FALLBACK': return 'expire approval — preserve status quo (NEVER auto-approve)';
        default: return 'no action needed';
    }
}

// ── Prepared statements ────────────────────────────────────────────
const _stmts = {
    insertEscalation: db.prepare(`
        INSERT INTO ml_operator_escalations
        (approval_id, level, hours_since_request, action_taken, actor,
         notified_operators_json, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    `),
    listForApproval: db.prepare(`
        SELECT * FROM ml_operator_escalations
        WHERE approval_id = ?
        ORDER BY created_at ASC, id ASC
    `),
    listPendingApprovals: db.prepare(`
        SELECT * FROM ml_operator_approval
        WHERE queue_state = 'PENDING'
          AND requested_at >= ?
        ORDER BY requested_at ASC
    `)
};

// ── evaluateApproval ───────────────────────────────────────────────
function evaluateApproval(params) {
    const approvalId = _required(params, 'approvalId');
    const approval = approvalQueue.getById(approvalId);
    if (!approval) {
        throw new Error(`evaluateApproval: approval ${approvalId} not found`);
    }

    if (approval.queue_state !== 'PENDING') {
        return {
            approvalId,
            level: 'NONE',
            hours_since_request: 0,
            next_escalation_in_hours: null,
            recommended_action: 'no action needed',
            reason: `approval state ${approval.queue_state} not pending`
        };
    }

    const hours = (Date.now() - approval.requested_at) / (3600 * 1000);
    const level = _levelForHours(hours);
    return {
        approvalId,
        level,
        hours_since_request: hours,
        next_escalation_in_hours: _nextEscalationHours(level, hours),
        recommended_action: _actionForLevel(level)
    };
}

// ── recordEscalation ───────────────────────────────────────────────
function recordEscalation(params) {
    const approvalId = _required(params, 'approvalId');
    const level = _required(params, 'level');
    const action = _required(params, 'action');
    const actor = _required(params, 'actor');
    const notifiedOperators = params.notifiedOperators || null;

    if (!PERSISTED_LEVELS.has(level)) {
        throw new Error(`recordEscalation: level "${level}" not in {WARN,HANDOVER,FALLBACK}`);
    }

    const approval = approvalQueue.getById(approvalId);
    if (!approval) {
        throw new Error(`recordEscalation: approval ${approvalId} not found`);
    }
    const hours = (Date.now() - approval.requested_at) / (3600 * 1000);

    let result;
    try {
        result = _stmts.insertEscalation.run(
            approvalId, level, hours, action, actor,
            notifiedOperators ? JSON.stringify(notifiedOperators) : null,
            Date.now()
        );
    } catch (err) {
        const msg = String(err && err.message || err);
        if (/UNIQUE/i.test(msg)) {
            throw new Error(`recordEscalation: approval ${approvalId} already escalated at ${level} level`);
        }
        throw err;
    }

    // FALLBACK transitions approval to EXPIRED (NEVER APPROVED)
    if (level === 'FALLBACK') {
        approvalQueue.decide({
            id: approvalId,
            decision: 'EXPIRED',
            decidedBy: actor,
            signature: null
        });
    }

    return { escalation_id: result.lastInsertRowid, level, hours_since_request: hours };
}

// ── getEscalationHistory ───────────────────────────────────────────
function getEscalationHistory(params) {
    const approvalId = _required(params, 'approvalId');
    return _stmts.listForApproval.all(approvalId);
}

// ── processEscalations ─────────────────────────────────────────────
function processEscalations(params = {}) {
    const sinceMs = params.sinceMs !== undefined ? params.sinceMs : 0;
    const backupOperators = params.backupOperators || ['operator_backup_default'];

    const result = {
        evaluated: 0,
        warned: 0,
        handed_over: 0,
        expired: 0,
        errors: []
    };

    const pendings = _stmts.listPendingApprovals.all(sinceMs);
    for (const approval of pendings) {
        try {
            result.evaluated++;
            const evaluation = evaluateApproval({ approvalId: approval.id });
            if (evaluation.level === 'NONE') continue;

            // Determine which level(s) need to be recorded — only persist
            // levels not yet recorded for this approval.
            const history = getEscalationHistory({ approvalId: approval.id });
            const recordedLevels = new Set(history.map(h => h.level));

            // Record WARN if applicable and not yet
            if ((evaluation.level === 'WARN' || evaluation.level === 'HANDOVER' || evaluation.level === 'FALLBACK')
                && !recordedLevels.has('WARN')) {
                recordEscalation({
                    approvalId: approval.id,
                    level: 'WARN',
                    action: _actionForLevel('WARN'),
                    actor: '§253*_auto_escalator'
                });
                result.warned++;
            }
            // HANDOVER
            if ((evaluation.level === 'HANDOVER' || evaluation.level === 'FALLBACK')
                && !recordedLevels.has('HANDOVER')) {
                recordEscalation({
                    approvalId: approval.id,
                    level: 'HANDOVER',
                    action: _actionForLevel('HANDOVER'),
                    actor: '§253*_auto_escalator',
                    notifiedOperators: backupOperators
                });
                result.handed_over++;
            }
            // FALLBACK
            if (evaluation.level === 'FALLBACK' && !recordedLevels.has('FALLBACK')) {
                recordEscalation({
                    approvalId: approval.id,
                    level: 'FALLBACK',
                    action: _actionForLevel('FALLBACK'),
                    actor: '§253*_auto_escalator'
                });
                result.expired++;
            }
        } catch (err) {
            result.errors.push({
                approvalId: approval.id,
                error: String(err && err.message || err)
            });
        }
    }

    return result;
}

module.exports = {
    THRESHOLDS,
    ESCALATION_LEVELS,
    evaluateApproval,
    recordEscalation,
    getEscalationHistory,
    processEscalations
};
