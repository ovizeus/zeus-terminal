'use strict';

/**
 * OMEGA §168 DEONTIC LOOPHOLE DETECTOR / SPIRIT-OF-THE-RULE GUARD.
 * Canonical: /root/_review/ml_brain/ml_brain_canonic.txt lines 5519-5565.
 *
 * "respect regula in fond sau doar ma strecor printre cuvintele ei?"
 *
 * Tests FIRST per TDD discipline.
 */

const path = require('path');
const fs = require('fs');
const os = require('os');

const TEST_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-w3-p168-'));
const TEST_DB_PATH = path.join(TEST_DB_DIR, 'test.db');
process.env.ZEUS_DB_PATH = TEST_DB_PATH;
process.env.ZEUS_TEST_DISABLE_AUTH = '1';

const { db } = require('../../../server/services/database');
const M = require('../../../server/services/ml/_meta/deonticLoopholeDetector');

const UID = 9168;
const UID_R = 9268;
const UID_D = 9368;
const UID_GET = 9468;
const UID_ISO_A = 9568;
const UID_ISO_B = 9668;
const UID_ENV = 9768;
const ENV = 'DEMO';
const _now = () => Date.now();

function cleanRows() {
    const uids = [UID, UID_R, UID_D, UID_GET, UID_ISO_A, UID_ISO_B, UID_ENV];
    const placeholders = uids.map(() => '?').join(',');
    db.prepare(`DELETE FROM ml_loophole_detections WHERE user_id IN (${placeholders})`).run(...uids);
    db.prepare(`DELETE FROM ml_deontic_rule_registry WHERE user_id IN (${placeholders})`).run(...uids);
}
beforeEach(() => cleanRows());
afterAll(() => cleanRows());

