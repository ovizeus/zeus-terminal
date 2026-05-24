'use strict';

const { db } = require('../../database');

const _stmts = {
    insert: db.prepare(`INSERT INTO ml_cognitive_checkpoints
        (label, cognitive_state, checkpoint_json, auto_created, created_at)
        VALUES (?, ?, ?, ?, ?)`),
    getById: db.prepare('SELECT * FROM ml_cognitive_checkpoints WHERE id = ?'),
    list: db.prepare('SELECT id, label, cognitive_state, auto_created, created_at FROM ml_cognitive_checkpoints ORDER BY created_at DESC LIMIT ?'),
    lastHealthy: db.prepare("SELECT * FROM ml_cognitive_checkpoints WHERE auto_created = 1 AND cognitive_state = 'HEALTHY' ORDER BY created_at DESC LIMIT 1"),
    countAll: db.prepare('SELECT COUNT(*) as cnt FROM ml_cognitive_checkpoints'),
    deleteOldest: db.prepare('DELETE FROM ml_cognitive_checkpoints WHERE id IN (SELECT id FROM ml_cognitive_checkpoints ORDER BY created_at ASC LIMIT ?)'),
};

function _gatherFullState() {
    let trustScores = {};
    let quarantines = [];
    let shedState = 0;
    let cognitiveState = 'HEALTHY';
    let banditPosteriors = [];
    let moduleState = [];

    try { trustScores = require('./trustScorer').listAllScores(); } catch (_) {}
    try { quarantines = require('./quarantineManager').getActiveQuarantines(); } catch (_) {}
    try { shedState = require('./shedManager').getCurrentState(); } catch (_) {}
    try { cognitiveState = require('./analyzer').getCurrentState() || 'HEALTHY'; } catch (_) {}

    try {
        banditPosteriors = db.prepare('SELECT * FROM ml_bandit_posteriors').all();
    } catch (_) {}

    try {
        moduleState = db.prepare('SELECT * FROM ml_module_state LIMIT 500').all();
    } catch (_) {}

    return { trustScores, quarantines, shedState, cognitiveState, banditPosteriors, moduleState };
}

function saveCheckpoint(params) {
    const label = (params && params.label) || 'manual_' + Date.now();
    const auto = !!(params && params.auto);
    const nowTs = Date.now();

    const state = _gatherFullState();
    const json = JSON.stringify(state);

    const result = _stmts.insert.run(label, state.cognitiveState, json, auto ? 1 : 0, nowTs);

    return {
        id: Number(result.lastInsertRowid),
        cognitiveState: state.cognitiveState,
        size: json.length,
    };
}

function getCheckpoint(id) {
    if (!id) return null;
    return _stmts.getById.get(id) || null;
}

function listCheckpoints(params) {
    const limit = (params && params.limit) || 50;
    return _stmts.list.all(limit);
}

function getLastHealthy() {
    return _stmts.lastHealthy.get() || null;
}

function restoreCheckpoint(params) {
    const checkpointId = params && params.checkpointId;
    if (!checkpointId) return { restored: false, error: 'checkpointId required' };

    const cp = getCheckpoint(checkpointId);
    if (!cp) return { restored: false, error: 'Checkpoint not found' };

    let state;
    try { state = JSON.parse(cp.checkpoint_json); } catch (_) {
        return { restored: false, error: 'Invalid checkpoint JSON' };
    }

    const rollbackItems = [];

    // Restore bandit posteriors
    if (Array.isArray(state.banditPosteriors) && state.banditPosteriors.length > 0) {
        try {
            const updateStmt = db.prepare(
                'UPDATE ml_bandit_posteriors SET alpha = ?, beta = ?, observation_count = ? WHERE level = ? AND cell_key = ?'
            );
            for (const p of state.banditPosteriors) {
                updateStmt.run(p.alpha, p.beta, p.observation_count, p.level, p.cell_key);
            }
            rollbackItems.push('bandit_posteriors');
        } catch (_) {}
    }

    // Restore shed state
    if (typeof state.shedState === 'number') {
        try {
            require('./shedManager').setState({ state: state.shedState, reason: 'checkpoint_restore' });
            rollbackItems.push('shed_state');
        } catch (_) {}
    }

    // Restore quarantines: lift all current, re-apply from checkpoint
    try {
        const qm = require('./quarantineManager');
        const current = qm.getActiveQuarantines();
        for (const q of current) {
            try { qm.lift({ moduleId: q.module_id || q.moduleId }); } catch (_) {}
        }
        if (Array.isArray(state.quarantines)) {
            for (const q of state.quarantines) {
                try {
                    qm.quarantine({
                        moduleId: q.module_id || q.moduleId,
                        action: q.quarantine_action || q.action || 'shadow_only',
                        reason: 'checkpoint_restore',
                    });
                } catch (_) {}
            }
        }
        rollbackItems.push('quarantines');
    } catch (_) {}

    return { restored: true, checkpointId, rollbackItems };
}

function pruneOld(maxCount) {
    const row = _stmts.countAll.get();
    const total = row ? row.cnt : 0;
    if (total <= maxCount) return 0;
    const toDelete = total - maxCount;
    const result = _stmts.deleteOldest.run(toDelete);
    return result.changes;
}

module.exports = {
    saveCheckpoint,
    getCheckpoint,
    listCheckpoints,
    getLastHealthy,
    restoreCheckpoint,
    pruneOld,
};
