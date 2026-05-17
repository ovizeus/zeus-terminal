'use strict';

/**
 * OMEGA §179 WORLDHOOD PRESSURE INDEX / HOW-MUCH-REALITY-IS-NOT-FITTING.
 * Canonical: /root/_review/ml_brain/ml_brain_canonic.txt lines 5834-5884.
 *
 * "cat de multa realitate incepe sa nu mai incapa in lumea mea interna?"
 *
 * Tests FIRST per TDD discipline.
 */

const path = require('path');
const fs = require('fs');
const os = require('os');

const TEST_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-w3-p179-'));
const TEST_DB_PATH = path.join(TEST_DB_DIR, 'test.db');
process.env.ZEUS_DB_PATH = TEST_DB_PATH;
process.env.ZEUS_TEST_DISABLE_AUTH = '1';

const { db } = require('../../../server/services/database');
const M = require('../../../server/services/ml/_meta/worldhoodPressureIndex');

const UID = 9179;
const UID_R = 9279;
const UID_GET = 9379;
const UID_ISO_A = 9479;
const UID_ISO_B = 9579;
const UID_ENV = 9679;
const ENV = 'DEMO';
const _now = () => Date.now();

const HEALTHY = {
    unexplainedResiduals: 0.10, ontologyStrain: 0.15,
    unknownPressure: 0.20, narrativeFractures: 0.10,
    weakSemanticGrounding: 0.15, repeatedLowDignityExplanations: 0.10,
    regimeGrammarTension: 0.15
};
const SEVERE = {
    // All components ≥ 0.85 for composite to clear observer_retreat threshold
    unexplainedResiduals: 0.92, ontologyStrain: 0.88,
    unknownPressure: 0.90, narrativeFractures: 0.92,
    weakSemanticGrounding: 0.85, repeatedLowDignityExplanations: 0.88,
    regimeGrammarTension: 0.90
};

function cleanRows() {
    const uids = [UID, UID_R, UID_GET, UID_ISO_A, UID_ISO_B, UID_ENV];
    const placeholders = uids.map(() => '?').join(',');
    db.prepare(`DELETE FROM ml_worldhood_pressure_snapshots WHERE user_id IN (${placeholders})`).run(...uids);
}
beforeEach(() => cleanRows());
afterAll(() => cleanRows());

