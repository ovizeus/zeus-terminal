'use strict';

/**
 * OMEGA _meta — reflectiveEquilibriumEngine (canonical §121)
 *
 * §121 REFLECTIVE EQUILIBRIUM ENGINE.
 * Source: /root/_review/ml_brain/ml_brain_canonic.txt lines 3297-3347.
 *
 * "Sistemul nu trebuie doar sa ia decizii bune local. Trebuie sa existe un
 *  mecanism care verifica daca deciziile locale, regulile intermediare,
 *  conceptele folosite, si principiile inalte raman coerente intre ele in
 *  timp... coherence audit intre constitution / utility / regime_grammar /
 *  concept_library / thesis_graph / policy_layer... 'sistemul meu, ca
 *  intreg, inca coerent cu el insusi?'... NU orice conflict local cere
 *  reactie; conflictele recurente + transversale trebuie investigate...
 *  echilibrul reflexiv NU schimba charter constitutional."
 *
 * Distinct from §116 constitutionalCharterLayer (immutable charter),
 * §115 selfRepairEngine (repair proposals), §114/§93/§68 (individual layers).
 * §121 = cross-layer coherence overlay.
 */

const { db } = require('../../database');

const CANONICAL_LAYERS = Object.freeze([
    'constitution', 'utility', 'regime_grammar',
    'concept_library', 'thesis_graph', 'policy_layer'
]);
const RECOMMENDED_ACTIONS = Object.freeze([
    'review_rule', 'weaken_concept',
    'quarantine_heuristic', 'escalate_governance',
    'no_action'
]);

const RECURRENCE_THRESHOLD = 3;
const CROSS_LAYER_ESCALATE_THRESHOLD = 5;
const RECURRING_PENALTY = 0.15;
const TOTAL_CONFLICT_PENALTY = 0.05;

function _required(params, key) {
    if (!params || params[key] === undefined || params[key] === null) {
        throw new Error(`reflectiveEquilibriumEngine: missing ${key}`);
    }
    return params[key];
}

