'use strict';

/**
 * OMEGA §159 SELF-KNOWLEDGE REPORT / HOW-I-THINK INTERPRETER.
 * Canonical: /root/_review/ml_brain/ml_brain_canonic.txt lines 5337-5368.
 *
 * "cum am gandit concret, nu doar ce am decis?"
 *
 * Tests FIRST per TDD discipline.
 */

const path = require('path');
const fs = require('fs');
const os = require('os');

const TEST_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-w3-p159-'));
const TEST_DB_PATH = path.join(TEST_DB_DIR, 'test.db');
process.env.ZEUS_DB_PATH = TEST_DB_PATH;
process.env.ZEUS_TEST_DISABLE_AUTH = '1';

const { db } = require('../../../server/services/database');
const M = require('../../../server/services/ml/_meta/selfKnowledgeReport');

const UID = 9159;
const UID_R = 9259;
const UID_C = 9359;
const UID_GET = 9459;
const UID_ISO_A = 9559;
const UID_ISO_B = 9659;
const UID_ENV = 9759;
const ENV = 'DEMO';
const _now = () => Date.now();

const FULL_REPORT = {
    whatISaw: ['btc broke 72k level', 'volume spike 3x', 'funding flipping positive'],
    whatIInferred: ['breakout valid', 'crowd long imbalance forming'],
    whatIAssumed: ['no macro shock incoming next 4h'],
    whatIDoubted: ['follow-through strength', 'cross-venue alignment'],
    whatChangedMyMind: 'OBI flipped from positive to neutral at the 72.1k retest',
    whatLimitedMyAction: ['daily DD budget at 60%', 'correlated SOL position open'],
    reasoningPathUsed: 'level_recheck + obi_confirm + funding_filter',
    alternativePathsRejected: [
        { path: 'momentum_only', reason: 'no level confirmation' },
        { path: 'breakout_strict', reason: 'insufficient cross-venue alignment' }
    ],
    missingInformation: ['real-time options skew', 'whale alert feed delayed 12s'],
    blockedAuthority: 'execution_size capped by user override (current: 0.5x)',
    shortSummary: 'Long BTC at 72.1k retest; size half due to DD budget; abort if OBI re-flips'
};

function cleanRows() {
    const uids = [UID, UID_R, UID_C, UID_GET, UID_ISO_A, UID_ISO_B, UID_ENV];
    const placeholders = uids.map(() => '?').join(',');
    db.prepare(`DELETE FROM ml_self_knowledge_critique WHERE user_id IN (${placeholders})`).run(...uids);
    db.prepare(`DELETE FROM ml_self_knowledge_reports WHERE user_id IN (${placeholders})`).run(...uids);
}
beforeEach(() => cleanRows());
afterAll(() => cleanRows());

