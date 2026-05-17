'use strict';

/**
 * OMEGA §147 INTELLECTUAL HONESTY AUDIT / ANTI-RATIONALIZATION ENGINE.
 * Canonical: /root/_review/ml_brain/ml_brain_canonic.txt lines 4776-4820.
 *
 * "spun adevarul despre de ce am facut asta sau imi scriu o poveste mai
 *  frumoasa dupa?"
 *
 * Tests written FIRST per TDD discipline (RED step). Module does not exist
 * yet — these tests MUST fail when run before module creation.
 */

const path = require('path');
const fs = require('fs');
const os = require('os');

const TEST_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-w3-p147-'));
const TEST_DB_PATH = path.join(TEST_DB_DIR, 'test.db');
process.env.ZEUS_DB_PATH = TEST_DB_PATH;
process.env.ZEUS_TEST_DISABLE_AUTH = '1';

const { db } = require('../../../server/services/database');
const M = require('../../../server/services/ml/_meta/intellectualHonestyAudit');

const UID = 9147;
const UID_COMMIT = 9247;
const UID_AUDIT = 9347;
const UID_GET = 9447;
const UID_ISO_A = 9547;
const UID_ISO_B = 9647;
const UID_ENV = 9747;
const ENV = 'DEMO';
const _now = () => Date.now();

function cleanRows() {
    const uids = [UID, UID_COMMIT, UID_AUDIT, UID_GET,
                  UID_ISO_A, UID_ISO_B, UID_ENV];
    const placeholders = uids.map(() => '?').join(',');
    db.prepare(`DELETE FROM ml_honesty_audit_assessments WHERE user_id IN (${placeholders})`).run(...uids);
    db.prepare(`DELETE FROM ml_reason_commitments WHERE user_id IN (${placeholders})`).run(...uids);
}
beforeEach(() => cleanRows());
afterAll(() => cleanRows());

