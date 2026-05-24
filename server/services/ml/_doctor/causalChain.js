'use strict';

const { db } = require('../../database');

const MAX_DEPTH_DEFAULT = 5;

function _getCallers(moduleId) {
    try {
        const reg = require('./moduleRegistry');
        const all = reg.listAll();
        const callers = [];
        for (const mod of all) {
            const contract = mod.contract_json ? JSON.parse(mod.contract_json) : {};
            if (Array.isArray(contract.allowedDeps) && contract.allowedDeps.includes(moduleId)) {
                callers.push(mod.module_id);
            }
        }
        return callers;
    } catch (_) { return []; }
}

function _getHeartbeat(moduleId) {
    try {
        const row = db.prepare(
            'SELECT latency_ms, ran_ok, invocation_count FROM ml_module_heartbeats WHERE module_id = ? ORDER BY ts DESC LIMIT 1'
        ).get(moduleId);
        return row || { latency_ms: null, ran_ok: null, invocation_count: 0 };
    } catch (_) { return { latency_ms: null, ran_ok: null, invocation_count: 0 }; }
}

function _getTrust(moduleId) {
    try {
        const ts = require('./trustScorer');
        return ts.getTrustScore(moduleId);
    } catch (_) { return 1.0; }
}

function _buildNode(moduleId, depth, maxDepth, visited) {
    if (depth > maxDepth || visited.has(moduleId)) return null;
    visited.add(moduleId);

    const hb = _getHeartbeat(moduleId);
    const trust = _getTrust(moduleId);
    let role = 'unknown';
    try {
        const reg = require('./moduleRegistry');
        const mod = reg.getModule({ moduleId });
        role = mod ? mod.role_tag : 'unknown';
    } catch (_) {}

    const callers = _getCallers(moduleId);
    const children = [];
    for (const caller of callers) {
        const child = _buildNode(caller, depth + 1, maxDepth, visited);
        if (child) children.push(child);
    }

    return {
        moduleId, role,
        latencyMs: hb.latency_ms,
        ranOk: hb.ran_ok === 1 || hb.ran_ok === true,
        invocationCount: hb.invocation_count || 0,
        trustScore: trust, depth, children,
    };
}

function _maxDepthOf(node) {
    if (!node.children || node.children.length === 0) return node.depth;
    return Math.max(node.depth, ...node.children.map(_maxDepthOf));
}

function buildBlameTree(params) {
    const moduleId = params && params.moduleId;
    if (!moduleId) return { root: null, depth: 0, nodes: [] };

    const maxDepth = (params && params.maxDepth) || MAX_DEPTH_DEFAULT;
    const visited = new Set();
    const callers = _getCallers(moduleId);

    const nodes = [];
    let maxFoundDepth = 0;
    for (const caller of callers) {
        const node = _buildNode(caller, 1, maxDepth, visited);
        if (node) {
            nodes.push(node);
            const d = _maxDepthOf(node);
            if (d > maxFoundDepth) maxFoundDepth = d;
        }
    }

    return { root: moduleId, depth: maxFoundDepth, nodes };
}

function getModuleHealth(params) {
    const moduleId = params && params.moduleId;
    if (!moduleId) return { moduleId: null, trustScore: 0, latencyMs: null, ranOk: false, invocationCount: 0 };

    const hb = _getHeartbeat(moduleId);
    const trust = _getTrust(moduleId);

    return {
        moduleId, trustScore: trust,
        latencyMs: hb.latency_ms,
        ranOk: hb.ran_ok === 1 || hb.ran_ok === true,
        invocationCount: hb.invocation_count || 0,
    };
}

module.exports = { buildBlameTree, getModuleHealth, MAX_DEPTH_DEFAULT };
