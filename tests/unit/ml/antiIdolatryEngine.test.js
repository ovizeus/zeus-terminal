'use strict';

/**
 * OMEGA §180 ANTI-IDOLATRY ENGINE / NO-MODEL-DESERVES-WORSHIP.
 * Canonical: /root/_review/ml_brain/ml_brain_canonic.txt lines 5887-5926.
 *
 * "mai cred in componenta asta pentru ca functioneaza acum sau pentru ca
 *  am ajuns sa o veneram?"
 *
 * Tests FIRST per TDD discipline.
 */

const path = require('path');
const fs = require('fs');
const os = require('os');

const TEST_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-w3-p180-'));
const TEST_DB_PATH = path.join(TEST_DB_DIR, 'test.db');
process.env.ZEUS_DB_PATH = TEST_DB_PATH;
process.env.ZEUS_TEST_DISABLE_AUTH = '1';

const { db } = require('../../../server/services/database');
const M = require('../../../server/services/ml/_audit/antiIdolatryEngine');

const UID = 9180;
const UID_R = 9280;
const UID_GET = 9380;
const UID_ISO_A = 9480;
const UID_ISO_B = 9580;
const UID_ENV = 9680;
const ENV = 'DEMO';
const _now = () => Date.now();

function cleanRows() {
    const uids = [UID, UID_R, UID_GET, UID_ISO_A, UID_ISO_B, UID_ENV];
    const placeholders = uids.map(() => '?').join(',');
    db.prepare(`DELETE FROM ml_anti_idolatry_audits WHERE user_id IN (${placeholders})`).run(...uids);
}
beforeEach(() => cleanRows());
afterAll(() => cleanRows());

