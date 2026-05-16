'use strict';

/**
 * OMEGA R5B Governance — competenceMap (canonical §106)
 *
 * §106 COMPETENCE MAP / DOMAIN-OF-VALIDITY CARTOGRAPHY.
 * Source: /root/_review/ml_brain/ml_brain_canonic.txt lines 2673-2726.
 *
 * "Bot poate fi foarte bun pe BTC+trend+London+medium-latency si slab pe
 *  alts+chop+weekend+degraded feeds... competence map multidimensional...
 *  action permission: allowed / reduced_size / shadow_only / observer_only...
 *  performanta globala buna NU acorda permisiune universala — fiecare
 *  regiune isi castiga dreptul la capital."
 *
 * R5B governance. Distinct from §94 complexityBudget (MDL pruning of features),
 * §90 goodhartProtection (metric gaming), §97 forgettingEngine (decay).
 * §106 = per-domain permission lifecycle.
 */

const { db } = require('../../database');

const ACTION_PERMISSIONS = Object.freeze([
    'allowed', 'reduced_size', 'shadow_only', 'observer_only'
]);

const MIN_SAMPLES_FOR_VALIDITY = 30;
const VALIDITY_THRESHOLDS = Object.freeze({
    allowed: 0.70,
    reduced: 0.50,
    shadow: 0.30
});

function _required(params, key) {
    if (!params || params[key] === undefined || params[key] === null) {
        throw new Error(`competenceMap: missing ${key}`);
    }
    return params[key];
}

