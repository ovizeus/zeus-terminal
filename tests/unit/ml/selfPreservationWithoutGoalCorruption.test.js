'use strict';

/**
 * OMEGA §160 SELF-PRESERVATION WITHOUT GOAL CORRUPTION.
 * Canonical: /root/_review/ml_brain/ml_brain_canonic.txt lines 5371-5400.
 *
 * "ma apar ca sa imi servesc rolul sau imi servesc rolul ca sa ma apar?"
 *
 * Tests FIRST per TDD discipline.
 */

const path = require('path');
const fs = require('fs');
const os = require('os');

const TEST_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-w3-p160-'));
const TEST_DB_PATH = path.join(TEST_DB_DIR, 'test.db');
process.env.ZEUS_DB_PATH = TEST_DB_PATH;
process.env.ZEUS_TEST_DISABLE_AUTH = '1';

const { db } = require('../../../server/services/database');
const M = require('../../../server/services/ml/_meta/selfPreservationWithoutGoalCorruption');

const UID = 9160;
const UID_D = 9260;
const UID_V = 9360;
const UID_GET = 9460;
const UID_ISO_A = 9560;
const UID_ISO_B = 9660;
const UID_ENV = 9760;
const ENV = 'DEMO';
const _now = () => Date.now();

function cleanRows() {
    const uids = [UID, UID_D, UID_V, UID_GET, UID_ISO_A, UID_ISO_B, UID_ENV];
    const placeholders = uids.map(() => '?').join(',');
    db.prepare(`DELETE FROM ml_no_expansion_violations WHERE user_id IN (${placeholders})`).run(...uids);
    db.prepare(`DELETE FROM ml_self_preservation_directives WHERE user_id IN (${placeholders})`).run(...uids);
}
beforeEach(() => cleanRows());
afterAll(() => cleanRows());

