'use strict';

/**
 * OMEGA §143 SEMANTIC MEMORY CONSOLIDATION.
 * Canonical: /root/_review/ml_brain/ml_brain_canonic.txt line 4711.
 *
 * "fără consolidare, sistemul poate fi expert în trecut fără să devină
 *  înțelept față de viitor"
 */

const path = require('path');
const fs = require('fs');
const os = require('os');

const TEST_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-w3-p143-'));
const TEST_DB_PATH = path.join(TEST_DB_DIR, 'test.db');
process.env.ZEUS_DB_PATH = TEST_DB_PATH;
process.env.ZEUS_TEST_DISABLE_AUTH = '1';

const { db } = require('../../../server/services/database');
const M = require('../../../server/services/ml/_meta/semanticMemoryConsolidation');

const UID = 9143;
const UID_PRIN = 9243;
const UID_TRANS = 9343;
const UID_HIST = 9443;
const UID_ISO_A = 9543;
const UID_ISO_B = 9643;
const UID_ENV = 9743;
const ENV = 'DEMO';
const _now = () => Date.now();

function cleanRows() {
    const uids = [UID, UID_PRIN, UID_TRANS, UID_HIST,
                  UID_ISO_A, UID_ISO_B, UID_ENV];
    const placeholders = uids.map(() => '?').join(',');
    db.prepare(`DELETE FROM ml_consolidated_principles WHERE user_id IN (${placeholders})`).run(...uids);
    db.prepare(`DELETE FROM ml_consolidation_sessions WHERE user_id IN (${placeholders})`).run(...uids);
}
beforeEach(() => cleanRows());
afterAll(() => cleanRows());

