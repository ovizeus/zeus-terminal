'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');

const TEST_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'doctor-seed-'));
process.env.ZEUS_DB_PATH = path.join(TEST_DB_DIR, 'test.db');
process.env.ZEUS_TEST_DISABLE_AUTH = '1';

const { db } = require('../../../server/services/database');
const registry = require('../../../server/services/ml/_doctor/moduleRegistry');
const seed = require('../../../server/services/ml/_doctor/seedRegistry');

describe('D-1.3 seedRegistry', () => {
    beforeAll(() => {
        db.prepare("DELETE FROM ml_module_registry").run();
        seed.runSeed();
    });

    test('seeds expected canonical module count', () => {
        // Initial seed: ~50 ops-critical modules + 8 cluster register entries +
        // 1 Doctor's own service. Future commits expand this.
        const all = registry.listAll();
        expect(all.length).toBeGreaterThanOrEqual(50);
    });

    test('seeds hot_path_critical execution modules', () => {
        const hpc = registry.getModulesByTag({ roleTag: 'hot_path_critical' });
        expect(hpc.length).toBeGreaterThan(0);
        const ids = hpc.map(m => m.moduleId);
        expect(ids).toContain('positionStateMachine');
    });

    test('seeds the 8 philosophical cluster entries', () => {
        const philos = registry.getModulesByTag({ roleTag: 'philosophical' });
        expect(philos.length).toBe(8);
        const ids = philos.map(m => m.moduleId).sort();
        expect(ids).toEqual([
            'cluster_active_inference', 'cluster_constitutive',
            'cluster_incompleteness', 'cluster_kairos', 'cluster_limit',
            'cluster_reflexive_meta', 'cluster_reflexive_temporal',
            'cluster_transcendental'
        ]);
    });

    test('seeds Doctor own module (self-contract)', () => {
        const self = registry.getModule({ moduleId: '_doctor_moduleRegistry' });
        expect(self).toBeTruthy();
        expect(self.roleTag).toBe('forensic');
        expect(self.contract.failurePolicy).toBe('halt');
    });

    test('DAG validation passes (no cycles in seeded set)', () => {
        const r = registry.validateDAG();
        expect(r.hardFail).toBe(false);
        expect(r.cycles).toEqual([]);
    });

    test('seed is idempotent (running twice does not error)', () => {
        // Second run should be a no-op due to getModule guard
        expect(() => seed.runSeed()).not.toThrow();
    });

    test('SEED_ENTRIES is frozen', () => {
        expect(Object.isFrozen(seed.SEED_ENTRIES)).toBe(true);
    });

    test('every seed entry has all 7 contract fields', () => {
        for (const e of seed.SEED_ENTRIES) {
            for (const field of registry.REQUIRED_CONTRACT_FIELDS) {
                expect(e.contract[field]).toBeDefined();
            }
        }
    });

    test('no seed entry has duplicate moduleId', () => {
        const ids = seed.SEED_ENTRIES.map(e => e.moduleId);
        const unique = new Set(ids);
        expect(unique.size).toBe(ids.length);
    });
});