describe('OMEGA §179 WORLDHOOD PRESSURE INDEX', () => {

    describe('Migration 331', () => {
        test('331 applied', () => {
            expect(db.prepare("SELECT name FROM _migrations WHERE name=?").get('331_ml_worldhood_pressure_snapshots')).toBeTruthy();
        });
        test('recommended_action CHECK enum (5)', () => {
            expect(() => db.prepare(`INSERT INTO ml_worldhood_pressure_snapshots
                (user_id, resolved_env, snapshot_id, unexplained_residuals,
                 ontology_strain, unknown_pressure, narrative_fractures,
                 weak_semantic_grounding, repeated_low_dignity_explanations,
                 regime_grammar_tension, composite_pressure_score,
                 recommended_action, trend_direction, persistent_zones_json,
                 reasoning, ts)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
                .run(UID, ENV, 's_bk', 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5,
                    0.5, 'BOGUS', 'steady', '[]', null, _now())).toThrow();
        });
        test('trend_direction CHECK enum (3)', () => {
            expect(() => db.prepare(`INSERT INTO ml_worldhood_pressure_snapshots
                (user_id, resolved_env, snapshot_id, unexplained_residuals,
                 ontology_strain, unknown_pressure, narrative_fractures,
                 weak_semantic_grounding, repeated_low_dignity_explanations,
                 regime_grammar_tension, composite_pressure_score,
                 recommended_action, trend_direction, persistent_zones_json,
                 reasoning, ts)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
                .run(UID, ENV, 's_td', 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5,
                    0.5, 'continue', 'BOGUS', '[]', null, _now())).toThrow();
        });
        test('range CHECK on all 7 components', () => {
            expect(() => db.prepare(`INSERT INTO ml_worldhood_pressure_snapshots
                (user_id, resolved_env, snapshot_id, unexplained_residuals,
                 ontology_strain, unknown_pressure, narrative_fractures,
                 weak_semantic_grounding, repeated_low_dignity_explanations,
                 regime_grammar_tension, composite_pressure_score,
                 recommended_action, trend_direction, persistent_zones_json,
                 reasoning, ts)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
                .run(UID, ENV, 's_br', 1.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5,
                    0.5, 'continue', 'steady', '[]', null, _now())).toThrow();
        });
        test('snapshot_id UNIQUE', () => {
            const stmt = db.prepare(`INSERT INTO ml_worldhood_pressure_snapshots
                (user_id, resolved_env, snapshot_id, unexplained_residuals,
                 ontology_strain, unknown_pressure, narrative_fractures,
                 weak_semantic_grounding, repeated_low_dignity_explanations,
                 regime_grammar_tension, composite_pressure_score,
                 recommended_action, trend_direction, persistent_zones_json,
                 reasoning, ts)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
            stmt.run(UID, ENV, 's_dup', 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5,
                0.5, 'continue', 'steady', '[]', null, _now());
            expect(() => stmt.run(UID, ENV, 's_dup', 0.5, 0.5, 0.5, 0.5, 0.5,
                0.5, 0.5, 0.5, 'simplify', 'rising', '[]', null, _now())).toThrow();
        });
    });

    describe('Constants', () => {
        test('PRESSURE_COMPONENTS frozen 7 (canonical PDF list)', () => {
            expect(M.PRESSURE_COMPONENTS).toEqual([
                'unexplainedResiduals', 'ontologyStrain',
                'unknownPressure', 'narrativeFractures',
                'weakSemanticGrounding', 'repeatedLowDignityExplanations',
                'regimeGrammarTension'
            ]);
            expect(Object.isFrozen(M.PRESSURE_COMPONENTS)).toBe(true);
        });
        test('RECOMMENDED_ACTIONS frozen 5 (canonical PDF list)', () => {
            expect(M.RECOMMENDED_ACTIONS).toEqual([
                'continue', 'simplify', 'research_escalation',
                'ontology_revision', 'observer_retreat'
            ]);
            expect(Object.isFrozen(M.RECOMMENDED_ACTIONS)).toBe(true);
        });
        test('TREND_DIRECTIONS frozen 3', () => {
            expect(M.TREND_DIRECTIONS).toEqual(['rising', 'steady', 'falling']);
            expect(Object.isFrozen(M.TREND_DIRECTIONS)).toBe(true);
        });
        test('PRESSURE_THRESHOLDS ordered', () => {
            expect(M.PRESSURE_THRESHOLDS.observer_retreat).toBe(0.85);
            expect(M.PRESSURE_THRESHOLDS.ontology_revision).toBe(0.70);
            expect(M.PRESSURE_THRESHOLDS.research_escalation).toBe(0.55);
            expect(M.PRESSURE_THRESHOLDS.simplify).toBe(0.40);
        });
        test('TREND_DELTA_THRESHOLD = 0.05', () => {
            expect(M.TREND_DELTA_THRESHOLD).toBe(0.05);
        });
        test('PERSISTENCE_WINDOW = 3', () => {
            expect(M.PERSISTENCE_WINDOW).toBe(3);
        });
    });

    describe('computeWorldhoodPressureScore (pure)', () => {
        test('all components low → low pressure', () => {
            const r = M.computeWorldhoodPressureScore({ components: HEALTHY });
            expect(r.pressureScore).toBeLessThan(0.20);
        });
        test('all components high → high pressure', () => {
            const r = M.computeWorldhoodPressureScore({ components: SEVERE });
            expect(r.pressureScore).toBeGreaterThan(0.75);
        });
        test('equal-weighted (1/7 each) → mean', () => {
            const r = M.computeWorldhoodPressureScore({
                components: {
                    unexplainedResiduals: 0.5, ontologyStrain: 0.5,
                    unknownPressure: 0.5, narrativeFractures: 0.5,
                    weakSemanticGrounding: 0.5, repeatedLowDignityExplanations: 0.5,
                    regimeGrammarTension: 0.5
                }
            });
            expect(r.pressureScore).toBeCloseTo(0.5, 5);
        });
        test('missing component throws', () => {
            const partial = { ...HEALTHY };
            delete partial.ontologyStrain;
            expect(() => M.computeWorldhoodPressureScore({
                components: partial
            })).toThrow();
        });
        test('out-of-range throws', () => {
            expect(() => M.computeWorldhoodPressureScore({
                components: { ...HEALTHY, ontologyStrain: 1.5 }
            })).toThrow();
        });
    });

    describe('classifyRecommendedAction (pure)', () => {
        test('pressure ≥ 0.85 → observer_retreat', () => {
            const r = M.classifyRecommendedAction({ pressureScore: 0.90 });
            expect(r.action).toBe('observer_retreat');
        });
        test('pressure 0.70..0.85 → ontology_revision', () => {
            const r = M.classifyRecommendedAction({ pressureScore: 0.75 });
            expect(r.action).toBe('ontology_revision');
        });
        test('pressure 0.55..0.70 → research_escalation', () => {
            const r = M.classifyRecommendedAction({ pressureScore: 0.60 });
            expect(r.action).toBe('research_escalation');
        });
        test('pressure 0.40..0.55 → simplify', () => {
            const r = M.classifyRecommendedAction({ pressureScore: 0.45 });
            expect(r.action).toBe('simplify');
        });
        test('pressure < 0.40 → continue', () => {
            const r = M.classifyRecommendedAction({ pressureScore: 0.20 });
            expect(r.action).toBe('continue');
        });
        test('boundary 0.85 → observer_retreat', () => {
            const r = M.classifyRecommendedAction({ pressureScore: 0.85 });
            expect(r.action).toBe('observer_retreat');
        });
    });

    describe('detectTrend (pure)', () => {
        test('clearly rising sequence → rising', () => {
            const r = M.detectTrend({
                recentScores: [0.20, 0.30, 0.45, 0.55, 0.65]
            });
            expect(r.trendDirection).toBe('rising');
        });
        test('clearly falling sequence → falling', () => {
            const r = M.detectTrend({
                recentScores: [0.65, 0.55, 0.45, 0.30, 0.20]
            });
            expect(r.trendDirection).toBe('falling');
        });
        test('flat sequence (delta < threshold) → steady', () => {
            const r = M.detectTrend({
                recentScores: [0.50, 0.51, 0.49, 0.50, 0.52]
            });
            expect(r.trendDirection).toBe('steady');
        });
        test('empty array → steady (no data)', () => {
            const r = M.detectTrend({ recentScores: [] });
            expect(r.trendDirection).toBe('steady');
        });
        test('single value → steady', () => {
            const r = M.detectTrend({ recentScores: [0.5] });
            expect(r.trendDirection).toBe('steady');
        });
    });

    describe('detectPersistentPressure (pure)', () => {
        test('all 3 recent above threshold → persistent', () => {
            const r = M.detectPersistentPressure({
                recentScores: [0.75, 0.80, 0.78],
                threshold: 0.70
            });
            expect(r.persistent).toBe(true);
        });
        test('only 1 of 3 above → not persistent', () => {
            const r = M.detectPersistentPressure({
                recentScores: [0.75, 0.30, 0.40],
                threshold: 0.70
            });
            expect(r.persistent).toBe(false);
        });
        test('insufficient data (< window) → not persistent', () => {
            const r = M.detectPersistentPressure({
                recentScores: [0.95, 0.90],
                threshold: 0.70
            });
            expect(r.persistent).toBe(false);
        });
    });

    describe('recordWorldhoodPressureSnapshot', () => {
        test('healthy state → continue + low pressure', () => {
            const r = M.recordWorldhoodPressureSnapshot({
                userId: UID_R, resolvedEnv: ENV,
                snapshotId: 'rs_healthy',
                components: HEALTHY,
                recentScores: [],
                persistentZones: [],
                ts: _now()
            });
            expect(r.recorded).toBe(true);
            expect(r.compositePressureScore).toBeLessThan(0.20);
            expect(r.recommendedAction).toBe('continue');
            expect(r.trendDirection).toBe('steady');
        });
        test('severe state → observer_retreat', () => {
            const r = M.recordWorldhoodPressureSnapshot({
                userId: UID_R, resolvedEnv: ENV,
                snapshotId: 'rs_severe',
                components: SEVERE,
                recentScores: [],
                persistentZones: ['cryptoMacroDecoupling', 'sweepFailureCluster'],
                ts: _now()
            });
            expect(r.recommendedAction).toBe('observer_retreat');
        });
        test('rising trend computed from recentScores', () => {
            const r = M.recordWorldhoodPressureSnapshot({
                userId: UID_R, resolvedEnv: ENV,
                snapshotId: 'rs_rising',
                components: HEALTHY,
                recentScores: [0.20, 0.35, 0.50],
                persistentZones: [],
                ts: _now()
            });
            expect(r.trendDirection).toBe('rising');
        });
        test('persistent zones persisted', () => {
            const r = M.recordWorldhoodPressureSnapshot({
                userId: UID_R, resolvedEnv: ENV,
                snapshotId: 'rs_zones',
                components: HEALTHY,
                recentScores: [],
                persistentZones: ['zone_a', 'zone_b', 'zone_c'],
                ts: _now()
            });
            expect(r.recorded).toBe(true);
            // Verify storage round-trip
            const snapshot = M.getRecentSnapshots({
                userId: UID_R, resolvedEnv: ENV
            }).find(s => s.snapshotId === 'rs_zones');
            expect(snapshot).toBeTruthy();
            // persistentZonesJson roundtrip
            const zones = JSON.parse(snapshot.persistentZonesJson);
            expect(zones).toEqual(['zone_a', 'zone_b', 'zone_c']);
        });
        test('duplicate snapshotId throws', () => {
            M.recordWorldhoodPressureSnapshot({
                userId: UID_R, resolvedEnv: ENV,
                snapshotId: 'rs_dup', components: HEALTHY,
                recentScores: [], persistentZones: [], ts: _now()
            });
            expect(() => M.recordWorldhoodPressureSnapshot({
                userId: UID_R, resolvedEnv: ENV,
                snapshotId: 'rs_dup', components: HEALTHY,
                recentScores: [], persistentZones: [], ts: _now()
            })).toThrow(/duplicate/);
        });
        test('missing component throws', () => {
            const partial = { ...HEALTHY };
            delete partial.regimeGrammarTension;
            expect(() => M.recordWorldhoodPressureSnapshot({
                userId: UID_R, resolvedEnv: ENV,
                snapshotId: 'rs_part', components: partial,
                recentScores: [], persistentZones: [], ts: _now()
            })).toThrow();
        });
    });

    describe('getRecentSnapshots & getTrendStats', () => {
        test('getRecentSnapshots filters by recommended_action', () => {
            M.recordWorldhoodPressureSnapshot({
                userId: UID_GET, resolvedEnv: ENV,
                snapshotId: 'g_c', components: HEALTHY,
                recentScores: [], persistentZones: [], ts: _now()
            });
            M.recordWorldhoodPressureSnapshot({
                userId: UID_GET, resolvedEnv: ENV,
                snapshotId: 'g_o', components: SEVERE,
                recentScores: [], persistentZones: [], ts: _now()
            });
            const obsOnly = M.getRecentSnapshots({
                userId: UID_GET, resolvedEnv: ENV,
                recommendedAction: 'observer_retreat'
            });
            expect(obsOnly.length).toBe(1);
            expect(obsOnly[0].snapshotId).toBe('g_o');
        });
        test('getTrendStats returns counts per direction', () => {
            M.recordWorldhoodPressureSnapshot({
                userId: UID_GET, resolvedEnv: ENV,
                snapshotId: 'gt_1', components: HEALTHY,
                recentScores: [0.20, 0.35, 0.50], persistentZones: [], ts: 1000
            });
            M.recordWorldhoodPressureSnapshot({
                userId: UID_GET, resolvedEnv: ENV,
                snapshotId: 'gt_2', components: HEALTHY,
                recentScores: [], persistentZones: [], ts: 2000
            });
            const stats = M.getTrendStats({
                userId: UID_GET, resolvedEnv: ENV,
                sinceTs: 0
            });
            expect(stats.rising).toBe(1);
            expect(stats.steady).toBe(1);
            expect(stats.totalCount).toBe(2);
        });
    });

    describe('isolation per user × env', () => {
        test('uid isolation', () => {
            M.recordWorldhoodPressureSnapshot({
                userId: UID_ISO_A, resolvedEnv: ENV,
                snapshotId: 'iso_a', components: HEALTHY,
                recentScores: [], persistentZones: [], ts: _now()
            });
            M.recordWorldhoodPressureSnapshot({
                userId: UID_ISO_B, resolvedEnv: ENV,
                snapshotId: 'iso_b', components: HEALTHY,
                recentScores: [], persistentZones: [], ts: _now()
            });
            const a = M.getRecentSnapshots({
                userId: UID_ISO_A, resolvedEnv: ENV
            });
            expect(a.every(s => s.snapshotId !== 'iso_b')).toBe(true);
        });
        test('env isolation', () => {
            M.recordWorldhoodPressureSnapshot({
                userId: UID_ENV, resolvedEnv: 'DEMO',
                snapshotId: 'env_d', components: HEALTHY,
                recentScores: [], persistentZones: [], ts: _now()
            });
            const testnet = M.getRecentSnapshots({
                userId: UID_ENV, resolvedEnv: 'TESTNET'
            });
            expect(testnet).toEqual([]);
        });
    });
});