const _stmts = {
    insertAudit: db.prepare(`
        INSERT INTO ml_coherence_audits
        (user_id, resolved_env, audit_id, layers_checked_json,
         equilibrium_score, conflicts_detected, recurring_count, ts)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `),
    insertContradiction: db.prepare(`
        INSERT INTO ml_systemic_contradictions
        (user_id, resolved_env, contradiction_id, audit_id,
         layer_a, layer_b, conflict_description,
         recurrence_count, recommended_action, ts)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    listContradictionsByLayerPair: db.prepare(`
        SELECT layer_a, layer_b, COUNT(*) AS count
        FROM ml_systemic_contradictions
        WHERE user_id = ? AND resolved_env = ?
        GROUP BY layer_a, layer_b
        HAVING count >= ?
        ORDER BY count DESC
    `),
    listContradictionsByLayer: db.prepare(`
        SELECT * FROM ml_systemic_contradictions
        WHERE user_id = ? AND resolved_env = ?
          AND (layer_a = ? OR layer_b = ?)
        ORDER BY ts DESC LIMIT ?
    `),
    listAllContradictions: db.prepare(`
        SELECT * FROM ml_systemic_contradictions
        WHERE user_id = ? AND resolved_env = ?
        ORDER BY ts DESC LIMIT ?
    `)
};

// ── computeEquilibriumScore (pure) ─────────────────────────────────
function computeEquilibriumScore(params) {
    const totalConflicts = _required(params, 'totalConflicts');
    const recurringCount = _required(params, 'recurringCount');
    if (totalConflicts < 0 || recurringCount < 0) {
        throw new Error(
            'reflectiveEquilibriumEngine: counts must be >= 0'
        );
    }
    const penalty = recurringCount * RECURRING_PENALTY
                  + totalConflicts * TOTAL_CONFLICT_PENALTY;
    const score = Math.max(0, Math.min(1, 1 - penalty));
    return { equilibriumScore: score, totalConflicts, recurringCount };
}

// ── proposeRevisionAction (pure) ───────────────────────────────────
function proposeRevisionAction(params) {
    const recurrenceCount = _required(params, 'recurrenceCount');
    const isCrossLayer = !!(params && params.isCrossLayer);
    const layerKind = (params && params.layerKind) ? params.layerKind : null;

    let action;
    let reason;

    if (isCrossLayer && recurrenceCount >= CROSS_LAYER_ESCALATE_THRESHOLD) {
        action = 'escalate_governance';
        reason = 'cross_layer_recurrent_above_threshold';
    } else if (recurrenceCount >= RECURRENCE_THRESHOLD &&
               layerKind === 'concept_library') {
        action = 'weaken_concept';
        reason = 'concept_recurrent_conflict';
    } else if (recurrenceCount >= RECURRENCE_THRESHOLD &&
               layerKind === 'policy_layer') {
        action = 'quarantine_heuristic';
        reason = 'policy_heuristic_recurrent';
    } else if (recurrenceCount >= 2) {
        action = 'review_rule';
        reason = 'moderate_rule_conflict';
    } else {
        action = 'no_action';
        reason = 'single_local_conflict';
    }
    return { action, reason, recurrenceCount, isCrossLayer, layerKind };
}

// ── runCoherenceAudit ──────────────────────────────────────────────
function runCoherenceAudit(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const auditId = _required(params, 'auditId');
    const layersChecked = _required(params, 'layersChecked');
    const equilibriumScore = _required(params, 'equilibriumScore');
    if (equilibriumScore < 0 || equilibriumScore > 1) {
        throw new Error(
            'reflectiveEquilibriumEngine: equilibriumScore must be in [0,1]'
        );
    }
    const conflictsDetected = _required(params, 'conflictsDetected');
    if (conflictsDetected < 0) {
        throw new Error(
            'reflectiveEquilibriumEngine: conflictsDetected must be >= 0'
        );
    }
    const recurringCount = _required(params, 'recurringCount');
    if (recurringCount < 0) {
        throw new Error(
            'reflectiveEquilibriumEngine: recurringCount must be >= 0'
        );
    }
    const ts = (params && params.ts) ? params.ts : Date.now();

    try {
        _stmts.insertAudit.run(
            userId, env, auditId,
            JSON.stringify(layersChecked),
            equilibriumScore, conflictsDetected,
            recurringCount, ts
        );
        return { recorded: true, auditId, equilibriumScore };
    } catch (err) {
        if (err.code === 'SQLITE_CONSTRAINT_UNIQUE' ||
            (err.message && err.message.includes('UNIQUE'))) {
            throw new Error(
                `reflectiveEquilibriumEngine: duplicate auditId "${auditId}"`
            );
        }
        throw err;
    }
}

// ── recordContradiction ────────────────────────────────────────────
function recordContradiction(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const contradictionId = _required(params, 'contradictionId');
    const auditId = _required(params, 'auditId');
    const layerA = _required(params, 'layerA');
    if (!CANONICAL_LAYERS.includes(layerA)) {
        throw new Error(`reflectiveEquilibriumEngine: invalid layerA "${layerA}"`);
    }
    const layerB = _required(params, 'layerB');
    if (!CANONICAL_LAYERS.includes(layerB)) {
        throw new Error(`reflectiveEquilibriumEngine: invalid layerB "${layerB}"`);
    }
    const conflictDescription = _required(params, 'conflictDescription');
    const recurrenceCount = _required(params, 'recurrenceCount');
    if (recurrenceCount < 1) {
        throw new Error('reflectiveEquilibriumEngine: recurrenceCount must be >= 1');
    }
    const recommendedAction = _required(params, 'recommendedAction');
    if (!RECOMMENDED_ACTIONS.includes(recommendedAction)) {
        throw new Error(
            `reflectiveEquilibriumEngine: invalid recommendedAction "${recommendedAction}"`
        );
    }
    const ts = (params && params.ts) ? params.ts : Date.now();

    try {
        _stmts.insertContradiction.run(
            userId, env, contradictionId, auditId,
            layerA, layerB, conflictDescription,
            recurrenceCount, recommendedAction, ts
        );
        return { recorded: true, contradictionId };
    } catch (err) {
        if (err.code === 'SQLITE_CONSTRAINT_UNIQUE' ||
            (err.message && err.message.includes('UNIQUE'))) {
            throw new Error(
                `reflectiveEquilibriumEngine: duplicate contradictionId "${contradictionId}"`
            );
        }
        throw err;
    }
}

// ── detectRecurringConflicts ───────────────────────────────────────
function detectRecurringConflicts(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const threshold = (params && params.threshold !== undefined)
        ? params.threshold : RECURRENCE_THRESHOLD;

    const rows = _stmts.listContradictionsByLayerPair.all(userId, env, threshold);
    return rows.map(r => ({
        layerA: r.layer_a,
        layerB: r.layer_b,
        count: r.count
    }));
}

// ── getContradictionHistory ────────────────────────────────────────
function getContradictionHistory(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const layerFilter = params && params.layerFilter;
    const limit = (params && params.limit) ? params.limit : 100;

    if (layerFilter && !CANONICAL_LAYERS.includes(layerFilter)) {
        throw new Error(
            `reflectiveEquilibriumEngine: invalid layerFilter "${layerFilter}"`
        );
    }
    const rows = layerFilter
        ? _stmts.listContradictionsByLayer.all(userId, env, layerFilter, layerFilter, limit)
        : _stmts.listAllContradictions.all(userId, env, limit);
    return rows.map(r => ({
        contradictionId: r.contradiction_id,
        auditId: r.audit_id,
        layerA: r.layer_a, layerB: r.layer_b,
        conflictDescription: r.conflict_description,
        recurrenceCount: r.recurrence_count,
        recommendedAction: r.recommended_action,
        ts: r.ts
    }));
}

module.exports = {
    CANONICAL_LAYERS,
    RECOMMENDED_ACTIONS,
    RECURRENCE_THRESHOLD,
    CROSS_LAYER_ESCALATE_THRESHOLD,
    computeEquilibriumScore,
    proposeRevisionAction,
    runCoherenceAudit,
    recordContradiction,
    detectRecurringConflicts,
    getContradictionHistory
};
