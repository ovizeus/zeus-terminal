'use strict';

/**
 * OMEGA Claude-Extra #2 — Adversarial ML Defense (DEFENSIVE only).
 * Detects attempts by other bots to induce psychosis in our ML.
 * NO offensive action — pure detection + signal sanitization.
 */

const path = require('path');
const fs = require('fs');
const os = require('os');

const TEST_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-extra-defense-'));
const TEST_DB_PATH = path.join(TEST_DB_DIR, 'test.db');
process.env.ZEUS_DB_PATH = TEST_DB_PATH;
process.env.ZEUS_TEST_DISABLE_AUTH = '1';

const { db } = require('../../../server/services/database');
const M = require('../../../server/services/ml/R3A_safety/adversarialMLDefense');

const UID = 9601;
const UID_DET = 9602;
const UID_SAN = 9603;
const UID_HIST = 9604;
const UID_ISO_A = 9605;
const UID_ISO_B = 9606;
const UID_ENV = 9607;
const ENV = 'DEMO';
const _now = () => Date.now();

function cleanRows() {
    const uids = [UID, UID_DET, UID_SAN, UID_HIST,
                  UID_ISO_A, UID_ISO_B, UID_ENV];
    const placeholders = uids.map(() => '?').join(',');
    db.prepare(`DELETE FROM ml_signal_sanitization_log WHERE user_id IN (${placeholders})`).run(...uids);
    db.prepare(`DELETE FROM ml_adversarial_attack_detections WHERE user_id IN (${placeholders})`).run(...uids);
}
beforeEach(() => cleanRows());
afterAll(() => cleanRows());

