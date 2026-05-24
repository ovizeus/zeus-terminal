'use strict';

/**
 * Doctor D-7 — cognitiveSandbox tests
 *
 * A/B module testing orchestrator that wraps R6 abTesting with Doctor semantics.
 */

const { db } = require('../../../server/services/database');
const {
    createExperiment,
    getExperimentStatus,
    listExperiments,
    completeExperiment,
} = require('../../../server/services/ml/_doctor/cognitiveSandbox');

describe('Doctor D-7 — cognitiveSandbox', () => {
    const TEST_ACTOR = `d7_sandbox_test_${Date.now()}`;
    const TEST_MODULE = `test_module_${Date.now()}`;
    let createdExperimentId = null;

    afterAll(() => {
        // Clean up test experiments
        const expIds = db.prepare(
            `SELECT id FROM ml_experiments WHERE actor = ?`
        ).all(TEST_ACTOR).map(r => r.id);
        for (const id of expIds) {
            db.prepare(`DELETE FROM ml_experiment_outcomes WHERE experiment_id = ?`).run(id);
        }
        db.prepare(`DELETE FROM ml_experiments WHERE actor = ?`).run(TEST_ACTOR);
        // Clean up governance versions created for test
        db.prepare(`DELETE FROM ml_governance_versions WHERE actor = ?`).run(TEST_ACTOR);
    });

    // ── Test 1: createExperiment ───────────────────────────────────
    test('createExperiment returns experimentId > 0', async () => {
        const result = await createExperiment({
            moduleId: TEST_MODULE,
            name: `d7_sandbox_exp_${Date.now()}`,
            variantAConfig: { strategy: 'conservative', threshold: 0.5 },
            variantBConfig: { strategy: 'aggressive', threshold: 0.7 },
            allocationPctB: 30,
            actor: TEST_ACTOR,
        });
        expect(result).toBeDefined();
        expect(typeof result.experimentId).toBe('number');
        expect(result.experimentId).toBeGreaterThan(0);
        createdExperimentId = result.experimentId;
    });

    // ── Test 2: getExperimentStatus ────────────────────────────────
    test('getExperimentStatus returns state + moduleId', async () => {
        expect(createdExperimentId).not.toBeNull();
        const status = await getExperimentStatus({ experimentId: createdExperimentId });
        expect(status).toBeDefined();
        expect(status.state).toBeDefined();
        expect(typeof status.state).toBe('string');
        expect(status.moduleId).toBe(TEST_MODULE);
    });

    // ── Test 3: listExperiments ────────────────────────────────────
    test('listExperiments returns array with created experiments', async () => {
        const list = await listExperiments({});
        expect(Array.isArray(list)).toBe(true);
        // The experiment we created should appear in the list
        const found = list.find(e => e.id === createdExperimentId);
        expect(found).toBeDefined();
    });

    // ── Test 4: completeExperiment ─────────────────────────────────
    test('completeExperiment returns completed: true', async () => {
        expect(createdExperimentId).not.toBeNull();
        const result = await completeExperiment({ experimentId: createdExperimentId });
        expect(result).toBeDefined();
        expect(result.completed).toBe(true);
    });
});
