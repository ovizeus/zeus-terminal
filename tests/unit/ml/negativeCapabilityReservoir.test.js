'use strict';

/**
 * OMEGA §188 NEGATIVE CAPABILITY RESERVOIR / STRUCTURED AMBIGUITY HOLDING.
 * Canonical: /root/_review/ml_brain/ml_brain_canonic.txt lines 6042-6090.
 */

const path = require('path');
const fs = require('fs');
const os = require('os');

const TEST_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-w3-p188-'));
const TEST_DB_PATH = path.join(TEST_DB_DIR, 'test.db');
process.env.ZEUS_DB_PATH = TEST_DB_PATH;
process.env.ZEUS_TEST_DISABLE_AUTH = '1';

const { db } = require('../../../server/services/database');
const M = require('../../../server/services/ml/_meta/negativeCapabilityReservoir');

const UID = 9188;
const UID_R = 9288;
const UID_GET = 9388;
const UID_ISO_A = 9488;
const UID_ISO_B = 9588;
const UID_ENV = 9688;
const ENV = 'DEMO';
const _now = () => Date.now();

function cleanRows() {
    const uids = [UID, UID_R, UID_GET, UID_ISO_A, UID_ISO_B, UID_ENV];
    const placeholders = uids.map(() => '?').join(',');
    db.prepare(`DELETE FROM ml_negative_capability_states WHERE user_id IN (${placeholders})`).run(...uids);
}
beforeEach(() => cleanRows());
afterAll(() => cleanRows());