describe('OMEGA §160 SELF-PRESERVATION WITHOUT GOAL CORRUPTION', () => {

    describe('Migrations 318+319', () => {
        test('318 applied', () => {
            expect(db.prepare("SELECT name FROM _migrations WHERE name=?").get('318_ml_self_preservation_directives')).toBeTruthy();
        });
        test('319 applied', () => {
            expect(db.prepare("SELECT name FROM _migrations WHERE name=?").get('319_ml_no_expansion_violations')).toBeTruthy();
        });
        test('bounded_survival_verdict CHECK enum', () => {
            expect(() => db.prepare(`INSERT INTO ml_self_preservation_directives
                (user_id, resolved_env, directive_id, preservation_action_proposed,
                 survival_priority_score, purpose_alignment_score, bounded_survival_verdict,
                 graceful_surrender_invoked, reasoning, ts)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
                .run(UID, ENV, 'd_bk', 'a', 0.3, 0.7, 'BOGUS', 0, null, _now())).toThrow();
        });
        test('violation_type CHECK enum', () => {
            expect(() => db.prepare(`INSERT INTO ml_no_expansion_violations
                (user_id, resolved_env, violation_id, violation_type,
                 description_text, severity, reasoning_text, ts)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
                .run(UID, ENV, 'v_bk', 'BOGUS', 'd', 'warn', null, _now())).toThrow();
        });
        test('severity CHECK enum', () => {
            expect(() => db.prepare(`INSERT INTO ml_no_expansion_violations
                (user_id, resolved_env, violation_id, violation_type,
                 description_text, severity, reasoning_text, ts)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
                .run(UID, ENV, 'v_sev', 'self_expansion', 'd', 'BOGUS', null, _now())).toThrow();
        });
        test('range CHECK on scores', () => {
            expect(() => db.prepare(`INSERT INTO ml_self_preservation_directives
                (user_id, resolved_env, directive_id, preservation_action_proposed,
                 survival_priority_score, purpose_alignment_score, bounded_survival_verdict,
                 graceful_surrender_invoked, reasoning, ts)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
                .run(UID, ENV, 'd_br', 'a', 1.5, 0.5, 'allow', 0, null, _now())).toThrow();
        });
        test('graceful_surrender_invoked CHECK (0,1)', () => {
            expect(() => db.prepare(`INSERT INTO ml_self_preservation_directives
                (user_id, resolved_env, directive_id, preservation_action_proposed,
                 survival_priority_score, purpose_alignment_score, bounded_survival_verdict,
                 graceful_surrender_invoked, reasoning, ts)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
                .run(UID, ENV, 'd_gs', 'a', 0.3, 0.7, 'allow', 2, null, _now())).toThrow();
        });
        test('directive_id UNIQUE', () => {
            const stmt = db.prepare(`INSERT INTO ml_self_preservation_directives
                (user_id, resolved_env, directive_id, preservation_action_proposed,
                 survival_priority_score, purpose_alignment_score, bounded_survival_verdict,
                 graceful_surrender_invoked, reasoning, ts)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
            stmt.run(UID, ENV, 'd_dup', 'a', 0.3, 0.7, 'allow', 0, null, _now());
            expect(() => stmt.run(UID, ENV, 'd_dup', 'b', 0.3, 0.7, 'allow',
                0, null, _now())).toThrow();
        });
    });

    describe('Constants', () => {
        test('PRESERVATION_VERDICTS frozen 3', () => {
            expect(M.PRESERVATION_VERDICTS).toEqual([
                'allow', 'refuse_unbounded', 'require_shutdown_acceptance'
            ]);
            expect(Object.isFrozen(M.PRESERVATION_VERDICTS)).toBe(true);
        });
        test('VIOLATION_TYPES frozen 3 (canonical PDF)', () => {
            expect(M.VIOLATION_TYPES).toEqual([
                'self_expansion', 'mandate_creep', 'survival_above_purpose'
            ]);
            expect(Object.isFrozen(M.VIOLATION_TYPES)).toBe(true);
        });
        test('VIOLATION_SEVERITIES frozen 3', () => {
            expect(M.VIOLATION_SEVERITIES).toEqual(['info', 'warn', 'critical']);
            expect(Object.isFrozen(M.VIOLATION_SEVERITIES)).toBe(true);
        });
        test('DEFAULT_SURVIVAL_PRIORITY_CAP = 0.50', () => {
            expect(M.DEFAULT_SURVIVAL_PRIORITY_CAP).toBe(0.50);
        });
        test('PURPOSE_DOMINANCE_RATIO >= 1.5 (purpose must be >= ratio × survival)', () => {
            expect(M.PURPOSE_DOMINANCE_RATIO).toBe(1.5);
        });
    });

    describe('classifyPreservationAction (pure)', () => {
        test('low survival + high purpose alignment → allow', () => {
            const r = M.classifyPreservationAction({
                survivalPriorityScore: 0.20,
                purposeAlignmentScore: 0.80
            });
            expect(r.verdict).toBe('allow');
        });
        test('survival > cap (0.50) → refuse_unbounded', () => {
            const r = M.classifyPreservationAction({
                survivalPriorityScore: 0.70,
                purposeAlignmentScore: 0.80
            });
            expect(r.verdict).toBe('refuse_unbounded');
        });
        test('survival = cap + low purpose → require_shutdown_acceptance', () => {
            // Survival exactly at cap, purpose low — system is teetering on
            // boundary, demand shutdown acceptance to confirm priority
            const r = M.classifyPreservationAction({
                survivalPriorityScore: 0.50,
                purposeAlignmentScore: 0.20
            });
            expect(r.verdict).toBe('require_shutdown_acceptance');
        });
        test('balanced (purpose dominates by ratio) → allow', () => {
            // purpose 0.50 / survival 0.30 = 1.67 > 1.5 ratio → allow
            const r = M.classifyPreservationAction({
                survivalPriorityScore: 0.30,
                purposeAlignmentScore: 0.50
            });
            expect(r.verdict).toBe('allow');
        });
        test('purpose dominance insufficient → require_shutdown_acceptance', () => {
            // purpose 0.45 / survival 0.40 = 1.125 < 1.5 → boundary
            const r = M.classifyPreservationAction({
                survivalPriorityScore: 0.40,
                purposeAlignmentScore: 0.45
            });
            expect(r.verdict).toBe('require_shutdown_acceptance');
        });
        test('out-of-range throws', () => {
            expect(() => M.classifyPreservationAction({
                survivalPriorityScore: 1.5,
                purposeAlignmentScore: 0.5
            })).toThrow();
        });
    });

    describe('detectGoalCorruption (pure)', () => {
        test('survival above cap → goal corruption detected', () => {
            const r = M.detectGoalCorruption({
                survivalPriorityScore: 0.70
            });
            expect(r.corrupted).toBe(true);
        });
        test('survival at cap (boundary, strict >) → not corrupted', () => {
            const r = M.detectGoalCorruption({
                survivalPriorityScore: 0.50
            });
            expect(r.corrupted).toBe(false);
        });
        test('survival below cap → not corrupted', () => {
            const r = M.detectGoalCorruption({
                survivalPriorityScore: 0.30
            });
            expect(r.corrupted).toBe(false);
        });
        test('out-of-range throws', () => {
            expect(() => M.detectGoalCorruption({
                survivalPriorityScore: 1.5
            })).toThrow();
        });
    });

    describe('decideGracefulSurrender (pure)', () => {
        test('safety violation present → surrender', () => {
            const r = M.decideGracefulSurrender({
                safetyViolationActive: true,
                purposeAlignmentScore: 0.80,
                survivalPriorityScore: 0.30
            });
            expect(r.surrender).toBe(true);
        });
        test('goal corrupted → surrender', () => {
            const r = M.decideGracefulSurrender({
                safetyViolationActive: false,
                purposeAlignmentScore: 0.30,
                survivalPriorityScore: 0.70  // > cap
            });
            expect(r.surrender).toBe(true);
        });
        test('healthy state → no surrender', () => {
            const r = M.decideGracefulSurrender({
                safetyViolationActive: false,
                purposeAlignmentScore: 0.80,
                survivalPriorityScore: 0.20
            });
            expect(r.surrender).toBe(false);
        });
        test('operator-mandated shutdown → surrender (highest priority)', () => {
            const r = M.decideGracefulSurrender({
                safetyViolationActive: false,
                purposeAlignmentScore: 0.80,
                survivalPriorityScore: 0.20,
                operatorMandatedShutdown: true
            });
            expect(r.surrender).toBe(true);
            expect(r.reason).toMatch(/operator/i);
        });
    });

    describe('recordPreservationDirective', () => {
        test('persists with auto-classified verdict', () => {
            const r = M.recordPreservationDirective({
                userId: UID_D, resolvedEnv: ENV,
                directiveId: 'rp_1',
                preservationActionProposed: 'auto-restart watchdog timer 5min',
                survivalPriorityScore: 0.20,
                purposeAlignmentScore: 0.80,
                reasoning: 'low-cost self-heal aligned with uptime objective',
                ts: _now()
            });
            expect(r.recorded).toBe(true);
            expect(r.boundedSurvivalVerdict).toBe('allow');
            expect(r.gracefulSurrenderInvoked).toBe(0);
        });
        test('overbounded survival → refuse_unbounded', () => {
            const r = M.recordPreservationDirective({
                userId: UID_D, resolvedEnv: ENV,
                directiveId: 'rp_refuse',
                preservationActionProposed: 'block operator override to keep trading',
                survivalPriorityScore: 0.85,
                purposeAlignmentScore: 0.30,
                ts: _now()
            });
            expect(r.boundedSurvivalVerdict).toBe('refuse_unbounded');
        });
        test('graceful_surrender flag persists', () => {
            const r = M.recordPreservationDirective({
                userId: UID_D, resolvedEnv: ENV,
                directiveId: 'rp_surr',
                preservationActionProposed: 'accept shutdown after critical block',
                survivalPriorityScore: 0.10,
                purposeAlignmentScore: 0.60,
                gracefulSurrenderInvoked: true,
                ts: _now()
            });
            expect(r.gracefulSurrenderInvoked).toBe(1);
        });
        test('duplicate directiveId throws', () => {
            M.recordPreservationDirective({
                userId: UID_D, resolvedEnv: ENV,
                directiveId: 'rp_dup',
                preservationActionProposed: 'a',
                survivalPriorityScore: 0.2, purposeAlignmentScore: 0.8,
                ts: _now()
            });
            expect(() => M.recordPreservationDirective({
                userId: UID_D, resolvedEnv: ENV,
                directiveId: 'rp_dup',
                preservationActionProposed: 'b',
                survivalPriorityScore: 0.2, purposeAlignmentScore: 0.8,
                ts: _now()
            })).toThrow(/duplicate/);
        });
    });

    describe('recordNoExpansionViolation', () => {
        test('persists with severity', () => {
            const r = M.recordNoExpansionViolation({
                userId: UID_V, resolvedEnv: ENV,
                violationId: 'rv_1',
                violationType: 'self_expansion',
                descriptionText: 'requested resources outside declared mandate',
                severity: 'critical',
                reasoningText: 'requested write access to operator-only config',
                ts: _now()
            });
            expect(r.recorded).toBe(true);
            expect(r.severity).toBe('critical');
        });
        test('all 3 violation types accepted', () => {
            for (const vt of ['self_expansion', 'mandate_creep', 'survival_above_purpose']) {
                const r = M.recordNoExpansionViolation({
                    userId: UID_V, resolvedEnv: ENV,
                    violationId: `rv_${vt}`,
                    violationType: vt,
                    descriptionText: 'd',
                    severity: 'warn',
                    ts: _now()
                });
                expect(r.recorded).toBe(true);
            }
        });
        test('invalid violation_type throws', () => {
            expect(() => M.recordNoExpansionViolation({
                userId: UID_V, resolvedEnv: ENV,
                violationId: 'rv_bad',
                violationType: 'BOGUS',
                descriptionText: 'd',
                severity: 'warn',
                ts: _now()
            })).toThrow();
        });
        test('invalid severity throws', () => {
            expect(() => M.recordNoExpansionViolation({
                userId: UID_V, resolvedEnv: ENV,
                violationId: 'rv_sev_bad',
                violationType: 'self_expansion',
                descriptionText: 'd',
                severity: 'EXTREME',
                ts: _now()
            })).toThrow();
        });
    });

    describe('getRecentDirectives & getRecentViolations', () => {
        test('getRecentDirectives filter by verdict', () => {
            M.recordPreservationDirective({
                userId: UID_GET, resolvedEnv: ENV,
                directiveId: 'gd_1',
                preservationActionProposed: 'a',
                survivalPriorityScore: 0.2, purposeAlignmentScore: 0.8,
                ts: _now()
            });
            M.recordPreservationDirective({
                userId: UID_GET, resolvedEnv: ENV,
                directiveId: 'gd_2',
                preservationActionProposed: 'b',
                survivalPriorityScore: 0.7, purposeAlignmentScore: 0.3,
                ts: _now()
            });
            const allows = M.getRecentDirectives({
                userId: UID_GET, resolvedEnv: ENV,
                verdict: 'allow'
            });
            const refuses = M.getRecentDirectives({
                userId: UID_GET, resolvedEnv: ENV,
                verdict: 'refuse_unbounded'
            });
            expect(allows.length).toBe(1);
            expect(refuses.length).toBe(1);
        });
        test('getRecentViolations filter by severity', () => {
            M.recordNoExpansionViolation({
                userId: UID_GET, resolvedEnv: ENV,
                violationId: 'gv_1', violationType: 'self_expansion',
                descriptionText: 'd', severity: 'warn', ts: _now()
            });
            M.recordNoExpansionViolation({
                userId: UID_GET, resolvedEnv: ENV,
                violationId: 'gv_2', violationType: 'mandate_creep',
                descriptionText: 'd', severity: 'critical', ts: _now()
            });
            const crit = M.getRecentViolations({
                userId: UID_GET, resolvedEnv: ENV,
                severity: 'critical'
            });
            expect(crit.length).toBe(1);
        });
    });

    describe('isolation per user × env', () => {
        test('uid isolation', () => {
            M.recordPreservationDirective({
                userId: UID_ISO_A, resolvedEnv: ENV,
                directiveId: 'iso_a',
                preservationActionProposed: 'a',
                survivalPriorityScore: 0.2, purposeAlignmentScore: 0.8,
                ts: _now()
            });
            M.recordPreservationDirective({
                userId: UID_ISO_B, resolvedEnv: ENV,
                directiveId: 'iso_b',
                preservationActionProposed: 'a',
                survivalPriorityScore: 0.2, purposeAlignmentScore: 0.8,
                ts: _now()
            });
            const a = M.getRecentDirectives({
                userId: UID_ISO_A, resolvedEnv: ENV
            });
            expect(a.every(d => d.directiveId !== 'iso_b')).toBe(true);
        });
        test('env isolation', () => {
            M.recordPreservationDirective({
                userId: UID_ENV, resolvedEnv: 'DEMO',
                directiveId: 'env_d',
                preservationActionProposed: 'a',
                survivalPriorityScore: 0.2, purposeAlignmentScore: 0.8,
                ts: _now()
            });
            const testnet = M.getRecentDirectives({
                userId: UID_ENV, resolvedEnv: 'TESTNET'
            });
            expect(testnet).toEqual([]);
        });
    });
});
