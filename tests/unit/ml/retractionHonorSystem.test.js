'use strict';

/**
 * OMEGA §171 RETRACTION HONOR SYSTEM / ELEGANT BACKDOWN ENGINE.
 * Canonical: /root/_review/ml_brain/ml_brain_canonic.txt lines 5672-5719.
 *
 * "daca ma retrag acum, e slabiciune sau e putere epistemica?"
 *
 * Tests FIRST per TDD discipline.
 */

const path = require('path');
const fs = require('fs');
const os = require('os');

const TEST_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-w3-p171-'));
const TEST_DB_PATH = path.join(TEST_DB_DIR, 'test.db');
process.env.ZEUS_DB_PATH = TEST_DB_PATH;
process.env.ZEUS_TEST_DISABLE_AUTH = '1';

const { db } = require('../../../server/services/database');
const M = require('../../../server/services/ml/_meta/retractionHonorSystem');

const UID = 9171;
const UID_R = 9271;
const UID_GET = 9371;
const UID_ISO_A = 9471;
const UID_ISO_B = 9571;
const UID_ENV = 9671;
const ENV = 'DEMO';
const _now = () => Date.now();

function cleanRows() {
    const uids = [UID, UID_R, UID_GET, UID_ISO_A, UID_ISO_B, UID_ENV];
    const placeholders = uids.map(() => '?').join(',');
    db.prepare(`DELETE FROM ml_retractions WHERE user_id IN (${placeholders})`).run(...uids);
}
beforeEach(() => cleanRows());
afterAll(() => cleanRows());

