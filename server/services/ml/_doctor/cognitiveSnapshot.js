'use strict';

const { db } = require('../../database');

const TRIGGER_TYPES = Object.freeze(['auto_p0', 'manual', 'scheduled']);

const _stmts = {
    insert: db.prepare(`INSERT INTO ml_cognitive_snapshots
        (trigger_type, trigger_event_id, cognitive_state, snapshot_json, modules_involved_json, created_at)
        VALUES (?, ?, ?, ?, ?, ?)`),
    getById: db.prepare('SELECT * FROM ml_cognitive_snapshots WHERE id = ?'),
    list: db.prepare('SELECT id, trigger_type, trigger_event_id, cognitive_state, created_at FROM ml_cognitive_snapshots ORDER BY created_at DESC LIMIT ?'),
    listSince: db.prepare('SELECT id, trigger_type, trigger_event_id, cognitive_state, created_at FROM ml_cognitive_snapshots WHERE created_at > ? ORDER BY created_at DESC LIMIT ?'),
    pruneOld: db.prepare('DELETE FROM ml_cognitive_snapshots WHERE created_at < ?'),
};

function _gatherState() {
    let trustScores = {};
    let quarantines = [];
    let shedState = 0;
    let cognitiveState = 'HEALTHY';

    try {
        const ts = require('./trustScorer');
        trustScores = ts.listAllScores();
    } catch (_) {}

    try {
        const qm = require('./quarantineManager');
        quarantines = qm.getActiveQuarantines();
    } catch (_) {}

    try {
        const sm = require('./shedManager');
        shedState = sm.getCurrentState();
    } catch (_) {}

    try {
        const az = require('./analyzer');
        cognitiveState = az.getCurrentState() || 'HEALTHY';
    } catch (_) {}

    return { trustScores, quarantines, shedState, cognitiveState };
}

function captureSnapshot(params) {
    const triggerType = (params && params.triggerType) || 'manual';
    if (!TRIGGER_TYPES.includes(triggerType)) {
        throw new Error(`Invalid trigger_type: ${triggerType}`);
    }
    const triggerEventId = (params && params.triggerEventId) || null;
    const nowTs = (params && params.nowTs) || Date.now();

    const state = _gatherState();
    const snapshotJson = JSON.stringify(state);
    const modulesInvolved = state.quarantines.length > 0
        ? JSON.stringify(state.quarantines.map(q => q.module_id || q.moduleId))
        : null;

    const result = _stmts.insert.run(
        triggerType, triggerEventId, state.cognitiveState,
        snapshotJson, modulesInvolved, nowTs
    );

    return {
        id: Number(result.lastInsertRowid),
        cognitiveState: state.cognitiveState,
        moduleCount: Object.keys(state.trustScores).length,
    };
}

function getSnapshot(id) {
    if (!id) return null;
    return _stmts.getById.get(id) || null;
}

function listSnapshots(params) {
    const limit = (params && params.limit) || 50;
    const since = params && params.since;
    if (since) return _stmts.listSince.all(since, limit);
    return _stmts.list.all(limit);
}

function pruneOld(maxAgeDays) {
    const cutoff = Date.now() - maxAgeDays * 86400000;
    const result = _stmts.pruneOld.run(cutoff);
    return result.changes;
}

module.exports = {
    TRIGGER_TYPES,
    captureSnapshot,
    getSnapshot,
    listSnapshots,
    pruneOld,
};
