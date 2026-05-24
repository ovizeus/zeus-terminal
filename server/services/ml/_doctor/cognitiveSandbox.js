'use strict';

/**
 * Doctor D-7 — cognitiveSandbox
 *
 * A/B module testing orchestrator that wraps R6 abTesting with Doctor
 * semantics. Each experiment tracks a moduleId and auto-captures a D-6
 * cognitive snapshot on completion.
 *
 * Lifecycle:
 *   createExperiment → (CREATED→RUNNING auto-start) → completeExperiment
 *
 * moduleId is stored as a JSON-encoded prefix in the experiment name so it
 * can be recovered without a separate table.
 */

const { db } = require('../../database');
const abTesting = require('../R6_shadowMeta/abTesting');
const versionRegistry = require('../R5B_governance/versionRegistry');

const DEFAULT_ALLOCATION_PCT_B = 50;
const DEFAULT_ACTOR = 'doctor_d7';

// ── Helpers ──────────────────────────────────────────────────────────

/**
 * Encode moduleId into the experiment name so it can be recovered later
 * without altering the schema.
 * Format: "d7:<moduleId>:<name>"
 */
function _encodeName(moduleId, name) {
    return `d7:${moduleId}:${name}`;
}

/**
 * Decode moduleId from a stored experiment name.
 * Returns null if name was not encoded by this module.
 */
function _decodeModuleId(storedName) {
    if (!storedName) return null;
    if (!storedName.startsWith('d7:')) return null;
    const parts = storedName.split(':');
    // parts[0] = 'd7', parts[1] = moduleId, rest = name segments
    return parts.length >= 3 ? parts[1] : null;
}

// ── Public API ────────────────────────────────────────────────────────

/**
 * createExperiment
 *
 * Proposes two versions in versionRegistry (one per variant config),
 * creates an R6 experiment, and immediately starts it so it enters
 * RUNNING state (required for future outcome recording + completion).
 *
 * @param {object} params
 * @param {string} params.moduleId         — logical module under test
 * @param {string} params.name             — human-readable experiment name
 * @param {object} params.variantAConfig   — config snapshot for arm A
 * @param {object} params.variantBConfig   — config snapshot for arm B
 * @param {number} [params.allocationPctB] — % traffic to arm B (default 50)
 * @param {string} [params.actor]          — who created this experiment
 * @returns {Promise<{experimentId: number}>}
 */
function createExperiment(params) {
    const moduleId = params && params.moduleId;
    const name = params && params.name;
    const variantAConfig = (params && params.variantAConfig) || {};
    const variantBConfig = (params && params.variantBConfig) || {};
    const allocationPctB = (params && params.allocationPctB != null)
        ? params.allocationPctB
        : DEFAULT_ALLOCATION_PCT_B;
    const actor = (params && params.actor) || DEFAULT_ACTOR;

    if (!moduleId) throw new Error('cognitiveSandbox.createExperiment: missing moduleId');
    if (!name) throw new Error('cognitiveSandbox.createExperiment: missing name');

    const ts = Date.now();
    let versionAId;
    try {
        const vA = versionRegistry.proposeVersion({
            componentType: 'model',
            componentId: `${moduleId}_variant_a`,
            version: `d7_${ts}_a`,
            config: variantAConfig,
            motivation: `D-7 sandbox experiment: ${name} (arm A)`,
            actor,
        });
        versionAId = vA.id;
    } catch (err) {
        throw new Error(`cognitiveSandbox.createExperiment: proposeVersion(A) failed — ${err.message}`);
    }

    let versionBId;
    try {
        const vB = versionRegistry.proposeVersion({
            componentType: 'model',
            componentId: `${moduleId}_variant_b`,
            version: `d7_${ts}_b`,
            config: variantBConfig,
            motivation: `D-7 sandbox experiment: ${name} (arm B)`,
            actor,
        });
        versionBId = vB.id;
    } catch (err) {
        throw new Error(`cognitiveSandbox.createExperiment: proposeVersion(B) failed — ${err.message}`);
    }

    let experimentId;
    try {
        const exp = abTesting.createExperiment({
            name: _encodeName(moduleId, name),
            versionAId,
            versionBId,
            allocationPctB,
            isolationMode: 'STRICT',
            actor,
        });
        experimentId = exp.experimentId;
    } catch (err) {
        throw new Error(`cognitiveSandbox.createExperiment: abTesting.createExperiment failed — ${err.message}`);
    }

    // Auto-start so the experiment enters RUNNING (required for completeExperiment)
    try {
        abTesting.startExperiment({ experimentId, actor });
    } catch (err) {
        throw new Error(`cognitiveSandbox.createExperiment: abTesting.startExperiment failed — ${err.message}`);
    }

    return { experimentId };
}

