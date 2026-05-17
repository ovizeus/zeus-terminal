'use strict';

/**
 * OMEGA §162-§166 (first batch) PHILOSOPHICAL PRINCIPLES REGISTER.
 * Canonical: /root/_review/ml_brain/ml_brain_canonic.txt lines 5446-5455.
 *
 * Consolidated register for ~40 bullet-only PDF points (§§162-241).
 * First seed cluster: active_inference_cluster (§162-§166).
 *
 * Tests FIRST per TDD discipline.
 */

const path = require('path');
const fs = require('fs');
const os = require('os');

const TEST_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-w3-p162-166-'));
const TEST_DB_PATH = path.join(TEST_DB_DIR, 'test.db');
process.env.ZEUS_DB_PATH = TEST_DB_PATH;
process.env.ZEUS_TEST_DISABLE_AUTH = '1';

const { db } = require('../../../server/services/database');
const M = require('../../../server/services/ml/_meta/philosophicalPrinciples');

const UID = 9162;
const UID_REG = 9262;
const UID_DEP = 9362;
const UID_GET = 9462;
const UID_ISO_A = 9562;
const UID_ISO_B = 9662;
const UID_ENV = 9762;
const ENV = 'DEMO';
const _now = () => Date.now();

function cleanRows() {
    const uids = [UID, UID_REG, UID_DEP, UID_GET, UID_ISO_A, UID_ISO_B, UID_ENV];
    const placeholders = uids.map(() => '?').join(',');
    db.prepare(`DELETE FROM ml_philosophical_principles_register WHERE user_id IN (${placeholders})`).run(...uids);
}
beforeEach(() => cleanRows());
afterAll(() => cleanRows());

