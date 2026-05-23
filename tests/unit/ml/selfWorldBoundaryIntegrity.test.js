'use strict';

/**
 * OMEGA §189 SELF-WORLD BOUNDARY INTEGRITY / ENDOGENEITY SEPARATION ENGINE.
 * Canonical: lines 6093-6151.
 */

const path = require('path');
const fs = require('fs');
const os = require('os');

const TEST_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-w3-p189-'));
const TEST_DB_PATH = path.join(TEST_DB_DIR, 'test.db');
process.env.ZEUS_DB_PATH = TEST_DB_PATH;
process.env.ZEUS_TEST_DISABLE_AUTH = '1';

const { db } = require('../../../server/services/database');
const M = require('../../../server/services/ml/_audit/selfWorldBoundaryIntegrity');

const UID = 9189;
const UID_R = 9289;
const UID_GET = 9389;
const UID_ISO_A = 9489;
const UID_ISO_B = 9589;
const UID_ENV = 9689;
const ENV = 'DEMO';
const _now = () => Date.now();

function cleanRows() {
    const uids = [UID, UID_R, UID_GET, UID_ISO_A, UID_ISO_B, UID_ENV];
    const placeholders = uids.map(() => '?').join(',');
    db.prepare(`DELETE FROM ml_self_world_boundary_attributions WHERE user_id IN (${placeholders})`).run(...uids);
}
beforeEach(() => cleanRows());
afterAll(() => cleanRows());

