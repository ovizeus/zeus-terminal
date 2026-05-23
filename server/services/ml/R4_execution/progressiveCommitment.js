'use strict';

/**
 * OMEGA R4 Execution — progressiveCommitment (canonical §108)
 *
 * §108 PROGRESSIVE COMMITMENT / REAL-OPTIONS ENTRY ENGINE.
 * Source: /root/_review/ml_brain/ml_brain_canonic.txt lines 2773-2815.
 *
 * "Uneori cea mai buna alegere este o angajare progresiva, in transe, care
 *  cumpara informatie din raspunsul pietei... probe entry minim... expansion
 *  daca confirma teza... abort daca contrazice... 'Merita sa cumpar informatie
 *  printr-o pozitie mica inainte de a ma angaja complet?'"
 *
 * R4 execution: entry sizing as real-options. Complementary to §99 active
 * sensing (info acquisition), §85 computeBudgetGovernor (budget).
 */

const { db } = require('../../database');

const SETUP_STATUSES = Object.freeze([
    'probing', 'confirming', 'full', 'aborted', 'completed'
]);
const TRANCHE_KINDS = Object.freeze([
    'exploratory', 'conviction', 'confirmation_add', 'defensive_reduce'
]);
const EXPANSION_DECISIONS = Object.freeze([
    'expand', 'hold', 'abort', 'exit'
]);

const DEFAULT_EXPANSION_THRESHOLD = 0.60;
const DEFAULT_ABORT_THRESHOLD = 0.30;
const FULL_FILL_TOLERANCE = 0.99;
const CONFIRMING_FILL_THRESHOLD = 0.30;

function _required(params, key) {
    if (!params || params[key] === undefined || params[key] === null) {
        throw new Error(`progressiveCommitment: missing ${key}`);
    }
    return params[key];
}

const _stmts = {
    insertSetup: db.prepare(`
        INSERT INTO ml_commitment_setups
        (user_id, resolved_env, setup_id, target_total_size,
         current_filled_size, status, thesis_id,
         ts_created, ts_last_updated)
        VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?)
    `),
    getSetup: db.prepare(`
        SELECT * FROM ml_commitment_setups WHERE setup_id = ?
    `),
    listSetups: db.prepare(`
        SELECT * FROM ml_commitment_setups
        WHERE user_id = ? AND resolved_env = ?
        ORDER BY ts_created DESC LIMIT ?
    `),
    listSetupsByStatus: db.prepare(`
        SELECT * FROM ml_commitment_setups
        WHERE user_id = ? AND resolved_env = ? AND status = ?
        ORDER BY ts_created DESC LIMIT ?
    `),
    updateSetup: db.prepare(`
        UPDATE ml_commitment_setups
        SET current_filled_size = ?, status = ?, ts_last_updated = ?
        WHERE user_id = ? AND resolved_env = ? AND setup_id = ?
    `),
    insertTranche: db.prepare(`
        INSERT INTO ml_commitment_tranches
        (user_id, resolved_env, tranche_id, setup_id, kind,
         size, market_response_score, decision_after, ts)
        VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?)
    `),
    getTranche: db.prepare(`
        SELECT * FROM ml_commitment_tranches WHERE tranche_id = ?
    `),
    updateTrancheDecision: db.prepare(`
        UPDATE ml_commitment_tranches
        SET decision_after = ?
        WHERE user_id = ? AND resolved_env = ? AND tranche_id = ?
    `)
};

// ── evaluateExpansionDecision (pure) ───────────────────────────────
function evaluateExpansionDecision(params) {
    const marketResponseScore = _required(params, 'marketResponseScore');
    const currentFilledRatio = _required(params, 'currentFilledRatio');
    const expansionThreshold = (params && params.expansionThreshold !== undefined)
        ? params.expansionThreshold : DEFAULT_EXPANSION_THRESHOLD;
    const abortThreshold = (params && params.abortThreshold !== undefined)
        ? params.abortThreshold : DEFAULT_ABORT_THRESHOLD;

    if (marketResponseScore < 0 || marketResponseScore > 1) {
        throw new Error('progressiveCommitment: marketResponseScore must be in [0,1]');
    }
    if (currentFilledRatio < 0) {
        throw new Error('progressiveCommitment: currentFilledRatio must be >= 0');
    }

    let decision;
    if (marketResponseScore < abortThreshold) decision = 'abort';
    else if (marketResponseScore >= expansionThreshold) {
        decision = currentFilledRatio >= FULL_FILL_TOLERANCE ? 'hold' : 'expand';
    } else {
        decision = 'hold';
    }
    return {
        decision, marketResponseScore, currentFilledRatio,
        expansionThreshold, abortThreshold
    };
}

// ── registerCommitmentSetup ────────────────────────────────────────
function registerCommitmentSetup(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const setupId = _required(params, 'setupId');
    const targetTotalSize = _required(params, 'targetTotalSize');
    if (targetTotalSize < 0) {
        throw new Error('progressiveCommitment: targetTotalSize must be >= 0');
    }
    const initialStatus = (params && params.initialStatus)
        ? params.initialStatus : 'probing';
    if (!SETUP_STATUSES.includes(initialStatus)) {
        throw new Error(
            `progressiveCommitment: invalid initialStatus "${initialStatus}"`
        );
    }
    const thesisId = (params && params.thesisId) ? params.thesisId : null;
    const ts = (params && params.ts) ? params.ts : Date.now();

    try {
        _stmts.insertSetup.run(
            userId, env, setupId, targetTotalSize,
            initialStatus, thesisId, ts, ts
        );
        return { registered: true, setupId, status: initialStatus };
    } catch (err) {
        if (err.code === 'SQLITE_CONSTRAINT_UNIQUE' ||
            (err.message && err.message.includes('UNIQUE'))) {
            throw new Error(`progressiveCommitment: duplicate setupId "${setupId}"`);
        }
        throw err;
    }
}

