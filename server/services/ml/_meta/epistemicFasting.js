'use strict';

/**
 * OMEGA §229 — EPISTEMIC FASTING / THE RIGHT-NOT-TO-KNOW-YET.
 * Canonical PDF lines 7165-7218.
 */

const { db } = require('../../database');

const INFO_CLASSES = Object.freeze([
    'beneficial', 'neutral', 'contaminating', 'premature'
]);

const RESOLVED_ENVS = new Set(['DEMO', 'TESTNET', 'REAL']);
function _required(p, k) { if (p == null || p[k] == null) throw new Error(`§229 missing param: ${k}`); return p[k]; }
function _requireEnv(env) { if (!RESOLVED_ENVS.has(env)) throw new Error(`§229 invalid env: ${env}`); return env; }

function shouldAbstain(params) {
    const infoClass = _required(params, 'infoClass');
    if (!INFO_CLASSES.includes(infoClass)) throw new Error(`§229 invalid infoClass: ${infoClass}`);
    // Abstain on contaminating/premature info — beneficial/neutral may flow.
    return { abstain: (infoClass === 'contaminating' || infoClass === 'premature') ? 1 : 0 };
}

const _stmts = {
    insert: db.prepare(`
        INSERT INTO ml_epistemic_fasting_windows (
            user_id, resolved_env, window_id, source_label, info_class,
            duration_ms, purpose, exit_condition, active, started_at, ts
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
    `),
    selectById: db.prepare(`SELECT * FROM ml_epistemic_fasting_windows WHERE window_id = ?`),
    deactivate: db.prepare(`UPDATE ml_epistemic_fasting_windows SET active = 0 WHERE window_id = ?`),
    listActive: db.prepare(`
        SELECT id, window_id AS windowId, source_label AS sourceLabel,
               info_class AS infoClass, duration_ms AS durationMs,
               purpose, exit_condition AS exitCondition, active,
               started_at AS startedAt, ts
        FROM ml_epistemic_fasting_windows
        WHERE user_id = ? AND resolved_env = ? AND active = 1
        ORDER BY started_at DESC
    `)
};

function openWindow(params) {
    const userId = _required(params, 'userId');
    const resolvedEnv = _requireEnv(_required(params, 'resolvedEnv'));
    const windowId = _required(params, 'windowId');
    const sourceLabel = _required(params, 'sourceLabel');
    const infoClass = _required(params, 'infoClass');
    const durationMs = _required(params, 'durationMs');
    const purpose = _required(params, 'purpose');
    const exitCondition = _required(params, 'exitCondition');
    const ts = _required(params, 'ts');

    if (!INFO_CLASSES.includes(infoClass)) throw new Error(`§229 invalid infoClass`);
    if (typeof durationMs !== 'number' || durationMs < 0) throw new Error(`§229 durationMs must be non-negative`);
    if (_stmts.selectById.get(windowId)) throw new Error(`§229 duplicate windowId: ${windowId}`);

    _stmts.insert.run(
        userId, resolvedEnv, windowId, sourceLabel, infoClass,
        durationMs, purpose, exitCondition, ts, ts
    );
    return { opened: true, windowId };
}

function closeWindow(params) {
    const windowId = _required(params, 'windowId');
    if (!_stmts.selectById.get(windowId)) throw new Error(`§229 unknown windowId: ${windowId}`);
    _stmts.deactivate.run(windowId);
    return { closed: true, windowId };
}

function listActiveWindows(params) {
    const userId = _required(params, 'userId');
    const resolvedEnv = _requireEnv(_required(params, 'resolvedEnv'));
    return _stmts.listActive.all(userId, resolvedEnv);
}

module.exports = { INFO_CLASSES, shouldAbstain, openWindow, closeWindow, listActiveWindows };
