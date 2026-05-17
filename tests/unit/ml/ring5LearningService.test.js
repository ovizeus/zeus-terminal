'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');

const TEST_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'r5-svc-'));
process.env.ZEUS_DB_PATH = path.join(TEST_DB_DIR, 'test.db');
process.env.ZEUS_TEST_DISABLE_AUTH = '1';

const { db } = require('../../../server/services/database');
const ring5 = require('../../../server/services/ml/ring5LearningService');

const _now = () => Date.now();

function clean() {
    db.prepare("DELETE FROM ml_module_state").run();
    // Clean cross-test pollution from sibling ML test files (shared DB).
    if (db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='ml_bandit_posteriors'").get()) {
        db.prepare("DELETE FROM ml_bandit_posteriors").run();
    }
    if (db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='ml_hypothesis_pre_registrations'").get()) {
        db.prepare("DELETE FROM ml_hypothesis_pre_registrations").run();
    }
    if (db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='ml_governance_versions'").get()) {
        db.prepare("DELETE FROM ml_governance_versions").run();
    }
}

describe('Ring5LearningService Phase 2 facade', () => {
    beforeEach(clean);

    describe('wrap (pass-through with hooks)', () => {
        test('returns phase2 decision unmodified when no ML inputs provided', () => {
            const phase2Decision = {
                dir: 'LONG',
                confidence: 0.72,
                score: 0.65,
                reasons: ['ema_bull', 'vol_high'],
                ts: _now()
            };
            const wrapped = ring5.wrap({
                userId: 1, resolvedEnv: 'DEMO', symbol: 'BTCUSDT',
                phase2Decision, mlBrainProInputs: null
            });
            expect(wrapped.dir).toBe('LONG');
            expect(wrapped.confidence).toBe(0.72);
            expect(wrapped.score).toBe(0.65);
            expect(wrapped.reasons).toEqual(['ema_bull', 'vol_high']);
            expect(wrapped.layeredBy).toBe('phase2-only');
        });

        test('attaches ring5 metadata when mlBrainProInputs provided (read-only mode)', () => {
            const phase2Decision = {
                dir: 'SHORT',
                confidence: 0.55,
                score: 0.40,
                reasons: ['rsi_overbought'],
                ts: _now()
            };
            const mlBrainProInputs = {
                contributions: [
                    { moduleId: 'smartMoneyDetector', contribution: -0.3, confidence: 0.8 },
                    { moduleId: 'regimeMetrics', contribution: -0.1, confidence: 0.6 }
                ]
            };
            const wrapped = ring5.wrap({
                userId: 1, resolvedEnv: 'DEMO', symbol: 'BTCUSDT',
                phase2Decision, mlBrainProInputs
            });
            expect(wrapped.dir).toBe('SHORT');
            expect(wrapped.confidence).toBe(0.55);
            expect(wrapped.score).toBe(0.40);
            expect(wrapped.layeredBy).toBe('ring5-shadow');
            expect(wrapped.ring5Shadow).toBeDefined();
            expect(wrapped.ring5Shadow.contributionsCount).toBe(2);
            expect(wrapped.ring5Shadow.sumContribution).toBeCloseTo(-0.4, 5);
        });

        test('preserves phase2 ts (immutability)', () => {
            const t = 1700000000000;
            const phase2Decision = { dir: 'LONG', confidence: 0.5, score: 0.5, reasons: [], ts: t };
            const wrapped = ring5.wrap({
                userId: 1, resolvedEnv: 'DEMO', symbol: 'BTCUSDT',
                phase2Decision, mlBrainProInputs: null
            });
            expect(wrapped.ts).toBe(t);
        });
    });

    describe('Validation', () => {
        test('rejects missing phase2Decision', () => {
            expect(() => ring5.wrap({
                userId: 1, resolvedEnv: 'DEMO', symbol: 'BTCUSDT',
                mlBrainProInputs: null
            })).toThrow(/phase2Decision/);
        });

        test('rejects invalid resolvedEnv', () => {
            const phase2Decision = { dir: 'LONG', confidence: 0.5, score: 0.5, reasons: [], ts: _now() };
            expect(() => ring5.wrap({
                userId: 1, resolvedEnv: 'BAD', symbol: 'BTCUSDT',
                phase2Decision, mlBrainProInputs: null
            })).toThrow(/resolvedEnv/);
        });

        test('rejects missing userId', () => {
            const phase2Decision = { dir: 'LONG', confidence: 0.5, score: 0.5, reasons: [], ts: _now() };
            expect(() => ring5.wrap({
                resolvedEnv: 'DEMO', symbol: 'BTCUSDT',
                phase2Decision, mlBrainProInputs: null
            })).toThrow(/userId/);
        });
    });

    describe('recordContribution (persists per-module evidence into state)', () => {
        test('inserts new state row for unseen module', () => {
            ring5.recordContribution({
                userId: 1, resolvedEnv: 'DEMO', symbol: 'BTCUSDT', moduleId: 'mod_smart',
                contribution: 0.2,
                confidence: 0.7,
                ts: _now()
            });
            const state = ring5._stateHelper.getModuleState({
                userId: 1, resolvedEnv: 'DEMO', symbol: 'BTCUSDT', moduleId: 'mod_smart'
            });
            expect(state).toBeTruthy();
            expect(state.version).toBe(1);
        });

        test('increments version on repeated contributions for same module', () => {
            const base = {
                userId: 1, resolvedEnv: 'DEMO', symbol: 'BTCUSDT', moduleId: 'mod_repeat',
                contribution: 0.1, confidence: 0.5, ts: _now()
            };
            ring5.recordContribution(base);
            ring5.recordContribution({ ...base, contribution: 0.2 });
            ring5.recordContribution({ ...base, contribution: 0.15 });
            const state = ring5._stateHelper.getModuleState({
                userId: 1, resolvedEnv: 'DEMO', symbol: 'BTCUSDT', moduleId: 'mod_repeat'
            });
            expect(state.version).toBe(3);
        });

        test('isolation across env: same module DEMO vs TESTNET tracked separately', () => {
            const base = {
                userId: 1, symbol: 'BTCUSDT', moduleId: 'iso_env',
                contribution: 0.1, confidence: 0.5, ts: _now()
            };
            ring5.recordContribution({ ...base, resolvedEnv: 'DEMO' });
            ring5.recordContribution({ ...base, resolvedEnv: 'TESTNET' });
            const demo = ring5._stateHelper.getModuleState({
                userId: 1, resolvedEnv: 'DEMO', symbol: 'BTCUSDT', moduleId: 'iso_env'
            });
            const testnet = ring5._stateHelper.getModuleState({
                userId: 1, resolvedEnv: 'TESTNET', symbol: 'BTCUSDT', moduleId: 'iso_env'
            });
            expect(demo.version).toBe(1);
            expect(testnet.version).toBe(1);
        });
    });

    describe('Constraint compliance', () => {
        test('Phase 2 fusion math signature is NOT modified — adapter is pure wrap', () => {
            const phase2Decision = {
                dir: 'LONG', confidence: 0.7, score: 0.65,
                reasons: ['rule1'], ts: _now()
            };
            const wrapped = ring5.wrap({
                userId: 1, resolvedEnv: 'DEMO', symbol: 'BTCUSDT',
                phase2Decision, mlBrainProInputs: null
            });
            expect(wrapped).toBeDefined();
            expect(Object.keys(wrapped)).toEqual(
                expect.arrayContaining(['dir', 'confidence', 'score', 'reasons', 'ts', 'layeredBy'])
            );
        });
    });

    describe('wrap influence mode (Phase 4)', () => {
        const _phase2 = (over = {}) => ({ dir: 'LONG', confidence: 70, score: 5, reasons: ['t1'], ts: Date.now(), ...over });

        beforeEach(() => {
            if (db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='ml_influence_audit'").get()) {
                db.prepare("DELETE FROM ml_influence_audit").run();
            }
        });

        test('mode=shadow (default) preserves Day 1 behavior — no audit row', () => {
            const r = ring5.wrap({
                userId: 1, resolvedEnv: 'DEMO', symbol: 'BTCUSDT',
                phase2Decision: _phase2(), mlBrainProInputs: null
            });
            expect(r.layeredBy).toBe('phase2-only');
            const audit = db.prepare("SELECT COUNT(*) c FROM ml_influence_audit").get();
            expect(audit.c).toBe(0);
        });

        test('mode=influence with no mlBrainProInputs -> not-eligible (no seeded version)', () => {
            const r = ring5.wrap({
                userId: 1, resolvedEnv: 'DEMO', symbol: 'BTCUSDT',
                regime: 'trending', marketContext: {}, nowTs: Date.now(),
                mode: 'influence',
                phase2Decision: _phase2(), mlBrainProInputs: null
            });
            expect(r.layeredBy).toBe('ring5-influence-not-eligible');
            const audit = db.prepare("SELECT gate_status, gate_reason FROM ml_influence_audit").get();
            expect(audit.gate_status).toBe('skipped');
            expect(audit.gate_reason).toMatch(/not_eligible/);
        });

        test('mode=influence with neutral signals -> not-eligible (no seeded version)', () => {
            const r = ring5.wrap({
                userId: 1, resolvedEnv: 'DEMO', symbol: 'BTCUSDT',
                regime: 'trending', marketContext: {}, nowTs: Date.now(),
                mode: 'influence',
                phase2Decision: _phase2(),
                mlBrainProInputs: { contributions: [{ moduleId: 'm', contribution: 0.0 }] }
            });
            expect(r.layeredBy).toBe('ring5-influence-not-eligible');
            expect(r.confidence).toBe(70);
        });

        test('mode=influence not eligible -> skipped + layeredBy=not-eligible + audit gate_reason=not_eligible_*', () => {
            const r = ring5.wrap({
                userId: 99, resolvedEnv: 'DEMO', symbol: 'BTCUSDT',
                regime: 'trending', marketContext: {}, nowTs: Date.now(),
                mode: 'influence',
                phase2Decision: _phase2(),
                mlBrainProInputs: { contributions: [{ moduleId: 'm', contribution: 0.30 }] }
            });
            expect(r.layeredBy).toBe('ring5-influence-not-eligible');
            expect(r.confidence).toBe(70);
            const audit = db.prepare("SELECT gate_status, gate_reason FROM ml_influence_audit WHERE user_id=99 ORDER BY id DESC LIMIT 1").get();
            expect(audit.gate_status).toBe('skipped');
            expect(audit.gate_reason).toMatch(/^not_eligible_/);
        });
    });

    describe('migration 373_ml_influence_audit', () => {
        test('table exists with required columns', () => {
            const cols = db.prepare("PRAGMA table_info(ml_influence_audit)").all();
            const names = cols.map(c => c.name);
            expect(names).toEqual(expect.arrayContaining([
                'id', 'user_id', 'env', 'symbol', 'regime',
                'phase2_dir', 'phase2_confidence', 'phase2_score',
                'proposed_dir', 'proposed_confidence', 'proposed_score',
                'gate_status', 'gate_reason', 'rationale_json',
                'created_at'
            ]));
        });
        test('gate_status CHECK constraint accepts only valid values', () => {
            const stmt = db.prepare(`INSERT INTO ml_influence_audit
                (user_id, env, symbol, regime, phase2_dir, phase2_confidence, phase2_score,
                 proposed_dir, proposed_confidence, proposed_score, gate_status, gate_reason, rationale_json, created_at)
                VALUES (1, 'DEMO', 'BTCUSDT', 'trending', 'LONG', 70, 5, 'LONG', 80, 5.5, ?, 'ok', '{}', ?)`);
            expect(() => stmt.run('accepted', Date.now())).not.toThrow();
            expect(() => stmt.run('rejected', Date.now())).not.toThrow();
            expect(() => stmt.run('skipped', Date.now())).not.toThrow();
            expect(() => stmt.run('INVALID', Date.now())).toThrow();
        });
    });
});
