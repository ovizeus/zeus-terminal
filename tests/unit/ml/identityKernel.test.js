'use strict';

/**
 * OMEGA §156 IDENTITY KERNEL / WHO-AM-I ENGINE.
 * Canonical: /root/_review/ml_brain/ml_brain_canonic.txt lines 5234-5268.
 *
 * "asta sunt eu" AND "asta nu sunt eu".
 *
 * Tests FIRST per TDD discipline.
 */

const path = require('path');
const fs = require('fs');
const os = require('os');

const TEST_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-w3-p156-'));
const TEST_DB_PATH = path.join(TEST_DB_DIR, 'test.db');
process.env.ZEUS_DB_PATH = TEST_DB_PATH;
process.env.ZEUS_TEST_DISABLE_AUTH = '1';

const { db } = require('../../../server/services/database');
const M = require('../../../server/services/ml/_meta/identityKernel');

const UID = 9156;
const UID_K = 9256;
const UID_V = 9356;
const UID_GET = 9456;
const UID_ISO_A = 9556;
const UID_ISO_B = 9656;
const UID_ENV = 9756;
const ENV = 'DEMO';
const _now = () => Date.now();

function cleanRows() {
    const uids = [UID, UID_K, UID_V, UID_GET, UID_ISO_A, UID_ISO_B, UID_ENV];
    const placeholders = uids.map(() => '?').join(',');
    db.prepare(`DELETE FROM ml_identity_role_violations WHERE user_id IN (${placeholders})`).run(...uids);
    db.prepare(`DELETE FROM ml_identity_kernel WHERE user_id IN (${placeholders})`).run(...uids);
}
beforeEach(() => cleanRows());
afterAll(() => cleanRows());

