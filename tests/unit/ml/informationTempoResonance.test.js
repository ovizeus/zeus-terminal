'use strict';

/**
 * OMEGA §145 INFORMATION TEMPO RESONANCE.
 * Canonical: /root/_review/ml_brain/ml_brain_canonic.txt line 4715.
 *
 * "fiecare semnal are un ritm natural, și deciziile luate în contra
 *  ritmului sunt mai slabe"
 */

const path = require('path');
const fs = require('fs');
const os = require('os');

const TEST_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-w3-p145-'));
const TEST_DB_PATH = path.join(TEST_DB_DIR, 'test.db');
process.env.ZEUS_DB_PATH = TEST_DB_PATH;
process.env.ZEUS_TEST_DISABLE_AUTH = '1';

const { db } = require('../../../server/services/database');
const M = require('../../../server/services/ml/_meta/informationTempoResonance');

const UID = 9145;
const UID_REG = 9245;
const UID_ASS = 9345;
const UID_GET = 9445;
const UID_DESYNC = 9545;
const UID_ISO_A = 9645;
const UID_ISO_B = 9745;
const UID_ENV = 9845;
const ENV = 'DEMO';
const _now = () => Date.now();

function cleanRows() {
    const uids = [UID, UID_REG, UID_ASS, UID_GET, UID_DESYNC,
                  UID_ISO_A, UID_ISO_B, UID_ENV];
    const placeholders = uids.map(() => '?').join(',');
    db.prepare(`DELETE FROM ml_signal_tempos WHERE user_id IN (${placeholders})`).run(...uids);
    db.prepare(`DELETE FROM ml_decision_tempo_assessments WHERE user_id IN (${placeholders})`).run(...uids);
}
beforeEach(() => cleanRows());
afterAll(() => cleanRows());

