'use strict';

/**
 * OMEGA R5B Governance — versionRegistry (canonical §19)
 *
 * "Tot sistemul trebuie versionat."
 *
 * Foundation R5B point. Manages version lifecycle for 5 component types
 * (model / detector / feature_schema / risk_config / execution_config)
 * with atomic state transitions:
 *
 *   PROPOSED → ACTIVE → ROLLED_BACK / RETIRED
 *
 * Constraints (enforced):
 *   - Only ONE ACTIVE row per (component_type, component_id) at any time
 *   - activateVersion atomically retires the previous ACTIVE for that component
 *   - rollbackVersion requires parent_version_id; re-activates parent
 *   - config_hash = SHA-256 of canonical(config_json) for identity comparison
 *
 * R5B-future points consume this:
 *   - §252* tiered promotion → proposeVersion + operator approval → activate
 *   - §254* auto-quarantine → rollbackVersion when drift/calibration degrades
 *   - §247* pre-registration → proposeVersion locked before evaluation
 *   - §33 A/B testing → compareVersions(A, B) for diff + KPI deltas
 */

const crypto = require('crypto');
const { db } = require('../../database');

const COMPONENT_TYPES = Object.freeze([
    'model', 'detector', 'feature_schema', 'risk_config', 'execution_config'
]);

const VERSION_STATES = Object.freeze([
    'PROPOSED', 'ACTIVE', 'ROLLED_BACK', 'RETIRED'
]);

// ── Helpers ─────────────────────────────────────────────────────────
function _required(params, key) {
    if (!params || params[key] === undefined || params[key] === null) {
        throw new Error(`versionRegistry: missing ${key}`);
    }
    return params[key];
}

function _canonicalJSON(obj) {
    if (obj === null || typeof obj !== 'object') return JSON.stringify(obj);
    if (Array.isArray(obj)) return '[' + obj.map(_canonicalJSON).join(',') + ']';
    const keys = Object.keys(obj).sort();
    return '{' + keys.map(k => JSON.stringify(k) + ':' + _canonicalJSON(obj[k])).join(',') + '}';
}

function _hashConfig(config) {
    return crypto.createHash('sha256').update(_canonicalJSON(config)).digest('hex');
}

// ── Prepared statements ─────────────────────────────────────────────
const _stmts = {
    insert: db.prepare(`
        INSERT INTO ml_governance_versions
        (component_type, component_id, version, config_json, config_hash,
         parent_version_id, motivation, actor, state, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'PROPOSED', ?)
    `),
    getById: db.prepare(`SELECT * FROM ml_governance_versions WHERE id = ?`),
    getActive: db.prepare(`
        SELECT * FROM ml_governance_versions
        WHERE component_type = ? AND component_id = ? AND state = 'ACTIVE'
        LIMIT 1
    `),
    setRetired: db.prepare(`
        UPDATE ml_governance_versions SET state = 'RETIRED' WHERE id = ?
    `),
    setActive: db.prepare(`
        UPDATE ml_governance_versions SET state = 'ACTIVE', activated_at = ? WHERE id = ?
    `),
    setRolledBack: db.prepare(`
        UPDATE ml_governance_versions SET state = 'ROLLED_BACK', rolled_back_at = ? WHERE id = ?
    `),
    reactivateParent: db.prepare(`
        UPDATE ml_governance_versions SET state = 'ACTIVE' WHERE id = ?
    `),
    setKpi: db.prepare(`
        UPDATE ml_governance_versions SET kpi_delta_json = ? WHERE id = ?
    `),
    history: db.prepare(`
        SELECT * FROM ml_governance_versions
        WHERE component_type = ? AND component_id = ?
        ORDER BY created_at DESC, id DESC
        LIMIT ?
    `),
    changelog: db.prepare(`
        SELECT * FROM ml_governance_versions
        WHERE (@componentType IS NULL OR component_type = @componentType)
          AND (@sinceMs IS NULL OR created_at >= @sinceMs)
        ORDER BY created_at DESC, id DESC
        LIMIT @limit
    `)
};