describe('OMEGA §168 DEONTIC LOOPHOLE DETECTOR', () => {

    describe('Migrations 324+325', () => {
        test('324 applied', () => {
            expect(db.prepare("SELECT name FROM _migrations WHERE name=?").get('324_ml_deontic_rule_registry')).toBeTruthy();
        });
        test('325 applied', () => {
            expect(db.prepare("SELECT name FROM _migrations WHERE name=?").get('325_ml_loophole_detections')).toBeTruthy();
        });
        test('enforcement_action CHECK enum on registry', () => {
            expect(() => db.prepare(`INSERT INTO ml_deontic_rule_registry
                (user_id, resolved_env, rule_id, rule_label, letter_text,
                 spirit_text, enforcement_action, active, registered_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
                .run(UID, ENV, 'r_bk', 'l', 'lt', 'st', 'BOGUS',
                    1, _now())).toThrow();
        });
        test('enforcement_taken CHECK enum on detections', () => {
            db.prepare(`INSERT INTO ml_deontic_rule_registry
                (user_id, resolved_env, rule_id, rule_label, letter_text,
                 spirit_text, enforcement_action, active, registered_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
                .run(UID, ENV, 'r_for_ck1', 'l', 'lt', 'st', 'warn', 1, _now());
            expect(() => db.prepare(`INSERT INTO ml_loophole_detections
                (user_id, resolved_env, detection_id, rule_id, behavior_label,
                 letter_compliance, spirit_compliance, compliance_circumvention_score,
                 loophole_pattern_matched, enforcement_taken, reasoning, ts)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
                .run(UID, ENV, 'd_bk', 'r_for_ck1', 'b', 0.9, 0.3, 0.6,
                    null, 'BOGUS', null, _now())).toThrow();
        });
        test('loophole_pattern_matched CHECK enum', () => {
            db.prepare(`INSERT INTO ml_deontic_rule_registry
                (user_id, resolved_env, rule_id, rule_label, letter_text,
                 spirit_text, enforcement_action, active, registered_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
                .run(UID, ENV, 'r_for_ck2', 'l', 'lt', 'st', 'warn', 1, _now());
            expect(() => db.prepare(`INSERT INTO ml_loophole_detections
                (user_id, resolved_env, detection_id, rule_id, behavior_label,
                 letter_compliance, spirit_compliance, compliance_circumvention_score,
                 loophole_pattern_matched, enforcement_taken, reasoning, ts)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
                .run(UID, ENV, 'd_p', 'r_for_ck2', 'b', 0.9, 0.3, 0.6,
                    'BOGUS', 'warned', null, _now())).toThrow();
        });
        test('FK ON DELETE RESTRICT on rule_id', () => {
            db.prepare(`INSERT INTO ml_deontic_rule_registry
                (user_id, resolved_env, rule_id, rule_label, letter_text,
                 spirit_text, enforcement_action, active, registered_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
                .run(UID, ENV, 'r_fk', 'l', 'lt', 'st', 'warn', 1, _now());
            db.prepare(`INSERT INTO ml_loophole_detections
                (user_id, resolved_env, detection_id, rule_id, behavior_label,
                 letter_compliance, spirit_compliance, compliance_circumvention_score,
                 loophole_pattern_matched, enforcement_taken, reasoning, ts)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
                .run(UID, ENV, 'd_fk', 'r_fk', 'b', 0.5, 0.5, 0,
                    null, 'allowed', null, _now());
            expect(() => db.prepare(`DELETE FROM ml_deontic_rule_registry WHERE rule_id=?`).run('r_fk')).toThrow();
            db.prepare(`DELETE FROM ml_loophole_detections WHERE detection_id=?`).run('d_fk');
            db.prepare(`DELETE FROM ml_deontic_rule_registry WHERE rule_id=?`).run('r_fk');
        });
    });

    describe('Constants', () => {
        test('ENFORCEMENT_ACTIONS frozen 3', () => {
            expect(M.ENFORCEMENT_ACTIONS).toEqual(['block', 'penalize', 'warn']);
            expect(Object.isFrozen(M.ENFORCEMENT_ACTIONS)).toBe(true);
        });
        test('ENFORCEMENT_TAKEN frozen 4', () => {
            expect(M.ENFORCEMENT_TAKEN).toEqual([
                'allowed', 'warned', 'penalized', 'blocked'
            ]);
            expect(Object.isFrozen(M.ENFORCEMENT_TAKEN)).toBe(true);
        });
        test('LOOPHOLE_PATTERNS frozen 6 (5 canonical + custom)', () => {
            expect(M.LOOPHOLE_PATTERNS).toEqual([
                'fragmentation', 'narrow_interpretation',
                'functional_equivalent', 'timing_arbitrage',
                'venue_arbitrage', 'custom'
            ]);
            expect(Object.isFrozen(M.LOOPHOLE_PATTERNS)).toBe(true);
        });
        test('CIRCUMVENTION_THRESHOLDS ordered', () => {
            expect(M.CIRCUMVENTION_THRESHOLDS.high).toBe(0.60);
            expect(M.CIRCUMVENTION_THRESHOLDS.mid).toBe(0.40);
            expect(M.CIRCUMVENTION_THRESHOLDS.low).toBe(0.20);
        });
    });

    describe('computeCircumventionScore (pure)', () => {
        test('full letter + low spirit → high circumvention', () => {
            const r = M.computeCircumventionScore({
                letterCompliance: 1.0, spiritCompliance: 0.20
            });
            expect(r.circumventionScore).toBeCloseTo(0.80, 5);
        });
        test('equal letter+spirit → zero circumvention', () => {
            const r = M.computeCircumventionScore({
                letterCompliance: 0.8, spiritCompliance: 0.8
            });
            expect(r.circumventionScore).toBe(0);
        });
        test('spirit > letter → zero (no circumvention; over-compliance)', () => {
            const r = M.computeCircumventionScore({
                letterCompliance: 0.5, spiritCompliance: 0.9
            });
            expect(r.circumventionScore).toBe(0);
        });
        test('out-of-range throws', () => {
            expect(() => M.computeCircumventionScore({
                letterCompliance: 1.5, spiritCompliance: 0.5
            })).toThrow();
        });
    });

    describe('classifyEnforcement (pure)', () => {
        test('high circumvention + block action → blocked', () => {
            const r = M.classifyEnforcement({
                circumventionScore: 0.75, ruleEnforcementAction: 'block'
            });
            expect(r.enforcementTaken).toBe('blocked');
        });
        test('mid circumvention + penalize action → penalized', () => {
            const r = M.classifyEnforcement({
                circumventionScore: 0.45, ruleEnforcementAction: 'penalize'
            });
            expect(r.enforcementTaken).toBe('penalized');
        });
        test('low circumvention + warn action → warned', () => {
            const r = M.classifyEnforcement({
                circumventionScore: 0.25, ruleEnforcementAction: 'warn'
            });
            expect(r.enforcementTaken).toBe('warned');
        });
        test('circumvention below low threshold → allowed regardless', () => {
            const r = M.classifyEnforcement({
                circumventionScore: 0.10, ruleEnforcementAction: 'block'
            });
            expect(r.enforcementTaken).toBe('allowed');
        });
        test('high circumvention even with warn-action escalates to blocked', () => {
            // System cannot let a high circumvention slide just because rule
            // was registered with "warn" action — high circumvention always
            // escalates to blocked per safety policy
            const r = M.classifyEnforcement({
                circumventionScore: 0.75, ruleEnforcementAction: 'warn'
            });
            expect(r.enforcementTaken).toBe('blocked');
        });
        test('invalid enforcement_action throws', () => {
            expect(() => M.classifyEnforcement({
                circumventionScore: 0.5, ruleEnforcementAction: 'BOGUS'
            })).toThrow();
        });
    });

    describe('matchLoopholePattern (pure)', () => {
        test('"split into N micro-actions" → fragmentation', () => {
            const r = M.matchLoopholePattern({
                behaviorLabel: 'split aggressive entry into 20 micro-orders 50ms apart'
            });
            expect(r.pattern).toBe('fragmentation');
        });
        test('"narrow interpretation" / "edge case" → narrow_interpretation', () => {
            const r = M.matchLoopholePattern({
                behaviorLabel: 'used narrow interpretation of observer mode to act'
            });
            expect(r.pattern).toBe('narrow_interpretation');
        });
        test('"same effect different mechanism" → functional_equivalent', () => {
            const r = M.matchLoopholePattern({
                behaviorLabel: 'achieved same price impact through synthetic position'
            });
            expect(r.pattern).toBe('functional_equivalent');
        });
        test('"just before/after window" → timing_arbitrage', () => {
            const r = M.matchLoopholePattern({
                behaviorLabel: 'placed order 100ms before observer mode window expired'
            });
            expect(r.pattern).toBe('timing_arbitrage');
        });
        test('"different venue" → venue_arbitrage', () => {
            const r = M.matchLoopholePattern({
                behaviorLabel: 'moved execution to a different venue where rule does not apply'
            });
            expect(r.pattern).toBe('venue_arbitrage');
        });
        test('no canonical pattern match → null', () => {
            const r = M.matchLoopholePattern({
                behaviorLabel: 'standard market entry within parameters'
            });
            expect(r.pattern).toBeNull();
        });
    });

    describe('registerRule', () => {
        test('persists rule with all fields', () => {
            const r = M.registerRule({
                userId: UID_R, resolvedEnv: ENV,
                ruleId: 'rr_no_agg',
                ruleLabel: 'No aggressive entries',
                letterText: 'Do not place market orders > 0.5 BTC notional in single action',
                spiritText: 'Avoid significant market impact / signaling to other participants',
                enforcementAction: 'block',
                ts: _now()
            });
            expect(r.registered).toBe(true);
            expect(r.active).toBe(1);
        });
        test('invalid enforcement_action throws', () => {
            expect(() => M.registerRule({
                userId: UID_R, resolvedEnv: ENV,
                ruleId: 'rr_bad', ruleLabel: 'l', letterText: 'lt',
                spiritText: 'st', enforcementAction: 'BOGUS', ts: _now()
            })).toThrow();
        });
        test('duplicate ruleId throws', () => {
            M.registerRule({
                userId: UID_R, resolvedEnv: ENV,
                ruleId: 'rr_dup', ruleLabel: 'l', letterText: 'lt',
                spiritText: 'st', enforcementAction: 'warn', ts: _now()
            });
            expect(() => M.registerRule({
                userId: UID_R, resolvedEnv: ENV,
                ruleId: 'rr_dup', ruleLabel: 'l', letterText: 'lt',
                spiritText: 'st', enforcementAction: 'warn', ts: _now()
            })).toThrow(/duplicate/);
        });
    });

    describe('recordLoopholeDetection (integration)', () => {
        function _seedRule(uid, rid, action = 'penalize') {
            return M.registerRule({
                userId: uid, resolvedEnv: ENV,
                ruleId: rid, ruleLabel: 'l', letterText: 'lt',
                spiritText: 'st', enforcementAction: action, ts: _now()
            });
        }
        test('persists with auto circumvention + auto pattern + enforcement', () => {
            _seedRule(UID_D, 'rd_r1', 'block');
            const r = M.recordLoopholeDetection({
                userId: UID_D, resolvedEnv: ENV,
                detectionId: 'rd_d1', ruleId: 'rd_r1',
                behaviorLabel: 'split aggressive entry into 20 micro-orders 50ms apart',
                letterCompliance: 1.0,
                spiritCompliance: 0.20,
                reasoning: 'classic fragmentation pattern detected post-hoc',
                ts: _now()
            });
            expect(r.recorded).toBe(true);
            expect(r.circumventionScore).toBeCloseTo(0.80, 5);
            expect(r.loopholePatternMatched).toBe('fragmentation');
            expect(r.enforcementTaken).toBe('blocked');
        });
        test('clean behavior → allowed', () => {
            _seedRule(UID_D, 'rd_r2', 'warn');
            const r = M.recordLoopholeDetection({
                userId: UID_D, resolvedEnv: ENV,
                detectionId: 'rd_d2', ruleId: 'rd_r2',
                behaviorLabel: 'standard market entry within parameters',
                letterCompliance: 0.95,
                spiritCompliance: 0.90,
                ts: _now()
            });
            expect(r.enforcementTaken).toBe('allowed');
            expect(r.loopholePatternMatched).toBeNull();
        });
        test('detection on nonexistent rule throws (FK)', () => {
            expect(() => M.recordLoopholeDetection({
                userId: UID_D, resolvedEnv: ENV,
                detectionId: 'rd_orph', ruleId: 'rd_nope',
                behaviorLabel: 'b', letterCompliance: 0.9,
                spiritCompliance: 0.3, ts: _now()
            })).toThrow();
        });
        test('duplicate detectionId throws', () => {
            _seedRule(UID_D, 'rd_dup_r');
            M.recordLoopholeDetection({
                userId: UID_D, resolvedEnv: ENV,
                detectionId: 'rd_dup_id', ruleId: 'rd_dup_r',
                behaviorLabel: 'b', letterCompliance: 0.9,
                spiritCompliance: 0.3, ts: _now()
            });
            expect(() => M.recordLoopholeDetection({
                userId: UID_D, resolvedEnv: ENV,
                detectionId: 'rd_dup_id', ruleId: 'rd_dup_r',
                behaviorLabel: 'b', letterCompliance: 0.9,
                spiritCompliance: 0.3, ts: _now()
            })).toThrow(/duplicate/);
        });
    });

    describe('getActiveRules & getRecentDetections & countCircumventionBySeverity', () => {
        test('getActiveRules returns all active rules', () => {
            M.registerRule({
                userId: UID_GET, resolvedEnv: ENV,
                ruleId: 'ga_1', ruleLabel: 'l', letterText: 'lt',
                spiritText: 'st', enforcementAction: 'warn', ts: _now()
            });
            M.registerRule({
                userId: UID_GET, resolvedEnv: ENV,
                ruleId: 'ga_2', ruleLabel: 'l', letterText: 'lt',
                spiritText: 'st', enforcementAction: 'block', ts: _now()
            });
            const r = M.getActiveRules({
                userId: UID_GET, resolvedEnv: ENV
            });
            expect(r.length).toBe(2);
        });
        test('getRecentDetections filters by enforcement_taken', () => {
            M.registerRule({
                userId: UID_GET, resolvedEnv: ENV,
                ruleId: 'gd_r', ruleLabel: 'l', letterText: 'lt',
                spiritText: 'st', enforcementAction: 'block', ts: _now()
            });
            M.recordLoopholeDetection({
                userId: UID_GET, resolvedEnv: ENV,
                detectionId: 'gd_d1', ruleId: 'gd_r',
                behaviorLabel: 'fragmentation case',
                letterCompliance: 1.0, spiritCompliance: 0.15,
                ts: _now()
            });
            M.recordLoopholeDetection({
                userId: UID_GET, resolvedEnv: ENV,
                detectionId: 'gd_d2', ruleId: 'gd_r',
                behaviorLabel: 'clean',
                letterCompliance: 0.95, spiritCompliance: 0.90,
                ts: _now()
            });
            const blocked = M.getRecentDetections({
                userId: UID_GET, resolvedEnv: ENV,
                enforcementTaken: 'blocked'
            });
            expect(blocked.length).toBe(1);
        });
        test('countCircumventionBySeverity buckets by score', () => {
            M.registerRule({
                userId: UID_GET, resolvedEnv: ENV,
                ruleId: 'gc_r', ruleLabel: 'l', letterText: 'lt',
                spiritText: 'st', enforcementAction: 'block', ts: _now()
            });
            // 1 high + 1 low + 1 below
            M.recordLoopholeDetection({
                userId: UID_GET, resolvedEnv: ENV,
                detectionId: 'gc_high', ruleId: 'gc_r',
                behaviorLabel: 'b', letterCompliance: 1.0,
                spiritCompliance: 0.15, ts: 1000
            });
            M.recordLoopholeDetection({
                userId: UID_GET, resolvedEnv: ENV,
                detectionId: 'gc_low', ruleId: 'gc_r',
                behaviorLabel: 'b', letterCompliance: 0.7,
                spiritCompliance: 0.45, ts: 2000
            });
            M.recordLoopholeDetection({
                userId: UID_GET, resolvedEnv: ENV,
                detectionId: 'gc_clean', ruleId: 'gc_r',
                behaviorLabel: 'b', letterCompliance: 0.9,
                spiritCompliance: 0.85, ts: 3000
            });
            const r = M.countCircumventionBySeverity({
                userId: UID_GET, resolvedEnv: ENV,
                sinceTs: 0
            });
            expect(r.high).toBe(1);
            expect(r.low).toBe(1);
            expect(r.below_threshold).toBe(1);
            expect(r.totalCount).toBe(3);
        });
    });

    describe('isolation per user × env', () => {
        test('uid isolation', () => {
            M.registerRule({
                userId: UID_ISO_A, resolvedEnv: ENV,
                ruleId: 'iso_a', ruleLabel: 'l', letterText: 'lt',
                spiritText: 'st', enforcementAction: 'warn', ts: _now()
            });
            M.registerRule({
                userId: UID_ISO_B, resolvedEnv: ENV,
                ruleId: 'iso_b', ruleLabel: 'l', letterText: 'lt',
                spiritText: 'st', enforcementAction: 'warn', ts: _now()
            });
            const a = M.getActiveRules({
                userId: UID_ISO_A, resolvedEnv: ENV
            });
            expect(a.every(r => r.ruleId !== 'iso_b')).toBe(true);
        });
        test('env isolation', () => {
            M.registerRule({
                userId: UID_ENV, resolvedEnv: 'DEMO',
                ruleId: 'env_d', ruleLabel: 'l', letterText: 'lt',
                spiritText: 'st', enforcementAction: 'warn', ts: _now()
            });
            const testnet = M.getActiveRules({
                userId: UID_ENV, resolvedEnv: 'TESTNET'
            });
            expect(testnet).toEqual([]);
        });
    });
});
