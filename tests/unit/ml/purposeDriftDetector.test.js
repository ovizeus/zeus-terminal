'use strict';

/**
 * OMEGA §149 PURPOSE DRIFT DETECTOR / ENDS-MEANS MISALIGNMENT ENGINE.
 * Canonical: /root/_review/ml_brain/ml_brain_canonic.txt lines 4869-4922.
 *
 * "mai servesc inca scopul meu real sau am inceput sa servesc doar
 *  mecanismele mele locale?"
 *
 * Tests FIRST per TDD discipline (RED step).
 */

const path = require('path');
const fs = require('fs');
const os = require('os');

const TEST_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-w3-p149-'));
const TEST_DB_PATH = path.join(TEST_DB_DIR, 'test.db');
process.env.ZEUS_DB_PATH = TEST_DB_PATH;
process.env.ZEUS_TEST_DISABLE_AUTH = '1';

const { db } = require('../../../server/services/database');
const M = require('../../../server/services/ml/_meta/purposeDriftDetector');

const UID = 9149;
const UID_REG = 9249;
const UID_AUD = 9349;
const UID_GET = 9449;
const UID_ISO_A = 9549;
const UID_ISO_B = 9649;
const UID_ENV = 9749;
const UID_RET = 9849;
const ENV = 'DEMO';
const _now = () => Date.now();

function cleanRows() {
    const uids = [UID, UID_REG, UID_AUD, UID_GET,
                  UID_ISO_A, UID_ISO_B, UID_ENV, UID_RET];
    const placeholders = uids.map(() => '?').join(',');
    db.prepare(`DELETE FROM ml_purpose_drift_audits WHERE user_id IN (${placeholders})`).run(...uids);
    // Children first (parent_purpose_id NOT NULL), then roots — FK RESTRICT
    db.prepare(`DELETE FROM ml_purpose_registry WHERE user_id IN (${placeholders}) AND parent_purpose_id IS NOT NULL`).run(...uids);
    db.prepare(`DELETE FROM ml_purpose_registry WHERE user_id IN (${placeholders}) AND parent_purpose_id IS NULL`).run(...uids);
}
beforeEach(() => cleanRows());
afterAll(() => cleanRows());