describe('Claude-Extra #2 ADVERSARIAL ML DEFENSE', () => {

    describe('Migrations 277+278', () => {
        test('277 applied', () => {
            expect(db.prepare("SELECT name FROM _migrations WHERE name=?").get('277_ml_adversarial_attack_detections')).toBeTruthy();
        });
        test('278 applied', () => {
            expect(db.prepare("SELECT name FROM _migrations WHERE name=?").get('278_ml_signal_sanitization_log')).toBeTruthy();
        });
        test('attack_pattern CHECK enum', () => {
            expect(() => db.prepare(`INSERT INTO ml_adversarial_attack_detections
                (user_id, resolved_env, detection_id, asset, attack_pattern,
                 anomaly_score, severity, evidence_json, defense_action, ts)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
                .run(UID, ENV, 'd_bk', 'BTC', 'BOGUS', 0.5,
                    'low', '{}', 'ignore_signal', _now())).toThrow();
        });
        test('severity CHECK enum', () => {
            expect(() => db.prepare(`INSERT INTO ml_adversarial_attack_detections
                (user_id, resolved_env, detection_id, asset, attack_pattern,
                 anomaly_score, severity, evidence_json, defense_action, ts)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
                .run(UID, ENV, 'd_bs', 'BTC', 'spoofing_storm', 0.5,
                    'BOGUS', '{}', 'ignore_signal', _now())).toThrow();
        });
        test('defense_action CHECK enum', () => {
            expect(() => db.prepare(`INSERT INTO ml_adversarial_attack_detections
                (user_id, resolved_env, detection_id, asset, attack_pattern,
                 anomaly_score, severity, evidence_json, defense_action, ts)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
                .run(UID, ENV, 'd_ba', 'BTC', 'spoofing_storm', 0.5,
                    'low', '{}', 'BOGUS', _now())).toThrow();
        });
        test('FK sanitization → detection', () => {
            expect(() => db.prepare(`INSERT INTO ml_signal_sanitization_log
                (user_id, resolved_env, sanitization_id, detection_id,
                 original_signal_json, sanitized_signal_json,
                 sanitization_applied, ts)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
                .run(UID, ENV, 's_orphan', 'NONEXISTENT',
                    '{}', '{}', 1, _now())).toThrow(/FOREIGN KEY/i);
        });
    });

    describe('Constants', () => {
        test('ATTACK_PATTERNS frozen 4', () => {
            expect(M.ATTACK_PATTERNS).toEqual([
                'spoofing_storm', 'ghost_liquidity',
                'micro_cancel_pattern', 'volume_anomaly'
            ]);
            expect(Object.isFrozen(M.ATTACK_PATTERNS)).toBe(true);
        });
        test('SEVERITY_LEVELS frozen 3', () => {
            expect(M.SEVERITY_LEVELS).toEqual(['low', 'medium', 'high']);
            expect(Object.isFrozen(M.SEVERITY_LEVELS)).toBe(true);
        });
        test('DEFENSE_ACTIONS frozen 3', () => {
            expect(M.DEFENSE_ACTIONS).toEqual([
                'ignore_signal', 'increase_caution', 'pause_trading'
            ]);
        });
        test('SEVERITY_THRESHOLDS ordered', () => {
            expect(M.SEVERITY_THRESHOLDS.high).toBe(0.70);
            expect(M.SEVERITY_THRESHOLDS.medium).toBe(0.40);
        });
        test('DETECTION_THRESHOLDS per pattern', () => {
            // spoofing_storm: cancel_rate_per_sec threshold
            expect(M.DETECTION_THRESHOLDS.spoofing_storm.cancelRatePerSec).toBeGreaterThan(0);
            expect(M.DETECTION_THRESHOLDS.ghost_liquidity.flickerCountPerWindow).toBeGreaterThan(0);
            expect(M.DETECTION_THRESHOLDS.micro_cancel_pattern.cyclesPerMinute).toBeGreaterThan(0);
            expect(M.DETECTION_THRESHOLDS.volume_anomaly.syntheticRatio).toBeGreaterThan(0);
        });
    });

    describe('computeAnomalyScore (pure)', () => {
        test('spoofing_storm — well-above threshold → high score', () => {
            const r = M.computeAnomalyScore({
                attackPattern: 'spoofing_storm',
                evidence: { cancelRatePerSec: 200 }
            });
            expect(r.anomalyScore).toBeGreaterThan(0.7);
        });
        test('spoofing_storm — at threshold → score ~0.5', () => {
            const th = M.DETECTION_THRESHOLDS.spoofing_storm.cancelRatePerSec;
            const r = M.computeAnomalyScore({
                attackPattern: 'spoofing_storm',
                evidence: { cancelRatePerSec: th }
            });
            expect(r.anomalyScore).toBeGreaterThanOrEqual(0.4);
            expect(r.anomalyScore).toBeLessThanOrEqual(0.6);
        });
        test('below threshold → low score', () => {
            const r = M.computeAnomalyScore({
                attackPattern: 'spoofing_storm',
                evidence: { cancelRatePerSec: 5 }
            });
            expect(r.anomalyScore).toBeLessThan(0.3);
        });
        test('ghost_liquidity', () => {
            const r = M.computeAnomalyScore({
                attackPattern: 'ghost_liquidity',
                evidence: { flickerCountPerWindow: 100 }
            });
            expect(r.anomalyScore).toBeGreaterThan(0);
        });
        test('volume_anomaly', () => {
            const r = M.computeAnomalyScore({
                attackPattern: 'volume_anomaly',
                evidence: { syntheticRatio: 0.9 }
            });
            expect(r.anomalyScore).toBeGreaterThan(0.7);
        });
        test('invalid pattern throws', () => {
            expect(() => M.computeAnomalyScore({
                attackPattern: 'BOGUS', evidence: {}
            })).toThrow();
        });
        test('missing evidence key → 0 score', () => {
            const r = M.computeAnomalyScore({
                attackPattern: 'spoofing_storm', evidence: {}
            });
            expect(r.anomalyScore).toBe(0);
        });
    });

    describe('classifySeverity (pure)', () => {
        test('≥0.70 → high', () => {
            expect(M.classifySeverity({ anomalyScore: 0.85 }).severity).toBe('high');
        });
        test('0.40-0.70 → medium', () => {
            expect(M.classifySeverity({ anomalyScore: 0.55 }).severity).toBe('medium');
        });
        test('<0.40 → low', () => {
            expect(M.classifySeverity({ anomalyScore: 0.20 }).severity).toBe('low');
        });
    });

    describe('selectDefenseAction (pure)', () => {
        test('low → ignore_signal', () => {
            expect(M.selectDefenseAction({ severity: 'low' }).defenseAction).toBe('ignore_signal');
        });
        test('medium → increase_caution', () => {
            expect(M.selectDefenseAction({ severity: 'medium' }).defenseAction).toBe('increase_caution');
        });
        test('high → pause_trading', () => {
            expect(M.selectDefenseAction({ severity: 'high' }).defenseAction).toBe('pause_trading');
        });
        test('invalid throws', () => {
            expect(() => M.selectDefenseAction({ severity: 'BOGUS' })).toThrow();
        });
    });

    describe('shouldSanitizeSignal (pure)', () => {
        test('high severity → true', () => {
            expect(M.shouldSanitizeSignal({ severity: 'high' }).shouldSanitize).toBe(true);
        });
        test('medium → true', () => {
            expect(M.shouldSanitizeSignal({ severity: 'medium' }).shouldSanitize).toBe(true);
        });
        test('low → false (defense by ignoring, not sanitizing)', () => {
            expect(M.shouldSanitizeSignal({ severity: 'low' }).shouldSanitize).toBe(false);
        });
    });

    describe('recordDetection (integration)', () => {
        test('high anomaly persists + auto-classifies', () => {
            const r = M.recordDetection({
                userId: UID_DET, resolvedEnv: ENV,
                detectionId: 'd_high', asset: 'BTC',
                attackPattern: 'spoofing_storm',
                evidence: { cancelRatePerSec: 250 },
                ts: _now()
            });
            expect(r.recorded).toBe(true);
            expect(r.severity).toBe('high');
            expect(r.defenseAction).toBe('pause_trading');
        });
        test('low anomaly → low + ignore_signal', () => {
            const r = M.recordDetection({
                userId: UID_DET, resolvedEnv: ENV,
                detectionId: 'd_low', asset: 'BTC',
                attackPattern: 'spoofing_storm',
                evidence: { cancelRatePerSec: 5 },
                ts: _now()
            });
            expect(r.severity).toBe('low');
            expect(r.defenseAction).toBe('ignore_signal');
        });
        test('duplicate detectionId throws', () => {
            M.recordDetection({
                userId: UID_DET, resolvedEnv: ENV,
                detectionId: 'd_dup', asset: 'BTC',
                attackPattern: 'spoofing_storm',
                evidence: { cancelRatePerSec: 100 }, ts: _now()
            });
            expect(() => M.recordDetection({
                userId: UID_DET, resolvedEnv: ENV,
                detectionId: 'd_dup', asset: 'ETH',
                attackPattern: 'volume_anomaly',
                evidence: { syntheticRatio: 0.5 }, ts: _now()
            })).toThrow(/duplicate/);
        });
        test('invalid pattern throws', () => {
            expect(() => M.recordDetection({
                userId: UID_DET, resolvedEnv: ENV,
                detectionId: 'd_bad', asset: 'BTC',
                attackPattern: 'BOGUS',
                evidence: {}, ts: _now()
            })).toThrow();
        });
    });

    describe('recordSanitization (integration)', () => {
        test('persists sanitization tied to detection (FK)', () => {
            M.recordDetection({
                userId: UID_SAN, resolvedEnv: ENV,
                detectionId: 'd_san', asset: 'BTC',
                attackPattern: 'spoofing_storm',
                evidence: { cancelRatePerSec: 250 }, ts: _now()
            });
            const r = M.recordSanitization({
                userId: UID_SAN, resolvedEnv: ENV,
                sanitizationId: 's_1', detectionId: 'd_san',
                originalSignal: { rsi: 80 },
                sanitizedSignal: { rsi: null },
                sanitizationApplied: true,
                ts: _now()
            });
            expect(r.recorded).toBe(true);
        });
        test('FK orphan rejected', () => {
            expect(() => M.recordSanitization({
                userId: UID_SAN, resolvedEnv: ENV,
                sanitizationId: 's_orphan', detectionId: 'NONEXISTENT',
                originalSignal: {}, sanitizedSignal: {},
                sanitizationApplied: true, ts: _now()
            })).toThrow(/FOREIGN KEY|not found/i);
        });
        test('duplicate sanitizationId throws', () => {
            M.recordDetection({
                userId: UID_SAN, resolvedEnv: ENV,
                detectionId: 'd_san2', asset: 'BTC',
                attackPattern: 'spoofing_storm',
                evidence: { cancelRatePerSec: 250 }, ts: _now()
            });
            M.recordSanitization({
                userId: UID_SAN, resolvedEnv: ENV,
                sanitizationId: 's_dup', detectionId: 'd_san2',
                originalSignal: {}, sanitizedSignal: {},
                sanitizationApplied: true, ts: _now()
            });
            expect(() => M.recordSanitization({
                userId: UID_SAN, resolvedEnv: ENV,
                sanitizationId: 's_dup', detectionId: 'd_san2',
                originalSignal: {}, sanitizedSignal: {},
                sanitizationApplied: true, ts: _now()
            })).toThrow(/duplicate/);
        });
    });

    describe('getRecentDetections', () => {
        test('filter by asset + severity', () => {
            const u = UID_HIST;
            M.recordDetection({
                userId: u, resolvedEnv: ENV,
                detectionId: 'h_h1', asset: 'BTC',
                attackPattern: 'spoofing_storm',
                evidence: { cancelRatePerSec: 250 }, ts: 1000
            });
            M.recordDetection({
                userId: u, resolvedEnv: ENV,
                detectionId: 'h_h2', asset: 'BTC',
                attackPattern: 'volume_anomaly',
                evidence: { syntheticRatio: 0.1 }, ts: 2000
            });
            const high = M.getRecentDetections({
                userId: u, resolvedEnv: ENV,
                asset: 'BTC', severity: 'high', limit: 10
            });
            expect(high.length).toBe(1);
            expect(high[0].detectionId).toBe('h_h1');
        });
    });

    // ─────────────────────────────────────────────────────────────
    // v2 tests (versioning + embedding + external_link)
    // ─────────────────────────────────────────────────────────────

    describe('v2 Migrations 280+281', () => {
        test('280 applied', () => {
            expect(db.prepare("SELECT name FROM _migrations WHERE name=?").get('280_alter_adversarial_detections_v2')).toBeTruthy();
            const cols = db.prepare("PRAGMA table_info(ml_adversarial_attack_detections)").all();
            const names = cols.map(c => c.name);
            expect(names).toContain('detection_model_version');
            expect(names).toContain('sanitization_policy_version');
            expect(names).toContain('anomaly_embedding_json');
            expect(names).toContain('external_link_kind');
            expect(names).toContain('external_link_id');
        });
        test('281 applied', () => {
            expect(db.prepare("SELECT name FROM _migrations WHERE name=?").get('281_alter_sanitization_log_v2')).toBeTruthy();
            const cols = db.prepare("PRAGMA table_info(ml_signal_sanitization_log)").all();
            expect(cols.map(c => c.name)).toContain('sanitization_policy_version');
        });
    });

    describe('v2 Constants', () => {
        test('DETECTION_MODEL_VERSION semver', () => {
            expect(M.DETECTION_MODEL_VERSION).toMatch(/^v\d+\.\d+\.\d+$/);
        });
        test('SANITIZATION_POLICY_VERSION semver', () => {
            expect(M.SANITIZATION_POLICY_VERSION).toMatch(/^v\d+\.\d+\.\d+$/);
        });
        test('EXTERNAL_LINK_KINDS frozen 2', () => {
            expect(M.EXTERNAL_LINK_KINDS).toEqual([
                'gravity_zone', 'gravity_conflict'
            ]);
            expect(Object.isFrozen(M.EXTERNAL_LINK_KINDS)).toBe(true);
        });
    });

    describe('v2 computeAnomalyEmbedding (pure)', () => {
        test('returns vector with one dim per attack pattern', () => {
            const r = M.computeAnomalyEmbedding({
                evidence: { cancelRatePerSec: 250 }
            });
            expect(r.embedding.length).toBe(M.ATTACK_PATTERNS.length);
        });
        test('missing evidence → zero dim', () => {
            const r = M.computeAnomalyEmbedding({ evidence: {} });
            expect(r.embedding.every(v => v === 0)).toBe(true);
        });
        test('above threshold → near 1.0 dim', () => {
            const r = M.computeAnomalyEmbedding({
                evidence: { syntheticRatio: 1.0 }
            });
            const volIdx = M.ATTACK_PATTERNS.indexOf('volume_anomaly');
            expect(r.embedding[volIdx]).toBeGreaterThan(0.9);
        });
        test('all-zero values produce zero vector', () => {
            const r = M.computeAnomalyEmbedding({
                evidence: {
                    cancelRatePerSec: 0, flickerCountPerWindow: 0,
                    cyclesPerMinute: 0, syntheticRatio: 0
                }
            });
            expect(r.embedding).toEqual([0, 0, 0, 0]);
        });
        test('negative value throws', () => {
            expect(() => M.computeAnomalyEmbedding({
                evidence: { cancelRatePerSec: -5 }
            })).toThrow();
        });
    });

    describe('v2 recordDetection with versioning + embedding', () => {
        test('persists versions + embedding by default', () => {
            const r = M.recordDetection({
                userId: UID_DET, resolvedEnv: ENV,
                detectionId: 'v2_d_def', asset: 'BTC',
                attackPattern: 'spoofing_storm',
                evidence: { cancelRatePerSec: 250 }, ts: _now()
            });
            expect(r.detectionModelVersion).toBe(M.DETECTION_MODEL_VERSION);
            expect(r.sanitizationPolicyVersion).toBe(M.SANITIZATION_POLICY_VERSION);
            expect(Array.isArray(r.anomalyEmbedding)).toBe(true);
            expect(r.anomalyEmbedding.length).toBe(M.ATTACK_PATTERNS.length);
        });
        test('custom versions accepted', () => {
            const r = M.recordDetection({
                userId: UID_DET, resolvedEnv: ENV,
                detectionId: 'v2_d_custom', asset: 'BTC',
                attackPattern: 'spoofing_storm',
                evidence: { cancelRatePerSec: 250 },
                detectionModelVersion: 'v2.0.0',
                sanitizationPolicyVersion: 'v1.5.0',
                ts: _now()
            });
            expect(r.detectionModelVersion).toBe('v2.0.0');
            expect(r.sanitizationPolicyVersion).toBe('v1.5.0');
        });
    });

    describe('v2 recordDetection with external_link', () => {
        test('links to gravity_zone', () => {
            const r = M.recordDetection({
                userId: UID_DET, resolvedEnv: ENV,
                detectionId: 'v2_d_link', asset: 'BTC',
                attackPattern: 'spoofing_storm',
                evidence: { cancelRatePerSec: 250 },
                externalLinkKind: 'gravity_zone',
                externalLinkId: 'z_some_zone',
                ts: _now()
            });
            expect(r.externalLinkKind).toBe('gravity_zone');
            expect(r.externalLinkId).toBe('z_some_zone');
        });
        test('invalid externalLinkKind throws', () => {
            expect(() => M.recordDetection({
                userId: UID_DET, resolvedEnv: ENV,
                detectionId: 'v2_d_bad_link', asset: 'BTC',
                attackPattern: 'spoofing_storm',
                evidence: { cancelRatePerSec: 250 },
                externalLinkKind: 'BOGUS',
                externalLinkId: 'x',
                ts: _now()
            })).toThrow(/invalid externalLinkKind/);
        });
        test('externalLinkKind set without externalLinkId throws', () => {
            expect(() => M.recordDetection({
                userId: UID_DET, resolvedEnv: ENV,
                detectionId: 'v2_d_no_id', asset: 'BTC',
                attackPattern: 'spoofing_storm',
                evidence: { cancelRatePerSec: 250 },
                externalLinkKind: 'gravity_zone',
                // externalLinkId missing
                ts: _now()
            })).toThrow(/externalLinkId required/);
        });
        test('no link → both null', () => {
            const r = M.recordDetection({
                userId: UID_DET, resolvedEnv: ENV,
                detectionId: 'v2_d_nolink', asset: 'BTC',
                attackPattern: 'spoofing_storm',
                evidence: { cancelRatePerSec: 250 }, ts: _now()
            });
            expect(r.externalLinkKind).toBeNull();
            expect(r.externalLinkId).toBeNull();
        });
    });

    describe('v2 recordSanitization with policy_version', () => {
        test('default version applied', () => {
            M.recordDetection({
                userId: UID_SAN, resolvedEnv: ENV,
                detectionId: 'v2_d_san_v', asset: 'BTC',
                attackPattern: 'spoofing_storm',
                evidence: { cancelRatePerSec: 250 }, ts: _now()
            });
            const r = M.recordSanitization({
                userId: UID_SAN, resolvedEnv: ENV,
                sanitizationId: 'v2_s_v', detectionId: 'v2_d_san_v',
                originalSignal: { x: 1 }, sanitizedSignal: { x: null },
                sanitizationApplied: true, ts: _now()
            });
            expect(r.sanitizationPolicyVersion).toBe(M.SANITIZATION_POLICY_VERSION);
        });
        test('custom version accepted', () => {
            M.recordDetection({
                userId: UID_SAN, resolvedEnv: ENV,
                detectionId: 'v2_d_san_cv', asset: 'BTC',
                attackPattern: 'spoofing_storm',
                evidence: { cancelRatePerSec: 250 }, ts: _now()
            });
            const r = M.recordSanitization({
                userId: UID_SAN, resolvedEnv: ENV,
                sanitizationId: 'v2_s_cv', detectionId: 'v2_d_san_cv',
                originalSignal: {}, sanitizedSignal: {},
                sanitizationApplied: true,
                sanitizationPolicyVersion: 'v2.0.0',
                ts: _now()
            });
            expect(r.sanitizationPolicyVersion).toBe('v2.0.0');
        });
    });

    describe('v2 getRecentDetections returns embedding + versions', () => {
        test('all v2 fields present', () => {
            const u = UID_HIST;
            M.recordDetection({
                userId: u, resolvedEnv: ENV,
                detectionId: 'v2_h_full', asset: 'BTC',
                attackPattern: 'spoofing_storm',
                evidence: { cancelRatePerSec: 250 }, ts: 1000
            });
            const rows = M.getRecentDetections({
                userId: u, resolvedEnv: ENV,
                asset: 'BTC', severity: 'high', limit: 10
            });
            expect(rows.length).toBe(1);
            const r = rows[0];
            expect(r.detectionModelVersion).toBeDefined();
            expect(r.sanitizationPolicyVersion).toBeDefined();
            expect(Array.isArray(r.anomalyEmbedding)).toBe(true);
            expect(r.anomalyEmbedding.length).toBe(M.ATTACK_PATTERNS.length);
            expect(r.externalLinkKind).toBeNull();
            expect(r.externalLinkId).toBeNull();
        });
    });

    describe('isolation', () => {
        test('uid', () => {
            M.recordDetection({
                userId: UID_ISO_A, resolvedEnv: ENV,
                detectionId: 'iso_a', asset: 'BTC',
                attackPattern: 'spoofing_storm',
                evidence: { cancelRatePerSec: 250 }, ts: 1000
            });
            M.recordDetection({
                userId: UID_ISO_B, resolvedEnv: ENV,
                detectionId: 'iso_b', asset: 'BTC',
                attackPattern: 'spoofing_storm',
                evidence: { cancelRatePerSec: 250 }, ts: 1000
            });
            const rows = M.getRecentDetections({
                userId: UID_ISO_A, resolvedEnv: ENV,
                asset: 'BTC', severity: 'high', limit: 10
            });
            expect(rows.every(r => r.detectionId !== 'iso_b')).toBe(true);
        });
        test('env', () => {
            M.recordDetection({
                userId: UID_ENV, resolvedEnv: 'DEMO',
                detectionId: 'env_d', asset: 'BTC',
                attackPattern: 'spoofing_storm',
                evidence: { cancelRatePerSec: 250 }, ts: 1000
            });
            M.recordDetection({
                userId: UID_ENV, resolvedEnv: 'TESTNET',
                detectionId: 'env_t', asset: 'BTC',
                attackPattern: 'spoofing_storm',
                evidence: { cancelRatePerSec: 250 }, ts: 1000
            });
            const demo = M.getRecentDetections({
                userId: UID_ENV, resolvedEnv: 'DEMO',
                asset: 'BTC', severity: 'high', limit: 10
            });
            expect(demo.every(r => r.detectionId !== 'env_t')).toBe(true);
        });
    });
});