describe('OMEGA §159 SELF-KNOWLEDGE REPORT', () => {

    describe('Migrations 316+317', () => {
        test('316 applied', () => {
            expect(db.prepare("SELECT name FROM _migrations WHERE name=?").get('316_ml_self_knowledge_reports')).toBeTruthy();
        });
        test('317 applied', () => {
            expect(db.prepare("SELECT name FROM _migrations WHERE name=?").get('317_ml_self_knowledge_critique')).toBeTruthy();
        });
        test('completeness_score range CHECK', () => {
            expect(() => db.prepare(`INSERT INTO ml_self_knowledge_reports
                (user_id, resolved_env, report_id, decision_id, what_i_saw_json,
                 what_i_inferred_json, what_i_assumed_json, what_i_doubted_json,
                 what_changed_my_mind_text, what_limited_my_action_json,
                 reasoning_path_used, alternative_paths_rejected_json,
                 missing_information_json, blocked_authority_text, short_summary,
                 completeness_score, ts)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
                .run(UID, ENV, 'r_br', 'd1', '[]', '[]', '[]', '[]',
                    null, '[]', 'p', '[]', '[]', null, 's', 1.5, _now())).toThrow();
        });
        test('inventiveness_flag CHECK enum (0,1)', () => {
            db.prepare(`INSERT INTO ml_self_knowledge_reports
                (user_id, resolved_env, report_id, decision_id, what_i_saw_json,
                 what_i_inferred_json, what_i_assumed_json, what_i_doubted_json,
                 what_changed_my_mind_text, what_limited_my_action_json,
                 reasoning_path_used, alternative_paths_rejected_json,
                 missing_information_json, blocked_authority_text, short_summary,
                 completeness_score, ts)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
                .run(UID, ENV, 'r_for_ck', 'd1', '[]', '[]', '[]', '[]',
                    null, '[]', 'p', '[]', '[]', null, 's', 0.5, _now());
            expect(() => db.prepare(`INSERT INTO ml_self_knowledge_critique
                (user_id, resolved_env, critique_id, report_id, self_criticism_text,
                 self_limitation_text, inventiveness_flag, inventiveness_reason, ts)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
                .run(UID, ENV, 'c_bk', 'r_for_ck', 'sc', 'sl', 2, null, _now())).toThrow();
        });
        test('report_id UNIQUE', () => {
            const stmt = db.prepare(`INSERT INTO ml_self_knowledge_reports
                (user_id, resolved_env, report_id, decision_id, what_i_saw_json,
                 what_i_inferred_json, what_i_assumed_json, what_i_doubted_json,
                 what_changed_my_mind_text, what_limited_my_action_json,
                 reasoning_path_used, alternative_paths_rejected_json,
                 missing_information_json, blocked_authority_text, short_summary,
                 completeness_score, ts)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
            stmt.run(UID, ENV, 'r_dup', 'd1', '[]', '[]', '[]', '[]',
                null, '[]', 'p', '[]', '[]', null, 's', 0.5, _now());
            expect(() => stmt.run(UID, ENV, 'r_dup', 'd2', '[]', '[]', '[]', '[]',
                null, '[]', 'p2', '[]', '[]', null, 's2', 0.6, _now())).toThrow();
        });
        test('FK ON DELETE RESTRICT on report_id', () => {
            db.prepare(`INSERT INTO ml_self_knowledge_reports
                (user_id, resolved_env, report_id, decision_id, what_i_saw_json,
                 what_i_inferred_json, what_i_assumed_json, what_i_doubted_json,
                 what_changed_my_mind_text, what_limited_my_action_json,
                 reasoning_path_used, alternative_paths_rejected_json,
                 missing_information_json, blocked_authority_text, short_summary,
                 completeness_score, ts)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
                .run(UID, ENV, 'r_fk', 'd1', '[]', '[]', '[]', '[]',
                    null, '[]', 'p', '[]', '[]', null, 's', 0.5, _now());
            db.prepare(`INSERT INTO ml_self_knowledge_critique
                (user_id, resolved_env, critique_id, report_id, self_criticism_text,
                 self_limitation_text, inventiveness_flag, inventiveness_reason, ts)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
                .run(UID, ENV, 'c_fk', 'r_fk', 'sc', 'sl', 0, null, _now());
            expect(() => db.prepare(`DELETE FROM ml_self_knowledge_reports WHERE report_id=?`).run('r_fk')).toThrow();
            db.prepare(`DELETE FROM ml_self_knowledge_critique WHERE critique_id=?`).run('c_fk');
            db.prepare(`DELETE FROM ml_self_knowledge_reports WHERE report_id=?`).run('r_fk');
        });
    });

    describe('Constants', () => {
        test('EXPLANATION_LAYERS frozen 6 (canonical PDF)', () => {
            expect(M.EXPLANATION_LAYERS).toEqual([
                'what_i_saw', 'what_i_inferred', 'what_i_assumed',
                'what_i_doubted', 'what_changed_my_mind', 'what_limited_my_action'
            ]);
            expect(Object.isFrozen(M.EXPLANATION_LAYERS)).toBe(true);
        });
        test('DISTINCTIONS frozen 4 (canonical PDF)', () => {
            expect(M.DISTINCTIONS).toEqual([
                'reasoning_path_used', 'alternative_paths_rejected',
                'missing_information', 'blocked_authority'
            ]);
            expect(Object.isFrozen(M.DISTINCTIONS)).toBe(true);
        });
        test('OUTPUT_TYPES frozen 4', () => {
            expect(M.OUTPUT_TYPES).toEqual([
                'short_summary', 'deep_explanation',
                'self_criticism', 'self_limitation'
            ]);
            expect(Object.isFrozen(M.OUTPUT_TYPES)).toBe(true);
        });
        test('INVENTIVENESS_GENERIC_PATTERNS frozen', () => {
            expect(Array.isArray(M.INVENTIVENESS_GENERIC_PATTERNS)).toBe(true);
            expect(Object.isFrozen(M.INVENTIVENESS_GENERIC_PATTERNS)).toBe(true);
        });
    });

    describe('computeCompletenessScore (pure)', () => {
        test('all layers + all distinctions populated → score 1.0', () => {
            const r = M.computeCompletenessScore({
                whatISaw: ['a'], whatIInferred: ['b'], whatIAssumed: ['c'],
                whatIDoubted: ['d'], whatChangedMyMind: 'changed', whatLimitedMyAction: ['e'],
                reasoningPathUsed: 'rp', alternativePathsRejected: [{ path: 'x', reason: 'y' }],
                missingInformation: ['g'], blockedAuthority: 'b'
            });
            expect(r.score).toBe(1);
        });
        test('all empty → score 0', () => {
            const r = M.computeCompletenessScore({
                whatISaw: [], whatIInferred: [], whatIAssumed: [],
                whatIDoubted: [], whatChangedMyMind: null, whatLimitedMyAction: [],
                reasoningPathUsed: '', alternativePathsRejected: [],
                missingInformation: [], blockedAuthority: null
            });
            expect(r.score).toBe(0);
        });
        test('half layers populated → partial score', () => {
            const r = M.computeCompletenessScore({
                whatISaw: ['a'], whatIInferred: ['b'], whatIAssumed: [],
                whatIDoubted: [], whatChangedMyMind: null, whatLimitedMyAction: [],
                reasoningPathUsed: 'rp', alternativePathsRejected: [],
                missingInformation: [], blockedAuthority: null
            });
            expect(r.score).toBeGreaterThan(0);
            expect(r.score).toBeLessThan(1);
        });
        test('completeness reports populated count', () => {
            const r = M.computeCompletenessScore({
                whatISaw: ['a'], whatIInferred: [], whatIAssumed: [],
                whatIDoubted: [], whatChangedMyMind: null, whatLimitedMyAction: [],
                reasoningPathUsed: 'rp', alternativePathsRejected: [],
                missingInformation: [], blockedAuthority: null
            });
            expect(r.populatedCount).toBe(2);  // 1 layer + 1 distinction
        });
    });

    describe('detectInventiveness (pure)', () => {
        test('genuine specific report → not flagged', () => {
            const r = M.detectInventiveness({
                whatISaw: FULL_REPORT.whatISaw,
                whatIInferred: FULL_REPORT.whatIInferred,
                whatIAssumed: FULL_REPORT.whatIAssumed,
                whatIDoubted: FULL_REPORT.whatIDoubted,
                shortSummary: FULL_REPORT.shortSummary
            });
            expect(r.flag).toBe(0);
        });
        test('all layers identical length + generic phrasing → flagged', () => {
            const r = M.detectInventiveness({
                whatISaw: ['something happened'],
                whatIInferred: ['something happened'],
                whatIAssumed: ['something happened'],
                whatIDoubted: ['something happened'],
                shortSummary: 'something happened'
            });
            expect(r.flag).toBe(1);
            expect(r.reason).toBeTruthy();
        });
        test('empty layers do not falsely flag inventiveness', () => {
            const r = M.detectInventiveness({
                whatISaw: [], whatIInferred: [],
                whatIAssumed: [], whatIDoubted: [],
                shortSummary: ''
            });
            expect(r.flag).toBe(0);
        });
        test('uses INVENTIVENESS_GENERIC_PATTERNS for detection', () => {
            const r = M.detectInventiveness({
                whatISaw: ['the system thought about it carefully'],
                whatIInferred: ['the system decided this was good'],
                whatIAssumed: ['various things'],
                whatIDoubted: ['some things'],
                shortSummary: 'made a decision based on analysis'
            });
            expect(r.flag).toBe(1);
        });
    });

    describe('summarizeReport (pure)', () => {
        test('extracts compact summary fields from full report', () => {
            const r = M.summarizeReport({
                report: FULL_REPORT
            });
            expect(r.summary).toBeTruthy();
            expect(typeof r.summary).toBe('string');
            expect(r.headlineDecisionPath).toBe('level_recheck + obi_confirm + funding_filter');
            expect(r.observationsCount).toBe(3);
            expect(r.inferencesCount).toBe(2);
            expect(r.doubtsCount).toBe(2);
        });
        test('handles partial reports gracefully', () => {
            const r = M.summarizeReport({
                report: {
                    whatISaw: ['x'], whatIInferred: [], whatIAssumed: [],
                    whatIDoubted: [], whatChangedMyMind: null,
                    whatLimitedMyAction: [], reasoningPathUsed: 'p',
                    alternativePathsRejected: [], missingInformation: [],
                    blockedAuthority: null, shortSummary: 'short'
                }
            });
            expect(r.observationsCount).toBe(1);
            expect(r.inferencesCount).toBe(0);
        });
    });

    describe('recordSelfKnowledgeReport', () => {
        test('persists full report with auto-computed completeness', () => {
            const r = M.recordSelfKnowledgeReport({
                userId: UID_R, resolvedEnv: ENV,
                reportId: 'rec_1', decisionId: 'd_btc_long_72k',
                ...FULL_REPORT,
                ts: _now()
            });
            expect(r.recorded).toBe(true);
            expect(r.completenessScore).toBe(1);
        });
        test('partial report records partial completeness', () => {
            const r = M.recordSelfKnowledgeReport({
                userId: UID_R, resolvedEnv: ENV,
                reportId: 'rec_partial', decisionId: 'd1',
                whatISaw: ['a'], whatIInferred: [], whatIAssumed: [],
                whatIDoubted: [], whatChangedMyMind: null,
                whatLimitedMyAction: [],
                reasoningPathUsed: 'p',
                alternativePathsRejected: [],
                missingInformation: [],
                blockedAuthority: null,
                shortSummary: 's',
                ts: _now()
            });
            expect(r.completenessScore).toBeGreaterThan(0);
            expect(r.completenessScore).toBeLessThan(1);
        });
        test('duplicate reportId throws', () => {
            M.recordSelfKnowledgeReport({
                userId: UID_R, resolvedEnv: ENV,
                reportId: 'rec_dup', decisionId: 'd1',
                ...FULL_REPORT, ts: _now()
            });
            expect(() => M.recordSelfKnowledgeReport({
                userId: UID_R, resolvedEnv: ENV,
                reportId: 'rec_dup', decisionId: 'd1',
                ...FULL_REPORT, ts: _now()
            })).toThrow(/duplicate/);
        });
        test('non-array layer throws', () => {
            expect(() => M.recordSelfKnowledgeReport({
                userId: UID_R, resolvedEnv: ENV,
                reportId: 'rec_arr', decisionId: 'd1',
                whatISaw: 'not array', whatIInferred: [], whatIAssumed: [],
                whatIDoubted: [], whatChangedMyMind: null,
                whatLimitedMyAction: [],
                reasoningPathUsed: 'p',
                alternativePathsRejected: [],
                missingInformation: [], blockedAuthority: null,
                shortSummary: 's',
                ts: _now()
            })).toThrow(/array/i);
        });
    });

    describe('recordSelfKnowledgeCritique (integration)', () => {
        function _seedReport(uid, rid) {
            return M.recordSelfKnowledgeReport({
                userId: uid, resolvedEnv: ENV,
                reportId: rid, decisionId: `d_for_${rid}`,
                ...FULL_REPORT, ts: _now()
            });
        }
        test('persists critique with auto-inventiveness flag', () => {
            _seedReport(UID_C, 'rc_r1');
            const r = M.recordSelfKnowledgeCritique({
                userId: UID_C, resolvedEnv: ENV,
                critiqueId: 'rc_c1', reportId: 'rc_r1',
                selfCriticism: 'I gave too much weight to single OBI signal',
                selfLimitation: 'Cannot verify cross-venue with current latency',
                ts: _now()
            });
            expect(r.recorded).toBe(true);
            expect(r.inventivenessFlag).toBe(0);  // FULL_REPORT is genuine
        });
        test('flags inventive report when critiquing it', () => {
            // Seed a generic-looking report
            M.recordSelfKnowledgeReport({
                userId: UID_C, resolvedEnv: ENV,
                reportId: 'rc_invent_r', decisionId: 'd1',
                whatISaw: ['something occurred'],
                whatIInferred: ['something occurred'],
                whatIAssumed: ['something occurred'],
                whatIDoubted: ['something occurred'],
                whatChangedMyMind: null,
                whatLimitedMyAction: ['something occurred'],
                reasoningPathUsed: 'analysis',
                alternativePathsRejected: [],
                missingInformation: ['various things'],
                blockedAuthority: null,
                shortSummary: 'analysis was performed',
                ts: _now()
            });
            const r = M.recordSelfKnowledgeCritique({
                userId: UID_C, resolvedEnv: ENV,
                critiqueId: 'rc_invent_c', reportId: 'rc_invent_r',
                selfCriticism: 'report seems fabricated',
                selfLimitation: 'cannot verify any of the above',
                ts: _now()
            });
            expect(r.inventivenessFlag).toBe(1);
        });
        test('critique on nonexistent report throws (FK)', () => {
            expect(() => M.recordSelfKnowledgeCritique({
                userId: UID_C, resolvedEnv: ENV,
                critiqueId: 'rc_orph', reportId: 'rc_nope',
                selfCriticism: 'x', selfLimitation: 'y',
                ts: _now()
            })).toThrow();
        });
        test('duplicate critiqueId throws', () => {
            _seedReport(UID_C, 'rc_dup_r');
            M.recordSelfKnowledgeCritique({
                userId: UID_C, resolvedEnv: ENV,
                critiqueId: 'rc_dup', reportId: 'rc_dup_r',
                selfCriticism: 'x', selfLimitation: 'y', ts: _now()
            });
            expect(() => M.recordSelfKnowledgeCritique({
                userId: UID_C, resolvedEnv: ENV,
                critiqueId: 'rc_dup', reportId: 'rc_dup_r',
                selfCriticism: 'x', selfLimitation: 'y', ts: _now()
            })).toThrow(/duplicate/);
        });
    });

    describe('getReportsForDecision & getLatestCritique', () => {
        test('getReportsForDecision returns all reports for a decision', () => {
            M.recordSelfKnowledgeReport({
                userId: UID_GET, resolvedEnv: ENV,
                reportId: 'gr_1', decisionId: 'd_target',
                ...FULL_REPORT, ts: _now()
            });
            M.recordSelfKnowledgeReport({
                userId: UID_GET, resolvedEnv: ENV,
                reportId: 'gr_2', decisionId: 'd_target',
                ...FULL_REPORT, ts: _now() + 100
            });
            const r = M.getReportsForDecision({
                userId: UID_GET, resolvedEnv: ENV,
                decisionId: 'd_target'
            });
            expect(r.length).toBe(2);
        });
        test('getLatestCritique returns most recent or null', () => {
            M.recordSelfKnowledgeReport({
                userId: UID_GET, resolvedEnv: ENV,
                reportId: 'gl_r', decisionId: 'd1',
                ...FULL_REPORT, ts: 1000
            });
            M.recordSelfKnowledgeCritique({
                userId: UID_GET, resolvedEnv: ENV,
                critiqueId: 'gl_c1', reportId: 'gl_r',
                selfCriticism: 'sc1', selfLimitation: 'sl1', ts: 2000
            });
            M.recordSelfKnowledgeCritique({
                userId: UID_GET, resolvedEnv: ENV,
                critiqueId: 'gl_c2', reportId: 'gl_r',
                selfCriticism: 'sc2', selfLimitation: 'sl2', ts: 3000
            });
            const r = M.getLatestCritique({
                userId: UID_GET, resolvedEnv: ENV,
                reportId: 'gl_r'
            });
            expect(r.critiqueId).toBe('gl_c2');
        });
        test('getLatestCritique returns null when none', () => {
            M.recordSelfKnowledgeReport({
                userId: UID_GET, resolvedEnv: ENV,
                reportId: 'gl_no', decisionId: 'd1',
                ...FULL_REPORT, ts: _now()
            });
            expect(M.getLatestCritique({
                userId: UID_GET, resolvedEnv: ENV,
                reportId: 'gl_no'
            })).toBeNull();
        });
    });

    describe('isolation per user × env', () => {
        test('uid isolation', () => {
            M.recordSelfKnowledgeReport({
                userId: UID_ISO_A, resolvedEnv: ENV,
                reportId: 'iso_a', decisionId: 'd_shared',
                ...FULL_REPORT, ts: _now()
            });
            M.recordSelfKnowledgeReport({
                userId: UID_ISO_B, resolvedEnv: ENV,
                reportId: 'iso_b', decisionId: 'd_shared',
                ...FULL_REPORT, ts: _now()
            });
            const a = M.getReportsForDecision({
                userId: UID_ISO_A, resolvedEnv: ENV,
                decisionId: 'd_shared'
            });
            expect(a.every(r => r.reportId !== 'iso_b')).toBe(true);
        });
        test('env isolation', () => {
            M.recordSelfKnowledgeReport({
                userId: UID_ENV, resolvedEnv: 'DEMO',
                reportId: 'env_d', decisionId: 'd1',
                ...FULL_REPORT, ts: _now()
            });
            const testnet = M.getReportsForDecision({
                userId: UID_ENV, resolvedEnv: 'TESTNET',
                decisionId: 'd1'
            });
            expect(testnet).toEqual([]);
        });
    });
});