describe('OMEGA §145 INFORMATION TEMPO RESONANCE', () => {

    describe('Migrations 288+289', () => {
        test('288 applied', () => {
            expect(db.prepare("SELECT name FROM _migrations WHERE name=?").get('288_ml_signal_tempos')).toBeTruthy();
        });
        test('289 applied', () => {
            expect(db.prepare("SELECT name FROM _migrations WHERE name=?").get('289_ml_decision_tempo_assessments')).toBeTruthy();
        });
        test('signal_category CHECK enum', () => {
            expect(() => db.prepare(`INSERT INTO ml_signal_tempos
                (user_id, resolved_env, tempo_id, signal_kind, signal_category,
                 natural_period_ms, period_tolerance_pct, active, ts)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
                .run(UID, ENV, 't_bk', 'rsi', 'BOGUS',
                    1000, 0.2, 1, _now())).toThrow();
        });
        test('desync_severity CHECK enum', () => {
            expect(() => db.prepare(`INSERT INTO ml_decision_tempo_assessments
                (user_id, resolved_env, assessment_id, decision_id,
                 decision_horizon_ms, contributing_signals_json,
                 mean_signal_period_ms, resonance_score, desync_severity,
                 decision_quality_penalty, ts)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
                .run(UID, ENV, 'a_bk', 'd1', 1000, '[]',
                    1000, 0.5, 'BOGUS', 0.2, _now())).toThrow();
        });
        test('natural_period_ms > 0', () => {
            expect(() => db.prepare(`INSERT INTO ml_signal_tempos
                (user_id, resolved_env, tempo_id, signal_kind, signal_category,
                 natural_period_ms, period_tolerance_pct, active, ts)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
                .run(UID, ENV, 't_bp', 'rsi', 'flow',
                    0, 0.2, 1, _now())).toThrow();
        });
        test('composite UNIQUE (user × env × signal_kind)', () => {
            const stmt = db.prepare(`INSERT INTO ml_signal_tempos
                (user_id, resolved_env, tempo_id, signal_kind, signal_category,
                 natural_period_ms, period_tolerance_pct, active, ts)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
            stmt.run(UID, ENV, 't_dup1', 'rsi', 'flow',
                30000, 0.2, 1, _now());
            expect(() => stmt.run(UID, ENV, 't_dup2', 'rsi', 'structural',
                3600000, 0.2, 1, _now())).toThrow();
        });
    });

    describe('Constants', () => {
        test('SIGNAL_CATEGORIES frozen 4', () => {
            expect(M.SIGNAL_CATEGORIES).toEqual([
                'microstructure', 'flow', 'structural', 'macro'
            ]);
            expect(Object.isFrozen(M.SIGNAL_CATEGORIES)).toBe(true);
        });
        test('DEFAULT_NATURAL_PERIODS_MS ascending by category', () => {
            expect(M.DEFAULT_NATURAL_PERIODS_MS.microstructure).toBe(1000);
            expect(M.DEFAULT_NATURAL_PERIODS_MS.flow).toBe(30000);
            expect(M.DEFAULT_NATURAL_PERIODS_MS.structural).toBe(3600000);
            expect(M.DEFAULT_NATURAL_PERIODS_MS.macro).toBe(28800000);
        });
        test('DESYNC_SEVERITY_LEVELS frozen 3', () => {
            expect(M.DESYNC_SEVERITY_LEVELS).toEqual([
                'in_sync', 'mild_desync', 'severe_desync'
            ]);
            expect(Object.isFrozen(M.DESYNC_SEVERITY_LEVELS)).toBe(true);
        });
        test('RESONANCE_THRESHOLDS ordered', () => {
            expect(M.RESONANCE_THRESHOLDS.in_sync).toBe(0.70);
            expect(M.RESONANCE_THRESHOLDS.mild).toBe(0.30);
        });
        test('PENALTY_MAP', () => {
            expect(M.PENALTY_MAP.in_sync).toBe(0);
            expect(M.PENALTY_MAP.mild_desync).toBe(0.20);
            expect(M.PENALTY_MAP.severe_desync).toBe(0.50);
        });
    });

    describe('computeResonance (pure)', () => {
        test('perfect match → 1.0', () => {
            expect(M.computeResonance({
                decisionHorizonMs: 1000, signalPeriodMs: 1000
            }).resonance).toBe(1.0);
        });
        test('2× difference → 0.5', () => {
            expect(M.computeResonance({
                decisionHorizonMs: 1000, signalPeriodMs: 2000
            }).resonance).toBe(0.5);
        });
        test('10× difference → 0.1', () => {
            expect(M.computeResonance({
                decisionHorizonMs: 1000, signalPeriodMs: 10000
            }).resonance).toBe(0.1);
        });
        test('100× difference → 0.01', () => {
            expect(M.computeResonance({
                decisionHorizonMs: 60000, signalPeriodMs: 6000000
            }).resonance).toBeCloseTo(0.01, 4);
        });
        test('order symmetric (min/max)', () => {
            const r1 = M.computeResonance({
                decisionHorizonMs: 1000, signalPeriodMs: 5000
            });
            const r2 = M.computeResonance({
                decisionHorizonMs: 5000, signalPeriodMs: 1000
            });
            expect(r1.resonance).toBe(r2.resonance);
        });
        test('zero periods throw', () => {
            expect(() => M.computeResonance({
                decisionHorizonMs: 0, signalPeriodMs: 1000
            })).toThrow();
            expect(() => M.computeResonance({
                decisionHorizonMs: 1000, signalPeriodMs: 0
            })).toThrow();
        });
    });

    describe('computeMeanSignalPeriod (pure)', () => {
        test('single signal → its period', () => {
            const r = M.computeMeanSignalPeriod({
                contributingSignals: [{ signalKind: 'rsi', weight: 1.0 }],
                periodLookup: { rsi: 5000 }
            });
            expect(r.meanPeriodMs).toBe(5000);
        });
        test('equal weights → simple average', () => {
            const r = M.computeMeanSignalPeriod({
                contributingSignals: [
                    { signalKind: 'a', weight: 1.0 },
                    { signalKind: 'b', weight: 1.0 }
                ],
                periodLookup: { a: 1000, b: 5000 }
            });
            expect(r.meanPeriodMs).toBe(3000);
        });
        test('weighted bias toward heavy weight', () => {
            // a × 0.1 + b × 0.9 → b dominates
            const r = M.computeMeanSignalPeriod({
                contributingSignals: [
                    { signalKind: 'a', weight: 0.1 },
                    { signalKind: 'b', weight: 0.9 }
                ],
                periodLookup: { a: 1000, b: 10000 }
            });
            // (1000 × 0.1 + 10000 × 0.9) / (0.1 + 0.9) = (100 + 9000) / 1.0 = 9100
            expect(r.meanPeriodMs).toBeCloseTo(9100, 1);
        });
        test('missing signal in lookup throws', () => {
            expect(() => M.computeMeanSignalPeriod({
                contributingSignals: [{ signalKind: 'unknown', weight: 1.0 }],
                periodLookup: {}
            })).toThrow(/missing|unknown/i);
        });
        test('empty signals throws', () => {
            expect(() => M.computeMeanSignalPeriod({
                contributingSignals: [],
                periodLookup: {}
            })).toThrow();
        });
    });

    describe('classifyDesyncSeverity (pure)', () => {
        test('≥0.70 → in_sync', () => {
            expect(M.classifyDesyncSeverity({ resonanceScore: 0.85 }).severity).toBe('in_sync');
        });
        test('0.30-0.70 → mild_desync', () => {
            expect(M.classifyDesyncSeverity({ resonanceScore: 0.50 }).severity).toBe('mild_desync');
        });
        test('<0.30 → severe_desync', () => {
            expect(M.classifyDesyncSeverity({ resonanceScore: 0.10 }).severity).toBe('severe_desync');
        });
        test('boundary 0.70 → in_sync', () => {
            expect(M.classifyDesyncSeverity({ resonanceScore: 0.70 }).severity).toBe('in_sync');
        });
        test('boundary 0.30 → mild_desync', () => {
            expect(M.classifyDesyncSeverity({ resonanceScore: 0.30 }).severity).toBe('mild_desync');
        });
    });

    describe('computeQualityPenalty (pure)', () => {
        test('in_sync → 0', () => {
            expect(M.computeQualityPenalty({ desyncSeverity: 'in_sync' }).penalty).toBe(0);
        });
        test('mild_desync → 0.20', () => {
            expect(M.computeQualityPenalty({ desyncSeverity: 'mild_desync' }).penalty).toBe(0.20);
        });
        test('severe_desync → 0.50', () => {
            expect(M.computeQualityPenalty({ desyncSeverity: 'severe_desync' }).penalty).toBe(0.50);
        });
        test('invalid throws', () => {
            expect(() => M.computeQualityPenalty({ desyncSeverity: 'BOGUS' })).toThrow();
        });
    });

    describe('registerSignalTempo', () => {
        test('persists tempo', () => {
            const r = M.registerSignalTempo({
                userId: UID_REG, resolvedEnv: ENV,
                signalKind: 'rsi_4h', signalCategory: 'structural',
                naturalPeriodMs: 3600000,
                periodTolerancePct: 0.20, ts: _now()
            });
            expect(r.registered).toBe(true);
        });
        test('UPSERT same signal_kind', () => {
            M.registerSignalTempo({
                userId: UID_REG, resolvedEnv: ENV,
                signalKind: 'rsi_4h', signalCategory: 'structural',
                naturalPeriodMs: 3600000,
                periodTolerancePct: 0.20, ts: 1000
            });
            // Re-register same kind with different period
            const r2 = M.registerSignalTempo({
                userId: UID_REG, resolvedEnv: ENV,
                signalKind: 'rsi_4h', signalCategory: 'structural',
                naturalPeriodMs: 7200000,  // changed
                periodTolerancePct: 0.30, ts: 2000
            });
            expect(r2.registered).toBe(true);
            const fetched = M.getSignalTempo({
                userId: UID_REG, resolvedEnv: ENV, signalKind: 'rsi_4h'
            });
            expect(fetched.naturalPeriodMs).toBe(7200000);
            // Single row check
            const rows = db.prepare("SELECT COUNT(*) AS c FROM ml_signal_tempos WHERE user_id=? AND signal_kind=?")
                .get(UID_REG, 'rsi_4h');
            expect(rows.c).toBe(1);
        });
        test('invalid signalCategory throws', () => {
            expect(() => M.registerSignalTempo({
                userId: UID_REG, resolvedEnv: ENV,
                signalKind: 'bad', signalCategory: 'BOGUS',
                naturalPeriodMs: 1000,
                periodTolerancePct: 0.2, ts: _now()
            })).toThrow(/invalid signalCategory/);
        });
        test('zero naturalPeriodMs throws', () => {
            expect(() => M.registerSignalTempo({
                userId: UID_REG, resolvedEnv: ENV,
                signalKind: 'zp', signalCategory: 'flow',
                naturalPeriodMs: 0,
                periodTolerancePct: 0.2, ts: _now()
            })).toThrow();
        });
    });

    describe('getSignalTempo', () => {
        test('returns registered tempo', () => {
            M.registerSignalTempo({
                userId: UID_GET, resolvedEnv: ENV,
                signalKind: 'g_rsi', signalCategory: 'flow',
                naturalPeriodMs: 30000,
                periodTolerancePct: 0.2, ts: _now()
            });
            const r = M.getSignalTempo({
                userId: UID_GET, resolvedEnv: ENV,
                signalKind: 'g_rsi'
            });
            expect(r).not.toBeNull();
            expect(r.naturalPeriodMs).toBe(30000);
            expect(r.signalCategory).toBe('flow');
        });
        test('returns null when no entry', () => {
            const r = M.getSignalTempo({
                userId: UID_GET, resolvedEnv: ENV,
                signalKind: 'NONEXISTENT'
            });
            expect(r).toBeNull();
        });
    });

    describe('recordDecisionTempoAssessment (integration)', () => {
        test('scalp + microstructure signals → in_sync', () => {
            const u = UID_ASS;
            // Register tempos
            M.registerSignalTempo({
                userId: u, resolvedEnv: ENV,
                signalKind: 'orderbook_imb', signalCategory: 'microstructure',
                naturalPeriodMs: 1000, periodTolerancePct: 0.2,
                ts: 1000
            });
            M.registerSignalTempo({
                userId: u, resolvedEnv: ENV,
                signalKind: 'tick_velocity', signalCategory: 'microstructure',
                naturalPeriodMs: 1500, periodTolerancePct: 0.2,
                ts: 1001
            });
            const r = M.recordDecisionTempoAssessment({
                userId: u, resolvedEnv: ENV,
                assessmentId: 'a_scalp_micro',
                decisionId: 'd_scalp',
                decisionHorizonMs: 1200,  // 1.2s scalp horizon
                contributingSignals: [
                    { signalKind: 'orderbook_imb', weight: 0.6 },
                    { signalKind: 'tick_velocity', weight: 0.4 }
                ],
                ts: 2000
            });
            expect(r.recorded).toBe(true);
            expect(r.desyncSeverity).toBe('in_sync');
            expect(r.decisionQualityPenalty).toBe(0);
        });
        test('scalp + structural signal → severe_desync (1.2s vs 1h)', () => {
            const u = UID_ASS;
            M.registerSignalTempo({
                userId: u, resolvedEnv: ENV,
                signalKind: 'h4_sr', signalCategory: 'structural',
                naturalPeriodMs: 3600000, periodTolerancePct: 0.2,
                ts: 1000
            });
            const r = M.recordDecisionTempoAssessment({
                userId: u, resolvedEnv: ENV,
                assessmentId: 'a_scalp_struct',
                decisionId: 'd_scalp_bad',
                decisionHorizonMs: 1200,
                contributingSignals: [
                    { signalKind: 'h4_sr', weight: 1.0 }
                ],
                ts: 2000
            });
            // 1200ms / 3600000ms ≈ 0.00033 → severe_desync
            expect(r.desyncSeverity).toBe('severe_desync');
            expect(r.decisionQualityPenalty).toBe(0.50);
        });
        test('mid horizon + mid signal → mild_desync', () => {
            const u = UID_ASS;
            M.registerSignalTempo({
                userId: u, resolvedEnv: ENV,
                signalKind: 'ofi_short', signalCategory: 'flow',
                naturalPeriodMs: 30000, periodTolerancePct: 0.2,
                ts: 1000
            });
            const r = M.recordDecisionTempoAssessment({
                userId: u, resolvedEnv: ENV,
                assessmentId: 'a_mild',
                decisionId: 'd_mid',
                decisionHorizonMs: 60000,  // 1min
                contributingSignals: [
                    { signalKind: 'ofi_short', weight: 1.0 }
                ],
                ts: 2000
            });
            // 30000 / 60000 = 0.5 → mild_desync (0.30 ≤ 0.5 < 0.70)
            expect(r.desyncSeverity).toBe('mild_desync');
            expect(r.decisionQualityPenalty).toBe(0.20);
        });
        test('missing signal_kind in registry throws', () => {
            const u = UID_ASS;
            expect(() => M.recordDecisionTempoAssessment({
                userId: u, resolvedEnv: ENV,
                assessmentId: 'a_missing',
                decisionId: 'd_missing',
                decisionHorizonMs: 1000,
                contributingSignals: [
                    { signalKind: 'UNKNOWN_SIGNAL', weight: 1.0 }
                ],
                ts: _now()
            })).toThrow(/missing|unknown/i);
        });
        test('duplicate assessmentId throws', () => {
            const u = UID_ASS;
            M.registerSignalTempo({
                userId: u, resolvedEnv: ENV,
                signalKind: 'd_signal', signalCategory: 'flow',
                naturalPeriodMs: 30000, periodTolerancePct: 0.2,
                ts: 1000
            });
            M.recordDecisionTempoAssessment({
                userId: u, resolvedEnv: ENV,
                assessmentId: 'a_dup', decisionId: 'd1',
                decisionHorizonMs: 30000,
                contributingSignals: [{ signalKind: 'd_signal', weight: 1.0 }],
                ts: 2000
            });
            expect(() => M.recordDecisionTempoAssessment({
                userId: u, resolvedEnv: ENV,
                assessmentId: 'a_dup', decisionId: 'd2',
                decisionHorizonMs: 30000,
                contributingSignals: [{ signalKind: 'd_signal', weight: 1.0 }],
                ts: 3000
            })).toThrow(/duplicate/);
        });
    });

    describe('getDecisionAssessment', () => {
        test('returns latest for decision', () => {
            const u = UID_GET;
            M.registerSignalTempo({
                userId: u, resolvedEnv: ENV,
                signalKind: 'lat_sig', signalCategory: 'flow',
                naturalPeriodMs: 30000, periodTolerancePct: 0.2,
                ts: 1000
            });
            M.recordDecisionTempoAssessment({
                userId: u, resolvedEnv: ENV,
                assessmentId: 'a_lat_old', decisionId: 'd_lat',
                decisionHorizonMs: 30000,
                contributingSignals: [{ signalKind: 'lat_sig', weight: 1.0 }],
                ts: 2000
            });
            M.recordDecisionTempoAssessment({
                userId: u, resolvedEnv: ENV,
                assessmentId: 'a_lat_new', decisionId: 'd_lat',
                decisionHorizonMs: 30000,
                contributingSignals: [{ signalKind: 'lat_sig', weight: 1.0 }],
                ts: 3000
            });
            const r = M.getDecisionAssessment({
                userId: u, resolvedEnv: ENV, decisionId: 'd_lat'
            });
            expect(r).not.toBeNull();
            expect(r.assessmentId).toBe('a_lat_new');
        });
        test('returns null when none', () => {
            expect(M.getDecisionAssessment({
                userId: UID_GET, resolvedEnv: ENV,
                decisionId: 'NONEXISTENT'
            })).toBeNull();
        });
    });

    describe('getDesyncedDecisions', () => {
        test('filter by severity', () => {
            const u = UID_DESYNC;
            M.registerSignalTempo({
                userId: u, resolvedEnv: ENV,
                signalKind: 'fast', signalCategory: 'microstructure',
                naturalPeriodMs: 1000, periodTolerancePct: 0.2,
                ts: 1000
            });
            M.registerSignalTempo({
                userId: u, resolvedEnv: ENV,
                signalKind: 'slow', signalCategory: 'macro',
                naturalPeriodMs: 28800000, periodTolerancePct: 0.2,
                ts: 1001
            });
            // In_sync scalp
            M.recordDecisionTempoAssessment({
                userId: u, resolvedEnv: ENV,
                assessmentId: 'a_sync', decisionId: 'd_sync',
                decisionHorizonMs: 1000,
                contributingSignals: [{ signalKind: 'fast', weight: 1.0 }],
                ts: 2000
            });
            // Severe desync scalp w/ macro
            M.recordDecisionTempoAssessment({
                userId: u, resolvedEnv: ENV,
                assessmentId: 'a_sev', decisionId: 'd_sev',
                decisionHorizonMs: 1000,
                contributingSignals: [{ signalKind: 'slow', weight: 1.0 }],
                ts: 3000
            });
            const sev = M.getDesyncedDecisions({
                userId: u, resolvedEnv: ENV,
                severity: 'severe_desync', limit: 10
            });
            expect(sev.length).toBe(1);
            expect(sev[0].assessmentId).toBe('a_sev');
        });
        test('invalid severity throws', () => {
            expect(() => M.getDesyncedDecisions({
                userId: UID_DESYNC, resolvedEnv: ENV,
                severity: 'BOGUS', limit: 10
            })).toThrow();
        });
    });

    describe('isolation per user × env', () => {
        test('uid', () => {
            M.registerSignalTempo({
                userId: UID_ISO_A, resolvedEnv: ENV,
                signalKind: 'iso_sig', signalCategory: 'flow',
                naturalPeriodMs: 30000, periodTolerancePct: 0.2,
                ts: 1000
            });
            M.registerSignalTempo({
                userId: UID_ISO_B, resolvedEnv: ENV,
                signalKind: 'iso_sig', signalCategory: 'flow',
                naturalPeriodMs: 30000, periodTolerancePct: 0.2,
                ts: 1000
            });
            M.recordDecisionTempoAssessment({
                userId: UID_ISO_A, resolvedEnv: ENV,
                assessmentId: 'iso_a', decisionId: 'd_iso_a',
                decisionHorizonMs: 30000,
                contributingSignals: [{ signalKind: 'iso_sig', weight: 1.0 }],
                ts: 2000
            });
            M.recordDecisionTempoAssessment({
                userId: UID_ISO_B, resolvedEnv: ENV,
                assessmentId: 'iso_b', decisionId: 'd_iso_b',
                decisionHorizonMs: 30000,
                contributingSignals: [{ signalKind: 'iso_sig', weight: 1.0 }],
                ts: 2000
            });
            const a = M.getDecisionAssessment({
                userId: UID_ISO_A, resolvedEnv: ENV,
                decisionId: 'd_iso_a'
            });
            const bForA = M.getDecisionAssessment({
                userId: UID_ISO_A, resolvedEnv: ENV,
                decisionId: 'd_iso_b'
            });
            expect(a).not.toBeNull();
            expect(bForA).toBeNull();  // cannot see B's decision
        });
        test('env', () => {
            M.registerSignalTempo({
                userId: UID_ENV, resolvedEnv: 'DEMO',
                signalKind: 'env_sig', signalCategory: 'flow',
                naturalPeriodMs: 30000, periodTolerancePct: 0.2,
                ts: 1000
            });
            M.registerSignalTempo({
                userId: UID_ENV, resolvedEnv: 'TESTNET',
                signalKind: 'env_sig', signalCategory: 'flow',
                naturalPeriodMs: 30000, periodTolerancePct: 0.2,
                ts: 1000
            });
            const demo = M.getSignalTempo({
                userId: UID_ENV, resolvedEnv: 'DEMO',
                signalKind: 'env_sig'
            });
            const testnet = M.getSignalTempo({
                userId: UID_ENV, resolvedEnv: 'TESTNET',
                signalKind: 'env_sig'
            });
            expect(demo).not.toBeNull();
            expect(testnet).not.toBeNull();
            // Different rows in different envs
            expect(demo.naturalPeriodMs).toBe(30000);
            expect(testnet.naturalPeriodMs).toBe(30000);
        });
    });
});