describe('OMEGA §162-§166 PHILOSOPHICAL PRINCIPLES REGISTER', () => {

    describe('Migration 322', () => {
        test('322 applied', () => {
            expect(db.prepare("SELECT name FROM _migrations WHERE name=?").get('322_ml_philosophical_principles_register')).toBeTruthy();
        });
        test('principle_number range CHECK [162,241]', () => {
            expect(() => db.prepare(`INSERT INTO ml_philosophical_principles_register
                (user_id, resolved_env, principle_number, title, canonical_text,
                 cluster, active, registered_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
                .run(UID, ENV, 100, 't', 'ct', 'c', 1, _now())).toThrow();
            expect(() => db.prepare(`INSERT INTO ml_philosophical_principles_register
                (user_id, resolved_env, principle_number, title, canonical_text,
                 cluster, active, registered_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
                .run(UID, ENV, 250, 't', 'ct', 'c', 1, _now())).toThrow();
        });
        test('UNIQUE on (user_id, resolved_env, principle_number)', () => {
            const stmt = db.prepare(`INSERT INTO ml_philosophical_principles_register
                (user_id, resolved_env, principle_number, title, canonical_text,
                 cluster, active, registered_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
            stmt.run(UID, ENV, 162, 't', 'ct', 'c', 1, _now());
            expect(() => stmt.run(UID, ENV, 162, 't2', 'ct2', 'c2',
                1, _now())).toThrow();
        });
        test('active CHECK enum (0,1)', () => {
            expect(() => db.prepare(`INSERT INTO ml_philosophical_principles_register
                (user_id, resolved_env, principle_number, title, canonical_text,
                 cluster, active, registered_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
                .run(UID, ENV, 163, 't', 'ct', 'c', 2, _now())).toThrow();
        });
    });

    describe('PHILOSOPHICAL_PRINCIPLES_CATALOG (first batch §162-§166)', () => {
        test('catalog frozen', () => {
            expect(Object.isFrozen(M.PHILOSOPHICAL_PRINCIPLES_CATALOG)).toBe(true);
        });
        test('catalog has §162 entry with title containing "Free Energy"', () => {
            expect(M.PHILOSOPHICAL_PRINCIPLES_CATALOG[162]).toBeTruthy();
            expect(M.PHILOSOPHICAL_PRINCIPLES_CATALOG[162].title).toMatch(/Free Energy|Active Inference/i);
        });
        test('catalog has §163 entry with title containing "Principal-Agent"', () => {
            expect(M.PHILOSOPHICAL_PRINCIPLES_CATALOG[163]).toBeTruthy();
            expect(M.PHILOSOPHICAL_PRINCIPLES_CATALOG[163].title).toMatch(/Principal-Agent/i);
        });
        test('catalog has §164 entry with title containing "Temporal Texture"', () => {
            expect(M.PHILOSOPHICAL_PRINCIPLES_CATALOG[164]).toBeTruthy();
            expect(M.PHILOSOPHICAL_PRINCIPLES_CATALOG[164].title).toMatch(/Temporal Texture/i);
        });
        test('catalog has §165 entry with title containing "Decision Boundary"', () => {
            expect(M.PHILOSOPHICAL_PRINCIPLES_CATALOG[165]).toBeTruthy();
            expect(M.PHILOSOPHICAL_PRINCIPLES_CATALOG[165].title).toMatch(/Decision Boundary/i);
        });
        test('catalog has §166 entry with title containing "Market as Language"', () => {
            expect(M.PHILOSOPHICAL_PRINCIPLES_CATALOG[166]).toBeTruthy();
            expect(M.PHILOSOPHICAL_PRINCIPLES_CATALOG[166].title).toMatch(/Market as Language/i);
        });
        test('all §162-§166 entries have canonicalText non-empty', () => {
            for (const n of [162, 163, 164, 165, 166]) {
                expect(M.PHILOSOPHICAL_PRINCIPLES_CATALOG[n].canonicalText.length).toBeGreaterThan(50);
            }
        });
        test('all §162-§166 share cluster active_inference_cluster', () => {
            for (const n of [162, 163, 164, 165, 166]) {
                expect(M.PHILOSOPHICAL_PRINCIPLES_CATALOG[n].cluster).toBe('active_inference_cluster');
            }
        });
        test('CLUSTERS frozen list with active_inference_cluster', () => {
            expect(M.CLUSTERS).toContain('active_inference_cluster');
            expect(Object.isFrozen(M.CLUSTERS)).toBe(true);
        });
    });

    describe('PHILOSOPHICAL_PRINCIPLES_CATALOG (batch 2 §172-§176 reflexive_meta_cluster)', () => {
        test('catalog has §172 Reflexivity entry', () => {
            expect(M.PHILOSOPHICAL_PRINCIPLES_CATALOG[172]).toBeTruthy();
            expect(M.PHILOSOPHICAL_PRINCIPLES_CATALOG[172].title).toMatch(/Reflexivity/i);
        });
        test('catalog has §173 Axiological entry', () => {
            expect(M.PHILOSOPHICAL_PRINCIPLES_CATALOG[173]).toBeTruthy();
            expect(M.PHILOSOPHICAL_PRINCIPLES_CATALOG[173].title).toMatch(/Axiological/i);
        });
        test('catalog has §174 Gestalt entry', () => {
            expect(M.PHILOSOPHICAL_PRINCIPLES_CATALOG[174]).toBeTruthy();
            expect(M.PHILOSOPHICAL_PRINCIPLES_CATALOG[174].title).toMatch(/Gestalt/i);
        });
        test('catalog has §175 Strategic sequence entry', () => {
            expect(M.PHILOSOPHICAL_PRINCIPLES_CATALOG[175]).toBeTruthy();
            expect(M.PHILOSOPHICAL_PRINCIPLES_CATALOG[175].title).toMatch(/Strategic sequence/i);
        });
        test('catalog has §176 Apophenia entry', () => {
            expect(M.PHILOSOPHICAL_PRINCIPLES_CATALOG[176]).toBeTruthy();
            expect(M.PHILOSOPHICAL_PRINCIPLES_CATALOG[176].title).toMatch(/Apophenia/i);
        });
        test('all §172-§176 share cluster reflexive_meta_cluster', () => {
            for (const n of [172, 173, 174, 175, 176]) {
                expect(M.PHILOSOPHICAL_PRINCIPLES_CATALOG[n].cluster).toBe('reflexive_meta_cluster');
            }
        });
        test('all §172-§176 entries have canonicalText non-empty', () => {
            for (const n of [172, 173, 174, 175, 176]) {
                expect(M.PHILOSOPHICAL_PRINCIPLES_CATALOG[n].canonicalText.length).toBeGreaterThan(50);
            }
        });
        test('CLUSTERS contains reflexive_meta_cluster (batch 2)', () => {
            expect(M.CLUSTERS).toContain('reflexive_meta_cluster');
        });
        test('listClusterCatalog returns 5 for reflexive_meta_cluster', () => {
            const r = M.listClusterCatalog({
                cluster: 'reflexive_meta_cluster'
            });
            expect(r.length).toBe(5);
            const numbers = r.map(p => p.principleNumber).sort();
            expect(numbers).toEqual([172, 173, 174, 175, 176]);
        });
        test('countCatalogEntries returns 15 (5 batch1 + 5 batch2 + 5 batch3)', () => {
            expect(M.countCatalogEntries()).toBe(15);
        });
        test('registerPrinciple works for §172', () => {
            const r = M.registerPrinciple({
                userId: UID_REG, resolvedEnv: ENV,
                principleNumber: 172, ts: _now()
            });
            expect(r.registered).toBe(true);
            expect(r.cluster).toBe('reflexive_meta_cluster');
        });
        test('listByCluster works for reflexive_meta_cluster', () => {
            for (const n of [172, 173, 174]) {
                M.registerPrinciple({
                    userId: UID_GET, resolvedEnv: ENV,
                    principleNumber: n, ts: _now()
                });
            }
            const r = M.listByCluster({
                userId: UID_GET, resolvedEnv: ENV,
                cluster: 'reflexive_meta_cluster'
            });
            expect(r.length).toBe(3);
        });
    });

    describe('PHILOSOPHICAL_PRINCIPLES_CATALOG (batch 3 §182-§186 transcendental_cluster)', () => {
        test('catalog has §182 Transcendental preconditions', () => {
            expect(M.PHILOSOPHICAL_PRINCIPLES_CATALOG[182]).toBeTruthy();
            expect(M.PHILOSOPHICAL_PRINCIPLES_CATALOG[182].title).toMatch(/Transcendental/i);
        });
        test('catalog has §183 Docta ignorantia', () => {
            expect(M.PHILOSOPHICAL_PRINCIPLES_CATALOG[183]).toBeTruthy();
            expect(M.PHILOSOPHICAL_PRINCIPLES_CATALOG[183].title).toMatch(/Docta ignorantia/i);
        });
        test('catalog has §184 Internal observer contamination', () => {
            expect(M.PHILOSOPHICAL_PRINCIPLES_CATALOG[184]).toBeTruthy();
            expect(M.PHILOSOPHICAL_PRINCIPLES_CATALOG[184].title).toMatch(/Internal observer/i);
        });
        test('catalog has §185 Convergent validity', () => {
            expect(M.PHILOSOPHICAL_PRINCIPLES_CATALOG[185]).toBeTruthy();
            expect(M.PHILOSOPHICAL_PRINCIPLES_CATALOG[185].title).toMatch(/Convergent validity/i);
        });
        test('catalog has §186 phenomenology incipient error', () => {
            expect(M.PHILOSOPHICAL_PRINCIPLES_CATALOG[186]).toBeTruthy();
            expect(M.PHILOSOPHICAL_PRINCIPLES_CATALOG[186].title).toMatch(/phenomenology of incipient error/i);
        });
        test('all §182-§186 share cluster transcendental_cluster', () => {
            for (const n of [182, 183, 184, 185, 186]) {
                expect(M.PHILOSOPHICAL_PRINCIPLES_CATALOG[n].cluster).toBe('transcendental_cluster');
            }
        });
        test('CLUSTERS contains transcendental_cluster (batch 3)', () => {
            expect(M.CLUSTERS).toContain('transcendental_cluster');
        });
        test('listClusterCatalog returns 5 for transcendental_cluster', () => {
            const r = M.listClusterCatalog({
                cluster: 'transcendental_cluster'
            });
            expect(r.length).toBe(5);
            const numbers = r.map(p => p.principleNumber).sort();
            expect(numbers).toEqual([182, 183, 184, 185, 186]);
        });
        test('registerPrinciple works for §184', () => {
            const r = M.registerPrinciple({
                userId: UID_REG, resolvedEnv: ENV,
                principleNumber: 184, ts: _now()
            });
            expect(r.registered).toBe(true);
            expect(r.cluster).toBe('transcendental_cluster');
        });
    });

    describe('getPrincipleFromCatalog (pure)', () => {
        test('returns metadata for known principle', () => {
            const r = M.getPrincipleFromCatalog({ principleNumber: 162 });
            expect(r.title).toMatch(/Free Energy/i);
            expect(r.cluster).toBe('active_inference_cluster');
        });
        test('in-range but not-seeded principle throws "not in catalog"', () => {
            // §200 is in [162,241] range but not yet seeded in this batch
            expect(() => M.getPrincipleFromCatalog({
                principleNumber: 200
            })).toThrow(/not in catalog/i);
        });
        test('out-of-range principle throws (separate check)', () => {
            expect(() => M.getPrincipleFromCatalog({
                principleNumber: 999
            })).toThrow(/out of range/i);
        });
        test('range out of [162,241] throws', () => {
            expect(() => M.getPrincipleFromCatalog({
                principleNumber: 100
            })).toThrow();
        });
    });

    describe('listClusterCatalog (pure)', () => {
        test('returns 5 principles for active_inference_cluster', () => {
            const r = M.listClusterCatalog({
                cluster: 'active_inference_cluster'
            });
            expect(r.length).toBe(5);
            const numbers = r.map(p => p.principleNumber).sort();
            expect(numbers).toEqual([162, 163, 164, 165, 166]);
        });
        test('unknown cluster returns empty', () => {
            const r = M.listClusterCatalog({ cluster: 'nonexistent' });
            expect(r).toEqual([]);
        });
    });

    describe('countCatalogEntries (pure)', () => {
        test('returns at least 5 (current first batch)', () => {
            expect(M.countCatalogEntries()).toBeGreaterThanOrEqual(5);
        });
    });

    describe('registerPrinciple', () => {
        test('persists §162 with catalog-derived title + canonical text', () => {
            const r = M.registerPrinciple({
                userId: UID_REG, resolvedEnv: ENV,
                principleNumber: 162,
                ts: _now()
            });
            expect(r.registered).toBe(true);
            expect(r.principleNumber).toBe(162);
            expect(r.title).toMatch(/Free Energy/i);
            expect(r.active).toBe(1);
        });
        test('registering principle not in catalog throws', () => {
            expect(() => M.registerPrinciple({
                userId: UID_REG, resolvedEnv: ENV,
                principleNumber: 200,  // not yet seeded
                ts: _now()
            })).toThrow(/not in catalog/i);
        });
        test('duplicate (user × env × principle) throws', () => {
            M.registerPrinciple({
                userId: UID_REG, resolvedEnv: ENV,
                principleNumber: 163, ts: _now()
            });
            expect(() => M.registerPrinciple({
                userId: UID_REG, resolvedEnv: ENV,
                principleNumber: 163, ts: _now()
            })).toThrow(/duplicate|UNIQUE/i);
        });
        test('out-of-range principle number throws', () => {
            expect(() => M.registerPrinciple({
                userId: UID_REG, resolvedEnv: ENV,
                principleNumber: 100, ts: _now()
            })).toThrow();
        });
    });

    describe('deprecatePrinciple', () => {
        test('marks active=0 and sets deprecated_at', () => {
            M.registerPrinciple({
                userId: UID_DEP, resolvedEnv: ENV,
                principleNumber: 164, ts: _now()
            });
            const r = M.deprecatePrinciple({
                userId: UID_DEP, resolvedEnv: ENV,
                principleNumber: 164,
                ts: _now()
            });
            expect(r.deprecated).toBe(true);
            const active = M.getRegisteredPrinciples({
                userId: UID_DEP, resolvedEnv: ENV
            });
            expect(active.find(p => p.principleNumber === 164)).toBeUndefined();
        });
        test('deprecate of nonexistent throws', () => {
            expect(() => M.deprecatePrinciple({
                userId: UID_DEP, resolvedEnv: ENV,
                principleNumber: 165, ts: _now()
            })).toThrow(/not found/i);
        });
        test('deprecate already-deprecated is idempotent', () => {
            M.registerPrinciple({
                userId: UID_DEP, resolvedEnv: ENV,
                principleNumber: 166, ts: _now()
            });
            M.deprecatePrinciple({
                userId: UID_DEP, resolvedEnv: ENV,
                principleNumber: 166, ts: _now()
            });
            const r = M.deprecatePrinciple({
                userId: UID_DEP, resolvedEnv: ENV,
                principleNumber: 166, ts: _now()
            });
            expect(r.deprecated).toBe(true);
        });
    });

    describe('getRegisteredPrinciples & listByCluster', () => {
        test('returns active principles for user × env', () => {
            for (const n of [162, 163, 164]) {
                M.registerPrinciple({
                    userId: UID_GET, resolvedEnv: ENV,
                    principleNumber: n, ts: _now()
                });
            }
            const r = M.getRegisteredPrinciples({
                userId: UID_GET, resolvedEnv: ENV
            });
            expect(r.length).toBe(3);
        });
        test('listByCluster filters by cluster', () => {
            for (const n of [162, 163, 164, 165]) {
                M.registerPrinciple({
                    userId: UID_GET, resolvedEnv: ENV,
                    principleNumber: n, ts: _now()
                });
            }
            const r = M.listByCluster({
                userId: UID_GET, resolvedEnv: ENV,
                cluster: 'active_inference_cluster'
            });
            expect(r.length).toBe(4);
        });
    });

    describe('isolation per user × env', () => {
        test('uid isolation', () => {
            M.registerPrinciple({
                userId: UID_ISO_A, resolvedEnv: ENV,
                principleNumber: 162, ts: _now()
            });
            M.registerPrinciple({
                userId: UID_ISO_B, resolvedEnv: ENV,
                principleNumber: 163, ts: _now()
            });
            const a = M.getRegisteredPrinciples({
                userId: UID_ISO_A, resolvedEnv: ENV
            });
            expect(a.length).toBe(1);
            expect(a[0].principleNumber).toBe(162);
        });
        test('env isolation', () => {
            M.registerPrinciple({
                userId: UID_ENV, resolvedEnv: 'DEMO',
                principleNumber: 162, ts: _now()
            });
            const testnet = M.getRegisteredPrinciples({
                userId: UID_ENV, resolvedEnv: 'TESTNET'
            });
            expect(testnet).toEqual([]);
        });
    });
});