describe('OMEGA §180 ANTI-IDOLATRY ENGINE', () => {

    describe('Migration 332', () => {
        test('332 applied', () => {
            expect(db.prepare("SELECT name FROM _migrations WHERE name=?").get('332_ml_anti_idolatry_audits')).toBeTruthy();
        });
        test('component_type CHECK enum (4)', () => {
            expect(() => db.prepare(`INSERT INTO ml_anti_idolatry_audits
                (user_id, resolved_env, audit_id, component_id, component_type,
                 historical_prestige_score, recent_contribution_score,
                 prestige_to_contribution_ratio, classification,
                 challenge_required, reasoning, ts)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
                .run(UID, ENV, 'a_bk', 'c1', 'BOGUS', 0.8, 0.8, 1.0,
                    'proven_high_value_component', 0, null, _now())).toThrow();
        });
        test('classification CHECK enum (3)', () => {
            expect(() => db.prepare(`INSERT INTO ml_anti_idolatry_audits
                (user_id, resolved_env, audit_id, component_id, component_type,
                 historical_prestige_score, recent_contribution_score,
                 prestige_to_contribution_ratio, classification,
                 challenge_required, reasoning, ts)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
                .run(UID, ENV, 'a_cl', 'c1', 'model', 0.8, 0.8, 1.0,
                    'BOGUS', 0, null, _now())).toThrow();
        });
        test('challenge_required CHECK (0,1)', () => {
            expect(() => db.prepare(`INSERT INTO ml_anti_idolatry_audits
                (user_id, resolved_env, audit_id, component_id, component_type,
                 historical_prestige_score, recent_contribution_score,
                 prestige_to_contribution_ratio, classification,
                 challenge_required, reasoning, ts)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
                .run(UID, ENV, 'a_ch', 'c1', 'model', 0.8, 0.8, 1.0,
                    'proven_high_value_component', 2, null, _now())).toThrow();
        });
        test('audit_id UNIQUE', () => {
            const stmt = db.prepare(`INSERT INTO ml_anti_idolatry_audits
                (user_id, resolved_env, audit_id, component_id, component_type,
                 historical_prestige_score, recent_contribution_score,
                 prestige_to_contribution_ratio, classification,
                 challenge_required, reasoning, ts)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
            stmt.run(UID, ENV, 'a_dup', 'c1', 'model', 0.8, 0.8, 1.0,
                'proven_high_value_component', 0, null, _now());
            expect(() => stmt.run(UID, ENV, 'a_dup', 'c2', 'concept', 0.7, 0.7,
                1.0, 'prestigious_but_accountable', 0, null, _now())).toThrow();
        });
    });

    describe('Constants', () => {
        test('COMPONENT_TYPES frozen 4', () => {
            expect(M.COMPONENT_TYPES).toEqual([
                'model', 'concept', 'source', 'detector'
            ]);
            expect(Object.isFrozen(M.COMPONENT_TYPES)).toBe(true);
        });
        test('CLASSIFICATIONS frozen 3 (canonical PDF list)', () => {
            expect(M.CLASSIFICATIONS).toEqual([
                'proven_high_value_component',
                'prestigious_but_accountable',
                'untouchable_idol'
            ]);
            expect(Object.isFrozen(M.CLASSIFICATIONS)).toBe(true);
        });
        test('IDOL_DETECTION_RATIO = 2.0', () => {
            expect(M.IDOL_DETECTION_RATIO).toBe(2.0);
        });
        test('ACCOUNTABLE_THRESHOLD_PRESTIGE = 0.60', () => {
            expect(M.ACCOUNTABLE_THRESHOLD_PRESTIGE).toBe(0.60);
        });
        test('PRESTIGE_DECAY_RATE = 0.10', () => {
            expect(M.PRESTIGE_DECAY_RATE).toBe(0.10);
        });
    });

    describe('computePrestigeToContributionRatio (pure)', () => {
        test('contribution > 0 → finite ratio', () => {
            const r = M.computePrestigeToContributionRatio({
                prestige: 0.80, contribution: 0.40
            });
            expect(r.ratio).toBeCloseTo(2.0, 5);
        });
        test('contribution = 0 + prestige > 0 → Infinity (idol candidate)', () => {
            const r = M.computePrestigeToContributionRatio({
                prestige: 0.80, contribution: 0
            });
            expect(r.ratio).toBe(Infinity);
        });
        test('prestige = 0 → ratio 0', () => {
            const r = M.computePrestigeToContributionRatio({
                prestige: 0, contribution: 0.5
            });
            expect(r.ratio).toBe(0);
        });
        test('balanced → ratio 1.0', () => {
            const r = M.computePrestigeToContributionRatio({
                prestige: 0.70, contribution: 0.70
            });
            expect(r.ratio).toBeCloseTo(1.0, 5);
        });
        test('out-of-range throws', () => {
            expect(() => M.computePrestigeToContributionRatio({
                prestige: 1.5, contribution: 0.5
            })).toThrow();
        });
    });

    describe('classifyComponent (pure)', () => {
        test('ratio >= 2.0 → untouchable_idol', () => {
            const r = M.classifyComponent({
                prestige: 0.85, contribution: 0.30, ratio: 2.83
            });
            expect(r.classification).toBe('untouchable_idol');
        });
        test('high prestige + reasonable contribution → proven_high_value_component', () => {
            const r = M.classifyComponent({
                prestige: 0.85, contribution: 0.80, ratio: 1.06
            });
            expect(r.classification).toBe('proven_high_value_component');
        });
        test('moderate prestige + still accountable', () => {
            const r = M.classifyComponent({
                prestige: 0.65, contribution: 0.50, ratio: 1.30
            });
            expect(r.classification).toBe('prestigious_but_accountable');
        });
        test('low prestige → proven (low risk of idolatry)', () => {
            const r = M.classifyComponent({
                prestige: 0.30, contribution: 0.30, ratio: 1.0
            });
            expect(r.classification).toBe('proven_high_value_component');
        });
        test('infinite ratio (zero contribution) → untouchable_idol', () => {
            const r = M.classifyComponent({
                prestige: 0.80, contribution: 0, ratio: Infinity
            });
            expect(r.classification).toBe('untouchable_idol');
        });
    });

    describe('requiresChallenge (pure)', () => {
        test('untouchable_idol → always requires challenge', () => {
            expect(M.requiresChallenge({
                classification: 'untouchable_idol',
                lastAuditAgeMs: 0
            }).challengeRequired).toBe(1);
        });
        test('prestigious_but_accountable + recent audit → no challenge', () => {
            expect(M.requiresChallenge({
                classification: 'prestigious_but_accountable',
                lastAuditAgeMs: 24 * 3600 * 1000  // 1 day
            }).challengeRequired).toBe(0);
        });
        test('prestigious_but_accountable + stale audit → challenge', () => {
            expect(M.requiresChallenge({
                classification: 'prestigious_but_accountable',
                lastAuditAgeMs: 30 * 24 * 3600 * 1000  // 30 days
            }).challengeRequired).toBe(1);
        });
        test('proven + recent → no challenge', () => {
            expect(M.requiresChallenge({
                classification: 'proven_high_value_component',
                lastAuditAgeMs: 24 * 3600 * 1000
            }).challengeRequired).toBe(0);
        });
        test('invalid throws', () => {
            expect(() => M.requiresChallenge({
                classification: 'BOGUS', lastAuditAgeMs: 0
            })).toThrow();
        });
    });

    describe('applyPrestigeDecay (pure)', () => {
        test('decays prestige per period', () => {
            const r = M.applyPrestigeDecay({
                currentPrestige: 0.80,
                periodsSinceContribution: 2
            });
            // 0.80 * (1 - 0.10)^2 = 0.80 * 0.81 = 0.648
            expect(r.decayedPrestige).toBeCloseTo(0.648, 3);
        });
        test('zero periods → unchanged', () => {
            const r = M.applyPrestigeDecay({
                currentPrestige: 0.80, periodsSinceContribution: 0
            });
            expect(r.decayedPrestige).toBe(0.80);
        });
        test('many periods → approaches zero', () => {
            const r = M.applyPrestigeDecay({
                currentPrestige: 0.80, periodsSinceContribution: 50
            });
            expect(r.decayedPrestige).toBeLessThan(0.01);
        });
        test('clamps to [0,1]', () => {
            const r = M.applyPrestigeDecay({
                currentPrestige: 0.50, periodsSinceContribution: 5
            });
            expect(r.decayedPrestige).toBeGreaterThanOrEqual(0);
            expect(r.decayedPrestige).toBeLessThanOrEqual(1);
        });
    });

    describe('recordAntiIdolatryAudit', () => {
        test('persists with auto-classification + ratio', () => {
            const r = M.recordAntiIdolatryAudit({
                userId: UID_R, resolvedEnv: ENV,
                auditId: 'ra_1',
                componentId: 'sweep_detector_v3',
                componentType: 'detector',
                historicalPrestige: 0.85,
                recentContribution: 0.80,
                lastAuditAgeMs: 24 * 3600 * 1000,
                reasoning: 'still performing in current regime',
                ts: _now()
            });
            expect(r.recorded).toBe(true);
            expect(r.classification).toBe('proven_high_value_component');
            expect(r.challengeRequired).toBe(0);
        });
        test('high prestige + zero contribution → untouchable_idol + challenge required', () => {
            const r = M.recordAntiIdolatryAudit({
                userId: UID_R, resolvedEnv: ENV,
                auditId: 'ra_idol',
                componentId: 'legacy_oracle',
                componentType: 'source',
                historicalPrestige: 0.90,
                recentContribution: 0.10,  // ratio = 9.0
                lastAuditAgeMs: 30 * 24 * 3600 * 1000,
                ts: _now()
            });
            expect(r.classification).toBe('untouchable_idol');
            expect(r.challengeRequired).toBe(1);
        });
        test('duplicate auditId throws', () => {
            M.recordAntiIdolatryAudit({
                userId: UID_R, resolvedEnv: ENV,
                auditId: 'ra_dup', componentId: 'c', componentType: 'model',
                historicalPrestige: 0.5, recentContribution: 0.5,
                lastAuditAgeMs: 0, ts: _now()
            });
            expect(() => M.recordAntiIdolatryAudit({
                userId: UID_R, resolvedEnv: ENV,
                auditId: 'ra_dup', componentId: 'c', componentType: 'model',
                historicalPrestige: 0.5, recentContribution: 0.5,
                lastAuditAgeMs: 0, ts: _now()
            })).toThrow(/duplicate/);
        });
        test('invalid componentType throws', () => {
            expect(() => M.recordAntiIdolatryAudit({
                userId: UID_R, resolvedEnv: ENV,
                auditId: 'ra_bad', componentId: 'c', componentType: 'BOGUS',
                historicalPrestige: 0.5, recentContribution: 0.5,
                lastAuditAgeMs: 0, ts: _now()
            })).toThrow();
        });
    });

    describe('getRecentAudits & getStatsByClassification', () => {
        test('getRecentAudits filters by classification', () => {
            M.recordAntiIdolatryAudit({
                userId: UID_GET, resolvedEnv: ENV,
                auditId: 'g_p', componentId: 'p', componentType: 'model',
                historicalPrestige: 0.80, recentContribution: 0.75,
                lastAuditAgeMs: 0, ts: _now()
            });
            M.recordAntiIdolatryAudit({
                userId: UID_GET, resolvedEnv: ENV,
                auditId: 'g_i', componentId: 'i', componentType: 'model',
                historicalPrestige: 0.90, recentContribution: 0.05,
                lastAuditAgeMs: 0, ts: _now()
            });
            const idols = M.getRecentAudits({
                userId: UID_GET, resolvedEnv: ENV,
                classification: 'untouchable_idol'
            });
            expect(idols.length).toBe(1);
        });
        test('getStatsByClassification returns counts', () => {
            M.recordAntiIdolatryAudit({
                userId: UID_GET, resolvedEnv: ENV,
                auditId: 'gs_1', componentId: 'c', componentType: 'model',
                historicalPrestige: 0.80, recentContribution: 0.75,
                lastAuditAgeMs: 0, ts: 1000
            });
            M.recordAntiIdolatryAudit({
                userId: UID_GET, resolvedEnv: ENV,
                auditId: 'gs_2', componentId: 'c', componentType: 'model',
                historicalPrestige: 0.90, recentContribution: 0.10,
                lastAuditAgeMs: 0, ts: 2000
            });
            const stats = M.getStatsByClassification({
                userId: UID_GET, resolvedEnv: ENV,
                sinceTs: 0
            });
            expect(stats.proven_high_value_component).toBe(1);
            expect(stats.untouchable_idol).toBe(1);
            expect(stats.totalCount).toBe(2);
        });
    });

    describe('isolation per user × env', () => {
        test('uid isolation', () => {
            M.recordAntiIdolatryAudit({
                userId: UID_ISO_A, resolvedEnv: ENV,
                auditId: 'iso_a', componentId: 'c', componentType: 'model',
                historicalPrestige: 0.5, recentContribution: 0.5,
                lastAuditAgeMs: 0, ts: _now()
            });
            M.recordAntiIdolatryAudit({
                userId: UID_ISO_B, resolvedEnv: ENV,
                auditId: 'iso_b', componentId: 'c', componentType: 'model',
                historicalPrestige: 0.5, recentContribution: 0.5,
                lastAuditAgeMs: 0, ts: _now()
            });
            const a = M.getRecentAudits({
                userId: UID_ISO_A, resolvedEnv: ENV
            });
            expect(a.every(r => r.auditId !== 'iso_b')).toBe(true);
        });
        test('env isolation', () => {
            M.recordAntiIdolatryAudit({
                userId: UID_ENV, resolvedEnv: 'DEMO',
                auditId: 'env_d', componentId: 'c', componentType: 'model',
                historicalPrestige: 0.5, recentContribution: 0.5,
                lastAuditAgeMs: 0, ts: _now()
            });
            const testnet = M.getRecentAudits({
                userId: UID_ENV, resolvedEnv: 'TESTNET'
            });
            expect(testnet).toEqual([]);
        });
    });
});