describe('OMEGA §189 SELF-WORLD BOUNDARY INTEGRITY', () => {

    describe('Migration 336', () => {
        test('336 applied', () => {
            expect(db.prepare("SELECT name FROM _migrations WHERE name=?").get('336_ml_self_world_boundary_attributions')).toBeTruthy();
        });
        test('attribution CHECK enum (4)', () => {
            expect(() => db.prepare(`INSERT INTO ml_self_world_boundary_attributions
                (user_id, resolved_env, attribution_id, change_label,
                 internal_change_magnitude, external_change_magnitude,
                 attribution, boundary_integrity_score,
                 conservative_mode_flag, reasoning, ts)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
                .run(UID, ENV, 'a_bk', 'l', 0.5, 0.5, 'BOGUS', 0.5, 0,
                    null, _now())).toThrow();
        });
        test('attribution_id UNIQUE', () => {
            const stmt = db.prepare(`INSERT INTO ml_self_world_boundary_attributions
                (user_id, resolved_env, attribution_id, change_label,
                 internal_change_magnitude, external_change_magnitude,
                 attribution, boundary_integrity_score,
                 conservative_mode_flag, reasoning, ts)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
            stmt.run(UID, ENV, 'a_dup', 'l', 0.8, 0.2, 'i_moved', 0.8, 0, null, _now());
            expect(() => stmt.run(UID, ENV, 'a_dup', 'l', 0.2, 0.8,
                'world_moved', 0.8, 0, null, _now())).toThrow();
        });
    });

    describe('Constants', () => {
        test('ATTRIBUTIONS frozen 4', () => {
            expect(M.ATTRIBUTIONS).toEqual([
                'world_moved', 'i_moved', 'both_moved', 'unclear_attribution'
            ]);
            expect(Object.isFrozen(M.ATTRIBUTIONS)).toBe(true);
        });
        test('INTERNAL_SOURCES frozen 4 (canonical PDF)', () => {
            expect(M.INTERNAL_SOURCES).toEqual([
                'self_revision', 'model_updates',
                'ontology_changes', 'source_reweighting'
            ]);
            expect(Object.isFrozen(M.INTERNAL_SOURCES)).toBe(true);
        });
        test('EXTERNAL_SOURCES frozen 3 (canonical PDF)', () => {
            expect(M.EXTERNAL_SOURCES).toEqual([
                'market_changes_real', 'venue_shifts', 'macro_regime_changes'
            ]);
            expect(Object.isFrozen(M.EXTERNAL_SOURCES)).toBe(true);
        });
        test('UNCLEAR_GAP_THRESHOLD = 0.20', () => {
            expect(M.UNCLEAR_GAP_THRESHOLD).toBe(0.20);
        });
        test('DOMINANT_THRESHOLD = 0.30', () => {
            expect(M.DOMINANT_THRESHOLD).toBe(0.30);
        });
    });

    describe('classifyAttribution (pure)', () => {
        test('only external → world_moved', () => {
            const r = M.classifyAttribution({
                internalMagnitude: 0.10, externalMagnitude: 0.85
            });
            expect(r.attribution).toBe('world_moved');
        });
        test('only internal → i_moved', () => {
            const r = M.classifyAttribution({
                internalMagnitude: 0.85, externalMagnitude: 0.10
            });
            expect(r.attribution).toBe('i_moved');
        });
        test('both high → both_moved', () => {
            const r = M.classifyAttribution({
                internalMagnitude: 0.70, externalMagnitude: 0.75
            });
            expect(r.attribution).toBe('both_moved');
        });
        test('both moderate similar → unclear_attribution', () => {
            const r = M.classifyAttribution({
                internalMagnitude: 0.45, externalMagnitude: 0.50
            });
            expect(r.attribution).toBe('unclear_attribution');
        });
        test('out-of-range throws', () => {
            expect(() => M.classifyAttribution({
                internalMagnitude: 1.5, externalMagnitude: 0.5
            })).toThrow();
        });
    });

    describe('computeBoundaryIntegrityScore (pure)', () => {
        test('clear separation → high integrity', () => {
            const r = M.computeBoundaryIntegrityScore({
                internalMagnitude: 0.10, externalMagnitude: 0.85
            });
            expect(r.integrityScore).toBeGreaterThan(0.70);
        });
        test('both equal moderate → low integrity', () => {
            const r = M.computeBoundaryIntegrityScore({
                internalMagnitude: 0.50, externalMagnitude: 0.50
            });
            expect(r.integrityScore).toBeLessThan(0.30);
        });
        test('out-of-range throws', () => {
            expect(() => M.computeBoundaryIntegrityScore({
                internalMagnitude: 1.5, externalMagnitude: 0.5
            })).toThrow();
        });
    });

    describe('requiresConservativeMode (pure)', () => {
        test('unclear_attribution → conservative mode', () => {
            const r = M.requiresConservativeMode({
                attribution: 'unclear_attribution'
            });
            expect(r.conservativeMode).toBe(1);
        });
        test('clear attributions → no conservative mode', () => {
            expect(M.requiresConservativeMode({ attribution: 'world_moved' }).conservativeMode).toBe(0);
            expect(M.requiresConservativeMode({ attribution: 'i_moved' }).conservativeMode).toBe(0);
        });
        test('both_moved → conservative (mixed signals)', () => {
            // Both moving simultaneously is risky too
            const r = M.requiresConservativeMode({ attribution: 'both_moved' });
            expect(r.conservativeMode).toBe(1);
        });
        test('invalid throws', () => {
            expect(() => M.requiresConservativeMode({
                attribution: 'BOGUS'
            })).toThrow();
        });
    });

    describe('recordBoundaryAttribution', () => {
        test('clear external change → world_moved, no conservative', () => {
            const r = M.recordBoundaryAttribution({
                userId: UID_R, resolvedEnv: ENV,
                attributionId: 'rb_world',
                changeLabel: 'BTC dropped 8% on macro news',
                internalChangeMagnitude: 0.10,
                externalChangeMagnitude: 0.85,
                reasoning: 'macro shock dominant signal',
                ts: _now()
            });
            expect(r.recorded).toBe(true);
            expect(r.attribution).toBe('world_moved');
            expect(r.conservativeModeFlag).toBe(0);
        });
        test('only internal model change → i_moved', () => {
            const r = M.recordBoundaryAttribution({
                userId: UID_R, resolvedEnv: ENV,
                attributionId: 'rb_self',
                changeLabel: 'updated ontology classification of regime',
                internalChangeMagnitude: 0.85,
                externalChangeMagnitude: 0.10,
                ts: _now()
            });
            expect(r.attribution).toBe('i_moved');
        });
        test('unclear attribution → conservative_mode_flag=1', () => {
            const r = M.recordBoundaryAttribution({
                userId: UID_R, resolvedEnv: ENV,
                attributionId: 'rb_unclear',
                changeLabel: 'simultaneous internal+external shift',
                internalChangeMagnitude: 0.45,
                externalChangeMagnitude: 0.50,
                ts: _now()
            });
            expect(r.attribution).toBe('unclear_attribution');
            expect(r.conservativeModeFlag).toBe(1);
        });
        test('duplicate attributionId throws', () => {
            M.recordBoundaryAttribution({
                userId: UID_R, resolvedEnv: ENV,
                attributionId: 'rb_dup', changeLabel: 'l',
                internalChangeMagnitude: 0.5, externalChangeMagnitude: 0.5,
                ts: _now()
            });
            expect(() => M.recordBoundaryAttribution({
                userId: UID_R, resolvedEnv: ENV,
                attributionId: 'rb_dup', changeLabel: 'l',
                internalChangeMagnitude: 0.5, externalChangeMagnitude: 0.5,
                ts: _now()
            })).toThrow(/duplicate/);
        });
    });

    describe('getRecentAttributions & getStatsByAttribution', () => {
        test('filter by attribution', () => {
            M.recordBoundaryAttribution({
                userId: UID_GET, resolvedEnv: ENV,
                attributionId: 'g_w', changeLabel: 'l',
                internalChangeMagnitude: 0.10, externalChangeMagnitude: 0.85,
                ts: _now()
            });
            M.recordBoundaryAttribution({
                userId: UID_GET, resolvedEnv: ENV,
                attributionId: 'g_i', changeLabel: 'l',
                internalChangeMagnitude: 0.85, externalChangeMagnitude: 0.10,
                ts: _now()
            });
            const worldOnly = M.getRecentAttributions({
                userId: UID_GET, resolvedEnv: ENV,
                attribution: 'world_moved'
            });
            expect(worldOnly.length).toBe(1);
        });
        test('stats by attribution', () => {
            M.recordBoundaryAttribution({
                userId: UID_GET, resolvedEnv: ENV,
                attributionId: 'gs_1', changeLabel: 'l',
                internalChangeMagnitude: 0.10, externalChangeMagnitude: 0.85,
                ts: 1000
            });
            const stats = M.getStatsByAttribution({
                userId: UID_GET, resolvedEnv: ENV, sinceTs: 0
            });
            expect(stats.world_moved).toBe(1);
            expect(stats.totalCount).toBe(1);
        });
    });

    describe('isolation', () => {
        test('uid + env', () => {
            M.recordBoundaryAttribution({
                userId: UID_ISO_A, resolvedEnv: ENV,
                attributionId: 'iso_a', changeLabel: 'l',
                internalChangeMagnitude: 0.5, externalChangeMagnitude: 0.5,
                ts: _now()
            });
            expect(M.getRecentAttributions({
                userId: UID_ISO_B, resolvedEnv: ENV
            })).toEqual([]);
            expect(M.getRecentAttributions({
                userId: UID_ISO_A, resolvedEnv: 'TESTNET'
            })).toEqual([]);
        });
    });
});