describe('OMEGA §149 PURPOSE DRIFT DETECTOR', () => {

    describe('Migrations 296+297', () => {
        test('296 applied', () => {
            expect(db.prepare("SELECT name FROM _migrations WHERE name=?").get('296_ml_purpose_registry')).toBeTruthy();
        });
        test('297 applied', () => {
            expect(db.prepare("SELECT name FROM _migrations WHERE name=?").get('297_ml_purpose_drift_audits')).toBeTruthy();
        });
        test('level CHECK enum on registry', () => {
            expect(() => db.prepare(`INSERT INTO ml_purpose_registry
                (user_id, resolved_env, purpose_id, level, parent_purpose_id,
                 description, telos_statement, active, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
                .run(UID, ENV, 'p_bk', 'BOGUS', null,
                    'desc', null, 1, _now())).toThrow();
        });
        test('substitution_pattern CHECK enum on audits', () => {
            // First insert a parent purpose so FK passes
            db.prepare(`INSERT INTO ml_purpose_registry
                (user_id, resolved_env, purpose_id, level, parent_purpose_id,
                 description, telos_statement, active, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
                .run(UID, ENV, 'p_for_ck1', 'final', null,
                    'd', 'telos', 1, _now());
            expect(() => db.prepare(`INSERT INTO ml_purpose_drift_audits
                (user_id, resolved_env, audit_id, audited_purpose_id,
                 justification_score, substitution_pattern,
                 drift_score, drift_severity, recommended_action, ts)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
                .run(UID, ENV, 'a_bk', 'p_for_ck1', 0.5, 'BOGUS',
                    0.5, 'moderate', 'continue', _now())).toThrow();
        });
        test('drift_severity CHECK enum', () => {
            db.prepare(`INSERT INTO ml_purpose_registry
                (user_id, resolved_env, purpose_id, level, parent_purpose_id,
                 description, telos_statement, active, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
                .run(UID, ENV, 'p_for_ck2', 'final', null,
                    'd', 'telos', 1, _now());
            expect(() => db.prepare(`INSERT INTO ml_purpose_drift_audits
                (user_id, resolved_env, audit_id, audited_purpose_id,
                 justification_score, substitution_pattern,
                 drift_score, drift_severity, recommended_action, ts)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
                .run(UID, ENV, 'a_sv', 'p_for_ck2', 0.5, null,
                    0.5, 'BOGUS', 'continue', _now())).toThrow();
        });
        test('purpose_id UNIQUE', () => {
            const stmt = db.prepare(`INSERT INTO ml_purpose_registry
                (user_id, resolved_env, purpose_id, level, parent_purpose_id,
                 description, telos_statement, active, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
            stmt.run(UID, ENV, 'p_dup', 'final', null,
                'd', 'telos', 1, _now());
            expect(() => stmt.run(UID, ENV, 'p_dup', 'proximate', null,
                'd2', null, 1, _now())).toThrow();
        });
        test('FK ON DELETE RESTRICT on parent_purpose_id', () => {
            db.prepare(`INSERT INTO ml_purpose_registry
                (user_id, resolved_env, purpose_id, level, parent_purpose_id,
                 description, telos_statement, active, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
                .run(UID, ENV, 'p_parent', 'final', null,
                    'parent', 'telos', 1, _now());
            db.prepare(`INSERT INTO ml_purpose_registry
                (user_id, resolved_env, purpose_id, level, parent_purpose_id,
                 description, telos_statement, active, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
                .run(UID, ENV, 'p_child', 'proximate', 'p_parent',
                    'child', null, 1, _now());
            // Try to delete parent - should fail because child references it
            expect(() => db.prepare(`DELETE FROM ml_purpose_registry WHERE purpose_id=?`).run('p_parent')).toThrow();
            // Cleanup child-before-parent (FK RESTRICT enforced)
            db.prepare(`DELETE FROM ml_purpose_registry WHERE purpose_id=?`).run('p_child');
            db.prepare(`DELETE FROM ml_purpose_registry WHERE purpose_id=?`).run('p_parent');
        });
    });

    describe('Constants', () => {
        test('PURPOSE_LEVELS frozen 4', () => {
            expect(M.PURPOSE_LEVELS).toEqual([
                'final', 'proximate', 'intermediate_metric', 'policy_action'
            ]);
            expect(Object.isFrozen(M.PURPOSE_LEVELS)).toBe(true);
        });
        test('SUBSTITUTION_PATTERNS frozen 4 (canonical PDF list)', () => {
            expect(M.SUBSTITUTION_PATTERNS).toEqual([
                'metric_becomes_purpose',
                'convenience_becomes_strategy',
                'safety_theater_becomes_paralysis',
                'confidence_becomes_identity'
            ]);
            expect(Object.isFrozen(M.SUBSTITUTION_PATTERNS)).toBe(true);
        });
        test('DRIFT_SEVERITIES frozen 3', () => {
            expect(M.DRIFT_SEVERITIES).toEqual(['none', 'moderate', 'severe']);
            expect(Object.isFrozen(M.DRIFT_SEVERITIES)).toBe(true);
        });
        test('RECOMMENDATIONS frozen 3', () => {
            expect(M.RECOMMENDATIONS).toEqual([
                'continue', 'governance_review', 'retire_purpose'
            ]);
            expect(Object.isFrozen(M.RECOMMENDATIONS)).toBe(true);
        });
        test('DRIFT_THRESHOLDS ordered', () => {
            expect(M.DRIFT_THRESHOLDS.severe).toBe(0.70);
            expect(M.DRIFT_THRESHOLDS.moderate).toBe(0.40);
        });
        test('MIN_JUSTIFICATION_SCORE = 0.30', () => {
            expect(M.MIN_JUSTIFICATION_SCORE).toBe(0.30);
        });
        test('SUBSTITUTION_DETECT_THRESHOLD = 0.60', () => {
            // Signal ratio above this threshold flags substitution pattern
            expect(M.SUBSTITUTION_DETECT_THRESHOLD).toBe(0.60);
        });
    });

    describe('classifyDrift (pure)', () => {
        test('drift < 0.40 → none', () => {
            expect(M.classifyDrift({ driftScore: 0.20 }).severity).toBe('none');
        });
        test('drift 0.40..0.70 → moderate', () => {
            expect(M.classifyDrift({ driftScore: 0.55 }).severity).toBe('moderate');
        });
        test('drift ≥ 0.70 → severe', () => {
            expect(M.classifyDrift({ driftScore: 0.85 }).severity).toBe('severe');
        });
        test('boundary 0.40 → moderate', () => {
            expect(M.classifyDrift({ driftScore: 0.40 }).severity).toBe('moderate');
        });
        test('boundary 0.70 → severe', () => {
            expect(M.classifyDrift({ driftScore: 0.70 }).severity).toBe('severe');
        });
        test('out-of-range throws', () => {
            expect(() => M.classifyDrift({ driftScore: 1.5 })).toThrow();
        });
    });

    describe('detectSubstitutionPattern (pure)', () => {
        test('no signal above threshold → null', () => {
            const r = M.detectSubstitutionPattern({
                metricFocusRatio: 0.30,
                conveniencePursuitRatio: 0.20,
                safetyParalysisRatio: 0.10,
                confidenceIdentityRatio: 0.40
            });
            expect(r.pattern).toBeNull();
        });
        test('metricFocusRatio dominant → metric_becomes_purpose', () => {
            const r = M.detectSubstitutionPattern({
                metricFocusRatio: 0.80,
                conveniencePursuitRatio: 0.20,
                safetyParalysisRatio: 0.10,
                confidenceIdentityRatio: 0.10
            });
            expect(r.pattern).toBe('metric_becomes_purpose');
        });
        test('conveniencePursuitRatio dominant → convenience_becomes_strategy', () => {
            const r = M.detectSubstitutionPattern({
                metricFocusRatio: 0.10,
                conveniencePursuitRatio: 0.75,
                safetyParalysisRatio: 0.10,
                confidenceIdentityRatio: 0.10
            });
            expect(r.pattern).toBe('convenience_becomes_strategy');
        });
        test('safetyParalysisRatio dominant → safety_theater_becomes_paralysis', () => {
            const r = M.detectSubstitutionPattern({
                metricFocusRatio: 0.10,
                conveniencePursuitRatio: 0.10,
                safetyParalysisRatio: 0.85,
                confidenceIdentityRatio: 0.10
            });
            expect(r.pattern).toBe('safety_theater_becomes_paralysis');
        });
        test('confidenceIdentityRatio dominant → confidence_becomes_identity', () => {
            const r = M.detectSubstitutionPattern({
                metricFocusRatio: 0.10,
                conveniencePursuitRatio: 0.10,
                safetyParalysisRatio: 0.10,
                confidenceIdentityRatio: 0.90
            });
            expect(r.pattern).toBe('confidence_becomes_identity');
        });
        test('multiple above threshold → pick highest', () => {
            const r = M.detectSubstitutionPattern({
                metricFocusRatio: 0.65,
                conveniencePursuitRatio: 0.70,
                safetyParalysisRatio: 0.61,
                confidenceIdentityRatio: 0.20
            });
            expect(r.pattern).toBe('convenience_becomes_strategy');
        });
        test('out-of-range throws', () => {
            expect(() => M.detectSubstitutionPattern({
                metricFocusRatio: 1.5,
                conveniencePursuitRatio: 0,
                safetyParalysisRatio: 0,
                confidenceIdentityRatio: 0
            })).toThrow();
        });
    });

    describe('computeDriftScore (pure)', () => {
        test('high justification + no substitution → low drift', () => {
            const r = M.computeDriftScore({
                justificationScore: 0.90,
                substitutionPattern: null
            });
            expect(r.driftScore).toBeLessThan(0.20);
        });
        test('low justification + substitution → high drift', () => {
            const r = M.computeDriftScore({
                justificationScore: 0.10,
                substitutionPattern: 'metric_becomes_purpose'
            });
            expect(r.driftScore).toBeGreaterThan(0.70);
        });
        test('low justification alone → moderate-high drift', () => {
            const r = M.computeDriftScore({
                justificationScore: 0.20,
                substitutionPattern: null
            });
            expect(r.driftScore).toBeGreaterThanOrEqual(0.40);
            expect(r.driftScore).toBeLessThan(0.80);
        });
        test('moderate justification + substitution → moderate-high drift', () => {
            const r = M.computeDriftScore({
                justificationScore: 0.50,
                substitutionPattern: 'safety_theater_becomes_paralysis'
            });
            expect(r.driftScore).toBeGreaterThanOrEqual(0.40);
        });
        test('out-of-range throws', () => {
            expect(() => M.computeDriftScore({
                justificationScore: 1.5,
                substitutionPattern: null
            })).toThrow();
        });
        test('invalid substitution pattern throws', () => {
            expect(() => M.computeDriftScore({
                justificationScore: 0.5,
                substitutionPattern: 'BOGUS'
            })).toThrow();
        });
    });

    describe('recommendAction (pure)', () => {
        test('none severity → continue', () => {
            expect(M.recommendAction({
                driftSeverity: 'none', substitutionPattern: null
            }).action).toBe('continue');
        });
        test('moderate severity → governance_review', () => {
            expect(M.recommendAction({
                driftSeverity: 'moderate', substitutionPattern: null
            }).action).toBe('governance_review');
        });
        test('severe + substitution → retire_purpose', () => {
            expect(M.recommendAction({
                driftSeverity: 'severe',
                substitutionPattern: 'metric_becomes_purpose'
            }).action).toBe('retire_purpose');
        });
        test('severe without substitution → governance_review', () => {
            expect(M.recommendAction({
                driftSeverity: 'severe', substitutionPattern: null
            }).action).toBe('governance_review');
        });
        test('invalid severity throws', () => {
            expect(() => M.recommendAction({
                driftSeverity: 'BOGUS', substitutionPattern: null
            })).toThrow();
        });
    });

    describe('registerPurpose', () => {
        test('register final purpose (no parent)', () => {
            const r = M.registerPurpose({
                userId: UID_REG, resolvedEnv: ENV,
                purposeId: 'rp_final',
                level: 'final',
                description: 'sustainable alpha',
                telosStatement: 'maintain positive expectancy across regimes',
                ts: _now()
            });
            expect(r.registered).toBe(true);
            expect(r.purposeId).toBe('rp_final');
        });
        test('register proximate with parent', () => {
            M.registerPurpose({
                userId: UID_REG, resolvedEnv: ENV,
                purposeId: 'rp_f', level: 'final',
                description: 'final', telosStatement: 'telos',
                ts: _now()
            });
            const r = M.registerPurpose({
                userId: UID_REG, resolvedEnv: ENV,
                purposeId: 'rp_prox',
                level: 'proximate',
                parentPurposeId: 'rp_f',
                description: 'PnL above threshold',
                ts: _now()
            });
            expect(r.registered).toBe(true);
        });
        test('final purpose requires telosStatement', () => {
            expect(() => M.registerPurpose({
                userId: UID_REG, resolvedEnv: ENV,
                purposeId: 'rp_no_telos',
                level: 'final',
                description: 'desc',
                ts: _now()
            })).toThrow(/telos/i);
        });
        test('non-final purpose requires parentPurposeId', () => {
            expect(() => M.registerPurpose({
                userId: UID_REG, resolvedEnv: ENV,
                purposeId: 'rp_no_parent',
                level: 'proximate',
                description: 'desc',
                ts: _now()
            })).toThrow(/parent/i);
        });
        test('invalid level throws', () => {
            expect(() => M.registerPurpose({
                userId: UID_REG, resolvedEnv: ENV,
                purposeId: 'rp_lvl',
                level: 'BOGUS',
                description: 'd',
                ts: _now()
            })).toThrow();
        });
        test('duplicate purposeId throws', () => {
            M.registerPurpose({
                userId: UID_REG, resolvedEnv: ENV,
                purposeId: 'rp_dup',
                level: 'final',
                description: 'd',
                telosStatement: 't',
                ts: _now()
            });
            expect(() => M.registerPurpose({
                userId: UID_REG, resolvedEnv: ENV,
                purposeId: 'rp_dup',
                level: 'final',
                description: 'd',
                telosStatement: 't',
                ts: _now()
            })).toThrow(/duplicate/);
        });
        test('parent must exist (FK)', () => {
            expect(() => M.registerPurpose({
                userId: UID_REG, resolvedEnv: ENV,
                purposeId: 'rp_orphan',
                level: 'proximate',
                parentPurposeId: 'rp_nonexistent',
                description: 'd',
                ts: _now()
            })).toThrow();
        });
    });

    describe('auditPurposeDrift (integration)', () => {
        test('high justification → none + continue', () => {
            M.registerPurpose({
                userId: UID_AUD, resolvedEnv: ENV,
                purposeId: 'aud_p_good', level: 'final',
                description: 'good', telosStatement: 'telos',
                ts: _now()
            });
            const r = M.auditPurposeDrift({
                userId: UID_AUD, resolvedEnv: ENV,
                auditId: 'aud_good',
                purposeId: 'aud_p_good',
                justificationScore: 0.90,
                substitutionSignals: {
                    metricFocusRatio: 0.10,
                    conveniencePursuitRatio: 0.10,
                    safetyParalysisRatio: 0.10,
                    confidenceIdentityRatio: 0.10
                },
                ts: _now()
            });
            expect(r.recorded).toBe(true);
            expect(r.driftSeverity).toBe('none');
            expect(r.recommendedAction).toBe('continue');
            expect(r.substitutionPattern).toBeNull();
        });
        test('low justification + metric substitution → severe + retire_purpose', () => {
            M.registerPurpose({
                userId: UID_AUD, resolvedEnv: ENV,
                purposeId: 'aud_p_bad', level: 'final',
                description: 'degraded', telosStatement: 'telos',
                ts: _now()
            });
            const r = M.auditPurposeDrift({
                userId: UID_AUD, resolvedEnv: ENV,
                auditId: 'aud_bad',
                purposeId: 'aud_p_bad',
                justificationScore: 0.10,
                substitutionSignals: {
                    metricFocusRatio: 0.85,
                    conveniencePursuitRatio: 0.10,
                    safetyParalysisRatio: 0.10,
                    confidenceIdentityRatio: 0.10
                },
                ts: _now()
            });
            expect(r.driftSeverity).toBe('severe');
            expect(r.substitutionPattern).toBe('metric_becomes_purpose');
            expect(r.recommendedAction).toBe('retire_purpose');
        });
        test('moderate drift → governance_review', () => {
            M.registerPurpose({
                userId: UID_AUD, resolvedEnv: ENV,
                purposeId: 'aud_p_med', level: 'final',
                description: 'medium', telosStatement: 'telos',
                ts: _now()
            });
            const r = M.auditPurposeDrift({
                userId: UID_AUD, resolvedEnv: ENV,
                auditId: 'aud_med',
                purposeId: 'aud_p_med',
                justificationScore: 0.35,
                substitutionSignals: {
                    metricFocusRatio: 0.20,
                    conveniencePursuitRatio: 0.20,
                    safetyParalysisRatio: 0.20,
                    confidenceIdentityRatio: 0.20
                },
                ts: _now()
            });
            expect(r.driftSeverity).toBe('moderate');
            expect(r.recommendedAction).toBe('governance_review');
        });
        test('audit on nonexistent purpose throws (FK)', () => {
            expect(() => M.auditPurposeDrift({
                userId: UID_AUD, resolvedEnv: ENV,
                auditId: 'aud_orph',
                purposeId: 'aud_p_nonexistent',
                justificationScore: 0.5,
                substitutionSignals: {
                    metricFocusRatio: 0.10,
                    conveniencePursuitRatio: 0.10,
                    safetyParalysisRatio: 0.10,
                    confidenceIdentityRatio: 0.10
                },
                ts: _now()
            })).toThrow();
        });
        test('duplicate auditId throws', () => {
            M.registerPurpose({
                userId: UID_AUD, resolvedEnv: ENV,
                purposeId: 'aud_p_dup', level: 'final',
                description: 'd', telosStatement: 't',
                ts: _now()
            });
            M.auditPurposeDrift({
                userId: UID_AUD, resolvedEnv: ENV,
                auditId: 'aud_dup_id',
                purposeId: 'aud_p_dup',
                justificationScore: 0.5,
                substitutionSignals: {
                    metricFocusRatio: 0.10, conveniencePursuitRatio: 0.10,
                    safetyParalysisRatio: 0.10, confidenceIdentityRatio: 0.10
                },
                ts: _now()
            });
            expect(() => M.auditPurposeDrift({
                userId: UID_AUD, resolvedEnv: ENV,
                auditId: 'aud_dup_id',
                purposeId: 'aud_p_dup',
                justificationScore: 0.5,
                substitutionSignals: {
                    metricFocusRatio: 0.10, conveniencePursuitRatio: 0.10,
                    safetyParalysisRatio: 0.10, confidenceIdentityRatio: 0.10
                },
                ts: _now()
            })).toThrow(/duplicate/);
        });
    });

    describe('getPurposeRegistry', () => {
        test('returns all purposes for user × env (active only by default)', () => {
            M.registerPurpose({
                userId: UID_GET, resolvedEnv: ENV,
                purposeId: 'g_f1', level: 'final',
                description: 'd', telosStatement: 't', ts: _now()
            });
            M.registerPurpose({
                userId: UID_GET, resolvedEnv: ENV,
                purposeId: 'g_p1', level: 'proximate',
                parentPurposeId: 'g_f1',
                description: 'd', ts: _now()
            });
            const r = M.getPurposeRegistry({
                userId: UID_GET, resolvedEnv: ENV
            });
            expect(r.length).toBe(2);
        });
        test('filter by level', () => {
            M.registerPurpose({
                userId: UID_GET, resolvedEnv: ENV,
                purposeId: 'gl_f', level: 'final',
                description: 'd', telosStatement: 't', ts: _now()
            });
            M.registerPurpose({
                userId: UID_GET, resolvedEnv: ENV,
                purposeId: 'gl_p', level: 'proximate',
                parentPurposeId: 'gl_f',
                description: 'd', ts: _now()
            });
            const r = M.getPurposeRegistry({
                userId: UID_GET, resolvedEnv: ENV,
                level: 'final'
            });
            expect(r.length).toBe(1);
            expect(r[0].purposeId).toBe('gl_f');
        });
    });

    describe('getLatestAudit', () => {
        test('returns most recent audit for purpose, or null', () => {
            M.registerPurpose({
                userId: UID_GET, resolvedEnv: ENV,
                purposeId: 'la_p', level: 'final',
                description: 'd', telosStatement: 't', ts: 1000
            });
            M.auditPurposeDrift({
                userId: UID_GET, resolvedEnv: ENV,
                auditId: 'la_a1', purposeId: 'la_p',
                justificationScore: 0.8,
                substitutionSignals: {
                    metricFocusRatio: 0.1, conveniencePursuitRatio: 0.1,
                    safetyParalysisRatio: 0.1, confidenceIdentityRatio: 0.1
                },
                ts: 2000
            });
            M.auditPurposeDrift({
                userId: UID_GET, resolvedEnv: ENV,
                auditId: 'la_a2', purposeId: 'la_p',
                justificationScore: 0.6,
                substitutionSignals: {
                    metricFocusRatio: 0.1, conveniencePursuitRatio: 0.1,
                    safetyParalysisRatio: 0.1, confidenceIdentityRatio: 0.1
                },
                ts: 3000
            });
            const r = M.getLatestAudit({
                userId: UID_GET, resolvedEnv: ENV,
                purposeId: 'la_p'
            });
            expect(r.auditId).toBe('la_a2');
        });
        test('returns null when no audits', () => {
            M.registerPurpose({
                userId: UID_GET, resolvedEnv: ENV,
                purposeId: 'la_no', level: 'final',
                description: 'd', telosStatement: 't', ts: _now()
            });
            expect(M.getLatestAudit({
                userId: UID_GET, resolvedEnv: ENV,
                purposeId: 'la_no'
            })).toBeNull();
        });
    });

    describe('retirePurpose', () => {
        test('marks purpose as retired (active=0)', () => {
            M.registerPurpose({
                userId: UID_RET, resolvedEnv: ENV,
                purposeId: 'ret_p', level: 'final',
                description: 'd', telosStatement: 't', ts: _now()
            });
            const r = M.retirePurpose({
                userId: UID_RET, resolvedEnv: ENV,
                purposeId: 'ret_p',
                ts: _now()
            });
            expect(r.retired).toBe(true);
            const active = M.getPurposeRegistry({
                userId: UID_RET, resolvedEnv: ENV
            });
            expect(active.find(p => p.purposeId === 'ret_p')).toBeUndefined();
        });
        test('retire idempotent (no error if already retired)', () => {
            M.registerPurpose({
                userId: UID_RET, resolvedEnv: ENV,
                purposeId: 'ret_idem', level: 'final',
                description: 'd', telosStatement: 't', ts: _now()
            });
            M.retirePurpose({
                userId: UID_RET, resolvedEnv: ENV,
                purposeId: 'ret_idem',
                ts: _now()
            });
            const r = M.retirePurpose({
                userId: UID_RET, resolvedEnv: ENV,
                purposeId: 'ret_idem',
                ts: _now()
            });
            expect(r.retired).toBe(true);
        });
        test('retire nonexistent throws', () => {
            expect(() => M.retirePurpose({
                userId: UID_RET, resolvedEnv: ENV,
                purposeId: 'ret_nope',
                ts: _now()
            })).toThrow(/not found/i);
        });
    });

    describe('isolation per user × env', () => {
        test('uid isolation', () => {
            M.registerPurpose({
                userId: UID_ISO_A, resolvedEnv: ENV,
                purposeId: 'iso_a', level: 'final',
                description: 'd', telosStatement: 't', ts: _now()
            });
            M.registerPurpose({
                userId: UID_ISO_B, resolvedEnv: ENV,
                purposeId: 'iso_b', level: 'final',
                description: 'd', telosStatement: 't', ts: _now()
            });
            const a = M.getPurposeRegistry({
                userId: UID_ISO_A, resolvedEnv: ENV
            });
            expect(a.every(p => p.purposeId !== 'iso_b')).toBe(true);
        });
        test('env isolation', () => {
            M.registerPurpose({
                userId: UID_ENV, resolvedEnv: 'DEMO',
                purposeId: 'env_demo', level: 'final',
                description: 'd', telosStatement: 't', ts: _now()
            });
            const testnet = M.getPurposeRegistry({
                userId: UID_ENV, resolvedEnv: 'TESTNET'
            });
            expect(testnet).toEqual([]);
        });
    });
});