describe('OMEGA §171 RETRACTION HONOR SYSTEM', () => {

    describe('Migration 328', () => {
        test('328 applied', () => {
            expect(db.prepare("SELECT name FROM _migrations WHERE name=?").get('328_ml_retractions')).toBeTruthy();
        });
        test('retraction_type CHECK enum (5)', () => {
            expect(() => db.prepare(`INSERT INTO ml_retractions
                (user_id, resolved_env, retraction_id, thesis_label, retraction_type,
                 classification, timeliness_score, clarity_score, justification_score,
                 honor_score, reasoning, ts)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
                .run(UID, ENV, 'r_bk', 'th', 'BOGUS', 'elegant_backdown',
                    0.7, 0.7, 0.7, 0.7, null, _now())).toThrow();
        });
        test('classification CHECK enum (4)', () => {
            expect(() => db.prepare(`INSERT INTO ml_retractions
                (user_id, resolved_env, retraction_id, thesis_label, retraction_type,
                 classification, timeliness_score, clarity_score, justification_score,
                 honor_score, reasoning, ts)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
                .run(UID, ENV, 'r_cl', 'th', 'early_abandonment', 'BOGUS',
                    0.7, 0.7, 0.7, 0.7, null, _now())).toThrow();
        });
        test('retraction_id UNIQUE', () => {
            const stmt = db.prepare(`INSERT INTO ml_retractions
                (user_id, resolved_env, retraction_id, thesis_label, retraction_type,
                 classification, timeliness_score, clarity_score, justification_score,
                 honor_score, reasoning, ts)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
            stmt.run(UID, ENV, 'r_dup', 'th', 'early_abandonment',
                'elegant_backdown', 0.7, 0.7, 0.7, 0.7, null, _now());
            expect(() => stmt.run(UID, ENV, 'r_dup', 'th2', 'pre_invalidation_exit',
                'strategic_surrender', 0.7, 0.7, 0.7, 0.7, null, _now())).toThrow();
        });
        test('range CHECK on scores', () => {
            expect(() => db.prepare(`INSERT INTO ml_retractions
                (user_id, resolved_env, retraction_id, thesis_label, retraction_type,
                 classification, timeliness_score, clarity_score, justification_score,
                 honor_score, reasoning, ts)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
                .run(UID, ENV, 'r_br', 'th', 'early_abandonment',
                    'elegant_backdown', 1.5, 0.7, 0.7, 0.7, null, _now())).toThrow();
        });
    });

    describe('Constants', () => {
        test('RETRACTION_TYPES frozen 5 (canonical PDF list)', () => {
            expect(M.RETRACTION_TYPES).toEqual([
                'early_abandonment', 'justified_size_reduction',
                'elegant_bias_flip', 'pre_invalidation_exit',
                'explicit_error_recognition'
            ]);
            expect(Object.isFrozen(M.RETRACTION_TYPES)).toBe(true);
        });
        test('CLASSIFICATIONS frozen 4 (canonical PDF list)', () => {
            expect(M.CLASSIFICATIONS).toEqual([
                'panic_exit', 'coward_exit',
                'elegant_backdown', 'strategic_surrender'
            ]);
            expect(Object.isFrozen(M.CLASSIFICATIONS)).toBe(true);
        });
        test('HONORED_CLASSIFICATIONS frozen 2', () => {
            expect(M.HONORED_CLASSIFICATIONS).toEqual([
                'elegant_backdown', 'strategic_surrender'
            ]);
            expect(Object.isFrozen(M.HONORED_CLASSIFICATIONS)).toBe(true);
        });
        test('HONOR_WEIGHTS sum to 1.0', () => {
            const sum = Object.values(M.HONOR_WEIGHTS).reduce((a, b) => a + b, 0);
            expect(sum).toBeCloseTo(1.0, 6);
        });
        test('HONOR_WEIGHTS — timeliness dominant', () => {
            expect(M.HONOR_WEIGHTS.timeliness).toBe(0.40);
            expect(M.HONOR_WEIGHTS.clarity).toBe(0.30);
            expect(M.HONOR_WEIGHTS.justification).toBe(0.30);
        });
        test('HONOR_THRESHOLDS ordered', () => {
            expect(M.HONOR_THRESHOLDS.high).toBe(0.70);
            expect(M.HONOR_THRESHOLDS.mid).toBe(0.40);
        });
    });

    describe('computeHonorScore (pure)', () => {
        test('all high components → high honor', () => {
            const r = M.computeHonorScore({
                timeliness: 0.85, clarity: 0.85, justification: 0.85
            });
            expect(r.honorScore).toBeGreaterThan(0.80);
        });
        test('all zero → zero honor', () => {
            const r = M.computeHonorScore({
                timeliness: 0, clarity: 0, justification: 0
            });
            expect(r.honorScore).toBe(0);
        });
        test('timeliness weighted heaviest (0.40)', () => {
            const timelinessHi = M.computeHonorScore({
                timeliness: 1, clarity: 0, justification: 0
            });
            const clarityHi = M.computeHonorScore({
                timeliness: 0, clarity: 1, justification: 0
            });
            expect(timelinessHi.honorScore).toBeGreaterThan(clarityHi.honorScore);
        });
        test('out-of-range throws', () => {
            expect(() => M.computeHonorScore({
                timeliness: 1.5, clarity: 0.5, justification: 0.5
            })).toThrow();
        });
    });

    describe('classifyRetraction (pure)', () => {
        test('high honor + high timeliness → elegant_backdown', () => {
            const r = M.classifyRetraction({
                honorScore: 0.85, timeliness: 0.90
            });
            expect(r.classification).toBe('elegant_backdown');
        });
        test('mid honor + mid timeliness → strategic_surrender', () => {
            const r = M.classifyRetraction({
                honorScore: 0.55, timeliness: 0.50
            });
            expect(r.classification).toBe('strategic_surrender');
        });
        test('very low honor + low timeliness → panic_exit (late)', () => {
            const r = M.classifyRetraction({
                honorScore: 0.15, timeliness: 0.10
            });
            // panic = abandonment under stress, late
            expect(r.classification).toBe('panic_exit');
        });
        test('low honor + moderate timeliness → coward_exit (early but unjustified)', () => {
            const r = M.classifyRetraction({
                honorScore: 0.20, timeliness: 0.65
            });
            // coward = bailed before challenge, weak justification
            expect(r.classification).toBe('coward_exit');
        });
        test('boundary high 0.70 → elegant_backdown', () => {
            const r = M.classifyRetraction({
                honorScore: 0.70, timeliness: 0.80
            });
            expect(r.classification).toBe('elegant_backdown');
        });
    });

    describe('isHonorWorthy (pure)', () => {
        test('elegant_backdown → true', () => {
            expect(M.isHonorWorthy({
                classification: 'elegant_backdown'
            }).honorWorthy).toBe(true);
        });
        test('strategic_surrender → true', () => {
            expect(M.isHonorWorthy({
                classification: 'strategic_surrender'
            }).honorWorthy).toBe(true);
        });
        test('panic_exit → false', () => {
            expect(M.isHonorWorthy({
                classification: 'panic_exit'
            }).honorWorthy).toBe(false);
        });
        test('coward_exit → false', () => {
            expect(M.isHonorWorthy({
                classification: 'coward_exit'
            }).honorWorthy).toBe(false);
        });
        test('invalid throws', () => {
            expect(() => M.isHonorWorthy({
                classification: 'BOGUS'
            })).toThrow();
        });
    });

    describe('recordRetraction', () => {
        test('persists with auto-honor + auto-classification', () => {
            const r = M.recordRetraction({
                userId: UID_R, resolvedEnv: ENV,
                retractionId: 'rr_1',
                thesisLabel: 'BTC long at 72k retest',
                retractionType: 'pre_invalidation_exit',
                timeliness: 0.85, clarity: 0.80, justification: 0.85,
                reasoning: 'OBI re-flipped negative before SL hit',
                ts: _now()
            });
            expect(r.recorded).toBe(true);
            expect(r.honorScore).toBeGreaterThan(0.70);
            expect(r.classification).toBe('elegant_backdown');
        });
        test('low timeliness + low clarity → panic_exit', () => {
            const r = M.recordRetraction({
                userId: UID_R, resolvedEnv: ENV,
                retractionId: 'rr_panic',
                thesisLabel: 'long held too long',
                retractionType: 'early_abandonment',
                timeliness: 0.10, clarity: 0.15, justification: 0.10,
                ts: _now()
            });
            expect(r.classification).toBe('panic_exit');
        });
        test('moderate timeliness + low justification → coward_exit', () => {
            const r = M.recordRetraction({
                userId: UID_R, resolvedEnv: ENV,
                retractionId: 'rr_coward',
                thesisLabel: 'bailed without reason',
                retractionType: 'early_abandonment',
                timeliness: 0.60, clarity: 0.30, justification: 0.10,
                ts: _now()
            });
            // honor = 0.40*0.60 + 0.30*0.30 + 0.30*0.10 = 0.24 + 0.09 + 0.03 = 0.36
            expect(r.classification).toBe('coward_exit');
        });
        test('invalid retraction_type throws', () => {
            expect(() => M.recordRetraction({
                userId: UID_R, resolvedEnv: ENV,
                retractionId: 'rr_bad', thesisLabel: 'th',
                retractionType: 'BOGUS',
                timeliness: 0.5, clarity: 0.5, justification: 0.5,
                ts: _now()
            })).toThrow();
        });
        test('duplicate retractionId throws', () => {
            M.recordRetraction({
                userId: UID_R, resolvedEnv: ENV,
                retractionId: 'rr_dup', thesisLabel: 'th',
                retractionType: 'early_abandonment',
                timeliness: 0.5, clarity: 0.5, justification: 0.5,
                ts: _now()
            });
            expect(() => M.recordRetraction({
                userId: UID_R, resolvedEnv: ENV,
                retractionId: 'rr_dup', thesisLabel: 'th',
                retractionType: 'early_abandonment',
                timeliness: 0.5, clarity: 0.5, justification: 0.5,
                ts: _now()
            })).toThrow(/duplicate/);
        });
    });

    describe('getRecentRetractions & getHonorStats', () => {
        test('getRecentRetractions filters by classification', () => {
            M.recordRetraction({
                userId: UID_GET, resolvedEnv: ENV,
                retractionId: 'g_e', thesisLabel: 'th',
                retractionType: 'pre_invalidation_exit',
                timeliness: 0.90, clarity: 0.85, justification: 0.80,
                ts: _now()
            });
            M.recordRetraction({
                userId: UID_GET, resolvedEnv: ENV,
                retractionId: 'g_p', thesisLabel: 'th',
                retractionType: 'early_abandonment',
                timeliness: 0.10, clarity: 0.10, justification: 0.10,
                ts: _now()
            });
            const elegant = M.getRecentRetractions({
                userId: UID_GET, resolvedEnv: ENV,
                classification: 'elegant_backdown'
            });
            expect(elegant.length).toBe(1);
        });
        test('getHonorStats aggregates honored vs unhonored', () => {
            M.recordRetraction({
                userId: UID_GET, resolvedEnv: ENV,
                retractionId: 'gs_1', thesisLabel: 'th',
                retractionType: 'pre_invalidation_exit',
                timeliness: 0.90, clarity: 0.85, justification: 0.80,
                ts: 1000
            });
            M.recordRetraction({
                userId: UID_GET, resolvedEnv: ENV,
                retractionId: 'gs_2', thesisLabel: 'th',
                retractionType: 'explicit_error_recognition',
                timeliness: 0.55, clarity: 0.50, justification: 0.55,
                ts: 2000
            });
            M.recordRetraction({
                userId: UID_GET, resolvedEnv: ENV,
                retractionId: 'gs_3', thesisLabel: 'th',
                retractionType: 'early_abandonment',
                timeliness: 0.10, clarity: 0.10, justification: 0.10,
                ts: 3000
            });
            const stats = M.getHonorStats({
                userId: UID_GET, resolvedEnv: ENV,
                sinceTs: 0
            });
            expect(stats.honoredCount).toBe(2);  // elegant + strategic
            expect(stats.unhonoredCount).toBe(1);  // panic
            expect(stats.totalCount).toBe(3);
            expect(stats.meanHonorScore).toBeGreaterThan(0);
        });
    });

    describe('isolation per user × env', () => {
        test('uid isolation', () => {
            M.recordRetraction({
                userId: UID_ISO_A, resolvedEnv: ENV,
                retractionId: 'iso_a', thesisLabel: 'th',
                retractionType: 'early_abandonment',
                timeliness: 0.5, clarity: 0.5, justification: 0.5,
                ts: _now()
            });
            M.recordRetraction({
                userId: UID_ISO_B, resolvedEnv: ENV,
                retractionId: 'iso_b', thesisLabel: 'th',
                retractionType: 'early_abandonment',
                timeliness: 0.5, clarity: 0.5, justification: 0.5,
                ts: _now()
            });
            const a = M.getRecentRetractions({
                userId: UID_ISO_A, resolvedEnv: ENV
            });
            expect(a.every(r => r.retractionId !== 'iso_b')).toBe(true);
        });
        test('env isolation', () => {
            M.recordRetraction({
                userId: UID_ENV, resolvedEnv: 'DEMO',
                retractionId: 'env_d', thesisLabel: 'th',
                retractionType: 'early_abandonment',
                timeliness: 0.5, clarity: 0.5, justification: 0.5,
                ts: _now()
            });
            const testnet = M.getRecentRetractions({
                userId: UID_ENV, resolvedEnv: 'TESTNET'
            });
            expect(testnet).toEqual([]);
        });
    });
});