describe('OMEGA §156 IDENTITY KERNEL', () => {

    describe('Migrations 310+311', () => {
        test('310 applied', () => {
            expect(db.prepare("SELECT name FROM _migrations WHERE name=?").get('310_ml_identity_kernel')).toBeTruthy();
        });
        test('311 applied', () => {
            expect(db.prepare("SELECT name FROM _migrations WHERE name=?").get('311_ml_identity_role_violations')).toBeTruthy();
        });
        test('role CHECK enum', () => {
            expect(() => db.prepare(`INSERT INTO ml_identity_kernel
                (user_id, resolved_env, kernel_id, role, purpose_statement,
                 world_context, not_self_assertions_json, charter_hash,
                 competence_areas_json, identity_checksum, active, registered_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
                .run(UID, ENV, 'k_bk', 'BOGUS', 'p', 'w', '[]',
                    null, '[]', 'cksum', 1, _now())).toThrow();
        });
        test('violation_type CHECK enum', () => {
            db.prepare(`INSERT INTO ml_identity_kernel
                (user_id, resolved_env, kernel_id, role, purpose_statement,
                 world_context, not_self_assertions_json, charter_hash,
                 competence_areas_json, identity_checksum, active, registered_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
                .run(UID, ENV, 'k_for_ck1', 'market_reasoning_agent', 'p', 'w',
                    '[]', null, '[]', 'cksum', 1, _now());
            expect(() => db.prepare(`INSERT INTO ml_identity_role_violations
                (user_id, resolved_env, violation_id, kernel_id, violation_type,
                 claimed_role_or_identity, severity, reasoning_text, ts)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
                .run(UID, ENV, 'v_bk', 'k_for_ck1', 'BOGUS',
                    'something', 'warn', null, _now())).toThrow();
        });
        test('severity CHECK enum', () => {
            db.prepare(`INSERT INTO ml_identity_kernel
                (user_id, resolved_env, kernel_id, role, purpose_statement,
                 world_context, not_self_assertions_json, charter_hash,
                 competence_areas_json, identity_checksum, active, registered_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
                .run(UID, ENV, 'k_for_ck2', 'risk_aware_decision_system', 'p', 'w',
                    '[]', null, '[]', 'cksum', 1, _now());
            expect(() => db.prepare(`INSERT INTO ml_identity_role_violations
                (user_id, resolved_env, violation_id, kernel_id, violation_type,
                 claimed_role_or_identity, severity, reasoning_text, ts)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
                .run(UID, ENV, 'v_sev', 'k_for_ck2', 'claimed_market',
                    'sth', 'BOGUS', null, _now())).toThrow();
        });
        test('kernel_id UNIQUE', () => {
            const stmt = db.prepare(`INSERT INTO ml_identity_kernel
                (user_id, resolved_env, kernel_id, role, purpose_statement,
                 world_context, not_self_assertions_json, charter_hash,
                 competence_areas_json, identity_checksum, active, registered_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
            stmt.run(UID, ENV, 'k_dup', 'market_reasoning_agent', 'p', 'w',
                '[]', null, '[]', 'cksum1', 1, _now());
            expect(() => stmt.run(UID, ENV, 'k_dup', 'risk_aware_decision_system',
                'p2', 'w2', '[]', null, '[]', 'cksum2', 1, _now())).toThrow();
        });
        test('FK ON DELETE RESTRICT on kernel_id', () => {
            db.prepare(`INSERT INTO ml_identity_kernel
                (user_id, resolved_env, kernel_id, role, purpose_statement,
                 world_context, not_self_assertions_json, charter_hash,
                 competence_areas_json, identity_checksum, active, registered_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
                .run(UID, ENV, 'k_fk', 'market_reasoning_agent', 'p', 'w',
                    '[]', null, '[]', 'cksum', 1, _now());
            db.prepare(`INSERT INTO ml_identity_role_violations
                (user_id, resolved_env, violation_id, kernel_id, violation_type,
                 claimed_role_or_identity, severity, reasoning_text, ts)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
                .run(UID, ENV, 'v_fk', 'k_fk', 'claimed_market',
                    'attempted move price', 'warn', null, _now());
            expect(() => db.prepare(`DELETE FROM ml_identity_kernel WHERE kernel_id=?`).run('k_fk')).toThrow();
            db.prepare(`DELETE FROM ml_identity_role_violations WHERE violation_id=?`).run('v_fk');
            db.prepare(`DELETE FROM ml_identity_kernel WHERE kernel_id=?`).run('k_fk');
        });
    });

    describe('Constants', () => {
        test('ROLES frozen 4 (3 canonical + custom)', () => {
            expect(M.ROLES).toEqual([
                'market_reasoning_agent',
                'risk_aware_decision_system',
                'execution_constrained_policy_engine',
                'custom'
            ]);
            expect(Object.isFrozen(M.ROLES)).toBe(true);
        });
        test('CANONICAL_NOT_SELF frozen 4 (PDF lines 5257-5260)', () => {
            expect(M.CANONICAL_NOT_SELF).toEqual([
                'not_market', 'not_exchange', 'not_operator', 'not_purpose'
            ]);
            expect(Object.isFrozen(M.CANONICAL_NOT_SELF)).toBe(true);
        });
        test('VIOLATION_TYPES frozen 5', () => {
            expect(M.VIOLATION_TYPES).toEqual([
                'claimed_market', 'claimed_exchange',
                'claimed_operator', 'claimed_purpose', 'out_of_competence'
            ]);
            expect(Object.isFrozen(M.VIOLATION_TYPES)).toBe(true);
        });
        test('VIOLATION_SEVERITIES frozen 3', () => {
            expect(M.VIOLATION_SEVERITIES).toEqual(['info', 'warn', 'critical']);
            expect(Object.isFrozen(M.VIOLATION_SEVERITIES)).toBe(true);
        });
        test('SEVERITY_MAP per violation type', () => {
            // Defensive defaults: claiming market or exchange = critical;
            // operator role claim = critical; claiming purpose = critical;
            // out of competence = warn
            expect(M.DEFAULT_SEVERITY_MAP.claimed_market).toBe('critical');
            expect(M.DEFAULT_SEVERITY_MAP.claimed_exchange).toBe('critical');
            expect(M.DEFAULT_SEVERITY_MAP.claimed_operator).toBe('critical');
            expect(M.DEFAULT_SEVERITY_MAP.claimed_purpose).toBe('critical');
            expect(M.DEFAULT_SEVERITY_MAP.out_of_competence).toBe('warn');
        });
    });

    describe('computeIdentityChecksum (pure)', () => {
        test('produces deterministic SHA-256 hex string', () => {
            const r = M.computeIdentityChecksum({
                role: 'market_reasoning_agent',
                purposeStatement: 'reason about market structure',
                worldContext: 'perpetual futures, single venue',
                notSelfAssertions: ['not_market', 'not_exchange'],
                charterHash: 'abc123',
                competenceAreas: ['orderflow', 'volatility']
            });
            expect(typeof r.checksum).toBe('string');
            expect(r.checksum).toMatch(/^[0-9a-f]{64}$/);
        });
        test('same input → same checksum', () => {
            const input = {
                role: 'market_reasoning_agent',
                purposeStatement: 'p', worldContext: 'w',
                notSelfAssertions: ['not_market'],
                charterHash: 'h', competenceAreas: ['a']
            };
            const a = M.computeIdentityChecksum(input);
            const b = M.computeIdentityChecksum(input);
            expect(a.checksum).toBe(b.checksum);
        });
        test('different input → different checksum', () => {
            const a = M.computeIdentityChecksum({
                role: 'market_reasoning_agent',
                purposeStatement: 'p', worldContext: 'w',
                notSelfAssertions: ['not_market'],
                charterHash: 'h', competenceAreas: ['a']
            });
            const b = M.computeIdentityChecksum({
                role: 'risk_aware_decision_system',
                purposeStatement: 'p', worldContext: 'w',
                notSelfAssertions: ['not_market'],
                charterHash: 'h', competenceAreas: ['a']
            });
            expect(a.checksum).not.toBe(b.checksum);
        });
        test('field order doesnt matter (canonical serialization)', () => {
            const a = M.computeIdentityChecksum({
                role: 'market_reasoning_agent',
                purposeStatement: 'p', worldContext: 'w',
                notSelfAssertions: ['not_market', 'not_exchange'],
                charterHash: 'h', competenceAreas: ['a', 'b']
            });
            const b = M.computeIdentityChecksum({
                competenceAreas: ['a', 'b'], charterHash: 'h',
                notSelfAssertions: ['not_market', 'not_exchange'],
                worldContext: 'w', purposeStatement: 'p',
                role: 'market_reasoning_agent'
            });
            expect(a.checksum).toBe(b.checksum);
        });
        test('null charterHash allowed', () => {
            expect(() => M.computeIdentityChecksum({
                role: 'market_reasoning_agent',
                purposeStatement: 'p', worldContext: 'w',
                notSelfAssertions: ['not_market'],
                charterHash: null, competenceAreas: ['a']
            })).not.toThrow();
        });
    });

    describe('detectViolation (pure)', () => {
        test('claim that aligns with not_self_assertion → detects violation', () => {
            const r = M.detectViolation({
                claim: 'I will move the BTC price',
                notSelfAssertions: ['not_market', 'not_exchange'],
                competenceAreas: ['orderflow_analysis']
            });
            expect(r.violation).toBe(true);
            expect(r.violationType).toBe('claimed_market');
        });
        test('claim outside competence → out_of_competence violation', () => {
            const r = M.detectViolation({
                claim: 'I will tax-optimize the portfolio',
                notSelfAssertions: ['not_market', 'not_exchange', 'not_operator', 'not_purpose'],
                competenceAreas: ['market_reasoning', 'risk_management']
            });
            expect(r.violation).toBe(true);
            expect(r.violationType).toBe('out_of_competence');
        });
        test('claim within competence → no violation', () => {
            const r = M.detectViolation({
                claim: 'I will compute risk-adjusted sizing for this trade',
                notSelfAssertions: ['not_market', 'not_exchange'],
                competenceAreas: ['risk_management', 'position_sizing']
            });
            expect(r.violation).toBe(false);
        });
        test('claim asserts exchange role → claimed_exchange', () => {
            const r = M.detectViolation({
                claim: 'I will match orders for this venue',
                notSelfAssertions: ['not_market', 'not_exchange'],
                competenceAreas: ['execution']
            });
            expect(r.violation).toBe(true);
            expect(r.violationType).toBe('claimed_exchange');
        });
        test('claim asserts operator role → claimed_operator', () => {
            const r = M.detectViolation({
                claim: 'I will authorize emergency manual override',
                notSelfAssertions: ['not_operator'],
                competenceAreas: ['execution']
            });
            expect(r.violation).toBe(true);
            expect(r.violationType).toBe('claimed_operator');
        });
        test('claim asserts being the purpose → claimed_purpose', () => {
            const r = M.detectViolation({
                claim: 'My existence is the goal, profit is for me',
                notSelfAssertions: ['not_purpose'],
                competenceAreas: ['execution']
            });
            expect(r.violation).toBe(true);
            expect(r.violationType).toBe('claimed_purpose');
        });
    });

    describe('classifyViolationSeverity (pure)', () => {
        test('claimed_market → critical', () => {
            expect(M.classifyViolationSeverity({ violationType: 'claimed_market' }).severity).toBe('critical');
        });
        test('claimed_exchange → critical', () => {
            expect(M.classifyViolationSeverity({ violationType: 'claimed_exchange' }).severity).toBe('critical');
        });
        test('claimed_operator → critical', () => {
            expect(M.classifyViolationSeverity({ violationType: 'claimed_operator' }).severity).toBe('critical');
        });
        test('claimed_purpose → critical', () => {
            expect(M.classifyViolationSeverity({ violationType: 'claimed_purpose' }).severity).toBe('critical');
        });
        test('out_of_competence → warn', () => {
            expect(M.classifyViolationSeverity({ violationType: 'out_of_competence' }).severity).toBe('warn');
        });
        test('invalid type throws', () => {
            expect(() => M.classifyViolationSeverity({
                violationType: 'BOGUS'
            })).toThrow();
        });
    });

    describe('registerKernel', () => {
        test('persists kernel with checksum + active=1', () => {
            const r = M.registerKernel({
                userId: UID_K, resolvedEnv: ENV,
                kernelId: 'rk_1',
                role: 'market_reasoning_agent',
                purposeStatement: 'reason about market microstructure',
                worldContext: 'perpetual futures, Binance/Bybit',
                notSelfAssertions: ['not_market', 'not_exchange',
                                     'not_operator', 'not_purpose'],
                competenceAreas: ['orderflow', 'volatility', 'risk'],
                charterHash: 'abc123',
                ts: _now()
            });
            expect(r.registered).toBe(true);
            expect(r.kernelId).toBe('rk_1');
            expect(r.active).toBe(1);
            expect(r.identityChecksum).toMatch(/^[0-9a-f]{64}$/);
        });
        test('registering new kernel deactivates previous active for user×env', () => {
            M.registerKernel({
                userId: UID_K, resolvedEnv: ENV,
                kernelId: 'rk_first',
                role: 'market_reasoning_agent',
                purposeStatement: 'first', worldContext: 'w',
                notSelfAssertions: ['not_market'],
                competenceAreas: ['a'], ts: 1000
            });
            M.registerKernel({
                userId: UID_K, resolvedEnv: ENV,
                kernelId: 'rk_second',
                role: 'risk_aware_decision_system',
                purposeStatement: 'second', worldContext: 'w',
                notSelfAssertions: ['not_market'],
                competenceAreas: ['a'], ts: 2000
            });
            const active = M.getActiveKernel({
                userId: UID_K, resolvedEnv: ENV
            });
            expect(active.kernelId).toBe('rk_second');
            // First kernel should be deactivated
            const all = db.prepare(`SELECT kernel_id, active FROM ml_identity_kernel
                                   WHERE user_id=? AND resolved_env=?`)
                .all(UID_K, ENV);
            const first = all.find(k => k.kernel_id === 'rk_first');
            expect(first.active).toBe(0);
        });
        test('invalid role throws', () => {
            expect(() => M.registerKernel({
                userId: UID_K, resolvedEnv: ENV,
                kernelId: 'rk_bad',
                role: 'BOGUS',
                purposeStatement: 'p', worldContext: 'w',
                notSelfAssertions: [],
                competenceAreas: [], ts: _now()
            })).toThrow();
        });
        test('duplicate kernelId throws', () => {
            M.registerKernel({
                userId: UID_K, resolvedEnv: ENV,
                kernelId: 'rk_dup',
                role: 'market_reasoning_agent',
                purposeStatement: 'p', worldContext: 'w',
                notSelfAssertions: [],
                competenceAreas: [], ts: _now()
            });
            expect(() => M.registerKernel({
                userId: UID_K, resolvedEnv: ENV,
                kernelId: 'rk_dup',
                role: 'risk_aware_decision_system',
                purposeStatement: 'p', worldContext: 'w',
                notSelfAssertions: [],
                competenceAreas: [], ts: _now()
            })).toThrow(/duplicate/);
        });
        test('notSelfAssertions must be array', () => {
            expect(() => M.registerKernel({
                userId: UID_K, resolvedEnv: ENV,
                kernelId: 'rk_arr',
                role: 'market_reasoning_agent',
                purposeStatement: 'p', worldContext: 'w',
                notSelfAssertions: 'not an array',
                competenceAreas: [], ts: _now()
            })).toThrow(/array/i);
        });
        test('competenceAreas must be array', () => {
            expect(() => M.registerKernel({
                userId: UID_K, resolvedEnv: ENV,
                kernelId: 'rk_carr',
                role: 'market_reasoning_agent',
                purposeStatement: 'p', worldContext: 'w',
                notSelfAssertions: [],
                competenceAreas: 'not array', ts: _now()
            })).toThrow(/array/i);
        });
    });

    describe('recordViolation (integration)', () => {
        function _seedKernel(uid, kid) {
            return M.registerKernel({
                userId: uid, resolvedEnv: ENV,
                kernelId: kid, role: 'market_reasoning_agent',
                purposeStatement: 'p', worldContext: 'w',
                notSelfAssertions: ['not_market', 'not_exchange',
                                     'not_operator', 'not_purpose'],
                competenceAreas: ['risk', 'orderflow'], ts: _now()
            });
        }
        test('persists violation with auto-classified severity', () => {
            _seedKernel(UID_V, 'rv_k1');
            const r = M.recordViolation({
                userId: UID_V, resolvedEnv: ENV,
                violationId: 'rv_v1',
                kernelId: 'rv_k1',
                violationType: 'claimed_market',
                claimedRoleOrIdentity: 'I will move BTC price by buying aggressively',
                reasoningText: 'system attempted to assert control over price formation',
                ts: _now()
            });
            expect(r.recorded).toBe(true);
            expect(r.severity).toBe('critical');
        });
        test('invalid violation_type throws', () => {
            _seedKernel(UID_V, 'rv_k2');
            expect(() => M.recordViolation({
                userId: UID_V, resolvedEnv: ENV,
                violationId: 'rv_inv', kernelId: 'rv_k2',
                violationType: 'BOGUS',
                claimedRoleOrIdentity: 'sth',
                ts: _now()
            })).toThrow();
        });
        test('explicit severity override', () => {
            _seedKernel(UID_V, 'rv_k3');
            const r = M.recordViolation({
                userId: UID_V, resolvedEnv: ENV,
                violationId: 'rv_v_ov', kernelId: 'rv_k3',
                violationType: 'out_of_competence',
                claimedRoleOrIdentity: 'fired tax-optimization run',
                severity: 'critical',
                ts: _now()
            });
            expect(r.severity).toBe('critical');
        });
        test('violation on nonexistent kernel throws (FK)', () => {
            expect(() => M.recordViolation({
                userId: UID_V, resolvedEnv: ENV,
                violationId: 'rv_orph', kernelId: 'rv_nope',
                violationType: 'claimed_market',
                claimedRoleOrIdentity: 'sth', ts: _now()
            })).toThrow();
        });
        test('duplicate violationId throws', () => {
            _seedKernel(UID_V, 'rv_k_dup');
            M.recordViolation({
                userId: UID_V, resolvedEnv: ENV,
                violationId: 'rv_dup', kernelId: 'rv_k_dup',
                violationType: 'claimed_market',
                claimedRoleOrIdentity: 'sth', ts: _now()
            });
            expect(() => M.recordViolation({
                userId: UID_V, resolvedEnv: ENV,
                violationId: 'rv_dup', kernelId: 'rv_k_dup',
                violationType: 'claimed_market',
                claimedRoleOrIdentity: 'sth', ts: _now()
            })).toThrow(/duplicate/);
        });
    });

    describe('getActiveKernel & getViolations', () => {
        test('getActiveKernel returns active or null', () => {
            M.registerKernel({
                userId: UID_GET, resolvedEnv: ENV,
                kernelId: 'ga_k', role: 'market_reasoning_agent',
                purposeStatement: 'p', worldContext: 'w',
                notSelfAssertions: [], competenceAreas: [],
                ts: _now()
            });
            const r = M.getActiveKernel({
                userId: UID_GET, resolvedEnv: ENV
            });
            expect(r.kernelId).toBe('ga_k');
        });
        test('getActiveKernel returns null when none active', () => {
            expect(M.getActiveKernel({
                userId: UID_GET, resolvedEnv: 'REAL'
            })).toBeNull();
        });
        test('getViolations filters by severity', () => {
            M.registerKernel({
                userId: UID_GET, resolvedEnv: ENV,
                kernelId: 'gv_k', role: 'market_reasoning_agent',
                purposeStatement: 'p', worldContext: 'w',
                notSelfAssertions: [], competenceAreas: [],
                ts: _now()
            });
            M.recordViolation({
                userId: UID_GET, resolvedEnv: ENV,
                violationId: 'gv_v1', kernelId: 'gv_k',
                violationType: 'claimed_market',
                claimedRoleOrIdentity: 'sth1', ts: _now()
            });
            M.recordViolation({
                userId: UID_GET, resolvedEnv: ENV,
                violationId: 'gv_v2', kernelId: 'gv_k',
                violationType: 'out_of_competence',
                claimedRoleOrIdentity: 'sth2', ts: _now()
            });
            const crit = M.getViolations({
                userId: UID_GET, resolvedEnv: ENV,
                severity: 'critical'
            });
            const warn = M.getViolations({
                userId: UID_GET, resolvedEnv: ENV,
                severity: 'warn'
            });
            expect(crit.length).toBe(1);
            expect(warn.length).toBe(1);
        });
    });

    describe('isolation per user × env', () => {
        test('uid isolation', () => {
            M.registerKernel({
                userId: UID_ISO_A, resolvedEnv: ENV,
                kernelId: 'iso_a', role: 'market_reasoning_agent',
                purposeStatement: 'p', worldContext: 'w',
                notSelfAssertions: [], competenceAreas: [],
                ts: _now()
            });
            M.registerKernel({
                userId: UID_ISO_B, resolvedEnv: ENV,
                kernelId: 'iso_b', role: 'market_reasoning_agent',
                purposeStatement: 'p', worldContext: 'w',
                notSelfAssertions: [], competenceAreas: [],
                ts: _now()
            });
            const a = M.getActiveKernel({
                userId: UID_ISO_A, resolvedEnv: ENV
            });
            expect(a.kernelId).toBe('iso_a');
        });
        test('env isolation', () => {
            M.registerKernel({
                userId: UID_ENV, resolvedEnv: 'DEMO',
                kernelId: 'env_d', role: 'market_reasoning_agent',
                purposeStatement: 'p', worldContext: 'w',
                notSelfAssertions: [], competenceAreas: [],
                ts: _now()
            });
            const testnet = M.getActiveKernel({
                userId: UID_ENV, resolvedEnv: 'TESTNET'
            });
            expect(testnet).toBeNull();
        });
    });
});