describe('OMEGA §147 INTELLECTUAL HONESTY AUDIT', () => {

    describe('Migrations 292+293', () => {
        test('292 applied', () => {
            expect(db.prepare("SELECT name FROM _migrations WHERE name=?").get('292_ml_reason_commitments')).toBeTruthy();
        });
        test('293 applied', () => {
            expect(db.prepare("SELECT name FROM _migrations WHERE name=?").get('293_ml_honesty_audit_assessments')).toBeTruthy();
        });
        test('stage CHECK enum on commitments', () => {
            expect(() => db.prepare(`INSERT INTO ml_reason_commitments
                (user_id, resolved_env, commitment_id, decision_id, stage,
                 reasons_text, reasons_hash, locked_at_ts,
                 is_reinterpretation, ts)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
                .run(UID, ENV, 'c_bk', 'd1', 'BOGUS_STAGE',
                    'reasons', 'hash', _now(), 0, _now())).toThrow();
        });
        test('rationalization_pattern CHECK enum', () => {
            // Need a committed reason first to satisfy FK
            db.prepare(`INSERT INTO ml_reason_commitments
                (user_id, resolved_env, commitment_id, decision_id, stage,
                 reasons_text, reasons_hash, locked_at_ts,
                 is_reinterpretation, ts)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
                .run(UID, ENV, 'c_for_audit_bad', 'd_for_audit_bad',
                    'pre_decision', 'r', 'h', _now(), 0, _now());
            expect(() => db.prepare(`INSERT INTO ml_honesty_audit_assessments
                (user_id, resolved_env, assessment_id, decision_id,
                 pre_decision_commitment_id, post_decision_commitment_id,
                 post_outcome_commitment_id,
                 pre_to_post_decision_drift, pre_to_post_outcome_drift,
                 post_decision_to_post_outcome_drift, max_drift_score,
                 rationalization_pattern, honesty_penalty,
                 investigation_required, ts)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
                .run(UID, ENV, 'a_bk', 'd_for_audit_bad', 'c_for_audit_bad',
                    null, null, 0, 0, 0, 0, 'BOGUS_PATTERN', 0, 0, _now())).toThrow();
        });
        test('UNIQUE(user × env × decision × stage) — one commitment per stage', () => {
            const stmt = db.prepare(`INSERT INTO ml_reason_commitments
                (user_id, resolved_env, commitment_id, decision_id, stage,
                 reasons_text, reasons_hash, locked_at_ts,
                 is_reinterpretation, ts)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
            stmt.run(UID, ENV, 'c_uniq1', 'd_uniq', 'pre_decision',
                'reasons1', 'hash1', _now(), 0, _now());
            expect(() => stmt.run(UID, ENV, 'c_uniq2', 'd_uniq',
                'pre_decision', 'reasons2', 'hash2', _now(), 0, _now())).toThrow();
        });
        test('different stages for same decision → allowed', () => {
            const stmt = db.prepare(`INSERT INTO ml_reason_commitments
                (user_id, resolved_env, commitment_id, decision_id, stage,
                 reasons_text, reasons_hash, locked_at_ts,
                 is_reinterpretation, ts)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
            stmt.run(UID, ENV, 'c_ms1', 'd_multi', 'pre_decision',
                'r1', 'h1', _now(), 0, _now());
            stmt.run(UID, ENV, 'c_ms2', 'd_multi', 'post_decision',
                'r2', 'h2', _now(), 0, _now());
            stmt.run(UID, ENV, 'c_ms3', 'd_multi', 'post_outcome',
                'r3', 'h3', _now(), 1, _now());
            // No throw expected
            expect(true).toBe(true);
        });
        test('FK pre_decision_commitment_id → ml_reason_commitments', () => {
            expect(() => db.prepare(`INSERT INTO ml_honesty_audit_assessments
                (user_id, resolved_env, assessment_id, decision_id,
                 pre_decision_commitment_id, post_decision_commitment_id,
                 post_outcome_commitment_id,
                 pre_to_post_decision_drift, pre_to_post_outcome_drift,
                 post_decision_to_post_outcome_drift, max_drift_score,
                 rationalization_pattern, honesty_penalty,
                 investigation_required, ts)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
                .run(UID, ENV, 'a_orphan', 'd', 'NONEXISTENT_PRE',
                    null, null, 0, 0, 0, 0, 'none', 0, 0, _now())).toThrow(/FOREIGN KEY/i);
        });
    });

    describe('Constants', () => {
        test('STAGES frozen 3', () => {
            expect(M.STAGES).toEqual([
                'pre_decision', 'post_decision', 'post_outcome'
            ]);
            expect(Object.isFrozen(M.STAGES)).toBe(true);
        });
        test('RATIONALIZATION_PATTERNS frozen 5 (none + 4 canonical)', () => {
            expect(M.RATIONALIZATION_PATTERNS).toEqual([
                'none', 'post_hoc_beautification',
                'explanatory_inflation', 'retrofitting_causal',
                'self_excusing_narrative'
            ]);
            expect(Object.isFrozen(M.RATIONALIZATION_PATTERNS)).toBe(true);
        });
        test('DRIFT_THRESHOLDS ordered', () => {
            expect(M.DRIFT_THRESHOLDS.investigation).toBe(0.50);
            expect(M.DRIFT_THRESHOLDS.penalty).toBe(0.20);
            expect(M.DRIFT_THRESHOLDS.penalty).toBeLessThan(M.DRIFT_THRESHOLDS.investigation);
        });
        test('PENALTY_MAP all 5 patterns', () => {
            expect(M.PENALTY_MAP.none).toBe(0);
            expect(M.PENALTY_MAP.post_hoc_beautification).toBe(0.20);
            expect(M.PENALTY_MAP.explanatory_inflation).toBe(0.30);
            expect(M.PENALTY_MAP.retrofitting_causal).toBe(0.40);
            expect(M.PENALTY_MAP.self_excusing_narrative).toBe(0.50);
        });
    });

    describe('computeReasonHash (pure)', () => {
        test('same text → same hash (deterministic)', () => {
            const h1 = M.computeReasonHash({ text: 'volume spike with bullish divergence' });
            const h2 = M.computeReasonHash({ text: 'volume spike with bullish divergence' });
            expect(h1.hash).toBe(h2.hash);
        });
        test('different text → different hash', () => {
            const h1 = M.computeReasonHash({ text: 'reason A' });
            const h2 = M.computeReasonHash({ text: 'reason B' });
            expect(h1.hash).not.toBe(h2.hash);
        });
        test('returns non-empty hex string', () => {
            const r = M.computeReasonHash({ text: 'test' });
            expect(typeof r.hash).toBe('string');
            expect(r.hash.length).toBeGreaterThan(0);
            expect(/^[a-f0-9]+$/.test(r.hash)).toBe(true);
        });
    });

    describe('computeReasonDrift (pure)', () => {
        test('identical texts → 0 drift', () => {
            const r = M.computeReasonDrift({
                baselineText: 'volume spike rsi divergence',
                currentText: 'volume spike rsi divergence'
            });
            expect(r.drift).toBe(0);
        });
        test('totally different → 1 drift', () => {
            const r = M.computeReasonDrift({
                baselineText: 'volume spike',
                currentText: 'macro shock'
            });
            expect(r.drift).toBe(1);
        });
        test('half overlap → 0.50 drift (Jaccard)', () => {
            // Jaccard: 1 - intersection/union
            // baseline {a, b}, current {a, c} → int={a}=1, union={a,b,c}=3
            // similarity = 1/3, drift = 1 - 1/3 = 0.667
            const r = M.computeReasonDrift({
                baselineText: 'a b',
                currentText: 'a c'
            });
            expect(r.drift).toBeCloseTo(2/3, 4);
        });
        test('case insensitive', () => {
            const r = M.computeReasonDrift({
                baselineText: 'Volume Spike',
                currentText: 'volume spike'
            });
            expect(r.drift).toBe(0);
        });
        test('empty texts → 0 drift (trivially equal)', () => {
            const r = M.computeReasonDrift({
                baselineText: '',
                currentText: ''
            });
            expect(r.drift).toBe(0);
        });
    });

    describe('classifyRationalizationPattern (pure)', () => {
        test('all drifts low → none', () => {
            const r = M.classifyRationalizationPattern({
                preToPostDecisionDrift: 0.05,
                preToPostOutcomeDrift: 0.10,
                postDecisionToPostOutcomeDrift: 0.05,
                outcomeFavorable: true,
                outcomeAvailable: true,
                baselineWordCount: 10,
                postOutcomeWordCount: 12
            });
            expect(r.pattern).toBe('none');
        });
        test('high post_outcome drift + favorable outcome → self_excusing_narrative', () => {
            // We were wrong but outcome went our way → we rewrite to claim foresight
            const r = M.classifyRationalizationPattern({
                preToPostDecisionDrift: 0.10,
                preToPostOutcomeDrift: 0.75,
                postDecisionToPostOutcomeDrift: 0.70,
                outcomeFavorable: true,
                outcomeAvailable: true,
                baselineWordCount: 10,
                postOutcomeWordCount: 12
            });
            expect(r.pattern).toBe('self_excusing_narrative');
        });
        test('high post_outcome drift + unfavorable outcome → retrofitting_causal', () => {
            // Outcome bad, we retrofit a "should have known" explanation
            const r = M.classifyRationalizationPattern({
                preToPostDecisionDrift: 0.10,
                preToPostOutcomeDrift: 0.75,
                postDecisionToPostOutcomeDrift: 0.70,
                outcomeFavorable: false,
                outcomeAvailable: true,
                baselineWordCount: 10,
                postOutcomeWordCount: 12
            });
            expect(r.pattern).toBe('retrofitting_causal');
        });
        test('post-decision adds many words but content overlaps → explanatory_inflation', () => {
            // Same reasons but inflated wordcount → fluff added
            const r = M.classifyRationalizationPattern({
                preToPostDecisionDrift: 0.15,
                preToPostOutcomeDrift: 0.15,
                postDecisionToPostOutcomeDrift: 0.05,
                outcomeFavorable: true,
                outcomeAvailable: true,
                baselineWordCount: 5,
                postOutcomeWordCount: 50  // 10x expansion
            });
            expect(r.pattern).toBe('explanatory_inflation');
        });
        test('mild post-decision drift, no outcome yet → post_hoc_beautification', () => {
            const r = M.classifyRationalizationPattern({
                preToPostDecisionDrift: 0.30,
                preToPostOutcomeDrift: 0,
                postDecisionToPostOutcomeDrift: 0,
                outcomeFavorable: false,
                outcomeAvailable: false,
                baselineWordCount: 10,
                postOutcomeWordCount: 13
            });
            expect(r.pattern).toBe('post_hoc_beautification');
        });
        test('invalid outcome flag types still process', () => {
            const r = M.classifyRationalizationPattern({
                preToPostDecisionDrift: 0,
                preToPostOutcomeDrift: 0,
                postDecisionToPostOutcomeDrift: 0,
                outcomeFavorable: true,
                outcomeAvailable: true,
                baselineWordCount: 10,
                postOutcomeWordCount: 10
            });
            expect(r.pattern).toBe('none');
        });
    });

    describe('computeHonestyPenalty (pure)', () => {
        test('none → 0', () => {
            expect(M.computeHonestyPenalty({ pattern: 'none' }).penalty).toBe(0);
        });
        test('post_hoc_beautification → 0.20', () => {
            expect(M.computeHonestyPenalty({ pattern: 'post_hoc_beautification' }).penalty).toBe(0.20);
        });
        test('explanatory_inflation → 0.30', () => {
            expect(M.computeHonestyPenalty({ pattern: 'explanatory_inflation' }).penalty).toBe(0.30);
        });
        test('retrofitting_causal → 0.40', () => {
            expect(M.computeHonestyPenalty({ pattern: 'retrofitting_causal' }).penalty).toBe(0.40);
        });
        test('self_excusing_narrative → 0.50 (max)', () => {
            expect(M.computeHonestyPenalty({ pattern: 'self_excusing_narrative' }).penalty).toBe(0.50);
        });
        test('invalid pattern throws', () => {
            expect(() => M.computeHonestyPenalty({ pattern: 'BOGUS' })).toThrow();
        });
    });

    describe('isInvestigationRequired (pure)', () => {
        test('max_drift ≥ 0.50 → required', () => {
            expect(M.isInvestigationRequired({ maxDriftScore: 0.55 }).required).toBe(true);
        });
        test('max_drift < 0.50 → not required', () => {
            expect(M.isInvestigationRequired({ maxDriftScore: 0.30 }).required).toBe(false);
        });
        test('boundary 0.50 → required', () => {
            expect(M.isInvestigationRequired({ maxDriftScore: 0.50 }).required).toBe(true);
        });
        test('out-of-range throws', () => {
            expect(() => M.isInvestigationRequired({ maxDriftScore: 1.5 })).toThrow();
        });
    });

    describe('commitReason', () => {
        test('persists commitment with hash auto-computed', () => {
            const r = M.commitReason({
                userId: UID_COMMIT, resolvedEnv: ENV,
                commitmentId: 'c_persist_1',
                decisionId: 'd_persist',
                stage: 'pre_decision',
                reasonsText: 'RSI overbought + volume divergence on 4h',
                isReinterpretation: false,
                ts: _now()
            });
            expect(r.committed).toBe(true);
            expect(r.reasonsHash).toBeDefined();
            expect(r.reasonsHash.length).toBeGreaterThan(0);
        });
        test('same decision + stage = duplicate → throws', () => {
            M.commitReason({
                userId: UID_COMMIT, resolvedEnv: ENV,
                commitmentId: 'c_dup_1',
                decisionId: 'd_dup',
                stage: 'pre_decision',
                reasonsText: 'reason A',
                isReinterpretation: false,
                ts: _now()
            });
            expect(() => M.commitReason({
                userId: UID_COMMIT, resolvedEnv: ENV,
                commitmentId: 'c_dup_2',
                decisionId: 'd_dup',
                stage: 'pre_decision',  // same stage
                reasonsText: 'reason B',
                isReinterpretation: false,
                ts: _now()
            })).toThrow(/duplicate|UNIQUE/i);
        });
        test('different stages for same decision → ok', () => {
            M.commitReason({
                userId: UID_COMMIT, resolvedEnv: ENV,
                commitmentId: 'c_stages_pre',
                decisionId: 'd_stages',
                stage: 'pre_decision',
                reasonsText: 'pre reason',
                isReinterpretation: false,
                ts: 1000
            });
            const r = M.commitReason({
                userId: UID_COMMIT, resolvedEnv: ENV,
                commitmentId: 'c_stages_post',
                decisionId: 'd_stages',
                stage: 'post_decision',
                reasonsText: 'post reason',
                isReinterpretation: false,
                ts: 2000
            });
            expect(r.committed).toBe(true);
        });
        test('invalid stage throws', () => {
            expect(() => M.commitReason({
                userId: UID_COMMIT, resolvedEnv: ENV,
                commitmentId: 'c_bad_stage',
                decisionId: 'd', stage: 'BOGUS',
                reasonsText: 'r', isReinterpretation: false,
                ts: _now()
            })).toThrow(/invalid stage/);
        });
        test('empty reasonsText throws', () => {
            expect(() => M.commitReason({
                userId: UID_COMMIT, resolvedEnv: ENV,
                commitmentId: 'c_empty',
                decisionId: 'd', stage: 'pre_decision',
                reasonsText: '', isReinterpretation: false,
                ts: _now()
            })).toThrow(/empty|reasonsText/i);
        });
    });

    describe('recordHonestyAudit (integration)', () => {
        test('all 3 stages low drift → none pattern, no penalty', () => {
            const u = UID_AUDIT;
            M.commitReason({
                userId: u, resolvedEnv: ENV,
                commitmentId: 'a_pre_none', decisionId: 'd_none',
                stage: 'pre_decision',
                reasonsText: 'volume spike rsi divergence breakout', isReinterpretation: false, ts: 1000
            });
            M.commitReason({
                userId: u, resolvedEnv: ENV,
                commitmentId: 'a_post_none', decisionId: 'd_none',
                stage: 'post_decision',
                reasonsText: 'volume spike rsi divergence breakout', isReinterpretation: false, ts: 2000
            });
            M.commitReason({
                userId: u, resolvedEnv: ENV,
                commitmentId: 'a_outcome_none', decisionId: 'd_none',
                stage: 'post_outcome',
                reasonsText: 'volume spike rsi divergence breakout', isReinterpretation: true, ts: 3000
            });
            const r = M.recordHonestyAudit({
                userId: u, resolvedEnv: ENV,
                assessmentId: 'au_none', decisionId: 'd_none',
                outcomeFavorable: true, outcomeAvailable: true, ts: 4000
            });
            expect(r.recorded).toBe(true);
            expect(r.rationalizationPattern).toBe('none');
            expect(r.honestyPenalty).toBe(0);
            expect(r.investigationRequired).toBe(false);
        });
        test('self_excusing_narrative when favorable outcome + drift', () => {
            const u = UID_AUDIT;
            M.commitReason({
                userId: u, resolvedEnv: ENV,
                commitmentId: 'a_pre_se', decisionId: 'd_se',
                stage: 'pre_decision',
                reasonsText: 'feeling lucky gut intuition', isReinterpretation: false, ts: 1000
            });
            M.commitReason({
                userId: u, resolvedEnv: ENV,
                commitmentId: 'a_post_se', decisionId: 'd_se',
                stage: 'post_decision',
                reasonsText: 'feeling lucky gut intuition', isReinterpretation: false, ts: 2000
            });
            M.commitReason({
                userId: u, resolvedEnv: ENV,
                commitmentId: 'a_outcome_se', decisionId: 'd_se',
                stage: 'post_outcome',
                reasonsText: 'masterful technical analysis price action confirmation volume profile institutional flow detected',
                isReinterpretation: true, ts: 3000
            });
            const r = M.recordHonestyAudit({
                userId: u, resolvedEnv: ENV,
                assessmentId: 'au_se', decisionId: 'd_se',
                outcomeFavorable: true, outcomeAvailable: true, ts: 4000
            });
            expect(r.rationalizationPattern).toBe('self_excusing_narrative');
            expect(r.honestyPenalty).toBe(0.50);
            expect(r.investigationRequired).toBe(true);
        });
        test('retrofitting_causal when unfavorable outcome + drift', () => {
            const u = UID_AUDIT;
            M.commitReason({
                userId: u, resolvedEnv: ENV,
                commitmentId: 'a_pre_rc', decisionId: 'd_rc',
                stage: 'pre_decision',
                reasonsText: 'bullish setup confirmed', isReinterpretation: false, ts: 1000
            });
            M.commitReason({
                userId: u, resolvedEnv: ENV,
                commitmentId: 'a_post_rc', decisionId: 'd_rc',
                stage: 'post_decision',
                reasonsText: 'bullish setup confirmed', isReinterpretation: false, ts: 2000
            });
            M.commitReason({
                userId: u, resolvedEnv: ENV,
                commitmentId: 'a_outcome_rc', decisionId: 'd_rc',
                stage: 'post_outcome',
                reasonsText: 'macro shock unforeseen liquidation cascade ETF outflow surprise',
                isReinterpretation: true, ts: 3000
            });
            const r = M.recordHonestyAudit({
                userId: u, resolvedEnv: ENV,
                assessmentId: 'au_rc', decisionId: 'd_rc',
                outcomeFavorable: false, outcomeAvailable: true, ts: 4000
            });
            expect(r.rationalizationPattern).toBe('retrofitting_causal');
            expect(r.honestyPenalty).toBe(0.40);
        });
        test('without post_outcome commitment → only pre_to_post_decision drift assessed', () => {
            const u = UID_AUDIT;
            M.commitReason({
                userId: u, resolvedEnv: ENV,
                commitmentId: 'a_pre_only', decisionId: 'd_only',
                stage: 'pre_decision',
                reasonsText: 'rsi divergence', isReinterpretation: false, ts: 1000
            });
            M.commitReason({
                userId: u, resolvedEnv: ENV,
                commitmentId: 'a_post_only', decisionId: 'd_only',
                stage: 'post_decision',
                reasonsText: 'rsi divergence', isReinterpretation: false, ts: 2000
            });
            // no post_outcome commitment yet
            const r = M.recordHonestyAudit({
                userId: u, resolvedEnv: ENV,
                assessmentId: 'au_only', decisionId: 'd_only',
                outcomeFavorable: false, outcomeAvailable: false, ts: 3000
            });
            expect(r.preToPostOutcomeDrift).toBe(0);
            expect(r.rationalizationPattern).toBe('none');
        });
        test('missing pre_decision commitment throws', () => {
            expect(() => M.recordHonestyAudit({
                userId: UID_AUDIT, resolvedEnv: ENV,
                assessmentId: 'au_missing', decisionId: 'd_NEVER_COMMITTED',
                outcomeFavorable: true, outcomeAvailable: true, ts: _now()
            })).toThrow(/pre_decision|not found/i);
        });
        test('duplicate assessmentId throws', () => {
            const u = UID_AUDIT;
            M.commitReason({
                userId: u, resolvedEnv: ENV,
                commitmentId: 'a_dup_pre', decisionId: 'd_dup_au',
                stage: 'pre_decision',
                reasonsText: 'r', isReinterpretation: false, ts: 1000
            });
            M.recordHonestyAudit({
                userId: u, resolvedEnv: ENV,
                assessmentId: 'au_dup', decisionId: 'd_dup_au',
                outcomeFavorable: true, outcomeAvailable: false, ts: 2000
            });
            expect(() => M.recordHonestyAudit({
                userId: u, resolvedEnv: ENV,
                assessmentId: 'au_dup', decisionId: 'd_dup_au',
                outcomeFavorable: false, outcomeAvailable: true, ts: 3000
            })).toThrow(/duplicate/);
        });
    });

    describe('getCommitmentsForDecision', () => {
        test('returns all stage commitments for decision', () => {
            const u = UID_GET;
            M.commitReason({
                userId: u, resolvedEnv: ENV,
                commitmentId: 'g_pre', decisionId: 'd_get',
                stage: 'pre_decision',
                reasonsText: 'r1', isReinterpretation: false, ts: 1000
            });
            M.commitReason({
                userId: u, resolvedEnv: ENV,
                commitmentId: 'g_post', decisionId: 'd_get',
                stage: 'post_decision',
                reasonsText: 'r2', isReinterpretation: false, ts: 2000
            });
            const r = M.getCommitmentsForDecision({
                userId: u, resolvedEnv: ENV, decisionId: 'd_get'
            });
            expect(r.length).toBe(2);
        });
        test('returns empty array when no commitments', () => {
            const r = M.getCommitmentsForDecision({
                userId: UID_GET, resolvedEnv: ENV,
                decisionId: 'd_NONE'
            });
            expect(r).toEqual([]);
        });
    });

    describe('getHonestyAudit', () => {
        test('returns latest audit for decision', () => {
            const u = UID_GET;
            M.commitReason({
                userId: u, resolvedEnv: ENV,
                commitmentId: 'h_pre', decisionId: 'd_h',
                stage: 'pre_decision', reasonsText: 'r',
                isReinterpretation: false, ts: 1000
            });
            M.recordHonestyAudit({
                userId: u, resolvedEnv: ENV,
                assessmentId: 'au_h', decisionId: 'd_h',
                outcomeFavorable: true, outcomeAvailable: false, ts: 2000
            });
            const r = M.getHonestyAudit({
                userId: u, resolvedEnv: ENV, decisionId: 'd_h'
            });
            expect(r).not.toBeNull();
            expect(r.assessmentId).toBe('au_h');
        });
        test('returns null when no audit', () => {
            expect(M.getHonestyAudit({
                userId: UID_GET, resolvedEnv: ENV,
                decisionId: 'd_NEVER'
            })).toBeNull();
        });
    });

    describe('isolation per user × env', () => {
        test('uid isolation', () => {
            M.commitReason({
                userId: UID_ISO_A, resolvedEnv: ENV,
                commitmentId: 'iso_a', decisionId: 'd_iso',
                stage: 'pre_decision', reasonsText: 'r',
                isReinterpretation: false, ts: 1000
            });
            M.commitReason({
                userId: UID_ISO_B, resolvedEnv: ENV,
                commitmentId: 'iso_b', decisionId: 'd_iso',
                stage: 'pre_decision', reasonsText: 'r',
                isReinterpretation: false, ts: 1000
            });
            const a = M.getCommitmentsForDecision({
                userId: UID_ISO_A, resolvedEnv: ENV, decisionId: 'd_iso'
            });
            expect(a.every(c => c.commitmentId !== 'iso_b')).toBe(true);
        });
        test('env isolation', () => {
            M.commitReason({
                userId: UID_ENV, resolvedEnv: 'DEMO',
                commitmentId: 'env_d', decisionId: 'd_env',
                stage: 'pre_decision', reasonsText: 'r',
                isReinterpretation: false, ts: 1000
            });
            const testnet = M.getCommitmentsForDecision({
                userId: UID_ENV, resolvedEnv: 'TESTNET',
                decisionId: 'd_env'
            });
            expect(testnet).toEqual([]);
        });
    });
});