const _stmts = {
    insertCell: db.prepare(`
        INSERT INTO ml_competence_cells
        (user_id, resolved_env, cell_id, dimensions_json,
         validity_score, sample_count, win_rate, action_permission,
         last_updated, ts_created)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    getCell: db.prepare(`
        SELECT * FROM ml_competence_cells WHERE cell_id = ?
    `),
    listCells: db.prepare(`
        SELECT * FROM ml_competence_cells
        WHERE user_id = ? AND resolved_env = ?
        ORDER BY validity_score DESC, ts_created DESC LIMIT ?
    `),
    listCellsByPermission: db.prepare(`
        SELECT * FROM ml_competence_cells
        WHERE user_id = ? AND resolved_env = ? AND action_permission = ?
        ORDER BY validity_score DESC, ts_created DESC LIMIT ?
    `),
    listAllCellsForUser: db.prepare(`
        SELECT * FROM ml_competence_cells
        WHERE user_id = ? AND resolved_env = ?
    `),
    updateCellMetrics: db.prepare(`
        UPDATE ml_competence_cells
        SET validity_score = ?, win_rate = ?, sample_count = ?,
            action_permission = ?, last_updated = ?
        WHERE user_id = ? AND resolved_env = ? AND cell_id = ?
    `),
    insertDecision: db.prepare(`
        INSERT INTO ml_competence_decisions
        (user_id, resolved_env, decision_id, cell_id,
         decision_context, action_permission, reason, ts)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `)
};

// ── computePermissionFromValidity (pure) ───────────────────────────
function computePermissionFromValidity(params) {
    const validity = _required(params, 'validity');
    const sampleCount = _required(params, 'sampleCount');
    const minSamples = (params && params.minSamples !== undefined)
        ? params.minSamples : MIN_SAMPLES_FOR_VALIDITY;

    if (validity < 0 || validity > 1) {
        throw new Error('competenceMap: validity must be in [0,1]');
    }
    if (sampleCount < 0) {
        throw new Error('competenceMap: sampleCount must be >= 0');
    }
    if (sampleCount < minSamples) {
        return {
            permission: 'observer_only',
            reason: 'insufficient_samples',
            sampleCount, validity
        };
    }
    if (validity >= VALIDITY_THRESHOLDS.allowed) {
        return { permission: 'allowed', reason: 'high_validity', sampleCount, validity };
    }
    if (validity >= VALIDITY_THRESHOLDS.reduced) {
        return { permission: 'reduced_size', reason: 'medium_validity', sampleCount, validity };
    }
    if (validity >= VALIDITY_THRESHOLDS.shadow) {
        return { permission: 'shadow_only', reason: 'low_validity', sampleCount, validity };
    }
    return {
        permission: 'observer_only', reason: 'very_low_validity',
        sampleCount, validity
    };
}

// ── registerCompetenceCell ─────────────────────────────────────────
function registerCompetenceCell(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const cellId = _required(params, 'cellId');
    const dimensions = _required(params, 'dimensions');
    const initialValidity = (params && params.initialValidity !== undefined)
        ? params.initialValidity : 0;
    const initialSamples = (params && params.initialSamples !== undefined)
        ? params.initialSamples : 0;
    const initialWinRate = (params && params.initialWinRate !== undefined)
        ? params.initialWinRate : null;

    if (initialValidity < 0 || initialValidity > 1) {
        throw new Error('competenceMap: initialValidity must be in [0,1]');
    }

    let initialPermission = params && params.initialPermission;
    if (initialPermission) {
        if (!ACTION_PERMISSIONS.includes(initialPermission)) {
            throw new Error(
                `competenceMap: invalid initialPermission "${initialPermission}"`
            );
        }
    } else {
        const r = computePermissionFromValidity({
            validity: initialValidity, sampleCount: initialSamples
        });
        initialPermission = r.permission;
    }

    const ts = (params && params.ts) ? params.ts : Date.now();

    try {
        _stmts.insertCell.run(
            userId, env, cellId, JSON.stringify(dimensions),
            initialValidity, initialSamples, initialWinRate,
            initialPermission, ts, ts
        );
        return { registered: true, cellId, actionPermission: initialPermission };
    } catch (err) {
        if (err.code === 'SQLITE_CONSTRAINT_UNIQUE' ||
            (err.message && err.message.includes('UNIQUE'))) {
            throw new Error(`competenceMap: duplicate cellId "${cellId}"`);
        }
        throw err;
    }
}

// ── updateCompetenceMetrics ────────────────────────────────────────
function updateCompetenceMetrics(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const cellId = _required(params, 'cellId');
    const newWinRate = _required(params, 'newWinRate');
    const newSampleCount = _required(params, 'newSampleCount');
    if (newWinRate < 0 || newWinRate > 1) {
        throw new Error('competenceMap: newWinRate must be in [0,1]');
    }
    if (newSampleCount < 0) {
        throw new Error('competenceMap: newSampleCount must be >= 0');
    }
    const ts = (params && params.ts) ? params.ts : Date.now();

    const cell = _stmts.getCell.get(cellId);
    if (!cell) {
        throw new Error(`competenceMap: cell "${cellId}" not found`);
    }
    if (cell.user_id !== userId || cell.resolved_env !== env) {
        throw new Error('competenceMap: cell not owned by user/env');
    }

    const validity = newWinRate;   // proxy validity = win_rate
    const r = computePermissionFromValidity({
        validity, sampleCount: newSampleCount
    });

    _stmts.updateCellMetrics.run(
        validity, newWinRate, newSampleCount,
        r.permission, ts,
        userId, env, cellId
    );
    return {
        updated: true, cellId,
        newValidity: validity, newPermission: r.permission,
        newSampleCount
    };
}

// ── lookupCompetence ───────────────────────────────────────────────
function lookupCompetence(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const dimensions = _required(params, 'dimensions');

    const rows = _stmts.listAllCellsForUser.all(userId, env);
    const target = JSON.stringify(dimensions);
    for (const r of rows) {
        if (r.dimensions_json === target) {
            return {
                found: true,
                cellId: r.cell_id,
                dimensions: JSON.parse(r.dimensions_json),
                validityScore: r.validity_score,
                sampleCount: r.sample_count,
                winRate: r.win_rate,
                actionPermission: r.action_permission,
                lastUpdated: r.last_updated
            };
        }
    }
    return { found: false };
}

// ── recordCompetenceDecision ───────────────────────────────────────
function recordCompetenceDecision(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const decisionId = _required(params, 'decisionId');
    const cellId = (params && params.cellId) ? params.cellId : null;
    const decisionContext = _required(params, 'decisionContext');
    const actionPermission = _required(params, 'actionPermission');
    if (!ACTION_PERMISSIONS.includes(actionPermission)) {
        throw new Error(`competenceMap: invalid actionPermission "${actionPermission}"`);
    }
    const reason = _required(params, 'reason');
    const ts = (params && params.ts) ? params.ts : Date.now();

    try {
        _stmts.insertDecision.run(
            userId, env, decisionId, cellId,
            decisionContext, actionPermission, reason, ts
        );
        return { recorded: true, decisionId };
    } catch (err) {
        if (err.code === 'SQLITE_CONSTRAINT_UNIQUE' ||
            (err.message && err.message.includes('UNIQUE'))) {
            throw new Error(`competenceMap: duplicate decisionId "${decisionId}"`);
        }
        throw err;
    }
}

// ── getCompetenceMap ───────────────────────────────────────────────
function getCompetenceMap(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const permissionFilter = params && params.permissionFilter;
    const limit = (params && params.limit) ? params.limit : 100;

    if (permissionFilter && !ACTION_PERMISSIONS.includes(permissionFilter)) {
        throw new Error(
            `competenceMap: invalid permissionFilter "${permissionFilter}"`
        );
    }
    const rows = permissionFilter
        ? _stmts.listCellsByPermission.all(userId, env, permissionFilter, limit)
        : _stmts.listCells.all(userId, env, limit);
    return rows.map(r => ({
        cellId: r.cell_id,
        dimensions: JSON.parse(r.dimensions_json),
        validityScore: r.validity_score,
        sampleCount: r.sample_count,
        winRate: r.win_rate,
        actionPermission: r.action_permission,
        lastUpdated: r.last_updated
    }));
}

module.exports = {
    ACTION_PERMISSIONS,
    MIN_SAMPLES_FOR_VALIDITY,
    VALIDITY_THRESHOLDS,
    computePermissionFromValidity,
    registerCompetenceCell,
    updateCompetenceMetrics,
    lookupCompetence,
    recordCompetenceDecision,
    getCompetenceMap
};