describe('OMEGA §143 SEMANTIC MEMORY CONSOLIDATION', () => {

    describe('Migrations 284+285', () => {
        test('284 applied', () => {
            expect(db.prepare("SELECT name FROM _migrations WHERE name=?").get('284_ml_consolidation_sessions')).toBeTruthy();
        });
        test('285 applied', () => {
            expect(db.prepare("SELECT name FROM _migrations WHERE name=?").get('285_ml_consolidated_principles')).toBeTruthy();
        });
        test('trigger_kind CHECK enum', () => {
            expect(() => db.prepare(`INSERT INTO ml_consolidation_sessions
                (user_id, resolved_env, session_id, trigger_kind, session_status,
                 episodes_examined_count, clusters_formed_count,
                 principles_extracted_count, principles_promoted_count,
                 principles_rejected_count, ts)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
                .run(UID, ENV, 's_bk', 'BOGUS', 'open',
                    0, 0, 0, 0, 0, _now())).toThrow();
        });
        test('principle status CHECK enum', () => {
            const stmt = db.prepare(`INSERT INTO ml_consolidation_sessions
                (user_id, resolved_env, session_id, trigger_kind, session_status,
                 episodes_examined_count, clusters_formed_count,
                 principles_extracted_count, principles_promoted_count,
                 principles_rejected_count, ts)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
            stmt.run(UID, ENV, 's_for_p', 'manual', 'open',
                0, 0, 0, 0, 0, _now());
            expect(() => db.prepare(`INSERT INTO ml_consolidated_principles
                (user_id, resolved_env, principle_id, session_id, principle_text,
                 source_episode_ids_json, generalizability_score,
                 testability_score, transferability_score,
                 overall_quality_score, status, ts)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
                .run(UID, ENV, 'p_bk', 's_for_p', 't', '[]',
                    0.5, 0.5, 0.5, 0.5, 'BOGUS', _now())).toThrow();
        });
        test('FK principle.session_id → session.session_id', () => {
            expect(() => db.prepare(`INSERT INTO ml_consolidated_principles
                (user_id, resolved_env, principle_id, session_id, principle_text,
                 source_episode_ids_json, generalizability_score,
                 testability_score, transferability_score,
                 overall_quality_score, status, ts)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
                .run(UID, ENV, 'p_orphan', 'NONEXISTENT', 't', '[]',
                    0.5, 0.5, 0.5, 0.5, 'extracted', _now())).toThrow(/FOREIGN KEY/i);
        });
        test('score range', () => {
            const stmt = db.prepare(`INSERT INTO ml_consolidation_sessions
                (user_id, resolved_env, session_id, trigger_kind, session_status,
                 episodes_examined_count, clusters_formed_count,
                 principles_extracted_count, principles_promoted_count,
                 principles_rejected_count, ts)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
            stmt.run(UID, ENV, 's_for_p2', 'manual', 'open',
                0, 0, 0, 0, 0, _now());
            expect(() => db.prepare(`INSERT INTO ml_consolidated_principles
                (user_id, resolved_env, principle_id, session_id, principle_text,
                 source_episode_ids_json, generalizability_score,
                 testability_score, transferability_score,
                 overall_quality_score, status, ts)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
                .run(UID, ENV, 'p_bs', 's_for_p2', 't', '[]',
                    1.5, 0.5, 0.5, 0.5, 'extracted', _now())).toThrow();
        });
    });

    describe('Constants', () => {
        test('TRIGGER_KINDS frozen 3', () => {
            expect(M.TRIGGER_KINDS).toEqual([
                'scheduled', 'episode_threshold', 'manual'
            ]);
            expect(Object.isFrozen(M.TRIGGER_KINDS)).toBe(true);
        });
        test('PRINCIPLE_STATUSES frozen 4', () => {
            expect(M.PRINCIPLE_STATUSES).toEqual([
                'extracted', 'tested', 'promoted', 'rejected'
            ]);
            expect(Object.isFrozen(M.PRINCIPLE_STATUSES)).toBe(true);
        });
        test('SESSION_STATUSES frozen 2', () => {
            expect(M.SESSION_STATUSES).toEqual(['open', 'closed']);
            expect(Object.isFrozen(M.SESSION_STATUSES)).toBe(true);
        });
        test('QUALITY_THRESHOLDS ordered', () => {
            expect(M.QUALITY_THRESHOLDS.promote).toBe(0.70);
            expect(M.QUALITY_THRESHOLDS.reject).toBe(0.30);
            expect(M.QUALITY_THRESHOLDS.reject).toBeLessThan(M.QUALITY_THRESHOLDS.promote);
        });
        test('QUALITY_WEIGHTS sum 1.0', () => {
            const sum = Object.values(M.QUALITY_WEIGHTS).reduce((a,b)=>a+b,0);
            expect(sum).toBeCloseTo(1.0, 6);
        });
        test('QUALITY_WEIGHTS: generalizability heaviest', () => {
            expect(M.QUALITY_WEIGHTS.generalizability).toBe(0.40);
        });
        test('MIN_EPISODES_FOR_CLUSTER = 5', () => {
            expect(M.MIN_EPISODES_FOR_CLUSTER).toBe(5);
        });
        test('VALID_PRINCIPLE_TRANSITIONS DAG', () => {
            expect(M.VALID_PRINCIPLE_TRANSITIONS.extracted).toContain('tested');
            expect(M.VALID_PRINCIPLE_TRANSITIONS.extracted).toContain('promoted');
            expect(M.VALID_PRINCIPLE_TRANSITIONS.extracted).toContain('rejected');
            expect(M.VALID_PRINCIPLE_TRANSITIONS.tested).toContain('promoted');
            expect(M.VALID_PRINCIPLE_TRANSITIONS.tested).toContain('rejected');
            expect(M.VALID_PRINCIPLE_TRANSITIONS.promoted).toEqual([]);
            expect(M.VALID_PRINCIPLE_TRANSITIONS.rejected).toEqual([]);
        });
    });

    describe('computeOverallQuality (pure)', () => {
        test('all-high → high', () => {
            const r = M.computeOverallQuality({
                generalizability: 0.9, testability: 0.9, transferability: 0.9
            });
            expect(r.qualityScore).toBeCloseTo(0.9, 6);
        });
        test('all-low → low', () => {
            const r = M.computeOverallQuality({
                generalizability: 0.1, testability: 0.1, transferability: 0.1
            });
            expect(r.qualityScore).toBeCloseTo(0.1, 6);
        });
        test('mixed weighting (gen heaviest)', () => {
            // gen 1.0 × 0.4 + test 0 × 0.3 + transf 0 × 0.3 = 0.4
            const r = M.computeOverallQuality({
                generalizability: 1.0, testability: 0, transferability: 0
            });
            expect(r.qualityScore).toBeCloseTo(0.4, 6);
        });
        test('out-of-range throws', () => {
            expect(() => M.computeOverallQuality({
                generalizability: 1.5, testability: 0.5, transferability: 0.5
            })).toThrow();
        });
        test('missing input throws', () => {
            expect(() => M.computeOverallQuality({
                generalizability: 0.5, testability: 0.5
                // transferability missing
            })).toThrow();
        });
    });

    describe('classifyPrincipleQuality (pure)', () => {
        test('≥0.70 → promoted candidate', () => {
            expect(M.classifyPrincipleQuality({ qualityScore: 0.85 }).candidate).toBe('promoted');
        });
        test('<0.30 → rejected candidate', () => {
            expect(M.classifyPrincipleQuality({ qualityScore: 0.20 }).candidate).toBe('rejected');
        });
        test('0.30-0.70 → tested candidate (need empirical validation)', () => {
            expect(M.classifyPrincipleQuality({ qualityScore: 0.55 }).candidate).toBe('tested');
        });
        test('boundary 0.70', () => {
            expect(M.classifyPrincipleQuality({ qualityScore: 0.70 }).candidate).toBe('promoted');
        });
        test('boundary 0.30', () => {
            expect(M.classifyPrincipleQuality({ qualityScore: 0.30 }).candidate).toBe('tested');
        });
    });

    describe('assessClusterFormability (pure)', () => {
        test('≥5 episodes → formable', () => {
            expect(M.assessClusterFormability({ episodeCount: 5 }).formable).toBe(true);
            expect(M.assessClusterFormability({ episodeCount: 10 }).formable).toBe(true);
        });
        test('<5 episodes → not formable', () => {
            expect(M.assessClusterFormability({ episodeCount: 4 }).formable).toBe(false);
            expect(M.assessClusterFormability({ episodeCount: 0 }).formable).toBe(false);
        });
    });

    describe('isValidPrincipleTransition (pure)', () => {
        test('extracted → tested ok', () => {
            expect(M.isValidPrincipleTransition({
                fromStatus: 'extracted', toStatus: 'tested'
            }).valid).toBe(true);
        });
        test('extracted → promoted ok (high quality direct promotion)', () => {
            expect(M.isValidPrincipleTransition({
                fromStatus: 'extracted', toStatus: 'promoted'
            }).valid).toBe(true);
        });
        test('tested → promoted ok', () => {
            expect(M.isValidPrincipleTransition({
                fromStatus: 'tested', toStatus: 'promoted'
            }).valid).toBe(true);
        });
        test('tested → rejected ok', () => {
            expect(M.isValidPrincipleTransition({
                fromStatus: 'tested', toStatus: 'rejected'
            }).valid).toBe(true);
        });
        test('promoted terminal', () => {
            expect(M.isValidPrincipleTransition({
                fromStatus: 'promoted', toStatus: 'tested'
            }).valid).toBe(false);
        });
        test('rejected terminal', () => {
            expect(M.isValidPrincipleTransition({
                fromStatus: 'rejected', toStatus: 'extracted'
            }).valid).toBe(false);
        });
        test('invalid status throws', () => {
            expect(() => M.isValidPrincipleTransition({
                fromStatus: 'BOGUS', toStatus: 'tested'
            })).toThrow();
        });
    });

    describe('startConsolidationSession', () => {
        test('persists open session', () => {
            const r = M.startConsolidationSession({
                userId: UID, resolvedEnv: ENV,
                sessionId: 's_start', triggerKind: 'scheduled',
                ts: _now()
            });
            expect(r.started).toBe(true);
            expect(r.sessionStatus).toBe('open');
        });
        test('duplicate sessionId throws', () => {
            M.startConsolidationSession({
                userId: UID, resolvedEnv: ENV,
                sessionId: 's_dup', triggerKind: 'manual', ts: _now()
            });
            expect(() => M.startConsolidationSession({
                userId: UID, resolvedEnv: ENV,
                sessionId: 's_dup', triggerKind: 'scheduled', ts: _now()
            })).toThrow(/duplicate/);
        });
        test('invalid triggerKind throws', () => {
            expect(() => M.startConsolidationSession({
                userId: UID, resolvedEnv: ENV,
                sessionId: 's_bad', triggerKind: 'BOGUS', ts: _now()
            })).toThrow();
        });
    });

    describe('recordExtractedPrinciple (integration)', () => {
        test('high quality → status=promoted candidate', () => {
            M.startConsolidationSession({
                userId: UID_PRIN, resolvedEnv: ENV,
                sessionId: 's_hq', triggerKind: 'manual', ts: 1000
            });
            const r = M.recordExtractedPrinciple({
                userId: UID_PRIN, resolvedEnv: ENV,
                principleId: 'p_hq', sessionId: 's_hq',
                principleText: 'authentic sweep distinguished from fake by volume distribution in first 3sec',
                sourceEpisodeIds: ['ep1', 'ep2', 'ep3', 'ep4', 'ep5'],
                generalizability: 0.85,
                testability: 0.80,
                transferability: 0.75,
                ts: 2000
            });
            expect(r.recorded).toBe(true);
            expect(r.qualityScore).toBeGreaterThan(0.70);
            expect(r.status).toBe('extracted');  // initial status; promotion is separate transition
        });
        test('orphan session FK rejected', () => {
            expect(() => M.recordExtractedPrinciple({
                userId: UID_PRIN, resolvedEnv: ENV,
                principleId: 'p_orphan', sessionId: 'NONEXISTENT',
                principleText: 't',
                sourceEpisodeIds: ['ep1', 'ep2', 'ep3', 'ep4', 'ep5'],
                generalizability: 0.5, testability: 0.5, transferability: 0.5,
                ts: _now()
            })).toThrow(/FOREIGN KEY|not found/i);
        });
        test('duplicate principleId throws', () => {
            M.startConsolidationSession({
                userId: UID_PRIN, resolvedEnv: ENV,
                sessionId: 's_dup_p', triggerKind: 'manual', ts: 1000
            });
            M.recordExtractedPrinciple({
                userId: UID_PRIN, resolvedEnv: ENV,
                principleId: 'p_dup', sessionId: 's_dup_p',
                principleText: 't',
                sourceEpisodeIds: ['ep1', 'ep2', 'ep3', 'ep4', 'ep5'],
                generalizability: 0.5, testability: 0.5, transferability: 0.5,
                ts: 2000
            });
            expect(() => M.recordExtractedPrinciple({
                userId: UID_PRIN, resolvedEnv: ENV,
                principleId: 'p_dup', sessionId: 's_dup_p',
                principleText: 't2',
                sourceEpisodeIds: ['ep1', 'ep2', 'ep3', 'ep4', 'ep5'],
                generalizability: 0.6, testability: 0.6, transferability: 0.6,
                ts: 3000
            })).toThrow(/duplicate/);
        });
        test('insufficient source episodes throws', () => {
            M.startConsolidationSession({
                userId: UID_PRIN, resolvedEnv: ENV,
                sessionId: 's_too_few', triggerKind: 'manual', ts: 1000
            });
            expect(() => M.recordExtractedPrinciple({
                userId: UID_PRIN, resolvedEnv: ENV,
                principleId: 'p_few', sessionId: 's_too_few',
                principleText: 't',
                sourceEpisodeIds: ['ep1', 'ep2'],  // only 2, need 5
                generalizability: 0.5, testability: 0.5, transferability: 0.5,
                ts: 2000
            })).toThrow(/MIN_EPISODES|insufficient/i);
        });
        test('out-of-range score throws', () => {
            M.startConsolidationSession({
                userId: UID_PRIN, resolvedEnv: ENV,
                sessionId: 's_bs', triggerKind: 'manual', ts: 1000
            });
            expect(() => M.recordExtractedPrinciple({
                userId: UID_PRIN, resolvedEnv: ENV,
                principleId: 'p_bs', sessionId: 's_bs',
                principleText: 't',
                sourceEpisodeIds: ['ep1', 'ep2', 'ep3', 'ep4', 'ep5'],
                generalizability: 1.5, testability: 0.5, transferability: 0.5,
                ts: 2000
            })).toThrow();
        });
    });

    describe('transitionPrincipleStatus', () => {
        test('extracted → tested ok', () => {
            M.startConsolidationSession({
                userId: UID_TRANS, resolvedEnv: ENV,
                sessionId: 's_tr', triggerKind: 'manual', ts: 1000
            });
            M.recordExtractedPrinciple({
                userId: UID_TRANS, resolvedEnv: ENV,
                principleId: 'p_tr1', sessionId: 's_tr',
                principleText: 't',
                sourceEpisodeIds: ['ep1', 'ep2', 'ep3', 'ep4', 'ep5'],
                generalizability: 0.55, testability: 0.55, transferability: 0.55,
                ts: 2000
            });
            const r = M.transitionPrincipleStatus({
                userId: UID_TRANS, resolvedEnv: ENV,
                principleId: 'p_tr1', newStatus: 'tested',
                reason: 'needs empirical validation', ts: 3000
            });
            expect(r.transitioned).toBe(true);
            expect(r.newStatus).toBe('tested');
        });
        test('tested → promoted ok', () => {
            M.startConsolidationSession({
                userId: UID_TRANS, resolvedEnv: ENV,
                sessionId: 's_tr2', triggerKind: 'manual', ts: 1000
            });
            M.recordExtractedPrinciple({
                userId: UID_TRANS, resolvedEnv: ENV,
                principleId: 'p_tr2', sessionId: 's_tr2',
                principleText: 't',
                sourceEpisodeIds: ['ep1', 'ep2', 'ep3', 'ep4', 'ep5'],
                generalizability: 0.55, testability: 0.55, transferability: 0.55,
                ts: 2000
            });
            M.transitionPrincipleStatus({
                userId: UID_TRANS, resolvedEnv: ENV,
                principleId: 'p_tr2', newStatus: 'tested',
                reason: 'r', ts: 3000
            });
            const r = M.transitionPrincipleStatus({
                userId: UID_TRANS, resolvedEnv: ENV,
                principleId: 'p_tr2', newStatus: 'promoted',
                reason: 'validated', ts: 4000
            });
            expect(r.transitioned).toBe(true);
        });
        test('terminal blocked', () => {
            M.startConsolidationSession({
                userId: UID_TRANS, resolvedEnv: ENV,
                sessionId: 's_term', triggerKind: 'manual', ts: 1000
            });
            M.recordExtractedPrinciple({
                userId: UID_TRANS, resolvedEnv: ENV,
                principleId: 'p_term', sessionId: 's_term',
                principleText: 't',
                sourceEpisodeIds: ['ep1', 'ep2', 'ep3', 'ep4', 'ep5'],
                generalizability: 0.5, testability: 0.5, transferability: 0.5,
                ts: 2000
            });
            M.transitionPrincipleStatus({
                userId: UID_TRANS, resolvedEnv: ENV,
                principleId: 'p_term', newStatus: 'rejected',
                reason: 'r', ts: 3000
            });
            expect(() => M.transitionPrincipleStatus({
                userId: UID_TRANS, resolvedEnv: ENV,
                principleId: 'p_term', newStatus: 'promoted',
                reason: 'r2', ts: 4000
            })).toThrow(/invalid transition|terminal/i);
        });
        test('missing principle throws', () => {
            expect(() => M.transitionPrincipleStatus({
                userId: UID_TRANS, resolvedEnv: ENV,
                principleId: 'NONEXISTENT', newStatus: 'tested',
                reason: 'r', ts: _now()
            })).toThrow(/not found/);
        });
    });

    describe('closeSession', () => {
        test('updates session aggregates + closes', () => {
            M.startConsolidationSession({
                userId: UID, resolvedEnv: ENV,
                sessionId: 's_close', triggerKind: 'scheduled', ts: 1000
            });
            const r = M.closeSession({
                userId: UID, resolvedEnv: ENV,
                sessionId: 's_close',
                aggregates: {
                    episodesExaminedCount: 50,
                    clustersFormedCount: 10,
                    principlesExtractedCount: 3,
                    principlesPromotedCount: 1,
                    principlesRejectedCount: 1
                },
                ts: 5000
            });
            expect(r.closed).toBe(true);
            const s = db.prepare("SELECT session_status, episodes_examined_count FROM ml_consolidation_sessions WHERE session_id=?").get('s_close');
            expect(s.session_status).toBe('closed');
            expect(s.episodes_examined_count).toBe(50);
        });
        test('missing session throws', () => {
            expect(() => M.closeSession({
                userId: UID, resolvedEnv: ENV,
                sessionId: 'NONEXISTENT',
                aggregates: {
                    episodesExaminedCount: 0, clustersFormedCount: 0,
                    principlesExtractedCount: 0, principlesPromotedCount: 0,
                    principlesRejectedCount: 0
                },
                ts: _now()
            })).toThrow(/not found/);
        });
    });

    describe('getSessionHistory', () => {
        test('returns DESC by ts', () => {
            const u = UID_HIST;
            for (let i = 0; i < 3; i++) {
                M.startConsolidationSession({
                    userId: u, resolvedEnv: ENV,
                    sessionId: `s_h_${i}`, triggerKind: 'scheduled',
                    ts: 1000 + i * 100
                });
            }
            const rows = M.getSessionHistory({
                userId: u, resolvedEnv: ENV, limit: 10
            });
            expect(rows.length).toBe(3);
            expect(rows[0].sessionId).toBe('s_h_2');
        });
    });

    describe('getPromotedPrinciples', () => {
        test('filter by promoted status', () => {
            const u = UID_HIST;
            M.startConsolidationSession({
                userId: u, resolvedEnv: ENV,
                sessionId: 's_pp', triggerKind: 'manual', ts: 1000
            });
            M.recordExtractedPrinciple({
                userId: u, resolvedEnv: ENV,
                principleId: 'p_promoted', sessionId: 's_pp',
                principleText: 'promoted principle',
                sourceEpisodeIds: ['ep1', 'ep2', 'ep3', 'ep4', 'ep5'],
                generalizability: 0.85, testability: 0.85, transferability: 0.85,
                ts: 2000
            });
            M.transitionPrincipleStatus({
                userId: u, resolvedEnv: ENV,
                principleId: 'p_promoted', newStatus: 'promoted',
                reason: 'high quality', ts: 3000
            });
            M.recordExtractedPrinciple({
                userId: u, resolvedEnv: ENV,
                principleId: 'p_extracted', sessionId: 's_pp',
                principleText: 'still extracted',
                sourceEpisodeIds: ['ep1', 'ep2', 'ep3', 'ep4', 'ep5'],
                generalizability: 0.5, testability: 0.5, transferability: 0.5,
                ts: 4000
            });
            const promoted = M.getPromotedPrinciples({
                userId: u, resolvedEnv: ENV, limit: 10
            });
            expect(promoted.length).toBe(1);
            expect(promoted[0].principleId).toBe('p_promoted');
        });
    });

    describe('isolation per user × env', () => {
        test('uid', () => {
            M.startConsolidationSession({
                userId: UID_ISO_A, resolvedEnv: ENV,
                sessionId: 'iso_a', triggerKind: 'manual', ts: 1000
            });
            M.startConsolidationSession({
                userId: UID_ISO_B, resolvedEnv: ENV,
                sessionId: 'iso_b', triggerKind: 'manual', ts: 1000
            });
            const rows = M.getSessionHistory({
                userId: UID_ISO_A, resolvedEnv: ENV, limit: 10
            });
            expect(rows.every(r => r.sessionId !== 'iso_b')).toBe(true);
        });
        test('env', () => {
            M.startConsolidationSession({
                userId: UID_ENV, resolvedEnv: 'DEMO',
                sessionId: 'env_d', triggerKind: 'manual', ts: 1000
            });
            M.startConsolidationSession({
                userId: UID_ENV, resolvedEnv: 'TESTNET',
                sessionId: 'env_t', triggerKind: 'manual', ts: 1000
            });
            const demo = M.getSessionHistory({
                userId: UID_ENV, resolvedEnv: 'DEMO', limit: 10
            });
            expect(demo.every(r => r.sessionId !== 'env_t')).toBe(true);
        });
    });
});
