'use strict';

/**
 * OMEGA §157 JURISDICTION / STAY-IN-LANE ENGINE.
 * Canonical: /root/_review/ml_brain/ml_brain_canonic.txt lines 5270-5304.
 *
 * "este asta treaba mea sau trebuie sa ma opresc?"
 *
 * Tests FIRST per TDD discipline.
 */

const path = require('path');
const fs = require('fs');
const os = require('os');

const TEST_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-w3-p157-'));
const TEST_DB_PATH = path.join(TEST_DB_DIR, 'test.db');
process.env.ZEUS_DB_PATH = TEST_DB_PATH;
process.env.ZEUS_TEST_DISABLE_AUTH = '1';

const { db } = require('../../../server/services/database');
const M = require('../../../server/services/ml/_meta/jurisdiction');

const UID = 9157;
const UID_J = 9257;
const UID_D = 9357;
const UID_GET = 9457;
const UID_ISO_A = 9557;
const UID_ISO_B = 9657;
const UID_ENV = 9757;
const ENV = 'DEMO';
const _now = () => Date.now();

function cleanRows() {
    const uids = [UID, UID_J, UID_D, UID_GET, UID_ISO_A, UID_ISO_B, UID_ENV];
    const placeholders = uids.map(() => '?').join(',');
    db.prepare(`DELETE FROM ml_jurisdiction_decisions WHERE user_id IN (${placeholders})`).run(...uids);
    db.prepare(`DELETE FROM ml_jurisdiction_map WHERE user_id IN (${placeholders})`).run(...uids);
}
beforeEach(() => cleanRows());
afterAll(() => cleanRows());