// ── Public API ──────────────────────────────────────────────────────
function proposeVersion(params) {
    const componentType = _required(params, 'componentType');
    const componentId = _required(params, 'componentId');
    const version = _required(params, 'version');
    const config = params.config !== undefined ? params.config : {};
    const motivation = _required(params, 'motivation');
    const actor = _required(params, 'actor');
    const parentVersionId = params.parentVersionId || null;

    const configJson = JSON.stringify(config);
    const configHash = _hashConfig(config);

    const result = _stmts.insert.run(
        componentType, componentId, version, configJson, configHash,
        parentVersionId, motivation, actor, Date.now()
    );
    return { id: result.lastInsertRowid, config_hash: configHash };
}

function activateVersion(params) {
    const id = _required(params, 'id');
    const row = getById(id);
    if (!row) throw new Error(`activateVersion: version ${id} not found`);
    if (row.state !== 'PROPOSED') {
        throw new Error(`activateVersion: version ${id} state is ${row.state}, must be PROPOSED`);
    }
    const previous = _stmts.getActive.get(row.component_type, row.component_id);
    const now = Date.now();
    if (previous) _stmts.setRetired.run(previous.id);
    _stmts.setActive.run(now, id);
    return getById(id);
}

function rollbackVersion(params) {
    const id = _required(params, 'id');
    const row = getById(id);
    if (!row) throw new Error(`rollbackVersion: version ${id} not found`);
    if (row.state !== 'ACTIVE') {
        throw new Error(`rollbackVersion: version ${id} state is ${row.state}, must be ACTIVE`);
    }
    if (!row.parent_version_id) {
        throw new Error(`rollbackVersion: version ${id} is initial (no parent), cannot rollback`);
    }
    _stmts.setRolledBack.run(Date.now(), id);
    _stmts.reactivateParent.run(row.parent_version_id);
    return getById(id);
}

function getActive(componentType, componentId) {
    if (!componentType || !componentId) return null;
    return _stmts.getActive.get(componentType, componentId) || null;
}

function getById(id) {
    if (!Number.isInteger(id) || id <= 0) return null;
    return _stmts.getById.get(id) || null;
}

function getHistory(componentType, componentId, limit = 50) {
    const lim = Math.max(1, Math.min(500, limit));
    return _stmts.history.all(componentType, componentId, lim);
}

function compareVersions(idA, idB) {
    const a = getById(idA);
    const b = getById(idB);
    if (!a || !b) throw new Error(`compareVersions: version not found (${idA}, ${idB})`);
    const cfgA = JSON.parse(a.config_json);
    const cfgB = JSON.parse(b.config_json);
    const keysA = new Set(Object.keys(cfgA));
    const keysB = new Set(Object.keys(cfgB));
    const added = [];
    const removed = [];
    const changed = [];
    for (const k of keysB) {
        if (!keysA.has(k)) added.push(k);
        else if (JSON.stringify(cfgA[k]) !== JSON.stringify(cfgB[k])) changed.push(k);
    }
    for (const k of keysA) {
        if (!keysB.has(k)) removed.push(k);
    }
    return {
        a: { id: a.id, version: a.version, hash: a.config_hash },
        b: { id: b.id, version: b.version, hash: b.config_hash },
        added,
        removed,
        changed,
        kpi_delta_a: a.kpi_delta_json ? JSON.parse(a.kpi_delta_json) : null,
        kpi_delta_b: b.kpi_delta_json ? JSON.parse(b.kpi_delta_json) : null
    };
}

function setKpiDelta(params) {
    const id = _required(params, 'id');
    const kpiDelta = _required(params, 'kpiDelta');
    _stmts.setKpi.run(JSON.stringify(kpiDelta), id);
    return getById(id);
}

function getChangelog(params = {}) {
    const componentType = params.componentType || null;
    const sinceMs = params.sinceMs !== undefined ? params.sinceMs : null;
    const limit = Math.max(1, Math.min(1000, params.limit || 100));
    const rows = _stmts.changelog.all({ componentType, sinceMs, limit });
    return rows.map(r => ({
        when: r.created_at,
        who: r.actor,
        type: r.component_type,
        component: r.component_id,
        version: r.version,
        motivation: r.motivation,
        state: r.state,
        kpi_summary: r.kpi_delta_json ? JSON.parse(r.kpi_delta_json) : null,
        activated_at: r.activated_at,
        rolled_back_at: r.rolled_back_at
    }));
}

module.exports = {
    proposeVersion,
    activateVersion,
    rollbackVersion,
    getActive,
    getById,
    getHistory,
    compareVersions,
    setKpiDelta,
    getChangelog,
    COMPONENT_TYPES,
    VERSION_STATES
};