describe('OMEGA §188 NEGATIVE CAPABILITY RESERVOIR', () => {

    describe('Migration 335', () => {
        test('335 applied', () => {
            expect(db.prepare("SELECT name FROM _migrations WHERE name=?").get('335_ml_negative_capability_states')).toBeTruthy();
        });
        test('ambiguity_classification CHECK enum (3)', () => {
            expect(() => db.prepare(`INSERT INTO ml_negative_capability_states
                (user_id, resolved_env, state_id, thesis_label, ambiguity_classification,
                 handling_mode, negative_capability_score, ambiguity_duration_ms,
                 escalation_required, reasoning, ts)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
                .run(UID, ENV, 's_bk', 'th', 'BOGUS', 'wait', 0.5, 0, 0,
                    null, _now())).toThrow();
        });
        test('handling_mode CHECK enum (4)', () => {
            expect(() => db.prepare(`INSERT INTO ml_negative_capability_states
                (user_id, resolved_env, state_id, thesis_label, ambiguity_classification,
                 handling_mode, negative_capability_score, ambiguity_duration_ms,
                 escalation_required, reasoning, ts)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
                .run(UID, ENV, 's_hm', 'th', 'healthy_tolerated_ambiguity',
                    'BOGUS', 0.5, 0, 0, null, _now())).toThrow();
        });
        test('state_id UNIQUE', () => {
            const stmt = db.prepare(`INSERT INTO ml_negative_capability_states
                (user_id, resolved_env, state_id, thesis_label, ambiguity_classification,
                 handling_mode, negative_capability_score, ambiguity_duration_ms,
                 escalation_required, reasoning, ts)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
            stmt.run(UID, ENV, 's_dup', 'th', 'healthy_tolerated_ambiguity',
                'wait', 0.5, 0, 0, null, _now());
            expect(() => stmt.run(UID, ENV, 's_dup', 'th2',
                'anxious_ambiguity', 'observer', 0.3, 0, 1, null, _now())).toThrow();
        });
    });

    describe('Constants', () => {
        test('AMBIGUITY_CLASSIFICATIONS frozen 3', () => {
            expect(M.AMBIGUITY_CLASSIFICATIONS).toEqual([
                'healthy_tolerated_ambiguity', 'anxious_ambiguity',
                'artificial_closure_avoidance'
            ]);
            expect(Object.isFrozen(M.AMBIGUITY_CLASSIFICATIONS)).toBe(true);
        });
        test('HANDLING_MODES frozen 4', () => {
            expect(M.HANDLING_MODES).toEqual([
                'unresolved_thesis', 'unresolved_but_stable',
                'wait', 'observer'
            ]);
            expect(Object.isFrozen(M.HANDLING_MODES)).toBe(true);
        });
        test('DURATION_ESCALATION_THRESHOLD_MS = 4h', () => {
            expect(M.DURATION_ESCALATION_THRESHOLD_MS).toBe(4 * 3600 * 1000);
        });
        test('STABILITY_INDEX_THRESHOLD = 0.65', () => {
            expect(M.STABILITY_INDEX_THRESHOLD).toBe(0.65);
        });
    });

    describe('computeNegativeCapabilityScore (pure)', () => {
        test('high lucidity + stable holding → high score', () => {
            const r = M.computeNegativeCapabilityScore({
                lucidityScore: 0.85,
                stabilityScore: 0.80,
                anxietyScore: 0.10
            });
            expect(r.score).toBeGreaterThan(0.70);
        });
        test('low lucidity + high anxiety → low score', () => {
            const r = M.computeNegativeCapabilityScore({
                lucidityScore: 0.20,
                stabilityScore: 0.25,
                anxietyScore: 0.85
            });
            expect(r.score).toBeLessThan(0.30);
        });
        test('out-of-range throws', () => {
            expect(() => M.computeNegativeCapabilityScore({
                lucidityScore: 1.5, stabilityScore: 0.5, anxietyScore: 0.5
            })).toThrow();
        });
    });

    describe('classifyAmbiguityHandling (pure)', () => {
        test('high score → healthy_tolerated_ambiguity', () => {
            const r = M.classifyAmbiguityHandling({
                negativeCapabilityScore: 0.80, anxietyScore: 0.10
            });
            expect(r.classification).toBe('healthy_tolerated_ambiguity');
        });
        test('high anxiety → anxious_ambiguity', () => {
            const r = M.classifyAmbiguityHandling({
                negativeCapabilityScore: 0.40, anxietyScore: 0.75
            });
            expect(r.classification).toBe('anxious_ambiguity');
        });
        test('low score + low anxiety → artificial_closure_avoidance', () => {
            // low capability + not anxious = system fakes closure to avoid sitting with ambiguity
            const r = M.classifyAmbiguityHandling({
                negativeCapabilityScore: 0.25, anxietyScore: 0.15
            });
            expect(r.classification).toBe('artificial_closure_avoidance');
        });
    });

    describe('requiresEscalation (pure)', () => {
        test('duration > threshold + no plan → escalate', () => {
            const r = M.requiresEscalation({
                ambiguityDurationMs: 8 * 3600 * 1000,  // 8h > 4h threshold
                hasResolutionPlan: false
            });
            expect(r.escalationRequired).toBe(1);
        });
        test('long duration but has plan → no escalation', () => {
            const r = M.requiresEscalation({
                ambiguityDurationMs: 8 * 3600 * 1000,
                hasResolutionPlan: true
            });
            expect(r.escalationRequired).toBe(0);
        });
        test('short duration → no escalation', () => {
            const r = M.requiresEscalation({
                ambiguityDurationMs: 30 * 60 * 1000,  // 30 min
                hasResolutionPlan: false
            });
            expect(r.escalationRequired).toBe(0);
        });
    });

    describe('recordAmbiguityState', () => {
        test('persists with auto-classify', () => {
            const r = M.recordAmbiguityState({
                userId: UID_R, resolvedEnv: ENV,
                stateId: 'ra_1',
                thesisLabel: 'BTC regime ambiguous post-FOMC',
                handlingMode: 'wait',
                lucidityScore: 0.80,
                stabilityScore: 0.75,
                anxietyScore: 0.15,
                ambiguityDurationMs: 30 * 60 * 1000,
                hasResolutionPlan: true,
                ts: _now()
            });
            expect(r.recorded).toBe(true);
            expect(r.ambiguityClassification).toBe('healthy_tolerated_ambiguity');
            expect(r.escalationRequired).toBe(0);
        });
        test('long ambiguity without plan → escalation required', () => {
            const r = M.recordAmbiguityState({
                userId: UID_R, resolvedEnv: ENV,
                stateId: 'ra_long',
                thesisLabel: 'th',
                handlingMode: 'observer',
                lucidityScore: 0.50, stabilityScore: 0.40, anxietyScore: 0.50,
                ambiguityDurationMs: 10 * 3600 * 1000,
                hasResolutionPlan: false,
                ts: _now()
            });
            expect(r.escalationRequired).toBe(1);
        });
        test('duplicate stateId throws', () => {
            M.recordAmbiguityState({
                userId: UID_R, resolvedEnv: ENV,
                stateId: 'ra_dup', thesisLabel: 'th', handlingMode: 'wait',
                lucidityScore: 0.5, stabilityScore: 0.5, anxietyScore: 0.5,
                ambiguityDurationMs: 0, hasResolutionPlan: true, ts: _now()
            });
            expect(() => M.recordAmbiguityState({
                userId: UID_R, resolvedEnv: ENV,
                stateId: 'ra_dup', thesisLabel: 'th', handlingMode: 'wait',
                lucidityScore: 0.5, stabilityScore: 0.5, anxietyScore: 0.5,
                ambiguityDurationMs: 0, hasResolutionPlan: true, ts: _now()
            })).toThrow(/duplicate/);
        });
    });

    describe('getRecentStates & getStatsByClassification', () => {
        test('filter by classification works', () => {
            M.recordAmbiguityState({
                userId: UID_GET, resolvedEnv: ENV,
                stateId: 'g_h', thesisLabel: 'th', handlingMode: 'wait',
                lucidityScore: 0.85, stabilityScore: 0.80, anxietyScore: 0.10,
                ambiguityDurationMs: 0, hasResolutionPlan: true, ts: _now()
            });
            M.recordAmbiguityState({
                userId: UID_GET, resolvedEnv: ENV,
                stateId: 'g_a', thesisLabel: 'th', handlingMode: 'observer',
                lucidityScore: 0.30, stabilityScore: 0.20, anxietyScore: 0.85,
                ambiguityDurationMs: 0, hasResolutionPlan: true, ts: _now()
            });
            const anxious = M.getRecentStates({
                userId: UID_GET, resolvedEnv: ENV,
                ambiguityClassification: 'anxious_ambiguity'
            });
            expect(anxious.length).toBe(1);
        });
        test('stats by classification', () => {
            M.recordAmbiguityState({
                userId: UID_GET, resolvedEnv: ENV,
                stateId: 'gs_1', thesisLabel: 'th', handlingMode: 'wait',
                lucidityScore: 0.85, stabilityScore: 0.80, anxietyScore: 0.10,
                ambiguityDurationMs: 0, hasResolutionPlan: true, ts: 1000
            });
            const stats = M.getStatsByClassification({
                userId: UID_GET, resolvedEnv: ENV, sinceTs: 0
            });
            expect(stats.totalCount).toBe(1);
            expect(stats.healthy_tolerated_ambiguity).toBe(1);
        });
    });

    describe('isolation', () => {
        test('uid + env', () => {
            M.recordAmbiguityState({
                userId: UID_ISO_A, resolvedEnv: ENV,
                stateId: 'iso_a', thesisLabel: 'th', handlingMode: 'wait',
                lucidityScore: 0.5, stabilityScore: 0.5, anxietyScore: 0.5,
                ambiguityDurationMs: 0, hasResolutionPlan: true, ts: _now()
            });
            M.recordAmbiguityState({
                userId: UID_ENV, resolvedEnv: 'DEMO',
                stateId: 'env_d', thesisLabel: 'th', handlingMode: 'wait',
                lucidityScore: 0.5, stabilityScore: 0.5, anxietyScore: 0.5,
                ambiguityDurationMs: 0, hasResolutionPlan: true, ts: _now()
            });
            expect(M.getRecentStates({
                userId: UID_ISO_B, resolvedEnv: ENV
            })).toEqual([]);
            expect(M.getRecentStates({
                userId: UID_ENV, resolvedEnv: 'TESTNET'
            })).toEqual([]);
        });
    });
});