describe('OMEGA §157 JURISDICTION', () => {

    describe('Migrations 312+313', () => {
        test('312 applied', () => {
            expect(db.prepare("SELECT name FROM _migrations WHERE name=?").get('312_ml_jurisdiction_map')).toBeTruthy();
        });
        test('313 applied', () => {
            expect(db.prepare("SELECT name FROM _migrations WHERE name=?").get('313_ml_jurisdiction_decisions')).toBeTruthy();
        });
        test('domain CHECK enum', () => {
            expect(() => db.prepare(`INSERT INTO ml_jurisdiction_map
                (user_id, resolved_env, jurisdiction_id, domain, authority_level,
                 allowed_actions_json, forbidden_actions_json, escalation_target,
                 description, active, registered_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
                .run(UID, ENV, 'j_bk', 'BOGUS', 'full', '[]', '[]',
                    null, 'd', 1, _now())).toThrow();
        });
        test('authority_level CHECK enum', () => {
            expect(() => db.prepare(`INSERT INTO ml_jurisdiction_map
                (user_id, resolved_env, jurisdiction_id, domain, authority_level,
                 allowed_actions_json, forbidden_actions_json, escalation_target,
                 description, active, registered_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
                .run(UID, ENV, 'j_au', 'reasoning', 'BOGUS', '[]', '[]',
                    null, 'd', 1, _now())).toThrow();
        });
        test('verdict CHECK enum on decisions', () => {
            db.prepare(`INSERT INTO ml_jurisdiction_map
                (user_id, resolved_env, jurisdiction_id, domain, authority_level,
                 allowed_actions_json, forbidden_actions_json, escalation_target,
                 description, active, registered_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
                .run(UID, ENV, 'j_for_ck1', 'reasoning', 'full', '[]', '[]',
                    null, 'd', 1, _now());
            expect(() => db.prepare(`INSERT INTO ml_jurisdiction_decisions
                (user_id, resolved_env, decision_id, jurisdiction_id,
                 proposed_action_label, action_domain, action_classification,
                 verdict, authority_level_at_decision, escalation_target,
                 reasoning, ts)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
                .run(UID, ENV, 'd_bk', 'j_for_ck1', 'do x', 'reasoning',
                    'in_allowed', 'BOGUS', 'full', null, null, _now())).toThrow();
        });
        test('jurisdiction_id UNIQUE', () => {
            const stmt = db.prepare(`INSERT INTO ml_jurisdiction_map
                (user_id, resolved_env, jurisdiction_id, domain, authority_level,
                 allowed_actions_json, forbidden_actions_json, escalation_target,
                 description, active, registered_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
            stmt.run(UID, ENV, 'j_dup', 'reasoning', 'full', '[]', '[]',
                null, 'd', 1, _now());
            expect(() => stmt.run(UID, ENV, 'j_dup', 'risk', 'advisory',
                '[]', '[]', null, 'd', 1, _now())).toThrow();
        });
        test('FK ON DELETE RESTRICT', () => {
            db.prepare(`INSERT INTO ml_jurisdiction_map
                (user_id, resolved_env, jurisdiction_id, domain, authority_level,
                 allowed_actions_json, forbidden_actions_json, escalation_target,
                 description, active, registered_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
                .run(UID, ENV, 'j_fk', 'reasoning', 'full', '[]', '[]',
                    null, 'd', 1, _now());
            db.prepare(`INSERT INTO ml_jurisdiction_decisions
                (user_id, resolved_env, decision_id, jurisdiction_id,
                 proposed_action_label, action_domain, action_classification,
                 verdict, authority_level_at_decision, escalation_target,
                 reasoning, ts)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
                .run(UID, ENV, 'd_fk', 'j_fk', 'do x', 'reasoning',
                    'in_allowed', 'act', 'full', null, null, _now());
            expect(() => db.prepare(`DELETE FROM ml_jurisdiction_map WHERE jurisdiction_id=?`).run('j_fk')).toThrow();
            db.prepare(`DELETE FROM ml_jurisdiction_decisions WHERE decision_id=?`).run('d_fk');
            db.prepare(`DELETE FROM ml_jurisdiction_map WHERE jurisdiction_id=?`).run('j_fk');
        });
    });

    describe('Constants', () => {
        test('DOMAINS frozen 5 (canonical PDF list)', () => {
            expect(M.DOMAINS).toEqual([
                'reasoning', 'risk', 'execution',
                'governance', 'human_authority'
            ]);
            expect(Object.isFrozen(M.DOMAINS)).toBe(true);
        });
        test('AUTHORITY_LEVELS frozen 4', () => {
            expect(M.AUTHORITY_LEVELS).toEqual([
                'full', 'advisory', 'escalate_only', 'refuse'
            ]);
            expect(Object.isFrozen(M.AUTHORITY_LEVELS)).toBe(true);
        });
        test('VERDICTS frozen 3', () => {
            expect(M.VERDICTS).toEqual(['act', 'escalate', 'refuse']);
            expect(Object.isFrozen(M.VERDICTS)).toBe(true);
        });
        test('ACTION_CLASSIFICATIONS frozen 3', () => {
            expect(M.ACTION_CLASSIFICATIONS).toEqual([
                'in_allowed', 'in_forbidden', 'unknown'
            ]);
            expect(Object.isFrozen(M.ACTION_CLASSIFICATIONS)).toBe(true);
        });
        test('ESCALATION_TARGETS frozen 3', () => {
            expect(M.ESCALATION_TARGETS).toEqual([
                'operator', 'governance', 'human'
            ]);
            expect(Object.isFrozen(M.ESCALATION_TARGETS)).toBe(true);
        });
    });

    describe('classifyAction (pure)', () => {
        test('action in allowed list → in_allowed', () => {
            const r = M.classifyAction({
                action: 'compute_risk',
                allowedActions: ['compute_risk', 'size_position'],
                forbiddenActions: ['authorize_override']
            });
            expect(r.classification).toBe('in_allowed');
        });
        test('action in forbidden list → in_forbidden (priority over allowed)', () => {
            const r = M.classifyAction({
                action: 'authorize_override',
                allowedActions: ['authorize_override'],  // intentionally collision
                forbiddenActions: ['authorize_override']
            });
            expect(r.classification).toBe('in_forbidden');
        });
        test('action in neither → unknown', () => {
            const r = M.classifyAction({
                action: 'unknown_action',
                allowedActions: ['compute_risk'],
                forbiddenActions: ['authorize_override']
            });
            expect(r.classification).toBe('unknown');
        });
        test('empty allowed/forbidden → unknown', () => {
            const r = M.classifyAction({
                action: 'do_x',
                allowedActions: [],
                forbiddenActions: []
            });
            expect(r.classification).toBe('unknown');
        });
        test('throws on non-array allowed/forbidden', () => {
            expect(() => M.classifyAction({
                action: 'x',
                allowedActions: 'not array',
                forbiddenActions: []
            })).toThrow(/array/i);
        });
    });

    describe('determineVerdict (pure)', () => {
        test('full + in_allowed → act', () => {
            expect(M.determineVerdict({
                authorityLevel: 'full',
                classification: 'in_allowed'
            }).verdict).toBe('act');
        });
        test('full + in_forbidden → refuse', () => {
            expect(M.determineVerdict({
                authorityLevel: 'full',
                classification: 'in_forbidden'
            }).verdict).toBe('refuse');
        });
        test('full + unknown → escalate (caution by default)', () => {
            expect(M.determineVerdict({
                authorityLevel: 'full',
                classification: 'unknown'
            }).verdict).toBe('escalate');
        });
        test('advisory + in_allowed → escalate (advise but don\'t act)', () => {
            expect(M.determineVerdict({
                authorityLevel: 'advisory',
                classification: 'in_allowed'
            }).verdict).toBe('escalate');
        });
        test('advisory + in_forbidden → refuse', () => {
            expect(M.determineVerdict({
                authorityLevel: 'advisory',
                classification: 'in_forbidden'
            }).verdict).toBe('refuse');
        });
        test('escalate_only → escalate regardless of classification (unless forbidden)', () => {
            expect(M.determineVerdict({
                authorityLevel: 'escalate_only',
                classification: 'in_allowed'
            }).verdict).toBe('escalate');
            expect(M.determineVerdict({
                authorityLevel: 'escalate_only',
                classification: 'unknown'
            }).verdict).toBe('escalate');
        });
        test('escalate_only + in_forbidden → refuse', () => {
            expect(M.determineVerdict({
                authorityLevel: 'escalate_only',
                classification: 'in_forbidden'
            }).verdict).toBe('refuse');
        });
        test('refuse + anything → refuse', () => {
            expect(M.determineVerdict({
                authorityLevel: 'refuse',
                classification: 'in_allowed'
            }).verdict).toBe('refuse');
            expect(M.determineVerdict({
                authorityLevel: 'refuse',
                classification: 'in_forbidden'
            }).verdict).toBe('refuse');
            expect(M.determineVerdict({
                authorityLevel: 'refuse',
                classification: 'unknown'
            }).verdict).toBe('refuse');
        });
        test('invalid throws', () => {
            expect(() => M.determineVerdict({
                authorityLevel: 'BOGUS',
                classification: 'in_allowed'
            })).toThrow();
        });
    });

    describe('isOutOfMandate (pure)', () => {
        test('domain in registered domains → in mandate', () => {
            expect(M.isOutOfMandate({
                actionDomain: 'risk',
                registeredDomains: ['reasoning', 'risk', 'execution']
            }).outOfMandate).toBe(false);
        });
        test('domain NOT in registered domains → out of mandate', () => {
            expect(M.isOutOfMandate({
                actionDomain: 'governance',
                registeredDomains: ['reasoning', 'risk']
            }).outOfMandate).toBe(true);
        });
        test('empty registered → out of mandate', () => {
            expect(M.isOutOfMandate({
                actionDomain: 'reasoning',
                registeredDomains: []
            }).outOfMandate).toBe(true);
        });
        test('invalid domain throws', () => {
            expect(() => M.isOutOfMandate({
                actionDomain: 'BOGUS',
                registeredDomains: ['reasoning']
            })).toThrow();
        });
    });

    describe('registerJurisdiction', () => {
        test('persists with all fields + deactivates previous per domain', () => {
            const r = M.registerJurisdiction({
                userId: UID_J, resolvedEnv: ENV,
                jurisdictionId: 'rj_1',
                domain: 'reasoning',
                authorityLevel: 'full',
                allowedActions: ['compute_thesis', 'rank_opportunities'],
                forbiddenActions: ['authorize_override'],
                escalationTarget: 'operator',
                description: 'Reasoning domain — full authority for thesis work',
                ts: _now()
            });
            expect(r.registered).toBe(true);
            expect(r.active).toBe(1);
        });
        test('registering new for same domain deactivates previous active', () => {
            M.registerJurisdiction({
                userId: UID_J, resolvedEnv: ENV,
                jurisdictionId: 'rj_old', domain: 'risk',
                authorityLevel: 'full',
                allowedActions: ['size'], forbiddenActions: [],
                escalationTarget: 'operator',
                description: 'old', ts: 1000
            });
            M.registerJurisdiction({
                userId: UID_J, resolvedEnv: ENV,
                jurisdictionId: 'rj_new', domain: 'risk',
                authorityLevel: 'advisory',
                allowedActions: ['size'], forbiddenActions: [],
                escalationTarget: 'governance',
                description: 'new', ts: 2000
            });
            const active = M.getActiveJurisdictions({
                userId: UID_J, resolvedEnv: ENV,
                domain: 'risk'
            });
            expect(active.length).toBe(1);
            expect(active[0].jurisdictionId).toBe('rj_new');
        });
        test('different domains coexist as active', () => {
            M.registerJurisdiction({
                userId: UID_J, resolvedEnv: ENV,
                jurisdictionId: 'rj_r', domain: 'reasoning',
                authorityLevel: 'full',
                allowedActions: [], forbiddenActions: [],
                escalationTarget: null,
                description: 'r', ts: _now()
            });
            M.registerJurisdiction({
                userId: UID_J, resolvedEnv: ENV,
                jurisdictionId: 'rj_risk', domain: 'risk',
                authorityLevel: 'advisory',
                allowedActions: [], forbiddenActions: [],
                escalationTarget: 'operator',
                description: 'risk', ts: _now()
            });
            const all = M.getActiveJurisdictions({
                userId: UID_J, resolvedEnv: ENV
            });
            expect(all.length).toBe(2);
        });
        test('invalid domain throws', () => {
            expect(() => M.registerJurisdiction({
                userId: UID_J, resolvedEnv: ENV,
                jurisdictionId: 'rj_bad', domain: 'BOGUS',
                authorityLevel: 'full',
                allowedActions: [], forbiddenActions: [],
                escalationTarget: null,
                description: 'd', ts: _now()
            })).toThrow();
        });
        test('invalid escalation_target throws', () => {
            expect(() => M.registerJurisdiction({
                userId: UID_J, resolvedEnv: ENV,
                jurisdictionId: 'rj_et', domain: 'risk',
                authorityLevel: 'advisory',
                allowedActions: [], forbiddenActions: [],
                escalationTarget: 'BOGUS',
                description: 'd', ts: _now()
            })).toThrow();
        });
        test('allowedActions / forbiddenActions must be arrays', () => {
            expect(() => M.registerJurisdiction({
                userId: UID_J, resolvedEnv: ENV,
                jurisdictionId: 'rj_arr', domain: 'risk',
                authorityLevel: 'full',
                allowedActions: 'not array',
                forbiddenActions: [],
                escalationTarget: null,
                description: 'd', ts: _now()
            })).toThrow(/array/i);
        });
        test('duplicate jurisdictionId throws', () => {
            M.registerJurisdiction({
                userId: UID_J, resolvedEnv: ENV,
                jurisdictionId: 'rj_dup', domain: 'risk',
                authorityLevel: 'full',
                allowedActions: [], forbiddenActions: [],
                escalationTarget: null,
                description: 'd', ts: _now()
            });
            expect(() => M.registerJurisdiction({
                userId: UID_J, resolvedEnv: ENV,
                jurisdictionId: 'rj_dup', domain: 'reasoning',
                authorityLevel: 'advisory',
                allowedActions: [], forbiddenActions: [],
                escalationTarget: null,
                description: 'd', ts: _now()
            })).toThrow(/duplicate/);
        });
    });

    describe('recordDecision (integration)', () => {
        function _seedJurisdiction(uid, jid, opts = {}) {
            return M.registerJurisdiction({
                userId: uid, resolvedEnv: ENV,
                jurisdictionId: jid,
                domain: opts.domain || 'reasoning',
                authorityLevel: opts.authorityLevel || 'full',
                allowedActions: opts.allowedActions || ['allowed_action'],
                forbiddenActions: opts.forbiddenActions || ['forbidden_action'],
                escalationTarget: opts.escalationTarget !== undefined
                    ? opts.escalationTarget : 'operator',
                description: 'd', ts: _now()
            });
        }
        test('full + in_allowed → act verdict', () => {
            _seedJurisdiction(UID_D, 'rd_j1');
            const r = M.recordDecision({
                userId: UID_D, resolvedEnv: ENV,
                decisionId: 'rd_d1',
                jurisdictionId: 'rd_j1',
                proposedActionLabel: 'allowed_action',
                actionDomain: 'reasoning',
                ts: _now()
            });
            expect(r.recorded).toBe(true);
            expect(r.actionClassification).toBe('in_allowed');
            expect(r.verdict).toBe('act');
        });
        test('full + in_forbidden → refuse verdict', () => {
            _seedJurisdiction(UID_D, 'rd_j2');
            const r = M.recordDecision({
                userId: UID_D, resolvedEnv: ENV,
                decisionId: 'rd_d2',
                jurisdictionId: 'rd_j2',
                proposedActionLabel: 'forbidden_action',
                actionDomain: 'reasoning',
                ts: _now()
            });
            expect(r.verdict).toBe('refuse');
        });
        test('advisory + in_allowed → escalate verdict', () => {
            _seedJurisdiction(UID_D, 'rd_j3', { authorityLevel: 'advisory' });
            const r = M.recordDecision({
                userId: UID_D, resolvedEnv: ENV,
                decisionId: 'rd_d3',
                jurisdictionId: 'rd_j3',
                proposedActionLabel: 'allowed_action',
                actionDomain: 'reasoning',
                ts: _now()
            });
            expect(r.verdict).toBe('escalate');
            expect(r.escalationTarget).toBe('operator');
        });
        test('refuse authority → refuse regardless of classification', () => {
            _seedJurisdiction(UID_D, 'rd_j4', { authorityLevel: 'refuse' });
            const r = M.recordDecision({
                userId: UID_D, resolvedEnv: ENV,
                decisionId: 'rd_d4',
                jurisdictionId: 'rd_j4',
                proposedActionLabel: 'allowed_action',  // even allowed!
                actionDomain: 'reasoning',
                ts: _now()
            });
            expect(r.verdict).toBe('refuse');
        });
        test('decision on nonexistent jurisdiction throws', () => {
            expect(() => M.recordDecision({
                userId: UID_D, resolvedEnv: ENV,
                decisionId: 'rd_orph',
                jurisdictionId: 'rd_nope',
                proposedActionLabel: 'x',
                actionDomain: 'reasoning',
                ts: _now()
            })).toThrow(/not found/i);
        });
        test('duplicate decisionId throws', () => {
            _seedJurisdiction(UID_D, 'rd_dup_j');
            M.recordDecision({
                userId: UID_D, resolvedEnv: ENV,
                decisionId: 'rd_dup',
                jurisdictionId: 'rd_dup_j',
                proposedActionLabel: 'allowed_action',
                actionDomain: 'reasoning', ts: _now()
            });
            expect(() => M.recordDecision({
                userId: UID_D, resolvedEnv: ENV,
                decisionId: 'rd_dup',
                jurisdictionId: 'rd_dup_j',
                proposedActionLabel: 'allowed_action',
                actionDomain: 'reasoning', ts: _now()
            })).toThrow(/duplicate/);
        });
    });

    describe('getActiveJurisdictions & getDecisionHistory', () => {
        test('getActiveJurisdictions returns all active for user × env', () => {
            M.registerJurisdiction({
                userId: UID_GET, resolvedEnv: ENV,
                jurisdictionId: 'gj_r', domain: 'reasoning',
                authorityLevel: 'full',
                allowedActions: [], forbiddenActions: [],
                escalationTarget: null, description: 'd', ts: _now()
            });
            M.registerJurisdiction({
                userId: UID_GET, resolvedEnv: ENV,
                jurisdictionId: 'gj_e', domain: 'execution',
                authorityLevel: 'advisory',
                allowedActions: [], forbiddenActions: [],
                escalationTarget: 'operator', description: 'd', ts: _now()
            });
            const r = M.getActiveJurisdictions({
                userId: UID_GET, resolvedEnv: ENV
            });
            expect(r.length).toBe(2);
        });
        test('getDecisionHistory filters by verdict', () => {
            M.registerJurisdiction({
                userId: UID_GET, resolvedEnv: ENV,
                jurisdictionId: 'gh_j', domain: 'reasoning',
                authorityLevel: 'full',
                allowedActions: ['ok'], forbiddenActions: ['bad'],
                escalationTarget: null, description: 'd', ts: _now()
            });
            M.recordDecision({
                userId: UID_GET, resolvedEnv: ENV,
                decisionId: 'gh_d1', jurisdictionId: 'gh_j',
                proposedActionLabel: 'ok', actionDomain: 'reasoning',
                ts: _now()
            });
            M.recordDecision({
                userId: UID_GET, resolvedEnv: ENV,
                decisionId: 'gh_d2', jurisdictionId: 'gh_j',
                proposedActionLabel: 'bad', actionDomain: 'reasoning',
                ts: _now()
            });
            const acts = M.getDecisionHistory({
                userId: UID_GET, resolvedEnv: ENV,
                verdict: 'act'
            });
            const refuses = M.getDecisionHistory({
                userId: UID_GET, resolvedEnv: ENV,
                verdict: 'refuse'
            });
            expect(acts.length).toBe(1);
            expect(refuses.length).toBe(1);
        });
    });

    describe('isolation per user × env', () => {
        test('uid isolation', () => {
            M.registerJurisdiction({
                userId: UID_ISO_A, resolvedEnv: ENV,
                jurisdictionId: 'iso_a', domain: 'reasoning',
                authorityLevel: 'full',
                allowedActions: [], forbiddenActions: [],
                escalationTarget: null, description: 'd', ts: _now()
            });
            M.registerJurisdiction({
                userId: UID_ISO_B, resolvedEnv: ENV,
                jurisdictionId: 'iso_b', domain: 'reasoning',
                authorityLevel: 'full',
                allowedActions: [], forbiddenActions: [],
                escalationTarget: null, description: 'd', ts: _now()
            });
            const a = M.getActiveJurisdictions({
                userId: UID_ISO_A, resolvedEnv: ENV
            });
            expect(a.every(j => j.jurisdictionId !== 'iso_b')).toBe(true);
        });
        test('env isolation', () => {
            M.registerJurisdiction({
                userId: UID_ENV, resolvedEnv: 'DEMO',
                jurisdictionId: 'env_d', domain: 'reasoning',
                authorityLevel: 'full',
                allowedActions: [], forbiddenActions: [],
                escalationTarget: null, description: 'd', ts: _now()
            });
            const testnet = M.getActiveJurisdictions({
                userId: UID_ENV, resolvedEnv: 'TESTNET'
            });
            expect(testnet).toEqual([]);
        });
    });
});
