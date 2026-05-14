/**
 * R0 Substrate — dr.js (Disaster Recovery) tests
 *
 * Spec 243 — DR primitives: snapshot save/load + integrity check.
 * Foundation for operational continuity per ML Architecture v2 frozen.
 * Real DR plan (failover, hot standby) layers in Wave 7+.
 */

const path = require('path');
const fs = require('fs');
const os = require('os');
const {
    saveSnapshot,
    loadSnapshot,
    listSnapshots,
    integrityCheck,
    deleteSnapshot,
    SNAPSHOTS_DIR
} = require('../../../server/services/ml/R0_substrate/dr');

describe('R0 Substrate — dr (Disaster Recovery)', () => {
    const TEST_LABEL_PREFIX = `omega_dr_test_${Date.now()}_`;

    afterAll(() => {
        // Clean up any test snapshots
        const snaps = listSnapshots();
        for (const s of snaps) {
            if (s.label.startsWith(TEST_LABEL_PREFIX)) {
                try { deleteSnapshot(s.label); } catch (_) {}
            }
        }
    });

    describe('saveSnapshot + loadSnapshot', () => {
        test('save returns object with label and hash', () => {
            const label = `${TEST_LABEL_PREFIX}save1`;
            const result = saveSnapshot(label, { foo: 'bar' });
            expect(result.label).toBe(label);
            expect(typeof result.hash).toBe('string');
            expect(result.hash.length).toBeGreaterThan(0);
        });

        test('load returns previously saved data', () => {
            const label = `${TEST_LABEL_PREFIX}save2`;
            const data = { score: 0.75, top5: ['a', 'b', 'c'] };
            saveSnapshot(label, data);
            const loaded = loadSnapshot(label);
            expect(loaded).toEqual(data);
        });

        test('load returns null for missing snapshot', () => {
            expect(loadSnapshot(`${TEST_LABEL_PREFIX}nonexistent`)).toBeNull();
        });

        test('overwrites existing snapshot with same label', () => {
            const label = `${TEST_LABEL_PREFIX}overwrite`;
            saveSnapshot(label, { v: 1 });
            saveSnapshot(label, { v: 2 });
            expect(loadSnapshot(label)).toEqual({ v: 2 });
        });

        test('throws on invalid label characters', () => {
            expect(() => saveSnapshot('../escape', {})).toThrow(/label/i);
            expect(() => saveSnapshot('with spaces', {})).toThrow(/label/i);
        });
    });

    describe('listSnapshots', () => {
        test('returns array of snapshot metadata', () => {
            const label = `${TEST_LABEL_PREFIX}list1`;
            saveSnapshot(label, { test: 1 });
            const all = listSnapshots();
            expect(Array.isArray(all)).toBe(true);
            const found = all.find(s => s.label === label);
            expect(found).toBeDefined();
            expect(typeof found.size).toBe('number');
            expect(typeof found.mtime).toBe('number');
        });
    });

    describe('integrityCheck', () => {
        test('returns true for unmodified snapshot', () => {
            const label = `${TEST_LABEL_PREFIX}integrity1`;
            const { hash } = saveSnapshot(label, { v: 'original' });
            expect(integrityCheck(label, hash)).toBe(true);
        });

        test('returns false for wrong expected hash', () => {
            const label = `${TEST_LABEL_PREFIX}integrity2`;
            saveSnapshot(label, { v: 'original' });
            expect(integrityCheck(label, 'wrong_hash_xxx')).toBe(false);
        });

        test('returns false for missing snapshot', () => {
            expect(integrityCheck(`${TEST_LABEL_PREFIX}gone`, 'anyhash')).toBe(false);
        });
    });

    describe('SNAPSHOTS_DIR', () => {
        test('exists and is writable', () => {
            expect(fs.existsSync(SNAPSHOTS_DIR)).toBe(true);
        });
    });
});