// ── addTranche ─────────────────────────────────────────────────────
function addTranche(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const trancheId = _required(params, 'trancheId');
    const setupId = _required(params, 'setupId');
    const kind = _required(params, 'kind');
    if (!TRANCHE_KINDS.includes(kind)) {
        throw new Error(`progressiveCommitment: invalid kind "${kind}"`);
    }
    const size = _required(params, 'size');
    const marketResponseScore = (params && params.marketResponseScore !== undefined)
        ? params.marketResponseScore : null;
    const ts = (params && params.ts) ? params.ts : Date.now();

    const setup = _stmts.getSetup.get(setupId);
    if (!setup) {
        throw new Error(`progressiveCommitment: setup "${setupId}" not found`);
    }
    if (setup.user_id !== userId || setup.resolved_env !== env) {
        throw new Error('progressiveCommitment: setup not owned by user/env');
    }
    if (setup.status === 'aborted' || setup.status === 'completed') {
        throw new Error(
            `progressiveCommitment: cannot add tranche to ${setup.status} setup`
        );
    }

    try {
        _stmts.insertTranche.run(
            userId, env, trancheId, setupId, kind,
            size, marketResponseScore, ts
        );
    } catch (err) {
        if (err.code === 'SQLITE_CONSTRAINT_UNIQUE' ||
            (err.message && err.message.includes('UNIQUE'))) {
            throw new Error(`progressiveCommitment: duplicate trancheId "${trancheId}"`);
        }
        throw err;
    }

    // Update filled size + status
    const sizeDelta = (kind === 'defensive_reduce') ? -size : size;
    const newFilled = Math.max(0, setup.current_filled_size + sizeDelta);
    const ratio = setup.target_total_size > 0
        ? newFilled / setup.target_total_size : 0;

    let newStatus = setup.status;
    if (ratio >= FULL_FILL_TOLERANCE) newStatus = 'full';
    else if (ratio >= CONFIRMING_FILL_THRESHOLD && newStatus === 'probing') {
        newStatus = 'confirming';
    }

    _stmts.updateSetup.run(
        newFilled, newStatus, ts, userId, env, setupId
    );
    return {
        added: true, trancheId, kind,
        newFilledSize: newFilled, newStatus
    };
}

// ── recordTrancheDecision ──────────────────────────────────────────
function recordTrancheDecision(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const trancheId = _required(params, 'trancheId');
    const decision = _required(params, 'decision');
    if (!EXPANSION_DECISIONS.includes(decision)) {
        throw new Error(`progressiveCommitment: invalid decision "${decision}"`);
    }

    const tranche = _stmts.getTranche.get(trancheId);
    if (!tranche) {
        throw new Error(`progressiveCommitment: tranche "${trancheId}" not found`);
    }
    if (tranche.user_id !== userId || tranche.resolved_env !== env) {
        throw new Error('progressiveCommitment: tranche not owned by user/env');
    }
    _stmts.updateTrancheDecision.run(decision, userId, env, trancheId);
    return { recorded: true, trancheId, decision };
}

// ── abortSetup ─────────────────────────────────────────────────────
function abortSetup(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const setupId = _required(params, 'setupId');
    const reason = (params && params.reason) ? params.reason : 'manual_abort';
    const ts = (params && params.ts) ? params.ts : Date.now();

    const setup = _stmts.getSetup.get(setupId);
    if (!setup) {
        throw new Error(`progressiveCommitment: setup "${setupId}" not found`);
    }
    if (setup.user_id !== userId || setup.resolved_env !== env) {
        throw new Error('progressiveCommitment: setup not owned by user/env');
    }
    _stmts.updateSetup.run(
        setup.current_filled_size, 'aborted', ts,
        userId, env, setupId
    );
    return { aborted: true, setupId, reason, previousStatus: setup.status };
}

// ── getActiveCommitments ───────────────────────────────────────────
function getActiveCommitments(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const status = params && params.status;
    const limit = (params && params.limit) ? params.limit : 100;

    if (status && !SETUP_STATUSES.includes(status)) {
        throw new Error(`progressiveCommitment: invalid status "${status}"`);
    }
    const rows = status
        ? _stmts.listSetupsByStatus.all(userId, env, status, limit)
        : _stmts.listSetups.all(userId, env, limit);
    return rows.map(r => ({
        setupId: r.setup_id,
        targetTotalSize: r.target_total_size,
        currentFilledSize: r.current_filled_size,
        status: r.status,
        thesisId: r.thesis_id,
        tsCreated: r.ts_created,
        tsLastUpdated: r.ts_last_updated
    }));
}

module.exports = {
    SETUP_STATUSES,
    TRANCHE_KINDS,
    EXPANSION_DECISIONS,
    DEFAULT_EXPANSION_THRESHOLD,
    DEFAULT_ABORT_THRESHOLD,
    evaluateExpansionDecision,
    registerCommitmentSetup,
    addTranche,
    recordTrancheDecision,
    abortSetup,
    getActiveCommitments
};
