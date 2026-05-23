'use strict';

/**
 * OMEGA Doctor D-1.2 — Module Registry (DNA / contract catalog).
 *
 * Tracks role_tag + criticality + runtime_mode + contract per module.
 * Boot-time DAG validator detects cycles (Tarjan-style DFS) and forbidden-dep
 * transitive violations. hot_path_critical cycles trigger hardFail.
 *
 * Per OMEGA Failure Ontology (docs/omega/FAILURE_ONTOLOGY.md): hardFail at
 * boot → exit code 42 (DEAD state).
 */

const { db } = require('../../database');

const ROLE_TAGS = Object.freeze([
    'hot_path_critical', 'hot_path_assist', 'shadow_assist',
    'governance', 'forensic', 'introspection_meta', 'philosophical'
]);
const CRITICALITY = Object.freeze(['low', 'medium', 'high', 'critical']);
const RUNTIME_MODES = Object.freeze(['live', 'shadow', 'offline']);
const REQUIRED_CONTRACT_FIELDS = Object.freeze([
    'acceptedInputs', 'emittedOutputs', 'authorityScope',
    'maxRuntimeMs', 'allowedDeps', 'forbiddenDeps', 'failurePolicy'
]);

function _required(p, k) {
    if (p == null || p[k] == null) {
        throw new Error(`moduleRegistry missing param: ${k}`);
    }
    return p[k];
}

function _validateContract(contract) {
    if (typeof contract !== 'object' || contract === null) {
        throw new Error('contract must be object');
    }
    for (const f of REQUIRED_CONTRACT_FIELDS) {
        if (!(f in contract)) {
            throw new Error(`contract missing required field: ${f}`);
        }
    }
    if (typeof contract.maxRuntimeMs !== 'number' || contract.maxRuntimeMs <= 0) {
        throw new Error('contract.maxRuntimeMs must be positive number');
    }
    if (!Array.isArray(contract.acceptedInputs)) {
        throw new Error('contract.acceptedInputs must be array');
    }
    if (!Array.isArray(contract.emittedOutputs)) {
        throw new Error('contract.emittedOutputs must be array');
    }
    if (!Array.isArray(contract.allowedDeps)) {
        throw new Error('contract.allowedDeps must be array');
    }
    if (!Array.isArray(contract.forbiddenDeps)) {
        throw new Error('contract.forbiddenDeps must be array');
    }
}

const _stmts = {
    insert: db.prepare(`
        INSERT INTO ml_module_registry
        (module_id, role_tag, criticality, runtime_mode, contract_json, registered_at)
        VALUES (?, ?, ?, ?, ?, ?)
    `),
    selectById: db.prepare(`SELECT * FROM ml_module_registry WHERE module_id = ?`),
    selectByTag: db.prepare(`SELECT * FROM ml_module_registry WHERE role_tag = ? ORDER BY module_id`),
    selectAll: db.prepare(`SELECT * FROM ml_module_registry ORDER BY module_id`)
};

function registerModule(params) {
    const moduleId = _required(params, 'moduleId');
    const roleTag = _required(params, 'roleTag');
    const criticality = _required(params, 'criticality');
    const runtimeMode = _required(params, 'runtimeMode');
    const contract = _required(params, 'contract');
    const ts = _required(params, 'ts');

    if (!ROLE_TAGS.includes(roleTag)) throw new Error(`invalid roleTag: ${roleTag}`);
    if (!CRITICALITY.includes(criticality)) throw new Error(`invalid criticality: ${criticality}`);
    if (!RUNTIME_MODES.includes(runtimeMode)) throw new Error(`invalid runtimeMode: ${runtimeMode}`);
    _validateContract(contract);
    if (_stmts.selectById.get(moduleId)) throw new Error(`duplicate moduleId: ${moduleId}`);

    _stmts.insert.run(moduleId, roleTag, criticality, runtimeMode, JSON.stringify(contract), ts);
    return { registered: true, moduleId };
}

function _hydrate(row) {
    if (!row) return null;
    return {
        moduleId: row.module_id,
        roleTag: row.role_tag,
        criticality: row.criticality,
        runtimeMode: row.runtime_mode,
        contract: JSON.parse(row.contract_json),
        registeredAt: row.registered_at
    };
}

function getModule(params) {
    const moduleId = _required(params, 'moduleId');
    return _hydrate(_stmts.selectById.get(moduleId));
}

function getModulesByTag(params) {
    const roleTag = _required(params, 'roleTag');
    if (!ROLE_TAGS.includes(roleTag)) throw new Error(`invalid roleTag: ${roleTag}`);
    return _stmts.selectByTag.all(roleTag).map(_hydrate);
}

function listAll() {
    return _stmts.selectAll.all().map(_hydrate);
}

function validateDAG() {
    const all = listAll();
    const graph = new Map();
    const tagMap = new Map();
    for (const m of all) {
        graph.set(m.moduleId, m.contract.allowedDeps);
        tagMap.set(m.moduleId, m.roleTag);
    }

    const cycles = [];
    const visited = new Set();
    const recStack = new Set();

    function dfs(node, pathStack) {
        if (recStack.has(node)) {
            const cycleStart = pathStack.indexOf(node);
            const cycle = pathStack.slice(cycleStart);
            // Deduplicate: check we haven't already recorded this cycle (rotation-invariant)
            const sortedCycle = [...cycle].sort().join(',');
            const seen = cycles.some(c => [...c].sort().join(',') === sortedCycle);
            if (!seen) cycles.push(cycle);
            return;
        }
        if (visited.has(node)) return;
        recStack.add(node);
        const deps = graph.get(node) || [];
        for (const dep of deps) {
            if (graph.has(dep)) {
                dfs(dep, pathStack.concat(node));
            }
        }
        recStack.delete(node);
        visited.add(node);
    }

    for (const node of graph.keys()) {
        if (!visited.has(node)) dfs(node, []);
    }

    let hardFail = false;
    for (const cycle of cycles) {
        if (cycle.some(n => tagMap.get(n) === 'hot_path_critical')) {
            hardFail = true;
            break;
        }
    }

    // Forbidden-dep transitive check (per OMEGA Failure Ontology — contracts enforce
    // that forbidden modules are unreachable in dep graph, including transitive paths).
    const forbiddenViolations = [];
    for (const m of all) {
        const forbidden = new Set(m.contract.forbiddenDeps);
        if (forbidden.size === 0) continue;
        const reachable = new Set();
        const stack = [...m.contract.allowedDeps];
        while (stack.length) {
            const next = stack.pop();
            if (reachable.has(next)) continue;
            reachable.add(next);
            if (forbidden.has(next)) {
                forbiddenViolations.push({ from: m.moduleId, transitivelyReached: next });
            }
            const nextDeps = graph.get(next);
            if (nextDeps) stack.push(...nextDeps);
        }
    }

    return { cycles, hardFail, forbiddenViolations };
}

module.exports = {
    ROLE_TAGS, CRITICALITY, RUNTIME_MODES, REQUIRED_CONTRACT_FIELDS,
    registerModule, getModule, getModulesByTag, listAll, validateDAG
};