/**
 * getExperimentStatus
 *
 * Returns current state and metadata for an experiment, including the
 * decoded moduleId and the R6 metrics snapshot.
 *
 * @param {object} params
 * @param {number} params.experimentId
 * @returns {Promise<{experimentId, state, moduleId, metrics}>}
 */
function getExperimentStatus(params) {
    const experimentId = params && params.experimentId;
    if (!experimentId) throw new Error('cognitiveSandbox.getExperimentStatus: missing experimentId');

    let row;
    try {
        row = db.prepare('SELECT * FROM ml_experiments WHERE id = ?').get(experimentId);
    } catch (err) {
        throw new Error(`cognitiveSandbox.getExperimentStatus: DB query failed — ${err.message}`);
    }
    if (!row) throw new Error(`cognitiveSandbox.getExperimentStatus: experiment ${experimentId} not found`);

    let metrics = null;
    try {
        metrics = abTesting.getExperimentMetrics({ experimentId });
    } catch (_) {
        // metrics are optional; don't fail status on metric errors
    }

    return {
        experimentId: row.id,
        state: row.state,
        moduleId: _decodeModuleId(row.name),
        name: row.name,
        allocationPctB: row.allocation_pct_b,
        isolationMode: row.isolation_mode,
        createdAt: row.created_at,
        startedAt: row.started_at || null,
        completedAt: row.completed_at || null,
        metrics,
    };
}

/**
 * listExperiments
 *
 * Returns all experiments (optionally filtered by state) created by
 * this orchestrator. Includes decoded moduleId for each row.
 *
 * @param {object} [params]
 * @param {string} [params.state] — filter by EXPERIMENT_STATES value
 * @returns {Promise<Array>}
 */
function listExperiments(params) {
    const state = params && params.state;

    let rows;
    try {
        if (state) {
            rows = db.prepare(
                `SELECT * FROM ml_experiments WHERE state = ? ORDER BY created_at DESC`
            ).all(state);
        } else {
            rows = db.prepare(
                `SELECT * FROM ml_experiments ORDER BY created_at DESC`
            ).all();
        }
    } catch (err) {
        throw new Error(`cognitiveSandbox.listExperiments: DB query failed — ${err.message}`);
    }

    return rows.map(row => ({
        id: row.id,
        name: row.name,
        moduleId: _decodeModuleId(row.name),
        state: row.state,
        allocationPctB: row.allocation_pct_b,
        isolationMode: row.isolation_mode,
        createdAt: row.created_at,
        startedAt: row.started_at || null,
        completedAt: row.completed_at || null,
        actor: row.actor,
    }));
}

/**
 * completeExperiment
 *
 * Completes the R6 experiment and auto-captures a D-6 cognitive snapshot.
 * The experiment must be in RUNNING state.
 *
 * @param {object} params
 * @param {number} params.experimentId
 * @param {string} [params.actor]
 * @param {string} [params.reason]
 * @returns {Promise<{completed: boolean, experimentId, snapshotId}>}
 */
function completeExperiment(params) {
    const experimentId = params && params.experimentId;
    const actor = (params && params.actor) || DEFAULT_ACTOR;
    const reason = (params && params.reason) || 'D-7 sandbox experiment completed';

    if (!experimentId) throw new Error('cognitiveSandbox.completeExperiment: missing experimentId');

    try {
        abTesting.completeExperiment({ experimentId, actor, reason });
    } catch (err) {
        throw new Error(`cognitiveSandbox.completeExperiment: abTesting.completeExperiment failed — ${err.message}`);
    }

    // Auto-capture a D-6 cognitive snapshot on completion
    let snapshotId = null;
    try {
        const cognitiveSnapshot = require('./cognitiveSnapshot');
        const snap = cognitiveSnapshot.captureSnapshot({
            triggerType: 'scheduled',
            triggerEventId: String(experimentId),
        });
        snapshotId = snap.id;
    } catch (_) {
        // Snapshot failure must not block completion
    }

    return {
        completed: true,
        experimentId,
        snapshotId,
    };
}

module.exports = {
    createExperiment,
    getExperimentStatus,
    listExperiments,
    completeExperiment,
};
