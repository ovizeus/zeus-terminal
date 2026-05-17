'use strict';

/**
 * OMEGA §228 — ENACTIVE TRUTH RESIDUE / WHAT-CAN-BE-KNOWN-ONLY-BY-DOING.
 * Canonical PDF lines 7112-7162.
 */

const { db } = require('../../database');

const TRUTH_CLASSES = Object.freeze([
    'observational', 'inferential', 'simulated', 'enactive'
]);

const RESOLVED_ENVS = new Set(['DEMO', 'TESTNET', 'REAL']);
function _required(p, k) { if (p == null || p[k] == null) throw new Error(`§228 missing param: ${k}`); return p[k]; }
function _requireEnv(env) { if (!RESOLVED_ENVS.has(env)) throw new Error(`§228 invalid env: ${env}`); return env; }

function classifyTruth(params) {
    const truthClass = _required(params, 'truthClass');
    if (!TRUTH_CLASSES.includes(truthClass)) throw new Error(`§228 invalid truthClass: ${truthClass}`);
    return { truthClass };
}

function specialWeight(params) {
    const truthClass = _required(params, 'truthClass');
    if (!TRUTH_CLASSES.includes(truthClass)) throw new Error(`§228 invalid truthClass`);
    // Enactive truths receive elevated weight — they cannot be substituted by lab work.
    const table = {
        observational: 1.0,
        inferential: 1.2,
        simulated: 1.5,
        enactive: 3.0
    };
    return { weightMultiplier: table[truthClass] };
}

const _stmts = {
    insert: db.prepare(`
        INSERT INTO ml_enactive_truth_residue (
            user_id, resolved_env, residue_id, truth_class,
            commitment_threshold_crossed, unobtainable_without_action,
            weight_multiplier, reasoning, ts
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    selectById: db.prepare(`SELECT * FROM ml_enactive_truth_residue WHERE residue_id = ?`),
    selectAll: db.prepare(`
        SELECT id, residue_id AS residueId, truth_class AS truthClass,
               commitment_threshold_crossed AS commitmentThresholdCrossed,
               unobtainable_without_action AS unobtainableWithoutAction,
               weight_multiplier AS weightMultiplier, ts
        FROM ml_enactive_truth_residue
        WHERE user_id = ? AND resolved_env = ?
        ORDER BY ts DESC
    `)
};

function recordResidue(params) {
    const userId = _required(params, 'userId');
    const resolvedEnv = _requireEnv(_required(params, 'resolvedEnv'));
    const residueId = _required(params, 'residueId');
    const truthClass = _required(params, 'truthClass');
    const commitmentThresholdCrossed = _required(params, 'commitmentThresholdCrossed');
    const unobtainableWithoutAction = _required(params, 'unobtainableWithoutAction');
    const ts = _required(params, 'ts');
    const reasoning = params.reasoning ?? null;

    if (!TRUTH_CLASSES.includes(truthClass)) throw new Error(`§228 invalid truthClass`);
    if (commitmentThresholdCrossed !== 0 && commitmentThresholdCrossed !== 1) throw new Error(`§228 commitmentThresholdCrossed must be 0|1`);
    if (unobtainableWithoutAction !== 0 && unobtainableWithoutAction !== 1) throw new Error(`§228 unobtainableWithoutAction must be 0|1`);
    if (_stmts.selectById.get(residueId)) throw new Error(`§228 duplicate residueId: ${residueId}`);

    const { weightMultiplier } = specialWeight({ truthClass });

    _stmts.insert.run(
        userId, resolvedEnv, residueId, truthClass,
        commitmentThresholdCrossed, unobtainableWithoutAction,
        weightMultiplier, reasoning, ts
    );
    return { recorded: true, residueId, truthClass, weightMultiplier };
}

function getRecentResidues(params) {
    const userId = _required(params, 'userId');
    const resolvedEnv = _requireEnv(_required(params, 'resolvedEnv'));
    return _stmts.selectAll.all(userId, resolvedEnv);
}

module.exports = { TRUTH_CLASSES, classifyTruth, specialWeight, recordResidue, getRecentResidues };
